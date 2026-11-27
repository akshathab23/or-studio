from __future__ import annotations

from collections import OrderedDict
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import io
import json
import math
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
from typing import Any
import uuid

import pandas as pd

from app.schemas import (
    ColumnProfile,
    DatasetCleanupReport,
    DatasetListItem,
    DatasetSummary,
    MappingValidationIssue,
    MappingValidationResponse,
    MultiPeriodColumnMapping,
)
from app.services.lifecycle_lock import lifecycle_lock

DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
DEFAULT_CACHE_SIZE = 16
DEFAULT_UNREFERENCED_TTL_HOURS = 0.0
DEFAULT_MAX_STORAGE_MB = 0.0
DEFAULT_MIN_DATASET_AGE_MINUTES = 60.0
DEFAULT_TEMP_FILE_GRACE_MINUTES = 15.0


class DatasetCleanupDisabledError(PermissionError):
    """Raised when destructive dataset cleanup is invoked while disabled."""

_DB_LOCK = threading.Lock()
_CACHE_LOCK = threading.Lock()
_DF_CACHE: OrderedDict[tuple[str, str | None], pd.DataFrame] = OrderedDict()


class DatasetTooLargeError(ValueError):
    """Raised when an uploaded dataset exceeds the configured maximum size."""


class DatasetInUseError(ValueError):
    """Raised when attempting to delete a dataset referenced by saved scenarios."""

    def __init__(
        self,
        message: str,
        referencing_scenarios: list[dict[str, str]] | None = None,
    ) -> None:
        super().__init__(message)
        self.referencing_scenarios = referencing_scenarios or []


@dataclass
class StoredDataset:
    dataset_id: str
    filename: str
    file_type: str
    sheets: list[str]
    active_sheet: str | None
    df: pd.DataFrame


def get_max_upload_bytes() -> int:
    raw_bytes = os.getenv("OR_STUDIO_MAX_UPLOAD_BYTES", "").strip()
    if raw_bytes:
        try:
            val = int(raw_bytes)
            if val > 0:
                return val
        except ValueError:
            pass
    raw_mb = os.getenv("OR_STUDIO_MAX_UPLOAD_MB", "").strip()
    if raw_mb:
        try:
            val_mb = float(raw_mb)
            if val_mb > 0:
                return int(val_mb * 1024 * 1024)
        except ValueError:
            pass
    return DEFAULT_MAX_UPLOAD_BYTES


def _get_cache_limit() -> int:
    raw = os.getenv("OR_STUDIO_DATASET_CACHE_SIZE", "").strip()
    if raw:
        try:
            val = int(raw)
            if val >= 1:
                return val
        except ValueError:
            pass
    return DEFAULT_CACHE_SIZE


def _get_data_dir() -> Path:
    override = os.getenv("OR_STUDIO_DATA_DIR", "").strip()
    if override:
        path = Path(override)
    else:
        path = Path(__file__).resolve().parents[2] / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _get_datasets_dir() -> Path:
    path = _get_data_dir() / "datasets"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _get_db_path() -> Path:
    return _get_data_dir() / "or_studio_datasets.db"


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_get_db_path(), timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS datasets (
                dataset_id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                file_type TEXT NOT NULL,
                sheets_json TEXT NOT NULL,
                active_sheet TEXT,
                storage_filename TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                last_accessed_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
        yield conn
    finally:
        conn.close()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_dataset_id(dataset_id: str) -> str:
    if not dataset_id or "/" in dataset_id or "\\" in dataset_id or ".." in dataset_id:
        raise KeyError(f"Dataset '{dataset_id}' not found. Please upload the dataset again.")
    try:
        parsed = uuid.UUID(dataset_id)
    except ValueError as exc:
        raise KeyError(
            f"Dataset '{dataset_id}' not found. Please upload the dataset again."
        ) from exc
    canonical = str(parsed)
    if canonical != dataset_id.lower():
        raise KeyError(f"Dataset '{dataset_id}' not found. Please upload the dataset again.")
    return canonical


def _resolve_storage_path(storage_filename: str) -> Path:
    datasets_dir = _get_datasets_dir().resolve()
    candidate = (datasets_dir / storage_filename).resolve()
    if candidate.parent != datasets_dir:
        raise ValueError("Invalid dataset storage path.")
    return candidate


def _write_bytes_atomically(target_path: Path, content: bytes) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(target_path.parent), prefix=".tmp_ds_")
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, target_path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def clear_dataset_cache() -> None:
    """Clear only the in-memory DataFrame cache (does not remove persistent files or metadata)."""
    with _CACHE_LOCK:
        _DF_CACHE.clear()


def get_dataset_cache_size() -> int:
    with _CACHE_LOCK:
        return len(_DF_CACHE)


def _cache_get(dataset_id: str, active_sheet: str | None) -> pd.DataFrame | None:
    key = (dataset_id, active_sheet)
    with _CACHE_LOCK:
        df = _DF_CACHE.get(key)
        if df is None:
            return None
        _DF_CACHE.move_to_end(key)
        return df.copy(deep=True)


def _cache_put(dataset_id: str, active_sheet: str | None, df: pd.DataFrame) -> None:
    key = (dataset_id, active_sheet)
    limit = _get_cache_limit()
    with _CACHE_LOCK:
        _DF_CACHE[key] = df.copy(deep=True)
        _DF_CACHE.move_to_end(key)
        while len(_DF_CACHE) > limit:
            _DF_CACHE.popitem(last=False)


def _cache_evict_dataset(dataset_id: str) -> None:
    with _CACHE_LOCK:
        keys_to_remove = [k for k in _DF_CACHE if k[0] == dataset_id]
        for k in keys_to_remove:
            del _DF_CACHE[k]


def _load_dataframe_from_disk(
    file_path: Path, file_type: str, active_sheet: str | None
) -> pd.DataFrame:
    if not file_path.exists():
        raise KeyError("Dataset file is missing from persistent storage. Please upload it again.")
    if file_type == "csv":
        df = pd.read_csv(file_path)
    elif file_type == "xlsx":
        df = pd.read_excel(file_path, sheet_name=active_sheet or 0, engine="openpyxl")
    else:
        raise ValueError(f"Unsupported stored dataset type: {file_type}")
    df.columns = [str(c).strip() for c in df.columns]
    return df


def _clean_value(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return None
    if pd.isna(val):
        return None
    if hasattr(val, "item"):
        try:
            return val.item()
        except Exception:
            return str(val)
    if isinstance(val, pd.Timestamp):
        return val.isoformat()
    return val


def _infer_column_profile(series: pd.Series) -> ColumnProfile:
    name = str(series.name)
    total = len(series)
    missing_count = int(series.isna().sum())
    non_null_count = total - missing_count
    missing_pct = round((missing_count / total) * 100.0, 2) if total > 0 else 0.0
    unique_count = int(series.nunique(dropna=True))

    non_null = series.dropna()
    stats: dict[str, float | None] | None = None

    if non_null_count == 0:
        inferred_type = "empty"
    elif pd.api.types.is_bool_dtype(series):
        inferred_type = "boolean"
    elif pd.api.types.is_integer_dtype(series):
        inferred_type = "integer"
        stats = _numeric_stats(non_null)
    elif pd.api.types.is_float_dtype(series):
        inferred_type = "float"
        stats = _numeric_stats(non_null)
    elif pd.api.types.is_numeric_dtype(series):
        inferred_type = "numeric"
        stats = _numeric_stats(non_null)
    elif pd.api.types.is_datetime64_any_dtype(series):
        inferred_type = "datetime"
    else:
        parsed = pd.to_numeric(non_null, errors="coerce")
        if len(non_null) > 0 and parsed.notna().all():
            inferred_type = "numeric"
            stats = _numeric_stats(parsed)
        else:
            inferred_type = "categorical"

    return ColumnProfile(
        name=name,
        dtype=str(series.dtype),
        inferred_type=inferred_type,  # type: ignore[arg-type]
        non_null_count=non_null_count,
        missing_count=missing_count,
        missing_percentage=missing_pct,
        unique_count=unique_count,
        stats=stats,
    )


def _numeric_stats(series: pd.Series) -> dict[str, float | None]:
    if len(series) == 0:
        return {"min": None, "max": None, "mean": None, "std": None, "median": None}
    s = pd.to_numeric(series, errors="coerce").dropna()
    if len(s) == 0:
        return {"min": None, "max": None, "mean": None, "std": None, "median": None}
    std_val = float(s.std(ddof=1)) if len(s) > 1 else 0.0
    return {
        "min": round(float(s.min()), 6),
        "max": round(float(s.max()), 6),
        "mean": round(float(s.mean()), 6),
        "std": round(0.0 if math.isnan(std_val) else std_val, 6),
        "median": round(float(s.median()), 6),
    }


def _dataframe_preview(df: pd.DataFrame, offset: int = 0, limit: int = 50) -> list[dict[str, Any]]:
    sliced = df.iloc[offset : offset + limit]
    rows: list[dict[str, Any]] = []
    for _, row in sliced.iterrows():
        rows.append({str(col): _clean_value(row[col]) for col in df.columns})
    return rows


def _build_summary(stored: StoredDataset, preview_limit: int = 50) -> DatasetSummary:
    df = stored.df
    profiles = [_infer_column_profile(df[col]) for col in df.columns]
    return DatasetSummary(
        dataset_id=stored.dataset_id,
        filename=stored.filename,
        file_type=stored.file_type,  # type: ignore[arg-type]
        sheets=stored.sheets,
        active_sheet=stored.active_sheet,
        row_count=int(len(df)),
        column_count=int(len(df.columns)),
        columns=profiles,
        preview_rows=_dataframe_preview(df, 0, preview_limit),
        preview_limit=preview_limit,
    )


def _persist_new_dataset(
    *,
    filename: str,
    file_type: str,
    content: bytes,
    sheets: list[str],
    active_sheet: str | None,
    df: pd.DataFrame,
) -> StoredDataset:
    dataset_id = str(uuid.uuid4())
    storage_filename = f"{dataset_id}.{file_type}"
    target_path = _resolve_storage_path(storage_filename)
    now = _utc_now()

    _write_bytes_atomically(target_path, content)
    try:
        with _DB_LOCK:
            with _connect() as conn:
                conn.execute(
                    """
                    INSERT INTO datasets (
                        dataset_id, filename, file_type, sheets_json, active_sheet,
                        storage_filename, size_bytes, created_at, last_accessed_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        dataset_id,
                        filename,
                        file_type,
                        json.dumps(sheets),
                        active_sheet,
                        storage_filename,
                        len(content),
                        now,
                        now,
                    ),
                )
                conn.commit()
    except Exception:
        try:
            target_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise

    _cache_put(dataset_id, active_sheet, df)
    return StoredDataset(
        dataset_id=dataset_id,
        filename=filename,
        file_type=file_type,
        sheets=sheets,
        active_sheet=active_sheet,
        df=df.copy(deep=True),
    )


def upload_dataset(filename: str, content: bytes) -> DatasetSummary:
    max_bytes = get_max_upload_bytes()
    if len(content) > max_bytes:
        max_mb = max(1, round(max_bytes / (1024 * 1024)))
        raise DatasetTooLargeError(
            f"Uploaded file exceeds the maximum allowed size of {max_mb} MB."
        )

    lower = filename.lower()
    if lower.endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(content))
        except Exception as exc:
            raise ValueError(f"Failed to parse CSV file: {exc}") from exc
        if df.empty and len(df.columns) == 0:
            raise ValueError("Uploaded CSV file has no columns or rows.")
        df.columns = [str(c).strip() for c in df.columns]
        stored = _persist_new_dataset(
            filename=filename,
            file_type="csv",
            content=content,
            sheets=[],
            active_sheet=None,
            df=df,
        )
        return _build_summary(stored)

    if lower.endswith(".xlsx"):
        try:
            with pd.ExcelFile(io.BytesIO(content), engine="openpyxl") as excel:
                sheets = list(excel.sheet_names)
            if not sheets:
                raise ValueError("Excel workbook contains no sheets.")
            active_sheet = sheets[0]
            df = pd.read_excel(
                io.BytesIO(content), sheet_name=active_sheet, engine="openpyxl"
            )
        except Exception as exc:
            raise ValueError(f"Failed to parse Excel (.xlsx) file: {exc}") from exc

        df.columns = [str(c).strip() for c in df.columns]
        stored = _persist_new_dataset(
            filename=filename,
            file_type="xlsx",
            content=content,
            sheets=sheets,
            active_sheet=active_sheet,
            df=df,
        )
        return _build_summary(stored)

    raise ValueError("Unsupported file format. Please upload a .csv or .xlsx file.")


def select_sheet(dataset_id: str, sheet_name: str) -> DatasetSummary:
    canonical_id = _validate_dataset_id(dataset_id)
    with _DB_LOCK:
        with _connect() as conn:
            row = conn.execute(
                "SELECT * FROM datasets WHERE dataset_id = ?", (canonical_id,)
            ).fetchone()
            if row is None:
                raise KeyError(
                    f"Dataset '{dataset_id}' not found. Please upload the dataset again."
                )

            if row["file_type"] != "xlsx":
                raise ValueError(
                    "Sheet selection is only supported for Excel (.xlsx) datasets."
                )
            sheets = json.loads(row["sheets_json"])
            if sheet_name not in sheets:
                raise ValueError(
                    f"Sheet '{sheet_name}' not found. Available sheets: {sheets}"
                )

            file_path = _resolve_storage_path(row["storage_filename"])
            if not file_path.exists():
                raise KeyError(
                    "Dataset file is missing from persistent storage. Please upload it again."
                )
            try:
                df = pd.read_excel(file_path, sheet_name=sheet_name, engine="openpyxl")
            except Exception as exc:
                raise ValueError(f"Failed to load sheet '{sheet_name}': {exc}") from exc

            df.columns = [str(c).strip() for c in df.columns]
            now = _utc_now()
            conn.execute(
                "UPDATE datasets SET active_sheet = ?, last_accessed_at = ? WHERE dataset_id = ?",
                (sheet_name, now, canonical_id),
            )
            conn.commit()
            filename = row["filename"]

    _cache_put(canonical_id, sheet_name, df)
    stored = StoredDataset(
        dataset_id=canonical_id,
        filename=filename,
        file_type="xlsx",
        sheets=sheets,
        active_sheet=sheet_name,
        df=df.copy(deep=True),
    )
    return _build_summary(stored)


def get_dataset(dataset_id: str, sheet_name: str | None = None) -> StoredDataset:
    canonical_id = _validate_dataset_id(dataset_id)
    with _DB_LOCK:
        with _connect() as conn:
            row = conn.execute(
                "SELECT * FROM datasets WHERE dataset_id = ?", (canonical_id,)
            ).fetchone()
            if row is None:
                raise KeyError(
                    f"Dataset '{dataset_id}' not found. Please upload the dataset again."
                )
            filename = row["filename"]
            file_type = row["file_type"]
            sheets = json.loads(row["sheets_json"])
            active_sheet = row["active_sheet"]
            storage_filename = row["storage_filename"]
            conn.execute(
                "UPDATE datasets SET last_accessed_at = ? WHERE dataset_id = ?",
                (_utc_now(), canonical_id),
            )
            conn.commit()

    target_sheet = active_sheet
    if sheet_name is not None:
        if file_type != "xlsx":
            raise ValueError(
                f"Sheet '{sheet_name}' was requested, but dataset '{filename}' is not an Excel (.xlsx) workbook."
            )
        if sheet_name not in sheets:
            raise ValueError(
                f"Saved sheet '{sheet_name}' not found in '{filename}'. Available sheets: {sheets}"
            )
        target_sheet = sheet_name

    cached_df = _cache_get(canonical_id, target_sheet)
    if cached_df is not None:
        return StoredDataset(
            dataset_id=canonical_id,
            filename=filename,
            file_type=file_type,
            sheets=sheets,
            active_sheet=target_sheet,
            df=cached_df,
        )

    file_path = _resolve_storage_path(storage_filename)
    df = _load_dataframe_from_disk(file_path, file_type, target_sheet)
    _cache_put(canonical_id, target_sheet, df)
    return StoredDataset(
        dataset_id=canonical_id,
        filename=filename,
        file_type=file_type,
        sheets=sheets,
        active_sheet=target_sheet,
        df=df.copy(deep=True),
    )


def list_datasets() -> list[DatasetListItem]:
    with _DB_LOCK:
        with _connect() as conn:
            rows = conn.execute(
                """
                SELECT dataset_id, filename, file_type, sheets_json, active_sheet,
                       size_bytes, created_at, last_accessed_at
                FROM datasets
                ORDER BY last_accessed_at DESC, created_at DESC, dataset_id ASC
                """
            ).fetchall()
    return [
        DatasetListItem(
            dataset_id=str(r["dataset_id"]),
            filename=str(r["filename"]),
            file_type=str(r["file_type"]),  # type: ignore[arg-type]
            sheets=json.loads(r["sheets_json"]),
            active_sheet=r["active_sheet"],
            size_bytes=int(r["size_bytes"]),
            created_at=str(r["created_at"]),
            last_accessed_at=str(r["last_accessed_at"]),
        )
        for r in rows
    ]


def get_dataset_summary(dataset_id: str, preview_limit: int = 50) -> DatasetSummary:
    stored = get_dataset(dataset_id)
    return _build_summary(stored, preview_limit=preview_limit)


def get_preview_rows(dataset_id: str, offset: int = 0, limit: int = 50) -> dict[str, Any]:
    stored = get_dataset(dataset_id)
    return {
        "dataset_id": stored.dataset_id,
        "offset": offset,
        "limit": limit,
        "total_rows": int(len(stored.df)),
        "rows": _dataframe_preview(stored.df, offset=offset, limit=limit),
    }


def delete_dataset(dataset_id: str) -> None:
    canonical_id = _validate_dataset_id(dataset_id)

    with lifecycle_lock():
        # Fail closed if the scenario reference registry cannot be queried reliably.
        from app.services.scenario_service import list_scenarios_referencing_dataset

        referencing = list_scenarios_referencing_dataset(canonical_id)
        if referencing:
            preview_names = ", ".join(f'"{s["name"]}"' for s in referencing[:3])
            extra = f" and {len(referencing) - 3} more" if len(referencing) > 3 else ""
            raise DatasetInUseError(
                f"Dataset cannot be deleted because it is referenced by {len(referencing)} saved "
                f"scenario(s): {preview_names}{extra}. Delete those scenarios first.",
                referencing_scenarios=referencing,
            )

        storage_filename: str | None = None
        with _DB_LOCK:
            with _connect() as conn:
                row = conn.execute(
                    "SELECT storage_filename FROM datasets WHERE dataset_id = ?",
                    (canonical_id,),
                ).fetchone()
                if row is None:
                    raise KeyError(f"Dataset '{dataset_id}' not found.")
                storage_filename = row["storage_filename"]
                conn.execute("DELETE FROM datasets WHERE dataset_id = ?", (canonical_id,))
                conn.commit()

        _cache_evict_dataset(canonical_id)
        if storage_filename:
            try:
                _resolve_storage_path(storage_filename).unlink(missing_ok=True)
            except OSError:
                pass


def is_dataset_cleanup_enabled() -> bool:
    return os.getenv("OR_STUDIO_ENABLE_DATASET_CLEANUP", "").strip().lower() == "true"


def _parse_non_negative_float_env(
    name: str, default: float, warnings: list[str]
) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        val = float(raw)
    except ValueError:
        warnings.append(f"Invalid value for {name}='{raw}'; using safe default {default}.")
        return default
    if not math.isfinite(val) or val < 0:
        warnings.append(f"Negative or non-finite {name}='{raw}'; using safe default {default}.")
        return default
    return val


def get_retention_config() -> tuple[dict[str, float | bool], list[str]]:
    warnings: list[str] = []
    ttl_hours = _parse_non_negative_float_env(
        "OR_STUDIO_UNREFERENCED_DATASET_TTL_HOURS",
        DEFAULT_UNREFERENCED_TTL_HOURS,
        warnings,
    )
    max_storage_mb = _parse_non_negative_float_env(
        "OR_STUDIO_MAX_DATASET_STORAGE_MB",
        DEFAULT_MAX_STORAGE_MB,
        warnings,
    )
    min_age_minutes = _parse_non_negative_float_env(
        "OR_STUDIO_MIN_DATASET_AGE_MINUTES",
        DEFAULT_MIN_DATASET_AGE_MINUTES,
        warnings,
    )
    temp_grace_minutes = _parse_non_negative_float_env(
        "OR_STUDIO_TEMP_FILE_GRACE_MINUTES",
        DEFAULT_TEMP_FILE_GRACE_MINUTES,
        warnings,
    )
    return (
        {
            "cleanup_enabled": is_dataset_cleanup_enabled(),
            "ttl_hours": ttl_hours,
            "max_storage_mb": max_storage_mb,
            "min_dataset_age_minutes": min_age_minutes,
            "temp_file_grace_minutes": temp_grace_minutes,
        },
        warnings,
    )


def _parse_iso_timestamp(raw: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def cleanup_unreferenced_datasets(dry_run: bool = True) -> DatasetCleanupReport:
    cfg, warnings = get_retention_config()
    cleanup_enabled = bool(cfg["cleanup_enabled"])
    ttl_hours = float(cfg["ttl_hours"])
    max_storage_mb = float(cfg["max_storage_mb"])
    min_age_minutes = float(cfg["min_dataset_age_minutes"])
    temp_grace_minutes = float(cfg["temp_file_grace_minutes"])

    if not dry_run and not cleanup_enabled:
        raise DatasetCleanupDisabledError(
            "Destructive dataset cleanup is disabled. Set OR_STUDIO_ENABLE_DATASET_CLEANUP=true to allow execution."
        )

    ordering_policy = "oldest_last_accessed_first"
    datasets_dir = _get_datasets_dir().resolve()
    now_dt = datetime.now(timezone.utc)
    now_epoch = now_dt.timestamp()
    min_age_seconds = min_age_minutes * 60.0
    ttl_seconds = ttl_hours * 3600.0
    temp_grace_seconds = temp_grace_minutes * 60.0
    quota_bytes = int(max_storage_mb * 1024 * 1024) if max_storage_mb > 0 else 0

    with lifecycle_lock():
        # Fail closed if the scenario reference registry cannot be queried reliably.
        from app.services.scenario_service import list_all_referenced_dataset_ids

        referenced_ids = list_all_referenced_dataset_ids()

        with _DB_LOCK:
            with _connect() as conn:
                rows = conn.execute(
                    """
                    SELECT dataset_id, filename, file_type, storage_filename,
                           size_bytes, created_at, last_accessed_at
                    FROM datasets
                    ORDER BY last_accessed_at ASC, created_at ASC, dataset_id ASC
                    """
                ).fetchall()

        total_storage_before = 0
        dir_entries: list[Path] = []
        if datasets_dir.exists():
            for entry in sorted(datasets_dir.iterdir(), key=lambda p: p.name):
                if entry.is_symlink():
                    warnings.append(f"Skipped symlink in datasets directory: {entry.name}")
                    continue
                if entry.is_file():
                    dir_entries.append(entry)
                    try:
                        total_storage_before += entry.stat().st_size
                    except OSError as exc:
                        warnings.append(f"Failed to stat '{entry.name}': {exc}")

        eligible_ids: list[str] = []
        eligible_set: set[str] = set()
        eligible_sizes: dict[str, int] = {}
        eligible_storage_names: dict[str, str] = {}
        quota_pool: list[tuple[str, str, int]] = []
        referenced_skipped: list[str] = []
        recent_skipped: list[str] = []
        other_skipped: list[str] = []
        missing_file_findings: list[str] = []
        missing_metadata_findings: list[str] = []
        failed_operations: list[str] = []

        indexed_storage_names: set[str] = set()

        for row in rows:
            raw_id = str(row["dataset_id"])
            storage_name = str(row["storage_filename"])
            try:
                canonical_id = _validate_dataset_id(raw_id)
                file_path = _resolve_storage_path(storage_name)
            except Exception as exc:
                failed_operations.append(f"Invalid dataset record '{raw_id}': {exc}")
                other_skipped.append(raw_id)
                continue

            indexed_storage_names.add(storage_name)
            file_exists = file_path.exists() and file_path.is_file() and not file_path.is_symlink()
            disk_size = 0
            if not file_exists:
                missing_file_findings.append(
                    f"Dataset '{canonical_id}' ({row['filename']}) is missing file '{storage_name}' on disk."
                )
            else:
                try:
                    disk_size = file_path.stat().st_size
                except OSError as exc:
                    warnings.append(f"Could not stat '{storage_name}': {exc}")

            if canonical_id in referenced_ids:
                referenced_skipped.append(canonical_id)
                continue

            if not file_exists:
                other_skipped.append(canonical_id)
                continue

            last_acc_dt = _parse_iso_timestamp(str(row["last_accessed_at"]))
            created_dt = _parse_iso_timestamp(str(row["created_at"]))
            ref_dt = last_acc_dt or created_dt
            if ref_dt is None:
                warnings.append(f"Dataset '{canonical_id}' has invalid timestamps; skipping.")
                other_skipped.append(canonical_id)
                continue

            age_seconds = max(0.0, (now_dt - ref_dt).total_seconds())
            if age_seconds < min_age_seconds:
                recent_skipped.append(canonical_id)
                continue

            if ttl_hours > 0 and age_seconds >= ttl_seconds:
                eligible_ids.append(canonical_id)
                eligible_set.add(canonical_id)
                eligible_sizes[canonical_id] = disk_size
                eligible_storage_names[canonical_id] = storage_name
            else:
                quota_pool.append((canonical_id, storage_name, disk_size))

        projected_storage = total_storage_before - sum(eligible_sizes.values())
        if quota_bytes > 0 and projected_storage > quota_bytes:
            for cand_id, storage_name, disk_size in quota_pool:
                if projected_storage <= quota_bytes:
                    break
                eligible_ids.append(cand_id)
                eligible_set.add(cand_id)
                eligible_sizes[cand_id] = disk_size
                eligible_storage_names[cand_id] = storage_name
                projected_storage -= disk_size

        for cand_id, _storage_name, _disk_size in quota_pool:
            if cand_id not in eligible_set:
                other_skipped.append(cand_id)

        # Scan temporary & orphan files
        temp_files_scanned = 0
        eligible_temp_files: list[tuple[Path, int]] = []
        orphan_files_scanned = 0
        eligible_orphan_files: list[tuple[Path, int]] = []

        for entry in dir_entries:
            name = entry.name
            if name.startswith(".tmp_ds_"):
                temp_files_scanned += 1
                try:
                    st = entry.stat()
                    age = max(0.0, now_epoch - st.st_mtime)
                    if age >= temp_grace_seconds:
                        eligible_temp_files.append((entry, st.st_size))
                except OSError as exc:
                    failed_operations.append(f"Failed to inspect temp file '{name}': {exc}")
                continue

            if name in indexed_storage_names:
                continue

            # Unindexed file in datasets/
            suffix = entry.suffix.lower()
            stem = entry.stem
            if suffix not in {".csv", ".xlsx"}:
                warnings.append(f"Ignored unexpected unindexed file type '{name}' in datasets directory.")
                continue
            try:
                canonical_stem = _validate_dataset_id(stem)
            except KeyError:
                warnings.append(f"Ignored non-UUID unindexed file '{name}' in datasets directory.")
                continue

            missing_metadata_findings.append(
                f"Unindexed dataset file '{name}' found on disk without metadata record."
            )
            orphan_files_scanned += 1
            if canonical_stem in referenced_ids:
                warnings.append(
                    f"Protected unindexed file '{name}' because scenario(s) reference '{canonical_stem}'."
                )
                continue

            try:
                st = entry.stat()
                age = max(0.0, now_epoch - st.st_mtime)
                if age >= temp_grace_seconds:
                    eligible_orphan_files.append((entry, st.st_size))
            except OSError as exc:
                failed_operations.append(f"Failed to inspect orphan file '{name}': {exc}")

        datasets_deleted: list[str] = []
        temp_files_removed: list[str] = []
        orphan_files_removed: list[str] = []
        bytes_freed = 0

        if not dry_run:
            for ds_id in eligible_ids:
                storage_name = eligible_storage_names[ds_id]
                disk_size = eligible_sizes[ds_id]
                try:
                    file_path = _resolve_storage_path(storage_name)
                    with _DB_LOCK:
                        with _connect() as conn:
                            cur = conn.execute(
                                "DELETE FROM datasets WHERE dataset_id = ?",
                                (ds_id,),
                            )
                            conn.commit()
                    if cur.rowcount == 0:
                        failed_operations.append(f"Dataset '{ds_id}' disappeared before deletion.")
                        continue
                    file_path.unlink(missing_ok=True)
                    _cache_evict_dataset(ds_id)
                    datasets_deleted.append(ds_id)
                    bytes_freed += disk_size
                except Exception as exc:
                    failed_operations.append(f"Failed to delete dataset '{ds_id}': {exc}")

            for tmp_path, tmp_size in eligible_temp_files:
                try:
                    tmp_path.unlink(missing_ok=False)
                    temp_files_removed.append(tmp_path.name)
                    bytes_freed += tmp_size
                except OSError as exc:
                    failed_operations.append(f"Failed to remove temp file '{tmp_path.name}': {exc}")

            for orphan_path, orphan_size in eligible_orphan_files:
                try:
                    orphan_path.unlink(missing_ok=False)
                    orphan_files_removed.append(orphan_path.name)
                    bytes_freed += orphan_size
                except OSError as exc:
                    failed_operations.append(
                        f"Failed to remove orphan file '{orphan_path.name}': {exc}"
                    )

        total_storage_after = max(0, total_storage_before - bytes_freed)
        quota_achieved = quota_bytes <= 0 or (
            (projected_storage if dry_run else total_storage_after) <= quota_bytes
        )
        if not quota_achieved:
            warnings.append(
                "Storage quota target could not be fully achieved because remaining datasets are "
                "referenced by saved scenarios or within minimum age protection."
            )

        return DatasetCleanupReport(
            dry_run=dry_run,
            cleanup_enabled=cleanup_enabled,
            ttl_hours=ttl_hours,
            max_storage_mb=max_storage_mb,
            min_dataset_age_minutes=min_age_minutes,
            temp_file_grace_minutes=temp_grace_minutes,
            ordering_policy=ordering_policy,
            datasets_scanned=len(rows),
            eligible_datasets=eligible_ids,
            datasets_deleted=datasets_deleted,
            bytes_freed=bytes_freed,
            referenced_datasets_skipped=referenced_skipped,
            recent_datasets_skipped=recent_skipped,
            other_datasets_skipped=other_skipped,
            temp_files_scanned=temp_files_scanned,
            temp_files_removed=temp_files_removed,
            orphan_files_scanned=orphan_files_scanned,
            orphan_files_removed=orphan_files_removed,
            missing_file_findings=missing_file_findings,
            missing_metadata_findings=missing_metadata_findings,
            failed_operations=failed_operations,
            warnings=warnings,
            quota_target_achieved=quota_achieved,
            total_storage_bytes_before=total_storage_before,
            total_storage_bytes_after=total_storage_after,
        )


def register_prepared_dataset(filename: str, df: pd.DataFrame) -> DatasetSummary:
    df_clean = df.copy()
    df_clean.columns = [str(c).strip() for c in df_clean.columns]
    csv_bytes = df_clean.to_csv(index=False).encode("utf-8")
    stored = _persist_new_dataset(
        filename=filename,
        file_type="csv",
        content=csv_bytes,
        sheets=[],
        active_sheet=None,
        df=df_clean,
    )
    return _build_summary(stored)


def validate_multi_period_mapping(
    dataset_id: str,
    mapping: MultiPeriodColumnMapping,
    sheet_name: str | None = None,
) -> MappingValidationResponse:
    stored = get_dataset(dataset_id, sheet_name=sheet_name)
    df = stored.df
    issues: list[MappingValidationIssue] = []

    if df.empty:
        issues.append(
            MappingValidationIssue(
                field="dataset",
                column="",
                severity="error",
                message="The active sheet/dataset has 0 rows.",
            )
        )
        return MappingValidationResponse(
            valid=False, compatible=False, issues=issues, detected_summary={}
        )

    required_fields = {
        "product": mapping.product,
        "period": mapping.period,
        "demand": mapping.demand,
    }
    optional_numeric_fields = {
        "production_cost": mapping.production_cost,
        "inventory_cost": mapping.inventory_cost,
        "capacity": mapping.capacity,
        "processing_time": mapping.processing_time,
        "initial_inventory": mapping.initial_inventory,
        "setup_cost": mapping.setup_cost,
        "setup_time": mapping.setup_time,
    }
    optional_id_fields = {
        "resource": mapping.resource,
    }

    all_mapped = {**required_fields, **optional_numeric_fields, **optional_id_fields}

    # 1. Check column existence & missing values (never silently substitute!)
    for field, col in all_mapped.items():
        if col is None or col == "":
            continue
        if col not in df.columns:
            issues.append(
                MappingValidationIssue(
                    field=field,
                    column=col,
                    severity="error",
                    message=f"Column '{col}' mapped to '{field}' does not exist in dataset.",
                )
            )
            continue

        missing = int(df[col].isna().sum())
        if missing > 0:
            issues.append(
                MappingValidationIssue(
                    field=field,
                    column=col,
                    severity="error",
                    message=(
                        f"Column '{col}' (mapped to '{field}') has {missing} missing value(s). "
                        "OR Studio does not silently substitute missing values."
                    ),
                )
            )

    # 2. Numeric validation for numeric fields
    numeric_fields = ["demand", *optional_numeric_fields.keys()]
    for field in numeric_fields:
        col = all_mapped.get(field)
        if not col or col not in df.columns:
            continue
        non_null = df[col].dropna()
        parsed = pd.to_numeric(non_null, errors="coerce")
        bad_count = int(parsed.isna().sum())
        if bad_count > 0:
            issues.append(
                MappingValidationIssue(
                    field=field,
                    column=col,
                    severity="error",
                    message=f"Column '{col}' (mapped to '{field}') contains {bad_count} non-numeric value(s).",
                )
            )
        elif (parsed < 0).any() and field in {
            "demand",
            "capacity",
            "processing_time",
            "initial_inventory",
            "setup_time",
        }:
            neg_count = int((parsed < 0).sum())
            issues.append(
                MappingValidationIssue(
                    field=field,
                    column=col,
                    severity="error",
                    message=f"Column '{col}' (mapped to '{field}') has {neg_count} negative value(s), which is invalid.",
                )
            )

    # 3. Check duplicate (product, period) if no resource or check consistency
    products = 0
    periods = 0
    repeated_pairs = 0
    if mapping.product in df.columns and mapping.period in df.columns:
        products = int(df[mapping.product].nunique(dropna=True))
        periods = int(df[mapping.period].nunique(dropna=True))
        if products == 0 or periods == 0:
            issues.append(
                MappingValidationIssue(
                    field="product",
                    column=mapping.product,
                    severity="error",
                    message="Product or Period column has 0 unique values.",
                )
            )
        else:
            if products == 1:
                other_multi = [
                    str(c)
                    for c in df.columns
                    if str(c) not in {mapping.product, mapping.period}
                    and not pd.api.types.is_numeric_dtype(df[c])
                    and int(df[c].nunique(dropna=True)) > 1
                ]
                if other_multi:
                    issues.append(
                        MappingValidationIssue(
                            field="product",
                            column=mapping.product,
                            severity="warning",
                            message=(
                                f"Mapped Product column '{mapping.product}' has only 1 unique value, "
                                f"while column(s) {', '.join(other_multi[:3])} have multiple values. "
                                "Verify your Product mapping."
                            ),
                        )
                    )
            dup_mask = df.duplicated(subset=[mapping.product, mapping.period], keep=False)
            if dup_mask.any():
                repeated_pairs = int(
                    df.loc[dup_mask, [mapping.product, mapping.period]]
                    .drop_duplicates()
                    .shape[0]
                )
                issues.append(
                    MappingValidationIssue(
                        field="product",
                        column=mapping.product,
                        severity="warning",
                        message=(
                            f"Detected {repeated_pairs} repeated (Product, Period) combination(s) "
                            f"across {int(dup_mask.sum())} rows. Demand will be summed per "
                            "(Product, Period) and unit costs/times averaged."
                        ),
                    )
                )

    # 4. Model compatibility warnings
    if not mapping.production_cost and not mapping.inventory_cost and not mapping.setup_cost:
        issues.append(
            MappingValidationIssue(
                field="production_cost",
                column="",
                severity="warning",
                message=(
                    "No cost columns (production_cost, inventory_cost, setup_cost) are mapped. "
                    "The solver will minimize total production + ending inventory as a feasibility proxy."
                ),
            )
        )

    if mapping.processing_time and not mapping.capacity:
        issues.append(
            MappingValidationIssue(
                field="capacity",
                column="",
                severity="warning",
                message="Processing time is mapped without Capacity; capacity constraints will not be enforced.",
            )
        )

    has_errors = any(i.severity == "error" for i in issues)
    detected_summary = {
        "row_count": int(len(df)),
        "unique_products": products,
        "unique_periods": periods,
        "unique_resources": (
            int(df[mapping.resource].nunique(dropna=True))
            if mapping.resource and mapping.resource in df.columns
            else 0
        ),
        "has_capacity": bool(mapping.capacity and mapping.capacity in df.columns),
        "has_costs": bool(
            (mapping.production_cost and mapping.production_cost in df.columns)
            or (mapping.inventory_cost and mapping.inventory_cost in df.columns)
        ),
        "has_setup": bool(
            (mapping.setup_cost and mapping.setup_cost in df.columns)
            or (mapping.setup_time and mapping.setup_time in df.columns)
        ),
    }

    return MappingValidationResponse(
        valid=not has_errors,
        compatible=not has_errors,
        issues=issues,
        detected_summary=detected_summary,
    )

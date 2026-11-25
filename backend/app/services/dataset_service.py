from __future__ import annotations

import io
import math
import uuid
from dataclasses import dataclass
from typing import Any

import pandas as pd

from app.schemas import (
    ColumnProfile,
    DatasetSummary,
    MappingValidationIssue,
    MappingValidationResponse,
    MultiPeriodColumnMapping,
)


@dataclass
class StoredDataset:
    dataset_id: str
    filename: str
    file_type: str
    raw_bytes: bytes
    sheets: list[str]
    active_sheet: str | None
    df: pd.DataFrame


_DATASET_STORE: dict[str, StoredDataset] = {}


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
        # Check if object/string column actually parses cleanly as numeric
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


def upload_dataset(filename: str, content: bytes) -> DatasetSummary:
    lower = filename.lower()
    if lower.endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(content))
        except Exception as exc:
            raise ValueError(f"Failed to parse CSV file: {exc}") from exc
        if df.empty and len(df.columns) == 0:
            raise ValueError("Uploaded CSV file has no columns or rows.")
        df.columns = [str(c).strip() for c in df.columns]
        dataset_id = str(uuid.uuid4())
        stored = StoredDataset(
            dataset_id=dataset_id,
            filename=filename,
            file_type="csv",
            raw_bytes=content,
            sheets=[],
            active_sheet=None,
            df=df,
        )
        _DATASET_STORE[dataset_id] = stored
        return _build_summary(stored)

    if lower.endswith(".xlsx"):
        try:
            excel = pd.ExcelFile(io.BytesIO(content), engine="openpyxl")
            sheets = list(excel.sheet_names)
            if not sheets:
                raise ValueError("Excel workbook contains no sheets.")
            active_sheet = sheets[0]
            df = excel.parse(active_sheet)
        except Exception as exc:
            raise ValueError(f"Failed to parse Excel (.xlsx) file: {exc}") from exc

        df.columns = [str(c).strip() for c in df.columns]
        dataset_id = str(uuid.uuid4())
        stored = StoredDataset(
            dataset_id=dataset_id,
            filename=filename,
            file_type="xlsx",
            raw_bytes=content,
            sheets=sheets,
            active_sheet=active_sheet,
            df=df,
        )
        _DATASET_STORE[dataset_id] = stored
        return _build_summary(stored)

    raise ValueError("Unsupported file format. Please upload a .csv or .xlsx file.")


def select_sheet(dataset_id: str, sheet_name: str) -> DatasetSummary:
    stored = get_dataset(dataset_id)
    if stored.file_type != "xlsx":
        raise ValueError("Sheet selection is only supported for Excel (.xlsx) datasets.")
    if sheet_name not in stored.sheets:
        raise ValueError(f"Sheet '{sheet_name}' not found. Available sheets: {stored.sheets}")

    try:
        excel = pd.ExcelFile(io.BytesIO(stored.raw_bytes), engine="openpyxl")
        df = excel.parse(sheet_name)
    except Exception as exc:
        raise ValueError(f"Failed to load sheet '{sheet_name}': {exc}") from exc

    df.columns = [str(c).strip() for c in df.columns]
    stored.active_sheet = sheet_name
    stored.df = df
    return _build_summary(stored)


def get_dataset(dataset_id: str) -> StoredDataset:
    if dataset_id not in _DATASET_STORE:
        raise KeyError(f"Dataset '{dataset_id}' not found. Please upload the dataset again.")
    return _DATASET_STORE[dataset_id]


def get_dataset_summary(dataset_id: str, preview_limit: int = 50) -> DatasetSummary:
    stored = get_dataset(dataset_id)
    return _build_summary(stored, preview_limit=preview_limit)


def get_preview_rows(dataset_id: str, offset: int = 0, limit: int = 50) -> dict[str, Any]:
    stored = get_dataset(dataset_id)
    return {
        "dataset_id": dataset_id,
        "offset": offset,
        "limit": limit,
        "total_rows": int(len(stored.df)),
        "rows": _dataframe_preview(stored.df, offset=offset, limit=limit),
    }


def delete_dataset(dataset_id: str) -> None:
    if dataset_id not in _DATASET_STORE:
        raise KeyError(f"Dataset '{dataset_id}' not found.")
    del _DATASET_STORE[dataset_id]


def validate_multi_period_mapping(
    dataset_id: str,
    mapping: MultiPeriodColumnMapping,
) -> MappingValidationResponse:
    stored = get_dataset(dataset_id)
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

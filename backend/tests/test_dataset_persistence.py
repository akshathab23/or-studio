from __future__ import annotations

import io
import sqlite3
from pathlib import Path

from fastapi import HTTPException, UploadFile
import pandas as pd
import pytest

from app.main import api_upload_dataset
from app.schemas import MultiPeriodColumnMapping, MultiPeriodSolveRequest
from app.services.dataset_service import (
    DatasetTooLargeError,
    clear_dataset_cache,
    delete_dataset,
    get_dataset,
    get_dataset_cache_size,
    get_dataset_summary,
    get_preview_rows,
    register_prepared_dataset,
    select_sheet,
    upload_dataset,
    validate_multi_period_mapping,
)
from app.services.multi_period_solver import solve_multi_period


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OR_STUDIO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OR_STUDIO_SCENARIO_DB", str(tmp_path / "scenarios.db"))
    clear_dataset_cache()
    yield
    clear_dataset_cache()


def _make_xlsx_bytes(sheets: dict[str, pd.DataFrame]) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        for name, df in sheets.items():
            df.to_excel(writer, sheet_name=name, index=False)
    return buf.getvalue()


def test_csv_upload_and_persistent_reload_after_cache_clear(tmp_path: Path):
    csv_data = "product,period,demand,prod_cost,inv_cost,capacity\nA,P1,50,10,2,100\nA,P2,60,10,2,100\n"
    summary = upload_dataset("sales.csv", csv_data.encode("utf-8"))
    assert summary.row_count == 2
    assert (tmp_path / "datasets" / f"{summary.dataset_id}.csv").exists()
    assert (tmp_path / "or_studio_datasets.db").exists()

    # Simulate backend restart / second worker with empty cache
    clear_dataset_cache()
    assert get_dataset_cache_size() == 0

    reloaded = get_dataset(summary.dataset_id)
    assert reloaded.filename == "sales.csv"
    assert len(reloaded.df) == 2

    reloaded_summary = get_dataset_summary(summary.dataset_id)
    assert reloaded_summary.row_count == 2
    preview = get_preview_rows(summary.dataset_id, offset=1, limit=1)
    assert preview["total_rows"] == 2
    assert len(preview["rows"]) == 1
    assert preview["rows"][0]["period"] == "P2"


def test_xlsx_multisheet_and_sheet_selection_persists_across_cache_clear(tmp_path: Path):
    df1 = pd.DataFrame({"product": ["A"], "period": ["P1"], "demand": [40]})
    df2 = pd.DataFrame({"product": ["A", "B"], "period": ["P1", "P1"], "demand": [80, 90]})
    xlsx_bytes = _make_xlsx_bytes({"Sheet1": df1, "Sheet2": df2})

    summary = upload_dataset("multi.xlsx", xlsx_bytes)
    assert summary.active_sheet == "Sheet1"
    assert summary.row_count == 1
    assert (tmp_path / "datasets" / f"{summary.dataset_id}.xlsx").exists()

    updated = select_sheet(summary.dataset_id, "Sheet2")
    assert updated.active_sheet == "Sheet2"
    assert updated.row_count == 2

    # Simulate second worker / restart
    clear_dataset_cache()
    reloaded = get_dataset(summary.dataset_id)
    assert reloaded.active_sheet == "Sheet2"
    assert len(reloaded.df) == 2


def test_cross_instance_sheet_selection_does_not_return_stale_sheet(tmp_path: Path):
    df1 = pd.DataFrame({"product": ["A"], "period": ["P1"], "demand": [10]})
    df2 = pd.DataFrame({"product": ["B", "C"], "period": ["P1", "P2"], "demand": [20, 30]})
    xlsx_bytes = _make_xlsx_bytes({"Initial": df1, "Updated": df2})

    summary = upload_dataset("cross_worker.xlsx", xlsx_bytes)
    # Worker A has Initial cached; simulate Worker B updating SQLite active_sheet directly
    db_path = tmp_path / "or_studio_datasets.db"
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "UPDATE datasets SET active_sheet = ? WHERE dataset_id = ?",
            ("Updated", summary.dataset_id),
        )
        conn.commit()
    finally:
        conn.close()

    # Worker A must check SQLite authoritative active_sheet and load Updated, not stale Initial
    reloaded = get_dataset(summary.dataset_id)
    assert reloaded.active_sheet == "Updated"
    assert len(reloaded.df) == 2


def test_prepared_dataset_persists_and_solves_after_cache_clear():
    df = pd.DataFrame(
        {
            "product": ["WidgetA", "WidgetA"],
            "period": ["2025-Q1", "2025-Q2"],
            "demand": [100, 120],
            "production_cost": [10, 10],
            "inventory_cost": [2, 2],
            "capacity": [150, 150],
        }
    )
    summary = register_prepared_dataset("uci_prepared.csv", df)
    clear_dataset_cache()

    mapping = MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
        production_cost="production_cost",
        inventory_cost="inventory_cost",
        capacity="capacity",
    )
    val = validate_multi_period_mapping(summary.dataset_id, mapping)
    assert val.valid is True

    sol = solve_multi_period(MultiPeriodSolveRequest(dataset_id=summary.dataset_id, mapping=mapping))
    assert sol.is_optimal is True
    assert sol.constraints_feasible is True
    assert sol.objective_value == 2200.0


def test_delete_removes_metadata_and_file(tmp_path: Path):
    summary = upload_dataset("del.csv", b"product,period,demand\nA,P1,10\n")
    file_path = tmp_path / "datasets" / f"{summary.dataset_id}.csv"
    assert file_path.exists()

    delete_dataset(summary.dataset_id)
    assert not file_path.exists()
    with pytest.raises(KeyError):
        get_dataset(summary.dataset_id)


def test_invalid_dataset_ids_never_create_unsafe_paths(tmp_path: Path):
    for bad_id in ["../evil", "..\\evil", "not-a-uuid", "a/b/c", ""]:
        with pytest.raises(KeyError):
            get_dataset(bad_id)
        with pytest.raises(KeyError):
            delete_dataset(bad_id)
    # No unexpected files created
    assert list((tmp_path / "datasets").glob("*")) == []


def test_oversized_upload_rejected_and_leaves_no_artifacts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("OR_STUDIO_MAX_UPLOAD_BYTES", "100")

    # Direct service check
    with pytest.raises(DatasetTooLargeError):
        upload_dataset("big.csv", b"a" * 200)
    assert list((tmp_path / "datasets").glob("*")) == []

    # Endpoint chunked streaming check returns 413 and stops before reading unbounded data
    upload = UploadFile(filename="big.csv", file=io.BytesIO(b"x" * 250))
    with pytest.raises(HTTPException) as exc_info:
        api_upload_dataset(upload)
    assert exc_info.value.status_code == 413
    assert "exceeds" in str(exc_info.value.detail).lower()
    assert list((tmp_path / "datasets").glob("*")) == []


def test_failed_upload_leaves_no_partial_registration(tmp_path: Path):
    with pytest.raises(ValueError):
        upload_dataset("bad.txt", b"hello")
    with pytest.raises(ValueError):
        upload_dataset("corrupt.xlsx", b"not-an-excel-zip")
    assert list((tmp_path / "datasets").glob("*")) == []


def test_bounded_lru_cache_eviction_preserves_persistent_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("OR_STUDIO_DATASET_CACHE_SIZE", "2")
    ids = []
    for i in range(4):
        s = upload_dataset(f"ds_{i}.csv", f"product,period,demand\nP{i},T1,{10 + i}\n".encode("utf-8"))
        ids.append(s.dataset_id)

    assert get_dataset_cache_size() == 2
    for ds_id in ids:
        assert (tmp_path / "datasets" / f"{ds_id}.csv").exists()

    # Evicted earliest dataset must still reload cleanly from disk
    reloaded = get_dataset(ids[0])
    assert int(reloaded.df["demand"].iloc[0]) == 10
    assert get_dataset_cache_size() == 2


def test_returned_dataframe_copy_does_not_mutate_cache():
    s = upload_dataset("immut.csv", b"product,period,demand\nA,P1,50\n")
    ds1 = get_dataset(s.dataset_id)
    ds1.df.loc[0, "demand"] = 9999

    ds2 = get_dataset(s.dataset_id)
    assert int(ds2.df.loc[0, "demand"]) == 50

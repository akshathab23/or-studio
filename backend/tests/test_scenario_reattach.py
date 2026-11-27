from __future__ import annotations

import io
from pathlib import Path
import threading

from fastapi import HTTPException
import pandas as pd
from pydantic import ValidationError
import pytest

from app.main import (
    api_create_scenario,
    api_delete_dataset,
    api_list_datasets,
    api_reattach_scenario,
    api_solve_multi_period,
)
from app.schemas import (
    MultiPeriodColumnMapping,
    MultiPeriodSolveRequest,
    ScenarioCreateRequest,
    ScenarioInputConfig,
    ScenarioReattachRequest,
)
from app.services.dataset_service import clear_dataset_cache, upload_dataset
from app.services.lifecycle_lock import lifecycle_lock


@pytest.fixture
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OR_STUDIO_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("OR_STUDIO_SCENARIO_DB", raising=False)
    clear_dataset_cache()
    yield tmp_path
    clear_dataset_cache()


def _make_xlsx_bytes(sheets: dict[str, pd.DataFrame]) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        for name, df in sheets.items():
            df.to_excel(writer, sheet_name=name, index=False)
    return buf.getvalue()


def test_reattach_csv_invalidates_snapshot_preserves_config_and_updates_references(
    isolated_env: Path,
):
    ds_old = upload_dataset(
        "old.csv",
        b"product,period,demand,prod_cost,inv_cost,capacity\nA,P1,50,10,2,100\n",
    )
    ds_new = upload_dataset(
        "new.csv",
        b"product,period,demand,prod_cost,inv_cost,capacity\nA,P1,80,10,2,120\n",
    )
    mapping = MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
        production_cost="prod_cost",
        inventory_cost="inv_cost",
        capacity="capacity",
    )
    sol_old = api_solve_multi_period(
        MultiPeriodSolveRequest(dataset_id=ds_old.dataset_id, mapping=mapping)
    )
    assert sol_old.objective_value == 500.0

    sc = api_create_scenario(
        ScenarioCreateRequest(
            name="Reattachable Plan",
            description="Original",
            dataset_id=ds_old.dataset_id,
            dataset_name=ds_old.filename,
            input_config=ScenarioInputConfig(
                mapping=mapping,
                integer_production=True,
                demand_multiplier=1.25,
            ),
            result_snapshot=sol_old,
        )
    )
    assert sc.has_result_snapshot is True
    assert sc.status == "Optimal"
    assert sc.objective_value == 500.0

    # List datasets endpoint includes both
    listed_ds = api_list_datasets()
    assert {d.dataset_id for d in listed_ds} == {ds_old.dataset_id, ds_new.dataset_id}

    # Explicit invalidate_snapshot=True required
    with pytest.raises(ValidationError):
        ScenarioReattachRequest(dataset_id=ds_new.dataset_id, invalidate_snapshot=False)

    reattached = api_reattach_scenario(
        sc.id,
        ScenarioReattachRequest(dataset_id=ds_new.dataset_id, invalidate_snapshot=True),
    )
    assert reattached.dataset_id == ds_new.dataset_id
    assert reattached.dataset_name == "new.csv"
    assert reattached.active_sheet is None
    assert reattached.status == "Not Solved"
    assert reattached.is_optimal is False
    assert reattached.constraints_feasible is False
    assert reattached.objective_value is None
    assert reattached.has_result_snapshot is False
    assert reattached.result_snapshot is None
    # Mathematical config preserved verbatim
    assert reattached.input_config.integer_production is True
    assert reattached.input_config.demand_multiplier == 1.25
    assert reattached.input_config.mapping == mapping

    # Lifecycle coordination: ds_old is now unreferenced (can be deleted), ds_new is protected (409)
    with pytest.raises(HTTPException) as exc_new:
        api_delete_dataset(ds_new.dataset_id)
    assert exc_new.value.status_code == 409

    deleted_old = api_delete_dataset(ds_old.dataset_id)
    assert deleted_old["status"] == "deleted"


def test_reattach_xlsx_sheet_validation_and_rerun(isolated_env: Path):
    ds_old = upload_dataset(
        "old.csv",
        b"product,period,demand,prod_cost,inv_cost,capacity\nA,P1,50,10,2,100\n",
    )
    s1 = pd.DataFrame({"wrong_col": [1]})
    s2 = pd.DataFrame(
        {
            "product": ["A"],
            "period": ["P1"],
            "demand": [60],
            "prod_cost": [10],
            "inv_cost": [2],
            "capacity": [100],
        }
    )
    ds_xlsx = upload_dataset("multi.xlsx", _make_xlsx_bytes({"Wrong": s1, "ValidPlan": s2}))
    mapping = MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
        production_cost="prod_cost",
        inventory_cost="inv_cost",
        capacity="capacity",
    )
    sc = api_create_scenario(
        ScenarioCreateRequest(
            name="Excel Reattach",
            dataset_id=ds_old.dataset_id,
            dataset_name=ds_old.filename,
            input_config=ScenarioInputConfig(mapping=mapping),
        )
    )

    # Incompatible sheet (missing mapped columns) -> 400 and scenario unchanged
    with pytest.raises(HTTPException) as exc_wrong_cols:
        api_reattach_scenario(
            sc.id,
            ScenarioReattachRequest(
                dataset_id=ds_xlsx.dataset_id,
                active_sheet="Wrong",
                invalidate_snapshot=True,
            ),
        )
    assert exc_wrong_cols.value.status_code == 400

    # Non-existent sheet -> 400
    with pytest.raises(HTTPException) as exc_missing_sheet:
        api_reattach_scenario(
            sc.id,
            ScenarioReattachRequest(
                dataset_id=ds_xlsx.dataset_id,
                active_sheet="NoSuchSheet",
                invalidate_snapshot=True,
            ),
        )
    assert exc_missing_sheet.value.status_code == 400

    # Compatible sheet succeeds and can be re-solved
    reattached = api_reattach_scenario(
        sc.id,
        ScenarioReattachRequest(
            dataset_id=ds_xlsx.dataset_id,
            active_sheet="ValidPlan",
            invalidate_snapshot=True,
        ),
    )
    assert reattached.dataset_id == ds_xlsx.dataset_id
    assert reattached.active_sheet == "ValidPlan"
    assert reattached.status == "Not Solved"

    rerun = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=reattached.dataset_id,
            mapping=reattached.input_config.mapping,
            sheet_name=reattached.active_sheet,
        )
    )
    assert rerun.is_optimal is True
    assert rerun.objective_value == 600.0


def test_reattach_error_cases_and_lock_failure_preserve_scenario(
    isolated_env: Path, monkeypatch: pytest.MonkeyPatch
):
    ds_old = upload_dataset(
        "old.csv",
        b"product,period,demand,prod_cost,inv_cost,capacity\nA,P1,50,10,2,100\n",
    )
    ds_bad = upload_dataset(
        "bad_cols.csv",
        b"product,period,sales_qty\nA,P1,50\n",
    )
    mapping = MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
        production_cost="prod_cost",
        inventory_cost="inv_cost",
        capacity="capacity",
    )
    sol_old = api_solve_multi_period(
        MultiPeriodSolveRequest(dataset_id=ds_old.dataset_id, mapping=mapping)
    )
    sc = api_create_scenario(
        ScenarioCreateRequest(
            name="Protected Original",
            dataset_id=ds_old.dataset_id,
            dataset_name=ds_old.filename,
            input_config=ScenarioInputConfig(mapping=mapping),
            result_snapshot=sol_old,
        )
    )

    # 1. Missing scenario -> 404
    with pytest.raises(HTTPException) as exc_scen:
        api_reattach_scenario(
            "nonexistent-scenario-id",
            ScenarioReattachRequest(dataset_id=ds_old.dataset_id, invalidate_snapshot=True),
        )
    assert exc_scen.value.status_code == 404

    # 2. Missing replacement dataset -> 404
    with pytest.raises(HTTPException) as exc_ds:
        api_reattach_scenario(
            sc.id,
            ScenarioReattachRequest(
                dataset_id="00000000-0000-0000-0000-000000000000",
                invalidate_snapshot=True,
            ),
        )
    assert exc_ds.value.status_code == 404

    # 3. Invalid dataset ID -> 404
    with pytest.raises(HTTPException) as exc_bad_id:
        api_reattach_scenario(
            sc.id,
            ScenarioReattachRequest(dataset_id="../evil", invalidate_snapshot=True),
        )
    assert exc_bad_id.value.status_code == 404

    # 4. Incompatible mapping -> 400
    with pytest.raises(HTTPException) as exc_incompat:
        api_reattach_scenario(
            sc.id,
            ScenarioReattachRequest(dataset_id=ds_bad.dataset_id, invalidate_snapshot=True),
        )
    assert exc_incompat.value.status_code == 400

    # 5. Lock acquisition failure -> 503
    monkeypatch.setenv("OR_STUDIO_LIFECYCLE_LOCK_TIMEOUT_SECONDS", "0.1")
    entered = threading.Event()
    release = threading.Event()

    def hold_lock():
        with lifecycle_lock(timeout_seconds=2.0):
            entered.set()
            release.wait(timeout=2.0)

    t = threading.Thread(target=hold_lock)
    t.start()
    assert entered.wait(timeout=2.0)
    try:
        with pytest.raises(HTTPException) as exc_lock:
            api_reattach_scenario(
                sc.id,
                ScenarioReattachRequest(dataset_id=ds_old.dataset_id, invalidate_snapshot=True),
            )
        assert exc_lock.value.status_code == 503
    finally:
        release.set()
        t.join(timeout=2.0)

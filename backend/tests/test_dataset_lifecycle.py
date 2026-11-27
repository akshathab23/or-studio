from __future__ import annotations

import io
from pathlib import Path

from fastapi import HTTPException
import pandas as pd
import pytest

from app.main import (
    api_create_scenario,
    api_delete_dataset,
    api_delete_scenario,
    api_solve_multi_period,
)
from app.schemas import (
    MultiPeriodColumnMapping,
    MultiPeriodSolveRequest,
    ScenarioCreateRequest,
    ScenarioInputConfig,
)
from app.services import scenario_service
from app.services.dataset_service import (
    DatasetInUseError,
    clear_dataset_cache,
    delete_dataset,
    get_dataset,
    select_sheet,
    upload_dataset,
)


@pytest.fixture
def isolated_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
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


def test_scenario_db_follows_data_dir_and_override_and_wal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    data_dir = tmp_path / "unified_data"
    monkeypatch.setenv("OR_STUDIO_DATA_DIR", str(data_dir))
    monkeypatch.delenv("OR_STUDIO_SCENARIO_DB", raising=False)

    assert scenario_service._get_db_path() == data_dir / "or_studio_scenarios.db"

    with scenario_service._connect() as conn:
        journal = conn.execute("PRAGMA journal_mode;").fetchone()[0]
        busy = conn.execute("PRAGMA busy_timeout;").fetchone()[0]
        assert str(journal).lower() == "wal"
        assert int(busy) == 5000

    custom_db = tmp_path / "custom" / "override_scenarios.db"
    monkeypatch.setenv("OR_STUDIO_SCENARIO_DB", str(custom_db))
    assert scenario_service._get_db_path() == custom_db


def test_unreferenced_dataset_deletion_succeeds(isolated_storage: Path):
    ds = upload_dataset("unref.csv", b"product,period,demand\nA,P1,10\n")
    file_path = isolated_storage / "datasets" / f"{ds.dataset_id}.csv"
    assert file_path.exists()

    res = api_delete_dataset(ds.dataset_id)
    assert res == {"status": "deleted", "dataset_id": ds.dataset_id}
    assert not file_path.exists()


def test_referenced_dataset_protected_with_409_and_unblocked_after_scenario_delete(
    isolated_storage: Path,
):
    ds = upload_dataset(
        "protected.csv",
        b"product,period,demand,prod_cost,inv_cost,capacity\nA,P1,50,10,2,100\n",
    )
    file_path = isolated_storage / "datasets" / f"{ds.dataset_id}.csv"
    mapping = MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
        production_cost="prod_cost",
        inventory_cost="inv_cost",
        capacity="capacity",
    )
    sol = api_solve_multi_period(MultiPeriodSolveRequest(dataset_id=ds.dataset_id, mapping=mapping))

    s1 = api_create_scenario(
        ScenarioCreateRequest(
            name="Scenario Alpha",
            dataset_id=ds.dataset_id,
            dataset_name=ds.filename,
            input_config=ScenarioInputConfig(mapping=mapping),
            result_snapshot=sol,
        )
    )

    # Single-reference 409 check
    with pytest.raises(HTTPException) as exc1:
        api_delete_dataset(ds.dataset_id)
    assert exc1.value.status_code == 409
    assert "Scenario Alpha" in str(exc1.value.detail)
    assert file_path.exists()

    # Multi-reference check
    s2 = api_create_scenario(
        ScenarioCreateRequest(
            name="Scenario Beta",
            dataset_id=ds.dataset_id,
            dataset_name=ds.filename,
            input_config=ScenarioInputConfig(mapping=mapping, demand_multiplier=1.1),
        )
    )
    refs = scenario_service.list_scenarios_referencing_dataset(ds.dataset_id)
    assert {r["id"] for r in refs} == {s1.id, s2.id}
    assert {r["name"] for r in refs} == {"Scenario Alpha", "Scenario Beta"}

    with pytest.raises(DatasetInUseError) as exc_in_use:
        delete_dataset(ds.dataset_id)
    assert len(exc_in_use.value.referencing_scenarios) == 2
    assert file_path.exists()
    assert len(get_dataset(ds.dataset_id).df) == 1

    # Deleting scenarios unblocks dataset deletion
    api_delete_scenario(s1.id)
    with pytest.raises(HTTPException) as exc_still_used:
        api_delete_dataset(ds.dataset_id)
    assert exc_still_used.value.status_code == 409

    api_delete_scenario(s2.id)
    deleted = api_delete_dataset(ds.dataset_id)
    assert deleted["status"] == "deleted"
    assert not file_path.exists()


def test_delete_fails_closed_if_scenario_registry_unreadable(
    isolated_storage: Path, monkeypatch: pytest.MonkeyPatch
):
    ds = upload_dataset("fail_closed.csv", b"product,period,demand\nA,P1,10\n")
    file_path = isolated_storage / "datasets" / f"{ds.dataset_id}.csv"

    def boom(_dataset_id: str):
        raise RuntimeError("Scenario DB unavailable")

    monkeypatch.setattr(scenario_service, "list_scenarios_referencing_dataset", boom)

    with pytest.raises(RuntimeError):
        delete_dataset(ds.dataset_id)
    assert file_path.exists()
    assert len(get_dataset(ds.dataset_id).df) == 1


def test_multisheet_scenario_rerun_uses_saved_sheet_and_rejects_missing_sheet(
    isolated_storage: Path,
):
    sheet_a = pd.DataFrame(
        {
            "product": ["A"],
            "period": ["P1"],
            "demand": [100],
            "prod_cost": [10],
            "inv_cost": [2],
            "capacity": [150],
        }
    )
    sheet_b = pd.DataFrame(
        {
            "product": ["B"],
            "period": ["P1"],
            "demand": [40],
            "prod_cost": [5],
            "inv_cost": [1],
            "capacity": [100],
        }
    )
    ds = upload_dataset("sheets.xlsx", _make_xlsx_bytes({"PlanA": sheet_a, "PlanB": sheet_b}))
    mapping = MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
        production_cost="prod_cost",
        inventory_cost="inv_cost",
        capacity="capacity",
    )

    # Save scenario on PlanA (obj = 1000)
    sol_a = api_solve_multi_period(
        MultiPeriodSolveRequest(dataset_id=ds.dataset_id, mapping=mapping, sheet_name="PlanA")
    )
    assert sol_a.objective_value == 1000.0
    sc_a = api_create_scenario(
        ScenarioCreateRequest(
            name="PlanA Baseline",
            dataset_id=ds.dataset_id,
            dataset_name=ds.filename,
            active_sheet="PlanA",
            input_config=ScenarioInputConfig(mapping=mapping),
            result_snapshot=sol_a,
        )
    )

    # Switch global active sheet to PlanB
    switched = select_sheet(ds.dataset_id, "PlanB")
    assert switched.active_sheet == "PlanB"

    # Rerunning sc_a with its saved active_sheet must still solve PlanA (1000.0) without mutating PlanB
    rerun_a = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=sc_a.input_config.mapping,
            sheet_name=sc_a.active_sheet,
        )
    )
    assert rerun_a.objective_value == 1000.0
    assert get_dataset(ds.dataset_id).active_sheet == "PlanB"

    # Missing/invalid saved sheet must fail explicitly with 400
    with pytest.raises(HTTPException) as exc_bad_sheet:
        api_solve_multi_period(
            MultiPeriodSolveRequest(
                dataset_id=ds.dataset_id,
                mapping=mapping,
                sheet_name="DeletedSheet",
            )
        )
    assert exc_bad_sheet.value.status_code == 400
    assert "DeletedSheet" in str(exc_bad_sheet.value.detail)

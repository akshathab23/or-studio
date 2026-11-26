from __future__ import annotations

import io
import pandas as pd
import pytest
from fastapi import HTTPException

from app.main import (
    api_delete_dataset,
    api_get_dataset,
    api_preview_dataset,
    api_select_sheet,
    api_solve_goal_programming,
    api_solve_mcdm,
    api_solve_multi_period,
    api_validate_mapping,
    health_check,
)
from app.schemas import (
    GoalProgrammingSolveRequest,
    MCDMSolveRequest,
    MultiPeriodColumnMapping,
    MultiPeriodSolveRequest,
    SheetSelectRequest,
)
from app.services.dataset_service import upload_dataset


def test_health():
    res = health_check()
    assert res["status"] == "ok"


def test_csv_upload_preview_and_delete():
    csv_data = (
        "product,period,demand,prod_cost,inv_cost,capacity\n"
        "A,1,100,10,2,250\n"
        "A,2,120,10,2,250\n"
        "B,1,80,15,3,250\n"
        "B,2,90,15,3,250\n"
    )
    summary = upload_dataset("test_prod.csv", csv_data.encode("utf-8"))
    assert summary.filename == "test_prod.csv"
    assert summary.row_count == 4
    assert summary.column_count == 6

    prev = api_preview_dataset(summary.dataset_id, offset=0, limit=2)
    assert len(prev["rows"]) == 2

    deleted = api_delete_dataset(summary.dataset_id)
    assert deleted["status"] == "deleted"
    with pytest.raises(HTTPException) as exc:
        api_get_dataset(summary.dataset_id)
    assert exc.value.status_code == 404


def test_excel_multisheet_and_missing_value_validation():
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        pd.DataFrame({"col_a": [1, 2], "col_b": ["x", "y"]}).to_excel(
            writer, sheet_name="Meta", index=False
        )
        pd.DataFrame(
            {
                "sku": ["P1", "P1", "P2", "P2"],
                "t": [1, 2, 1, 2],
                "qty_demand": [50, None, 40, 60],
                "cost": [5.0, 5.0, 8.0, 8.0],
            }
        ).to_excel(writer, sheet_name="DemandPlan", index=False)

    summary = upload_dataset("workbook.xlsx", buf.getvalue())
    assert summary.sheets == ["Meta", "DemandPlan"]
    assert summary.active_sheet == "Meta"

    switched = api_select_sheet(summary.dataset_id, SheetSelectRequest(sheet_name="DemandPlan"))
    assert switched.active_sheet == "DemandPlan"
    demand_col = next(c for c in switched.columns if c.name == "qty_demand")
    assert demand_col.missing_count == 1

    val = api_validate_mapping(
        summary.dataset_id,
        MultiPeriodColumnMapping(
            product="sku", period="t", demand="qty_demand", production_cost="cost"
        ),
    )
    assert val.valid is False
    assert any("missing value" in i.message for i in val.issues)


def test_multi_period_solver_optimal_and_infeasible():
    csv_feasible = (
        "product,period,demand,prod_cost,inv_cost,capacity,proc_time\n"
        "P1,1,100,10,2,120,1\n"
        "P1,2,140,10,2,120,1\n"
    )
    ds = upload_dataset("feasible.csv", csv_feasible.encode("utf-8"))
    sol = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=MultiPeriodColumnMapping(
                product="product",
                period="period",
                demand="demand",
                production_cost="prod_cost",
                inventory_cost="inv_cost",
                capacity="capacity",
                processing_time="proc_time",
            ),
            integer_production=False,
        )
    )
    assert sol.is_optimal is True
    assert sol.status == "Optimal"
    assert sol.constraints_feasible is True
    assert sol.objective_value is not None
    assert abs(sol.objective_value - 2440.0) < 1e-4

    csv_infeasible = (
        "product,period,demand,prod_cost,inv_cost,capacity\n"
        "P1,1,150,10,2,120\n"
        "P1,2,100,10,2,120\n"
    )
    ds2 = upload_dataset("infeasible.csv", csv_infeasible.encode("utf-8"))
    sol2 = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds2.dataset_id,
            mapping=MultiPeriodColumnMapping(
                product="product",
                period="period",
                demand="demand",
                production_cost="prod_cost",
                inventory_cost="inv_cost",
                capacity="capacity",
            ),
        )
    )
    assert sol2.is_optimal is False
    assert sol2.status == "Infeasible"


def test_multi_period_repeated_product_period_aggregation():
    # Two rows for (P1, 1) with demands 30 and 20 (sum=50) and costs 10 and 20 (mean=15)
    csv_dup = (
        "product,period,demand,prod_cost,inv_cost,capacity\n"
        "P1,1,30,10,2,100\n"
        "P1,1,20,20,2,100\n"
    )
    ds = upload_dataset("dup.csv", csv_dup.encode("utf-8"))
    val = api_validate_mapping(
        ds.dataset_id,
        MultiPeriodColumnMapping(
            product="product",
            period="period",
            demand="demand",
            production_cost="prod_cost",
            inventory_cost="inv_cost",
            capacity="capacity",
        ),
    )
    assert val.valid is True
    assert any(
        i.severity == "warning" and "repeated (Product, Period)" in i.message
        for i in val.issues
    )

    sol = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=MultiPeriodColumnMapping(
                product="product",
                period="period",
                demand="demand",
                production_cost="prod_cost",
                inventory_cost="inv_cost",
                capacity="capacity",
            ),
        )
    )
    assert sol.is_optimal is True
    assert abs((sol.total_demand or 0) - 50.0) < 1e-6
    assert abs((sol.objective_value or 0) - 750.0) < 1e-4  # 50 * mean(10, 20) = 750
    assert "Aggregated 1 repeated (Product, Period)" in sol.message


def test_multi_period_30_row_per_product_capacity_regression():
    # 5 products x 6 periods = 30 rows with per-product Capacity_Units (varies across products)
    rows = [
        "Product,Period,Demand_Units,Capacity_Units,Unit_Profit,Production_Cost,Holding_Cost,Target_Units"
    ]
    total_dem = 0
    for p_idx in range(1, 6):
        for t in range(1, 7):
            dem = 95 + p_idx * 2 + t
            cap = dem + 25
            total_dem += dem
            rows.append(f"P{p_idx},{t},{dem},{cap},50,20,2,{dem}")
    ds = upload_dataset("prod_30.csv", "\n".join(rows).encode("utf-8"))

    # Auto-detect should recognize per-product capacity and solve to Optimal
    sol_auto = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=MultiPeriodColumnMapping(
                product="Product",
                period="Period",
                demand="Demand_Units",
                production_cost="Production_Cost",
                inventory_cost="Holding_Cost",
                capacity="Capacity_Units",
            ),
        )
    )
    assert sol_auto.is_optimal is True
    assert sol_auto.status == "Optimal"
    assert sol_auto.constraints_feasible is True
    assert abs((sol_auto.total_demand or 0) - total_dem) < 1e-6
    assert len(sol_auto.production_schedule) == 30
    assert len(sol_auto.period_summary) == 6
    assert sol_auto.cost_breakdown is not None
    assert "production_cost" in sol_auto.cost_breakdown
    assert len(sol_auto.resource_utilization) == 30

    # Explicit aggregate_period on the same dataset should still be Infeasible
    sol_agg = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=MultiPeriodColumnMapping(
                product="Product",
                period="Period",
                demand="Demand_Units",
                production_cost="Production_Cost",
                inventory_cost="Holding_Cost",
                capacity="Capacity_Units",
            ),
            capacity_scope="aggregate_period",
        )
    )
    assert sol_agg.is_optimal is False
    assert sol_agg.status == "Infeasible"


def test_multi_period_10_row_36_period_and_15_product_completeness():
    # 1. 10-row dataset (2 products x 5 periods, aggregate capacity 100 >= 40+40)
    rows_10 = ["product,period,demand,prod_cost,inv_cost,capacity"]
    for p in ["A", "B"]:
        for t in range(1, 6):
            rows_10.append(f"{p},{t},40,10,2,100")
    ds10 = upload_dataset("ten_rows.csv", "\n".join(rows_10).encode("utf-8"))
    sol10 = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds10.dataset_id,
            mapping=MultiPeriodColumnMapping(
                product="product",
                period="period",
                demand="demand",
                production_cost="prod_cost",
                inventory_cost="inv_cost",
                capacity="capacity",
            ),
        )
    )
    assert sol10.is_optimal is True
    assert len(sol10.period_summary) == 5
    assert len(sol10.production_schedule) == 10

    # 2. 36-period dataset with unsorted YYYY-MM labels
    rows_36 = ["product,period,demand,prod_cost,inv_cost,capacity"]
    months = [f"{2023 + (m // 12)}-{(m % 12) + 1:02d}" for m in range(36)]
    for m in reversed(months):  # intentionally reverse order to test chronological sort
        rows_36.append(f"SKU1,{m},25,8,1,40")
    ds36 = upload_dataset("periods_36.csv", "\n".join(rows_36).encode("utf-8"))
    sol36 = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds36.dataset_id,
            mapping=MultiPeriodColumnMapping(
                product="product",
                period="period",
                demand="demand",
                production_cost="prod_cost",
                inventory_cost="inv_cost",
                capacity="capacity",
            ),
        )
    )
    assert sol36.is_optimal is True
    assert [p["period"] for p in sol36.period_summary] == months
    sum_period_cost = sum(p["total_cost"] for p in sol36.period_summary)
    assert sol36.objective_value is not None
    assert abs(sum_period_cost - sol36.objective_value) < 1e-3

    # 3. 15 products (>12 products) across 4 natural alphanumeric periods
    rows_15 = ["product,period,demand,prod_cost,inv_cost,capacity"]
    for p_idx in range(1, 16):
        for per in ["Month 10", "Month 2", "Month 1", "Month 3"]:
            rows_15.append(f"Item_{p_idx:02d},{per},{10 + p_idx},5,1,{30 + p_idx}")
    ds15 = upload_dataset("products_15.csv", "\n".join(rows_15).encode("utf-8"))
    sol15 = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds15.dataset_id,
            mapping=MultiPeriodColumnMapping(
                product="product",
                period="period",
                demand="demand",
                production_cost="prod_cost",
                inventory_cost="inv_cost",
                capacity="capacity",
            ),
        )
    )
    assert sol15.is_optimal is True
    assert [p["period"] for p in sol15.period_summary] == [
        "Month 1",
        "Month 2",
        "Month 3",
        "Month 10",
    ]
    unique_prods = {r["product"] for r in sol15.production_schedule}
    assert len(unique_prods) == 15


def test_multi_period_15_products_10_periods_nonzero_inventory():
    # 15 products x 10 periods (150 rows), with higher production cost in periods 6 & 10
    # so the solver holds non-zero ending inventory across multiple periods.
    rows = ["product,period,demand,prod_cost,inv_cost,setup_cost,capacity"]
    periods = [f"2025-{m:02d}" for m in range(1, 11)]
    for p_idx in range(1, 16):
        for idx, per in enumerate(periods, start=1):
            dem = 15 + p_idx
            pc = 25 if idx in (6, 10) else 10
            cap = dem * 2 + 10
            rows.append(f"SKU_{p_idx:02d},{per},{dem},{pc},2,5,{cap}")
    ds = upload_dataset("prod_15x10.csv", "\n".join(rows).encode("utf-8"))
    sol = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=MultiPeriodColumnMapping(
                product="product",
                period="period",
                demand="demand",
                production_cost="prod_cost",
                inventory_cost="inv_cost",
                setup_cost="setup_cost",
                capacity="capacity",
            ),
        )
    )
    assert sol.is_optimal is True
    assert sol.constraints_feasible is True
    assert [p["period"] for p in sol.period_summary] == periods
    assert len({r["product"] for r in sol.production_schedule}) == 15
    assert (sol.total_ending_inventory or 0) > 0
    nonzero_inv_periods = sum(
        1 for p in sol.period_summary if p["total_ending_inventory"] > 0
    )
    assert nonzero_inv_periods >= 2
    assert sol.cost_breakdown is not None
    assert set(sol.cost_breakdown.keys()) == {"production_cost", "inventory_cost", "setup_cost"}
    sum_period_cost = sum(p["total_cost"] for p in sol.period_summary)
    assert sol.objective_value is not None
    assert abs(sum_period_cost - sol.objective_value) < 1e-3


def test_single_product_mapping_warning_when_other_multi_product_column_exists():
    csv_data = (
        "plant,sku,period,demand\n"
        "PlantA,SKU1,2025-01,10\n"
        "PlantA,SKU2,2025-01,20\n"
    )
    ds = upload_dataset("warn_1prod.csv", csv_data.encode("utf-8"))
    val = api_validate_mapping(
        ds.dataset_id,
        MultiPeriodColumnMapping(product="plant", period="period", demand="demand"),
    )
    assert val.valid is True
    assert any(
        i.severity == "warning" and "only 1 unique value" in i.message
        for i in val.issues
    )


def test_goal_programming_weighted_and_preemptive():
    base = dict(
        variables=[
            {"name": "x1", "lower_bound": 0, "var_type": "continuous"},
            {"name": "x2", "lower_bound": 0, "var_type": "continuous"},
        ],
        hard_constraints=[
            {"name": "Labor", "coefficients": {"x1": 2, "x2": 1}, "operator": "<=", "rhs": 100},
        ],
        goals=[
            {
                "name": "Profit",
                "coefficients": {"x1": 10, "x2": 8},
                "goal_type": "minimum",
                "target": 600,
                "priority": 1,
                "weight": 1.0,
            },
            {
                "name": "Overtime",
                "coefficients": {"x1": 1, "x2": 1},
                "goal_type": "maximum",
                "target": 40,
                "priority": 2,
                "weight": 5.0,
            },
        ],
    )

    sw = api_solve_goal_programming(GoalProgrammingSolveRequest(method="weighted", **base))
    assert sw.is_optimal is True
    assert sw.method == "weighted"

    sp = api_solve_goal_programming(GoalProgrammingSolveRequest(method="preemptive", **base))
    assert sp.is_optimal is True
    assert sp.method == "preemptive"
    profit_goal = next(g for g in sp.goal_results if g.name == "Profit")
    assert profit_goal.negative_deviation is not None
    assert profit_goal.negative_deviation <= 1e-5
    assert profit_goal.status == "Achieved"


def test_mcdm_topsis():
    res = api_solve_mcdm(
        MCDMSolveRequest(
            method="topsis",
            criteria=[
                {"name": "Cost", "weight": 0.4, "direction": "cost"},
                {"name": "Quality", "weight": 0.6, "direction": "benefit"},
            ],
            alternatives=[
                {"name": "Supplier A", "scores": {"Cost": 100, "Quality": 80}},
                {"name": "Supplier B", "scores": {"Cost": 130, "Quality": 95}},
                {"name": "Supplier C", "scores": {"Cost": 90, "Quality": 60}},
            ],
        )
    )
    assert len(res.rankings) == 3
    assert res.rankings[0].rank == 1


def test_multi_period_scenario_multiplier_validation():
    from pydantic import ValidationError
    import pytest

    base_map = MultiPeriodColumnMapping(product="product", period="period", demand="demand")
    for bad in [0.0, -0.5, float("nan"), float("inf"), 11.0]:
        with pytest.raises(ValidationError):
            MultiPeriodSolveRequest(
                dataset_id="dummy",
                mapping=base_map,
                demand_multiplier=bad,
            )
        with pytest.raises(ValidationError):
            MultiPeriodSolveRequest(
                dataset_id="dummy",
                mapping=base_map,
                capacity_multiplier=bad,
            )
        with pytest.raises(ValidationError):
            MultiPeriodSolveRequest(
                dataset_id="dummy",
                mapping=base_map,
                production_cost_multiplier=bad,
            )


def test_multi_period_whatif_parametric_overrides_and_baseline_isolation():
    csv_data = (
        "product,period,demand,prod_cost,inv_cost,capacity\n"
        "A,P1,100,10,2,150\n"
        "A,P2,100,10,2,150\n"
    )
    ds = upload_dataset("whatif_test.csv", csv_data.encode("utf-8"))
    mapping = MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
        production_cost="prod_cost",
        inventory_cost="inv_cost",
        capacity="capacity",
    )

    # 1. Baseline
    baseline = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=mapping,
            integer_production=True,
        )
    )
    assert baseline.is_optimal is True
    assert baseline.total_demand == 200.0
    assert baseline.total_production == 200.0
    assert baseline.objective_value == 2000.0
    assert baseline.integer_production is True

    # 2. Demand multiplier (1.2x)
    dem_scen = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=mapping,
            integer_production=True,
            demand_multiplier=1.2,
        )
    )
    assert dem_scen.is_optimal is True
    assert dem_scen.total_demand == 240.0
    assert dem_scen.total_production == 240.0
    assert dem_scen.objective_value == 2400.0
    assert dem_scen.integer_production is True

    # 3. Production cost multiplier (1.5x) — only production cost scales
    cost_scen = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=mapping,
            integer_production=True,
            production_cost_multiplier=1.5,
        )
    )
    assert cost_scen.is_optimal is True
    assert cost_scen.total_demand == 200.0
    assert cost_scen.objective_value == 3000.0
    assert cost_scen.cost_breakdown is not None
    assert cost_scen.cost_breakdown["production_cost"] == 3000.0

    # 4. Capacity multiplier (0.5x -> 75 per period < 100 demand -> Infeasible)
    cap_infeasible = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=mapping,
            integer_production=True,
            capacity_multiplier=0.5,
        )
    )
    assert cap_infeasible.is_optimal is False
    assert cap_infeasible.status == "Infeasible"

    # 5. Capacity multiplier (0.8x -> 120 per period >= 100 demand -> Optimal with scaled capacity)
    cap_feasible = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=mapping,
            integer_production=True,
            capacity_multiplier=0.8,
        )
    )
    assert cap_feasible.is_optimal is True
    assert all(r["capacity"] == 120.0 for r in cap_feasible.resource_utilization)

    # 6. Baseline isolation — re-solving baseline still produces original dataset values
    baseline_after = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=mapping,
            integer_production=True,
        )
    )
    assert baseline_after.total_demand == 200.0
    assert baseline_after.objective_value == 2000.0
    assert all(r["capacity"] == 150.0 for r in baseline_after.resource_utilization)


def test_scenario_management_crud_persistence_and_validation(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from pydantic import ValidationError
    import pytest
    from app.main import (
        api_create_scenario,
        api_delete_scenario,
        api_get_scenario,
        api_list_scenarios,
        api_update_scenario,
    )
    from app.schemas import ScenarioCreateRequest, ScenarioInputConfig, ScenarioUpdateRequest

    db_file = tmp_path / "test_scenarios.db"
    monkeypatch.setenv("OR_STUDIO_SCENARIO_DB", str(db_file))

    csv_data = (
        "product,period,demand,prod_cost,inv_cost,capacity\n"
        "A,P1,100,10,2,150\n"
        "A,P2,100,10,2,150\n"
    )
    ds = upload_dataset("scen_crud.csv", csv_data.encode("utf-8"))
    mapping = MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
        production_cost="prod_cost",
        inventory_cost="inv_cost",
        capacity="capacity",
    )

    opt_sol = api_solve_multi_period(
        MultiPeriodSolveRequest(dataset_id=ds.dataset_id, mapping=mapping)
    )
    inf_sol = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id, mapping=mapping, capacity_multiplier=0.5
        )
    )
    assert opt_sol.is_optimal is True
    assert inf_sol.is_optimal is False

    # 1. Invalid inputs (empty name, non-finite multiplier)
    with pytest.raises(ValidationError):
        ScenarioCreateRequest(
            name="   ",
            input_config=ScenarioInputConfig(mapping=mapping),
        )
    with pytest.raises(ValidationError):
        ScenarioInputConfig(mapping=mapping, demand_multiplier=float("nan"))

    # 2. Save optimal scenario
    s1 = api_create_scenario(
        ScenarioCreateRequest(
            name="Baseline Plan",
            description="Initial baseline run",
            dataset_id=ds.dataset_id,
            dataset_name=ds.filename,
            input_config=ScenarioInputConfig(mapping=mapping),
            result_snapshot=opt_sol,
        )
    )
    assert s1.name == "Baseline Plan"
    assert s1.is_optimal is True
    assert s1.objective_value == 2000.0
    assert s1.has_result_snapshot is True

    # 3. Duplicate name handling (case-insensitive -> 409)
    with pytest.raises(HTTPException) as exc_dup:
        api_create_scenario(
            ScenarioCreateRequest(
                name="baseline plan",
                input_config=ScenarioInputConfig(mapping=mapping),
            )
        )
    assert exc_dup.value.status_code == 409

    # 4. Save infeasible scenario
    s2 = api_create_scenario(
        ScenarioCreateRequest(
            name="Tight Capacity 50%",
            description="Infeasible stress test",
            dataset_id=ds.dataset_id,
            dataset_name=ds.filename,
            input_config=ScenarioInputConfig(mapping=mapping, capacity_multiplier=0.5),
            result_snapshot=inf_sol,
        )
    )
    assert s2.is_optimal is False
    assert s2.status == "Infeasible"
    assert s2.has_result_snapshot is True

    # 5. List & Retrieve by ID (verifies SQLite persistence)
    listed = api_list_scenarios()
    assert len(listed) == 2
    fetched = api_get_scenario(s1.id)
    assert fetched.result_snapshot is not None
    assert fetched.result_snapshot.objective_value == 2000.0
    assert fetched.input_config.mapping.product == "product"

    # 6. Update metadata (rename & description) + duplicate rename rejected
    updated = api_update_scenario(
        s2.id,
        ScenarioUpdateRequest(name="Capacity Crunch 50%", description="Updated desc"),
    )
    assert updated.name == "Capacity Crunch 50%"
    assert updated.description == "Updated desc"
    with pytest.raises(HTTPException) as exc_ren_dup:
        api_update_scenario(s2.id, ScenarioUpdateRequest(name="Baseline Plan"))
    assert exc_ren_dup.value.status_code == 409

    # 6b. Snapshot immutability on re-run & explicit Update Saved Snapshot
    rerun_cost = api_solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=ds.dataset_id,
            mapping=mapping,
            production_cost_multiplier=1.5,
        )
    )
    assert rerun_cost.objective_value == 3000.0
    # Saved snapshot for s1 must remain 2000.0 until explicitly updated
    assert api_get_scenario(s1.id).objective_value == 2000.0

    updated_snap = api_update_scenario(
        s1.id,
        ScenarioUpdateRequest(result_snapshot=rerun_cost),
    )
    assert updated_snap.objective_value == 3000.0
    assert api_get_scenario(s1.id).objective_value == 3000.0

    # 7. Delete & Missing scenario 404
    api_delete_scenario(s2.id)
    assert len(api_list_scenarios()) == 1
    with pytest.raises(HTTPException) as exc_404:
        api_get_scenario(s2.id)
    assert exc_404.value.status_code == 404
    with pytest.raises(HTTPException) as exc_del_404:
        api_delete_scenario(s2.id)
    assert exc_del_404.value.status_code == 404



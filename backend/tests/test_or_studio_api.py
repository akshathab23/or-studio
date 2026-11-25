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

from __future__ import annotations

import math
from unittest.mock import patch

from fastapi import HTTPException
import pytest
from pydantic import ValidationError

from app.main import _SENSITIVITY_SEMAPHORE, api_analyze_sensitivity
from app.schemas import (
    MultiPeriodColumnMapping,
    MultiPeriodSolveRequest,
    MultiPeriodSolveResponse,
    SensitivitySweepRequest,
)
from app.services.dataset_service import upload_dataset
from app.services.multi_period_solver import (
    prepare_multi_period_data,
    solve_multi_period,
    solve_prepared_multi_period,
)
from app.services.sensitivity_service import (
    MAX_TOTAL_SOLVER_RUNS,
    run_sensitivity_analysis,
)


def _upload_sample_dataset(*, include_setup: bool = False, zero_costs: bool = False) -> tuple[str, MultiPeriodColumnMapping]:
    if include_setup:
        csv_data = (
            "product,period,demand,prod_cost,inv_cost,capacity,setup_cost,setup_time\n"
            "A,1,50,10,2,120,100,5\n"
            "A,2,60,10,2,120,100,5\n"
            "B,1,40,12,2,120,80,5\n"
            "B,2,50,12,2,120,80,5\n"
        )
        mapping = MultiPeriodColumnMapping(
            product="product",
            period="period",
            demand="demand",
            production_cost="prod_cost",
            inventory_cost="inv_cost",
            capacity="capacity",
            setup_cost="setup_cost",
            setup_time="setup_time",
        )
    elif zero_costs:
        csv_data = (
            "product,period,demand,prod_cost,inv_cost,capacity\n"
            "A,1,50,0,0,150\n"
            "A,2,50,0,0,150\n"
        )
        mapping = MultiPeriodColumnMapping(
            product="product",
            period="period",
            demand="demand",
            production_cost="prod_cost",
            inventory_cost="inv_cost",
            capacity="capacity",
        )
    else:
        csv_data = (
            "product,period,demand,prod_cost,inv_cost,capacity\n"
            "A,1,60,10,1,150\n"
            "A,2,80,12,1,150\n"
            "B,1,40,15,2,150\n"
            "B,2,50,14,2,150\n"
        )
        mapping = MultiPeriodColumnMapping(
            product="product",
            period="period",
            demand="demand",
            production_cost="prod_cost",
            inventory_cost="inv_cost",
            capacity="capacity",
        )
    summary = upload_dataset("sens_test.csv", csv_data.encode("utf-8"))
    return summary.dataset_id, mapping


def test_sensitivity_request_validation_bounds_and_points():
    dataset_id, mapping = _upload_sample_dataset()

    with pytest.raises(ValidationError):
        SensitivitySweepRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            parameter="invalid_param",  # type: ignore[arg-type]
        )

    with pytest.raises(ValidationError):
        SensitivitySweepRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            parameter="demand",
            min_multiplier=1.5,
            max_multiplier=1.0,
        )

    with pytest.raises(ValidationError):
        SensitivitySweepRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            parameter="demand",
            min_multiplier=0.0,
            max_multiplier=1.2,
        )

    with pytest.raises(ValidationError):
        SensitivitySweepRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            parameter="demand",
            min_multiplier=float("nan"),
            max_multiplier=1.2,
        )

    with pytest.raises(ValidationError):
        SensitivitySweepRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            parameter="demand",
            num_points=2,
        )

    with pytest.raises(ValidationError):
        SensitivitySweepRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            parameter="demand",
            num_points=26,
        )


def test_sensitivity_rejects_unmapped_parameters():
    csv_data = "product,period,demand\nA,1,50\nA,2,60\n"
    ds = upload_dataset("minimal.csv", csv_data.encode("utf-8"))
    minimal_mapping = MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
    )

    for param in ("capacity", "production_cost", "inventory_cost"):
        req = SensitivitySweepRequest(
            dataset_id=ds.dataset_id,
            mapping=minimal_mapping,
            parameter=param,  # type: ignore[arg-type]
            min_multiplier=0.8,
            max_multiplier=1.2,
            num_points=5,
        )
        with pytest.raises(ValueError, match="not mapped"):
            run_sensitivity_analysis(req)


def test_sensitivity_max_runs_cap_and_separate_baseline():
    dataset_id, mapping = _upload_sample_dataset()
    # Range excludes 1.0 -> 25 grid points + 1 separate baseline = 26 total runs (allowed)
    req = SensitivitySweepRequest(
        dataset_id=dataset_id,
        mapping=mapping,
        parameter="production_cost",
        min_multiplier=1.1,
        max_multiplier=1.5,
        num_points=25,
    )
    resp = run_sensitivity_analysis(req)
    assert resp.grid_config.baseline_included_in_grid is False
    assert resp.grid_config.total_solver_runs == MAX_TOTAL_SOLVER_RUNS
    assert len(resp.points) == 25
    assert resp.baseline.is_baseline is True
    assert resp.baseline.in_requested_grid is False
    assert resp.baseline.multiplier == 1.0


def test_continuous_lp_sensitivity_sweep_and_metrics():
    dataset_id, mapping = _upload_sample_dataset()
    req = SensitivitySweepRequest(
        dataset_id=dataset_id,
        mapping=mapping,
        parameter="demand",
        min_multiplier=0.8,
        max_multiplier=1.2,
        num_points=5,
    )
    resp = run_sensitivity_analysis(req)

    assert resp.is_milp is False
    assert resp.grid_config.baseline_included_in_grid is True
    assert resp.grid_config.total_solver_runs == 5
    assert len(resp.points) == 5
    assert any(p.is_baseline and abs(p.multiplier - 1.0) < 1e-6 for p in resp.points)
    assert resp.summary.feasibility_rate_pct == 100.0
    assert resp.summary.feasible_optimal_count == 5
    assert resp.summary.infeasible_count == 0
    assert resp.summary.first_infeasible_multiplier is None
    assert resp.summary.objective_sense == "Minimize"
    assert resp.summary.worst_case_feasible_objective is not None
    assert resp.summary.best_feasible_objective is not None
    assert resp.summary.worst_case_feasible_objective >= resp.summary.best_feasible_objective
    assert resp.summary.max_plan_shift_pct is not None
    assert resp.summary.max_plan_shift_pct > 0.0
    assert "empirical" in resp.summary.empirical_disclosure.lower()

    # Inventory cost sweep works via shared solver abstraction
    inv_req = SensitivitySweepRequest(
        dataset_id=dataset_id,
        mapping=mapping,
        parameter="inventory_cost",
        min_multiplier=0.5,
        max_multiplier=2.0,
        num_points=5,
    )
    inv_resp = run_sensitivity_analysis(inv_req)
    assert inv_resp.summary.feasible_optimal_count == 5


def test_milp_sensitivity_with_integer_and_setup_binaries():
    dataset_id, mapping = _upload_sample_dataset(include_setup=True)
    req = SensitivitySweepRequest(
        dataset_id=dataset_id,
        mapping=mapping,
        integer_production=True,
        parameter="demand",
        min_multiplier=0.5,
        max_multiplier=1.1,
        num_points=5,
    )
    resp = run_sensitivity_analysis(req)

    assert resp.is_milp is True
    assert resp.summary.feasible_optimal_count == 5
    assert "LP duals/shadow prices are not used" in resp.summary.empirical_disclosure
    for pt in resp.points:
        assert pt.setup_changes is not None
        assert pt.plan_shift_pct is not None
        assert all("setup" in d for d in pt.production_decisions)


def test_infeasibility_transition_and_null_objective_handling():
    dataset_id, mapping = _upload_sample_dataset()
    # Tight capacity crunch causes infeasibility at low capacity multipliers
    req = SensitivitySweepRequest(
        dataset_id=dataset_id,
        mapping=mapping,
        parameter="capacity",
        min_multiplier=0.3,
        max_multiplier=1.1,
        num_points=5,
    )
    resp = run_sensitivity_analysis(req)

    assert resp.summary.infeasible_count > 0
    assert resp.summary.feasible_optimal_count > 0
    assert 0.0 < resp.summary.feasibility_rate_pct < 100.0
    assert resp.summary.first_infeasible_multiplier == 0.3
    assert len(resp.summary.observed_transitions) >= 1

    infeasible_pts = [p for p in resp.points if p.status_category == "infeasible"]
    assert len(infeasible_pts) > 0
    for pt in infeasible_pts:
        assert pt.is_feasible_optimal is False
        assert pt.objective_value is None
        assert pt.objective_diff is None
        assert pt.objective_pct_change is None
        assert pt.plan_shift_pct is None


def test_solver_timeout_unknown_and_error_do_not_fabricate_results():
    dataset_id, mapping = _upload_sample_dataset()
    baseline_resp = solve_multi_period(
        MultiPeriodSolveRequest(dataset_id=dataset_id, mapping=mapping)
    )

    def _fake_solve(prepared, **kwargs):
        d_mult = kwargs.get("demand_multiplier", 1.0)
        if abs(d_mult - 1.0) < 1e-6:
            return baseline_resp
        if d_mult < 1.0:
            return MultiPeriodSolveResponse(
                **{
                    **baseline_resp.model_dump(),
                    "status": "Not Solved",
                    "is_optimal": False,
                    "constraints_feasible": False,
                    "objective_value": None,
                }
            )
        if abs(d_mult - 1.1) < 1e-6:
            return MultiPeriodSolveResponse(
                **{
                    **baseline_resp.model_dump(),
                    "status": "Unknown",
                    "is_optimal": False,
                    "constraints_feasible": False,
                    "objective_value": None,
                }
            )
        raise RuntimeError("Simulated CBC crash")

    req = SensitivitySweepRequest(
        dataset_id=dataset_id,
        mapping=mapping,
        parameter="demand",
        min_multiplier=0.9,
        max_multiplier=1.2,
        num_points=4,
    )
    with patch(
        "app.services.sensitivity_service.solve_prepared_multi_period",
        side_effect=_fake_solve,
    ):
        resp = run_sensitivity_analysis(req)

    by_mult = {round(p.multiplier, 2): p for p in resp.points}
    assert by_mult[0.9].status_category == "timeout"
    assert by_mult[0.9].is_feasible_optimal is False
    assert by_mult[0.9].objective_value is None

    assert by_mult[1.0].status_category == "optimal"
    assert by_mult[1.0].is_feasible_optimal is True

    assert by_mult[1.1].status_category == "unknown"
    assert by_mult[1.1].objective_value is None

    assert by_mult[1.2].status_category == "solver_error"
    assert by_mult[1.2].error_message == "Simulated CBC crash"
    assert by_mult[1.2].objective_value is None

    # Only the 1.0 baseline point is feasible optimal
    assert resp.summary.feasible_optimal_count == 1
    assert resp.summary.incomplete_or_error_count == 3
    assert resp.summary.feasibility_rate_pct == 25.0


def test_zero_baseline_objective_and_plan_shift_formula():
    dataset_id, mapping = _upload_sample_dataset(zero_costs=True)
    req = SensitivitySweepRequest(
        dataset_id=dataset_id,
        mapping=mapping,
        parameter="demand",
        min_multiplier=0.8,
        max_multiplier=1.2,
        num_points=3,
    )
    resp = run_sensitivity_analysis(req)

    assert resp.baseline.objective_value == 0.0
    for pt in resp.points:
        assert pt.is_feasible_optimal is True
        assert pt.objective_pct_change is None
        assert math.isfinite(pt.plan_shift_pct or 0.0)

    # Demand 0.8x on 50,50 -> 40,40 => L1 diff = 20, baseline L1 = 100 => 20.0%
    low_pt = resp.points[0]
    assert low_pt.plan_shift_pct == pytest.approx(20.0, abs=1e-4)


def test_baseline_regression_equivalence_after_refactor():
    dataset_id, mapping = _upload_sample_dataset()
    direct = solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            integer_production=False,
            capacity_scope="auto",
        )
    )
    prepared = prepare_multi_period_data(
        dataset_id,
        mapping,
        integer_production=False,
        capacity_scope="auto",
    )
    via_prepared = solve_prepared_multi_period(
        prepared,
        demand_multiplier=1.0,
        capacity_multiplier=1.0,
        production_cost_multiplier=1.0,
        inventory_cost_multiplier=1.0,
    )

    assert direct.status == via_prepared.status
    assert direct.objective_value == pytest.approx(via_prepared.objective_value or 0.0, abs=1e-6)
    assert direct.variable_count == via_prepared.variable_count
    assert direct.constraint_count == via_prepared.constraint_count
    assert direct.constraints_feasible == via_prepared.constraints_feasible
    assert direct.production_schedule == via_prepared.production_schedule


def test_sensitivity_api_endpoint_http_contracts():
    """Verify the API endpoint handler contracts (success, 404, 400, 429).

    Calls ``api_analyze_sensitivity`` directly (matching the convention in
    ``test_or_studio_api.py``).
    """
    dataset_id, mapping = _upload_sample_dataset()

    # --- 200 OK ---
    ok_res = api_analyze_sensitivity(
        SensitivitySweepRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            parameter="demand",
            min_multiplier=0.9,
            max_multiplier=1.1,
            num_points=3,
        )
    )
    assert ok_res.parameter == "demand"
    assert len(ok_res.points) == 3

    # --- 404 Not Found ---
    with pytest.raises(HTTPException) as exc_404:
        api_analyze_sensitivity(
            SensitivitySweepRequest(
                dataset_id="nonexistent-id",
                mapping=mapping,
                parameter="demand",
                min_multiplier=0.9,
                max_multiplier=1.1,
                num_points=3,
            )
        )
    assert exc_404.value.status_code == 404

    # --- 400 Bad Request (unmapped parameter) ---
    minimal_csv = "product,period,demand\nA,1,50\nA,2,60\n"
    min_ds = upload_dataset("minimal_http.csv", minimal_csv.encode("utf-8"))
    with pytest.raises(HTTPException) as exc_400:
        api_analyze_sensitivity(
            SensitivitySweepRequest(
                dataset_id=min_ds.dataset_id,
                mapping=MultiPeriodColumnMapping(
                    product="product",
                    period="period",
                    demand="demand",
                ),
                parameter="capacity",
                min_multiplier=0.9,
                max_multiplier=1.1,
                num_points=3,
            )
        )
    assert exc_400.value.status_code == 400

    # --- 429 Too Many Requests (semaphore busy) ---
    assert _SENSITIVITY_SEMAPHORE.acquire(blocking=False)
    assert _SENSITIVITY_SEMAPHORE.acquire(blocking=False)
    try:
        with pytest.raises(HTTPException) as exc_429:
            api_analyze_sensitivity(
                SensitivitySweepRequest(
                    dataset_id=dataset_id,
                    mapping=mapping,
                    parameter="demand",
                    min_multiplier=0.9,
                    max_multiplier=1.1,
                    num_points=3,
                )
            )
        assert exc_429.value.status_code == 429
    finally:
        _SENSITIVITY_SEMAPHORE.release()
        _SENSITIVITY_SEMAPHORE.release()

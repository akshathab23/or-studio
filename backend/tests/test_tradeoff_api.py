from __future__ import annotations

import math
from unittest.mock import patch

from fastapi import HTTPException
import pulp
import pytest
from pydantic import ValidationError

from app.main import _TRADEOFF_SEMAPHORE, api_analyze_tradeoffs
from app.schemas import (
    MultiPeriodColumnMapping,
    MultiPeriodSolveRequest,
    MultiPeriodSolveResponse,
    TradeoffExploreRequest,
)
from app.services.dataset_service import get_dataset, upload_dataset
from app.services.multi_period_solver import (
    build_multi_period_pulp_model,
    extract_multi_period_response,
    prepare_multi_period_data,
    solve_multi_period,
)
from app.services.tradeoff_service import (
    _solve_epsilon_candidate,
    run_tradeoff_exploration,
)


def _upload_tradeoff_dataset(*, zero_costs: bool = False, with_setup: bool = False) -> tuple[str, MultiPeriodColumnMapping]:
    """Create a dataset where cost minimization creates genuine trade-offs with
    peak utilization, cumulative inventory, and production smoothing.
    Period 1 has cheap production (10) and cheap inventory (1); Period 2 has
    higher production cost (20) and higher demand (100), so cost-minimization
    pre-builds in Period 1 (high Period 1 utilization, positive inventory, uneven
    ramp), whereas smoothing/utilization/inventory criteria trade cost for balance.
    """
    if zero_costs:
        csv_data = (
            "product,period,demand,prod_cost,inv_cost,capacity\n"
            "A,1,40,0,0,150\n"
            "A,2,80,0,0,150\n"
        )
    elif with_setup:
        csv_data = (
            "product,period,demand,prod_cost,inv_cost,capacity,setup_cost,setup_time\n"
            "A,1,40,10,1,150,50,5\n"
            "A,2,100,25,1,150,50,5\n"
        )
        summary = upload_dataset("tradeoff_setup.csv", csv_data.encode("utf-8"))
        return summary.dataset_id, MultiPeriodColumnMapping(
            product="product",
            period="period",
            demand="demand",
            production_cost="prod_cost",
            inventory_cost="inv_cost",
            capacity="capacity",
            setup_cost="setup_cost",
            setup_time="setup_time",
        )
    else:
        csv_data = (
            "product,period,demand,prod_cost,inv_cost,capacity\n"
            "A,1,40,10,1,150\n"
            "A,2,100,25,1,150\n"
        )
    summary = upload_dataset("tradeoff_test.csv", csv_data.encode("utf-8"))
    return summary.dataset_id, MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
        production_cost="prod_cost",
        inventory_cost="inv_cost",
        capacity="capacity",
    )


def test_shared_model_builder_baseline_regression_equivalence():
    dataset_id, mapping = _upload_tradeoff_dataset(with_setup=True)
    direct = solve_multi_period(
        MultiPeriodSolveRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            integer_production=True,
            capacity_scope="auto",
        )
    )
    prepared = prepare_multi_period_data(
        dataset_id, mapping, integer_production=True, capacity_scope="auto"
    )
    built = build_multi_period_pulp_model(prepared)
    built.prob.solve(pulp.PULP_CBC_CMD(msg=False))
    via_builder = extract_multi_period_response(prepared, built, solve_time=0.01)

    assert direct.status == via_builder.status
    assert direct.objective_value == pytest.approx(via_builder.objective_value or 0.0, abs=1e-6)
    assert direct.variable_count == via_builder.variable_count
    assert direct.constraint_count == via_builder.constraint_count
    assert direct.production_schedule == via_builder.production_schedule
    assert direct.resource_utilization == via_builder.resource_utilization


def test_tradeoff_request_validation():
    dataset_id, mapping = _upload_tradeoff_dataset()

    with pytest.raises(ValidationError):
        TradeoffExploreRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            criterion="demand_satisfaction",  # type: ignore[arg-type]
        )

    with pytest.raises(ValidationError):
        TradeoffExploreRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            criterion="peak_utilization",
            num_points=1,
        )

    with pytest.raises(ValidationError):
        TradeoffExploreRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            criterion="peak_utilization",
            num_points=13,
        )

    with pytest.raises(ValidationError):
        TradeoffExploreRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            criterion="peak_utilization",
            max_relative_tolerance_pct=0.0,
        )

    with pytest.raises(ValidationError):
        TradeoffExploreRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            criterion="peak_utilization",
            max_relative_tolerance_pct=55.0,
        )


def test_tradeoff_all_three_criteria_lp_and_verification():
    dataset_id, mapping = _upload_tradeoff_dataset()
    raw_df_before = get_dataset(dataset_id).df.copy(deep=True)
    baseline_before = solve_multi_period(
        MultiPeriodSolveRequest(dataset_id=dataset_id, mapping=mapping)
    )

    for crit in ("peak_utilization", "cumulative_inventory", "production_smoothing"):
        req = TradeoffExploreRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            criterion=crit,  # type: ignore[arg-type]
            max_relative_tolerance_pct=40.0,
            num_points=5,
        )
        resp = run_tradeoff_exploration(req)

        assert resp.is_milp is False
        assert resp.summary.tolerance_mode == "relative_pct"
        assert resp.summary.verified_feasible_count == 5
        assert resp.summary.distinct_feasible_count >= 2
        assert resp.summary.best_criterion_value is not None
        assert resp.summary.best_criterion_value <= resp.summary.baseline_criterion_value + 1e-6

        for cand in resp.candidates:
            assert cand.is_verified_feasible is True
            assert cand.original_constraints_feasible is True
            assert cand.objective_budget_satisfied is True
            assert cand.objective_value is not None
            assert cand.objective_value <= cand.objective_budget + 1e-5
            assert cand.max_constraint_violation is not None
            assert cand.max_constraint_violation <= 1e-5

    # Dataset and baseline remain completely immutable
    assert get_dataset(dataset_id).df.equals(raw_df_before)
    baseline_after = solve_multi_period(
        MultiPeriodSolveRequest(dataset_id=dataset_id, mapping=mapping)
    )
    assert baseline_after.objective_value == baseline_before.objective_value
    assert baseline_after.production_schedule == baseline_before.production_schedule


def test_tradeoff_milp_with_setup_and_integer_production():
    dataset_id, mapping = _upload_tradeoff_dataset(with_setup=True)
    req = TradeoffExploreRequest(
        dataset_id=dataset_id,
        mapping=mapping,
        integer_production=True,
        criterion="peak_utilization",
        max_relative_tolerance_pct=35.0,
        num_points=4,
    )
    resp = run_tradeoff_exploration(req)

    assert resp.is_milp is True
    assert resp.summary.verified_feasible_count == 4
    assert "MILP mode" in resp.summary.disclosure
    for cand in resp.candidates:
        assert cand.is_verified_feasible is True
        assert all("setup" in row for row in cand.production_schedule)


def test_zero_and_near_zero_baseline_require_absolute_tolerance():
    dataset_id, mapping = _upload_tradeoff_dataset(zero_costs=True)

    # Zero baseline without absolute_tolerance must be rejected (cannot use %)
    with pytest.raises(ValueError, match="absolute_tolerance"):
        run_tradeoff_exploration(
            TradeoffExploreRequest(
                dataset_id=dataset_id,
                mapping=mapping,
                criterion="peak_utilization",
                max_relative_tolerance_pct=10.0,
                absolute_tolerance=None,
                num_points=4,
            )
        )

    # Zero baseline WITH explicit absolute_tolerance succeeds in objective units
    resp = run_tradeoff_exploration(
        TradeoffExploreRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            criterion="peak_utilization",
            max_relative_tolerance_pct=None,
            absolute_tolerance=50.0,
            num_points=4,
        )
    )
    assert resp.summary.tolerance_mode == "absolute"
    assert resp.summary.baseline_objective == 0.0
    assert resp.summary.verified_feasible_count == 4
    assert resp.baseline.objective_pct_change is None


def test_unmapped_and_invalid_baseline_rejection():
    # 1. Missing capacity -> peak_utilization rejected
    min_csv = "product,period,demand\nA,1,50\nA,2,60\n"
    min_ds = upload_dataset("no_cap.csv", min_csv.encode("utf-8"))
    min_map = MultiPeriodColumnMapping(product="product", period="period", demand="demand")
    with pytest.raises(ValueError, match="Capacity is not mapped"):
        run_tradeoff_exploration(
            TradeoffExploreRequest(
                dataset_id=min_ds.dataset_id,
                mapping=min_map,
                criterion="peak_utilization",
            )
        )

    # 2. Single period -> production_smoothing rejected
    one_p_csv = "product,period,demand,capacity\nA,1,50,100\n"
    one_ds = upload_dataset("one_period.csv", one_p_csv.encode("utf-8"))
    with pytest.raises(ValueError, match="at least 2 periods"):
        run_tradeoff_exploration(
            TradeoffExploreRequest(
                dataset_id=one_ds.dataset_id,
                mapping=MultiPeriodColumnMapping(
                    product="product", period="period", demand="demand", capacity="capacity"
                ),
                criterion="production_smoothing",
            )
        )

    # 3. Infeasible baseline -> rejected
    inf_csv = "product,period,demand,capacity\nA,1,200,50\nA,2,200,50\n"
    inf_ds = upload_dataset("infeasible_base.csv", inf_csv.encode("utf-8"))
    with pytest.raises(ValueError, match="not optimal and feasible"):
        run_tradeoff_exploration(
            TradeoffExploreRequest(
                dataset_id=inf_ds.dataset_id,
                mapping=MultiPeriodColumnMapping(
                    product="product", period="period", demand="demand", capacity="capacity"
                ),
                criterion="peak_utilization",
            )
        )


def test_duplicate_detection_on_flat_frontier():
    # Flat cost & zero inventory opportunity -> all tolerances yield identical plan
    csv_data = (
        "product,period,demand,prod_cost,inv_cost,capacity\n"
        "A,1,50,10,1,100\n"
        "A,2,50,10,1,100\n"
    )
    ds = upload_dataset("flat_tradeoff.csv", csv_data.encode("utf-8"))
    mapping = MultiPeriodColumnMapping(
        product="product",
        period="period",
        demand="demand",
        production_cost="prod_cost",
        inventory_cost="inv_cost",
        capacity="capacity",
    )
    resp = run_tradeoff_exploration(
        TradeoffExploreRequest(
            dataset_id=ds.dataset_id,
            mapping=mapping,
            criterion="cumulative_inventory",
            max_relative_tolerance_pct=15.0,
            num_points=4,
        )
    )
    assert resp.summary.verified_feasible_count == 4
    assert resp.summary.duplicate_count == 4
    assert all(c.is_duplicate and c.duplicate_of_candidate_id == "baseline" for c in resp.candidates)


def test_maximize_sense_and_budget_violation_verification():
    dataset_id, mapping = _upload_tradeoff_dataset()
    prepared = prepare_multi_period_data(dataset_id, mapping)

    # Verify Maximize objective budget check rejects an under-budget objective
    base_resp = solve_multi_period(MultiPeriodSolveRequest(dataset_id=dataset_id, mapping=mapping))
    assert base_resp.objective_value is not None

    with patch(
        "app.services.tradeoff_service.solve_prepared_multi_period",
        return_value=base_resp,
    ):
        # Mock _solve_epsilon_candidate returning a solution that violates budget
        violating_resp = MultiPeriodSolveResponse(
            **{
                **base_resp.model_dump(),
                "objective_value": base_resp.objective_value + 5000.0,
            }
        )
        with patch(
            "app.services.tradeoff_service._solve_epsilon_candidate",
            return_value=(violating_resp, 50.0, False),
        ):
            resp = run_tradeoff_exploration(
                TradeoffExploreRequest(
                    dataset_id=dataset_id,
                    mapping=mapping,
                    criterion="peak_utilization",
                    num_points=3,
                )
            )
    assert resp.summary.verified_feasible_count == 0
    assert resp.summary.incomplete_or_error_count == 3
    for cand in resp.candidates:
        assert cand.is_verified_feasible is False
        assert cand.objective_budget_satisfied is False
        assert cand.objective_value is None

    # Directly test Maximize branch in _solve_epsilon_candidate adds >= constraint
    resp_max, _, _ = _solve_epsilon_candidate(
        prepared,
        "cumulative_inventory",
        "Maximize",
        0.0,
        time_limit_seconds=5.0,
    )
    assert resp_max.is_optimal is True


def test_timeout_budget_exhaustion_and_solver_error_do_not_fabricate():
    dataset_id, mapping = _upload_tradeoff_dataset()
    base_resp = solve_multi_period(MultiPeriodSolveRequest(dataset_id=dataset_id, mapping=mapping))

    call_idx = 0

    def _fake_eps(*args, **kwargs):
        nonlocal call_idx
        call_idx += 1
        if call_idx == 1:
            return (
                MultiPeriodSolveResponse(
                    **{
                        **base_resp.model_dump(),
                        "status": "Not Solved",
                        "is_optimal": False,
                        "constraints_feasible": False,
                        "objective_value": None,
                    }
                ),
                None,
                False,
            )
        raise RuntimeError("Simulated CBC failure")

    with patch("app.services.tradeoff_service._solve_epsilon_candidate", side_effect=_fake_eps):
        resp = run_tradeoff_exploration(
            TradeoffExploreRequest(
                dataset_id=dataset_id,
                mapping=mapping,
                criterion="peak_utilization",
                num_points=3,
            ),
            total_budget_seconds=25.0,
        )

    assert resp.candidates[0].status_category == "timeout"
    assert resp.candidates[0].is_verified_feasible is False
    assert resp.candidates[0].objective_value is None
    assert resp.candidates[1].status_category == "solver_error"
    assert resp.candidates[1].error_message == "Simulated CBC failure"
    assert resp.candidates[1].is_verified_feasible is False

    # Cooperative total budget exhaustion
    resp_budget = run_tradeoff_exploration(
        TradeoffExploreRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            criterion="peak_utilization",
            num_points=3,
        ),
        total_budget_seconds=0.0,
    )
    assert resp_budget.summary.budget_exhausted is True
    assert all(c.status_category == "timeout" for c in resp_budget.candidates)


def test_tradeoff_api_endpoint_contracts_and_concurrency():
    dataset_id, mapping = _upload_tradeoff_dataset()

    # 200 OK
    ok_res = api_analyze_tradeoffs(
        TradeoffExploreRequest(
            dataset_id=dataset_id,
            mapping=mapping,
            criterion="peak_utilization",
            max_relative_tolerance_pct=20.0,
            num_points=4,
        )
    )
    assert ok_res.criterion == "peak_utilization"
    assert len(ok_res.candidates) == 4

    # 404 Missing dataset
    with pytest.raises(HTTPException) as exc_404:
        api_analyze_tradeoffs(
            TradeoffExploreRequest(
                dataset_id="nonexistent-id",
                mapping=mapping,
                criterion="peak_utilization",
            )
        )
    assert exc_404.value.status_code == 404

    # 400 Unmapped criterion
    min_csv = "product,period,demand\nA,1,50\nA,2,60\n"
    min_ds = upload_dataset("min_tradeoff_http.csv", min_csv.encode("utf-8"))
    with pytest.raises(HTTPException) as exc_400:
        api_analyze_tradeoffs(
            TradeoffExploreRequest(
                dataset_id=min_ds.dataset_id,
                mapping=MultiPeriodColumnMapping(product="product", period="period", demand="demand"),
                criterion="peak_utilization",
            )
        )
    assert exc_400.value.status_code == 400

    # 429 Bounded concurrency
    assert _TRADEOFF_SEMAPHORE.acquire(blocking=False)
    assert _TRADEOFF_SEMAPHORE.acquire(blocking=False)
    try:
        with pytest.raises(HTTPException) as exc_429:
            api_analyze_tradeoffs(
                TradeoffExploreRequest(
                    dataset_id=dataset_id,
                    mapping=mapping,
                    criterion="peak_utilization",
                )
            )
        assert exc_429.value.status_code == 429
    finally:
        _TRADEOFF_SEMAPHORE.release()
        _TRADEOFF_SEMAPHORE.release()

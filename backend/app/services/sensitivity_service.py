from __future__ import annotations

import math
import time
from typing import Any

from app.schemas import (
    MultiPeriodSolveResponse,
    SensitivityGridConfig,
    SensitivityParameter,
    SensitivityPointResult,
    SensitivitySolveCategory,
    SensitivitySummary,
    SensitivitySweepRequest,
    SensitivitySweepResponse,
    SensitivityTransition,
)
from app.services.multi_period_solver import (
    PreparedMultiPeriodData,
    prepare_multi_period_data,
    solve_prepared_multi_period,
)

MIN_SENSITIVITY_POINTS = 3
MAX_SENSITIVITY_POINTS = 25
MAX_TOTAL_SOLVER_RUNS = 26
DEFAULT_PER_SOLVE_TIME_LIMIT_SECONDS = 5.0
DEFAULT_TOTAL_BUDGET_SECONDS = 25.0


def _validate_parameter_supported(
    prepared: PreparedMultiPeriodData, parameter: SensitivityParameter
) -> None:
    if parameter == "capacity" and not prepared.has_capacity:
        raise ValueError(
            "Cannot run sensitivity on 'capacity' because Capacity is not mapped in this model."
        )
    if parameter == "production_cost" and not prepared.has_prod_cost:
        raise ValueError(
            "Cannot run sensitivity on 'production_cost' because Production Cost is not mapped in this model."
        )
    if parameter == "inventory_cost" and not prepared.has_inv_cost:
        raise ValueError(
            "Cannot run sensitivity on 'inventory_cost' because Inventory Cost is not mapped in this model."
        )


def _build_grid(
    min_mult: float, max_mult: float, num_points: int
) -> tuple[list[float], bool]:
    if num_points < MIN_SENSITIVITY_POINTS or num_points > MAX_SENSITIVITY_POINTS:
        raise ValueError(
            f"num_points must be between {MIN_SENSITIVITY_POINTS} and {MAX_SENSITIVITY_POINTS}."
        )
    if not (math.isfinite(min_mult) and math.isfinite(max_mult)) or min_mult <= 0 or min_mult >= max_mult:
        raise ValueError("Invalid multiplier range: require 0 < min_multiplier < max_multiplier.")

    step = (max_mult - min_mult) / (num_points - 1)
    grid = [round(min_mult + i * step, 6) for i in range(num_points)]
    grid[0] = round(min_mult, 6)
    grid[-1] = round(max_mult, 6)

    baseline_included = min_mult <= 1.0 <= max_mult
    if baseline_included and all(abs(m - 1.0) > 1e-6 for m in grid):
        nearest_idx = min(range(len(grid)), key=lambda idx: abs(grid[idx] - 1.0))
        grid[nearest_idx] = 1.0

    # Ensure strictly sorted unique multipliers
    grid = sorted(dict.fromkeys(grid))
    return grid, baseline_included


def _classify_status(status: str, is_optimal: bool) -> SensitivitySolveCategory:
    if is_optimal:
        return "optimal"
    if status == "Infeasible":
        return "infeasible"
    if status == "Unbounded":
        return "unbounded"
    if status == "Not Solved":
        return "timeout"
    return "unknown"


def _extract_decisions(
    resp: MultiPeriodSolveResponse,
) -> tuple[dict[tuple[str, str], float], dict[tuple[str, str], int], list[dict[str, Any]]]:
    prod_map: dict[tuple[str, str], float] = {}
    setup_map: dict[tuple[str, str], int] = {}
    decisions: list[dict[str, Any]] = []
    for row in resp.production_schedule:
        p = str(row["product"])
        t = str(row["period"])
        xv = float(row.get("production", 0.0))
        iv = float(row.get("ending_inventory", 0.0))
        prod_map[(p, t)] = xv
        entry: dict[str, Any] = {
            "product": p,
            "period": t,
            "production": xv,
            "ending_inventory": iv,
        }
        if "setup" in row and row["setup"] is not None:
            sv = int(row["setup"])
            setup_map[(p, t)] = sv
            entry["setup"] = sv
        decisions.append(entry)
    return prod_map, setup_map, decisions


def _extract_peak_utilization(resp: MultiPeriodSolveResponse) -> float | None:
    if not (resp.is_optimal and resp.constraints_feasible) or not resp.resource_utilization:
        return None
    vals = [
        float(u["utilization_pct"])
        for u in resp.resource_utilization
        if u.get("utilization_pct") is not None and math.isfinite(float(u["utilization_pct"]))
    ]
    return round(max(vals), 2) if vals else None


def _multiplier_kwargs(parameter: SensitivityParameter, mult: float) -> dict[str, float]:
    kwargs = {
        "demand_multiplier": 1.0,
        "capacity_multiplier": 1.0,
        "production_cost_multiplier": 1.0,
        "inventory_cost_multiplier": 1.0,
    }
    if parameter == "demand":
        kwargs["demand_multiplier"] = mult
    elif parameter == "capacity":
        kwargs["capacity_multiplier"] = mult
    elif parameter == "production_cost":
        kwargs["production_cost_multiplier"] = mult
    elif parameter == "inventory_cost":
        kwargs["inventory_cost_multiplier"] = mult
    return kwargs


def _build_point_from_response(
    *,
    multiplier: float,
    parameter: SensitivityParameter,
    is_baseline: bool,
    in_requested_grid: bool,
    resp: MultiPeriodSolveResponse,
    has_setup: bool,
    baseline_feasible_optimal: bool,
    baseline_obj: float | None,
    baseline_prod: dict[tuple[str, str], float],
    baseline_setup: dict[tuple[str, str], int],
    baseline_prod_l1: float,
) -> SensitivityPointResult:
    status_category = _classify_status(resp.status, resp.is_optimal)
    is_feasible_optimal = bool(resp.is_optimal and resp.constraints_feasible)

    obj_val: float | None = None
    if is_feasible_optimal and resp.objective_value is not None and math.isfinite(resp.objective_value):
        obj_val = float(resp.objective_value)

    obj_diff: float | None = None
    obj_pct: float | None = None
    plan_shift_pct: float | None = None
    setup_changes: int | None = None
    decisions: list[dict[str, Any]] = []

    if is_feasible_optimal:
        prod_map, setup_map, decisions = _extract_decisions(resp)
        if baseline_feasible_optimal and baseline_obj is not None and obj_val is not None:
            obj_diff = round(obj_val - baseline_obj, 6)
            if abs(baseline_obj) >= 1e-12:
                obj_pct = round(((obj_val - baseline_obj) / abs(baseline_obj)) * 100.0, 4)

        if baseline_feasible_optimal:
            if is_baseline:
                plan_shift_pct = 0.0
                if has_setup:
                    setup_changes = 0
            else:
                all_keys = set(baseline_prod.keys()) | set(prod_map.keys())
                l1_diff = sum(abs(prod_map.get(k, 0.0) - baseline_prod.get(k, 0.0)) for k in all_keys)
                denom = max(baseline_prod_l1, 1.0)
                plan_shift_pct = round(100.0 * l1_diff / denom, 4)
                if has_setup:
                    setup_keys = set(baseline_setup.keys()) | set(setup_map.keys())
                    setup_changes = sum(
                        1 for k in setup_keys if setup_map.get(k, 0) != baseline_setup.get(k, 0)
                    )

    error_msg: str | None = None
    if status_category == "timeout":
        error_msg = "Solver did not prove optimality within the per-solve time limit."
    elif status_category in {"unbounded", "unknown"}:
        error_msg = resp.message

    return SensitivityPointResult(
        multiplier=multiplier,
        parameter=parameter,
        is_baseline=is_baseline,
        in_requested_grid=in_requested_grid,
        solver_status=resp.status,
        status_category=status_category,
        is_optimal=resp.is_optimal,
        constraints_feasible=resp.constraints_feasible,
        is_feasible_optimal=is_feasible_optimal,
        objective_value=obj_val,
        objective_diff=obj_diff,
        objective_pct_change=obj_pct,
        plan_shift_pct=plan_shift_pct,
        setup_changes=setup_changes,
        peak_utilization_pct=_extract_peak_utilization(resp),
        total_production=resp.total_production if is_feasible_optimal else None,
        total_demand=resp.total_demand,
        total_ending_inventory=resp.total_ending_inventory if is_feasible_optimal else None,
        max_constraint_violation=resp.max_constraint_violation,
        runtime_seconds=resp.solve_time_seconds,
        production_decisions=decisions,
        error_message=error_msg,
    )


def run_sensitivity_analysis(
    req: SensitivitySweepRequest,
    *,
    per_solve_time_limit_seconds: float = DEFAULT_PER_SOLVE_TIME_LIMIT_SECONDS,
    total_budget_seconds: float = DEFAULT_TOTAL_BUDGET_SECONDS,
) -> SensitivitySweepResponse:
    sweep_t0 = time.perf_counter()

    prepared = prepare_multi_period_data(
        req.dataset_id,
        req.mapping,
        integer_production=req.integer_production,
        allow_backlogging=req.allow_backlogging,
        capacity_scope=req.capacity_scope,
    )
    _validate_parameter_supported(prepared, req.parameter)

    grid, baseline_in_grid = _build_grid(
        req.min_multiplier, req.max_multiplier, req.num_points
    )
    total_runs = len(grid) + (0 if baseline_in_grid else 1)
    if total_runs > MAX_TOTAL_SOLVER_RUNS:
        raise ValueError(
            f"Requested sweep requires {total_runs} solver runs, exceeding limit of {MAX_TOTAL_SOLVER_RUNS}."
        )

    is_milp = bool(prepared.integer_production or prepared.has_setup)

    # Solve baseline (multiplier = 1.0) first so all grid points compare against it
    baseline_resp: MultiPeriodSolveResponse | None = None
    baseline_error: str | None = None
    baseline_t0 = time.perf_counter()
    try:
        baseline_resp = solve_prepared_multi_period(
            prepared,
            demand_multiplier=1.0,
            capacity_multiplier=1.0,
            production_cost_multiplier=1.0,
            inventory_cost_multiplier=1.0,
            time_limit_seconds=per_solve_time_limit_seconds,
        )
    except Exception as exc:
        baseline_error = str(exc)

    if baseline_resp is not None:
        baseline_feasible_optimal = bool(
            baseline_resp.is_optimal and baseline_resp.constraints_feasible
        )
        baseline_obj = (
            float(baseline_resp.objective_value)
            if baseline_feasible_optimal
            and baseline_resp.objective_value is not None
            and math.isfinite(baseline_resp.objective_value)
            else None
        )
        baseline_prod, baseline_setup, _ = (
            _extract_decisions(baseline_resp)
            if baseline_feasible_optimal
            else ({}, {}, [])
        )
        baseline_prod_l1 = sum(abs(v) for v in baseline_prod.values())
        baseline_point = _build_point_from_response(
            multiplier=1.0,
            parameter=req.parameter,
            is_baseline=True,
            in_requested_grid=baseline_in_grid,
            resp=baseline_resp,
            has_setup=prepared.has_setup,
            baseline_feasible_optimal=baseline_feasible_optimal,
            baseline_obj=baseline_obj,
            baseline_prod=baseline_prod,
            baseline_setup=baseline_setup,
            baseline_prod_l1=baseline_prod_l1,
        )
        objective_sense = baseline_resp.objective_sense
    else:
        baseline_feasible_optimal = False
        baseline_obj = None
        baseline_prod = {}
        baseline_setup = {}
        baseline_prod_l1 = 0.0
        objective_sense = "Minimize"
        baseline_point = SensitivityPointResult(
            multiplier=1.0,
            parameter=req.parameter,
            is_baseline=True,
            in_requested_grid=baseline_in_grid,
            solver_status="Solver Error",
            status_category="solver_error",
            is_optimal=False,
            constraints_feasible=False,
            is_feasible_optimal=False,
            runtime_seconds=round(time.perf_counter() - baseline_t0, 4),
            error_message=baseline_error or "Unknown solver error.",
        )

    points: list[SensitivityPointResult] = []
    budget_exhausted = False

    for mult in grid:
        if baseline_in_grid and abs(mult - 1.0) <= 1e-6:
            points.append(baseline_point)
            continue

        elapsed = time.perf_counter() - sweep_t0
        if elapsed >= total_budget_seconds:
            budget_exhausted = True
            points.append(
                SensitivityPointResult(
                    multiplier=mult,
                    parameter=req.parameter,
                    is_baseline=False,
                    in_requested_grid=True,
                    solver_status="Not Solved (Budget Exhausted)",
                    status_category="timeout",
                    is_optimal=False,
                    constraints_feasible=False,
                    is_feasible_optimal=False,
                    runtime_seconds=0.0,
                    error_message="Total sensitivity execution budget exceeded before solving this point.",
                )
            )
            continue

        pt_t0 = time.perf_counter()
        try:
            resp = solve_prepared_multi_period(
                prepared,
                time_limit_seconds=per_solve_time_limit_seconds,
                **_multiplier_kwargs(req.parameter, mult),
            )
            points.append(
                _build_point_from_response(
                    multiplier=mult,
                    parameter=req.parameter,
                    is_baseline=False,
                    in_requested_grid=True,
                    resp=resp,
                    has_setup=prepared.has_setup,
                    baseline_feasible_optimal=baseline_feasible_optimal,
                    baseline_obj=baseline_obj,
                    baseline_prod=baseline_prod,
                    baseline_setup=baseline_setup,
                    baseline_prod_l1=baseline_prod_l1,
                )
            )
        except Exception as exc:
            points.append(
                SensitivityPointResult(
                    multiplier=mult,
                    parameter=req.parameter,
                    is_baseline=False,
                    in_requested_grid=True,
                    solver_status="Solver Error",
                    status_category="solver_error",
                    is_optimal=False,
                    constraints_feasible=False,
                    is_feasible_optimal=False,
                    runtime_seconds=round(time.perf_counter() - pt_t0, 4),
                    error_message=str(exc),
                )
            )

    # Summary metrics strictly over tested grid points
    total_grid_points = len(points)
    feasible_points = [p for p in points if p.is_feasible_optimal]
    infeasible_points = [p for p in points if p.status_category == "infeasible"]
    incomplete_points = [
        p for p in points if p.status_category in {"timeout", "solver_error", "unbounded", "unknown"}
    ]

    feasibility_rate_pct = (
        round((len(feasible_points) / total_grid_points) * 100.0, 2)
        if total_grid_points > 0
        else 0.0
    )

    feasible_objs = [
        p.objective_value
        for p in feasible_points
        if p.objective_value is not None and math.isfinite(p.objective_value)
    ]

    is_minimize = objective_sense.lower().startswith("min")
    best_obj: float | None = None
    worst_obj: float | None = None
    obj_range: float | None = None
    if feasible_objs:
        best_obj = min(feasible_objs) if is_minimize else max(feasible_objs)
        worst_obj = max(feasible_objs) if is_minimize else min(feasible_objs)
        obj_range = round(max(feasible_objs) - min(feasible_objs), 6)

    plan_shifts = [
        p.plan_shift_pct
        for p in feasible_points
        if p.plan_shift_pct is not None and math.isfinite(p.plan_shift_pct)
    ]
    max_plan_shift_pct = round(max(plan_shifts), 4) if plan_shifts else None

    first_infeasible_multiplier = (
        infeasible_points[0].multiplier if infeasible_points else None
    )

    transitions: list[SensitivityTransition] = []
    for prev, curr in zip(points, points[1:]):
        if prev.is_feasible_optimal != curr.is_feasible_optimal:
            transitions.append(
                SensitivityTransition(
                    from_multiplier=prev.multiplier,
                    to_multiplier=curr.multiplier,
                    from_status=prev.solver_status,
                    to_status=curr.solver_status,
                    description=(
                        f"Observed feasibility transition between multiplier {prev.multiplier} "
                        f"({prev.solver_status}) and {curr.multiplier} ({curr.solver_status})."
                    ),
                )
            )

    total_runtime = round(time.perf_counter() - sweep_t0, 4)
    disclosure = (
        "Empirical robustness metrics are computed strictly over the tested discrete multiplier grid "
        "and do not represent formal worst-case robust optimization guarantees or exact continuous "
        "feasibility thresholds."
    )
    if is_milp:
        disclosure += " MILP mode uses full discrete re-optimization; LP duals/shadow prices are not used."

    return SensitivitySweepResponse(
        parameter=req.parameter,
        dataset_id=req.dataset_id,
        is_milp=is_milp,
        baseline=baseline_point,
        grid_config=SensitivityGridConfig(
            min_multiplier=req.min_multiplier,
            max_multiplier=req.max_multiplier,
            requested_points=req.num_points,
            grid_multipliers=grid,
            baseline_included_in_grid=baseline_in_grid,
            total_solver_runs=total_runs,
            per_solve_time_limit_seconds=per_solve_time_limit_seconds,
            total_budget_seconds=total_budget_seconds,
            budget_exhausted=budget_exhausted,
        ),
        points=points,
        summary=SensitivitySummary(
            total_grid_points=total_grid_points,
            feasible_optimal_count=len(feasible_points),
            infeasible_count=len(infeasible_points),
            incomplete_or_error_count=len(incomplete_points),
            feasibility_rate_pct=feasibility_rate_pct,
            objective_sense=objective_sense,
            baseline_objective=baseline_obj,
            best_feasible_objective=best_obj,
            worst_case_feasible_objective=worst_obj,
            objective_range=obj_range,
            max_plan_shift_pct=max_plan_shift_pct,
            first_infeasible_multiplier=first_infeasible_multiplier,
            observed_transitions=transitions,
            total_runtime_seconds=total_runtime,
            empirical_disclosure=disclosure,
        ),
    )

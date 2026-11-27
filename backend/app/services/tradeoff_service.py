from __future__ import annotations

import math
import time
from typing import Any

import pulp

from app.schemas import (
    MultiPeriodSolveResponse,
    SensitivitySolveCategory,
    TradeoffCandidateResult,
    TradeoffCriterion,
    TradeoffExploreRequest,
    TradeoffExploreResponse,
    TradeoffSummary,
    TradeoffToleranceMode,
)
from app.services.multi_period_solver import (
    BuiltMultiPeriodModel,
    PreparedMultiPeriodData,
    build_multi_period_pulp_model,
    extract_multi_period_response,
    prepare_multi_period_data,
    solve_prepared_multi_period,
)

MIN_TRADEOFF_POINTS = 2
MAX_TRADEOFF_POINTS = 12
MAX_RELATIVE_TOLERANCE_PCT = 50.0
MAX_ABSOLUTE_TOLERANCE = 1e6
NEAR_ZERO_OBJECTIVE_THRESHOLD = 1e-6
FEASIBILITY_TOLERANCE = 1e-5
DECISION_DUPLICATE_TOLERANCE = 1e-4
DEFAULT_PER_SOLVE_TIME_LIMIT_SECONDS = 5.0
DEFAULT_TOTAL_BUDGET_SECONDS = 25.0

CRITERION_METADATA: dict[TradeoffCriterion, tuple[str, str]] = {
    "peak_utilization": ("Peak Capacity Utilization", "%"),
    "cumulative_inventory": ("Cumulative Ending Inventory", "units"),
    "production_smoothing": ("Production Ramp Volatility (L1)", "units"),
}


def _validate_criterion_supported(
    prepared: PreparedMultiPeriodData,
    built_probe: BuiltMultiPeriodModel,
    criterion: TradeoffCriterion,
) -> None:
    if criterion == "peak_utilization":
        if not prepared.has_capacity:
            raise ValueError(
                "Cannot explore 'peak_utilization' trade-offs because Capacity is not mapped in this model."
            )
        positive_caps = [
            meta for meta, _ in built_probe.capacity_lhs_exprs if float(meta["capacity"]) > 0.0
        ]
        if not positive_caps:
            raise ValueError(
                "Cannot explore 'peak_utilization' trade-offs because no positive capacity limits exist."
            )
    elif criterion == "production_smoothing":
        if len(prepared.periods) < 2:
            raise ValueError(
                "Cannot explore 'production_smoothing' trade-offs because at least 2 periods are required."
            )
    elif criterion != "cumulative_inventory":
        raise ValueError(f"Unsupported trade-off criterion: {criterion}")


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


def _compute_criterion_from_response(
    resp: MultiPeriodSolveResponse, criterion: TradeoffCriterion
) -> float | None:
    if not (resp.is_optimal and resp.constraints_feasible):
        return None
    if criterion == "peak_utilization":
        vals = [
            float(u["utilization_pct"])
            for u in resp.resource_utilization
            if u.get("utilization_pct") is not None and math.isfinite(float(u["utilization_pct"]))
        ]
        return round(max(vals), 4) if vals else None
    if criterion == "cumulative_inventory":
        if resp.total_ending_inventory is None or not math.isfinite(resp.total_ending_inventory):
            return None
        return round(float(resp.total_ending_inventory), 6)
    if criterion == "production_smoothing":
        by_prod: dict[str, list[float]] = {}
        for row in resp.production_schedule:
            p = str(row["product"])
            by_prod.setdefault(p, []).append(float(row.get("production", 0.0)))
        ramp = 0.0
        for seq in by_prod.values():
            for a, b in zip(seq, seq[1:]):
                ramp += abs(b - a)
        return round(ramp, 6)
    return None


def _extract_decision_vector(
    resp: MultiPeriodSolveResponse,
) -> tuple[dict[tuple[str, str], float], dict[tuple[str, str], float], dict[tuple[str, str], int]]:
    prod: dict[tuple[str, str], float] = {}
    inv: dict[tuple[str, str], float] = {}
    setup: dict[tuple[str, str], int] = {}
    for row in resp.production_schedule:
        key = (str(row["product"]), str(row["period"]))
        prod[key] = float(row.get("production", 0.0))
        inv[key] = float(row.get("ending_inventory", 0.0))
        if "setup" in row and row["setup"] is not None:
            setup[key] = int(row["setup"])
    return prod, inv, setup


def _vectors_match(
    a: tuple[dict[tuple[str, str], float], dict[tuple[str, str], float], dict[tuple[str, str], int]],
    b: tuple[dict[tuple[str, str], float], dict[tuple[str, str], float], dict[tuple[str, str], int]],
) -> bool:
    a_prod, a_inv, a_setup = a
    b_prod, b_inv, b_setup = b
    for k in set(a_prod.keys()) | set(b_prod.keys()):
        if abs(a_prod.get(k, 0.0) - b_prod.get(k, 0.0)) > DECISION_DUPLICATE_TOLERANCE:
            return False
    for k in set(a_inv.keys()) | set(b_inv.keys()):
        if abs(a_inv.get(k, 0.0) - b_inv.get(k, 0.0)) > DECISION_DUPLICATE_TOLERANCE:
            return False
    for k in set(a_setup.keys()) | set(b_setup.keys()):
        if a_setup.get(k, 0) != b_setup.get(k, 0):
            return False
    return True


def _compute_plan_shift_pct(
    prod: dict[tuple[str, str], float],
    baseline_prod: dict[tuple[str, str], float],
    baseline_prod_l1: float,
) -> float:
    all_keys = set(baseline_prod.keys()) | set(prod.keys())
    l1_diff = sum(abs(prod.get(k, 0.0) - baseline_prod.get(k, 0.0)) for k in all_keys)
    denom = max(baseline_prod_l1, 1.0)
    return round(100.0 * l1_diff / denom, 4)


def _solve_epsilon_candidate(
    prepared: PreparedMultiPeriodData,
    criterion: TradeoffCriterion,
    objective_sense: str,
    objective_budget: float,
    *,
    time_limit_seconds: float,
) -> tuple[MultiPeriodSolveResponse, float | None, bool]:
    built = build_multi_period_pulp_model(prepared)
    prob = built.prob

    # Add hard epsilon-constraint budget on the original objective expression
    is_minimize = objective_sense.lower().startswith("min")
    if is_minimize:
        prob += built.original_obj_expr <= objective_budget, "Tradeoff_Objective_Budget"
    else:
        prob += built.original_obj_expr >= objective_budget, "Tradeoff_Objective_Budget"

    # Replace objective with the verified secondary operational criterion
    if criterion == "peak_utilization":
        u_max = pulp.LpVariable("Tradeoff_U_max", lowBound=0, cat=pulp.LpContinuous)
        for idx, (meta, lhs_expr) in enumerate(built.capacity_lhs_exprs):
            cap_val = float(meta["capacity"])
            if cap_val > 0.0:
                prob += lhs_expr <= u_max * cap_val, f"Tradeoff_PeakUtil_{idx}"
        prob.setObjective(u_max)
    elif criterion == "cumulative_inventory":
        inv_expr = pulp.lpSum(
            built.I_var[(p, t)] for p in prepared.products for t in prepared.periods
        )
        prob.setObjective(inv_expr)
    elif criterion == "production_smoothing":
        ramp_terms = []
        for i, p in enumerate(prepared.products):
            for j in range(1, len(prepared.periods)):
                t_prev = prepared.periods[j - 1]
                t_curr = prepared.periods[j]
                d_pos = pulp.LpVariable(
                    f"Tradeoff_RampPos_{i}_{j}", lowBound=0, cat=pulp.LpContinuous
                )
                d_neg = pulp.LpVariable(
                    f"Tradeoff_RampNeg_{i}_{j}", lowBound=0, cat=pulp.LpContinuous
                )
                prob += (
                    built.x[(p, t_curr)] - built.x[(p, t_prev)] == d_pos - d_neg,
                    f"Tradeoff_Ramp_{i}_{j}",
                )
                ramp_terms.append(d_pos + d_neg)
        prob.setObjective(pulp.lpSum(ramp_terms))

    t0 = time.perf_counter()
    solver_kwargs: dict[str, Any] = {"msg": False, "timeLimit": float(time_limit_seconds)}
    solver = pulp.PULP_CBC_CMD(**solver_kwargs)
    prob.solve(solver)
    solve_time = round(time.perf_counter() - t0, 4)

    resp = extract_multi_period_response(prepared, built, solve_time=solve_time)
    crit_val = _compute_criterion_from_response(resp, criterion)

    budget_satisfied = False
    if resp.is_optimal and resp.objective_value is not None and math.isfinite(resp.objective_value):
        if is_minimize:
            budget_satisfied = resp.objective_value <= objective_budget + FEASIBILITY_TOLERANCE
        else:
            budget_satisfied = resp.objective_value >= objective_budget - FEASIBILITY_TOLERANCE

    return resp, crit_val, budget_satisfied


def run_tradeoff_exploration(
    req: TradeoffExploreRequest,
    *,
    per_solve_time_limit_seconds: float = DEFAULT_PER_SOLVE_TIME_LIMIT_SECONDS,
    total_budget_seconds: float = DEFAULT_TOTAL_BUDGET_SECONDS,
) -> TradeoffExploreResponse:
    t_start = time.perf_counter()

    if req.num_points < MIN_TRADEOFF_POINTS or req.num_points > MAX_TRADEOFF_POINTS:
        raise ValueError(
            f"num_points must be between {MIN_TRADEOFF_POINTS} and {MAX_TRADEOFF_POINTS}."
        )

    prepared = prepare_multi_period_data(
        req.dataset_id,
        req.mapping,
        integer_production=req.integer_production,
        allow_backlogging=req.allow_backlogging,
        capacity_scope=req.capacity_scope,
    )
    probe_model = build_multi_period_pulp_model(prepared)
    _validate_criterion_supported(prepared, probe_model, req.criterion)

    # Solve and verify baseline first
    baseline_resp = solve_prepared_multi_period(
        prepared, time_limit_seconds=per_solve_time_limit_seconds
    )
    if (
        not baseline_resp.is_optimal
        or not baseline_resp.constraints_feasible
        or baseline_resp.objective_value is None
        or not math.isfinite(baseline_resp.objective_value)
    ):
        raise ValueError(
            f"Baseline model is not optimal and feasible (status: '{baseline_resp.status}'); "
            "cannot generate trade-off alternatives."
        )

    baseline_obj = float(baseline_resp.objective_value)
    objective_sense = baseline_resp.objective_sense
    is_minimize = objective_sense.lower().startswith("min")
    baseline_crit = _compute_criterion_from_response(baseline_resp, req.criterion)
    if baseline_crit is None or not math.isfinite(baseline_crit):
        raise ValueError(
            f"Could not evaluate baseline '{req.criterion}' metric from optimal solution."
        )

    # Determine tolerance mode: relative % for non-zero baseline; explicit absolute for near-zero
    if abs(baseline_obj) >= NEAR_ZERO_OBJECTIVE_THRESHOLD:
        if req.max_relative_tolerance_pct is None:
            raise ValueError(
                "max_relative_tolerance_pct is required when baseline objective is non-zero."
            )
        tol_mode: TradeoffToleranceMode = "relative_pct"
        max_tol = float(req.max_relative_tolerance_pct)
        if not math.isfinite(max_tol) or max_tol <= 0.0 or max_tol > MAX_RELATIVE_TOLERANCE_PCT:
            raise ValueError(
                f"max_relative_tolerance_pct must be in (0, {MAX_RELATIVE_TOLERANCE_PCT}]."
            )
        tol_grid = [
            round((i * max_tol) / (req.num_points - 1), 6) for i in range(req.num_points)
        ]
    else:
        if req.absolute_tolerance is None:
            raise ValueError(
                "Baseline objective is zero or near-zero; an explicit positive absolute_tolerance "
                "(in objective units) is required instead of a relative percentage."
            )
        tol_mode = "absolute"
        max_tol = float(req.absolute_tolerance)
        if not math.isfinite(max_tol) or max_tol <= 0.0 or max_tol > MAX_ABSOLUTE_TOLERANCE:
            raise ValueError(
                f"absolute_tolerance must be in (0, {MAX_ABSOLUTE_TOLERANCE}]."
            )
        tol_grid = [
            round((i * max_tol) / (req.num_points - 1), 6) for i in range(req.num_points)
        ]

    baseline_vec = _extract_decision_vector(baseline_resp)
    baseline_prod_l1 = sum(abs(v) for v in baseline_vec[0].values())
    baseline_peak_util = _compute_criterion_from_response(baseline_resp, "peak_utilization")

    baseline_candidate = TradeoffCandidateResult(
        candidate_id="baseline",
        index=0,
        is_baseline=True,
        tolerance_value=0.0,
        objective_budget=baseline_obj,
        solver_status=baseline_resp.status,
        status_category="optimal",
        is_optimal=True,
        original_constraints_feasible=True,
        objective_budget_satisfied=True,
        is_verified_feasible=True,
        objective_value=baseline_obj,
        objective_diff=0.0,
        objective_pct_change=0.0 if abs(baseline_obj) >= NEAR_ZERO_OBJECTIVE_THRESHOLD else None,
        criterion_value=baseline_crit,
        criterion_diff=0.0,
        plan_shift_pct=0.0,
        peak_utilization_pct=baseline_peak_util,
        total_production=baseline_resp.total_production,
        total_demand=baseline_resp.total_demand,
        total_ending_inventory=baseline_resp.total_ending_inventory,
        cost_breakdown=baseline_resp.cost_breakdown,
        max_constraint_violation=baseline_resp.max_constraint_violation,
        runtime_seconds=baseline_resp.solve_time_seconds,
        is_duplicate=False,
        duplicate_of_candidate_id=None,
        production_schedule=baseline_resp.production_schedule,
        resource_utilization=baseline_resp.resource_utilization,
        error_message=None,
    )

    candidates: list[TradeoffCandidateResult] = []
    seen_vectors: list[tuple[str, tuple[dict[tuple[str, str], float], dict[tuple[str, str], float], dict[tuple[str, str], int]]]] = [
        ("baseline", baseline_vec)
    ]
    budget_exhausted = False

    for idx, tol_val in enumerate(tol_grid):
        eps = (tol_val / 100.0) * abs(baseline_obj) if tol_mode == "relative_pct" else tol_val
        obj_budget = round(baseline_obj + eps if is_minimize else baseline_obj - eps, 6)
        cand_id = f"alt-{idx + 1}"

        if time.perf_counter() - t_start >= total_budget_seconds:
            budget_exhausted = True
            candidates.append(
                TradeoffCandidateResult(
                    candidate_id=cand_id,
                    index=idx,
                    is_baseline=False,
                    tolerance_value=tol_val,
                    objective_budget=obj_budget,
                    solver_status="Not Solved (Budget Exhausted)",
                    status_category="timeout",
                    is_optimal=False,
                    original_constraints_feasible=False,
                    objective_budget_satisfied=False,
                    is_verified_feasible=False,
                    runtime_seconds=0.0,
                    error_message="Total trade-off execution budget exceeded before solving this point.",
                )
            )
            continue

        pt_t0 = time.perf_counter()
        try:
            resp, crit_val, budget_ok = _solve_epsilon_candidate(
                prepared,
                req.criterion,
                objective_sense,
                obj_budget,
                time_limit_seconds=per_solve_time_limit_seconds,
            )
        except Exception as exc:
            candidates.append(
                TradeoffCandidateResult(
                    candidate_id=cand_id,
                    index=idx,
                    is_baseline=False,
                    tolerance_value=tol_val,
                    objective_budget=obj_budget,
                    solver_status="Solver Error",
                    status_category="solver_error",
                    is_optimal=False,
                    original_constraints_feasible=False,
                    objective_budget_satisfied=False,
                    is_verified_feasible=False,
                    runtime_seconds=round(time.perf_counter() - pt_t0, 4),
                    error_message=str(exc),
                )
            )
            continue

        status_cat = _classify_status(resp.status, resp.is_optimal)
        verified = bool(
            resp.is_optimal
            and resp.constraints_feasible
            and budget_ok
            and resp.objective_value is not None
            and math.isfinite(resp.objective_value)
            and crit_val is not None
            and math.isfinite(crit_val)
        )

        if not verified:
            err_msg = None
            if status_cat == "timeout":
                err_msg = "Solver did not prove optimality within the per-solve time limit."
            elif resp.is_optimal and not budget_ok:
                err_msg = "Candidate violated the original objective tolerance budget."
            elif status_cat in {"unbounded", "unknown"}:
                err_msg = resp.message

            candidates.append(
                TradeoffCandidateResult(
                    candidate_id=cand_id,
                    index=idx,
                    is_baseline=False,
                    tolerance_value=tol_val,
                    objective_budget=obj_budget,
                    solver_status=resp.status,
                    status_category=status_cat,
                    is_optimal=resp.is_optimal,
                    original_constraints_feasible=resp.constraints_feasible,
                    objective_budget_satisfied=budget_ok,
                    is_verified_feasible=False,
                    runtime_seconds=resp.solve_time_seconds,
                    max_constraint_violation=resp.max_constraint_violation,
                    error_message=err_msg,
                )
            )
            continue

        obj_val = float(resp.objective_value)  # type: ignore[arg-type]
        obj_diff = round(obj_val - baseline_obj, 6)
        obj_pct = (
            round(((obj_val - baseline_obj) / abs(baseline_obj)) * 100.0, 4)
            if abs(baseline_obj) >= NEAR_ZERO_OBJECTIVE_THRESHOLD
            else None
        )
        crit_diff = round(float(crit_val) - baseline_crit, 6)  # type: ignore[arg-type]
        cand_vec = _extract_decision_vector(resp)
        plan_shift = _compute_plan_shift_pct(cand_vec[0], baseline_vec[0], baseline_prod_l1)
        peak_util = _compute_criterion_from_response(resp, "peak_utilization")

        dup_of: str | None = None
        for prev_id, prev_vec in seen_vectors:
            if _vectors_match(cand_vec, prev_vec):
                dup_of = prev_id
                break
        if dup_of is None:
            seen_vectors.append((cand_id, cand_vec))

        candidates.append(
            TradeoffCandidateResult(
                candidate_id=cand_id,
                index=idx,
                is_baseline=False,
                tolerance_value=tol_val,
                objective_budget=obj_budget,
                solver_status=resp.status,
                status_category=status_cat,
                is_optimal=True,
                original_constraints_feasible=True,
                objective_budget_satisfied=True,
                is_verified_feasible=True,
                objective_value=obj_val,
                objective_diff=obj_diff,
                objective_pct_change=obj_pct,
                criterion_value=crit_val,
                criterion_diff=crit_diff,
                plan_shift_pct=plan_shift,
                peak_utilization_pct=peak_util,
                total_production=resp.total_production,
                total_demand=resp.total_demand,
                total_ending_inventory=resp.total_ending_inventory,
                cost_breakdown=resp.cost_breakdown,
                max_constraint_violation=resp.max_constraint_violation,
                runtime_seconds=resp.solve_time_seconds,
                is_duplicate=dup_of is not None,
                duplicate_of_candidate_id=dup_of,
                production_schedule=resp.production_schedule,
                resource_utilization=resp.resource_utilization,
                error_message=None,
            )
        )

    verified_cands = [c for c in candidates if c.is_verified_feasible]
    distinct_cands = [c for c in verified_cands if not c.is_duplicate]
    dup_count = sum(1 for c in verified_cands if c.is_duplicate)
    incomplete_count = len(candidates) - len(verified_cands)

    crit_vals = [
        c.criterion_value
        for c in verified_cands
        if c.criterion_value is not None and math.isfinite(c.criterion_value)
    ]
    best_crit = min(crit_vals) if crit_vals else None
    crit_improvement = (
        round(baseline_crit - best_crit, 6) if best_crit is not None else None
    )

    crit_label, crit_unit = CRITERION_METADATA[req.criterion]
    is_milp = bool(prepared.integer_production or prepared.has_setup)
    total_runtime = round(time.perf_counter() - t_start, 4)

    disclosure = (
        "Trade-off candidates are generated via bounded epsilon-constraint optimization over the "
        "exact original Multi-Period feasible region. Only proven optimal solutions that satisfy "
        "all original constraints and the objective tolerance budget are marked verified feasible."
    )
    if is_milp:
        disclosure += " MILP mode uses discrete re-optimization; intermediate non-convex trade-offs may appear."

    return TradeoffExploreResponse(
        dataset_id=req.dataset_id,
        criterion=req.criterion,
        is_milp=is_milp,
        baseline=baseline_candidate,
        candidates=candidates,
        summary=TradeoffSummary(
            criterion=req.criterion,
            criterion_label=crit_label,
            criterion_unit=crit_unit,
            tolerance_mode=tol_mode,
            objective_sense=objective_sense,
            baseline_objective=baseline_obj,
            baseline_criterion_value=baseline_crit,
            total_requested_points=len(candidates),
            verified_feasible_count=len(verified_cands),
            distinct_feasible_count=len(distinct_cands),
            duplicate_count=dup_count,
            incomplete_or_error_count=incomplete_count,
            best_criterion_value=best_crit,
            criterion_improvement=crit_improvement,
            budget_exhausted=budget_exhausted,
            total_runtime_seconds=total_runtime,
            per_solve_time_limit_seconds=per_solve_time_limit_seconds,
            total_budget_seconds=total_budget_seconds,
            disclosure=disclosure,
        ),
    )

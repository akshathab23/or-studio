from __future__ import annotations

import time
from typing import Any

import pulp

from app.schemas import (
    GoalProgrammingSolveRequest,
    GoalProgrammingSolveResponse,
    GPGoalResult,
    MathFormulationSection,
)


def solve_goal_programming(req: GoalProgrammingSolveRequest) -> GoalProgrammingSolveResponse:
    t0 = time.perf_counter()
    if not req.variables:
        raise ValueError("At least one decision variable is required.")
    if not req.goals:
        raise ValueError("At least one goal is required.")

    var_names = [v.name for v in req.variables]
    if len(set(var_names)) != len(var_names):
        raise ValueError("Decision variable names must be unique.")

    solver = pulp.PULP_CBC_CMD(msg=False)

    def build_base_model():
        prob = pulp.LpProblem("OR_Studio_Goal_Programming", pulp.LpMinimize)
        x_vars: dict[str, pulp.LpVariable] = {}
        for v in req.variables:
            cat = pulp.LpInteger if v.var_type == "integer" else pulp.LpContinuous
            x_vars[v.name] = pulp.LpVariable(
                f"var_{v.name}",
                lowBound=v.lower_bound,
                upBound=v.upper_bound,
                cat=cat,
            )

        # Hard constraints
        for idx, hc in enumerate(req.hard_constraints):
            expr = pulp.lpSum(
                hc.coefficients.get(vn, 0.0) * x_vars[vn] for vn in var_names
            )
            if hc.operator == "<=":
                prob += expr <= hc.rhs, f"Hard_{idx}_{hc.name}"
            elif hc.operator == ">=":
                prob += expr >= hc.rhs, f"Hard_{idx}_{hc.name}"
            else:
                prob += expr == hc.rhs, f"Hard_{idx}_{hc.name}"

        # Goal constraints & deviation variables: expr + D- - D+ = target
        d_pos: list[pulp.LpVariable] = []
        d_neg: list[pulp.LpVariable] = []
        goal_exprs: list[pulp.LpAffineExpression] = []

        for k, g in enumerate(req.goals):
            dp = pulp.LpVariable(f"D_pos_{k}", lowBound=0, cat=pulp.LpContinuous)
            dn = pulp.LpVariable(f"D_neg_{k}", lowBound=0, cat=pulp.LpContinuous)
            d_pos.append(dp)
            d_neg.append(dn)

            g_expr = pulp.lpSum(
                g.coefficients.get(vn, 0.0) * x_vars[vn] for vn in var_names
            )
            goal_exprs.append(g_expr)
            prob += g_expr + dn - dp == g.target, f"Goal_{k}_{g.name}"

        return prob, x_vars, d_pos, d_neg, goal_exprs

    def penalty_term_for_goal(k: int, d_pos: list[pulp.LpVariable], d_neg: list[pulp.LpVariable]):
        g = req.goals[k]
        if g.goal_type == "minimum":
            # Achieve >= target => penalize negative deviation D-
            return g.weight * d_neg[k]
        if g.goal_type == "maximum":
            # Achieve <= target => penalize positive deviation D+
            return g.weight * d_pos[k]
        # Exact target => penalize both D- and D+
        return g.weight * (d_neg[k] + d_pos[k])

    priority_levels_solved: list[dict[str, Any]] = []
    final_prob = None
    final_x: dict[str, pulp.LpVariable] = {}
    final_dp: list[pulp.LpVariable] = []
    final_dn: list[pulp.LpVariable] = []
    final_status = "Unknown"

    if req.method == "weighted":
        prob, x_vars, d_pos, d_neg, _ = build_base_model()
        total_obj = pulp.lpSum(
            penalty_term_for_goal(k, d_pos, d_neg) for k in range(len(req.goals))
        )
        prob += total_obj, "Weighted_Deviation_Sum"
        prob.solve(solver)
        final_status = pulp.LpStatus.get(prob.status, "Unknown")
        final_prob = prob
        final_x = x_vars
        final_dp = d_pos
        final_dn = d_neg
        priority_levels_solved.append(
            {
                "priority": "All (Weighted)",
                "status": final_status,
                "objective": (
                    round(float(pulp.value(prob.objective)), 6)
                    if final_status == "Optimal"
                    else None
                ),
            }
        )
    else:
        # Preemptive Lexicographic Goal Programming:
        # Solve priority levels sequentially and lock each achieved optimum
        priorities = sorted({g.priority for g in req.goals})
        prob, x_vars, d_pos, d_neg, _ = build_base_model()

        for p_level in priorities:
            level_indices = [k for k, g in enumerate(req.goals) if g.priority == p_level]
            level_obj = pulp.lpSum(
                penalty_term_for_goal(k, d_pos, d_neg) for k in level_indices
            )
            prob.setObjective(level_obj)
            prob.solve(solver)
            step_status = pulp.LpStatus.get(prob.status, "Unknown")
            if step_status != "Optimal":
                final_status = step_status
                final_prob = prob
                final_x = x_vars
                final_dp = d_pos
                final_dn = d_neg
                priority_levels_solved.append(
                    {"priority": p_level, "status": step_status, "objective": None}
                )
                break

            z_opt = float(pulp.value(prob.objective) or 0.0)
            priority_levels_solved.append(
                {
                    "priority": p_level,
                    "status": step_status,
                    "objective": round(z_opt, 6),
                }
            )
            # Preserve achieved priority optimum before moving to next priority level
            prob += level_obj <= z_opt + 1e-6, f"Preserve_Priority_{p_level}"
            final_status = step_status
            final_prob = prob
            final_x = x_vars
            final_dp = d_pos
            final_dn = d_neg

    solve_time = round(time.perf_counter() - t0, 4)
    is_optimal = final_status == "Optimal"

    variable_values: dict[str, float] = {}
    goal_results: list[GPGoalResult] = []
    total_weighted_penalty: float | None = None

    if is_optimal and final_prob is not None:
        variable_values = {
            vn: round(float(pulp.value(final_x[vn]) or 0.0), 6) for vn in var_names
        }
        total_pen = 0.0
        for k, g in enumerate(req.goals):
            achieved = sum(g.coefficients.get(vn, 0.0) * variable_values[vn] for vn in var_names)
            achieved = round(achieved, 6)
            dp_val = round(float(pulp.value(final_dp[k]) or 0.0), 6)
            dn_val = round(float(pulp.value(final_dn[k]) or 0.0), 6)

            if g.goal_type == "minimum":
                pen = g.weight * dn_val
                g_status = "Achieved" if dn_val <= 1e-5 else "Underachieved"
            elif g.goal_type == "maximum":
                pen = g.weight * dp_val
                g_status = "Achieved" if dp_val <= 1e-5 else "Overachieved"
            else:
                pen = g.weight * (dp_val + dn_val)
                if dp_val <= 1e-5 and dn_val <= 1e-5:
                    g_status = "Achieved"
                elif dp_val > 1e-5:
                    g_status = "Overachieved"
                else:
                    g_status = "Underachieved"

            total_pen += pen
            goal_results.append(
                GPGoalResult(
                    name=g.name,
                    goal_type=g.goal_type,
                    target=g.target,
                    achieved=achieved,
                    positive_deviation=dp_val,
                    negative_deviation=dn_val,
                    priority=g.priority,
                    weight=g.weight,
                    penalty_contribution=round(pen, 6),
                    status=g_status,
                )
            )
        total_weighted_penalty = round(total_pen, 6)
    else:
        for g in req.goals:
            goal_results.append(
                GPGoalResult(
                    name=g.name,
                    goal_type=g.goal_type,
                    target=g.target,
                    achieved=None,
                    positive_deviation=None,
                    negative_deviation=None,
                    priority=g.priority,
                    weight=g.weight,
                    penalty_contribution=None,
                    status=final_status,
                )
            )

    formulation = _build_gp_formulation(
        req=req,
        status_str=final_status,
        total_weighted_penalty=total_weighted_penalty,
        priority_levels_solved=priority_levels_solved,
        variable_values=variable_values,
        goal_results=goal_results,
    )

    if is_optimal:
        msg = f"{req.method.capitalize()} Goal Programming solved to Optimal in {solve_time}s."
    elif final_status == "Infeasible":
        msg = "The hard constraints are INFEASIBLE. No solution satisfies all hard constraints."
    else:
        msg = f"Solver terminated with status: {final_status}."

    return GoalProgrammingSolveResponse(
        solver_name="PuLP CBC (COIN-OR Branch and Cut)",
        method=req.method,
        status=final_status,
        is_optimal=is_optimal,
        solve_time_seconds=solve_time,
        total_weighted_penalty=total_weighted_penalty,
        priority_levels_solved=priority_levels_solved,
        variable_values=variable_values,
        goal_results=goal_results,
        formulation=formulation,
        message=msg,
    )


def _format_linear_expr_latex(coeffs: dict[str, float], var_names: list[str]) -> str:
    terms: list[str] = []
    for vn in var_names:
        c = coeffs.get(vn, 0.0)
        if abs(c) < 1e-12:
            continue
        sign = "+" if c > 0 else "-"
        abs_c = abs(c)
        c_str = "" if abs(abs_c - 1.0) < 1e-9 else f"{abs_c:g}\\,"
        if not terms:
            terms.append(f"{'' if c > 0 else '-'}{c_str}{vn}")
        else:
            terms.append(f" {sign} {c_str}{vn}")
    return "".join(terms) if terms else "0"


def _build_gp_formulation(
    *,
    req: GoalProgrammingSolveRequest,
    status_str: str,
    total_weighted_penalty: float | None,
    priority_levels_solved: list[dict[str, Any]],
    variable_values: dict[str, float],
    goal_results: list[GPGoalResult],
) -> MathFormulationSection:
    var_names = [v.name for v in req.variables]
    decision_variables = [
        {
            "symbol": f"{v.name}",
            "description": f"Decision variable ({v.var_type}, bounds [{v.lower_bound}, {v.upper_bound if v.upper_bound is not None else '+∞'}])",
        }
        for v in req.variables
    ]
    decision_variables.extend(
        [
            {"symbol": r"D_k^+", "description": "Positive deviation (overachievement) for goal k"},
            {"symbol": r"D_k^-", "description": "Negative deviation (underachievement) for goal k"},
        ]
    )

    if req.method == "weighted":
        pen_parts = []
        for k, g in enumerate(req.goals, start=1):
            w_str = f"{g.weight:g}"
            if g.goal_type == "minimum":
                pen_parts.append(rf"{w_str} D_{{{k}}}^-")
            elif g.goal_type == "maximum":
                pen_parts.append(rf"{w_str} D_{{{k}}}^+")
            else:
                pen_parts.append(rf"{w_str} (D_{{{k}}}^- + D_{{{k}}}^+)")
        obj_latex = r"\min Z = " + " + ".join(pen_parts)
        obj_expl = "Non-preemptive weighted Goal Programming minimizes the weighted sum of unwanted deviations."
    else:
        priorities = sorted({g.priority for g in req.goals})
        lex_parts = []
        for p in priorities:
            p_terms = []
            for k, g in enumerate(req.goals, start=1):
                if g.priority != p:
                    continue
                w_str = f"{g.weight:g}"
                if g.goal_type == "minimum":
                    p_terms.append(rf"{w_str} D_{{{k}}}^-")
                elif g.goal_type == "maximum":
                    p_terms.append(rf"{w_str} D_{{{k}}}^+")
                else:
                    p_terms.append(rf"{w_str} (D_{{{k}}}^- + D_{{{k}}}^+)")
            lex_parts.append(rf"P_{{{p}}}\!:\; \min \left(" + " + ".join(p_terms) + r"\right)")
        obj_latex = r"\text{lex}\min \left[" + r",\;\; ".join(lex_parts) + r"\right]"
        obj_expl = (
            "Preemptive lexicographic Goal Programming optimizes each priority level sequentially "
            "and locks previously achieved priority optimums as hard constraints."
        )

    constraints = []
    for hc in req.hard_constraints:
        lhs = _format_linear_expr_latex(hc.coefficients, var_names)
        op_latex = r"\le" if hc.operator == "<=" else (r"\ge" if hc.operator == ">=" else "=")
        constraints.append(
            {
                "name": f"Hard: {hc.name}",
                "latex": rf"{lhs} {op_latex} {hc.rhs:g}",
                "explanation": "Mandatory hard constraint that must be satisfied by any feasible solution.",
            }
        )

    for k, g in enumerate(req.goals, start=1):
        lhs = _format_linear_expr_latex(g.coefficients, var_names)
        pen_dev = (
            f"D_{{{k}}}^-"
            if g.goal_type == "minimum"
            else (f"D_{{{k}}}^+" if g.goal_type == "maximum" else f"D_{{{k}}}^-, D_{{{k}}}^+")
        )
        constraints.append(
            {
                "name": f"Goal {k} ({g.goal_type}, P{g.priority}): {g.name}",
                "latex": rf"{lhs} + D_{{{k}}}^- - D_{{{k}}}^+ = {g.target:g}",
                "explanation": f"Measures deviation from target {g.target:g}; unwanted deviation penalized: {pen_dev}.",
            }
        )

    non_neg = (
        ", ".join(rf"{v.name} \ge {v.lower_bound:g}" for v in req.variables)
        + r",\quad D_k^+, D_k^- \ge 0 \;\forall k"
    )
    int_vars = [v.name for v in req.variables if v.var_type == "integer"]
    integrality = (
        ", ".join(rf"{vn} \in \mathbb{{Z}}" for vn in int_vars) if int_vars else None
    )

    interpretation = []
    if status_str == "Optimal":
        achieved_count = sum(1 for gr in goal_results if gr.status == "Achieved")
        interpretation.append(
            f"Solved to Optimal ({req.method} method). {achieved_count} of {len(goal_results)} goals were fully achieved."
        )
        if total_weighted_penalty is not None:
            interpretation.append(f"Total weighted deviation penalty = {total_weighted_penalty}.")
        for vn, val in variable_values.items():
            interpretation.append(f"Optimal {vn} = {val}.")
    else:
        interpretation.append(
            f"Solver status is '{status_str}'. Check hard constraints for conflicts."
        )

    return MathFormulationSection(
        problem_title=f"Goal Programming ({'Preemptive Lexicographic' if req.method == 'preemptive' else 'Non-Preemptive Weighted'})",
        problem_definition=(
            "Finds decision variable values satisfying all hard constraints while minimizing "
            "deviations from multiple competing goal targets."
        ),
        sets=[{"symbol": r"\mathcal{K}", "description": f"Set of goals (|K| = {len(req.goals)})"}],
        parameters=[
            {"symbol": r"g_k", "description": "Target value for goal k"},
            {"symbol": r"w_k", "description": "Weight for goal k"},
            {"symbol": r"P_p", "description": "Priority level p (1 = highest)"},
        ],
        decision_variables=decision_variables,
        objective_latex=obj_latex,
        objective_explanation=obj_expl,
        constraints=constraints,
        non_negativity_latex=non_neg,
        integrality_latex=integrality,
        numerical_summary={
            "method": req.method,
            "decision_variables": len(req.variables),
            "hard_constraints": len(req.hard_constraints),
            "goals": len(req.goals),
            "priority_levels": priority_levels_solved,
            "total_weighted_penalty": total_weighted_penalty,
            "status": status_str,
        },
        solution_interpretation=interpretation,
    )

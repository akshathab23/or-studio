from __future__ import annotations

import time
from typing import Any

import pandas as pd
import pulp

from app.schemas import (
    MathFormulationSection,
    MultiPeriodSolveRequest,
    MultiPeriodSolveResponse,
)
from app.services.dataset_service import get_dataset, validate_multi_period_mapping


def _sort_periods(values: list[Any]) -> list[str]:
    unique = list(dict.fromkeys(str(v) for v in values))
    try:
        return [str(x) for x in sorted(unique, key=lambda v: float(v))]
    except ValueError:
        return unique


def solve_multi_period(req: MultiPeriodSolveRequest) -> MultiPeriodSolveResponse:
    t0 = time.perf_counter()
    validation = validate_multi_period_mapping(req.dataset_id, req.mapping)
    if not validation.valid:
        err_msgs = "; ".join(i.message for i in validation.issues if i.severity == "error")
        raise ValueError(f"Mapping validation failed: {err_msgs}")

    stored = get_dataset(req.dataset_id)
    df = stored.df.copy()
    m = req.mapping

    # Extract sets
    products: list[str] = list(dict.fromkeys(str(v) for v in df[m.product].tolist()))
    periods: list[str] = _sort_periods(df[m.period].tolist())

    has_prod_cost = bool(m.production_cost)
    has_inv_cost = bool(m.inventory_cost)
    has_capacity = bool(m.capacity)
    has_proc_time = bool(m.processing_time)
    has_resource = bool(m.resource)
    has_init_inv = bool(m.initial_inventory)
    has_setup_cost = bool(m.setup_cost)
    has_setup_time = bool(m.setup_time)
    has_setup = has_setup_cost or has_setup_time

    # Build parameter dictionaries from actual rows
    demand: dict[tuple[str, str], float] = {(p, t): 0.0 for p in products for t in periods}
    prod_cost: dict[tuple[str, str], float] = {}
    inv_cost: dict[tuple[str, str], float] = {}
    proc_time: dict[tuple[str, str], float] = {}
    setup_cost: dict[tuple[str, str], float] = {}
    setup_time: dict[tuple[str, str], float] = {}
    init_inv: dict[str, float] = {p: 0.0 for p in products}
    init_inv_seen: set[str] = set()

    # Capacity structures
    cap_period: dict[str, float] = {}
    cap_resource_period: dict[tuple[str, str], float] = {}
    prod_period_resource: dict[tuple[str, str], str] = {}
    resources: list[str] = []

    for _, row in df.iterrows():
        p = str(row[m.product])
        t = str(row[m.period])
        d_val = float(pd.to_numeric(row[m.demand]))
        demand[(p, t)] = demand.get((p, t), 0.0) + d_val

        if has_prod_cost and m.production_cost:
            prod_cost[(p, t)] = float(pd.to_numeric(row[m.production_cost]))
        if has_inv_cost and m.inventory_cost:
            inv_cost[(p, t)] = float(pd.to_numeric(row[m.inventory_cost]))
        if has_proc_time and m.processing_time:
            proc_time[(p, t)] = float(pd.to_numeric(row[m.processing_time]))
        if has_setup_cost and m.setup_cost:
            setup_cost[(p, t)] = float(pd.to_numeric(row[m.setup_cost]))
        if has_setup_time and m.setup_time:
            setup_time[(p, t)] = float(pd.to_numeric(row[m.setup_time]))
        if has_init_inv and m.initial_inventory and p not in init_inv_seen:
            init_inv[p] = float(pd.to_numeric(row[m.initial_inventory]))
            init_inv_seen.add(p)

        if has_capacity and m.capacity:
            c_val = float(pd.to_numeric(row[m.capacity]))
            if has_resource and m.resource:
                r = str(row[m.resource])
                if r not in resources:
                    resources.append(r)
                prod_period_resource[(p, t)] = r
                cap_resource_period[(r, t)] = c_val
            else:
                cap_period[t] = c_val

    # Construct PuLP model
    prob = pulp.LpProblem("OR_Studio_Multi_Period_Production_Planning", pulp.LpMinimize)

    x_cat = pulp.LpInteger if req.integer_production else pulp.LpContinuous
    x: dict[tuple[str, str], pulp.LpVariable] = {
        (p, t): pulp.LpVariable(f"x_{i}_{j}", lowBound=0, cat=x_cat)
        for i, p in enumerate(products)
        for j, t in enumerate(periods)
    }
    I_var: dict[tuple[str, str], pulp.LpVariable] = {
        (p, t): pulp.LpVariable(f"I_{i}_{j}", lowBound=0, cat=pulp.LpContinuous)
        for i, p in enumerate(products)
        for j, t in enumerate(periods)
    }
    y: dict[tuple[str, str], pulp.LpVariable] = {}
    if has_setup:
        y = {
            (p, t): pulp.LpVariable(f"y_{i}_{j}", cat=pulp.LpBinary)
            for i, p in enumerate(products)
            for j, t in enumerate(periods)
        }

    # Objective function
    obj_terms = []
    uses_cost_objective = has_prod_cost or has_inv_cost or has_setup_cost
    if uses_cost_objective:
        for p in products:
            for t in periods:
                if has_prod_cost and (p, t) in prod_cost:
                    obj_terms.append(prod_cost[(p, t)] * x[(p, t)])
                if has_inv_cost and (p, t) in inv_cost:
                    obj_terms.append(inv_cost[(p, t)] * I_var[(p, t)])
                if has_setup_cost and (p, t) in setup_cost and (p, t) in y:
                    obj_terms.append(setup_cost[(p, t)] * y[(p, t)])
        obj_desc = "Minimize total production, inventory holding, and setup costs"
    else:
        for p in products:
            for t in periods:
                obj_terms.append(x[(p, t)] + I_var[(p, t)])
        obj_desc = "Minimize total production and ending inventory (no cost columns mapped)"

    prob += pulp.lpSum(obj_terms), "Total_Objective"

    # Constraints: 1. Inventory Balance
    for p in products:
        for j, t in enumerate(periods):
            prev_inv = init_inv[p] if j == 0 else I_var[(p, periods[j - 1])]
            prob += (
                prev_inv + x[(p, t)] - I_var[(p, t)] == demand[(p, t)],
                f"InvBalance_{p}_{t}",
            )

    # Constraints: 2. Capacity
    capacity_constraints_meta: list[dict[str, Any]] = []
    if has_capacity:
        if has_resource and resources:
            for r in resources:
                for t in periods:
                    if (r, t) not in cap_resource_period:
                        continue
                    lhs_terms = []
                    for p in products:
                        if prod_period_resource.get((p, t)) == r:
                            pt = proc_time.get((p, t), 1.0) if has_proc_time else 1.0
                            lhs_terms.append(pt * x[(p, t)])
                            if has_setup_time and (p, t) in setup_time and (p, t) in y:
                                lhs_terms.append(setup_time[(p, t)] * y[(p, t)])
                    if lhs_terms:
                        cap_val = cap_resource_period[(r, t)]
                        prob += pulp.lpSum(lhs_terms) <= cap_val, f"Cap_{r}_{t}"
                        capacity_constraints_meta.append(
                            {"resource": r, "period": t, "capacity": cap_val}
                        )
        else:
            for t in periods:
                if t not in cap_period:
                    continue
                lhs_terms = []
                for p in products:
                    pt = proc_time.get((p, t), 1.0) if has_proc_time else 1.0
                    lhs_terms.append(pt * x[(p, t)])
                    if has_setup_time and (p, t) in setup_time and (p, t) in y:
                        lhs_terms.append(setup_time[(p, t)] * y[(p, t)])
                cap_val = cap_period[t]
                prob += pulp.lpSum(lhs_terms) <= cap_val, f"Cap_{t}"
                capacity_constraints_meta.append(
                    {"resource": "Aggregate", "period": t, "capacity": cap_val}
                )

    # Constraints: 3. Setup linking (exact remaining demand upper bound)
    if has_setup:
        for p in products:
            total_rem = sum(demand[(p, t)] for t in periods)
            big_m = max(total_rem, 1.0)
            for t in periods:
                prob += x[(p, t)] <= big_m * y[(p, t)], f"SetupLink_{p}_{t}"

    # Solve
    solver = pulp.PULP_CBC_CMD(msg=False)
    prob.solve(solver)
    solve_time = round(time.perf_counter() - t0, 4)

    status_str = pulp.LpStatus.get(prob.status, "Unknown")
    is_optimal = status_str == "Optimal"

    var_count = len(prob.variables())
    con_count = len(prob.constraints)

    production_schedule: list[dict[str, Any]] = []
    period_summary: list[dict[str, Any]] = []
    resource_utilization: list[dict[str, Any]] = []
    cost_breakdown: dict[str, float] | None = None
    max_violation: float | None = None
    constraints_feasible = False
    obj_value: float | None = None
    total_prod: float | None = None
    total_dem: float | None = round(sum(demand.values()), 6)
    total_end_inv: float | None = None

    if is_optimal:
        obj_value = round(float(pulp.value(prob.objective)), 6)

        # Compute max constraint violation for solution verification
        max_v = 0.0
        for cname, con in prob.constraints.items():
            val = float(pulp.value(con))
            # PuLP constraint value is LHS - RHS
            if con.sense == pulp.LpConstraintEQ:
                viol = abs(val)
            elif con.sense == pulp.LpConstraintLE:
                viol = max(0.0, val)
            elif con.sense == pulp.LpConstraintGE:
                viol = max(0.0, -val)
            else:
                viol = 0.0
            if viol > max_v:
                max_v = viol
        max_violation = round(max_v, 8)
        constraints_feasible = max_v <= 1e-5

        total_p_val = 0.0
        total_i_val = 0.0
        total_prod_cost_val = 0.0
        total_inv_cost_val = 0.0
        total_setup_cost_val = 0.0

        for j, t in enumerate(periods):
            p_sum = 0.0
            d_sum = 0.0
            i_sum = 0.0
            for p in products:
                xv = round(float(pulp.value(x[(p, t)]) or 0.0), 6)
                iv = round(float(pulp.value(I_var[(p, t)]) or 0.0), 6)
                yv = round(float(pulp.value(y[(p, t)]) or 0.0), 6) if (p, t) in y else None
                dv = round(demand[(p, t)], 6)
                beg_inv = (
                    round(init_inv[p], 6)
                    if j == 0
                    else round(float(pulp.value(I_var[(p, periods[j - 1])]) or 0.0), 6)
                )

                pc = prod_cost.get((p, t), 0.0) * xv if has_prod_cost else 0.0
                ic = inv_cost.get((p, t), 0.0) * iv if has_inv_cost else 0.0
                sc = setup_cost.get((p, t), 0.0) * (yv or 0.0) if has_setup_cost else 0.0

                total_prod_cost_val += pc
                total_inv_cost_val += ic
                total_setup_cost_val += sc

                row_item: dict[str, Any] = {
                    "product": p,
                    "period": t,
                    "beginning_inventory": beg_inv,
                    "production": xv,
                    "demand": dv,
                    "ending_inventory": iv,
                }
                if yv is not None:
                    row_item["setup"] = int(round(yv))
                if has_prod_cost:
                    row_item["production_cost"] = round(pc, 4)
                if has_inv_cost:
                    row_item["inventory_cost"] = round(ic, 4)
                if has_setup_cost:
                    row_item["setup_cost"] = round(sc, 4)
                production_schedule.append(row_item)

                p_sum += xv
                d_sum += dv
                i_sum += iv

            total_p_val += p_sum
            total_i_val += i_sum
            period_summary.append(
                {
                    "period": t,
                    "total_production": round(p_sum, 6),
                    "total_demand": round(d_sum, 6),
                    "total_ending_inventory": round(i_sum, 6),
                }
            )

        total_prod = round(total_p_val, 6)
        total_end_inv = round(total_i_val, 6)

        if uses_cost_objective:
            cost_breakdown = {}
            if has_prod_cost:
                cost_breakdown["production_cost"] = round(total_prod_cost_val, 4)
            if has_inv_cost:
                cost_breakdown["inventory_cost"] = round(total_inv_cost_val, 4)
            if has_setup_cost:
                cost_breakdown["setup_cost"] = round(total_setup_cost_val, 4)

        # Resource utilization
        for meta in capacity_constraints_meta:
            r = meta["resource"]
            t = meta["period"]
            cap_val = meta["capacity"]
            used = 0.0
            for p in products:
                if has_resource and resources and prod_period_resource.get((p, t)) != r:
                    continue
                xv = float(pulp.value(x[(p, t)]) or 0.0)
                pt = proc_time.get((p, t), 1.0) if has_proc_time else 1.0
                used += pt * xv
                if has_setup_time and (p, t) in setup_time and (p, t) in y:
                    yv = float(pulp.value(y[(p, t)]) or 0.0)
                    used += setup_time[(p, t)] * yv
            util_pct = round((used / cap_val) * 100.0, 2) if cap_val > 0 else 0.0
            resource_utilization.append(
                {
                    "resource": r,
                    "period": t,
                    "used": round(used, 4),
                    "capacity": round(cap_val, 4),
                    "utilization_pct": util_pct,
                }
            )

    formulation = _build_multi_period_formulation(
        products=products,
        periods=periods,
        resources=resources,
        has_prod_cost=has_prod_cost,
        has_inv_cost=has_inv_cost,
        has_capacity=has_capacity,
        has_proc_time=has_proc_time,
        has_resource=has_resource and bool(resources),
        has_init_inv=has_init_inv,
        has_setup_cost=has_setup_cost,
        has_setup_time=has_setup_time,
        integer_production=req.integer_production,
        status_str=status_str,
        obj_value=obj_value,
        total_prod=total_prod,
        total_dem=total_dem,
        total_end_inv=total_end_inv,
        var_count=var_count,
        con_count=con_count,
        uses_cost_objective=uses_cost_objective,
    )

    if is_optimal:
        msg = f"Optimal solution found in {solve_time}s with objective value {obj_value}."
    elif status_str == "Infeasible":
        msg = (
            "The model is INFEASIBLE. No production plan satisfies all demand and capacity "
            "constraints simultaneously."
        )
    elif status_str == "Unbounded":
        msg = "The model is UNBOUNDED. Check cost signs and constraints."
    else:
        msg = f"Solver terminated with non-optimal status: {status_str}."

    return MultiPeriodSolveResponse(
        solver_name="PuLP CBC (COIN-OR Branch and Cut)",
        status=status_str,
        is_optimal=is_optimal,
        solve_time_seconds=solve_time,
        objective_value=obj_value,
        objective_sense="Minimize",
        objective_description=obj_desc,
        variable_count=var_count,
        constraint_count=con_count,
        max_constraint_violation=max_violation,
        constraints_feasible=constraints_feasible,
        total_production=total_prod,
        total_demand=total_dem,
        total_ending_inventory=total_end_inv,
        cost_breakdown=cost_breakdown,
        production_schedule=production_schedule,
        period_summary=period_summary,
        resource_utilization=resource_utilization,
        formulation=formulation,
        message=msg,
    )


def _build_multi_period_formulation(
    *,
    products: list[str],
    periods: list[str],
    resources: list[str],
    has_prod_cost: bool,
    has_inv_cost: bool,
    has_capacity: bool,
    has_proc_time: bool,
    has_resource: bool,
    has_init_inv: bool,
    has_setup_cost: bool,
    has_setup_time: bool,
    integer_production: bool,
    status_str: str,
    obj_value: float | None,
    total_prod: float | None,
    total_dem: float | None,
    total_end_inv: float | None,
    var_count: int,
    con_count: int,
    uses_cost_objective: bool,
) -> MathFormulationSection:
    sets = [
        {"symbol": r"\mathcal{P}", "description": f"Set of products (|P| = {len(products)})"},
        {"symbol": r"\mathcal{T}", "description": f"Ordered set of time periods (|T| = {len(periods)})"},
    ]
    if has_resource:
        sets.append(
            {"symbol": r"\mathcal{R}", "description": f"Set of resources (|R| = {len(resources)})"}
        )

    parameters = [
        {"symbol": r"d_{i,t}", "description": "Demand of product i in period t"},
    ]
    if has_prod_cost:
        parameters.append({"symbol": r"c^{prod}_{i,t}", "description": "Unit production cost of product i in period t"})
    if has_inv_cost:
        parameters.append({"symbol": r"c^{inv}_{i,t}", "description": "Unit inventory holding cost of product i at end of period t"})
    if has_init_inv:
        parameters.append({"symbol": r"I_{i,0}", "description": "Initial inventory of product i before period 1"})
    if has_capacity:
        if has_resource:
            parameters.append({"symbol": r"K_{r,t}", "description": "Available capacity of resource r in period t"})
        else:
            parameters.append({"symbol": r"K_t", "description": "Available aggregate production capacity in period t"})
    if has_proc_time:
        parameters.append({"symbol": r"a_{i,t}", "description": "Processing time per unit of product i in period t"})
    if has_setup_cost:
        parameters.append({"symbol": r"c^{setup}_{i,t}", "description": "Fixed setup cost for product i in period t"})
    if has_setup_time:
        parameters.append({"symbol": r"s_{i,t}", "description": "Setup time consumed when product i is produced in period t"})

    decision_variables = [
        {"symbol": r"x_{i,t}", "description": "Production quantity of product i in period t"},
        {"symbol": r"I_{i,t}", "description": "Ending inventory of product i in period t"},
    ]
    has_setup = has_setup_cost or has_setup_time
    if has_setup:
        decision_variables.append(
            {"symbol": r"y_{i,t} \in \{0,1\}", "description": "Binary setup indicator (1 if product i is produced in period t, 0 otherwise)"}
        )

    if uses_cost_objective:
        obj_parts = []
        if has_prod_cost:
            obj_parts.append(r"c^{prod}_{i,t} x_{i,t}")
        if has_inv_cost:
            obj_parts.append(r"c^{inv}_{i,t} I_{i,t}")
        if has_setup_cost:
            obj_parts.append(r"c^{setup}_{i,t} y_{i,t}")
        obj_latex = r"\min Z = \sum_{i \in \mathcal{P}} \sum_{t \in \mathcal{T}} \left( " + " + ".join(obj_parts) + r" \right)"
        obj_expl = "Minimizes the sum of all mapped cost components across every product and period."
    else:
        obj_latex = r"\min Z = \sum_{i \in \mathcal{P}} \sum_{t \in \mathcal{T}} (x_{i,t} + I_{i,t})"
        obj_expl = "No cost columns were mapped; minimizes total production and ending inventory as a feasibility proxy."

    constraints = [
        {
            "name": "Inventory Balance & Demand Satisfaction",
            "latex": r"I_{i,t-1} + x_{i,t} - I_{i,t} = d_{i,t} \quad \forall i \in \mathcal{P},\; t \in \mathcal{T}",
            "explanation": (
                "Ensures ending inventory equals beginning inventory plus production minus demand. "
                + ("Initial inventory I_{i,0} is taken from the mapped column." if has_init_inv else "Initial inventory I_{i,0} = 0.")
            ),
        }
    ]
    if has_capacity:
        proc_sym = r"a_{i,t} x_{i,t}" if has_proc_time else r"x_{i,t}"
        setup_term = r" + s_{i,t} y_{i,t}" if has_setup_time else ""
        if has_resource:
            constraints.append(
                {
                    "name": "Resource Capacity",
                    "latex": rf"\sum_{{i \in \mathcal{{P}}_{{r,t}}}} ({proc_sym}{setup_term}) \le K_{{r,t}} \quad \forall r \in \mathcal{{R}},\; t \in \mathcal{{T}}",
                    "explanation": "Total resource consumption (processing plus setup time if mapped) cannot exceed available resource capacity.",
                }
            )
        else:
            constraints.append(
                {
                    "name": "Production Capacity",
                    "latex": rf"\sum_{{i \in \mathcal{{P}}}} ({proc_sym}{setup_term}) \le K_t \quad \forall t \in \mathcal{{T}}",
                    "explanation": "Total production load in each period cannot exceed available period capacity.",
                }
            )
    if has_setup:
        constraints.append(
            {
                "name": "Setup Linking",
                "latex": r"x_{i,t} \le M_i \, y_{i,t} \quad \forall i \in \mathcal{P},\; t \in \mathcal{T}",
                "explanation": "Forces setup indicator y_{i,t} = 1 whenever production x_{i,t} > 0, where M_i = sum_t d_{i,t}.",
            }
        )

    non_neg = r"x_{i,t} \ge 0,\quad I_{i,t} \ge 0 \quad \forall i \in \mathcal{P},\; t \in \mathcal{T}"
    integrality_parts = []
    if integer_production:
        integrality_parts.append(r"x_{i,t} \in \mathbb{Z}_{\ge 0}")
    if has_setup:
        integrality_parts.append(r"y_{i,t} \in \{0, 1\}")
    integrality = ", ".join(integrality_parts) if integrality_parts else None

    interpretation = []
    if status_str == "Optimal":
        interpretation.append(
            f"The solver reached a proven Optimal solution with objective value Z = {obj_value}."
        )
        if total_prod is not None and total_dem is not None:
            interpretation.append(
                f"Total production across all periods is {total_prod} units to satisfy {total_dem} units of total demand."
            )
        if total_end_inv is not None:
            interpretation.append(
                f"Cumulative ending inventory across all product-periods is {total_end_inv} units."
            )
    else:
        interpretation.append(
            f"Solver status is '{status_str}'. No optimal production plan was found for the current dataset and constraints."
        )

    return MathFormulationSection(
        problem_title="Multi-Period Capacitated Production Planning",
        problem_definition=(
            "Determines optimal production quantities x_{i,t} and ending inventory levels I_{i,t} "
            "across multiple products and time periods to satisfy demand while respecting capacity and balance equations."
        ),
        sets=sets,
        parameters=parameters,
        decision_variables=decision_variables,
        objective_latex=obj_latex,
        objective_explanation=obj_expl,
        constraints=constraints,
        non_negativity_latex=non_neg,
        integrality_latex=integrality,
        numerical_summary={
            "products": len(products),
            "periods": len(periods),
            "resources": len(resources) if has_resource else 0,
            "variables": var_count,
            "constraints": con_count,
            "status": status_str,
            "objective_value": obj_value,
        },
        solution_interpretation=interpretation,
    )

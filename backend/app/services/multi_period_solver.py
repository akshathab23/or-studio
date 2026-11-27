from __future__ import annotations

from dataclasses import dataclass
import re
import time
from typing import Any

import pandas as pd
import pulp

from app.schemas import (
    MathFormulationSection,
    MultiPeriodColumnMapping,
    MultiPeriodSolveRequest,
    MultiPeriodSolveResponse,
)
from app.services.dataset_service import get_dataset, validate_multi_period_mapping


@dataclass(frozen=True)
class PreparedMultiPeriodData:
    products: list[str]
    periods: list[str]
    resources: list[str]
    has_prod_cost: bool
    has_inv_cost: bool
    has_capacity: bool
    has_proc_time: bool
    has_resource: bool
    has_init_inv: bool
    has_setup_cost: bool
    has_setup_time: bool
    has_setup: bool
    base_demand: dict[tuple[str, str], float]
    base_prod_cost: dict[tuple[str, str], float]
    base_inv_cost: dict[tuple[str, str], float]
    proc_time: dict[tuple[str, str], float]
    setup_cost: dict[tuple[str, str], float]
    setup_time: dict[tuple[str, str], float]
    init_inv: dict[str, float]
    base_cap_period: dict[str, float]
    base_cap_prod_period: dict[tuple[str, str], float]
    base_cap_resource_period: dict[tuple[str, str], float]
    prod_period_resource: dict[tuple[str, str], str]
    use_per_product_cap: bool
    repeated_pairs: int
    integer_production: bool
    allow_backlogging: bool
    capacity_scope: str


@dataclass
class BuiltMultiPeriodModel:
    prob: pulp.LpProblem
    x: dict[tuple[str, str], pulp.LpVariable]
    I_var: dict[tuple[str, str], pulp.LpVariable]
    y: dict[tuple[str, str], pulp.LpVariable]
    original_obj_expr: pulp.LpAffineExpression
    original_constraints: dict[str, pulp.LpConstraint]
    capacity_constraints_meta: list[dict[str, Any]]
    capacity_lhs_exprs: list[tuple[dict[str, Any], pulp.LpAffineExpression]]
    demand: dict[tuple[str, str], float]
    prod_cost: dict[tuple[str, str], float]
    inv_cost: dict[tuple[str, str], float]
    uses_cost_objective: bool
    obj_desc: str
    demand_mult: float
    capacity_mult: float
    prod_cost_mult: float
    inv_cost_mult: float


def _sort_periods(values: list[Any]) -> list[str]:
    unique = list(dict.fromkeys(str(v).strip() for v in values))
    if len(unique) <= 1:
        return unique

    # 1. Pure numeric periods (e.g., 1, 2, 10)
    try:
        return [x for x in sorted(unique, key=lambda v: float(v))]
    except ValueError:
        pass

    # 2. ISO dates, YYYY-MM, or date strings
    try:
        parsed_dates = pd.to_datetime(unique, format="mixed", errors="raise")
        paired = sorted(zip(parsed_dates, unique), key=lambda pair: pair[0])
        return [u for _, u in paired]
    except Exception:
        pass

    # 3. Natural alphanumeric periods (e.g., Month 1..10, P1..P12, 2025-W01, 2025-Q1)
    if all(re.search(r"\d", u) for u in unique):
        def _nat_key(s: str) -> list[tuple[int, Any]]:
            parts = re.split(r"(\d+)", s)
            return [(0, int(p)) if p.isdigit() else (1, p.lower()) for p in parts if p]

        return sorted(unique, key=_nat_key)

    return unique


def prepare_multi_period_data(
    dataset_id: str,
    mapping: MultiPeriodColumnMapping,
    *,
    sheet_name: str | None = None,
    integer_production: bool = False,
    allow_backlogging: bool = False,
    capacity_scope: str = "auto",
) -> PreparedMultiPeriodData:
    validation = validate_multi_period_mapping(dataset_id, mapping, sheet_name=sheet_name)
    if not validation.valid:
        err_msgs = "; ".join(i.message for i in validation.issues if i.severity == "error")
        raise ValueError(f"Mapping validation failed: {err_msgs}")

    stored = get_dataset(dataset_id, sheet_name=sheet_name)
    df = stored.df.copy()
    m = mapping

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

    # Build parameter dictionaries from actual rows (track counts for clean aggregation)
    base_demand: dict[tuple[str, str], float] = {(p, t): 0.0 for p in products for t in periods}
    pair_row_counts: dict[tuple[str, str], int] = {}
    prod_cost_acc: dict[tuple[str, str], list[float]] = {}
    inv_cost_acc: dict[tuple[str, str], list[float]] = {}
    proc_time_acc: dict[tuple[str, str], list[float]] = {}
    setup_cost_acc: dict[tuple[str, str], list[float]] = {}
    setup_time_acc: dict[tuple[str, str], list[float]] = {}
    init_inv: dict[str, float] = {p: 0.0 for p in products}
    init_inv_seen: set[str] = set()

    # Capacity structures
    cap_period_acc: dict[str, list[float]] = {}
    cap_prod_period_acc: dict[tuple[str, str], list[float]] = {}
    cap_resource_period_acc: dict[tuple[str, str], list[float]] = {}
    prod_period_resource: dict[tuple[str, str], str] = {}
    resources: list[str] = []

    for _, row in df.iterrows():
        p = str(row[m.product])
        t = str(row[m.period])
        pair_row_counts[(p, t)] = pair_row_counts.get((p, t), 0) + 1
        d_val = float(pd.to_numeric(row[m.demand]))
        base_demand[(p, t)] = base_demand.get((p, t), 0.0) + d_val

        if has_prod_cost and m.production_cost:
            prod_cost_acc.setdefault((p, t), []).append(float(pd.to_numeric(row[m.production_cost])))
        if has_inv_cost and m.inventory_cost:
            inv_cost_acc.setdefault((p, t), []).append(float(pd.to_numeric(row[m.inventory_cost])))
        if has_proc_time and m.processing_time:
            proc_time_acc.setdefault((p, t), []).append(float(pd.to_numeric(row[m.processing_time])))
        if has_setup_cost and m.setup_cost:
            setup_cost_acc.setdefault((p, t), []).append(float(pd.to_numeric(row[m.setup_cost])))
        if has_setup_time and m.setup_time:
            setup_time_acc.setdefault((p, t), []).append(float(pd.to_numeric(row[m.setup_time])))
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
                cap_resource_period_acc.setdefault((r, t), []).append(c_val)
            else:
                cap_period_acc.setdefault(t, []).append(c_val)
                cap_prod_period_acc.setdefault((p, t), []).append(c_val)

    base_prod_cost = {k: sum(v) / len(v) for k, v in prod_cost_acc.items()}
    base_inv_cost = {k: sum(v) / len(v) for k, v in inv_cost_acc.items()}
    proc_time = {k: sum(v) / len(v) for k, v in proc_time_acc.items()}
    setup_cost = {k: sum(v) / len(v) for k, v in setup_cost_acc.items()}
    setup_time = {k: sum(v) / len(v) for k, v in setup_time_acc.items()}
    base_cap_period = {k: sum(v) / len(v) for k, v in cap_period_acc.items()}
    base_cap_prod_period = {k: sum(v) / len(v) for k, v in cap_prod_period_acc.items()}
    base_cap_resource_period = {k: sum(v) / len(v) for k, v in cap_resource_period_acc.items()}
    repeated_pairs = sum(1 for cnt in pair_row_counts.values() if cnt > 1)

    # Determine capacity scope when Resource is not mapped
    cap_varies_within_period = any(len(set(vals)) > 1 for vals in cap_period_acc.values())
    use_per_product_cap = False
    if has_capacity and not (has_resource and resources):
        if capacity_scope == "per_product":
            use_per_product_cap = True
        elif capacity_scope == "aggregate_period":
            use_per_product_cap = False
        else:
            use_per_product_cap = cap_varies_within_period

    return PreparedMultiPeriodData(
        products=products,
        periods=periods,
        resources=resources,
        has_prod_cost=has_prod_cost,
        has_inv_cost=has_inv_cost,
        has_capacity=has_capacity,
        has_proc_time=has_proc_time,
        has_resource=has_resource,
        has_init_inv=has_init_inv,
        has_setup_cost=has_setup_cost,
        has_setup_time=has_setup_time,
        has_setup=has_setup,
        base_demand=base_demand,
        base_prod_cost=base_prod_cost,
        base_inv_cost=base_inv_cost,
        proc_time=proc_time,
        setup_cost=setup_cost,
        setup_time=setup_time,
        init_inv=init_inv,
        base_cap_period=base_cap_period,
        base_cap_prod_period=base_cap_prod_period,
        base_cap_resource_period=base_cap_resource_period,
        prod_period_resource=prod_period_resource,
        use_per_product_cap=use_per_product_cap,
        repeated_pairs=repeated_pairs,
        integer_production=integer_production,
        allow_backlogging=allow_backlogging,
        capacity_scope=capacity_scope,
    )


def build_multi_period_pulp_model(
    prepared: PreparedMultiPeriodData,
    *,
    demand_multiplier: float = 1.0,
    capacity_multiplier: float = 1.0,
    production_cost_multiplier: float = 1.0,
    inventory_cost_multiplier: float = 1.0,
) -> BuiltMultiPeriodModel:
    products = prepared.products
    periods = prepared.periods
    resources = prepared.resources
    has_prod_cost = prepared.has_prod_cost
    has_inv_cost = prepared.has_inv_cost
    has_capacity = prepared.has_capacity
    has_proc_time = prepared.has_proc_time
    has_resource = prepared.has_resource
    has_setup_cost = prepared.has_setup_cost
    has_setup_time = prepared.has_setup_time
    has_setup = prepared.has_setup
    proc_time = prepared.proc_time
    setup_cost = prepared.setup_cost
    setup_time = prepared.setup_time
    init_inv = prepared.init_inv
    prod_period_resource = prepared.prod_period_resource
    use_per_product_cap = prepared.use_per_product_cap

    demand_mult = float(demand_multiplier)
    capacity_mult = float(capacity_multiplier)
    prod_cost_mult = float(production_cost_multiplier)
    inv_cost_mult = float(inventory_cost_multiplier)

    demand = {k: v * demand_mult for k, v in prepared.base_demand.items()}
    prod_cost = {k: v * prod_cost_mult for k, v in prepared.base_prod_cost.items()}
    inv_cost = {k: v * inv_cost_mult for k, v in prepared.base_inv_cost.items()}
    cap_period = {k: v * capacity_mult for k, v in prepared.base_cap_period.items()}
    cap_prod_period = {k: v * capacity_mult for k, v in prepared.base_cap_prod_period.items()}
    cap_resource_period = {k: v * capacity_mult for k, v in prepared.base_cap_resource_period.items()}

    # Construct PuLP model
    prob = pulp.LpProblem("OR_Studio_Multi_Period_Production_Planning", pulp.LpMinimize)

    x_cat = pulp.LpInteger if prepared.integer_production else pulp.LpContinuous
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

    original_obj_expr = pulp.lpSum(obj_terms)
    prob += original_obj_expr, "Total_Objective"

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
    capacity_lhs_exprs: list[tuple[dict[str, Any], pulp.LpAffineExpression]] = []
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
                        lhs_expr = pulp.lpSum(lhs_terms)
                        prob += lhs_expr <= cap_val, f"Cap_{r}_{t}"
                        meta = {"resource": r, "period": t, "capacity": cap_val, "scope": "resource"}
                        capacity_constraints_meta.append(meta)
                        capacity_lhs_exprs.append((meta, lhs_expr))
        elif use_per_product_cap:
            for p in products:
                for t in periods:
                    if (p, t) not in cap_prod_period:
                        continue
                    pt = proc_time.get((p, t), 1.0) if has_proc_time else 1.0
                    lhs_terms = [pt * x[(p, t)]]
                    if has_setup_time and (p, t) in setup_time and (p, t) in y:
                        lhs_terms.append(setup_time[(p, t)] * y[(p, t)])
                    cap_val = cap_prod_period[(p, t)]
                    lhs_expr = pulp.lpSum(lhs_terms)
                    prob += lhs_expr <= cap_val, f"Cap_{p}_{t}"
                    meta = {"resource": p, "period": t, "capacity": cap_val, "scope": "per_product"}
                    capacity_constraints_meta.append(meta)
                    capacity_lhs_exprs.append((meta, lhs_expr))
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
                lhs_expr = pulp.lpSum(lhs_terms)
                prob += lhs_expr <= cap_val, f"Cap_{t}"
                meta = {"resource": "Aggregate", "period": t, "capacity": cap_val, "scope": "aggregate"}
                capacity_constraints_meta.append(meta)
                capacity_lhs_exprs.append((meta, lhs_expr))

    # Constraints: 3. Setup linking (exact remaining demand upper bound)
    if has_setup:
        for p in products:
            total_rem = sum(demand[(p, t)] for t in periods)
            big_m = max(total_rem, 1.0)
            for t in periods:
                prob += x[(p, t)] <= big_m * y[(p, t)], f"SetupLink_{p}_{t}"

    return BuiltMultiPeriodModel(
        prob=prob,
        x=x,
        I_var=I_var,
        y=y,
        original_obj_expr=original_obj_expr,
        original_constraints=dict(prob.constraints),
        capacity_constraints_meta=capacity_constraints_meta,
        capacity_lhs_exprs=capacity_lhs_exprs,
        demand=demand,
        prod_cost=prod_cost,
        inv_cost=inv_cost,
        uses_cost_objective=uses_cost_objective,
        obj_desc=obj_desc,
        demand_mult=demand_mult,
        capacity_mult=capacity_mult,
        prod_cost_mult=prod_cost_mult,
        inv_cost_mult=inv_cost_mult,
    )


def extract_multi_period_response(
    prepared: PreparedMultiPeriodData,
    built: BuiltMultiPeriodModel,
    *,
    solve_time: float,
) -> MultiPeriodSolveResponse:
    products = prepared.products
    periods = prepared.periods
    resources = prepared.resources
    has_prod_cost = prepared.has_prod_cost
    has_inv_cost = prepared.has_inv_cost
    has_capacity = prepared.has_capacity
    has_proc_time = prepared.has_proc_time
    has_resource = prepared.has_resource
    has_init_inv = prepared.has_init_inv
    has_setup_cost = prepared.has_setup_cost
    has_setup_time = prepared.has_setup_time
    proc_time = prepared.proc_time
    setup_cost = prepared.setup_cost
    setup_time = prepared.setup_time
    init_inv = prepared.init_inv
    prod_period_resource = prepared.prod_period_resource
    use_per_product_cap = prepared.use_per_product_cap
    repeated_pairs = prepared.repeated_pairs

    prob = built.prob
    x = built.x
    I_var = built.I_var
    y = built.y
    demand = built.demand
    prod_cost = built.prod_cost
    inv_cost = built.inv_cost
    uses_cost_objective = built.uses_cost_objective
    obj_desc = built.obj_desc
    capacity_constraints_meta = built.capacity_constraints_meta

    status_str = pulp.LpStatus.get(prob.status, "Unknown")
    is_optimal = status_str == "Optimal"

    var_count = len(prob.variables())
    con_count = len(built.original_constraints)

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
        raw_obj = pulp.value(built.original_obj_expr)
        obj_value = round(float(raw_obj), 6) if raw_obj is not None else 0.0

        # Compute max constraint violation over the original model constraints
        max_v = 0.0
        for cname, con in built.original_constraints.items():
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
            p_prod_cost = 0.0
            p_inv_cost = 0.0
            p_setup_cost = 0.0
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
                p_prod_cost += pc
                p_inv_cost += ic
                p_setup_cost += sc

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
            period_entry: dict[str, Any] = {
                "period": t,
                "total_production": round(p_sum, 6),
                "total_demand": round(d_sum, 6),
                "total_ending_inventory": round(i_sum, 6),
            }
            if uses_cost_objective:
                period_entry["production_cost"] = round(p_prod_cost, 4)
                period_entry["inventory_cost"] = round(p_inv_cost, 4)
                period_entry["setup_cost"] = round(p_setup_cost, 4)
                period_entry["total_cost"] = round(p_prod_cost + p_inv_cost + p_setup_cost, 4)
            period_summary.append(period_entry)

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
            scope = meta.get("scope", "aggregate")
            used = 0.0
            for p in products:
                if scope == "per_product" and p != r:
                    continue
                if scope == "resource" and prod_period_resource.get((p, t)) != r:
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
        use_per_product_cap=use_per_product_cap,
        has_init_inv=has_init_inv,
        has_setup_cost=has_setup_cost,
        has_setup_time=has_setup_time,
        integer_production=prepared.integer_production,
        status_str=status_str,
        obj_value=obj_value,
        total_prod=total_prod,
        total_dem=total_dem,
        total_end_inv=total_end_inv,
        var_count=var_count,
        con_count=con_count,
        uses_cost_objective=uses_cost_objective,
    )

    agg_note = (
        f" Aggregated {repeated_pairs} repeated (Product, Period) pair(s) by summing demand "
        "and averaging unit parameters."
        if repeated_pairs > 0
        else ""
    )

    if is_optimal:
        msg = f"Optimal solution found in {solve_time}s with objective value {obj_value}.{agg_note}"
    elif status_str == "Infeasible":
        msg = (
            "The model is INFEASIBLE. No production plan satisfies all demand and capacity "
            f"constraints simultaneously.{agg_note}"
        )
    elif status_str == "Unbounded":
        msg = f"The model is UNBOUNDED. Check cost signs and constraints.{agg_note}"
    else:
        msg = f"Solver terminated with non-optimal status: {status_str}.{agg_note}"

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
        integer_production=prepared.integer_production,
        allow_backlogging=prepared.allow_backlogging,
        capacity_scope=prepared.capacity_scope,
        demand_multiplier=built.demand_mult,
        capacity_multiplier=built.capacity_mult,
        production_cost_multiplier=built.prod_cost_mult,
    )


def solve_prepared_multi_period(
    prepared: PreparedMultiPeriodData,
    *,
    demand_multiplier: float = 1.0,
    capacity_multiplier: float = 1.0,
    production_cost_multiplier: float = 1.0,
    inventory_cost_multiplier: float = 1.0,
    time_limit_seconds: float | None = None,
) -> MultiPeriodSolveResponse:
    t0 = time.perf_counter()
    built = build_multi_period_pulp_model(
        prepared,
        demand_multiplier=demand_multiplier,
        capacity_multiplier=capacity_multiplier,
        production_cost_multiplier=production_cost_multiplier,
        inventory_cost_multiplier=inventory_cost_multiplier,
    )
    solver_kwargs: dict[str, Any] = {"msg": False}
    if time_limit_seconds is not None:
        solver_kwargs["timeLimit"] = float(time_limit_seconds)
    solver = pulp.PULP_CBC_CMD(**solver_kwargs)
    built.prob.solve(solver)
    solve_time = round(time.perf_counter() - t0, 4)
    return extract_multi_period_response(prepared, built, solve_time=solve_time)


def solve_multi_period(req: MultiPeriodSolveRequest) -> MultiPeriodSolveResponse:
    prepared = prepare_multi_period_data(
        req.dataset_id,
        req.mapping,
        sheet_name=req.sheet_name,
        integer_production=req.integer_production,
        allow_backlogging=req.allow_backlogging,
        capacity_scope=req.capacity_scope,
    )
    return solve_prepared_multi_period(
        prepared,
        demand_multiplier=req.demand_multiplier,
        capacity_multiplier=req.capacity_multiplier,
        production_cost_multiplier=req.production_cost_multiplier,
        inventory_cost_multiplier=1.0,
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
    use_per_product_cap: bool,
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
        elif use_per_product_cap:
            parameters.append({"symbol": r"K_{i,t}", "description": "Available production capacity for product i in period t"})
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
        elif use_per_product_cap:
            constraints.append(
                {
                    "name": "Per-Product Production Capacity",
                    "latex": rf"{proc_sym}{setup_term} \le K_{{i,t}} \quad \forall i \in \mathcal{{P}},\; t \in \mathcal{{T}}",
                    "explanation": "Production load for each product i in period t cannot exceed its mapped product-period capacity.",
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

from __future__ import annotations

import math

from app.schemas import (
    MCDMResultRow,
    MCDMSolveRequest,
    MCDMSolveResponse,
    MathFormulationSection,
)


def solve_mcdm(req: MCDMSolveRequest) -> MCDMSolveResponse:
    if not req.criteria:
        raise ValueError("At least one criterion is required.")
    if len(req.alternatives) < 2:
        raise ValueError("At least two alternatives are required for MCDM ranking.")

    crit_names = [c.name for c in req.criteria]
    if len(set(crit_names)) != len(crit_names):
        raise ValueError("Criteria names must be unique.")

    alt_names = [a.name for a in req.alternatives]
    if len(set(alt_names)) != len(alt_names):
        raise ValueError("Alternative names must be unique.")

    total_w = sum(c.weight for c in req.criteria)
    norm_weights = {c.name: round(c.weight / total_w, 6) for c in req.criteria}

    # Verify all scores exist
    for alt in req.alternatives:
        for c in req.criteria:
            if c.name not in alt.scores:
                raise ValueError(f"Alternative '{alt.name}' is missing score for '{c.name}'.")

    if req.method == "topsis":
        # Vector normalization
        norm_matrix: dict[str, dict[str, float]] = {a.name: {} for a in req.alternatives}
        weighted_matrix: dict[str, dict[str, float]] = {a.name: {} for a in req.alternatives}
        for c in req.criteria:
            denom = math.sqrt(sum((a.scores[c.name] ** 2) for a in req.alternatives))
            for a in req.alternatives:
                r_ij = (a.scores[c.name] / denom) if denom > 0 else 0.0
                norm_matrix[a.name][c.name] = round(r_ij, 6)
                weighted_matrix[a.name][c.name] = r_ij * norm_weights[c.name]

        ideal: dict[str, float] = {}
        anti_ideal: dict[str, float] = {}
        for c in req.criteria:
            vals = [weighted_matrix[a.name][c.name] for a in req.alternatives]
            if c.direction == "benefit":
                ideal[c.name] = max(vals)
                anti_ideal[c.name] = min(vals)
            else:
                ideal[c.name] = min(vals)
                anti_ideal[c.name] = max(vals)

        rows: list[MCDMResultRow] = []
        for a in req.alternatives:
            d_plus = math.sqrt(
                sum((weighted_matrix[a.name][c.name] - ideal[c.name]) ** 2 for c in req.criteria)
            )
            d_minus = math.sqrt(
                sum((weighted_matrix[a.name][c.name] - anti_ideal[c.name]) ** 2 for c in req.criteria)
            )
            closeness = d_minus / (d_plus + d_minus) if (d_plus + d_minus) > 0 else 0.0
            rows.append(
                MCDMResultRow(
                    rank=0,
                    alternative=a.name,
                    score=round(closeness, 6),
                    distance_ideal=round(d_plus, 6),
                    distance_anti_ideal=round(d_minus, 6),
                    normalized_scores=norm_matrix[a.name],
                )
            )
    else:
        # Weighted Sum Model (min-max normalized)
        norm_matrix = {a.name: {} for a in req.alternatives}
        rows = []
        for c in req.criteria:
            vals = [a.scores[c.name] for a in req.alternatives]
            c_min, c_max = min(vals), max(vals)
            span = c_max - c_min
            for a in req.alternatives:
                if span == 0:
                    n_val = 1.0
                elif c.direction == "benefit":
                    n_val = (a.scores[c.name] - c_min) / span
                else:
                    n_val = (c_max - a.scores[c.name]) / span
                norm_matrix[a.name][c.name] = round(n_val, 6)

        for a in req.alternatives:
            score = sum(norm_matrix[a.name][c.name] * norm_weights[c.name] for c in req.criteria)
            rows.append(
                MCDMResultRow(
                    rank=0,
                    alternative=a.name,
                    score=round(score, 6),
                    normalized_scores=norm_matrix[a.name],
                )
            )

    rows.sort(key=lambda r: r.score, reverse=True)
    for idx, r in enumerate(rows, start=1):
        r.rank = idx

    best = rows[0]
    formulation = MathFormulationSection(
        problem_title=f"Multi-Criteria Decision Making ({'TOPSIS' if req.method == 'topsis' else 'Weighted Sum Model'})",
        problem_definition=(
            "Evaluates and ranks discrete alternatives across multiple weighted benefit and cost criteria."
        ),
        sets=[
            {"symbol": r"\mathcal{A}", "description": f"Set of alternatives (|A| = {len(req.alternatives)})"},
            {"symbol": r"\mathcal{C}", "description": f"Set of criteria (|C| = {len(req.criteria)})"},
        ],
        parameters=[
            {"symbol": r"x_{i,j}", "description": "Performance score of alternative i on criterion j"},
            {"symbol": r"w_j", "description": "Normalized weight of criterion j (sum w_j = 1)"},
        ],
        decision_variables=[
            {"symbol": r"S_i", "description": "Composite preference score / closeness coefficient of alternative i"}
        ],
        objective_latex=(
            r"C_i = \frac{D_i^-}{D_i^+ + D_i^-}, \quad D_i^+ = \sqrt{\sum_j (v_{ij} - v_j^+)^2}, \quad D_i^- = \sqrt{\sum_j (v_{ij} - v_j^-)^2}"
            if req.method == "topsis"
            else r"S_i = \sum_{j \in \mathcal{C}} w_j \, \tilde{x}_{i,j}"
        ),
        objective_explanation=(
            "Ranks alternatives by relative closeness to the positive ideal solution."
            if req.method == "topsis"
            else "Ranks alternatives by weighted sum of normalized benefit/cost scores."
        ),
        constraints=[
            {
                "name": "Weight Normalization",
                "latex": r"\sum_{j \in \mathcal{C}} w_j = 1, \quad w_j > 0",
                "explanation": "Criterion weights are normalized to sum to 1.",
            }
        ],
        non_negativity_latex=r"S_i \in [0, 1] \quad \forall i \in \mathcal{A}",
        integrality_latex=None,
        numerical_summary={
            "method": req.method.upper(),
            "alternatives": len(req.alternatives),
            "criteria": len(req.criteria),
            "top_ranked": best.alternative,
            "top_score": best.score,
        },
        solution_interpretation=[
            f"Top-ranked alternative is '{best.alternative}' with score {best.score}."
        ],
    )

    return MCDMSolveResponse(
        method=req.method,
        status="Optimal",
        normalized_weights=norm_weights,
        rankings=rows,
        formulation=formulation,
        message=f"Ranked {len(rows)} alternatives using {req.method.upper()}. Top choice: {best.alternative}.",
    )

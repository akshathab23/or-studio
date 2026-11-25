from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


class ColumnProfile(BaseModel):
    name: str
    dtype: str
    inferred_type: Literal["integer", "float", "numeric", "categorical", "datetime", "boolean", "empty"]
    non_null_count: int
    missing_count: int
    missing_percentage: float
    unique_count: int
    stats: dict[str, float | None] | None = None


class DatasetSummary(BaseModel):
    dataset_id: str
    filename: str
    file_type: Literal["csv", "xlsx"]
    sheets: list[str]
    active_sheet: str | None
    row_count: int
    column_count: int
    columns: list[ColumnProfile]
    preview_rows: list[dict[str, Any]]
    preview_limit: int


class SheetSelectRequest(BaseModel):
    sheet_name: str


class MultiPeriodColumnMapping(BaseModel):
    product: str = Field(..., min_length=1)
    period: str = Field(..., min_length=1)
    demand: str = Field(..., min_length=1)
    production_cost: str | None = None
    inventory_cost: str | None = None
    capacity: str | None = None
    processing_time: str | None = None
    resource: str | None = None
    initial_inventory: str | None = None
    setup_cost: str | None = None
    setup_time: str | None = None


class MappingValidationIssue(BaseModel):
    field: str
    column: str
    severity: Literal["error", "warning"]
    message: str


class MappingValidationResponse(BaseModel):
    valid: bool
    compatible: bool
    issues: list[MappingValidationIssue]
    detected_summary: dict[str, Any]


class MultiPeriodSolveRequest(BaseModel):
    dataset_id: str
    mapping: MultiPeriodColumnMapping
    integer_production: bool = False
    allow_backlogging: bool = False
    capacity_scope: Literal["auto", "per_product", "aggregate_period"] = "auto"


class MathFormulationSection(BaseModel):
    problem_title: str
    problem_definition: str
    sets: list[dict[str, str]]
    parameters: list[dict[str, str]]
    decision_variables: list[dict[str, str]]
    objective_latex: str
    objective_explanation: str
    constraints: list[dict[str, str]]
    non_negativity_latex: str
    integrality_latex: str | None = None
    numerical_summary: dict[str, Any]
    solution_interpretation: list[str]


class MultiPeriodSolveResponse(BaseModel):
    solver_name: str
    status: str
    is_optimal: bool
    solve_time_seconds: float
    objective_value: float | None
    objective_sense: str
    objective_description: str
    variable_count: int
    constraint_count: int
    max_constraint_violation: float | None
    constraints_feasible: bool
    total_production: float | None
    total_demand: float | None
    total_ending_inventory: float | None
    cost_breakdown: dict[str, float] | None
    production_schedule: list[dict[str, Any]]
    period_summary: list[dict[str, Any]]
    resource_utilization: list[dict[str, Any]]
    formulation: MathFormulationSection
    message: str


class GPVariable(BaseModel):
    name: str = Field(..., min_length=1)
    lower_bound: float = 0.0
    upper_bound: float | None = None
    var_type: Literal["continuous", "integer"] = "continuous"


class GPHardConstraint(BaseModel):
    name: str = Field(..., min_length=1)
    coefficients: dict[str, float]
    operator: Literal["<=", ">=", "="]
    rhs: float


class GPGoal(BaseModel):
    name: str = Field(..., min_length=1)
    coefficients: dict[str, float]
    goal_type: Literal["minimum", "maximum", "exact"]
    target: float
    priority: int = Field(1, ge=1)
    weight: float = Field(1.0, gt=0.0)


class GoalProgrammingSolveRequest(BaseModel):
    method: Literal["weighted", "preemptive"]
    variables: list[GPVariable]
    hard_constraints: list[GPHardConstraint] = []
    goals: list[GPGoal]


class GPGoalResult(BaseModel):
    name: str
    goal_type: str
    target: float
    achieved: float | None
    positive_deviation: float | None
    negative_deviation: float | None
    priority: int
    weight: float
    penalty_contribution: float | None
    status: str


class GoalProgrammingSolveResponse(BaseModel):
    solver_name: str
    method: Literal["weighted", "preemptive"]
    status: str
    is_optimal: bool
    solve_time_seconds: float
    total_weighted_penalty: float | None
    priority_levels_solved: list[dict[str, Any]]
    variable_values: dict[str, float]
    goal_results: list[GPGoalResult]
    formulation: MathFormulationSection
    message: str


class MCDMCriterion(BaseModel):
    name: str = Field(..., min_length=1)
    weight: float = Field(..., gt=0.0)
    direction: Literal["benefit", "cost"]


class MCDMAlternative(BaseModel):
    name: str = Field(..., min_length=1)
    scores: dict[str, float]


class MCDMSolveRequest(BaseModel):
    method: Literal["topsis", "wsm"] = "topsis"
    criteria: list[MCDMCriterion]
    alternatives: list[MCDMAlternative]


class MCDMResultRow(BaseModel):
    rank: int
    alternative: str
    score: float
    distance_ideal: float | None = None
    distance_anti_ideal: float | None = None
    normalized_scores: dict[str, float]


class MCDMSolveResponse(BaseModel):
    method: str
    status: str
    normalized_weights: dict[str, float]
    rankings: list[MCDMResultRow]
    formulation: MathFormulationSection
    message: str

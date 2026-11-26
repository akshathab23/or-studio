from __future__ import annotations

import math
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator


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
    demand_multiplier: float = Field(default=1.0, gt=0.0, le=10.0)
    capacity_multiplier: float = Field(default=1.0, gt=0.0, le=10.0)
    production_cost_multiplier: float = Field(default=1.0, gt=0.0, le=10.0)

    @field_validator(
        "demand_multiplier",
        "capacity_multiplier",
        "production_cost_multiplier",
    )
    @classmethod
    def _validate_finite_multiplier(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("Scenario multipliers must be finite numbers.")
        return v


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
    integer_production: bool = False
    allow_backlogging: bool = False
    capacity_scope: str = "auto"
    demand_multiplier: float = 1.0
    capacity_multiplier: float = 1.0
    production_cost_multiplier: float = 1.0


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


class PublicDatasetCatalogItem(BaseModel):
    id: str
    name: str
    source: str
    source_url: str
    description: str
    approximate_size: str
    data_period: str
    license: str
    citation: str
    disclaimer: str


class PublicDatasetImportRequest(BaseModel):
    source_id: Literal["uci_online_retail"] = "uci_online_retail"
    aggregation_period: Literal["monthly", "weekly", "quarterly"] = "monthly"
    max_products: int = Field(10, ge=1, le=50)
    max_periods: int = Field(12, ge=1, le=24)
    capacity_buffer_pct: float = Field(20.0, ge=0.0, le=500.0)
    include_production_cost: bool = True
    production_cost_ratio: float = Field(0.6, ge=0.0, le=10.0)
    include_inventory_cost: bool = True
    inventory_cost_ratio: float = Field(0.05, ge=0.0, le=10.0)
    include_initial_inventory: bool = False
    initial_inventory_units: float = Field(0.0, ge=0.0)


class PreprocessingReport(BaseModel):
    raw_row_count: int
    cancelled_invoices_removed: int
    non_positive_quantity_removed: int
    invalid_price_removed: int
    missing_stockcode_removed: int
    invalid_date_removed: int
    clean_row_count: int
    aggregation_period: str
    products_selected: int
    periods_created: int
    prepared_row_count: int
    date_range_start: str | None
    date_range_end: str | None
    cached_source_used: bool


class ParameterAssumptionItem(BaseModel):
    field: str
    column_name: str
    origin: Literal["source_derived", "model_assumption"]
    methodology: str
    summary: str


class PublicDatasetImportResponse(BaseModel):
    dataset: DatasetSummary
    catalog_entry: PublicDatasetCatalogItem
    preprocessing_report: PreprocessingReport
    assumptions: list[ParameterAssumptionItem]
    suggested_mapping: MultiPeriodColumnMapping
    suggested_capacity_scope: Literal["auto", "per_product", "aggregate_period"] = "per_product"


class ScenarioInputConfig(BaseModel):
    mapping: MultiPeriodColumnMapping
    integer_production: bool = False
    allow_backlogging: bool = False
    capacity_scope: Literal["auto", "per_product", "aggregate_period"] = "auto"
    demand_multiplier: float = Field(default=1.0, gt=0.0, le=10.0)
    capacity_multiplier: float = Field(default=1.0, gt=0.0, le=10.0)
    production_cost_multiplier: float = Field(default=1.0, gt=0.0, le=10.0)
    objective_sense: str = "Minimize"

    @field_validator(
        "demand_multiplier",
        "capacity_multiplier",
        "production_cost_multiplier",
    )
    @classmethod
    def _validate_finite_multiplier(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("Scenario multipliers must be finite numbers.")
        return v


class ScenarioCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    module: Literal["multi-period"] = "multi-period"
    dataset_id: str | None = None
    dataset_name: str | None = None
    active_sheet: str | None = None
    input_config: ScenarioInputConfig
    result_snapshot: MultiPeriodSolveResponse | None = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Scenario name cannot be empty.")
        return trimmed


class ScenarioUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    input_config: ScenarioInputConfig | None = None
    result_snapshot: MultiPeriodSolveResponse | None = None

    @field_validator("name")
    @classmethod
    def _validate_optional_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Scenario name cannot be empty.")
        return trimmed


class SavedScenarioSummary(BaseModel):
    id: str
    name: str
    description: str
    created_at: str
    updated_at: str
    module: Literal["multi-period"]
    dataset_id: str | None
    dataset_name: str | None
    active_sheet: str | None
    objective_sense: str
    status: str
    is_optimal: bool
    constraints_feasible: bool
    objective_value: float | None
    has_result_snapshot: bool
    input_config: ScenarioInputConfig


class SavedScenarioDetail(SavedScenarioSummary):
    result_snapshot: MultiPeriodSolveResponse | None = None

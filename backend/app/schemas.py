from __future__ import annotations

import math
from typing import Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator


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


class DatasetListItem(BaseModel):
    dataset_id: str
    filename: str
    file_type: Literal["csv", "xlsx"]
    sheets: list[str]
    active_sheet: str | None
    size_bytes: int
    created_at: str
    last_accessed_at: str


class DatasetCleanupReport(BaseModel):
    dry_run: bool
    cleanup_enabled: bool
    ttl_hours: float
    max_storage_mb: float
    min_dataset_age_minutes: float
    temp_file_grace_minutes: float
    ordering_policy: str
    datasets_scanned: int
    eligible_datasets: list[str]
    datasets_deleted: list[str]
    bytes_freed: int
    referenced_datasets_skipped: list[str]
    recent_datasets_skipped: list[str]
    other_datasets_skipped: list[str]
    temp_files_scanned: int
    temp_files_removed: list[str]
    orphan_files_scanned: int
    orphan_files_removed: list[str]
    missing_file_findings: list[str]
    missing_metadata_findings: list[str]
    failed_operations: list[str]
    warnings: list[str]
    quota_target_achieved: bool
    total_storage_bytes_before: int
    total_storage_bytes_after: int


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
    sheet_name: str | None = None
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


class ScenarioReattachRequest(BaseModel):
    dataset_id: str = Field(..., min_length=1)
    active_sheet: str | None = None
    invalidate_snapshot: bool

    @field_validator("invalidate_snapshot")
    @classmethod
    def _require_invalidate_snapshot(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError(
                "invalidate_snapshot must be explicitly true when re-attaching a scenario to a replacement dataset."
            )
        return v


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


SensitivityParameter = Literal["demand", "capacity", "production_cost", "inventory_cost"]
SensitivitySolveCategory = Literal[
    "optimal", "infeasible", "unbounded", "timeout", "solver_error", "unknown"
]


class SensitivitySweepRequest(BaseModel):
    dataset_id: str = Field(..., min_length=1)
    mapping: MultiPeriodColumnMapping
    integer_production: bool = False
    allow_backlogging: bool = False
    capacity_scope: Literal["auto", "per_product", "aggregate_period"] = "auto"
    parameter: SensitivityParameter
    min_multiplier: float = Field(default=0.7, gt=0.0, le=10.0)
    max_multiplier: float = Field(default=1.3, gt=0.0, le=10.0)
    num_points: int = Field(default=9, ge=3, le=25)

    @field_validator("min_multiplier", "max_multiplier")
    @classmethod
    def _validate_finite_bound(cls, v: float) -> float:
        if not math.isfinite(v):
            raise ValueError("Sensitivity multiplier bounds must be finite numbers.")
        return v

    @model_validator(mode="after")
    def _validate_bounds_order(self) -> SensitivitySweepRequest:
        if self.min_multiplier >= self.max_multiplier:
            raise ValueError("min_multiplier must be strictly less than max_multiplier.")
        return self


class SensitivityPointResult(BaseModel):
    multiplier: float
    parameter: SensitivityParameter
    is_baseline: bool = False
    in_requested_grid: bool = True
    solver_status: str
    status_category: SensitivitySolveCategory
    is_optimal: bool
    constraints_feasible: bool
    is_feasible_optimal: bool
    objective_value: float | None = None
    objective_diff: float | None = None
    objective_pct_change: float | None = None
    plan_shift_pct: float | None = None
    setup_changes: int | None = None
    peak_utilization_pct: float | None = None
    total_production: float | None = None
    total_demand: float | None = None
    total_ending_inventory: float | None = None
    max_constraint_violation: float | None = None
    runtime_seconds: float
    production_decisions: list[dict[str, Any]] = []
    error_message: str | None = None


class SensitivityTransition(BaseModel):
    from_multiplier: float
    to_multiplier: float
    from_status: str
    to_status: str
    description: str


class SensitivityGridConfig(BaseModel):
    min_multiplier: float
    max_multiplier: float
    requested_points: int
    grid_multipliers: list[float]
    baseline_included_in_grid: bool
    total_solver_runs: int
    per_solve_time_limit_seconds: float
    total_budget_seconds: float
    budget_exhausted: bool = False


class SensitivitySummary(BaseModel):
    total_grid_points: int
    feasible_optimal_count: int
    infeasible_count: int
    incomplete_or_error_count: int
    feasibility_rate_pct: float
    objective_sense: str
    baseline_objective: float | None = None
    best_feasible_objective: float | None = None
    worst_case_feasible_objective: float | None = None
    objective_range: float | None = None
    max_plan_shift_pct: float | None = None
    first_infeasible_multiplier: float | None = None
    observed_transitions: list[SensitivityTransition] = []
    total_runtime_seconds: float
    empirical_disclosure: str


class SensitivitySweepResponse(BaseModel):
    parameter: SensitivityParameter
    dataset_id: str
    is_milp: bool
    baseline: SensitivityPointResult
    grid_config: SensitivityGridConfig
    points: list[SensitivityPointResult]
    summary: SensitivitySummary


TradeoffCriterion = Literal[
    "peak_utilization",
    "cumulative_inventory",
    "production_smoothing",
]
TradeoffToleranceMode = Literal["relative_pct", "absolute"]


class TradeoffExploreRequest(BaseModel):
    dataset_id: str = Field(..., min_length=1)
    mapping: MultiPeriodColumnMapping
    integer_production: bool = False
    allow_backlogging: bool = False
    capacity_scope: Literal["auto", "per_product", "aggregate_period"] = "auto"
    criterion: TradeoffCriterion
    max_relative_tolerance_pct: float | None = Field(default=10.0, gt=0.0, le=50.0)
    absolute_tolerance: float | None = Field(default=None, gt=0.0, le=1e6)
    num_points: int = Field(default=6, ge=2, le=12)

    @field_validator("max_relative_tolerance_pct", "absolute_tolerance")
    @classmethod
    def _validate_finite_tolerance(cls, v: float | None) -> float | None:
        if v is not None and not math.isfinite(v):
            raise ValueError("Trade-off tolerance must be a finite number.")
        return v


class TradeoffCandidateResult(BaseModel):
    candidate_id: str
    index: int
    is_baseline: bool = False
    tolerance_value: float
    objective_budget: float
    solver_status: str
    status_category: SensitivitySolveCategory
    is_optimal: bool
    original_constraints_feasible: bool
    objective_budget_satisfied: bool
    is_verified_feasible: bool
    objective_value: float | None = None
    objective_diff: float | None = None
    objective_pct_change: float | None = None
    criterion_value: float | None = None
    criterion_diff: float | None = None
    plan_shift_pct: float | None = None
    peak_utilization_pct: float | None = None
    total_production: float | None = None
    total_demand: float | None = None
    total_ending_inventory: float | None = None
    cost_breakdown: dict[str, float] | None = None
    max_constraint_violation: float | None = None
    runtime_seconds: float
    is_duplicate: bool = False
    duplicate_of_candidate_id: str | None = None
    production_schedule: list[dict[str, Any]] = []
    resource_utilization: list[dict[str, Any]] = []
    error_message: str | None = None


class TradeoffSummary(BaseModel):
    criterion: TradeoffCriterion
    criterion_label: str
    criterion_unit: str
    tolerance_mode: TradeoffToleranceMode
    objective_sense: str
    baseline_objective: float
    baseline_criterion_value: float
    total_requested_points: int
    verified_feasible_count: int
    distinct_feasible_count: int
    duplicate_count: int
    incomplete_or_error_count: int
    best_criterion_value: float | None = None
    criterion_improvement: float | None = None
    budget_exhausted: bool = False
    total_runtime_seconds: float
    per_solve_time_limit_seconds: float
    total_budget_seconds: float
    disclosure: str


class TradeoffExploreResponse(BaseModel):
    dataset_id: str
    criterion: TradeoffCriterion
    is_milp: bool
    baseline: TradeoffCandidateResult
    candidates: list[TradeoffCandidateResult]
    summary: TradeoffSummary

export type InferredType =
  | 'integer'
  | 'float'
  | 'numeric'
  | 'categorical'
  | 'datetime'
  | 'boolean'
  | 'empty';

export interface ColumnProfile {
  name: string;
  dtype: string;
  inferred_type: InferredType;
  non_null_count: number;
  missing_count: number;
  missing_percentage: number;
  unique_count: number;
  stats: {
    min: number | null;
    max: number | null;
    mean: number | null;
    std: number | null;
    median: number | null;
  } | null;
}

export interface DatasetSummary {
  dataset_id: string;
  filename: string;
  file_type: 'csv' | 'xlsx';
  sheets: string[];
  active_sheet: string | null;
  row_count: number;
  column_count: number;
  columns: ColumnProfile[];
  preview_rows: Record<string, unknown>[];
  preview_limit: number;
}

export interface MultiPeriodColumnMapping {
  product: string;
  period: string;
  demand: string;
  production_cost?: string | null;
  inventory_cost?: string | null;
  capacity?: string | null;
  processing_time?: string | null;
  resource?: string | null;
  initial_inventory?: string | null;
  setup_cost?: string | null;
  setup_time?: string | null;
}

export interface MappingValidationIssue {
  field: string;
  column: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface MappingValidationResponse {
  valid: boolean;
  compatible: boolean;
  issues: MappingValidationIssue[];
  detected_summary: Record<string, unknown>;
}

export interface MathFormulationSection {
  problem_title: string;
  problem_definition: string;
  sets: { symbol: string; description: string }[];
  parameters: { symbol: string; description: string }[];
  decision_variables: { symbol: string; description: string }[];
  objective_latex: string;
  objective_explanation: string;
  constraints: { name: string; latex: string; explanation: string }[];
  non_negativity_latex: string;
  integrality_latex: string | null;
  numerical_summary: Record<string, unknown>;
  solution_interpretation: string[];
}

export interface MultiPeriodSolveResponse {
  solver_name: string;
  status: string;
  is_optimal: boolean;
  solve_time_seconds: number;
  objective_value: number | null;
  objective_sense: string;
  objective_description: string;
  variable_count: number;
  constraint_count: number;
  max_constraint_violation: number | null;
  constraints_feasible: boolean;
  total_production: number | null;
  total_demand: number | null;
  total_ending_inventory: number | null;
  cost_breakdown: Record<string, number> | null;
  production_schedule: Record<string, unknown>[];
  period_summary: {
    period: string;
    total_production: number;
    total_demand: number;
    total_ending_inventory: number;
  }[];
  resource_utilization: {
    resource: string;
    period: string;
    used: number;
    capacity: number;
    utilization_pct: number;
  }[];
  formulation: MathFormulationSection;
  message: string;
  integer_production?: boolean;
  allow_backlogging?: boolean;
  capacity_scope?: string;
  demand_multiplier?: number;
  capacity_multiplier?: number;
  production_cost_multiplier?: number;
}

export interface GPVariable {
  name: string;
  lower_bound: number;
  upper_bound?: number | null;
  var_type: 'continuous' | 'integer';
}

export interface GPHardConstraint {
  name: string;
  coefficients: Record<string, number>;
  operator: '<=' | '>=' | '=';
  rhs: number;
}

export interface GPGoal {
  name: string;
  coefficients: Record<string, number>;
  goal_type: 'minimum' | 'maximum' | 'exact';
  target: number;
  priority: number;
  weight: number;
}

export interface GoalProgrammingSolveRequest {
  method: 'weighted' | 'preemptive';
  variables: GPVariable[];
  hard_constraints: GPHardConstraint[];
  goals: GPGoal[];
}

export interface GPGoalResult {
  name: string;
  goal_type: string;
  target: number;
  achieved: number | null;
  positive_deviation: number | null;
  negative_deviation: number | null;
  priority: number;
  weight: number;
  penalty_contribution: number | null;
  status: string;
}

export interface GoalProgrammingSolveResponse {
  solver_name: string;
  method: 'weighted' | 'preemptive';
  status: string;
  is_optimal: boolean;
  solve_time_seconds: number;
  total_weighted_penalty: number | null;
  priority_levels_solved: { priority: string | number; status: string; objective: number | null }[];
  variable_values: Record<string, number>;
  goal_results: GPGoalResult[];
  formulation: MathFormulationSection;
  message: string;
}

export interface MCDMCriterion {
  name: string;
  weight: number;
  direction: 'benefit' | 'cost';
}

export interface MCDMAlternative {
  name: string;
  scores: Record<string, number>;
}

export interface MCDMSolveResponse {
  method: string;
  status: string;
  normalized_weights: Record<string, number>;
  rankings: {
    rank: number;
    alternative: string;
    score: number;
    distance_ideal: number | null;
    distance_anti_ideal: number | null;
    normalized_scores: Record<string, number>;
  }[];
  formulation: MathFormulationSection;
  message: string;
}

export interface SolutionHistoryItem {
  id: string;
  timestamp: string;
  module: 'multi-period' | 'goal-programming' | 'mcdm';
  title: string;
  status: string;
  isOptimal: boolean;
  objectiveSummary: string;
  datasetName?: string;
  payload: MultiPeriodSolveResponse | GoalProgrammingSolveResponse | MCDMSolveResponse;
}

export interface PublicDatasetCatalogItem {
  id: string;
  name: string;
  source: string;
  source_url: string;
  description: string;
  approximate_size: string;
  data_period: string;
  license: string;
  citation: string;
  disclaimer: string;
}

export interface PublicDatasetImportRequest {
  source_id: 'uci_online_retail';
  aggregation_period: 'monthly' | 'weekly' | 'quarterly';
  max_products: number;
  max_periods: number;
  capacity_buffer_pct: number;
  include_production_cost: boolean;
  production_cost_ratio: number;
  include_inventory_cost: boolean;
  inventory_cost_ratio: number;
  include_initial_inventory: boolean;
  initial_inventory_units: number;
}

export interface PreprocessingReport {
  raw_row_count: number;
  cancelled_invoices_removed: number;
  non_positive_quantity_removed: number;
  invalid_price_removed: number;
  missing_stockcode_removed: number;
  invalid_date_removed: number;
  clean_row_count: number;
  aggregation_period: string;
  products_selected: number;
  periods_created: number;
  prepared_row_count: number;
  date_range_start: string | null;
  date_range_end: string | null;
  cached_source_used: boolean;
}

export interface ParameterAssumptionItem {
  field: string;
  column_name: string;
  origin: 'source_derived' | 'model_assumption';
  methodology: string;
  summary: string;
}

export interface PublicDatasetImportResponse {
  dataset: DatasetSummary;
  catalog_entry: PublicDatasetCatalogItem;
  preprocessing_report: PreprocessingReport;
  assumptions: ParameterAssumptionItem[];
  suggested_mapping: MultiPeriodColumnMapping;
  suggested_capacity_scope: 'auto' | 'per_product' | 'aggregate_period';
}

export interface ScenarioInputConfig {
  mapping: MultiPeriodColumnMapping;
  integer_production: boolean;
  allow_backlogging: boolean;
  capacity_scope: 'auto' | 'per_product' | 'aggregate_period';
  demand_multiplier: number;
  capacity_multiplier: number;
  production_cost_multiplier: number;
  objective_sense: string;
}

export interface SavedScenarioSummary {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  module: 'multi-period';
  dataset_id: string | null;
  dataset_name: string | null;
  active_sheet: string | null;
  objective_sense: string;
  status: string;
  is_optimal: boolean;
  constraints_feasible: boolean;
  objective_value: number | null;
  has_result_snapshot: boolean;
  input_config: ScenarioInputConfig;
}

export interface SavedScenarioDetail extends SavedScenarioSummary {
  result_snapshot: MultiPeriodSolveResponse | null;
}

export interface ScenarioCreateRequest {
  name: string;
  description: string;
  module: 'multi-period';
  dataset_id: string | null;
  dataset_name: string | null;
  active_sheet: string | null;
  input_config: ScenarioInputConfig;
  result_snapshot: MultiPeriodSolveResponse | null;
}

export interface ScenarioUpdateRequest {
  name?: string;
  description?: string;
  input_config?: ScenarioInputConfig;
  result_snapshot?: MultiPeriodSolveResponse | null;
}

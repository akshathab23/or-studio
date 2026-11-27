import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  SensitivityParameter,
  SensitivitySolveCategory,
  SensitivitySweepRequest,
  SensitivitySweepResponse,
} from '../types/or';

export const DEFAULT_MIN_MULTIPLIER = 0.7;
export const DEFAULT_MAX_MULTIPLIER = 1.4;
export const DEFAULT_NUM_POINTS = 9;
export const MIN_SWEEP_POINTS = 3;
export const MAX_SWEEP_POINTS = 25;
export const MIN_MULTIPLIER_BOUND = 0.05;
export const MAX_MULTIPLIER_BOUND = 10.0;

/**
 * Deterministic qualitative classification thresholds for normalized L1
 * production plan shift (%):
 * - <= 5%: plan remained relatively stable across tested grid
 * - (5%, 20%]: moderate adjustments across tested grid
 * - > 20%: substantial production plan changes across tested grid
 */
export const PLAN_SHIFT_STABLE_THRESHOLD_PCT = 5.0;
export const PLAN_SHIFT_MODERATE_THRESHOLD_PCT = 20.0;

export const MANDATORY_ROBUSTNESS_DISCLOSURE =
  'Robustness results are empirical evaluations of the tested parameter values. They are not formal robust optimization guarantees.';

export interface SensitivityParameterOption {
  value: SensitivityParameter;
  label: string;
  description: string;
  unitHint: string;
  available: boolean;
  disabledReason: string | null;
}

export function getSensitivityParameterOptions(
  mapping: MultiPeriodColumnMapping | null
): SensitivityParameterOption[] {
  const hasMapping = Boolean(mapping?.product && mapping?.period && mapping?.demand);
  const hasCapacity = Boolean(mapping?.capacity);
  const hasProdCost = Boolean(mapping?.production_cost);
  const hasInvCost = Boolean(mapping?.inventory_cost);

  return [
    {
      value: 'demand',
      label: 'Demand',
      description: 'Scales product-period demand requirements uniformly.',
      unitHint: 'Demand multiplier (1.00x = baseline)',
      available: hasMapping,
      disabledReason: hasMapping
        ? null
        : 'Demand column is not mapped in the active Multi-Period model.',
    },
    {
      value: 'capacity',
      label: 'Capacity',
      description: 'Scales available production capacity limits uniformly.',
      unitHint: 'Capacity multiplier (1.00x = baseline)',
      available: hasMapping && hasCapacity,
      disabledReason: !hasMapping
        ? 'Multi-Period mapping is incomplete.'
        : hasCapacity
          ? null
          : 'Capacity is not mapped in the active Multi-Period model.',
    },
    {
      value: 'production_cost',
      label: 'Production Cost',
      description: 'Scales unit production cost coefficients uniformly.',
      unitHint: 'Production cost multiplier (1.00x = baseline)',
      available: hasMapping && hasProdCost,
      disabledReason: !hasMapping
        ? 'Multi-Period mapping is incomplete.'
        : hasProdCost
          ? null
          : 'Production Cost is not mapped in the active Multi-Period model.',
    },
    {
      value: 'inventory_cost',
      label: 'Inventory Cost',
      description: 'Scales unit inventory holding cost coefficients uniformly.',
      unitHint: 'Inventory cost multiplier (1.00x = baseline)',
      available: hasMapping && hasInvCost,
      disabledReason: !hasMapping
        ? 'Multi-Period mapping is incomplete.'
        : hasInvCost
          ? null
          : 'Inventory Cost is not mapped in the active Multi-Period model.',
    },
  ];
}

export function validateSensitivityInputs(params: {
  parameter: SensitivityParameter;
  minMultiplier: number;
  maxMultiplier: number;
  numPoints: number;
  mapping: MultiPeriodColumnMapping | null;
}): string | null {
  const { parameter, minMultiplier, maxMultiplier, numPoints, mapping } = params;
  if (!mapping || !mapping.product || !mapping.period || !mapping.demand) {
    return 'Complete the Multi-Period column mapping before running sensitivity analysis.';
  }

  const options = getSensitivityParameterOptions(mapping);
  const selected = options.find((opt) => opt.value === parameter);
  if (!selected) {
    return `Unsupported sensitivity parameter: ${parameter}.`;
  }
  if (!selected.available) {
    return selected.disabledReason ?? `${selected.label} is not available for this model.`;
  }

  if (!Number.isFinite(minMultiplier) || !Number.isFinite(maxMultiplier)) {
    return 'Minimum and maximum multipliers must be finite numbers.';
  }
  if (minMultiplier <= 0 || maxMultiplier <= 0) {
    return 'Multipliers must be strictly greater than 0.';
  }
  if (minMultiplier > MAX_MULTIPLIER_BOUND || maxMultiplier > MAX_MULTIPLIER_BOUND) {
    return `Multipliers cannot exceed ${MAX_MULTIPLIER_BOUND}x.`;
  }
  if (minMultiplier >= maxMultiplier) {
    return 'Minimum multiplier must be strictly less than maximum multiplier.';
  }
  if (!Number.isInteger(numPoints) || numPoints < MIN_SWEEP_POINTS || numPoints > MAX_SWEEP_POINTS) {
    return `Number of sweep points must be a whole number between ${MIN_SWEEP_POINTS} and ${MAX_SWEEP_POINTS}.`;
  }
  return null;
}

export function buildSensitivityRequest(params: {
  datasetId: string;
  mapping: MultiPeriodColumnMapping;
  integerProduction: boolean;
  capacityScope: 'auto' | 'per_product' | 'aggregate_period';
  parameter: SensitivityParameter;
  minMultiplier: number;
  maxMultiplier: number;
  numPoints: number;
}): SensitivitySweepRequest {
  return {
    dataset_id: params.datasetId,
    mapping: params.mapping,
    integer_production: params.integerProduction,
    allow_backlogging: false,
    capacity_scope: params.capacityScope,
    parameter: params.parameter,
    min_multiplier: params.minMultiplier,
    max_multiplier: params.maxMultiplier,
    num_points: params.numPoints,
  };
}

export interface BaselineConsistencyResult {
  ready: boolean;
  reason: string | null;
}

export function getMappingSignature(
  mapping: MultiPeriodColumnMapping | null | undefined
): string | null {
  if (!mapping) return null;
  return JSON.stringify({
    product: mapping.product || null,
    period: mapping.period || null,
    demand: mapping.demand || null,
    production_cost: mapping.production_cost || null,
    inventory_cost: mapping.inventory_cost || null,
    capacity: mapping.capacity || null,
    processing_time: mapping.processing_time || null,
    resource: mapping.resource || null,
    initial_inventory: mapping.initial_inventory || null,
    setup_cost: mapping.setup_cost || null,
    setup_time: mapping.setup_time || null,
  });
}

export function checkBaselineConsistency(params: {
  dataset: DatasetSummary | null;
  mpMapping: MultiPeriodColumnMapping | null;
  mpSolution: MultiPeriodSolveResponse | null;
  mpIntegerProd: boolean;
  mpCapacityScope: 'auto' | 'per_product' | 'aggregate_period';
  mpSolutionMappingSignature?: string | null;
}): BaselineConsistencyResult {
  const {
    dataset,
    mpMapping,
    mpSolution,
    mpIntegerProd,
    mpCapacityScope,
    mpSolutionMappingSignature,
  } = params;

  if (!dataset) {
    return {
      ready: false,
      reason: 'No active dataset is loaded. Upload or select a dataset first.',
    };
  }
  if (!mpMapping || !mpMapping.product || !mpMapping.period || !mpMapping.demand) {
    return {
      ready: false,
      reason: 'Multi-Period column mapping is incomplete. Configure and solve the baseline model first.',
    };
  }
  if (!mpSolution) {
    return {
      ready: false,
      reason: 'No baseline Multi-Period solution is available. Solve the baseline model before running sensitivity analysis.',
    };
  }
  if (
    mpSolutionMappingSignature !== undefined &&
    mpSolutionMappingSignature !== getMappingSignature(mpMapping)
  ) {
    return {
      ready: false,
      reason: 'The active Multi-Period column mapping changed after the baseline was solved. Re-solve the Multi-Period model first.',
    };
  }
  if (!mpSolution.is_optimal || !mpSolution.constraints_feasible) {
    return {
      ready: false,
      reason: `The active baseline solution is '${mpSolution.status}' and is not verified optimal & feasible. Resolve a feasible optimal baseline before running sensitivity analysis.`,
    };
  }
  if (
    mpSolution.integer_production !== undefined &&
    mpSolution.integer_production !== mpIntegerProd
  ) {
    return {
      ready: false,
      reason: 'The active baseline solution does not match the current integer production setting. Re-solve the Multi-Period model first.',
    };
  }
  if (
    mpSolution.capacity_scope !== undefined &&
    mpSolution.capacity_scope !== mpCapacityScope
  ) {
    return {
      ready: false,
      reason: 'The active baseline solution does not match the current capacity scope setting. Re-solve the Multi-Period model first.',
    };
  }
  return { ready: true, reason: null };
}

export function formatSensitivityApiError(err: unknown): string {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  const rawMsg = err instanceof Error ? err.message : 'Sensitivity analysis request failed.';

  if (status === 429) {
    return 'Sensitivity solver capacity is currently busy with other requests. Please wait a moment and try again.';
  }
  if (status === 404) {
    return `Dataset not found on the server (${rawMsg}). Please re-upload or select the dataset.`;
  }
  if (status === 400) {
    return `Invalid sensitivity configuration: ${rawMsg}`;
  }
  if (status !== undefined && status >= 500) {
    return `Server error while running sensitivity analysis (${status}): ${rawMsg}`;
  }
  if (err instanceof TypeError) {
    return 'Network error: unable to reach the OR Studio backend API.';
  }
  return rawMsg;
}

export interface PointStatusBadge {
  label: string;
  tone: 'emerald' | 'rose' | 'amber' | 'slate';
}

export function classifyPointStatus(category: SensitivitySolveCategory): PointStatusBadge {
  switch (category) {
    case 'optimal':
      return { label: 'Optimal', tone: 'emerald' };
    case 'infeasible':
      return { label: 'Infeasible', tone: 'rose' };
    case 'timeout':
      return { label: 'Time Limit', tone: 'amber' };
    case 'solver_error':
      return { label: 'Solver Error', tone: 'amber' };
    case 'unbounded':
      return { label: 'Unbounded', tone: 'amber' };
    default:
      return { label: 'Unknown', tone: 'slate' };
  }
}

export function formatNumberOrNull(
  value: number | null | undefined,
  decimals = 2,
  suffix = ''
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })}${suffix}`;
}

export interface SensitivityCurveChartModel {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
  /** Ordered multipliers corresponding to curve points for click resolution */
  feasiblePointMultipliers: number[];
  infeasiblePointMultipliers: number[];
  incompletePointMultipliers: number[];
}

export function buildSensitivityCurveChart(
  response: SensitivitySweepResponse,
  parameterLabel: string
): SensitivityCurveChartModel {
  const { points, baseline, summary } = response;
  const isMinimize = summary.objective_sense.toLowerCase().startsWith('min');

  // Build X/Y arrays preserving nulls at non-feasible points so connectgaps=false
  // never interpolates or connects across infeasible/incomplete gaps, and never plots 0.
  const allX = points.map((p) => p.multiplier);
  const feasibleLineY = points.map((p) =>
    p.is_feasible_optimal && p.objective_value !== null && Number.isFinite(p.objective_value)
      ? p.objective_value
      : null
  );

  const feasiblePts = points.filter(
    (p) => p.is_feasible_optimal && p.objective_value !== null && Number.isFinite(p.objective_value)
  );
  const infeasiblePts = points.filter((p) => p.status_category === 'infeasible');
  const incompletePts = points.filter(
    (p) =>
      !p.is_feasible_optimal &&
      p.status_category !== 'infeasible'
  );

  const data: Record<string, unknown>[] = [
    {
      x: allX,
      y: feasibleLineY,
      type: 'scatter',
      mode: 'lines',
      name: 'Feasible Objective Path',
      connectgaps: false,
      line: { color: '#2563eb', width: 2.5 },
      hoverinfo: 'skip',
      yaxis: 'y',
    },
    {
      x: feasiblePts.map((p) => p.multiplier),
      y: feasiblePts.map((p) => p.objective_value),
      type: 'scatter',
      mode: 'markers',
      name: 'Feasible Optimal',
      marker: {
        color: feasiblePts.map((p) => (p.is_baseline ? '#0f172a' : '#2563eb')),
        size: feasiblePts.map((p) => (p.is_baseline ? 11 : 8)),
        symbol: feasiblePts.map((p) => (p.is_baseline ? 'diamond' : 'circle')),
        line: { color: '#ffffff', width: 1.5 },
      },
      text: feasiblePts.map(
        (p) =>
          `${p.multiplier.toFixed(2)}x${p.is_baseline ? ' (Baseline)' : ''}<br>Objective: ${formatNumberOrNull(p.objective_value, 2)}<br>Plan Shift: ${formatNumberOrNull(p.plan_shift_pct, 2, '%')}`
      ),
      hovertemplate: '%{text}<extra></extra>',
      yaxis: 'y',
    },
  ];

  if (
    baseline.is_feasible_optimal &&
    baseline.objective_value !== null &&
    Number.isFinite(baseline.objective_value)
  ) {
    data.push({
      x: [baseline.multiplier],
      y: [baseline.objective_value],
      type: 'scatter',
      mode: 'markers',
      name: 'Baseline (1.00x)',
      marker: {
        color: '#0f172a',
        size: 12,
        symbol: 'diamond',
        line: { color: '#ffffff', width: 1.5 },
      },
      hovertemplate: `Baseline 1.00x<br>Objective: ${formatNumberOrNull(baseline.objective_value, 2)}<extra></extra>`,
      yaxis: 'y',
    });
  }

  // Separate bottom status strip (yaxis2) for infeasible & incomplete points so
  // no fabricated objective value is ever plotted on the objective Y-axis.
  if (infeasiblePts.length > 0) {
    data.push({
      x: infeasiblePts.map((p) => p.multiplier),
      y: infeasiblePts.map(() => 0.5),
      type: 'scatter',
      mode: 'markers',
      name: 'Infeasible (No Objective)',
      marker: { color: '#e11d48', size: 10, symbol: 'x' },
      text: infeasiblePts.map(
        (p) => `${p.multiplier.toFixed(2)}x<br>Status: ${p.solver_status}<br>Objective: N/A (Infeasible)`
      ),
      hovertemplate: '%{text}<extra></extra>',
      yaxis: 'y2',
    });
  }

  if (incompletePts.length > 0) {
    data.push({
      x: incompletePts.map((p) => p.multiplier),
      y: incompletePts.map(() => 0.5),
      type: 'scatter',
      mode: 'markers',
      name: 'Incomplete / Error (No Objective)',
      marker: { color: '#d97706', size: 10, symbol: 'triangle-up' },
      text: incompletePts.map(
        (p) =>
          `${p.multiplier.toFixed(2)}x<br>Status: ${p.solver_status}<br>${p.error_message ?? 'Incomplete solve'}`
      ),
      hovertemplate: '%{text}<extra></extra>',
      yaxis: 'y2',
    });
  }

  const shapes: Record<string, unknown>[] = [];
  if (
    baseline.is_feasible_optimal &&
    baseline.objective_value !== null &&
    Number.isFinite(baseline.objective_value)
  ) {
    shapes.push({
      type: 'line',
      xref: 'paper',
      x0: 0,
      x1: 1,
      yref: 'y',
      y0: baseline.objective_value,
      y1: baseline.objective_value,
      line: { color: '#64748b', width: 1.2, dash: 'dash' },
    });
  }
  shapes.push({
    type: 'line',
    xref: 'x',
    x0: 1.0,
    x1: 1.0,
    yref: 'paper',
    y0: 0,
    y1: 1,
    line: { color: '#94a3b8', width: 1.2, dash: 'dot' },
  });

  const hasStatusStrip = infeasiblePts.length > 0 || incompletePts.length > 0;

  const layout: Record<string, unknown> = {
    xaxis: {
      title: { text: `${parameterLabel} Multiplier (1.00x = Baseline)`, standoff: 10 },
      anchor: hasStatusStrip ? 'y2' : 'y',
      gridcolor: '#f1f5f9',
      zeroline: false,
    },
    yaxis: {
      title: {
        text: isMinimize ? 'Objective (Min)' : 'Objective (Max)',
        standoff: 8,
      },
      domain: hasStatusStrip ? [0.24, 1.0] : [0.0, 1.0],
      gridcolor: '#f1f5f9',
      zeroline: false,
      automargin: true,
    },
    ...(hasStatusStrip
      ? {
          yaxis2: {
            domain: [0.0, 0.12],
            range: [0, 1],
            tickvals: [0.5],
            ticktext: ['Failed'],
            zeroline: false,
            gridcolor: '#f8fafc',
            automargin: true,
          },
        }
      : {}),
    shapes,
    legend: { orientation: 'h', x: 0, xanchor: 'left', y: -0.38, yanchor: 'top' },
    margin: { t: 28, r: 16, b: 104, l: 60 },
  };

  return {
    data,
    layout,
    feasiblePointMultipliers: feasiblePts.map((p) => p.multiplier),
    infeasiblePointMultipliers: infeasiblePts.map((p) => p.multiplier),
    incompletePointMultipliers: incompletePts.map((p) => p.multiplier),
  };
}

export interface PlanStabilityChartModel {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
}

export function buildPlanStabilityChart(
  response: SensitivitySweepResponse,
  parameterLabel: string
): PlanStabilityChartModel {
  const { points, is_milp } = response;
  const xVals = points.map((p) => p.multiplier);
  const shiftY = points.map((p) =>
    p.is_feasible_optimal && p.plan_shift_pct !== null && Number.isFinite(p.plan_shift_pct)
      ? p.plan_shift_pct
      : null
  );

  const data: Record<string, unknown>[] = [
    {
      x: xVals,
      y: shiftY,
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Production Plan Shift (%)',
      connectgaps: false,
      line: { color: '#0f766e', width: 2.5 },
      marker: { color: '#0f766e', size: 7 },
      hovertemplate: `${parameterLabel} %{x:.2f}x<br>Normalized L1 Plan Shift: %{y:.2f}%<extra></extra>`,
    },
  ];

  const hasSetupChanges =
    is_milp && points.some((p) => p.is_feasible_optimal && p.setup_changes !== null);

  if (hasSetupChanges) {
    data.push({
      x: xVals,
      y: points.map((p) => (p.is_feasible_optimal ? p.setup_changes : null)),
      type: 'bar',
      name: 'Setup Binary Changes',
      opacity: 0.35,
      marker: { color: '#6366f1' },
      yaxis: 'y2',
      hovertemplate: `${parameterLabel} %{x:.2f}x<br>Setup Changes: %{y}<extra></extra>`,
    });
  }

  const layout: Record<string, unknown> = {
    xaxis: {
      title: { text: `${parameterLabel} Multiplier (1.00x = Baseline)`, standoff: 10 },
      gridcolor: '#f1f5f9',
      zeroline: false,
    },
    yaxis: {
      title: { text: 'Plan Shift (%)', standoff: 8 },
      rangemode: 'tozero',
      gridcolor: '#f1f5f9',
      automargin: true,
    },
    ...(hasSetupChanges
      ? {
          yaxis2: {
            title: { text: 'Setup Changes', standoff: 8 },
            overlaying: 'y',
            side: 'right',
            rangemode: 'tozero',
            showgrid: false,
            automargin: true,
          },
        }
      : {}),
    legend: { orientation: 'h', x: 0, xanchor: 'left', y: -0.28, yanchor: 'top' },
    margin: { t: 28, r: hasSetupChanges ? 56 : 16, b: 80, l: 56 },
  };

  return { data, layout };
}

export interface RobustnessInterpretation {
  statements: string[];
  observedWorstCaseSummary: string | null;
  disclosure: string;
}

export function buildRobustnessInterpretation(
  response: SensitivitySweepResponse
): RobustnessInterpretation {
  const { summary } = response;
  const statements: string[] = [];

  if (summary.incomplete_or_error_count > 0) {
    statements.push(
      `Some grid points (${summary.incomplete_or_error_count} of ${summary.total_grid_points}) could not be verified because of solver errors or incomplete execution.`
    );
  }
  if (summary.infeasible_count === 0 && summary.feasible_optimal_count === summary.total_grid_points) {
    statements.push(
      `All tested grid points (${summary.total_grid_points}/${summary.total_grid_points}) were verified feasible.`
    );
  } else if (summary.infeasible_count > 0) {
    const firstInf =
      summary.first_infeasible_multiplier !== null
        ? ` First observed infeasible grid point: ${summary.first_infeasible_multiplier.toFixed(2)}x.`
        : '';
    statements.push(
      `Some tested grid points were infeasible (${summary.infeasible_count} of ${summary.total_grid_points}).${firstInf}`
    );
  }

  if (summary.max_plan_shift_pct !== null && Number.isFinite(summary.max_plan_shift_pct)) {
    if (summary.max_plan_shift_pct <= PLAN_SHIFT_STABLE_THRESHOLD_PCT) {
      statements.push(
        `The production plan remained relatively stable across the tested grid (max shift ${summary.max_plan_shift_pct.toFixed(2)}% <= ${PLAN_SHIFT_STABLE_THRESHOLD_PCT}% threshold).`
      );
    } else if (summary.max_plan_shift_pct <= PLAN_SHIFT_MODERATE_THRESHOLD_PCT) {
      statements.push(
        `The production plan showed moderate adjustments across the tested grid (max shift ${summary.max_plan_shift_pct.toFixed(2)}%, within ${PLAN_SHIFT_STABLE_THRESHOLD_PCT}%–${PLAN_SHIFT_MODERATE_THRESHOLD_PCT}% threshold).`
      );
    } else {
      statements.push(
        `The production plan changed substantially across the tested grid (max shift ${summary.max_plan_shift_pct.toFixed(2)}% > ${PLAN_SHIFT_MODERATE_THRESHOLD_PCT}% threshold).`
      );
    }
  }

  const observedWorstCaseSummary =
    summary.worst_case_feasible_objective !== null &&
    Number.isFinite(summary.worst_case_feasible_objective)
      ? `Observed worst-case objective among tested feasible points (${summary.objective_sense}): ${formatNumberOrNull(summary.worst_case_feasible_objective, 2)}.`
      : null;

  return {
    statements,
    observedWorstCaseSummary,
    disclosure: MANDATORY_ROBUSTNESS_DISCLOSURE,
  };
}

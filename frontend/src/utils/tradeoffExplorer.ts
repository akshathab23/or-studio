import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  TradeoffCandidateResult,
  TradeoffCriterion,
  TradeoffExploreRequest,
  TradeoffExploreResponse,
  TradeoffToleranceMode,
} from '../types/or';
import {
  checkBaselineConsistency,
  classifyPointStatus,
  formatNumberOrNull,
} from './sensitivityAnalysis.ts';

export const DEFAULT_RELATIVE_TOLERANCE_PCT = 10.0;
export const MAX_RELATIVE_TOLERANCE_PCT = 50.0;
export const MAX_ABSOLUTE_TOLERANCE = 1_000_000;
export const DEFAULT_TRADEOFF_POINTS = 6;
export const MIN_TRADEOFF_POINTS = 2;
export const MAX_TRADEOFF_POINTS = 12;
export const NEAR_ZERO_OBJECTIVE_THRESHOLD = 1e-6;

export const MANDATORY_TRADEOFF_DISCLOSURE =
  'These are verified optimization candidates within the configured objective budget. They are not a guarantee of a complete Pareto frontier or of a globally exhaustive set of operational trade-offs.';

export interface TradeoffCriterionOption {
  value: TradeoffCriterion;
  label: string;
  unit: string;
  description: string;
  available: boolean;
  disabledReason: string | null;
}

export function getTradeoffCriterionOptions(
  mapping: MultiPeriodColumnMapping | null,
  solution: MultiPeriodSolveResponse | null
): TradeoffCriterionOption[] {
  const hasMapping = Boolean(mapping?.product && mapping?.period && mapping?.demand);
  const hasCapacity = Boolean(mapping?.capacity);
  const periodCount = solution?.period_summary?.length ?? 0;
  const hasMultiplePeriods = solution ? periodCount >= 2 : hasMapping;

  return [
    {
      value: 'peak_utilization',
      label: 'Peak Capacity Utilization',
      unit: '%',
      description:
        'Find alternative plans that reduce the maximum utilization of available capacity while respecting the original objective budget.',
      available: hasMapping && hasCapacity,
      disabledReason: !hasMapping
        ? 'Multi-Period mapping is incomplete.'
        : hasCapacity
          ? null
          : 'Capacity is not mapped in the active Multi-Period model.',
    },
    {
      value: 'cumulative_inventory',
      label: 'Cumulative Inventory',
      unit: 'units',
      description:
        'Find alternative plans that reduce cumulative inventory across products and periods while respecting the original objective budget.',
      available: hasMapping,
      disabledReason: hasMapping
        ? null
        : 'Multi-Period mapping is incomplete.',
    },
    {
      value: 'production_smoothing',
      label: 'Production Smoothing',
      unit: 'units',
      description:
        'Find alternative plans that reduce changes in production quantities between periods while respecting the original objective budget.',
      available: hasMapping && hasMultiplePeriods,
      disabledReason: !hasMapping
        ? 'Multi-Period mapping is incomplete.'
        : hasMultiplePeriods
          ? null
          : 'At least 2 periods are required for Production Smoothing.',
    },
  ];
}

export function isNearZeroBaselineObjective(objectiveValue: number | null | undefined): boolean {
  if (objectiveValue === null || objectiveValue === undefined || !Number.isFinite(objectiveValue)) {
    return false;
  }
  return Math.abs(objectiveValue) < NEAR_ZERO_OBJECTIVE_THRESHOLD;
}

export function computeAllowedObjectiveBudget(
  baselineObjective: number,
  objectiveSense: string,
  mode: TradeoffToleranceMode,
  toleranceValue: number
): number {
  const isMinimize = objectiveSense.toLowerCase().startsWith('min');
  const eps =
    mode === 'relative_pct'
      ? (toleranceValue / 100.0) * Math.abs(baselineObjective)
      : toleranceValue;
  return isMinimize ? baselineObjective + eps : baselineObjective - eps;
}

export function validateTradeoffInputs(params: {
  criterion: TradeoffCriterion;
  mapping: MultiPeriodColumnMapping | null;
  solution: MultiPeriodSolveResponse | null;
  toleranceMode: TradeoffToleranceMode;
  relativeTolerancePct: number;
  absoluteTolerance: number;
  numPoints: number;
}): string | null {
  const {
    criterion,
    mapping,
    solution,
    toleranceMode,
    relativeTolerancePct,
    absoluteTolerance,
    numPoints,
  } = params;

  if (!mapping || !mapping.product || !mapping.period || !mapping.demand) {
    return 'Complete the Multi-Period column mapping before generating trade-off alternatives.';
  }

  const options = getTradeoffCriterionOptions(mapping, solution);
  const selected = options.find((o) => o.value === criterion);
  if (!selected) {
    return `Unsupported trade-off criterion: ${criterion}.`;
  }
  if (!selected.available) {
    return selected.disabledReason ?? `${selected.label} is not available for this model.`;
  }

  if (toleranceMode === 'relative_pct') {
    if (!Number.isFinite(relativeTolerancePct) || relativeTolerancePct <= 0) {
      return 'Relative objective tolerance (%) must be strictly greater than 0.';
    }
    if (relativeTolerancePct > MAX_RELATIVE_TOLERANCE_PCT) {
      return `Relative objective tolerance cannot exceed ${MAX_RELATIVE_TOLERANCE_PCT}%.`;
    }
  } else {
    if (!Number.isFinite(absoluteTolerance) || absoluteTolerance <= 0) {
      return 'Absolute objective tolerance (in objective units) must be strictly greater than 0.';
    }
    if (absoluteTolerance > MAX_ABSOLUTE_TOLERANCE) {
      return `Absolute objective tolerance cannot exceed ${MAX_ABSOLUTE_TOLERANCE.toLocaleString()}.`;
    }
  }

  if (!Number.isInteger(numPoints) || numPoints < MIN_TRADEOFF_POINTS || numPoints > MAX_TRADEOFF_POINTS) {
    return `Number of trade-off points must be a whole number between ${MIN_TRADEOFF_POINTS} and ${MAX_TRADEOFF_POINTS}.`;
  }
  return null;
}

export function checkTradeoffBaselineConsistency(params: {
  dataset: DatasetSummary | null;
  mpMapping: MultiPeriodColumnMapping | null;
  mpSolution: MultiPeriodSolveResponse | null;
  mpIntegerProd: boolean;
  mpCapacityScope: 'auto' | 'per_product' | 'aggregate_period';
  mpSolutionMappingSignature?: string | null;
}) {
  const baseCheck = checkBaselineConsistency(params);
  if (!baseCheck.ready) return baseCheck;
  const sol = params.mpSolution;
  if (
    !sol ||
    sol.objective_value === null ||
    sol.objective_value === undefined ||
    !Number.isFinite(sol.objective_value)
  ) {
    return {
      ready: false,
      reason: 'The active baseline solution does not have a finite objective value.',
    };
  }
  if (!sol.objective_sense) {
    return {
      ready: false,
      reason: 'The active baseline solution is missing objective sense metadata.',
    };
  }
  return { ready: true, reason: null };
}

export function buildTradeoffRequest(params: {
  datasetId: string;
  mapping: MultiPeriodColumnMapping;
  integerProduction: boolean;
  capacityScope: 'auto' | 'per_product' | 'aggregate_period';
  criterion: TradeoffCriterion;
  toleranceMode: TradeoffToleranceMode;
  relativeTolerancePct: number;
  absoluteTolerance: number;
  numPoints: number;
}): TradeoffExploreRequest {
  return {
    dataset_id: params.datasetId,
    mapping: params.mapping,
    integer_production: params.integerProduction,
    allow_backlogging: false,
    capacity_scope: params.capacityScope,
    criterion: params.criterion,
    max_relative_tolerance_pct:
      params.toleranceMode === 'relative_pct' ? params.relativeTolerancePct : null,
    absolute_tolerance:
      params.toleranceMode === 'absolute' ? params.absoluteTolerance : null,
    num_points: params.numPoints,
  };
}

export function formatTradeoffApiError(err: unknown): string {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  const rawMsg = err instanceof Error ? err.message : 'Trade-off exploration request failed.';

  if (status === 429) {
    return 'Trade-off solver capacity is currently busy with other requests. Please wait a moment and try again.';
  }
  if (status === 404) {
    return `Dataset not found on the server (${rawMsg}). Please re-upload or select the dataset.`;
  }
  if (status === 400) {
    return `Invalid trade-off configuration: ${rawMsg}`;
  }
  if (status !== undefined && status >= 500) {
    return `Server error while generating trade-off alternatives (${status}): ${rawMsg}`;
  }
  if (err instanceof TypeError) {
    return 'Network error: unable to reach the OR Studio backend API.';
  }
  return rawMsg;
}

export interface TradeoffChartModel {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
  curveCandidateIds: string[][];
}

export function buildTradeoffChart(response: TradeoffExploreResponse): TradeoffChartModel {
  const { baseline, candidates, summary } = response;
  const useRelative = summary.tolerance_mode === 'relative_pct';
  const isMinimize = summary.objective_sense.toLowerCase().startsWith('min');

  const getDeteriorationX = (c: TradeoffCandidateResult): number | null => {
    if (!c.is_verified_feasible) return null;
    if (useRelative) {
      if (c.objective_pct_change === null || !Number.isFinite(c.objective_pct_change)) {
        return null;
      }
      return isMinimize ? c.objective_pct_change : -c.objective_pct_change;
    }
    if (c.objective_diff === null || !Number.isFinite(c.objective_diff)) return null;
    return isMinimize ? c.objective_diff : -c.objective_diff;
  };

  const distinctVerified = candidates.filter(
    (c) =>
      c.is_verified_feasible &&
      !c.is_duplicate &&
      getDeteriorationX(c) !== null &&
      c.criterion_value !== null &&
      Number.isFinite(c.criterion_value)
  );
  const duplicateVerified = candidates.filter(
    (c) =>
      c.is_verified_feasible &&
      c.is_duplicate &&
      getDeteriorationX(c) !== null &&
      c.criterion_value !== null &&
      Number.isFinite(c.criterion_value)
  );

  // Path line connects only verified points in tolerance order without interpolating across gaps
  const lineX: (number | null)[] = candidates.map((c) => getDeteriorationX(c));
  const lineY: (number | null)[] = candidates.map((c) =>
    c.is_verified_feasible && c.criterion_value !== null && Number.isFinite(c.criterion_value)
      ? c.criterion_value
      : null
  );

  const formatTooltip = (c: TradeoffCandidateResult, tag: string) =>
    `${c.candidate_id} (${tag})<br>` +
    `Tolerance: ${c.tolerance_value.toFixed(2)}${useRelative ? '%' : ''}<br>` +
    `Original Objective: ${formatNumberOrNull(c.objective_value, 2)}<br>` +
    `${summary.criterion_label}: ${formatNumberOrNull(c.criterion_value, 2, summary.criterion_unit ? ` ${summary.criterion_unit}` : '')}<br>` +
    `Status: ${c.solver_status}`;

  const data: Record<string, unknown>[] = [
    {
      x: lineX,
      y: lineY,
      type: 'scatter',
      mode: 'lines',
      name: 'Verified Path',
      connectgaps: false,
      line: { color: '#94a3b8', width: 1.8, dash: 'dot' },
      hoverinfo: 'skip',
    },
  ];
  const curveCandidateIds: string[][] = [[]];

  if (
    baseline.is_verified_feasible &&
    baseline.criterion_value !== null &&
    Number.isFinite(baseline.criterion_value)
  ) {
    data.push({
      x: [0],
      y: [baseline.criterion_value],
      type: 'scatter',
      mode: 'markers',
      name: 'Baseline',
      marker: {
        color: '#0f172a',
        size: 12,
        symbol: 'diamond',
        line: { color: '#ffffff', width: 1.5 },
      },
      customdata: [baseline.candidate_id],
      text: [formatTooltip(baseline, 'Baseline')],
      hovertemplate: '%{text}<extra></extra>',
    });
    curveCandidateIds.push([baseline.candidate_id]);
  }

  if (distinctVerified.length > 0) {
    data.push({
      x: distinctVerified.map((c) => getDeteriorationX(c)),
      y: distinctVerified.map((c) => c.criterion_value),
      type: 'scatter',
      mode: 'markers',
      name: 'Verified Distinct Alternative',
      marker: {
        color: '#2563eb',
        size: 10,
        symbol: 'circle',
        line: { color: '#ffffff', width: 1.5 },
      },
      customdata: distinctVerified.map((c) => c.candidate_id),
      text: distinctVerified.map((c) => formatTooltip(c, 'Verified Distinct')),
      hovertemplate: '%{text}<extra></extra>',
    });
    curveCandidateIds.push(distinctVerified.map((c) => c.candidate_id));
  }

  if (duplicateVerified.length > 0) {
    data.push({
      x: duplicateVerified.map((c) => getDeteriorationX(c)),
      y: duplicateVerified.map((c) => c.criterion_value),
      type: 'scatter',
      mode: 'markers',
      name: 'Duplicate Plan',
      marker: {
        color: '#ffffff',
        size: 9,
        symbol: 'square',
        line: { color: '#64748b', width: 2 },
      },
      customdata: duplicateVerified.map((c) => c.candidate_id),
      text: duplicateVerified.map((c) =>
        formatTooltip(c, `Duplicate of ${c.duplicate_of_candidate_id ?? 'prior'}`)
      ),
      hovertemplate: '%{text}<extra></extra>',
    });
    curveCandidateIds.push(duplicateVerified.map((c) => c.candidate_id));
  }

  const xLabel = useRelative
    ? 'Original Objective Deterioration (%)'
    : 'Original Objective Deterioration (Objective Units)';
  const shortYLabel =
    summary.criterion === 'peak_utilization'
      ? 'Peak Utilization (%)'
      : summary.criterion === 'cumulative_inventory'
        ? 'Cumulative Inventory (units)'
        : 'Production Ramp (units)';

  const layout: Record<string, unknown> = {
    xaxis: {
      title: { text: xLabel, standoff: 10 },
      gridcolor: '#f1f5f9',
      zeroline: true,
      zerolinecolor: '#cbd5e1',
    },
    yaxis: {
      title: { text: shortYLabel, standoff: 8 },
      gridcolor: '#f1f5f9',
      zeroline: false,
      automargin: true,
    },
    legend: { orientation: 'h', x: 0, xanchor: 'left', y: -0.34, yanchor: 'top' },
    margin: { t: 28, r: 16, b: 96, l: 64 },
  };

  return { data, layout, curveCandidateIds };
}

export interface ScheduleDiffRow {
  product: string;
  period: string;
  baselineProduction: number;
  candidateProduction: number;
  productionDelta: number;
  baselineInventory: number;
  candidateInventory: number;
  inventoryDelta: number;
  baselineSetup: number | null;
  candidateSetup: number | null;
}

export interface UtilizationDiffRow {
  resource: string;
  period: string;
  capacity: number;
  baselineUtilPct: number;
  candidateUtilPct: number;
  utilDeltaPct: number;
}

export interface CandidatePlanDiff {
  scheduleAvailable: boolean;
  utilizationAvailable: boolean;
  scheduleRows: ScheduleDiffRow[];
  utilizationRows: UtilizationDiffRow[];
}

export function buildCandidatePlanDiff(
  baseline: TradeoffCandidateResult,
  candidate: TradeoffCandidateResult
): CandidatePlanDiff {
  const scheduleAvailable =
    candidate.is_verified_feasible &&
    baseline.production_schedule.length > 0 &&
    candidate.production_schedule.length > 0;

  const scheduleRows: ScheduleDiffRow[] = [];
  if (scheduleAvailable) {
    const candMap = new Map<string, Record<string, unknown>>();
    for (const row of candidate.production_schedule) {
      candMap.set(`${String(row.product)}__${String(row.period)}`, row);
    }
    for (const bRow of baseline.production_schedule) {
      const key = `${String(bRow.product)}__${String(bRow.period)}`;
      const cRow = candMap.get(key);
      if (!cRow) continue;
      const bProd = Number(bRow.production ?? 0);
      const cProd = Number(cRow.production ?? 0);
      const bInv = Number(bRow.ending_inventory ?? 0);
      const cInv = Number(cRow.ending_inventory ?? 0);
      scheduleRows.push({
        product: String(bRow.product),
        period: String(bRow.period),
        baselineProduction: bProd,
        candidateProduction: cProd,
        productionDelta: Number((cProd - bProd).toFixed(4)),
        baselineInventory: bInv,
        candidateInventory: cInv,
        inventoryDelta: Number((cInv - bInv).toFixed(4)),
        baselineSetup: bRow.setup !== undefined && bRow.setup !== null ? Number(bRow.setup) : null,
        candidateSetup: cRow.setup !== undefined && cRow.setup !== null ? Number(cRow.setup) : null,
      });
    }
  }

  const utilizationAvailable =
    candidate.is_verified_feasible &&
    baseline.resource_utilization.length > 0 &&
    candidate.resource_utilization.length > 0;

  const utilizationRows: UtilizationDiffRow[] = [];
  if (utilizationAvailable) {
    const candUtilMap = new Map<string, Record<string, unknown>>();
    for (const u of candidate.resource_utilization) {
      candUtilMap.set(`${String(u.resource)}__${String(u.period)}`, u);
    }
    for (const bUtil of baseline.resource_utilization) {
      const key = `${String(bUtil.resource)}__${String(bUtil.period)}`;
      const cUtil = candUtilMap.get(key);
      if (!cUtil) continue;
      const bPct = Number(bUtil.utilization_pct ?? 0);
      const cPct = Number(cUtil.utilization_pct ?? 0);
      utilizationRows.push({
        resource: String(bUtil.resource),
        period: String(bUtil.period),
        capacity: Number(bUtil.capacity ?? 0),
        baselineUtilPct: bPct,
        candidateUtilPct: cPct,
        utilDeltaPct: Number((cPct - bPct).toFixed(2)),
      });
    }
  }

  return {
    scheduleAvailable,
    utilizationAvailable,
    scheduleRows,
    utilizationRows,
  };
}

export interface TradeoffInterpretation {
  candidateStatement: string;
  executionNotes: string[];
  disclosure: string;
}

export function buildTradeoffInterpretation(
  response: TradeoffExploreResponse,
  selected: TradeoffCandidateResult | null
): TradeoffInterpretation {
  const { summary } = response;
  let candidateStatement = 'Select a verified candidate to inspect its operational trade-off.';

  if (selected) {
    if (!selected.is_verified_feasible) {
      const badge = classifyPointStatus(selected.status_category);
      candidateStatement = `${selected.candidate_id} terminated as '${badge.label}' and was not verified feasible within the configured budget.`;
    } else if (selected.is_baseline) {
      candidateStatement = `Baseline plan achieves the optimal original objective (${formatNumberOrNull(selected.objective_value, 2)}) with ${summary.criterion_label} = ${formatNumberOrNull(selected.criterion_value, 2, summary.criterion_unit ? ` ${summary.criterion_unit}` : '')}.`;
    } else {
      const critImproved =
        selected.criterion_diff !== null && selected.criterion_diff < -1e-6;
      const critAction =
        summary.criterion === 'peak_utilization'
          ? critImproved
            ? 'reduces peak capacity utilization'
            : 'maintains peak capacity utilization'
          : summary.criterion === 'cumulative_inventory'
            ? critImproved
              ? 'uses less cumulative inventory'
              : 'maintains cumulative inventory'
            : critImproved
              ? 'smooths production between periods'
              : 'maintains period-to-period production stability';

      candidateStatement = `${selected.candidate_id} ${critAction} (${formatNumberOrNull(selected.criterion_value, 2, summary.criterion_unit ? ` ${summary.criterion_unit}` : '')}) while staying within the permitted original objective budget (${formatNumberOrNull(selected.objective_budget, 2)}).`;
    }
  }

  const executionNotes: string[] = [];
  if (summary.incomplete_or_error_count > 0) {
    executionNotes.push(
      `${summary.incomplete_or_error_count} of ${summary.total_requested_points} candidate runs did not complete as verified feasible.`
    );
  }
  if (summary.duplicate_count > 0) {
    executionNotes.push(
      `${summary.duplicate_count} candidate run(s) reproduced an already-discovered production plan within numerical tolerance.`
    );
  }

  return {
    candidateStatement,
    executionNotes,
    disclosure: MANDATORY_TRADEOFF_DISCLOSURE,
  };
}

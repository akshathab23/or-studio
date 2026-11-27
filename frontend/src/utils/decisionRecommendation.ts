import type {
  CriterionDirection,
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  RecommendationCriterionConfig,
  RecommendationCriterionId,
  TradeoffCandidateResult,
  TradeoffContextMeta,
  TradeoffExploreResponse,
} from '../types/or';
import { formatNumberOrNull, getMappingSignature } from './sensitivityAnalysis.ts';
import { checkTradeoffBaselineConsistency } from './tradeoffExplorer.ts';

export const RECOMMENDATION_METHOD_DISCLOSURE =
  'Rankings use min-max normalization over the currently eligible verified candidate set and user-assigned preference weights. Changing the candidate set or weights can change normalized scores and rankings. A preference ranking is not a mathematical proof of a globally optimal operational plan.';

export interface EligibleCandidatesResult {
  ready: boolean;
  reason: string | null;
  eligible: TradeoffCandidateResult[];
  excludedDuplicatesCount: number;
  excludedUnverifiedCount: number;
}

export function extractEligibleCandidates(params: {
  dataset: DatasetSummary | null;
  mpMapping: MultiPeriodColumnMapping | null;
  mpSolution: MultiPeriodSolveResponse | null;
  mpIntegerProd: boolean;
  mpCapacityScope: 'auto' | 'per_product' | 'aggregate_period';
  mpSolutionMappingSignature: string | null;
  tradeoffResult: TradeoffExploreResponse | null;
  tradeoffMeta: TradeoffContextMeta | null;
}): EligibleCandidatesResult {
  const {
    dataset,
    mpMapping,
    mpSolution,
    mpIntegerProd,
    mpCapacityScope,
    mpSolutionMappingSignature,
    tradeoffResult,
    tradeoffMeta,
  } = params;

  const baselineCheck = checkTradeoffBaselineConsistency({
    dataset,
    mpMapping,
    mpSolution,
    mpIntegerProd,
    mpCapacityScope,
    mpSolutionMappingSignature,
  });

  if (!baselineCheck.ready) {
    return {
      ready: false,
      reason: baselineCheck.reason,
      eligible: [],
      excludedDuplicatesCount: 0,
      excludedUnverifiedCount: 0,
    };
  }

  if (!tradeoffResult) {
    return {
      ready: false,
      reason:
        'No trade-off alternatives have been generated yet. Visit Trade-off Explorer to generate verified candidate plans.',
      eligible: [],
      excludedDuplicatesCount: 0,
      excludedUnverifiedCount: 0,
    };
  }

  const currentSig = getMappingSignature(mpMapping);
  if (
    tradeoffResult.dataset_id !== dataset?.dataset_id ||
    (tradeoffMeta &&
      (tradeoffMeta.datasetId !== dataset?.dataset_id ||
        tradeoffMeta.mappingSignature !== currentSig ||
        tradeoffMeta.integerProd !== mpIntegerProd ||
        tradeoffMeta.capacityScope !== mpCapacityScope))
  ) {
    return {
      ready: false,
      reason:
        'The stored trade-off candidates were generated for a different dataset, mapping, or model configuration. Re-generate trade-off alternatives first.',
      eligible: [],
      excludedDuplicatesCount: 0,
      excludedUnverifiedCount: 0,
    };
  }

  const allPool = [tradeoffResult.baseline, ...tradeoffResult.candidates];
  const eligible: TradeoffCandidateResult[] = [];
  let excludedDuplicatesCount = 0;
  let excludedUnverifiedCount = 0;

  for (const cand of allPool) {
    const isValid =
      cand.is_verified_feasible &&
      cand.is_optimal &&
      cand.original_constraints_feasible &&
      cand.objective_budget_satisfied &&
      cand.objective_value !== null &&
      Number.isFinite(cand.objective_value);

    if (!isValid) {
      excludedUnverifiedCount += 1;
      continue;
    }
    if (cand.is_duplicate) {
      excludedDuplicatesCount += 1;
      continue;
    }
    eligible.push(cand);
  }

  if (eligible.length < 2) {
    return {
      ready: false,
      reason:
        'At least 2 distinct verified feasible plans (baseline + at least 1 distinct alternative) are needed for comparison and ranking. Generate trade-off alternatives with a wider tolerance or different criterion.',
      eligible,
      excludedDuplicatesCount,
      excludedUnverifiedCount,
    };
  }

  return {
    ready: true,
    reason: null,
    eligible,
    excludedDuplicatesCount,
    excludedUnverifiedCount,
  };
}

export function computeProductionRampFromSchedule(
  schedule: Record<string, unknown>[]
): number | null {
  if (!schedule || schedule.length === 0) return null;
  const byProd = new Map<string, number[]>();
  for (const row of schedule) {
    const p = String(row.product ?? '');
    const val = Number(row.production);
    if (!Number.isFinite(val)) return null;
    const arr = byProd.get(p) ?? [];
    arr.push(val);
    byProd.set(p, arr);
  }
  let hasMultiPeriod = false;
  let totalRamp = 0;
  for (const seq of byProd.values()) {
    if (seq.length >= 2) hasMultiPeriod = true;
    for (let i = 1; i < seq.length; i += 1) {
      totalRamp += Math.abs(seq[i] - seq[i - 1]);
    }
  }
  return hasMultiPeriod ? Number(totalRamp.toFixed(6)) : null;
}

export function extractCriterionValue(
  cand: TradeoffCandidateResult,
  criterionId: RecommendationCriterionId,
  tradeoffCriterion?: string
): number | null {
  switch (criterionId) {
    case 'primary_objective':
      return cand.objective_value !== null && Number.isFinite(cand.objective_value)
        ? cand.objective_value
        : null;
    case 'peak_utilization':
      return cand.peak_utilization_pct !== null && Number.isFinite(cand.peak_utilization_pct)
        ? cand.peak_utilization_pct
        : null;
    case 'cumulative_inventory':
      return cand.total_ending_inventory !== null && Number.isFinite(cand.total_ending_inventory)
        ? cand.total_ending_inventory
        : null;
    case 'production_smoothing':
      if (
        tradeoffCriterion === 'production_smoothing' &&
        cand.criterion_value !== null &&
        Number.isFinite(cand.criterion_value)
      ) {
        return cand.criterion_value;
      }
      return computeProductionRampFromSchedule(cand.production_schedule);
  }
}

export function buildDefaultCriteriaConfig(
  eligible: TradeoffCandidateResult[],
  objectiveSense: string,
  tradeoffCriterion?: string
): RecommendationCriterionConfig[] {
  const isMinimize = objectiveSense.toLowerCase().startsWith('min');
  const allHave = (id: RecommendationCriterionId) =>
    eligible.length > 0 &&
    eligible.every((c) => extractCriterionValue(c, id, tradeoffCriterion) !== null);

  const hasObj = allHave('primary_objective');
  const hasPeak = allHave('peak_utilization');
  const hasInv = allHave('cumulative_inventory');
  const hasSmooth = allHave('production_smoothing');

  return [
    {
      id: 'primary_objective',
      label: 'Primary Objective',
      unit: 'obj units',
      description: 'Original optimization objective value (cost or volume).',
      direction: isMinimize ? 'minimize' : 'maximize',
      selected: hasObj,
      weight: hasObj ? 40 : 0,
      available: hasObj,
      disabledReason: hasObj ? null : 'Objective value unavailable for eligible candidates.',
    },
    {
      id: 'peak_utilization',
      label: 'Peak Capacity Utilization',
      unit: '%',
      description: 'Maximum utilization across mapped capacity constraints.',
      direction: 'minimize',
      selected: hasPeak,
      weight: hasPeak ? 25 : 0,
      available: hasPeak,
      disabledReason: hasPeak
        ? null
        : 'Capacity utilization is unavailable (Capacity may not be mapped).',
    },
    {
      id: 'cumulative_inventory',
      label: 'Cumulative Ending Inventory',
      unit: 'units',
      description: 'Total ending inventory carried across all product-periods.',
      direction: 'minimize',
      selected: hasInv,
      weight: hasInv ? 20 : 0,
      available: hasInv,
      disabledReason: hasInv ? null : 'Ending inventory data is unavailable.',
    },
    {
      id: 'production_smoothing',
      label: 'Production Smoothing (Ramp)',
      unit: 'units',
      description: 'Total period-to-period absolute change in production quantities.',
      direction: 'minimize',
      selected: hasSmooth,
      weight: hasSmooth ? 15 : 0,
      available: hasSmooth,
      disabledReason: hasSmooth
        ? null
        : 'Production schedule across >= 2 periods is required.',
    },
  ];
}

export function validateCriteriaAndWeights(
  criteria: RecommendationCriterionConfig[]
): string | null {
  const active = criteria.filter((c) => c.selected && c.available);
  if (active.length === 0) {
    return 'Select at least one available decision criterion.';
  }
  for (const c of active) {
    if (!Number.isFinite(c.weight) || c.weight < 0) {
      return `Weight for '${c.label}' must be a finite non-negative number.`;
    }
  }
  const sum = active.reduce((acc, c) => acc + c.weight, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    return 'At least one selected criterion must have a positive preference weight (> 0).';
  }
  return null;
}

export function normalizeCriteriaWeights(
  criteria: RecommendationCriterionConfig[]
): Record<RecommendationCriterionId, number> {
  const active = criteria.filter((c) => c.selected && c.available && Number.isFinite(c.weight) && c.weight >= 0);
  const total = active.reduce((acc, c) => acc + c.weight, 0);
  const result: Record<RecommendationCriterionId, number> = {
    primary_objective: 0,
    peak_utilization: 0,
    cumulative_inventory: 0,
    production_smoothing: 0,
  };
  if (total <= 0) return result;
  for (const c of active) {
    result[c.id] = c.weight / total;
  }
  return result;
}

export function normalizeCriterionValues(
  values: number[],
  direction: CriterionDirection
): number[] {
  if (values.length === 0) return [];
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = maxVal - minVal;
  if (!Number.isFinite(span) || span <= 1e-12) {
    return values.map(() => 1.0);
  }
  return values.map((v) => {
    const raw =
      direction === 'minimize' ? (maxVal - v) / span : (v - minVal) / span;
    return Math.min(1.0, Math.max(0.0, raw));
  });
}

export interface RankedCriterionBreakdown {
  criterionId: RecommendationCriterionId;
  label: string;
  unit: string;
  direction: CriterionDirection;
  rawValue: number;
  normalizedScore: number;
  normalizedWeight: number;
  weightedContribution: number;
}

export interface RankedCandidateResult {
  rank: number;
  candidate: TradeoffCandidateResult;
  totalScore: number;
  breakdowns: RankedCriterionBreakdown[];
}

export interface RankingEngineOutput {
  valid: boolean;
  error: string | null;
  normalizedWeights: Record<RecommendationCriterionId, number>;
  ranked: RankedCandidateResult[];
}

export function rankAlternatives(params: {
  eligible: TradeoffCandidateResult[];
  criteria: RecommendationCriterionConfig[];
  objectiveSense: string;
  tradeoffCriterion?: string;
}): RankingEngineOutput {
  const { eligible, criteria, objectiveSense, tradeoffCriterion } = params;
  if (eligible.length < 2) {
    return {
      valid: false,
      error: 'At least 2 eligible verified candidates are required for ranking.',
      normalizedWeights: normalizeCriteriaWeights([]),
      ranked: [],
    };
  }

  const valErr = validateCriteriaAndWeights(criteria);
  if (valErr) {
    return {
      valid: false,
      error: valErr,
      normalizedWeights: normalizeCriteriaWeights([]),
      ranked: [],
    };
  }

  const active = criteria.filter((c) => c.selected && c.available);
  const normWeights = normalizeCriteriaWeights(criteria);

  // Extract & verify all active criteria values for all eligible candidates
  const perCriterionScores = new Map<RecommendationCriterionId, number[]>();
  const perCriterionRaw = new Map<RecommendationCriterionId, number[]>();

  for (const crit of active) {
    const rawVals: number[] = [];
    for (const cand of eligible) {
      const val = extractCriterionValue(cand, crit.id, tradeoffCriterion);
      if (val === null || !Number.isFinite(val)) {
        return {
          valid: false,
          error: `Metric '${crit.label}' is missing or non-finite for candidate '${cand.candidate_id}'.`,
          normalizedWeights: normWeights,
          ranked: [],
        };
      }
      rawVals.push(val);
    }
    perCriterionRaw.set(crit.id, rawVals);
    perCriterionScores.set(crit.id, normalizeCriterionValues(rawVals, crit.direction));
  }

  const unsorted: RankedCandidateResult[] = eligible.map((cand, idx) => {
    let totalScore = 0;
    const breakdowns: RankedCriterionBreakdown[] = active.map((crit) => {
      const rawValue = perCriterionRaw.get(crit.id)![idx];
      const normalizedScore = perCriterionScores.get(crit.id)![idx];
      const normalizedWeight = normWeights[crit.id];
      const weightedContribution = normalizedWeight * normalizedScore;
      totalScore += weightedContribution;
      return {
        criterionId: crit.id,
        label: crit.label,
        unit: crit.unit,
        direction: crit.direction,
        rawValue,
        normalizedScore,
        normalizedWeight,
        weightedContribution,
      };
    });

    return {
      rank: 0,
      candidate: cand,
      totalScore,
      breakdowns,
    };
  });

  const isMinimizeObj = objectiveSense.toLowerCase().startsWith('min');
  unsorted.sort((a, b) => {
    if (Math.abs(b.totalScore - a.totalScore) > 1e-9) {
      return b.totalScore - a.totalScore;
    }
    const objA = a.candidate.objective_value ?? 0;
    const objB = b.candidate.objective_value ?? 0;
    if (Math.abs(objA - objB) > 1e-9) {
      return isMinimizeObj ? objA - objB : objB - objA;
    }
    if (a.candidate.is_baseline !== b.candidate.is_baseline) {
      return a.candidate.is_baseline ? -1 : 1;
    }
    return a.candidate.candidate_id.localeCompare(b.candidate.candidate_id);
  });

  const ranked = unsorted.map((item, idx) => ({ ...item, rank: idx + 1 }));

  return {
    valid: true,
    error: null,
    normalizedWeights: normWeights,
    ranked,
  };
}

export interface RecommendationExplanation {
  headline: string;
  strengths: string[];
  compromises: string[];
  statusNote: string;
  limitations: string[];
}

export function buildRecommendationExplanation(
  ranked: RankedCandidateResult[],
  excludedDuplicatesCount: number,
  excludedUnverifiedCount: number
): RecommendationExplanation | null {
  if (ranked.length === 0) return null;
  const top = ranked[0];
  const cand = top.candidate;

  const objStr = formatNumberOrNull(cand.objective_value, 2);
  const pctStr =
    cand.objective_pct_change !== null
      ? ` (${cand.objective_pct_change >= 0 ? '+' : ''}${cand.objective_pct_change.toFixed(2)}% vs. baseline)`
      : '';

  const headline = `Recommended under your current preferences: ${cand.candidate_id}${cand.is_baseline ? ' (Baseline)' : ''} with preference score ${(top.totalScore * 100).toFixed(1)} / 100 and original objective ${objStr}${pctStr}.`;

  const strengths: string[] = [];
  const compromises: string[] = [];

  for (const bd of top.breakdowns) {
    if (bd.normalizedWeight <= 0) continue;
    const allScores = ranked.map(
      (r) => r.breakdowns.find((b) => b.criterionId === bd.criterionId)?.normalizedScore ?? 0
    );
    const maxScore = Math.max(...allScores);
    if (bd.normalizedScore >= maxScore - 1e-6) {
      strengths.push(
        `Strongest (or tied strongest) on ${bd.label}: ${formatNumberOrNull(bd.rawValue, 2, bd.unit ? ` ${bd.unit}` : '')} (contribution ${(bd.weightedContribution * 100).toFixed(1)} pts).`
      );
    } else {
      const bestItem = ranked.find(
        (r) =>
          (r.breakdowns.find((b) => b.criterionId === bd.criterionId)?.normalizedScore ?? 0) >=
          maxScore - 1e-6
      );
      const bestRaw = bestItem?.breakdowns.find((b) => b.criterionId === bd.criterionId)?.rawValue;
      compromises.push(
        `Not strongest on ${bd.label}: achieves ${formatNumberOrNull(bd.rawValue, 2, bd.unit ? ` ${bd.unit}` : '')} vs. ${bestItem?.candidate.candidate_id}'s ${formatNumberOrNull(bestRaw, 2, bd.unit ? ` ${bd.unit}` : '')}.`
      );
    }
  }

  const statusNote = cand.is_baseline
    ? 'This top-ranked plan is the original baseline optimal solution.'
    : `This alternative differs from baseline objective by ${formatNumberOrNull(cand.objective_diff, 4)} with ${formatNumberOrNull(cand.plan_shift_pct, 2, '%')} L1 production plan shift.`;

  const limitations: string[] = [RECOMMENDATION_METHOD_DISCLOSURE];
  if (excludedDuplicatesCount > 0) {
    limitations.push(
      `${excludedDuplicatesCount} duplicate candidate plan(s) were excluded so identical solutions are not double-counted.`
    );
  }
  if (excludedUnverifiedCount > 0) {
    limitations.push(
      `${excludedUnverifiedCount} unverified/incomplete candidate(s) were excluded from ranking.`
    );
  }

  return {
    headline,
    strengths,
    compromises,
    statusNote,
    limitations,
  };
}

export interface PairwiseCriterionComparisonRow {
  criterionId: RecommendationCriterionId;
  label: string;
  unit: string;
  valueA: number;
  valueB: number;
  deltaBMinusA: number;
  normScoreA: number;
  normScoreB: number;
  contribA: number;
  contribB: number;
}

export function buildPairwiseComparison(
  itemA: RankedCandidateResult,
  itemB: RankedCandidateResult
): PairwiseCriterionComparisonRow[] {
  return itemA.breakdowns.map((bdA) => {
    const bdB = itemB.breakdowns.find((b) => b.criterionId === bdA.criterionId)!;
    return {
      criterionId: bdA.criterionId,
      label: bdA.label,
      unit: bdA.unit,
      valueA: bdA.rawValue,
      valueB: bdB.rawValue,
      deltaBMinusA: Number((bdB.rawValue - bdA.rawValue).toFixed(6)),
      normScoreA: bdA.normalizedScore,
      normScoreB: bdB.normalizedScore,
      contribA: bdA.weightedContribution,
      contribB: bdB.weightedContribution,
    };
  });
}

export function buildRankedScoreChart(ranked: RankedCandidateResult[]): {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
} {
  const labels = ranked.map(
    (r) => `#${r.rank} ${r.candidate.candidate_id}`
  );
  const scores = ranked.map((r) => Number((r.totalScore * 100).toFixed(2)));
  const colors = ranked.map((r, idx) =>
    idx === 0 ? '#2563eb' : r.candidate.is_baseline ? '#0f172a' : '#64748b'
  );

  return {
    data: [
      {
        x: labels,
        y: scores,
        type: 'bar',
        marker: { color: colors },
        hovertemplate: '%{x}<br>Preference Score: %{y:.1f} / 100<extra></extra>',
      },
    ],
    layout: {
      xaxis: { title: { text: 'Eligible Candidate (Ranked)', standoff: 8 } },
      yaxis: {
        title: { text: 'Preference Score (0–100)', standoff: 8 },
        range: [0, 105],
        gridcolor: '#f1f5f9',
        automargin: true,
      },
      margin: { t: 24, r: 16, b: 64, l: 56 },
    },
  };
}

export function buildContributionChart(ranked: RankedCandidateResult[]): {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
} {
  if (ranked.length === 0) return { data: [], layout: {} };
  const labels = ranked.map(
    (r) => `#${r.rank} ${r.candidate.candidate_id}`
  );
  const palette = ['#2563eb', '#0f766e', '#d97706', '#7c3aed'];
  const activeBreakdowns = ranked[0].breakdowns.filter((b) => b.normalizedWeight > 0);

  const data = activeBreakdowns.map((bd, idx) => ({
    x: labels,
    y: ranked.map((r) => {
      const match = r.breakdowns.find((b) => b.criterionId === bd.criterionId);
      return Number(((match?.weightedContribution ?? 0) * 100).toFixed(2));
    }),
    type: 'bar',
    name: bd.label,
    marker: { color: palette[idx % palette.length] },
    hovertemplate: `${bd.label}<br>%{x}: %{y:.1f} pts<extra></extra>`,
  }));

  return {
    data,
    layout: {
      barmode: 'stack',
      xaxis: { title: { text: 'Ranked Candidate', standoff: 8 } },
      yaxis: {
        title: { text: 'Score Points', standoff: 8 },
        range: [0, 105],
        gridcolor: '#f1f5f9',
        automargin: true,
      },
      legend: { orientation: 'h', x: 0, xanchor: 'left', y: -0.32, yanchor: 'top' },
      margin: { t: 28, r: 16, b: 92, l: 56 },
    },
  };
}

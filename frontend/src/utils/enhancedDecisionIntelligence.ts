import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  RecommendationCriterionConfig,
  RecommendationCriterionId,
  SensitivityContextMeta,
  SensitivitySweepResponse,
  TradeoffCandidateResult,
  TradeoffContextMeta,
  TradeoffExploreResponse,
} from '../types/or';
import { rankAlternatives } from './decisionRecommendation.ts';
import {
  PLAN_SHIFT_MODERATE_THRESHOLD_PCT,
  checkBaselineConsistency,
  getMappingSignature,
} from './sensitivityAnalysis.ts';
import { checkTradeoffBaselineConsistency } from './tradeoffExplorer.ts';

export const BINDING_SLACK_TOLERANCE = 1e-5;
export const NEAR_BINDING_UTILIZATION_PCT = 90.0;
export const PREFERENCE_PERTURBATION_FRACTION = 0.2;

export type BottleneckClassification = 'binding' | 'near_binding' | 'slack' | 'invalid';

export interface BottleneckObservation {
  resource: string;
  period: string;
  capacity: number | null;
  used: number | null;
  remaining: number | null;
  utilizationPct: number | null;
  classification: BottleneckClassification;
  evidence: string;
}

export interface BottleneckGroupSummary {
  key: string;
  bindingCount: number;
  nearBindingCount: number;
  slackCount: number;
  validObservations: number;
  peakUtilizationPct: number | null;
  minRemainingCapacity: number | null;
}

export interface BottleneckAnalysisResult {
  available: boolean;
  reason: string | null;
  observations: BottleneckObservation[];
  resourceSummaries: BottleneckGroupSummary[];
  periodSummaries: BottleneckGroupSummary[];
  bindingCount: number;
  nearBindingCount: number;
  slackCount: number;
  invalidCount: number;
  peakUtilizationPct: number | null;
  limitationNote: string;
}

const BOTTLENECK_LIMITATION_NOTE =
  'Binding classification uses primal capacity slack (<= 1e-5) and near-binding uses a heuristic >= 90% utilization threshold. PuLP CBC outputs do not include LP duals, shadow prices, reduced costs, or marginal economic values.';

export function analyzeBottlenecks(
  solution: MultiPeriodSolveResponse | null
): BottleneckAnalysisResult {
  if (!solution) {
    return {
      available: false,
      reason: 'No Multi-Period solution is available.',
      observations: [],
      resourceSummaries: [],
      periodSummaries: [],
      bindingCount: 0,
      nearBindingCount: 0,
      slackCount: 0,
      invalidCount: 0,
      peakUtilizationPct: null,
      limitationNote: BOTTLENECK_LIMITATION_NOTE,
    };
  }
  if (!solution.is_optimal || !solution.constraints_feasible) {
    return {
      available: false,
      reason: `Bottleneck analysis requires an optimal, verified-feasible solution (status: '${solution.status}').`,
      observations: [],
      resourceSummaries: [],
      periodSummaries: [],
      bindingCount: 0,
      nearBindingCount: 0,
      slackCount: 0,
      invalidCount: 0,
      peakUtilizationPct: null,
      limitationNote: BOTTLENECK_LIMITATION_NOTE,
    };
  }

  const rawRows = solution.resource_utilization ?? [];
  if (rawRows.length === 0) {
    return {
      available: false,
      reason: 'No resource capacity utilization records are present (Capacity may not be mapped).',
      observations: [],
      resourceSummaries: [],
      periodSummaries: [],
      bindingCount: 0,
      nearBindingCount: 0,
      slackCount: 0,
      invalidCount: 0,
      peakUtilizationPct: null,
      limitationNote: BOTTLENECK_LIMITATION_NOTE,
    };
  }

  const observations: BottleneckObservation[] = rawRows.map((row) => {
    const resource = String(row.resource ?? '').trim();
    const period = String(row.period ?? '').trim();
    const cap = row.capacity !== null && row.capacity !== undefined ? Number(row.capacity) : NaN;
    const used = row.used !== null && row.used !== undefined ? Number(row.used) : NaN;
    const pct =
      row.utilization_pct !== null && row.utilization_pct !== undefined
        ? Number(row.utilization_pct)
        : NaN;

    if (
      !resource ||
      !period ||
      !Number.isFinite(cap) ||
      cap <= 0 ||
      !Number.isFinite(used) ||
      used < -BINDING_SLACK_TOLERANCE ||
      !Number.isFinite(pct) ||
      pct < -1e-4
    ) {
      return {
        resource: resource || 'Unknown',
        period: period || 'Unknown',
        capacity: Number.isFinite(cap) ? cap : null,
        used: Number.isFinite(used) ? used : null,
        remaining: null,
        utilizationPct: Number.isFinite(pct) ? pct : null,
        classification: 'invalid',
        evidence: 'Invalid or non-positive capacity/utilization record; excluded from binding counts.',
      };
    }

    const slack = cap - used;
    const remaining = Math.max(0, Number(slack.toFixed(6)));
    let classification: BottleneckClassification;
    let evidence: string;

    if (slack < -BINDING_SLACK_TOLERANCE) {
      return {
        resource,
        period,
        capacity: cap,
        used,
        remaining: 0,
        utilizationPct: pct,
        classification: 'invalid',
        evidence: `Negative capacity slack (${slack.toFixed(6)}); excluded as invalid observation.`,
      };
    } else if (slack <= BINDING_SLACK_TOLERANCE) {
      classification = 'binding';
      evidence = `Primal capacity slack is ${remaining} <= ${BINDING_SLACK_TOLERANCE} (${pct.toFixed(2)}% used of ${cap}).`;
    } else if (pct >= NEAR_BINDING_UTILIZATION_PCT) {
      classification = 'near_binding';
      evidence = `Utilization ${pct.toFixed(2)}% >= ${NEAR_BINDING_UTILIZATION_PCT}% heuristic threshold (remaining capacity: ${remaining}).`;
    } else {
      classification = 'slack';
      evidence = `Utilization ${pct.toFixed(2)}% < ${NEAR_BINDING_UTILIZATION_PCT}% (remaining capacity: ${remaining}).`;
    }

    return {
      resource,
      period,
      capacity: cap,
      used,
      remaining,
      utilizationPct: pct,
      classification,
      evidence,
    };
  });

  const buildGroups = (keyFn: (o: BottleneckObservation) => string): BottleneckGroupSummary[] => {
    const map = new Map<string, BottleneckObservation[]>();
    for (const obs of observations) {
      if (obs.classification === 'invalid') continue;
      const k = keyFn(obs);
      const list = map.get(k) ?? [];
      list.push(obs);
      map.set(k, list);
    }
    const groups: BottleneckGroupSummary[] = [];
    for (const [key, list] of map.entries()) {
      const utils = list
        .map((o) => o.utilizationPct)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      const rems = list
        .map((o) => o.remaining)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      groups.push({
        key,
        bindingCount: list.filter((o) => o.classification === 'binding').length,
        nearBindingCount: list.filter((o) => o.classification === 'near_binding').length,
        slackCount: list.filter((o) => o.classification === 'slack').length,
        validObservations: list.length,
        peakUtilizationPct: utils.length > 0 ? Math.max(...utils) : null,
        minRemainingCapacity: rems.length > 0 ? Math.min(...rems) : null,
      });
    }
    return groups.sort((a, b) => {
      if (b.bindingCount !== a.bindingCount) return b.bindingCount - a.bindingCount;
      if (b.nearBindingCount !== a.nearBindingCount) return b.nearBindingCount - a.nearBindingCount;
      return (b.peakUtilizationPct ?? -1) - (a.peakUtilizationPct ?? -1);
    });
  };

  const validObs = observations.filter((o) => o.classification !== 'invalid');
  const validUtils = validObs
    .map((o) => o.utilizationPct)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  return {
    available: validObs.length > 0,
    reason: validObs.length > 0 ? null : 'All capacity utilization records were invalid.',
    observations,
    resourceSummaries: buildGroups((o) => o.resource),
    periodSummaries: buildGroups((o) => o.period),
    bindingCount: validObs.filter((o) => o.classification === 'binding').length,
    nearBindingCount: validObs.filter((o) => o.classification === 'near_binding').length,
    slackCount: validObs.filter((o) => o.classification === 'slack').length,
    invalidCount: observations.filter((o) => o.classification === 'invalid').length,
    peakUtilizationPct: validUtils.length > 0 ? Math.max(...validUtils) : null,
    limitationNote: BOTTLENECK_LIMITATION_NOTE,
  };
}

export interface SensitivityFreshnessResult {
  valid: boolean;
  reason: string | null;
}

export function validateSensitivityFreshness(params: {
  dataset: DatasetSummary | null;
  mpMapping: MultiPeriodColumnMapping | null;
  mpSolution: MultiPeriodSolveResponse | null;
  mpIntegerProd: boolean;
  mpCapacityScope: 'auto' | 'per_product' | 'aggregate_period';
  mpSolutionMappingSignature: string | null;
  sensitivityResult: SensitivitySweepResponse | null;
  sensitivityMeta: SensitivityContextMeta | null;
}): SensitivityFreshnessResult {
  const {
    dataset,
    mpMapping,
    mpSolution,
    mpIntegerProd,
    mpCapacityScope,
    mpSolutionMappingSignature,
    sensitivityResult,
    sensitivityMeta,
  } = params;

  const baseCheck = checkBaselineConsistency({
    dataset,
    mpMapping,
    mpSolution,
    mpIntegerProd,
    mpCapacityScope,
    mpSolutionMappingSignature,
  });
  if (!baseCheck.ready) {
    return { valid: false, reason: baseCheck.reason };
  }

  if (!sensitivityResult || !sensitivityMeta) {
    return {
      valid: false,
      reason: 'Sensitivity sweep results or freshness metadata are not available.',
    };
  }

  const activeSig = getMappingSignature(mpMapping);
  if (
    sensitivityResult.dataset_id !== dataset?.dataset_id ||
    sensitivityMeta.datasetId !== dataset?.dataset_id
  ) {
    return {
      valid: false,
      reason: 'Sensitivity sweep belongs to a different dataset and was suppressed.',
    };
  }
  if (sensitivityMeta.mappingSignature !== activeSig) {
    return {
      valid: false,
      reason: 'Sensitivity sweep was generated under an older column mapping and was suppressed.',
    };
  }
  if (
    sensitivityMeta.integerProd !== mpIntegerProd ||
    sensitivityMeta.capacityScope !== mpCapacityScope
  ) {
    return {
      valid: false,
      reason: 'Sensitivity sweep does not match the active solver configuration and was suppressed.',
    };
  }
  if (
    sensitivityMeta.baselineObjective !== mpSolution?.objective_value ||
    sensitivityMeta.baselineStatus !== mpSolution?.status
  ) {
    return {
      valid: false,
      reason: 'Sensitivity sweep does not match the active baseline solution and was suppressed.',
    };
  }
  if (
    !sensitivityResult.summary ||
    !Array.isArray(sensitivityResult.points) ||
    !Number.isFinite(sensitivityResult.summary.feasibility_rate_pct)
  ) {
    return {
      valid: false,
      reason: 'Sensitivity sweep payload is incomplete or malformed.',
    };
  }
  return { valid: true, reason: null };
}

export interface SensitivityRiskSummary {
  available: boolean;
  reason: string | null;
  testedParameter: string | null;
  testedMinMultiplier: number | null;
  testedMaxMultiplier: number | null;
  testedPoints: number;
  feasiblePoints: number;
  infeasiblePoints: number;
  incompletePoints: number;
  observedFeasibilityRatePct: number | null;
  firstInfeasibleMultiplier: number | null;
  observedFeasibleObjectiveRange: number | null;
  maxObservedPlanShiftPct: number | null;
  budgetExhausted: boolean;
  disclosure: string;
}

export interface TradeoffSummarySnapshot {
  available: boolean;
  reason: string | null;
  criterion: string | null;
  criterionLabel: string | null;
  distinctAlternatives: number;
  duplicateCount: number;
  incompleteCount: number;
  bestCriterionValue: number | null;
  criterionImprovement: number | null;
}

export interface CrossModuleRiskResult {
  sensitivityRisk: SensitivityRiskSummary;
  tradeoffSnapshot: TradeoffSummarySnapshot;
}

const SENSITIVITY_RISK_DISCLOSURE =
  'Empirical grid observations cover only the single tested parameter and discrete multiplier range; they do not represent probability distributions or multi-parameter robustness guarantees.';

export function analyzeCrossModuleRisk(params: {
  dataset: DatasetSummary | null;
  mpMapping: MultiPeriodColumnMapping | null;
  mpSolution: MultiPeriodSolveResponse | null;
  mpIntegerProd: boolean;
  mpCapacityScope: 'auto' | 'per_product' | 'aggregate_period';
  mpSolutionMappingSignature: string | null;
  sensitivityResult: SensitivitySweepResponse | null;
  sensitivityMeta: SensitivityContextMeta | null;
  tradeoffResult: TradeoffExploreResponse | null;
  tradeoffMeta: TradeoffContextMeta | null;
}): CrossModuleRiskResult {
  const sensFresh = validateSensitivityFreshness(params);
  let sensitivityRisk: SensitivityRiskSummary;

  if (!sensFresh.valid || !params.sensitivityResult) {
    sensitivityRisk = {
      available: false,
      reason: sensFresh.reason,
      testedParameter: null,
      testedMinMultiplier: null,
      testedMaxMultiplier: null,
      testedPoints: 0,
      feasiblePoints: 0,
      infeasiblePoints: 0,
      incompletePoints: 0,
      observedFeasibilityRatePct: null,
      firstInfeasibleMultiplier: null,
      observedFeasibleObjectiveRange: null,
      maxObservedPlanShiftPct: null,
      budgetExhausted: false,
      disclosure: SENSITIVITY_RISK_DISCLOSURE,
    };
  } else {
    const sr = params.sensitivityResult;
    const s = sr.summary;
    const gc = sr.grid_config;
    sensitivityRisk = {
      available: true,
      reason: null,
      testedParameter: sr.parameter,
      testedMinMultiplier: Number.isFinite(gc.min_multiplier) ? gc.min_multiplier : null,
      testedMaxMultiplier: Number.isFinite(gc.max_multiplier) ? gc.max_multiplier : null,
      testedPoints: s.total_grid_points,
      feasiblePoints: s.feasible_optimal_count,
      infeasiblePoints: s.infeasible_count,
      incompletePoints: s.incomplete_or_error_count,
      observedFeasibilityRatePct: s.feasibility_rate_pct,
      firstInfeasibleMultiplier: s.first_infeasible_multiplier,
      observedFeasibleObjectiveRange: s.objective_range,
      maxObservedPlanShiftPct: s.max_plan_shift_pct,
      budgetExhausted: gc.budget_exhausted,
      disclosure: SENSITIVITY_RISK_DISCLOSURE,
    };
  }

  const baseTradeoffCheck = checkTradeoffBaselineConsistency({
    dataset: params.dataset,
    mpMapping: params.mpMapping,
    mpSolution: params.mpSolution,
    mpIntegerProd: params.mpIntegerProd,
    mpCapacityScope: params.mpCapacityScope,
    mpSolutionMappingSignature: params.mpSolutionMappingSignature,
  });

  const activeSig = getMappingSignature(params.mpMapping);
  const tr = params.tradeoffResult;
  const tm = params.tradeoffMeta;
  const tradeoffValid = Boolean(
    baseTradeoffCheck.ready &&
      tr &&
      tm &&
      tr.dataset_id === params.dataset?.dataset_id &&
      tm.datasetId === params.dataset?.dataset_id &&
      tm.mappingSignature === activeSig &&
      tm.integerProd === params.mpIntegerProd &&
      tm.capacityScope === params.mpCapacityScope
  );

  const tradeoffSnapshot: TradeoffSummarySnapshot =
    tradeoffValid && tr
      ? {
          available: true,
          reason: null,
          criterion: tr.criterion,
          criterionLabel: tr.summary.criterion_label,
          distinctAlternatives: tr.summary.distinct_feasible_count,
          duplicateCount: tr.summary.duplicate_count,
          incompleteCount: tr.summary.incomplete_or_error_count,
          bestCriterionValue: tr.summary.best_criterion_value,
          criterionImprovement: tr.summary.criterion_improvement,
        }
      : {
          available: false,
          reason: !baseTradeoffCheck.ready
            ? baseTradeoffCheck.reason
            : 'No fresh trade-off exploration results are available for the active configuration.',
          criterion: null,
          criterionLabel: null,
          distinctAlternatives: 0,
          duplicateCount: 0,
          incompleteCount: 0,
          bestCriterionValue: null,
          criterionImprovement: null,
        };

  return { sensitivityRisk, tradeoffSnapshot };
}

export interface PreferencePerturbationResult {
  criterionId: RecommendationCriterionId;
  criterionLabel: string;
  perturbationLabel: '-20%' | '+20%';
  topCandidateId: string;
  topScore: number;
  retainedOriginalWinner: boolean;
}

export interface PreferenceRankStabilityResult {
  available: boolean;
  reason: string | null;
  originalTopCandidateId: string | null;
  originalTopScore: number | null;
  perturbationsTested: number;
  retainedCount: number;
  winnerChangesCount: number;
  observedAlternativeWinners: string[];
  stabilityClass: 'stable' | 'sensitive' | 'unavailable';
  perturbations: PreferencePerturbationResult[];
  methodologyNote: string;
  disclosure: string;
}

const PREF_METHODOLOGY_NOTE =
  'Each active criterion with positive weight is perturbed independently by -20% and +20%, renormalized to 100%, and re-scored with rankAlternatives over the same verified eligible candidate set.';
const PREF_DISCLOSURE =
  'Local weight perturbation stability tests sensitivity of the current ranking to ±20% preference changes; it is not a probability, statistical confidence score, or formal Pareto guarantee.';

export function analyzePreferenceStability(params: {
  eligible: TradeoffCandidateResult[];
  criteria: RecommendationCriterionConfig[];
  objectiveSense: string;
  tradeoffCriterion?: string;
}): PreferenceRankStabilityResult {
  const { eligible, criteria, objectiveSense, tradeoffCriterion } = params;

  const baseRanking = rankAlternatives({
    eligible,
    criteria,
    objectiveSense,
    tradeoffCriterion,
  });

  if (!baseRanking.valid || baseRanking.ranked.length < 2) {
    return {
      available: false,
      reason: baseRanking.error ?? 'At least 2 distinct eligible plans are required.',
      originalTopCandidateId: null,
      originalTopScore: null,
      perturbationsTested: 0,
      retainedCount: 0,
      winnerChangesCount: 0,
      observedAlternativeWinners: [],
      stabilityClass: 'unavailable',
      perturbations: [],
      methodologyNote: PREF_METHODOLOGY_NOTE,
      disclosure: PREF_DISCLOSURE,
    };
  }

  const originalTop = baseRanking.ranked[0];
  const originalTopId = originalTop.candidate.candidate_id;
  const activePositive = criteria.filter(
    (c) => c.selected && c.available && Number.isFinite(c.weight) && c.weight > 0
  );

  const perturbations: PreferencePerturbationResult[] = [];
  const altWinners = new Set<string>();

  for (const target of activePositive) {
    for (const [label, factor] of [
      ['-20%', 1 - PREFERENCE_PERTURBATION_FRACTION],
      ['+20%', 1 + PREFERENCE_PERTURBATION_FRACTION],
    ] as const) {
      const perturbedCriteria = criteria.map((c) =>
        c.id === target.id ? { ...c, weight: Number((c.weight * factor).toFixed(6)) } : c
      );
      const res = rankAlternatives({
        eligible,
        criteria: perturbedCriteria,
        objectiveSense,
        tradeoffCriterion,
      });
      if (!res.valid || res.ranked.length === 0) continue;
      const winner = res.ranked[0];
      const winnerId = winner.candidate.candidate_id;
      const retained = winnerId === originalTopId;
      if (!retained) altWinners.add(winnerId);

      perturbations.push({
        criterionId: target.id,
        criterionLabel: target.label,
        perturbationLabel: label,
        topCandidateId: winnerId,
        topScore: winner.totalScore,
        retainedOriginalWinner: retained,
      });
    }
  }

  const retainedCount = perturbations.filter((p) => p.retainedOriginalWinner).length;
  const winnerChangesCount = perturbations.length - retainedCount;

  return {
    available: perturbations.length > 0,
    reason: perturbations.length > 0 ? null : 'No positive-weight criteria available to perturb.',
    originalTopCandidateId: originalTopId,
    originalTopScore: originalTop.totalScore,
    perturbationsTested: perturbations.length,
    retainedCount,
    winnerChangesCount,
    observedAlternativeWinners: Array.from(altWinners),
    stabilityClass: winnerChangesCount === 0 ? 'stable' : 'sensitive',
    perturbations,
    methodologyNote: PREF_METHODOLOGY_NOTE,
    disclosure: PREF_DISCLOSURE,
  };
}

export type InsightEvidenceStrength =
  | 'mathematically_verified'
  | 'empirical_grid'
  | 'heuristic_threshold';

export interface ActionableInsight {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  evidence: string;
  explanation: string;
  suggestedAction: string;
  metric: string | null;
  sourceModule: 'multi-period' | 'sensitivity' | 'trade-offs' | 'recommendation';
  evidenceStrength: InsightEvidenceStrength;
  limitations: string;
  route: string;
}

export function buildActionableInsights(params: {
  bottlenecks: BottleneckAnalysisResult;
  crossModuleRisk: CrossModuleRiskResult;
  preferenceStability?: PreferenceRankStabilityResult | null;
}): ActionableInsight[] {
  const { bottlenecks, crossModuleRisk, preferenceStability } = params;
  const insights: ActionableInsight[] = [];
  const seenIds = new Set<string>();

  const pushUnique = (item: ActionableInsight) => {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    insights.push(item);
  };

  if (bottlenecks.available) {
    if (bottlenecks.bindingCount > 0) {
      const topRes = bottlenecks.resourceSummaries.find((r) => r.bindingCount > 0);
      pushUnique({
        id: 'bottleneck-binding-capacity',
        title: `${bottlenecks.bindingCount} Binding Capacity Constraint(s) Observed`,
        severity: 'warning',
        evidence: `${bottlenecks.bindingCount} valid resource-period observation(s) have primal slack <= ${BINDING_SLACK_TOLERANCE}${topRes ? ` (tightest resource: ${topRes.key} with ${topRes.bindingCount} binding period(s))` : ''}.`,
        explanation:
          'Production or setup load equals available capacity in these periods under the current baseline solution.',
        suggestedAction:
          'Inspect Peak Capacity Utilization in Trade-off Explorer or test capacity increases in Sensitivity Analysis.',
        metric: `${bottlenecks.bindingCount} binding`,
        sourceModule: 'multi-period',
        evidenceStrength: 'mathematically_verified',
        limitations:
          'Primal capacity slack only; does not establish LP shadow prices or economic marginal values.',
        route: '/trade-offs',
      });
    } else if (bottlenecks.nearBindingCount > 0) {
      pushUnique({
        id: 'bottleneck-near-binding',
        title: `${bottlenecks.nearBindingCount} Near-Binding Capacity Period(s) (>=90%)`,
        severity: 'info',
        evidence: `${bottlenecks.nearBindingCount} observation(s) exceed ${NEAR_BINDING_UTILIZATION_PCT}% utilization without hitting zero slack (peak: ${bottlenecks.peakUtilizationPct?.toFixed(2) ?? 'N/A'}%).`,
        explanation:
          'These periods operate close to capacity limits under a 90% heuristic threshold.',
        suggestedAction:
          'Consider testing demand increases in Sensitivity Analysis to observe when capacity becomes infeasible.',
        metric: `${bottlenecks.peakUtilizationPct?.toFixed(1) ?? 'N/A'}% peak`,
        sourceModule: 'multi-period',
        evidenceStrength: 'heuristic_threshold',
        limitations:
          '90% is a heuristic warning threshold rather than a binding mathematical proof.',
        route: '/sensitivity',
      });
    }
  }

  const sr = crossModuleRisk.sensitivityRisk;
  if (sr.available && sr.testedParameter) {
    if (sr.infeasiblePoints > 0) {
      pushUnique({
        id: 'sensitivity-infeasibility-risk',
        title: `Observed Infeasibility Under ${sr.testedParameter} Sweep`,
        severity: 'warning',
        evidence: `${sr.infeasiblePoints} of ${sr.testedPoints} tested grid points were infeasible (feasibility rate ${sr.observedFeasibilityRatePct?.toFixed(1) ?? 'N/A'}%${sr.firstInfeasibleMultiplier !== null ? `; first infeasible at ${sr.firstInfeasibleMultiplier.toFixed(2)}x` : ''}).`,
        explanation:
          `Within the tested ${sr.testedParameter} range (${sr.testedMinMultiplier?.toFixed(2)}x–${sr.testedMaxMultiplier?.toFixed(2)}x), no feasible schedule satisfied all constraints at those grid points.`,
        suggestedAction:
          'Review capacity headroom or demand exposure on the Sensitivity Analysis curve.',
        metric: `${sr.observedFeasibilityRatePct?.toFixed(1) ?? 'N/A'}% feasible`,
        sourceModule: 'sensitivity',
        evidenceStrength: 'empirical_grid',
        limitations:
          'Applies strictly to the discrete tested single-parameter grid; not a probability or multi-parameter guarantee.',
        route: '/sensitivity',
      });
    }
    if (sr.incompletePoints > 0 || sr.budgetExhausted) {
      pushUnique({
        id: 'sensitivity-incomplete-runs',
        title: 'Incomplete Sensitivity Grid Execution',
        severity: 'warning',
        evidence: `${sr.incompletePoints} tested grid point(s) did not complete as verified optimal or infeasible${sr.budgetExhausted ? ' (execution budget exhausted)' : ''}.`,
        explanation:
          'Feasibility and objective metrics exclude unverified points.',
        suggestedAction:
          'Re-run with fewer sweep points or a narrower multiplier range for complete coverage.',
        metric: `${sr.incompletePoints} incomplete`,
        sourceModule: 'sensitivity',
        evidenceStrength: 'empirical_grid',
        limitations: 'Unverified points cannot confirm feasibility or infeasibility.',
        route: '/sensitivity',
      });
    }
    if (
      sr.maxObservedPlanShiftPct !== null &&
      sr.maxObservedPlanShiftPct > PLAN_SHIFT_MODERATE_THRESHOLD_PCT
    ) {
      pushUnique({
        id: 'sensitivity-high-plan-shift',
        title: `Substantial Schedule Sensitivity to ${sr.testedParameter}`,
        severity: 'info',
        evidence: `Max normalized L1 plan shift reached ${sr.maxObservedPlanShiftPct.toFixed(2)}% (> ${PLAN_SHIFT_MODERATE_THRESHOLD_PCT}% threshold).`,
        explanation:
          'Optimal production quantities changed substantially across the tested parameter multipliers.',
        suggestedAction:
          'Use Production Smoothing in Trade-off Explorer to inspect flatter schedule alternatives.',
        metric: `${sr.maxObservedPlanShiftPct.toFixed(1)}% shift`,
        sourceModule: 'sensitivity',
        evidenceStrength: 'heuristic_threshold',
        limitations:
          'Plan-shift classification uses a heuristic 20% threshold over the tested discrete grid.',
        route: '/trade-offs',
      });
    }
  }

  const tr = crossModuleRisk.tradeoffSnapshot;
  if (
    tr.available &&
    tr.distinctAlternatives >= 1 &&
    tr.criterionImprovement !== null &&
    tr.criterionImprovement > 1e-6
  ) {
    pushUnique({
      id: 'tradeoff-operational-headroom',
      title: `Verified ${tr.criterionLabel} Improvement Available`,
      severity: 'info',
      evidence: `${tr.distinctAlternatives} distinct verified alternative(s) achieved up to ${tr.criterionImprovement.toFixed(2)} improvement in ${tr.criterionLabel} within the objective tolerance.`,
      explanation:
        'Operational trade-offs exist without violating any original model constraints.',
      suggestedAction:
        'Rank and compare the verified alternatives under your operational weights in Decision Recommendation.',
      metric: `${tr.distinctAlternatives} distinct`,
      sourceModule: 'trade-offs',
      evidenceStrength: 'mathematically_verified',
      limitations:
        'Reflects only the configured objective tolerance and discrete epsilon-constraint points.',
      route: '/recommendations',
    });
  }

  if (preferenceStability && preferenceStability.available && preferenceStability.perturbationsTested > 0) {
    if (preferenceStability.winnerChangesCount > 0) {
      pushUnique({
        id: 'preference-rank-sensitive',
        title: 'Top Recommendation Sensitive to ±20% Weight Shifts',
        severity: 'warning',
        evidence: `Original winner '${preferenceStability.originalTopCandidateId}' retained rank #1 in ${preferenceStability.retainedCount} of ${preferenceStability.perturbationsTested} perturbations (changed to: ${preferenceStability.observedAlternativeWinners.join(', ')}).`,
        explanation:
          'Moderate preference adjustments shift the top-ranked plan, indicating close trade-offs between leading candidates.',
        suggestedAction:
          'Compare the leading plans side by side in Decision Recommendation before selecting an operational plan.',
        metric: `${preferenceStability.retainedCount}/${preferenceStability.perturbationsTested} retained`,
        sourceModule: 'recommendation',
        evidenceStrength: 'heuristic_threshold',
        limitations:
          'Tests ±20% local weight perturbations only; not a statistical confidence or probability.',
        route: '/recommendations',
      });
    } else {
      pushUnique({
        id: 'preference-rank-stable',
        title: 'Top Recommendation Stable Under ±20% Weight Shifts',
        severity: 'info',
        evidence: `'${preferenceStability.originalTopCandidateId}' remained #1 across all ${preferenceStability.perturbationsTested} local ±20% weight perturbations.`,
        explanation:
          'Under your current preference structure, the top-ranked plan is insensitive to moderate weight adjustments.',
        suggestedAction:
          'Inspect the selected plan details and constraints before operational adoption.',
        metric: `${preferenceStability.retainedCount}/${preferenceStability.perturbationsTested} retained`,
        sourceModule: 'recommendation',
        evidenceStrength: 'heuristic_threshold',
        limitations:
          'Covers ±20% local perturbations over the current eligible pool only.',
        route: '/recommendations',
      });
    }
  }

  return insights;
}

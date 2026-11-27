import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  TradeoffCandidateResult,
  TradeoffExploreResponse,
} from '../types/or.ts';
import {
  RECOMMENDATION_METHOD_DISCLOSURE,
  buildDefaultCriteriaConfig,
  buildPairwiseComparison,
  buildRankedScoreChart,
  buildContributionChart,
  buildRecommendationExplanation,
  extractEligibleCandidates,
  normalizeCriteriaWeights,
  normalizeCriterionValues,
  rankAlternatives,
  validateCriteriaAndWeights,
} from './decisionRecommendation.ts';
import { getMappingSignature } from './sensitivityAnalysis.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

const FULL_MAPPING: MultiPeriodColumnMapping = {
  product: 'product',
  period: 'period',
  demand: 'demand',
  production_cost: 'prod_cost',
  inventory_cost: 'inv_cost',
  capacity: 'capacity',
};

function makeDataset(): DatasetSummary {
  return {
    dataset_id: 'ds-1',
    filename: 'sample.csv',
    file_type: 'csv',
    sheets: [],
    active_sheet: null,
    row_count: 8,
    column_count: 6,
    columns: [],
    preview_rows: [],
    preview_limit: 50,
  };
}

function makeSolution(
  overrides: Partial<MultiPeriodSolveResponse> = {}
): MultiPeriodSolveResponse {
  return {
    solver_name: 'PuLP CBC',
    status: 'Optimal',
    is_optimal: true,
    solve_time_seconds: 0.04,
    objective_value: 1000,
    objective_sense: 'Minimize',
    objective_description: 'Minimize cost',
    variable_count: 4,
    constraint_count: 4,
    max_constraint_violation: 0,
    constraints_feasible: true,
    total_production: 100,
    total_demand: 100,
    total_ending_inventory: 20,
    cost_breakdown: null,
    production_schedule: [],
    period_summary: [
      { period: '1', total_production: 60, total_demand: 40, total_ending_inventory: 20 },
      { period: '2', total_production: 40, total_demand: 60, total_ending_inventory: 0 },
    ],
    resource_utilization: [],
    formulation: {
      problem_title: 'T',
      problem_definition: 'T',
      sets: [],
      parameters: [],
      decision_variables: [],
      objective_latex: '',
      objective_explanation: '',
      constraints: [],
      non_negativity_latex: '',
      integrality_latex: null,
      numerical_summary: {},
      solution_interpretation: [],
    },
    message: 'Optimal',
    integer_production: false,
    allow_backlogging: false,
    capacity_scope: 'auto',
    ...overrides,
  };
}

function makeCand(
  id: string,
  overrides: Partial<TradeoffCandidateResult> = {}
): TradeoffCandidateResult {
  return {
    candidate_id: id,
    index: 0,
    is_baseline: id === 'baseline',
    tolerance_value: id === 'baseline' ? 0 : 5,
    objective_budget: 1100,
    solver_status: 'Optimal',
    status_category: 'optimal',
    is_optimal: true,
    original_constraints_feasible: true,
    objective_budget_satisfied: true,
    is_verified_feasible: true,
    objective_value: 1000,
    objective_diff: 0,
    objective_pct_change: 0,
    criterion_value: 80,
    criterion_diff: 0,
    plan_shift_pct: 0,
    peak_utilization_pct: 80,
    total_production: 100,
    total_demand: 100,
    total_ending_inventory: 20,
    cost_breakdown: null,
    max_constraint_violation: 0,
    runtime_seconds: 0.02,
    is_duplicate: false,
    duplicate_of_candidate_id: null,
    production_schedule: [
      { product: 'A', period: '1', production: 60, demand: 40, ending_inventory: 20 },
      { product: 'A', period: '2', production: 40, demand: 60, ending_inventory: 0 },
    ],
    resource_utilization: [
      { resource: 'Aggregate', period: '1', used: 80, capacity: 100, utilization_pct: 80 },
    ],
    error_message: null,
    ...overrides,
  };
}

function makeTradeoffResp(
  baseline: TradeoffCandidateResult,
  candidates: TradeoffCandidateResult[]
): TradeoffExploreResponse {
  return {
    dataset_id: 'ds-1',
    criterion: 'peak_utilization',
    is_milp: false,
    baseline,
    candidates,
    summary: {
      criterion: 'peak_utilization',
      criterion_label: 'Peak Capacity Utilization',
      criterion_unit: '%',
      tolerance_mode: 'relative_pct',
      objective_sense: 'Minimize',
      baseline_objective: baseline.objective_value ?? 0,
      baseline_criterion_value: baseline.criterion_value ?? 0,
      total_requested_points: candidates.length,
      verified_feasible_count: candidates.filter((c) => c.is_verified_feasible).length,
      distinct_feasible_count: candidates.filter((c) => c.is_verified_feasible && !c.is_duplicate).length,
      duplicate_count: candidates.filter((c) => c.is_duplicate).length,
      incomplete_or_error_count: candidates.filter((c) => !c.is_verified_feasible).length,
      best_criterion_value: 60,
      criterion_improvement: 20,
      budget_exhausted: false,
      total_runtime_seconds: 0.1,
      per_solve_time_limit_seconds: 5,
      total_budget_seconds: 25,
      disclosure: 'D',
    },
  };
}

export async function runDecisionRecommendationTests(): Promise<number> {
  let passed = 0;

  // 1. Candidate eligibility, unverified exclusion, duplicate exclusion, baseline freshness
  {
    const base = makeCand('baseline', { objective_value: 1000, peak_utilization_pct: 90, total_ending_inventory: 0 });
    const dup = makeCand('alt-1', { is_duplicate: true, duplicate_of_candidate_id: 'baseline' });
    const unverified = makeCand('alt-2', { is_verified_feasible: false, solver_status: 'Not Solved', status_category: 'timeout', objective_value: null });
    const distinct = makeCand('alt-3', { objective_value: 1050, objective_diff: 50, objective_pct_change: 5, peak_utilization_pct: 65, total_ending_inventory: 20, plan_shift_pct: 20 });

    const resp = makeTradeoffResp(base, [dup, unverified, distinct]);
    const sig = getMappingSignature(FULL_MAPPING);

    const elig = extractEligibleCandidates({
      dataset: makeDataset(),
      mpMapping: FULL_MAPPING,
      mpSolution: makeSolution(),
      mpIntegerProd: false,
      mpCapacityScope: 'auto',
      mpSolutionMappingSignature: sig,
      tradeoffResult: resp,
      tradeoffMeta: { datasetId: 'ds-1', mappingSignature: sig, integerProd: false, capacityScope: 'auto' },
    });
    assert(elig.ready && elig.eligible.length === 2, 'only baseline and distinct alt-3 eligible');
    assert(elig.excludedDuplicatesCount === 1 && elig.excludedUnverifiedCount === 1, 'excluded counts tracked');

    // Stale mapping must fail eligibility
    const stale = extractEligibleCandidates({
      dataset: makeDataset(),
      mpMapping: { ...FULL_MAPPING, capacity: 'other_cap' },
      mpSolution: makeSolution(),
      mpIntegerProd: false,
      mpCapacityScope: 'auto',
      mpSolutionMappingSignature: sig,
      tradeoffResult: resp,
      tradeoffMeta: { datasetId: 'ds-1', mappingSignature: sig, integerProd: false, capacityScope: 'auto' },
    });
    assert(!stale.ready && Boolean(stale.reason?.includes('mapping changed')), 'stale mapping rejected');
    passed++;
  }

  // 2. Min-max normalization: minimize, maximize, equal, zero, negative, extreme values
  {
    assert(
      JSON.stringify(normalizeCriterionValues([100, 150, 200], 'minimize')) ===
        JSON.stringify([1, 0.5, 0]),
      'minimize normalization'
    );
    assert(
      JSON.stringify(normalizeCriterionValues([100, 150, 200], 'maximize')) ===
        JSON.stringify([0, 0.5, 1]),
      'maximize normalization'
    );
    assert(
      JSON.stringify(normalizeCriterionValues([42, 42, 42], 'minimize')) ===
        JSON.stringify([1, 1, 1]),
      'equal values receive neutral 1.0 without div-by-zero'
    );
    const negNorm = normalizeCriterionValues([-50, 0, 50], 'minimize');
    assert(negNorm[0] === 1 && negNorm[1] === 0.5 && negNorm[2] === 0, 'negative and zero values');
    const extreme = normalizeCriterionValues([0, 1e12], 'minimize');
    assert(Number.isFinite(extreme[0]) && Number.isFinite(extreme[1]), 'extreme values finite');
    passed++;
  }

  // 3. Criterion availability & weight normalization & invalid weights
  {
    const base = makeCand('baseline', { peak_utilization_pct: null, resource_utilization: [] });
    const alt = makeCand('alt-1', { peak_utilization_pct: null, resource_utilization: [] });
    const defs = buildDefaultCriteriaConfig([base, alt], 'Minimize');
    const peak = defs.find((d) => d.id === 'peak_utilization')!;
    assert(!peak.available && !peak.selected && Boolean(peak.disabledReason), 'missing utilization disables peak_utilization');

    // Zero weight allowed if another active criterion > 0
    const withZero = defs.map((d) =>
      d.id === 'primary_objective'
        ? { ...d, selected: true, weight: 80 }
        : d.id === 'cumulative_inventory'
          ? { ...d, selected: true, weight: 0 }
          : { ...d, selected: false, weight: 0 }
    );
    assert(validateCriteriaAndWeights(withZero) === null, 'zero weight allowed when total > 0');
    const nw = normalizeCriteriaWeights(withZero);
    assert(nw.primary_objective === 1 && nw.cumulative_inventory === 0, 'normalized weights sum to 1');

    // All zero weights invalid
    const allZero = withZero.map((d) => ({ ...d, weight: 0 }));
    assert(validateCriteriaAndWeights(allZero) !== null, 'all-zero weights rejected');

    // Negative / NaN weight invalid
    const negW = withZero.map((d) => (d.id === 'primary_objective' ? { ...d, weight: -5 } : d));
    assert(validateCriteriaAndWeights(negW) !== null, 'negative weight rejected');
    passed++;
  }

  // 4. Weighted scoring, ranking, deterministic tie-breaking, and missing metrics
  {
    const base = makeCand('baseline', {
      objective_value: 1000,
      peak_utilization_pct: 90,
      total_ending_inventory: 0,
      production_schedule: [
        { product: 'A', period: '1', production: 100, demand: 40, ending_inventory: 60 },
        { product: 'A', period: '2', production: 0, demand: 60, ending_inventory: 0 },
      ],
    });
    const alt = makeCand('alt-1', {
      objective_value: 1050,
      objective_diff: 50,
      objective_pct_change: 5,
      peak_utilization_pct: 60,
      total_ending_inventory: 20,
      plan_shift_pct: 30,
      production_schedule: [
        { product: 'A', period: '1', production: 50, demand: 40, ending_inventory: 10 },
        { product: 'A', period: '2', production: 50, demand: 60, ending_inventory: 0 },
      ],
    });

    const criteria = buildDefaultCriteriaConfig([base, alt], 'Minimize').map((c) => {
      if (c.id === 'peak_utilization') return { ...c, weight: 100, selected: true };
      if (c.id === 'primary_objective') return { ...c, weight: 0, selected: true };
      return { ...c, selected: false, weight: 0 };
    });

    const out = rankAlternatives({ eligible: [base, alt], criteria, objectiveSense: 'Minimize' });
    assert(out.valid && out.ranked[0].candidate.candidate_id === 'alt-1', 'alt-1 wins when peak_utilization weight is 100%');
    assert(out.ranked[0].totalScore === 1 && out.ranked[1].totalScore === 0, 'scores 1.0 and 0.0');

    // Deterministic tie-breaking when scores are equal (e.g. equal weights on opposite extremes)
    const tieCriteria = buildDefaultCriteriaConfig([base, alt], 'Minimize').map((c) => {
      if (c.id === 'peak_utilization' || c.id === 'primary_objective') {
        return { ...c, weight: 50, selected: true };
      }
      return { ...c, selected: false, weight: 0 };
    });
    const tieOut = rankAlternatives({ eligible: [alt, base], criteria: tieCriteria, objectiveSense: 'Minimize' });
    assert(tieOut.valid && tieOut.ranked[0].candidate.candidate_id === 'baseline', 'tie breaks deterministically to better objective / baseline');

    // Missing metric on selected criterion rejected cleanly
    const badAlt = makeCand('alt-2', { peak_utilization_pct: null });
    const badOut = rankAlternatives({ eligible: [base, badAlt], criteria, objectiveSense: 'Minimize' });
    assert(!badOut.valid && Boolean(badOut.error?.includes('missing')), 'missing metric rejected');
    passed++;
  }

  // 5. Recommendation explanation, pairwise comparison, and chart data construction
  {
    const base = makeCand('baseline', { objective_value: 1000, peak_utilization_pct: 90, total_ending_inventory: 0 });
    const alt = makeCand('alt-1', { objective_value: 1050, objective_diff: 50, objective_pct_change: 5, peak_utilization_pct: 60, total_ending_inventory: 10, plan_shift_pct: 20 });
    const criteria = buildDefaultCriteriaConfig([base, alt], 'Minimize').map((c) =>
      c.id === 'peak_utilization'
        ? { ...c, weight: 80, selected: true }
        : c.id === 'primary_objective'
          ? { ...c, weight: 20, selected: true }
          : { ...c, selected: false, weight: 0 }
    );
    const out = rankAlternatives({ eligible: [base, alt], criteria, objectiveSense: 'Minimize' });
    const exp = buildRecommendationExplanation(out.ranked, 1, 1);
    if (!exp) {
      throw new Error('Expected non-null explanation');
    }
    assert(exp.headline.startsWith('Recommended under your current preferences: alt-1'), 'explanation headline phrasing');
    assert(exp.strengths.length >= 1 && exp.compromises.length >= 1, 'strengths and compromises populated');
    assert(exp.limitations.includes(RECOMMENDATION_METHOD_DISCLOSURE), 'disclosure included');

    const pair = buildPairwiseComparison(out.ranked[1], out.ranked[0]);
    assert(pair.length === 2 && pair[0].deltaBMinusA !== 0, 'pairwise deltas computed');

    const scoreChart = buildRankedScoreChart(out.ranked);
    const contribChart = buildContributionChart(out.ranked);
    assert(scoreChart.data.length === 1 && contribChart.data.length === 2, 'charts built');
    passed++;
  }

  return passed;
}

const entryArg = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1] ?? '';
if (entryArg.endsWith('decisionRecommendation.test.ts')) {
  const count = await runDecisionRecommendationTests();
  console.log(`Decision Recommendation unit tests passed: ${count}/${count}`);
}

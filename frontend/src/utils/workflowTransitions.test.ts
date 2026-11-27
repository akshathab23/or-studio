import {
  DASHBOARD_ANALYSIS_LIBRARY,
  DASHBOARD_MODULES,
  DASHBOARD_WORKFLOW_STEPS,
} from '../pages/DashboardPage';
import { extractEligibleCandidates } from './decisionRecommendation';
import { getMappingSignature } from './sensitivityAnalysis';
import {
  getDashboardHeroState,
  getDecisionIntelligenceNextSteps,
} from './workflowTransitions';
import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  TradeoffExploreResponse,
} from '../types/or';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed (${msg}): expected ${String(expected)}, got ${String(actual)}`
    );
  }
}

function makeDataset(): DatasetSummary {
  return {
    dataset_id: 'ds-62c',
    filename: 'sample_multi_period_demo.csv',
    row_count: 8,
    column_count: 7,
    columns: [],
    preview: [],
  } as unknown as DatasetSummary;
}

function makeMapping(): MultiPeriodColumnMapping {
  return {
    product: 'product',
    period: 'period',
    demand: 'demand',
    production_cost: 'production_cost',
    capacity: 'capacity',
  };
}

function makeSolution(optimal = true): MultiPeriodSolveResponse {
  return {
    status: optimal ? 'Optimal' : 'Infeasible',
    is_optimal: optimal,
    constraints_feasible: optimal,
    objective_sense: 'minimize',
    objective_value: optimal ? 1200 : null,
    total_production: 100,
    total_inventory: 10,
    total_shortage: 0,
    periods: ['P1'],
    products: ['A'],
    production_plan: [],
    inventory_flow: [],
    capacity_utilization: [],
    cost_breakdown: {
      production: 1200,
      holding: 0,
      shortage: 0,
      setup: 0,
      total: 1200,
    },
    infeasibility_diagnostics: null,
  } as unknown as MultiPeriodSolveResponse;
}

function makeTradeoffResult(datasetId: string, numDistinctAlts: number): TradeoffExploreResponse {
  const verifiedBase = {
    status: 'Optimal',
    is_verified_feasible: true,
    is_optimal: true,
    original_constraints_feasible: true,
    objective_budget_satisfied: true,
    is_duplicate: false,
    objective_value: 1200,
    total_production: 100,
    total_inventory: 10,
    total_shortage: 0,
    production_cost: 1200,
    holding_cost: 0,
    shortage_cost: 0,
    setup_cost: 0,
  };
  const candidates = Array.from({ length: numDistinctAlts }, (_, idx) => ({
    ...verifiedBase,
    candidate_id: `alt-${idx + 1}`,
    label: `Alternative ${idx + 1}`,
    objective_value: 1220 + idx * 10,
  }));
  return {
    dataset_id: datasetId,
    criterion: 'peak_utilization',
    baseline: {
      ...verifiedBase,
      candidate_id: 'baseline',
      label: 'Baseline',
    },
    candidates,
    summary: {
      candidate_count: candidates.length,
      feasible_count: candidates.length,
      non_dominated_count: candidates.length,
      best_cost_candidate_id: 'baseline',
      best_service_candidate_id: 'baseline',
    },
  } as unknown as TradeoffExploreResponse;
}

// 1. Dashboard module coverage (all 10 capabilities)
const coveredRoutes = new Set([
  ...DASHBOARD_MODULES.map((m) => m.to),
  ...DASHBOARD_ANALYSIS_LIBRARY.map((a) => a.to),
]);
for (const expectedRoute of [
  '/datasets',
  '/multi-period',
  '/goal-programming',
  '/mcdm',
  '/what-if',
  '/sensitivity',
  '/trade-offs',
  '/recommendations',
  '/scenarios',
  '/history',
]) {
  assert(coveredRoutes.has(expectedRoute), `Dashboard must surface ${expectedRoute}`);
}

// 2. Dashboard 8-stage workflow pipeline
assertEqual(DASHBOARD_WORKFLOW_STEPS.length, 8, 'Dashboard workflow step count');
assertEqual(DASHBOARD_WORKFLOW_STEPS[0].to, '/datasets', 'Step 01 route');
assertEqual(DASHBOARD_WORKFLOW_STEPS[7].to, '/scenarios', 'Step 08 route');

// 3. Dashboard hero CTA behavior
const firstVisitHero = getDashboardHeroState({
  dataset: null,
  mpMapping: null,
  mpSolution: null,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: null,
});
assertEqual(firstVisitHero.primaryCta.label, 'Get Started', 'First-visit primary label');
assertEqual(firstVisitHero.primaryCta.to, '/datasets', 'First-visit primary route');
assertEqual(firstVisitHero.secondaryScenarioCta.to, '/scenarios', 'First-visit must not dead-end to /what-if');
assertEqual(firstVisitHero.showSampleProblemButton, true, 'First-visit shows sample button');
assertEqual(firstVisitHero.showDatasetsAlternativeLink, false, 'First-visit hides dataset alternative link');

const dataset = makeDataset();
const mapping = makeMapping();
const sig = getMappingSignature(mapping);

const datasetOnlyHero = getDashboardHeroState({
  dataset,
  mpMapping: mapping,
  mpSolution: null,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: null,
});
assertEqual(datasetOnlyHero.primaryCta.label, 'Configure Model', 'Dataset-only primary label');
assertEqual(datasetOnlyHero.primaryCta.to, '/multi-period', 'Dataset-only primary route');
assertEqual(datasetOnlyHero.secondaryScenarioCta.to, '/scenarios', 'Dataset-only without baseline routes to /scenarios');
assertEqual(datasetOnlyHero.showSampleProblemButton, false, 'Sample button hidden when dataset loaded');
assertEqual(datasetOnlyHero.showDatasetsAlternativeLink, true, 'Alternative datasets/samples link shown');

const solution = makeSolution(true);
const solvedHero = getDashboardHeroState({
  dataset,
  mpMapping: mapping,
  mpSolution: solution,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: sig,
});
assertEqual(solvedHero.primaryCta.label, 'View Results', 'Solved primary label');
assertEqual(solvedHero.secondaryScenarioCta.to, '/what-if', 'Solved baseline routes to /what-if');
assertEqual(solvedHero.baselineReady, true, 'Solved baselineReady flag');

// 4. Trade-off Explorer -> Decision Recommendation eligibility gating
const tooFewAlts = extractEligibleCandidates({
  dataset,
  mpMapping: mapping,
  mpSolution: solution,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: sig,
  tradeoffResult: makeTradeoffResult(dataset.dataset_id, 0),
  tradeoffMeta: {
    datasetId: dataset.dataset_id,
    mappingSignature: sig,
    integerProd: false,
    capacityScope: 'auto',
  },
});
assertEqual(tooFewAlts.ready, false, 'Fewer than 2 eligible alternatives must hide recommendation CTA');

const staleMeta = extractEligibleCandidates({
  dataset,
  mpMapping: mapping,
  mpSolution: solution,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: sig,
  tradeoffResult: makeTradeoffResult(dataset.dataset_id, 1),
  tradeoffMeta: {
    datasetId: dataset.dataset_id,
    mappingSignature: 'stale-signature',
    integerProd: false,
    capacityScope: 'auto',
  },
});
assertEqual(staleMeta.ready, false, 'Stale tradeoffMeta must hide recommendation CTA');

const eligibleAlts = extractEligibleCandidates({
  dataset,
  mpMapping: mapping,
  mpSolution: solution,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: sig,
  tradeoffResult: makeTradeoffResult(dataset.dataset_id, 1),
  tradeoffMeta: {
    datasetId: dataset.dataset_id,
    mappingSignature: sig,
    integerProd: false,
    capacityScope: 'auto',
  },
});
assertEqual(eligibleAlts.ready, true, '2+ verified distinct alternatives enable recommendation CTA');

// 5. Decision Intelligence contextual next steps
const diBaselineOnly = getDecisionIntelligenceNextSteps({
  dataset,
  mpMapping: mapping,
  mpSolution: solution,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: sig,
  tradeoffResult: null,
  tradeoffMeta: null,
  isLiveBaseline: true,
  isOptimal: true,
  constraintsFeasible: true,
});
assert(
  diBaselineOnly.links.some((l) => l.to === '/what-if') &&
    diBaselineOnly.links.some((l) => l.to === '/sensitivity') &&
    diBaselineOnly.links.some((l) => l.to === '/trade-offs'),
  'Verified baseline unlocks What-If, Sensitivity, and Trade-offs'
);
assert(
  !diBaselineOnly.links.some((l) => l.to === '/recommendations'),
  'Recommendations link hidden before trade-off alternatives exist'
);
assertEqual(diBaselineOnly.unavailableNote, null, 'No unavailableNote when baseline ready');

const diWithTradeoffs = getDecisionIntelligenceNextSteps({
  dataset,
  mpMapping: mapping,
  mpSolution: solution,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: sig,
  tradeoffResult: makeTradeoffResult(dataset.dataset_id, 1),
  tradeoffMeta: {
    datasetId: dataset.dataset_id,
    mappingSignature: sig,
    integerProd: false,
    capacityScope: 'auto',
  },
  isLiveBaseline: true,
  isOptimal: true,
  constraintsFeasible: true,
});
assert(
  diWithTradeoffs.links.some((l) => l.to === '/recommendations'),
  'Recommendations link shown when eligible trade-off alternatives exist'
);

const diInfeasible = getDecisionIntelligenceNextSteps({
  dataset,
  mpMapping: mapping,
  mpSolution: makeSolution(false),
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: sig,
  tradeoffResult: null,
  tradeoffMeta: null,
  isLiveBaseline: true,
  isOptimal: false,
  constraintsFeasible: false,
});
assert(
  !diInfeasible.links.some((l) => l.to === '/what-if') &&
    !diInfeasible.links.some((l) => l.to === '/sensitivity') &&
    !diInfeasible.links.some((l) => l.to === '/trade-offs'),
  'Infeasible baseline must not present downstream analyses as ready'
);
assert(
  diInfeasible.links.some((l) => l.to === '/datasets'),
  'Infeasible baseline surfaces Dataset Explorer link'
);
assert(diInfeasible.unavailableNote !== null, 'Infeasible baseline explains prerequisite status');

console.log('workflowTransitions.test.ts: all assertions passed');

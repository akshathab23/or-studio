import {
  ALL_NAV_ITEMS,
  NAV_GROUPS,
  computeNavigationReadiness,
  findActiveNavigationContext,
  getBackendHealthPresentation,
} from './navigation';
import { getMappingSignature } from './sensitivityAnalysis';
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
    throw new Error(`Assertion failed (${msg}): expected ${String(expected)}, got ${String(actual)}`);
  }
}

const EXPECTED_GROUPS = [
  'Overview',
  'Data',
  'Optimization',
  'Decision Analysis',
  'Library & History',
];

const EXPECTED_ROUTES = [
  '/',
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
];

function makeDataset(): DatasetSummary {
  return {
    dataset_id: 'ds-1',
    filename: 'sample.csv',
    row_count: 10,
    column_count: 5,
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

function makeSolution(): MultiPeriodSolveResponse {
  return {
    status: 'Optimal',
    is_optimal: true,
    constraints_feasible: true,
    objective_sense: 'minimize',
    objective_value: 1000,
    total_production: 100,
    total_inventory: 10,
    total_shortage: 0,
    periods: ['P1'],
    products: ['A'],
    production_plan: [],
    inventory_flow: [],
    capacity_utilization: [],
    cost_breakdown: {
      production: 1000,
      holding: 0,
      shortage: 0,
      setup: 0,
      total: 1000,
    },
    infeasibility_diagnostics: null,
  } as unknown as MultiPeriodSolveResponse;
}

// Test 1: Grouping structure and all 11 routes preserved
assertEqual(
  JSON.stringify(NAV_GROUPS.map((g) => g.label)),
  JSON.stringify(EXPECTED_GROUPS),
  'Expected 5 grouped navigation sections'
);
assertEqual(ALL_NAV_ITEMS.length, 11, 'Expected all 11 routes to remain present');
assertEqual(
  JSON.stringify(ALL_NAV_ITEMS.map((i) => i.to)),
  JSON.stringify(EXPECTED_ROUTES),
  'Expected exact 11 route paths'
);

// Test 2: Active route orientation lookup
const rootCtx = findActiveNavigationContext('/');
assert(rootCtx !== null, 'Expected root context');
assertEqual(rootCtx!.group.label, 'Overview', 'Root group');
assertEqual(rootCtx!.item.label, 'Dashboard', 'Root item');

const mpCtx = findActiveNavigationContext('/multi-period');
assert(mpCtx !== null, 'Expected multi-period context');
assertEqual(mpCtx!.group.label, 'Optimization', 'MP group');
assertEqual(mpCtx!.item.label, 'Multi-Period Optimization', 'MP item');

const recCtx = findActiveNavigationContext('/recommendations/');
assert(recCtx !== null, 'Expected recommendations context');
assertEqual(recCtx!.group.label, 'Decision Analysis', 'Rec group');
assertEqual(recCtx!.item.label, 'Decision Recommendation', 'Rec item');

assertEqual(findActiveNavigationContext('/unknown-route'), null, 'Unknown route');

// Test 3: Readiness indicators reflect state truthfully
const emptyReadiness = computeNavigationReadiness({
  dataset: null,
  mpMapping: null,
  mpSolution: null,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: null,
  tradeoffResult: null,
  tradeoffMeta: null,
  gpSolution: null,
  mcdmSolution: null,
  historyCount: 0,
});
assertEqual(emptyReadiness['/datasets'].status, 'needs-input', 'Empty datasets readiness');
assertEqual(emptyReadiness['/what-if'].status, 'needs-input', 'Empty what-if readiness');
assertEqual(emptyReadiness['/recommendations'].status, 'needs-input', 'Empty rec readiness');

const dataset = makeDataset();
const mapping = makeMapping();
const signature = getMappingSignature(mapping);
const solution = makeSolution();

const baselineReadiness = computeNavigationReadiness({
  dataset,
  mpMapping: mapping,
  mpSolution: solution,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: signature,
  tradeoffResult: null,
  tradeoffMeta: null,
  gpSolution: null,
  mcdmSolution: null,
  historyCount: 2,
});
assertEqual(baselineReadiness['/datasets'].status, 'ready', 'Dataset ready');
assertEqual(baselineReadiness['/multi-period'].status, 'ready', 'MP ready');
assertEqual(baselineReadiness['/what-if'].status, 'ready', 'What-If ready');
assertEqual(baselineReadiness['/sensitivity'].status, 'ready', 'Sensitivity ready');
assertEqual(baselineReadiness['/trade-offs'].status, 'ready', 'Trade-offs ready');
assertEqual(baselineReadiness['/recommendations'].status, 'needs-input', 'Rec needs tradeoffs');
assertEqual(baselineReadiness['/history'].status, 'ready', 'History ready');

const verifiedCandidateBase = {
  status: 'Optimal',
  is_verified_feasible: true,
  is_optimal: true,
  original_constraints_feasible: true,
  objective_budget_satisfied: true,
  is_duplicate: false,
  objective_value: 1000,
  total_production: 100,
  total_inventory: 10,
  total_shortage: 0,
  production_cost: 1000,
  holding_cost: 0,
  shortage_cost: 0,
  setup_cost: 0,
};

const tradeoffResult = {
  dataset_id: dataset.dataset_id,
  criterion: 'capacity',
  baseline: {
    ...verifiedCandidateBase,
    candidate_id: 'baseline',
    label: 'Baseline',
  },
  candidates: [
    {
      ...verifiedCandidateBase,
      candidate_id: 'cand-1',
      label: 'Option 1',
      objective_value: 1050,
    },
  ],
  summary: {
    candidate_count: 1,
    feasible_count: 1,
    non_dominated_count: 1,
    best_cost_candidate_id: 'cand-1',
    best_service_candidate_id: 'cand-1',
  },
} as unknown as TradeoffExploreResponse;

const fullReadiness = computeNavigationReadiness({
  dataset,
  mpMapping: mapping,
  mpSolution: solution,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: signature,
  tradeoffResult,
  tradeoffMeta: {
    datasetId: dataset.dataset_id,
    mappingSignature: signature,
    integerProd: false,
    capacityScope: 'auto',
  },
  gpSolution: null,
  mcdmSolution: null,
  historyCount: 3,
});
assertEqual(fullReadiness['/recommendations'].status, 'ready', 'Recommendations ready');

// Test 4: Backend health presentation
assertEqual(getBackendHealthPresentation('checking').label, 'Checking Connection', 'Checking label');
assertEqual(getBackendHealthPresentation('connected').label, 'Backend Connected', 'Connected label');
assertEqual(getBackendHealthPresentation('unavailable').label, 'Backend Unavailable', 'Unavailable label');

console.log('navigation.test.ts: all assertions passed');

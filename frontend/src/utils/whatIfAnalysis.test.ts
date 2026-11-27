import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
} from '../types/or.ts';
import {
  checkWhatIfBaselineConsistency,
  getMappingSignature,
  validateWhatIfMultipliers,
} from './whatIfAnalysis.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

const BASE_MAPPING: MultiPeriodColumnMapping = {
  product: 'product',
  period: 'period',
  demand: 'demand',
  production_cost: 'prod_cost',
  inventory_cost: 'inv_cost',
  capacity: 'capacity',
};

function makeDataset(): DatasetSummary {
  return {
    dataset_id: 'ds-test-123',
    filename: 'test_production.csv',
    file_type: 'csv',
    row_count: 8,
    column_count: 6,
    sheets: [],
    active_sheet: null,
    columns: [],
    preview_rows: [],
    preview_limit: 50,
  };
}

function makeSolution(overrides?: Partial<MultiPeriodSolveResponse>): MultiPeriodSolveResponse {
  return {
    solver_name: 'PULP_CBC_CMD',
    status: 'Optimal',
    is_optimal: true,
    solve_time_seconds: 0.05,
    objective_value: 2450.0,
    objective_sense: 'Minimize',
    objective_description: 'Total Cost',
    variable_count: 16,
    constraint_count: 24,
    max_constraint_violation: 0.0,
    constraints_feasible: true,
    total_production: 980,
    total_demand: 980,
    total_ending_inventory: 40,
    cost_breakdown: { production: 2200, inventory: 250 },
    production_schedule: [],
    period_summary: [
      { period: '2025-Q1', total_production: 250, total_demand: 250, total_ending_inventory: 10 },
      { period: '2025-Q2', total_production: 260, total_demand: 260, total_ending_inventory: 10 },
    ],
    resource_utilization: [
      { resource: 'Plant1', period: '2025-Q1', used: 250, capacity: 320, utilization_pct: 78.1 },
    ],
    formulation: {
      problem_title: 'Test',
      problem_definition: 'Test',
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
    message: 'Optimal solution found.',
    integer_production: false,
    allow_backlogging: false,
    capacity_scope: 'auto',
    ...overrides,
  };
}

let passed = 0;

// Test 1: Baseline presence & consistency
{
  // 1a. Missing dataset blocks analysis
  const noDs = checkWhatIfBaselineConsistency({
    dataset: null,
    mpMapping: BASE_MAPPING,
    mpSolution: makeSolution(),
    mpIntegerProd: false,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: getMappingSignature(BASE_MAPPING),
  });
  assert(!noDs.ready, 'Missing dataset must block What-If analysis');
  assert(
    Boolean(noDs.reason?.toLowerCase().includes('dataset')),
    'Reason must describe missing dataset'
  );

  // 1b. Incomplete mapping blocks analysis
  const incompleteMap = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: { product: 'product', period: 'period', demand: '' },
    mpSolution: makeSolution(),
    mpIntegerProd: false,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: getMappingSignature(BASE_MAPPING),
  });
  assert(!incompleteMap.ready, 'Incomplete mapping must block What-If analysis');
  assert(
    Boolean(incompleteMap.reason?.toLowerCase().includes('mapping')),
    'Reason must describe incomplete mapping'
  );

  // 1c. Missing baseline solution blocks analysis
  const noSol = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: BASE_MAPPING,
    mpSolution: null,
    mpIntegerProd: false,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: null,
  });
  assert(!noSol.ready, 'Missing baseline solution must block What-If analysis');
  assert(
    Boolean(noSol.reason?.toLowerCase().includes('what-if analysis')),
    'Reason must specify What-If analysis'
  );

  // 1d. Non-optimal baseline blocks analysis
  const infeasibleSol = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: BASE_MAPPING,
    mpSolution: makeSolution({ is_optimal: false, status: 'Infeasible' }),
    mpIntegerProd: false,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: getMappingSignature(BASE_MAPPING),
  });
  assert(!infeasibleSol.ready, 'Infeasible baseline must block What-If analysis');

  // 1e. Non-feasible constraints block analysis
  const unverifiedSol = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: BASE_MAPPING,
    mpSolution: makeSolution({ constraints_feasible: false }),
    mpIntegerProd: false,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: getMappingSignature(BASE_MAPPING),
  });
  assert(!unverifiedSol.ready, 'Unverified constraints baseline must block What-If analysis');

  // 1f. Non-finite objective blocks analysis
  const nanSol = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: BASE_MAPPING,
    mpSolution: makeSolution({ objective_value: NaN }),
    mpIntegerProd: false,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: getMappingSignature(BASE_MAPPING),
  });
  assert(!nanSol.ready, 'NaN objective value baseline must block What-If analysis');

  passed++;
}

// Test 2: Mapping signature freshness and model configuration consistency
{
  const solvedSig = getMappingSignature(BASE_MAPPING);

  // 2a. Valid fresh baseline allows What-If analysis
  const validRes = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: BASE_MAPPING,
    mpSolution: makeSolution(),
    mpIntegerProd: false,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: solvedSig,
  });
  assert(validRes.ready && validRes.reason === null, 'Valid fresh baseline must pass');

  // 2b. Modified mapping without re-solve triggers signature mismatch and blocks analysis
  const modifiedMapping: MultiPeriodColumnMapping = {
    ...BASE_MAPPING,
    production_cost: 'alt_prod_cost',
  };
  const staleSigRes = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: modifiedMapping,
    mpSolution: makeSolution(),
    mpIntegerProd: false,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: solvedSig,
  });
  assert(!staleSigRes.ready, 'Stale mapping signature must block What-If analysis');
  assert(
    Boolean(staleSigRes.reason?.includes('mapping changed')),
    'Reason must clearly state that column mapping changed after baseline was solved'
  );

  // 2c. Integer production setting mismatch blocks analysis
  const integerMismatch = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: BASE_MAPPING,
    mpSolution: makeSolution({ integer_production: false }),
    mpIntegerProd: true,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: solvedSig,
  });
  assert(!integerMismatch.ready, 'Integer production mismatch must block analysis');

  // 2d. Capacity scope setting mismatch blocks analysis
  const scopeMismatch = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: BASE_MAPPING,
    mpSolution: makeSolution({ capacity_scope: 'per_product' }),
    mpIntegerProd: false,
    mpCapacityScope: 'aggregate_period',
    mpSolutionMappingSignature: solvedSig,
  });
  assert(!scopeMismatch.ready, 'Capacity scope mismatch must block analysis');

  // 2e. Equivalent mapping object reference does not falsely trigger stale state
  const equivalentMapping: MultiPeriodColumnMapping = {
    ...BASE_MAPPING,
    setup_cost: '',
    setup_time: undefined,
  };
  assert(
    getMappingSignature(equivalentMapping) === solvedSig,
    'Equivalent mapping must have matching signature'
  );
  const equivRes = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: equivalentMapping,
    mpSolution: makeSolution(),
    mpIntegerProd: false,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: solvedSig,
  });
  assert(equivRes.ready, 'Equivalent mapping must not be falsely flagged as stale');

  passed++;
}

// Test 3: Multiplier validation
{
  assert(
    validateWhatIfMultipliers({
      demandMultiplier: 1.0,
      capacityMultiplier: 1.0,
      costMultiplier: 1.0,
    }) === null,
    'Baseline 1.0x multipliers must be valid'
  );

  assert(
    validateWhatIfMultipliers({
      demandMultiplier: 1.3,
      capacityMultiplier: 0.75,
      costMultiplier: 1.2,
    }) === null,
    'Preset multipliers must be valid'
  );

  assert(
    validateWhatIfMultipliers({
      demandMultiplier: 0,
      capacityMultiplier: 1.0,
      costMultiplier: 1.0,
    }) !== null,
    'Zero demand multiplier must be rejected'
  );

  assert(
    validateWhatIfMultipliers({
      demandMultiplier: -0.5,
      capacityMultiplier: 1.0,
      costMultiplier: 1.0,
    }) !== null,
    'Negative multiplier must be rejected'
  );

  assert(
    validateWhatIfMultipliers({
      demandMultiplier: 1.0,
      capacityMultiplier: 15.0,
      costMultiplier: 1.0,
    }) !== null,
    'Multiplier > 10.0 must be rejected'
  );

  assert(
    validateWhatIfMultipliers({
      demandMultiplier: NaN,
      capacityMultiplier: 1.0,
      costMultiplier: 1.0,
    }) !== null,
    'NaN multiplier must be rejected'
  );

  passed++;
}

// Test 4: Guard simulation ensuring no solve call can be made on stale baseline
{
  let apiCallMade = false;
  const mockSolve = () => {
    apiCallMade = true;
  };

  const simulateWhatIfAction = (check: { ready: boolean; reason: string | null }) => {
    if (!check.ready) {
      return { status: 'blocked', reason: check.reason };
    }
    mockSolve();
    return { status: 'solved', reason: null };
  };

  // Simulating changed mapping
  const staleCheck = checkWhatIfBaselineConsistency({
    dataset: makeDataset(),
    mpMapping: { ...BASE_MAPPING, demand: 'demand_updated' },
    mpSolution: makeSolution(),
    mpIntegerProd: false,
    mpCapacityScope: 'auto',
    mpSolutionMappingSignature: getMappingSignature(BASE_MAPPING),
  });

  const outcome = simulateWhatIfAction(staleCheck);
  assert(outcome.status === 'blocked', 'Action must be blocked on stale baseline');
  assert(!apiCallMade, 'No solve API call may be made when baseline check fails');

  passed++;
}

console.log(`What-If analysis unit tests passed: ${passed}/${passed}`);

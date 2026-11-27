import { ApiError, exploreTradeoffs } from '../api/client.ts';
import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  TradeoffCandidateResult,
  TradeoffExploreResponse,
} from '../types/or.ts';
import { getMappingSignature } from './sensitivityAnalysis.ts';
import {
  MANDATORY_TRADEOFF_DISCLOSURE,
  buildCandidatePlanDiff,
  buildTradeoffChart,
  buildTradeoffInterpretation,
  buildTradeoffRequest,
  checkTradeoffBaselineConsistency,
  computeAllowedObjectiveBudget,
  formatTradeoffApiError,
  getTradeoffCriterionOptions,
  isNearZeroBaselineObjective,
  validateTradeoffInputs,
} from './tradeoffExplorer.ts';

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

const MINIMAL_MAPPING: MultiPeriodColumnMapping = {
  product: 'product',
  period: 'period',
  demand: 'demand',
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
    cost_breakdown: { production_cost: 980, inventory_cost: 20 },
    production_schedule: [
      { product: 'A', period: '1', production: 60, demand: 40, ending_inventory: 20 },
      { product: 'A', period: '2', production: 40, demand: 60, ending_inventory: 0 },
    ],
    period_summary: [
      { period: '1', total_production: 60, total_demand: 40, total_ending_inventory: 20 },
      { period: '2', total_production: 40, total_demand: 60, total_ending_inventory: 0 },
    ],
    resource_utilization: [
      { resource: 'Aggregate', period: '1', used: 60, capacity: 100, utilization_pct: 60 },
      { resource: 'Aggregate', period: '2', used: 40, capacity: 100, utilization_pct: 40 },
    ],
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

function makeCandidate(
  overrides: Partial<TradeoffCandidateResult> = {}
): TradeoffCandidateResult {
  return {
    candidate_id: 'alt-1',
    index: 0,
    is_baseline: false,
    tolerance_value: 5.0,
    objective_budget: 1050,
    solver_status: 'Optimal',
    status_category: 'optimal',
    is_optimal: true,
    original_constraints_feasible: true,
    objective_budget_satisfied: true,
    is_verified_feasible: true,
    objective_value: 1040,
    objective_diff: 40,
    objective_pct_change: 4.0,
    criterion_value: 50,
    criterion_diff: -10,
    plan_shift_pct: 20,
    peak_utilization_pct: 50,
    total_production: 100,
    total_demand: 100,
    total_ending_inventory: 10,
    cost_breakdown: { production_cost: 1030, inventory_cost: 10 },
    max_constraint_violation: 0,
    runtime_seconds: 0.02,
    is_duplicate: false,
    duplicate_of_candidate_id: null,
    production_schedule: [
      { product: 'A', period: '1', production: 50, demand: 40, ending_inventory: 10 },
      { product: 'A', period: '2', production: 50, demand: 60, ending_inventory: 0 },
    ],
    resource_utilization: [
      { resource: 'Aggregate', period: '1', used: 50, capacity: 100, utilization_pct: 50 },
      { resource: 'Aggregate', period: '2', used: 50, capacity: 100, utilization_pct: 50 },
    ],
    error_message: null,
    ...overrides,
  };
}

function makeResponse(
  candidates: TradeoffCandidateResult[],
  overrides: Partial<TradeoffExploreResponse> = {}
): TradeoffExploreResponse {
  const baseline = makeCandidate({
    candidate_id: 'baseline',
    index: 0,
    is_baseline: true,
    tolerance_value: 0,
    objective_budget: 1000,
    objective_value: 1000,
    objective_diff: 0,
    objective_pct_change: 0,
    criterion_value: 60,
    criterion_diff: 0,
    plan_shift_pct: 0,
    peak_utilization_pct: 60,
    production_schedule: makeSolution().production_schedule,
    resource_utilization: makeSolution().resource_utilization,
  });

  const verified = candidates.filter((c) => c.is_verified_feasible);
  const distinct = verified.filter((c) => !c.is_duplicate);

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
      baseline_objective: 1000,
      baseline_criterion_value: 60,
      total_requested_points: candidates.length,
      verified_feasible_count: verified.length,
      distinct_feasible_count: distinct.length,
      duplicate_count: verified.length - distinct.length,
      incomplete_or_error_count: candidates.length - verified.length,
      best_criterion_value: 50,
      criterion_improvement: 10,
      budget_exhausted: false,
      total_runtime_seconds: 0.15,
      per_solve_time_limit_seconds: 5,
      total_budget_seconds: 25,
      disclosure: 'Backend disclosure.',
    },
    ...overrides,
  };
}

export async function runTradeoffExplorerTests(): Promise<number> {
  let passed = 0;

  // 1. Criterion identifiers & availability logic
  {
    const full = getTradeoffCriterionOptions(FULL_MAPPING, makeSolution());
    assert(full.every((o) => o.available), 'all 3 criteria available for multi-period with capacity');
    assert(
      full.map((o) => o.value).join(',') ===
        'peak_utilization,cumulative_inventory,production_smoothing',
      'exact backend criterion identifiers'
    );

    const noCap = getTradeoffCriterionOptions(MINIMAL_MAPPING, makeSolution());
    const byVal = Object.fromEntries(noCap.map((o) => [o.value, o]));
    assert(!byVal.peak_utilization.available && Boolean(byVal.peak_utilization.disabledReason), 'peak_utilization disabled without capacity');
    assert(byVal.cumulative_inventory.available, 'cumulative_inventory available');

    const singlePeriod = getTradeoffCriterionOptions(
      FULL_MAPPING,
      makeSolution({ period_summary: [{ period: '1', total_production: 100, total_demand: 100, total_ending_inventory: 0 }] })
    );
    const spByVal = Object.fromEntries(singlePeriod.map((o) => [o.value, o]));
    assert(!spByVal.production_smoothing.available, 'production_smoothing disabled for 1 period');
    passed++;
  }

  // 2. Tolerance mode, near-zero objective & point count validation
  {
    assert(isNearZeroBaselineObjective(0) === true, 'zero baseline is near-zero');
    assert(isNearZeroBaselineObjective(1e-9) === true, '1e-9 baseline is near-zero');
    assert(isNearZeroBaselineObjective(100) === false, '100 baseline is non-zero');

    assert(
      computeAllowedObjectiveBudget(1000, 'Minimize', 'relative_pct', 10) === 1100,
      'minimize relative budget'
    );
    assert(
      computeAllowedObjectiveBudget(1000, 'Maximize', 'relative_pct', 10) === 900,
      'maximize relative budget'
    );
    assert(
      computeAllowedObjectiveBudget(0, 'Minimize', 'absolute', 25) === 25,
      'zero baseline absolute budget'
    );

    const sol = makeSolution();
    assert(
      validateTradeoffInputs({
        criterion: 'peak_utilization',
        mapping: FULL_MAPPING,
        solution: sol,
        toleranceMode: 'relative_pct',
        relativeTolerancePct: 10,
        absoluteTolerance: 50,
        numPoints: 6,
      }) === null,
      'valid relative config passes'
    );
    assert(
      validateTradeoffInputs({
        criterion: 'peak_utilization',
        mapping: FULL_MAPPING,
        solution: sol,
        toleranceMode: 'relative_pct',
        relativeTolerancePct: 60,
        absoluteTolerance: 50,
        numPoints: 6,
      }) !== null,
      'relative > 50% fails'
    );
    assert(
      validateTradeoffInputs({
        criterion: 'peak_utilization',
        mapping: FULL_MAPPING,
        solution: sol,
        toleranceMode: 'absolute',
        relativeTolerancePct: 10,
        absoluteTolerance: 0,
        numPoints: 6,
      }) !== null,
      'absolute <= 0 fails'
    );
    assert(
      validateTradeoffInputs({
        criterion: 'peak_utilization',
        mapping: FULL_MAPPING,
        solution: sol,
        toleranceMode: 'relative_pct',
        relativeTolerancePct: 10,
        absoluteTolerance: 50,
        numPoints: 1,
      }) !== null,
      'numPoints < 2 fails'
    );
    assert(
      validateTradeoffInputs({
        criterion: 'peak_utilization',
        mapping: FULL_MAPPING,
        solution: sol,
        toleranceMode: 'relative_pct',
        relativeTolerancePct: 10,
        absoluteTolerance: 50,
        numPoints: 13,
      }) !== null,
      'numPoints > 12 fails'
    );
    passed++;
  }

  // 3. Baseline invalid & stale state checks
  {
    assert(
      !checkTradeoffBaselineConsistency({
        dataset: makeDataset(),
        mpMapping: FULL_MAPPING,
        mpSolution: makeSolution({ is_optimal: false, status: 'Infeasible', constraints_feasible: false }),
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
      }).ready,
      'infeasible baseline rejected'
    );
    assert(
      !checkTradeoffBaselineConsistency({
        dataset: makeDataset(),
        mpMapping: FULL_MAPPING,
        mpSolution: makeSolution({ integer_production: false }),
        mpIntegerProd: true,
        mpCapacityScope: 'auto',
      }).ready,
      'stale integer_production rejected'
    );
    assert(
      checkTradeoffBaselineConsistency({
        dataset: makeDataset(),
        mpMapping: FULL_MAPPING,
        mpSolution: makeSolution(),
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
        mpSolutionMappingSignature: getMappingSignature(FULL_MAPPING),
      }).ready,
      'valid baseline with matching mapping signature accepted'
    );
    const clonedSame: MultiPeriodColumnMapping = { ...FULL_MAPPING, resource: undefined };
    assert(
      checkTradeoffBaselineConsistency({
        dataset: makeDataset(),
        mpMapping: clonedSame,
        mpSolution: makeSolution(),
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
        mpSolutionMappingSignature: getMappingSignature(FULL_MAPPING),
      }).ready,
      'cloned identical mapping must keep Trade-off baseline valid'
    );
    const modifiedMapping: MultiPeriodColumnMapping = {
      ...FULL_MAPPING,
      capacity: 'other_capacity',
    };
    const staleTradeoff = checkTradeoffBaselineConsistency({
      dataset: makeDataset(),
      mpMapping: modifiedMapping,
      mpSolution: makeSolution(),
      mpIntegerProd: false,
      mpCapacityScope: 'auto',
      mpSolutionMappingSignature: getMappingSignature(FULL_MAPPING),
    });
    assert(
      !staleTradeoff.ready && Boolean(staleTradeoff.reason?.includes('mapping changed')),
      'Trade-off Explorer must reject stale mapping baseline'
    );
    passed++;
  }

  // 4. Request construction & API error handling
  {
    const req = buildTradeoffRequest({
      datasetId: 'ds-1',
      mapping: FULL_MAPPING,
      integerProduction: true,
      capacityScope: 'per_product',
      criterion: 'cumulative_inventory',
      toleranceMode: 'absolute',
      relativeTolerancePct: 10,
      absoluteTolerance: 75,
      numPoints: 5,
    });
    assert(req.max_relative_tolerance_pct === null && req.absolute_tolerance === 75, 'absolute mode request');
    assert(formatTradeoffApiError(new ApiError('busy', 429)).toLowerCase().includes('busy'), '429');
    assert(formatTradeoffApiError(new ApiError('missing', 404)).toLowerCase().includes('not found'), '404');
    assert(formatTradeoffApiError(new ApiError('bad', 400)).toLowerCase().includes('invalid'), '400');
    assert(formatTradeoffApiError(new TypeError('network')).toLowerCase().includes('network'), 'network error');
    passed++;
  }

  // 5. Chart building: duplicates distinct, failed candidates not plotted/interpolated
  {
    const c1 = makeCandidate({ candidate_id: 'alt-1', is_duplicate: true, duplicate_of_candidate_id: 'baseline', objective_value: 1000, objective_pct_change: 0, criterion_value: 60 });
    const c2 = makeCandidate({ candidate_id: 'alt-2', objective_value: 1040, objective_pct_change: 4, criterion_value: 50 });
    const c3 = makeCandidate({
      candidate_id: 'alt-3',
      solver_status: 'Not Solved',
      status_category: 'timeout',
      is_optimal: false,
      original_constraints_feasible: false,
      objective_budget_satisfied: false,
      is_verified_feasible: false,
      objective_value: null,
      objective_diff: null,
      objective_pct_change: null,
      criterion_value: null,
      criterion_diff: null,
      plan_shift_pct: null,
      production_schedule: [],
      resource_utilization: [],
      error_message: 'Timed out',
    });

    const resp = makeResponse([c1, c2, c3]);
    const chart = buildTradeoffChart(resp);
    const pathTrace = chart.data[0] as { y: (number | null)[]; connectgaps: boolean };
    assert(pathTrace.connectgaps === false && pathTrace.y[2] === null, 'failed candidate omitted without interpolation');
    assert(chart.data.some((d) => d.name === 'Duplicate Plan'), 'duplicate series present');
    assert(chart.curveCandidateIds.flat().includes('alt-2'), 'candidate click lookup populated');

    // Plan diff & missing schedule handling
    const diffOk = buildCandidatePlanDiff(resp.baseline, c2);
    assert(diffOk.scheduleAvailable && diffOk.scheduleRows[0].productionDelta === -10, 'schedule delta computed');
    assert(diffOk.utilizationAvailable && diffOk.utilizationRows[0].utilDeltaPct === -10, 'utilization delta computed');

    const diffFailed = buildCandidatePlanDiff(resp.baseline, c3);
    assert(!diffFailed.scheduleAvailable && !diffFailed.utilizationAvailable, 'failed candidate hides fake schedule');

    const interp = buildTradeoffInterpretation(resp, c2);
    assert(interp.disclosure === MANDATORY_TRADEOFF_DISCLOSURE, 'mandatory disclosure matches');
    assert(interp.candidateStatement.includes('reduces peak capacity utilization'), 'dynamic statement');
    passed++;
  }

  // 6. API client exploreTradeoffs mocked fetch & malformed response guard
  {
    const origFetch = globalThis.fetch;
    try {
      const valid = makeResponse([makeCandidate()]);
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(valid), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;

      const res = await exploreTradeoffs(
        buildTradeoffRequest({
          datasetId: 'ds-1',
          mapping: FULL_MAPPING,
          integerProduction: false,
          capacityScope: 'auto',
          criterion: 'peak_utilization',
          toleranceMode: 'relative_pct',
          relativeTolerancePct: 10,
          absoluteTolerance: 50,
          numPoints: 6,
        })
      );
      assert(res.criterion === 'peak_utilization' && res.candidates.length === 1, 'client returns valid response');

      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ bad: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;

      let caught = false;
      try {
        await exploreTradeoffs(
          buildTradeoffRequest({
            datasetId: 'ds-1',
            mapping: FULL_MAPPING,
            integerProduction: false,
            capacityScope: 'auto',
            criterion: 'peak_utilization',
            toleranceMode: 'relative_pct',
            relativeTolerancePct: 10,
            absoluteTolerance: 50,
            numPoints: 6,
          })
        );
      } catch (err) {
        caught = err instanceof ApiError && err.status === 502;
      }
      assert(caught, 'malformed response raises 502 ApiError');
    } finally {
      globalThis.fetch = origFetch;
    }
    passed++;
  }

  return passed;
}

const entryArg = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1] ?? '';
if (entryArg.endsWith('tradeoffExplorer.test.ts')) {
  const count = await runTradeoffExplorerTests();
  console.log(`Trade-off Explorer unit tests passed: ${count}/${count}`);
}

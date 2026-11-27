import { ApiError, analyzeSensitivity } from '../api/client.ts';
import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  SensitivityPointResult,
  SensitivitySweepResponse,
} from '../types/or.ts';
import {
  MANDATORY_ROBUSTNESS_DISCLOSURE,
  buildPlanStabilityChart,
  buildRobustnessInterpretation,
  buildSensitivityCurveChart,
  buildSensitivityRequest,
  checkBaselineConsistency,
  classifyPointStatus,
  formatNumberOrNull,
  formatSensitivityApiError,
  getMappingSignature,
  getSensitivityParameterOptions,
  validateSensitivityInputs,
} from './sensitivityAnalysis.ts';

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
    row_count: 10,
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
    solve_time_seconds: 0.05,
    objective_value: 1000,
    objective_sense: 'Minimize',
    objective_description: 'Minimize cost',
    variable_count: 4,
    constraint_count: 4,
    max_constraint_violation: 0,
    constraints_feasible: true,
    total_production: 100,
    total_demand: 100,
    total_ending_inventory: 0,
    cost_breakdown: { production_cost: 900, inventory_cost: 100 },
    production_schedule: [],
    period_summary: [],
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

function makePoint(
  overrides: Partial<SensitivityPointResult> = {}
): SensitivityPointResult {
  return {
    multiplier: 1.0,
    parameter: 'demand',
    is_baseline: false,
    in_requested_grid: true,
    solver_status: 'Optimal',
    status_category: 'optimal',
    is_optimal: true,
    constraints_feasible: true,
    is_feasible_optimal: true,
    objective_value: 1000,
    objective_diff: 0,
    objective_pct_change: 0,
    plan_shift_pct: 0,
    setup_changes: null,
    peak_utilization_pct: 75,
    total_production: 100,
    total_demand: 100,
    total_ending_inventory: 0,
    max_constraint_violation: 0,
    runtime_seconds: 0.02,
    production_decisions: [],
    error_message: null,
    ...overrides,
  };
}

function makeSweepResponse(
  points: SensitivityPointResult[],
  overrides: Partial<SensitivitySweepResponse> = {}
): SensitivitySweepResponse {
  const feasible = points.filter((p) => p.is_feasible_optimal);
  const infeasible = points.filter((p) => p.status_category === 'infeasible');
  const incomplete = points.filter(
    (p) => !p.is_feasible_optimal && p.status_category !== 'infeasible'
  );
  const objs = feasible
    .map((p) => p.objective_value)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  return {
    parameter: 'demand',
    dataset_id: 'ds-1',
    is_milp: false,
    baseline: points.find((p) => p.is_baseline) ?? makePoint({ is_baseline: true }),
    grid_config: {
      min_multiplier: 0.7,
      max_multiplier: 1.4,
      requested_points: points.length,
      grid_multipliers: points.map((p) => p.multiplier),
      baseline_included_in_grid: true,
      total_solver_runs: points.length,
      per_solve_time_limit_seconds: 5,
      total_budget_seconds: 25,
      budget_exhausted: false,
    },
    points,
    summary: {
      total_grid_points: points.length,
      feasible_optimal_count: feasible.length,
      infeasible_count: infeasible.length,
      incomplete_or_error_count: incomplete.length,
      feasibility_rate_pct: (feasible.length / points.length) * 100,
      objective_sense: 'Minimize',
      baseline_objective: 1000,
      best_feasible_objective: objs.length ? Math.min(...objs) : null,
      worst_case_feasible_objective: objs.length ? Math.max(...objs) : null,
      objective_range: objs.length ? Math.max(...objs) - Math.min(...objs) : null,
      max_plan_shift_pct: 12.5,
      first_infeasible_multiplier: infeasible[0]?.multiplier ?? null,
      observed_transitions: [],
      total_runtime_seconds: 0.25,
      empirical_disclosure: 'Empirical only.',
    },
    ...overrides,
  };
}

export async function runSensitivityTests(): Promise<number> {
  let passed = 0;

  // 1. Mapped vs unmapped parameter restrictions
  {
    const fullOpts = getSensitivityParameterOptions(FULL_MAPPING);
    assert(fullOpts.every((o) => o.available), 'all 4 params should be available when mapped');

    const minOpts = getSensitivityParameterOptions(MINIMAL_MAPPING);
    const byVal = Object.fromEntries(minOpts.map((o) => [o.value, o]));
    assert(byVal.demand.available === true, 'demand must be available');
    assert(byVal.capacity.available === false && Boolean(byVal.capacity.disabledReason), 'capacity disabled with reason');
    assert(byVal.production_cost.available === false && Boolean(byVal.production_cost.disabledReason), 'production_cost disabled with reason');
    assert(byVal.inventory_cost.available === false && Boolean(byVal.inventory_cost.disabledReason), 'inventory_cost disabled with reason');
    passed++;
  }

  // 2. Input validation & request construction
  {
    assert(
      validateSensitivityInputs({
        parameter: 'demand',
        minMultiplier: 0.7,
        maxMultiplier: 1.4,
        numPoints: 9,
        mapping: FULL_MAPPING,
      }) === null,
      'valid defaults must pass'
    );
    assert(
      validateSensitivityInputs({
        parameter: 'demand',
        minMultiplier: 1.5,
        maxMultiplier: 1.0,
        numPoints: 9,
        mapping: FULL_MAPPING,
      }) !== null,
      'min >= max must fail'
    );
    assert(
      validateSensitivityInputs({
        parameter: 'demand',
        minMultiplier: 0,
        maxMultiplier: 1.2,
        numPoints: 9,
        mapping: FULL_MAPPING,
      }) !== null,
      'min <= 0 must fail'
    );
    assert(
      validateSensitivityInputs({
        parameter: 'demand',
        minMultiplier: 0.8,
        maxMultiplier: 1.2,
        numPoints: 2,
        mapping: FULL_MAPPING,
      }) !== null,
      'numPoints < 3 must fail'
    );
    assert(
      validateSensitivityInputs({
        parameter: 'capacity',
        minMultiplier: 0.8,
        maxMultiplier: 1.2,
        numPoints: 5,
        mapping: MINIMAL_MAPPING,
      }) !== null,
      'unmapped capacity must fail validation'
    );

    const req = buildSensitivityRequest({
      datasetId: 'ds-1',
      mapping: FULL_MAPPING,
      integerProduction: true,
      capacityScope: 'per_product',
      parameter: 'inventory_cost',
      minMultiplier: 0.5,
      maxMultiplier: 1.5,
      numPoints: 5,
    });
    assert(req.dataset_id === 'ds-1' && req.integer_production === true && req.capacity_scope === 'per_product', 'request preserves model config');
    assert(req.parameter === 'inventory_cost' && req.num_points === 5, 'request preserves sweep config');
    passed++;
  }

  // 3. Baseline consistency checks
  {
    assert(
      !checkBaselineConsistency({
        dataset: null,
        mpMapping: FULL_MAPPING,
        mpSolution: makeSolution(),
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
      }).ready,
      'missing dataset must block sensitivity'
    );
    assert(
      !checkBaselineConsistency({
        dataset: makeDataset(),
        mpMapping: FULL_MAPPING,
        mpSolution: makeSolution({ is_optimal: false, status: 'Infeasible', constraints_feasible: false }),
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
      }).ready,
      'infeasible baseline must block sensitivity'
    );
    assert(
      !checkBaselineConsistency({
        dataset: makeDataset(),
        mpMapping: FULL_MAPPING,
        mpSolution: makeSolution({ integer_production: false }),
        mpIntegerProd: true,
        mpCapacityScope: 'auto',
      }).ready,
      'stale integer_production config must block sensitivity'
    );
    assert(
      checkBaselineConsistency({
        dataset: makeDataset(),
        mpMapping: FULL_MAPPING,
        mpSolution: makeSolution(),
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
        mpSolutionMappingSignature: getMappingSignature(FULL_MAPPING),
      }).ready,
      'consistent optimal baseline with matching mapping signature must pass'
    );
    // Identical mapping values in a distinct object reference must NOT invalidate baseline
    const clonedSameMapping: MultiPeriodColumnMapping = {
      ...FULL_MAPPING,
      setup_cost: undefined,
      setup_time: '',
    };
    assert(
      getMappingSignature(clonedSameMapping) === getMappingSignature(FULL_MAPPING),
      'identical mapping values with undefined/empty optional fields must produce identical signature'
    );
    assert(
      checkBaselineConsistency({
        dataset: makeDataset(),
        mpMapping: clonedSameMapping,
        mpSolution: makeSolution(),
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
        mpSolutionMappingSignature: getMappingSignature(FULL_MAPPING),
      }).ready,
      'cloned identical mapping must not unnecessarily invalidate baseline'
    );
    // Mapping change followed by validation without re-solve must invalidate Sensitivity baseline
    const changedMapping: MultiPeriodColumnMapping = {
      ...FULL_MAPPING,
      production_cost: 'alt_prod_cost',
    };
    const staleSigRes = checkBaselineConsistency({
      dataset: makeDataset(),
      mpMapping: changedMapping,
      mpSolution: makeSolution(),
      mpIntegerProd: false,
      mpCapacityScope: 'auto',
      mpSolutionMappingSignature: getMappingSignature(FULL_MAPPING),
    });
    assert(!staleSigRes.ready && Boolean(staleSigRes.reason?.includes('mapping changed')), 'Sensitivity must reject stale mapping baseline');
    passed++;
  }

  // 4. API error formatting (400, 404, 429, 500, TypeError)
  {
    assert(formatSensitivityApiError(new ApiError('busy', 429)).toLowerCase().includes('busy'), '429 message');
    assert(formatSensitivityApiError(new ApiError('missing', 404)).toLowerCase().includes('not found'), '404 message');
    assert(formatSensitivityApiError(new ApiError('bad', 400)).toLowerCase().includes('invalid'), '400 message');
    assert(formatSensitivityApiError(new ApiError('boom', 500)).includes('500'), '500 message');
    assert(formatSensitivityApiError(new TypeError('Failed to fetch')).toLowerCase().includes('network'), 'network error message');
    passed++;
  }

  // 5. Chart building: infeasible & timeout points do NOT plot 0 and do NOT connect gaps
  {
    const pts: SensitivityPointResult[] = [
      makePoint({ multiplier: 0.7, objective_value: 700, plan_shift_pct: 12 }),
      makePoint({ multiplier: 1.0, is_baseline: true, objective_value: 1000, plan_shift_pct: 0 }),
      makePoint({
        multiplier: 1.2,
        solver_status: 'Infeasible',
        status_category: 'infeasible',
        is_optimal: false,
        constraints_feasible: false,
        is_feasible_optimal: false,
        objective_value: null,
        objective_diff: null,
        objective_pct_change: null,
        plan_shift_pct: null,
      }),
      makePoint({
        multiplier: 1.4,
        solver_status: 'Not Solved',
        status_category: 'timeout',
        is_optimal: false,
        constraints_feasible: false,
        is_feasible_optimal: false,
        objective_value: null,
        objective_diff: null,
        objective_pct_change: null,
        plan_shift_pct: null,
        error_message: 'Timeout',
      }),
    ];
    const resp = makeSweepResponse(pts);
    const curve = buildSensitivityCurveChart(resp, 'Demand');
    const lineTrace = curve.data[0] as { y: (number | null)[]; connectgaps: boolean };
    assert(lineTrace.connectgaps === false, 'line must never connect across infeasible/incomplete gaps');
    assert(lineTrace.y[2] === null && lineTrace.y[3] === null, 'infeasible/timeout points must have null objective on line trace, never 0');
    assert(curve.infeasiblePointMultipliers.length === 1 && curve.incompletePointMultipliers.length === 1, 'infeasible and incomplete points separated');

    const stab = buildPlanStabilityChart(resp, 'Demand');
    const shiftTrace = stab.data[0] as { y: (number | null)[]; connectgaps: boolean };
    assert(shiftTrace.connectgaps === false && shiftTrace.y[2] === null, 'plan shift must omit infeasible gaps');
    passed++;
  }

  // 6. Zero baseline objective & status badge distinction & null formatting
  {
    const zeroPt = makePoint({
      multiplier: 0.8,
      objective_value: 0,
      objective_diff: 0,
      objective_pct_change: null,
      plan_shift_pct: 20,
    });
    assert(formatNumberOrNull(zeroPt.objective_value, 2) === '0', 'zero objective must render as 0');
    assert(formatNumberOrNull(zeroPt.objective_pct_change, 2, '%') === 'N/A', 'null pct change must render as N/A');
    assert(classifyPointStatus('timeout').label === 'Time Limit', 'timeout distinct from infeasible');
    assert(classifyPointStatus('solver_error').label === 'Solver Error', 'solver_error distinct from infeasible');
    assert(classifyPointStatus('infeasible').label === 'Infeasible', 'infeasible label');
    passed++;
  }

  // 7. Deterministic interpretation & mandatory disclosure & Maximize sense
  {
    const resp = makeSweepResponse([
      makePoint({ multiplier: 0.8, objective_value: 1200, plan_shift_pct: 25 }),
      makePoint({ multiplier: 1.0, is_baseline: true, objective_value: 1000, plan_shift_pct: 0 }),
    ]);
    resp.summary.objective_sense = 'Maximize';
    resp.summary.worst_case_feasible_objective = 1000;
    resp.summary.max_plan_shift_pct = 25;
    const interp = buildRobustnessInterpretation(resp);
    assert(interp.disclosure === MANDATORY_ROBUSTNESS_DISCLOSURE, 'mandatory disclosure must match');
    assert(interp.statements.some((s) => s.includes('verified feasible')), 'all feasible statement');
    assert(interp.statements.some((s) => s.includes('substantially')), 'substantial shift statement');
    assert(Boolean(interp.observedWorstCaseSummary?.includes('Maximize')), 'objective sense preserved');
    passed++;
  }

  // 8. Live analyzeSensitivity client call & invalid payload rejection via mocked fetch
  {
    const origFetch = globalThis.fetch;
    try {
      const validResp = makeSweepResponse([makePoint({ is_baseline: true })]);
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(validResp), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;

      const res = await analyzeSensitivity(
        buildSensitivityRequest({
          datasetId: 'ds-1',
          mapping: FULL_MAPPING,
          integerProduction: false,
          capacityScope: 'auto',
          parameter: 'demand',
          minMultiplier: 0.7,
          maxMultiplier: 1.4,
          numPoints: 9,
        })
      );
      assert(res.parameter === 'demand' && res.points.length === 1, 'client returns valid response');

      // Invalid payload shape -> 502 ApiError
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;

      let caughtInvalid = false;
      try {
        await analyzeSensitivity(
          buildSensitivityRequest({
            datasetId: 'ds-1',
            mapping: FULL_MAPPING,
            integerProduction: false,
            capacityScope: 'auto',
            parameter: 'demand',
            minMultiplier: 0.7,
            maxMultiplier: 1.4,
            numPoints: 9,
          })
        );
      } catch (err) {
        caughtInvalid = err instanceof ApiError && err.status === 502;
      }
      assert(caughtInvalid, 'invalid response payload must raise ApiError');
    } finally {
      globalThis.fetch = origFetch;
    }
    passed++;
  }

  return passed;
}

const entryArg = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1] ?? '';
if (entryArg.endsWith('sensitivityAnalysis.test.ts')) {
  const count = await runSensitivityTests();
  console.log(`Sensitivity analysis unit tests passed: ${count}/${count}`);
}

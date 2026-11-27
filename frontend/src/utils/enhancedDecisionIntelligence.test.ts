import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  SensitivityContextMeta,
  SensitivitySweepResponse,
  TradeoffCandidateResult,
  TradeoffContextMeta,
  TradeoffExploreResponse,
} from '../types/or.ts';
import { buildDefaultCriteriaConfig } from './decisionRecommendation.ts';
import {
  analyzeBottlenecks,
  analyzeCrossModuleRisk,
  analyzePreferenceStability,
  buildActionableInsights,
  validateSensitivityFreshness,
} from './enhancedDecisionIntelligence.ts';
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

function makeDataset(id = 'ds-1'): DatasetSummary {
  return {
    dataset_id: id,
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
    production_schedule: [],
    period_summary: [
      { period: '1', total_production: 60, total_demand: 40, total_ending_inventory: 20 },
      { period: '2', total_production: 40, total_demand: 60, total_ending_inventory: 0 },
    ],
    resource_utilization: [
      { resource: 'LineA', period: 'P1', used: 100, capacity: 100, utilization_pct: 100 },
      { resource: 'LineA', period: 'P2', used: 92, capacity: 100, utilization_pct: 92 },
      { resource: 'LineB', period: 'P1', used: 50, capacity: 100, utilization_pct: 50 },
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

function makeSensitivityResp(
  overrides: Partial<SensitivitySweepResponse> = {}
): SensitivitySweepResponse {
  return {
    parameter: 'demand',
    dataset_id: 'ds-1',
    is_milp: false,
    baseline: {
      multiplier: 1.0,
      parameter: 'demand',
      is_baseline: true,
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
      peak_utilization_pct: 100,
      total_production: 100,
      total_demand: 100,
      total_ending_inventory: 20,
      max_constraint_violation: 0,
      runtime_seconds: 0.02,
      production_decisions: [],
      error_message: null,
    },
    grid_config: {
      min_multiplier: 0.7,
      max_multiplier: 1.4,
      requested_points: 5,
      grid_multipliers: [0.7, 0.875, 1.0, 1.225, 1.4],
      baseline_included_in_grid: true,
      total_solver_runs: 5,
      per_solve_time_limit_seconds: 5,
      total_budget_seconds: 25,
      budget_exhausted: false,
    },
    points: [],
    summary: {
      total_grid_points: 5,
      feasible_optimal_count: 4,
      infeasible_count: 1,
      incomplete_or_error_count: 0,
      feasibility_rate_pct: 80.0,
      objective_sense: 'Minimize',
      baseline_objective: 1000,
      best_feasible_objective: 700,
      worst_case_feasible_objective: 1350,
      objective_range: 650,
      max_plan_shift_pct: 25.0,
      first_infeasible_multiplier: 1.4,
      observed_transitions: [],
      total_runtime_seconds: 0.15,
      empirical_disclosure: 'Empirical only.',
    },
    ...overrides,
  };
}

function makeSensitivityMeta(
  overrides: Partial<SensitivityContextMeta> = {}
): SensitivityContextMeta {
  return {
    datasetId: 'ds-1',
    mappingSignature: getMappingSignature(FULL_MAPPING),
    integerProd: false,
    capacityScope: 'auto',
    baselineObjective: 1000,
    baselineStatus: 'Optimal',
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
      { resource: 'LineA', period: '1', used: 80, capacity: 100, utilization_pct: 80 },
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
      baseline_objective: 1000,
      baseline_criterion_value: 90,
      total_requested_points: candidates.length,
      verified_feasible_count: 1,
      distinct_feasible_count: 1,
      duplicate_count: 0,
      incomplete_or_error_count: 0,
      best_criterion_value: 65,
      criterion_improvement: 25,
      budget_exhausted: false,
      total_runtime_seconds: 0.1,
      per_solve_time_limit_seconds: 5,
      total_budget_seconds: 25,
      disclosure: 'D',
    },
  };
}

export async function runEnhancedDecisionIntelligenceTests(): Promise<number> {
  let passed = 0;

  // 1. Bottleneck analysis: binding, near-binding, slack, invalid/zero capacity, grouping, no dual claims
  {
    const sol = makeSolution({
      resource_utilization: [
        { resource: 'LineA', period: 'P1', used: 100, capacity: 100, utilization_pct: 100 }, // binding
        { resource: 'LineA', period: 'P2', used: 92, capacity: 100, utilization_pct: 92 }, // near_binding
        { resource: 'LineB', period: 'P1', used: 50, capacity: 100, utilization_pct: 50 }, // slack
        { resource: 'ZeroCap', period: 'P1', used: 0, capacity: 0, utilization_pct: 0 }, // invalid
        { resource: 'NegSlack', period: 'P1', used: 105, capacity: 100, utilization_pct: 105 }, // invalid
        { resource: 'NaNCap', period: 'P1', used: Number.NaN, capacity: 100, utilization_pct: Number.NaN }, // invalid
      ],
    });
    const bn = analyzeBottlenecks(sol);
    assert(bn.available, 'bottleneck analysis must be available');
    assert(bn.bindingCount === 1, '1 binding observation');
    assert(bn.nearBindingCount === 1, '1 near-binding observation');
    assert(bn.slackCount === 1, '1 slack observation');
    assert(bn.invalidCount === 3, 'zero capacity, negative slack, and NaN classified invalid (never binding)');
    assert(bn.resourceSummaries[0].key === 'LineA' && bn.resourceSummaries[0].bindingCount === 1, 'resource grouping sorted by bindingCount');
    assert(bn.periodSummaries[0].key === 'P1' && bn.periodSummaries[0].bindingCount === 1, 'period grouping sorted by bindingCount');
    assert(bn.limitationNote.toLowerCase().includes('do not include lp duals'), 'must disclaim shadow prices');

    // Missing capacity -> unavailable
    const noCapBn = analyzeBottlenecks(makeSolution({ resource_utilization: [] }));
    assert(!noCapBn.available && noCapBn.bindingCount === 0, 'empty utilization must be unavailable');
    passed++;
  }

  // 2. Sensitivity freshness & cross-module risk
  {
    const ds = makeDataset('ds-1');
    const sol = makeSolution();
    const sig = getMappingSignature(FULL_MAPPING);
    const sResp = makeSensitivityResp();
    const sMeta = makeSensitivityMeta();

    assert(
      validateSensitivityFreshness({
        dataset: ds,
        mpMapping: FULL_MAPPING,
        mpSolution: sol,
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
        mpSolutionMappingSignature: sig,
        sensitivityResult: sResp,
        sensitivityMeta: sMeta,
      }).valid,
      'valid current sensitivity must pass'
    );

    // Stale dataset
    assert(
      !validateSensitivityFreshness({
        dataset: makeDataset('ds-2'),
        mpMapping: FULL_MAPPING,
        mpSolution: sol,
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
        mpSolutionMappingSignature: sig,
        sensitivityResult: sResp,
        sensitivityMeta: sMeta,
      }).valid,
      'stale dataset rejected'
    );

    // Stale mapping
    assert(
      !validateSensitivityFreshness({
        dataset: ds,
        mpMapping: { ...FULL_MAPPING, capacity: 'other_cap' },
        mpSolution: sol,
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
        mpSolutionMappingSignature: getMappingSignature({ ...FULL_MAPPING, capacity: 'other_cap' }),
        sensitivityResult: sResp,
        sensitivityMeta: sMeta,
      }).valid,
      'stale mapping rejected'
    );

    // Stale integer_production config
    assert(
      !validateSensitivityFreshness({
        dataset: ds,
        mpMapping: FULL_MAPPING,
        mpSolution: makeSolution({ integer_production: true }),
        mpIntegerProd: true,
        mpCapacityScope: 'auto',
        mpSolutionMappingSignature: sig,
        sensitivityResult: sResp,
        sensitivityMeta: sMeta,
      }).valid,
      'stale config rejected'
    );

    // Stale baseline objective
    assert(
      !validateSensitivityFreshness({
        dataset: ds,
        mpMapping: FULL_MAPPING,
        mpSolution: makeSolution({ objective_value: 2000 }),
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
        mpSolutionMappingSignature: sig,
        sensitivityResult: sResp,
        sensitivityMeta: sMeta,
      }).valid,
      'stale baseline objective rejected'
    );

    // Missing metadata
    assert(
      !validateSensitivityFreshness({
        dataset: ds,
        mpMapping: FULL_MAPPING,
        mpSolution: sol,
        mpIntegerProd: false,
        mpCapacityScope: 'auto',
        mpSolutionMappingSignature: sig,
        sensitivityResult: sResp,
        sensitivityMeta: null,
      }).valid,
      'missing metadata rejected'
    );

    // Valid cross-module risk summary
    const tBase = makeCand('baseline', { peak_utilization_pct: 90, total_ending_inventory: 0 });
    const tAlt = makeCand('alt-1', { objective_value: 1050, peak_utilization_pct: 65, total_ending_inventory: 20 });
    const tResp = makeTradeoffResp(tBase, [tAlt]);
    const tMeta: TradeoffContextMeta = {
      datasetId: 'ds-1',
      mappingSignature: sig,
      integerProd: false,
      capacityScope: 'auto',
    };

    const risk = analyzeCrossModuleRisk({
      dataset: ds,
      mpMapping: FULL_MAPPING,
      mpSolution: sol,
      mpIntegerProd: false,
      mpCapacityScope: 'auto',
      mpSolutionMappingSignature: sig,
      sensitivityResult: sResp,
      sensitivityMeta: sMeta,
      tradeoffResult: tResp,
      tradeoffMeta: tMeta,
    });
    assert(risk.sensitivityRisk.available && risk.sensitivityRisk.infeasiblePoints === 1, 'empirical risk extracted');
    assert(risk.sensitivityRisk.disclosure.toLowerCase().includes('not represent probability'), 'no probability claim');
    assert(risk.tradeoffSnapshot.available && risk.tradeoffSnapshot.distinctAlternatives === 1, 'tradeoff snapshot extracted');

    // Scenario: Trade-off Explorer available, Sensitivity Analysis unavailable
    const onlyTradeoff = analyzeCrossModuleRisk({
      dataset: ds,
      mpMapping: FULL_MAPPING,
      mpSolution: sol,
      mpIntegerProd: false,
      mpCapacityScope: 'auto',
      mpSolutionMappingSignature: sig,
      sensitivityResult: null,
      sensitivityMeta: null,
      tradeoffResult: tResp,
      tradeoffMeta: tMeta,
    });
    assert(!onlyTradeoff.sensitivityRisk.available, 'sensitivity must remain unavailable');
    assert(
      onlyTradeoff.tradeoffSnapshot.available && onlyTradeoff.tradeoffSnapshot.distinctAlternatives === 1,
      'tradeoff snapshot must still be available when sensitivity is not run'
    );

    // Scenario: Sensitivity Analysis available, Trade-off Explorer unavailable
    const onlySensitivity = analyzeCrossModuleRisk({
      dataset: ds,
      mpMapping: FULL_MAPPING,
      mpSolution: sol,
      mpIntegerProd: false,
      mpCapacityScope: 'auto',
      mpSolutionMappingSignature: sig,
      sensitivityResult: sResp,
      sensitivityMeta: sMeta,
      tradeoffResult: null,
      tradeoffMeta: null,
    });
    assert(onlySensitivity.sensitivityRisk.available, 'sensitivity must remain available');
    assert(!onlySensitivity.tradeoffSnapshot.available, 'tradeoff must remain unavailable');
    passed++;
  }

  // 3. Preference rank stability: stable winner, rank-flipping, invalid weights, insufficient candidates
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
      peak_utilization_pct: 65,
      total_ending_inventory: 20,
      plan_shift_pct: 20,
      production_schedule: [
        { product: 'A', period: '1', production: 50, demand: 40, ending_inventory: 10 },
        { product: 'A', period: '2', production: 50, demand: 60, ending_inventory: 0 },
      ],
    });

    // Clear dominant weight -> stable
    const dominantCrit = buildDefaultCriteriaConfig([base, alt], 'Minimize').map((c) =>
      c.id === 'primary_objective'
        ? { ...c, weight: 90, selected: true }
        : c.id === 'peak_utilization'
          ? { ...c, weight: 10, selected: true }
          : { ...c, selected: false, weight: 0 }
    );
    const stableRes = analyzePreferenceStability({
      eligible: [base, alt],
      criteria: dominantCrit,
      objectiveSense: 'Minimize',
    });
    assert(stableRes.available && stableRes.stabilityClass === 'stable', 'dominant weight is stable under ±20%');
    assert(stableRes.perturbationsTested === 4 && stableRes.winnerChangesCount === 0, '4 perturbations tested, 0 flips');
    assert(stableRes.disclosure.toLowerCase().includes('not a probability'), 'must disclaim probability');

    // Near-tie weights (49 vs 51) -> ±20% flips rank!
    const knifeEdgeCrit = buildDefaultCriteriaConfig([base, alt], 'Minimize').map((c) =>
      c.id === 'primary_objective'
        ? { ...c, weight: 51, selected: true }
        : c.id === 'peak_utilization'
          ? { ...c, weight: 49, selected: true }
          : { ...c, selected: false, weight: 0 }
    );
    const flipRes = analyzePreferenceStability({
      eligible: [base, alt],
      criteria: knifeEdgeCrit,
      objectiveSense: 'Minimize',
    });
    assert(flipRes.available && flipRes.stabilityClass === 'sensitive' && flipRes.winnerChangesCount > 0, 'knife-edge weights must detect rank flip');

    // Invalid / all-zero weights -> unavailable
    const zeroCrit = dominantCrit.map((c) => ({ ...c, weight: 0 }));
    const zeroRes = analyzePreferenceStability({
      eligible: [base, alt],
      criteria: zeroCrit,
      objectiveSense: 'Minimize',
    });
    assert(!zeroRes.available && zeroRes.stabilityClass === 'unavailable', 'all-zero weights must return unavailable');

    // Insufficient candidates (<2) -> unavailable
    const singleRes = analyzePreferenceStability({
      eligible: [base],
      criteria: dominantCrit,
      objectiveSense: 'Minimize',
    });
    assert(!singleRes.available, 'single candidate must return unavailable');
    passed++;
  }

  // 4. Actionable insights: evidence classification, deduplication, stale suppression
  {
    const ds = makeDataset('ds-1');
    const sol = makeSolution();
    const sig = getMappingSignature(FULL_MAPPING);
    const bn = analyzeBottlenecks(sol);
    const risk = analyzeCrossModuleRisk({
      dataset: ds,
      mpMapping: FULL_MAPPING,
      mpSolution: sol,
      mpIntegerProd: false,
      mpCapacityScope: 'auto',
      mpSolutionMappingSignature: sig,
      sensitivityResult: makeSensitivityResp(),
      sensitivityMeta: makeSensitivityMeta(),
      tradeoffResult: makeTradeoffResp(
        makeCand('baseline', { peak_utilization_pct: 90 }),
        [makeCand('alt-1', { peak_utilization_pct: 65 })]
      ),
      tradeoffMeta: { datasetId: 'ds-1', mappingSignature: sig, integerProd: false, capacityScope: 'auto' },
    });

    const insights = buildActionableInsights({ bottlenecks: bn, crossModuleRisk: risk });
    assert(insights.length >= 4, 'multiple grounded insights produced');
    assert(new Set(insights.map((i) => i.id)).size === insights.length, 'all insight IDs unique');
    assert(
      insights.some((i) => i.id === 'bottleneck-binding-capacity' && i.evidenceStrength === 'mathematically_verified'),
      'binding insight classified mathematically_verified'
    );
    assert(
      insights.some((i) => i.id === 'sensitivity-infeasibility-risk' && i.evidenceStrength === 'empirical_grid'),
      'sensitivity insight classified empirical_grid'
    );
    assert(
      insights.every((i) => !i.explanation.toLowerCase().includes('shadow price is $')),
      'no fabricated economic/shadow price claims'
    );

    // Stale sensitivity & trade-off must suppress their insights
    const staleRisk = analyzeCrossModuleRisk({
      dataset: ds,
      mpMapping: FULL_MAPPING,
      mpSolution: sol,
      mpIntegerProd: false,
      mpCapacityScope: 'auto',
      mpSolutionMappingSignature: sig,
      sensitivityResult: makeSensitivityResp({ dataset_id: 'old-ds' }),
      sensitivityMeta: makeSensitivityMeta({ datasetId: 'old-ds' }),
      tradeoffResult: null,
      tradeoffMeta: null,
    });
    const staleInsights = buildActionableInsights({ bottlenecks: bn, crossModuleRisk: staleRisk });
    assert(
      !staleInsights.some((i) => i.sourceModule === 'sensitivity' || i.sourceModule === 'trade-offs'),
      'stale sensitivity and missing trade-off insights must be suppressed'
    );
    passed++;
  }

  return passed;
}

const entryArg = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1] ?? '';
if (entryArg.endsWith('enhancedDecisionIntelligence.test.ts')) {
  const count = await runEnhancedDecisionIntelligenceTests();
  console.log(`Enhanced Decision Intelligence unit tests passed: ${count}/${count}`);
}

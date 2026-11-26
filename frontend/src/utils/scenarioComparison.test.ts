import type { MultiPeriodSolveResponse, SavedScenarioDetail } from '../types/or';
import { buildScenarioComparison } from './scenarioComparison';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function makeScenario(
  id: string,
  name: string,
  opts: {
    sense?: string;
    isOptimal?: boolean;
    status?: string;
    obj?: number | null;
    utilPct?: number | null;
    hasSnap?: boolean;
  } = {}
): SavedScenarioDetail {
  const isOptimal = opts.isOptimal ?? true;
  const hasSnap = opts.hasSnap ?? true;
  const sense = opts.sense ?? 'Minimize';

  const snap: MultiPeriodSolveResponse | null = hasSnap
    ? {
        solver_name: 'PuLP CBC',
        status: opts.status ?? (isOptimal ? 'Optimal' : 'Infeasible'),
        is_optimal: isOptimal,
        solve_time_seconds: 0.05,
        objective_value: isOptimal ? opts.obj ?? 1000 : null,
        objective_sense: sense,
        objective_description: 'Test',
        variable_count: 2,
        constraint_count: 2,
        max_constraint_violation: isOptimal ? 0 : null,
        constraints_feasible: isOptimal,
        total_production: isOptimal ? 100 : null,
        total_demand: 100,
        total_ending_inventory: isOptimal ? 0 : null,
        cost_breakdown: isOptimal ? { production_cost: opts.obj ?? 1000 } : null,
        production_schedule: [],
        period_summary: [],
        resource_utilization:
          isOptimal && opts.utilPct !== null && opts.utilPct !== undefined
            ? [{ resource: 'R1', period: 'P1', used: opts.utilPct, capacity: 100, utilization_pct: opts.utilPct }]
            : [],
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
        message: 'Test',
      }
    : null;

  return {
    id,
    name,
    description: '',
    created_at: '2026-11-26T00:00:00Z',
    updated_at: '2026-11-26T00:00:00Z',
    module: 'multi-period',
    dataset_id: 'ds1',
    dataset_name: 'test.csv',
    active_sheet: null,
    objective_sense: sense,
    status: snap ? snap.status : 'Not Solved',
    is_optimal: isOptimal && hasSnap,
    constraints_feasible: isOptimal && hasSnap,
    objective_value: isOptimal && hasSnap ? opts.obj ?? 1000 : null,
    has_result_snapshot: hasSnap,
    input_config: {
      mapping: { product: 'p', period: 't', demand: 'd' },
      integer_production: false,
      allow_backlogging: false,
      capacity_scope: 'auto',
      demand_multiplier: 1,
      capacity_multiplier: 1,
      production_cost_multiplier: 1,
      objective_sense: sense,
    },
    result_snapshot: snap,
  };
}

export function runScenarioComparisonTests(): number {
  let passed = 0;

  // 1. Compatible feasible scenarios with trade-off detection
  {
    const s1 = makeScenario('1', 'Low Cost / High Util', { obj: 1000, utilPct: 95 });
    const s2 = makeScenario('2', 'Higher Cost / Low Util', { obj: 1200, utilPct: 70 });
    const cmp = buildScenarioComparison([s1, s2]);
    assert(cmp.compatibleObjectiveSenses === true, 'same sense should be compatible');
    assert(cmp.feasibleCount === 2, '2 feasible scenarios');
    assert(cmp.preferredNote.includes('Low Cost / High Util'), 'identifies best objective');
    assert(cmp.tradeOffNotes.some((n) => n.includes('Trade-off')), 'flags capacity pressure trade-off');
    passed++;
  }

  // 2. Incompatible objective senses
  {
    const s1 = makeScenario('1', 'Min Model', { sense: 'Minimize', obj: 500 });
    const s2 = makeScenario('2', 'Max Model', { sense: 'Maximize', obj: 900 });
    const cmp = buildScenarioComparison([s1, s2]);
    assert(cmp.compatibleObjectiveSenses === false, 'different senses incompatible');
    assert(cmp.preferredNote.includes('incompatible'), 'refuses preferred winner on incompatible senses');
    passed++;
  }

  // 3. Infeasible & unsolved scenarios handled safely
  {
    const s1 = makeScenario('1', 'Optimal', { obj: 1000 });
    const s2 = makeScenario('2', 'Infeasible', { isOptimal: false, status: 'Infeasible' });
    const s3 = makeScenario('3', 'Config Only', { hasSnap: false });
    const cmp = buildScenarioComparison([s1, s2, s3]);
    assert(cmp.feasibleCount === 1, '1 feasible');
    assert(cmp.infeasibleCount === 1, '1 infeasible');
    assert(cmp.unsolvedCount === 1, '1 unsolved');
    assert(cmp.rows[1].objectiveValue === null, 'infeasible objectiveValue must be null');
    assert(cmp.rows[2].totalProduction === null, 'unsolved totalProduction must be null');
    passed++;
  }

  // 4. Different datasets refuse preferred winner & mixed LP/MILP warns
  {
    const s1 = makeScenario('1', 'Dataset A', { obj: 1000 });
    const s2 = makeScenario('2', 'Dataset B', { obj: 900 });
    s2.dataset_id = 'ds2';
    s2.dataset_name = 'other.csv';
    const cmpDiffDs = buildScenarioComparison([s1, s2]);
    assert(cmpDiffDs.compatibleDatasets === false, 'different datasets incompatible');
    assert(cmpDiffDs.compatibleStructure === false, 'structure incompatible');
    assert(
      cmpDiffDs.preferredNote.includes('different datasets'),
      'refuses preferred winner across different datasets'
    );

    const lp = makeScenario('3', 'LP Run', { obj: 1000 });
    const milp = makeScenario('4', 'MILP Run', { obj: 1050 });
    milp.input_config.integer_production = true;
    milp.input_config.capacity_scope = 'per_product';
    const cmpMode = buildScenarioComparison([lp, milp]);
    assert(
      cmpMode.tradeOffNotes.some((n) => n.includes('LP (continuous) and MILP (integer)')),
      'warns on LP vs MILP mix'
    );
    assert(
      cmpMode.tradeOffNotes.some((n) => n.includes('capacity scopes')),
      'warns on capacity scope mismatch'
    );
    passed++;
  }

  // 5. Non-finite utilization_pct yields null peakUtilizationPct (not 0)
  {
    const s1 = makeScenario('1', 'NaN Util', { obj: 1000, utilPct: Number.NaN });
    const s2 = makeScenario('2', 'Valid Util', { obj: 1200, utilPct: 75 });
    const cmp = buildScenarioComparison([s1, s2]);
    assert(cmp.rows[0].peakUtilizationPct === null, 'NaN utilization must yield null, not 0');
    assert(cmp.rows[1].peakUtilizationPct === 75, 'valid utilization preserved');
    passed++;
  }

  return passed;
}

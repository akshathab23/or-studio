import type { MultiPeriodSolveResponse } from '../types/or';
import { buildDecisionIntelligence } from './decisionIntelligence';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function makeBaseSolution(
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
    cost_breakdown: { production_cost: 800, inventory_cost: 200 },
    production_schedule: [{ product: 'A', period: 'P1', production: 100, demand: 100, ending_inventory: 0 }],
    period_summary: [{ period: 'P1', total_production: 100, total_demand: 100, total_ending_inventory: 0 }],
    resource_utilization: [{ resource: 'Line1', period: 'P1', used: 80, capacity: 100, utilization_pct: 80 }],
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
    message: 'Optimal',
    integer_production: false,
    allow_backlogging: false,
    capacity_scope: 'auto',
    demand_multiplier: 1,
    capacity_multiplier: 1,
    production_cost_multiplier: 1,
    ...overrides,
  };
}

export function runDecisionIntelligenceTests(): number {
  let passed = 0;

  // 1. Mixed positive and negative cost components
  {
    const r = buildDecisionIntelligence(
      makeBaseSolution({
        cost_breakdown: { production_cost: 1000, inventory_cost: -400 },
      })
    );
    assert(r.costAnalysis.available === true, 'mixed-sign cost should still be available');
    assert(r.costAnalysis.largestComponent === null, 'mixed-sign must not claim largestComponent');
    assert(
      r.costAnalysis.components.every((c) => c.sharePct === null),
      'mixed-sign must set all sharePct to null'
    );
    assert(
      r.costAnalysis.components.some((c) => c.value === 1000) &&
        r.costAnalysis.components.some((c) => c.value === -400),
      'mixed-sign must preserve actual component values'
    );
    assert(
      Boolean(r.costAnalysis.tradeOffNote && r.costAnalysis.tradeOffNote.includes('negative')),
      'mixed-sign must include explanatory note'
    );
    passed++;
  }

  // 2. Valid non-negative cost components
  {
    const r = buildDecisionIntelligence(
      makeBaseSolution({
        cost_breakdown: { production_cost: 800, inventory_cost: 200 },
      })
    );
    assert(r.costAnalysis.largestComponent?.key === 'production_cost', 'largest component should be production_cost');
    assert(r.costAnalysis.components[0].sharePct === 80, '800/1000 should be 80%');
    assert(r.costAnalysis.components[1].sharePct === 20, '200/1000 should be 20%');
    passed++;
  }

  // 3. Zero total cost
  {
    const r = buildDecisionIntelligence(
      makeBaseSolution({
        cost_breakdown: { production_cost: 0, inventory_cost: 0 },
      })
    );
    assert(r.costAnalysis.totalCost === 0, 'totalCost should be 0');
    assert(r.costAnalysis.largestComponent === null, 'zero totalCost must not claim largestComponent');
    assert(
      r.costAnalysis.components.every((c) => c.sharePct === null),
      'zero totalCost must set sharePct to null'
    );
    passed++;
  }

  // 4. Tied cost maxima
  {
    const r = buildDecisionIntelligence(
      makeBaseSolution({
        cost_breakdown: { production_cost: 500, inventory_cost: 500 },
      })
    );
    assert(r.costAnalysis.largestComponent === null, 'tied maxima must not claim largestComponent');
    assert(r.costAnalysis.components[0].sharePct === 50, 'tied components should each be 50%');
    passed++;
  }

  // 5. NaN resource utilization & Infinity resource usage
  {
    const r = buildDecisionIntelligence(
      makeBaseSolution({
        resource_utilization: [
          { resource: 'NaNUtil', period: 'P1', used: 50, capacity: 100, utilization_pct: Number.NaN },
          { resource: 'InfUsed', period: 'P2', used: Number.POSITIVE_INFINITY, capacity: 100, utilization_pct: 95 },
          { resource: 'Valid', period: 'P3', used: 92, capacity: 100, utilization_pct: 92 },
        ],
      })
    );
    assert(r.resourceInsights.highCount === 1, 'only Valid (92%) should be high');
    assert(r.resourceInsights.items[0].resource === 'Valid', 'Valid should sort first above unavailable');
    const nanItem = r.resourceInsights.items.find((i) => i.resource === 'NaNUtil')!;
    const infItem = r.resourceInsights.items.find((i) => i.resource === 'InfUsed')!;
    assert(nanItem.tier === 'unavailable' && nanItem.utilizationPct === null, 'NaN utilization -> unavailable');
    assert(infItem.tier === 'unavailable' && infItem.used === null && infItem.remaining === null, 'Inf usage -> unavailable');
    passed++;
  }

  // 6. Missing capacity & Zero capacity
  {
    const r = buildDecisionIntelligence(
      makeBaseSolution({
        resource_utilization: [
          { resource: 'ZeroCap', period: 'P1', used: 10, capacity: 0, utilization_pct: 0 },
          { resource: 'MissingCap', period: 'P2', used: 10, capacity: Number.NaN, utilization_pct: 50 },
        ],
      })
    );
    assert(
      r.resourceInsights.items.every((i) => i.tier === 'unavailable' && i.capacity === null && i.remaining === null),
      'zero or missing capacity -> unavailable with null capacity & remaining'
    );
    passed++;
  }

  // 7. Valid resource metrics unchanged
  {
    const r = buildDecisionIntelligence(
      makeBaseSolution({
        resource_utilization: [
          { resource: 'L1', period: 'P1', used: 120, capacity: 150, utilization_pct: 80 },
        ],
      })
    );
    const item = r.resourceInsights.items[0];
    assert(item.tier === 'moderate', '80% should be moderate');
    assert(item.capacity === 150 && item.used === 120 && item.remaining === 30 && item.utilizationPct === 80, 'valid metrics preserved');
    passed++;
  }

  return passed;
}

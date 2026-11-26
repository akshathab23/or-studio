import type { SavedScenarioDetail } from '../types/or';

export interface ScenarioComparisonRow {
  id: string;
  name: string;
  status: string;
  isOptimal: boolean;
  constraintsFeasible: boolean;
  objectiveSense: string;
  objectiveValue: number | null;
  totalProduction: number | null;
  totalDemand: number | null;
  totalEndingInventory: number | null;
  peakUtilizationPct: number | null;
  productionCost: number | null;
  inventoryCost: number | null;
  setupCost: number | null;
  demandMultiplier: number;
  capacityMultiplier: number;
  productionCostMultiplier: number;
}

export interface ScenarioComparisonSummary {
  rows: ScenarioComparisonRow[];
  compatibleObjectiveSenses: boolean;
  compatibleDatasets: boolean;
  compatibleStructure: boolean;
  objectiveSenses: string[];
  feasibleCount: number;
  infeasibleCount: number;
  unsolvedCount: number;
  preferredNote: string;
  tradeOffNotes: string[];
}

function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildScenarioComparison(
  scenarios: SavedScenarioDetail[]
): ScenarioComparisonSummary {
  const rows: ScenarioComparisonRow[] = scenarios.map((sc) => {
    const snap = sc.result_snapshot;
    const isOpt = Boolean(snap?.is_optimal);
    const utils = isOpt ? snap?.resource_utilization ?? [] : [];
    const validUtils = utils
      .map((u) => finiteOrNull(u.utilization_pct))
      .filter((v): v is number => v !== null);
    const peakUtil = validUtils.length > 0 ? Math.max(...validUtils) : null;
    const costs = isOpt ? snap?.cost_breakdown ?? null : null;

    return {
      id: sc.id,
      name: sc.name,
      status: snap?.status ?? sc.status,
      isOptimal: isOpt,
      constraintsFeasible: Boolean(snap?.constraints_feasible),
      objectiveSense: snap?.objective_sense ?? sc.objective_sense,
      objectiveValue: isOpt ? finiteOrNull(snap?.objective_value) : null,
      totalProduction: isOpt ? finiteOrNull(snap?.total_production) : null,
      totalDemand: finiteOrNull(snap?.total_demand),
      totalEndingInventory: isOpt ? finiteOrNull(snap?.total_ending_inventory) : null,
      peakUtilizationPct: peakUtil,
      productionCost: finiteOrNull(costs?.production_cost),
      inventoryCost: finiteOrNull(costs?.inventory_cost),
      setupCost: finiteOrNull(costs?.setup_cost),
      demandMultiplier: sc.input_config.demand_multiplier,
      capacityMultiplier: sc.input_config.capacity_multiplier,
      productionCostMultiplier: sc.input_config.production_cost_multiplier,
    };
  });

  const senses = Array.from(new Set(rows.map((r) => r.objectiveSense)));
  const compatibleObjectiveSenses = senses.length <= 1;

  const datasetKeys = Array.from(
    new Set(scenarios.map((sc) => sc.dataset_id || sc.dataset_name || 'unknown'))
  );
  const compatibleDatasets = datasetKeys.length <= 1;
  const compatibleStructure = compatibleObjectiveSenses && compatibleDatasets;

  const integerModes = Array.from(
    new Set(scenarios.map((sc) => sc.input_config.integer_production))
  );
  const capacityScopes = Array.from(
    new Set(scenarios.map((sc) => sc.input_config.capacity_scope))
  );

  const feasibleRows = rows.filter(
    (r) => r.isOptimal && r.constraintsFeasible && r.objectiveValue !== null
  );
  const infeasibleCount = rows.filter(
    (r) => r.status !== 'Not Solved' && !r.isOptimal
  ).length;
  const unsolvedCount = rows.filter((r) => r.status === 'Not Solved').length;

  const tradeOffNotes: string[] = [];
  if (!compatibleObjectiveSenses) {
    tradeOffNotes.push(
      `Selected scenarios use different objective senses (${senses.join(
        ' vs. '
      )}). Direct objective comparison is invalid.`
    );
  }
  if (!compatibleDatasets) {
    tradeOffNotes.push(
      'Selected scenarios were solved on different datasets. Direct objective and volume comparison is invalid.'
    );
  }
  if (integerModes.length > 1) {
    tradeOffNotes.push(
      'Selected scenarios mix LP (continuous) and MILP (integer) production modes; interpret objective differences accordingly.'
    );
  }
  if (capacityScopes.length > 1) {
    tradeOffNotes.push(
      `Selected scenarios use different capacity scopes (${capacityScopes.join(' vs. ')}).`
    );
  }
  if (infeasibleCount > 0) {
    tradeOffNotes.push(
      `${infeasibleCount} selected scenario(s) are infeasible and excluded from optimal objective ranking.`
    );
  }
  if (unsolvedCount > 0) {
    tradeOffNotes.push(
      `${unsolvedCount} selected scenario(s) contain only saved inputs without a solver result snapshot.`
    );
  }

  let preferredNote =
    'Select at least two solved feasible scenarios with the same objective sense to compare outcomes.';

  if (!compatibleObjectiveSenses) {
    preferredNote =
      'No preferred scenario can be determined because selected scenarios have incompatible objective senses.';
  } else if (!compatibleDatasets) {
    preferredNote =
      'No preferred scenario can be determined because selected scenarios reference different datasets.';
  } else if (feasibleRows.length === 0) {
    preferredNote =
      'None of the selected scenarios have a feasible optimal solution snapshot.';
  } else if (feasibleRows.length === 1) {
    preferredNote = `Only "${feasibleRows[0].name}" has a feasible optimal solution (${feasibleRows[0].objectiveValue?.toLocaleString()}).`;
  } else {
    const isMin = (senses[0] ?? 'Minimize').toLowerCase().startsWith('min');
    const sorted = [...feasibleRows].sort((a, b) =>
      isMin
        ? a.objectiveValue! - b.objectiveValue!
        : b.objectiveValue! - a.objectiveValue!
    );
    const best = sorted[0];
    const tiedBest = sorted.filter(
      (r) => Math.abs(r.objectiveValue! - best.objectiveValue!) < 1e-6
    );

    // Check if best-objective scenario has higher peak utilization than an alternative
    const hasLowerUtilAlternative = sorted
      .slice(1)
      .some(
        (alt) =>
          alt.peakUtilizationPct !== null &&
          best.peakUtilizationPct !== null &&
          alt.peakUtilizationPct < best.peakUtilizationPct - 1e-3
      );

    if (tiedBest.length > 1) {
      preferredNote = `${tiedBest
        .map((t) => `"${t.name}"`)
        .join(' and ')} tie for the best ${senses[0]} objective value (${best.objectiveValue?.toLocaleString()}).`;
    } else if (hasLowerUtilAlternative) {
      preferredNote = `"${best.name}" achieves the best ${senses[0]} objective value (${best.objectiveValue?.toLocaleString()}), though an alternative scenario operates with lower peak resource utilization (${best.peakUtilizationPct?.toFixed(1)}% vs. lower alternatives) — review trade-offs before deciding.`;
      tradeOffNotes.push(
        `Trade-off observed: "${best.name}" optimizes the objective (${best.objectiveValue?.toLocaleString()}), while another feasible scenario has lower peak capacity pressure.`
      );
    } else {
      preferredNote = `"${best.name}" achieves the best ${senses[0]} objective value (${best.objectiveValue?.toLocaleString()}) among the compared feasible scenarios.`;
    }
  }

  return {
    rows,
    compatibleObjectiveSenses,
    compatibleDatasets,
    compatibleStructure,
    objectiveSenses: senses,
    feasibleCount: feasibleRows.length,
    infeasibleCount,
    unsolvedCount,
    preferredNote,
    tradeOffNotes,
  };
}

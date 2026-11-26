import type { MultiPeriodColumnMapping, MultiPeriodSolveResponse } from '../types/or';

export type ResourceTier = 'high' | 'moderate' | 'low' | 'unavailable';

export interface ResourceInsightItem {
  resource: string;
  period: string;
  capacity: number | null;
  used: number | null;
  remaining: number | null;
  utilizationPct: number | null;
  tier: ResourceTier;
  tierLabel: string;
}

export interface CostComponentItem {
  key: string;
  label: string;
  value: number;
  sharePct: number | null;
}

export interface DecisionAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  evidence: string;
  investigation: string;
}

export interface DecisionIntelligenceReport {
  executiveSummary: {
    headline: string;
    status: string;
    isOptimal: boolean;
    constraintsFeasible: boolean;
    objectiveSense: string;
    objectiveValue: number | null;
    totalProduction: number | null;
    totalDemand: number | null;
    totalEndingInventory: number | null;
    productCount: number;
    periodCount: number;
    completenessNote: string;
  };
  whyThisSolution: {
    modelFacts: string[];
    observedResults: string[];
    interpretations: string[];
  };
  resourceInsights: {
    available: boolean;
    highCount: number;
    moderateCount: number;
    lowCount: number;
    items: ResourceInsightItem[];
    limitationNote: string;
  };
  costAnalysis: {
    available: boolean;
    totalCost: number | null;
    components: CostComponentItem[];
    largestComponent: CostComponentItem | null;
    tradeOffNote: string | null;
    unavailableReason: string | null;
  };
  alerts: DecisionAlert[];
}

const COST_LABELS: Record<string, string> = {
  production_cost: 'Production Cost',
  inventory_cost: 'Inventory Holding Cost',
  setup_cost: 'Setup Cost',
};

function formatCostKey(key: string): string {
  if (COST_LABELS[key]) return COST_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtNum(v: number | null | undefined, maxDecimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'N/A';
  return v.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

export function buildDecisionIntelligence(
  solution: MultiPeriodSolveResponse,
  mapping?: MultiPeriodColumnMapping | null
): DecisionIntelligenceReport {
  const isOptimal = Boolean(solution.is_optimal);
  const constraintsFeasible = Boolean(solution.constraints_feasible);
  const objVal =
    solution.objective_value !== null &&
    solution.objective_value !== undefined &&
    Number.isFinite(solution.objective_value)
      ? solution.objective_value
      : null;

  const totalProd =
    solution.total_production !== null &&
    solution.total_production !== undefined &&
    Number.isFinite(solution.total_production)
      ? solution.total_production
      : null;
  const totalDemand =
    solution.total_demand !== null &&
    solution.total_demand !== undefined &&
    Number.isFinite(solution.total_demand)
      ? solution.total_demand
      : null;
  const totalEndInv =
    solution.total_ending_inventory !== null &&
    solution.total_ending_inventory !== undefined &&
    Number.isFinite(solution.total_ending_inventory)
      ? solution.total_ending_inventory
      : null;

  const uniqueProducts = new Set(
    solution.production_schedule.map((r) => String(r.product ?? '')).filter(Boolean)
  );
  const productCount = uniqueProducts.size;
  const periodCount = solution.period_summary.length;

  // Missing optional telemetry check
  const missingOptional: string[] = [];
  if (isOptimal && solution.resource_utilization.length === 0) {
    missingOptional.push('resource utilization');
  }
  if (
    isOptimal &&
    (!solution.cost_breakdown || Object.keys(solution.cost_breakdown).length === 0)
  ) {
    missingOptional.push('cost breakdown');
  }

  let completenessNote = 'All core solver metrics are available.';
  if (!isOptimal) {
    completenessNote =
      'Non-optimal run: decision variable schedules, resource utilization, and cost breakdowns are not populated.';
  } else if (missingOptional.length > 0) {
    completenessNote = `Optimal solution found, though ${missingOptional.join(
      ' and '
    )} data is unavailable because those optional columns were not mapped.`;
  }

  // ── Section 1: Executive Summary ──────────────────────────────────────────
  let headline: string;
  if (!isOptimal) {
    headline =
      solution.status === 'Infeasible'
        ? 'The solver could not find a feasible production plan under the current demand and capacity constraints.'
        : `The solver terminated with status "${solution.status}" and did not produce an optimal solution.`;
  } else if (!constraintsFeasible) {
    headline = `The solver returned an optimal status with an objective value of ${fmtNum(
      objVal
    )}, but constraint verification detected a violation (max: ${fmtNum(
      solution.max_constraint_violation,
      6
    )}).`;
  } else if (objVal === null) {
    headline =
      'The model found a feasible solution, though the numeric objective value could not be evaluated.';
  } else {
    const scopeParts: string[] = [];
    if (productCount > 0) scopeParts.push(`${productCount} product(s)`);
    if (periodCount > 0) scopeParts.push(`${periodCount} period(s)`);
    const scopeText = scopeParts.length > 0 ? ` across ${scopeParts.join(' and ')}` : '';
    headline = `The model found an optimal feasible production plan${scopeText} with an objective value of ${fmtNum(
      objVal
    )} (${solution.objective_sense}).`;
  }

  // ── Section 2: Why This Solution? ─────────────────────────────────────────
  const modelFacts: string[] = [];
  modelFacts.push(
    `Optimization mode: ${
      solution.integer_production ? 'MILP (Integer production quantities)' : 'LP (Continuous production quantities)'
    }.`
  );
  modelFacts.push(
    `Backlogging setting: ${
      solution.allow_backlogging
        ? 'Allowed (unmet period demand may be deferred).'
        : 'Disabled (all period demand must be satisfied on time via production or available inventory).'
    }`
  );
  modelFacts.push(
    `Objective: ${solution.objective_sense} — ${solution.objective_description}.`
  );
  modelFacts.push(
    `Model size: ${solution.variable_count.toLocaleString()} decision variable(s) and ${solution.constraint_count.toLocaleString()} constraint(s).`
  );
  if (mapping?.initial_inventory) {
    modelFacts.push(
      `Initial inventory column ("${mapping.initial_inventory}") is included in Period 1 inventory balance.`
    );
  }
  if (mapping?.capacity) {
    modelFacts.push(
      `Capacity constraints are active (scope: ${solution.capacity_scope ?? 'auto'}, capacity multiplier: ×${(
        solution.capacity_multiplier ?? 1
      ).toFixed(2)}).`
    );
  } else {
    modelFacts.push('No capacity column was mapped; production is unconstrained by machine/period capacity.');
  }

  const observedResults: string[] = [];
  const interpretations: string[] = [];

  if (isOptimal) {
    if (totalProd !== null && totalDemand !== null) {
      observedResults.push(
        `Total production is ${fmtNum(totalProd)} units against ${fmtNum(totalDemand)} units of total demand.`
      );
      if (constraintsFeasible && !solution.allow_backlogging && totalProd < totalDemand - 1e-6) {
        observedResults.push(
          `Production (${fmtNum(totalProd)}) is lower than demand (${fmtNum(
            totalDemand
          )}) while remaining feasible, indicating initial inventory contributed ${fmtNum(
            totalDemand - totalProd
          )} unit(s) toward meeting demand.`
        );
      }
    }
    if (totalEndInv !== null) {
      const zeroInvPeriods = solution.period_summary.filter(
        (p) => Number(p.total_ending_inventory ?? 0) < 1e-6
      ).length;
      observedResults.push(
        `Cumulative ending inventory across all periods is ${fmtNum(
          totalEndInv
        )} unit(s) (${zeroInvPeriods} of ${periodCount} period(s) end with zero inventory).`
      );
      if (zeroInvPeriods === periodCount && periodCount > 0) {
        interpretations.push(
          'Rule-based interpretation: Ending inventory is zero in every period, consistent with just-in-time production when available capacity can meet period demand without incurring holding cost.'
        );
      } else if (totalEndInv > 1e-6) {
        interpretations.push(
          'Rule-based interpretation: Positive ending inventory is carried across periods, which typically occurs when pre-building stock in earlier periods reduces total objective cost or avoids capacity shortfalls in peak periods.'
        );
      }
    }
    if (constraintsFeasible) {
      observedResults.push(
        `All constraints verified within numerical tolerance (max violation: ${fmtNum(
          solution.max_constraint_violation,
          8
        )}).`
      );
    }
  } else {
    observedResults.push(`Solver status: ${solution.status}. ${solution.message}`);
    if (solution.status === 'Infeasible') {
      interpretations.push(
        'Rule-based interpretation: No combination of non-negative production and inventory satisfies all demand and capacity limits simultaneously. Check whether period demand exceeds cumulative available capacity plus initial stock.'
      );
    }
  }

  // ── Section 3: Resource & Capacity Insights ───────────────────────────────
  const rawResources = solution.resource_utilization ?? [];
  const resourceItems: ResourceInsightItem[] = rawResources
    .map((u) => {
      const capRaw = u.capacity !== null && u.capacity !== undefined ? Number(u.capacity) : NaN;
      const usedRaw = u.used !== null && u.used !== undefined ? Number(u.used) : NaN;
      const pctRaw =
        u.utilization_pct !== null && u.utilization_pct !== undefined
          ? Number(u.utilization_pct)
          : NaN;

      const capValid = Number.isFinite(capRaw) && capRaw > 0;
      const usedValid = Number.isFinite(usedRaw);
      const pctValid = Number.isFinite(pctRaw);

      const cap = capValid ? capRaw : null;
      const used = usedValid ? usedRaw : null;
      const remaining =
        cap !== null && used !== null ? Math.max(0, Number((cap - used).toFixed(4))) : null;
      const pct = capValid && usedValid && pctValid ? pctRaw : null;

      let tier: ResourceTier = 'unavailable';
      let tierLabel = 'Capacity / Utilization Unavailable';
      if (cap !== null && pct !== null) {
        if (pct >= 90) {
          tier = 'high';
          tierLabel = 'High Utilization (≥90%)';
        } else if (pct >= 70) {
          tier = 'moderate';
          tierLabel = 'Moderate Utilization (70–90%)';
        } else {
          tier = 'low';
          tierLabel = 'Low Utilization (<70%)';
        }
      }

      return {
        resource: String(u.resource),
        period: String(u.period),
        capacity: cap,
        used,
        remaining,
        utilizationPct: pct,
        tier,
        tierLabel,
      };
    })
    .sort((a, b) => {
      if (a.utilizationPct === null && b.utilizationPct === null) return 0;
      if (a.utilizationPct === null) return 1;
      if (b.utilizationPct === null) return -1;
      return b.utilizationPct - a.utilizationPct;
    });

  const highCount = resourceItems.filter((r) => r.tier === 'high').length;
  const moderateCount = resourceItems.filter((r) => r.tier === 'moderate').length;
  const lowCount = resourceItems.filter((r) => r.tier === 'low').length;

  // ── Section 4: Cost Breakdown & Trade-Offs ────────────────────────────────
  const rawCosts = solution.cost_breakdown;
  const costEntries = rawCosts
    ? Object.entries(rawCosts).filter(([, v]) => v !== null && Number.isFinite(Number(v)))
    : [];
  const costAvailable = isOptimal && costEntries.length > 0;
  let totalCost: number | null = null;
  let costComponents: CostComponentItem[] = [];
  let largestComponent: CostComponentItem | null = null;
  let tradeOffNote: string | null = null;
  let unavailableReason: string | null = null;

  if (!isOptimal) {
    unavailableReason = 'Cost breakdown is unavailable because no optimal solution was found.';
  } else if (costEntries.length === 0) {
    unavailableReason =
      'No cost columns (Production Cost, Inventory Cost, or Setup Cost) were mapped for this run.';
  } else {
    totalCost = costEntries.reduce((acc, [, v]) => acc + Number(v), 0);
    const allNonNegative = costEntries.every(([, v]) => Number(v) >= 0);
    const sharesValid = totalCost > 0 && allNonNegative;

    costComponents = costEntries
      .map(([k, v]) => {
        const val = Number(v);
        return {
          key: k,
          label: formatCostKey(k),
          value: val,
          sharePct: sharesValid ? Number(((val / totalCost!) * 100).toFixed(1)) : null,
        };
      })
      .sort((a, b) => b.value - a.value);

    if (sharesValid && costComponents.length > 0) {
      const top = costComponents[0];
      const tied = costComponents.filter((c) => Math.abs(c.value - top.value) < 1e-6);
      if (tied.length === 1) {
        largestComponent = top;
      }
    }

    if (!allNonNegative) {
      tradeOffNote =
        'Percentage breakdown is unavailable because cost components contain negative values; actual component values are shown above.';
    } else {
      const invComp = costComponents.find((c) => c.key === 'inventory_cost');
      const prodComp = costComponents.find((c) => c.key === 'production_cost');
      if (invComp && invComp.value === 0 && prodComp && prodComp.value > 0) {
        tradeOffNote =
          'Inventory holding cost is 0, indicating the schedule did not carry stock between periods.';
      } else if (invComp && invComp.value > 0 && prodComp && prodComp.value > 0) {
        tradeOffNote =
          'The solver balanced production cost against inventory holding cost across periods to minimize total objective cost.';
      }
    }
  }

  // ── Section 5: Decision Alerts ────────────────────────────────────────────
  const alerts: DecisionAlert[] = [];

  if (!isOptimal) {
    alerts.push({
      id: 'non-optimal',
      severity: 'critical',
      title: `Model ${solution.status}`,
      evidence: `Solver returned status "${solution.status}" (${solution.constraint_count} constraints, demand multiplier ×${(
        solution.demand_multiplier ?? 1
      ).toFixed(2)}, capacity multiplier ×${(solution.capacity_multiplier ?? 1).toFixed(2)}).`,
      investigation:
        'Investigate whether demand exceeds available capacity in early periods, or test relaxed capacity/demand assumptions in the What-If Lab.',
    });
  } else if (!constraintsFeasible) {
    alerts.push({
      id: 'constraint-violation',
      severity: 'critical',
      title: 'Constraint Tolerance Exceeded',
      evidence: `Max constraint violation is ${fmtNum(solution.max_constraint_violation, 8)}.`,
      investigation:
        'Review numerical scaling of cost/capacity parameters and verify input data values.',
    });
  }

  if (isOptimal && highCount > 0) {
    const topHigh = resourceItems
      .filter((r) => r.tier === 'high')
      .slice(0, 3)
      .map((r) => `${r.resource} (T${r.period}: ${fmtNum(r.utilizationPct, 1)}%)`)
      .join(', ');
    alerts.push({
      id: 'high-utilization',
      severity: 'warning',
      title: `${highCount} Resource-Period(s) at High Utilization (≥90%)`,
      evidence: `Heuristic threshold ≥90% triggered for: ${topHigh}${
        highCount > 3 ? ` (+${highCount - 3} more)` : ''
      }.`,
      investigation:
        'Investigate adding capacity or shifting production earlier in the What-If Lab. Note: this is a utilization heuristic, not a dual/shadow-price proof.',
    });
  }

  if (isOptimal && solution.allow_backlogging) {
    alerts.push({
      id: 'backlogging-enabled',
      severity: 'info',
      title: 'Backlogging Enabled',
      evidence: 'allow_backlogging = true in solver configuration.',
      investigation:
        'Inspect period-by-period production vs. demand in the Visualizations tab to verify whether demand was deferred.',
    });
  }

  if (isOptimal && rawResources.length === 0) {
    alerts.push({
      id: 'missing-capacity',
      severity: 'info',
      title: 'Capacity Constraints Not Mapped',
      evidence: 'resource_utilization array is empty.',
      investigation:
        'Map a Capacity column if production limits exist, as unconstrained runs assume unlimited production capacity.',
    });
  }

  if (isOptimal && !costAvailable) {
    alerts.push({
      id: 'missing-costs',
      severity: 'info',
      title: 'Cost Breakdown Unavailable',
      evidence: 'cost_breakdown is null (no cost columns mapped).',
      investigation:
        'Map Production Cost, Inventory Cost, or Setup Cost to optimize financial trade-offs instead of unit volume.',
    });
  }

  if (isOptimal && objVal === 0) {
    alerts.push({
      id: 'zero-objective',
      severity: 'info',
      title: 'Zero Objective Value',
      evidence: 'objective_value = 0.',
      investigation:
        'Verify whether all demand was satisfied by initial inventory or whether cost coefficients are zero.',
    });
  }

  return {
    executiveSummary: {
      headline,
      status: solution.status,
      isOptimal,
      constraintsFeasible,
      objectiveSense: solution.objective_sense,
      objectiveValue: objVal,
      totalProduction: totalProd,
      totalDemand,
      totalEndingInventory: totalEndInv,
      productCount,
      periodCount,
      completenessNote,
    },
    whyThisSolution: {
      modelFacts,
      observedResults,
      interpretations,
    },
    resourceInsights: {
      available: isOptimal && resourceItems.length > 0,
      highCount,
      moderateCount,
      lowCount,
      items: resourceItems,
      limitationNote:
        'Utilization tiers are rule-based heuristics (≥90% High, 70–90% Moderate, <70% Low). This solver does not report LP dual/shadow prices.',
    },
    costAnalysis: {
      available: costAvailable,
      totalCost,
      components: costComponents,
      largestComponent,
      tradeOffNote,
      unavailableReason,
    },
    alerts,
  };
}

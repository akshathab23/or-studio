import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
} from '../types/or';
import {
  checkBaselineConsistency,
  getMappingSignature,
  type BaselineConsistencyResult,
} from './sensitivityAnalysis.ts';

export { getMappingSignature };

/**
 * Verifies that the active Multi-Period solution baseline is fresh, verified optimal
 * and feasible, and exactly consistent with the current dataset, validated column mapping,
 * integer production flag, and capacity scope setting.
 */
export function checkWhatIfBaselineConsistency(params: {
  dataset: DatasetSummary | null;
  mpMapping: MultiPeriodColumnMapping | null;
  mpSolution: MultiPeriodSolveResponse | null;
  mpIntegerProd: boolean;
  mpCapacityScope: 'auto' | 'per_product' | 'aggregate_period';
  mpSolutionMappingSignature?: string | null;
}): BaselineConsistencyResult {
  const baseCheck = checkBaselineConsistency(params);
  if (!baseCheck.ready) {
    return {
      ready: false,
      reason: baseCheck.reason
        ? baseCheck.reason.replace(/sensitivity analysis/g, 'What-If analysis')
        : 'Baseline model is not ready for What-If analysis.',
    };
  }

  const sol = params.mpSolution;
  if (
    !sol ||
    sol.objective_value === null ||
    sol.objective_value === undefined ||
    !Number.isFinite(sol.objective_value)
  ) {
    return {
      ready: false,
      reason:
        'The baseline solution does not have a finite numerical objective value. Re-solve the baseline model first.',
    };
  }

  return { ready: true, reason: null };
}

/**
 * Validates scenario multipliers for What-If experimentation.
 */
export function validateWhatIfMultipliers(multipliers: {
  demandMultiplier: number;
  capacityMultiplier: number;
  costMultiplier: number;
}): string | null {
  const { demandMultiplier, capacityMultiplier, costMultiplier } = multipliers;

  if (
    !Number.isFinite(demandMultiplier) ||
    demandMultiplier <= 0 ||
    demandMultiplier > 10
  ) {
    return 'Demand multiplier must be a finite positive number between 0.01 and 10.0.';
  }
  if (
    !Number.isFinite(capacityMultiplier) ||
    capacityMultiplier <= 0 ||
    capacityMultiplier > 10
  ) {
    return 'Capacity multiplier must be a finite positive number between 0.01 and 10.0.';
  }
  if (
    !Number.isFinite(costMultiplier) ||
    costMultiplier <= 0 ||
    costMultiplier > 10
  ) {
    return 'Production cost multiplier must be a finite positive number between 0.01 and 10.0.';
  }

  return null;
}

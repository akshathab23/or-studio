import type { MappingValidationResponse } from '../types/or';

export type CapacityScopeValue = 'auto' | 'per_product' | 'aggregate_period';

export interface ModelTypeCue {
  kind: 'LP' | 'MILP';
  badgeLabel: string;
  explanation: string;
}

export function getModelTypeCue(
  integerProduction: boolean,
  hasSetupParameters = false
): ModelTypeCue {
  if (integerProduction) {
    return {
      kind: 'MILP',
      badgeLabel: 'MILP · Mixed-Integer Linear Programming',
      explanation:
        'Integer production quantities are enabled (LpInteger variables), solving a Mixed-Integer Linear Programming (MILP) model.',
    };
  }
  if (hasSetupParameters) {
    return {
      kind: 'MILP',
      badgeLabel: 'MILP · Binary Setup Variables',
      explanation:
        'Production quantities are continuous, while mapped setup parameters add binary setup indicators (LpBinary), forming a Mixed-Integer Linear Programming (MILP) model.',
    };
  }
  return {
    kind: 'LP',
    badgeLabel: 'LP · Linear Programming',
    explanation:
      'Integer production restrictions are off and no setup variables are mapped; the model solves as a continuous Linear Programming (LP) formulation.',
  };
}

export interface CapacityScopeOption {
  value: CapacityScopeValue;
  label: string;
  description: string;
}

export const CAPACITY_SCOPE_OPTIONS: CapacityScopeOption[] = [
  {
    value: 'auto',
    label: 'Auto-detect',
    description:
      'Applies per-product capacity when capacity values vary across products in a period, or aggregate period capacity when uniform across products.',
  },
  {
    value: 'per_product',
    label: 'Per-Product',
    description:
      'Enforces a separate capacity limit for each product within each period.',
  },
  {
    value: 'aggregate_period',
    label: 'Aggregate Period',
    description:
      'Enforces a single combined capacity limit shared across all products within each period.',
  },
];

export interface CapacityScopeCue {
  selectedValue: CapacityScopeValue;
  selectedLabel: string;
  description: string;
  resolvedNote: string | null;
}

export function getCapacityScopeCue(
  scope: CapacityScopeValue,
  resolvedScope?: string | null
): CapacityScopeCue {
  const match =
    CAPACITY_SCOPE_OPTIONS.find((opt) => opt.value === scope) ?? CAPACITY_SCOPE_OPTIONS[0];
  const resolvedNote =
    resolvedScope && resolvedScope !== scope
      ? `Last solved model resolved scope as: ${resolvedScope}.`
      : null;

  return {
    selectedValue: match.value,
    selectedLabel: match.label,
    description: match.description,
    resolvedNote,
  };
}

export type ValidationFreshnessStatus = 'validated' | 'modified' | 'unvalidated';

export interface MappingValidationFreshness {
  status: ValidationFreshnessStatus;
  label: string;
  detail: string;
}

export function getMappingValidationFreshness(params: {
  currentSignature: string | null;
  validatedSignature: string | null;
  validation: MappingValidationResponse | null;
}): MappingValidationFreshness {
  const { currentSignature, validatedSignature, validation } = params;

  if (!currentSignature || !validation || validatedSignature === null) {
    return {
      status: 'unvalidated',
      label: 'Requires Validation',
      detail: 'Mapping has not been validated yet. Click Validate Mapping or Solve Model.',
    };
  }

  if (validatedSignature !== currentSignature) {
    return {
      status: 'modified',
      label: 'Modified Since Validation',
      detail:
        'Column mapping changed after the last validation. Re-validate or click Solve Model to verify the updated mapping.',
    };
  }

  if (!validation.valid) {
    return {
      status: 'validated',
      label: 'Validated (Errors Found)',
      detail: 'Current mapping was checked and has validation errors that must be resolved.',
    };
  }

  return {
    status: 'validated',
    label: 'Mapping Validated',
    detail: 'Current column mapping matches the latest passed validation.',
  };
}

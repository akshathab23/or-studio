import {
  CAPACITY_SCOPE_OPTIONS,
  getCapacityScopeCue,
  getMappingValidationFreshness,
  getModelTypeCue,
} from './modelingCues';
import type { MappingValidationResponse } from '../types/or';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed (${msg}): expected ${String(expected)}, got ${String(actual)}`
    );
  }
}

// 1. LP vs MILP contextual cues
const lpCue = getModelTypeCue(false, false);
assertEqual(lpCue.kind, 'LP', 'Continuous without setup should be LP');
assert(lpCue.badgeLabel.includes('LP'), 'LP badge label');
assert(lpCue.explanation.includes('Linear Programming (LP)'), 'LP explanation');

const milpIntCue = getModelTypeCue(true, false);
assertEqual(milpIntCue.kind, 'MILP', 'Integer production should be MILP');
assert(milpIntCue.badgeLabel.includes('MILP'), 'MILP badge label');
assert(
  milpIntCue.explanation.includes('Mixed-Integer Linear Programming (MILP)'),
  'MILP explanation'
);

const milpSetupCue = getModelTypeCue(false, true);
assertEqual(milpSetupCue.kind, 'MILP', 'Setup parameters should be MILP');

// 2. Capacity scope visibility & supported options
assertEqual(CAPACITY_SCOPE_OPTIONS.length, 3, 'Only 3 supported capacity scopes');
assertEqual(
  JSON.stringify(CAPACITY_SCOPE_OPTIONS.map((o) => o.value)),
  JSON.stringify(['auto', 'per_product', 'aggregate_period']),
  'Exact capacity scope values'
);

const autoScope = getCapacityScopeCue('auto', 'per_product');
assertEqual(autoScope.selectedLabel, 'Auto-detect', 'Auto label');
assert(autoScope.resolvedNote !== null && autoScope.resolvedNote.includes('per_product'), 'Resolved scope note');

const perProductScope = getCapacityScopeCue('per_product', 'per_product');
assertEqual(perProductScope.selectedLabel, 'Per-Product', 'Per-product label');
assertEqual(perProductScope.resolvedNote, null, 'No redundant resolved note when matching');

const aggScope = getCapacityScopeCue('aggregate_period');
assertEqual(aggScope.selectedLabel, 'Aggregate Period', 'Aggregate label');

// 3. Mapping validation freshness
const unvalidated = getMappingValidationFreshness({
  currentSignature: 'sig-1',
  validatedSignature: null,
  validation: null,
});
assertEqual(unvalidated.status, 'unvalidated', 'Unvalidated initial state');

const validRes = { valid: true, issues: [], detected_summary: {} } as unknown as MappingValidationResponse;
const validated = getMappingValidationFreshness({
  currentSignature: 'sig-1',
  validatedSignature: 'sig-1',
  validation: validRes,
});
assertEqual(validated.status, 'validated', 'Validated matching signature');
assertEqual(validated.label, 'Mapping Validated', 'Validated label');

const modified = getMappingValidationFreshness({
  currentSignature: 'sig-2',
  validatedSignature: 'sig-1',
  validation: validRes,
});
assertEqual(modified.status, 'modified', 'Modified after validation');
assertEqual(modified.label, 'Modified Since Validation', 'Modified label');

const invalidRes = { valid: false, issues: [], detected_summary: {} } as unknown as MappingValidationResponse;
const validatedErr = getMappingValidationFreshness({
  currentSignature: 'sig-1',
  validatedSignature: 'sig-1',
  validation: invalidRes,
});
assertEqual(validatedErr.status, 'validated', 'Validated with errors');
assertEqual(validatedErr.label, 'Validated (Errors Found)', 'Error label');

console.log('modelingCues.test.ts: all assertions passed');

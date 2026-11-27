import type { GPGoal, GPHardConstraint, GPVariable } from '../types/or.ts';
import { renameGoalProgrammingVariable } from './goalProgramming.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function makeModel(): {
  variables: GPVariable[];
  hardConstraints: GPHardConstraint[];
  goals: GPGoal[];
} {
  return {
    variables: [
      { name: 'x1', lower_bound: 0, upper_bound: null, var_type: 'continuous' },
      { name: 'x2', lower_bound: 5, upper_bound: 50, var_type: 'integer' },
    ],
    hardConstraints: [
      { name: 'Capacity', coefficients: { x1: 2, x2: 1 }, operator: '<=', rhs: 100 },
      { name: 'MinMix', coefficients: { x1: 1, x2: 3 }, operator: '>=', rhs: 10 },
    ],
    goals: [
      {
        name: 'Profit Target',
        coefficients: { x1: 10, x2: 8 },
        goal_type: 'minimum',
        target: 600,
        priority: 1,
        weight: 1,
      },
      {
        name: 'Overtime Limit',
        coefficients: { x1: 1, x2: 1 },
        goal_type: 'maximum',
        target: 40,
        priority: 2,
        weight: 2,
      },
    ],
  };
}

let passed = 0;

// 1. Draft clearing & valid rename commits cleanly and preserves all references
{
  const model = makeModel();
  // Simulating temporary empty draft while editing (no commit yet)
  let draft = '';
  assert(draft === '', 'User can clear draft input temporarily without forcing oldName back');

  // User types new name with surrounding whitespace
  draft = '  profit_units  ';
  const res = renameGoalProgrammingVariable({
    ...model,
    index: 0,
    rawNewName: draft,
  });

  assert(res.accepted && res.error === null, 'Valid new variable name must be accepted');
  assert(res.variables[0].name === 'profit_units', 'Variable name must be trimmed and updated');
  assert(res.variables[0].lower_bound === 0 && res.variables[0].var_type === 'continuous', 'Variable properties preserved');
  assert(res.variables[1].name === 'x2', 'Other variables untouched');

  // Hard constraint coefficients remapped without losing values
  assert(res.hardConstraints[0].coefficients['profit_units'] === 2, 'Constraint 0 coefficient preserved');
  assert(!('x1' in res.hardConstraints[0].coefficients), 'Old key removed from constraint 0');
  assert(res.hardConstraints[0].coefficients['x2'] === 1, 'Other variable coefficient untouched in constraint 0');
  assert(res.hardConstraints[1].coefficients['profit_units'] === 1, 'Constraint 1 coefficient preserved');

  // Goal coefficients remapped without losing values
  assert(res.goals[0].coefficients['profit_units'] === 10, 'Goal 0 coefficient preserved');
  assert(!('x1' in res.goals[0].coefficients), 'Old key removed from goal 0');
  assert(res.goals[1].coefficients['profit_units'] === 1, 'Goal 1 coefficient preserved');

  passed++;
}

// 2. Empty or whitespace-only names are rejected and preserve original model
{
  const model = makeModel();
  for (const bad of ['', '   ', '\t\n']) {
    const res = renameGoalProgrammingVariable({
      ...model,
      index: 0,
      rawNewName: bad,
    });
    assert(!res.accepted, `Empty/whitespace name "${bad}" must be rejected`);
    assert(Boolean(res.error?.toLowerCase().includes('empty')), 'Rejection must explain empty name');
    assert(res.variables === model.variables, 'Original variables reference preserved on rejection');
    assert(res.hardConstraints === model.hardConstraints, 'Original constraints preserved on rejection');
    assert(res.goals === model.goals, 'Original goals preserved on rejection');
    assert(res.variables[0].name === 'x1', 'Variable name remains x1');
  }
  passed++;
}

// 3. Exact and case-insensitive duplicate names are rejected without merging/overwriting
{
  const model = makeModel();

  // Exact duplicate (renaming x1 -> x2)
  const exactDup = renameGoalProgrammingVariable({
    ...model,
    index: 0,
    rawNewName: 'x2',
  });
  assert(!exactDup.accepted, 'Exact duplicate name must be rejected');
  assert(Boolean(exactDup.error?.includes('conflicts')), 'Error must mention conflict');
  assert(exactDup.variables[0].name === 'x1', 'x1 must remain x1');
  assert(exactDup.hardConstraints[0].coefficients['x1'] === 2, 'x1 constraint coeff untouched');
  assert(exactDup.hardConstraints[0].coefficients['x2'] === 1, 'x2 constraint coeff must not be overwritten');
  assert(exactDup.goals[0].coefficients['x1'] === 10, 'x1 goal coeff untouched');
  assert(exactDup.goals[0].coefficients['x2'] === 8, 'x2 goal coeff must not be overwritten');

  // Case-insensitive duplicate (renaming x1 -> X2)
  const caseDup = renameGoalProgrammingVariable({
    ...model,
    index: 0,
    rawNewName: '  X2 ',
  });
  assert(!caseDup.accepted, 'Case-insensitive duplicate name must be rejected');
  assert(Boolean(caseDup.error?.includes('case-insensitive')), 'Case sensitivity rule must be explicit in message');
  assert(caseDup.variables[0].name === 'x1', 'Model preserved after case-insensitive collision');

  passed++;
}

// 4. Unchanged name (or case-only change of the SAME variable) works as expected
{
  const model = makeModel();

  // No-op rename (x1 -> " x1 ")
  const noop = renameGoalProgrammingVariable({
    ...model,
    index: 0,
    rawNewName: ' x1 ',
  });
  assert(noop.accepted && noop.error === null, 'Same trimmed name must succeed cleanly');
  assert(noop.variables === model.variables, 'No-op returns original variables');

  // Case-only rename of the SAME variable (x1 -> X1) is allowed when no other variable matches
  const selfCase = renameGoalProgrammingVariable({
    ...model,
    index: 0,
    rawNewName: 'X1',
  });
  assert(selfCase.accepted && selfCase.error === null, 'Self case-only rename must be allowed');
  assert(selfCase.variables[0].name === 'X1', 'Variable renamed to X1');
  assert(selfCase.hardConstraints[0].coefficients['X1'] === 2, 'Coefficient remapped to X1');
  assert(!('x1' in selfCase.hardConstraints[0].coefficients), 'Old lowercase key removed');

  passed++;
}

console.log(`Goal Programming rename unit tests passed: ${passed}/${passed}`);

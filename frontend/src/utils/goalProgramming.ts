import type { GPGoal, GPHardConstraint, GPVariable } from '../types/or';

export interface RenameVariableResult {
  accepted: boolean;
  error: string | null;
  variables: GPVariable[];
  hardConstraints: GPHardConstraint[];
  goals: GPGoal[];
}

/**
 * Validates and applies a Goal Programming decision variable rename atomically.
 *
 * Rules:
 * - Leading/trailing whitespace is trimmed on commit.
 * - Empty or whitespace-only names are rejected.
 * - Duplicate names are rejected using case-insensitive trimmed comparison
 *   to prevent accidental variable collisions or silent coefficient merges.
 * - On rejection, the original variables, hardConstraints, and goals are returned untouched.
 * - On acceptance, the variable name and all coefficient keys in hardConstraints
 *   and goals are updated atomically.
 */
export function renameGoalProgrammingVariable(params: {
  variables: GPVariable[];
  hardConstraints: GPHardConstraint[];
  goals: GPGoal[];
  index: number;
  rawNewName: string;
}): RenameVariableResult {
  const { variables, hardConstraints, goals, index, rawNewName } = params;

  if (index < 0 || index >= variables.length) {
    return {
      accepted: false,
      error: 'Selected variable no longer exists.',
      variables,
      hardConstraints,
      goals,
    };
  }

  const oldName = variables[index].name;
  const trimmed = rawNewName.trim();

  if (!trimmed) {
    return {
      accepted: false,
      error: `Variable name cannot be empty. Reverted to "${oldName}".`,
      variables,
      hardConstraints,
      goals,
    };
  }

  const normalizedCandidate = trimmed.toLowerCase();
  const duplicate = variables.find(
    (v, i) => i !== index && v.name.trim().toLowerCase() === normalizedCandidate
  );
  if (duplicate) {
    return {
      accepted: false,
      error: `Variable name "${trimmed}" conflicts with existing variable "${duplicate.name}" (names must be unique, case-insensitive). Reverted to "${oldName}".`,
      variables,
      hardConstraints,
      goals,
    };
  }

  if (trimmed === oldName) {
    return {
      accepted: true,
      error: null,
      variables,
      hardConstraints,
      goals,
    };
  }

  const nextVariables = variables.map((item, i) =>
    i === index ? { ...item, name: trimmed } : item
  );

  const remapCoefficients = (coeffs: Record<string, number>): Record<string, number> => {
    const next = { ...coeffs };
    const existingVal = Object.prototype.hasOwnProperty.call(next, oldName) ? next[oldName] : 0;
    delete next[oldName];
    next[trimmed] = existingVal;
    return next;
  };

  const nextHardConstraints = hardConstraints.map((hc) => ({
    ...hc,
    coefficients: remapCoefficients(hc.coefficients),
  }));

  const nextGoals = goals.map((g) => ({
    ...g,
    coefficients: remapCoefficients(g.coefficients),
  }));

  return {
    accepted: true,
    error: null,
    variables: nextVariables,
    hardConstraints: nextHardConstraints,
    goals: nextGoals,
  };
}

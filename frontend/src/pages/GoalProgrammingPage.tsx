import React, { useState } from 'react';
import {
  AlertCircle,
  Download,
  LineChart,
  Loader2,
  Play,
  Plus,
  Sigma,
  Table2,
  Target,
  Trash2,
} from 'lucide-react';
import { solveGoalProgramming } from '../api/client';
import { FormulationView } from '../components/FormulationView';
import { PlotlyChart } from '../components/PlotlyChart';
import { useStudio } from '../context/StudioContext';
import type { GPGoal, GPHardConstraint, GPVariable } from '../types/or';

export const GoalProgrammingPage: React.FC = () => {
  const { gpSolution, setGpSolution, addHistoryItem } = useStudio();

  const [method, setMethod] = useState<'weighted' | 'preemptive'>('preemptive');
  const [variables, setVariables] = useState<GPVariable[]>([
    { name: 'x1', lower_bound: 0, upper_bound: null, var_type: 'continuous' },
    { name: 'x2', lower_bound: 0, upper_bound: null, var_type: 'continuous' },
  ]);
  const [hardConstraints, setHardConstraints] = useState<GPHardConstraint[]>([
    { name: 'Capacity', coefficients: { x1: 2, x2: 1 }, operator: '<=', rhs: 100 },
  ]);
  const [goals, setGoals] = useState<GPGoal[]>([
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
  ]);

  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'results' | 'graphs' | 'formulation'>('results');

  const addVariable = () => {
    const nextIdx = variables.length + 1;
    let name = `x${nextIdx}`;
    while (variables.some((v) => v.name === name)) {
      name = `x${nextIdx}_${Math.floor(Math.random() * 100)}`;
    }
    setVariables((prev) => [
      ...prev,
      { name, lower_bound: 0, upper_bound: null, var_type: 'continuous' },
    ]);
  };

  const removeVariable = (idx: number) => {
    const removedName = variables[idx].name;
    setVariables((prev) => prev.filter((_, i) => i !== idx));
    setHardConstraints((prev) =>
      prev.map((hc) => {
        const copy = { ...hc.coefficients };
        delete copy[removedName];
        return { ...hc, coefficients: copy };
      })
    );
    setGoals((prev) =>
      prev.map((g) => {
        const copy = { ...g.coefficients };
        delete copy[removedName];
        return { ...g, coefficients: copy };
      })
    );
  };

  const addHardConstraint = () => {
    const coeffs: Record<string, number> = {};
    variables.forEach((v) => {
      coeffs[v.name] = 0;
    });
    setHardConstraints((prev) => [
      ...prev,
      { name: `Constraint ${prev.length + 1}`, coefficients: coeffs, operator: '<=', rhs: 10 },
    ]);
  };

  const addGoal = () => {
    const coeffs: Record<string, number> = {};
    variables.forEach((v) => {
      coeffs[v.name] = 0;
    });
    setGoals((prev) => [
      ...prev,
      {
        name: `Goal ${prev.length + 1}`,
        coefficients: coeffs,
        goal_type: 'minimum',
        target: 50,
        priority: prev.length + 1,
        weight: 1,
      },
    ]);
  };

  const handleSolve = async () => {
    setSolving(true);
    setError(null);
    try {
      const res = await solveGoalProgramming({
        method,
        variables,
        hard_constraints: hardConstraints,
        goals,
      });
      setGpSolution(res);
      setActiveTab('results');
      addHistoryItem({
        module: 'goal-programming',
        title: `Goal Programming (${method === 'preemptive' ? 'Preemptive' : 'Weighted'})`,
        status: res.status,
        isOptimal: res.is_optimal,
        objectiveSummary:
          res.is_optimal && res.total_weighted_penalty !== null
            ? `Penalty = ${res.total_weighted_penalty}`
            : `Status: ${res.status}`,
        payload: res,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to solve Goal Programming model.');
    } finally {
      setSolving(false);
    }
  };

  const handleExportCsv = () => {
    if (!gpSolution) return;
    const headers = [
      'Goal',
      'Type',
      'Priority',
      'Weight',
      'Target',
      'Achieved',
      'D_pos',
      'D_neg',
      'Penalty',
      'Status',
    ];
    const rows = gpSolution.goal_results.map((g) => [
      JSON.stringify(g.name),
      g.goal_type,
      g.target,
      g.achieved ?? '',
      g.positive_deviation ?? '',
      g.negative_deviation ?? '',
      g.priority,
      g.weight,
      g.penalty_contribution ?? '',
      g.status,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goal-programming-${gpSolution.method}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Target className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900">Goal Programming</h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Configure decision variables, hard constraints, and competing goals using Weighted or
            Preemptive Lexicographic optimization.
          </p>
        </div>

        {/* Method Selector */}
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setMethod('weighted')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              method === 'weighted'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Non-Preemptive Weighted
          </button>
          <button
            type="button"
            onClick={() => setMethod('preemptive')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              method === 'preemptive'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Preemptive Lexicographic
          </button>
        </div>
      </div>

      {/* Decision Variables */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">1. Decision Variables</h2>
          <button
            type="button"
            onClick={addVariable}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Variable
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {variables.map((v, idx) => (
            <div
              key={idx}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3"
            >
              <input
                type="text"
                value={v.name}
                onChange={(e) => {
                  const oldName = v.name;
                  const newName = e.target.value.trim() || oldName;
                  setVariables((prev) =>
                    prev.map((item, i) => (i === idx ? { ...item, name: newName } : item))
                  );
                  if (oldName !== newName) {
                    setHardConstraints((prev) =>
                      prev.map((hc) => {
                        const c = { ...hc.coefficients };
                        c[newName] = c[oldName] ?? 0;
                        delete c[oldName];
                        return { ...hc, coefficients: c };
                      })
                    );
                    setGoals((prev) =>
                      prev.map((g) => {
                        const c = { ...g.coefficients };
                        c[newName] = c[oldName] ?? 0;
                        delete c[oldName];
                        return { ...g, coefficients: c };
                      })
                    );
                  }
                }}
                className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs font-semibold text-slate-900"
                aria-label="Variable name"
              />
              <input
                type="number"
                value={v.lower_bound}
                onChange={(e) =>
                  setVariables((prev) =>
                    prev.map((item, i) =>
                      i === idx ? { ...item, lower_bound: Number(e.target.value) } : item
                    )
                  )
                }
                className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                title="Lower bound"
                aria-label="Lower bound"
              />
              <select
                value={v.var_type}
                onChange={(e) =>
                  setVariables((prev) =>
                    prev.map((item, i) =>
                      i === idx
                        ? { ...item, var_type: e.target.value as 'continuous' | 'integer' }
                        : item
                    )
                  )
                }
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                <option value="continuous">Continuous</option>
                <option value="integer">Integer</option>
              </select>
              {variables.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeVariable(idx)}
                  className="ml-auto text-slate-400 hover:text-rose-600"
                  aria-label="Remove variable"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Hard Constraints */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">2. Hard Constraints</h2>
          <button
            type="button"
            onClick={addHardConstraint}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Hard Constraint
          </button>
        </div>

        {hardConstraints.length === 0 ? (
          <p className="text-xs text-slate-500">No hard constraints defined.</p>
        ) : (
          <div className="space-y-3">
            {hardConstraints.map((hc, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3"
              >
                <input
                  type="text"
                  value={hc.name}
                  onChange={(e) =>
                    setHardConstraints((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, name: e.target.value } : item))
                    )
                  }
                  className="w-32 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium"
                  placeholder="Name"
                />
                {variables.map((v) => (
                  <label key={v.name} className="inline-flex items-center gap-1 text-xs">
                    <input
                      type="number"
                      step="any"
                      value={hc.coefficients[v.name] ?? 0}
                      onChange={(e) =>
                        setHardConstraints((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? {
                                  ...item,
                                  coefficients: {
                                    ...item.coefficients,
                                    [v.name]: Number(e.target.value),
                                  },
                                }
                              : item
                          )
                        )
                      }
                      className="w-16 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                    />
                    <span className="font-mono text-slate-600">{v.name}</span>
                  </label>
                ))}
                <select
                  value={hc.operator}
                  onChange={(e) =>
                    setHardConstraints((prev) =>
                      prev.map((item, i) =>
                        i === idx
                          ? { ...item, operator: e.target.value as '<=' | '>=' | '=' }
                          : item
                      )
                    )
                  }
                  className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                >
                  <option value="<=">&lt;=</option>
                  <option value=">=">&gt;=</option>
                  <option value="=">=</option>
                </select>
                <input
                  type="number"
                  step="any"
                  value={hc.rhs}
                  onChange={(e) =>
                    setHardConstraints((prev) =>
                      prev.map((item, i) =>
                        i === idx ? { ...item, rhs: Number(e.target.value) } : item
                      )
                    )
                  }
                  className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() =>
                    setHardConstraints((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="ml-auto text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Goals */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            3. Goals (with Deviation Variables D+ & D-)
          </h2>
          <button
            type="button"
            onClick={addGoal}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Goal
          </button>
        </div>

        <div className="space-y-3">
          {goals.map((g, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  type="text"
                  value={g.name}
                  onChange={(e) =>
                    setGoals((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, name: e.target.value } : item))
                    )
                  }
                  className="w-40 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold"
                  placeholder="Goal name"
                />
                <select
                  value={g.goal_type}
                  onChange={(e) =>
                    setGoals((prev) =>
                      prev.map((item, i) =>
                        i === idx
                          ? {
                              ...item,
                              goal_type: e.target.value as 'minimum' | 'maximum' | 'exact',
                            }
                          : item
                      )
                    )
                  }
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs"
                >
                  <option value="minimum">Minimum target (&gt;=, pen D-)</option>
                  <option value="maximum">Maximum target (&lt;=, pen D+)</option>
                  <option value="exact">Exact target (=, pen D- + D+)</option>
                </select>
                <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                  Target:
                  <input
                    type="number"
                    step="any"
                    value={g.target}
                    onChange={(e) =>
                      setGoals((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, target: Number(e.target.value) } : item
                        )
                      )
                    }
                    className="w-20 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900"
                  />
                </label>
                <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                  Priority:
                  <input
                    type="number"
                    min={1}
                    value={g.priority}
                    onChange={(e) =>
                      setGoals((prev) =>
                        prev.map((item, i) =>
                          i === idx
                            ? { ...item, priority: Math.max(1, Number(e.target.value)) }
                            : item
                        )
                      )
                    }
                    className="w-14 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900"
                  />
                </label>
                <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                  Weight:
                  <input
                    type="number"
                    step="any"
                    min={0.01}
                    value={g.weight}
                    onChange={(e) =>
                      setGoals((prev) =>
                        prev.map((item, i) =>
                          i === idx
                            ? { ...item, weight: Math.max(0.01, Number(e.target.value)) }
                            : item
                        )
                      )
                    }
                    className="w-16 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900"
                  />
                </label>
                {goals.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setGoals((prev) => prev.filter((_, i) => i !== idx))}
                    className="ml-auto text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-500">Expression:</span>
                {variables.map((v) => (
                  <label key={v.name} className="inline-flex items-center gap-1">
                    <input
                      type="number"
                      step="any"
                      value={g.coefficients[v.name] ?? 0}
                      onChange={(e) =>
                        setGoals((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? {
                                  ...item,
                                  coefficients: {
                                    ...item.coefficients,
                                    [v.name]: Number(e.target.value),
                                  },
                                }
                              : item
                          )
                        )
                      }
                      className="w-16 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                    />
                    <span className="font-mono text-slate-700">{v.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            disabled={solving}
            onClick={() => void handleSolve()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
          >
            {solving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Solve Goal Program
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {/* Results, Graphs & Formulation */}
      {gpSolution && (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
            <div className="flex gap-1">
              {[
                { id: 'results', label: 'Results & Deviations', icon: Table2 },
                { id: 'graphs', label: 'Visualizations', icon: LineChart },
                { id: 'formulation', label: 'Mathematical Formulation', icon: Sigma },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id as typeof activeTab)}
                  className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                    activeTab === id
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {gpSolution.is_optimal && (
              <button
                type="button"
                onClick={handleExportCsv}
                className="mb-1 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            )}
          </div>

          {activeTab === 'results' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="text-xs font-medium text-slate-500">Solver Status</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        gpSolution.is_optimal
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {gpSolution.status}
                    </span>
                    <span className="text-xs text-slate-500">
                      {gpSolution.solve_time_seconds}s
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="text-xs font-medium text-slate-500">Method</div>
                  <div className="mt-1 text-sm font-semibold capitalize text-slate-900">
                    {gpSolution.method === 'preemptive'
                      ? 'Preemptive Lexicographic'
                      : 'Non-Preemptive Weighted'}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="text-xs font-medium text-slate-500">Total Weighted Penalty</div>
                  <div className="mt-1 font-mono text-xl font-bold text-slate-900">
                    {gpSolution.total_weighted_penalty !== null
                      ? gpSolution.total_weighted_penalty.toLocaleString()
                      : 'N/A'}
                  </div>
                </div>
              </div>

              {!gpSolution.is_optimal ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                  {gpSolution.message}
                </div>
              ) : (
                <>
                  {/* Decision Variable Values */}
                  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                    <h3 className="mb-3 text-sm font-semibold text-slate-900">
                      Optimal Decision Variables
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      {Object.entries(gpSolution.variable_values).map(([vn, val]) => (
                        <div
                          key={vn}
                          className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2"
                        >
                          <span className="font-mono text-xs text-slate-500">{vn} = </span>
                          <span className="font-mono text-sm font-bold text-slate-900">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Goal Achievement Table */}
                  <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                    <div className="border-b border-slate-200 px-5 py-3.5">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Goal Achievement & Deviation Analysis
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-500 uppercase">
                          <tr>
                            <th className="px-4 py-2.5 font-semibold">Goal</th>
                            <th className="px-4 py-2.5 font-semibold">Type</th>
                            <th className="px-4 py-2.5 font-semibold">Priority</th>
                            <th className="px-4 py-2.5 font-semibold">Weight</th>
                            <th className="px-4 py-2.5 font-semibold">Target</th>
                            <th className="px-4 py-2.5 font-semibold">Achieved</th>
                            <th className="px-4 py-2.5 font-semibold">D+</th>
                            <th className="px-4 py-2.5 font-semibold">D-</th>
                            <th className="px-4 py-2.5 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {gpSolution.goal_results.map((g, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/70">
                              <td className="px-4 py-2.5 font-semibold text-slate-900">
                                {g.name}
                              </td>
                              <td className="px-4 py-2.5 capitalize text-slate-600">
                                {g.goal_type}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-slate-700">
                                P{g.priority}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-slate-700">{g.weight}</td>
                              <td className="px-4 py-2.5 font-mono text-slate-700">{g.target}</td>
                              <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                                {g.achieved}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-slate-700">
                                {g.positive_deviation}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-slate-700">
                                {g.negative_deviation}
                              </td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    g.status === 'Achieved'
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-amber-50 text-amber-700'
                                  }`}
                                >
                                  {g.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'graphs' && (
            <div className="space-y-6">
              {!gpSolution.is_optimal ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
                  Charts are only generated when an Optimal solution is available.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {/* Target vs Achieved */}
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                    <PlotlyChart
                      data={[
                        {
                          x: gpSolution.goal_results.map((g) => g.name),
                          y: gpSolution.goal_results.map((g) => g.target),
                          name: 'Target',
                          type: 'bar',
                          marker: { color: '#94a3b8' },
                        },
                        {
                          x: gpSolution.goal_results.map((g) => g.name),
                          y: gpSolution.goal_results.map((g) => g.achieved ?? 0),
                          name: 'Achieved',
                          type: 'bar',
                          marker: { color: '#2563eb' },
                        },
                      ]}
                      layout={{
                        title: { text: 'Goal Target vs. Achieved' },
                        barmode: 'group',
                        xaxis: { title: 'Goal' },
                        yaxis: { title: 'Value' },
                      }}
                    />
                  </div>

                  {/* Deviation Comparison */}
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                    <h4 className="mb-1 text-sm font-semibold text-slate-900">
                      Deviation Variables (D+ vs. D−)
                    </h4>
                    <p className="mb-3 text-xs text-slate-500">
                      D+ = overachievement (value exceeded target); D− = underachievement (value
                      fell short of target). A zero value means the goal was met exactly on that
                      side.
                    </p>
                    <PlotlyChart
                      height={300}
                      data={[
                        {
                          x: gpSolution.goal_results.map((g) => g.name),
                          y: gpSolution.goal_results.map((g) => g.positive_deviation ?? 0),
                          name: 'D+ (Overachievement)',
                          type: 'bar',
                          marker: { color: '#2563eb' },
                          text: gpSolution.goal_results.map((g) =>
                            (g.positive_deviation ?? 0).toLocaleString(undefined, {
                              maximumFractionDigits: 4,
                            })
                          ),
                          textposition: 'outside',
                          cliponaxis: false,
                          hovertemplate:
                            '<b>%{x}</b><br>D+ (Overachievement): %{y:,.4f}<extra></extra>',
                        },
                        {
                          x: gpSolution.goal_results.map((g) => g.name),
                          y: gpSolution.goal_results.map((g) => g.negative_deviation ?? 0),
                          name: 'D− (Underachievement)',
                          type: 'bar',
                          marker: { color: '#f59e0b' },
                          text: gpSolution.goal_results.map((g) =>
                            (g.negative_deviation ?? 0).toLocaleString(undefined, {
                              maximumFractionDigits: 4,
                            })
                          ),
                          textposition: 'outside',
                          cliponaxis: false,
                          hovertemplate:
                            '<b>%{x}</b><br>D− (Underachievement): %{y:,.4f}<extra></extra>',
                        },
                      ]}
                      layout={{
                        barmode: 'group',
                        margin: { t: 24, r: 16, b: 56, l: 56 },
                        legend: {
                          orientation: 'h',
                          x: 0,
                          y: 1.02,
                          xanchor: 'left',
                          yanchor: 'bottom',
                          font: { size: 11 },
                        },
                        xaxis: { title: 'Goal', automargin: true },
                        yaxis: { title: 'Deviation', automargin: true },
                      }}
                    />
                  </div>

                  {/* Priority / Weighted Penalties */}
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-2">
                    <h4 className="mb-1 text-sm font-semibold text-slate-900">
                      Weighted Penalty Contribution by Goal &amp; Priority
                    </h4>
                    <p className="mb-3 text-xs text-slate-500">
                      Each bar shows the weighted penalty a goal contributes to the objective
                      function. A zero contribution means the goal was fully satisfied (no
                      penalised deviation).
                    </p>
                    {gpSolution.goal_results.some(
                      (g) => g.penalty_contribution !== null
                    ) ? (
                      <PlotlyChart
                        height={Math.max(260, gpSolution.goal_results.length * 48 + 80)}
                        data={[
                          {
                            y: gpSolution.goal_results.map(
                              (g) => `${g.name} · P${g.priority} · w=${g.weight}`
                            ),
                            x: gpSolution.goal_results.map(
                              (g) => g.penalty_contribution ?? 0
                            ),
                            name: 'Weighted Penalty',
                            type: 'bar',
                            orientation: 'h',
                            marker: {
                              color: gpSolution.goal_results.map((g) =>
                                (g.penalty_contribution ?? 0) === 0 ? '#94a3b8' : '#2563eb'
                              ),
                            },
                            text: gpSolution.goal_results.map((g) =>
                              (g.penalty_contribution ?? 0).toLocaleString(undefined, {
                                maximumFractionDigits: 4,
                              })
                            ),
                            textposition: 'outside',
                            cliponaxis: false,
                            hovertemplate:
                              '<b>%{y}</b><br>Weighted Penalty: %{x:,.4f}<extra></extra>',
                          },
                        ]}
                        layout={{
                          margin: { t: 24, r: 80, b: 56, l: 220 },
                          xaxis: { title: 'Weighted Penalty Contribution', automargin: true },
                          yaxis: { automargin: true, autorange: 'reversed' },
                        }}
                      />
                    ) : (
                      <p className="py-6 text-center text-sm text-slate-500">
                        Penalty contribution data is unavailable for this solution.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'formulation' && (
            <FormulationView formulation={gpSolution.formulation} />
          )}
        </section>
      )}
    </div>
  );
};

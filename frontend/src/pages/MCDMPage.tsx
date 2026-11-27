import React, { useState } from 'react';
import {
  AlertCircle,
  LineChart,
  Loader2,
  Play,
  Plus,
  Scale,
  Sigma,
  Table2,
  Trash2,
} from 'lucide-react';
import { solveMCDM } from '../api/client';
import { FormulationView } from '../components/FormulationView';
import { PlotlyChart } from '../components/PlotlyChart';
import { useStudio } from '../context/StudioContext';
import type { MCDMAlternative, MCDMCriterion } from '../types/or';

export const MCDMPage: React.FC = () => {
  const { mcdmSolution, setMcdmSolution, addHistoryItem } = useStudio();

  const [method, setMethod] = useState<'topsis' | 'wsm'>('topsis');
  const [criteria, setCriteria] = useState<MCDMCriterion[]>([
    { name: 'Cost', weight: 0.4, direction: 'cost' },
    { name: 'Quality', weight: 0.35, direction: 'benefit' },
    { name: 'Lead Time', weight: 0.25, direction: 'cost' },
  ]);
  const [alternatives, setAlternatives] = useState<MCDMAlternative[]>([
    { name: 'Option A', scores: { Cost: 120, Quality: 85, 'Lead Time': 5 } },
    { name: 'Option B', scores: { Cost: 145, Quality: 94, 'Lead Time': 3 } },
    { name: 'Option C', scores: { Cost: 105, Quality: 72, 'Lead Time': 7 } },
  ]);

  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'results' | 'graphs' | 'formulation'>('results');

  const addCriterion = () => {
    const name = `Criterion ${criteria.length + 1}`;
    setCriteria((prev) => [...prev, { name, weight: 1, direction: 'benefit' }]);
    setAlternatives((prev) =>
      prev.map((a) => ({ ...a, scores: { ...a.scores, [name]: 0 } }))
    );
  };

  const removeCriterion = (idx: number) => {
    const name = criteria[idx].name;
    setCriteria((prev) => prev.filter((_, i) => i !== idx));
    setAlternatives((prev) =>
      prev.map((a) => {
        const s = { ...a.scores };
        delete s[name];
        return { ...a, scores: s };
      })
    );
  };

  const addAlternative = () => {
    const scores: Record<string, number> = {};
    criteria.forEach((c) => {
      scores[c.name] = 0;
    });
    setAlternatives((prev) => [
      ...prev,
      { name: `Option ${String.fromCharCode(65 + prev.length)}`, scores },
    ]);
  };

  const handleSolve = async () => {
    setSolving(true);
    setError(null);
    try {
      const res = await solveMCDM(method, criteria, alternatives);
      setMcdmSolution(res);
      setActiveTab('results');
      addHistoryItem({
        module: 'mcdm',
        title: `MCDM Ranking (${method.toUpperCase()})`,
        status: res.status,
        isOptimal: true,
        objectiveSummary: `Top: ${res.rankings[0]?.alternative} (${res.rankings[0]?.score})`,
        payload: res,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MCDM evaluation failed.');
    } finally {
      setSolving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Scale className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900">
              Multi-Criteria Decision Making (MCDM)
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Rank discrete alternatives across weighted benefit and cost criteria using TOPSIS or
            Weighted Sum Model.
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setMethod('topsis')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              method === 'topsis'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            TOPSIS
          </button>
          <button
            type="button"
            onClick={() => setMethod('wsm')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              method === 'wsm'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Weighted Sum (WSM)
          </button>
        </div>
      </div>

      {/* Criteria Builder */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">1. Decision Criteria & Weights</h2>
          <button
            type="button"
            onClick={addCriterion}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Criterion
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {criteria.map((c, idx) => (
            <div
              key={idx}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3"
            >
              <input
                type="text"
                value={c.name}
                onChange={(e) => {
                  const oldName = c.name;
                  const newName = e.target.value || oldName;
                  setCriteria((prev) =>
                    prev.map((item, i) => (i === idx ? { ...item, name: newName } : item))
                  );
                  if (oldName !== newName) {
                    setAlternatives((prev) =>
                      prev.map((a) => {
                        const s = { ...a.scores };
                        s[newName] = s[oldName] ?? 0;
                        delete s[oldName];
                        return { ...a, scores: s };
                      })
                    );
                  }
                }}
                className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold"
              />
              <input
                type="number"
                step="0.05"
                min="0.01"
                value={c.weight}
                onChange={(e) =>
                  setCriteria((prev) =>
                    prev.map((item, i) =>
                      i === idx ? { ...item, weight: Math.max(0.01, Number(e.target.value)) } : item
                    )
                  )
                }
                className="w-16 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
              />
              <select
                value={c.direction}
                onChange={(e) =>
                  setCriteria((prev) =>
                    prev.map((item, i) =>
                      i === idx
                        ? { ...item, direction: e.target.value as 'benefit' | 'cost' }
                        : item
                    )
                  )
                }
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                <option value="benefit">Benefit (Max)</option>
                <option value="cost">Cost (Min)</option>
              </select>
              {criteria.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeCriterion(idx)}
                  className="ml-auto text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Decision Matrix */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">2. Decision Matrix</h2>
          <button
            type="button"
            onClick={addAlternative}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Alternative
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 font-semibold">Alternative</th>
                {criteria.map((c) => (
                  <th key={c.name} className="px-3 py-2 font-semibold">
                    {c.name} ({c.direction})
                  </th>
                ))}
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {alternatives.map((a, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={a.name}
                      onChange={(e) =>
                        setAlternatives((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, name: e.target.value } : item
                          )
                        )
                      }
                      className="w-36 rounded border border-slate-300 px-2.5 py-1 text-xs font-medium"
                    />
                  </td>
                  {criteria.map((c) => (
                    <td key={c.name} className="px-3 py-2">
                      <input
                        type="number"
                        step="any"
                        value={a.scores[c.name] ?? 0}
                        onChange={(e) =>
                          setAlternatives((prev) =>
                            prev.map((item, i) =>
                              i === idx
                                ? {
                                    ...item,
                                    scores: {
                                      ...item.scores,
                                      [c.name]: Number(e.target.value),
                                    },
                                  }
                                : item
                            )
                          )
                        }
                        className="w-24 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    {alternatives.length > 2 && (
                      <button
                        type="button"
                        onClick={() =>
                          setAlternatives((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5">
          <button
            type="button"
            disabled={solving}
            onClick={() => void handleSolve()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
          >
            {solving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Compute Rankings
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {mcdmSolution && (
        <section className="space-y-6">
          <div className="flex max-w-full flex-wrap gap-1 overflow-x-auto border-b border-slate-200 sm:flex-nowrap">
            {[
              { id: 'results', label: 'Rankings', icon: Table2 },
              { id: 'graphs', label: 'Visualizations', icon: LineChart },
              { id: 'formulation', label: 'Mathematical Formulation', icon: Sigma },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id as typeof activeTab)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm ${
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

          {activeTab === 'results' && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Rank</th>
                    <th className="px-4 py-2.5 font-semibold">Alternative</th>
                    <th className="px-4 py-2.5 font-semibold">Score</th>
                    {mcdmSolution.method === 'topsis' && (
                      <>
                        <th className="px-4 py-2.5 font-semibold">D+ (Ideal)</th>
                        <th className="px-4 py-2.5 font-semibold">D- (Anti-Ideal)</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mcdmSolution.rankings.map((r) => (
                    <tr key={r.alternative} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 font-mono font-bold text-blue-700">#{r.rank}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{r.alternative}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-900">{r.score}</td>
                      {mcdmSolution.method === 'topsis' && (
                        <>
                          <td className="px-4 py-2.5 font-mono text-slate-600">
                            {r.distance_ideal}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-600">
                            {r.distance_anti_ideal}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'graphs' && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <h4 className="mb-2 text-sm font-semibold text-slate-900">
                {mcdmSolution.method.toUpperCase()} Preference Scores
              </h4>
              <PlotlyChart
                height={340}
                data={[
                  {
                    x: mcdmSolution.rankings.map((r) => r.alternative),
                    y: mcdmSolution.rankings.map((r) => r.score),
                    type: 'bar',
                    marker: { color: '#2563eb' },
                  },
                ]}
                layout={{
                  margin: { t: 24, r: 16, b: 56, l: 56 },
                  xaxis: { title: 'Alternative', automargin: true },
                  yaxis: { title: 'Score', range: [0, 1], automargin: true },
                }}
              />
            </div>
          )}

          {activeTab === 'formulation' && (
            <FormulationView formulation={mcdmSolution.formulation} />
          )}
        </section>
      )}
    </div>
  );
};

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  GitBranch,
  LineChart,
  Scale,
  Sigma,
  Target,
  XCircle,
} from 'lucide-react';
import { useStudio } from '../context/StudioContext';

const WORKFLOW_STEPS = [
  { label: 'Dataset', desc: 'Upload CSV or Excel & inspect schema', icon: Database },
  { label: 'Model', desc: 'Map columns or define variables & goals', icon: GitBranch },
  { label: 'Solver', desc: 'Run exact LP / MILP via PuLP CBC', icon: Activity },
  { label: 'Results', desc: 'Verify feasibility & inspect schedules', icon: CheckCircle2 },
  { label: 'Graphs', desc: 'Interactive Plotly.js visual analytics', icon: LineChart },
  { label: 'Mathematical Formulation', desc: 'Exact KaTeX model equations', icon: Sigma },
];

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { dataset, history } = useStudio();

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs lg:p-8">
        <div className="max-w-3xl">
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
            OR Studio v1.0
          </span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 lg:text-3xl">
            Interactive Operations Research Solver
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 lg:text-base">
            OR Studio is a scientific decision-analytics workbench for formulating, solving,
            visualizing, and auditing mathematical optimization models. Upload real production
            datasets, map parameters without silent approximations, solve exact LP/MILP and Goal
            Programming models with PuLP CBC, and inspect the generated KaTeX mathematical
            formulation.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/datasets')}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-blue-700"
            >
              <FileSpreadsheet className="h-4 w-4" />
              {dataset ? 'Inspect Loaded Dataset' : 'Upload Dataset'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/goal-programming')}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Open Goal Programming
            </button>
          </div>
        </div>
      </section>

      {/* Three Interactive Solver Cards */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <button
          type="button"
          onClick={() => navigate('/multi-period')}
          className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 text-left shadow-xs transition-all hover:border-blue-300 hover:shadow-sm"
        >
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
              <Activity className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">
              Multi-Period Optimization
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              Capacitated multi-product production planning and inventory balance across time
              periods using your uploaded CSV or Excel dataset.
            </p>
          </div>
          <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600">
            Configure & Solve
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate('/goal-programming')}
          className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 text-left shadow-xs transition-all hover:border-blue-300 hover:shadow-sm"
        >
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
              <Target className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Goal Programming</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              Define competing targets, priorities, weights, and hard constraints. Solve via
              non-preemptive weighted or preemptive lexicographic optimization.
            </p>
          </div>
          <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600">
            Build Goal Model
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate('/mcdm')}
          className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 text-left shadow-xs transition-all hover:border-blue-300 hover:shadow-sm"
        >
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
              <Scale className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">MCDM</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              Multi-Criteria Decision Making using TOPSIS and Weighted Sum Model (WSM) to rank
              alternatives across weighted benefit and cost criteria.
            </p>
          </div>
          <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600">
            Evaluate Alternatives
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </button>
      </section>

      {/* Workflow Explanation Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <h2 className="text-base font-semibold text-slate-900">End-to-End Modeling Workflow</h2>
        <p className="mt-1 text-xs text-slate-500">
          Every optimization run follows a transparent, verifiable pipeline from raw data to
          mathematical proof.
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {WORKFLOW_STEPS.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div
                key={step.label}
                className="relative flex flex-col rounded-lg border border-slate-200 bg-slate-50/70 p-3.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-blue-600">0{idx + 1}</span>
                  <Icon className="h-4 w-4 text-slate-500" />
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{step.label}</div>
                <div className="mt-1 text-xs text-slate-500">{step.desc}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Recent Analysis Section (Real runs only, no fabricated data) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Recent Analysis</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Verified solver runs from your current session history.
            </p>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              View all ({history.length})
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
            <p className="text-sm font-medium text-slate-700">No solver runs recorded yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              Run a Multi-Period Optimization, Goal Programming, or MCDM model to see real
              results here.
            </p>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {history.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="flex items-center gap-3">
                  {item.isOptimal ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-amber-600" />
                  )}
                  <div>
                    <div className="font-medium text-slate-900">{item.title}</div>
                    <div className="text-xs text-slate-500">
                      {new Date(item.timestamp).toLocaleString()}
                      {item.datasetName ? ` · ${item.datasetName}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-slate-700">
                    {item.objectiveSummary}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      item.isOptimal
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

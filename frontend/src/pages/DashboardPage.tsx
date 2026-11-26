import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Database,
  FileSpreadsheet,
  FlaskConical,
  GitBranch,
  History,
  LineChart,
  Scale,
  Sigma,
  Target,
  XCircle,
  Zap,
} from 'lucide-react';
import { useStudio } from '../context/StudioContext';

// ── Workflow steps ────────────────────────────────────────────────────────────
const WORKFLOW_STEPS = [
  {
    num: '01',
    label: 'Define Problem',
    desc: 'Choose the optimization type that matches your business question.',
    icon: BookOpen,
    to: '/',
  },
  {
    num: '02',
    label: 'Prepare Data',
    desc: 'Upload CSV or Excel and validate column schema.',
    icon: Database,
    to: '/datasets',
  },
  {
    num: '03',
    label: 'Build Model',
    desc: 'Map columns, configure variables, goals, and constraints.',
    icon: GitBranch,
    to: '/multi-period',
  },
  {
    num: '04',
    label: 'Optimize',
    desc: 'Solve the exact LP/MILP or Goal Programming model with PuLP CBC.',
    icon: Sigma,
    to: '/multi-period',
  },
  {
    num: '05',
    label: 'Explore Results',
    desc: 'Inspect schedules, charts, and mathematical formulation.',
    icon: LineChart,
    to: '/multi-period',
  },
  {
    num: '06',
    label: 'Make Decision',
    desc: 'Use What-If Lab to compare scenarios and confirm the optimal plan.',
    icon: Zap,
    to: '/what-if',
  },
];

// ── Optimization module cards ─────────────────────────────────────────────────
const MODULES = [
  {
    to: '/multi-period',
    icon: Activity,
    title: 'Multi-Period Optimization',
    subtitle: 'Production Planning & Inventory',
    description:
      'Solve capacitated multi-product, multi-period production planning with inventory balance constraints. Upload your dataset and let the solver minimise cost while meeting demand.',
    tags: ['LP / MILP', 'Production', 'Inventory'],
    cta: 'Configure & Solve',
  },
  {
    to: '/goal-programming',
    icon: Target,
    title: 'Goal Programming',
    subtitle: 'Competing Objectives',
    description:
      'Balance multiple conflicting targets — profit, overtime, quality — with priority weights. Use weighted or preemptive lexicographic methods to find the least-deviation solution.',
    tags: ['Weighted', 'Preemptive', 'Deviation'],
    cta: 'Build Goal Model',
  },
  {
    to: '/mcdm',
    icon: Scale,
    title: 'MCDM',
    subtitle: 'Multi-Criteria Decision Making',
    description:
      'Rank discrete alternatives across benefit and cost criteria using TOPSIS or Weighted Sum Model. Ideal for supplier selection, site ranking, and policy evaluation.',
    tags: ['TOPSIS', 'WSM', 'Ranking'],
    cta: 'Evaluate Alternatives',
  },
  {
    to: '/what-if',
    icon: FlaskConical,
    title: 'What-If Decision Lab',
    subtitle: 'Scenario Experimentation',
    description:
      'Experiment with demand changes, capacity constraints, and cost shifts. Compare baseline results against alternative scenarios to make confident decisions.',
    tags: ['Scenarios', 'Comparison', 'Sensitivity'],
    cta: 'Open Lab',
  },
];

// ── Quick actions ─────────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  {
    label: 'Upload Dataset',
    desc: 'Start with your own CSV or Excel file.',
    icon: FileSpreadsheet,
    to: '/datasets',
    primary: true,
  },
  {
    label: 'Run Optimization',
    desc: 'Jump straight to Multi-Period setup.',
    icon: Activity,
    to: '/multi-period',
    primary: false,
  },
  {
    label: 'Try Goal Programming',
    desc: 'Balance competing business targets.',
    icon: Target,
    to: '/goal-programming',
    primary: false,
  },
  {
    label: 'What-If Lab',
    desc: 'Compare scenarios against your baseline.',
    icon: FlaskConical,
    to: '/what-if',
    primary: false,
  },
  {
    label: 'Solution History',
    desc: 'Review past solver runs in this session.',
    icon: History,
    to: '/history',
    primary: false,
  },
];

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { dataset, history, mpSolution } = useStudio();

  return (
    <div className="space-y-8">
      {/* ── Hero section ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-600 to-blue-800 p-6 text-white shadow-sm lg:p-8">
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center rounded-full border border-blue-400/50 bg-blue-500/30 px-2.5 py-0.5 text-xs font-semibold">
            OR Studio v1.0 · PuLP CBC Solver
          </span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight lg:text-3xl">
            Your Operations Research Decision Workspace
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-blue-100 lg:text-base">
            Upload real production data, build exact LP/MILP and Goal Programming models,
            solve to optimality, and explore decisions with confidence — without silent
            approximations or fabricated results.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(dataset ? '/multi-period' : '/datasets')}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-xs transition-all hover:bg-blue-50"
            >
              <Zap className="h-4 w-4" />
              {dataset
                ? mpSolution?.is_optimal
                  ? 'View Results'
                  : 'Configure Model'
                : 'Get Started'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/what-if')}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-400/50 bg-blue-500/20 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-blue-500/30"
            >
              <FlaskConical className="h-4 w-4" />
              Explore Scenarios
            </button>
          </div>
        </div>
        {/* Decorative background element */}
        <div
          aria-hidden
          className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-blue-900/20 to-transparent"
        />
      </section>

      {/* ── Status strip (shows only when dataset or solution is active) ──── */}
      {(dataset || mpSolution) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-xs text-xs">
          {dataset && (
            <div className="flex items-center gap-2 text-slate-600">
              <FileSpreadsheet className="h-3.5 w-3.5 text-blue-600" />
              <span>
                <span className="font-semibold text-slate-900">{dataset.filename}</span> ·{' '}
                {dataset.row_count.toLocaleString()} rows · {dataset.column_count} cols
              </span>
            </div>
          )}
          {dataset && mpSolution && (
            <span className="hidden text-slate-300 sm:inline">|</span>
          )}
          {mpSolution && (
            <div className="flex items-center gap-2">
              {mpSolution.is_optimal ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-amber-600" />
              )}
              <span className={mpSolution.is_optimal ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                {mpSolution.is_optimal ? 'Optimal solution loaded' : 'Infeasible'}
              </span>
              {mpSolution.is_optimal && (
                <span className="text-slate-500">
                  · Objective {(mpSolution.objective_value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => navigate('/multi-period')}
            className="ml-auto inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-semibold"
          >
            Open <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Optimization modules grid ─────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-base font-semibold text-slate-900">Optimization Modules</h2>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {MODULES.map((mod) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.to}
                type="button"
                onClick={() => navigate(mod.to)}
                className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 text-left shadow-xs transition-all hover:border-blue-300 hover:shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className="text-[11px] font-medium text-slate-400">{mod.subtitle}</span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-slate-900">{mod.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{mod.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {mod.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600">
                  {mod.cta}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-slate-900">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.to}
                type="button"
                onClick={() => navigate(action.to)}
                className={`group flex flex-col gap-2 rounded-xl border p-4 text-left transition-all ${
                  action.primary
                    ? 'border-blue-200 bg-blue-50 hover:border-blue-300 hover:bg-blue-100'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                } shadow-xs`}
              >
                <Icon
                  className={`h-4 w-4 ${action.primary ? 'text-blue-600' : 'text-slate-500'}`}
                />
                <div>
                  <div
                    className={`text-xs font-semibold ${
                      action.primary ? 'text-blue-900' : 'text-slate-800'
                    }`}
                  >
                    {action.label}
                  </div>
                  <div className="text-[11px] text-slate-500">{action.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Workflow pipeline ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <h2 className="text-base font-semibold text-slate-900">Decision-Making Workflow</h2>
        <p className="mt-1 text-xs text-slate-500">
          Every optimization run follows a transparent, verifiable pipeline — from raw data to
          confident decisions.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {WORKFLOW_STEPS.map((step, idx) => {
            const Icon = step.icon;
            return (
              <button
                key={step.label}
                type="button"
                onClick={() => navigate(step.to)}
                className="group relative flex flex-col rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-left transition-all hover:border-blue-300 hover:bg-blue-50/40"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-blue-600">{step.num}</span>
                  <Icon className="h-4 w-4 text-slate-400 group-hover:text-blue-500 transition-colors" />
                </div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{step.label}</div>
                <div className="mt-1 text-[11px] text-slate-500">{step.desc}</div>
                {idx < WORKFLOW_STEPS.length - 1 && (
                  <ChevronRight className="absolute -right-2 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-slate-300 lg:block" />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Recent Analysis ───────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Recent Analysis</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Verified solver runs from your current session. Persisted in local storage.
            </p>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              View all ({history.length})
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
            <Activity className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">No solver runs recorded yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              Run an optimization to see real results appear here.
            </p>
            <button
              type="button"
              onClick={() => navigate('/multi-period')}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Start with Multi-Period
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {history.slice(0, 6).map((item) => (
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

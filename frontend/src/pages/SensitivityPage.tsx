import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Info,
  Loader2,
  Play,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { analyzeSensitivity } from '../api/client';
import { PlotlyChart } from '../components/PlotlyChart';
import { useStudio } from '../context/StudioContext';
import type { SensitivityParameter, SensitivityPointResult } from '../types/or';
import {
  DEFAULT_MAX_MULTIPLIER,
  DEFAULT_MIN_MULTIPLIER,
  DEFAULT_NUM_POINTS,
  MAX_MULTIPLIER_BOUND,
  MAX_SWEEP_POINTS,
  MIN_MULTIPLIER_BOUND,
  MIN_SWEEP_POINTS,
  PLAN_SHIFT_MODERATE_THRESHOLD_PCT,
  PLAN_SHIFT_STABLE_THRESHOLD_PCT,
  buildPlanStabilityChart,
  buildRobustnessInterpretation,
  buildSensitivityCurveChart,
  buildSensitivityRequest,
  checkBaselineConsistency,
  classifyPointStatus,
  formatNumberOrNull,
  formatSensitivityApiError,
  getMappingSignature,
  getSensitivityParameterOptions,
  validateSensitivityInputs,
} from '../utils/sensitivityAnalysis';

const BADGE_CLASSES: Record<'emerald' | 'rose' | 'amber' | 'slate', string> = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rose: 'border-rose-200 bg-rose-50 text-rose-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  slate: 'border-slate-200 bg-slate-100 text-slate-700',
};

export const SensitivityPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    dataset,
    mpMapping,
    mpCapacityScope,
    mpIntegerProd,
    mpSolution,
    mpSolutionMappingSignature,
    sensitivityResult: result,
    setSensitivityResult,
  } = useStudio();

  const paramOptions = useMemo(() => getSensitivityParameterOptions(mpMapping), [mpMapping]);
  const [parameter, setParameter] = useState<SensitivityParameter>('demand');
  const [minMultiplierInput, setMinMultiplierInput] = useState<string>(
    DEFAULT_MIN_MULTIPLIER.toFixed(2)
  );
  const [maxMultiplierInput, setMaxMultiplierInput] = useState<string>(
    DEFAULT_MAX_MULTIPLIER.toFixed(2)
  );
  const [numPointsInput, setNumPointsInput] = useState<string>(String(DEFAULT_NUM_POINTS));

  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMultiplier, setSelectedMultiplier] = useState<number | null>(null);

  // If the selected parameter becomes unavailable (e.g. mapping changed), fall back to demand.
  useEffect(() => {
    const activeOpt = paramOptions.find((o) => o.value === parameter);
    if (activeOpt && !activeOpt.available) {
      setParameter('demand');
    }
  }, [paramOptions, parameter]);

  // Clear local selection when dataset or baseline changes.
  useEffect(() => {
    setSelectedMultiplier(null);
    setError(null);
  }, [dataset?.dataset_id, mpSolution]);

  const baselineCheck = useMemo(
    () =>
      checkBaselineConsistency({
        dataset,
        mpMapping,
        mpSolution,
        mpIntegerProd,
        mpCapacityScope,
        mpSolutionMappingSignature,
      }),
    [dataset, mpMapping, mpSolution, mpIntegerProd, mpCapacityScope, mpSolutionMappingSignature]
  );

  const selectedOption =
    paramOptions.find((o) => o.value === parameter) ?? paramOptions[0];

  const handleRunAnalysis = async () => {
    if (running) return;
    if (!baselineCheck.ready || !dataset || !mpMapping) {
      setError(baselineCheck.reason ?? 'Baseline model is not ready for sensitivity analysis.');
      return;
    }

    const minMult = Number(minMultiplierInput);
    const maxMult = Number(maxMultiplierInput);
    const numPts = Number(numPointsInput);

    const validationError = validateSensitivityInputs({
      parameter,
      minMultiplier: minMult,
      maxMultiplier: maxMult,
      numPoints: numPts,
      mapping: mpMapping,
    });
    if (validationError) {
      setError(validationError);
      return;
    }

    const integerFlag = mpSolution?.integer_production ?? mpIntegerProd;
    const scopeFlag =
      (mpSolution?.capacity_scope as 'auto' | 'per_product' | 'aggregate_period' | undefined) ??
      mpCapacityScope;

    setRunning(true);
    setError(null);
    try {
      const req = buildSensitivityRequest({
        datasetId: dataset.dataset_id,
        mapping: mpMapping,
        integerProduction: integerFlag,
        capacityScope: scopeFlag,
        parameter,
        minMultiplier: minMult,
        maxMultiplier: maxMult,
        numPoints: numPts,
      });
      const response = await analyzeSensitivity(req);
      setSensitivityResult(response, {
        datasetId: dataset.dataset_id,
        mappingSignature: getMappingSignature(mpMapping),
        integerProd: integerFlag,
        capacityScope: scopeFlag,
        baselineObjective: mpSolution?.objective_value ?? null,
        baselineStatus: mpSolution?.status ?? 'Unknown',
      });
      // Select the baseline point if present in grid, otherwise the first point
      const baselineGridPt = response.points.find((p) => p.is_baseline);
      setSelectedMultiplier(
        baselineGridPt?.multiplier ?? response.points[0]?.multiplier ?? null
      );
    } catch (err) {
      setError(formatSensitivityApiError(err));
    } finally {
      setRunning(false);
    }
  };

  const curveChart = useMemo(
    () =>
      result
        ? buildSensitivityCurveChart(
            result,
            paramOptions.find((o) => o.value === result.parameter)?.label ?? result.parameter
          )
        : null,
    [result, paramOptions]
  );

  const stabilityChart = useMemo(
    () =>
      result
        ? buildPlanStabilityChart(
            result,
            paramOptions.find((o) => o.value === result.parameter)?.label ?? result.parameter
          )
        : null,
    [result, paramOptions]
  );

  const interpretation = useMemo(
    () => (result ? buildRobustnessInterpretation(result) : null),
    [result]
  );

  const selectedPoint: SensitivityPointResult | null = useMemo(() => {
    if (!result) return null;
    if (selectedMultiplier !== null) {
      const match = result.points.find(
        (p) => Math.abs(p.multiplier - selectedMultiplier) < 1e-6
      );
      if (match) return match;
    }
    return result.points[0] ?? null;
  }, [result, selectedMultiplier]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Sensitivity &amp; Robustness Analysis
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Run bounded One-at-a-Time (OAT) parameter sweeps around your verified Multi-Period
            baseline to evaluate feasibility boundaries, objective impact, and plan stability.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/multi-period')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Activity className="h-3.5 w-3.5 text-blue-600" />
          Back to Multi-Period Model
        </button>
      </div>

      {/* Section B: Baseline Information */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
            Active Baseline Reference
          </h2>
          {baselineCheck.ready ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Verified Baseline Ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              Baseline Required
            </span>
          )}
        </div>

        {!baselineCheck.ready ? (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <span>{baselineCheck.reason}</span>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {!dataset ? (
                <button
                  type="button"
                  onClick={() => navigate('/datasets')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Database className="h-3.5 w-3.5" />
                  Go to Dataset Explorer
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate('/multi-period')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Solve Baseline Model
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Dataset
              </div>
              <div className="mt-1 truncate text-xs font-semibold text-slate-900" title={dataset?.filename}>
                {dataset?.filename}
              </div>
              <div className="text-[11px] text-slate-500">
                {dataset?.active_sheet ? `Sheet: ${dataset.active_sheet}` : `${dataset?.row_count} rows`}
              </div>
            </div>

            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Solver Status
              </div>
              <div className="mt-1 text-sm font-bold text-emerald-700">{mpSolution?.status}</div>
              <div className="text-[11px] text-slate-500">{mpSolution?.solver_name}</div>
            </div>

            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Baseline Objective
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900">
                {formatNumberOrNull(mpSolution?.objective_value, 2)}
              </div>
              <div className="text-[11px] text-slate-500">{mpSolution?.objective_sense}</div>
            </div>

            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Total Production
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900">
                {formatNumberOrNull(mpSolution?.total_production, 2)}
              </div>
              <div className="text-[11px] text-slate-500">
                Demand: {formatNumberOrNull(mpSolution?.total_demand, 2)}
              </div>
            </div>

            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Formulation Mode
              </div>
              <div className="mt-1 text-xs font-semibold text-slate-900">
                {mpSolution?.integer_production || mpMapping?.setup_cost || mpMapping?.setup_time
                  ? 'MILP (Discrete)'
                  : 'Continuous LP'}
              </div>
              <div className="text-[11px] text-slate-500">Scope: {mpCapacityScope}</div>
            </div>

            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Production Plan
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900">
                {mpSolution?.production_schedule.length ?? 0} entries
              </div>
              <div className="text-[11px] text-slate-500">
                {mpSolution?.period_summary.length ?? 0} periods
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Section A & C: Sensitivity Analysis Setup & Run */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
          <SlidersHorizontal className="h-4 w-4 text-blue-600" />
          <h2 className="text-base font-semibold text-slate-900">
            Sweep Configuration (One-at-a-Time)
          </h2>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Parameter Selector */}
          <div className="lg:col-span-6">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Perturbed Parameter
            </label>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {paramOptions.map((opt) => {
                const isSelected = parameter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={!opt.available || running}
                    onClick={() => setParameter(opt.value)}
                    aria-pressed={isSelected}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      !opt.available
                        ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-60'
                        : isSelected
                          ? 'border-blue-500 bg-blue-50/70 ring-1 ring-blue-500'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{opt.label}</span>
                      {!opt.available && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          Unmapped
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {opt.available ? opt.description : opt.disabledReason}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bounds and Sweep Points */}
          <div className="space-y-4 lg:col-span-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="sens-min-mult"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                >
                  Min Multiplier
                </label>
                <input
                  id="sens-min-mult"
                  type="number"
                  step="0.05"
                  min={MIN_MULTIPLIER_BOUND}
                  max={MAX_MULTIPLIER_BOUND}
                  disabled={running}
                  value={minMultiplierInput}
                  onChange={(e) => setMinMultiplierInput(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
                />
                <span className="mt-1 block text-[11px] text-slate-500">e.g. 0.70 (−30%)</span>
              </div>

              <div>
                <label
                  htmlFor="sens-max-mult"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                >
                  Max Multiplier
                </label>
                <input
                  id="sens-max-mult"
                  type="number"
                  step="0.05"
                  min={MIN_MULTIPLIER_BOUND}
                  max={MAX_MULTIPLIER_BOUND}
                  disabled={running}
                  value={maxMultiplierInput}
                  onChange={(e) => setMaxMultiplierInput(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
                />
                <span className="mt-1 block text-[11px] text-slate-500">e.g. 1.40 (+40%)</span>
              </div>

              <div>
                <label
                  htmlFor="sens-num-points"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                >
                  Sweep Points
                </label>
                <input
                  id="sens-num-points"
                  type="number"
                  step="1"
                  min={MIN_SWEEP_POINTS}
                  max={MAX_SWEEP_POINTS}
                  disabled={running}
                  value={numPointsInput}
                  onChange={(e) => setNumPointsInput(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
                />
                <span className="mt-1 block text-[11px] text-slate-500">
                  {MIN_SWEEP_POINTS}–{MAX_SWEEP_POINTS} discrete runs
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Scale:</span> {selectedOption.unitHint}.
              All other mapped parameters remain fixed at 1.00x. Sweeps do not modify your baseline
              solution or saved scenarios.
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={running || !baselineCheck.ready}
                onClick={() => void handleRunAnalysis()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Running Sensitivity Sweep…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Run Sensitivity Analysis
                  </>
                )}
              </button>
              {running && (
                <span className="text-xs text-slate-500">
                  Solving discrete grid points with PuLP CBC…
                </span>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {/* Results Sections (only rendered when real backend response is present) */}
      {result && (
        <>
          {result.grid_config.budget_exhausted && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <span>
                The total sweep execution budget ({result.grid_config.total_budget_seconds}s) was
                reached before all grid points finished. Remaining points are marked as incomplete /
                budget exhausted and excluded from feasible metrics.
              </span>
            </div>
          )}

          {/* Section 5: Robustness Summary KPIs */}
          <section aria-label="Robustness Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Feasibility Rate (Tested Grid)
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">
                {result.summary.feasibility_rate_pct.toFixed(1)}%
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {result.summary.feasible_optimal_count} optimal feasible ·{' '}
                {result.summary.infeasible_count} infeasible
                {result.summary.incomplete_or_error_count > 0
                  ? ` · ${result.summary.incomplete_or_error_count} incomplete/error`
                  : ''}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Worst-Case Feasible Objective (Observed)
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">
                {formatNumberOrNull(result.summary.worst_case_feasible_objective, 2)}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Best observed ({result.summary.objective_sense}):{' '}
                {formatNumberOrNull(result.summary.best_feasible_objective, 2)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Max Observed Plan Shift
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">
                {formatNumberOrNull(result.summary.max_plan_shift_pct, 2, '%')}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Normalized L1 distance vs. 1.00x baseline
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Observed Objective Range
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">
                {formatNumberOrNull(result.summary.objective_range, 2)}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Across verified feasible grid points only
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                First Observed Infeasible Point
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">
                {result.summary.first_infeasible_multiplier !== null
                  ? `${result.summary.first_infeasible_multiplier.toFixed(2)}x`
                  : 'None observed'}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Discrete grid observation (not exact threshold)
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Sweep Runtime
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">
                {result.summary.total_runtime_seconds.toFixed(2)}s
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {result.grid_config.total_solver_runs} solver runs ·{' '}
                {result.is_milp ? 'MILP re-optimization' : 'LP re-optimization'}
              </div>
            </div>
          </section>

          {/* Section 6: Sensitivity Curve & Selected Point Details */}
          <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs xl:col-span-8">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {paramOptions.find((o) => o.value === result.parameter)?.label ?? result.parameter}{' '}
                  Sensitivity Curve ({result.summary.objective_sense})
                </h3>
                <span className="text-[11px] text-slate-500">
                  {result.summary.objective_sense.toLowerCase().startsWith('min')
                    ? 'Lower objective is better'
                    : 'Higher objective is better'}
                </span>
              </div>
              {curveChart && (
                <PlotlyChart
                  data={curveChart.data}
                  layout={curveChart.layout}
                  height={370}
                  onPointClick={(pt) => {
                    if (typeof pt.x === 'number' && Number.isFinite(pt.x)) {
                      setSelectedMultiplier(pt.x);
                    }
                  }}
                />
              )}
              <p className="mt-2 text-xs text-slate-500">
                Click any marker on the curve or any row in the results table to inspect its full
                solver details. Non-feasible points are shown on the bottom strip without
                interpolated or fabricated objective values.
              </p>
            </div>

            {/* Point Details Inspector */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs xl:col-span-4">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h3 className="text-sm font-semibold text-slate-900">Selected Point Details</h3>
                {selectedPoint && (
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      BADGE_CLASSES[classifyPointStatus(selectedPoint.status_category).tone]
                    }`}
                  >
                    {classifyPointStatus(selectedPoint.status_category).label}
                  </span>
                )}
              </div>

              {selectedPoint ? (
                <dl className="mt-4 space-y-2.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Multiplier</dt>
                    <dd className="font-semibold text-slate-900">
                      {selectedPoint.multiplier.toFixed(3)}x
                      {selectedPoint.is_baseline ? ' (Baseline)' : ''}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Parameter</dt>
                    <dd className="font-medium text-slate-900">
                      {paramOptions.find((o) => o.value === selectedPoint.parameter)?.label ??
                        selectedPoint.parameter}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Solver Status</dt>
                    <dd className="font-medium text-slate-900">{selectedPoint.solver_status}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Constraints Feasible</dt>
                    <dd className="font-medium text-slate-900">
                      {selectedPoint.is_feasible_optimal ? 'Yes (Verified)' : 'No'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Objective Value</dt>
                    <dd className="font-semibold text-slate-900">
                      {formatNumberOrNull(selectedPoint.objective_value, 4)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Objective Diff vs. Baseline</dt>
                    <dd className="font-medium text-slate-900">
                      {formatNumberOrNull(selectedPoint.objective_diff, 4)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Objective % Change</dt>
                    <dd className="font-medium text-slate-900">
                      {formatNumberOrNull(selectedPoint.objective_pct_change, 2, '%')}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Production Plan Shift</dt>
                    <dd className="font-medium text-slate-900">
                      {formatNumberOrNull(selectedPoint.plan_shift_pct, 2, '%')}
                    </dd>
                  </div>
                  {result.is_milp && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Setup Changes</dt>
                      <dd className="font-medium text-slate-900">
                        {selectedPoint.setup_changes !== null
                          ? selectedPoint.setup_changes
                          : 'N/A'}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Peak Utilization</dt>
                    <dd className="font-medium text-slate-900">
                      {formatNumberOrNull(selectedPoint.peak_utilization_pct, 2, '%')}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Max Constraint Violation</dt>
                    <dd className="font-medium text-slate-900">
                      {formatNumberOrNull(selectedPoint.max_constraint_violation, 8)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Solve Runtime</dt>
                    <dd className="font-medium text-slate-900">
                      {selectedPoint.runtime_seconds.toFixed(4)}s
                    </dd>
                  </div>
                  {selectedPoint.error_message && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-900">
                      <span className="font-semibold">Note:</span> {selectedPoint.error_message}
                    </div>
                  )}
                </dl>
              ) : (
                <p className="mt-4 text-xs text-slate-500">Select a sweep point to inspect.</p>
              )}
            </div>
          </section>

          {/* Section 7: Production Plan Stability */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="mb-2 text-sm font-semibold text-slate-900">
              Production Plan Stability vs. Baseline (Normalized L1 Shift)
            </h3>
            {stabilityChart && (
              <PlotlyChart data={stabilityChart.data} layout={stabilityChart.layout} height={320} />
            )}
            <p className="mt-2 text-xs text-slate-500">
              Normalized L1 Plan Shift ={' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-700">
                100 × Σ|x*(θ) − x₀| / max(Σ|x₀|, 1)
              </code>{' '}
              computed by the backend across all product-period production variables. Non-feasible
              grid points are omitted without interpolation.
            </p>
          </section>

          {/* Section 8: Sweep Results Table */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-900">Detailed Sweep Results</h2>
              <span className="text-xs text-slate-500">
                {result.points.length} tested grid points · click a row to inspect
              </span>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-3 py-2.5">Multiplier</th>
                    <th className="px-3 py-2.5">Solver Status</th>
                    <th className="px-3 py-2.5">Feasibility</th>
                    <th className="px-3 py-2.5 text-right">Objective</th>
                    <th className="px-3 py-2.5 text-right">Obj Change</th>
                    <th className="px-3 py-2.5 text-right">Plan Shift</th>
                    <th className="px-3 py-2.5 text-right">Peak Util</th>
                    <th className="px-3 py-2.5 text-right">Runtime</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.points.map((pt) => {
                    const badge = classifyPointStatus(pt.status_category);
                    const isRowSelected =
                      selectedPoint !== null &&
                      Math.abs(selectedPoint.multiplier - pt.multiplier) < 1e-6;
                    return (
                      <tr
                        key={pt.multiplier}
                        onClick={() => setSelectedMultiplier(pt.multiplier)}
                        className={`cursor-pointer transition-colors ${
                          isRowSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-900">
                          {pt.multiplier.toFixed(3)}x
                          {pt.is_baseline && (
                            <span className="ml-1.5 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              Baseline
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              BADGE_CLASSES[badge.tone]
                            }`}
                          >
                            {pt.is_feasible_optimal ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : pt.status_category === 'infeasible' ? (
                              <XCircle className="h-3 w-3" />
                            ) : (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            {badge.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">
                          {pt.is_feasible_optimal ? 'Verified Feasible' : 'Not Feasible / Unverified'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-slate-900">
                          {formatNumberOrNull(pt.objective_value, 4)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">
                          {pt.objective_pct_change !== null
                            ? `${pt.objective_pct_change >= 0 ? '+' : ''}${pt.objective_pct_change.toFixed(2)}%`
                            : 'N/A'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">
                          {formatNumberOrNull(pt.plan_shift_pct, 2, '%')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">
                          {formatNumberOrNull(pt.peak_utilization_pct, 2, '%')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600">
                          {pt.runtime_seconds.toFixed(3)}s
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 9: Feasibility & Robustness Interpretation */}
          {interpretation && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <Info className="h-4 w-4 text-blue-600" />
                <h2 className="text-base font-semibold text-slate-900">
                  Deterministic Robustness Interpretation
                </h2>
              </div>

              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                {interpretation.statements.map((stmt, idx) => (
                  <li key={idx}>{stmt}</li>
                ))}
                {interpretation.observedWorstCaseSummary && (
                  <li>{interpretation.observedWorstCaseSummary}</li>
                )}
              </ul>

              {result.summary.observed_transitions.length > 0 && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                    Observed Feasibility Transitions
                  </div>
                  <ul className="mt-1.5 space-y-1 text-xs text-slate-700">
                    {result.summary.observed_transitions.map((tr, i) => (
                      <li key={i}>{tr.description}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Thresholds &amp; Disclosure:</span>{' '}
                Plan stability is classified deterministically (stable &le;{' '}
                {PLAN_SHIFT_STABLE_THRESHOLD_PCT}%, moderate &le;{' '}
                {PLAN_SHIFT_MODERATE_THRESHOLD_PCT}%, substantial &gt;{' '}
                {PLAN_SHIFT_MODERATE_THRESHOLD_PCT}%). {interpretation.disclosure}{' '}
                {result.summary.empirical_disclosure}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

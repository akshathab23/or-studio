import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Database,
  GitCompareArrows,
  Info,
  Loader2,
  Play,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { exploreTradeoffs } from '../api/client';
import { PlotlyChart } from '../components/PlotlyChart';
import { useStudio } from '../context/StudioContext';
import type {
  TradeoffCandidateResult,
  TradeoffCriterion,
  TradeoffToleranceMode,
} from '../types/or';
import { classifyPointStatus, formatNumberOrNull, getMappingSignature } from '../utils/sensitivityAnalysis';
import { extractEligibleCandidates } from '../utils/decisionRecommendation';
import {
  DEFAULT_RELATIVE_TOLERANCE_PCT,
  DEFAULT_TRADEOFF_POINTS,
  MAX_ABSOLUTE_TOLERANCE,
  MAX_RELATIVE_TOLERANCE_PCT,
  MAX_TRADEOFF_POINTS,
  MIN_TRADEOFF_POINTS,
  buildCandidatePlanDiff,
  buildTradeoffChart,
  buildTradeoffInterpretation,
  buildTradeoffRequest,
  checkTradeoffBaselineConsistency,
  computeAllowedObjectiveBudget,
  formatTradeoffApiError,
  getTradeoffCriterionOptions,
  isNearZeroBaselineObjective,
  validateTradeoffInputs,
} from '../utils/tradeoffExplorer';

const BADGE_CLASSES: Record<'emerald' | 'rose' | 'amber' | 'slate', string> = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rose: 'border-rose-200 bg-rose-50 text-rose-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  slate: 'border-slate-200 bg-slate-100 text-slate-700',
};

export const TradeoffExplorerPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    dataset,
    mpMapping,
    mpCapacityScope,
    mpIntegerProd,
    mpSolution,
    mpSolutionMappingSignature,
    tradeoffResult: result,
    tradeoffMeta,
    setTradeoffResult,
  } = useStudio();

  const criterionOptions = useMemo(
    () => getTradeoffCriterionOptions(mpMapping, mpSolution),
    [mpMapping, mpSolution]
  );

  const [criterion, setCriterion] = useState<TradeoffCriterion>('peak_utilization');
  const [relativeTolInput, setRelativeTolInput] = useState<string>(
    String(DEFAULT_RELATIVE_TOLERANCE_PCT)
  );
  const [absoluteTolInput, setAbsoluteTolInput] = useState<string>('100');
  const [numPointsInput, setNumPointsInput] = useState<string>(String(DEFAULT_TRADEOFF_POINTS));

  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [lastRunConfigKey, setLastRunConfigKey] = useState<string | null>(null);

  // Fall back to cumulative_inventory if peak_utilization or production_smoothing becomes unavailable
  useEffect(() => {
    const activeOpt = criterionOptions.find((o) => o.value === criterion);
    if (activeOpt && !activeOpt.available) {
      const fallback = criterionOptions.find((o) => o.available);
      if (fallback) {
        setCriterion(fallback.value);
      }
    }
  }, [criterionOptions, criterion]);

  // Clear local selection when dataset or baseline changes
  useEffect(() => {
    setSelectedCandidateId(null);
    setLastRunConfigKey(null);
    setError(null);
  }, [dataset?.dataset_id, mpSolution]);

  const baselineCheck = useMemo(
    () =>
      checkTradeoffBaselineConsistency({
        dataset,
        mpMapping,
        mpSolution,
        mpIntegerProd,
        mpCapacityScope,
        mpSolutionMappingSignature,
      }),
    [dataset, mpMapping, mpSolution, mpIntegerProd, mpCapacityScope, mpSolutionMappingSignature]
  );

  const nearZeroBaseline = isNearZeroBaselineObjective(mpSolution?.objective_value);
  const toleranceMode: TradeoffToleranceMode = nearZeroBaseline ? 'absolute' : 'relative_pct';

  const currentConfigKey = `${criterion}|${toleranceMode}|${relativeTolInput}|${absoluteTolInput}|${numPointsInput}`;
  const isResultStaleConfig = Boolean(
    result && lastRunConfigKey !== null && lastRunConfigKey !== currentConfigKey
  );

  const baselineObj = mpSolution?.objective_value ?? null;
  const objectiveSense = mpSolution?.objective_sense ?? 'Minimize';
  const isMinimize = objectiveSense.toLowerCase().startsWith('min');

  const parsedTolVal =
    toleranceMode === 'relative_pct' ? Number(relativeTolInput) : Number(absoluteTolInput);
  const computedBudget =
    baselineObj !== null &&
    Number.isFinite(baselineObj) &&
    Number.isFinite(parsedTolVal) &&
    parsedTolVal > 0
      ? computeAllowedObjectiveBudget(baselineObj, objectiveSense, toleranceMode, parsedTolVal)
      : null;

  const handleReset = () => {
    setTradeoffResult(null);
    setSelectedCandidateId(null);
    setLastRunConfigKey(null);
    setError(null);
  };

  const handleGenerate = async () => {
    if (running) return;
    if (!baselineCheck.ready || !dataset || !mpMapping) {
      setError(baselineCheck.reason ?? 'Baseline model is not ready for trade-off exploration.');
      return;
    }

    const relTol = Number(relativeTolInput);
    const absTol = Number(absoluteTolInput);
    const numPts = Number(numPointsInput);

    const validationErr = validateTradeoffInputs({
      criterion,
      mapping: mpMapping,
      solution: mpSolution,
      toleranceMode,
      relativeTolerancePct: relTol,
      absoluteTolerance: absTol,
      numPoints: numPts,
    });
    if (validationErr) {
      setError(validationErr);
      return;
    }

    const integerFlag = mpSolution?.integer_production ?? mpIntegerProd;
    const scopeFlag =
      (mpSolution?.capacity_scope as 'auto' | 'per_product' | 'aggregate_period' | undefined) ??
      mpCapacityScope;

    setRunning(true);
    setError(null);
    try {
      const req = buildTradeoffRequest({
        datasetId: dataset.dataset_id,
        mapping: mpMapping,
        integerProduction: integerFlag,
        capacityScope: scopeFlag,
        criterion,
        toleranceMode,
        relativeTolerancePct: relTol,
        absoluteTolerance: absTol,
        numPoints: numPts,
      });
      const response = await exploreTradeoffs(req);
      setTradeoffResult(response, {
        datasetId: dataset.dataset_id,
        mappingSignature: getMappingSignature(mpMapping),
        integerProd: integerFlag,
        capacityScope: scopeFlag,
      });
      setLastRunConfigKey(currentConfigKey);
      const firstDistinctAlt = response.candidates.find(
        (c) => c.is_verified_feasible && !c.is_duplicate
      );
      setSelectedCandidateId(
        firstDistinctAlt?.candidate_id ??
          response.candidates[0]?.candidate_id ??
          response.baseline.candidate_id
      );
    } catch (err) {
      setError(formatTradeoffApiError(err));
    } finally {
      setRunning(false);
    }
  };

  const chartModel = useMemo(() => (result ? buildTradeoffChart(result) : null), [result]);

  const selectedCandidate: TradeoffCandidateResult | null = useMemo(() => {
    if (!result) return null;
    if (selectedCandidateId === result.baseline.candidate_id) return result.baseline;
    const found = result.candidates.find((c) => c.candidate_id === selectedCandidateId);
    return found ?? result.candidates[0] ?? result.baseline;
  }, [result, selectedCandidateId]);

  const planDiff = useMemo(
    () =>
      result && selectedCandidate
        ? buildCandidatePlanDiff(result.baseline, selectedCandidate)
        : null,
    [result, selectedCandidate]
  );

  const interpretation = useMemo(
    () => (result ? buildTradeoffInterpretation(result, selectedCandidate) : null),
    [result, selectedCandidate]
  );

  const recommendationEligibility = useMemo(
    () =>
      extractEligibleCandidates({
        dataset,
        mpMapping,
        mpSolution,
        mpIntegerProd,
        mpCapacityScope,
        mpSolutionMappingSignature,
        tradeoffResult: result,
        tradeoffMeta,
      }),
    [
      dataset,
      mpMapping,
      mpSolution,
      mpIntegerProd,
      mpCapacityScope,
      mpSolutionMappingSignature,
      result,
      tradeoffMeta,
    ]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Decision Trade-off Explorer
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Generate mathematically verified alternative feasible plans within a controlled objective
            tolerance to compare operational trade-offs without altering your baseline or scenario
            history.
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

      {/* Section 4: Baseline Validation */}
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
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Dataset
              </div>
              <div className="mt-1 truncate text-xs font-semibold text-slate-900" title={dataset?.filename}>
                {dataset?.filename}
              </div>
              <div className="text-[11px] text-slate-500">{dataset?.row_count} rows</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Baseline Status
              </div>
              <div className="mt-1 text-sm font-bold text-emerald-700">{mpSolution?.status}</div>
              <div className="text-[11px] text-slate-500">{mpSolution?.solver_name}</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Baseline Objective
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900">
                {formatNumberOrNull(mpSolution?.objective_value, 4)}
              </div>
              <div className="text-[11px] text-slate-500">{mpSolution?.objective_sense}</div>
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
                Horizon
              </div>
              <div className="mt-1 text-sm font-bold text-slate-900">
                {mpSolution?.period_summary.length ?? 0} periods
              </div>
              <div className="text-[11px] text-slate-500">
                {mpSolution?.production_schedule.length ?? 0} schedule entries
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Sections 5, 6, 7, 8: Criterion, Objective Tolerance, Points & Generate */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-blue-600" />
            <h2 className="text-base font-semibold text-slate-900">
              Trade-off Configuration (&epsilon;-Constraint)
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {result && result.summary.distinct_feasible_count >= 1 && (
              <button
                type="button"
                onClick={() => navigate('/recommendations')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                Rank &amp; Compare Plans
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {result && (
              <button
                type="button"
                onClick={handleReset}
                disabled={running}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Results
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Criterion Selector */}
          <div className="lg:col-span-6">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
              Secondary Trade-off Criterion
            </label>
            <div className="mt-2 space-y-2">
              {criterionOptions.map((opt) => {
                const isSelected = criterion === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={!opt.available || running}
                    onClick={() => setCriterion(opt.value)}
                    aria-pressed={isSelected}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
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
                          Unavailable
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

          {/* Objective Tolerance & Point Count */}
          <div className="space-y-4 lg:col-span-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {toleranceMode === 'relative_pct' ? (
                <div>
                  <label
                    htmlFor="tradeoff-rel-tol"
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                  >
                    Max Objective Tolerance (%)
                  </label>
                  <input
                    id="tradeoff-rel-tol"
                    type="number"
                    step="0.5"
                    min={0.5}
                    max={MAX_RELATIVE_TOLERANCE_PCT}
                    disabled={running}
                    value={relativeTolInput}
                    onChange={(e) => setRelativeTolInput(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">
                    Permits up to {relativeTolInput || '0'}% deterioration (max {MAX_RELATIVE_TOLERANCE_PCT}%)
                  </span>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="tradeoff-abs-tol"
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                  >
                    Absolute Tolerance (Objective Units)
                  </label>
                  <input
                    id="tradeoff-abs-tol"
                    type="number"
                    step="1"
                    min={0.01}
                    max={MAX_ABSOLUTE_TOLERANCE}
                    disabled={running}
                    value={absoluteTolInput}
                    onChange={(e) => setAbsoluteTolInput(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">
                    Baseline objective is zero/near-zero; enter explicit tolerance in objective units.
                  </span>
                </div>
              )}

              <div>
                <label
                  htmlFor="tradeoff-num-points"
                  className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                >
                  Trade-off Points
                </label>
                <input
                  id="tradeoff-num-points"
                  type="number"
                  step="1"
                  min={MIN_TRADEOFF_POINTS}
                  max={MAX_TRADEOFF_POINTS}
                  disabled={running}
                  value={numPointsInput}
                  onChange={(e) => setNumPointsInput(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none disabled:bg-slate-100"
                />
                <span className="mt-1 block text-[11px] text-slate-500">
                  {MIN_TRADEOFF_POINTS}–{MAX_TRADEOFF_POINTS} alternative optimization attempts
                </span>
              </div>
            </div>

            {/* Objective Budget Direction Box */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
              <div className="font-semibold text-slate-800">
                Objective Budget Direction ({objectiveSense}):
              </div>
              <div className="mt-1">
                {isMinimize
                  ? 'Original objective ≤ baseline + allowed tolerance'
                  : 'Original objective ≥ baseline − allowed tolerance'}
              </div>
              {baselineObj !== null && computedBudget !== null && (
                <div className="mt-1 text-slate-600">
                  Baseline: <span className="font-semibold">{formatNumberOrNull(baselineObj, 4)}</span>{' '}
                  &rarr; Allowed budget:{' '}
                  <span className="font-semibold">{formatNumberOrNull(computedBudget, 4)}</span>
                </div>
              )}
              <p className="mt-2 border-t border-slate-200 pt-2 text-[11px] leading-relaxed text-slate-600">
                <strong>What Objective Tolerance means:</strong> It sets how far a trade-off
                alternative may move from your baseline optimal objective while improving a
                secondary criterion. Tightening tolerance keeps plans closer to baseline cost/profit
                (fewer alternatives may qualify); widening tolerance allows larger trade-offs.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={running || !baselineCheck.ready}
                onClick={() => void handleGenerate()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating Alternatives…
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Generate Trade-off Alternatives
                  </>
                )}
              </button>
              {running && (
                <span className="text-xs text-slate-500">
                  Solving {numPointsInput} bounded &epsilon;-constraint models…
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

        {isResultStaleConfig && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <span>
              Settings changed since the last generation. The displayed results below reflect{' '}
              <strong>{result?.summary.criterion_label}</strong> from your previous run. Click{' '}
              <strong>Generate Trade-off Alternatives</strong> to solve with the updated settings.
            </span>
          </div>
        )}
      </section>

      {/* Results Workspace */}
      {result && (
        <>
          {result.summary.budget_exhausted && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <span>
                Total execution budget ({result.summary.total_budget_seconds}s) was reached before
                all attempts completed. Incomplete candidates are marked accordingly and excluded
                from verified metrics.
              </span>
            </div>
          )}

          {recommendationEligibility.ready && (
            <section
              aria-label="Recommendation Transition"
              className="flex flex-col gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 px-5 py-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="text-sm font-semibold text-indigo-950">
                  Ready to Rank &amp; Compare Alternatives
                </div>
                <p className="mt-0.5 text-xs text-indigo-900">
                  {recommendationEligibility.eligible.length} verified feasible plans (baseline +{' '}
                  {recommendationEligibility.eligible.length - 1} distinct alternative
                  {recommendationEligibility.eligible.length - 1 === 1 ? '' : 's'}) are eligible for
                  multi-criteria preference ranking and pairwise comparison.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/recommendations')}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700"
              >
                Rank &amp; Compare Alternatives
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </section>
          )}

          {/* Execution Summary KPIs */}
          <section aria-label="Trade-off Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Verified Candidates
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">
                {result.summary.verified_feasible_count} / {result.summary.total_requested_points}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {result.summary.distinct_feasible_count} distinct · {result.summary.duplicate_count}{' '}
                duplicate
                {result.summary.incomplete_or_error_count > 0
                  ? ` · ${result.summary.incomplete_or_error_count} failed/incomplete`
                  : ''}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Baseline {result.summary.criterion_label}
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">
                {formatNumberOrNull(
                  result.summary.baseline_criterion_value,
                  2,
                  result.summary.criterion_unit ? ` ${result.summary.criterion_unit}` : ''
                )}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                At baseline objective {formatNumberOrNull(result.summary.baseline_objective, 2)}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Best Verified {result.summary.criterion_label}
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">
                {formatNumberOrNull(
                  result.summary.best_criterion_value,
                  2,
                  result.summary.criterion_unit ? ` ${result.summary.criterion_unit}` : ''
                )}
              </div>
              <div className="mt-1 text-xs text-slate-600">
                Improvement:{' '}
                {formatNumberOrNull(
                  result.summary.criterion_improvement,
                  2,
                  result.summary.criterion_unit ? ` ${result.summary.criterion_unit}` : ''
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Execution Duration
              </div>
              <div className="mt-1.5 text-2xl font-bold text-slate-900">
                {result.summary.total_runtime_seconds.toFixed(2)}s
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {result.is_milp ? 'MILP discrete solves' : 'LP solves'} ·{' '}
                {result.summary.per_solve_time_limit_seconds}s per-solve limit
              </div>
            </div>
          </section>

          {/* Section 9: Trade-off Chart & Section 12: Interpretation */}
          <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs xl:col-span-8">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {result.summary.criterion_label} vs. Original Objective Deterioration
                </h3>
                <span className="text-[11px] text-slate-500">
                  Click any marker to inspect candidate plan
                </span>
              </div>
              {chartModel && (
                <PlotlyChart
                  data={chartModel.data}
                  layout={chartModel.layout}
                  height={350}
                  onPointClick={(pt) => {
                    if (
                      typeof pt.curveNumber === 'number' &&
                      typeof pt.pointIndex === 'number'
                    ) {
                      const cid =
                        chartModel.curveCandidateIds[pt.curveNumber]?.[pt.pointIndex];
                      if (cid) setSelectedCandidateId(cid);
                    }
                  }}
                />
              )}
              <p className="mt-2 text-xs text-slate-500">
                Only verified optimal solutions satisfying all original constraints and the
                objective budget are plotted. Duplicate plans are shown distinctly; failed runs are
                never interpolated or plotted as zero.
              </p>
            </div>

            {/* Section 12: Decision Support Interpretation */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs xl:col-span-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <Info className="h-4 w-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Decision Support Interpretation
                </h3>
              </div>

              {interpretation && (
                <div className="mt-4 space-y-3 text-xs text-slate-700">
                  <p className="rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-slate-800">
                    {interpretation.candidateStatement}
                  </p>
                  {interpretation.executionNotes.length > 0 && (
                    <ul className="list-disc space-y-1 pl-4 text-slate-600">
                      {interpretation.executionNotes.map((note, idx) => (
                        <li key={idx}>{note}</li>
                      ))}
                    </ul>
                  )}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-700">Disclosure:</span>{' '}
                    {interpretation.disclosure}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Section 10: Candidate Results Table */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-900">Trade-off Candidates</h2>
              <span className="text-xs text-slate-500">
                Select any row to compare against the baseline
              </span>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-3 py-2.5">Candidate</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Duplicate</th>
                    <th className="px-3 py-2.5 text-right">Original Obj</th>
                    <th className="px-3 py-2.5 text-right">Deterioration</th>
                    <th className="px-3 py-2.5 text-right">{result.summary.criterion_label}</th>
                    <th className="px-3 py-2.5 text-right">Plan Shift</th>
                    <th className="px-3 py-2.5 text-right">Runtime</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[result.baseline, ...result.candidates].map((cand) => {
                    const badge = classifyPointStatus(cand.status_category);
                    const isSelected = selectedCandidate?.candidate_id === cand.candidate_id;
                    const detDisplay =
                      !cand.is_verified_feasible
                        ? 'N/A'
                        : result.summary.tolerance_mode === 'relative_pct' &&
                            cand.objective_pct_change !== null
                          ? `${cand.objective_pct_change >= 0 ? '+' : ''}${cand.objective_pct_change.toFixed(2)}%`
                          : formatNumberOrNull(cand.objective_diff, 4);

                    return (
                      <tr
                        key={cand.candidate_id}
                        onClick={() => setSelectedCandidateId(cand.candidate_id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-900">
                          {cand.candidate_id}
                          {cand.is_baseline && (
                            <span className="ml-1.5 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              Baseline
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              BADGE_CLASSES[cand.is_verified_feasible ? 'emerald' : badge.tone]
                            }`}
                          >
                            {cand.is_verified_feasible ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : cand.status_category === 'infeasible' ? (
                              <XCircle className="h-3 w-3" />
                            ) : (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            {cand.is_verified_feasible ? 'Verified' : badge.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                          {cand.is_duplicate ? (
                            <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              <Copy className="h-3 w-3" />
                              Same as {cand.duplicate_of_candidate_id}
                            </span>
                          ) : cand.is_verified_feasible ? (
                            'Distinct'
                          ) : (
                            'N/A'
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-slate-900">
                          {formatNumberOrNull(cand.objective_value, 4)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">
                          {detDisplay}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-slate-900">
                          {formatNumberOrNull(
                            cand.criterion_value,
                            2,
                            result.summary.criterion_unit ? ` ${result.summary.criterion_unit}` : ''
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">
                          {formatNumberOrNull(cand.plan_shift_pct, 2, '%')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-600">
                          {cand.runtime_seconds.toFixed(3)}s
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 11: Alternative Plan Inspector */}
          {selectedCandidate && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Alternative Plan Inspector: {selectedCandidate.candidate_id}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Side-by-side operational comparison against baseline (budget:{' '}
                    {formatNumberOrNull(selectedCandidate.objective_budget, 4)})
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                    BADGE_CLASSES[
                      selectedCandidate.is_verified_feasible
                        ? 'emerald'
                        : classifyPointStatus(selectedCandidate.status_category).tone
                    ]
                  }`}
                >
                  {selectedCandidate.is_verified_feasible
                    ? 'Verified Feasible'
                    : selectedCandidate.solver_status}
                </span>
              </div>

              {!selectedCandidate.is_verified_feasible ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                  <div className="font-semibold">Detailed plan unavailable</div>
                  <p className="mt-1">
                    {selectedCandidate.error_message ??
                      `Candidate '${selectedCandidate.candidate_id}' terminated with status '${selectedCandidate.solver_status}' and did not produce a verified feasible plan.`}
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-semibold uppercase text-slate-500">
                        Original Objective
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-900">
                        {formatNumberOrNull(selectedCandidate.objective_value, 4)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Baseline: {formatNumberOrNull(result.baseline.objective_value, 4)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-semibold uppercase text-slate-500">
                        {result.summary.criterion_label}
                      </div>
                      <div className="mt-1 text-sm font-bold text-blue-700">
                        {formatNumberOrNull(
                          selectedCandidate.criterion_value,
                          2,
                          result.summary.criterion_unit ? ` ${result.summary.criterion_unit}` : ''
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Diff: {formatNumberOrNull(selectedCandidate.criterion_diff, 4)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-semibold uppercase text-slate-500">
                        Peak Utilization
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-900">
                        {formatNumberOrNull(selectedCandidate.peak_utilization_pct, 2, '%')}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Baseline: {formatNumberOrNull(result.baseline.peak_utilization_pct, 2, '%')}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-semibold uppercase text-slate-500">
                        Ending Inventory
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-900">
                        {formatNumberOrNull(selectedCandidate.total_ending_inventory, 2)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Baseline: {formatNumberOrNull(result.baseline.total_ending_inventory, 2)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-semibold uppercase text-slate-500">
                        Plan Shift (L1)
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-900">
                        {formatNumberOrNull(selectedCandidate.plan_shift_pct, 2, '%')}
                      </div>
                      <div className="text-[11px] text-slate-500">vs. baseline schedule</div>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="text-[11px] font-semibold uppercase text-slate-500">
                        Max Violation
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-900">
                        {formatNumberOrNull(selectedCandidate.max_constraint_violation, 8)}
                      </div>
                      <div className="text-[11px] text-slate-500">Original constraints</div>
                    </div>
                  </div>

                  {/* Production & Inventory Schedule Diff */}
                  {planDiff?.scheduleAvailable ? (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Production &amp; Inventory Schedule Comparison
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                            <tr>
                              <th className="px-3 py-2">Product</th>
                              <th className="px-3 py-2">Period</th>
                              <th className="px-3 py-2 text-right">Base Prod</th>
                              <th className="px-3 py-2 text-right">Alt Prod</th>
                              <th className="px-3 py-2 text-right">Prod &Delta;</th>
                              <th className="px-3 py-2 text-right">Base Inv</th>
                              <th className="px-3 py-2 text-right">Alt Inv</th>
                              <th className="px-3 py-2 text-right">Inv &Delta;</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {planDiff.scheduleRows.map((row) => (
                              <tr key={`${row.product}-${row.period}`}>
                                <td className="px-3 py-2 font-medium text-slate-900">{row.product}</td>
                                <td className="px-3 py-2 text-slate-700">{row.period}</td>
                                <td className="px-3 py-2 text-right text-slate-600">
                                  {row.baselineProduction.toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-right font-medium text-slate-900">
                                  {row.candidateProduction.toLocaleString()}
                                </td>
                                <td
                                  className={`px-3 py-2 text-right font-medium ${
                                    Math.abs(row.productionDelta) > 1e-4
                                      ? 'text-blue-700'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {row.productionDelta > 0 ? `+${row.productionDelta}` : row.productionDelta}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-600">
                                  {row.baselineInventory.toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-right font-medium text-slate-900">
                                  {row.candidateInventory.toLocaleString()}
                                </td>
                                <td
                                  className={`px-3 py-2 text-right font-medium ${
                                    Math.abs(row.inventoryDelta) > 1e-4
                                      ? 'text-blue-700'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {row.inventoryDelta > 0 ? `+${row.inventoryDelta}` : row.inventoryDelta}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Detailed production schedule rows are unavailable for this candidate.
                    </p>
                  )}

                  {/* Resource Utilization Diff */}
                  {planDiff?.utilizationAvailable && (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Capacity Utilization Comparison
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                            <tr>
                              <th className="px-3 py-2">Resource</th>
                              <th className="px-3 py-2">Period</th>
                              <th className="px-3 py-2 text-right">Capacity</th>
                              <th className="px-3 py-2 text-right">Base Util</th>
                              <th className="px-3 py-2 text-right">Alt Util</th>
                              <th className="px-3 py-2 text-right">Util &Delta;</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {planDiff.utilizationRows.map((u) => (
                              <tr key={`${u.resource}-${u.period}`}>
                                <td className="px-3 py-2 font-medium text-slate-900">{u.resource}</td>
                                <td className="px-3 py-2 text-slate-700">{u.period}</td>
                                <td className="px-3 py-2 text-right text-slate-600">
                                  {u.capacity.toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-600">
                                  {u.baselineUtilPct.toFixed(2)}%
                                </td>
                                <td className="px-3 py-2 text-right font-medium text-slate-900">
                                  {u.candidateUtilPct.toFixed(2)}%
                                </td>
                                <td
                                  className={`px-3 py-2 text-right font-medium ${
                                    u.utilDeltaPct < -0.01
                                      ? 'text-emerald-700'
                                      : u.utilDeltaPct > 0.01
                                        ? 'text-amber-700'
                                        : 'text-slate-400'
                                  }`}
                                >
                                  {u.utilDeltaPct > 0 ? `+${u.utilDeltaPct}%` : `${u.utilDeltaPct}%`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookmarkPlus,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FlaskConical,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { solveMultiPeriod } from '../api/client';
import { PlotlyChart } from '../components/PlotlyChart';
import { SaveScenarioModal } from '../components/SaveScenarioModal';
import { useStudio } from '../context/StudioContext';
import type { MultiPeriodSolveResponse } from '../types/or';
import {
  checkWhatIfBaselineConsistency,
  validateWhatIfMultipliers,
} from '../utils/whatIfAnalysis';

type BadgeTone = 'blue' | 'amber' | 'rose';

const BADGE_STYLES: Record<BadgeTone, { above: string; below: string }> = {
  blue: {
    above: 'border-blue-200 text-blue-700 bg-blue-50',
    below: 'border-amber-200 text-amber-700 bg-amber-50',
  },
  amber: {
    above: 'border-amber-200 text-amber-700 bg-amber-50',
    below: 'border-amber-200 text-amber-700 bg-amber-50',
  },
  rose: {
    above: 'border-rose-200 text-rose-700 bg-rose-50',
    below: 'border-emerald-200 text-emerald-700 bg-emerald-50',
  },
};

// ── Scenario presets ────────────────────────────────────────────────────────
type ScenarioPreset = {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  demandMultiplier: number;
  capacityMultiplier: number;
  costMultiplier: number;
};

const PRESETS: ScenarioPreset[] = [
  {
    id: 'baseline',
    label: 'Baseline',
    description: 'Original model with no modifications.',
    icon: CheckCircle2,
    demandMultiplier: 1.0,
    capacityMultiplier: 1.0,
    costMultiplier: 1.0,
  },
  {
    id: 'demand_surge',
    label: 'Demand Surge +30%',
    description: 'Demand increases across all products and periods.',
    icon: TrendingUp,
    demandMultiplier: 1.3,
    capacityMultiplier: 1.0,
    costMultiplier: 1.0,
  },
  {
    id: 'capacity_crunch',
    label: 'Capacity Crunch −25%',
    description: 'Available capacity is reduced, stressing the schedule.',
    icon: TrendingDown,
    demandMultiplier: 1.0,
    capacityMultiplier: 0.75,
    costMultiplier: 1.0,
  },
  {
    id: 'cost_pressure',
    label: 'Higher Production Cost +20%',
    description: 'Production cost rises, affecting the objective value.',
    icon: Zap,
    demandMultiplier: 1.0,
    capacityMultiplier: 1.0,
    costMultiplier: 1.2,
  },
];

// ── Metric diff card ─────────────────────────────────────────────────────────
function DiffCard({
  label,
  baseline,
  scenario,
  unit = '',
  lowerIsBetter = false,
  informationalOnly = false,
}: {
  label: string;
  baseline: number | null | undefined;
  scenario: number | null | undefined;
  unit?: string;
  lowerIsBetter?: boolean;
  informationalOnly?: boolean;
}) {
  const bValid = baseline !== null && baseline !== undefined && Number.isFinite(baseline);
  const sValid = scenario !== null && scenario !== undefined && Number.isFinite(scenario);

  if (!bValid || !sValid) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </div>
        <div className="mt-3 text-xs text-slate-500">Unavailable for this run</div>
      </div>
    );
  }

  const diff = scenario - baseline;
  const unchanged = Math.abs(diff) < 1e-6;
  const zeroBaselineNonzeroScenario = Math.abs(baseline) < 1e-9 && !unchanged;
  const pct =
    Math.abs(baseline) >= 1e-9 && Number.isFinite(diff / Math.abs(baseline))
      ? (diff / Math.abs(baseline)) * 100
      : null;
  const improved = lowerIsBetter ? diff < 0 : diff > 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <div className="text-xs text-slate-400">Baseline</div>
          <div className="font-mono text-sm font-semibold text-slate-700">
            {baseline.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            {unit}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
        <div>
          <div className="text-xs text-slate-400">Scenario</div>
          <div className="font-mono text-sm font-semibold text-slate-900">
            {scenario.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            {unit}
          </div>
        </div>
      </div>

      {informationalOnly ? (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {unchanged
            ? 'Unchanged'
            : `${diff > 0 ? '+' : ''}${diff.toFixed(4)}${unit} (informational)`}
        </div>
      ) : unchanged ? (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500">
          Unchanged
        </div>
      ) : zeroBaselineNonzeroScenario || pct === null ? (
        <div
          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
            improved ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {diff > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {diff > 0 ? '+' : ''}
          {diff.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          {unit} (N/A %)
        </div>
      ) : (
        <div
          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
            improved ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {diff > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {diff > 0 ? '+' : ''}
          {pct.toFixed(1)}%
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export const WhatIfLabPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    dataset,
    mpMapping,
    mpSolution,
    mpCapacityScope,
    mpIntegerProd,
    mpSolutionMappingSignature,
  } = useStudio();

  const [selectedPreset, setSelectedPreset] = useState<string>('baseline');
  const [demandMult, setDemandMult] = useState(1.0);
  const [capacityMult, setCapacityMult] = useState(1.0);
  const [costMult, setCostMult] = useState(1.0);
  const [scenarioResult, setScenarioResult] = useState<MultiPeriodSolveResponse | null>(null);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const baselineCheck = useMemo(
    () =>
      checkWhatIfBaselineConsistency({
        dataset,
        mpMapping,
        mpSolution,
        mpIntegerProd,
        mpCapacityScope,
        mpSolutionMappingSignature,
      }),
    [
      dataset,
      mpMapping,
      mpSolution,
      mpIntegerProd,
      mpCapacityScope,
      mpSolutionMappingSignature,
    ]
  );

  useEffect(() => {
    setScenarioResult(null);
    setShowComparison(false);
    setError(null);
  }, [dataset?.dataset_id, mpSolution, mpSolutionMappingSignature]);

  const applyPreset = (preset: ScenarioPreset) => {
    if (getPresetDisabledReason(preset) !== null) return;
    setSelectedPreset(preset.id);
    setDemandMult(preset.demandMultiplier);
    setCapacityMult(hasCapacityMapped ? preset.capacityMultiplier : 1.0);
    setCostMult(hasProdCostMapped ? preset.costMultiplier : 1.0);
    setScenarioResult(null);
    setShowComparison(false);
    setError(null);
  };

  const handleRunScenario = async () => {
    if (!baselineCheck.ready || !dataset || !mpMapping) {
      setError(
        baselineCheck.reason ?? 'Baseline model is not ready for What-If analysis.'
      );
      return;
    }

    const validationErr = validateWhatIfMultipliers({
      demandMultiplier: demandMult,
      capacityMultiplier: capacityMult,
      costMultiplier: costMult,
    });
    if (validationErr) {
      setError(validationErr);
      return;
    }

    setSolving(true);
    setError(null);
    setScenarioResult(null);
    setShowComparison(false);
    try {
      const integerFlag = mpSolution?.integer_production ?? mpIntegerProd;
      const scopeFlag =
        (mpSolution?.capacity_scope as 'auto' | 'per_product' | 'aggregate_period' | undefined) ??
        mpCapacityScope;

      const result = await solveMultiPeriod(
        dataset.dataset_id,
        mpMapping,
        integerFlag,
        scopeFlag,
        {
          demand_multiplier: demandMult,
          capacity_multiplier: capacityMult,
          production_cost_multiplier: costMult,
        }
      );
      setScenarioResult(result);
      setShowComparison(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scenario run failed.');
    } finally {
      setSolving(false);
    }
  };

  const hasBaseline = baselineCheck.ready;
  const hasScenario = Boolean(scenarioResult?.is_optimal);
  const hasCapacityMapped = Boolean(mpMapping?.capacity);
  const hasProdCostMapped = Boolean(mpMapping?.production_cost);

  const getPresetDisabledReason = (preset: ScenarioPreset): string | null => {
    if (preset.capacityMultiplier !== 1.0 && !hasCapacityMapped) {
      return 'Capacity is not mapped in the baseline model.';
    }
    if (preset.costMultiplier !== 1.0 && !hasProdCostMapped) {
      return 'Production Cost is not mapped in the baseline model.';
    }
    return null;
  };

  const isMinimize = (mpSolution?.objective_sense ?? 'Minimize')
    .toLowerCase()
    .startsWith('min');

  const baselineObj = mpSolution?.objective_value ?? null;
  const scenarioObj = scenarioResult?.objective_value ?? null;
  const baselineProd = mpSolution?.total_production ?? null;
  const scenarioProd = scenarioResult?.total_production ?? null;
  const baselineDemand = mpSolution?.total_demand ?? null;
  const scenarioDemand = scenarioResult?.total_demand ?? null;

  const baselinePeriods = mpSolution?.period_summary.map((p) => String(p.period)) ?? [];
  const scenarioPeriods = scenarioResult?.period_summary.map((p) => String(p.period)) ?? [];

  const incompatibilityReasons: string[] = [];
  if (mpSolution && scenarioResult) {
    if (mpSolution.objective_sense !== scenarioResult.objective_sense) {
      incompatibilityReasons.push('Objective sense differs');
    }
    if (
      mpSolution.integer_production !== undefined &&
      scenarioResult.integer_production !== undefined &&
      mpSolution.integer_production !== scenarioResult.integer_production
    ) {
      incompatibilityReasons.push('Integer production setting differs');
    }
    if (
      mpSolution.allow_backlogging !== undefined &&
      scenarioResult.allow_backlogging !== undefined &&
      mpSolution.allow_backlogging !== scenarioResult.allow_backlogging
    ) {
      incompatibilityReasons.push('Backlogging setting differs');
    }
    if (
      mpSolution.capacity_scope !== undefined &&
      scenarioResult.capacity_scope !== undefined &&
      mpSolution.capacity_scope !== scenarioResult.capacity_scope
    ) {
      incompatibilityReasons.push('Capacity scope differs');
    }
  }
  const modelsCompatible = incompatibilityReasons.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <FlaskConical className="h-5 w-5 text-blue-600" />
          <h1 className="text-xl font-bold text-slate-900">What-If Decision Lab</h1>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Experiment with demand, capacity, and production cost multipliers and solve the modified
          optimization model without altering your baseline solution.
        </p>
      </div>

      {/* Prerequisite & Baseline Freshness guard */}
      {!hasBaseline && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-xs">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">
                {!mpSolution
                  ? 'No baseline solution available'
                  : 'Baseline model is outdated or inconsistent'}
              </p>
              <p className="mt-1 text-xs text-amber-800">
                {baselineCheck.reason}
              </p>
              <p className="mt-1.5 text-xs text-amber-700">
                {!mpSolution
                  ? 'Run a Multi-Period Optimization first to establish a baseline. The What-If Lab compares modified scenarios against that baseline result.'
                  : 'The What-If Decision Lab requires a verified, fresh baseline corresponding to your current column mapping and solver configuration. Revalidate and solve your model in Multi-Period Optimization before running scenario experiments.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {!dataset ? (
                  <button
                    type="button"
                    onClick={() => navigate('/datasets')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                  >
                    <Database className="h-3.5 w-3.5" />
                    Upload Dataset
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => navigate('/multi-period')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                    {!mpSolution
                      ? 'Run Optimization'
                      : 'Return to Multi-Period Optimization'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {hasBaseline && (
        <>
          {/* Baseline summary strip */}
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 shadow-xs">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="text-xs font-semibold text-emerald-800">Verified baseline loaded</span>
            <span className="text-xs text-emerald-700">
              Objective ({mpSolution?.objective_sense}):{' '}
              {(baselineObj ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs text-emerald-700">
              Production: {(baselineProd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs text-emerald-700">
              Demand: {(baselineDemand ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs text-emerald-700">
              Mode: {(mpSolution?.integer_production ?? mpIntegerProd) ? 'MILP (Integer)' : 'LP (Continuous)'}
            </span>
          </div>

          {/* Scenario controls */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Preset selector */}
            <section className="lg:col-span-1 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Scenario Presets</h2>
              <div className="space-y-2">
                {PRESETS.map((preset) => {
                  const Icon = preset.icon;
                  const disabledReason = getPresetDisabledReason(preset);
                  const disabled = disabledReason !== null;
                  const active = !disabled && selectedPreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={disabled}
                      title={disabledReason ?? undefined}
                      onClick={() => applyPreset(preset)}
                      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all ${
                        disabled
                          ? 'cursor-not-allowed border-slate-200 bg-slate-50/70 opacity-65'
                          : active
                          ? 'border-blue-300 bg-blue-50 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          disabled
                            ? 'text-slate-400'
                            : active
                            ? 'text-blue-600'
                            : 'text-slate-400'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-xs font-semibold ${
                              disabled
                                ? 'text-slate-600'
                                : active
                                ? 'text-blue-800'
                                : 'text-slate-800'
                            }`}
                          >
                            {preset.label}
                          </span>
                          {disabled && (
                            <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500">
                              Not mapped
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500">{preset.description}</div>
                        {disabledReason && (
                          <div className="mt-1 text-[11px] text-amber-700">{disabledReason}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Slider controls */}
            <section className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Scenario Parameters</h2>
                <button
                  type="button"
                  onClick={() => {
                    setDemandMult(1.0);
                    setCapacityMult(1.0);
                    setCostMult(1.0);
                    setSelectedPreset('baseline');
                    setScenarioResult(null);
                    setShowComparison(false);
                    setError(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <RefreshCw className="h-3 w-3" />
                  Reset
                </button>
              </div>

              <div className="space-y-5">
                {(
                  [
                    {
                      label: 'Demand Multiplier',
                      value: demandMult,
                      setter: setDemandMult,
                      min: 0.5,
                      max: 2.0,
                      step: 0.05,
                      tone: 'blue',
                      disabled: false,
                      disabledReason: null as string | null,
                    },
                    {
                      label: 'Capacity Multiplier',
                      value: capacityMult,
                      setter: setCapacityMult,
                      min: 0.25,
                      max: 1.5,
                      step: 0.05,
                      tone: 'amber',
                      disabled: !hasCapacityMapped,
                      disabledReason: 'Capacity is not mapped in the baseline model.',
                    },
                    {
                      label: 'Production Cost Multiplier',
                      value: costMult,
                      setter: setCostMult,
                      min: 0.5,
                      max: 2.0,
                      step: 0.05,
                      tone: 'rose',
                      disabled: !hasProdCostMapped,
                      disabledReason: 'Production Cost is not mapped in the baseline model.',
                    },
                  ] as const
                ).map(({ label, value, setter, min, max, step, tone, disabled, disabledReason }) => (
                  <div key={label} className={disabled ? 'opacity-65' : ''}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700">{label}</label>
                      <span
                        className={`rounded-md border px-2 py-0.5 font-mono text-xs font-bold ${
                          disabled
                            ? 'border-slate-200 bg-slate-100 text-slate-500'
                            : Math.abs(value - 1.0) < 1e-6
                            ? 'border-slate-200 text-slate-500'
                            : value > 1.0
                            ? BADGE_STYLES[tone].above
                            : BADGE_STYLES[tone].below
                        }`}
                      >
                        {disabled ? 'Not mapped' : `×${value.toFixed(2)}`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      disabled={disabled}
                      value={disabled ? 1.0 : value}
                      onChange={(e) => {
                        setter(Number(e.target.value));
                        setSelectedPreset('custom');
                        setScenarioResult(null);
                        setShowComparison(false);
                      }}
                      className="w-full accent-blue-600 disabled:cursor-not-allowed"
                    />
                    {disabled && disabledReason ? (
                      <div className="mt-1 text-[11px] text-amber-700">{disabledReason}</div>
                    ) : (
                      <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
                        <span>×{min}</span>
                        <span>×1.00 (baseline)</span>
                        <span>×{max}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={solving}
                  onClick={() => void handleRunScenario()}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
                >
                  {solving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FlaskConical className="h-4 w-4" />
                  )}
                  {solving ? 'Solving Scenario…' : 'Run Scenario'}
                </button>
                <button
                  type="button"
                  disabled={!mpMapping}
                  onClick={() => setSaveModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <BookmarkPlus className="h-4 w-4 text-blue-600" />
                  Save Scenario
                </button>
                {scenarioResult && (
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                      hasScenario ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {hasScenario ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5" />
                    )}
                    Scenario status: {scenarioResult.status}
                  </span>
                )}
              </div>

              {savedNotice && (
                <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
                  <span>{savedNotice}</span>
                  <button
                    type="button"
                    onClick={() => navigate('/scenarios')}
                    className="font-semibold underline hover:text-emerald-950"
                  >
                    View in Scenario Library
                  </button>
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <span>{error}</span>
                </div>
              )}
            </section>
          </div>

          {/* Comparison section (always shown once scenarioResult exists, even if infeasible) */}
          {scenarioResult && (
            <section className="space-y-5">
              <div className="flex items-center gap-3">
                <h2 className="text-base font-semibold text-slate-900">
                  Scenario Comparison (Demand ×{demandMult.toFixed(2)}, Capacity ×
                  {capacityMult.toFixed(2)}, Prod Cost ×{costMult.toFixed(2)})
                </h2>
                <button
                  type="button"
                  onClick={() => setShowComparison((v) => !v)}
                  className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  {showComparison ? 'Collapse' : 'Expand'}
                  {showComparison ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              </div>

              {showComparison && (
                <>
                  {!modelsCompatible && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <div>
                        <span className="font-semibold">Model structure mismatch: </span>
                        {incompatibilityReasons.join('; ')}. Direct metric comparison may not be
                        valid.
                      </div>
                    </div>
                  )}

                  {/* Feasibility comparison (always visible) */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Baseline Feasibility
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                          mpSolution?.is_optimal
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {mpSolution?.is_optimal ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5" />
                        )}
                        {mpSolution?.status}
                      </span>
                      <p className="mt-2 text-xs text-slate-500">{mpSolution?.message}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Scenario Feasibility
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                          scenarioResult.is_optimal
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {scenarioResult.is_optimal ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                          <AlertCircle className="h-3.5 w-3.5" />
                        )}
                        {scenarioResult.status}
                      </span>
                      <p className="mt-2 text-xs text-slate-500">{scenarioResult.message}</p>
                    </div>
                  </div>

                  {!hasScenario ? (
                    <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                      <div>
                        <span className="font-semibold">
                          Scenario did not reach an optimal solution ({scenarioResult.status}):{' '}
                        </span>
                        Objective comparison and production charts are omitted because no valid
                        feasible production plan exists under these parameters. Adjust demand or
                        capacity multipliers and re-run.
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Metric diff cards */}
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        <DiffCard
                          label={`Objective Value (${mpSolution?.objective_sense ?? 'Minimize'})`}
                          baseline={baselineObj}
                          scenario={scenarioObj}
                          lowerIsBetter={isMinimize}
                        />
                        <DiffCard
                          label="Total Production"
                          baseline={baselineProd}
                          scenario={scenarioProd}
                          informationalOnly={true}
                        />
                        <DiffCard
                          label="Total Demand"
                          baseline={baselineDemand}
                          scenario={scenarioDemand}
                          informationalOnly={true}
                        />
                        <DiffCard
                          label="Solve Time (s)"
                          baseline={mpSolution?.solve_time_seconds ?? null}
                          scenario={scenarioResult.solve_time_seconds}
                          informationalOnly={true}
                        />
                      </div>

                      {modelsCompatible && (
                        <>
                          {/* Production comparison chart */}
                          {baselinePeriods.length > 0 && scenarioPeriods.length > 0 && (
                            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                              <h3 className="mb-3 text-sm font-semibold text-slate-900">
                                Total Production — Baseline vs. Scenario
                              </h3>
                              <PlotlyChart
                                height={280}
                                data={[
                                  {
                                    x: baselinePeriods,
                                    y: mpSolution!.period_summary.map((p) =>
                                      Number(p.total_production ?? 0)
                                    ),
                                    name: 'Baseline',
                                    type: 'bar',
                                    marker: { color: '#94a3b8' },
                                    hovertemplate: 'Baseline · %{x}: %{y:,.0f}<extra></extra>',
                                  },
                                  {
                                    x: scenarioPeriods,
                                    y: scenarioResult.period_summary.map((p) =>
                                      Number(p.total_production ?? 0)
                                    ),
                                    name: 'Scenario',
                                    type: 'bar',
                                    marker: { color: '#2563eb' },
                                    hovertemplate: 'Scenario · %{x}: %{y:,.0f}<extra></extra>',
                                  },
                                ]}
                                layout={{
                                  barmode: 'group',
                                  margin: { t: 16, r: 16, b: 56, l: 56 },
                                  legend: {
                                    orientation: 'h',
                                    x: 0,
                                    y: 1.02,
                                    xanchor: 'left',
                                    yanchor: 'bottom',
                                    font: { size: 11 },
                                  },
                                  xaxis: { title: 'Period', automargin: true },
                                  yaxis: { title: 'Production', automargin: true },
                                }}
                              />
                            </div>
                          )}

                          {/* Objective comparison chart */}
                          {baselineObj !== null && scenarioObj !== null && (
                            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                              <h3 className="mb-3 text-sm font-semibold text-slate-900">
                                Objective Value Comparison ({mpSolution?.objective_sense})
                              </h3>
                              <PlotlyChart
                                height={220}
                                data={[
                                  {
                                    x: ['Baseline', 'Scenario'],
                                    y: [baselineObj, scenarioObj],
                                    type: 'bar',
                                    marker: {
                                      color: [
                                        '#94a3b8',
                                        (isMinimize
                                          ? scenarioObj <= baselineObj
                                          : scenarioObj >= baselineObj)
                                          ? '#10b981'
                                          : '#ef4444',
                                      ],
                                    },
                                    text: [
                                      baselineObj.toLocaleString(undefined, {
                                        maximumFractionDigits: 2,
                                      }),
                                      scenarioObj.toLocaleString(undefined, {
                                        maximumFractionDigits: 2,
                                      }),
                                    ],
                                    textposition: 'outside',
                                    cliponaxis: false,
                                    hovertemplate: '%{x}: %{y:,.4f}<extra></extra>',
                                  },
                                ]}
                                layout={{
                                  margin: { t: 32, r: 16, b: 48, l: 72 },
                                  yaxis: { title: 'Objective Value', automargin: true },
                                }}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
      {hasBaseline && mpMapping && (
        <SaveScenarioModal
          isOpen={saveModalOpen}
          onClose={() => setSaveModalOpen(false)}
          defaultName={
            selectedPreset !== 'baseline' && selectedPreset !== 'custom'
              ? PRESETS.find((p) => p.id === selectedPreset)?.label ?? 'What-If Scenario'
              : `What-If (D×${demandMult.toFixed(2)}, C×${capacityMult.toFixed(2)}, P×${costMult.toFixed(2)})`
          }
          datasetId={dataset?.dataset_id ?? null}
          datasetName={dataset?.filename ?? null}
          activeSheet={dataset?.active_sheet ?? null}
          inputConfig={{
            mapping: mpMapping,
            integer_production: mpSolution?.integer_production ?? mpIntegerProd,
            allow_backlogging: mpSolution?.allow_backlogging ?? false,
            capacity_scope:
              (mpSolution?.capacity_scope as 'auto' | 'per_product' | 'aggregate_period' | undefined) ??
              mpCapacityScope,
            demand_multiplier: demandMult,
            capacity_multiplier: capacityMult,
            production_cost_multiplier: costMult,
            objective_sense: mpSolution?.objective_sense ?? 'Minimize',
          }}
          resultSnapshot={scenarioResult}
          onSaved={(saved) =>
            setSavedNotice(`Scenario "${saved.name}" saved to Scenario Library.`)
          }
        />
      )}
    </div>
  );
};

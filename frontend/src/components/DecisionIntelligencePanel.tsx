import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Award,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  Info,
  Lightbulb,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
} from 'lucide-react';
import type { MultiPeriodColumnMapping, MultiPeriodSolveResponse } from '../types/or';
import { useStudio } from '../context/StudioContext';
import { buildDecisionIntelligence } from '../utils/decisionIntelligence';
import {
  analyzeBottlenecks,
  analyzeCrossModuleRisk,
  buildActionableInsights,
  type InsightEvidenceStrength,
} from '../utils/enhancedDecisionIntelligence';
import { getDecisionIntelligenceNextSteps } from '../utils/workflowTransitions';

interface DecisionIntelligencePanelProps {
  solution: MultiPeriodSolveResponse;
  mapping?: MultiPeriodColumnMapping | null;
  onSwitchTab?: (tab: 'results' | 'graphs' | 'formulation') => void;
  onFocusMapping?: () => void;
}

export const DecisionIntelligencePanel: React.FC<DecisionIntelligencePanelProps> = ({
  solution,
  mapping,
  onSwitchTab,
  onFocusMapping,
}) => {
  const navigate = useNavigate();
  const {
    dataset,
    mpMapping,
    mpCapacityScope,
    mpIntegerProd,
    mpSolution,
    mpSolutionMappingSignature,
    sensitivityResult,
    sensitivityMeta,
    tradeoffResult,
    tradeoffMeta,
  } = useStudio();
  const [showAllResources, setShowAllResources] = useState(false);
  const [whyExpanded, setWhyExpanded] = useState(true);
  const [bottlenecksExpanded, setBottlenecksExpanded] = useState(true);

  const report = useMemo(
    () => buildDecisionIntelligence(solution, mapping),
    [solution, mapping]
  );

  const bottlenecks = useMemo(() => analyzeBottlenecks(solution), [solution]);
  const isLiveBaseline = mpSolution !== null && solution === mpSolution;

  const crossModuleRisk = useMemo(
    () =>
      analyzeCrossModuleRisk({
        dataset,
        mpMapping,
        mpSolution: isLiveBaseline ? mpSolution : null,
        mpIntegerProd,
        mpCapacityScope,
        mpSolutionMappingSignature,
        sensitivityResult: isLiveBaseline ? sensitivityResult : null,
        sensitivityMeta: isLiveBaseline ? sensitivityMeta : null,
        tradeoffResult: isLiveBaseline ? tradeoffResult : null,
        tradeoffMeta: isLiveBaseline ? tradeoffMeta : null,
      }),
    [
      dataset,
      mpMapping,
      isLiveBaseline,
      mpSolution,
      mpIntegerProd,
      mpCapacityScope,
      mpSolutionMappingSignature,
      sensitivityResult,
      sensitivityMeta,
      tradeoffResult,
      tradeoffMeta,
    ]
  );

  const actionableInsights = useMemo(
    () => buildActionableInsights({ bottlenecks, crossModuleRisk }),
    [bottlenecks, crossModuleRisk]
  );

  const { executiveSummary, whyThisSolution, resourceInsights, costAnalysis, alerts } = report;

  const nextSteps = useMemo(
    () =>
      getDecisionIntelligenceNextSteps({
        dataset,
        mpMapping,
        mpSolution,
        mpIntegerProd,
        mpCapacityScope,
        mpSolutionMappingSignature,
        tradeoffResult,
        tradeoffMeta,
        isLiveBaseline,
        isOptimal: executiveSummary.isOptimal,
        constraintsFeasible: executiveSummary.constraintsFeasible,
      }),
    [
      dataset,
      mpMapping,
      mpSolution,
      mpIntegerProd,
      mpCapacityScope,
      mpSolutionMappingSignature,
      tradeoffResult,
      tradeoffMeta,
      isLiveBaseline,
      executiveSummary.isOptimal,
      executiveSummary.constraintsFeasible,
    ]
  );

  const EVIDENCE_BADGE: Record<InsightEvidenceStrength, { label: string; cls: string }> = {
    mathematically_verified: {
      label: 'Mathematically Verified',
      cls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    },
    empirical_grid: {
      label: 'Empirical Grid',
      cls: 'border-blue-200 bg-blue-50 text-blue-700',
    },
    heuristic_threshold: {
      label: 'Heuristic Threshold',
      cls: 'border-amber-200 bg-amber-50 text-amber-800',
    },
  };

  const visibleResources = showAllResources
    ? resourceInsights.items
    : resourceInsights.items.slice(0, 6);

  return (
    <section
      aria-label="Decision Intelligence Layer"
      className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:p-6"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Lightbulb className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Decision Intelligence</h2>
            <p className="text-xs text-slate-500">
              Deterministic interpretation derived exclusively from actual solver outputs and model
              settings.
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            executiveSummary.isOptimal
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-rose-50 text-rose-700'
          }`}
        >
          {executiveSummary.isOptimal ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5" />
          )}
          {executiveSummary.status}
        </span>
      </div>

      {/* SECTION 1 — EXECUTIVE SUMMARY */}
      <div
        className={`rounded-xl border p-4 ${
          executiveSummary.isOptimal
            ? 'border-blue-200 bg-blue-50/40'
            : 'border-rose-200 bg-rose-50/50'
        }`}
      >
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          1. Executive Summary
        </div>
        <p className="mt-1.5 text-sm font-semibold leading-relaxed text-slate-900">
          {executiveSummary.headline}
        </p>
        <p className="mt-1 text-xs text-slate-600">{executiveSummary.completenessNote}</p>

        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-400">
              Objective ({executiveSummary.objectiveSense})
            </div>
            <div className="mt-0.5 font-mono text-xs font-bold text-slate-900">
              {executiveSummary.objectiveValue !== null
                ? executiveSummary.objectiveValue.toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })
                : 'N/A'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-400">
              Total Production
            </div>
            <div className="mt-0.5 font-mono text-xs font-bold text-slate-900">
              {executiveSummary.totalProduction !== null
                ? executiveSummary.totalProduction.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })
                : 'N/A'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-400">Total Demand</div>
            <div className="mt-0.5 font-mono text-xs font-bold text-slate-900">
              {executiveSummary.totalDemand !== null
                ? executiveSummary.totalDemand.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })
                : 'N/A'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-400">Feasibility</div>
            <div
              className={`mt-0.5 text-xs font-bold ${
                executiveSummary.isOptimal && executiveSummary.constraintsFeasible
                  ? 'text-emerald-700'
                  : 'text-rose-700'
              }`}
            >
              {executiveSummary.isOptimal
                ? executiveSummary.constraintsFeasible
                  ? 'Verified'
                  : 'Violated'
                : 'Infeasible'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-400">Products</div>
            <div className="mt-0.5 font-mono text-xs font-bold text-slate-900">
              {executiveSummary.productCount > 0 ? executiveSummary.productCount : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2">
            <div className="text-[10px] font-semibold uppercase text-slate-400">Periods</div>
            <div className="mt-0.5 font-mono text-xs font-bold text-slate-900">
              {executiveSummary.periodCount > 0 ? executiveSummary.periodCount : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2 — WHY THIS SOLUTION? */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
        <button
          type="button"
          onClick={() => setWhyExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-slate-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              2. Why This Solution?
            </span>
          </div>
          {whyExpanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {whyExpanded && (
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3.5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                Model Facts
              </div>
              <ul className="space-y-1.5 text-xs text-slate-600">
                {whyThisSolution.modelFacts.map((fact, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-blue-500" />
                    <span>{fact}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3.5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Observed Results
              </div>
              <ul className="space-y-1.5 text-xs text-slate-600">
                {whyThisSolution.observedResults.map((obs, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                    <span>{obs}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3.5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <Info className="h-3.5 w-3.5 text-amber-600" />
                Rule-Based Interpretations
              </div>
              {whyThisSolution.interpretations.length > 0 ? (
                <ul className="space-y-1.5 text-xs text-slate-600">
                  {whyThisSolution.interpretations.map((interp, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                      <span>{interp}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">
                  No additional rule-based interpretations apply beyond the observed solver metrics.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 3 & SECTION 4 — RESOURCE INSIGHTS & COST TRADE-OFFS */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* SECTION 3 — RESOURCE & CAPACITY INSIGHTS */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-blue-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                3. Resource &amp; Capacity Insights
              </h3>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              Heuristic Classification
            </span>
          </div>

          {!resourceInsights.available ? (
            <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
              {executiveSummary.isOptimal
                ? 'Resource capacity data is unavailable for this run (no Capacity column mapped).'
                : 'Resource utilization is unavailable because the model did not reach an optimal solution.'}{' '}
              Dual/shadow prices are not reported by this solver.
            </div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full bg-rose-50 px-2.5 py-0.5 font-semibold text-rose-700">
                  High (≥90%): {resourceInsights.highCount}
                </span>
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-700">
                  Moderate (70–90%): {resourceInsights.moderateCount}
                </span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700">
                  Low (&lt;70%): {resourceInsights.lowCount}
                </span>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="py-1.5 pr-2 font-semibold">Resource (Period)</th>
                      <th className="py-1.5 px-2 font-semibold">Used / Cap</th>
                      <th className="py-1.5 px-2 font-semibold">Slack</th>
                      <th className="py-1.5 pl-2 font-semibold">Util %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleResources.map((r) => (
                      <tr key={`${r.resource}-${r.period}`}>
                        <td className="py-1.5 pr-2 font-medium text-slate-800">
                          {r.resource} <span className="text-slate-400">({r.period})</span>
                        </td>
                        <td className="py-1.5 px-2 font-mono text-slate-700">
                          {r.used !== null
                            ? r.used.toLocaleString(undefined, { maximumFractionDigits: 2 })
                            : 'N/A'}{' '}
                          /{' '}
                          {r.capacity !== null
                            ? r.capacity.toLocaleString(undefined, { maximumFractionDigits: 2 })
                            : 'N/A'}
                        </td>
                        <td className="py-1.5 px-2 font-mono text-slate-600">
                          {r.remaining !== null
                            ? r.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })
                            : 'N/A'}
                        </td>
                        <td className="py-1.5 pl-2">
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                              r.tier === 'unavailable'
                                ? 'bg-slate-100 text-slate-600'
                                : r.tier === 'high'
                                ? 'bg-rose-50 text-rose-700'
                                : r.tier === 'moderate'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {r.tier === 'unavailable' || r.utilizationPct === null
                              ? 'N/A'
                              : `${r.utilizationPct.toFixed(1)}%`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {resourceInsights.items.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllResources((v) => !v)}
                  className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  {showAllResources
                    ? 'Show fewer resources'
                    : `Show all ${resourceInsights.items.length} entries`}
                </button>
              )}

              <p className="mt-2 text-[11px] text-slate-400">
                {resourceInsights.limitationNote}
              </p>
            </>
          )}
        </div>

        {/* SECTION 4 — COST BREAKDOWN & TRADE-OFFS */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              4. Cost Breakdown &amp; Trade-Offs
            </h3>
          </div>

          {!costAnalysis.available ? (
            <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
              {costAnalysis.unavailableReason}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {costAnalysis.largestComponent && (
                <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs text-slate-700">
                  Largest cost driver:{' '}
                  <span className="font-semibold text-slate-900">
                    {costAnalysis.largestComponent.label}
                  </span>{' '}
                  (
                  {costAnalysis.largestComponent.value.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                  {costAnalysis.largestComponent.sharePct !== null
                    ? `, ${costAnalysis.largestComponent.sharePct}% of total mapped cost`
                    : ''}
                  ).
                </div>
              )}

              <div className="space-y-2.5">
                {costAnalysis.components.map((comp) => (
                  <div key={comp.key}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{comp.label}</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {comp.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        {comp.sharePct !== null ? ` (${comp.sharePct}%)` : ''}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{
                          width: `${Math.min(100, Math.max(0, comp.sharePct ?? 0))}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {costAnalysis.tradeOffNote && (
                <p className="text-xs text-slate-600">{costAnalysis.tradeOffNote}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 5 — DECISION ALERTS */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            5. Decision Alerts ({alerts.length})
          </h3>
        </div>

        {alerts.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-800">
            No risk alerts triggered: solution is optimal, constraints are verified, and mapped
            resources are below the 90% utilization threshold.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {alerts.map((alert) => {
              const style =
                alert.severity === 'critical'
                  ? 'border-rose-200 bg-rose-50/70 text-rose-900'
                  : alert.severity === 'warning'
                  ? 'border-amber-200 bg-amber-50/70 text-amber-900'
                  : 'border-blue-200 bg-blue-50/50 text-slate-800';
              const badge =
                alert.severity === 'critical'
                  ? 'bg-rose-600 text-white'
                  : alert.severity === 'warning'
                  ? 'bg-amber-600 text-white'
                  : 'bg-blue-600 text-white';

              return (
                <div key={alert.id} className={`rounded-lg border p-3 text-xs ${style}`}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${badge}`}
                    >
                      {alert.severity}
                    </span>
                    <span className="font-semibold">{alert.title}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] opacity-90">
                    <span className="font-semibold">Evidence:</span> {alert.evidence}
                  </p>
                  <p className="mt-1 text-[11px] opacity-90">
                    <span className="font-semibold">Suggested investigation:</span>{' '}
                    {alert.investigation}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 6 — CONSTRAINT & BOTTLENECK INTELLIGENCE */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <button
          type="button"
          onClick={() => setBottlenecksExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Gauge className="h-4 w-4 text-blue-600" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              6. Constraint &amp; Bottleneck Intelligence
            </span>
            {bottlenecks.available && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                {bottlenecks.bindingCount} Binding · {bottlenecks.nearBindingCount} Near-Binding ·{' '}
                {bottlenecks.slackCount} Slack
              </span>
            )}
          </div>
          {bottlenecksExpanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {bottlenecksExpanded && (
          <div className="mt-3 space-y-3">
            {!bottlenecks.available ? (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                {bottlenecks.reason}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 font-semibold text-rose-700">
                    Binding (slack &le; 1e-5): {bottlenecks.bindingCount}
                  </span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-800">
                    Near-Binding (&ge;90%): {bottlenecks.nearBindingCount}
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700">
                    Slack (&lt;90%): {bottlenecks.slackCount}
                  </span>
                  {bottlenecks.invalidCount > 0 && (
                    <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-700">
                      Invalid/Unclassifiable: {bottlenecks.invalidCount}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="overflow-x-auto rounded-lg border border-slate-100 p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                      Resource Bottleneck Summary
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="py-1 pr-2">Resource</th>
                          <th className="py-1 px-2 text-right">Binding</th>
                          <th className="py-1 px-2 text-right">Near</th>
                          <th className="py-1 px-2 text-right">Peak Util</th>
                          <th className="py-1 pl-2 text-right">Min Slack</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bottlenecks.resourceSummaries.map((rs) => (
                          <tr key={rs.key}>
                            <td className="py-1.5 pr-2 font-medium text-slate-800">{rs.key}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{rs.bindingCount}</td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {rs.nearBindingCount}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {rs.peakUtilizationPct !== null
                                ? `${rs.peakUtilizationPct.toFixed(1)}%`
                                : 'N/A'}
                            </td>
                            <td className="py-1.5 pl-2 text-right font-mono">
                              {rs.minRemainingCapacity !== null
                                ? rs.minRemainingCapacity.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })
                                : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-100 p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                      Period Bottleneck Summary
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="py-1 pr-2">Period</th>
                          <th className="py-1 px-2 text-right">Binding</th>
                          <th className="py-1 px-2 text-right">Near</th>
                          <th className="py-1 px-2 text-right">Peak Util</th>
                          <th className="py-1 pl-2 text-right">Min Slack</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bottlenecks.periodSummaries.map((ps) => (
                          <tr key={ps.key}>
                            <td className="py-1.5 pr-2 font-medium text-slate-800">{ps.key}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{ps.bindingCount}</td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {ps.nearBindingCount}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {ps.peakUtilizationPct !== null
                                ? `${ps.peakUtilizationPct.toFixed(1)}%`
                                : 'N/A'}
                            </td>
                            <td className="py-1.5 pl-2 text-right font-mono">
                              {ps.minRemainingCapacity !== null
                                ? ps.minRemainingCapacity.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })
                                : 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            <p className="text-[11px] text-slate-500">{bottlenecks.limitationNote}</p>
          </div>
        )}
      </div>

      {/* SECTION 7 — CROSS-MODULE RISK & STABILITY */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              7. Cross-Module Risk &amp; Stability
            </h3>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            Empirical &amp; Verified Only
          </span>
        </div>

        {!crossModuleRisk.sensitivityRisk.available &&
        !crossModuleRisk.tradeoffSnapshot.available ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <span>
              {crossModuleRisk.sensitivityRisk.reason ??
                'Run a parameter sweep in Sensitivity Analysis to inspect empirical feasibility risk.'}
            </span>
            <button
              type="button"
              onClick={() => navigate('/sensitivity')}
              className="font-semibold text-blue-600 hover:text-blue-700"
            >
              Open Sensitivity Analysis &rarr;
            </button>
          </div>
        ) : !crossModuleRisk.sensitivityRisk.available &&
          crossModuleRisk.tradeoffSnapshot.available ? (
          <div className="mt-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div>
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  Trade-off Alternatives ({crossModuleRisk.tradeoffSnapshot.criterionLabel})
                </div>
                <div className="mt-0.5 font-bold text-slate-900">
                  {crossModuleRisk.tradeoffSnapshot.distinctAlternatives} distinct verified
                  alternative(s)
                  {crossModuleRisk.tradeoffSnapshot.duplicateCount > 0
                    ? ` · ${crossModuleRisk.tradeoffSnapshot.duplicateCount} duplicate`
                    : ''}
                  {crossModuleRisk.tradeoffSnapshot.criterionImprovement !== null
                    ? ` · Best improvement: ${crossModuleRisk.tradeoffSnapshot.criterionImprovement.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate('/trade-offs')}
                className="font-semibold text-blue-600 hover:text-blue-700"
              >
                Open Trade-off Explorer &rarr;
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <span>
                {crossModuleRisk.sensitivityRisk.reason ??
                  'Run a parameter sweep in Sensitivity Analysis to inspect empirical feasibility risk.'}
              </span>
              <button
                type="button"
                onClick={() => navigate('/sensitivity')}
                className="font-semibold text-blue-600 hover:text-blue-700"
              >
                Open Sensitivity Analysis &rarr;
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  Tested Parameter
                </div>
                <div className="mt-0.5 text-xs font-bold text-slate-900">
                  {crossModuleRisk.sensitivityRisk.testedParameter}
                </div>
                <div className="text-[10px] text-slate-500">
                  {crossModuleRisk.sensitivityRisk.testedMinMultiplier?.toFixed(2)}x–
                  {crossModuleRisk.sensitivityRisk.testedMaxMultiplier?.toFixed(2)}x (
                  {crossModuleRisk.sensitivityRisk.testedPoints} pts)
                </div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  Observed Feasibility
                </div>
                <div className="mt-0.5 text-xs font-bold text-slate-900">
                  {crossModuleRisk.sensitivityRisk.observedFeasibilityRatePct?.toFixed(1)}%
                </div>
                <div className="text-[10px] text-slate-500">
                  {crossModuleRisk.sensitivityRisk.feasiblePoints} feas ·{' '}
                  {crossModuleRisk.sensitivityRisk.infeasiblePoints} infeas
                  {crossModuleRisk.sensitivityRisk.incompletePoints > 0
                    ? ` · ${crossModuleRisk.sensitivityRisk.incompletePoints} inc`
                    : ''}
                </div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  First Infeasible
                </div>
                <div className="mt-0.5 text-xs font-bold text-slate-900">
                  {crossModuleRisk.sensitivityRisk.firstInfeasibleMultiplier !== null
                    ? `${crossModuleRisk.sensitivityRisk.firstInfeasibleMultiplier.toFixed(2)}x`
                    : 'None observed'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  Objective Range
                </div>
                <div className="mt-0.5 text-xs font-bold text-slate-900">
                  {crossModuleRisk.sensitivityRisk.observedFeasibleObjectiveRange !== null
                    ? crossModuleRisk.sensitivityRisk.observedFeasibleObjectiveRange.toLocaleString(
                        undefined,
                        { maximumFractionDigits: 2 }
                      )
                    : 'N/A'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  Max Plan Shift
                </div>
                <div className="mt-0.5 text-xs font-bold text-slate-900">
                  {crossModuleRisk.sensitivityRisk.maxObservedPlanShiftPct !== null
                    ? `${crossModuleRisk.sensitivityRisk.maxObservedPlanShiftPct.toFixed(2)}%`
                    : 'N/A'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-500">
                  Trade-off Alternatives
                </div>
                <div className="mt-0.5 text-xs font-bold text-slate-900">
                  {crossModuleRisk.tradeoffSnapshot.available
                    ? `${crossModuleRisk.tradeoffSnapshot.distinctAlternatives} distinct`
                    : 'Not run'}
                </div>
              </div>
            </div>
            {crossModuleRisk.sensitivityRisk.budgetExhausted && (
              <p className="text-[11px] font-medium text-amber-800">
                Note: Sensitivity sweep execution budget was exhausted before completing all grid
                points.
              </p>
            )}
            <p className="text-[11px] text-slate-500">
              {crossModuleRisk.sensitivityRisk.disclosure}
            </p>
          </div>
        )}
      </div>

      {/* SECTION 8 — ACTIONABLE INSIGHT CARDS */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-blue-600" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            8. Actionable Insights ({actionableInsights.length})
          </h3>
        </div>

        {actionableInsights.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
            No cross-module insights triggered for the current verified state. Run Sensitivity
            Analysis or Trade-off Explorer to surface empirical and trade-off insights.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {actionableInsights.map((ins) => {
              const evBadge = EVIDENCE_BADGE[ins.evidenceStrength];
              return (
                <div
                  key={ins.id}
                  className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-3.5 text-xs"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="font-semibold text-slate-900">{ins.title}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${evBadge.cls}`}
                      >
                        {evBadge.label}
                      </span>
                    </div>
                    <p className="text-slate-700">{ins.explanation}</p>
                    <p className="text-[11px] text-slate-600">
                      <span className="font-semibold">Evidence:</span> {ins.evidence}
                    </p>
                    <p className="text-[11px] text-slate-700">
                      <span className="font-semibold">Suggested action:</span> {ins.suggestedAction}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      <span className="font-semibold">Limitation:</span> {ins.limitations}
                    </p>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px]">
                    <span className="text-slate-500">
                      Source: {ins.sourceModule}
                      {ins.metric ? ` · ${ins.metric}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate(ins.route)}
                      className="font-semibold text-blue-600 hover:text-blue-700"
                    >
                      Inspect &rarr;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 9 — NEXT STEPS */}
      <div>
        <div className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-700">
          9. Recommended Next Steps
        </div>
        {nextSteps.unavailableNote && (
          <p className="mb-2.5 text-[11px] text-slate-600">{nextSteps.unavailableNote}</p>
        )}
        <div className="flex flex-wrap gap-2.5">
          {nextSteps.links.map((link) => {
            const Icon =
              link.id === 'what-if'
                ? FlaskConical
                : link.id === 'sensitivity'
                  ? SlidersHorizontal
                  : link.id === 'trade-offs'
                    ? GitCompareArrows
                    : link.id === 'recommendations'
                      ? Award
                      : Database;
            return (
              <button
                key={link.id}
                type="button"
                onClick={() => navigate(link.to)}
                className={
                  link.primary
                    ? 'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-blue-700'
                    : 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50'
                }
              >
                <Icon className={`h-3.5 w-3.5 ${link.primary ? '' : 'text-blue-600'}`} />
                {link.label}
                {link.primary && <ArrowRight className="h-3.5 w-3.5" />}
              </button>
            );
          })}

          {onSwitchTab && executiveSummary.isOptimal && (
            <button
              type="button"
              onClick={() => onSwitchTab('graphs')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <BarChart3 className="h-3.5 w-3.5 text-blue-600" />
              Inspect Resource &amp; Flow Charts
            </button>
          )}

          {onSwitchTab && (
            <button
              type="button"
              onClick={() => onSwitchTab('formulation')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Sigma className="h-3.5 w-3.5 text-slate-600" />
              Review Mathematical Formulation
            </button>
          )}

          {!executiveSummary.isOptimal && onFocusMapping && (
            <button
              type="button"
              onClick={onFocusMapping}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
            >
              Adjust Column Mapping
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

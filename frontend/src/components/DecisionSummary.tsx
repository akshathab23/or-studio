/**
 * DecisionSummary — Rule-based decision explanation panel.
 * Uses actual solver output only. No AI-generated or fabricated content.
 */
import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type { MultiPeriodSolveResponse } from '../types/or';

interface DecisionSummaryProps {
  solution: MultiPeriodSolveResponse;
}

export const DecisionSummary: React.FC<DecisionSummaryProps> = ({ solution }) => {
  const [expanded, setExpanded] = useState(true);

  if (!solution.is_optimal) return null;

  // ── Derive facts from actual solver output ────────────────────────────────
  const totalProd = solution.total_production ?? 0;
  const totalDemand = solution.total_demand ?? 0;
  const allowBacklogging = Boolean(solution.allow_backlogging);
  const demandVerifiedSatisfied =
    solution.is_optimal && solution.constraints_feasible && !allowBacklogging;

  const bottlenecks = solution.resource_utilization.filter(
    (u) => (u.utilization_pct ?? 0) >= 90
  );
  const highUtilization = solution.resource_utilization.filter(
    (u) => (u.utilization_pct ?? 0) >= 70 && (u.utilization_pct ?? 0) < 90
  );

  const periods = solution.period_summary;
  const lowInventoryPeriods = periods.filter(
    (p) => (p.total_ending_inventory ?? 0) < 1e-6
  );
  const peakProductionPeriod =
    periods.length > 0
      ? periods.reduce((max, p) =>
          (p.total_production ?? 0) > (max.total_production ?? 0) ? p : max
        )
      : null;

  const objValue = solution.objective_value ?? 0;
  const solveTime = solution.solve_time_seconds ?? 0;

  // ── Insights array ────────────────────────────────────────────────────────
  const insights: { type: 'good' | 'warn' | 'info'; text: string }[] = [];

  if (demandVerifiedSatisfied) {
    if (totalDemand > 0 && totalProd < totalDemand - 1e-6) {
      insights.push({
        type: 'good',
        text: `All period demand constraints are satisfied without backlogging (${totalProd.toLocaleString(
          undefined,
          { maximumFractionDigits: 2 }
        )} units produced; initial inventory contributed toward ${totalDemand.toLocaleString(
          undefined,
          { maximumFractionDigits: 2 }
        )} total demand).`,
      });
    } else {
      insights.push({
        type: 'good',
        text: 'All period demand constraints are satisfied without backlogging.',
      });
    }
  } else if (allowBacklogging) {
    insights.push({
      type: 'info',
      text: 'Backlogging is enabled in this model; exact demand fulfillment cannot be assumed as 100% on-time from aggregate totals alone.',
    });
  } else {
    insights.push({
      type: 'warn',
      text: 'Demand satisfaction could not be verified because constraint feasibility is unconfirmed.',
    });
  }

  if (bottlenecks.length > 0) {
    insights.push({
      type: 'warn',
      text: `${bottlenecks.length} resource(s) are at ≥90% utilization and may be capacity bottlenecks: ${bottlenecks
        .map((b) => `${b.resource} (T${b.period}) ${b.utilization_pct?.toFixed(1)}%`)
        .slice(0, 3)
        .join(', ')}.`,
    });
  } else if (highUtilization.length > 0) {
    insights.push({
      type: 'info',
      text: `${highUtilization.length} resource(s) are at 70–90% utilization. Monitor for future capacity pressure.`,
    });
  } else if (solution.resource_utilization.length > 0) {
    insights.push({ type: 'good', text: 'All resources are operating below 70% utilization.' });
  }

  if (lowInventoryPeriods.length > 0) {
    insights.push({
      type: 'info',
      text: `Just-in-time production: ending inventory is zero in ${lowInventoryPeriods.length} of ${periods.length} period(s).`,
    });
  }

  if (peakProductionPeriod) {
    insights.push({
      type: 'info',
      text: `Peak production occurs in period ${peakProductionPeriod.period} (${Number(
        peakProductionPeriod.total_production ?? 0
      ).toLocaleString(undefined, { maximumFractionDigits: 0 })} units).`,
    });
  }

  if (solveTime < 1) {
    insights.push({
      type: 'good',
      text: `Model solved to optimality in ${(solveTime * 1000).toFixed(0)} ms.`,
    });
  }

  if (insights.length === 0) return null;

  const iconFor = (type: 'good' | 'warn' | 'info') => {
    if (type === 'good') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />;
    if (type === 'warn') return <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />;
    return <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
  };

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-semibold text-slate-900">Decision Insights</span>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
            {insights.length}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {/* Key metrics strip */}
          <div className="flex flex-wrap gap-4 rounded-lg bg-white/70 px-4 py-2.5 text-xs">
            <div>
              <span className="font-semibold text-slate-500">Objective: </span>
              <span className="font-mono font-bold text-slate-900">
                {objValue.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
            </div>
            <div>
              <span className="font-semibold text-slate-500">Demand Status: </span>
              <span
                className={`font-semibold ${
                  demandVerifiedSatisfied ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {demandVerifiedSatisfied
                  ? 'Satisfied (No Backlogging)'
                  : allowBacklogging
                  ? 'Backlogging Allowed'
                  : 'Unverified'}
              </span>
            </div>
            <div>
              <span className="font-semibold text-slate-500">Periods: </span>
              <span className="font-mono font-bold text-slate-900">{periods.length}</span>
            </div>
            {bottlenecks.length > 0 && (
              <div className="flex items-center gap-1 text-amber-700">
                <TrendingUp className="h-3 w-3" />
                <span className="font-semibold">{bottlenecks.length} near/at capacity</span>
              </div>
            )}
            {lowInventoryPeriods.length > 0 && (
              <div className="flex items-center gap-1 text-blue-600">
                <TrendingDown className="h-3 w-3" />
                <span className="font-semibold">JIT in {lowInventoryPeriods.length} period(s)</span>
              </div>
            )}
          </div>

          {/* Insights list */}
          <ul className="space-y-1.5">
            {insights.map((ins, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                {iconFor(ins.type)}
                <span>{ins.text}</span>
              </li>
            ))}
          </ul>

          <p className="pt-1 text-[11px] text-slate-400">
            Insights are derived exclusively from actual solver output. No values are estimated or
            fabricated.
          </p>
        </div>
      )}
    </div>
  );
};

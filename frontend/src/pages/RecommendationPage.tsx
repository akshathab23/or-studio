import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Award,
  CheckCircle2,
  GitCompareArrows,
  Info,
  Layers,
  RotateCcw,
  Sliders,
} from 'lucide-react';
import { PlotlyChart } from '../components/PlotlyChart';
import { useStudio } from '../context/StudioContext';
import type {
  CriterionDirection,
  RecommendationCriterionConfig,
  RecommendationCriterionId,
} from '../types/or';
import {
  buildContributionChart,
  buildDefaultCriteriaConfig,
  buildPairwiseComparison,
  buildRankedScoreChart,
  buildRecommendationExplanation,
  extractEligibleCandidates,
  rankAlternatives,
} from '../utils/decisionRecommendation';
import { analyzePreferenceStability } from '../utils/enhancedDecisionIntelligence';
import { formatNumberOrNull } from '../utils/sensitivityAnalysis';
import { buildCandidatePlanDiff } from '../utils/tradeoffExplorer';

export const RecommendationPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    dataset,
    mpMapping,
    mpCapacityScope,
    mpIntegerProd,
    mpSolution,
    mpSolutionMappingSignature,
    tradeoffResult,
    tradeoffMeta,
  } = useStudio();

  const eligibility = useMemo(
    () =>
      extractEligibleCandidates({
        dataset,
        mpMapping,
        mpSolution,
        mpIntegerProd,
        mpCapacityScope,
        mpSolutionMappingSignature,
        tradeoffResult,
        tradeoffMeta,
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
    ]
  );

  const objectiveSense = mpSolution?.objective_sense ?? 'Minimize';
  const tradeoffCriterion = tradeoffResult?.criterion;

  const [criteria, setCriteria] = useState<RecommendationCriterionConfig[]>(() =>
    buildDefaultCriteriaConfig(eligibility.eligible, objectiveSense, tradeoffCriterion)
  );
  const [compareIdA, setCompareIdA] = useState<string>('');
  const [compareIdB, setCompareIdB] = useState<string>('');

  // Re-initialize default criteria whenever eligible candidate pool changes
  useEffect(() => {
    setCriteria(
      buildDefaultCriteriaConfig(eligibility.eligible, objectiveSense, tradeoffCriterion)
    );
  }, [eligibility.eligible, objectiveSense, tradeoffCriterion]);

  const rankingOutput = useMemo(
    () =>
      rankAlternatives({
        eligible: eligibility.eligible,
        criteria,
        objectiveSense,
        tradeoffCriterion,
      }),
    [eligibility.eligible, criteria, objectiveSense, tradeoffCriterion]
  );

  // Keep pairwise comparison selections valid (default: baseline vs top-ranked or rank #1 vs #2)
  useEffect(() => {
    const ranked = rankingOutput.ranked;
    if (ranked.length < 2) {
      setCompareIdA('');
      setCompareIdB('');
      return;
    }
    const ids = new Set(ranked.map((r) => r.candidate.candidate_id));
    const defaultA = ranked[0].candidate.candidate_id;
    const defaultB =
      ranked.find((r) => r.candidate.candidate_id !== defaultA)?.candidate.candidate_id ??
      ranked[1].candidate.candidate_id;
    if (!ids.has(compareIdA)) setCompareIdA(defaultA);
    if (!ids.has(compareIdB) || compareIdB === compareIdA) {
      setCompareIdB(defaultB === compareIdA ? ranked[0].candidate.candidate_id : defaultB);
    }
  }, [rankingOutput.ranked, compareIdA, compareIdB]);

  const handleToggleCriterion = (id: RecommendationCriterionId) => {
    setCriteria((prev) =>
      prev.map((c) => (c.id === id && c.available ? { ...c, selected: !c.selected } : c))
    );
  };

  const handleDirectionChange = (id: RecommendationCriterionId, direction: CriterionDirection) => {
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, direction } : c)));
  };

  const handleWeightChange = (id: RecommendationCriterionId, raw: string) => {
    const num = raw === '' ? 0 : Number(raw);
    setCriteria((prev) =>
      prev.map((c) => (c.id === id ? { ...c, weight: Number.isFinite(num) ? num : -1 } : c))
    );
  };

  const handleResetPreferences = () => {
    setCriteria(
      buildDefaultCriteriaConfig(eligibility.eligible, objectiveSense, tradeoffCriterion)
    );
  };

  const handleResetComparison = () => {
    const ranked = rankingOutput.ranked;
    if (ranked.length >= 2) {
      setCompareIdA(ranked[0].candidate.candidate_id);
      setCompareIdB(ranked[1].candidate.candidate_id);
    }
  };

  const explanation = useMemo(
    () =>
      rankingOutput.valid
        ? buildRecommendationExplanation(
            rankingOutput.ranked,
            eligibility.excludedDuplicatesCount,
            eligibility.excludedUnverifiedCount
          )
        : null,
    [rankingOutput, eligibility.excludedDuplicatesCount, eligibility.excludedUnverifiedCount]
  );

  const preferenceStability = useMemo(
    () =>
      analyzePreferenceStability({
        eligible: eligibility.eligible,
        criteria,
        objectiveSense,
        tradeoffCriterion,
      }),
    [eligibility.eligible, criteria, objectiveSense, tradeoffCriterion]
  );

  const rankedScoreChart = useMemo(
    () => (rankingOutput.valid ? buildRankedScoreChart(rankingOutput.ranked) : null),
    [rankingOutput]
  );

  const contributionChart = useMemo(
    () => (rankingOutput.valid ? buildContributionChart(rankingOutput.ranked) : null),
    [rankingOutput]
  );

  const itemA = rankingOutput.ranked.find((r) => r.candidate.candidate_id === compareIdA) ?? null;
  const itemB = rankingOutput.ranked.find((r) => r.candidate.candidate_id === compareIdB) ?? null;

  const pairwiseCriteria = useMemo(
    () => (itemA && itemB ? buildPairwiseComparison(itemA, itemB) : []),
    [itemA, itemB]
  );

  const planDiffAB = useMemo(
    () => (itemA && itemB ? buildCandidatePlanDiff(itemA.candidate, itemB.candidate) : null),
    [itemA, itemB]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            Decision Recommendation &amp; Comparison
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Rank and compare verified feasible plans using transparent operational preference
            weights and min-max normalized scoring.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate('/trade-offs')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <GitCompareArrows className="h-3.5 w-3.5 text-blue-600" />
            Trade-off Explorer
          </button>
          <button
            type="button"
            onClick={() => navigate('/scenarios')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Layers className="h-3.5 w-3.5 text-slate-600" />
            Scenario Management
          </button>
        </div>
      </div>

      {/* Empty / Freshness Guard */}
      {!eligibility.ready ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-6 shadow-xs">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <h2 className="text-sm font-semibold text-amber-950">
                  Eligible Trade-off Alternatives Required
                </h2>
                <p className="mt-1 text-sm text-amber-900">{eligibility.reason}</p>
                <p className="mt-2 text-xs text-amber-800">
                  Workflow: Solve a verified Multi-Period baseline &rarr; generate alternatives in{' '}
                  <strong>Trade-off Explorer</strong> &rarr; return here to rank and compare plans.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {!mpSolution ? (
                <button
                  type="button"
                  onClick={() => navigate('/multi-period')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Go to Multi-Period Optimization
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate('/trade-offs')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Generate in Trade-off Explorer
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Preference Criteria & Weights */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-blue-600" />
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Decision Criteria &amp; Preference Weights
                  </h2>
                  <p className="text-xs text-slate-500">
                    Weights express your operational priorities (not solver constraints) and are
                    normalized to sum to 100%.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleResetPreferences}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Preferences
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {criteria.map((crit) => {
                const normPct = rankingOutput.normalizedWeights[crit.id] * 100;
                return (
                  <div
                    key={crit.id}
                    className={`rounded-lg border p-3.5 transition-colors ${
                      !crit.available
                        ? 'border-slate-200 bg-slate-50 opacity-60'
                        : crit.selected
                          ? 'border-blue-300 bg-blue-50/40'
                          : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={!crit.available}
                          checked={crit.selected}
                          onChange={() => handleToggleCriterion(crit.id)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        <span className="text-sm font-semibold text-slate-900">
                          {crit.label}{' '}
                          <span className="text-xs font-normal text-slate-500">({crit.unit})</span>
                        </span>
                      </label>

                      {crit.available ? (
                        <select
                          aria-label={`${crit.label} direction`}
                          value={crit.direction}
                          disabled={!crit.selected}
                          onChange={(e) =>
                            handleDirectionChange(crit.id, e.target.value as CriterionDirection)
                          }
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 disabled:bg-slate-100"
                        >
                          <option value="minimize">Minimize</option>
                          <option value="maximize">Maximize</option>
                        </select>
                      ) : (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          Unavailable
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-slate-600">
                      {crit.available ? crit.description : crit.disabledReason}
                    </p>

                    {crit.available && (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <label className="text-xs font-medium text-slate-700" htmlFor={`w-${crit.id}`}>
                          Weight:
                        </label>
                        <input
                          id={`w-${crit.id}`}
                          type="number"
                          min={0}
                          step={5}
                          disabled={!crit.selected}
                          value={crit.weight}
                          onChange={(e) => handleWeightChange(crit.id, e.target.value)}
                          className="w-24 rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-900 disabled:bg-slate-100"
                        />
                        <span className="text-xs font-semibold text-blue-700">
                          Normalized: {crit.selected ? `${normPct.toFixed(1)}%` : '0.0%'}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {!rankingOutput.valid && rankingOutput.error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <span>{rankingOutput.error}</span>
              </div>
            )}
          </section>

          {rankingOutput.valid && explanation && (
            <>
              {/* Recommendation Explanation Banner */}
              <section className="rounded-xl border border-blue-200 bg-white p-6 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Award className="h-5 w-5 text-blue-600" />
                    <h2 className="text-base font-semibold text-slate-900">
                      Preference-Based Recommendation
                    </h2>
                  </div>
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-0.5 text-xs font-semibold text-blue-700">
                    Top Ranked ({eligibility.eligible.length} distinct verified plans)
                  </span>
                </div>

                <p className="mt-3 rounded-lg border border-blue-100 bg-blue-50/70 p-3.5 text-sm font-medium text-slate-900">
                  {explanation.headline}
                </p>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                      Relative Strengths
                    </div>
                    {explanation.strengths.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                        {explanation.strengths.map((s, idx) => (
                          <li key={idx}>{s}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-600">
                        Balanced compromise across multiple weighted criteria.
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                      Trade-offs &amp; Compromises
                    </div>
                    {explanation.compromises.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                        {explanation.compromises.map((c, idx) => (
                          <li key={idx}>{c}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-600">
                        No single-criterion compromise relative to other eligible plans.
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                    <Info className="h-3.5 w-3.5 text-blue-600" />
                    Methodology &amp; Limitations
                  </div>
                  <p>{explanation.statusNote}</p>
                  {explanation.limitations.map((lim, idx) => (
                    <p key={idx}>{lim}</p>
                  ))}
                </div>
              </section>

              {/* Preference Rank Stability (±20% Perturbations) */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Preference Rank Stability (&plusmn;20% Weight Perturbations)
                    </h2>
                    <p className="text-xs text-slate-500">
                      Deterministic local sensitivity of the #1 ranked plan when each positive
                      weight is varied by &plusmn;20% and renormalized.
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      !preferenceStability.available
                        ? 'border-slate-200 bg-slate-100 text-slate-700'
                        : preferenceStability.stabilityClass === 'stable'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    {!preferenceStability.available
                      ? 'Unavailable'
                      : preferenceStability.stabilityClass === 'stable'
                        ? 'Stable Under ±20% Shifts'
                        : 'Sensitive to ±20% Shifts'}
                  </span>
                </div>

                {!preferenceStability.available ? (
                  <p className="text-xs text-slate-600">{preferenceStability.reason}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase text-slate-500">
                          Original Winner
                        </div>
                        <div className="mt-1 text-sm font-bold text-slate-900">
                          {preferenceStability.originalTopCandidateId}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase text-slate-500">
                          Perturbations Tested
                        </div>
                        <div className="mt-1 text-sm font-bold text-slate-900">
                          {preferenceStability.perturbationsTested}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase text-slate-500">
                          Winner Retained
                        </div>
                        <div className="mt-1 text-sm font-bold text-emerald-700">
                          {preferenceStability.retainedCount} /{' '}
                          {preferenceStability.perturbationsTested}
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase text-slate-500">
                          Winner Changes
                        </div>
                        <div className="mt-1 text-sm font-bold text-slate-900">
                          {preferenceStability.winnerChangesCount}
                          {preferenceStability.observedAlternativeWinners.length > 0
                            ? ` (${preferenceStability.observedAlternativeWinners.join(', ')})`
                            : ''}
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                        <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                          <tr>
                            <th className="px-3 py-2">Perturbed Criterion</th>
                            <th className="px-3 py-2">Shift</th>
                            <th className="px-3 py-2">Top Candidate</th>
                            <th className="px-3 py-2 text-right">Top Score</th>
                            <th className="px-3 py-2">Retained #1</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {preferenceStability.perturbations.map((p, idx) => (
                            <tr key={`${p.criterionId}-${p.perturbationLabel}-${idx}`}>
                              <td className="px-3 py-2 font-medium text-slate-900">
                                {p.criterionLabel}
                              </td>
                              <td className="px-3 py-2 text-slate-700">{p.perturbationLabel}</td>
                              <td className="px-3 py-2 font-semibold text-slate-900">
                                {p.topCandidateId}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-slate-700">
                                {(p.topScore * 100).toFixed(1)}
                              </td>
                              <td className="px-3 py-2">
                                {p.retainedOriginalWinner ? (
                                  <span className="text-emerald-700 font-semibold">Yes</span>
                                ) : (
                                  <span className="text-amber-700 font-semibold">Changed</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <p className="text-[11px] text-slate-500">
                      {preferenceStability.methodologyNote} {preferenceStability.disclosure}
                    </p>
                  </>
                )}
              </section>

              {/* Visualizations */}
              <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">
                    Ranked Eligible Alternatives (Preference Score)
                  </h3>
                  {rankedScoreChart && (
                    <PlotlyChart
                      data={rankedScoreChart.data}
                      layout={rankedScoreChart.layout}
                      height={320}
                    />
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">
                    Weighted Criterion Score Contributions
                  </h3>
                  {contributionChart && (
                    <PlotlyChart
                      data={contributionChart.data}
                      layout={contributionChart.layout}
                      height={320}
                    />
                  )}
                </div>
              </section>

              {/* Ranked Candidate Table */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  <h2 className="text-base font-semibold text-slate-900">
                    Ranked Candidate Plans
                  </h2>
                  <span className="text-xs text-slate-500">
                    Min-max normalized across {rankingOutput.ranked.length} distinct verified plans
                  </span>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                      <tr>
                        <th className="px-3 py-2.5">Rank</th>
                        <th className="px-3 py-2.5">Candidate</th>
                        <th className="px-3 py-2.5 text-right">Preference Score</th>
                        {rankingOutput.ranked[0]?.breakdowns.map((bd) => (
                          <th key={bd.criterionId} className="px-3 py-2.5 text-right">
                            {bd.label}
                          </th>
                        ))}
                        <th className="px-3 py-2.5 text-right">Plan Shift</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rankingOutput.ranked.map((item) => {
                        const c = item.candidate;
                        return (
                          <tr key={c.candidate_id} className={item.rank === 1 ? 'bg-blue-50/50' : ''}>
                            <td className="whitespace-nowrap px-3 py-2.5 font-bold text-slate-900">
                              #{item.rank}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-900">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span>{c.candidate_id}</span>
                                {item.rank === 1 && (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Recommended
                                  </span>
                                )}
                                {c.is_baseline && (
                                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                    Baseline
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold text-blue-700">
                              {(item.totalScore * 100).toFixed(1)}
                            </td>
                            {item.breakdowns.map((bd) => (
                              <td
                                key={bd.criterionId}
                                className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700"
                              >
                                <div className="font-medium text-slate-900">
                                  {formatNumberOrNull(bd.rawValue, 2)}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  norm {(bd.normalizedScore * 100).toFixed(0)}%
                                </div>
                              </td>
                            ))}
                            <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">
                              {formatNumberOrNull(c.plan_shift_pct, 2, '%')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Pairwise Candidate Comparison Workspace */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Side-by-Side Plan Comparison
                    </h2>
                    <p className="text-xs text-slate-500">
                      Compare any two verified eligible plans across decision scores, schedules,
                      inventory, and capacity utilization.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetComparison}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset Comparison
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="compare-plan-a"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                    >
                      Plan A
                    </label>
                    <select
                      id="compare-plan-a"
                      value={compareIdA}
                      onChange={(e) => setCompareIdA(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      {rankingOutput.ranked.map((r) => (
                        <option key={r.candidate.candidate_id} value={r.candidate.candidate_id}>
                          #{r.rank} {r.candidate.candidate_id}
                          {r.candidate.is_baseline ? ' (Baseline)' : ''} — Score{' '}
                          {(r.totalScore * 100).toFixed(1)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="compare-plan-b"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                    >
                      Plan B
                    </label>
                    <select
                      id="compare-plan-b"
                      value={compareIdB}
                      onChange={(e) => setCompareIdB(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      {rankingOutput.ranked.map((r) => (
                        <option key={r.candidate.candidate_id} value={r.candidate.candidate_id}>
                          #{r.rank} {r.candidate.candidate_id}
                          {r.candidate.is_baseline ? ' (Baseline)' : ''} — Score{' '}
                          {(r.totalScore * 100).toFixed(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {itemA && itemB && (
                  <>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                        <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                          <tr>
                            <th className="px-3 py-2">Criterion</th>
                            <th className="px-3 py-2 text-right">{itemA.candidate.candidate_id}</th>
                            <th className="px-3 py-2 text-right">{itemB.candidate.candidate_id}</th>
                            <th className="px-3 py-2 text-right">Diff (B &minus; A)</th>
                            <th className="px-3 py-2 text-right">Score A / B</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {pairwiseCriteria.map((row) => (
                            <tr key={row.criterionId}>
                              <td className="px-3 py-2 font-medium text-slate-900">
                                {row.label} ({row.unit})
                              </td>
                              <td className="px-3 py-2 text-right text-slate-700">
                                {formatNumberOrNull(row.valueA, 2)}
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-slate-900">
                                {formatNumberOrNull(row.valueB, 2)}
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-blue-700">
                                {row.deltaBMinusA > 0
                                  ? `+${row.deltaBMinusA.toLocaleString()}`
                                  : row.deltaBMinusA.toLocaleString()}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-600">
                                {(row.normScoreA * 100).toFixed(1)} /{' '}
                                {(row.normScoreB * 100).toFixed(1)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {planDiffAB?.scheduleAvailable ? (
                      <div>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
                          Production &amp; Inventory Comparison ({itemA.candidate.candidate_id} vs.{' '}
                          {itemB.candidate.candidate_id})
                        </h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                              <tr>
                                <th className="px-3 py-2">Product</th>
                                <th className="px-3 py-2">Period</th>
                                <th className="px-3 py-2 text-right">A Prod</th>
                                <th className="px-3 py-2 text-right">B Prod</th>
                                <th className="px-3 py-2 text-right">Prod &Delta;</th>
                                <th className="px-3 py-2 text-right">A Inv</th>
                                <th className="px-3 py-2 text-right">B Inv</th>
                                <th className="px-3 py-2 text-right">Inv &Delta;</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {planDiffAB.scheduleRows.map((row) => (
                                <tr key={`${row.product}-${row.period}`}>
                                  <td className="px-3 py-2 font-medium text-slate-900">
                                    {row.product}
                                  </td>
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
                                    {row.productionDelta > 0
                                      ? `+${row.productionDelta}`
                                      : row.productionDelta}
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
                                    {row.inventoryDelta > 0
                                      ? `+${row.inventoryDelta}`
                                      : row.inventoryDelta}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Detailed production schedule comparison is unavailable for the selected
                        plans.
                      </p>
                    )}

                    {planDiffAB?.utilizationAvailable && (
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
                                <th className="px-3 py-2 text-right">A Util</th>
                                <th className="px-3 py-2 text-right">B Util</th>
                                <th className="px-3 py-2 text-right">Util &Delta;</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {planDiffAB.utilizationRows.map((u) => (
                                <tr key={`${u.resource}-${u.period}`}>
                                  <td className="px-3 py-2 font-medium text-slate-900">
                                    {u.resource}
                                  </td>
                                  <td className="px-3 py-2 text-slate-700">{u.period}</td>
                                  <td className="px-3 py-2 text-right text-slate-600">
                                    {u.baselineUtilPct.toFixed(2)}%
                                  </td>
                                  <td className="px-3 py-2 text-right font-medium text-slate-900">
                                    {u.candidateUtilPct.toFixed(2)}%
                                  </td>
                                  <td className="px-3 py-2 text-right font-medium text-blue-700">
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

              {/* Scenario Management Transition */}
              <section
                aria-label="Scenario Management Transition"
                className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Manage Saved Model Scenarios
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">
                    These preference-weighted rankings are computed live for your current session and
                    are not automatically saved. Open Scenario Management to save, revisit, or rerun
                    baseline model scenarios and their datasets.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/scenarios')}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-xs transition-colors hover:bg-slate-100"
                >
                  <Layers className="h-3.5 w-3.5 text-blue-600" />
                  Open Scenario Management
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
};

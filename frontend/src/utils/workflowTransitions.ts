import type {
  DatasetSummary,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  TradeoffExploreResponse,
} from '../types/or';
import {
  type EligibleCandidatesResult,
  extractEligibleCandidates,
} from './decisionRecommendation';
import { checkBaselineConsistency } from './sensitivityAnalysis';

export interface DashboardHeroCta {
  label: string;
  to: string;
}

export interface DashboardHeroState {
  primaryCta: DashboardHeroCta;
  secondaryScenarioCta: DashboardHeroCta;
  showSampleProblemButton: boolean;
  showDatasetsAlternativeLink: boolean;
  baselineReady: boolean;
}

export function getDashboardHeroState(params: {
  dataset: DatasetSummary | null;
  mpMapping: MultiPeriodColumnMapping | null;
  mpSolution: MultiPeriodSolveResponse | null;
  mpIntegerProd: boolean;
  mpCapacityScope: 'auto' | 'per_product' | 'aggregate_period';
  mpSolutionMappingSignature: string | null;
}): DashboardHeroState {
  const baselineCheck = checkBaselineConsistency(params);

  const primaryCta: DashboardHeroCta = !params.dataset
    ? { label: 'Get Started', to: '/datasets' }
    : baselineCheck.ready
      ? { label: 'View Results', to: '/multi-period' }
      : { label: 'Configure Model', to: '/multi-period' };

  const secondaryScenarioCta: DashboardHeroCta = baselineCheck.ready
    ? { label: 'Open What-If Lab', to: '/what-if' }
    : { label: 'Scenario Library', to: '/scenarios' };

  return {
    primaryCta,
    secondaryScenarioCta,
    showSampleProblemButton: !params.dataset,
    showDatasetsAlternativeLink: Boolean(params.dataset),
    baselineReady: baselineCheck.ready,
  };
}

export interface DecisionIntelligenceNextStepLink {
  id: 'what-if' | 'sensitivity' | 'trade-offs' | 'recommendations' | 'datasets';
  label: string;
  to: string;
  primary: boolean;
}

export interface DecisionIntelligenceNextStepsState {
  links: DecisionIntelligenceNextStepLink[];
  unavailableNote: string | null;
}

export function getDecisionIntelligenceNextSteps(params: {
  dataset: DatasetSummary | null;
  mpMapping: MultiPeriodColumnMapping | null;
  mpSolution: MultiPeriodSolveResponse | null;
  mpIntegerProd: boolean;
  mpCapacityScope: 'auto' | 'per_product' | 'aggregate_period';
  mpSolutionMappingSignature: string | null;
  tradeoffResult: TradeoffExploreResponse | null;
  tradeoffMeta: Parameters<typeof extractEligibleCandidates>[0]['tradeoffMeta'];
  isLiveBaseline: boolean;
  isOptimal: boolean;
  constraintsFeasible: boolean;
}): DecisionIntelligenceNextStepsState {
  const effectiveBaseline = params.isLiveBaseline ? params.mpSolution : null;
  const baselineCheck = checkBaselineConsistency({
    dataset: params.dataset,
    mpMapping: params.mpMapping,
    mpSolution: effectiveBaseline,
    mpIntegerProd: params.mpIntegerProd,
    mpCapacityScope: params.mpCapacityScope,
    mpSolutionMappingSignature: params.mpSolutionMappingSignature,
  });

  const recCheck: EligibleCandidatesResult = extractEligibleCandidates({
    dataset: params.dataset,
    mpMapping: params.mpMapping,
    mpSolution: effectiveBaseline,
    mpIntegerProd: params.mpIntegerProd,
    mpCapacityScope: params.mpCapacityScope,
    mpSolutionMappingSignature: params.mpSolutionMappingSignature,
    tradeoffResult: params.isLiveBaseline ? params.tradeoffResult : null,
    tradeoffMeta: params.isLiveBaseline ? params.tradeoffMeta : null,
  });

  const links: DecisionIntelligenceNextStepLink[] = [];

  if (baselineCheck.ready) {
    links.push(
      {
        id: 'what-if',
        label: 'Explore Scenarios in What-If Lab',
        to: '/what-if',
        primary: true,
      },
      {
        id: 'sensitivity',
        label: 'Run Sensitivity Analysis',
        to: '/sensitivity',
        primary: false,
      },
      {
        id: 'trade-offs',
        label: 'Explore Trade-offs',
        to: '/trade-offs',
        primary: false,
      }
    );
    if (recCheck.ready) {
      links.push({
        id: 'recommendations',
        label: 'Rank & Compare Recommendations',
        to: '/recommendations',
        primary: false,
      });
    }
  }

  if (!params.dataset || !params.isOptimal || !params.constraintsFeasible) {
    links.push({
      id: 'datasets',
      label: 'Check Dataset Explorer',
      to: '/datasets',
      primary: false,
    });
  }

  const unavailableNote = baselineCheck.ready
    ? null
    : baselineCheck.reason;

  return { links, unavailableNote };
}

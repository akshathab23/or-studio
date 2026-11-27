import type {
  DatasetSummary,
  GoalProgrammingSolveResponse,
  MCDMSolveResponse,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  TradeoffExploreResponse,
} from '../types/or';
import { extractEligibleCandidates } from './decisionRecommendation';
import { checkBaselineConsistency } from './sensitivityAnalysis';

export type NavIconKey =
  | 'dashboard'
  | 'datasets'
  | 'multi-period'
  | 'goal-programming'
  | 'mcdm'
  | 'what-if'
  | 'sensitivity'
  | 'trade-offs'
  | 'recommendations'
  | 'scenarios'
  | 'history';

export interface NavItem {
  to: string;
  label: string;
  subtitle?: string;
  iconKey: NavIconKey;
  description: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      {
        to: '/',
        label: 'Dashboard',
        iconKey: 'dashboard',
        description: 'Platform overview and workflow entry points',
      },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    items: [
      {
        to: '/datasets',
        label: 'Dataset Explorer',
        iconKey: 'datasets',
        description: 'Upload, inspect, and manage active datasets',
      },
    ],
  },
  {
    id: 'optimization',
    label: 'Optimization',
    items: [
      {
        to: '/multi-period',
        label: 'Multi-Period Optimization',
        iconKey: 'multi-period',
        description: 'Configure and solve multi-period production planning',
      },
      {
        to: '/goal-programming',
        label: 'Goal Programming',
        iconKey: 'goal-programming',
        description: 'Weighted and lexicographic multi-goal optimization',
      },
      {
        to: '/mcdm',
        label: 'MCDM',
        subtitle: 'Multi-Criteria Decision Making',
        iconKey: 'mcdm',
        description: 'Multi-Criteria Decision Making (TOPSIS & WSM alternative ranking)',
      },
    ],
  },
  {
    id: 'decision-analysis',
    label: 'Decision Analysis',
    items: [
      {
        to: '/what-if',
        label: 'What-If Lab',
        iconKey: 'what-if',
        description: 'Compare baseline and modified parameter runs',
      },
      {
        to: '/sensitivity',
        label: 'Sensitivity Analysis',
        iconKey: 'sensitivity',
        description: 'Sweep key parameters and inspect solution stability',
      },
      {
        to: '/trade-offs',
        label: 'Trade-off Explorer',
        iconKey: 'trade-offs',
        description: 'Generate non-dominated Pareto trade-off candidates',
      },
      {
        to: '/recommendations',
        label: 'Decision Recommendation',
        iconKey: 'recommendations',
        description: 'Rank trade-off options by decision profile',
      },
    ],
  },
  {
    id: 'library-history',
    label: 'Library & History',
    items: [
      {
        to: '/scenarios',
        label: 'Scenario Management',
        iconKey: 'scenarios',
        description: 'Save, inspect, rerun, and re-attach scenarios',
      },
      {
        to: '/history',
        label: 'Solution History',
        iconKey: 'history',
        description: 'Review optimization runs from the current session',
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export interface ActiveNavigationContext {
  group: NavGroup;
  item: NavItem;
}

export function findActiveNavigationContext(pathname: string): ActiveNavigationContext | null {
  const normalized = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.to === '/') {
        if (normalized === '/') {
          return { group, item };
        }
      } else if (normalized === item.to || normalized.startsWith(`${item.to}/`)) {
        return { group, item };
      }
    }
  }
  return null;
}

export type NavReadinessStatus = 'ready' | 'needs-input' | 'neutral';

export interface NavReadinessInfo {
  status: NavReadinessStatus;
  label: string;
}

export interface NavigationReadinessInput {
  dataset: DatasetSummary | null;
  mpMapping: MultiPeriodColumnMapping | null;
  mpSolution: MultiPeriodSolveResponse | null;
  mpIntegerProd: boolean;
  mpCapacityScope: 'auto' | 'per_product' | 'aggregate_period';
  mpSolutionMappingSignature: string | null;
  tradeoffResult: TradeoffExploreResponse | null;
  tradeoffMeta: Parameters<typeof extractEligibleCandidates>[0]['tradeoffMeta'];
  gpSolution: GoalProgrammingSolveResponse | null;
  mcdmSolution: MCDMSolveResponse | null;
  historyCount: number;
}

export function computeNavigationReadiness(
  input: NavigationReadinessInput
): Record<string, NavReadinessInfo> {
  const baselineCheck = checkBaselineConsistency({
    dataset: input.dataset,
    mpMapping: input.mpMapping,
    mpSolution: input.mpSolution,
    mpIntegerProd: input.mpIntegerProd,
    mpCapacityScope: input.mpCapacityScope,
    mpSolutionMappingSignature: input.mpSolutionMappingSignature,
  });

  const eligibleCheck = extractEligibleCandidates({
    dataset: input.dataset,
    mpMapping: input.mpMapping,
    mpSolution: input.mpSolution,
    mpIntegerProd: input.mpIntegerProd,
    mpCapacityScope: input.mpCapacityScope,
    mpSolutionMappingSignature: input.mpSolutionMappingSignature,
    tradeoffResult: input.tradeoffResult,
    tradeoffMeta: input.tradeoffMeta,
  });

  return {
    '/': { status: 'neutral', label: '' },
    '/datasets': input.dataset
      ? { status: 'ready', label: 'Active dataset loaded' }
      : { status: 'needs-input', label: 'No active dataset loaded' },
    '/multi-period': baselineCheck.ready
      ? { status: 'ready', label: 'Baseline solution active' }
      : input.dataset
        ? { status: 'neutral', label: 'Dataset ready for modeling' }
        : { status: 'needs-input', label: 'Requires active dataset' },
    '/goal-programming': input.gpSolution
      ? { status: 'ready', label: 'Solution available' }
      : input.dataset
        ? { status: 'neutral', label: 'Dataset ready' }
        : { status: 'needs-input', label: 'Requires active dataset' },
    '/mcdm': input.mcdmSolution
      ? { status: 'ready', label: 'Ranking available' }
      : input.dataset
        ? { status: 'neutral', label: 'Dataset ready' }
        : { status: 'needs-input', label: 'Requires active dataset' },
    '/what-if': baselineCheck.ready
      ? { status: 'ready', label: 'Baseline solution ready' }
      : { status: 'needs-input', label: 'Requires solved baseline model' },
    '/sensitivity': baselineCheck.ready
      ? { status: 'ready', label: 'Baseline solution ready' }
      : { status: 'needs-input', label: 'Requires solved baseline model' },
    '/trade-offs': baselineCheck.ready
      ? { status: 'ready', label: 'Baseline solution ready' }
      : { status: 'needs-input', label: 'Requires solved baseline model' },
    '/recommendations': eligibleCheck.ready
      ? { status: 'ready', label: 'Recommendation candidates ready' }
      : { status: 'needs-input', label: 'Requires trade-off exploration results' },
    '/scenarios': { status: 'neutral', label: '' },
    '/history':
      input.historyCount > 0
        ? { status: 'ready', label: `${input.historyCount} session run${input.historyCount === 1 ? '' : 's'}` }
        : { status: 'neutral', label: 'No runs recorded yet' },
  };
}

export type BackendHealthStatus = 'checking' | 'connected' | 'unavailable';

export interface BackendHealthPresentation {
  status: BackendHealthStatus;
  label: string;
  detail: string;
  dotClass: string;
  badgeClass: string;
}

export function getBackendHealthPresentation(
  status: BackendHealthStatus
): BackendHealthPresentation {
  switch (status) {
    case 'connected':
      return {
        status,
        label: 'Backend Connected',
        detail: 'API and solver engine reachable',
        dotClass: 'bg-emerald-500',
        badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      };
    case 'unavailable':
      return {
        status,
        label: 'Backend Unavailable',
        detail: 'Unable to reach /api/health',
        dotClass: 'bg-rose-500',
        badgeClass: 'border-rose-200 bg-rose-50 text-rose-700',
      };
    case 'checking':
    default:
      return {
        status: 'checking',
        label: 'Checking Connection',
        detail: 'Verifying backend API connectivity',
        dotClass: 'bg-amber-400 animate-pulse',
        badgeClass: 'border-amber-200 bg-amber-50 text-amber-700',
      };
  }
}

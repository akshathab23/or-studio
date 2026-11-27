import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  Award,
  Database,
  FileSpreadsheet,
  FlaskConical,
  GitCompareArrows,
  History,
  Layers,
  LayoutDashboard,
  Menu,
  Scale,
  SlidersHorizontal,
  Target,
  X,
} from 'lucide-react';
import { checkBackendHealth, isRequestCancelledError } from '../api/client';
import { useStudio } from '../context/StudioContext';
import type { DatasetSummary } from '../types/or';
import {
  type BackendHealthStatus,
  NAV_GROUPS,
  type NavIconKey,
  type NavReadinessInfo,
  computeNavigationReadiness,
  findActiveNavigationContext,
  getBackendHealthPresentation,
} from '../utils/navigation';

const NAV_ICON_MAP: Record<NavIconKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  datasets: Database,
  'multi-period': Activity,
  'goal-programming': Target,
  mcdm: Scale,
  'what-if': FlaskConical,
  sensitivity: SlidersHorizontal,
  'trade-offs': GitCompareArrows,
  recommendations: Award,
  scenarios: Layers,
  history: History,
};

function renderReadinessDot(readiness: NavReadinessInfo | undefined) {
  if (!readiness || readiness.status === 'neutral') {
    return null;
  }
  const dotColor =
    readiness.status === 'ready'
      ? 'bg-emerald-400'
      : 'bg-slate-600';

  return (
    <span
      className={`ml-auto w-2 h-2 rounded-full shrink-0 ${dotColor}`}
      title={readiness.label}
      aria-label={readiness.label}
    />
  );
}

export interface LayoutShellProps {
  pathname: string;
  healthStatus: BackendHealthStatus;
  readinessByRoute: Record<string, NavReadinessInfo>;
  dataset: DatasetSummary | null;
  mobileOpen: boolean;
  onOpenMobile: () => void;
  onCloseMobile: () => void;
  children: React.ReactNode;
}

export const LayoutShell: React.FC<LayoutShellProps> = ({
  pathname,
  healthStatus,
  readinessByRoute,
  dataset,
  mobileOpen,
  onOpenMobile,
  onCloseMobile,
  children,
}) => {
  const activeContext = findActiveNavigationContext(pathname);
  const health = getBackendHealthPresentation(healthStatus);

  const renderNavContent = (onItemClick?: () => void) => (
    <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto" aria-label="Primary navigation">
      {NAV_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {group.label}
          </div>
          <div className="space-y-1">
            {group.items.map((item) => {
              const Icon = NAV_ICON_MAP[item.iconKey];
              const readiness = readinessByRoute[item.to];
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onItemClick}
                  title={item.description}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        {item.subtitle && (
                          <span
                            className={`block truncate text-[10px] font-normal leading-tight ${
                              isActive ? 'text-indigo-100' : 'text-slate-400'
                            }`}
                          >
                            {item.subtitle}
                          </span>
                        )}
                      </span>
                      {renderReadinessDot(readiness)}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const renderDatasetFooter = () =>
    dataset ? (
      <div className="p-3 border-t border-slate-800 bg-slate-950/60">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="uppercase tracking-wider font-semibold">Active Dataset</span>
        </div>
        <p className="text-xs font-medium text-slate-100 truncate" title={dataset.filename}>
          {dataset.filename}
        </p>
        <p className="text-[11px] text-slate-400">
          {dataset.row_count} rows × {dataset.column_count} cols
        </p>
      </div>
    ) : null;

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-64 md:fixed md:inset-y-0 bg-slate-900 text-slate-100 border-r border-slate-800">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center font-bold text-white shadow-sm">
            OR
          </div>
          <div>
            <div className="font-semibold text-sm tracking-tight">OR Studio</div>
            <div className="text-[11px] text-slate-400">Operations Research Workbench</div>
          </div>
        </div>

        {renderNavContent()}
        {renderDatasetFooter()}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="fixed inset-0 bg-slate-950/60" onClick={onCloseMobile} />
          <aside className="relative w-72 max-w-[85vw] bg-slate-900 text-slate-100 flex flex-col z-50 h-full">
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-indigo-500 flex items-center justify-center font-bold text-xs text-white">
                  OR
                </div>
                <span className="font-semibold text-sm">OR Studio</span>
              </div>
              <button
                type="button"
                onClick={onCloseMobile}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderNavContent(onCloseMobile)}
            {renderDatasetFooter()}
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200 px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onOpenMobile}
              className="md:hidden p-1.5 rounded-md text-slate-600 hover:bg-slate-100 shrink-0"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 min-w-0">
              {activeContext ? (
                <>
                  <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-medium shrink-0">
                    {activeContext.group.label}
                  </span>
                  <span className="hidden sm:inline text-slate-300 text-xs">/</span>
                  <span className="text-sm font-semibold text-slate-800 truncate">
                    {activeContext.item.label}
                  </span>
                </>
              ) : (
                <span className="text-sm font-medium text-slate-600 truncate">
                  Operations Research Decision-Support Platform
                </span>
              )}
            </div>
          </div>

          <div
            role="status"
            aria-live="polite"
            title={health.detail}
            className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-medium shrink-0 ${health.badgeClass}`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${health.dotClass}`} />
            <span>{health.label}</span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const {
    dataset,
    mpMapping,
    mpCapacityScope,
    mpIntegerProd,
    mpSolution,
    mpSolutionMappingSignature,
    tradeoffResult,
    tradeoffMeta,
    gpSolution,
    mcdmSolution,
    history,
  } = useStudio();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [healthStatus, setHealthStatus] = useState<BackendHealthStatus>('checking');

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    setHealthStatus('checking');
    checkBackendHealth({ signal: controller.signal })
      .then(() => {
        if (active && !controller.signal.aborted) {
          setHealthStatus('connected');
        }
      })
      .catch((err) => {
        if (!active || controller.signal.aborted || isRequestCancelledError(err)) {
          return;
        }
        setHealthStatus('unavailable');
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const readinessByRoute = useMemo(
    () =>
      computeNavigationReadiness({
        dataset,
        mpMapping,
        mpSolution,
        mpIntegerProd,
        mpCapacityScope,
        mpSolutionMappingSignature,
        tradeoffResult,
        tradeoffMeta,
        gpSolution,
        mcdmSolution,
        historyCount: history.length,
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
      gpSolution,
      mcdmSolution,
      history.length,
    ]
  );

  return (
    <LayoutShell
      pathname={location.pathname}
      healthStatus={healthStatus}
      readinessByRoute={readinessByRoute}
      dataset={dataset}
      mobileOpen={mobileOpen}
      onOpenMobile={() => setMobileOpen(true)}
      onCloseMobile={() => setMobileOpen(false)}
    >
      {children}
    </LayoutShell>
  );
};

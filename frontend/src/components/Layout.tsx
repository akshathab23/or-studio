import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Activity,
  Database,
  FileSpreadsheet,
  FlaskConical,
  History,
  LayoutDashboard,
  Menu,
  Scale,
  Target,
  X,
} from 'lucide-react';
import { useStudio } from '../context/StudioContext';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/multi-period', label: 'Multi-Period Optimization', icon: Activity },
  { to: '/goal-programming', label: 'Goal Programming', icon: Target },
  { to: '/mcdm', label: 'MCDM', icon: Scale },
  { to: '/what-if', label: 'What-If Lab', icon: FlaskConical },
  { to: '/datasets', label: 'Dataset Explorer', icon: Database },
  { to: '/history', label: 'Solution History', icon: History },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { dataset } = useStudio();

  const SidebarContent = (
    <div className="flex h-full flex-col bg-white border-r border-slate-200">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white font-semibold text-sm shadow-xs">
          OR
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-slate-900">OR Studio</div>
          <div className="text-[11px] font-medium text-slate-500">Operations Research Solver</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Active Dataset
          </div>
          {dataset ? (
            <div className="mt-1.5 flex items-start gap-2">
              <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900">
                  {dataset.filename}
                </div>
                <div className="text-[11px] text-slate-500">
                  {dataset.row_count.toLocaleString()} rows · {dataset.column_count} cols
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-xs text-slate-500">No dataset loaded</div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 lg:block">{SidebarContent}</aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative z-10 w-64 max-w-[80vw]">{SidebarContent}</div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
            className="relative z-10 ml-2 mt-3 flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 shadow-md"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-xs lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-semibold text-slate-900 lg:hidden">OR Studio</span>
            <span className="hidden text-xs font-medium text-slate-500 lg:inline">
              Interactive Mathematical Optimization & Decision Analysis
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              PuLP CBC Engine
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
};

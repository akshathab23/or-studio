import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  History,
  Info,
  Layers,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useStudio } from '../context/StudioContext';

export const SolutionHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { history, clearHistory } = useStudio();
  const [confirmClear, setConfirmClear] = useState(false);

  const handleExportJson = (item: (typeof history)[number]) => {
    const blob = new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `or-studio-${item.module}-${item.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <History className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900">Solution History</h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Browser-local audit log of solver runs across Multi-Period, Goal Programming, and MCDM.
          </p>
        </div>

        {history.length > 0 && (
          !confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear History
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  clearHistory();
                  setConfirmClear(false);
                }}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Confirm Clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          )
        )}
      </div>

      {/* Distinction from Scenario Management */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-xs text-slate-700">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <div>
            <span className="font-semibold text-slate-900">
              Session Log vs. Persistent Scenarios:
            </span>{' '}
            Solution History is a browser-local audit log across all solvers. To persistently save,
            restore, re-optimize, and compare Multi-Period models on the backend, use{' '}
            <span className="font-semibold text-slate-900">Scenario Management</span>.
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/scenarios')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
        >
          <Layers className="h-3.5 w-3.5" />
          Open Scenario Management
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {history.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-xs">
          <p className="text-sm font-medium text-slate-700">No solved models in history yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Results from Multi-Period Optimization, Goal Programming, and MCDM will appear here
            automatically after solving.
          </p>
          <button
            type="button"
            onClick={() => navigate('/multi-period')}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Start with Multi-Period Optimization
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {item.isOptimal ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 [overflow-wrap:anywhere]">
                      {item.title}
                    </span>
                    <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium uppercase text-slate-600">
                      {item.module}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        item.isOptimal
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">
                    {new Date(item.timestamp).toLocaleString()}
                    {item.datasetName ? ` · Dataset: ${item.datasetName}` : ''}
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-700 [overflow-wrap:anywhere]">
                    {item.objectiveSummary}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleExportJson(item)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Export JSON
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

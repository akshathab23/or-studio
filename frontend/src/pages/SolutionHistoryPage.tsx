import React from 'react';
import { CheckCircle2, Download, History, Trash2, XCircle } from 'lucide-react';
import { useStudio } from '../context/StudioContext';

export const SolutionHistoryPage: React.FC = () => {
  const { history, clearHistory } = useStudio();

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
            Audit log of all real optimization runs executed in OR Studio.
          </p>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={clearHistory}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear History
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-xs">
          <p className="text-sm font-medium text-slate-700">No solved models in history yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Results from Multi-Period Optimization, Goal Programming, and MCDM will appear here
            automatically after solving.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
            >
              <div className="flex items-start gap-3">
                {item.isOptimal ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{item.title}</span>
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
                  <div className="mt-1 text-xs text-slate-500">
                    {new Date(item.timestamp).toLocaleString()}
                    {item.datasetName ? ` · Dataset: ${item.datasetName}` : ''}
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-700">
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

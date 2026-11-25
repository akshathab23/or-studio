import React from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Trash2 } from 'lucide-react';
import type { DatasetSummary } from '../types/or';

interface DatasetPreviewProps {
  dataset: DatasetSummary;
  onSelectSheet: (sheetName: string) => Promise<void>;
  onRemoveDataset: () => Promise<void>;
  loading: boolean;
}

export const DatasetPreview: React.FC<DatasetPreviewProps> = ({
  dataset,
  onSelectSheet,
  onRemoveDataset,
  loading,
}) => {
  const totalMissing = dataset.columns.reduce((acc, c) => acc + c.missing_count, 0);

  return (
    <div className="space-y-6">
      {/* Header Metadata Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">{dataset.filename}</h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span className="uppercase font-mono">{dataset.file_type}</span>
                <span>•</span>
                <span>{dataset.row_count.toLocaleString()} rows</span>
                <span>•</span>
                <span>{dataset.column_count} columns</span>
                <span>•</span>
                {totalMissing > 0 ? (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {totalMissing.toLocaleString()} missing cell(s)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    No missing values
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {dataset.file_type === 'xlsx' && dataset.sheets.length > 0 && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="sheet-select"
                  className="text-xs font-medium text-slate-600"
                >
                  Sheet:
                </label>
                <select
                  id="sheet-select"
                  disabled={loading}
                  value={dataset.active_sheet ?? ''}
                  onChange={(e) => void onSelectSheet(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                >
                  {dataset.sheets.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              disabled={loading}
              onClick={() => void onRemoveDataset()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove Dataset
            </button>
          </div>
        </div>
      </div>

      {/* Column Profiles & Statistics */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h4 className="text-sm font-semibold text-slate-900">
            Column Schema, Data Types & Missing Values
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Column</th>
                <th className="px-4 py-2.5 font-semibold">Detected Type</th>
                <th className="px-4 py-2.5 font-semibold">Missing</th>
                <th className="px-4 py-2.5 font-semibold">Unique</th>
                <th className="px-4 py-2.5 font-semibold">Min</th>
                <th className="px-4 py-2.5 font-semibold">Max</th>
                <th className="px-4 py-2.5 font-semibold">Mean</th>
                <th className="px-4 py-2.5 font-semibold">Std Dev</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dataset.columns.map((col) => (
                <tr key={col.name} className="hover:bg-slate-50/70">
                  <td className="px-4 py-2.5 font-medium text-slate-900">{col.name}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-700">
                      {col.inferred_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {col.missing_count > 0 ? (
                      <span className="font-medium text-amber-700">
                        {col.missing_count} ({col.missing_percentage}%)
                      </span>
                    ) : (
                      <span className="text-slate-500">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-600">{col.unique_count}</td>
                  <td className="px-4 py-2.5 font-mono text-slate-700">
                    {col.stats?.min !== null && col.stats?.min !== undefined ? col.stats.min : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-700">
                    {col.stats?.max !== null && col.stats?.max !== undefined ? col.stats.max : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-700">
                    {col.stats?.mean !== null && col.stats?.mean !== undefined
                      ? col.stats.mean
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-slate-700">
                    {col.stats?.std !== null && col.stats?.std !== undefined ? col.stats.std : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Data Table Preview */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h4 className="text-sm font-semibold text-slate-900">
            Data Preview (first {Math.min(dataset.preview_rows.length, dataset.row_count)} of{' '}
            {dataset.row_count.toLocaleString()} rows)
          </h4>
        </div>
        {dataset.preview_rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            This sheet contains 0 rows.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[420px]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 font-semibold text-slate-400">#</th>
                  {dataset.columns.map((c) => (
                    <th key={c.name} className="whitespace-nowrap px-4 py-2 font-semibold">
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dataset.preview_rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2 font-mono text-slate-400">{idx + 1}</td>
                    {dataset.columns.map((c) => {
                      const val = row[c.name];
                      return (
                        <td
                          key={c.name}
                          className="whitespace-nowrap px-4 py-2 text-slate-700"
                        >
                          {val === null || val === undefined ? (
                            <span className="italic text-amber-600">null</span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

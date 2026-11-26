import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  FileSpreadsheet,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { DatasetSummary } from '../types/or';

interface DatasetPreviewProps {
  dataset: DatasetSummary;
  onSelectSheet: (sheetName: string) => Promise<void>;
  onRemoveDataset: () => Promise<void>;
  loading: boolean;
}

type SortDir = 'asc' | 'desc' | null;
type SortState = { col: string; dir: SortDir };

export const DatasetPreview: React.FC<DatasetPreviewProps> = ({
  dataset,
  onSelectSheet,
  onRemoveDataset,
  loading,
}) => {
  const totalMissing = dataset.columns.reduce((acc, c) => acc + c.missing_count, 0);

  // ── Search / filter / sort state ─────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ col: '', dir: null });
  const [filterCol, setFilterCol] = useState('');
  const [filterValue, setFilterValue] = useState('');

  const toggleSort = (col: string) => {
    setSort((prev) => {
      if (prev.col !== col) return { col, dir: 'asc' };
      if (prev.dir === 'asc') return { col, dir: 'desc' };
      if (prev.dir === 'desc') return { col: '', dir: null };
      return { col, dir: 'asc' };
    });
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sort.col !== col) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    if (sort.dir === 'asc') return <ArrowUp className="h-3 w-3 text-blue-600" />;
    return <ArrowDown className="h-3 w-3 text-blue-600" />;
  };

  // ── Derived preview rows (search + filter + sort) ─────────────────────────
  const processedRows = useMemo(() => {
    let rows = [...dataset.preview_rows];

    // Global search
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((row) =>
        Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q))
      );
    }

    // Column filter
    if (filterCol && filterValue.trim()) {
      const q = filterValue.toLowerCase();
      rows = rows.filter((row) =>
        String(row[filterCol] ?? '').toLowerCase().includes(q)
      );
    }

    // Sort (missing values null/undefined/empty always placed last, never coerced to 0)
    if (sort.col && sort.dir) {
      rows.sort((a, b) => {
        const av = a[sort.col];
        const bv = b[sort.col];
        const aMissing = av === null || av === undefined || String(av).trim() === '';
        const bMissing = bv === null || bv === undefined || String(bv).trim() === '';
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;

        const an = Number(av);
        const bn = Number(bv);
        const numeric = Number.isFinite(an) && Number.isFinite(bn);
        const cmp = numeric
          ? an - bn
          : String(av).localeCompare(String(bv));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }

    return rows;
  }, [dataset.preview_rows, search, filterCol, filterValue, sort]);

  const clearFilters = () => {
    setSearch('');
    setFilterCol('');
    setFilterValue('');
    setSort({ col: '', dir: null });
  };

  const hasActiveFilters =
    search.trim() || filterCol || filterValue.trim() || sort.col;

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
                <span className="font-mono uppercase">{dataset.file_type}</span>
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
                <label htmlFor="sheet-select" className="text-xs font-medium text-slate-600">
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

        {/* Dataset quality summary */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Rows', value: dataset.row_count.toLocaleString(), ok: true },
            { label: 'Columns', value: String(dataset.column_count), ok: true },
            {
              label: 'Missing Cells',
              value: totalMissing.toLocaleString(),
              ok: totalMissing === 0,
            },
            {
              label: 'Data Quality',
              value: totalMissing === 0 ? 'Clean' : 'Has Gaps',
              ok: totalMissing === 0,
            },
          ].map(({ label, value, ok }) => (
            <div
              key={label}
              className={`rounded-lg border p-3 ${
                ok ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {label}
              </div>
              <div
                className={`mt-1 font-mono text-sm font-bold ${
                  ok ? 'text-emerald-800' : 'text-amber-800'
                }`}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Column Schema */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h4 className="text-sm font-semibold text-slate-900">
            Column Schema, Data Types &amp; Statistics
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Column</th>
                <th className="px-4 py-2.5 font-semibold">Type</th>
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
                  <td className="px-4 py-2.5 font-semibold text-slate-900">{col.name}</td>
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

      {/* Data Table Preview with Search/Filter/Sort */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-900">
              Data Preview
              <span className="ml-2 text-xs font-normal text-slate-400">
                {processedRows.length === dataset.preview_rows.length
                  ? `${dataset.preview_rows.length} of ${dataset.row_count.toLocaleString()} rows`
                  : `${processedRows.length} of ${dataset.preview_rows.length} preview rows (filtered)`}
              </span>
            </h4>

            <div className="flex flex-wrap items-center gap-2">
              {/* Global search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search rows…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-36 rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs focus:border-blue-400 focus:outline-none sm:w-48"
                />
              </div>

              {/* Column filter */}
              <select
                value={filterCol}
                onChange={(e) => setFilterCol(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
              >
                <option value="">Filter column…</option>
                {dataset.columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>

              {filterCol && (
                <input
                  type="text"
                  placeholder={`Contains…`}
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs focus:border-blue-400 focus:outline-none"
                />
              )}

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {dataset.preview_rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            This sheet contains 0 rows.
          </div>
        ) : processedRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No rows match the current filter.
            <button
              type="button"
              onClick={clearFilters}
              className="ml-2 font-semibold text-blue-600 hover:text-blue-700"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-semibold text-slate-400">#</th>
                  {dataset.columns.map((c) => (
                    <th key={c.name} className="whitespace-nowrap px-4 py-2">
                      <button
                        type="button"
                        onClick={() => toggleSort(c.name)}
                        className="inline-flex items-center gap-1 font-semibold hover:text-blue-600"
                      >
                        {c.name}
                        <SortIcon col={c.name} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {processedRows.map((row, idx) => (
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

        {dataset.row_count > dataset.preview_rows.length && (
          <div className="border-t border-slate-100 px-5 py-2.5 text-center text-xs text-slate-400">
            Preview shows first {dataset.preview_rows.length} of{' '}
            {dataset.row_count.toLocaleString()} rows. Full data is processed server-side.
          </div>
        )}
      </div>
    </div>
  );
};

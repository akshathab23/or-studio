import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CloudDownload,
  ExternalLink,
  Info,
  Loader2,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import {
  fetchPublicDatasets,
  importPublicDataset,
  solveMultiPeriod,
  validateMultiPeriodMapping,
} from '../api/client';
import { useStudio } from '../context/StudioContext';
import type {
  PublicDatasetCatalogItem,
  PublicDatasetImportRequest,
} from '../types/or';

export const PublicDatasetImporter: React.FC = () => {
  const navigate = useNavigate();
  const {
    setDataset,
    publicImport,
    setPublicImport,
    setMpMapping,
    setMpCapacityScope,
    setMpSolution,
    addHistoryItem,
  } = useStudio();

  const [catalog, setCatalog] = useState<PublicDatasetCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<'uci_online_retail'>('uci_online_retail');

  const [config, setConfig] = useState<PublicDatasetImportRequest>({
    source_id: 'uci_online_retail',
    aggregation_period: 'monthly',
    max_products: 10,
    max_periods: 12,
    capacity_buffer_pct: 20,
    include_production_cost: true,
    production_cost_ratio: 0.6,
    include_inventory_cost: true,
    inventory_cost_ratio: 0.05,
    include_initial_inventory: false,
    initial_inventory_units: 0,
  });

  const [importing, setImporting] = useState(false);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let active = true;
    fetchPublicDatasets()
      .then((items) => {
        if (active) {
          setCatalog(items);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Failed to load public dataset catalog.');
        }
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedEntry = catalog.find((c) => c.id === selectedId) ?? catalog[0] ?? null;

  const handleImport = async () => {
    if (inFlightRef.current || importing) return;
    inFlightRef.current = true;
    setImporting(true);
    setError(null);
    try {
      const res = await importPublicDataset({ ...config, source_id: selectedId });
      setPublicImport(res);
      setDataset(res.dataset);
      setMpMapping(res.suggested_mapping);
      setMpCapacityScope(res.suggested_capacity_scope);
      setMpSolution(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import public dataset.');
    } finally {
      setImporting(false);
      inFlightRef.current = false;
    }
  };

  const handleSolveDirectly = async () => {
    if (!publicImport || solving) return;
    setSolving(true);
    setError(null);
    try {
      const val = await validateMultiPeriodMapping(
        publicImport.dataset.dataset_id,
        publicImport.suggested_mapping
      );
      if (!val.valid) {
        const msg = val.issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.message)
          .join('; ');
        setError(`Prepared dataset validation failed: ${msg}`);
        setSolving(false);
        return;
      }
      const sol = await solveMultiPeriod(
        publicImport.dataset.dataset_id,
        publicImport.suggested_mapping,
        false,
        publicImport.suggested_capacity_scope
      );
      setMpSolution(sol);
      addHistoryItem({
        module: 'multi-period',
        title: `Multi-Period (${publicImport.catalog_entry.name})`,
        status: sol.status,
        isOptimal: sol.is_optimal,
        objectiveSummary:
          sol.is_optimal && sol.objective_value !== null
            ? `Obj = ${sol.objective_value.toLocaleString()}`
            : `Status: ${sol.status}`,
        datasetName: publicImport.dataset.filename,
        payload: sol,
      });
      navigate('/multi-period');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to solve prepared dataset.');
    } finally {
      setSolving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Catalog Selection Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CloudDownload className="h-5 w-5 text-blue-600" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Real-World Public Dataset Catalog
              </h2>
              <p className="text-xs text-slate-500">
                Fetch, clean, and prepare real historical datasets for Multi-Period Optimization.
              </p>
            </div>
          </div>
          {catalogLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
        </div>

        {selectedEntry && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value as 'uci_online_retail')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  {catalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} — {item.source}
                    </option>
                  ))}
                </select>
              </div>
              <a
                href={selectedEntry.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
              >
                Official UCI Page
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <p className="text-xs leading-relaxed text-slate-700">{selectedEntry.description}</p>

            <div className="grid grid-cols-1 gap-2 pt-1 text-xs text-slate-600 sm:grid-cols-3">
              <div>
                <span className="font-semibold text-slate-800">Size:</span>{' '}
                {selectedEntry.approximate_size}
              </div>
              <div>
                <span className="font-semibold text-slate-800">Data Period:</span>{' '}
                {selectedEntry.data_period}
              </div>
              <div>
                <span className="font-semibold text-slate-800">License:</span>{' '}
                {selectedEntry.license}
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2 text-[11px] text-slate-700">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
              <div>
                <span>{selectedEntry.disclaimer}</span>{' '}
                <span className="text-slate-500">Citation: {selectedEntry.citation}</span>
              </div>
            </div>
          </div>
        )}

        {/* Preprocessing & Assumptions Configuration */}
        <div className="border-t border-slate-100 pt-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Preprocessing & Optimization Assumptions
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Aggregation Period
              </label>
              <select
                value={config.aggregation_period}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    aggregation_period: e.target.value as 'monthly' | 'weekly' | 'quarterly',
                  }))
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800"
              >
                <option value="monthly">Monthly (Default)</option>
                <option value="weekly">Weekly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Max Products (Top by Demand)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={config.max_products}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    max_products: Math.min(50, Math.max(1, Number(e.target.value) || 1)),
                  }))
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-800"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Max Periods
              </label>
              <input
                type="number"
                min={1}
                max={24}
                value={config.max_periods}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    max_periods: Math.min(24, Math.max(1, Number(e.target.value) || 1)),
                  }))
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-800"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Estimated Capacity Buffer (%)
              </label>
              <input
                type="number"
                min={0}
                max={500}
                step={5}
                value={config.capacity_buffer_pct}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    capacity_buffer_pct: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-800"
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs">
              <span className="flex items-center gap-2 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={config.include_production_cost}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      include_production_cost: e.target.checked,
                    }))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                />
                Assumed Prod. Cost (% price)
              </span>
              <input
                type="number"
                step={5}
                min={0}
                max={500}
                disabled={!config.include_production_cost}
                value={Math.round(config.production_cost_ratio * 100)}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    production_cost_ratio: Math.max(0, Number(e.target.value) / 100),
                  }))
                }
                className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs disabled:opacity-50"
              />
            </label>

            <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs">
              <span className="flex items-center gap-2 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={config.include_inventory_cost}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      include_inventory_cost: e.target.checked,
                    }))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                />
                Assumed Inv. Cost (% price)
              </span>
              <input
                type="number"
                step={1}
                min={0}
                max={200}
                disabled={!config.include_inventory_cost}
                value={Math.round(config.inventory_cost_ratio * 100)}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    inventory_cost_ratio: Math.max(0, Number(e.target.value) / 100),
                  }))
                }
                className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs disabled:opacity-50"
              />
            </label>

            <label className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs">
              <span className="flex items-center gap-2 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={config.include_initial_inventory}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      include_initial_inventory: e.target.checked,
                    }))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                />
                Initial Inventory (units)
              </span>
              <input
                type="number"
                min={0}
                disabled={!config.include_initial_inventory}
                value={config.initial_inventory_units}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    initial_inventory_units: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-xs disabled:opacity-50"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            disabled={importing || catalogLoading}
            onClick={() => void handleImport()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CloudDownload className="h-4 w-4" />
            )}
            {importing ? 'Downloading & Preprocessing...' : 'Import & Prepare Dataset'}
          </button>

          {publicImport && (
            <>
              <button
                type="button"
                disabled={solving || importing}
                onClick={() => void handleSolveDirectly()}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-600 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                {solving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Solve Multi-Period Model
              </button>
              <button
                type="button"
                onClick={() => navigate('/multi-period')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Review Mappings
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Preprocessing & Assumptions Transparency Report */}
      {publicImport && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Preprocessing Report ({publicImport.preprocessing_report.aggregation_period})
              </h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 className="h-3 w-3" />
                {publicImport.preprocessing_report.cached_source_used ? 'Cached Source' : 'Fresh Download'}
              </span>
            </div>
            <dl className="divide-y divide-slate-100 text-xs">
              {[
                ['Raw Transactions', publicImport.preprocessing_report.raw_row_count.toLocaleString()],
                ['Cancelled Invoices Removed (C*)', publicImport.preprocessing_report.cancelled_invoices_removed.toLocaleString()],
                ['Non-Positive Quantity Removed', publicImport.preprocessing_report.non_positive_quantity_removed.toLocaleString()],
                ['Invalid UnitPrice Removed', publicImport.preprocessing_report.invalid_price_removed.toLocaleString()],
                ['Missing StockCode Removed', publicImport.preprocessing_report.missing_stockcode_removed.toLocaleString()],
                ['Invalid InvoiceDate Removed', publicImport.preprocessing_report.invalid_date_removed.toLocaleString()],
                ['Clean Valid Transactions', publicImport.preprocessing_report.clean_row_count.toLocaleString()],
                [
                  'Prepared Grid',
                  `${publicImport.preprocessing_report.products_selected} products × ${publicImport.preprocessing_report.periods_created} periods (${publicImport.preprocessing_report.prepared_row_count} rows)`,
                ],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-1.5">
                  <dt className="text-slate-600">{k}</dt>
                  <dd className="font-mono font-semibold text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              Source Data vs. Model Assumptions
            </h3>
            <div className="space-y-2.5">
              {publicImport.assumptions.map((a) => (
                <div
                  key={a.field}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-900">{a.column_name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        a.origin === 'source_derived'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {a.origin === 'source_derived' ? 'Source-Derived' : 'Model Assumption'}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600">{a.methodology}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-700">{a.summary}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

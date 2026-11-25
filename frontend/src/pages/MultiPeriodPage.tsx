import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  LineChart,
  Loader2,
  Play,
  Sigma,
  Table2,
} from 'lucide-react';
import { solveMultiPeriod, validateMultiPeriodMapping } from '../api/client';
import { FormulationView } from '../components/FormulationView';
import { PlotlyChart } from '../components/PlotlyChart';
import { useStudio } from '../context/StudioContext';
import type { MappingValidationResponse, MultiPeriodColumnMapping } from '../types/or';

const OPTIONAL_FIELDS: { key: keyof MultiPeriodColumnMapping; label: string; hint: string }[] = [
  { key: 'production_cost', label: 'Production Cost', hint: 'Unit production cost' },
  { key: 'inventory_cost', label: 'Inventory Cost', hint: 'Unit holding cost per period' },
  { key: 'capacity', label: 'Capacity', hint: 'Available period or resource capacity' },
  { key: 'processing_time', label: 'Processing Time', hint: 'Capacity consumed per unit' },
  { key: 'resource', label: 'Resource', hint: 'Machine / line identifier (if multi-resource)' },
  { key: 'initial_inventory', label: 'Initial Inventory', hint: 'Starting stock before period 1' },
  { key: 'setup_cost', label: 'Setup Cost', hint: 'Fixed setup cost if produced' },
  { key: 'setup_time', label: 'Setup Time', hint: 'Fixed setup time if produced' },
];

export const MultiPeriodPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    dataset,
    publicImport,
    mpMapping,
    setMpMapping,
    mpCapacityScope,
    mpSolution,
    setMpSolution,
    addHistoryItem,
  } = useStudio();

  const [mapping, setMapping] = useState<MultiPeriodColumnMapping>(() => ({
    product: mpMapping?.product ?? '',
    period: mpMapping?.period ?? '',
    demand: mpMapping?.demand ?? '',
    production_cost: mpMapping?.production_cost ?? '',
    inventory_cost: mpMapping?.inventory_cost ?? '',
    capacity: mpMapping?.capacity ?? '',
    processing_time: mpMapping?.processing_time ?? '',
    resource: mpMapping?.resource ?? '',
    initial_inventory: mpMapping?.initial_inventory ?? '',
    setup_cost: mpMapping?.setup_cost ?? '',
    setup_time: mpMapping?.setup_time ?? '',
  }));

  const [integerProd, setIntegerProd] = useState(false);
  const [validation, setValidation] = useState<MappingValidationResponse | null>(null);
  const [validating, setValidating] = useState(false);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'results' | 'graphs' | 'formulation'>('results');

  useEffect(() => {
    setValidation(null);
    setError(null);
  }, [dataset?.dataset_id, dataset?.active_sheet]);

  useEffect(() => {
    if (mpMapping) {
      setMapping({
        product: mpMapping.product ?? '',
        period: mpMapping.period ?? '',
        demand: mpMapping.demand ?? '',
        production_cost: mpMapping.production_cost ?? '',
        inventory_cost: mpMapping.inventory_cost ?? '',
        capacity: mpMapping.capacity ?? '',
        processing_time: mpMapping.processing_time ?? '',
        resource: mpMapping.resource ?? '',
        initial_inventory: mpMapping.initial_inventory ?? '',
        setup_cost: mpMapping.setup_cost ?? '',
        setup_time: mpMapping.setup_time ?? '',
      });
    }
  }, [mpMapping]);

  const columnNames = useMemo(
    () => dataset?.columns.map((c) => c.name) ?? [],
    [dataset]
  );

  const { productProductionTraces, productInventoryTraces, periodCostTraces } = useMemo(() => {
    if (!mpSolution?.is_optimal || mpSolution.production_schedule.length === 0) {
      return {
        productProductionTraces: [],
        productInventoryTraces: [],
        periodCostTraces: [],
      };
    }

    const palette = [
      '#2563eb', '#0f172a', '#0ea5e9', '#10b981', '#f59e0b', '#6366f1',
      '#ec4899', '#14b8a6', '#8b5cf6', '#ef4444', '#84cc16', '#06b6d4',
      '#f97316', '#3b82f6', '#64748b', '#059669', '#d97706', '#7c3aed',
    ];
    const periods = mpSolution.period_summary.map((p) => String(p.period));
    const products = Array.from(
      new Set(mpSolution.production_schedule.map((r) => String(r.product)))
    );

    const prodLookup = new Map<string, number>();
    const invLookup = new Map<string, number>();
    const prodCostByPeriod = new Map<string, number>();
    const invCostByPeriod = new Map<string, number>();
    const setupCostByPeriod = new Map<string, number>();

    let hasProdCostCol = false;
    let hasInvCostCol = false;
    let hasSetupCostCol = false;

    mpSolution.production_schedule.forEach((r) => {
      const key = `${String(r.product)}__${String(r.period)}`;
      const per = String(r.period);
      prodLookup.set(key, Number(r.production ?? 0));
      invLookup.set(key, Number(r.ending_inventory ?? 0));

      if (r.production_cost !== undefined && r.production_cost !== null) {
        hasProdCostCol = true;
        prodCostByPeriod.set(per, (prodCostByPeriod.get(per) ?? 0) + Number(r.production_cost));
      }
      if (r.inventory_cost !== undefined && r.inventory_cost !== null) {
        hasInvCostCol = true;
        invCostByPeriod.set(per, (invCostByPeriod.get(per) ?? 0) + Number(r.inventory_cost));
      }
      if (r.setup_cost !== undefined && r.setup_cost !== null) {
        hasSetupCostCol = true;
        setupCostByPeriod.set(per, (setupCostByPeriod.get(per) ?? 0) + Number(r.setup_cost));
      }
    });

    const prodTraces = products.map((prod, idx) => ({
      x: periods,
      y: periods.map((per) => prodLookup.get(`${prod}__${per}`) ?? 0),
      name: prod,
      type: 'bar',
      marker: { color: palette[idx % palette.length] },
    }));

    const invTraces = products.map((prod, idx) => ({
      x: periods,
      y: periods.map((per) => invLookup.get(`${prod}__${per}`) ?? 0),
      name: prod,
      type: 'scatter',
      mode: 'lines+markers',
      line: { color: palette[idx % palette.length], width: 2 },
      marker: { size: 5, color: palette[idx % palette.length] },
    }));

    const costTraces: Record<string, unknown>[] = [];
    if (hasProdCostCol) {
      costTraces.push({
        x: periods,
        y: periods.map((per) => Number((prodCostByPeriod.get(per) ?? 0).toFixed(4))),
        name: 'Production Cost',
        type: 'bar',
        marker: { color: '#2563eb' },
      });
    }
    if (hasInvCostCol) {
      costTraces.push({
        x: periods,
        y: periods.map((per) => Number((invCostByPeriod.get(per) ?? 0).toFixed(4))),
        name: 'Inventory Cost',
        type: 'bar',
        marker: { color: '#0f172a' },
      });
    }
    if (hasSetupCostCol) {
      costTraces.push({
        x: periods,
        y: periods.map((per) => Number((setupCostByPeriod.get(per) ?? 0).toFixed(4))),
        name: 'Setup Cost',
        type: 'bar',
        marker: { color: '#f59e0b' },
      });
    }

    return {
      productProductionTraces: prodTraces,
      productInventoryTraces: invTraces,
      periodCostTraces: costTraces,
    };
  }, [mpSolution]);

  const periodTickAngle =
    (mpSolution?.period_summary.length ?? 0) > 10 ? -35 : 0;

  const renderResultCharts = () => {
    if (!mpSolution?.is_optimal) return null;
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {productProductionTraces.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <PlotlyChart
              height={productProductionTraces.length > 12 ? 400 : 340}
              data={productProductionTraces}
              layout={{
                title: {
                  text: `Production by Product and Period (${productProductionTraces.length} products)`,
                },
                barmode: 'group',
                hovermode: 'x unified',
                margin: { t: 48, r: 24, b: periodTickAngle ? 72 : 56, l: 60 },
                xaxis: { title: 'Period', type: 'category', tickangle: periodTickAngle },
                yaxis: { title: 'Production Units' },
              }}
            />
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <PlotlyChart
            data={[
              {
                x: mpSolution.period_summary.map((p) => p.period),
                y: mpSolution.period_summary.map((p) => p.total_demand),
                name: 'Total Demand',
                type: 'bar',
                marker: { color: '#94a3b8' },
              },
              {
                x: mpSolution.period_summary.map((p) => p.period),
                y: mpSolution.period_summary.map((p) => p.total_production),
                name: 'Total Production',
                type: 'bar',
                marker: { color: '#2563eb' },
              },
            ]}
            layout={{
              title: { text: 'Demand vs. Production by Period' },
              barmode: 'group',
              hovermode: 'x unified',
              margin: { t: 48, r: 24, b: periodTickAngle ? 72 : 56, l: 60 },
              xaxis: { title: 'Period', type: 'category', tickangle: periodTickAngle },
              yaxis: { title: 'Units' },
            }}
          />
        </div>

        {productInventoryTraces.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <PlotlyChart
              height={productInventoryTraces.length > 12 ? 400 : 340}
              data={productInventoryTraces}
              layout={{
                title: {
                  text: `Ending Inventory by Product and Period (${productInventoryTraces.length} products)`,
                },
                hovermode: 'x unified',
                margin: { t: 48, r: 24, b: periodTickAngle ? 72 : 56, l: 60 },
                xaxis: { title: 'Period', type: 'category', tickangle: periodTickAngle },
                yaxis: { title: 'Inventory Units' },
              }}
            />
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <PlotlyChart
            data={[
              {
                x: mpSolution.period_summary.map((p) => p.period),
                y: mpSolution.period_summary.map((p) => p.total_ending_inventory),
                name: 'Aggregate Ending Inventory',
                type: 'scatter',
                mode: 'lines+markers',
                line: { color: '#0f172a', width: 2.5 },
                marker: { size: 7, color: '#2563eb' },
              },
            ]}
            layout={{
              title: { text: 'Aggregate Ending Inventory Over Periods' },
              hovermode: 'x unified',
              margin: { t: 48, r: 24, b: periodTickAngle ? 72 : 56, l: 60 },
              xaxis: { title: 'Period', type: 'category', tickangle: periodTickAngle },
              yaxis: { title: 'Inventory Units' },
            }}
          />
        </div>

        {periodCostTraces.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <PlotlyChart
              data={periodCostTraces}
              layout={{
                title: { text: 'Cost Breakdown by Period' },
                barmode: 'stack',
                hovermode: 'x unified',
                margin: { t: 48, r: 24, b: periodTickAngle ? 72 : 56, l: 64 },
                xaxis: { title: 'Period', type: 'category', tickangle: periodTickAngle },
                yaxis: { title: 'Cost' },
              }}
            />
          </div>
        )}

        {mpSolution.cost_breakdown &&
          Object.keys(mpSolution.cost_breakdown).length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <PlotlyChart
                data={[
                  {
                    x: Object.keys(mpSolution.cost_breakdown).map((k) =>
                      k.replace(/_/g, ' ').toUpperCase()
                    ),
                    y: Object.values(mpSolution.cost_breakdown),
                    type: 'bar',
                    marker: { color: ['#2563eb', '#0f172a', '#f59e0b'] },
                  },
                ]}
                layout={{
                  title: { text: 'Total Cost Summary Breakdown' },
                  xaxis: { title: 'Cost Component', type: 'category' },
                  yaxis: { title: 'Total Cost' },
                }}
              />
            </div>
          )}

        {mpSolution.resource_utilization.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-2">
            <PlotlyChart
              height={360}
              data={[
                {
                  x: mpSolution.resource_utilization.map(
                    (u) => `${u.resource} (T${u.period})`
                  ),
                  y: mpSolution.resource_utilization.map((u) => u.utilization_pct),
                  name: 'Utilization %',
                  type: 'bar',
                  marker: { color: '#2563eb' },
                },
              ]}
              layout={{
                title: { text: 'Capacity & Resource Utilization (%)' },
                margin: {
                  t: 48,
                  r: 24,
                  b: mpSolution.resource_utilization.length > 12 ? 90 : 60,
                  l: 60,
                },
                xaxis: {
                  title: 'Resource / Period',
                  type: 'category',
                  tickangle: mpSolution.resource_utilization.length > 12 ? -40 : 0,
                },
                yaxis: { title: 'Utilization (%)', range: [0, 110] },
              }}
            />
          </div>
        )}
      </div>
    );
  };

  const cleanMapping = (): MultiPeriodColumnMapping => ({
    product: mapping.product,
    period: mapping.period,
    demand: mapping.demand,
    production_cost: mapping.production_cost || null,
    inventory_cost: mapping.inventory_cost || null,
    capacity: mapping.capacity || null,
    processing_time: mapping.processing_time || null,
    resource: mapping.resource || null,
    initial_inventory: mapping.initial_inventory || null,
    setup_cost: mapping.setup_cost || null,
    setup_time: mapping.setup_time || null,
  });

  const handleValidate = async () => {
    if (!dataset) return;
    if (!mapping.product || !mapping.period || !mapping.demand) {
      setError('Please map the required fields: Product, Period, and Demand.');
      return;
    }
    setValidating(true);
    setError(null);
    try {
      const cleaned = cleanMapping();
      setMpMapping(cleaned);
      const res = await validateMultiPeriodMapping(dataset.dataset_id, cleaned);
      setValidation(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed.');
    } finally {
      setValidating(false);
    }
  };

  const handleSolve = async () => {
    if (!dataset) return;
    if (!mapping.product || !mapping.period || !mapping.demand) {
      setError('Please map the required fields: Product, Period, and Demand.');
      return;
    }
    setSolving(true);
    setError(null);
    try {
      const cleaned = cleanMapping();
      setMpMapping(cleaned);
      const val = await validateMultiPeriodMapping(dataset.dataset_id, cleaned);
      setValidation(val);
      if (!val.valid) {
        setError('Mapping validation failed. Resolve all errors before solving.');
        setSolving(false);
        return;
      }
      const sol = await solveMultiPeriod(
        dataset.dataset_id,
        cleaned,
        integerProd,
        mpCapacityScope
      );
      setMpSolution(sol);
      setActiveTab('results');
      addHistoryItem({
        module: 'multi-period',
        title: `Multi-Period Production Plan (${dataset.filename})`,
        status: sol.status,
        isOptimal: sol.is_optimal,
        objectiveSummary:
          sol.is_optimal && sol.objective_value !== null
            ? `Obj = ${sol.objective_value.toLocaleString()}`
            : `Status: ${sol.status}`,
        datasetName: dataset.filename,
        payload: sol,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed.');
    } finally {
      setSolving(false);
    }
  };

  const handleExportCsv = () => {
    if (!mpSolution || mpSolution.production_schedule.length === 0) return;
    const headers = Object.keys(mpSolution.production_schedule[0]);
    const lines = [
      headers.join(','),
      ...mpSolution.production_schedule.map((row) =>
        headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'multi-period-solution.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Activity className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900">Multi-Period Optimization</h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Map your dataset columns to production planning parameters and solve with PuLP CBC.
          </p>
        </div>
      </div>

      {!dataset ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-xs">
          <Database className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-3 text-base font-semibold text-slate-900">No Dataset Loaded</h2>
          <p className="mt-1 text-sm text-slate-600">
            Upload a CSV or Excel dataset in Dataset Explorer first to map columns and solve.
          </p>
          <button
            type="button"
            onClick={() => navigate('/datasets')}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Go to Dataset Explorer
          </button>
        </div>
      ) : (
        <>
          {/* Column Mapping Card */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Parameter Column Mapping
                </h2>
                <p className="text-xs text-slate-500">
                  Dataset: <span className="font-medium text-slate-700">{dataset.filename}</span>
                  {dataset.active_sheet ? ` (Sheet: ${dataset.active_sheet})` : ''} ·{' '}
                  {dataset.row_count} rows
                </p>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={integerProd}
                  onChange={(e) => setIntegerProd(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                Integer production quantities
              </label>
            </div>

            {/* Required Fields */}
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Required Parameters
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {(
                  [
                    { key: 'product', label: 'Product *' },
                    { key: 'period', label: 'Period *' },
                    { key: 'demand', label: 'Demand *' },
                  ] as const
                ).map(({ key, label }) => (
                  <div key={key}>
                    <label className="mb-1 block text-xs font-medium text-slate-700">
                      {label}
                    </label>
                    <select
                      value={mapping[key] ?? ''}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">-- Select column --</option>
                      {columnNames.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Optional Fields */}
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Optional Model Parameters (Included Only When Mapped)
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {OPTIONAL_FIELDS.map(({ key, label, hint }) => (
                  <div key={key}>
                    <label className="mb-1 block text-xs font-medium text-slate-700" title={hint}>
                      {label}
                    </label>
                    <select
                      value={(mapping[key] as string) ?? ''}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">(Not mapped)</option>
                      {columnNames.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={validating || solving}
                onClick={() => void handleValidate()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {validating && <Loader2 className="h-4 w-4 animate-spin" />}
                Validate Mapping
              </button>

              <button
                type="button"
                disabled={solving || validating}
                onClick={() => void handleSolve()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
              >
                {solving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Solve Model
              </button>
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            {validation && (
              <div className="mt-4 space-y-2">
                {validation.issues.map((issue, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 rounded-lg border px-4 py-2.5 text-xs ${
                      issue.severity === 'error'
                        ? 'border-rose-200 bg-rose-50 text-rose-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{issue.message}</span>
                  </div>
                ))}
                {validation.valid && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Mapping validated: {String(validation.detected_summary.unique_products ?? 0)}{' '}
                    product(s) across {String(validation.detected_summary.unique_periods ?? 0)}{' '}
                    period(s).
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Solution Results, Visualizations, Mathematical Formulation */}
          {mpSolution && (
            <section className="space-y-6">
              {/* Sub-navigation Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
                <div className="flex gap-1">
                  {[
                    { id: 'results', label: 'Results & Schedule', icon: Table2 },
                    { id: 'graphs', label: 'Visualizations', icon: LineChart },
                    { id: 'formulation', label: 'Mathematical Formulation', icon: Sigma },
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id as typeof activeTab)}
                      className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                        activeTab === id
                          ? 'border-blue-600 text-blue-700'
                          : 'border-transparent text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>

                {mpSolution.is_optimal && mpSolution.production_schedule.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="mb-1 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export Schedule CSV
                  </button>
                )}
              </div>

              {activeTab === 'results' && (
                <div className="space-y-6">
                  {/* Status & KPIs */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                      <div className="text-xs font-medium text-slate-500">Solver Status</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            mpSolution.is_optimal
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {mpSolution.status}
                        </span>
                        <span className="text-xs text-slate-500">
                          {mpSolution.solve_time_seconds}s
                        </span>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                      <div className="text-xs font-medium text-slate-500">
                        Objective Value ({mpSolution.objective_sense})
                      </div>
                      <div className="mt-1 font-mono text-xl font-bold text-slate-900">
                        {mpSolution.objective_value !== null
                          ? mpSolution.objective_value.toLocaleString()
                          : 'N/A'}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                      <div className="text-xs font-medium text-slate-500">
                        Total Production / Demand
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold text-slate-900">
                        {mpSolution.total_production?.toLocaleString() ?? '—'} /{' '}
                        {mpSolution.total_demand?.toLocaleString() ?? '—'}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                      <div className="text-xs font-medium text-slate-500">
                        Constraint Feasibility
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {mpSolution.is_optimal
                          ? mpSolution.constraints_feasible
                            ? `Verified (max viol: ${mpSolution.max_constraint_violation})`
                            : `Violation: ${mpSolution.max_constraint_violation}`
                          : 'Not Feasible'}
                      </div>
                    </div>
                  </div>

                  {!mpSolution.is_optimal && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                      {mpSolution.message}
                    </div>
                  )}

                  {mpSolution.is_optimal && (
                    <>
                      <div className="rounded-xl border border-blue-200 bg-blue-50/40 px-4 py-3 text-xs text-slate-700">
                        <div>{mpSolution.message}</div>
                        {publicImport && publicImport.dataset.dataset_id === dataset.dataset_id && (
                          <div className="mt-2 border-t border-blue-200/70 pt-2 text-[11px] text-slate-600">
                            <span className="font-semibold text-slate-800">
                              Source & Assumptions ({publicImport.catalog_entry.name}):
                            </span>{' '}
                            {publicImport.assumptions
                              .map(
                                (a) =>
                                  `${a.column_name} (${a.origin === 'source_derived' ? 'Source-Derived' : 'Model Assumption'})`
                              )
                              .join(' · ')}{' '}
                            — {publicImport.catalog_entry.license}
                          </div>
                        )}
                      </div>

                      {/* Result Visualizations (Always visible on Results view) */}
                      {renderResultCharts()}
                      {/* Production & Inventory Schedule Table */}
                      <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                        <div className="border-b border-slate-200 px-5 py-3.5">
                          <h3 className="text-sm font-semibold text-slate-900">
                            Production & Inventory Schedule by Product and Period
                          </h3>
                        </div>
                        <div className="overflow-x-auto max-h-[420px]">
                          <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-slate-50 text-slate-500 uppercase">
                              <tr>
                                {Object.keys(mpSolution.production_schedule[0] ?? {}).map((col) => (
                                  <th key={col} className="px-4 py-2.5 font-semibold">
                                    {col.replace(/_/g, ' ')}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {mpSolution.production_schedule.map((row, idx) => (
                                <tr key={idx} className="hover:bg-slate-50/70">
                                  {Object.entries(row).map(([k, v]) => (
                                    <td
                                      key={k}
                                      className="whitespace-nowrap px-4 py-2 font-mono text-slate-800"
                                    >
                                      {String(v)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Resource Utilization Table */}
                      {mpSolution.resource_utilization.length > 0 && (
                        <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
                          <div className="border-b border-slate-200 px-5 py-3.5">
                            <h3 className="text-sm font-semibold text-slate-900">
                              Resource & Capacity Utilization
                            </h3>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-50 text-slate-500 uppercase">
                                <tr>
                                  <th className="px-4 py-2.5 font-semibold">Resource</th>
                                  <th className="px-4 py-2.5 font-semibold">Period</th>
                                  <th className="px-4 py-2.5 font-semibold">Used</th>
                                  <th className="px-4 py-2.5 font-semibold">Capacity</th>
                                  <th className="px-4 py-2.5 font-semibold">Utilization</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {mpSolution.resource_utilization.map((u, idx) => (
                                  <tr key={idx} className="hover:bg-slate-50/70">
                                    <td className="px-4 py-2.5 font-medium text-slate-900">
                                      {u.resource}
                                    </td>
                                    <td className="px-4 py-2.5 font-mono text-slate-700">
                                      {u.period}
                                    </td>
                                    <td className="px-4 py-2.5 font-mono text-slate-700">
                                      {u.used}
                                    </td>
                                    <td className="px-4 py-2.5 font-mono text-slate-700">
                                      {u.capacity}
                                    </td>
                                    <td className="px-4 py-2.5 font-mono font-semibold text-blue-700">
                                      {u.utilization_pct}%
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
                </div>
              )}

              {activeTab === 'graphs' && (
                <div className="space-y-6">
                  {!mpSolution.is_optimal ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
                      Charts are only generated when an Optimal solution is available.
                    </div>
                  ) : (
                    renderResultCharts()
                  )}
                </div>
              )}

              {activeTab === 'formulation' && (
                <FormulationView formulation={mpSolution.formulation} />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};

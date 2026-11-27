import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  Database,
  Download,
  LineChart,
  Loader2,
  Play,
  RotateCcw,
  Sigma,
  Table2,
} from 'lucide-react';
import { solveMultiPeriod, validateMultiPeriodMapping } from '../api/client';
import { DecisionIntelligencePanel } from '../components/DecisionIntelligencePanel';
import { FormulationView } from '../components/FormulationView';
import { PlotlyChart } from '../components/PlotlyChart';
import { SaveScenarioModal } from '../components/SaveScenarioModal';
import { useStudio } from '../context/StudioContext';
import type {
  MappingValidationResponse,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
} from '../types/or';
import {
  CAPACITY_SCOPE_OPTIONS,
  type CapacityScopeValue,
  getCapacityScopeCue,
  getMappingValidationFreshness,
  getModelTypeCue,
} from '../utils/modelingCues';
import { getMappingSignature } from '../utils/sensitivityAnalysis';

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
    setMpCapacityScope,
    mpIntegerProd: integerProd,
    setMpIntegerProd: setIntegerProd,
    mpSolution: baselineMpSolution,
    setMpSolution,
    restoredScenario,
    setRestoredScenario,
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

  const [validation, setValidation] = useState<MappingValidationResponse | null>(null);
  const [validatedMappingSignature, setValidatedMappingSignature] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [solving, setSolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'results' | 'graphs' | 'formulation'>('results');
  const [selectedFlowProduct, setSelectedFlowProduct] = useState<string>('__ALL__');
  const [selectedResource, setSelectedResource] = useState<string | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);
  const [restoredSolveResult, setRestoredSolveResult] =
    useState<MultiPeriodSolveResponse | null>(null);

  const mpSolution = restoredScenario
    ? restoredSolveResult ?? restoredScenario.result_snapshot
    : baselineMpSolution;

  useEffect(() => {
    setRestoredSolveResult(null);
  }, [restoredScenario?.id]);

  useEffect(() => {
    setSelectedFlowProduct('__ALL__');
  }, [mpSolution]);

  useEffect(() => {
    setValidation(null);
    setValidatedMappingSignature(null);
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
      return;
    }

    if (!dataset || dataset.columns.length === 0) return;

    const used = new Set<string>();
    const pickCol = (aliases: string[]): string => {
      const normalized = dataset.columns.map((c) => ({
        raw: c.name,
        norm: c.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
      }));
      for (const alias of aliases) {
        const exact = normalized.find((c) => c.norm === alias && !used.has(c.raw));
        if (exact) {
          used.add(exact.raw);
          return exact.raw;
        }
      }
      for (const alias of aliases) {
        const partial = normalized.find(
          (c) => c.norm.includes(alias) && !used.has(c.raw)
        );
        if (partial) {
          used.add(partial.raw);
          return partial.raw;
        }
      }
      return '';
    };

    setMapping({
      product: pickCol(['product', 'productid', 'productname', 'sku', 'stockcode', 'item', 'itemid']),
      period: pickCol(['period', 'timeperiod', 'month', 'week', 'quarter', 'yearmonth', 'date', 't']),
      demand: pickCol(['demand', 'demandunits', 'quantity', 'qty', 'sales']),
      production_cost: pickCol(['productioncost', 'prodcost', 'unitproductioncost', 'unitcost', 'assumedproductioncost']),
      inventory_cost: pickCol(['inventorycost', 'holdingcost', 'invcost', 'unitholdingcost', 'assumedinventorycost']),
      capacity: pickCol(['capacity', 'capacityunits', 'estimatedcapacity', 'maxcapacity']),
      processing_time: pickCol(['processingtime', 'proctime', 'cycletime', 'unittime']),
      resource: pickCol(['resource', 'machine', 'line', 'workcenter', 'plant']),
      initial_inventory: pickCol(['initialinventory', 'initinv', 'startinginventory', 'beginninginventory', 'assumedinitialinventory']),
      setup_cost: pickCol(['setupcost', 'changeovercost', 'fixedcost']),
      setup_time: pickCol(['setuptime', 'changeovertime']),
    });
  }, [mpMapping, dataset]);

  const columnNames = useMemo(
    () => dataset?.columns.map((c) => c.name) ?? [],
    [dataset]
  );

  const columnUniqueMap = useMemo(() => {
    const m = new Map<string, number>();
    dataset?.columns.forEach((c) => m.set(c.name, c.unique_count));
    return m;
  }, [dataset]);

  const {
    productProductionTraces,
    periodCostTraces,
    flowProducts,
    inventoryFlowSeries,
  } = useMemo(() => {
    if (!mpSolution?.is_optimal || mpSolution.production_schedule.length === 0) {
      return {
        productProductionTraces: [],
        periodCostTraces: [],
        flowProducts: [] as string[],
        inventoryFlowSeries: null as {
          periods: string[];
          production: number[];
          demand: number[];
          endingInventory: number[];
        } | null,
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
    const demLookup = new Map<string, number>();
    const invLookup = new Map<string, number>();
    const prodCostByPeriod = new Map<string, number>();
    const invCostByPeriod = new Map<string, number>();
    const setupCostByPeriod = new Map<string, number>();

    let hasProdCostCol = false;
    let hasInvCostCol = false;
    let hasSetupCostCol = false;
    let hasRequiredFlowFields = true;

    mpSolution.production_schedule.forEach((r) => {
      const key = `${String(r.product)}__${String(r.period)}`;
      const per = String(r.period);
      if (
        r.production === undefined ||
        r.demand === undefined ||
        r.ending_inventory === undefined
      ) {
        hasRequiredFlowFields = false;
      }
      prodLookup.set(key, Number(r.production ?? 0));
      demLookup.set(key, Number(r.demand ?? 0));
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

    let flowSeries: {
      periods: string[];
      production: number[];
      demand: number[];
      endingInventory: number[];
    } | null = null;

    if (hasRequiredFlowFields && periods.length > 0) {
      if (selectedFlowProduct === '__ALL__' || !products.includes(selectedFlowProduct)) {
        flowSeries = {
          periods,
          production: mpSolution.period_summary.map((p) => Number(p.total_production ?? 0)),
          demand: mpSolution.period_summary.map((p) => Number(p.total_demand ?? 0)),
          endingInventory: mpSolution.period_summary.map((p) =>
            Number(p.total_ending_inventory ?? 0)
          ),
        };
      } else {
        flowSeries = {
          periods,
          production: periods.map((per) => prodLookup.get(`${selectedFlowProduct}__${per}`) ?? 0),
          demand: periods.map((per) => demLookup.get(`${selectedFlowProduct}__${per}`) ?? 0),
          endingInventory: periods.map(
            (per) => invLookup.get(`${selectedFlowProduct}__${per}`) ?? 0
          ),
        };
      }
    }

    const costTraces: Record<string, unknown>[] = [];
    if (hasProdCostCol) {
      costTraces.push({
        x: periods,
        y: periods.map((per) => Number((prodCostByPeriod.get(per) ?? 0).toFixed(4))),
        name: 'Production Cost',
        type: 'bar',
        marker: { color: '#2563eb' },
        hovertemplate: 'Production Cost: %{y:,.2f}<extra></extra>',
      });
    }
    if (hasInvCostCol) {
      costTraces.push({
        x: periods,
        y: periods.map((per) => Number((invCostByPeriod.get(per) ?? 0).toFixed(4))),
        name: 'Inventory Cost',
        type: 'bar',
        marker: { color: '#0f172a' },
        hovertemplate: 'Inventory Cost: %{y:,.2f}<extra></extra>',
      });
    }
    if (hasSetupCostCol) {
      costTraces.push({
        x: periods,
        y: periods.map((per) => Number((setupCostByPeriod.get(per) ?? 0).toFixed(4))),
        name: 'Setup Cost',
        type: 'bar',
        marker: { color: '#f59e0b' },
        hovertemplate: 'Setup Cost: %{y:,.2f}<extra></extra>',
      });
    }

    return {
      productProductionTraces: prodTraces,
      periodCostTraces: costTraces,
      flowProducts: products,
      inventoryFlowSeries: flowSeries,
    };
  }, [mpSolution, selectedFlowProduct]);

  const periodTickAngle =
    (mpSolution?.period_summary.length ?? 0) > 6 ? -40 : 0;
  const periodNTicks =
    (mpSolution?.period_summary.length ?? 0) > 14 ? 12 : undefined;

  const productCountLabel = (n: number) => (n === 1 ? '1 product' : `${n} products`);

  const renderResultCharts = () => {
    if (!mpSolution?.is_optimal) return null;
    const topHorizontalLegend = {
      orientation: 'h',
      x: 0,
      y: 1.02,
      xanchor: 'left',
      yanchor: 'bottom',
      font: { size: 11 },
    };
    const multiProductLegend =
      productProductionTraces.length > 6
        ? { orientation: 'v', x: 1.02, y: 1, font: { size: 11 } }
        : topHorizontalLegend;
    const zeroTotalInventory = (mpSolution.total_ending_inventory ?? 0) <= 1e-6;

    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {productProductionTraces.length > 0 && (
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <h4 className="mb-2 text-sm font-semibold text-slate-900">
              Production by Product and Period ({productCountLabel(productProductionTraces.length)})
            </h4>
            <PlotlyChart
              height={productProductionTraces.length > 10 ? 400 : 330}
              data={productProductionTraces}
              layout={{
                barmode: 'group',
                hovermode: 'x unified',
                legend: multiProductLegend,
                margin: {
                  t: productProductionTraces.length > 6 ? 16 : 48,
                  r: productProductionTraces.length > 6 ? 105 : 16,
                  b: periodTickAngle ? 72 : 48,
                  l: 56,
                },
                xaxis: {
                  title: 'Period',
                  type: 'category',
                  tickmode: 'auto',
                  nticks: periodNTicks,
                  tickangle: periodTickAngle,
                  automargin: true,
                },
                yaxis: { title: 'Production Units', automargin: true },
              }}
            />
          </div>
        )}

        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <h4 className="mb-2 text-sm font-semibold text-slate-900">
            Demand vs. Production by Period
          </h4>
          <PlotlyChart
            height={330}
            data={[
              {
                x: mpSolution.period_summary.map((p) => p.period),
                y: mpSolution.period_summary.map((p) => p.total_demand),
                name: 'Total Demand',
                type: 'bar',
                marker: { color: '#94a3b8' },
                hovertemplate: 'Total Demand: %{y:,.2f}<extra></extra>',
              },
              {
                x: mpSolution.period_summary.map((p) => p.period),
                y: mpSolution.period_summary.map((p) => p.total_production),
                name: 'Total Production',
                type: 'bar',
                marker: { color: '#2563eb' },
                hovertemplate: 'Total Production: %{y:,.2f}<extra></extra>',
              },
            ]}
            layout={{
              barmode: 'group',
              hovermode: 'x unified',
              legend: topHorizontalLegend,
              margin: { t: 48, r: 16, b: periodTickAngle ? 72 : 48, l: 56 },
              xaxis: {
                title: 'Period',
                type: 'category',
                tickmode: 'auto',
                nticks: periodNTicks,
                tickangle: periodTickAngle,
                automargin: true,
              },
              yaxis: { title: 'Units', automargin: true },
            }}
          />
        </div>

        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-900">
              Inventory Flow &amp; Demand Analysis
            </h4>
            {flowProducts.length > 1 && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="inventory-flow-product"
                  className="text-xs font-medium text-slate-600"
                >
                  Scope:
                </label>
                <select
                  id="inventory-flow-product"
                  value={selectedFlowProduct}
                  onChange={(e) => setSelectedFlowProduct(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                >
                  <option value="__ALL__">
                    All Products (Aggregated — {flowProducts.length} products)
                  </option>
                  {flowProducts.map((prod) => (
                    <option key={prod} value={prod}>
                      {prod}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {!inventoryFlowSeries ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              Production, Demand, or Ending Inventory fields are unavailable in the current solver output.
            </div>
          ) : (
            <>
              <PlotlyChart
                height={360}
                data={[
                  {
                    x: inventoryFlowSeries.periods,
                    y: inventoryFlowSeries.production,
                    name: 'Production',
                    type: 'bar',
                    marker: { color: '#2563eb' },
                    hovertemplate: 'Production: %{y:,.2f}<extra></extra>',
                  },
                  {
                    x: inventoryFlowSeries.periods,
                    y: inventoryFlowSeries.demand,
                    name: 'Demand',
                    type: 'bar',
                    marker: { color: '#94a3b8' },
                    hovertemplate: 'Demand: %{y:,.2f}<extra></extra>',
                  },
                  {
                    x: inventoryFlowSeries.periods,
                    y: inventoryFlowSeries.endingInventory,
                    name: 'Ending Inventory',
                    type: 'scatter',
                    mode: 'lines+markers',
                    line: { color: '#0f172a', width: 2.5 },
                    marker: { size: 7, color: '#f59e0b' },
                    hovertemplate: 'Ending Inventory: %{y:,.2f}<extra></extra>',
                  },
                ]}
                layout={{
                  barmode: 'group',
                  hovermode: 'x unified',
                  legend: topHorizontalLegend,
                  margin: { t: 48, r: 16, b: periodTickAngle ? 72 : 48, l: 56 },
                  xaxis: {
                    title: 'Period',
                    type: 'category',
                    tickmode: 'auto',
                    nticks: periodNTicks,
                    tickangle: periodTickAngle,
                    automargin: true,
                  },
                  yaxis: { title: 'Units', automargin: true },
                }}
              />
              {inventoryFlowSeries.endingInventory.every((v) => v <= 1e-6) && (
                <p className="mt-2 text-xs text-slate-500">
                  {zeroTotalInventory
                    ? 'Just-in-time optimal plan: ending inventory is 0 across all periods because capacity meets demand and holding inventory incurs positive cost.'
                    : 'Ending inventory is 0 across all periods for the selected product.'}
                </p>
              )}
            </>
          )}
        </div>

        {periodCostTraces.length > 0 && (
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <h4 className="mb-2 text-sm font-semibold text-slate-900">
              Cost Breakdown by Period
            </h4>
            <PlotlyChart
              height={330}
              data={periodCostTraces}
              layout={{
                barmode: 'stack',
                hovermode: 'x unified',
                legend: topHorizontalLegend,
                margin: { t: 54, r: 16, b: periodTickAngle ? 72 : 48, l: 60 },
                xaxis: {
                  title: 'Period',
                  type: 'category',
                  tickmode: 'auto',
                  nticks: periodNTicks,
                  tickangle: periodTickAngle,
                  automargin: true,
                },
                yaxis: { title: 'Cost', automargin: true },
              }}
            />
          </div>
        )}

        {mpSolution.resource_utilization.length > 0 && (
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:col-span-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-900">
                Capacity & Resource Utilization (%) — {mpSolution.resource_utilization.length} entries
              </h4>
              {selectedResource && (
                <button
                  type="button"
                  onClick={() => setSelectedResource(null)}
                  className="rounded-md border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Clear Selection
                </button>
              )}
            </div>

            <PlotlyChart
              height={350}
              onPointClick={(pt) => {
                if (pt.x !== undefined) {
                  const key = String(pt.x);
                  setSelectedResource((prev) => (prev === key ? null : key));
                }
              }}
              data={[
                {
                  x: mpSolution.resource_utilization.map(
                    (u) => `${u.resource} (T${u.period})`
                  ),
                  y: mpSolution.resource_utilization.map((u) => u.utilization_pct),
                  name: 'Utilization %',
                  type: 'bar',
                  marker: {
                    color: mpSolution.resource_utilization.map((u) => {
                      const key = `${u.resource} (T${u.period})`;
                      if (selectedResource && selectedResource !== key) return '#cbd5e1';
                      const pct = u.utilization_pct ?? 0;
                      if (pct >= 99.9) return '#ef4444';
                      if (pct >= 90) return '#f59e0b';
                      return '#2563eb';
                    }),
                  },
                  hovertemplate: '%{x}: %{y:.2f}%<extra></extra>',
                },
              ]}
              layout={{
                margin: {
                  t: 16,
                  r: 16,
                  b: mpSolution.resource_utilization.length > 12 ? 96 : 56,
                  l: 56,
                },
                xaxis: {
                  title: 'Resource / Period',
                  type: 'category',
                  automargin: true,
                  tickmode: 'auto',
                  nticks: mpSolution.resource_utilization.length > 15 ? 8 : undefined,
                  tickangle: mpSolution.resource_utilization.length > 10 ? -35 : 0,
                },
                yaxis: { title: 'Utilization (%)', range: [0, 110], automargin: true },
              }}
            />

            {/* Interactive Bottleneck & Resource Drilldown */}
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Resource Inspector (Click a bar on the chart or select below)
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {mpSolution.resource_utilization.map((u) => {
                  const key = `${u.resource} (T${u.period})`;
                  const isSelected = selectedResource === key;
                  const pct = u.utilization_pct ?? 0;
                  const atCapacity = pct >= 99.9;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedResource(isSelected ? null : key)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50 text-blue-800'
                          : atCapacity
                          ? 'border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100'
                          : pct >= 90
                          ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="font-semibold">{key}</span>
                      <span className="font-mono text-[11px] font-bold">
                        {pct.toFixed(1)}%
                      </span>
                      {atCapacity && (
                        <span className="rounded bg-rose-600 px-1 py-0.2 text-[9px] text-white font-bold">
                          AT CAPACITY
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedResource && (() => {
                const item = mpSolution.resource_utilization.find(
                  (u) => `${u.resource} (T${u.period})` === selectedResource
                );
                if (!item) return null;
                const pct = item.utilization_pct ?? 0;
                const atCapacity = pct >= 99.9;
                const nearCapacity = pct >= 90 && !atCapacity;
                const capacityVal = Number(item.capacity ?? 0);
                const usedVal = Number(item.used ?? 0);
                const remainingVal = Math.max(0, Number((capacityVal - usedVal).toFixed(4)));
                return (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-slate-900">
                      <span>
                        Resource Detail: {item.resource} (Period {item.period})
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          atCapacity
                            ? 'bg-rose-100 text-rose-800'
                            : nearCapacity
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {atCapacity
                          ? 'At Capacity'
                          : nearCapacity
                          ? 'Near Capacity'
                          : 'Available Capacity'}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-slate-600 sm:grid-cols-4">
                      <div>
                        Capacity:{' '}
                        <span className="font-mono font-bold text-slate-900">
                          {capacityVal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </span>
                      </div>
                      <div>
                        Used Capacity:{' '}
                        <span className="font-mono font-bold text-slate-900">
                          {usedVal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </span>
                      </div>
                      <div>
                        Remaining Capacity:{' '}
                        <span className="font-mono font-bold text-slate-900">
                          {remainingVal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </span>
                      </div>
                      <div>
                        Utilization:{' '}
                        <span className="font-mono font-bold text-slate-900">
                          {pct.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">
                      {atCapacity
                        ? 'This resource is at ≥99.9% of its available capacity in this period. Note: exact dual/shadow prices are not reported by this solver.'
                        : nearCapacity
                        ? 'This resource is at 90–99.9% utilization with limited remaining capacity and should be monitored for demand surges.'
                        : 'Available capacity remains in this period.'}
                    </p>
                  </div>
                );
              })()}
            </div>
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

  const currentMappingSignature = useMemo(
    () => getMappingSignature(cleanMapping()),
    [mapping]
  );

  const modelTypeCue = getModelTypeCue(
    integerProd,
    Boolean(mapping.setup_cost || mapping.setup_time)
  );
  const capacityScopeCue = getCapacityScopeCue(mpCapacityScope, mpSolution?.capacity_scope);
  const validationFreshness = getMappingValidationFreshness({
    currentSignature: currentMappingSignature,
    validatedSignature: validatedMappingSignature,
    validation,
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
      setValidatedMappingSignature(getMappingSignature(cleaned));
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
      setValidatedMappingSignature(getMappingSignature(cleaned));
      if (!val.valid) {
        setError('Mapping validation failed. Resolve all errors before solving.');
        setSolving(false);
        return;
      }
      const mults = restoredScenario
        ? {
            demand_multiplier: restoredScenario.input_config.demand_multiplier,
            capacity_multiplier: restoredScenario.input_config.capacity_multiplier,
            production_cost_multiplier:
              restoredScenario.input_config.production_cost_multiplier,
          }
        : undefined;
      const sol = await solveMultiPeriod(
        dataset.dataset_id,
        cleaned,
        integerProd,
        mpCapacityScope,
        mults
      );
      if (restoredScenario) {
        setRestoredSolveResult(sol);
      } else {
        setMpSolution(sol, cleaned);
      }
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
        <div className="space-y-4">
          {restoredScenario && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-xs text-amber-900">
              <span className="font-semibold">
                Restored Scenario &ldquo;{restoredScenario.name}&rdquo;:
              </span>{' '}
              The original dataset (<code>{restoredScenario.dataset_name ?? restoredScenario.dataset_id ?? 'unknown'}</code>) is no longer in active backend memory. Re-upload it in Dataset Explorer to re-optimize with the restored configuration.
            </div>
          )}
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
        </div>
      ) : (
        <>
          {restoredScenario && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
              <div className="flex items-start gap-2">
                <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                <div>
                  <span className="font-semibold">
                    Restored Scenario: &ldquo;{restoredScenario.name}&rdquo;
                  </span>{' '}
                  (Demand ×{restoredScenario.input_config.demand_multiplier.toFixed(2)}, Cap ×
                  {restoredScenario.input_config.capacity_multiplier.toFixed(2)}, Cost ×
                  {restoredScenario.input_config.production_cost_multiplier.toFixed(2)}). Editing
                  or re-solving here will not overwrite your saved snapshot or baseline.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRestoredScenario(null);
                  setRestoredSolveResult(null);
                }}
                className="rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800 hover:bg-blue-100"
              >
                Exit Restored Mode
              </button>
            </div>
          )}

          {savedBanner && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
              <span>{savedBanner}</span>
              <button
                type="button"
                onClick={() => navigate('/scenarios')}
                className="font-semibold underline hover:text-emerald-950"
              >
                Open Scenario Library
              </button>
            </div>
          )}

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

              <div className="flex flex-col items-start gap-2 sm:items-end">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={integerProd}
                      onChange={(e) => setIntegerProd(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                    Integer production quantities
                  </label>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                      modelTypeCue.kind === 'MILP'
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {modelTypeCue.badgeLabel}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 sm:text-right">{modelTypeCue.explanation}</p>
              </div>
            </div>

            {/* Capacity Scope & Modeling Cue */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <label
                    htmlFor="mp-capacity-scope"
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
                  >
                    Capacity Scope
                  </label>
                  <p className="mt-0.5 text-xs text-slate-600">{capacityScopeCue.description}</p>
                  {capacityScopeCue.resolvedNote && (
                    <p className="mt-0.5 text-[11px] font-medium text-blue-700">
                      {capacityScopeCue.resolvedNote}
                    </p>
                  )}
                </div>
                <select
                  id="mp-capacity-scope"
                  value={mpCapacityScope}
                  onChange={(e) => setMpCapacityScope(e.target.value as CapacityScopeValue)}
                  className="w-full shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none sm:w-48"
                >
                  {CAPACITY_SCOPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
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
                ).map(({ key, label }) => {
                  const selectedCol = mapping[key] ?? '';
                  const uniqueCount = selectedCol ? columnUniqueMap.get(selectedCol) : undefined;
                  return (
                    <div key={key}>
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-700">
                          {label}
                        </label>
                        {uniqueCount !== undefined && (
                          <span className="font-mono text-[11px] text-slate-500">
                            {uniqueCount} unique
                          </span>
                        )}
                      </div>
                      <select
                        value={selectedCol}
                        onChange={(e) =>
                          setMapping((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="">-- Select column --</option>
                        {columnNames.map((col) => {
                          const cnt = columnUniqueMap.get(col);
                          return (
                            <option key={col} value={col}>
                              {col}
                              {cnt !== undefined ? ` (${cnt} unique)` : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  );
                })}
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

              <button
                type="button"
                disabled={!mapping.product || !mapping.period || !mapping.demand}
                onClick={() => setSaveModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <BookmarkPlus className="h-4 w-4 text-blue-600" />
                Save Scenario
              </button>

              {!restoredScenario &&
                baselineMpSolution?.is_optimal &&
                baselineMpSolution.constraints_feasible && (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate('/sensitivity')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Sensitivity Analysis
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/trade-offs')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Trade-off Explorer
                    </button>
                  </>
                )}
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            {/* Mapping Validation Freshness */}
            <div
              className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-xs ${
                validationFreshness.status === 'modified'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : validationFreshness.status === 'validated'
                    ? validation?.valid
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-rose-200 bg-rose-50 text-rose-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              <span className="font-semibold">{validationFreshness.label}</span>
              <span>{validationFreshness.detail}</span>
            </div>

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
                <div className="flex max-w-full flex-wrap gap-1 overflow-x-auto sm:flex-nowrap">
                  {[
                    { id: 'results', label: 'Results & Schedule', icon: Table2 },
                    { id: 'graphs', label: 'Visualizations', icon: LineChart },
                    { id: 'formulation', label: 'Mathematical Formulation', icon: Sigma },
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id as typeof activeTab)}
                      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm ${
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
                  {/* Decision Intelligence Layer */}
                  <DecisionIntelligencePanel
                    solution={mpSolution}
                    mapping={mapping}
                    onSwitchTab={setActiveTab}
                    onFocusMapping={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  />

                  {/* Compact Solver Telemetry Strip (avoids repeating DecisionIntelligence KPIs) */}
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-xs shadow-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-500">Solver Status:</span>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 font-semibold ${
                          mpSolution.is_optimal
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {mpSolution.status}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-slate-500">Runtime:</span>{' '}
                      <span className="font-mono font-semibold text-slate-900">
                        {mpSolution.solve_time_seconds}s
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-slate-500">Constraint Verification:</span>{' '}
                      <span className="font-semibold text-slate-900">
                        {mpSolution.is_optimal
                          ? mpSolution.constraints_feasible
                            ? `Verified (max viol: ${mpSolution.max_constraint_violation})`
                            : `Violation: ${mpSolution.max_constraint_violation}`
                          : 'Not Feasible'}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-slate-500">Model Size:</span>{' '}
                      <span className="font-mono text-slate-800">
                        {mpSolution.variable_count} vars · {mpSolution.constraint_count} constraints
                      </span>
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
      <SaveScenarioModal
        isOpen={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        defaultName={
          restoredScenario
            ? `${restoredScenario.name} (Copy)`
            : dataset
            ? `Multi-Period (${dataset.filename})`
            : 'Multi-Period Scenario'
        }
        datasetId={dataset?.dataset_id ?? null}
        datasetName={dataset?.filename ?? null}
        activeSheet={dataset?.active_sheet ?? null}
        inputConfig={{
          mapping: cleanMapping(),
          integer_production: integerProd,
          allow_backlogging: false,
          capacity_scope: mpCapacityScope,
          demand_multiplier: restoredScenario?.input_config.demand_multiplier ?? 1.0,
          capacity_multiplier: restoredScenario?.input_config.capacity_multiplier ?? 1.0,
          production_cost_multiplier:
            restoredScenario?.input_config.production_cost_multiplier ?? 1.0,
          objective_sense: mpSolution?.objective_sense ?? 'Minimize',
        }}
        resultSnapshot={mpSolution}
        onSaved={(saved) =>
          setSavedBanner(`Scenario "${saved.name}" saved to Scenario Library.`)
        }
      />
    </div>
  );
};

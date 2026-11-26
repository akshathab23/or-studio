import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookmarkCheck,
  CheckCircle2,
  Edit3,
  Eye,
  FlaskConical,
  GitCompare,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  deleteScenario,
  fetchDatasetSummary,
  fetchScenarios,
  solveMultiPeriod,
  updateScenario,
} from '../api/client';
import { DecisionIntelligencePanel } from '../components/DecisionIntelligencePanel';
import { PlotlyChart } from '../components/PlotlyChart';
import { SaveScenarioModal } from '../components/SaveScenarioModal';
import { useStudio } from '../context/StudioContext';
import type { MultiPeriodSolveResponse, SavedScenarioDetail } from '../types/or';
import { buildScenarioComparison } from '../utils/scenarioComparison';

type TabId = 'library' | 'compare' | 'details';
type StatusFilter = 'all' | 'optimal' | 'infeasible' | 'unsolved';
type SortOption = 'newest' | 'oldest' | 'name_asc' | 'name_desc';

export const ScenariosPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    dataset,
    setDataset,
    setMpMapping,
    setMpCapacityScope,
    setMpIntegerProd,
    setRestoredScenario,
  } = useStudio();

  const [scenarios, setScenarios] = useState<SavedScenarioDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>('library');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeScenario, setActiveScenario] = useState<SavedScenarioDetail | null>(null);

  // Rename / edit metadata
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Live re-run in details
  const [rerunning, setRerunning] = useState(false);
  const [rerunResult, setRerunResult] = useState<MultiPeriodSolveResponse | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [updatingSnapshot, setUpdatingSnapshot] = useState(false);
  const [saveNewModalOpen, setSaveNewModalOpen] = useState(false);

  const loadScenarios = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchScenarios();
      setScenarios(list);
      setSelectedIds((prev) => prev.filter((id) => list.some((s) => s.id === id)));
      if (activeScenario) {
        const refreshed = list.find((s) => s.id === activeScenario.id) ?? null;
        setActiveScenario(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved scenarios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadScenarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredScenarios = useMemo(() => {
    let list = [...scenarios];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (s.dataset_name ?? '').toLowerCase().includes(q)
      );
    }
    if (statusFilter === 'optimal') {
      list = list.filter((s) => s.is_optimal);
    } else if (statusFilter === 'infeasible') {
      list = list.filter((s) => s.has_result_snapshot && !s.is_optimal);
    } else if (statusFilter === 'unsolved') {
      list = list.filter((s) => !s.has_result_snapshot);
    }

    list.sort((a, b) => {
      if (sortBy === 'newest') return b.created_at.localeCompare(a.created_at);
      if (sortBy === 'oldest') return a.created_at.localeCompare(b.created_at);
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
      return b.name.localeCompare(a.name);
    });
    return list;
  }, [scenarios, search, statusFilter, sortBy]);

  const selectedScenarios = useMemo(
    () => scenarios.filter((s) => selectedIds.includes(s.id)),
    [scenarios, selectedIds]
  );

  const comparison = useMemo(
    () => buildScenarioComparison(selectedScenarios),
    [selectedScenarios]
  );

  const toggleCompareSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  const handleOpenDetails = (sc: SavedScenarioDetail) => {
    setActiveScenario(sc);
    setRerunResult(null);
    setRerunError(null);
    setActiveTab('details');
  };

  const handleRestoreToWorkspace = async (
    sc: SavedScenarioDetail,
    target: 'multi-period' | 'what-if'
  ) => {
    setError(null);
    // Restore configuration without overwriting baseline mpSolution
    setMpMapping(sc.input_config.mapping);
    setMpIntegerProd(sc.input_config.integer_production);
    setMpCapacityScope(sc.input_config.capacity_scope);
    setRestoredScenario(sc);

    if (!sc.dataset_id) {
      setDataset(null);
    } else if (dataset?.dataset_id !== sc.dataset_id) {
      try {
        const ds = await fetchDatasetSummary(sc.dataset_id);
        setDataset(ds);
      } catch {
        // Dataset expired on backend restart; clear any unrelated active dataset to prevent mismatch
        setDataset(null);
      }
    }

    navigate(target === 'what-if' ? '/what-if' : '/multi-period');
  };

  const handleRerunScenario = async (sc: SavedScenarioDetail) => {
    if (!sc.dataset_id) {
      setRerunError('No dataset ID is linked to this scenario.');
      return;
    }
    setRerunning(true);
    setRerunError(null);
    setRerunResult(null);
    try {
      const res = await solveMultiPeriod(
        sc.dataset_id,
        sc.input_config.mapping,
        sc.input_config.integer_production,
        sc.input_config.capacity_scope,
        {
          demand_multiplier: sc.input_config.demand_multiplier,
          capacity_multiplier: sc.input_config.capacity_multiplier,
          production_cost_multiplier: sc.input_config.production_cost_multiplier,
        }
      );
      setRerunResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Re-optimization failed.';
      setRerunError(
        msg.includes('404') || msg.toLowerCase().includes('not found')
          ? 'The original uploaded dataset is no longer in active backend memory. Re-upload the dataset in Dataset Explorer to re-run this scenario.'
          : msg
      );
    } finally {
      setRerunning(false);
    }
  };

  const handleUpdateSavedSnapshot = async () => {
    if (!activeScenario || !rerunResult) return;
    setUpdatingSnapshot(true);
    setError(null);
    try {
      const updated = await updateScenario(activeScenario.id, {
        result_snapshot: rerunResult,
      });
      setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setActiveScenario(updated);
      setRerunResult(null);
      setNotice(`Updated saved result snapshot for "${updated.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update scenario snapshot.');
    } finally {
      setUpdatingSnapshot(false);
    }
  };

  const startEditing = (sc: SavedScenarioDetail) => {
    setEditingId(sc.id);
    setEditName(sc.name);
    setEditDesc(sc.description);
    setError(null);
  };

  const handleSaveEdit = async (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      setError('Scenario name cannot be empty.');
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const updated = await updateScenario(id, {
        name: trimmed,
        description: editDesc.trim(),
      });
      setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      if (activeScenario?.id === updated.id) setActiveScenario(updated);
      setEditingId(null);
      setNotice(`Renamed scenario to "${updated.name}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update scenario.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await deleteScenario(id);
      setScenarios((prev) => prev.filter((s) => s.id !== id));
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      if (activeScenario?.id === id) {
        setActiveScenario(null);
        setActiveTab('library');
      }
      setConfirmDeleteId(null);
      setNotice('Scenario deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete scenario.');
    } finally {
      setDeletingId(null);
    }
  };

  const fmtOpt = (v: number | null | undefined, dec = 2) =>
    v !== null && v !== undefined && Number.isFinite(v)
      ? v.toLocaleString(undefined, { maximumFractionDigits: dec })
      : 'N/A';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Layers className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900">Scenario Management</h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Save, organize, restore, re-optimize, and compare decision scenarios across solver runs.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadScenarios()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {[
          { id: 'library', label: `Scenario Library (${scenarios.length})`, icon: BookmarkCheck },
          {
            id: 'compare',
            label: `Compare Scenarios (${selectedIds.length}/4)`,
            icon: GitCompare,
          },
          ...(activeScenario
            ? [{ id: 'details', label: `Details: ${activeScenario.name}`, icon: Eye }]
            : []),
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id as TabId)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors sm:text-sm ${
              activeTab === id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="max-w-[200px] truncate">{label}</span>
          </button>
        ))}
      </div>

      {notice && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{notice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: SCENARIO LIBRARY */}
      {activeTab === 'library' && (
        <div className="space-y-4">
          {/* Controls bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search scenarios…"
                  className="w-48 rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none sm:w-64"
                />
              </div>

              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="optimal">Optimal Only</option>
                <option value="infeasible">Infeasible / Non-Optimal</option>
                <option value="unsolved">Config Only (Not Solved)</option>
              </select>

              <select
                aria-label="Sort scenarios"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="name_asc">Name (A–Z)</option>
                <option value="name_desc">Name (Z–A)</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              {selectedIds.length >= 2 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('compare')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700"
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  Compare Selected ({selectedIds.length})
                </button>
              )}
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Clear Selection
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-12 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              Loading saved scenarios…
            </div>
          ) : scenarios.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-xs">
              <BookmarkCheck className="mx-auto h-8 w-8 text-slate-300" />
              <h2 className="mt-3 text-sm font-semibold text-slate-900">No saved scenarios yet</h2>
              <p className="mt-1 text-xs text-slate-500">
                Run a Multi-Period Optimization or a What-If scenario, then click{' '}
                <span className="font-semibold text-slate-700">Save Scenario</span> to store it
                persistently.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate('/multi-period')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Open Multi-Period Optimization
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/what-if')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  Open What-If Lab
                </button>
              </div>
            </div>
          ) : filteredScenarios.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              No saved scenarios match your current search/filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filteredScenarios.map((sc) => {
                const isSelected = selectedIds.includes(sc.id);
                const disableSelect = !isSelected && selectedIds.length >= 4;
                const isEditing = editingId === sc.id;
                const isConfirmDelete = confirmDeleteId === sc.id;

                return (
                  <div
                    key={sc.id}
                    className={`flex flex-col justify-between rounded-xl border bg-white p-5 shadow-xs transition-all ${
                      isSelected ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={disableSelect}
                            onChange={() => toggleCompareSelect(sc.id)}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                            title={
                              disableSelect
                                ? 'Maximum 4 scenarios can be compared at once'
                                : 'Select for comparison'
                            }
                          />
                          <div>
                            <div className="text-sm font-bold text-slate-900">{sc.name}</div>
                            <div className="mt-0.5 text-[11px] text-slate-500">
                              Saved {new Date(sc.created_at).toLocaleString()}
                              {sc.dataset_name ? ` · ${sc.dataset_name}` : ''}
                            </div>
                          </div>
                        </label>

                        <span
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            !sc.has_result_snapshot
                              ? 'bg-slate-100 text-slate-600'
                              : sc.is_optimal
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {sc.status}
                        </span>
                      </div>

                      {sc.description && !isEditing && (
                        <p className="mt-2 text-xs text-slate-600">{sc.description}</p>
                      )}

                      {isEditing && (
                        <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="Scenario name"
                            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold"
                          />
                          <textarea
                            rows={2}
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            placeholder="Description"
                            className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={savingEdit}
                              onClick={() => void handleSaveEdit(sc.id)}
                              className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {savingEdit ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Key metadata strip */}
                      <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 text-xs">
                        <div>
                          <div className="text-[10px] font-semibold uppercase text-slate-400">
                            Objective ({sc.objective_sense})
                          </div>
                          <div className="font-mono font-bold text-slate-900">
                            {sc.is_optimal ? fmtOpt(sc.objective_value) : 'N/A'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase text-slate-400">
                            Mode
                          </div>
                          <div className="font-semibold text-slate-700">
                            {sc.input_config.integer_production ? 'MILP' : 'LP'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase text-slate-400">
                            Multipliers (D / C / P)
                          </div>
                          <div className="font-mono text-[11px] text-slate-700">
                            {sc.input_config.demand_multiplier.toFixed(2)} /{' '}
                            {sc.input_config.capacity_multiplier.toFixed(2)} /{' '}
                            {sc.input_config.production_cost_multiplier.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        onClick={() => handleOpenDetails(sc)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Details
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleRestoreToWorkspace(sc, 'multi-period')}
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restore
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          handleOpenDetails(sc);
                          void handleRerunScenario(sc);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Play className="h-3.5 w-3.5 text-blue-600" />
                        Re-Run
                      </button>

                      <button
                        type="button"
                        onClick={() => startEditing(sc)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Rename
                      </button>

                      {!isConfirmDelete ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(sc.id)}
                          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      ) : (
                        <div className="ml-auto flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={deletingId === sc.id}
                            onClick={() => void handleDelete(sc.id)}
                            className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                          >
                            {deletingId === sc.id ? 'Deleting…' : 'Confirm Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: COMPARE SCENARIOS */}
      {activeTab === 'compare' && (
        <div className="space-y-5">
          {selectedScenarios.length < 2 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <GitCompare className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">
                Select 2 to 4 scenarios to compare
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Use the checkboxes in the Scenario Library to pick up to 4 scenarios for side-by-side
                comparison.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('library')}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Go to Scenario Library
              </button>
            </div>
          ) : (
            <>
              {/* Preferred & Trade-off Banner */}
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-blue-800">
                  Comparison &amp; Trade-Off Analysis
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {comparison.preferredNote}
                </p>
                {comparison.tradeOffNotes.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-slate-700">
                    {comparison.tradeOffNotes.map((note, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Comparison Table */}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Metric</th>
                        {comparison.rows.map((r) => (
                          <th key={r.id} className="px-4 py-3 font-semibold text-slate-900">
                            {r.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">Solver Status</td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                r.status === 'Not Solved'
                                  ? 'bg-slate-100 text-slate-600'
                                  : r.isOptimal
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-rose-50 text-rose-700'
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">
                          Objective Sense
                        </td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 text-slate-800">
                            {r.objectiveSense}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">
                          Objective Value
                        </td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 font-mono font-bold text-slate-900">
                            {fmtOpt(r.objectiveValue)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">
                          Multipliers (Dem / Cap / Cost)
                        </td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 font-mono text-slate-700">
                            ×{r.demandMultiplier.toFixed(2)} / ×{r.capacityMultiplier.toFixed(2)} /
                            ×{r.productionCostMultiplier.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">
                          Total Production
                        </td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 font-mono text-slate-800">
                            {fmtOpt(r.totalProduction)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">Total Demand</td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 font-mono text-slate-800">
                            {fmtOpt(r.totalDemand)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">
                          Ending Inventory
                        </td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 font-mono text-slate-800">
                            {fmtOpt(r.totalEndingInventory)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">
                          Peak Resource Util %
                        </td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 font-mono text-slate-800">
                            {r.peakUtilizationPct !== null
                              ? `${r.peakUtilizationPct.toFixed(1)}%`
                              : 'N/A'}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">
                          Production Cost
                        </td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 font-mono text-slate-800">
                            {fmtOpt(r.productionCost)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">
                          Inventory Cost
                        </td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 font-mono text-slate-800">
                            {fmtOpt(r.inventoryCost)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 font-semibold text-slate-600">Setup Cost</td>
                        {comparison.rows.map((r) => (
                          <td key={r.id} className="px-4 py-2.5 font-mono text-slate-800">
                            {fmtOpt(r.setupCost)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Comparison Charts (only compatible feasible scenarios) */}
              {comparison.compatibleStructure &&
                comparison.rows.some((r) => r.isOptimal && r.objectiveValue !== null) && (
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                      <h3 className="mb-2 text-sm font-semibold text-slate-900">
                        Objective Value Comparison ({comparison.objectiveSenses[0]})
                      </h3>
                      <PlotlyChart
                        height={280}
                        data={[
                          {
                            x: comparison.rows
                              .filter((r) => r.isOptimal && r.objectiveValue !== null)
                              .map((r) => r.name),
                            y: comparison.rows
                              .filter((r) => r.isOptimal && r.objectiveValue !== null)
                              .map((r) => r.objectiveValue),
                            type: 'bar',
                            marker: { color: '#2563eb' },
                            text: comparison.rows
                              .filter((r) => r.isOptimal && r.objectiveValue !== null)
                              .map((r) => fmtOpt(r.objectiveValue)),
                            textposition: 'outside',
                            cliponaxis: false,
                          },
                        ]}
                        layout={{
                          margin: { t: 24, r: 16, b: 56, l: 64 },
                          xaxis: { automargin: true },
                          yaxis: { title: 'Objective Value', automargin: true },
                        }}
                      />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                      <h3 className="mb-2 text-sm font-semibold text-slate-900">
                        Production vs. Demand (Feasible Scenarios)
                      </h3>
                      <PlotlyChart
                        height={280}
                        data={[
                          {
                            x: comparison.rows
                              .filter((r) => r.isOptimal)
                              .map((r) => r.name),
                            y: comparison.rows
                              .filter((r) => r.isOptimal)
                              .map((r) => r.totalProduction ?? 0),
                            name: 'Total Production',
                            type: 'bar',
                            marker: { color: '#2563eb' },
                          },
                          {
                            x: comparison.rows
                              .filter((r) => r.isOptimal)
                              .map((r) => r.name),
                            y: comparison.rows
                              .filter((r) => r.isOptimal)
                              .map((r) => r.totalDemand ?? 0),
                            name: 'Total Demand',
                            type: 'bar',
                            marker: { color: '#94a3b8' },
                          },
                        ]}
                        layout={{
                          barmode: 'group',
                          margin: { t: 36, r: 16, b: 56, l: 64 },
                          legend: {
                            orientation: 'h',
                            x: 0,
                            y: 1.02,
                            xanchor: 'left',
                            yanchor: 'bottom',
                          },
                          xaxis: { automargin: true },
                          yaxis: { title: 'Units', automargin: true },
                        }}
                      />
                    </div>
                  </div>
                )}
            </>
          )}
        </div>
      )}

      {/* TAB 3: SCENARIO DETAILS & RE-OPTIMIZE */}
      {activeTab === 'details' && activeScenario && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{activeScenario.name}</h2>
                {activeScenario.description && (
                  <p className="mt-1 text-xs text-slate-600">{activeScenario.description}</p>
                )}
                <div className="mt-1.5 text-xs text-slate-500">
                  Saved {new Date(activeScenario.created_at).toLocaleString()} · Dataset:{' '}
                  {activeScenario.dataset_name ?? 'N/A'}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleRestoreToWorkspace(activeScenario, 'multi-period')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore to Multi-Period
                </button>
                <button
                  type="button"
                  disabled={rerunning}
                  onClick={() => void handleRerunScenario(activeScenario)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {rerunning ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  {rerunning ? 'Re-Optimizing…' : 'Re-Run Solver'}
                </button>
              </div>
            </div>

            {/* Saved Input Configuration */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
              <div className="mb-2 font-semibold uppercase tracking-wider text-slate-500">
                Saved Input Configuration
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <span className="text-slate-500">Mode:</span>{' '}
                  <span className="font-semibold text-slate-900">
                    {activeScenario.input_config.integer_production ? 'MILP (Integer)' : 'LP'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Capacity Scope:</span>{' '}
                  <span className="font-semibold text-slate-900">
                    {activeScenario.input_config.capacity_scope}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Demand Mult:</span>{' '}
                  <span className="font-mono font-bold text-slate-900">
                    ×{activeScenario.input_config.demand_multiplier.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Cap / Cost Mult:</span>{' '}
                  <span className="font-mono font-bold text-slate-900">
                    ×{activeScenario.input_config.capacity_multiplier.toFixed(2)} / ×
                    {activeScenario.input_config.production_cost_multiplier.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-slate-600">
                Mapped Columns: Product=<code>{activeScenario.input_config.mapping.product}</code>,
                Period=<code>{activeScenario.input_config.mapping.period}</code>, Demand=
                <code>{activeScenario.input_config.mapping.demand}</code>
                {activeScenario.input_config.mapping.capacity
                  ? `, Capacity=${activeScenario.input_config.mapping.capacity}`
                  : ''}
                {activeScenario.input_config.mapping.production_cost
                  ? `, ProdCost=${activeScenario.input_config.mapping.production_cost}`
                  : ''}
              </div>
            </div>
          </div>

          {rerunError && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span>{rerunError}</span>
            </div>
          )}

          {rerunResult && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
              <div>
                <span className="font-semibold">Live Re-Optimization Complete:</span>{' '}
                {rerunResult.status}
                {rerunResult.objective_value !== null
                  ? ` · Objective: ${rerunResult.objective_value.toLocaleString()}`
                  : ''}
                . Your saved snapshot has NOT been overwritten.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={updatingSnapshot}
                  onClick={() => void handleUpdateSavedSnapshot()}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {updatingSnapshot ? 'Updating…' : 'Update Saved Snapshot'}
                </button>
                <button
                  type="button"
                  onClick={() => setSaveNewModalOpen(true)}
                  className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
                >
                  Save as New Version
                </button>
              </div>
            </div>
          )}

          {/* Decision Intelligence Reuse */}
          {(rerunResult ?? activeScenario.result_snapshot) ? (
            <DecisionIntelligencePanel
              solution={(rerunResult ?? activeScenario.result_snapshot)!}
              mapping={activeScenario.input_config.mapping}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">
              This scenario stores only input configuration (no saved result snapshot). Click{' '}
              <span className="font-semibold text-slate-700">Re-Run Solver</span> above to execute
              it with the actual solver.
            </div>
          )}
        </div>
      )}

      {activeScenario && (
        <SaveScenarioModal
          isOpen={saveNewModalOpen}
          onClose={() => setSaveNewModalOpen(false)}
          defaultName={`${activeScenario.name} (Re-run)`}
          datasetId={activeScenario.dataset_id}
          datasetName={activeScenario.dataset_name}
          activeSheet={activeScenario.active_sheet}
          inputConfig={activeScenario.input_config}
          resultSnapshot={rerunResult ?? activeScenario.result_snapshot}
          onSaved={(saved) => {
            setScenarios((prev) => [saved, ...prev]);
            setActiveScenario(saved);
            setRerunResult(null);
            setNotice(`Saved new scenario "${saved.name}".`);
          }}
        />
      )}
    </div>
  );
};

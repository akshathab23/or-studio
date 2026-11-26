import React, { useEffect, useState } from 'react';
import { AlertCircle, BookmarkPlus, CheckCircle2, Loader2, X } from 'lucide-react';
import { saveScenario } from '../api/client';
import type {
  MultiPeriodSolveResponse,
  SavedScenarioDetail,
  ScenarioInputConfig,
} from '../types/or';

interface SaveScenarioModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultName?: string;
  datasetId: string | null;
  datasetName: string | null;
  activeSheet: string | null;
  inputConfig: ScenarioInputConfig;
  resultSnapshot: MultiPeriodSolveResponse | null;
  onSaved?: (saved: SavedScenarioDetail) => void;
}

export const SaveScenarioModal: React.FC<SaveScenarioModalProps> = ({
  isOpen,
  onClose,
  defaultName = '',
  datasetId,
  datasetName,
  activeSheet,
  inputConfig,
  resultSnapshot,
  onSaved,
}) => {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setDescription('');
      setError(null);
      setSaving(false);
    }
  }, [isOpen, defaultName]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a valid scenario name.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = await saveScenario({
        name: trimmed,
        description: description.trim(),
        module: 'multi-period',
        dataset_id: datasetId,
        dataset_name: datasetName,
        active_sheet: activeSheet,
        input_config: inputConfig,
        result_snapshot: resultSnapshot,
      });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save scenario.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-scenario-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <BookmarkPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 id="save-scenario-title" className="text-base font-bold text-slate-900">
                Save Scenario
              </h2>
              <p className="text-xs text-slate-500">
                Persists input configuration and any available solver snapshot without altering your
                baseline.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close save dialog"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="scenario-name-input"
              className="mb-1 block text-xs font-semibold text-slate-700"
            >
              Scenario Name *
            </label>
            <input
              id="scenario-name-input"
              type="text"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q4 Demand Surge +20%"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="scenario-desc-input"
              className="mb-1 block text-xs font-semibold text-slate-700"
            >
              Description (Optional)
            </label>
            <textarea
              id="scenario-desc-input"
              rows={2}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Document key assumptions or business context…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Configuration vs Snapshot preview */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
            <div className="font-semibold text-slate-800">What will be saved:</div>
            <div className="text-slate-600">
              <span className="font-medium text-slate-700">Input Configuration:</span>{' '}
              {datasetName ?? 'Dataset'} · {inputConfig.integer_production ? 'MILP' : 'LP'} · Demand
              ×{inputConfig.demand_multiplier.toFixed(2)}, Capacity ×
              {inputConfig.capacity_multiplier.toFixed(2)}, Prod Cost ×
              {inputConfig.production_cost_multiplier.toFixed(2)}
            </div>
            <div className="flex items-center gap-1.5 text-slate-600">
              <span className="font-medium text-slate-700">Result Snapshot:</span>
              {resultSnapshot ? (
                <span
                  className={`inline-flex items-center gap-1 font-semibold ${
                    resultSnapshot.is_optimal ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {resultSnapshot.is_optimal ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5" />
                  )}
                  {resultSnapshot.status}
                  {resultSnapshot.objective_value !== null
                    ? ` (Obj: ${resultSnapshot.objective_value.toLocaleString()})`
                    : ''}
                </span>
              ) : (
                <span className="text-slate-500">None (input configuration only)</span>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <BookmarkPlus className="h-3.5 w-3.5" />
              )}
              {saving ? 'Saving…' : 'Save Scenario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

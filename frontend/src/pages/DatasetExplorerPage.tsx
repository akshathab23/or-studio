import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, CloudDownload, Database, ExternalLink, Info, Upload } from 'lucide-react';
import { ApiError, deleteDataset, selectDatasetSheet, uploadDataset } from '../api/client';
import { DatasetPreview } from '../components/DatasetPreview';
import { DatasetUploader } from '../components/DatasetUploader';
import { PublicDatasetImporter } from '../components/PublicDatasetImporter';
import { useStudio } from '../context/StudioContext';

export const DatasetExplorerPage: React.FC = () => {
  const navigate = useNavigate();
  const { dataset, setDataset, setPublicImport, setMpMapping, setMpSolution } = useStudio();
  const [sourceMode, setSourceMode] = useState<'upload' | 'public'>('upload');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ message: string; isInUse: boolean } | null>(null);

  const handleUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    setRemoveError(null);
    try {
      const summary = await uploadDataset(file);
      setDataset(summary);
      setPublicImport(null);
      setMpMapping(null);
      setMpSolution(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload dataset.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSheet = async (sheetName: string) => {
    if (!dataset) return;
    setLoading(true);
    setError(null);
    setRemoveError(null);
    try {
      const updated = await selectDatasetSheet(dataset.dataset_id, sheetName);
      setDataset(updated);
      setPublicImport(null);
      setMpMapping(null);
      setMpSolution(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch Excel sheet.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!dataset) return;
    setLoading(true);
    setRemoveError(null);
    try {
      await deleteDataset(dataset.dataset_id);
      setDataset(null);
      setPublicImport(null);
      setMpMapping(null);
      setMpSolution(null);
    } catch (err) {
      const isInUse = err instanceof ApiError && err.status === 409;
      setRemoveError({
        message: err instanceof Error ? err.message : 'Failed to remove dataset.',
        isInUse,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <Database className="h-5 w-5 text-blue-600" />
            <h1 className="text-xl font-bold text-slate-900">Dataset Explorer</h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Upload local CSV/Excel files or import real-world public datasets with automatic
            optimization preparation.
          </p>
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setSourceMode('upload')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              sourceMode === 'upload'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload Local File
          </button>
          <button
            type="button"
            onClick={() => setSourceMode('public')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              sourceMode === 'public'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CloudDownload className="h-3.5 w-3.5" />
            Import Real Dataset
          </button>
        </div>
      </div>

      {sourceMode === 'upload' ? (
        <>
          {/* Candidate Research Dataset Info */}
          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-xs text-slate-700">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <div>
              <span className="font-semibold text-slate-900">Candidate Research Dataset:</span>{' '}
              Tablets Manufacturing Processes (Multi-level, multi-item capacitated lot-sizing) on
              Mendeley Data (
              <a
                href="https://data.mendeley.com/datasets/wt4s58xwj3/4"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 break-all font-medium text-blue-700 underline"
              >
                data.mendeley.com/datasets/wt4s58xwj3/4
                <ExternalLink className="h-3 w-3" />
              </a>
              ). Download the dataset file locally and upload it below; OR Studio never fabricates
              datasets or silently substitutes missing values.
            </div>
          </div>

          <DatasetUploader onFileSelected={handleUpload} loading={loading} error={error} />
        </>
      ) : (
        <PublicDatasetImporter />
      )}

      {dataset ? (
        <div className="space-y-4">
          {removeError && (
            <div
              role="alert"
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-5 py-3.5 text-xs text-rose-900 shadow-xs"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <div>
                  <div className="font-semibold">
                    {removeError.isInUse
                      ? 'Dataset retained — referenced by saved scenarios'
                      : 'Unable to remove dataset'}
                  </div>
                  <div className="mt-0.5 text-rose-800">{removeError.message}</div>
                </div>
              </div>
              {removeError.isInUse && (
                <button
                  type="button"
                  onClick={() => navigate('/scenarios')}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                >
                  Open Scenario Library
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {!loading && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-5 py-3.5 shadow-xs">
              <div className="text-xs text-slate-700">
                <span className="font-semibold text-slate-900">Dataset ready:</span>{' '}
                <span className="font-medium">{dataset.filename}</span> ({dataset.row_count.toLocaleString()}{' '}
                rows, {dataset.column_count} columns). Proceed to map parameters and solve.
              </div>
              <button
                type="button"
                onClick={() => navigate('/multi-period')}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-blue-700"
              >
                Next: Configure &amp; Solve
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <DatasetPreview
            dataset={dataset}
            onSelectSheet={handleSelectSheet}
            onRemoveDataset={handleRemove}
            loading={loading}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-xs">
          <p className="text-sm font-medium text-slate-700">No dataset currently loaded</p>
          <p className="mt-1 text-xs text-slate-500">
            Upload a <span className="font-mono">.csv</span> or{' '}
            <span className="font-mono">.xlsx</span> file above to inspect its structure.
          </p>
        </div>
      )}
    </div>
  );
};

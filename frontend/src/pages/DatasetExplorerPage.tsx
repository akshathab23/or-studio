import React, { useState } from 'react';
import { Database, ExternalLink, Info } from 'lucide-react';
import { deleteDataset, selectDatasetSheet, uploadDataset } from '../api/client';
import { DatasetPreview } from '../components/DatasetPreview';
import { DatasetUploader } from '../components/DatasetUploader';
import { useStudio } from '../context/StudioContext';

export const DatasetExplorerPage: React.FC = () => {
  const { dataset, setDataset, setMpMapping, setMpSolution } = useStudio();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const summary = await uploadDataset(file);
      setDataset(summary);
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
    try {
      const updated = await selectDatasetSheet(dataset.dataset_id, sheetName);
      setDataset(updated);
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
    setError(null);
    try {
      await deleteDataset(dataset.dataset_id);
      setDataset(null);
      setMpMapping(null);
      setMpSolution(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove dataset.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <Database className="h-5 w-5 text-blue-600" />
          <h1 className="text-xl font-bold text-slate-900">Dataset Explorer</h1>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          Upload CSV or Excel (.xlsx) datasets to inspect columns, data types, missing values, and
          numerical statistics before mapping to an optimization model.
        </p>
      </div>

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
            className="inline-flex items-center gap-1 font-medium text-blue-700 underline"
          >
            data.mendeley.com/datasets/wt4s58xwj3/4
            <ExternalLink className="h-3 w-3" />
          </a>
          ). Download the dataset file locally and upload it below; OR Studio never fabricates
          datasets or silently substitutes missing values.
        </div>
      </div>

      <DatasetUploader onFileSelected={handleUpload} loading={loading} error={error} />

      {dataset ? (
        <DatasetPreview
          dataset={dataset}
          onSelectSheet={handleSelectSheet}
          onRemoveDataset={handleRemove}
          loading={loading}
        />
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

import React, { useRef, useState } from 'react';
import { AlertCircle, Loader2, Upload } from 'lucide-react';

interface DatasetUploaderProps {
  onFileSelected: (file: File) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export const DatasetUploader: React.FC<DatasetUploaderProps> = ({
  onFileSelected,
  loading,
  error,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    void onFileSelected(files[0]);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !loading && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragActive
            ? 'border-blue-500 bg-blue-50/50'
            : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50/60'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {loading ? (
          <>
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-blue-600" />
            <p className="text-sm font-medium text-slate-800">Parsing dataset...</p>
            <p className="mt-1 text-xs text-slate-500">
              Detecting columns, data types, missing values, and numerical statistics
            </p>
          </>
        ) : (
          <>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Upload className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-slate-900">
              Click to upload or drag & drop a dataset
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Supports <span className="font-mono">.csv</span> and Excel{' '}
              <span className="font-mono">.xlsx</span> workbooks (multi-sheet supported)
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

import React, { createContext, useContext, useEffect, useState } from 'react';
import type {
  DatasetSummary,
  GoalProgrammingSolveResponse,
  MCDMSolveResponse,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  PublicDatasetImportResponse,
  SolutionHistoryItem,
} from '../types/or';

interface StudioContextValue {
  dataset: DatasetSummary | null;
  setDataset: (ds: DatasetSummary | null) => void;
  publicImport: PublicDatasetImportResponse | null;
  setPublicImport: (imp: PublicDatasetImportResponse | null) => void;
  mpMapping: MultiPeriodColumnMapping | null;
  setMpMapping: (m: MultiPeriodColumnMapping | null) => void;
  mpCapacityScope: 'auto' | 'per_product' | 'aggregate_period';
  setMpCapacityScope: (s: 'auto' | 'per_product' | 'aggregate_period') => void;
  mpIntegerProd: boolean;
  setMpIntegerProd: (v: boolean) => void;
  mpSolution: MultiPeriodSolveResponse | null;
  setMpSolution: (s: MultiPeriodSolveResponse | null) => void;
  gpSolution: GoalProgrammingSolveResponse | null;
  setGpSolution: (s: GoalProgrammingSolveResponse | null) => void;
  mcdmSolution: MCDMSolveResponse | null;
  setMcdmSolution: (s: MCDMSolveResponse | null) => void;
  history: SolutionHistoryItem[];
  addHistoryItem: (item: Omit<SolutionHistoryItem, 'id' | 'timestamp'>) => void;
  clearHistory: () => void;
}

const HISTORY_KEY = 'or_studio_history_v1';

const StudioContext = createContext<StudioContextValue | undefined>(undefined);

export const StudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [publicImport, setPublicImport] = useState<PublicDatasetImportResponse | null>(null);
  const [mpMapping, setMpMapping] = useState<MultiPeriodColumnMapping | null>(null);
  const [mpCapacityScope, setMpCapacityScope] = useState<
    'auto' | 'per_product' | 'aggregate_period'
  >('auto');
  const [mpIntegerProd, setMpIntegerProd] = useState<boolean>(false);
  const [mpSolution, setMpSolution] = useState<MultiPeriodSolveResponse | null>(null);
  const [gpSolution, setGpSolution] = useState<GoalProgrammingSolveResponse | null>(null);
  const [mcdmSolution, setMcdmSolution] = useState<MCDMSolveResponse | null>(null);
  const [history, setHistory] = useState<SolutionHistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? (JSON.parse(raw) as SolutionHistoryItem[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
    } catch {
      // ignore storage quota errors
    }
  }, [history]);

  const addHistoryItem = (item: Omit<SolutionHistoryItem, 'id' | 'timestamp'>) => {
    const entry: SolutionHistoryItem = {
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    setHistory((prev) => [entry, ...prev]);
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <StudioContext.Provider
      value={{
        dataset,
        setDataset,
        publicImport,
        setPublicImport,
        mpMapping,
        setMpMapping,
        mpCapacityScope,
        setMpCapacityScope,
        mpIntegerProd,
        setMpIntegerProd,
        mpSolution,
        setMpSolution,
        gpSolution,
        setGpSolution,
        mcdmSolution,
        setMcdmSolution,
        history,
        addHistoryItem,
        clearHistory,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
};

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) {
    throw new Error('useStudio must be used inside StudioProvider');
  }
  return ctx;
}

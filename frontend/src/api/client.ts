import type {
  DatasetSummary,
  GoalProgrammingSolveRequest,
  GoalProgrammingSolveResponse,
  MCDMCriterion,
  MCDMAlternative,
  MCDMSolveResponse,
  MappingValidationResponse,
  MultiPeriodColumnMapping,
  MultiPeriodSolveResponse,
  PublicDatasetCatalogItem,
  PublicDatasetImportRequest,
  PublicDatasetImportResponse,
} from '../types/or';

const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';
const normalizedBase = rawBase.replace(/\/+$/, '');
const API_BASE = normalizedBase
  ? normalizedBase.endsWith('/api')
    ? normalizedBase
    : `${normalizedBase}/api`
  : '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `Request failed with status ${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) {
        detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
      }
    } catch {
      // ignore JSON parse failure
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function uploadDataset(file: File): Promise<DatasetSummary> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/datasets/upload`, {
    method: 'POST',
    body: form,
  });
  return handleResponse<DatasetSummary>(res);
}

export async function selectDatasetSheet(
  datasetId: string,
  sheetName: string
): Promise<DatasetSummary> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/sheet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheet_name: sheetName }),
  });
  return handleResponse<DatasetSummary>(res);
}

export async function fetchDatasetPreview(
  datasetId: string,
  offset = 0,
  limit = 50
): Promise<{ rows: Record<string, unknown>[]; total_rows: number }> {
  const res = await fetch(
    `${API_BASE}/datasets/${datasetId}/preview?offset=${offset}&limit=${limit}`
  );
  return handleResponse(res);
}

export async function deleteDataset(datasetId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}`, {
    method: 'DELETE',
  });
  await handleResponse(res);
}

export async function validateMultiPeriodMapping(
  datasetId: string,
  mapping: MultiPeriodColumnMapping
): Promise<MappingValidationResponse> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/validate-mapping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapping),
  });
  return handleResponse<MappingValidationResponse>(res);
}

export async function solveMultiPeriod(
  datasetId: string,
  mapping: MultiPeriodColumnMapping,
  integerProduction: boolean,
  capacityScope: 'auto' | 'per_product' | 'aggregate_period' = 'auto'
): Promise<MultiPeriodSolveResponse> {
  const res = await fetch(`${API_BASE}/solve/multi-period`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataset_id: datasetId,
      mapping,
      integer_production: integerProduction,
      capacity_scope: capacityScope,
    }),
  });
  return handleResponse<MultiPeriodSolveResponse>(res);
}

export async function fetchPublicDatasets(): Promise<PublicDatasetCatalogItem[]> {
  const res = await fetch(`${API_BASE}/public-datasets`);
  return handleResponse<PublicDatasetCatalogItem[]>(res);
}

export async function importPublicDataset(
  req: PublicDatasetImportRequest
): Promise<PublicDatasetImportResponse> {
  const res = await fetch(`${API_BASE}/public-datasets/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return handleResponse<PublicDatasetImportResponse>(res);
}

export async function solveGoalProgramming(
  req: GoalProgrammingSolveRequest
): Promise<GoalProgrammingSolveResponse> {
  const res = await fetch(`${API_BASE}/solve/goal-programming`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return handleResponse<GoalProgrammingSolveResponse>(res);
}

export async function solveMCDM(
  method: 'topsis' | 'wsm',
  criteria: MCDMCriterion[],
  alternatives: MCDMAlternative[]
): Promise<MCDMSolveResponse> {
  const res = await fetch(`${API_BASE}/solve/mcdm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, criteria, alternatives }),
  });
  return handleResponse<MCDMSolveResponse>(res);
}

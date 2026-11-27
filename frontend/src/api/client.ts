import type {
  DatasetListItem,
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
  SavedScenarioDetail,
  ScenarioCreateRequest,
  ScenarioReattachRequest,
  ScenarioUpdateRequest,
  SensitivitySweepRequest,
  SensitivitySweepResponse,
  TradeoffExploreRequest,
  TradeoffExploreResponse,
} from '../types/or';

const rawBase = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';
const normalizedBase = rawBase.replace(/\/+$/, '');
const withProtocol =
  normalizedBase && !/^https?:\/\//i.test(normalizedBase)
    ? `https://${normalizedBase}`
    : normalizedBase;
const API_BASE = withProtocol
  ? withProtocol.endsWith('/api')
    ? withProtocol
    : `${withProtocol}/api`
  : '/api';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const LONG_REQUEST_TIMEOUT_MS = 90_000;

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class RequestTimeoutError extends Error {
  timeoutMs: number;

  constructor(timeoutMs: number) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    super(
      `The request timed out after ${seconds} seconds. The server may be busy or starting up — please try again.`
    );
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class RequestCancelledError extends Error {
  constructor(message = 'The request was cancelled.') {
    super(message);
    this.name = 'RequestCancelledError';
  }
}

export function isRequestCancelledError(err: unknown): boolean {
  return err instanceof RequestCancelledError;
}

function isAbortLikeError(err: unknown): boolean {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') {
    return true;
  }
  return err instanceof Error && err.name === 'AbortError';
}

export async function requestWithTimeout<T>(
  url: string,
  init: RequestInit = {},
  options: RequestOptions = {},
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const externalSignal = options.signal;

  if (externalSignal?.aborted) {
    throw new RequestCancelledError();
  }

  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => {
    controller.abort();
  };

  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const res = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    return await handleResponse<T>(res);
  } catch (err) {
    if (timedOut) {
      throw new RequestTimeoutError(timeoutMs);
    }
    if (externalSignal?.aborted || isAbortLikeError(err)) {
      throw new RequestCancelledError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

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
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

export async function uploadDataset(
  file: File,
  options?: RequestOptions
): Promise<DatasetSummary> {
  const form = new FormData();
  form.append('file', file);
  return requestWithTimeout<DatasetSummary>(
    `${API_BASE}/datasets/upload`,
    { method: 'POST', body: form },
    options
  );
}

export async function selectDatasetSheet(
  datasetId: string,
  sheetName: string,
  options?: RequestOptions
): Promise<DatasetSummary> {
  return requestWithTimeout<DatasetSummary>(
    `${API_BASE}/datasets/${datasetId}/sheet`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_name: sheetName }),
    },
    options
  );
}

export async function fetchDatasetPreview(
  datasetId: string,
  offset = 0,
  limit = 50,
  options?: RequestOptions
): Promise<{ rows: Record<string, unknown>[]; total_rows: number }> {
  return requestWithTimeout(
    `${API_BASE}/datasets/${datasetId}/preview?offset=${offset}&limit=${limit}`,
    {},
    options
  );
}

export async function deleteDataset(datasetId: string, options?: RequestOptions): Promise<void> {
  await requestWithTimeout(
    `${API_BASE}/datasets/${datasetId}`,
    { method: 'DELETE' },
    options
  );
}

export async function validateMultiPeriodMapping(
  datasetId: string,
  mapping: MultiPeriodColumnMapping,
  options?: RequestOptions
): Promise<MappingValidationResponse> {
  return requestWithTimeout<MappingValidationResponse>(
    `${API_BASE}/datasets/${datasetId}/validate-mapping`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapping),
    },
    options
  );
}

export async function solveMultiPeriod(
  datasetId: string,
  mapping: MultiPeriodColumnMapping,
  integerProduction: boolean,
  capacityScope: 'auto' | 'per_product' | 'aggregate_period' = 'auto',
  multipliers?: {
    demand_multiplier?: number;
    capacity_multiplier?: number;
    production_cost_multiplier?: number;
    sheet_name?: string | null;
  },
  options?: RequestOptions
): Promise<MultiPeriodSolveResponse> {
  return requestWithTimeout<MultiPeriodSolveResponse>(
    `${API_BASE}/solve/multi-period`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataset_id: datasetId,
        mapping,
        integer_production: integerProduction,
        capacity_scope: capacityScope,
        ...(multipliers?.sheet_name ? { sheet_name: multipliers.sheet_name } : {}),
        ...(multipliers?.demand_multiplier !== undefined
          ? { demand_multiplier: multipliers.demand_multiplier }
          : {}),
        ...(multipliers?.capacity_multiplier !== undefined
          ? { capacity_multiplier: multipliers.capacity_multiplier }
          : {}),
        ...(multipliers?.production_cost_multiplier !== undefined
          ? { production_cost_multiplier: multipliers.production_cost_multiplier }
          : {}),
      }),
    },
    options
  );
}

export async function fetchPublicDatasets(
  options?: RequestOptions
): Promise<PublicDatasetCatalogItem[]> {
  return requestWithTimeout<PublicDatasetCatalogItem[]>(`${API_BASE}/public-datasets`, {}, options);
}

export async function importPublicDataset(
  req: PublicDatasetImportRequest,
  options?: RequestOptions
): Promise<PublicDatasetImportResponse> {
  return requestWithTimeout<PublicDatasetImportResponse>(
    `${API_BASE}/public-datasets/import`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
    { timeoutMs: LONG_REQUEST_TIMEOUT_MS, ...options }
  );
}

export async function solveGoalProgramming(
  req: GoalProgrammingSolveRequest,
  options?: RequestOptions
): Promise<GoalProgrammingSolveResponse> {
  return requestWithTimeout<GoalProgrammingSolveResponse>(
    `${API_BASE}/solve/goal-programming`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
    options
  );
}

export async function solveMCDM(
  method: 'topsis' | 'wsm',
  criteria: MCDMCriterion[],
  alternatives: MCDMAlternative[],
  options?: RequestOptions
): Promise<MCDMSolveResponse> {
  return requestWithTimeout<MCDMSolveResponse>(
    `${API_BASE}/solve/mcdm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, criteria, alternatives }),
    },
    options
  );
}

export async function fetchDatasetSummary(
  datasetId: string,
  options?: RequestOptions
): Promise<DatasetSummary> {
  return requestWithTimeout<DatasetSummary>(`${API_BASE}/datasets/${datasetId}`, {}, options);
}

export async function fetchDatasets(options?: RequestOptions): Promise<DatasetListItem[]> {
  return requestWithTimeout<DatasetListItem[]>(`${API_BASE}/datasets`, {}, options);
}

export async function fetchScenarios(options?: RequestOptions): Promise<SavedScenarioDetail[]> {
  return requestWithTimeout<SavedScenarioDetail[]>(`${API_BASE}/scenarios`, {}, options);
}

export async function fetchScenarioById(
  scenarioId: string,
  options?: RequestOptions
): Promise<SavedScenarioDetail> {
  return requestWithTimeout<SavedScenarioDetail>(
    `${API_BASE}/scenarios/${scenarioId}`,
    {},
    options
  );
}

export async function saveScenario(
  req: ScenarioCreateRequest,
  options?: RequestOptions
): Promise<SavedScenarioDetail> {
  return requestWithTimeout<SavedScenarioDetail>(
    `${API_BASE}/scenarios`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
    options
  );
}

export async function updateScenario(
  scenarioId: string,
  req: ScenarioUpdateRequest,
  options?: RequestOptions
): Promise<SavedScenarioDetail> {
  return requestWithTimeout<SavedScenarioDetail>(
    `${API_BASE}/scenarios/${scenarioId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
    options
  );
}

export async function reattachScenario(
  scenarioId: string,
  req: ScenarioReattachRequest,
  options?: RequestOptions
): Promise<SavedScenarioDetail> {
  return requestWithTimeout<SavedScenarioDetail>(
    `${API_BASE}/scenarios/${scenarioId}/reattach`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
    options
  );
}

export async function deleteScenario(
  scenarioId: string,
  options?: RequestOptions
): Promise<void> {
  await requestWithTimeout(
    `${API_BASE}/scenarios/${scenarioId}`,
    { method: 'DELETE' },
    options
  );
}

export async function analyzeSensitivity(
  req: SensitivitySweepRequest,
  options?: RequestOptions
): Promise<SensitivitySweepResponse> {
  const data = await requestWithTimeout<SensitivitySweepResponse>(
    `${API_BASE}/analyze/sensitivity`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
    { timeoutMs: LONG_REQUEST_TIMEOUT_MS, ...options }
  );
  if (
    !data ||
    typeof data.parameter !== 'string' ||
    !data.baseline ||
    !data.grid_config ||
    !Array.isArray(data.points) ||
    !data.summary
  ) {
    throw new ApiError('Invalid sensitivity analysis response received from server.', 502);
  }
  return data;
}

export async function exploreTradeoffs(
  req: TradeoffExploreRequest,
  options?: RequestOptions
): Promise<TradeoffExploreResponse> {
  const data = await requestWithTimeout<TradeoffExploreResponse>(
    `${API_BASE}/analyze/trade-offs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    },
    { timeoutMs: LONG_REQUEST_TIMEOUT_MS, ...options }
  );
  if (
    !data ||
    typeof data.criterion !== 'string' ||
    !data.baseline ||
    !Array.isArray(data.candidates) ||
    !data.summary
  ) {
    throw new ApiError('Invalid trade-off explorer response received from server.', 502);
  }
  return data;
}

export interface HealthCheckResponse {
  status: string;
  service: string;
}

export async function checkBackendHealth(
  options?: RequestOptions
): Promise<HealthCheckResponse> {
  const data = await requestWithTimeout<HealthCheckResponse>(
    `${API_BASE}/health`,
    { method: 'GET' },
    { timeoutMs: 5_000, ...options }
  );
  if (!data || data.status !== 'ok') {
    throw new ApiError('Unexpected health check response from server.', 502);
  }
  return data;
}

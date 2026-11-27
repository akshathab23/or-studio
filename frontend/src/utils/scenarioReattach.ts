import type { DatasetListItem, SavedScenarioDetail } from '../types/or';

export function isMissingDatasetError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('404') ||
    lower.includes('not found') ||
    lower.includes('missing from persistent storage') ||
    lower.includes('no dataset id is linked')
  );
}

export function resolveDefaultSheetForDataset(
  item: Pick<DatasetListItem, 'file_type' | 'sheets' | 'active_sheet'> | null | undefined,
  preferredSheet?: string | null
): string | null {
  if (!item || item.file_type !== 'xlsx' || item.sheets.length === 0) {
    return null;
  }
  if (preferredSheet && item.sheets.includes(preferredSheet)) {
    return preferredSheet;
  }
  if (item.active_sheet && item.sheets.includes(item.active_sheet)) {
    return item.active_sheet;
  }
  return item.sheets[0] ?? null;
}

export function canConfirmReattach(params: {
  selectedDatasetId: string;
  selectedItem: DatasetListItem | null;
  selectedSheet: string | null;
  confirmedClearSnapshot: boolean;
  submitting: boolean;
}): boolean {
  const {
    selectedDatasetId,
    selectedItem,
    selectedSheet,
    confirmedClearSnapshot,
    submitting,
  } = params;
  if (submitting || !selectedDatasetId || !confirmedClearSnapshot) {
    return false;
  }
  if (selectedItem?.file_type === 'xlsx' && selectedItem.sheets.length > 0) {
    return Boolean(selectedSheet && selectedItem.sheets.includes(selectedSheet));
  }
  return true;
}

export function buildReattachWarningText(scenarioName: string): string {
  return `Re-attaching "${scenarioName}" will clear its previous solution snapshot and reset status to "Not Solved" so stale results are never attributed to the replacement dataset. You will need to re-run the solver.`;
}

export function applyReattachedScenarioToList(
  scenarios: SavedScenarioDetail[],
  updated: SavedScenarioDetail
): SavedScenarioDetail[] {
  return scenarios.map((s) => (s.id === updated.id ? updated : s));
}

export function formatReattachError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return 'Unable to re-attach dataset to this scenario. Verify that the replacement dataset contains all required mapped columns.';
}

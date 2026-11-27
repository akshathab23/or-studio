import type { DatasetListItem, SavedScenarioDetail } from '../types/or.ts';
import {
  applyReattachedScenarioToList,
  buildReattachWarningText,
  canConfirmReattach,
  formatReattachError,
  isMissingDatasetError,
  resolveDefaultSheetForDataset,
} from './scenarioReattach.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function makeScenario(overrides?: Partial<SavedScenarioDetail>): SavedScenarioDetail {
  return {
    id: 'scen-1',
    name: 'Baseline Scenario',
    description: 'Desc',
    created_at: '2026-11-27T00:00:00Z',
    updated_at: '2026-11-27T00:00:00Z',
    module: 'multi-period',
    dataset_id: 'ds-old',
    dataset_name: 'old.csv',
    active_sheet: null,
    objective_sense: 'Minimize',
    status: 'Optimal',
    is_optimal: true,
    constraints_feasible: true,
    objective_value: 1500,
    has_result_snapshot: true,
    input_config: {
      mapping: { product: 'product', period: 'period', demand: 'demand' },
      integer_production: false,
      allow_backlogging: false,
      capacity_scope: 'auto',
      demand_multiplier: 1.0,
      capacity_multiplier: 1.0,
      production_cost_multiplier: 1.0,
      objective_sense: 'Minimize',
    },
    result_snapshot: null,
    ...overrides,
  };
}

let passed = 0;

// 1. Missing dataset detection & warning copy
{
  assert(isMissingDatasetError('Dataset "abc" not found. Please upload the dataset again.'), 'Detects 404/not found');
  assert(isMissingDatasetError('Request failed with status 404'), 'Detects 404 status');
  assert(!isMissingDatasetError('Mapping validation failed'), 'Does not misclassify mapping error');

  const warn = buildReattachWarningText('Q1 Plan');
  assert(warn.includes('Not Solved'), 'Warning must state Not Solved transition');
  assert(warn.includes('clear its previous solution snapshot'), 'Warning must explain snapshot clearing');
  passed++;
}

// 2. Sheet resolution for CSV vs multi-sheet XLSX
{
  const csvDs: DatasetListItem = {
    dataset_id: 'ds-csv',
    filename: 'data.csv',
    file_type: 'csv',
    sheets: [],
    active_sheet: null,
    size_bytes: 100,
    created_at: '2026-11-27T00:00:00Z',
    last_accessed_at: '2026-11-27T00:00:00Z',
  };
  assert(resolveDefaultSheetForDataset(csvDs, 'Sheet1') === null, 'CSV returns null sheet');

  const xlsxDs: DatasetListItem = {
    dataset_id: 'ds-xlsx',
    filename: 'book.xlsx',
    file_type: 'xlsx',
    sheets: ['SheetA', 'SheetB'],
    active_sheet: 'SheetA',
    size_bytes: 200,
    created_at: '2026-11-27T00:00:00Z',
    last_accessed_at: '2026-11-27T00:00:00Z',
  };
  assert(resolveDefaultSheetForDataset(xlsxDs, 'SheetB') === 'SheetB', 'Prefers scenario sheet when present');
  assert(resolveDefaultSheetForDataset(xlsxDs, 'Missing') === 'SheetA', 'Falls back to dataset active_sheet');
  passed++;
}

// 3. Confirmation gate & state transition after re-attachment
{
  const xlsxDs: DatasetListItem = {
    dataset_id: 'ds-xlsx',
    filename: 'book.xlsx',
    file_type: 'xlsx',
    sheets: ['SheetA', 'SheetB'],
    active_sheet: 'SheetA',
    size_bytes: 200,
    created_at: '2026-11-27T00:00:00Z',
    last_accessed_at: '2026-11-27T00:00:00Z',
  };

  assert(
    !canConfirmReattach({
      selectedDatasetId: 'ds-xlsx',
      selectedItem: xlsxDs,
      selectedSheet: 'SheetA',
      confirmedClearSnapshot: false,
      submitting: false,
    }),
    'Must require explicit confirmation checkbox'
  );
  assert(
    !canConfirmReattach({
      selectedDatasetId: 'ds-xlsx',
      selectedItem: xlsxDs,
      selectedSheet: 'InvalidSheet',
      confirmedClearSnapshot: true,
      submitting: false,
    }),
    'Must require valid sheet for XLSX'
  );
  assert(
    canConfirmReattach({
      selectedDatasetId: 'ds-xlsx',
      selectedItem: xlsxDs,
      selectedSheet: 'SheetB',
      confirmedClearSnapshot: true,
      submitting: false,
    }),
    'Valid dataset + sheet + confirmation enables submit'
  );

  const oldSc = makeScenario();
  const reattached = makeScenario({
    dataset_id: 'ds-xlsx',
    dataset_name: 'book.xlsx',
    active_sheet: 'SheetB',
    status: 'Not Solved',
    is_optimal: false,
    constraints_feasible: false,
    objective_value: null,
    has_result_snapshot: false,
    result_snapshot: null,
  });

  const nextList = applyReattachedScenarioToList([oldSc], reattached);
  assert(nextList[0].status === 'Not Solved', 'Status updated to Not Solved');
  assert(nextList[0].has_result_snapshot === false, 'Old snapshot invalidated');
  assert(nextList[0].result_snapshot === null, 'Previous result cleared');
  assert(formatReattachError(new Error('Incompatible columns')).includes('Incompatible'), 'Error message preserved');
  passed++;
}

console.log(`Scenario re-attachment unit tests passed: ${passed}/${passed}`);

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { SaveScenarioModal } from '../components/SaveScenarioModal';
import { StudioProvider } from '../context/StudioContext';
import { SolutionHistoryPage } from '../pages/SolutionHistoryPage';
import type { ScenarioInputConfig } from '../types/or';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

// Minimal localStorage shim for SSR StudioProvider rendering
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}

const sampleInputConfig: ScenarioInputConfig = {
  mapping: { product: 'p', period: 't', demand: 'd' },
  integer_production: false,
  allow_backlogging: false,
  capacity_scope: 'auto',
  objective_sense: 'minimize',
  demand_multiplier: 1,
  capacity_multiplier: 1,
  production_cost_multiplier: 1,
};

// 1. SaveScenarioModal dialog accessibility semantics
const closedModalHtml = renderToStaticMarkup(
  React.createElement(SaveScenarioModal, {
    isOpen: false,
    onClose: () => {},
    datasetId: 'ds-1',
    datasetName: 'sample.csv',
    activeSheet: null,
    inputConfig: sampleInputConfig,
    resultSnapshot: null,
  })
);
assert(closedModalHtml === '', 'Closed SaveScenarioModal must render empty');

const openModalHtml = renderToStaticMarkup(
  React.createElement(SaveScenarioModal, {
    isOpen: true,
    onClose: () => {},
    datasetId: 'ds-1',
    datasetName: 'sample.csv',
    activeSheet: null,
    inputConfig: sampleInputConfig,
    resultSnapshot: null,
  })
);
assert(openModalHtml.includes('role="dialog"'), 'SaveScenarioModal must have role="dialog"');
assert(openModalHtml.includes('aria-modal="true"'), 'SaveScenarioModal must have aria-modal="true"');
assert(
  openModalHtml.includes('aria-labelledby="save-scenario-title"'),
  'SaveScenarioModal must have aria-labelledby'
);
assert(
  openModalHtml.includes('aria-label="Close save dialog"'),
  'SaveScenarioModal close button must have accessible label'
);

// 2. SolutionHistoryPage empty-state contextual CTA & header consistency
const emptyHistoryHtml = renderToStaticMarkup(
  React.createElement(
    MemoryRouter,
    { initialEntries: ['/history'] },
    React.createElement(StudioProvider, null, React.createElement(SolutionHistoryPage))
  )
);
assert(
  emptyHistoryHtml.includes('No solved models in history yet.'),
  'Expected empty history message'
);
assert(
  emptyHistoryHtml.includes('Start with Multi-Period Optimization'),
  'Expected empty history contextual CTA'
);
assert(
  emptyHistoryHtml.includes('<h1 class="text-xl font-bold text-slate-900">Solution History</h1>'),
  'Expected standardized text-xl h1 on SolutionHistoryPage'
);

// 3. Populated SolutionHistoryPage card with long unbreakable filename wraps safely
globalThis.localStorage.setItem(
  'or_studio_history_v1',
  JSON.stringify([
    {
      id: 'hist-long-1',
      module: 'multi-period',
      title: 'Multi-Period Production Plan (very_long_unbreakable_dataset_filename_without_spaces_2025.csv)',
      status: 'Optimal',
      isOptimal: true,
      objectiveSummary: 'Objective = 12,840',
      datasetName: 'very_long_unbreakable_dataset_filename_without_spaces_2025.csv',
      timestamp: '2026-11-27T12:00:00.000Z',
    },
  ])
);
const populatedHistoryHtml = renderToStaticMarkup(
  React.createElement(
    MemoryRouter,
    { initialEntries: ['/history'] },
    React.createElement(StudioProvider, null, React.createElement(SolutionHistoryPage))
  )
);
assert(
  populatedHistoryHtml.includes('very_long_unbreakable_dataset_filename_without_spaces_2025.csv'),
  'Expected full long filename preserved in populated history card'
);
assert(
  populatedHistoryHtml.includes('min-w-0 flex-1') &&
    populatedHistoryHtml.includes('[overflow-wrap:anywhere]'),
  'Expected min-w-0 flex-1 and overflow-wrap:anywhere on populated history card'
);

console.log('uxPolish.test.ts: all assertions passed');

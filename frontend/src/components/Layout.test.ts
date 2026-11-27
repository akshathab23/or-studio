import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { LayoutShell } from './Layout';
import { NAV_GROUPS, computeNavigationReadiness } from '../utils/navigation';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

const emptyReadiness = computeNavigationReadiness({
  dataset: null,
  mpMapping: null,
  mpSolution: null,
  mpIntegerProd: false,
  mpCapacityScope: 'auto',
  mpSolutionMappingSignature: null,
  tradeoffResult: null,
  tradeoffMeta: null,
  gpSolution: null,
  mcdmSolution: null,
  historyCount: 0,
});

// Test 1: Renders all 5 groups, all 11 routes, orientation header, and Connected badge
const connectedHtml = renderToStaticMarkup(
  React.createElement(
    MemoryRouter,
    { initialEntries: ['/multi-period'] },
    React.createElement(LayoutShell, {
      pathname: '/multi-period',
      healthStatus: 'connected',
      readinessByRoute: emptyReadiness,
      dataset: null,
      mobileOpen: false,
      onOpenMobile: () => {},
      onCloseMobile: () => {},
      children: React.createElement('div', null, 'Page Body'),
    })
  )
);

for (const group of NAV_GROUPS) {
  const escapedGroup = group.label.replace(/&/g, '&amp;');
  assert(
    connectedHtml.includes(escapedGroup),
    `Expected group label "${group.label}" in rendered Layout`
  );
  for (const item of group.items) {
    assert(
      connectedHtml.includes(item.label),
      `Expected route label "${item.label}" in rendered Layout`
    );
  }
}

assert(connectedHtml.includes('aria-current="page"'), 'Expected active route aria-current');
assert(connectedHtml.includes('bg-indigo-600 text-white'), 'Expected active route styling');
assert(connectedHtml.includes('Multi-Criteria Decision Making'), 'Expected MCDM expansion subtitle');
assert(connectedHtml.includes('Optimization'), 'Expected active group in header');
assert(connectedHtml.includes('Multi-Period Optimization'), 'Expected active item in header');
assert(connectedHtml.includes('Backend Connected'), 'Expected connected health indicator');
assert(!connectedHtml.includes('role="dialog"'), 'Expected mobile drawer closed when mobileOpen=false');

// Test 2: Unavailable health indicator and checking state render cleanly without crashing
const unavailableHtml = renderToStaticMarkup(
  React.createElement(
    MemoryRouter,
    { initialEntries: ['/'] },
    React.createElement(LayoutShell, {
      pathname: '/',
      healthStatus: 'unavailable',
      readinessByRoute: emptyReadiness,
      dataset: null,
      mobileOpen: false,
      onOpenMobile: () => {},
      onCloseMobile: () => {},
      children: React.createElement('div', null, 'Root Body'),
    })
  )
);
assert(unavailableHtml.includes('Backend Unavailable'), 'Expected unavailable health label');

const checkingHtml = renderToStaticMarkup(
  React.createElement(
    MemoryRouter,
    { initialEntries: ['/'] },
    React.createElement(LayoutShell, {
      pathname: '/',
      healthStatus: 'checking',
      readinessByRoute: emptyReadiness,
      dataset: null,
      mobileOpen: true,
      onOpenMobile: () => {},
      onCloseMobile: () => {},
      children: React.createElement('div', null, 'Mobile Open'),
    })
  )
);
assert(checkingHtml.includes('Checking Connection'), 'Expected checking health label');
assert(checkingHtml.includes('role="dialog"'), 'Expected mobile drawer open when mobileOpen=true');

console.log('Layout.test.ts: all assertions passed');

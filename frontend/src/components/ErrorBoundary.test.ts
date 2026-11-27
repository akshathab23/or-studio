import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ErrorBoundary,
  type ErrorBoundaryProps,
  type ErrorBoundaryState,
} from './ErrorBoundary';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

let passed = 0;

// 1. Normal rendering preserves children
{
  const html = renderToStaticMarkup(
    React.createElement(
      ErrorBoundary,
      null,
      React.createElement('div', { id: 'ok-view' }, 'Normal OR Studio Content')
    )
  );
  assert(html.includes('Normal OR Studio Content'), 'Normal children must render unaffected');
  assert(!html.includes('Something went wrong'), 'Error UI must not render normally');
  passed++;
}

// 2. getDerivedStateFromError transitions state to hasError: true
{
  const nextState = ErrorBoundary.getDerivedStateFromError(
    new Error('Internal secret stack frame /app/secret.ts:99')
  );
  assert(nextState.hasError === true, 'getDerivedStateFromError must set hasError: true');
  passed++;
}

// 3. Error state renders recovery UI without exposing technical stack traces
{
  let retried = false;
  let navigatedHome = false;

  const boundary = new ErrorBoundary({
    children: React.createElement('div', null, 'Protected View'),
    onReset: () => {
      retried = true;
    },
    onNavigateHome: () => {
      navigatedHome = true;
    },
  });

  // Simulate state after getDerivedStateFromError
  boundary.state = { hasError: true };
  // Capture setState calls on standalone class instance
  boundary.setState = ((
    updater:
      | ErrorBoundaryState
      | ((prevState: Readonly<ErrorBoundaryState>, props: Readonly<ErrorBoundaryProps>) => ErrorBoundaryState | null)
      | null
  ) => {
    const patch =
      typeof updater === 'function' ? updater(boundary.state, boundary.props) : updater;
    if (patch) {
      boundary.state = { ...boundary.state, ...patch };
    }
  }) as ErrorBoundary['setState'];

  const errorEl = boundary.render();
  const errorHtml = renderToStaticMarkup(errorEl as React.ReactElement);

  assert(
    errorHtml.includes('Something went wrong while rendering this view'),
    'Recovery heading must render'
  );
  assert(errorHtml.includes('Try Again'), 'Try Again action must render');
  assert(errorHtml.includes('Return to Dashboard'), 'Return to Dashboard action must render');
  assert(!errorHtml.includes('secret.ts'), 'Technical stack/file paths must not be exposed');

  // 4. Retry action resets error state and restores normal child rendering
  boundary.handleRetry();
  assert(boundary.state.hasError === false, 'handleRetry must reset hasError to false');
  assert(retried, 'onReset callback must be invoked');

  const recoveredHtml = renderToStaticMarkup(boundary.render() as React.ReactElement);
  assert(recoveredHtml.includes('Protected View'), 'Children must render again after retry');

  // 5. Navigate home action resets error state and triggers navigation callback
  boundary.state = { hasError: true };
  boundary.handleNavigateHome();
  assert(boundary.state.hasError === false, 'handleNavigateHome must reset hasError to false');
  assert(navigatedHome, 'onNavigateHome callback must be invoked');

  // 6. Route resetKey change clears error state automatically
  boundary.state = { hasError: true };
  const mutableBoundary = boundary as unknown as { props: ErrorBoundaryProps };
  mutableBoundary.props = { ...boundary.props, resetKey: '/recommendations' };
  boundary.componentDidUpdate({ ...boundary.props, resetKey: '/multi-period' });
  assert(boundary.state.hasError === false, 'Changing resetKey must clear error state');

  passed++;
}

console.log(`ErrorBoundary unit tests passed: ${passed}/${passed}`);

import React from 'react';
import { AlertTriangle, Home, RotateCcw } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: string;
  onReset?: () => void;
  onNavigateHome?: () => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Application-level React Error Boundary that catches unexpected rendering errors
 * in the protected UI tree and displays a safe recovery screen without exposing
 * technical stack traces.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_error: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('OR Studio UI rendering error:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      this.props.resetKey !== undefined &&
      this.props.resetKey !== prevProps.resetKey
    ) {
      this.setState({ hasError: false });
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  handleNavigateHome = (): void => {
    this.setState({ hasError: false });
    if (this.props.onNavigateHome) {
      this.props.onNavigateHome();
    } else if (typeof window !== 'undefined') {
      window.location.assign('/');
    }
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="mx-auto my-8 max-w-xl rounded-2xl border border-rose-200 bg-white p-6 shadow-xs sm:p-8"
        >
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-bold text-slate-900">
                Something went wrong while rendering this view
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                An unexpected display error occurred. Your saved scenarios and backend solver
                state remain intact.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={this.handleRetry}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-blue-700"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Try Again
                </button>
                <button
                  type="button"
                  onClick={this.handleNavigateHome}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Home className="h-3.5 w-3.5" />
                  Return to Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

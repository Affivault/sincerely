import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoBack = () => {
    this.setState({ hasError: false, error: null });
    window.history.back();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8">
          <div className="text-center max-w-md">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center mb-4 border border-[var(--border-subtle)]">
              <AlertTriangle className="h-6 w-6 text-[var(--text-tertiary)]" />
            </div>
            <h2 className="text-title font-semibold text-[var(--text-primary)] mb-2">
              Something went wrong
            </h2>
            <p className="text-strong text-[var(--text-secondary)] mb-6">
              {this.state.error?.message || 'An unexpected error occurred while rendering this page.'}
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleGoBack}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-strong text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Go Back
              </button>
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--text-primary)] text-[var(--bg-app)] text-strong font-medium hover:opacity-90 transition-opacity"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

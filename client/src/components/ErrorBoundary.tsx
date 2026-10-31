import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';
import { isChunkLoadError, reloadForNewVersion } from '../lib/chunkReload';

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
    // A screen from an older deploy that no longer exists. A reload fixes it;
    // if one was only just tried, the message below offers it by hand.
    if (isChunkLoadError(error)) reloadForNewVersion();
  }

  handleReload = () => {
    window.location.reload();
  };

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

      if (isChunkLoadError(this.state.error)) {
        // Never show a raw module URL to a customer. Retrying the import
        // cannot help (the file is gone), so the only useful action is a reload.
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        return (
          <div className="flex items-center justify-center min-h-[400px] p-8">
            <div className="text-center max-w-md">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center mb-4 border border-[var(--border-subtle)]">
                <RefreshCw className="h-6 w-6 text-[var(--text-tertiary)]" />
              </div>
              <h2 className="text-title font-semibold text-[var(--text-primary)] mb-2">
                {offline ? "You're offline" : 'Sincerely has been updated'}
              </h2>
              <p className="text-strong text-[var(--text-secondary)] mb-6">
                {offline
                  ? 'This page could not be loaded. Check your connection, then reload.'
                  : 'Reload to get the latest version. Nothing you saved is lost.'}
              </p>
              <button
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--text-primary)] text-[var(--bg-app)] text-strong font-medium hover:opacity-90 transition-opacity"
              >
                <RefreshCw className="h-4 w-4" />
                Reload
              </button>
            </div>
          </div>
        );
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
              {/* The raw message ("Cannot read properties of undefined") means
                  nothing to a customer; it is in the console for us. */}
              This page hit a problem. Try again, or go back to where you were.
              Nothing you saved is lost.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={this.handleGoBack}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-strong text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Go back
              </button>
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--text-primary)] text-[var(--bg-app)] text-strong font-medium hover:opacity-90 transition-opacity"
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

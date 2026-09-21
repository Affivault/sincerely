import { type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, type LucideIcon } from 'lucide-react';
import { describeFailure } from '@lemlist/shared';
import { EmptyState } from '../shared/EmptyState';
import { Skeleton, SkeletonList, SkeletonText } from './Skeleton';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   One component for everything a screen does before it has data.

   Loading, empty and failed were improvised per page, fifty-nine times.
   Five loading idioms were in live use at once - shimmer blocks, the
   Spinner component, a bare spinning Loader2, the Skeleton component,
   and the literal words "Loading..." - so the app flickered in a
   different dialect depending which screen you were on. An EmptyState
   component existed and twenty-four files wrote their own anyway.

   The fix is not a style guide. It is making the improvised version
   harder to write than the shared one: a screen hands this its query and
   what to draw when the data arrives, and gets the other three states for
   free and identical to everywhere else.

       <AsyncPanel query={q} skeleton="list" empty={{ ... }}>
         {(rows) => <Table rows={rows} />}
       </AsyncPanel>

   The failure half is the part that was genuinely broken rather than
   merely inconsistent. Two hundred and fifty-two toast.error calls
   against three error boundaries meant the normal experience of a failed
   request was a message that vanished after four seconds over a blank
   area, with no way to try again and nothing left on screen to say what
   had happened.
   ═══════════════════════════════════════════════════════════════════════ */

/** Named shapes, so a screen picks a structure rather than inventing one. */
export type SkeletonShape = 'list' | 'text' | 'panel' | 'cards' | 'none';

function SkeletonFor({ shape, rows }: { shape: SkeletonShape; rows: number }) {
  switch (shape) {
    case 'none':
      return null;
    case 'text':
      return <SkeletonText lines={rows} />;
    case 'cards':
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: rows }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      );
    case 'panel':
      /*
       * A single block the height of the panel it replaces. Deliberately
       * not a spinner: a spinner says "wait", a block the right shape
       * says "this is where it will be", and the second one stops the
       * page jumping when it arrives.
       */
      return <Skeleton className="h-48 rounded-xl" />;
    case 'list':
    default:
      return <SkeletonList rows={rows} />;
  }
}

/* ── Failure, inline and recoverable ──────────────────────────────────── */

export function InlineError({ error, onRetry, className, compact }: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const d = describeFailure(error);

  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60',
        compact ? 'px-3.5 py-3' : 'px-5 py-8 text-center',
        className,
      )}
      role="alert"
      data-inline-error
    >
      <div className={cn('flex gap-2.5', compact ? 'items-start' : 'flex-col items-center')}>
        <span className={cn(
          'flex flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/10',
          compact ? 'mt-px h-6 w-6' : 'h-10 w-10',
        )}>
          <AlertTriangle className={cn('text-amber-500', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
        </span>

        <div className={cn('min-w-0', !compact && 'max-w-sm')}>
          <p className={cn('font-semibold text-[var(--text-primary)]', compact ? 'text-body' : 'text-heading')}>
            {d.title}
          </p>
          <p className={cn('mt-0.5 leading-relaxed text-[var(--text-secondary)]', compact ? 'text-caption' : 'text-body')}>
            {d.detail}
          </p>

          {/*
            * Offered only where it could work. A retry button on a 404 or
            * a rejected request fails identically every time, and one
            * button that does nothing is enough for somebody to stop
            * trusting every other button on the page.
            */}
          {d.retryable && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={cn(
                'mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]',
                compact ? 'h-7 px-2.5 text-caption' : 'h-8 px-3 text-body',
              )}
              data-retry
            >
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── The panel ────────────────────────────────────────────────────────── */

/** The slice of a react-query result this needs. Kept structural so any
 *  query shape fits without the caller casting. */
export interface AsyncQueryLike<T> {
  data: T | undefined;
  isLoading: boolean;
  isError?: boolean;
  error?: unknown;
  refetch?: () => unknown;
}

export interface AsyncPanelProps<T> {
  query: AsyncQueryLike<T>;
  children: (data: T) => ReactNode;

  /** Which placeholder structure to hold the space with. */
  skeleton?: SkeletonShape;
  /** How many rows/lines/cards the placeholder draws. */
  skeletonRows?: number;

  /**
   * What "nothing here" looks like for this screen.
   *
   * Omitted when a screen genuinely has no empty state - a summary panel
   * that always has something to say, for instance.
   */
  empty?: {
    icon: LucideIcon;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
    secondaryActionLabel?: string;
    onSecondaryAction?: () => void;
  };
  /**
   * Whether the data counts as empty.
   *
   * Defaults to an empty array or a null/undefined value. Anything else -
   * `{ items: [] }`, a zero total - has to say so, because guessing at
   * somebody's response shape is how a screen shows an empty state over
   * real data.
   */
  isEmpty?: (data: T) => boolean;

  /** Rendered instead of the inline error. For screens with their own. */
  errorFallback?: (error: unknown, retry: () => void) => ReactNode;
  className?: string;
}

function defaultIsEmpty(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  return false;
}

export function AsyncPanel<T>({
  query, children, skeleton = 'list', skeletonRows = 5,
  empty, isEmpty = defaultIsEmpty, errorFallback, className,
}: AsyncPanelProps<T>) {
  const retry = () => query.refetch?.();

  /*
   * Failure first, and before loading.
   *
   * react-query keeps `isLoading` true on a refetch after a failure, so
   * checking loading first would replace a visible error with a skeleton
   * every time the retry button was pressed - the error would flash away
   * and come back, which reads as the button having worked.
   */
  if (query.isError) {
    if (errorFallback) return <>{errorFallback(query.error, retry)}</>;
    return <InlineError error={query.error} onRetry={query.refetch ? retry : undefined} className={className} />;
  }

  if (query.isLoading || query.data === undefined) {
    return (
      <div className={className} aria-busy data-async-loading>
        <SkeletonFor shape={skeleton} rows={skeletonRows} />
      </div>
    );
  }

  if (empty && isEmpty(query.data)) {
    return (
      <div className={className} data-async-empty>
        <EmptyState {...empty} />
      </div>
    );
  }

  return <>{children(query.data)}</>;
}

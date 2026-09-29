import { cn } from '../../lib/utils';

/**
 * Skeleton — a shimmering placeholder block used while data loads.
 * Premium products show structure-aware skeletons instead of a spinner,
 * which makes loading feel instant and intentional.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-md', className)} />;
}

/** A horizontal row of skeleton text lines with decreasing widths. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        // last line is shorter for a natural paragraph rag
        <Skeleton key={i} className={cn('h-3', i === lines - 1 && 'w-2/3')} />
      ))}
    </div>
  );
}

/**
 * A whole page, before its data: the header band, then the shape of what
 * is coming - rows for a list, a record header and two columns for a
 * detail page, a stat strip and panels for a dashboard. It replaces the
 * lone spinner in the middle of an empty page, which read as "broken"
 * for the half second before it read as "loading".
 */
export function PageSkeleton({ variant = 'list', bleed = true }: { variant?: 'list' | 'detail' | 'panels'; bleed?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className={cn(
        'mb-5 border-b border-[var(--border-subtle)]',
        bleed ? '-mx-4 -mt-5 sm:-mx-6 lg:-mx-8 lg:-mt-7 bg-[var(--bg-surface)] px-4 sm:px-6 lg:px-8 pt-5 pb-4' : 'pb-4',
      )}>
        <div className="flex items-start gap-4">
          <Skeleton className="h-9 w-9 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>
          <Skeleton className="hidden sm:block h-8 w-28 rounded-lg" />
        </div>
      </div>
      {variant === 'list' && <SkeletonList rows={7} />}
      {variant === 'detail' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-4">
            <div className="panel p-5"><SkeletonText lines={4} /></div>
            <SkeletonList rows={4} />
          </div>
          <div className="panel p-5 space-y-4">
            <Skeleton className="h-4 w-24" />
            <SkeletonText lines={5} />
          </div>
        </div>
      )}
      {variant === 'panels' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="panel p-4 space-y-2.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="panel p-5"><SkeletonText lines={5} /></div>
            <div className="panel p-5"><SkeletonText lines={5} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Canonical list-loading placeholder — a panel of structure-aware rows
 * (icon/avatar + two text lines + a trailing chip). Used in place of a
 * bare spinner so every list screen loads the same, intentional way.
 */
export function SkeletonList({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('panel overflow-hidden divide-y divide-[var(--border-subtle)]', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-8 w-8 rounded-lg flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-2.5 w-2/5" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

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

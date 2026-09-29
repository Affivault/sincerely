import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * A choice among a few: a filter, a tone, a provider.
 *
 * The same idea was drawn a dozen ways - black when chosen on one page,
 * indigo on another, square here and round there. One chip, one "chosen".
 */
export function Chip({
  active, onClick, children, className, size = 'sm', title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md';
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium border transition-colors whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-caption' : 'h-8 px-3 text-body',
        active
          ? 'border-[rgba(91,91,245,0.4)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
        className,
      )}
    >
      {children}
    </button>
  );
}

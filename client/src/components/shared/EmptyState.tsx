import { type LucideIcon } from 'lucide-react';
import { Button } from '../ui/Button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Optional secondary (ghost) action shown next to the primary one */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      {/* Icon tile with a soft ambient halo */}
      <div className="relative mb-4">
        <div
          className="absolute inset-0 -m-2 rounded-full blur-xl opacity-60"
          style={{ background: 'radial-gradient(circle, var(--indigo-subtle), transparent 70%)' }}
        />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[var(--shadow-sm)]">
          <Icon className="h-6 w-6 text-[var(--text-tertiary)]" strokeWidth={1.5} />
        </div>
      </div>
      <h3 className="mb-1.5 text-[14px] font-semibold text-[var(--text-primary)] tracking-[-0.01em]">{title}</h3>
      <p className="mb-5 max-w-sm text-[12.5px] text-[var(--text-secondary)] leading-relaxed">{description}</p>
      {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
        <div className="flex items-center gap-2">
          {secondaryActionLabel && onSecondaryAction && (
            <Button onClick={onSecondaryAction} size="sm" variant="secondary">{secondaryActionLabel}</Button>
          )}
          {actionLabel && onAction && (
            <Button onClick={onAction} size="sm">{actionLabel}</Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

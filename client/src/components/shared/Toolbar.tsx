import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface ToolbarProps {
  /** Items rendered on the left (filters, search, etc) */
  left?: ReactNode;
  /** Items rendered on the right (actions, bulk-edit etc) */
  right?: ReactNode;
  /** Background variant — "inset" sits flush with the page, "raised" sits on a card surface */
  variant?: 'inset' | 'raised';
  className?: string;
}

export function Toolbar({ left, right, variant = 'inset', className }: ToolbarProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-3 py-2 rounded-lg',
        variant === 'inset'
          ? 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)]'
          : 'bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[var(--shadow-sm)]',
        className
      )}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">{left}</div>
      {right && <div className="flex items-center gap-1.5 flex-shrink-0">{right}</div>}
    </div>
  );
}

/* Tabs that sit inside / under a PageHeader. Subtle, underline-on-active style. */
export function PageTabs({ tabs, value, onChange }: {
  tabs: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 -mb-px">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={cn(
              'group relative flex items-center gap-1.5 px-3 h-9 text-[12.5px] font-medium transition-colors duration-150 border-b-2',
              active
                ? 'text-[var(--text-primary)] border-[var(--indigo)]'
                : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-primary)]'
            )}
          >
            {t.label}
            {t.count != null && (
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[4px] text-[10.5px] font-semibold tabular',
                  active
                    ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] group-hover:bg-[var(--bg-hover)]'
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

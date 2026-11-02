import { cn } from '../../lib/utils';

/** One segmented control for every "pick a period / pick a view" switch, so
 *  Home, Analytics, Win/loss and Results all look and read the same. */
export const DAY_RANGES: readonly { value: number; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

export function Segmented<T extends string | number>({ options, value, onChange, size = 'md', label, className }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  /** Accessible name for the group, e.g. "Period". */
  label?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex max-w-full items-center p-0.5 rounded-lg bg-[var(--bg-elevated)] overflow-x-auto', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            'shrink-0 whitespace-nowrap rounded-md font-medium transition-all duration-150 text-body',
            size === 'sm' ? 'h-6 px-2.5' : 'h-7 px-3',
            value === o.value
              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

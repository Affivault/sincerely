import { Check, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visually-checked dash state for "some but not all" selections */
  indeterminate?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
}

/**
 * Checkbox — the single canonical check control across the app.
 * A styled button (role="checkbox") instead of the native input, so it
 * renders identically in every browser/theme: indigo fill when on, a
 * spring-popped check, indeterminate dash, and a proper focus ring.
 */
export function Checkbox({
  checked,
  onChange,
  indeterminate = false,
  disabled = false,
  className,
  ...aria
}: CheckboxProps) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
      {...aria}
      className={cn(
        'relative inline-flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-md border transition-all duration-150 ease-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--indigo)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]',
        on
          ? 'border-[var(--indigo)] bg-[var(--indigo)] shadow-[0_1px_2px_rgba(67,56,202,0.35)]'
          : 'border-[var(--border-strong)] bg-[var(--bg-surface)] hover:border-[var(--indigo)] hover:bg-[var(--indigo-subtle)]',
        disabled && 'opacity-40 cursor-not-allowed',
        className
      )}
    >
      {indeterminate ? (
        <Minus className="h-3 w-3 text-white" strokeWidth={3} />
      ) : (
        <Check
          className={cn('h-3 w-3 text-white transition-transform duration-150', checked ? 'scale-100' : 'scale-0')}
          strokeWidth={3}
          style={{ transitionTimingFunction: 'var(--ease-spring)' }}
        />
      )}
    </button>
  );
}

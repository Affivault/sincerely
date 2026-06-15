import { cn } from '../../lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** Accessible label when there's no visible text label nearby */
  'aria-label'?: string;
  id?: string;
  className?: string;
}

/**
 * Toggle — the single canonical switch used across the app.
 * Premium detailing: inset track shadow, layered knob shadow, a spring
 * ease on the knob travel, and a proper focus-visible ring. Accessible
 * via role="switch" + aria-checked so it works with keyboards/AT.
 */
export function Toggle({
  checked,
  onChange,
  size = 'md',
  disabled = false,
  className,
  id,
  ...aria
}: ToggleProps) {
  const dims = size === 'sm'
    ? { track: 'h-[18px] w-[30px]', knob: 'h-3.5 w-3.5', on: 'translate-x-[12px]' }
    : { track: 'h-[22px] w-[38px]', knob: 'h-[18px] w-[18px]', on: 'translate-x-[16px]' };

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      {...aria}
      className={cn(
        'relative inline-flex flex-shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 ease-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--indigo)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]',
        'shadow-[inset_0_1px_2px_rgba(15,15,25,0.18)]',
        checked ? 'bg-[var(--indigo)]' : 'bg-[var(--border-strong)]',
        disabled && 'opacity-45 cursor-not-allowed',
        dims.track,
        className
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full bg-white shadow-[0_1px_2px_rgba(15,15,25,0.3),0_1px_1px_rgba(15,15,25,0.15)] transition-transform duration-200',
          dims.knob,
          checked ? dims.on : 'translate-x-0'
        )}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      />
    </button>
  );
}

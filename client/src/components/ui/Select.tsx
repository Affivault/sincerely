import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, hint, id, options, placeholder, ...props }, ref) => {
    // Same root cause as Input: no id meant the <label> was tied to nothing.
    const auto = useId();
    const fid = id ?? auto;
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={fid} className="block text-body font-medium text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={fid}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-error` : (hint ? `${fid}-hint` : undefined)}
          className={cn(
            'block w-full h-8 rounded-md border bg-[var(--bg-app)] px-2.5 text-strong text-[var(--text-primary)] transition-[border-color,box-shadow] duration-150 ease-out focus:outline-none cursor-pointer',
            // 1.4.11: control edge at 3:1; hover darkens rather than lightens.
            error
              ? 'border-[var(--error)] hover:border-[var(--error)] focus:border-[var(--error)] focus:shadow-[var(--ring-error)]'
              : 'border-[var(--border-control)] hover:border-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:shadow-[var(--ring-focus)]',
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={`${fid}-error`} role="alert" className="text-caption text-[var(--error)] leading-tight">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${fid}-hint`} className="text-caption text-[var(--text-tertiary)] leading-tight">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';

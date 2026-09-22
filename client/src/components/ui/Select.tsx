import { forwardRef, type SelectHTMLAttributes } from 'react';
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
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={id} className="block text-body font-medium text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={id}
          className={cn(
            'block w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 text-strong text-[var(--text-primary)] transition-[border-color,box-shadow] duration-150 ease-out hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)] cursor-pointer',
            error && 'border-[var(--error)] hover:border-[var(--error)] focus:border-[var(--error)] focus:shadow-[var(--ring-error)]',
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
        {error && <p className="text-caption text-[var(--error)] leading-tight">{error}</p>}
        {hint && !error && <p className="text-caption text-[var(--text-tertiary)] leading-tight">{hint}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

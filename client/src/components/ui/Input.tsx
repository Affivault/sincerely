import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    /*
     * 45 of 78 call sites passed no id, so the <label htmlFor> pointed at
     * nothing and the field had no accessible name, and the error/hint had
     * nothing to be described-by. Generate one when the caller does not.
     */
    const auto = useId();
    const fid = id ?? auto;
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={fid} className="block text-body font-medium text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={fid}
          /*
           * The error was rendered and never announced. aria-invalid was
           * used ZERO times in this app, so a field at fault looked wrong
           * to a reader and was indistinguishable from a correct one to
           * anything else - and aria-describedby is what connects the
           * message underneath to the field it is about, rather than
           * leaving it as loose text nearby.
           */
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-error` : (hint ? `${fid}-hint` : undefined)}
          className={cn(
            'block w-full h-8 rounded-md border bg-[var(--bg-app)] px-2.5 text-strong text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-[border-color,box-shadow] duration-150 ease-out focus:outline-none',
            // 1.4.11: the field edge is --border-control (3:1). Hover darkens
            // (--border-strong is lighter than the control edge).
            error
              ? 'border-[var(--error)] hover:border-[var(--error)] focus:border-[var(--error)] focus:shadow-[var(--ring-error)]'
              : 'border-[var(--border-control)] hover:border-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:shadow-[var(--ring-focus)]',
            className
          )}
          {...props}
        />
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

Input.displayName = 'Input';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={id} className="block text-body font-medium text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          /*
           * The error was rendered and never announced. aria-invalid was
           * used ZERO times in this app, so a field at fault looked wrong
           * to a reader and was indistinguishable from a correct one to
           * anything else - and aria-describedby is what connects the
           * message underneath to the field it is about, rather than
           * leaving it as loose text nearby.
           */
          aria-invalid={error ? true : undefined}
          aria-describedby={error && id ? `${id}-error` : (hint && id ? `${id}-hint` : undefined)}
          className={cn(
            'block w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 text-strong text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-[border-color,box-shadow] duration-150 ease-out hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]',
            error && 'border-[var(--error)] hover:border-[var(--error)] focus:border-[var(--error)] focus:shadow-[0_0_0_3px_rgba(239,68,68,0.12)]',
            className
          )}
          {...props}
        />
        {error && (
          <p id={id ? `${id}-error` : undefined} role="alert" className="text-caption text-[var(--error)] leading-tight">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={id ? `${id}-hint` : undefined} className="text-caption text-[var(--text-tertiary)] leading-tight">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

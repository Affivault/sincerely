import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'brand';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => {
    const variants = {
      primary:
        '[background:var(--indigo-grad)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(67,56,202,0.35)] hover:[background:var(--indigo-grad-hover)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_8px_rgba(67,56,202,0.45)] active:translate-y-[0.5px]',
      brand:
        '[background:var(--indigo-grad)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(67,56,202,0.35)] hover:[background:var(--indigo-grad-hover)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_8px_rgba(67,56,202,0.45)] active:translate-y-[0.5px]',
      secondary:
        'bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] shadow-[0_1px_0_rgba(0,0,0,0.015)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] active:bg-[var(--bg-active)]',
      ghost:
        'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:bg-[var(--bg-active)]',
      danger:
        'bg-[var(--error)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(220,38,38,0.3)] hover:bg-[#DC2626] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_2px_6px_rgba(220,38,38,0.4)] active:translate-y-[0.5px]',
    };

    const sizes = {
      sm: 'h-7 px-2.5 text-body gap-1',
      md: 'h-8 px-3 text-strong gap-1.5',
      lg: 'h-9 px-4 text-strong gap-2',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium whitespace-nowrap rounded-md transition-[background-color,border-color,box-shadow,transform,opacity] duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--indigo)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-app)] disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

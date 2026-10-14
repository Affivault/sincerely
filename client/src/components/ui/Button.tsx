import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { blockedProps, BLOCKED_CLASS } from '../../lib/blockedAction';
import { cn } from '../../lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'brand';
  size?: 'sm' | 'md' | 'lg';
  /**
   * Why this cannot be pressed yet, or null when it can.
   *
   * NOT the same as `disabled`, and the difference is the whole point.
   * `disabled` sets pointer-events: none, so a greyed-out button cannot
   * be hovered, cannot be focused and cannot be asked anything - which is
   * how this app ended up with five-condition gates that told nobody
   * which condition applied.
   *
   * A button blocked this way looks the same, refuses the action the
   * same, and stays reachable: hovering says why, clicking says why, and
   * assistive technology is told both that it is unavailable and what
   * would make it available.
   *
   * Use `disabled` for something that is briefly busy - a request in
   * flight, where the label already says "Saving..." and there is nothing
   * to explain. Use this for something the person could act on.
   */
  blockedBy?: string | null;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, blockedBy, onClick, ...props }, ref) => {
    const blocked = !!blockedBy;
    // One definition of what "blocked" means, shared with the raw
    // <button> elements that carry their own styling.
    const gate = blockedProps(blockedBy, onClick);
    const variants = {
      primary:
        'bg-[var(--indigo)] text-white shadow-[var(--glow-indigo)] hover:bg-[var(--indigo-hover)] active:translate-y-[0.5px]',
      brand:
        'bg-[var(--indigo)] text-white shadow-[var(--glow-indigo)] hover:bg-[var(--indigo-hover)] active:translate-y-[0.5px]',
      secondary:
        'bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] shadow-[var(--shadow-sm)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)] active:bg-[var(--bg-active)]',
      ghost:
        'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:bg-[var(--bg-active)]',
      danger:
        'bg-[var(--error)] text-white shadow-[var(--glow-indigo)] hover:brightness-95 active:translate-y-[0.5px]',
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
          // Looks disabled; is not. No pointer-events-none here, which is
          // what keeps it hoverable, focusable and able to answer.
          blocked && BLOCKED_CLASS,
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
        /* After the spread, deliberately. A caller's own `title` must not
           win over the reason this cannot be pressed, and `onClick` is
           already destructured out above so the spread cannot reinstate
           the unguarded one. */
        {...gate}
        title={blockedBy ?? props.title}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

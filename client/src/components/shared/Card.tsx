import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Render gradient border for "featured" cards */
  variant?: 'default' | 'premium' | 'inset';
  /** Apply hover lift effect (shadow only, no transform) */
  hoverable?: boolean;
  /** Default internal padding — set to "none" if you want full control */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', hoverable, padding = 'md', children, ...props }, ref) => {
    const base = variant === 'premium' ? 'card-premium' : variant === 'inset' ? 'panel-inset' : 'card';
    const pads = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' }[padding];

    return (
      <div
        ref={ref}
        className={cn(base, pads, hoverable && 'card-hover cursor-pointer', className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
Card.displayName = 'Card';

/* ── Card subcomponents for consistent header / body / footer layout ── */

export function CardHeader({ children, className, action }: {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 mb-3', className)}>
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="flex-shrink-0 flex items-center gap-1">{action}</div>}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn('text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.005em] leading-tight', className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-[12px] text-[var(--text-secondary)] leading-snug mt-0.5', className)}>
      {children}
    </p>
  );
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-3 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between', className)}>
      {children}
    </div>
  );
}

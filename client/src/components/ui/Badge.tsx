import { cn } from '../../lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'brand';
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
}

const dotColors: Record<string, string> = {
  default: 'bg-[var(--text-tertiary)]',
  success: 'bg-[var(--success)]',
  warning: 'bg-[var(--warning)]',
  danger: 'bg-[var(--error)]',
  info: 'bg-[var(--text-tertiary)]',
  brand: 'bg-[var(--indigo)]',
};

export function Badge({ children, variant = 'default', size = 'md', dot = false, className }: BadgeProps) {
  const variants = {
    default: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
    success: 'bg-[var(--success-bg)] text-[var(--success)] border border-[var(--success-border)]',
    warning: 'bg-[var(--warning-bg)] text-[var(--warning)] border border-[var(--warning-border)]',
    danger:  'bg-[var(--error-bg)] text-[var(--error)] border border-[var(--error-border)]',
    info:    'bg-[var(--info-bg)] text-[var(--info)] border border-[var(--info-border)]',
    brand:   'bg-[var(--indigo-subtle)] text-[var(--indigo)] border border-[rgba(99,102,241,0.2)]',
  };

  const sizes = {
    sm: 'h-[16px] px-1 text-micro gap-0.5',
    md: 'h-[18px] px-1.5 text-caption gap-1',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded leading-none whitespace-nowrap transition-colors duration-150',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {dot && (
        <span className={cn('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', dotColors[variant])} />
      )}
      {children}
    </span>
  );
}

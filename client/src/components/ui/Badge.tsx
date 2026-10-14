import { cn } from '../../lib/utils';
import { TONE } from './tone';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'brand';
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
}

/* The shared status language (see ui/tone): one soft ground per meaning. */
const TONE_OF = { default: 'neutral', success: 'positive', warning: 'attention', danger: 'negative', info: 'info', brand: 'brand' } as const;

export function Badge({ children, variant = 'default', size = 'md', dot = false, className }: BadgeProps) {
  const tone = TONE[TONE_OF[variant]];

  const sizes = {
    sm: 'h-[16px] px-1 text-micro gap-0.5',
    md: 'h-[18px] px-1.5 text-caption gap-1',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center font-medium rounded leading-none whitespace-nowrap transition-colors duration-150',
        tone.bg, tone.text,
        sizes[size],
        className
      )}
    >
      {dot && (
        <span className={cn('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', tone.solid)} />
      )}
      {children}
    </span>
  );
}

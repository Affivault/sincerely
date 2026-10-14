import { type LucideIcon, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  /** Secondary metric or unit eg "of 1,200" or "%" */
  hint?: string;
  /** Trend delta as percentage (positive or negative) */
  delta?: number;
  /** Inverted means "negative is good" eg bounce rate */
  deltaInverted?: boolean;
  icon?: LucideIcon;
  /** Accent colour for the small icon (kept restrained) */
  accent?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan' | 'blue' | 'slate';
  /** Accepted for backwards-compat; intentionally not rendered (calmer cards). */
  sparkline?: number[];
  className?: string;
  onClick?: () => void;
}

/* Restrained single-tone accents — used only for the small icon */
const ACCENT_HEX: Record<string, string> = {
  indigo: 'var(--c-indigo)', violet: 'var(--c-violet)', cyan: 'var(--c-cyan)', blue: 'var(--c-blue)',
  emerald: 'var(--c-emerald)', amber: 'var(--c-amber)', rose: 'var(--c-rose)', slate: 'var(--text-tertiary)',
};

/**
 * Calm stat tile — icon + sentence-case label + big number + optional trend.
 * Matches the dashboard KPI language: no uppercase microtext, no sparkline,
 * no hover spotlight. Hierarchy and whitespace carry it.
 */
export function StatCard({
  label,
  value,
  hint,
  delta,
  deltaInverted = false,
  icon: Icon,
  accent = 'indigo',
  className,
  onClick,
}: StatCardProps) {
  const color = ACCENT_HEX[accent] ?? ACCENT_HEX.indigo;
  const deltaGood = delta != null ? (deltaInverted ? delta < 0 : delta > 0) : null;
  const flat = delta != null && Math.abs(delta) < 0.05;

  return (
    <div
      onClick={onClick}
      className={cn('panel p-4', onClick && 'panel-hover cursor-pointer', className)}
    >
      <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
        {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0 opacity-80" strokeWidth={1.75} style={{ color }} />}
        <span className="text-body font-medium truncate">{label}</span>
        {delta != null && (
          <span className={cn(
            'ml-auto flex items-center gap-0.5 text-body font-semibold tabular flex-shrink-0',
            flat ? 'text-[var(--text-tertiary)]' : deltaGood ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-500'
          )}>
            {!flat && (delta > 0 ? <ArrowUp className="h-3 w-3" strokeWidth={2.5} /> : <ArrowDown className="h-3 w-3" strokeWidth={2.5} />)}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>

      <div className="mt-3 text-hero font-medium text-[var(--text-primary)] tabular leading-none tracking-[-0.025em]">
        {value}
      </div>
      {hint && <div className="mt-2 text-body text-[var(--text-tertiary)] truncate">{hint}</div>}
    </div>
  );
}

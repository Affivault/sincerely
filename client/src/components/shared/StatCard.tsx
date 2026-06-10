import { type LucideIcon } from 'lucide-react';
import { ArrowUp, ArrowDown } from 'lucide-react';
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
  /** Accent colour for the icon + sparkline (kept restrained) */
  accent?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan' | 'blue' | 'slate';
  /** Optional sparkline as inline SVG path */
  sparkline?: number[];
  className?: string;
  onClick?: () => void;
}

/* Restrained single-tone accents — used only for the small icon + sparkline */
const ACCENT_HEX: Record<string, string> = {
  indigo: '#6366F1', violet: '#8B5CF6', cyan: '#06B6D4', blue: '#3B82F6',
  emerald: '#10B981', amber: '#F59E0B', rose: '#F43F5E', slate: '#64748B',
};

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null;
  const w = 88, h = 30;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`);
  const uid = color.replace('#', '');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`sc-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={`url(#sc-${uid})`} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatCard({
  label,
  value,
  hint,
  delta,
  deltaInverted = false,
  icon: Icon,
  accent = 'indigo',
  sparkline,
  className,
  onClick,
}: StatCardProps) {
  const color = ACCENT_HEX[accent] ?? ACCENT_HEX.indigo;
  const deltaGood = delta != null ? (deltaInverted ? delta < 0 : delta > 0) : null;
  const flat = delta != null && Math.abs(delta) < 0.05;

  return (
    <div
      onClick={onClick}
      className={cn(
        'group panel p-4 pb-3',
        onClick && 'panel-hover cursor-pointer',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} style={{ color }} />}
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)] truncate">
            {label}
          </span>
        </div>

        {delta != null && (
          <span className={cn(
            'flex items-center gap-0.5 text-[11.5px] font-semibold tabular flex-shrink-0',
            flat ? 'text-[var(--text-tertiary)]' : deltaGood ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-500'
          )}>
            {!flat && (delta > 0 ? <ArrowUp className="h-3 w-3" strokeWidth={2.5} /> : <ArrowDown className="h-3 w-3" strokeWidth={2.5} />)}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[24px] font-semibold text-[var(--text-primary)] tabular leading-none tracking-[-0.03em]">
            {value}
          </div>
          {hint && (
            <div className="text-[11.5px] text-[var(--text-tertiary)] mt-1.5 truncate">
              {hint}
            </div>
          )}
        </div>

        {sparkline && sparkline.length >= 2 && (
          <div className="flex-shrink-0">
            <Sparkline data={sparkline} color={color} />
          </div>
        )}
      </div>
    </div>
  );
}

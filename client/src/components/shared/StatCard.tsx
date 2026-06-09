import { type LucideIcon } from 'lucide-react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
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
  /** Accent colour for the card */
  accent?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan' | 'blue' | 'slate';
  /** Optional sparkline as inline SVG path (0..100 normalised) */
  sparkline?: number[];
  className?: string;
  onClick?: () => void;
}

/* Vivid gradient pairings + tint backgrounds for each accent */
const ACCENTS: Record<string, { from: string; to: string; tint: string; border: string }> = {
  indigo:  { from: '#6366F1', to: '#8B5CF6', tint: 'rgba(99,102,241,0.08)',  border: 'rgba(99,102,241,0.18)' },
  violet:  { from: '#8B5CF6', to: '#D946EF', tint: 'rgba(139,92,246,0.08)',  border: 'rgba(139,92,246,0.18)' },
  cyan:    { from: '#06B6D4', to: '#3B82F6', tint: 'rgba(6,182,212,0.08)',   border: 'rgba(6,182,212,0.18)' },
  blue:    { from: '#3B82F6', to: '#6366F1', tint: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.18)' },
  emerald: { from: '#10B981', to: '#06B6D4', tint: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.18)' },
  amber:   { from: '#F59E0B', to: '#F43F5E', tint: 'rgba(245,158,11,0.09)',  border: 'rgba(245,158,11,0.20)' },
  rose:    { from: '#F43F5E', to: '#EC4899', tint: 'rgba(244,63,94,0.08)',   border: 'rgba(244,63,94,0.18)' },
  slate:   { from: '#64748B', to: '#94A3B8', tint: 'rgba(100,116,139,0.07)', border: 'rgba(100,116,139,0.16)' },
};

function Sparkline({ data, from, to }: { data: number[]; from: string; to: string }) {
  if (!data || data.length < 2) return null;

  const w = 84;
  const h = 30;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const uid = `${from}${to}`.replace(/[#,]/g, '');

  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 5) - 2.5;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPath = `M0,${h} L${points.split(' ').join(' L')} L${w},${h} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`sl-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={from} stopOpacity="0.28" />
          <stop offset="100%" stopColor={from} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`sk-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#sl-${uid})`} />
      <polyline
        points={points}
        fill="none"
        stroke={`url(#sk-${uid})`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  const acc = ACCENTS[accent] ?? ACCENTS.indigo;
  const deltaGood = delta != null ? (deltaInverted ? delta < 0 : delta > 0) : null;

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-[16px] border p-4 transition-all duration-[var(--dur-base)] ease-[var(--ease-out)]',
        onClick && 'cursor-pointer hover:-translate-y-1 hover:shadow-[var(--shadow-lg)] active:translate-y-0',
        className
      )}
      style={{
        background: `linear-gradient(150deg, ${acc.tint}, transparent 70%), var(--bg-surface)`,
        borderColor: acc.border,
      }}
    >
      {/* Decorative corner glow */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-50 blur-2xl transition-opacity duration-300 group-hover:opacity-80"
        style={{ background: `radial-gradient(circle, ${acc.from}55, transparent 70%)` }}
      />

      <div className="relative flex items-start justify-between gap-3 mb-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <span
              className="flex h-9 w-9 items-center justify-center rounded-[10px] flex-shrink-0"
              style={{ backgroundImage: `linear-gradient(135deg, ${acc.from}, ${acc.to})`, boxShadow: `0 6px 14px -3px ${acc.from}80, inset 0 1px 0 rgba(255,255,255,0.3)` }}
            >
              <Icon className="h-[17px] w-[17px] text-white" strokeWidth={2.1} />
            </span>
          )}
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)] truncate">
            {label}
          </span>
        </div>

        {delta != null && (
          <span
            className={cn(
              'flex items-center gap-0.5 text-[11px] font-bold tabular flex-shrink-0 px-1.5 h-[20px] rounded-full',
              deltaGood == null ? 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
                : deltaGood ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400'
                : 'bg-rose-500/12 text-rose-600 dark:text-rose-400'
            )}
          >
            {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>

      <div className="relative flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[28px] font-bold text-[var(--text-primary)] tabular leading-[1.05] tracking-[-0.03em]">
            {value}
          </div>
          {hint && (
            <div className="text-[11.5px] text-[var(--text-tertiary)] mt-1 truncate">
              {hint}
            </div>
          )}
        </div>

        {sparkline && sparkline.length >= 2 && (
          <div className="flex-shrink-0">
            <Sparkline data={sparkline} from={acc.from} to={acc.to} />
          </div>
        )}
      </div>
    </div>
  );
}

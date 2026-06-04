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
  /** Accent colour for the icon chip */
  accent?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate';
  /** Optional sparkline as inline SVG path (0..100 normalised) */
  sparkline?: number[];
  className?: string;
  onClick?: () => void;
}

const accentClasses = {
  indigo:  { bg: 'bg-[rgba(91,91,245,0.08)]',  text: 'text-[#5B5BF5]', stroke: '#5B5BF5' },
  emerald: { bg: 'bg-emerald-500/8',           text: 'text-emerald-600', stroke: '#10B981' },
  amber:   { bg: 'bg-amber-500/8',             text: 'text-amber-600',   stroke: '#F59E0B' },
  rose:    { bg: 'bg-rose-500/8',              text: 'text-rose-600',    stroke: '#F43F5E' },
  violet:  { bg: 'bg-violet-500/8',            text: 'text-violet-600',  stroke: '#8B5CF6' },
  slate:   { bg: 'bg-slate-500/8',             text: 'text-slate-600',   stroke: '#64748B' },
};

function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  if (!data || data.length < 2) return null;

  const w = 80;
  const h = 28;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  const areaPath = `M0,${h} L${points.split(' ').join(' L')} L${w},${h} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${stroke.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.2" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${stroke.replace('#', '')})`} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
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
  const acc = accentClasses[accent];
  const deltaGood = delta != null ? (deltaInverted ? delta < 0 : delta > 0) : null;
  const deltaColour =
    deltaGood == null
      ? 'text-[var(--text-tertiary)]'
      : deltaGood
      ? 'text-emerald-600'
      : 'text-rose-600';

  return (
    <div
      onClick={onClick}
      className={cn(
        'group surface p-4 transition-all duration-200',
        onClick && 'cursor-pointer hover:shadow-[var(--shadow-md)] hover:border-[var(--border-default)]',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        {/* Label + icon chip */}
        <div className="flex items-center gap-2 min-w-0">
          {Icon && (
            <span className={cn('flex h-7 w-7 items-center justify-center rounded-[8px] flex-shrink-0', acc.bg)}>
              <Icon className={cn('h-3.5 w-3.5', acc.text)} strokeWidth={2} />
            </span>
          )}
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)] truncate">
            {label}
          </span>
        </div>

        {/* Trend delta */}
        {delta != null && (
          <span className={cn('flex items-center gap-0.5 text-[11px] font-semibold tabular flex-shrink-0', deltaColour)}>
            {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[24px] font-semibold text-[var(--text-primary)] tabular leading-[1.1] tracking-[-0.02em]">
            {value}
          </div>
          {hint && (
            <div className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5 truncate">
              {hint}
            </div>
          )}
        </div>

        {sparkline && sparkline.length >= 2 && (
          <div className="flex-shrink-0 opacity-90">
            <Sparkline data={sparkline} stroke={acc.stroke} />
          </div>
        )}
      </div>
    </div>
  );
}

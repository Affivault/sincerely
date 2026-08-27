import { Link } from 'react-router-dom';
import { funnel, summarisePipeline, DEAL_STAGES } from '@lemlist/shared';
import type { Deal, DealStage } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { AlertTriangle, CalendarClock, Clock, Target, TrendingUp, Trophy } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   The top of the deals page, answering "am I going to hit my number?"

   It used to answer "how much is in the pipeline", which is the number
   everyone quotes and nobody believes: a £2m pipeline of ten unqualified
   leads is not the same as one of three proposals out, and a board that
   adds them together says they are.

   Three numbers instead of one, in the order a forecast is actually built:
   what is open, what it is worth once the odds are admitted, and what you
   would commit to out loud. Then the things that are wrong with it.
   ═══════════════════════════════════════════════════════════════════════ */

function money(v: number, currency = 'USD'): string {
  const abs = Math.abs(v);
  // Thousands and millions, because a pipeline header is read at a glance
  // and "$1,284,000" takes longer to parse than "$1.28M".
  const compact = abs >= 1_000_000
    ? `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
    : abs >= 10_000
      ? `${Math.round(v / 1000)}K`
      : Math.round(v).toLocaleString();
  const symbol = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
  return `${symbol}${compact}`;
}

function full(v: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(v || 0);
  } catch {
    return `$${Math.round(v || 0).toLocaleString()}`;
  }
}

const STAGE_BAR: Record<DealStage, string> = {
  lead: 'bg-slate-400',
  qualified: 'bg-[var(--indigo)]',
  proposal: 'bg-amber-500',
  won: 'bg-emerald-500',
  lost: 'bg-rose-500',
};

function Figure({
  label, value, title, sub, subTone, icon: Icon, accent,
}: {
  label: string;
  value: string;
  title: string;
  sub: string;
  subTone?: string;
  icon: typeof Target;
  accent?: boolean;
}) {
  return (
    <div
      title={title}
      className={cn(
        'rounded-xl border px-3.5 py-3',
        accent
          ? 'border-[var(--indigo)]/25 bg-[var(--indigo-subtle)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]',
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-tertiary)]">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-[21px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
          accent ? 'text-[var(--indigo)]' : 'text-[var(--text-primary)]',
        )}
      >
        {value}
      </p>
      <p className={cn('mt-1.5 text-[11px]', subTone || 'text-[var(--text-muted)]')}>{sub}</p>
    </div>
  );
}

/** A clickable count of something that needs attention, or nothing at all. */
function Flag({
  count, value, label, tone, onClick, icon: Icon,
}: {
  count: number;
  value: number;
  label: string;
  tone: 'rose' | 'amber';
  onClick: () => void;
  icon: typeof AlertTriangle;
}) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium transition-colors',
        tone === 'rose'
          ? 'bg-rose-500/10 text-rose-600 hover:bg-rose-500/[0.16] dark:text-rose-400'
          : 'bg-amber-500/10 text-amber-700 hover:bg-amber-500/[0.16] dark:text-amber-400',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="font-semibold tabular-nums">{count}</span>
      {label}
      <span className="opacity-60">· {money(value)}</span>
    </button>
  );
}

export function PipelineHeader({
  deals,
  currency = 'USD',
  onShowRotting,
  onShowOverdue,
}: {
  deals: Deal[];
  currency?: string;
  onShowRotting: () => void;
  onShowOverdue: () => void;
}) {
  const s = summarisePipeline(deals);
  const rows = funnel(deals);
  const stageLabel = (id: DealStage) => DEAL_STAGES.find((x) => x.id === id)?.label || id;

  return (
    <div className="mb-5 space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Open pipeline"
          value={money(s.open, currency)}
          title={`${full(s.open, currency)} across ${s.openCount} open deals`}
          sub={`${s.openCount} deal${s.openCount === 1 ? '' : 's'}`}
          icon={Target}
        />
        <Figure
          label="Weighted forecast"
          value={money(s.weighted, currency)}
          title={`${full(s.weighted, currency)} — every open deal multiplied by the odds of its stage`}
          sub="by stage probability"
          icon={TrendingUp}
          accent
        />
        <Figure
          label="Commit"
          value={money(s.commit, currency)}
          title={`${full(s.commit, currency)} — proposals out, unweighted`}
          sub={`${s.commitCount} proposal${s.commitCount === 1 ? '' : 's'} out`}
          icon={Trophy}
        />
        <Figure
          label="Won · 30 days"
          value={money(s.wonRecent, currency)}
          title={`${full(s.wonRecent, currency)} closed in the last 30 days`}
          sub={
            s.winRate !== null
              ? `${s.winRate}% win rate${s.avgDaysToClose !== null ? ` · ${s.avgDaysToClose}d cycle` : ''}`
              : 'nothing closed yet'
          }
          icon={Trophy}
        />
      </div>

      {/* What is wrong with the forecast above, if anything. Shown only when
          there is something to say — a row of zeroes is furniture. */}
      {(s.rottingCount > 0 || s.overdueCount > 0 || s.closingSoonCount > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <Flag
            count={s.rottingCount}
            value={s.rotting}
            label="stalled"
            tone="rose"
            icon={Clock}
            onClick={onShowRotting}
          />
          <Flag
            count={s.overdueCount}
            value={s.overdue}
            label="past close date"
            tone="amber"
            icon={AlertTriangle}
            onClick={onShowOverdue}
          />
          {s.closingSoonCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--bg-elevated)] px-2.5 py-1.5 text-[11.5px] font-medium text-[var(--text-secondary)]">
              <CalendarClock className="h-3.5 w-3.5" />
              <span className="font-semibold tabular-nums">{s.closingSoonCount}</span>
              closing in 30 days
              <span className="opacity-60">· {money(s.closingSoon, currency)}</span>
            </span>
          )}
          <span className="flex-1" />
          <Link
            to="/tasks"
            className="text-[11.5px] font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--indigo)]"
          >
            Open activities →
          </Link>
        </div>
      )}

      {/* The shape of the open pipeline. Won and lost are deliberately absent:
          they only grow, so including them would flatten every live stage into
          nothing and turn a picture of current work into one of all history. */}
      {s.openCount > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
          <div className="flex items-end gap-4">
            {rows.map((row) => (
              <div key={row.stage} className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11.5px] font-medium text-[var(--text-secondary)]">
                    {stageLabel(row.stage)}
                  </span>
                  <span className="flex-shrink-0 text-[11px] font-semibold tabular-nums text-[var(--text-primary)]">
                    {row.count}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                  <div
                    className={cn('h-full rounded-full transition-[width] duration-500', STAGE_BAR[row.stage])}
                    style={{ width: `${Math.max(row.share * 100, row.count > 0 ? 4 : 0)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10.5px] tabular-nums text-[var(--text-tertiary)]">
                  {money(row.value, currency)}
                  <span className="text-[var(--text-muted)]"> · {money(row.weighted, currency)} wtd</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

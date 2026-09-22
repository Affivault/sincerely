import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { readinessApi } from '../../api/readiness.api';
import type { ReadinessCheck, ReadinessReport, ReadinessStatus } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { formatTime } from '@lemlist/shared';
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, Minus, RefreshCw, ShieldAlert, ShieldCheck, XCircle,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   One view answering "am I safe to send?"

   The answer was always knowable and never in one place: domain auth on
   one page, mailbox health on another, warm-up on a third, the bounce
   guard in settings, the tracking domain elsewhere again. So it was never
   assembled before a launch — only afterwards, out of the bounce rate.

   A verdict in one sentence, then the evidence, then the link that fixes
   each thing. Nothing here is new data; it is the same data finally asked
   the question people actually have.
   ═══════════════════════════════════════════════════════════════════════ */

const STATUS_STYLE: Record<ReadinessStatus, { ring: string; bg: string; text: string; Icon: typeof Check }> = {
  pass: {
    ring: 'border-emerald-500/25',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-600 dark:text-emerald-400',
    Icon: Check,
  },
  warn: {
    ring: 'border-amber-500/25',
    bg: 'bg-amber-500/10',
    text: 'text-amber-600 dark:text-amber-400',
    Icon: AlertTriangle,
  },
  fail: {
    ring: 'border-rose-500/25',
    bg: 'bg-rose-500/10',
    text: 'text-rose-600 dark:text-rose-400',
    Icon: XCircle,
  },
  /*
   * Not measured yet, and deliberately colourless.
   *
   * "Nothing sent yet - no bounce history to judge" used to carry a green
   * tick, which is an absence of evidence wearing the colour of evidence.
   * A dash says the same thing without the reassurance.
   */
  unknown: {
    ring: 'border-[var(--border-subtle)]',
    bg: 'bg-[var(--bg-elevated)]',
    text: 'text-[var(--text-muted)]',
    Icon: Minus,
  },
};

const VERDICT_STYLE = {
  ready: {
    label: 'Safe to send',
    Icon: ShieldCheck,
    border: 'border-emerald-500/25',
    wash: 'bg-emerald-500/[0.06]',
    chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
  risky: {
    label: 'Send with care',
    Icon: ShieldAlert,
    border: 'border-amber-500/25',
    wash: 'bg-amber-500/[0.06]',
    chip: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  blocked: {
    label: 'Not ready',
    Icon: ShieldAlert,
    border: 'border-rose-500/25',
    wash: 'bg-rose-500/[0.06]',
    chip: 'bg-rose-500/12 text-rose-700 dark:text-rose-400',
    icon: 'text-rose-600 dark:text-rose-400',
  },
} as const;

/** The small round status marker used everywhere a check appears. */
export function StatusDot({ status, className }: { status: ReadinessStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cn('flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full', s.bg, s.text, className)}>
      <s.Icon className="h-[11px] w-[11px]" strokeWidth={3} />
    </span>
  );
}

export function CheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <li className="flex items-start gap-2.5 px-3.5 py-2.5 border-b border-[var(--border-subtle)] last:border-0">
      <StatusDot status={check.status} className="mt-[3px]" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-body font-medium text-[var(--text-primary)]">{check.label}</span>
          <span className="text-body text-[var(--text-secondary)]">{check.headline}</span>
        </div>
        {check.detail && (
          <p className="mt-1 text-caption leading-relaxed text-[var(--text-tertiary)]">{check.detail}</p>
        )}
        {check.facts.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {check.facts.map((f) => (
              <span key={f.label} className="text-caption text-[var(--text-tertiary)]">
                {f.label} <span className="font-semibold tabular text-[var(--text-secondary)]">{f.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      {check.fix && (
        <Link
          to={check.fix.href}
          className="mt-[1px] inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-caption font-semibold text-[var(--indigo)] hover:bg-[var(--indigo-subtle)] transition-colors"
        >
          {check.fix.label}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </li>
  );
}

function capacityLine(report: ReadinessReport): string | null {
  if (report.capacity_today === null) return 'At least one mailbox sends without a daily cap.';
  if (report.capacity_ceiling === null || report.capacity_ceiling === 0) return null;
  return `${report.capacity_today.toLocaleString()} of ${report.capacity_ceiling.toLocaleString()} sends left today.`;
}

export function ReadinessPanel() {
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const { data: report, isLoading, isError, isFetching } = useQuery({
    queryKey: ['readiness'],
    queryFn: readinessApi.get,
    // A stale "safe to send" is worse than a slow one.
    staleTime: 0,
    meta: { silentError: true },
  });

  if (isLoading) {
    return <div className="h-40 rounded-xl bg-[var(--bg-elevated)] animate-pulse" />;
  }
  if (isError || !report) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
        <span className="flex-1 text-body text-[var(--text-secondary)]">
          Couldn&rsquo;t work out your sending readiness just now — that is this check failing, not a verdict on your setup.
        </span>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['readiness'] })}
          className="text-body font-semibold text-[var(--indigo)] hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const v = VERDICT_STYLE[report.verdict];
  const capacity = capacityLine(report);
  const attention = report.checks.filter((c) => c.status === 'warn' || c.status === 'fail');
  const passing = report.checks.filter((c) => c.status === 'pass');
  const unknown = report.checks.filter((c) => c.status === 'unknown');
  const settled = [...passing, ...unknown];
  const problems = attention.length;

  return (
    <div className="space-y-3">
      {/* ── The verdict ── */}
      <div className={cn('rounded-xl border p-4', v.border, v.wash)}>
        <div className="flex items-start gap-3">
          <span className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border bg-[var(--bg-surface)]', v.border)}>
            <v.Icon className={cn('h-5 w-5', v.icon)} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {/*
                * Sentence case, not a hazard placard. SEND WITH CARE in
                * bold caps shouts at somebody whose setup is very nearly
                * fine, and shouting is what you have left when the sentence
                * underneath is not carrying its weight.
                */}
              <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-caption font-semibold', v.chip)}>
                {v.label}
              </span>
              {problems > 0 && (
                <span className="text-caption text-[var(--text-tertiary)]">
                  {problems} of {report.checks.length} check{problems === 1 ? '' : 's'}{' '}
                  need{problems === 1 ? 's' : ''} attention
                </span>
              )}
            </div>
            <p className="mt-1.5 text-heading font-semibold leading-snug text-[var(--text-primary)]">
              {report.summary}
            </p>
            {capacity && (
              <p className="mt-1 text-body text-[var(--text-secondary)] tabular">{capacity}</p>
            )}
          </div>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['readiness'] })}
            disabled={isFetching}
            className="icon-btn h-7 px-2 text-caption flex-shrink-0"
            title="Re-run every check"
          >
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
            Re-check
          </button>
        </div>
      </div>

      {/*
        * What needs you, then everything else out of the way.
        *
        * This used to render four cards, one per group, listing all eight
        * checks at equal weight - so the single thing that wanted doing sat
        * fifth, styled identically to seven that did not, under editorial
        * headings nobody navigates by. A checklist where seven of eight are
        * green should show you the one. The seven are reassurance you
        * consult once, not content to scroll past every time.
        */}
      {attention.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
          <ul>{attention.map((c) => <CheckRow key={c.id} check={c} />)}</ul>
        </div>
      )}

      {settled.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex w-full items-center gap-2 px-3.5 h-10 text-left"
            aria-expanded={showAll}
            data-show-settled
          >
            <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" strokeWidth={3} />
            <span className="text-body text-[var(--text-secondary)]">
              {passing.length > 0 && <>{passing.length} check{passing.length === 1 ? '' : 's'} passing</>}
              {passing.length > 0 && unknown.length > 0 && ', '}
              {unknown.length > 0 && (
                <span className="text-[var(--text-tertiary)]">
                  {unknown.length} not measured yet
                </span>
              )}
            </span>
            <ChevronDown className={cn(
              'ml-auto h-4 w-4 flex-shrink-0 text-[var(--text-muted)] transition-transform',
              showAll && 'rotate-180',
            )} />
          </button>
          {showAll && (
            <ul className="border-t border-[var(--border-subtle)]">
              {settled.map((c) => <CheckRow key={c.id} check={c} />)}
            </ul>
          )}
        </div>
      )}

      <p className="text-caption text-[var(--text-muted)]">
        Checked {formatTime(new Date(report.generated_at))}.
        Every number here is the same one the send path uses.
      </p>
    </div>
  );
}

/**
 * The verdict alone, for places that need it beside something else — the
 * launch confirmation, most of all, where it is the last thing seen before
 * the emails start going out.
 */
export function ReadinessSummary({ className }: { className?: string }) {
  const { data: report, isLoading } = useQuery({
    queryKey: ['readiness'],
    queryFn: readinessApi.get,
    meta: { silentError: true },
  });

  if (isLoading || !report || report.verdict === 'ready') return null;

  const v = VERDICT_STYLE[report.verdict];
  const problems = report.checks.filter((c) => c.status !== 'pass');

  return (
    <div className={cn('rounded-lg border p-3', v.border, v.wash, className)}>
      <div className="flex items-start gap-2.5">
        <v.Icon className={cn('h-4 w-4 flex-shrink-0 mt-px', v.icon)} />
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-[var(--text-primary)]">{report.summary}</p>
          <ul className="mt-1.5 space-y-1">
            {problems.slice(0, 3).map((c) => (
              <li key={c.id} className="flex items-start gap-1.5 text-caption text-[var(--text-secondary)]">
                <StatusDot status={c.status} className="!h-3.5 !w-3.5 mt-[1px] [&>svg]:h-2 [&>svg]:w-2" />
                <span className="min-w-0">{c.headline}</span>
              </li>
            ))}
          </ul>
          <Link
            to="/email-accounts?tab=readiness"
            className="mt-2 inline-flex items-center gap-1 text-caption font-semibold text-[var(--indigo)] hover:underline"
          >
            See the full readiness check
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}

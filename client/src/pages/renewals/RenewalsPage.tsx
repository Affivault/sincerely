import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Check, X, Zap, Loader2, AlertTriangle, ArrowRight,
  Building2, Megaphone, RotateCw, CalendarDays,
} from 'lucide-react';
import {
  RENEWAL_BANDS, renewalPhrase, type RenewalBandId,
} from '@lemlist/shared';
import { renewalsApi, type RenewalRow } from '../../api/renewals.api';
import { EmptyState } from '../../components/shared/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   The renewals book.

   Every B2B business runs one. Almost none of them run it in software - it
   is a spreadsheet, or a set of calendar reminders, or somebody's memory,
   which is why the standard way to lose a customer is to notice the
   renewal a fortnight after it rolled over on their terms.

   Nothing on this page is new information. The term and the close date were
   already recorded; this is the arithmetic nobody was doing. What makes it
   worth a page rather than a column is that the answer is a number with
   money attached and a date attached, and both of those are things people
   act on.
   ═══════════════════════════════════════════════════════════════════════ */

function money(v: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0,
    }).format(v || 0);
  } catch {
    return `$${Math.round(v || 0).toLocaleString()}`;
  }
}

/** How urgent a band looks. Overdue is the only one that shouts. */
const BAND_TONE: Record<RenewalBandId, { chip: string; bar: string }> = {
  overdue:    { chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',       bar: 'bg-rose-500' },
  this_week:  { chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',    bar: 'bg-amber-500' },
  this_month: { chip: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400', bar: 'bg-indigo-500' },
  quarter:    { chip: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',    bar: 'bg-slate-400' },
  later:      { chip: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',    bar: 'bg-slate-300' },
};

const BAND_LABEL: Record<RenewalBandId, string> =
  Object.fromEntries(RENEWAL_BANDS.map((b) => [b.id, b.label])) as Record<RenewalBandId, string>;

export function RenewalsPage() {
  const qc = useQueryClient();
  const [band, setBand] = useState<RenewalBandId | 'all'>('all');
  /** Which row is mid-question, and which question. */
  const [asking, setAsking] = useState<{ id: string; kind: 'churn' | 'date' } | null>(null);
  const [draftDate, setDraftDate] = useState('');
  const [churnReason, setChurnReason] = useState('');

  const { data: rows, isLoading } = useQuery({
    queryKey: ['renewals', 'list'],
    queryFn: () => renewalsApi.list({ status: 'upcoming' }),
  });
  const { data: summary } = useQuery({
    queryKey: ['renewals', 'summary'],
    queryFn: renewalsApi.summary,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['renewals'] });
    // A renewal decision makes or closes a deal, so the board and the
    // forecast are wrong until they refetch too.
    qc.invalidateQueries({ queryKey: ['crm'] });
    qc.invalidateQueries({ queryKey: ['deals'] });
  };

  const renewed = useMutation({
    mutationFn: (id: string) => renewalsApi.markRenewed(id),
    onSuccess: (r) => {
      invalidate();
      setAsking(null);
      toast.success(r.created
        ? `Renewed — the next term is now its own deal`
        : 'Already recorded as renewed');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not record that'),
  });

  const churned = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => renewalsApi.markChurned(id, reason),
    onSuccess: () => {
      invalidate();
      setAsking(null);
      setChurnReason('');
      toast.success('Recorded. They are not suppressed — a lapsed customer is still a warm lead.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not record that'),
  });

  const setDate = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string }) =>
      renewalsApi.update(id, { renewal_date: date || null }),
    onSuccess: () => {
      invalidate();
      setAsking(null);
      toast.success('Renewal date updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save that date'),
  });

  const runTriggers = useMutation({
    mutationFn: renewalsApi.runTriggers,
    onSuccess: (report) => {
      invalidate();
      if (report.campaigns === 0) {
        toast('No customer campaign is set to start from a renewal yet.', { icon: 'ℹ️' });
      } else if (report.enrolled > 0) {
        toast.success(`${report.enrolled} enrolled from ${report.matched} renewal(s)`);
      } else {
        // The important case. "Nothing happened" with no reason is how an
        // automation stays quietly broken for a month.
        const why = Object.entries(report.reasons).map(([r, n]) => `${r.replace(/_/g, ' ')}: ${n}`).join(', ');
        toast(why
          ? `Nothing new to enrol — ${why}`
          : `Nothing due yet across ${report.campaigns} campaign(s)`, { duration: 6000 });
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not run the triggers'),
  });

  const visible = useMemo(
    () => (rows || []).filter((r) => band === 'all' || r.band === band),
    [rows, band],
  );

  const busy = renewed.isPending || churned.isPending || setDate.isPending;

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-6">
      {/* ── What is coming, and what it is worth ── */}
      <header className="mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">Renewals</h1>
            <p className="mt-1 text-[12.5px] text-[var(--text-secondary)] max-w-xl leading-relaxed">
              {summary && summary.totalCount > 0
                ? <>
                    <strong className="text-[var(--text-primary)]">{money(summary.atRiskValue)}</strong>
                    {' '}of recurring revenue comes up in the next 90 days
                    {summary.overdueCount > 0 && <>, and <strong className="text-rose-600 dark:text-rose-400">{summary.overdueCount}</strong> already passed</>}.
                  </>
                : 'Every won deal with a term shows up here when its renewal approaches.'}
            </p>
          </div>
          <button
            onClick={() => runTriggers.mutate()}
            disabled={runTriggers.isPending}
            title="Run the renewal triggers now instead of waiting for the next tick"
            className="inline-flex flex-shrink-0 items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
          >
            {runTriggers.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Zap className="h-3.5 w-3.5" />}
            Run sequences now
          </button>
        </div>

        {/* The year, banded. Clicking one filters the book below it. */}
        {summary && summary.totalCount > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {summary.bands.map((b) => {
              const active = band === b.id;
              const tone = BAND_TONE[b.id];
              return (
                <button
                  key={b.id}
                  onClick={() => setBand(active ? 'all' : b.id)}
                  title={b.hint}
                  className={cn(
                    'group rounded-xl border px-3 py-2.5 text-left transition-colors',
                    active
                      ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', tone.bar)} />
                    <span className="text-[11px] font-medium text-[var(--text-tertiary)] truncate">{b.label}</span>
                  </div>
                  <p className="mt-1 text-[15px] font-semibold tabular text-[var(--text-primary)] leading-tight">
                    {money(b.value)}
                  </p>
                  <p className="text-[11px] text-[var(--text-tertiary)] tabular">
                    {b.count} {b.count === 1 ? 'deal' : 'deals'}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* ── The book ── */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 h-[34px] bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] text-[11px] font-medium text-[var(--text-tertiary)]">
          <span className="flex-1 min-w-0">Customer</span>
          <span className="w-[130px] flex-shrink-0 hidden md:block">Renews</span>
          <span className="w-[110px] flex-shrink-0 text-right">At stake</span>
          <span className="w-[210px] flex-shrink-0 text-right">Did they?</span>
        </div>

        {isLoading ? (
          <div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 h-[52px] border-b border-[var(--border-subtle)]">
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-[110px]" />
                <Skeleton className="h-3 w-[80px]" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={band === 'all' ? 'No renewals on the books' : `Nothing ${BAND_LABEL[band as RenewalBandId].toLowerCase()}`}
            description={band === 'all'
              // Says exactly what to do, because the commonest reason this
              // page is empty is a term nobody filled in, not a lack of
              // customers.
              ? 'A won deal shows up here once it has a term on it. Add one to a closed deal and its renewal date works itself out.'
              : 'Nothing in this band. Clear the filter to see the rest of the year.'}
            actionLabel={band === 'all' ? undefined : 'Show everything'}
            onAction={band === 'all' ? undefined : () => setBand('all')}
          />
        ) : (
          visible.map((row) => (
            <RenewalRowView
              key={row.id}
              row={row}
              busy={busy}
              asking={asking?.id === row.id ? asking.kind : null}
              draftDate={draftDate}
              churnReason={churnReason}
              onAsk={(kind) => {
                setAsking(kind ? { id: row.id, kind } : null);
                setDraftDate(row.renewal_date || '');
                setChurnReason('');
              }}
              onDraftDate={setDraftDate}
              onChurnReason={setChurnReason}
              onRenewed={() => renewed.mutate(row.id)}
              onChurned={() => churned.mutate({ id: row.id, reason: churnReason })}
              onSaveDate={() => setDate.mutate({ id: row.id, date: draftDate })}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RenewalRowView({
  row, busy, asking, draftDate, churnReason,
  onAsk, onDraftDate, onChurnReason, onRenewed, onChurned, onSaveDate,
}: {
  row: RenewalRow;
  busy: boolean;
  asking: 'churn' | 'date' | null;
  draftDate: string;
  churnReason: string;
  onAsk: (kind: 'churn' | 'date' | null) => void;
  onDraftDate: (v: string) => void;
  onChurnReason: (v: string) => void;
  onRenewed: () => void;
  onChurned: () => void;
  onSaveDate: () => void;
}) {
  const tone = row.band ? BAND_TONE[row.band] : BAND_TONE.later;
  const phrase = renewalPhrase(row as any);
  // The notice deadline, when there is one, is the date that actually
  // matters — and it is the one nothing else in this app would show.
  const noticeMatters = row.action_by && row.action_by !== row.renewal_date;

  return (
    <div className="border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex items-center gap-3 px-4 py-2.5 min-h-[52px]">
        {/* Customer */}
        <div className="flex-1 min-w-0">
          <Link
            to={`/deals/${row.id}`}
            className="group inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-primary)] hover:text-[var(--indigo)] transition-colors"
          >
            <span className="truncate">{row.company || row.title}</span>
            <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </Link>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            {row.company && row.company !== row.title && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] truncate">
                <Building2 className="h-2.5 w-2.5 flex-shrink-0" /> {row.title}
              </span>
            )}
            {/* Where the relationship came from, carried through the years.
                This is the link every other stack loses at the handoff. */}
            {row.source_campaign_id && (
              <Link
                to={`/analytics/revenue/${row.source_campaign_id}`}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--indigo)]"
                title="This customer came from outreach — see what that campaign earned"
              >
                <Megaphone className="h-2.5 w-2.5" /> from outreach
              </Link>
            )}
          </div>
        </div>

        {/* Renews */}
        <div className="w-[130px] flex-shrink-0 hidden md:block">
          <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold', tone.chip)}>
            {row.band === 'overdue' && <AlertTriangle className="h-2.5 w-2.5" />}
            {phrase || 'no date'}
          </span>
          {noticeMatters && (
            <p className="mt-0.5 text-[10.5px] text-[var(--text-tertiary)]" title="Notice has to be given by this date, so this is the real deadline">
              notice by {row.action_by}
            </p>
          )}
        </div>

        {/* At stake */}
        <div className="w-[110px] flex-shrink-0 text-right">
          <p className="text-[13px] font-semibold tabular text-[var(--text-primary)]">
            {money(row.renewal_value, row.currency || 'USD')}
          </p>
          <p className="text-[10.5px] text-[var(--text-tertiary)]">
            {row.recurring_amount ? 'a year' : 'one-off'}
          </p>
        </div>

        {/* The one decision this page exists for */}
        <div className="w-[210px] flex-shrink-0 flex items-center justify-end gap-1.5">
          {asking ? null : (
            <>
              <button
                onClick={onRenewed}
                disabled={busy}
                title="They renewed. The next term becomes its own deal, so this year's revenue is not counted twice."
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[var(--indigo)] text-white text-[11.5px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <Check className="h-3 w-3" /> Renewed
              </button>
              <button
                onClick={() => onAsk('churn')}
                disabled={busy}
                title="They did not renew"
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
              >
                <X className="h-3 w-3" /> Churned
              </button>
              <button
                onClick={() => onAsk('date')}
                disabled={busy}
                title="Change the renewal date"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
              >
                <CalendarDays className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Churn asks for a reason — churn you cannot count is churn you cannot fix. */}
      {asking === 'churn' && (
        <div className="flex items-center gap-2 flex-wrap px-4 pb-3">
          <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">Why did they go?</span>
          {['Price', 'Switched supplier', 'No longer needed', 'Unhappy', 'Went quiet'].map((r) => (
            <button
              key={r}
              onClick={() => { onChurnReason(r); }}
              className={cn(
                'h-7 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors',
                churnReason === r
                  ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-rose-500/50',
              )}
            >
              {r}
            </button>
          ))}
          <button
            onClick={onChurned}
            disabled={busy}
            className="h-7 rounded-md bg-rose-600 px-2.5 text-[11.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Record it
          </button>
          <button onClick={() => onAsk(null)} className="h-7 px-2 text-[11.5px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            Cancel
          </button>
          <span className="text-[10.5px] text-[var(--text-tertiary)] w-full">
            They stay emailable. A customer who left is the warmest lead most businesses have.
          </span>
        </div>
      )}

      {/* Correcting the date. A derived date is a starting point, not a fact. */}
      {asking === 'date' && (
        <div className="flex items-center gap-2 flex-wrap px-4 pb-3">
          <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">Renews on</span>
          <input
            type="date"
            value={draftDate}
            onChange={(e) => onDraftDate(e.target.value)}
            className="h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[11.5px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
          />
          <button
            onClick={onSaveDate}
            disabled={busy}
            className="h-7 rounded-md bg-[var(--indigo)] px-2.5 text-[11.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </button>
          <button onClick={() => onAsk(null)} className="h-7 px-2 text-[11.5px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            Cancel
          </button>
          <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-tertiary)]">
            <RotateCw className="h-2.5 w-2.5" />
            Derived from the close date and the term. Change it and it stays changed.
          </span>
        </div>
      )}
    </div>
  );
}

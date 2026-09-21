import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  MessageSquare, Clock, AlertTriangle, Hand, Inbox, CheckCircle2,
  CalendarClock, Banknote, ChevronRight, Info, Undo2,
} from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { AsyncPanel } from '../../components/ui/AsyncPanel';
import { replyQueueApi, type QueuedReply, type QueueFilter } from '../../api/replyQueue.api';
import { cn } from '../../lib/utils';
import { replyStateLabel, waitLabel, type ReplyUrgency } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   What you owe people, hardest first.

   Forty replies land, three matter, and the three get lost. That is where
   cold outreach actually leaks money, and it was the one part of the loop
   this app had nothing for: a reply could be classified and triaged, but
   nothing said how long somebody had been waiting or what to do first.

   This is deliberately not another tab in the unibox. Reading mail and
   working a queue are different jobs - one is "show me my mail", the
   other is "what do I owe, and what is late". Every row opens the real
   thread in the unibox, so it is one place to decide and one place to
   act rather than two places doing the same thing.

   The ordering is the feature. It comes from shared/reply-queue, where
   intent leads, what is at stake follows, and lateness is a tiebreak
   rather than the sort key - rank on age alone and the top of the queue
   is permanently held by the oldest thing nobody was ever going to
   convert, which teaches people to ignore the top of the queue.
   ═══════════════════════════════════════════════════════════════════════ */

const URGENCY: Record<ReplyUrgency, { dot: string; text: string; chip: string }> = {
  overdue:    { dot: 'bg-rose-500',  text: 'text-rose-600 dark:text-rose-400',       chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  'due-soon': { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400',     chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  waiting:    { dot: 'bg-[var(--indigo)]', text: 'text-[var(--text-secondary)]',      chip: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]' },
  parked:     { dot: 'bg-[var(--text-muted)]', text: 'text-[var(--text-tertiary)]',   chip: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]' },
  done:       { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', chip: 'bg-emerald-500/10 text-emerald-600' },
};

const INTENT_LABEL: Record<string, string> = {
  meeting: 'Wants to book',
  interested: 'Interested',
  objection: 'Objection',
  not_now: 'Not now',
  other: 'Reply',
};

/** Common parking spots, as offsets. Absolute dates need a picker nobody wants mid-triage. */
const SNOOZE_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: 'Tomorrow', ms: 24 * 60 * 60 * 1000 },
  { label: 'In 3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: 'Next week', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'In a month', ms: 30 * 24 * 60 * 60 * 1000 },
];

function money(n: number): string {
  if (n >= 1000) return `£${Math.round(n / 1000)}k`;
  return `£${Math.round(n)}`;
}

/* ── One reply ────────────────────────────────────────────────────────── */

function ReplyRow({ reply, onOpen, onClaim, onPark, busy }: {
  reply: QueuedReply;
  onOpen: () => void;
  onClaim: () => void;
  onPark: (ms: number | null) => void;
  busy: boolean;
}) {
  const [parkOpen, setParkOpen] = useState(false);
  const u = URGENCY[reply.state.urgency];
  const intent = INTENT_LABEL[reply.sara_intent || ''] || 'Reply';
  const snippet = (reply.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 160);

  return (
    <div className="group relative flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-0 transition-colors hover:bg-[var(--bg-hover)]">
      {/* Urgency, as one mark rather than a colour on everything. */}
      <span className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', u.dot)} />

      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
            {reply.from_email}
          </span>
          <span className="text-[11px] font-medium text-[var(--text-tertiary)]">{intent}</span>

          {/* What is on the table. A reply against an open deal is a
              different conversation from one that is not. */}
          {reply.deal_value ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)]">
              <Banknote className="h-3 w-3" /> {money(reply.deal_value)} open
            </span>
          ) : null}
        </div>

        {reply.subject && (
          <p className="mt-0.5 truncate text-[12px] text-[var(--text-secondary)]">{reply.subject}</p>
        )}
        {snippet && (
          <p className="mt-0.5 line-clamp-1 text-[11.5px] leading-snug text-[var(--text-tertiary)]">{snippet}</p>
        )}

        {/*
          * The clock, in words. "Overdue" on its own is a colour; "waiting
          * 6h, past the 2h this kind gets" is a claim somebody can
          * disagree with, which is what makes it worth reading.
          */}
        <p className={cn('mt-1 text-[11px] font-medium', u.text)} data-reply-state>
          {replyStateLabel(reply.state)}
          {reply.snooze_note && reply.state.urgency === 'parked' && (
            <span className="font-normal text-[var(--text-tertiary)]"> — {reply.snooze_note}</span>
          )}
        </p>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {/*
          * Claimed, or nobody has it. Shown always rather than on hover:
          * unowned work is the work that gets dropped, so the absence has
          * to be as visible as the presence.
          */}
        <button
          type="button"
          onClick={onClaim}
          disabled={busy}
          title={reply.assigned_to ? 'You have this. Click to hand it back.' : 'Nobody has picked this up'}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium transition-colors disabled:opacity-60',
            reply.assigned_to
              ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
              : 'border border-dashed border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
          )}
          data-reply-claim
        >
          <Hand className="h-3 w-3" />
          {reply.assigned_to ? 'Yours' : 'Claim'}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setParkOpen((v) => !v)}
            disabled={busy}
            title={reply.state.urgency === 'parked' ? 'Bring it back now' : 'Park this until later'}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-60"
            data-reply-park
          >
            {reply.state.urgency === 'parked'
              ? <><Undo2 className="h-3 w-3" /> Unpark</>
              : <><CalendarClock className="h-3 w-3" /> Park</>}
          </button>

          {parkOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setParkOpen(false)} />
              <div className="absolute right-0 top-8 z-50 w-40 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] py-1 shadow-[var(--shadow-xl)]">
                {reply.state.urgency === 'parked' ? (
                  <button
                    type="button"
                    onClick={() => { onPark(null); setParkOpen(false); }}
                    className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  >
                    Bring it back now
                  </button>
                ) : SNOOZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => { onPark(opt.ms); setParkOpen(false); }}
                    className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <ChevronRight className="h-4 w-4 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </div>
  );
}

/* ── The page ─────────────────────────────────────────────────────────── */

export function RepliesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<QueueFilter>('all');

  const queueQuery = useQuery({
    queryKey: ['reply-queue', filter],
    queryFn: () => replyQueueApi.queue(filter),
    // The clock moves whether or not anybody reloads, and a queue showing
    // a stale "3h" is a queue that quietly stops being a queue.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['reply-queue'] });

  const claim = useMutation({
    mutationFn: ({ id, assigned }: { id: string; assigned: boolean }) => replyQueueApi.assign(id, assigned),
    onSuccess: invalidate,
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not update that reply'),
  });

  const park = useMutation({
    mutationFn: ({ id, ms }: { id: string; ms: number | null }) =>
      replyQueueApi.snooze(id, ms === null ? null : new Date(Date.now() + ms).toISOString()),
    onSuccess: (_d, vars) => {
      invalidate();
      toast.success(vars.ms === null ? 'Back in the queue' : 'Parked');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not park that reply'),
  });

  const { data } = queueQuery;
  const counts = data?.counts;

  const tabs = useMemo(() => ([
    { id: 'all' as const, label: 'Open', count: counts?.open },
    { id: 'overdue' as const, label: 'Late', count: counts?.overdue },
    { id: 'unassigned' as const, label: 'Unclaimed', count: counts?.unassigned },
    { id: 'mine' as const, label: 'Yours', count: counts?.mine },
    { id: 'parked' as const, label: 'Parked', count: counts?.parked },
  ]), [counts]);

  return (
    <div className="stagger space-y-5 pb-8">
      <PageHeader
        className="!mx-0 !mt-0 rounded-xl border border-[var(--border-subtle)]"
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[rgba(91,91,245,0.18)] bg-[var(--indigo-subtle)]">
            <MessageSquare className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Replies"
        description="What you owe people, hardest first. A request to book outranks an objection, however long the objection has waited."
        meta={
          counts ? (
            <>
              <span className="tabular">{counts.open} open</span>
              {counts.overdue > 0 && (
                <>
                  <span className="sep-dot" />
                  <span className="tabular font-semibold text-rose-500">{counts.overdue} late</span>
                </>
              )}
              {counts.unassigned > 0 && (
                <>
                  <span className="sep-dot" />
                  <span className="tabular">{counts.unassigned} unclaimed</span>
                </>
              )}
            </>
          ) : undefined
        }
      />

      {/* Filters. Counts on every one, so "Late: 0" is a fact rather than
          an empty tab you have to click to discover. */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-1 scrollbar-none">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors',
              filter === t.id
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            {t.label}
            {t.count != null && (
              <span className={cn(
                'tabular text-[11px]',
                t.id === 'overdue' && t.count > 0 ? 'font-semibold text-rose-500' : 'text-[var(--text-tertiary)]',
              )}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/*
        * Loading, empty and failed all come from one place, so this screen
        * resolves exactly like every other one. It used to hand-roll all
        * three - a pulsing block, a bespoke panel, and nothing at all for a
        * failure, which left a blank area and a toast that had already gone.
        */}
      <AsyncPanel
        query={queueQuery}
        skeleton="list"
        skeletonRows={6}
        isEmpty={(d) => d.items.length === 0}
        empty={{
          icon: CheckCircle2,
          title: filter === 'overdue' ? 'Nothing is late'
            : filter === 'parked' ? 'Nothing parked'
            : filter === 'mine' ? 'Nothing claimed'
            : 'Nobody is waiting on you',
          description: filter === 'all'
            ? 'Every reply that needs a human has had one. Out-of-office messages and unsubscribes never appear here \u2014 they are not people waiting.'
            : 'Nothing in this view right now.',
        }}
      >
        {(d) => (
          <section className="panel overflow-hidden">
            <div className="divide-y divide-[var(--border-subtle)]">
              {d.items.map((reply) => (
                <ReplyRow
                  key={reply.id}
                  reply={reply}
                  busy={claim.isPending || park.isPending}
                  onOpen={() => navigate(`/inbox?message=${reply.id}`)}
                  onClaim={() => claim.mutate({ id: reply.id, assigned: !reply.assigned_to })}
                  onPark={(ms) => park.mutate({ id: reply.id, ms })}
                />
              ))}
            </div>
          </section>
        )}
      </AsyncPanel>

      {/*
        * What is not in here, said plainly. A queue whose headline number
        * includes robots is a number people stop believing within a week -
        * and then the real ones are hidden behind something nobody reads.
        */}
      <div className="flex items-start gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-4 py-3">
        <Info className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
        <p className="text-[11.5px] leading-relaxed text-[var(--text-secondary)]" data-queue-caveat>
          Out-of-office replies, bounces and unsubscribes never enter this queue — nobody is waiting on
          an answer to those. The clock stops when you actually reply, not when you triage: deciding a
          reply is &ldquo;interested&rdquo; is a note to yourself. How long each kind gets before it is
          late is set by intent — two hours for someone asking to book, a day for an objection — because
          one flat number would be either hysterical or useless.
        </p>
      </div>
    </div>
  );
}

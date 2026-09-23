/* ═══════════════════════════════════════════════════════════════════════
   Flow - the day, as one list of decisions.

   Replies waiting on you, deals going quiet, the next meeting and the one
   that just ended, the tasks due: ranked together, each with the next
   move prepared. Built to be worked top to bottom by keyboard:

     j / k   move          enter   do the prepared thing
     d       done           s       not now (back tomorrow)
     o       open it        e       edit the draft
     p       peek at the person or deal behind it

   Anything with a cost - completing a task, marking a reply handled - goes
   through the undo bar, so moving fast is never a risk.
   ═══════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  CalendarClock, CheckCircle2, Clock, Handshake, Inbox, Keyboard, ListChecks, Loader2,
  MessageSquareReply, RefreshCw, Send, Sparkles, Sun, Video, Waves,
} from 'lucide-react';
import {
  DEAL_ACTION_LABEL, type FlowItem, type FlowKind,
} from '@lemlist/shared';
import { flowApi } from '../../api/flow.api';
import { saraApi } from '../../api/sara.api';
import { crmApi } from '../../api/crm.api';
import { replyQueueApi } from '../../api/replyQueue.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { useDeferredAction } from '../../components/ui/UndoBar';
import { usePeek } from '../../components/peek/usePeek';
import { DealHealthDot, ACTION_ICON } from '../../components/crm/DealHealth';
import { MeetingBrief, MeetingOutcome } from '../../components/flow/MeetingBrief';
import { cn, formatRelativeTime, formatTimeUntil } from '../../lib/utils';

/* ─── "Not now": hidden until tomorrow morning, per browser ────────────── */

const SNOOZE_KEY = 'sincerely_flow_snoozed';

function tomorrowMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d;
}

function readSnoozed(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, until]) => until > now));
  } catch { return {}; }
}

function writeSnoozed(map: Record<string, number>) {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(map)); } catch { /* private mode */ }
}

const KIND_META: Record<FlowKind, { label: string; icon: typeof Inbox; tint: string }> = {
  meeting: { label: 'Meetings', icon: CalendarClock, tint: 'text-sky-500' },
  reply:   { label: 'Replies',  icon: MessageSquareReply, tint: 'text-[var(--indigo)]' },
  deal:    { label: 'Deals',    icon: Handshake, tint: 'text-amber-500' },
  task:    { label: 'Tasks',    icon: ListChecks, tint: 'text-emerald-500' },
};

const INTENT_LABEL: Record<string, string> = {
  interested: 'Interested', meeting: 'Wants a meeting', objection: 'Objection',
  not_now: 'Not now', other: 'Reply', question: 'Question',
};

function money(v: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v); }
  catch { return `${currency} ${Math.round(v)}`; }
}

function waited(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 48) return `${h}h waiting`;
  return `${Math.floor(h / 24)}d waiting`;
}

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

export function FlowPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const offer = useDeferredAction();
  const { openPeek } = usePeek();
  const [snoozed, setSnoozed] = useState<Record<string, number>>(() => readSnoozed());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FlowKind | 'all'>('all');
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['flow'],
    queryFn: flowApi.get,
    refetchInterval: 60_000,
  });

  const items = useMemo(() => (data?.items || []).filter((i) =>
    !gone.has(i.key) && !snoozed[i.key] && (filter === 'all' || i.kind === filter)), [data, gone, snoozed, filter]);

  const counts = useMemo(() => {
    const c: Record<FlowKind, number> = { meeting: 0, reply: 0, deal: 0, task: 0 };
    for (const i of data?.items || []) if (!gone.has(i.key) && !snoozed[i.key]) c[i.kind]++;
    return c;
  }, [data, gone, snoozed]);
  const total = counts.meeting + counts.reply + counts.deal + counts.task;

  useEffect(() => { if (cursor >= items.length) setCursor(Math.max(0, items.length - 1)); }, [items.length, cursor]);
  const current = items[cursor];

  // Keep the selected card in view as the cursor moves.
  useEffect(() => {
    if (!current) return;
    listRef.current?.querySelector(`[data-key="${CSS.escape(current.key)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const hide = useCallback((key: string) => setGone((g) => new Set(g).add(key)), []);
  const unhide = useCallback((key: string) => setGone((g) => { const n = new Set(g); n.delete(key); return n; }), []);

  const snooze = useCallback((item: FlowItem) => {
    const until = tomorrowMorning();
    if (item.kind === 'reply' && item.reply) {
      replyQueueApi.snooze(item.reply.message_id, until.toISOString(), 'Not now, from Flow').catch(() => {});
    } else if (item.kind === 'task' && item.task) {
      crmApi.updateTask(item.task.task_id, { due_date: until.toISOString() }).catch(() => {});
    }
    const next = { ...readSnoozed(), [item.key]: until.getTime() };
    writeSnoozed(next);
    setSnoozed(next);
    toast.success('Back tomorrow morning');
  }, []);

  const sendDraft = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => saraApi.approve(id, text),
    onMutate: ({ id }) => hide(`reply:${id}`),
    onSuccess: () => { toast.success('Reply sent'); qc.invalidateQueries({ queryKey: ['reply-queue'] }); },
    onError: (e: any, { id }) => { unhide(`reply:${id}`); toast.error(e?.response?.data?.error || 'Could not send that reply'); },
  });

  const done = useCallback((item: FlowItem) => {
    if (item.kind === 'task' && item.task) {
      hide(item.key);
      offer({
        id: item.key,
        label: 'Task completed',
        commit: () => crmApi.updateTask(item.task!.task_id, { is_done: true }).then(() => qc.invalidateQueries({ queryKey: ['crm'] })),
        revert: () => unhide(item.key),
      });
    } else if (item.kind === 'reply' && item.reply) {
      hide(item.key);
      offer({
        id: item.key,
        label: 'Marked handled',
        commit: () => flowApi.handled(item.reply!.message_id),
        revert: () => unhide(item.key),
      });
    } else if (item.kind === 'meeting' && item.meeting?.needs_outcome) {
      setOpen(item.key);
    } else {
      // Deals and upcoming meetings are not "done" from here - just out of the way.
      snooze(item);
    }
  }, [hide, unhide, offer, qc, snooze]);

  const openItem = useCallback((item: FlowItem) => {
    if (item.reply) navigate(`/inbox?message=${item.reply.message_id}`);
    else if (item.deal) navigate(`/deals/${item.deal.deal_id}`);
    else if (item.meeting?.deal_id) navigate(`/deals/${item.meeting.deal_id}`);
    else if (item.meeting) navigate('/calendar');
    else if (item.task?.deal_id) navigate(`/deals/${item.task.deal_id}`);
    else navigate('/tasks');
  }, [navigate]);

  const primary = useCallback((item: FlowItem) => {
    if (item.kind === 'reply' && item.reply) {
      const text = drafts[item.key] ?? item.reply.draft;
      if (text && text.trim()) sendDraft.mutate({ id: item.reply.message_id, text });
      else openItem(item);
    } else if (item.kind === 'meeting') {
      setOpen((o) => (o === item.key ? null : item.key));
    } else if (item.kind === 'task') {
      done(item);
    } else {
      openItem(item);
    }
  }, [drafts, sendDraft, openItem, done]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!current && !['r'].includes(e.key)) return;
      switch (e.key) {
        case 'j': case 'ArrowDown': e.preventDefault(); setCursor((c) => Math.min(items.length - 1, c + 1)); break;
        case 'k': case 'ArrowUp': e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); break;
        case 'Enter': e.preventDefault(); primary(current); break;
        case 'd': e.preventDefault(); done(current); break;
        case 's': e.preventDefault(); snooze(current); break;
        case 'o': e.preventDefault(); openItem(current); break;
        case 'p': {
          // Peek: who this is, without leaving the queue.
          const contact = current.reply?.contact_id || current.meeting?.contact_id;
          const deal = current.deal?.deal_id || current.task?.deal_id || current.meeting?.deal_id;
          if (contact) { e.preventDefault(); openPeek('contact', contact); }
          else if (deal) { e.preventDefault(); openPeek('deal', deal); }
          break;
        }
        case 'e':
          if (current.kind === 'reply') { e.preventDefault(); setEditing(current.key); }
          break;
        case ' ':
          e.preventDefault(); setOpen((o) => (o === current.key ? null : current.key)); break;
        case 'r': e.preventDefault(); refetch(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, items.length, primary, done, snooze, openItem, refetch, openPeek]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Flow"
        description={isLoading ? 'Gathering your day...' : total === 0
          ? `${greeting}. Nothing needs you right now.`
          : `${greeting}. ${total} thing${total === 1 ? '' : 's'} need${total === 1 ? 's' : ''} a decision, most urgent first.`}
        actions={
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] text-body font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title="Refresh (r)"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Refresh
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['all', 'meeting', 'reply', 'deal', 'task'] as const).map((k) => {
          const n = k === 'all' ? total : counts[k];
          const Icon = k === 'all' ? Waves : KIND_META[k].icon;
          return (
            <button
              key={k}
              onClick={() => { setFilter(k); setCursor(0); }}
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-body font-medium transition-colors',
                filter === k
                  ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', k !== 'all' && filter !== k && KIND_META[k].tint)} />
              {k === 'all' ? 'Everything' : KIND_META[k].label}
              <span className="tabular text-caption opacity-70">{n}</span>
            </button>
          );
        })}
        <span className="ml-auto hidden items-center gap-1.5 text-caption text-[var(--text-tertiary)] md:inline-flex">
          <Keyboard className="h-3.5 w-3.5" />
          <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>enter</kbd> do it · <kbd>d</kbd> done · <kbd>s</kbd> tomorrow · <kbd>p</kbd> peek · <kbd>o</kbd> open
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-[var(--text-tertiary)]"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
          <p className="text-body text-[var(--text-secondary)]">Flow could not be loaded.</p>
          <button onClick={() => refetch()} className="mt-2 text-body font-medium text-[var(--indigo)] hover:underline">Try again</button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-16 text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10">
            <Sun className="h-6 w-6 text-emerald-500" />
          </span>
          <p className="text-strong font-semibold text-[var(--text-primary)]">
            {filter === 'all' ? 'All clear.' : `No ${KIND_META[filter].label.toLowerCase()} need you.`}
          </p>
          <p className="mt-1 max-w-sm text-body text-[var(--text-tertiary)]">
            New replies, meetings and deals that need a nudge will land here as they happen.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={() => navigate('/prospector')} className="h-8 px-3 rounded-lg border border-[var(--border-default)] text-body font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Find new leads</button>
            <button onClick={() => navigate('/deals')} className="h-8 px-3 rounded-lg border border-[var(--border-default)] text-body font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Review pipeline</button>
          </div>
        </div>
      ) : (
        <div ref={listRef} className="space-y-2">
          {items.map((item, i) => (
            <FlowCard
              key={item.key}
              item={item}
              selected={i === cursor}
              expanded={open === item.key || (i === cursor && item.kind === 'reply' && !!(item.reply?.draft))}
              draft={drafts[item.key] ?? item.reply?.draft ?? ''}
              editing={editing === item.key}
              sending={sendDraft.isPending && sendDraft.variables?.id === item.reply?.message_id}
              onSelect={() => setCursor(i)}
              onDraft={(t) => setDrafts((d) => ({ ...d, [item.key]: t }))}
              onEditDone={() => setEditing(null)}
              onPrimary={() => primary(item)}
              onDone={() => done(item)}
              onSnooze={() => snooze(item)}
              onOpen={() => openItem(item)}
              onToggle={() => setOpen((o) => (o === item.key ? null : item.key))}
              onOutcomeSaved={() => hide(item.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ml-1 hidden rounded border border-current/20 px-1 text-micro opacity-60 md:inline">{children}</kbd>;
}

function FlowCard({
  item, selected, expanded, draft, editing, sending,
  onSelect, onDraft, onEditDone, onPrimary, onDone, onSnooze, onOpen, onToggle, onOutcomeSaved,
}: {
  item: FlowItem; selected: boolean; expanded: boolean; draft: string; editing: boolean; sending: boolean;
  onSelect: () => void; onDraft: (t: string) => void; onEditDone: () => void;
  onPrimary: () => void; onDone: () => void; onSnooze: () => void; onOpen: () => void; onToggle: () => void;
  onOutcomeSaved: () => void;
}) {
  const meta = KIND_META[item.kind];
  const Icon = meta.icon;

  let title = '';
  let sub: React.ReactNode = null;
  let primaryLabel = 'Open';
  let PrimaryIcon: typeof Send = Send;
  let doneLabel = 'Done';

  if (item.reply) {
    const r = item.reply;
    title = r.contact_name ? `${r.contact_name}${r.company ? ` · ${r.company}` : ''}` : r.from_email;
    sub = (
      <>
        <span className="font-medium text-[var(--text-secondary)]">{r.subject || '(no subject)'}</span>
        {r.snippet && <span> - {r.snippet}</span>}
      </>
    );
    primaryLabel = draft.trim() ? 'Send reply' : 'Write reply';
    PrimaryIcon = draft.trim() ? Send : MessageSquareReply;
    doneLabel = 'Handled';
  } else if (item.deal) {
    const d = item.deal;
    title = d.title;
    sub = <>{d.company ? `${d.company} · ` : ''}{money(d.value, d.currency)} · {item.why}</>;
    primaryLabel = DEAL_ACTION_LABEL[d.health.next_action] || 'Open deal';
    PrimaryIcon = ACTION_ICON[d.health.next_action];
    doneLabel = 'Tomorrow';
  } else if (item.meeting) {
    const m = item.meeting;
    title = m.title;
    sub = m.needs_outcome
      ? <>Ended {formatRelativeTime(m.ends_at || m.starts_at)}{m.contact_name ? ` · with ${m.contact_name}` : ''}</>
      : <>{new Date(m.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {formatTimeUntil(m.starts_at)}{m.contact_name ? ` · with ${m.contact_name}` : ''}</>;
    primaryLabel = m.needs_outcome ? 'Log outcome' : expanded ? 'Hide brief' : 'Prep';
    PrimaryIcon = m.needs_outcome ? CheckCircle2 : Sparkles;
    doneLabel = m.needs_outcome ? 'Log outcome' : 'Tomorrow';
  } else if (item.task) {
    const t = item.task;
    title = t.title;
    sub = <>{t.overdue ? 'Overdue' : 'Due today'}{t.due_date ? ` · ${formatRelativeTime(t.due_date)}` : ''}{t.contact_name ? ` · ${t.contact_name}` : ''}</>;
    primaryLabel = 'Complete';
    PrimaryIcon = CheckCircle2;
  }

  const urgent = item.rank >= 85;

  return (
    <div
      data-key={item.key}
      onClick={onSelect}
      className={cn(
        'rounded-xl border bg-[var(--bg-surface)] transition-all',
        selected
          ? 'border-[var(--indigo)] shadow-[var(--shadow-md)] ring-2 ring-[var(--indigo-subtle)]'
          : 'border-[var(--border-subtle)] hover:border-[var(--border-default)]',
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <span className={cn('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]', meta.tint)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-body font-semibold text-[var(--text-primary)]">{title}</span>
            {item.reply?.intent && (
              <span className="rounded-full bg-[var(--indigo-subtle)] px-1.5 py-0.5 text-micro font-semibold text-[var(--indigo)]">
                {INTENT_LABEL[item.reply.intent] || item.reply.intent}
              </span>
            )}
            {item.deal && <DealHealthDot health={item.deal.health} withScore />}
            {item.reply && (
              <span className={cn('inline-flex items-center gap-1 text-micro', urgent ? 'font-semibold text-rose-500' : 'text-[var(--text-tertiary)]')}>
                <Clock className="h-3 w-3" />{waited(item.reply.waited_ms)}
              </span>
            )}
            {item.meeting?.conferencing_url && !item.meeting.needs_outcome && (
              <a
                href={item.meeting.conferencing_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-micro font-semibold text-[var(--indigo)] hover:underline"
              >
                <Video className="h-3 w-3" /> Join
              </a>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-caption text-[var(--text-tertiary)]">{sub}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onSnooze}
            className="hidden h-8 px-2.5 rounded-lg text-caption font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] sm:inline-flex sm:items-center"
            title="Not now - back tomorrow morning (s)"
          >
            Tomorrow<Kbd>s</Kbd>
          </button>
          {item.kind !== 'deal' && !(item.meeting && !item.meeting.needs_outcome) && item.kind !== 'task' && (
            <button
              onClick={onDone}
              className="hidden h-8 px-2.5 rounded-lg text-caption font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] sm:inline-flex sm:items-center"
              title={item.kind === 'reply' ? 'Dealt with elsewhere - nobody is waiting (d)' : `${doneLabel} (d)`}
            >
              {doneLabel}<Kbd>d</Kbd>
            </button>
          )}
          <button
            onClick={onPrimary}
            disabled={sending}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--indigo)] px-3 text-caption font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PrimaryIcon className="h-3.5 w-3.5" />}
            {primaryLabel}<Kbd>enter</Kbd>
          </button>
        </div>
      </div>

      {item.reply && expanded && (
        <div className="border-t border-[var(--border-subtle)] px-3.5 pb-3.5 pt-3" onClick={(e) => e.stopPropagation()}>
          <p className="mb-1.5 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            <Sparkles className="h-3 w-3" /> Relay's draft
            <span className="font-normal normal-case tracking-normal">- edit, then send</span>
          </p>
          <textarea
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onBlur={onEditDone}
            autoFocus={editing}
            rows={Math.min(10, Math.max(3, draft.split('\n').length + 1))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onPrimary(); }
              if (e.key === 'Escape') { (e.target as HTMLTextAreaElement).blur(); }
            }}
            className="w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-body text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo-subtle)]"
          />
          <div className="mt-1.5 flex items-center justify-between text-caption text-[var(--text-tertiary)]">
            <span>Cmd/Ctrl + Enter sends · Esc stops editing</span>
            <button onClick={onOpen} className="font-medium text-[var(--indigo)] hover:underline">Open the conversation</button>
          </div>
        </div>
      )}

      {item.meeting && expanded && (
        <div className="border-t border-[var(--border-subtle)] px-3.5 pb-3.5 pt-3" onClick={(e) => e.stopPropagation()}>
          {item.meeting.needs_outcome
            ? <MeetingOutcome eventId={item.meeting.event_id} onDone={onOutcomeSaved} />
            : <MeetingBrief eventId={item.meeting.event_id} />}
        </div>
      )}

      {item.deal && expanded && (
        <div className="border-t border-[var(--border-subtle)] px-3.5 pb-3.5 pt-3">
          <ul className="space-y-1">
            {item.deal.health.reasons.map((r, i) => (
              <li key={i} className={cn('text-caption', r.impact < 0 ? 'text-[var(--text-secondary)]' : 'text-emerald-600 dark:text-emerald-400')}>
                {r.impact < 0 ? '−' : '+'} {r.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {selected && item.kind !== 'reply' && !expanded && (item.meeting || item.deal) && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="w-full border-t border-[var(--border-subtle)] py-1.5 text-caption text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          {item.meeting ? (item.meeting.needs_outcome ? 'Log how it went' : 'Show the brief') : 'Why is this here?'} <Kbd>space</Kbd>
        </button>
      )}
    </div>
  );
}

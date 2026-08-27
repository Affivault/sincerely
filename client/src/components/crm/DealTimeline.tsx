import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEAL_STAGES } from '@lemlist/shared';
import type {
  CrmEvent, CrmNote, CrmTask, Deal, DealEmail, DealStageEvent, DealStage,
} from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';
import { Avatar } from '../shared/Avatar';
import { EmailBody } from '../shared/EmailBody';
import { QuickCompose } from '../shared/QuickCompose';
import { useConfirm } from '../ui/ConfirmDialog';
import { dueLabel, DUE_TONE, TASK_TYPE_ICON } from './CrmPrimitives';
import { cn } from '../../lib/utils';
import {
  ArrowDownLeft, ArrowUpRight, CalendarPlus, CheckCircle2, CheckSquare, Circle,
  Clock, GitCommitHorizontal, Mail, Pin, StickyNote, Trash2, Users,
} from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   What has actually happened on this deal.

   Split across five places — emails in the inbox, notes on the contact,
   activities on the tasks page, meetings on the calendar, stage moves
   nowhere at all — the answer to "where are we with Northbeam" was a
   reconstruction job every single time. Merged into one stream in time
   order, it is a read.

   Everything here is already loaded by the page's one detail request, so
   switching tabs is instant and costs nothing.
   ═══════════════════════════════════════════════════════════════════════ */

type Tab = 'all' | 'notes' | 'emails' | 'activities' | 'changes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'notes', label: 'Notes' },
  { id: 'emails', label: 'Emails' },
  { id: 'activities', label: 'Activities' },
  { id: 'changes', label: 'Changes' },
];

interface Entry {
  id: string;
  at: Date;
  tab: Exclude<Tab, 'all'>;
  icon: typeof Mail;
  tone: string;
  title: string;
  detail?: string | null;
  meta?: string | null;
  note?: CrmNote;
  task?: CrmTask;
  email?: DealEmail;
}

function dayLabel(d: Date): string {
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `${diff} days ago`;
  // Booked things sit above today in a newest-first stream, so the future
  // needs the same treatment or the column mixes "Aug 29" with "Yesterday"
  // and stops reading as a sequence.
  if (diff === -1) return 'Tomorrow';
  if (diff < -1 && diff > -7) return `In ${Math.abs(diff)} days`;
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function stageLabel(id: string | null): string {
  if (!id) return 'created';
  return DEAL_STAGES.find((s) => s.id === (id as DealStage))?.label || id;
}

/* ── The compose bar ──────────────────────────────────────────────────── */

function AddNote({ dealId, contactId }: { dealId: string; contactId: string | null }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');

  const save = useMutation({
    mutationFn: (body: string) =>
      // Attached to the contact as well when there is one, so it shows up on
      // their profile too rather than being visible only from in here.
      crmApi.createNote({ body, deal_id: dealId, ...(contactId ? { contact_id: contactId } : {}) }),
    onSuccess: () => { setDraft(''); qc.invalidateQueries({ queryKey: ['crm'] }); toast.success('Note saved'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save the note'),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (draft.trim()) save.mutate(draft.trim()); }}
      className="panel p-2.5"
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, shift-enter breaks the line. A note is one or two
          // sentences and reaching for a button every time is friction that
          // stops people writing them at all.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (draft.trim()) save.mutate(draft.trim());
          }
        }}
        rows={draft ? 3 : 1}
        placeholder="Add a note — what was said, what changed, what you promised…"
        className="w-full resize-none bg-transparent px-1 py-1 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
      />
      {draft.trim() && (
        <div className="mt-1 flex items-center justify-end gap-2">
          <span className="mr-auto text-[10.5px] text-[var(--text-muted)]">Enter to save · Shift+Enter for a new line</span>
          <button
            type="button"
            onClick={() => setDraft('')}
            className="rounded-lg px-2 py-1 text-[12px] font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-lg bg-[var(--indigo)] px-2.5 py-1 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save note'}
          </button>
        </div>
      )}
    </form>
  );
}

/* ── The stream ───────────────────────────────────────────────────────── */

export interface DealRecipient { email: string; name: string }

export function DealTimeline({
  deal, notes, tasks, events, emails, history, recipients, writeTo, onWriteTo,
  onAddActivity, onBookMeeting,
}: {
  deal: Deal;
  notes: CrmNote[];
  tasks: CrmTask[];
  events: CrmEvent[];
  emails: DealEmail[];
  history: DealStageEvent[];
  /** Everybody on the deal who has an address, primary first. */
  recipients: DealRecipient[];
  /**
   * Who the compose box is aimed at, or null for the note box. Owned by the
   * page so that clicking the mail icon beside somebody in the People panel
   * opens a message to them here rather than in a second, disconnected
   * compose window.
   */
  writeTo: DealRecipient | null;
  onWriteTo: (to: DealRecipient | null) => void;
  onAddActivity: () => void;
  onBookMeeting: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('all');
  const [openEmail, setOpenEmail] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['crm'] });

  const toggleTask = useMutation({
    mutationFn: (t: CrmTask) => crmApi.updateTask(t.id, { is_done: !t.is_done }),
    onSuccess: invalidate,
    onError: () => toast.error('Could not update that activity'),
  });
  const pinNote = useMutation({
    mutationFn: (n: CrmNote) => crmApi.updateNote(n.id, { pinned: !n.pinned }),
    onSuccess: invalidate,
    onError: () => toast.error('Could not pin that note'),
  });
  const deleteNote = useMutation({
    mutationFn: (n: CrmNote) => crmApi.deleteNote(n.id),
    onSuccess: () => { invalidate(); toast.success('Note deleted'); },
    onError: () => toast.error('Could not delete that note'),
  });

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];

    /*
     * Pinned notes are promoted to the top of the page, not copied there.
     * Leaving them in the stream as well showed the same sentence twice on
     * one screen, which reads as a duplication bug rather than emphasis.
     */
    for (const n of notes) {
      if (n.pinned) continue;
      out.push({
        id: `note-${n.id}`, at: new Date(n.created_at), tab: 'notes',
        icon: StickyNote, tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        title: n.body, note: n,
      });
    }

    for (const t of tasks) {
      const Icon = TASK_TYPE_ICON[t.type] || CheckSquare;
      out.push({
        // Sort a task by when it is due when it has a date, because an
        // activity booked for next Tuesday belongs next Tuesday in the
        // stream, not on the afternoon somebody typed it in.
        id: `task-${t.id}`, at: new Date(t.due_date || t.created_at), tab: 'activities',
        icon: Icon, tone: t.is_done
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-[var(--indigo-subtle)] text-[var(--indigo)]',
        title: t.title, meta: t.due_date ? dueLabel(t.due_date).text : null, task: t,
      });
    }

    for (const e of events) {
      out.push({
        id: `event-${e.id}`, at: new Date(e.starts_at), tab: 'activities',
        icon: e.type === 'call' ? Users : CalendarPlus,
        tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        title: e.title,
        meta: `${new Date(e.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${e.location ? ` · ${e.location}` : ''}`,
      });
    }

    for (const m of emails) {
      const outbound = m.direction === 'outbound';
      out.push({
        id: `mail-${m.id}`, at: new Date(m.received_at), tab: 'emails',
        icon: outbound ? ArrowUpRight : ArrowDownLeft,
        tone: outbound
          ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        title: m.subject || '(no subject)',
        meta: outbound ? `To ${m.to_email || 'them'}` : `From ${m.from_email || 'them'}`,
        email: m,
      });
    }

    for (const h of history) {
      out.push({
        id: `stage-${h.id}`, at: new Date(h.changed_at), tab: 'changes',
        icon: GitCommitHorizontal, tone: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]',
        title: h.from_stage
          ? `Moved from ${stageLabel(h.from_stage)} to ${stageLabel(h.to_stage)}`
          : `Started in ${stageLabel(h.to_stage)}`,
        meta: h.reason,
      });
    }

    return out
      .filter((e) => Number.isFinite(e.at.getTime()))
      .sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [notes, tasks, events, emails, history]);

  const shown = tab === 'all' ? entries : entries.filter((e) => e.tab === tab);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entries.length };
    for (const e of entries) c[e.tab] = (c[e.tab] || 0) + 1;
    return c;
  }, [entries]);

  const pinned = notes.filter((n) => n.pinned);
  const primaryContactId = deal.contact_id || deal.contact?.id || null;

  // Group by day so the stream reads as a diary rather than a list.
  const groups: { day: string; items: Entry[] }[] = [];
  for (const e of shown) {
    const day = dayLabel(e.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  /* The last thing they wrote about, so a reply is pre-titled correctly. */
  const lastSubjectFrom = (email: string): string | null => {
    const hit = emails.find((m) => m.from_email === email || m.to_email === email);
    return hit?.subject || null;
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {recipients.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => onWriteTo(null)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-medium transition-colors',
                writeTo === null
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
              )}
            >
              <StickyNote className="h-3 w-3" /> Note
            </button>
            <span className="mx-0.5 h-3.5 w-px bg-[var(--border-default)]" />
            <span className="text-[11px] text-[var(--text-muted)]">Email</span>
            {recipients.map((r) => (
              <button
                key={r.email}
                type="button"
                onClick={() => onWriteTo(writeTo?.email === r.email ? null : r)}
                title={r.email}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11.5px] font-medium transition-colors',
                  writeTo?.email === r.email
                    ? 'bg-[var(--indigo)] text-white'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                )}
              >
                <Avatar name={r.name} email={r.email} size="xs" />
                {r.name}
              </button>
            ))}
          </div>
        )}

        {writeTo ? (
          <QuickCompose
            key={writeTo.email}
            to={writeTo.email}
            toName={writeTo.name}
            defaultSubject={lastSubjectFrom(writeTo.email) || deal.title}
            alwaysOpen
            onSent={() => { onWriteTo(null); invalidate(); }}
          />
        ) : (
          <AddNote dealId={deal.id} contactId={primaryContactId} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors',
              tab === t.id
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
            )}
          >
            {t.label}
            {(counts[t.id] || 0) > 0 && (
              <span className="text-[10.5px] tabular-nums text-[var(--text-muted)]">{counts[t.id]}</span>
            )}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onAddActivity}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-[var(--indigo)] hover:underline"
        >
          <CheckSquare className="h-3 w-3" /> Activity
        </button>
        <button
          type="button"
          onClick={onBookMeeting}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-[var(--indigo)] hover:underline"
        >
          <CalendarPlus className="h-3 w-3" /> Meeting
        </button>
      </div>

      {/* Pinned notes ride above the stream: the point of pinning something
          is not having to scroll for it. */}
      {tab !== 'changes' && pinned.length > 0 && (
        <div className="space-y-1.5">
          {pinned.map((n) => (
            <div key={n.id} className="flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-2.5">
              <Pin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
              <p className="min-w-0 flex-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--text-primary)]">{n.body}</p>
              <button type="button" onClick={() => pinNote.mutate(n)} className="icon-btn h-6 w-6 flex-shrink-0" title="Unpin">
                <Pin className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="panel py-10 text-center">
          <p className="text-[13px] font-medium text-[var(--text-primary)]">
            {tab === 'all' ? 'Nothing on this deal yet' : `No ${TABS.find((t) => t.id === tab)?.label.toLowerCase()} yet`}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
            {tab === 'emails'
              ? 'Emails to or from anybody on this deal appear here automatically.'
              : 'Notes, activities, meetings and stage changes all land here.'}
          </p>
        </div>
      ) : (
        <div className="panel divide-y divide-[var(--border-subtle)]">
          {groups.map((g) => (
            <div key={g.day} className="px-3.5 py-3">
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{g.day}</p>
              <div className="space-y-2">
                {g.items.map((e) => {
                  const Icon = e.icon;
                  const expandable = !!e.email;
                  const expanded = openEmail === e.id;
                  return (
                    <div key={e.id} className="flex gap-2.5">
                      <span className={cn('mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md', e.tone)}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          {e.task ? (
                            <button
                              type="button"
                              onClick={() => toggleTask.mutate(e.task!)}
                              className="mt-0.5 flex-shrink-0"
                              title={e.task.is_done ? 'Mark not done' : 'Mark done'}
                            >
                              {e.task.is_done
                                ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                : <Circle className="h-4 w-4 text-[var(--text-muted)] transition-colors hover:text-[var(--indigo)]" />}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={!expandable}
                            onClick={() => setOpenEmail(expanded ? null : e.id)}
                            className={cn(
                              'min-w-0 flex-1 text-left',
                              expandable && 'transition-colors hover:text-[var(--indigo)]',
                            )}
                          >
                            <p
                              className={cn(
                                'text-[12.5px] leading-relaxed text-[var(--text-primary)]',
                                e.note ? 'whitespace-pre-wrap' : 'truncate',
                                e.task?.is_done && 'text-[var(--text-muted)] line-through',
                              )}
                            >
                              {e.title}
                            </p>
                          </button>
                          <span className="flex-shrink-0 text-[10.5px] tabular-nums text-[var(--text-muted)]">
                            {timeLabel(e.at)}
                          </span>
                          {e.note && (
                            <span className="flex flex-shrink-0 gap-0.5">
                              <button type="button" onClick={() => pinNote.mutate(e.note!)} className="icon-btn h-5 w-5" title={e.note.pinned ? 'Unpin' : 'Pin'}>
                                <Pin className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => confirm(
                                  { title: 'Delete this note?', body: 'It goes from the deal and from the contact.', tone: 'danger' },
                                  () => deleteNote.mutate(e.note!),
                                )}
                                className="icon-btn h-5 w-5 hover:text-rose-500"
                                title="Delete"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </span>
                          )}
                        </div>

                        {e.detail && (
                          <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-secondary)]">{e.detail}</p>
                        )}
                        {e.meta && (
                          <p className={cn(
                            'mt-0.5 text-[10.5px]',
                            e.task && !e.task.is_done && e.task.due_date
                              ? DUE_TONE[dueLabel(e.task.due_date).tone]
                              : 'text-[var(--text-tertiary)]',
                          )}>
                            {e.meta}
                          </p>
                        )}
                        {expanded && e.email && (
                          <div className="mt-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 p-2.5">
                            <EmailBody html={null} text={e.email.body_text || '(no body stored)'} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

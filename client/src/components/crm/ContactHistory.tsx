import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { crmApi } from '../../api/crm.api';
import { Checkbox } from '../ui/Checkbox';
import { useConfirm } from '../ui/ConfirmDialog';
import { QuickCompose } from '../shared/QuickCompose';
import { EmailBody } from '../shared/EmailBody';
import { cn } from '../../lib/utils';
import {
  ActivityModal, MeetingModal, TASK_TYPE_ICON, TASK_TYPE_TONE,
  dueLabel, DUE_TONE, startOfDay,
} from './CrmPrimitives';
import {
  StickyNote, Pin, Trash2, Plus, CalendarPlus, CheckSquare, Phone, Users,
  ArrowUpRight, ArrowDownLeft, MousePointerClick, MessageSquare, AlertTriangle,
  Mail, Handshake, Clock, MapPin, Send, ChevronDown, Settings2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CrmNote, CrmTask, CrmEvent } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The history of a relationship.

   A contact profile is worth having only if it answers "what has actually
   happened with this person" without you piecing it together. So everything
   — emails both ways, campaign events, notes, calls, meetings — merges into
   one chronological stream, with what's still outstanding pulled to the top
   where it can be acted on.
   ═══════════════════════════════════════════════════════════════════════ */

type Entry = {
  id: string;
  at: Date;
  kind: 'email_out' | 'email_in' | 'note' | 'task' | 'event' | 'campaign';
  title: string;
  detail?: string | null;
  meta?: string | null;
  icon: typeof Mail;
  tone: string;
  note?: CrmNote;
  task?: CrmTask;
  event?: CrmEvent;
  /** The raw inbox message, so the row can expand to the full body. */
  email?: any;
};

const CAMPAIGN_ICON: Record<string, typeof Mail> = {
  sent: Send, delivered: Mail, opened: Mail, clicked: MousePointerClick,
  replied: MessageSquare, bounced: AlertTriangle, error: AlertTriangle,
};

const CAMPAIGN_TONE: Record<string, string> = {
  sent: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]',
  delivered: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]',
  opened: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  clicked: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  replied: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  bounced: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  error: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

type ComposeTab = 'note' | 'email' | 'activity' | 'meeting';

const COMPOSE_TABS: { id: ComposeTab; label: string; icon: typeof Mail }[] = [
  { id: 'note', label: 'Note', icon: StickyNote },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'activity', label: 'Activity', icon: CheckSquare },
  { id: 'meeting', label: 'Call / meeting', icon: CalendarPlus },
];

/** Local datetime string for an <input type="datetime-local">. */
function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* The 90% case for an activity is a title and a day. Anything richer opens
   the full form, which is one click away rather than the only way in. */
function QuickActivity({ contactId, contactName, onDone, onDetail }: {
  contactId: string; contactName: string; onDone: () => void; onDetail: () => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<CrmTask['type']>('follow_up');
  const [due, setDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return localInput(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0));
  });

  const create = useMutation({
    mutationFn: () => crmApi.createTask({
      title: title.trim(),
      type,
      due_date: due ? new Date(due).toISOString() : null,
      contact_id: contactId,
      contact_name: contactName,
    } as any),
    onSuccess: () => { setTitle(''); onDone(); toast.success('Activity scheduled'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not schedule that'),
  });

  return (
    <div className="space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) create.mutate(); }}
        placeholder={`What needs doing with ${contactName}?`}
        className="w-full h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)]"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CrmTask['type'])}
          className="h-7 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
        >
          <option value="follow_up">Follow-up</option>
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="todo">To-do</option>
          <option value="deadline">Deadline</option>
        </select>
        <input
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="h-7 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
        />
        <button
          onClick={onDetail}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11.5px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <Settings2 className="h-3 w-3" /> More options
        </button>
        <span className="flex-1" />
        <button
          onClick={() => title.trim() && create.mutate()}
          disabled={!title.trim() || create.isPending}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-[var(--indigo)] text-white text-[12px] font-semibold disabled:opacity-40 hover:bg-[#4F46E5] transition-colors"
        >
          <CheckSquare className="h-3.5 w-3.5" /> {create.isPending ? 'Saving…' : 'Schedule'}
        </button>
      </div>
    </div>
  );
}

function QuickMeeting({ contactId, contactName, contactEmail, onDone, onDetail }: {
  contactId: string; contactName: string; contactEmail: string;
  onDone: () => void; onDetail: () => void;
}) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<'call' | 'meeting'>('call');
  const [starts, setStarts] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return localInput(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0));
  });

  const create = useMutation({
    mutationFn: () => {
      const start = new Date(starts);
      const end = new Date(start.getTime() + 30 * 60_000);
      return crmApi.createEvent({
        title: title.trim() || `${type === 'call' ? 'Call' : 'Meeting'} — ${contactName}`,
        type,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        contact_id: contactId,
        contact_name: contactName,
        contact_email: contactEmail,
      } as any);
    },
    onSuccess: () => { setTitle(''); onDone(); toast.success('Added to the calendar'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not book that'),
  });

  return (
    <div className="space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') create.mutate(); }}
        placeholder={`${type === 'call' ? 'Call' : 'Meeting'} — ${contactName}`}
        className="w-full h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)]"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-[var(--border-subtle)] overflow-hidden">
          {(['call', 'meeting'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                'h-7 px-2.5 text-[12px] font-medium transition-colors',
                type === t ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]',
              )}
            >
              {t === 'call' ? 'Call' : 'Meeting'}
            </button>
          ))}
        </div>
        <input
          type="datetime-local"
          value={starts}
          onChange={(e) => setStarts(e.target.value)}
          className="h-7 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
        />
        <button
          onClick={onDetail}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-[11.5px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <Settings2 className="h-3 w-3" /> More options
        </button>
        <span className="flex-1" />
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-[var(--indigo)] text-white text-[12px] font-semibold disabled:opacity-40 hover:bg-[#4F46E5] transition-colors"
        >
          <CalendarPlus className="h-3.5 w-3.5" /> {create.isPending ? 'Saving…' : 'Book'}
        </button>
      </div>
    </div>
  );
}

function dayHeading(d: Date): string {
  const today = startOfDay(new Date());
  const day = startOfDay(d);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7 && diff > 0) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

function timeOf(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Strip HTML and clamp, so a note or email preview reads as one line. */
function preview(text?: string | null, max = 140): string {
  if (!text) return '';
  const clean = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function ContactHistory({
  contactId, contactName, contactEmail, emails, campaignActivity,
}: {
  contactId: string;
  contactName: string;
  contactEmail: string;
  /** Inbox messages both ways, already fetched by the profile page. */
  emails: any[];
  /** Campaign send/open/click/reply events. */
  campaignActivity: any[];
}) {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [noteDraft, setNoteDraft] = useState('');
  const [activityModal, setActivityModal] = useState<Partial<CrmTask> | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [meetingModal, setMeetingModal] = useState<Partial<CrmEvent> | null>(null);
  const [filter, setFilter] = useState<'all' | 'notes' | 'emails' | 'meetings' | 'campaign'>('all');
  const [compose, setCompose] = useState<ComposeTab>('note');
  const [openEmail, setOpenEmail] = useState<string | null>(null);

  const { data: summary } = useQuery({
    queryKey: ['contact-crm', contactId],
    queryFn: () => crmApi.contactSummary(contactId),
    enabled: !!contactId,
  });

  const notes = summary?.notes || [];
  const tasks = summary?.tasks || [];
  const events = summary?.events || [];
  const deals = summary?.deals || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contact-crm', contactId] });
    qc.invalidateQueries({ queryKey: ['crm'] });
  };

  const addNote = useMutation({
    mutationFn: (body: string) => crmApi.createNote({ body, contact_id: contactId }),
    onSuccess: () => { setNoteDraft(''); invalidate(); toast.success('Note saved'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save the note'),
  });

  const pinNote = useMutation({
    mutationFn: (n: CrmNote) => crmApi.updateNote(n.id, { pinned: !n.pinned }),
    onSuccess: invalidate,
  });

  const removeNote = useMutation({
    mutationFn: (id: string) => crmApi.deleteNote(id),
    onSuccess: () => { invalidate(); toast.success('Note deleted'); },
  });

  const toggleTask = useMutation({
    mutationFn: (t: CrmTask) => crmApi.updateTask(t.id, { is_done: !t.is_done }),
    onSuccess: invalidate,
    onError: () => toast.error('Could not update that'),
  });

  /* ── The merged stream ─────────────────────────────────────────────── */
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];

    for (const m of emails) {
      const at = new Date(m.received_at);
      if (Number.isNaN(at.getTime())) continue;
      const outbound = m.direction === 'outbound';
      out.push({
        id: `email-${m.id}`,
        at,
        kind: outbound ? 'email_out' : 'email_in',
        title: m.subject || '(no subject)',
        detail: preview(m.body_text || m.body_html),
        meta: outbound ? 'You sent' : `${contactName || contactEmail} replied`,
        icon: outbound ? ArrowUpRight : ArrowDownLeft,
        tone: outbound ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        email: m,
      });
    }

    for (const a of campaignActivity) {
      const at = new Date(a.occurred_at);
      if (Number.isNaN(at.getTime())) continue;
      // Replies are already represented by the inbound email itself.
      if (a.activity_type === 'replied') continue;
      out.push({
        id: `act-${a.id || `${a.activity_type}-${a.occurred_at}`}`,
        at,
        kind: 'campaign',
        title: `Campaign email ${a.activity_type}`,
        detail: a.campaign_name || a.subject || null,
        icon: CAMPAIGN_ICON[a.activity_type] || Send,
        tone: CAMPAIGN_TONE[a.activity_type] || CAMPAIGN_TONE.sent,
      });
    }

    for (const n of notes) {
      out.push({
        id: `note-${n.id}`,
        at: new Date(n.created_at),
        kind: 'note',
        title: 'Note',
        detail: n.body,
        meta: n.deal ? `on ${n.deal.title}` : null,
        icon: StickyNote,
        tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        note: n,
      });
    }

    for (const t of tasks) {
      // Completed activities are history; open ones live in "Coming up".
      if (!t.is_done) continue;
      const at = new Date(t.completed_at || t.updated_at);
      if (Number.isNaN(at.getTime())) continue;
      out.push({
        id: `task-${t.id}`,
        at,
        kind: 'task',
        title: t.title,
        detail: t.notes,
        meta: `${t.type.replace('_', ' ')} completed`,
        icon: TASK_TYPE_ICON[t.type] || CheckSquare,
        tone: TASK_TYPE_TONE[t.type] || TASK_TYPE_TONE.todo,
        task: t,
      });
    }

    for (const e of events) {
      const at = new Date(e.starts_at);
      if (Number.isNaN(at.getTime()) || at.getTime() > Date.now()) continue;
      out.push({
        id: `event-${e.id}`,
        at,
        kind: 'event',
        title: e.title,
        detail: e.outcome || e.notes,
        meta: [e.type === 'call' ? 'Call' : 'Meeting', e.location].filter(Boolean).join(' · '),
        icon: e.type === 'call' ? Phone : Users,
        tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
        event: e,
      });
    }

    return out.sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [emails, campaignActivity, notes, tasks, events, contactName, contactEmail]);

  const visible = useMemo(() => {
    if (filter === 'all') return entries;
    if (filter === 'notes') return entries.filter((e) => e.kind === 'note');
    if (filter === 'emails') return entries.filter((e) => e.kind === 'email_in' || e.kind === 'email_out');
    if (filter === 'campaign') return entries.filter((e) => e.kind === 'campaign');
    return entries.filter((e) => e.kind === 'event' || e.kind === 'task');
  }, [entries, filter]);

  const pinned = notes.filter((n) => n.pinned);
  const openTasks = tasks.filter((t) => !t.is_done)
    .sort((a, b) => new Date(a.due_date || 0).getTime() - new Date(b.due_date || 0).getTime());
  const upcomingEvents = events.filter((e) => new Date(e.starts_at).getTime() >= Date.now())
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

  const seed = { contact_id: contactId, contact_name: contactName || contactEmail };
  // The thread they're most likely replying to.
  const lastSubject = emails.length
    ? [...emails].sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())[0]?.subject || null
    : null;

  return (
    <div className="space-y-3">
      {/* ── Compose ────────────────────────────────────────────────────
         Everything you can do to a person, in one place, chosen by tab
         rather than scattered across pages: write to them, note what was
         said, put the next step in the diary. The bar stays put; only the
         panel beneath it changes. */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-0.5 px-2 h-10 border-b border-[var(--border-subtle)]">
          {COMPOSE_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setCompose(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors',
                  compose === t.id
                    ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-3">
          {compose === 'note' ? (
            <>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && noteDraft.trim()) addNote.mutate(noteDraft.trim());
                }}
                rows={2}
                placeholder={`Log a note about ${contactName || contactEmail}… (⌘↵ to save)`}
                className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] transition-all"
              />
              <div className="flex items-center mt-2">
                <span className="flex-1" />
                <button
                  onClick={() => noteDraft.trim() && addNote.mutate(noteDraft.trim())}
                  disabled={!noteDraft.trim() || addNote.isPending}
                  className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg bg-[var(--indigo)] text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#4F46E5] transition-colors"
                >
                  <StickyNote className="h-3.5 w-3.5" /> {addNote.isPending ? 'Saving…' : 'Save note'}
                </button>
              </div>
            </>
          ) : compose === 'email' ? (
            contactEmail ? (
              <QuickCompose
                alwaysOpen
                to={contactEmail}
                toName={contactName || null}
                defaultSubject={lastSubject}
              />
            ) : (
              <p className="text-[12px] text-[var(--text-tertiary)] py-2">
                This lead has no email address yet — add one and you can write to them from here.
              </p>
            )
          ) : compose === 'activity' ? (
            <QuickActivity
              contactId={contactId}
              contactName={contactName || contactEmail}
              onDone={invalidate}
              onDetail={() => { setActivityModal({ ...seed } as Partial<CrmTask>); setActivityOpen(true); }}
            />
          ) : (
            <QuickMeeting
              contactId={contactId}
              contactName={contactName || contactEmail}
              contactEmail={contactEmail}
              onDone={invalidate}
              onDetail={() => setMeetingModal({
                contact_id: contactId,
                contact_name: contactName || contactEmail,
                contact_email: contactEmail,
                title: `Call — ${contactName || contactEmail}`,
              } as Partial<CrmEvent>)}
            />
          )}
        </div>
      </div>

      {/* ── Pinned: the standing context ── */}
      {pinned.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 space-y-2">
          {pinned.map((n) => (
            <div key={n.id} className="flex items-start gap-2">
              <Pin className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="flex-1 min-w-0 text-[12.5px] text-[var(--text-primary)] whitespace-pre-wrap">{n.body}</p>
              <button onClick={() => pinNote.mutate(n)} className="icon-btn h-6 w-6 flex-shrink-0" title="Unpin">
                <Pin className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Outstanding: what's still owed to this person ── */}
      {(openTasks.length > 0 || upcomingEvents.length > 0) && (
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
            <Clock className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <h3 className="text-[11.5px] font-semibold text-[var(--text-secondary)]">Coming up</h3>
            <span className="text-[11px] tabular text-[var(--text-tertiary)]">{openTasks.length + upcomingEvents.length}</span>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {openTasks.map((t) => {
              const Icon = TASK_TYPE_ICON[t.type] || CheckSquare;
              const due = dueLabel(t.due_date);
              return (
                <div key={t.id} className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-[var(--bg-hover)] transition-colors">
                  <Checkbox checked={false} onChange={() => toggleTask.mutate(t)} aria-label={`Complete ${t.title}`} />
                  <span className={cn('flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0', TASK_TYPE_TONE[t.type])}>
                    <Icon className="h-3 w-3" />
                  </span>
                  <button
                    onClick={() => { setActivityModal(t); setActivityOpen(true); }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{t.title}</p>
                    <p className={cn('text-[11px]', DUE_TONE[due.tone])}>{due.text}</p>
                  </button>
                </div>
              );
            })}
            {upcomingEvents.map((e) => (
              <button
                key={e.id}
                onClick={() => setMeetingModal(e)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 flex-shrink-0">
                  {e.type === 'call' ? <Phone className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">{e.title}</span>
                  <span className="block text-[11px] text-[var(--text-tertiary)] truncate">
                    {new Date(e.starts_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, {timeOf(new Date(e.starts_at))}
                    {e.location ? ` · ${e.location}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Deals this person is attached to ── */}
      {deals.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
            <Handshake className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <h3 className="text-[11.5px] font-semibold text-[var(--text-secondary)]">Deals</h3>
            <span className="text-[11px] tabular text-[var(--text-tertiary)]">{deals.length}</span>
            <Link to="/deals" className="ml-auto text-[11px] font-medium text-[var(--indigo)] hover:underline">Open pipeline</Link>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {deals.map((d) => (
              <div key={d.id} className="flex items-center gap-2.5 px-3.5 py-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">{d.title}</span>
                  <span className="block text-[11px] text-[var(--text-tertiary)] capitalize">{d.stage}</span>
                </span>
                <span className="text-[12px] font-semibold tabular text-[var(--text-primary)] flex-shrink-0">
                  {(d.value || 0).toLocaleString(undefined, { style: 'currency', currency: d.currency || 'USD', maximumFractionDigits: 0 })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── The stream ── */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-1 px-3 h-10 border-b border-[var(--border-subtle)]">
          {([
            { id: 'all' as const, label: 'Everything', n: entries.length },
            { id: 'emails' as const, label: 'Emails', n: entries.filter((e) => e.kind === 'email_in' || e.kind === 'email_out').length },
            { id: 'notes' as const, label: 'Notes', n: entries.filter((e) => e.kind === 'note').length },
            { id: 'meetings' as const, label: 'Calls & meetings', n: entries.filter((e) => e.kind === 'event' || e.kind === 'task').length },
            { id: 'campaign' as const, label: 'Campaign', n: entries.filter((e) => e.kind === 'campaign').length },
          ]).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors',
                filter === f.id
                  ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
              )}
            >
              {f.label}
              {f.n > 0 && <span className="ml-1 text-[10.5px] tabular opacity-70">{f.n}</span>}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-elevated)] mb-2">
              <Clock className="h-4 w-4 text-[var(--text-tertiary)]" />
            </span>
            <p className="text-[12.5px] font-medium text-[var(--text-primary)]">
              {filter === 'all' ? 'Nothing has happened yet' : 'Nothing of this kind yet'}
            </p>
            <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5 max-w-xs">
              Emails, notes, calls and meetings with this person all collect here as a single history.
            </p>
          </div>
        ) : (
          <div className="p-3">
            {visible.map((e, i) => {
              const prev = visible[i - 1];
              const newDay = !prev || startOfDay(prev.at).getTime() !== startOfDay(e.at).getTime();
              const Icon = e.icon;
              return (
                <div key={e.id}>
                  {newDay && (
                    <div className="flex items-center gap-2 pt-3 first:pt-0 pb-1.5">
                      <span className="text-[11px] font-semibold text-[var(--text-tertiary)]">{dayHeading(e.at)}</span>
                      <span className="flex-1 h-px bg-[var(--border-subtle)]" />
                    </div>
                  )}
                  <div className="group relative flex gap-2.5 pb-3">
                    {/* Spine */}
                    <div className="flex flex-col items-center flex-shrink-0">
                      <span className={cn('flex h-6 w-6 items-center justify-center rounded-lg', e.tone)}>
                        <Icon className="h-3 w-3" />
                      </span>
                      <span className="flex-1 w-px bg-[var(--border-subtle)] mt-1" />
                    </div>

                    <div className="flex-1 min-w-0 -mt-0.5">
                      <div className="flex items-baseline gap-2">
                        <p className={cn(
                          'text-[12.5px] font-medium text-[var(--text-primary)] min-w-0',
                          e.kind === 'note' ? 'truncate' : 'truncate',
                        )}>
                          {e.title}
                        </p>
                        <span className="text-[10.5px] tabular text-[var(--text-muted)] flex-shrink-0 ml-auto">{timeOf(e.at)}</span>
                      </div>
                      {e.meta && <p className="text-[11px] text-[var(--text-tertiary)]">{e.meta}</p>}
                      {e.detail && !(e.email && openEmail === e.id) && (
                        <p className={cn(
                          'text-[12px] text-[var(--text-secondary)] mt-1',
                          e.kind === 'note' ? 'whitespace-pre-wrap' : 'line-clamp-2',
                        )}>
                          {e.kind === 'note' ? e.detail : preview(e.detail)}
                        </p>
                      )}
                      {e.email && (
                        <>
                          <button
                            onClick={() => setOpenEmail(openEmail === e.id ? null : e.id)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-tertiary)] hover:text-[var(--indigo)] transition-colors"
                          >
                            <ChevronDown className={cn('h-3 w-3 transition-transform', openEmail === e.id && 'rotate-180')} />
                            {openEmail === e.id ? 'Hide message' : 'Read message'}
                          </button>
                          {openEmail === e.id && (
                            <div className="mt-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] overflow-hidden">
                              <EmailBody html={e.email.body_html} text={e.email.body_text} />
                            </div>
                          )}
                        </>
                      )}
                      {e.note && (
                        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={() => pinNote.mutate(e.note!)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-tertiary)] hover:text-[var(--indigo)]"
                          >
                            <Pin className="h-3 w-3" /> {e.note.pinned ? 'Unpin' : 'Pin'}
                          </button>
                          <button
                            onClick={() => confirm(
                              { title: 'Delete this note?', tone: 'danger' },
                              () => removeNote.mutate(e.note!.id),
                            )}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-tertiary)] hover:text-[var(--error)]"
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </button>
                        </div>
                      )}
                      {e.event?.location && (
                        <p className="inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] mt-1">
                          <MapPin className="h-3 w-3" />{e.event.location}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {activityOpen && (
        <ActivityModal
          task={activityModal}
          defaults={seed as Partial<CrmTask>}
          onClose={() => { setActivityOpen(false); setActivityModal(null); }}
        />
      )}
      {meetingModal && <MeetingModal event={meetingModal} onClose={() => setMeetingModal(null)} />}
    </div>
  );
}

/** Small "where did this lead come from" line for the profile sidebar. */
export function ContactOrigin({ source, importSource, importedAt, createdAt }: {
  source?: string | null;
  importSource?: string | null;
  importedAt?: string | null;
  createdAt?: string | null;
}) {
  const when = importedAt || createdAt;
  const whenText = when ? new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  if (importSource) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-2.5 py-2">
        <Plus className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0 mt-px rotate-45" />
        <div className="min-w-0">
          <p className="text-[11.5px] text-[var(--text-secondary)]">
            Imported from <span className="font-medium text-[var(--text-primary)] break-all">{importSource}</span>
          </p>
          {whenText && <p className="text-[11px] text-[var(--text-tertiary)]">{whenText}</p>}
        </div>
      </div>
    );
  }

  const label = source === 'csv_import' ? 'CSV import'
    : source === 'manual' ? 'Added manually'
    : source === 'api' ? 'API'
    : source || 'Unknown';

  return (
    <p className="text-[11px] text-[var(--text-tertiary)]">
      Source: {label}{whenText ? ` · ${whenText}` : ''}
    </p>
  );
}

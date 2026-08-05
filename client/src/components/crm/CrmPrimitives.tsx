import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmApi } from '../../api/crm.api';
import { contactsApi } from '../../api/contacts.api';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Avatar } from '../shared/Avatar';
import { cn } from '../../lib/utils';
import {
  Phone, Users, Mail, CheckSquare, Flag, RotateCw, Link2, X, MapPin, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  CrmTask, CrmEvent, TaskType, TaskPriority, EventType, ContactWithTags,
} from '@lemlist/shared';
import { TASK_TYPES } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Shared CRM building blocks.

   Activities (tasks) and meetings (events) are created from the deals board,
   the tasks page, the calendar and a contact's profile. One implementation
   each keeps them behaving identically everywhere.
   ═══════════════════════════════════════════════════════════════════════ */

export const TASK_TYPE_ICON: Record<TaskType, typeof Phone> = {
  call: Phone,
  meeting: Users,
  email: Mail,
  todo: CheckSquare,
  follow_up: RotateCw,
  deadline: Flag,
};

export const TASK_TYPE_TONE: Record<TaskType, string> = {
  call: 'text-sky-600 dark:text-sky-400 bg-sky-500/10',
  meeting: 'text-violet-600 dark:text-violet-400 bg-violet-500/10',
  email: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10',
  todo: 'text-slate-600 dark:text-slate-300 bg-slate-500/10',
  follow_up: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
  deadline: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
};

export const PRIORITY_TONE: Record<TaskPriority, string> = {
  high: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/25',
  normal: 'text-[var(--text-secondary)] bg-[var(--bg-elevated)] border-[var(--border-subtle)]',
  low: 'text-[var(--text-tertiary)] bg-[var(--bg-elevated)] border-[var(--border-subtle)]',
};

/* ── Date helpers ─────────────────────────────────────────────────────── */

/** `datetime-local` wants local wall-clock, not the ISO Z string. */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toDateInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Local midnight for a date, as an ISO string — the boundary all the
 *  "today / overdue / upcoming" buckets are measured against. */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Overdue by 2 days" / "Today" / "In 3 days" — with a tone to colour it. */
export function dueLabel(iso?: string | null): { text: string; tone: 'over' | 'today' | 'soon' | 'later' | 'none' } {
  if (!iso) return { text: 'No date', tone: 'none' };
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return { text: 'No date', tone: 'none' };
  const today = startOfDay(new Date());
  const day = startOfDay(due);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  const time = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff < 0) return { text: diff === -1 ? 'Yesterday' : `${Math.abs(diff)} days overdue`, tone: 'over' };
  if (diff === 0) return { text: `Today, ${time}`, tone: 'today' };
  if (diff === 1) return { text: `Tomorrow, ${time}`, tone: 'soon' };
  if (diff <= 7) return { text: due.toLocaleDateString(undefined, { weekday: 'long' }), tone: 'soon' };
  return { text: due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), tone: 'later' };
}

export const DUE_TONE: Record<string, string> = {
  over: 'text-rose-600 dark:text-rose-400',
  today: 'text-amber-600 dark:text-amber-400',
  soon: 'text-[var(--text-secondary)]',
  later: 'text-[var(--text-tertiary)]',
  none: 'text-[var(--text-muted)]',
};

/* ── Contact picker ───────────────────────────────────────────────────── */

/**
 * Search the contact base and link a real contact, or type a bare name for
 * someone who isn't in it yet. Linking is what makes an activity show up on
 * that person's profile, so it's worth the extra affordance.
 */
export function ContactPicker({
  label = 'Contact', contactId, contactName, contactEmail, onLink, onUnlink, onName,
}: {
  label?: string;
  contactId: string | null;
  contactName: string | null;
  contactEmail?: string | null;
  onLink: (c: ContactWithTags) => void;
  onUnlink: () => void;
  onName: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [debounced, setDebounced] = useState('');
  const typed = contactName || '';

  useEffect(() => {
    const t = setTimeout(() => setDebounced(typed.trim()), 250);
    return () => clearTimeout(t);
  }, [typed]);

  const { data: results } = useQuery({
    queryKey: ['crm', 'contact-search', debounced],
    queryFn: () => contactsApi.list({ search: debounced, limit: 6 }),
    enabled: !contactId && debounced.length >= 2,
  });

  if (contactId) {
    return (
      <div>
        <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">{label}</label>
        <div className="flex items-center gap-2.5 rounded-lg border border-[var(--indigo)]/30 bg-[var(--indigo-subtle)]/40 px-2.5 h-10">
          <Avatar name={contactName} email={contactEmail || ''} size="md" />
          <div className="flex-1 min-w-0 leading-tight">
            <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{contactName || contactEmail}</p>
            {contactEmail && <p className="text-[10.5px] text-[var(--text-tertiary)] truncate">{contactEmail}</p>}
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-[10.5px] font-medium text-[var(--indigo)]"><Link2 className="h-3 w-3" /> Linked</span>
          <button type="button" onClick={onUnlink} className="icon-btn h-6 w-6" title="Unlink"><X className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    );
  }

  const options = results?.data || [];
  const open = focused && debounced.length >= 2 && options.length > 0;

  return (
    <div className="relative">
      <Input
        label={label}
        value={typed}
        onChange={(e) => onName(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search contacts or type a name…"
        autoComplete="off"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] overflow-hidden">
          {options.map((c) => {
            const full = [c.first_name, c.last_name].filter(Boolean).join(' ');
            return (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onLink(c); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors"
              >
                <Avatar name={full || c.email} email={c.email} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{full || c.email}</p>
                  <p className="text-[11px] text-[var(--text-tertiary)] truncate">{c.email}{c.company ? ` · ${c.company}` : ''}</p>
                </div>
                <Link2 className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              </button>
            );
          })}
        </div>
      )}
      <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Link a contact and this shows on their profile.</p>
    </div>
  );
}

/** Deal options for the "attach to deal" selector. */
function useDealOptions() {
  const { data } = useQuery({ queryKey: ['crm', 'deals'], queryFn: () => crmApi.listDeals() });
  return [{ value: '', label: 'No deal' }, ...(data || []).map((d) => ({ value: d.id, label: d.title }))];
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">{children}</label>;
}

function selectCls() {
  return 'w-full h-9 px-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] transition-all';
}

/* ── Activity (task) modal ────────────────────────────────────────────── */

export function ActivityModal({
  task, defaults, onClose,
}: {
  task: Partial<CrmTask> | null;
  /** Pre-fill when created from a contact profile or a calendar day. */
  defaults?: Partial<CrmTask>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = !!task?.id;
  const seed = { ...defaults, ...(task || {}) } as Partial<CrmTask>;

  const [form, setForm] = useState({
    title: seed.title || '',
    type: (seed.type || 'todo') as TaskType,
    priority: (seed.priority || 'normal') as TaskPriority,
    due_date: toLocalInput(seed.due_date) || toLocalInput(new Date().toISOString()),
    deal_id: seed.deal_id || '',
    contact_id: seed.contact_id || seed.contact?.id || null,
    contact_name: seed.contact_name
      || (seed.contact ? [seed.contact.first_name, seed.contact.last_name].filter(Boolean).join(' ') : '')
      || '',
    contact_email: seed.contact?.email || null,
    notes: seed.notes || '',
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const dealOptions = useDealOptions();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['crm'] });
    qc.invalidateQueries({ queryKey: ['contact-crm'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title.trim(),
        type: form.type,
        priority: form.priority,
        due_date: fromLocalInput(form.due_date),
        deal_id: form.deal_id || null,
        contact_id: form.contact_id || null,
        contact_name: form.contact_name.trim() || null,
        notes: form.notes.trim() || null,
      };
      return editing ? crmApi.updateTask(task!.id!, payload) : crmApi.createTask(payload);
    },
    onSuccess: () => { invalidate(); toast.success(editing ? 'Activity updated' : 'Activity scheduled'); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save'),
  });

  const remove = useMutation({
    mutationFn: () => crmApi.deleteTask(task!.id!),
    onSuccess: () => { invalidate(); toast.success('Activity deleted'); onClose(); },
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editing ? 'Edit activity' : 'Schedule an activity'}
      description="Calls, meetings and follow-ups all live here — linked to a contact and a deal so nothing floats free."
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          {editing ? (
            <button
              onClick={() => { if (confirm('Delete this activity?')) remove.mutate(); }}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--error)] hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="activity-form" disabled={!form.title.trim() || save.isPending}>
              {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Schedule'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="activity-form" onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) save.mutate(); }} className="space-y-3.5">
        {/* Type is the first decision — it sets the tone for everything else */}
        <div>
          <FieldLabel>Type</FieldLabel>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {TASK_TYPES.map((t) => {
              const Icon = TASK_TYPE_ICON[t.id];
              const active = form.type === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => set('type', t.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-medium transition-all',
                    active
                      ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <Input label="What needs doing?" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Call about the Q3 proposal" autoFocus />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Due</FieldLabel>
            <input type="datetime-local" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} className={selectCls()} />
          </div>
          <div>
            <FieldLabel>Priority</FieldLabel>
            <select value={form.priority} onChange={(e) => set('priority', e.target.value)} className={selectCls()}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <ContactPicker
          contactId={form.contact_id}
          contactName={form.contact_name}
          contactEmail={form.contact_email}
          onName={(v) => set('contact_name', v)}
          onLink={(c) => setForm((f) => ({
            ...f,
            contact_id: c.id,
            contact_name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
            contact_email: c.email,
          }))}
          onUnlink={() => setForm((f) => ({ ...f, contact_id: null, contact_email: null, contact_name: '' }))}
        />

        <div>
          <FieldLabel>Deal</FieldLabel>
          <select value={form.deal_id} onChange={(e) => set('deal_id', e.target.value)} className={selectCls()}>
            {dealOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <FieldLabel>Notes</FieldLabel>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={3}
            placeholder="Context, talking points, what you promised…"
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] transition-all"
          />
        </div>
      </form>
    </Modal>
  );
}

/* ── Meeting (event) modal ────────────────────────────────────────────── */

export function MeetingModal({
  event, defaults, onClose,
}: {
  event: Partial<CrmEvent> | null;
  defaults?: Partial<CrmEvent>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = !!event?.id;
  const seed = { ...defaults, ...(event || {}) } as Partial<CrmEvent>;

  const [form, setForm] = useState({
    title: seed.title || '',
    type: (seed.type || 'meeting') as EventType,
    starts_at: toLocalInput(seed.starts_at) || toLocalInput(new Date().toISOString()),
    ends_at: toLocalInput(seed.ends_at),
    all_day: !!seed.all_day,
    location: seed.location || '',
    contact_id: seed.contact_id || seed.contact?.id || null,
    contact_name: seed.contact_name
      || (seed.contact ? [seed.contact.first_name, seed.contact.last_name].filter(Boolean).join(' ') : '')
      || '',
    contact_email: seed.contact_email || seed.contact?.email || null,
    deal_id: seed.deal_id || '',
    notes: seed.notes || '',
    outcome: seed.outcome || '',
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  const dealOptions = useDealOptions();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['crm'] });
    qc.invalidateQueries({ queryKey: ['contact-crm'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title.trim(),
        type: form.type,
        starts_at: fromLocalInput(form.starts_at) || new Date().toISOString(),
        ends_at: fromLocalInput(form.ends_at),
        all_day: form.all_day,
        location: form.location.trim() || null,
        contact_id: form.contact_id || null,
        contact_name: form.contact_name.trim() || null,
        contact_email: form.contact_email || null,
        deal_id: form.deal_id || null,
        notes: form.notes.trim() || null,
        outcome: form.outcome.trim() || null,
      };
      return editing ? crmApi.updateEvent(event!.id!, payload) : crmApi.createEvent(payload);
    },
    onSuccess: () => { invalidate(); toast.success(editing ? 'Meeting updated' : 'Meeting booked'); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save'),
  });

  const remove = useMutation({
    mutationFn: () => crmApi.deleteEvent(event!.id!),
    onSuccess: () => { invalidate(); toast.success('Meeting deleted'); onClose(); },
  });

  const started = !!form.starts_at && new Date(form.starts_at).getTime() < Date.now();

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editing ? 'Edit meeting' : 'Book a meeting'}
      description="Calls and meetings on your calendar, tied to the person and the deal they belong to."
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          {editing ? (
            <button
              onClick={() => { if (confirm('Delete this meeting?')) remove.mutate(); }}
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--error)] hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="meeting-form" disabled={!form.title.trim() || save.isPending}>
              {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Book it'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="meeting-form" onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) save.mutate(); }} className="space-y-3.5">
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <Input label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Intro call — Yieldtrak" autoFocus />
          <div className="flex gap-1.5 pb-0.5">
            {(['call', 'meeting'] as EventType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set('type', t)}
                className={cn(
                  'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[12px] font-medium capitalize transition-all',
                  form.type === t
                    ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                {t === 'call' ? <Phone className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Starts</FieldLabel>
            <input
              type={form.all_day ? 'date' : 'datetime-local'}
              value={form.all_day ? form.starts_at.slice(0, 10) : form.starts_at}
              onChange={(e) => set('starts_at', form.all_day ? `${e.target.value}T09:00` : e.target.value)}
              className={selectCls()}
            />
          </div>
          <div>
            <FieldLabel>Ends <span className="font-normal text-[var(--text-tertiary)]">(optional)</span></FieldLabel>
            <input
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => set('ends_at', e.target.value)}
              disabled={form.all_day}
              className={cn(selectCls(), form.all_day && 'opacity-50')}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => set('all_day', !form.all_day)}
          className="inline-flex items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]"
        >
          <span className={cn('relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors', form.all_day ? 'bg-[var(--indigo)]' : 'bg-[var(--border-default)]')}>
            <span className={cn('inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform', form.all_day ? 'translate-x-[15px]' : 'translate-x-[2px]')} />
          </span>
          All day
        </button>

        <div className="relative">
          <FieldLabel>Location</FieldLabel>
          <div className="relative">
            <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <input
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="Zoom link, address, or 'phone'"
              className={cn(selectCls(), 'pl-8')}
            />
          </div>
        </div>

        <ContactPicker
          contactId={form.contact_id}
          contactName={form.contact_name}
          contactEmail={form.contact_email}
          onName={(v) => set('contact_name', v)}
          onLink={(c) => setForm((f) => ({
            ...f,
            contact_id: c.id,
            contact_name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
            contact_email: c.email,
          }))}
          onUnlink={() => setForm((f) => ({ ...f, contact_id: null, contact_email: null, contact_name: '' }))}
        />

        <div>
          <FieldLabel>Deal</FieldLabel>
          <select value={form.deal_id} onChange={(e) => set('deal_id', e.target.value)} className={selectCls()}>
            {dealOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <FieldLabel>Agenda</FieldLabel>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            placeholder="What you want out of it"
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] transition-all"
          />
        </div>

        {/* Only worth asking once it has actually happened */}
        {(editing || started) && (
          <div>
            <FieldLabel>How did it go?</FieldLabel>
            <textarea
              value={form.outcome}
              onChange={(e) => set('outcome', e.target.value)}
              rows={2}
              placeholder="Outcome, next steps, who else was on the call"
              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] transition-all"
            />
          </div>
        )}
      </form>
    </Modal>
  );
}

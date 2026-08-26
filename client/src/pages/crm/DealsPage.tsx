import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi } from '../../api/crm.api';
import { ActivityModal, MeetingModal, ContactPicker, toDateInput } from '../../components/crm/CrmPrimitives';
import { contactsApi } from '../../api/contacts.api';
import { inboxApi } from '../../api/inbox.api';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Spinner } from '../../components/ui/Spinner';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { Avatar } from '../../components/shared/Avatar';
import { SearchInput } from '../../components/shared/SearchInput';
import { usePeek } from '../../components/peek/usePeek';
import { PipelineHeader } from '../../components/crm/PipelineHeader';
import { DealTable, type SortKey, type SortDir } from '../../components/crm/DealTable';
import { OutcomeDialog } from '../../components/crm/OutcomeDialog';
import {
  DealFilters, applyDealFilters, EMPTY_FILTERS,
  type DealFilterState, type DealView,
} from '../../components/crm/DealFilters';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import {
  Handshake, ListTodo, Calendar as CalendarIcon, Plus, Trash2,
  Phone, Users as UsersIcon, Building2,
  CalendarClock, CheckCircle2, Circle, GripVertical,
  X, Pencil, Clock, ArrowUpRight, ArrowDownLeft, Mail, StickyNote,
  Link2, Trophy, MailOpen, Briefcase, Download,
} from 'lucide-react';
import {
  DEAL_STAGES,
  isOpen,
  rotOf,
  STAGE_PROBABILITY,
  type Deal, type DealStage, type CreateDealInput,
  type CrmTask, type TaskPriority,
  type CrmEvent, type EventType,
  type ContactWithTags,
} from '@lemlist/shared';

/* ─── Helpers ─────────────────────────────────────── */
function fmtMoney(v: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v || 0);
  } catch { return `$${Math.round(v || 0).toLocaleString()}`; }
}
function dealAge(iso?: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month' : `${months} months`;
}
function relDay(iso?: string | null): { label: string; tone: 'over' | 'today' | 'soon' | 'none'; diff: number | null } {
  if (!iso) return { label: 'No date', tone: 'none', diff: null };
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(new Date())) / 86400000);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, tone: 'over', diff };
  if (diff === 0) return { label: 'Today', tone: 'today', diff };
  if (diff === 1) return { label: 'Tomorrow', tone: 'soon', diff };
  if (diff < 7) return { label: `In ${diff}d`, tone: 'soon', diff };
  return { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tone: 'none', diff };
}

/** Best display name for the lead attached to a deal (live contact wins). */
function leadName(d: Deal): string | null {
  if (d.contact) {
    const n = [d.contact.first_name, d.contact.last_name].filter(Boolean).join(' ');
    if (n) return n;
  }
  return d.contact_name || d.contact?.email || d.contact_email || null;
}
function leadEmail(d: Deal): string | null {
  return d.contact?.email || d.contact_email || null;
}
/** The lead's contact record, when the deal is actually linked to one. */
function leadId(d: Deal): string | null {
  return d.contact_id || d.contact?.id || null;
}
/** The account this deal belongs to — its own link, or the lead's. */
function dealCompanyId(d: Deal): string | null {
  return d.company_id || d.contact?.company_id || null;
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Export the given deals as a CSV file the browser downloads directly — no server round-trip. */
function exportDealsCsv(deals: Deal[]) {
  const header = ['Title', 'Company', 'Lead name', 'Lead email', 'Stage', 'Value', 'Expected close date', 'Notes'];
  const rows = deals.map(d => [
    d.title, d.company, leadName(d), leadEmail(d), DEAL_STAGES.find(s => s.id === d.stage)?.label || d.stage,
    d.value || 0, d.expected_close_date ? toDateInput(d.expected_close_date) : '', d.notes,
  ].map(csvCell).join(','));
  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `deals-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const STAGE_DOT: Record<DealStage, string> = {
  lead: 'bg-slate-400', qualified: 'bg-[var(--indigo)]', proposal: 'bg-amber-500', won: 'bg-emerald-500', lost: 'bg-rose-500',
};
const PRIORITY_META: Record<TaskPriority, { label: string; cls: string }> = {
  high: { label: 'High', cls: 'text-rose-500' },
  normal: { label: 'Normal', cls: 'text-[var(--text-tertiary)]' },
  low: { label: 'Low', cls: 'text-slate-400' },
};
const EVENT_META: Record<EventType, { label: string; icon: typeof Phone; dot: string; chip: string }> = {
  call: { label: 'Call', icon: Phone, dot: 'bg-[var(--indigo)]', chip: 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' },
  meeting: { label: 'Meeting', icon: UsersIcon, dot: 'bg-emerald-500', chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
};

/* ─── Lead picker ─────────────────────────────────── */
/* ─── Deal modal ──────────────────────────────────── */
export function DealModal({ deal, onClose }: { deal: Partial<Deal> | null; onClose: () => void }) {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const editing = !!deal?.id;
  const [form, setForm] = useState<CreateDealInput & { stage: DealStage }>({
    title: deal?.title || '',
    company: deal?.company || '',
    contact_name: deal?.contact_name || (deal?.contact ? [deal.contact.first_name, deal.contact.last_name].filter(Boolean).join(' ') : '') || '',
    contact_email: deal?.contact_email || deal?.contact?.email || null,
    contact_id: deal?.contact_id || deal?.contact?.id || null,
    value: deal?.value ?? 0,
    stage: (deal?.stage as DealStage) || 'lead',
    expected_close_date: toDateInput(deal?.expected_close_date) || '',
    notes: deal?.notes || '',
    // Empty means "use the stage default", which is what almost every deal
    // should be. Stored as a string so the field can be cleared back to that.
    probability: deal?.probability == null ? '' : String(deal.probability),
  } as any);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        value: Number(form.value) || 0,
        expected_close_date: form.expected_close_date || null,
        contact_email: form.contact_email || null,
        contact_id: form.contact_id || null,
        contact_name: form.contact_name?.trim() || null,
        // '' is a cleared field and means "no opinion, use the stage". 0 is a
        // real answer that means the deal is dead, so the two must not collapse.
        probability: (form as any).probability === '' ? null : Number((form as any).probability),
      };
      return editing ? crmApi.updateDeal(deal!.id!, payload) : crmApi.createDeal(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm'] }); toast.success(editing ? 'Deal updated' : 'Deal added'); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save deal'),
  });
  const del = useMutation({
    mutationFn: () => crmApi.deleteDeal(deal!.id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm'] }); toast.success('Deal deleted'); onClose(); },
    onError: () => toast.error('Failed to delete'),
  });

  const linkContact = (c: ContactWithTags) => {
    const full = [c.first_name, c.last_name].filter(Boolean).join(' ');
    setForm(f => ({
      ...f,
      contact_id: c.id,
      contact_email: c.email,
      contact_name: full || c.email,
      company: f.company || c.company || '',
    }));
  };

  return (
    <Modal isOpen onClose={onClose} title={editing ? 'Edit deal' : 'New deal'} size="md">
      <form onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) save.mutate(); }} className="space-y-4">
        <Input label="Deal name" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Northbeam — annual plan" required autoFocus />
        <ContactPicker
          label="Lead"
          contactId={form.contact_id || null}
          contactName={form.contact_name || ''}
          contactEmail={form.contact_email || null}
          onName={v => set('contact_name', v)}
          onLink={linkContact}
          onUnlink={() => setForm(f => ({ ...f, contact_id: null, contact_email: null, contact_name: '' }))}
        />
        <Input label="Company" value={form.company || ''} onChange={e => set('company', e.target.value)} placeholder="Northbeam" />
        <div className="grid grid-cols-3 gap-4">
          <Input label="Value (USD)" type="number" min="0" value={String(form.value ?? 0)} onChange={e => set('value', e.target.value)} />
          <Select label="Stage" options={DEAL_STAGES.map(s => ({ value: s.id, label: s.label }))} value={form.stage} onChange={e => set('stage', e.target.value)} />
          <Input label="Close date" type="date" value={form.expected_close_date || ''} onChange={e => set('expected_close_date', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Input
              label="Win probability"
              type="number"
              min="0"
              max="100"
              value={(form as any).probability ?? ''}
              onChange={e => set('probability', e.target.value)}
              placeholder={String(STAGE_PROBABILITY[form.stage])}
            />
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              Leave blank for the stage default ({STAGE_PROBABILITY[form.stage]}%).
            </p>
          </div>
          <div className="col-span-2 flex items-end pb-[26px]">
            <p className="text-[12px] text-[var(--text-secondary)]">
              Weighted at{' '}
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {fmtMoney(
                  ((Number(form.value) || 0) *
                    ((form as any).probability === '' || (form as any).probability == null
                      ? STAGE_PROBABILITY[form.stage]
                      : Number((form as any).probability) || 0)) / 100,
                )}
              </span>{' '}
              in the forecast.
            </p>
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">Notes</label>
          <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Context, next steps…" className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]" />
        </div>
        <div className="flex items-center justify-between pt-2">
          {editing ? (
            <button type="button" onClick={() => confirm({ title: `Delete "${form.title}"?`, body: 'The deal and its history go. Linked contacts and companies stay.', tone: 'danger' }, () => del.mutate())} className="flex items-center gap-1.5 text-[12px] font-medium text-rose-500 hover:text-rose-600 transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={save.isPending || !form.title.trim()}>{save.isPending ? 'Saving…' : editing ? 'Save' : 'Add deal'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Deal detail drawer ──────────────────────────── */
const STAGE_ACTIVE: Record<DealStage, string> = {
  lead: 'bg-slate-500 text-white border-slate-500',
  qualified: 'bg-[var(--indigo)] text-white border-[var(--indigo)]',
  proposal: 'bg-amber-500 text-white border-amber-500',
  won: 'bg-emerald-500 text-white border-emerald-500',
  lost: 'bg-rose-500 text-white border-rose-500',
};

/**
 * A company or person shown on a deal, as a way through to their history
 * rather than a label. Falls back to plain text when there's nothing to
 * open — a dead link is worse than no link.
 */
function CrossLink({ icon: Icon, label, onClick }: {
  icon: React.ElementType; label: string; onClick?: () => void;
}) {
  const body = (
    <>
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  if (!onClick) return <span className="inline-flex items-center gap-1 min-w-0">{body}</span>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`Open ${label}`}
      className="inline-flex items-center gap-1 min-w-0 rounded transition-colors hover:text-[var(--indigo)] hover:underline focus:outline-none focus-visible:text-[var(--indigo)]"
    >
      {body}
    </button>
  );
}

export function DealDrawer({
  deal, tasks, events, onClose, onEdit, onAddTask, onBookEvent,
}: {
  deal: Deal;
  tasks: CrmTask[];
  events: CrmEvent[];
  onClose: () => void;
  onEdit: (d: Deal) => void;
  onAddTask: (d: Deal) => void;
  onBookEvent: (d: Deal) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openPeek } = usePeek();
  const [show, setShow] = useState(false);

  const contactId = leadId(deal);
  const companyId = dealCompanyId(deal);

  useEffect(() => {
    setShow(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => { setShow(false); setTimeout(onClose, 180); };

  const email = leadEmail(deal);
  const name = leadName(deal);

  // Every email exchanged with this deal's lead — real platform sync with the inbox.
  const { data: emailsPage, isLoading: loadingEmails } = useQuery({
    queryKey: ['crm', 'deal-emails', email],
    queryFn: () => inboxApi.list({ contact_email: email!, limit: 5 }),
    enabled: !!email,
  });
  const emails = (emailsPage?.data || []) as any[];

  const dealTasks = tasks
    .filter(t => t.deal_id === deal.id)
    .sort((a, b) => Number(a.is_done) - Number(b.is_done) || (a.due_date || '').localeCompare(b.due_date || ''));
  const dealEvents = events
    .filter(e => e.deal_id === deal.id)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const changeStage = (stage: DealStage) => {
    if (stage === deal.stage) return;
    qc.setQueryData<Deal[]>(['crm', 'deals'], (old) => (old || []).map(d => d.id === deal.id ? { ...d, stage } : d));
    crmApi.updateDeal(deal.id, { stage })
      .then(() => qc.invalidateQueries({ queryKey: ['crm', 'deals'] }))
      .catch(() => { toast.error('Failed to move deal'); qc.invalidateQueries({ queryKey: ['crm', 'deals'] }); });
  };

  const toggleTask = (t: CrmTask) => {
    qc.setQueryData<CrmTask[]>(['crm', 'tasks'], (old) => (old || []).map(x => x.id === t.id ? { ...x, is_done: !x.is_done } : x));
    crmApi.updateTask(t.id, { is_done: !t.is_done })
      .then(() => qc.invalidateQueries({ queryKey: ['crm', 'tasks'] }))
      .catch(() => { toast.error('Failed to update task'); qc.invalidateQueries({ queryKey: ['crm', 'tasks'] }); });
  };

  const close_ = relDay(deal.expected_close_date);
  const closeTone = close_.tone === 'over' ? 'text-rose-500' : close_.tone === 'today' ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-primary)]';

  return (
    <div className="fixed inset-0 z-40">
      <div
        onClick={close}
        className={cn('absolute inset-0 bg-black/30 backdrop-blur-[1px] transition-opacity duration-200', show ? 'opacity-100' : 'opacity-0')}
      />
      <div
        className={cn(
          'absolute right-0 top-0 h-full w-full max-w-[456px] bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] shadow-[var(--shadow-xl)] flex flex-col transition-transform duration-200 ease-out',
          show ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-5 pt-4 pb-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between mb-3">
            <span className={cn('inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-[11px] font-semibold', STAGE_ACTIVE[deal.stage])}>
              {DEAL_STAGES.find(s => s.id === deal.stage)?.label}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => onEdit(deal)} className="icon-btn h-7 w-7" title="Edit deal"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={close} className="icon-btn h-7 w-7" title="Close"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <h2 className="text-[17px] font-semibold text-[var(--text-primary)] leading-snug tracking-[-0.01em]">{deal.title}</h2>
          {/* Both are doors: the company opens everyone who works there and
              every deal against the account; the person opens their own
              history. Neither costs you this drawer — peeks stack over it. */}
          {(deal.company || name) && (
            <div className="mt-1.5 flex items-center gap-2.5 text-[12.5px] text-[var(--text-tertiary)]">
              {deal.company && (
                <CrossLink
                  icon={Building2}
                  label={deal.company}
                  onClick={
                    companyId
                      ? () => openPeek('company', companyId)
                      // Not linked to a company record yet — take them to the
                      // accounts list filtered to this name rather than nowhere.
                      : () => navigate(`/companies?q=${encodeURIComponent(deal.company!)}`)
                  }
                />
              )}
              {name && (
                <CrossLink
                  icon={UsersIcon}
                  label={name}
                  onClick={contactId ? () => openPeek('contact', contactId) : undefined}
                />
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Stage changer */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Stage</p>
            <div className="flex flex-wrap gap-1.5">
              {DEAL_STAGES.map(s => {
                const active = s.id === deal.stage;
                return (
                  <button
                    key={s.id}
                    onClick={() => changeStage(s.id)}
                    className={cn(
                      'h-7 px-2.5 rounded-lg text-[12px] font-medium border transition-all',
                      active ? STAGE_ACTIVE[s.id] : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2.5">
            <Stat label="Value" value={fmtMoney(deal.value, deal.currency)} />
            <Stat label="Close date" value={close_.label} tone={closeTone} />
            <Stat label="Deal age" value={dealAge(deal.created_at)} />
          </div>

          {/* Lead card — the contact/lead attached to this deal */}
          {(email || name || deal.contact_id) && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center gap-1.5">
                <Link2 className="h-3 w-3" /> Attached lead
              </p>
              <div className="flex items-center gap-2.5">
                <Avatar name={name} email={email} size="lg" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{name || 'Contact'}</p>
                  {(deal.contact?.job_title || deal.contact?.company || deal.company) && (
                    <p className="text-[11px] text-[var(--text-tertiary)] truncate inline-flex items-center gap-1">
                      <Briefcase className="h-3 w-3 shrink-0" />
                      {[deal.contact?.job_title, deal.contact?.company || deal.company].filter(Boolean).join(' @ ')}
                    </p>
                  )}
                  {email && <p className="text-[11px] text-[var(--text-tertiary)] truncate flex items-center gap-1"><Mail className="h-3 w-3 shrink-0" />{email}</p>}
                </div>
                {(deal.contact_id || deal.contact?.id) && (
                  <button onClick={() => { close(); navigate(`/contacts/${deal.contact_id || deal.contact?.id}`); }} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--indigo)] hover:underline flex-shrink-0">
                    Open <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Conversation — synced from the inbox */}
          {email && (
            <Section title="Conversation" count={emailsPage?.total || emails.length} icon={MailOpen}
              actionLabel={deal.contact_id ? 'View all' : undefined}
              onAction={deal.contact_id ? () => { close(); navigate(`/contacts/${deal.contact_id}`); } : undefined}
            >
              {loadingEmails ? (
                <div className="flex justify-center py-3"><Spinner size="sm" /></div>
              ) : emails.length === 0 ? (
                <p className="text-[12px] text-[var(--text-muted)] py-1">No emails exchanged with {name || email} yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {emails.map((m) => {
                    const outbound = m.direction === 'outbound';
                    return (
                      <div key={m.id} className="flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] px-2.5 py-2">
                        <span className={cn('flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0', outbound ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400')}>
                          {outbound ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-[var(--text-primary)] truncate">{m.subject || '(no subject)'}</p>
                          <p className="text-[10.5px] text-[var(--text-tertiary)]">
                            {outbound ? 'You' : (name || m.from_email)} · {new Date(m.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>
          )}

          {/* Tasks */}
          <Section title="Tasks" count={dealTasks.length} actionLabel="Add task" onAction={() => onAddTask(deal)} icon={ListTodo}>
            {dealTasks.length === 0 ? (
              <p className="text-[12px] text-[var(--text-muted)] py-1">No tasks linked to this deal yet.</p>
            ) : (
              <div className="space-y-0.5">
                {dealTasks.map(t => {
                  const due = relDay(t.due_date);
                  const tone = due.tone === 'over' ? 'text-rose-500' : due.tone === 'today' ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-tertiary)]';
                  return (
                    <div key={t.id} className="flex items-center gap-2.5 py-1.5">
                      <button onClick={() => toggleTask(t)} className="flex-shrink-0" title={t.is_done ? 'Mark not done' : 'Mark done'}>
                        {t.is_done ? <CheckCircle2 className="h-[17px] w-[17px] text-emerald-500" /> : <Circle className="h-[17px] w-[17px] text-[var(--text-muted)] hover:text-[var(--indigo)] transition-colors" />}
                      </button>
                      <span className={cn('flex-1 min-w-0 text-[12.5px] truncate', t.is_done ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]')}>{t.title}</span>
                      {!t.is_done && t.due_date && <span className={cn('text-[11px] font-medium tabular flex-shrink-0', tone)}>{due.label}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Events */}
          <Section title="Meetings & calls" count={dealEvents.length} actionLabel="Book" onAction={() => onBookEvent(deal)} icon={CalendarIcon}>
            {dealEvents.length === 0 ? (
              <p className="text-[12px] text-[var(--text-muted)] py-1">No calls or meetings booked yet.</p>
            ) : (
              <div className="space-y-1.5">
                {dealEvents.map(ev => {
                  const meta = EVENT_META[ev.type];
                  const Icon = meta.icon;
                  const past = new Date(ev.starts_at) < new Date();
                  const when = new Date(ev.starts_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + new Date(ev.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  return (
                    <div key={ev.id} className={cn('flex items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] px-2.5 py-2', past && 'opacity-60')}>
                      <span className={cn('flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0', meta.chip)}><Icon className="h-3.5 w-3.5" /></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{ev.title}</p>
                        <p className="text-[11px] text-[var(--text-tertiary)]">{when}{ev.location ? ` · ${ev.location}` : ''}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Notes */}
          <Section title="Notes" icon={StickyNote}>
            {deal.notes?.trim() ? (
              <p className="text-[12.5px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{deal.notes}</p>
            ) : (
              <button onClick={() => onEdit(deal)} className="text-[12px] text-[var(--text-muted)] hover:text-[var(--indigo)] transition-colors">Add notes…</button>
            )}
          </Section>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><Clock className="h-3 w-3" /> {deal.updated_at ? `Updated ${dealAge(deal.updated_at)} ago` : 'Recently updated'}</span>
          <Button variant="secondary" onClick={() => onEdit(deal)}><Pencil className="h-3.5 w-3.5" /> Edit deal</Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 px-2.5 py-2">
      <p className="text-[10.5px] font-medium text-[var(--text-muted)]">{label}</p>
      <p className={cn('mt-0.5 text-[13.5px] font-semibold tabular leading-tight', tone || 'text-[var(--text-primary)]')}>{value}</p>
    </div>
  );
}

function Section({ title, count, actionLabel, onAction, icon: Icon, children }: {
  title: string; count?: number; actionLabel?: string; onAction?: () => void; icon: typeof ListTodo; children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{title}</p>
        {count != null && count > 0 && <span className="text-[11px] font-medium text-[var(--text-tertiary)] tabular">{count}</span>}
        <span className="flex-1" />
        {actionLabel && onAction && (
          <button onClick={onAction} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--indigo)] hover:underline">
            <Plus className="h-3 w-3" />{actionLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

/* ─── Pipeline (deals kanban) ─────────────────────── */
function PipelineBoard({ deals, tasks, events, onEdit, onStageChange, dragDisabled }: { deals: Deal[]; tasks: CrmTask[]; events: CrmEvent[]; onEdit: (d: Deal) => void; onStageChange: (d: Deal, stage: DealStage) => void; dragDisabled?: boolean }) {
  const { openPeek } = usePeek();
  const navigate = useNavigate();
  // Peek the account when the deal is linked to one; otherwise show the
  // accounts list filtered to the name we do have.
  const onOpenCompany = (d: Deal) => {
    const id = dealCompanyId(d);
    if (id) openPeek('company', id);
    else if (d.company) navigate(`/companies?q=${encodeURIComponent(d.company)}`);
  };
  const qc = useQueryClient();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ stage: DealStage; index: number } | null>(null);

  // Reorder within a column (or move across stages) at a given index — persists
  // fresh sequential positions for the affected column, optimistically.
  const commit = (stage: DealStage, index: number) => {
    const id = dragId;
    if (!id) return;
    const all = qc.getQueryData<Deal[]>(['crm', 'deals']) || deals;
    const moving = all.find(d => d.id === id);
    if (!moving) return;

    /*
     * A drag that ends the deal goes through the page's stage handler, which
     * asks why first. Reordering inside won or lost is meaningless anyway —
     * those columns are a record, not a queue — so nothing is lost by not
     * doing the optimistic position work here.
     */
    if (stage !== moving.stage && (stage === 'won' || stage === 'lost')) {
      onStageChange(moving, stage);
      return;
    }
    // `index` was measured against the on-screen column list, which still includes the
    // dragged card when it's already in this stage. targetList has that card removed, so
    // if the card started before the drop point, every slot after it shifts back by one.
    const sameStageItems = all.filter(d => d.stage === stage);
    const originalIndex = sameStageItems.findIndex(d => d.id === id);
    const adjustedIndex = originalIndex !== -1 && originalIndex < index ? index - 1 : index;
    const targetList = all.filter(d => d.stage === stage && d.id !== id);
    const insertAt = Math.max(0, Math.min(adjustedIndex, targetList.length));
    const newOrder = [...targetList.slice(0, insertAt), moving, ...targetList.slice(insertAt)];
    const rebuilt = newOrder.map((d, i) => ({ ...d, stage, position: i }));
    const changed = rebuilt.filter((d, i) => d.id === id || newOrder[i].position !== i || newOrder[i].stage !== stage);
    qc.setQueryData<Deal[]>(['crm', 'deals'], (old) => {
      const others = (old || []).filter(d => d.stage !== stage && d.id !== id);
      return [...others, ...rebuilt];
    });
    Promise.all(changed.map(d => crmApi.updateDeal(d.id, { stage, position: d.position })))
      .then(() => qc.invalidateQueries({ queryKey: ['crm'] }))
      .catch(() => { toast.error('Failed to reorder'); qc.invalidateQueries({ queryKey: ['crm'] }); });
  };

  const linkCounts = (dealId: string) => ({
    tasks: tasks.filter(t => t.deal_id === dealId && !t.is_done).length,
    events: events.filter(e => e.deal_id === dealId && new Date(e.starts_at) >= new Date()).length,
  });

  /*
   * Columns follow what is actually on the board.
   *
   * Won and lost only ever grow, and a board that always shows them spends a
   * third of its width on history — while the default filter is open deals,
   * which would render those two columns permanently empty. So they appear
   * when they hold something and stay out of the way when they do not.
   */
  const columns = DEAL_STAGES.filter(
    (s) => isOpen(s.id) || deals.some((d) => d.stage === s.id),
  );

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map(stage => {
        const items = deals.filter(d => d.stage === stage.id);
        const total = items.reduce((s, d) => s + (d.value || 0), 0);
        const dropHere = over?.stage === stage.id;
        return (
          <div
            key={stage.id}
            onDragOver={(e) => { e.preventDefault(); setOver({ stage: stage.id, index: items.length }); }}
            onDrop={(e) => { e.preventDefault(); if (dragId && over) commit(over.stage, over.index); setDragId(null); setOver(null); }}
            className={cn(
              'flex-shrink-0 w-[264px] rounded-xl border bg-[var(--bg-muted)]/40 flex flex-col max-h-full transition-colors',
              dropHere ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]/40' : 'border-[var(--border-subtle)]'
            )}
          >
            <div className="flex items-center gap-2 px-3 h-11 flex-shrink-0">
              <span className={cn('h-2 w-2 rounded-full', STAGE_DOT[stage.id])} />
              <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">{stage.label}</span>
              <span className="text-[11px] font-medium text-[var(--text-tertiary)] tabular">{items.length}</span>
              <span className="flex-1" />
              <span className="text-[11px] font-semibold text-[var(--text-secondary)] tabular">{fmtMoney(total)}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-[80px]">
              {items.map((d, idx) => {
                const lc = linkCounts(d.id);
                const rot = rotOf(d);
                const lead = leadName(d);
                const closeInfo = d.expected_close_date ? relDay(d.expected_close_date) : null;
                return (
                  <div key={d.id}>
                    {dropHere && over!.index === idx && dragId !== d.id && (
                      <div className="h-0.5 my-1 rounded-full bg-[var(--indigo)]" />
                    )}
                    {/* A div, not a button: the company and lead inside are
                        themselves clickable, and a button inside a button is
                        invalid markup that browsers resolve unpredictably. */}
                    <div
                      role="button"
                      tabIndex={0}
                      draggable={!dragDisabled}
                      onDragStart={() => { if (!dragDisabled) setDragId(d.id); }}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; setOver({ stage: stage.id, index: after ? idx + 1 : idx }); }}
                      onClick={() => onEdit(d)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(d); } }}
                      className={cn(
                        'group w-full text-left rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 my-1 shadow-[var(--shadow-sm)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all',
                        dragDisabled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
                        dragId === d.id && 'opacity-50'
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
                        <span className="text-[12.5px] font-medium text-[var(--text-primary)] leading-snug line-clamp-2">{d.title}</span>
                        {/* Movement is the only real signal of health, and a
                            static card is the one place it never shows. */}
                        {rot.rotting && (
                          <span
                            title={`No movement for ${rot.days} days — ${stage.label.toLowerCase()} deals are expected to move within ${rot.limit}`}
                            className="ml-auto inline-flex flex-shrink-0 items-center gap-0.5 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400"
                          >
                            <Clock className="h-2.5 w-2.5" />{rot.days}d
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-semibold text-[var(--text-primary)] tabular">{fmtMoney(d.value, d.currency)}</span>
                        {d.company && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpenCompany(d); }}
                            title={`Open ${d.company}`}
                            className="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-tertiary)] truncate max-w-[110px] rounded transition-colors hover:text-[var(--indigo)] hover:underline"
                          >
                            <Building2 className="h-3 w-3 flex-shrink-0" />{d.company}
                          </button>
                        )}
                      </div>
                      {(lead || closeInfo || lc.tasks > 0 || lc.events > 0) && (
                        <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-[var(--text-tertiary)]">
                          {lead && (leadId(d)
                            ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openPeek('contact', leadId(d)!); }}
                                title={`Open ${leadEmail(d) || lead}`}
                                className="inline-flex items-center gap-1 min-w-0 flex-shrink rounded transition-colors hover:text-[var(--indigo)]"
                              >
                                <Avatar name={lead} email={leadEmail(d)} size="xs" />
                                <span className="truncate max-w-[92px] hover:underline">{lead}</span>
                              </button>
                            )
                            : (
                              <span className="inline-flex items-center gap-1 min-w-0 flex-shrink" title={leadEmail(d) || lead}>
                                <Avatar name={lead} email={leadEmail(d)} size="xs" />
                                <span className="truncate max-w-[92px]">{lead}</span>
                              </span>
                            )
                          )}
                          <span className="flex-1" />
                          {closeInfo && (
                            <span className={cn('inline-flex items-center gap-1 flex-shrink-0', closeInfo.tone === 'over' && d.stage !== 'won' && d.stage !== 'lost' && 'text-rose-500 font-medium')}>
                              <CalendarClock className="h-3 w-3" /> {closeInfo.label}
                            </span>
                          )}
                          {lc.tasks > 0 && <span className="inline-flex items-center gap-1 flex-shrink-0"><ListTodo className="h-3 w-3" /> {lc.tasks}</span>}
                          {lc.events > 0 && <span className="inline-flex items-center gap-1 flex-shrink-0"><CalendarIcon className="h-3 w-3" /> {lc.events}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {dropHere && over!.index >= items.length && (
                <div className="h-0.5 my-1 rounded-full bg-[var(--indigo)]" />
              )}
              {items.length === 0 && !dropHere && (
                <p className="text-[11px] text-[var(--text-muted)] text-center py-4">Drop deals here</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Tasks panel ─────────────────────────────────── */
export function DealsPage() {
  const [dealModal, setDealModal] = useState<Partial<Deal> | null | undefined>(undefined);
  const [taskModal, setTaskModal] = useState<Partial<CrmTask> | null | undefined>(undefined);
  const [eventModal, setEventModal] = useState<Partial<CrmEvent> | null | undefined>(undefined);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  /* The view survives a reload: somebody who works in the table does not
     want to be put back on a board every morning. */
  const [view, setView] = useState<DealView>(() => {
    try { return (localStorage.getItem('deals.view') as DealView) || 'board'; } catch { return 'board'; }
  });
  const setViewPersisted = (v: DealView) => {
    setView(v);
    try { localStorage.setItem('deals.view', v); } catch { /* private window; not worth failing over */ }
  };

  const [filters, setFilters] = useState<DealFilterState>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<{ deal: Deal; stage: 'won' | 'lost' } | null>(null);

  const qc = useQueryClient();
  const { openPeek } = usePeek();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const dealsQ = useQuery({ queryKey: ['crm', 'deals'], queryFn: () => crmApi.listDeals() });
  const tasksQ = useQuery({ queryKey: ['crm', 'tasks'], queryFn: () => crmApi.listTasks() });
  const eventsQ = useQuery({ queryKey: ['crm', 'events'], queryFn: () => crmApi.listEvents() });

  const deals = dealsQ.data || [];
  const tasks = tasksQ.data || [];
  const events = eventsQ.data || [];

  const visibleDeals = useMemo(
    () => applyDealFilters(deals, filters, query),
    [deals, filters, query],
  );

  // Selection is keyed by id, and ids leave the page when a filter changes.
  // Left alone, a bulk action would apply to deals nobody can see.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(visibleDeals.map((d) => d.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleDeals]);

  const loading = dealsQ.isLoading || tasksQ.isLoading || eventsQ.isLoading;

  const refresh = () => qc.invalidateQueries({ queryKey: ['crm'] });

  /**
   * Move a deal to a stage, asking why when the move ends it.
   *
   * Every stage change on the page funnels through here — the board's drag,
   * the table's dropdown, the drawer — so the reason is asked once and in
   * one place rather than at whichever entry point somebody remembered.
   */
  const moveStage = async (deal: Deal, stage: DealStage, reason?: string | null) => {
    if (deal.stage === stage) return;
    if ((stage === 'won' || stage === 'lost') && reason === undefined) {
      setOutcome({ deal, stage });
      return;
    }
    try {
      await crmApi.updateDeal(deal.id, {
        stage,
        ...(reason !== undefined ? { outcome_reason: reason } : {}),
      } as any);
      refresh();
      toast.success(
        stage === 'won' ? `“${deal.title}” marked won`
          : stage === 'lost' ? `“${deal.title}” marked lost`
            : `Moved to ${DEAL_STAGES.find((s) => s.id === stage)?.label}`,
      );
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not move that deal');
      refresh();
    }
  };

  const bulkStage = async (stage: DealStage) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => crmApi.updateDeal(id, { stage } as any)));
      setSelected(new Set());
      refresh();
      toast.success(`${ids.length} deal${ids.length === 1 ? '' : 's'} moved`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not move those deals');
      refresh();
    }
  };

  const bulkDelete = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    confirm(
      {
        title: `Delete ${ids.length} deal${ids.length === 1 ? '' : 's'}?`,
        body: 'Their activities and meetings stay, but lose the link back to the deal. This cannot be undone.',
        tone: 'danger',
      },
      async () => {
        try {
          await Promise.all(ids.map((id) => crmApi.deleteDeal(id)));
          setSelected(new Set());
          refresh();
          toast.success('Deleted');
        } catch (e: any) {
          toast.error(e?.response?.data?.error || 'Could not delete those deals');
          refresh();
        }
      },
    );
  };

  const openCompany = (d: Deal) => {
    const id = dealCompanyId(d);
    if (id) openPeek('company', id);
    else if (d.company) navigate(`/companies?q=${encodeURIComponent(d.company)}`);
  };
  const openLead = (d: Deal) => {
    const id = leadId(d);
    if (id) openPeek('contact', id);
  };

  const onSort = (key: SortKey) => {
    if (key === sortKey) { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); return; }
    setSortKey(key);
    // Money and dates are almost always wanted biggest-or-soonest first;
    // names are wanted alphabetically. Guessing right saves a second click
    // on nearly every sort.
    setSortDir(key === 'title' || key === 'company' || key === 'lead' ? 'asc' : 'desc');
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--indigo-subtle)]">
            <Handshake className="h-5 w-5 text-[var(--indigo)]" />
          </span>
          <div>
            <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Deals</h1>
            <p className="text-[12.5px] text-[var(--text-tertiary)]">
              Your pipeline, synced with your leads. Activities and meetings have their own pages.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search deals, companies, leads…" className="hidden w-56 sm:block" />
          {deals.length > 0 && (
            <Button variant="secondary" onClick={() => exportDealsCsv(visibleDeals)} title="Export the deals shown below as a CSV file">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          )}
          <Button variant="primary" onClick={() => setDealModal(null)}><Plus className="h-4 w-4" /> New deal</Button>
        </div>
      </div>

      {deals.length > 0 && (
        <PipelineHeader
          deals={deals}
          onShowRotting={() => setFilters({ ...EMPTY_FILTERS, focus: 'stalled' })}
          onShowOverdue={() => setFilters({ ...EMPTY_FILTERS, focus: 'overdue' })}
        />
      )}

      {deals.length > 0 && (
        <DealFilters
          deals={deals}
          filters={filters}
          onChange={setFilters}
          view={view}
          onView={setViewPersisted}
        />
      )}

      {/* Bulk bar. Only present when something is selected, so it costs no
          height the rest of the time. */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--indigo)]/25 bg-[var(--indigo-subtle)] px-3 py-2">
          <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">
            {selected.size} selected
          </span>
          <span className="h-4 w-px bg-[var(--border-default)]" />
          <span className="text-[11.5px] text-[var(--text-secondary)]">Move to</span>
          {DEAL_STAGES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => bulkStage(s.id)}
              className="rounded-lg bg-[var(--bg-surface)] px-2 py-1 text-[11.5px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {s.label}
            </button>
          ))}
          <span className="flex-1" />
          <button
            type="button"
            onClick={bulkDelete}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-medium text-rose-500 transition-colors hover:bg-rose-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-[11.5px] font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Clear
          </button>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-24"><Spinner size="md" /></div>
      ) : deals.length === 0 ? (
        <EmptyBoard icon={Handshake} title="No deals yet" body="Add your first deal to start tracking your pipeline." action="New deal" onAction={() => setDealModal(null)} />
      ) : visibleDeals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] py-14 text-center">
          <p className="text-[13px] font-medium text-[var(--text-primary)]">
            {query ? `No deals match “${query}”` : 'Nothing here'}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
            {filters.focus === 'stalled'
              ? 'Nothing has gone quiet — every open deal has moved recently.'
              : filters.focus === 'overdue'
                ? 'Nothing is past its close date.'
                : 'Try a different filter, or clear the search.'}
          </p>
          <button
            onClick={() => { setQuery(''); setFilters(EMPTY_FILTERS); }}
            className="mt-2 text-[12px] text-[var(--indigo)] hover:underline"
          >
            Reset filters
          </button>
        </div>
      ) : view === 'table' ? (
        <DealTable
          deals={visibleDeals}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          selected={selected}
          onToggle={(id) => setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
          onToggleAll={() => setSelected((prev) =>
            prev.size === visibleDeals.length ? new Set() : new Set(visibleDeals.map((d) => d.id)))}
          onOpen={(d) => setDrawerId(d.id)}
          onOpenCompany={openCompany}
          onOpenLead={openLead}
          onStageChange={(d, stage) => moveStage(d, stage)}
        />
      ) : (
        <PipelineBoard
          deals={visibleDeals}
          tasks={tasks}
          events={events}
          onEdit={(d) => setDrawerId(d.id)}
          onStageChange={moveStage}
          dragDisabled={query.trim().length > 0}
        />
      )}

      {drawerId && deals.some((d) => d.id === drawerId) && (
        <DealDrawer
          deal={deals.find((d) => d.id === drawerId)!}
          tasks={tasks}
          events={events}
          onClose={() => setDrawerId(null)}
          onEdit={(d) => setDealModal(d)}
          onAddTask={(d) => setTaskModal({ deal_id: d.id, contact_id: d.contact_id, contact_name: leadName(d) })}
          onBookEvent={(d) => setEventModal({ deal_id: d.id, contact_id: d.contact_id, contact_name: leadName(d), contact_email: leadEmail(d), title: `Call — ${d.company || leadName(d) || d.title}` })}
        />
      )}

      {outcome && (
        <OutcomeDialog
          deal={outcome.deal}
          stage={outcome.stage}
          onCancel={() => setOutcome(null)}
          onConfirm={(reason) => {
            const { deal, stage } = outcome;
            setOutcome(null);
            moveStage(deal, stage, reason);
          }}
        />
      )}

      {dealModal !== undefined && <DealModal deal={dealModal} onClose={() => setDealModal(undefined)} />}
      {taskModal !== undefined && <ActivityModal task={taskModal} onClose={() => setTaskModal(undefined)} />}
      {eventModal !== undefined && <MeetingModal event={eventModal} onClose={() => setEventModal(undefined)} />}
    </div>
  );
}

function EmptyBoard({ icon: Icon, title, body, action, onAction }: { icon: typeof Handshake; title: string; body: string; action: string; onAction: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] py-16 text-center">
      <Icon className="h-8 w-8 text-[var(--text-muted)] mx-auto mb-3" />
      <p className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 mb-4">{body}</p>
      <Button variant="primary" onClick={onAction}><Plus className="h-4 w-4" /> {action}</Button>
    </div>
  );
}

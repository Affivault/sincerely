import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi } from '../../api/crm.api';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import {
  Handshake, ListTodo, Calendar as CalendarIcon, Plus, Trash2,
  ChevronLeft, ChevronRight, Phone, Users as UsersIcon, Building2,
  CalendarClock, CheckCircle2, Circle, Flag, GripVertical,
} from 'lucide-react';
import {
  DEAL_STAGES,
  type Deal, type DealStage, type CreateDealInput,
  type CrmTask, type CreateTaskInput, type TaskPriority,
  type CrmEvent, type CreateEventInput, type EventType,
} from '@lemlist/shared';

/* ─── Helpers ─────────────────────────────────────── */
function fmtMoney(v: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v || 0);
  } catch { return `$${Math.round(v || 0).toLocaleString()}`; }
}
function toDateInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
function relDay(iso?: string | null): { label: string; tone: 'over' | 'today' | 'soon' | 'none' } {
  if (!iso) return { label: 'No date', tone: 'none' };
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(new Date())) / 86400000);
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, tone: 'over' };
  if (diff === 0) return { label: 'Today', tone: 'today' };
  if (diff === 1) return { label: 'Tomorrow', tone: 'soon' };
  if (diff < 7) return { label: `In ${diff}d`, tone: 'soon' };
  return { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tone: 'none' };
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

/** Deal <select> options for linking a task/event to a deal. */
function useDealOptions() {
  const { data } = useQuery({ queryKey: ['crm', 'deals'], queryFn: () => crmApi.listDeals() });
  return [{ value: '', label: 'No deal' }, ...(data || []).map(d => ({ value: d.id, label: d.title }))];
}

/* ─── Deal modal ──────────────────────────────────── */
export function DealModal({ deal, onClose }: { deal: Partial<Deal> | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!deal?.id;
  const [form, setForm] = useState<CreateDealInput & { stage: DealStage }>({
    title: deal?.title || '',
    company: deal?.company || '',
    contact_name: deal?.contact_name || '',
    value: deal?.value ?? 0,
    stage: (deal?.stage as DealStage) || 'lead',
    expected_close_date: toDateInput(deal?.expected_close_date) || '',
    notes: deal?.notes || '',
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        value: Number(form.value) || 0,
        expected_close_date: form.expected_close_date || null,
        // Preserve the lead link when the deal is created from a contact page.
        contact_email: deal?.contact_email ?? undefined,
        contact_id: deal?.contact_id ?? undefined,
      };
      return editing ? crmApi.updateDeal(deal!.id!, payload) : crmApi.createDeal(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm'] }); toast.success(editing ? 'Deal updated' : 'Deal added'); onClose(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save deal'),
  });
  const del = useMutation({
    mutationFn: () => crmApi.deleteDeal(deal!.id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', 'deals'] }); toast.success('Deal deleted'); onClose(); },
    onError: () => toast.error('Failed to delete'),
  });

  return (
    <Modal isOpen onClose={onClose} title={editing ? 'Edit deal' : 'New deal'} size="md">
      <form onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) save.mutate(); }} className="space-y-4">
        <Input label="Deal name" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Northbeam — annual plan" required autoFocus />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Company" value={form.company || ''} onChange={e => set('company', e.target.value)} placeholder="Northbeam" />
          <Input label="Contact" value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} placeholder="Sarah Chen" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input label="Value (USD)" type="number" value={String(form.value ?? 0)} onChange={e => set('value', e.target.value)} />
          <Select label="Stage" options={DEAL_STAGES.map(s => ({ value: s.id, label: s.label }))} value={form.stage} onChange={e => set('stage', e.target.value)} />
          <Input label="Close date" type="date" value={form.expected_close_date || ''} onChange={e => set('expected_close_date', e.target.value)} />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">Notes</label>
          <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Context, next steps…" className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]" />
        </div>
        <div className="flex items-center justify-between pt-2">
          {editing ? (
            <button type="button" onClick={() => del.mutate()} className="flex items-center gap-1.5 text-[12px] font-medium text-rose-500 hover:text-rose-600 transition-colors">
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

/* ─── Task modal ──────────────────────────────────── */
function TaskModal({ task, onClose }: { task: Partial<CrmTask> | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!task?.id;
  const [form, setForm] = useState<CreateTaskInput & { priority: TaskPriority }>({
    title: task?.title || '',
    contact_name: task?.contact_name || '',
    priority: (task?.priority as TaskPriority) || 'normal',
    due_date: toDateInput(task?.due_date) || '',
    deal_id: task?.deal_id || '',
    notes: task?.notes || '',
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const dealOptions = useDealOptions();

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, deal_id: form.deal_id || null, due_date: form.due_date ? new Date(form.due_date + 'T09:00').toISOString() : null };
      return editing ? crmApi.updateTask(task!.id!, payload) : crmApi.createTask(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', 'tasks'] }); toast.success(editing ? 'Task updated' : 'Task added'); onClose(); },
    onError: () => toast.error('Failed to save task'),
  });
  const del = useMutation({
    mutationFn: () => crmApi.deleteTask(task!.id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', 'tasks'] }); toast.success('Task deleted'); onClose(); },
  });

  return (
    <Modal isOpen onClose={onClose} title={editing ? 'Edit task' : 'New task'} size="md">
      <form onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) save.mutate(); }} className="space-y-4">
        <Input label="Task" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Send proposal to Sarah" required autoFocus />
        <div className="grid grid-cols-3 gap-4">
          <Input label="Due date" type="date" value={form.due_date || ''} onChange={e => set('due_date', e.target.value)} />
          <Select label="Priority" options={[{ value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }]} value={form.priority} onChange={e => set('priority', e.target.value)} />
          <Input label="Contact" value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} placeholder="Sarah Chen" />
        </div>
        <Select label="Linked deal" options={dealOptions} value={form.deal_id || ''} onChange={e => set('deal_id', e.target.value)} />
        <div>
          <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">Notes</label>
          <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]" />
        </div>
        <div className="flex items-center justify-between pt-2">
          {editing ? (
            <button type="button" onClick={() => del.mutate()} className="flex items-center gap-1.5 text-[12px] font-medium text-rose-500 hover:text-rose-600 transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={save.isPending || !form.title.trim()}>{save.isPending ? 'Saving…' : editing ? 'Save' : 'Add task'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Event modal ─────────────────────────────────── */
export function EventModal({ event, onClose }: { event: Partial<CrmEvent> | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!event?.id;
  const [form, setForm] = useState<CreateEventInput & { type: EventType }>({
    title: event?.title || '',
    type: (event?.type as EventType) || 'meeting',
    starts_at: toLocalInput(event?.starts_at) || toLocalInput(new Date().toISOString()),
    contact_name: event?.contact_name || '',
    location: event?.location || '',
    deal_id: event?.deal_id || '',
    notes: event?.notes || '',
  });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const dealOptions = useDealOptions();

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, deal_id: form.deal_id || null, starts_at: fromLocalInput(form.starts_at) as string };
      return editing ? crmApi.updateEvent(event!.id!, payload) : crmApi.createEvent(payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', 'events'] }); toast.success(editing ? 'Event updated' : 'Event booked'); onClose(); },
    onError: () => toast.error('Failed to save event'),
  });
  const del = useMutation({
    mutationFn: () => crmApi.deleteEvent(event!.id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm', 'events'] }); toast.success('Event deleted'); onClose(); },
  });

  return (
    <Modal isOpen onClose={onClose} title={editing ? 'Edit event' : 'Book a call or meeting'} size="md">
      <form onSubmit={(e) => { e.preventDefault(); if (form.title.trim() && form.starts_at) save.mutate(); }} className="space-y-4">
        <Input label="Title" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Discovery call — Northbeam" required autoFocus />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Type" options={[{ value: 'meeting', label: 'Meeting' }, { value: 'call', label: 'Call' }]} value={form.type} onChange={e => set('type', e.target.value)} />
          <Input label="When" type="datetime-local" value={form.starts_at} onChange={e => set('starts_at', e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Contact" value={form.contact_name || ''} onChange={e => set('contact_name', e.target.value)} placeholder="Sarah Chen" />
          <Input label="Location / link" value={form.location || ''} onChange={e => set('location', e.target.value)} placeholder="Google Meet, Zoom…" />
        </div>
        <Select label="Linked deal" options={dealOptions} value={form.deal_id || ''} onChange={e => set('deal_id', e.target.value)} />
        <div>
          <label className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1">Notes</label>
          <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]" />
        </div>
        <div className="flex items-center justify-between pt-2">
          {editing ? (
            <button type="button" onClick={() => del.mutate()} className="flex items-center gap-1.5 text-[12px] font-medium text-rose-500 hover:text-rose-600 transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={save.isPending || !form.title.trim()}>{save.isPending ? 'Saving…' : editing ? 'Save' : 'Book it'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/* ─── Pipeline (deals kanban) ─────────────────────── */
function PipelineBoard({ deals, tasks, events, onEdit }: { deals: Deal[]; tasks: CrmTask[]; events: CrmEvent[]; onEdit: (d: Deal) => void }) {
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
    const targetList = all.filter(d => d.stage === stage && d.id !== id);
    const insertAt = Math.max(0, Math.min(index, targetList.length));
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

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {DEAL_STAGES.map(stage => {
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
                return (
                  <div key={d.id}>
                    {dropHere && over!.index === idx && dragId !== d.id && (
                      <div className="h-0.5 my-1 rounded-full bg-[var(--indigo)]" />
                    )}
                    <button
                      draggable
                      onDragStart={() => setDragId(d.id)}
                      onDragEnd={() => { setDragId(null); setOver(null); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; setOver({ stage: stage.id, index: after ? idx + 1 : idx }); }}
                      onClick={() => onEdit(d)}
                      className={cn(
                        'group w-full text-left rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 my-1 shadow-[var(--shadow-sm)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all cursor-grab active:cursor-grabbing',
                        dragId === d.id && 'opacity-50'
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="h-3.5 w-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
                        <span className="text-[12.5px] font-medium text-[var(--text-primary)] leading-snug line-clamp-2">{d.title}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-semibold text-[var(--text-primary)] tabular">{fmtMoney(d.value, d.currency)}</span>
                        {d.company && (
                          <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-tertiary)] truncate max-w-[110px]">
                            <Building2 className="h-3 w-3 flex-shrink-0" />{d.company}
                          </span>
                        )}
                      </div>
                      {(d.expected_close_date || lc.tasks > 0 || lc.events > 0) && (
                        <div className="mt-1.5 flex items-center gap-2.5 text-[10.5px] text-[var(--text-tertiary)]">
                          {d.expected_close_date && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {relDay(d.expected_close_date).label}</span>}
                          {lc.tasks > 0 && <span className="inline-flex items-center gap-1"><ListTodo className="h-3 w-3" /> {lc.tasks}</span>}
                          {lc.events > 0 && <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" /> {lc.events}</span>}
                        </div>
                      )}
                    </button>
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
function TasksPanel({ tasks, onEdit }: { tasks: CrmTask[]; onEdit: (t: CrmTask) => void }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: ({ id, is_done }: { id: string; is_done: boolean }) => crmApi.updateTask(id, { is_done }),
    onMutate: async ({ id, is_done }) => {
      await qc.cancelQueries({ queryKey: ['crm', 'tasks'] });
      const prev = qc.getQueryData<CrmTask[]>(['crm', 'tasks']);
      qc.setQueryData<CrmTask[]>(['crm', 'tasks'], (old) => (old || []).map(t => t.id === id ? { ...t, is_done } : t));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['crm', 'tasks'], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['crm', 'tasks'] }),
  });

  const open = tasks.filter(t => !t.is_done);
  const done = tasks.filter(t => t.is_done);

  const Row = ({ t }: { t: CrmTask }) => {
    const due = relDay(t.due_date);
    const tone = due.tone === 'over' ? 'text-rose-500' : due.tone === 'today' ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-tertiary)]';
    return (
      <div className="group flex items-center gap-3 px-3 h-12 border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors">
        <button onClick={() => toggle.mutate({ id: t.id, is_done: !t.is_done })} className="flex-shrink-0" title={t.is_done ? 'Mark not done' : 'Mark done'}>
          {t.is_done ? <CheckCircle2 className="h-[18px] w-[18px] text-emerald-500" /> : <Circle className="h-[18px] w-[18px] text-[var(--text-muted)] hover:text-[var(--indigo)] transition-colors" />}
        </button>
        <button onClick={() => onEdit(t)} className="flex-1 min-w-0 text-left flex items-center gap-2">
          <span className={cn('text-[13px] truncate', t.is_done ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]')}>{t.title}</span>
          {t.contact_name && <span className="text-[11px] text-[var(--text-tertiary)] truncate hidden sm:inline">· {t.contact_name}</span>}
        </button>
        {t.priority !== 'normal' && (
          <span className={cn('hidden sm:inline-flex items-center gap-1 text-[10.5px] font-medium', PRIORITY_META[t.priority].cls)}>
            <Flag className="h-3 w-3" />{PRIORITY_META[t.priority].label}
          </span>
        )}
        {!t.is_done && <span className={cn('text-[11px] font-medium tabular flex-shrink-0', tone)}>{due.label}</span>}
      </div>
    );
  };

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-16 text-center">
        <ListTodo className="h-8 w-8 text-[var(--text-muted)] mx-auto mb-3" />
        <p className="text-[13px] font-medium text-[var(--text-primary)]">No tasks yet</p>
        <p className="text-[12px] text-[var(--text-tertiary)] mt-1">Add follow-ups and to-dos to stay on top of every deal.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden max-w-3xl">
      {open.length > 0 && <div className="px-3 h-8 flex items-center text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-muted)]/50 border-b border-[var(--border-subtle)]">To do · {open.length}</div>}
      {open.map(t => <Row key={t.id} t={t} />)}
      {done.length > 0 && <div className="px-3 h-8 flex items-center text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-muted)]/50 border-y border-[var(--border-subtle)]">Done · {done.length}</div>}
      {done.map(t => <Row key={t.id} t={t} />)}
    </div>
  );
}

/* ─── Calendar panel ──────────────────────────────── */
function CalendarPanel({ events, onAdd, onEdit }: { events: CrmEvent[]; onAdd: (dayIso: string) => void; onEdit: (e: CrmEvent) => void }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const cells = useMemo(() => {
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const out: { date: Date; inMonth: boolean }[] = [];
    for (let i = firstDay - 1; i >= 0; i--) out.push({ date: new Date(year, month, -i), inMonth: false });
    const days = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= days; d++) out.push({ date: new Date(year, month, d), inMonth: true });
    while (out.length % 7 !== 0) out.push({ date: new Date(year, month + 1, out.length - days - firstDay + 1), inMonth: false });
    return out;
  }, [cursor]);

  const byDay = useMemo(() => {
    const m = new Map<string, CrmEvent[]>();
    for (const ev of events) {
      const k = toDateInput(ev.starts_at);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(ev);
    }
    return m;
  }, [events]);

  const todayKey = toDateInput(new Date().toISOString());

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-[var(--border-subtle)]">
        <CalendarIcon className="h-4 w-4 text-[var(--indigo)]" />
        <span className="text-[14px] font-semibold text-[var(--text-primary)]">{monthLabel}</span>
        <span className="flex-1" />
        <button onClick={() => setCursor(new Date())} className="text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 h-7 rounded-lg hover:bg-[var(--bg-hover)] transition-colors">Today</button>
        <button onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))} className="icon-btn h-7 w-7"><ChevronLeft className="h-4 w-4" /></button>
        <button onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))} className="icon-btn h-7 w-7"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 border-b border-[var(--border-subtle)]">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="py-2 text-center text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          const key = toDateInput(cell.date.toISOString());
          const dayEvents = byDay.get(key) || [];
          const isToday = key === todayKey;
          return (
            <div
              key={i}
              onClick={() => onAdd(new Date(cell.date.getFullYear(), cell.date.getMonth(), cell.date.getDate(), 9, 0).toISOString())}
              className={cn(
                'group min-h-[104px] border-b border-r border-[var(--border-subtle)] p-1.5 cursor-pointer transition-colors',
                (i + 1) % 7 === 0 && 'border-r-0',
                cell.inMonth ? 'hover:bg-[var(--bg-hover)]' : 'bg-[var(--bg-muted)]/30'
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[11px] font-medium px-1',
                  isToday ? 'bg-[var(--indigo)] text-white' : cell.inMonth ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'
                )}>{cell.date.getDate()}</span>
                <Plus className="h-3 w-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0, 3).map(ev => {
                  const meta = EVENT_META[ev.type];
                  const time = new Date(ev.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  return (
                    <button
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); onEdit(ev); }}
                      className={cn('w-full flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium truncate transition-opacity hover:opacity-90', meta.chip)}
                      title={`${time} · ${ev.title}`}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', meta.dot)} />
                      <span className="truncate">{time} {ev.title}</span>
                    </button>
                  );
                })}
                {dayEvents.length > 3 && <span className="block px-1.5 text-[10px] text-[var(--text-tertiary)]">+{dayEvents.length - 3} more</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main CRM page ───────────────────────────────── */
type Tab = 'pipeline' | 'tasks' | 'calendar';

export function CrmPage() {
  const [tab, setTab] = useState<Tab>('pipeline');
  const [dealModal, setDealModal] = useState<Partial<Deal> | null | undefined>(undefined);
  const [taskModal, setTaskModal] = useState<Partial<CrmTask> | null | undefined>(undefined);
  const [eventModal, setEventModal] = useState<Partial<CrmEvent> | null | undefined>(undefined);

  const dealsQ = useQuery({ queryKey: ['crm', 'deals'], queryFn: () => crmApi.listDeals() });
  const tasksQ = useQuery({ queryKey: ['crm', 'tasks'], queryFn: crmApi.listTasks });
  const eventsQ = useQuery({ queryKey: ['crm', 'events'], queryFn: () => crmApi.listEvents() });

  const deals = dealsQ.data || [];
  const tasks = tasksQ.data || [];
  const events = eventsQ.data || [];

  const pipelineValue = deals.filter(d => d.stage !== 'lost').reduce((s, d) => s + (d.value || 0), 0);
  const wonValue = deals.filter(d => d.stage === 'won').reduce((s, d) => s + (d.value || 0), 0);
  const openTasks = tasks.filter(t => !t.is_done).length;
  const upcoming = events.filter(e => new Date(e.starts_at) >= new Date()).length;

  const tabs: { id: Tab; label: string; icon: typeof Handshake; count?: number }[] = [
    { id: 'pipeline', label: 'Pipeline', icon: Handshake, count: deals.length },
    { id: 'tasks', label: 'Tasks', icon: ListTodo, count: openTasks },
    { id: 'calendar', label: 'Calendar', icon: CalendarIcon, count: upcoming },
  ];

  const newAction = () => {
    if (tab === 'pipeline') setDealModal(null);
    else if (tab === 'tasks') setTaskModal(null);
    else setEventModal(null);
  };
  const newLabel = tab === 'pipeline' ? 'New deal' : tab === 'tasks' ? 'New task' : 'Book event';

  const loading = dealsQ.isLoading || tasksQ.isLoading || eventsQ.isLoading;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--indigo-subtle)]">
            <Handshake className="h-5 w-5 text-[var(--indigo)]" />
          </span>
          <div>
            <h1 className="text-[19px] font-semibold text-[var(--text-primary)] tracking-[-0.01em]">CRM</h1>
            <p className="text-[12.5px] text-[var(--text-tertiary)]">Track deals, follow-ups, and the calls & meetings you book.</p>
          </div>
        </div>
        <Button variant="primary" onClick={newAction}><Plus className="h-4 w-4" /> {newLabel}</Button>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Open pipeline', value: fmtMoney(pipelineValue), sub: `${deals.filter(d => d.stage !== 'won' && d.stage !== 'lost').length} active deals` },
          { label: 'Won', value: fmtMoney(wonValue), sub: `${deals.filter(d => d.stage === 'won').length} closed` },
          { label: 'Open tasks', value: String(openTasks), sub: `${tasks.length} total` },
          { label: 'Upcoming events', value: String(upcoming), sub: 'calls & meetings' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
            <p className="text-[11px] font-medium text-[var(--text-tertiary)]">{s.label}</p>
            <p className="mt-1 text-[19px] font-semibold text-[var(--text-primary)] tabular leading-none">{s.value}</p>
            <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] mb-5">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative flex items-center gap-1.5 h-9 px-3 text-[13px] font-medium transition-colors',
                active ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={cn('flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] px-1 text-[10.5px] font-semibold tabular', active ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]')}>{t.count}</span>
              )}
              <span className={cn('absolute left-2 right-2 -bottom-px h-[2px] rounded-t-full transition-opacity', active ? 'bg-[var(--indigo)] opacity-100' : 'opacity-0')} />
            </button>
          );
        })}
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-24"><Spinner size="md" /></div>
      ) : tab === 'pipeline' ? (
        deals.length === 0 ? (
          <EmptyBoard icon={Handshake} title="No deals yet" body="Add your first deal to start tracking your pipeline." action="New deal" onAction={() => setDealModal(null)} />
        ) : (
          <PipelineBoard deals={deals} tasks={tasks} events={events} onEdit={(d) => setDealModal(d)} />
        )
      ) : tab === 'tasks' ? (
        <TasksPanel tasks={tasks} onEdit={(t) => setTaskModal(t)} />
      ) : (
        <CalendarPanel events={events} onAdd={(iso) => setEventModal({ starts_at: iso })} onEdit={(e) => setEventModal(e)} />
      )}

      {dealModal !== undefined && <DealModal deal={dealModal} onClose={() => setDealModal(undefined)} />}
      {taskModal !== undefined && <TaskModal task={taskModal} onClose={() => setTaskModal(undefined)} />}
      {eventModal !== undefined && <EventModal event={eventModal} onClose={() => setEventModal(undefined)} />}
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

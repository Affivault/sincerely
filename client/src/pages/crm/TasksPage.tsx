import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { crmApi } from '../../api/crm.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { EmptyState } from '../../components/shared/EmptyState';
import { Checkbox } from '../../components/ui/Checkbox';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../lib/utils';
import {
  ActivityModal, TASK_TYPE_ICON, TASK_TYPE_TONE, PRIORITY_TONE,
  dueLabel, DUE_TONE, startOfDay,
} from '../../components/crm/CrmPrimitives';
import {
  CheckSquare, Plus, Handshake, User, CalendarDays, ListTodo, Flame, Check,
  Linkedin, Copy, ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CrmTask, TaskType } from '@lemlist/shared';
import { TASK_TYPES, isLinkedinStep } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Activities.

   The organising question is "what do I do next", so the default view is a
   single prioritised stream bucketed by when it's due — overdue first,
   because that is the only bucket that costs you deals. Filters narrow by
   type; completed work is kept out of the way but reachable.
   ═══════════════════════════════════════════════════════════════════════ */

type Bucket = { id: string; label: string; hint?: string; tasks: CrmTask[]; tone: string };

// Tomorrow relative to *now*, not the task's stale due date — a task overdue
// by several days must clear in one push, not one day per click. Keeps
// whatever time of day it was already scheduled for.
function pushToTomorrow(dueDate: string): Date {
  const original = new Date(dueDate);
  const next = new Date();
  next.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds());
  next.setDate(next.getDate() + 1);
  return next;
}

function bucketTasks(tasks: CrmTask[]): Bucket[] {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const weekEnd = new Date(today.getTime() + 7 * 86_400_000);

  const open = tasks.filter((t) => !t.is_done);
  const overdue: CrmTask[] = [];
  const todayList: CrmTask[] = [];
  const tomorrowList: CrmTask[] = [];
  const week: CrmTask[] = [];
  const later: CrmTask[] = [];
  const undated: CrmTask[] = [];

  for (const t of open) {
    if (!t.due_date) { undated.push(t); continue; }
    const due = new Date(t.due_date);
    if (Number.isNaN(due.getTime())) { undated.push(t); continue; }
    const day = startOfDay(due);
    if (day < today) overdue.push(t);
    else if (day.getTime() === today.getTime()) todayList.push(t);
    else if (day.getTime() === tomorrow.getTime()) tomorrowList.push(t);
    else if (day < weekEnd) week.push(t);
    else later.push(t);
  }

  const byDue = (a: CrmTask, b: CrmTask) =>
    new Date(a.due_date || 0).getTime() - new Date(b.due_date || 0).getTime();

  return [
    { id: 'overdue', label: 'Overdue', hint: 'Deal with these first', tasks: overdue.sort(byDue), tone: 'text-rose-600 dark:text-rose-400' },
    { id: 'today', label: 'Today', tasks: todayList.sort(byDue), tone: 'text-amber-600 dark:text-amber-400' },
    { id: 'tomorrow', label: 'Tomorrow', tasks: tomorrowList.sort(byDue), tone: 'text-[var(--text-primary)]' },
    { id: 'week', label: 'This week', tasks: week.sort(byDue), tone: 'text-[var(--text-primary)]' },
    { id: 'later', label: 'Later', tasks: later.sort(byDue), tone: 'text-[var(--text-secondary)]' },
    { id: 'undated', label: 'No date set', hint: 'Give these a date so they surface', tasks: undated, tone: 'text-[var(--text-secondary)]' },
  ].filter((b) => b.tasks.length > 0);
}

function StatCard({ icon: Icon, label, value, tone }: {
  icon: typeof CheckSquare; label: string; value: string | number; tone?: string;
}) {
  return (
    <div className="panel px-4 py-3 flex items-center gap-3">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0', tone || 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]')}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[18px] font-semibold tabular text-[var(--text-primary)] leading-none tracking-[-0.02em]">{value}</p>
        <p className="text-[11px] text-[var(--text-tertiary)] mt-1">{label}</p>
      </div>
    </div>
  );
}

/* A LinkedIn touch raised by a sequence is work you do somewhere else, so
   the row carries the two things that make that quick: the words, on the
   clipboard, and the profile, in a new tab. Ticking the box is what tells
   the sequence to move on. */
function LinkedinTaskActions({ task }: { task: CrmTask }) {
  const [copied, setCopied] = useState(false);
  const { payload, target_url: url } = task;

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!payload) return;
    navigator.clipboard.writeText(payload).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1800); },
      () => toast.error('Could not copy that'),
    );
  };

  return (
    <span className="hidden sm:flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      {payload && (
        <button
          onClick={copy}
          title={payload}
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[var(--border-subtle)] text-[10.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors"
        >
          {copied ? <Check className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy message'}
        </button>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md bg-sky-500/10 text-[10.5px] font-semibold text-sky-700 dark:text-sky-400 hover:bg-sky-500/20 transition-colors"
        >
          <Linkedin className="h-3 w-3" /> Open profile
        </a>
      )}
    </span>
  );
}

function TaskRow({ task, onEdit, onToggle, onSnooze }: {
  task: CrmTask; onEdit: (t: CrmTask) => void; onToggle: (t: CrmTask) => void; onSnooze: (t: CrmTask) => void;
}) {
  const linkedin = isLinkedinStep(task.channel || '');
  const Icon = linkedin ? Linkedin : (TASK_TYPE_ICON[task.type] || CheckSquare);
  const due = dueLabel(task.due_date);
  const contactName = task.contact
    ? [task.contact.first_name, task.contact.last_name].filter(Boolean).join(' ') || task.contact.email
    : task.contact_name;

  return (
    <div
      onClick={() => onEdit(task)}
      className={cn(
        'group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent cursor-pointer transition-all',
        'hover:border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]',
        task.is_done && 'opacity-55',
      )}
    >
      <span onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
        <Checkbox checked={task.is_done} onChange={() => onToggle(task)} aria-label={`Complete ${task.title}`} />
      </span>

      <span className={cn(
        'flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0',
        linkedin ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400' : (TASK_TYPE_TONE[task.type] || TASK_TYPE_TONE.todo),
      )}>
        <Icon className="h-3.5 w-3.5" />
      </span>

      <div className="flex-1 min-w-0">
        <p className={cn('text-[13px] font-medium text-[var(--text-primary)] truncate', task.is_done && 'line-through')}>
          {task.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--text-tertiary)]">
          <span className={cn('font-medium', DUE_TONE[due.tone])}>{due.text}</span>
          {contactName && (
            <>
              <span className="text-[var(--text-muted)]">·</span>
              {task.contact_id ? (
                <Link
                  to={`/contacts/${task.contact_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 hover:text-[var(--indigo)] hover:underline truncate"
                >
                  <User className="h-3 w-3" />{contactName}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 truncate"><User className="h-3 w-3" />{contactName}</span>
              )}
            </>
          )}
          {task.deal && (
            <>
              <span className="text-[var(--text-muted)]">·</span>
              <Link
                to="/deals"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 hover:text-[var(--indigo)] hover:underline truncate"
              >
                <Handshake className="h-3 w-3" />{task.deal.title}
              </Link>
            </>
          )}
        </div>
      </div>

      {linkedin && !task.is_done && (
        <LinkedinTaskActions task={task} />
      )}

      {due.tone === 'over' && !task.is_done && (
        <button
          onClick={(e) => { e.stopPropagation(); onSnooze(task); }}
          title="Push to tomorrow"
          className="hidden sm:inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[var(--border-subtle)] text-[10.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
        >
          <ArrowRight className="h-3 w-3" /> Tomorrow
        </button>
      )}

      {task.priority !== 'normal' && (
        <span className={cn('hidden sm:inline-flex items-center h-5 px-2 rounded-full border text-[10px] font-semibold capitalize flex-shrink-0', PRIORITY_TONE[task.priority])}>
          {task.priority}
        </span>
      )}
    </div>
  );
}

export function TasksPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<Partial<CrmTask> | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TaskType | 'all'>('all');
  const [showDone, setShowDone] = useState(false);

  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['crm', 'tasks'], queryFn: () => crmApi.listTasks() });

  const toggle = useMutation({
    mutationFn: (t: CrmTask) => crmApi.updateTask(t.id, { is_done: !t.is_done }),
    onMutate: async (t) => {
      // Ticking a task should feel instant — the list is the whole interface.
      await qc.cancelQueries({ queryKey: ['crm', 'tasks'] });
      const prev = qc.getQueryData<CrmTask[]>(['crm', 'tasks']);
      qc.setQueryData<CrmTask[]>(['crm', 'tasks'], (old) =>
        (old || []).map((x) => (x.id === t.id ? { ...x, is_done: !x.is_done, completed_at: !x.is_done ? new Date().toISOString() : null } : x)));
      return { prev };
    },
    onError: (_e, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(['crm', 'tasks'], ctx.prev);
      toast.error('Could not update that');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['crm'] }),
  });

  // Overdue is the one bucket that costs deals, so pushing it out shouldn't
  // require opening the edit modal — bump the date a day forward and keep
  // whatever time of day it was already scheduled for.
  const snooze = useMutation({
    mutationFn: (t: CrmTask) => {
      const due = pushToTomorrow(t.due_date!);
      return crmApi.updateTask(t.id, { due_date: due.toISOString() });
    },
    onMutate: async (t) => {
      await qc.cancelQueries({ queryKey: ['crm', 'tasks'] });
      const prev = qc.getQueryData<CrmTask[]>(['crm', 'tasks']);
      const due = pushToTomorrow(t.due_date!);
      qc.setQueryData<CrmTask[]>(['crm', 'tasks'], (old) =>
        (old || []).map((x) => (x.id === t.id ? { ...x, due_date: due.toISOString() } : x)));
      return { prev };
    },
    onError: (_e, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(['crm', 'tasks'], ctx.prev);
      toast.error('Could not reschedule that');
    },
    onSuccess: () => toast.success('Pushed to tomorrow'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['crm'] }),
  });

  // One toast for the whole batch, not one per task — clearing a dozen
  // overdue items shouldn't paper the screen in identical toasts.
  const snoozeAll = useMutation({
    mutationFn: async (list: CrmTask[]) => {
      // allSettled, not all: one failed request must not make Promise.all
      // reject the whole batch and roll back tasks that actually succeeded.
      const results = await Promise.allSettled(
        list.map((t) => crmApi.updateTask(t.id, { due_date: pushToTomorrow(t.due_date!).toISOString() }))
      );
      const failed = list.filter((_, i) => results[i].status === 'rejected');
      return { failed };
    },
    onMutate: async (list) => {
      await qc.cancelQueries({ queryKey: ['crm', 'tasks'] });
      const prev = qc.getQueryData<CrmTask[]>(['crm', 'tasks']);
      const ids = new Set(list.map((t) => t.id));
      const dueById = new Map(list.map((t) => [t.id, pushToTomorrow(t.due_date!).toISOString()]));
      qc.setQueryData<CrmTask[]>(['crm', 'tasks'], (old) =>
        (old || []).map((x) => (ids.has(x.id) ? { ...x, due_date: dueById.get(x.id)! } : x)));
      return { prev };
    },
    onSuccess: ({ failed }, list, ctx) => {
      if (failed.length === 0) {
        toast.success(`Pushed ${list.length} to tomorrow`);
        return;
      }
      // Partial failure: only undo the ones that didn't actually save —
      // the rest genuinely moved and shouldn't snap back.
      if (ctx?.prev) {
        const prevById = new Map(ctx.prev.map((t) => [t.id, t]));
        const failedIds = new Set(failed.map((t) => t.id));
        qc.setQueryData<CrmTask[]>(['crm', 'tasks'], (old) =>
          (old || []).map((x) => (failedIds.has(x.id) ? prevById.get(x.id) || x : x)));
      }
      if (failed.length === list.length) {
        toast.error('Could not reschedule those');
      } else {
        toast.error(`Pushed ${list.length - failed.length} to tomorrow, ${failed.length} failed`);
      }
    },
    onError: (_e, _list, ctx) => {
      if (ctx?.prev) qc.setQueryData(['crm', 'tasks'], ctx.prev);
      toast.error('Could not reschedule those');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['crm'] }),
  });

  const filtered = useMemo(
    () => (typeFilter === 'all' ? tasks : tasks.filter((t) => t.type === typeFilter)),
    [tasks, typeFilter],
  );

  const buckets = useMemo(() => bucketTasks(filtered), [filtered]);

  const done = useMemo(() => {
    const cutoff = startOfDay(new Date()).getTime();
    return filtered
      .filter((t) => t.is_done)
      .sort((a, b) => new Date(b.completed_at || b.updated_at).getTime() - new Date(a.completed_at || a.updated_at).getTime())
      .map((t) => ({ t, today: new Date(t.completed_at || t.updated_at).getTime() >= cutoff }));
  }, [filtered]);

  const stats = useMemo(() => {
    const today = startOfDay(new Date());
    const open = tasks.filter((t) => !t.is_done);
    return {
      overdue: open.filter((t) => t.due_date && startOfDay(new Date(t.due_date)) < today).length,
      today: open.filter((t) => t.due_date && startOfDay(new Date(t.due_date)).getTime() === today.getTime()).length,
      open: open.length,
      doneToday: tasks.filter((t) => t.is_done && new Date(t.completed_at || t.updated_at) >= today).length,
    };
  }, [tasks]);

  const openNew = () => { setModal(null); setModalOpen(true); };
  const openEdit = (t: CrmTask) => { setModal(t); setModalOpen(true); };

  return (
    <div>
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(99,102,241,0.18)]">
            <ListTodo className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Activities"
        description={
          stats.overdue > 0
            ? `${stats.overdue} overdue · ${stats.today} due today`
            : stats.today > 0
              ? `${stats.today} due today — nothing overdue`
              : 'Calls, meetings and follow-ups, in the order they need doing'
        }
        actions={
          <button onClick={openNew} className="btn-primary">
            <Plus className="h-3.5 w-3.5" /> Schedule activity
          </button>
        }
      />

      <div className="space-y-4">
        {/* At-a-glance */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Flame} label="Overdue" value={stats.overdue} tone={stats.overdue > 0 ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : undefined} />
          <StatCard icon={CalendarDays} label="Due today" value={stats.today} tone={stats.today > 0 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : undefined} />
          <StatCard icon={ListTodo} label="Open" value={stats.open} />
          <StatCard icon={Check} label="Done today" value={stats.doneToday} tone={stats.doneToday > 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : undefined} />
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {([{ id: 'all' as const, label: 'All' }, ...TASK_TYPES]).map((t) => {
            const active = typeFilter === t.id;
            const count = t.id === 'all'
              ? tasks.filter((x) => !x.is_done).length
              : tasks.filter((x) => !x.is_done && x.type === t.id).length;
            return (
              <button
                key={t.id}
                onClick={() => setTypeFilter(t.id as TaskType | 'all')}
                className={cn(
                  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12px] font-medium transition-all',
                  active
                    ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]',
                )}
              >
                {t.label}
                <span className={cn('tabular text-[10.5px]', active ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')}>{count}</span>
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="panel p-4 space-y-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : buckets.length === 0 && done.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon={ListTodo}
              title={typeFilter === 'all' ? 'Nothing scheduled' : 'Nothing of this type'}
              description="Activities are how a pipeline actually moves — schedule the next call or follow-up and it'll show up here and on your calendar."
              actionLabel="Schedule activity"
              onAction={openNew}
            />
          </div>
        ) : (
          <>
            {buckets.map((b) => (
              <div key={b.id} className="panel overflow-hidden">
                <div className="flex items-baseline gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
                  <h3 className={cn('text-[12.5px] font-semibold', b.tone)}>{b.label}</h3>
                  <span className="text-[11px] tabular text-[var(--text-tertiary)]">{b.tasks.length}</span>
                  {b.id === 'overdue' && b.tasks.length > 1 ? (
                    <button
                      onClick={() => snoozeAll.mutate(b.tasks)}
                      disabled={snoozeAll.isPending}
                      className="ml-auto text-[11px] font-medium text-[var(--indigo)] hover:underline disabled:opacity-50"
                    >
                      Push all to tomorrow
                    </button>
                  ) : (
                    b.hint && <span className="text-[11px] text-[var(--text-muted)] ml-auto">{b.hint}</span>
                  )}
                </div>
                <div className="p-1.5">
                  {b.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} onEdit={openEdit} onToggle={(x) => toggle.mutate(x)} onSnooze={(x) => snooze.mutate(x)} />
                  ))}
                </div>
              </div>
            ))}

            {done.length > 0 && (
              <div className="panel overflow-hidden">
                <button
                  onClick={() => setShowDone((v) => !v)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 text-left hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <h3 className="text-[12.5px] font-semibold text-[var(--text-secondary)]">Completed</h3>
                  <span className="text-[11px] tabular text-[var(--text-tertiary)]">{done.length}</span>
                  <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">{showDone ? 'Hide' : 'Show'}</span>
                </button>
                {showDone && (
                  <div className="p-1.5">
                    {done.slice(0, 50).map(({ t }) => (
                      <TaskRow key={t.id} task={t} onEdit={openEdit} onToggle={(x) => toggle.mutate(x)} onSnooze={(x) => snooze.mutate(x)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {modalOpen && <ActivityModal task={modal} onClose={() => setModalOpen(false)} />}
    </div>
  );
}

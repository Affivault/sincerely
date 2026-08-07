import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi } from '../../api/crm.api';
import { inboxApi } from '../../api/inbox.api';
import { campaignsApi } from '../../api/campaigns.api';
import { Checkbox } from '../../components/ui/Checkbox';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../lib/utils';
import { ActivityModal, TASK_TYPE_ICON, startOfDay, sameDay } from '../../components/crm/CrmPrimitives';
import {
  CheckSquare, ChevronRight, Phone, Users, Inbox, Snowflake, Megaphone,
  Plus, PartyPopper,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CrmTask, CrmEvent, Deal } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Today.

   This is a queue, not a dashboard. The first version counted the same
   things twice — four tiles reading "Overdue 3", then a panel listing
   those same three — and painted six sections in six accent colours, so
   a paused campaign shouted exactly as loudly as a deal about to die.
   Everything below is one list, in the order you should work it: what's
   late, then what's booked, then what's due. Signals that are worth
   knowing but aren't tasks sit underneath in a single quiet strip, and
   the numbers live on the Dashboard where numbers belong.
   ═══════════════════════════════════════════════════════════════════════ */

/** Deals untouched for this long are treated as going cold. */
const STALE_DAYS = 14;

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "3 days late", for the only rows allowed to use the alarm colour. */
function lateBy(iso: string, today: Date): string {
  const days = Math.round((today.getTime() - startOfDay(new Date(iso)).getTime()) / 86_400_000);
  if (days <= 0) return 'Late';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days late`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? 'A week late' : `${weeks} weeks late`;
}

/* One row shape for both kinds of work, so the day reads as a single list
   rather than two lists that happen to be stacked. */
type Row =
  | { kind: 'task'; at: number; task: CrmTask; late: boolean }
  | { kind: 'meeting'; at: number; event: CrmEvent };

function TaskRow({ task, late, today, onToggle, onOpen }: {
  task: CrmTask; late: boolean; today: Date;
  onToggle: (t: CrmTask) => void; onOpen: (t: CrmTask) => void;
}) {
  const Icon = TASK_TYPE_ICON[task.type] || CheckSquare;
  const who = task.contact
    ? [task.contact.first_name, task.contact.last_name].filter(Boolean).join(' ') || task.contact.email
    : task.contact_name;

  return (
    <div className={cn(
      'group flex items-center gap-3 py-2.5 pr-4 transition-colors hover:bg-[var(--bg-hover)]',
      // The single alarm colour in the whole page. Everything that isn't
      // late is neutral, so late actually means something.
      late ? 'border-l-2 border-l-[var(--error)] pl-[14px]' : 'pl-4',
    )}>
      <Checkbox checked={false} onChange={() => onToggle(task)} aria-label={`Complete ${task.title}`} />
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
      <button onClick={() => onOpen(task)} className="flex-1 min-w-0 text-left">
        <span className="block text-[13px] text-[var(--text-primary)] truncate">{task.title}</span>
        {who && <span className="block text-[11.5px] text-[var(--text-tertiary)] truncate">{who}</span>}
      </button>
      {late && task.due_date && (
        <span className="flex-shrink-0 text-[11.5px] font-medium text-[var(--error)]">
          {lateBy(task.due_date, today)}
        </span>
      )}
      {task.contact_id && (
        <Link
          to={`/contacts/${task.contact_id}`}
          className="hidden sm:inline-flex flex-shrink-0 text-[11.5px] font-medium text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--indigo)] transition-all"
        >
          Profile
        </Link>
      )}
    </div>
  );
}

function MeetingRow({ event, onOpen }: { event: CrmEvent; onOpen: (e: CrmEvent) => void }) {
  const Icon = event.type === 'call' ? Phone : Users;
  return (
    <button
      onClick={() => onOpen(event)}
      className="w-full flex items-center gap-3 py-2.5 pl-4 pr-4 text-left transition-colors hover:bg-[var(--bg-hover)]"
    >
      <span className="w-[52px] flex-shrink-0 text-[11.5px] tabular font-medium text-[var(--text-secondary)]">
        {event.all_day ? 'All day' : clock(event.starts_at)}
      </span>
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] text-[var(--text-primary)] truncate">{event.title}</span>
        {(event.contact_name || event.location) && (
          <span className="block text-[11.5px] text-[var(--text-tertiary)] truncate">
            {[event.contact_name, event.location].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
    </button>
  );
}

/** A signal, not a task: one line, a count, and the way through to it. */
function SignalRow({ icon: Icon, label, count, to }: {
  icon: typeof Inbox; label: string; count: number; to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
      <span className="text-[13px] text-[var(--text-primary)]">
        <span className="tabular font-semibold">{count}</span> {label}
      </span>
      <ChevronRight className="h-3.5 w-3.5 ml-auto flex-shrink-0 text-[var(--text-muted)]" />
    </Link>
  );
}

export function TodayPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activityModal, setActivityModal] = useState<Partial<CrmTask> | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({ queryKey: ['crm', 'tasks'], queryFn: () => crmApi.listTasks() });
  const { data: events = [] } = useQuery({ queryKey: ['crm', 'events'], queryFn: () => crmApi.listEvents() });
  const { data: deals = [] } = useQuery({ queryKey: ['crm', 'deals'], queryFn: () => crmApi.listDeals() });
  const { data: unread } = useQuery({
    queryKey: ['today', 'unread'],
    queryFn: () => inboxApi.list({ is_read: false, limit: 1 }),
  });
  const { data: campaigns } = useQuery({ queryKey: ['campaigns', 'today'], queryFn: () => campaignsApi.list({ limit: 100 }) });

  const toggle = useMutation({
    mutationFn: (t: CrmTask) => crmApi.updateTask(t.id, { is_done: !t.is_done }),
    onMutate: async (t) => {
      await qc.cancelQueries({ queryKey: ['crm', 'tasks'] });
      const prev = qc.getQueryData<CrmTask[]>(['crm', 'tasks']);
      qc.setQueryData<CrmTask[]>(['crm', 'tasks'], (old) =>
        (old || []).map((x) => (x.id === t.id ? { ...x, is_done: true, completed_at: new Date().toISOString() } : x)));
      return { prev };
    },
    onError: (_e, _t, ctx) => {
      if (ctx?.prev) qc.setQueryData(['crm', 'tasks'], ctx.prev);
      toast.error('Could not update that');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['crm'] }),
  });

  const now = new Date();
  const today = startOfDay(now);

  const { rows, lateCount, staleCount, pausedCount } = useMemo(() => {
    const open = tasks.filter((t) => !t.is_done);
    const time = (iso?: string | null) => (iso ? new Date(iso).getTime() : 0);

    const late = open
      .filter((t) => t.due_date && startOfDay(new Date(t.due_date)) < today)
      .sort((a, b) => time(a.due_date) - time(b.due_date))
      .map<Row>((task) => ({ kind: 'task', at: time(task.due_date), task, late: true }));

    // Meetings and to-dos share one timeline: at 2pm you want to know the
    // 3pm call is next, not that it lives in a different panel.
    const booked = (events as CrmEvent[])
      .filter((e) => sameDay(new Date(e.starts_at), today))
      .map<Row>((event) => ({ kind: 'meeting', at: time(event.starts_at), event }));

    const due = open
      .filter((t) => t.due_date && sameDay(new Date(t.due_date), today))
      .map<Row>((task) => ({ kind: 'task', at: time(task.due_date), task, late: false }));

    const rest = [...booked, ...due].sort((a, b) => a.at - b.at);

    const staleCount = (deals as Deal[])
      .filter((d) => d.stage !== 'won' && d.stage !== 'lost')
      .filter((d) => (daysSince(d.updated_at) ?? 0) >= STALE_DAYS)
      .length;

    const pausedCount = ((campaigns?.data || []) as any[])
      .filter((c) => c.status === 'paused' || c.status === 'error')
      .length;

    return { rows: [...late, ...rest], lateCount: late.length, staleCount, pausedCount };
  }, [tasks, events, deals, campaigns, today]);

  const unreadTotal = unread?.total ?? 0;
  const openActivity = (t: Partial<CrmTask> | null) => { setActivityModal(t); setModalOpen(true); };
  const openMeeting = (e: CrmEvent) => navigate(e.contact_id ? `/contacts/${e.contact_id}` : '/calendar');

  const remaining = rows.length;
  const hasSignals = unreadTotal > 0 || staleCount > 0 || pausedCount > 0;

  return (
    <div className="space-y-4 max-w-3xl">
      {/* One line of context, one action. The date and the count are the
          only numbers here — the rest are the Dashboard's job. */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold text-[var(--text-primary)] tracking-[-0.02em] leading-tight">
            Today
          </h1>
          <p className="text-[12.5px] text-[var(--text-secondary)] mt-0.5">
            {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            {remaining > 0 && (
              <>
                {' · '}
                {lateCount > 0 && <span className="text-[var(--error)] font-medium">{lateCount} late</span>}
                {lateCount > 0 && remaining > lateCount && ', '}
                {remaining > lateCount && `${remaining - lateCount} to go`}
              </>
            )}
          </p>
        </div>
        <button onClick={() => openActivity(null)} className="btn-primary">
          <Plus className="h-3.5 w-3.5" /> Schedule
        </button>
      </div>

      {tasksLoading ? (
        <div className="panel p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
      ) : remaining === 0 ? (
        <div className="panel py-14 text-center">
          <span className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-emerald-500/10 mb-3">
            <PartyPopper className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </span>
          <p className="text-[15px] font-semibold text-[var(--text-primary)]">Nothing left today</p>
          <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 max-w-sm mx-auto">
            No meetings, nothing due and nothing late. Good time to add prospects or start a campaign.
          </p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <Link to="/prospector" className="btn-secondary">Find prospects</Link>
            <Link to="/campaigns/new" className="btn-primary">New campaign</Link>
          </div>
        </div>
      ) : (
        <div className="panel overflow-hidden divide-y divide-[var(--border-subtle)]">
          {rows.map((row) =>
            row.kind === 'meeting' ? (
              <MeetingRow key={`e-${row.event.id}`} event={row.event} onOpen={openMeeting} />
            ) : (
              <TaskRow
                key={`t-${row.task.id}`}
                task={row.task}
                late={row.late}
                today={today}
                onToggle={(x) => toggle.mutate(x)}
                onOpen={openActivity}
              />
            )
          )}
        </div>
      )}

      {/* Worth knowing, not worth a panel each. */}
      {hasSignals && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-muted)] mb-1.5 px-0.5">
            Worth a look
          </p>
          <div className="panel overflow-hidden divide-y divide-[var(--border-subtle)]">
            {unreadTotal > 0 && (
              <SignalRow icon={Inbox} label={unreadTotal === 1 ? 'unread reply' : 'unread replies'} count={unreadTotal} to="/inbox" />
            )}
            {staleCount > 0 && (
              <SignalRow
                icon={Snowflake}
                label={`${staleCount === 1 ? 'deal' : 'deals'} untouched for ${STALE_DAYS}+ days`}
                count={staleCount}
                to="/deals"
              />
            )}
            {pausedCount > 0 && (
              <SignalRow
                icon={Megaphone}
                label={pausedCount === 1 ? 'campaign stopped' : 'campaigns stopped'}
                count={pausedCount}
                to="/campaigns"
              />
            )}
          </div>
        </div>
      )}

      {modalOpen && <ActivityModal task={activityModal} onClose={() => setModalOpen(false)} />}
    </div>
  );
}

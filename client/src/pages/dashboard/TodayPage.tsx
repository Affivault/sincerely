import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi } from '../../api/crm.api';
import { inboxApi } from '../../api/inbox.api';
import { campaignsApi } from '../../api/campaigns.api';
import { useAuth } from '../../context/AuthContext';
import { Checkbox } from '../../components/ui/Checkbox';
import { Skeleton } from '../../components/ui/Skeleton';
import { Avatar } from '../../components/shared/Avatar';
import { cn } from '../../lib/utils';
import {
  ActivityModal, TASK_TYPE_ICON, TASK_TYPE_TONE, dueLabel, DUE_TONE, startOfDay, sameDay,
} from '../../components/crm/CrmPrimitives';
import {
  Flame, CalendarDays, Inbox, CheckSquare, ArrowRight, Phone, Users,
  Snowflake, Megaphone, BarChart3, Sun, Sunrise, Moon, PartyPopper, Plus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { CrmTask, CrmEvent, Deal } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Today.

   The old home was a report: funnels, leaderboards, deliverability scores.
   Useful on a Friday, useless on a Tuesday morning — it told you what had
   happened, never what to do. This is the worklist version: the things
   that are late, the things due now, the people waiting on a reply, and
   the deals quietly going cold. Analytics still exists, one click away.
   ═══════════════════════════════════════════════════════════════════════ */

/** Deals untouched for this long are treated as going cold. */
const STALE_DAYS = 14;

function greeting(now: Date): { text: string; icon: typeof Sun } {
  const h = now.getHours();
  if (h < 12) return { text: 'Good morning', icon: Sunrise };
  if (h < 18) return { text: 'Good afternoon', icon: Sun };
  return { text: 'Good evening', icon: Moon };
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function Tile({ icon: Icon, label, value, tone, to }: {
  icon: typeof Flame; label: string; value: number; tone?: string; to: string;
}) {
  return (
    <Link
      to={to}
      className="panel px-4 py-3 flex items-center gap-3 hover:border-[var(--indigo)]/40 hover:bg-[var(--bg-hover)] transition-colors"
    >
      <span className={cn(
        'flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0',
        value > 0 && tone ? tone : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]',
      )}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[18px] font-semibold tabular text-[var(--text-primary)] leading-none tracking-[-0.02em]">{value}</span>
        <span className="block text-[11px] text-[var(--text-tertiary)] mt-1">{label}</span>
      </span>
    </Link>
  );
}

function SectionCard({ icon: Icon, title, count, tone, action, children }: {
  icon: typeof Flame; title: string; count?: number; tone?: string;
  action?: { label: string; to: string };
  children: React.ReactNode;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50">
        <Icon className={cn('h-3.5 w-3.5', tone || 'text-[var(--text-tertiary)]')} />
        <h2 className={cn('text-[12.5px] font-semibold', tone || 'text-[var(--text-primary)]')}>{title}</h2>
        {count != null && <span className="text-[11px] tabular text-[var(--text-tertiary)]">{count}</span>}
        {action && (
          <Link to={action.to} className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--indigo)] hover:underline">
            {action.label} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function ActivityRow({ task, onToggle, onOpen }: {
  task: CrmTask; onToggle: (t: CrmTask) => void; onOpen: (t: CrmTask) => void;
}) {
  const Icon = TASK_TYPE_ICON[task.type] || CheckSquare;
  const due = dueLabel(task.due_date);
  const who = task.contact
    ? [task.contact.first_name, task.contact.last_name].filter(Boolean).join(' ') || task.contact.email
    : task.contact_name;
  return (
    <div className="flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--bg-hover)] transition-colors">
      <Checkbox checked={false} onChange={() => onToggle(task)} aria-label={`Complete ${task.title}`} />
      <span className={cn('flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0', TASK_TYPE_TONE[task.type])}>
        <Icon className="h-3 w-3" />
      </span>
      <button onClick={() => onOpen(task)} className="flex-1 min-w-0 text-left">
        <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">{task.title}</span>
        <span className="flex items-center gap-1.5 text-[11px]">
          <span className={DUE_TONE[due.tone]}>{due.text}</span>
          {who && <><span className="text-[var(--text-muted)]">·</span><span className="text-[var(--text-tertiary)] truncate">{who}</span></>}
        </span>
      </button>
      {task.contact_id && (
        <Link
          to={`/contacts/${task.contact_id}`}
          className="hidden sm:inline-flex h-6 px-2 items-center rounded-md border border-[var(--border-subtle)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
        >
          Profile
        </Link>
      )}
    </div>
  );
}

export function TodayPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [activityModal, setActivityModal] = useState<Partial<CrmTask> | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({ queryKey: ['crm', 'tasks'], queryFn: () => crmApi.listTasks() });
  const { data: events = [] } = useQuery({ queryKey: ['crm', 'events'], queryFn: () => crmApi.listEvents() });
  const { data: deals = [] } = useQuery({ queryKey: ['crm', 'deals'], queryFn: () => crmApi.listDeals() });
  const { data: unread } = useQuery({
    queryKey: ['today', 'unread'],
    queryFn: () => inboxApi.list({ is_read: false, limit: 6 }),
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

  const { overdue, dueToday, meetingsToday, stale, needsAttention } = useMemo(() => {
    const open = tasks.filter((t) => !t.is_done);
    const byDue = (a: CrmTask, b: CrmTask) =>
      new Date(a.due_date || 0).getTime() - new Date(b.due_date || 0).getTime();

    const overdue = open
      .filter((t) => t.due_date && startOfDay(new Date(t.due_date)) < today)
      .sort(byDue);
    const dueToday = open
      .filter((t) => t.due_date && sameDay(new Date(t.due_date), today))
      .sort(byDue);

    const meetingsToday = (events as CrmEvent[])
      .filter((e) => sameDay(new Date(e.starts_at), today))
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

    // A deal is "cold" when it's still open and nothing has touched it for a
    // fortnight — the quiet way pipelines die.
    const stale = (deals as Deal[])
      .filter((d) => d.stage !== 'won' && d.stage !== 'lost')
      .map((d) => ({ deal: d, days: daysSince(d.updated_at) ?? 0 }))
      .filter((x) => x.days >= STALE_DAYS)
      .sort((a, b) => b.days - a.days)
      .slice(0, 5);

    const running = (campaigns?.data || []) as any[];
    const needsAttention = running
      .filter((c) => c.status === 'paused' || c.status === 'error')
      .slice(0, 4);

    return { overdue, dueToday, meetingsToday, stale, needsAttention };
  }, [tasks, events, deals, campaigns, today]);

  const unreadMessages = (unread?.data || []) as any[];
  const unreadTotal = unread?.total ?? unreadMessages.length;

  const openActivity = (t: Partial<CrmTask> | null) => { setActivityModal(t); setModalOpen(true); };

  const name = (user as any)?.user_metadata?.full_name?.split(' ')[0]
    || (user?.email ? user.email.split('@')[0] : '');
  const { text: hello, icon: HelloIcon } = greeting(now);

  const nothingToDo =
    overdue.length === 0 && dueToday.length === 0 && meetingsToday.length === 0 &&
    unreadMessages.length === 0 && stale.length === 0 && needsAttention.length === 0;

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Greeting */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(99,102,241,0.18)]">
            <HelloIcon className="h-5 w-5 text-[var(--indigo)]" />
          </span>
          <div>
            <h1 className="text-[22px] font-semibold text-[var(--text-primary)] tracking-[-0.02em] leading-tight">
              {hello}{name ? `, ${name}` : ''}
            </h1>
            <p className="text-[12.5px] text-[var(--text-secondary)]">
              {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              {overdue.length > 0
                ? ` · ${overdue.length} thing${overdue.length === 1 ? '' : 's'} overdue`
                : dueToday.length > 0
                  ? ` · ${dueToday.length} due today`
                  : ' · nothing overdue'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/dashboard/overview" className="btn-secondary">
            <BarChart3 className="h-3.5 w-3.5" /> Performance
          </Link>
          <button onClick={() => openActivity(null)} className="btn-primary">
            <Plus className="h-3.5 w-3.5" /> Schedule
          </button>
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Flame} label="Overdue" value={overdue.length} tone="bg-rose-500/10 text-rose-600 dark:text-rose-400" to="/tasks" />
        <Tile icon={CheckSquare} label="Due today" value={dueToday.length} tone="bg-amber-500/10 text-amber-600 dark:text-amber-400" to="/tasks" />
        <Tile icon={CalendarDays} label="Meetings today" value={meetingsToday.length} tone="bg-violet-500/10 text-violet-600 dark:text-violet-400" to="/calendar" />
        <Tile icon={Inbox} label="Unread replies" value={unreadTotal} tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" to="/inbox" />
      </div>

      {tasksLoading ? (
        <div className="panel p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
      ) : nothingToDo ? (
        <div className="panel py-14 text-center">
          <span className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-emerald-500/10 mb-3">
            <PartyPopper className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </span>
          <p className="text-[15px] font-semibold text-[var(--text-primary)]">You're all clear</p>
          <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 max-w-sm mx-auto">
            Nothing overdue, nothing due today, no unread replies and no deals going cold. Good time to add prospects or start a campaign.
          </p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <Link to="/prospector" className="btn-secondary">Find prospects</Link>
            <Link to="/campaigns/new" className="btn-primary">New campaign</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Overdue first — the only bucket that costs you deals */}
          {overdue.length > 0 && (
            <SectionCard icon={Flame} title="Overdue" count={overdue.length} tone="text-rose-600 dark:text-rose-400" action={{ label: 'All activities', to: '/tasks' }}>
              <div className="divide-y divide-[var(--border-subtle)]">
                {overdue.slice(0, 6).map((t) => (
                  <ActivityRow key={t.id} task={t} onToggle={(x) => toggle.mutate(x)} onOpen={openActivity} />
                ))}
              </div>
            </SectionCard>
          )}

          {/* Today's plan: activities and meetings interleaved by time */}
          {(dueToday.length > 0 || meetingsToday.length > 0) && (
            <SectionCard icon={CalendarDays} title="Today" count={dueToday.length + meetingsToday.length} action={{ label: 'Calendar', to: '/calendar' }}>
              <div className="divide-y divide-[var(--border-subtle)]">
                {meetingsToday.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => navigate(e.contact_id ? `/contacts/${e.contact_id}` : '/calendar')}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <span className="w-14 flex-shrink-0 text-[11.5px] tabular font-medium text-[var(--text-tertiary)]">
                      {e.all_day ? 'All day' : new Date(e.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 flex-shrink-0">
                      {e.type === 'call' ? <Phone className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">{e.title}</span>
                      {(e.contact_name || e.location) && (
                        <span className="block text-[11px] text-[var(--text-tertiary)] truncate">
                          {[e.contact_name, e.location].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
                {dueToday.map((t) => (
                  <ActivityRow key={t.id} task={t} onToggle={(x) => toggle.mutate(x)} onOpen={openActivity} />
                ))}
              </div>
            </SectionCard>
          )}

          {/* People waiting on you */}
          {unreadMessages.length > 0 && (
            <SectionCard icon={Inbox} title="Waiting on a reply" count={unreadTotal} tone="text-emerald-600 dark:text-emerald-400" action={{ label: 'Unibox', to: '/inbox' }}>
              <div className="divide-y divide-[var(--border-subtle)]">
                {unreadMessages.map((m) => (
                  <Link
                    key={m.id}
                    to={`/inbox?message=${m.id}`}
                    className="flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <Avatar name={m.contact_name || m.from_email} email={m.from_email} size="sm" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">
                        {m.subject || '(no subject)'}
                      </span>
                      <span className="block text-[11px] text-[var(--text-tertiary)] truncate">{m.from_email}</span>
                    </span>
                    <span className="text-[11px] tabular text-[var(--text-tertiary)] flex-shrink-0">
                      {new Date(m.received_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                  </Link>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Deals dying quietly */}
          {stale.length > 0 && (
            <SectionCard icon={Snowflake} title="Going cold" count={stale.length} tone="text-sky-600 dark:text-sky-400" action={{ label: 'Pipeline', to: '/deals' }}>
              <div className="divide-y divide-[var(--border-subtle)]">
                {stale.map(({ deal, days }) => (
                  <Link key={deal.id} to="/deals" className="flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--bg-hover)] transition-colors">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">{deal.title}</span>
                      <span className="block text-[11px] text-[var(--text-tertiary)] truncate">
                        {[deal.company, deal.stage].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="text-[11px] text-sky-600 dark:text-sky-400 flex-shrink-0">
                      {days} days quiet
                    </span>
                  </Link>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Campaigns that stopped */}
          {needsAttention.length > 0 && (
            <SectionCard icon={Megaphone} title="Campaigns needing attention" count={needsAttention.length} tone="text-amber-600 dark:text-amber-400" action={{ label: 'Campaigns', to: '/campaigns' }}>
              <div className="divide-y divide-[var(--border-subtle)]">
                {needsAttention.map((c) => (
                  <Link key={c.id} to={`/campaigns/${c.id}`} className="flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--bg-hover)] transition-colors">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">{c.name}</span>
                      <span className="block text-[11px] text-[var(--text-tertiary)] capitalize">{c.status}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)] flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}

      <p className="text-[11.5px] text-[var(--text-tertiary)] text-center">
        Looking for funnels, leaderboards and deliverability?{' '}
        <Link to="/dashboard/overview" className="text-[var(--indigo)] hover:underline">Performance overview</Link>
      </p>

      {modalOpen && <ActivityModal task={activityModal} onClose={() => setModalOpen(false)} />}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle, CalendarClock, Flag, ListTodo, Mail, Phone, Plus, RotateCcw, Users,
} from 'lucide-react';
import { crmApi } from '../../api/crm.api';
import { usePopover } from '../../hooks/usePopover';
import { cn } from '../../lib/utils';
import { formatDayMonth, formatDayMonthTime, formatWeekdayShort, type CrmEvent, type CrmTask, type Deal, type TaskType } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   What happens next on a deal, on the card itself.

   The one rule every good pipeline teaches: an open deal always has a next
   step booked. So every card says what it is and when, turns red when it is
   late, and when there is none it says so and offers to plan one in two
   clicks, right there, without opening the deal.
   ═══════════════════════════════════════════════════════════════════════ */

export interface NextStepInfo {
  kind: 'task' | 'event';
  title: string;
  type: TaskType | 'meeting' | 'call';
  at: Date;
  /** Whole days from today: negative is late, 0 is today. */
  dayDiff: number;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The earliest open task or upcoming meeting on each deal, keyed by deal id. */
export function nextStepsByDeal(tasks: CrmTask[], events: CrmEvent[], now = new Date()): Map<string, NextStepInfo> {
  const out = new Map<string, NextStepInfo>();
  const today = startOfDay(now);
  const consider = (dealId: string | null, info: Omit<NextStepInfo, 'dayDiff'>) => {
    if (!dealId || !Number.isFinite(info.at.getTime())) return;
    const dayDiff = Math.round((startOfDay(info.at) - today) / 86_400_000);
    const prev = out.get(dealId);
    if (!prev || info.at.getTime() < prev.at.getTime()) out.set(dealId, { ...info, dayDiff });
  };
  for (const t of tasks) {
    if (t.is_done || !t.due_date) continue;
    consider(t.deal_id, { kind: 'task', title: t.title, type: t.type || 'todo', at: new Date(t.due_date) });
  }
  for (const e of events) {
    if (e.status === 'cancelled') continue;
    const at = new Date(e.starts_at);
    if (at.getTime() < now.getTime()) continue;
    consider(e.deal_id, { kind: 'event', title: e.title, type: e.type === 'call' ? 'call' : 'meeting', at });
  }
  return out;
}

const TYPE_ICON: Record<string, typeof Phone> = {
  call: Phone, email: Mail, meeting: Users, follow_up: RotateCcw, deadline: Flag, todo: ListTodo,
};

function whenLabel(info: NextStepInfo): string {
  if (info.dayDiff < 0) return `${Math.abs(info.dayDiff)}d late`;
  if (info.dayDiff === 0) return 'Today';
  if (info.dayDiff === 1) return 'Tomorrow';
  if (info.dayDiff < 7) return formatWeekdayShort(info.at);
  return formatDayMonth(info.at);
}

const QUICK_TYPES: { id: TaskType; label: string }[] = [
  { id: 'call', label: 'Call' },
  { id: 'email', label: 'Email' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'follow_up', label: 'Follow-up' },
  { id: 'todo', label: 'To-do' },
];

const QUICK_WHEN: { id: string; label: string; days: number }[] = [
  { id: 'today', label: 'Today', days: 0 },
  { id: 'tomorrow', label: 'Tomorrow', days: 1 },
  { id: '3d', label: 'In 3 days', days: 3 },
  { id: 'week', label: 'Next week', days: 7 },
];

/** 9am on the chosen day; later today if 9am has already gone. */
function dueAt(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  if (d.getTime() < Date.now()) {
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    soon.setMinutes(0, 0, 0);
    return soon.toISOString();
  }
  return d.toISOString();
}

function personName(deal: Deal): string {
  const c = deal.contact;
  const n = c ? [c.first_name, c.last_name].filter(Boolean).join(' ') : '';
  return n || deal.contact_name || deal.company || deal.title;
}

/**
 * The next-step pill on a deal card, with the quick planner behind it.
 * Closed deals show nothing: there is nothing left to plan.
 */
export function NextActivity({ deal, info, compact }: { deal: Deal; info: NextStepInfo | undefined; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { triggerProps, panelProps } = usePopover(open, () => setOpen(false));
  const btn = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  // Drawn on the page, not inside the card: a board column scrolls and
  // clips, and the card below would sit on top of anything inside this one.
  useEffect(() => {
    if (!open || !btn.current) { setPos(null); return; }
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 272));
      const roomBelow = window.innerHeight - r.bottom;
      setPos(roomBelow > 300 ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
    };
    place();
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || panelProps.ref.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', away);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', away);
    };
  }, [open, panelProps.ref]);

  const closed = deal.stage === 'won' || deal.stage === 'lost';
  if (closed) return null;

  const Icon = info ? TYPE_ICON[info.type] || ListTodo : AlertTriangle;
  const tone = !info
    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20'
    : info.dayDiff < 0
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20'
      : info.dayDiff === 0
        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
        : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]';

  return (
    <span className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        {...triggerProps}
        ref={(el) => { triggerProps.ref(el); btn.current = el; }}
        onClick={() => setOpen((v) => !v)}
        title={info ? `${info.title} - ${`${formatWeekdayShort(info.at)} ${formatDayMonthTime(info.at)}`}` : 'No next step planned. Plan one.'}
        className={cn('inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-micro font-semibold transition-colors', tone)}
      >
        <Icon className="h-3 w-3 flex-shrink-0" />
        {info ? (
          <span className="truncate">{whenLabel(info)}{!compact && <span className="font-medium opacity-80"> · {info.title}</span>}</span>
        ) : (
          <span className="truncate">{compact ? 'Plan' : 'Plan next step'}</span>
        )}
      </button>
      {open && createPortal(
        <QuickPlanner deal={deal} panelProps={panelProps} pos={pos} onDone={() => setOpen(false)} />,
        document.body,
      )}
    </span>
  );
}

function QuickPlanner({ deal, panelProps, pos, onDone }: {
  deal: Deal;
  panelProps: ReturnType<typeof usePopover>['panelProps'];
  pos: { left: number; top?: number; bottom?: number } | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<TaskType>('call');
  const [when, setWhen] = useState('tomorrow');
  const label = QUICK_TYPES.find((t) => t.id === type)?.label || 'Call';
  const [title, setTitle] = useState('');
  const placeholder = `${label} ${personName(deal)}`;

  const save = useMutation({
    mutationFn: () => crmApi.createTask({
      title: title.trim() || placeholder,
      type,
      due_date: dueAt(QUICK_WHEN.find((w) => w.id === when)?.days ?? 1),
      deal_id: deal.id,
      contact_id: deal.contact_id || deal.contact?.id || null,
      priority: 'normal',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      qc.invalidateQueries({ queryKey: ['contact-crm'] });
      toast.success('Next step planned');
      onDone();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not plan that'),
  });

  return (
    <div
      {...panelProps}
      onClick={(e) => e.stopPropagation()}
      style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom } : { visibility: 'hidden' }}
      className="fixed z-50 w-64 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-[var(--shadow-lg)]"
    >
      <p className="mb-2 flex items-center gap-1.5 text-caption font-semibold text-[var(--text-primary)]">
        <CalendarClock className="h-3.5 w-3.5 text-[var(--indigo-text)]" /> Plan the next step
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {QUICK_TYPES.map((t) => {
          const I = TYPE_ICON[t.id];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setType(t.id)}
              aria-pressed={type === t.id}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-1 text-micro font-semibold transition-colors',
                type === t.id ? 'bg-[var(--indigo)] text-white' : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <I className="h-3 w-3" />{t.label}
            </button>
          );
        })}
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1">
        {QUICK_WHEN.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setWhen(w.id)}
            aria-pressed={when === w.id}
            className={cn(
              'rounded-lg px-2 py-1 text-caption font-medium transition-colors',
              when === w.id ? 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
            )}
          >
            {w.label}
          </button>
        ))}
      </div>
      <input
        aria-label="What to do"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save.mutate(); } }}
        placeholder={placeholder}
        className="mb-2 h-8 w-full rounded-md border border-[var(--border-control)] bg-[var(--bg-app)] px-2.5 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)] focus-visible:shadow-[var(--ring-focus)]"
      />
      <button
        type="button"
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--indigo)] text-body font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <Plus className="h-3.5 w-3.5" /> {save.isPending ? 'Saving…' : 'Add to the plan'}
      </button>
    </div>
  );
}

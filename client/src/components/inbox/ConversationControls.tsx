import { useMemo, useState } from 'react';
import { AlarmClock, BellRing, Check, ChevronDown, UserPlus, X } from 'lucide-react';
import { usePopover } from '../../hooks/usePopover';
import { Avatar } from '../shared/Avatar';
import { cn } from '../../lib/utils';
import {
  NUDGE_DAY_OPTIONS, snoozePresets, formatDayMonthTime, formatWeekdayDate, formatTime,
  type InboxTeammate,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The three "deal with this later, or somebody else" controls on an open
   conversation: snooze it, be reminded if they do not answer, hand it on.

   Each is a small disclosure menu in the same pattern as the inbox's other
   dropdowns (usePopover): a button that says what it opens, a panel of
   ordinary buttons reached with Tab, Escape to close.
   ═══════════════════════════════════════════════════════════════════════ */

const PANEL = 'absolute right-0 top-full mt-1 z-50 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-default)] p-1 shadow-[var(--shadow-xl)] animate-slide-in';
const ITEM = 'w-full flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg text-body text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors';

/** A local datetime-local value an hour from now, as a sensible default. */
function defaultCustom(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Snooze: later today, tomorrow morning, next week, or a time you pick.
 * When the conversation is already snoozed the menu says until when and
 * offers to bring it back now.
 */
export function SnoozeMenu({ snoozedUntil, onSnooze, pending }: {
  snoozedUntil?: string | null;
  onSnooze: (until: string | null) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const menu = usePopover(open, () => setOpen(false));
  // Recomputed each time it opens, so "later today" is later than now.
  const presets = useMemo(() => (open ? snoozePresets(new Date()) : []), [open]);
  const asleep = !!snoozedUntil && new Date(snoozedUntil).getTime() > Date.now();

  const pick = (until: string | null) => {
    setOpen(false);
    onSnooze(until);
  };

  return (
    <div className="relative">
      <button
        type="button"
        {...menu.triggerProps}
        onClick={() => { setOpen((o) => !o); setCustom(defaultCustom()); }}
        disabled={pending}
        aria-label={asleep ? `Snoozed until ${formatDayMonthTime(new Date(snoozedUntil!))}` : 'Snooze'}
        title={asleep ? `Snoozed until ${formatDayMonthTime(new Date(snoozedUntil!))}` : 'Snooze - hide until later'}
        className={cn('icon-btn h-8 w-8 disabled:opacity-40', asleep && 'text-[var(--indigo-text)] bg-[var(--indigo-subtle)]')}
      >
        <AlarmClock className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setOpen(false)} />
          <div {...menu.panelProps} className={cn(PANEL, 'w-64')}>
            <p className="px-2.5 pt-1.5 pb-1 text-micro font-semibold text-[var(--text-tertiary)]">
              {asleep ? `Snoozed until ${formatDayMonthTime(new Date(snoozedUntil!))}` : 'Snooze until'}
            </p>
            {asleep && (
              <button type="button" className={ITEM} onClick={() => pick(null)}>
                Bring it back now
              </button>
            )}
            {presets.map((p) => (
              <button key={p.id} type="button" className={ITEM} onClick={() => pick(p.at.toISOString())}>
                <span>{p.label}</span>
                <span className="text-caption tabular text-[var(--text-tertiary)]">
                  {p.id === 'later_today' ? formatTime(p.at) : `${formatWeekdayDate(p.at)}, ${formatTime(p.at)}`}
                </span>
              </button>
            ))}
            <form
              className="mt-1 border-t border-[var(--border-subtle)] px-2.5 pt-2 pb-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const at = custom ? new Date(custom) : null;
                if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return;
                pick(at.toISOString());
              }}
            >
              <label htmlFor="snooze-custom" className="block text-micro font-semibold text-[var(--text-tertiary)]">Pick a date and time</label>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  id="snooze-custom"
                  type="datetime-local"
                  value={custom}
                  min={defaultCustom().slice(0, 16)}
                  onChange={(e) => setCustom(e.target.value)}
                  className="min-w-0 flex-1 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-caption text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
                />
                <button
                  type="submit"
                  disabled={!custom || new Date(custom).getTime() <= Date.now()}
                  className="h-8 px-2.5 rounded-lg bg-[var(--indigo)] text-white text-caption font-semibold hover:bg-[var(--indigo-hover)] disabled:opacity-40"
                >
                  Snooze
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * "Remind me if no reply in N days" - a plain select for the composer,
 * where it is one more setting on the thing being sent.
 */
export function NudgeSelect({ value, onChange, disabled }: {
  value: number | null;
  onChange: (days: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-1.5 h-9 px-2 rounded-lg border text-caption font-medium transition-colors',
        value ? 'border-[rgba(47,63,156,0.3)] bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' : 'border-[var(--border-subtle)] text-[var(--text-tertiary)]',
        disabled && 'opacity-40',
      )}
      title="If they have not replied by then, the conversation comes back to the top of your inbox marked 'No reply yet'."
    >
      <BellRing className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <span className="sr-only">Remind me if no reply</span>
      <select
        aria-label="Remind me if no reply"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="bg-transparent outline-none cursor-pointer"
      >
        <option value="">No reminder</option>
        {NUDGE_DAY_OPTIONS.map((d) => (
          <option key={d} value={d}>{`If no reply in ${d} day${d === 1 ? '' : 's'}`}</option>
        ))}
      </select>
    </label>
  );
}

/**
 * The same reminder on a message already sent: shown on the open
 * conversation when the last word was ours.
 */
export function NudgeMenu({ nudgeAt, fired, onSet, pending }: {
  nudgeAt?: string | null;
  fired?: boolean;
  onSet: (days: number | null) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menu = usePopover(open, () => setOpen(false));
  const waiting = !!nudgeAt && !fired;
  const label = fired
    ? 'No reply yet'
    : waiting ? `Reminder ${formatDayMonthTime(new Date(nudgeAt!))}` : 'Remind me if no reply';
  return (
    <div className="relative">
      <button
        type="button"
        {...menu.triggerProps}
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        aria-label={label}
        title={label}
        className={cn('icon-btn h-8 w-8 disabled:opacity-40', (waiting || fired) && 'text-[var(--indigo-text)] bg-[var(--indigo-subtle)]')}
      >
        <BellRing className="h-4 w-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setOpen(false)} />
          <div {...menu.panelProps} className={cn(PANEL, 'w-60')}>
            <p className="px-2.5 pt-1.5 pb-1 text-micro font-semibold text-[var(--text-tertiary)]">{waiting ? label : 'Remind me if they have not replied in'}</p>
            {NUDGE_DAY_OPTIONS.map((d) => (
              <button key={d} type="button" className={ITEM} onClick={() => { setOpen(false); onSet(d); }}>
                {d} day{d === 1 ? '' : 's'}
              </button>
            ))}
            {(waiting || fired) && (
              <button type="button" className={cn(ITEM, 'border-t border-[var(--border-subtle)] mt-1 rounded-t-none')} onClick={() => { setOpen(false); onSet(null); }}>
                <span className="inline-flex items-center gap-1.5"><X className="h-3.5 w-3.5" /> {fired ? 'Dismiss' : 'Cancel reminder'}</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Initials for whoever a conversation is assigned to, on a list row. */
export function AssigneeBadge({ email, me }: { email: string; me?: boolean }) {
  return (
    <span title={me ? 'Assigned to you' : `Assigned to ${email}`} className="inline-flex flex-shrink-0">
      <Avatar name={email.split('@')[0]} email={email} size="xs" />
    </span>
  );
}

/** Hand the conversation to a teammate, or take it back. */
export function AssignMenu({ teammates, assignedTo, onAssign, pending }: {
  teammates: InboxTeammate[];
  assignedTo?: string | null;
  onAssign: (userId: string | null) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menu = usePopover(open, () => setOpen(false));
  const current = teammates.find((t) => t.user_id === assignedTo) || null;
  const who = current ? (current.is_me ? 'you' : current.email) : null;

  return (
    <div className="relative">
      <button
        type="button"
        {...menu.triggerProps}
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        title={who ? `Assigned to ${who}` : 'Assign to a teammate'}
        className="flex items-center gap-1.5 h-8 pl-1.5 pr-2 rounded-lg text-body font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
      >
        {current
          ? <Avatar name={current.email.split('@')[0]} email={current.email} size="xs" />
          : <UserPlus className="h-4 w-4" />}
        <span className="hidden 2xl:inline max-w-[120px] truncate">{current ? (current.is_me ? 'You' : current.email.split('@')[0]) : 'Assign'}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setOpen(false)} />
          <div {...menu.panelProps} className={cn(PANEL, 'w-64')}>
            <p className="px-2.5 pt-1.5 pb-1 text-micro font-semibold text-[var(--text-tertiary)]">Assign to</p>
            {teammates.map((t) => (
              <button
                key={t.user_id}
                type="button"
                className={cn(ITEM, t.user_id === assignedTo && 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]')}
                onClick={() => { setOpen(false); if (t.user_id !== assignedTo) onAssign(t.user_id); }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={t.email.split('@')[0]} email={t.email} size="xs" />
                  <span className="truncate">{t.is_me ? `${t.email} (you)` : t.email}</span>
                </span>
                {t.user_id === assignedTo && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
              </button>
            ))}
            {assignedTo && (
              <button type="button" className={cn(ITEM, 'border-t border-[var(--border-subtle)] mt-1 rounded-t-none')} onClick={() => { setOpen(false); onAssign(null); }}>
                <span className="inline-flex items-center gap-1.5"><X className="h-3.5 w-3.5" /> Unassign</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

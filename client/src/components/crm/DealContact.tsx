import { MessagesSquare, Reply, Send, CalendarCheck, Phone, UserX } from 'lucide-react';
import {
  agoLabel, dealContactShort, DEAL_CONTACT_COOLING_DAYS, DEAL_CONTACT_QUIET_DAYS,
  type DealContactActivity, type DealContactPace, type DealPersonContact,
} from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   When we last spoke to anyone on the deal.

   On the card, one short line coloured by how long it has been. On the
   deal, the full read: the last touch and who with, the last time anybody
   on their side wrote back, who holds the ball, and how many of the people
   on the deal are actually talking to us.
   ═══════════════════════════════════════════════════════════════════════ */

export const PACE_STYLE: Record<DealContactPace, { dot: string; text: string; label: string }> = {
  fresh: { dot: 'bg-emerald-500', text: 'text-[var(--text-tertiary)]', label: `In touch this week` },
  cooling: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', label: `Cooling: ${DEAL_CONTACT_COOLING_DAYS}+ days since the last touch` },
  quiet: { dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', label: `Gone quiet: ${DEAL_CONTACT_QUIET_DAYS}+ days since anyone spoke` },
  never: { dot: 'bg-[var(--text-tertiary)]', text: 'text-[var(--text-tertiary)]', label: 'Nobody on the deal has been contacted' },
};

function kindIcon(a: DealContactActivity) {
  if (!a.last) return UserX;
  if (a.last.kind === 'meeting') return CalendarCheck;
  if (a.last.kind === 'call') return Phone;
  return a.last.by === 'them' ? Reply : Send;
}

/** One line for a deal card. */
export function DealContactLine({ activity, className }: { activity?: DealContactActivity | null; className?: string }) {
  if (!activity) return null;
  const s = PACE_STYLE[activity.pace];
  const Icon = kindIcon(activity);
  const waiting = activity.ball === 'you' && activity.last?.by === 'them';
  return (
    <span
      data-deal-contact={activity.pace}
      title={`${activity.sentence}. ${s.label}.`}
      className={cn('inline-flex min-w-0 items-center gap-1 text-micro', s.text, activity.pace !== 'fresh' && 'font-medium', className)}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">{dealContactShort(activity)}</span>
      {waiting && activity.pace === 'fresh' && <span className="flex-shrink-0 font-semibold text-[var(--indigo-text)]">· your turn</span>}
    </span>
  );
}

/** For a table cell: "3d ago" with the full sentence on hover. */
export function DealContactCell({ activity }: { activity?: DealContactActivity | null }) {
  if (!activity) return <span className="text-[var(--text-tertiary)]">-</span>;
  const s = PACE_STYLE[activity.pace];
  return (
    <span title={activity.sentence} className={cn('inline-flex items-center gap-1.5', s.text, activity.pace !== 'fresh' && 'font-medium')}>
      <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', s.dot)} aria-hidden="true" />
      {activity.last ? agoLabel(activity.days_since) : 'Never'}
    </span>
  );
}

/** The per-person line under somebody in the People panel. */
export function PersonContactLine({ person }: { person?: DealPersonContact | null }) {
  if (!person) return null;
  const s = PACE_STYLE[person.pace];
  return (
    <span className={cn('flex items-center gap-1 truncate text-micro', s.text)} data-person-contact={person.pace}>
      <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', s.dot)} aria-hidden="true" />
      <span className="truncate">{person.line}</span>
    </span>
  );
}

/** The full read for the deal page. */
export function DealContactPanel({ activity, open, onWrite }: {
  activity: DealContactActivity;
  open: boolean;
  /** Write to this address in the deal's composer. */
  onWrite?: (email: string, name: string) => void;
}) {
  const s = PACE_STYLE[activity.pace];
  const Icon = kindIcon(activity);
  const waitingOn = activity.ball === 'you' && activity.last?.by === 'them' ? activity.people.find((p) => p.email === activity.last?.email) : null;
  // The one person worth chasing: someone who matters and has gone longest without a word.
  const forgotten = open
    ? activity.people
      .filter((p) => (p.role === 'Decision maker' || p.primary) && (p.pace === 'quiet' || p.pace === 'never'))
      .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity))[0]
    : null;

  return (
    <div className="record-section" data-deal-contact-panel>
      <div className="mb-2 flex items-center gap-2">
        <MessagesSquare className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <p className="text-caption font-medium text-[var(--text-tertiary)]">Last contact</p>
        <span className="flex-1" />
        {open && (
          <span className={cn('inline-flex items-center gap-1 text-micro font-semibold', s.text)} title={s.label}>
            <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden="true" />
            {activity.pace === 'fresh' ? 'In touch' : activity.pace === 'cooling' ? 'Cooling' : activity.pace === 'quiet' ? 'Gone quiet' : 'No contact'}
          </span>
        )}
      </div>

      <p className="flex items-start gap-2 text-body font-medium text-[var(--text-primary)]">
        <Icon className={cn('mt-0.5 h-4 w-4 flex-shrink-0', open ? s.text : 'text-[var(--text-tertiary)]')} />
        <span>{activity.sentence}.</span>
      </p>

      <dl className="mt-2.5 grid grid-cols-3 gap-2 text-caption">
        <div className="min-w-0">
          <dt className="text-[var(--text-tertiary)]">Heard from them</dt>
          <dd className="truncate font-medium text-[var(--text-primary)]" title={activity.last_heard?.name || undefined}>
            {activity.last_heard ? agoLabel(activity.days_since_heard) : 'Not yet'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[var(--text-tertiary)]">Next move</dt>
          <dd className={cn('truncate font-medium', activity.ball === 'you' ? 'text-[var(--indigo-text)]' : 'text-[var(--text-primary)]')}>
            {activity.ball === 'you' ? 'Yours' : activity.ball === 'them' ? 'Theirs' : '-'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[var(--text-tertiary)]">Talking</dt>
          <dd className="truncate font-medium tabular-nums text-[var(--text-primary)]" title="People on the deal who have written back or met you">
            {activity.engaged} of {activity.total}
          </dd>
        </div>
      </dl>

      {open && waitingOn && onWrite && (
        <button
          type="button"
          onClick={() => onWrite(waitingOn.email, waitingOn.name)}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-[var(--indigo-subtle)] px-2.5 py-1.5 text-caption font-semibold text-[var(--indigo-text)] transition-colors hover:opacity-90"
        >
          <Reply className="h-3.5 w-3.5" /> Reply to {waitingOn.name.split(/\s+/)[0]}
        </button>
      )}

      {forgotten && !(waitingOn && waitingOn.email === forgotten.email) && (
        <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-amber-500/10 px-2 py-1.5 text-caption text-amber-700 dark:text-amber-400">
          <span>
            {forgotten.role === 'Decision maker' ? 'The decision maker' : 'The main contact'}, {forgotten.name},{' '}
            {forgotten.last_at ? `was last in touch ${agoLabel(forgotten.days)}` : 'has not been contacted'}.
          </span>
          {onWrite && (
            <button type="button" onClick={() => onWrite(forgotten.email, forgotten.name)} className="font-semibold underline-offset-2 hover:underline">
              Write to them
            </button>
          )}
        </p>
      )}
    </div>
  );
}

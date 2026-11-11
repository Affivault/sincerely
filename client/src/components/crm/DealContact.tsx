import { MessagesSquare, Reply, Send, CalendarCheck, Phone, UserX, Crown, Mail } from 'lucide-react';
import { Avatar } from '../shared/Avatar';
import {
  agoLabel, agoShort, dealContactShort, DEAL_CONTACT_COOLING_DAYS, DEAL_CONTACT_QUIET_DAYS, RHYTHM_DAYS,
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

export const PACE_STYLE: Record<DealContactPace, { dot: string; text: string; tint: string; bar: string; name: string; label: string }> = {
  fresh: {
    dot: 'bg-emerald-500', text: 'text-[var(--text-tertiary)]', tint: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    bar: 'bg-emerald-500', name: 'In touch', label: 'In touch this week',
  },
  cooling: {
    dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', tint: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    bar: 'bg-amber-500', name: 'Cooling', label: `Cooling: ${DEAL_CONTACT_COOLING_DAYS}+ days since the last touch`,
  },
  quiet: {
    dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', tint: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    bar: 'bg-rose-500', name: 'Gone quiet', label: `Gone quiet: ${DEAL_CONTACT_QUIET_DAYS}+ days since anyone spoke`,
  },
  never: {
    dot: 'bg-[var(--text-tertiary)]', text: 'text-[var(--text-tertiary)]', tint: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
    bar: 'bg-[var(--border-default)]', name: 'No contact', label: 'Nobody on the deal has been contacted',
  },
};

function kindIcon(a: DealContactActivity) {
  if (!a.last) return UserX;
  if (a.last.kind === 'meeting') return CalendarCheck;
  if (a.last.kind === 'call') return Phone;
  return a.last.by === 'them' ? Reply : Send;
}

/** One line for a deal card: a quiet line while fresh, a tinted pill once it cools. */
export function DealContactLine({ activity, className }: { activity?: DealContactActivity | null; className?: string }) {
  if (!activity) return null;
  const s = PACE_STYLE[activity.pace];
  const Icon = kindIcon(activity);
  const waiting = activity.ball === 'you' && activity.last?.by === 'them';
  const loud = activity.pace === 'cooling' || activity.pace === 'quiet';
  return (
    <span
      data-deal-contact={activity.pace}
      title={`${activity.sentence}. ${s.label}.`}
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1 text-micro',
        loud ? cn('rounded-full px-1.5 py-0.5 font-medium', s.tint) : s.text,
        className,
      )}
    >
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">{dealContactShort(activity)}</span>
      {waiting && !loud && (
        <span className="flex-shrink-0 rounded-full bg-[var(--indigo-subtle)] px-1.5 font-semibold text-[var(--indigo-text)]">Your turn</span>
      )}
    </span>
  );
}

/** For a table cell: "3 days ago" with the full sentence on hover. */
export function DealContactCell({ activity }: { activity?: DealContactActivity | null }) {
  if (!activity) return <span className="text-[var(--text-tertiary)]">-</span>;
  const s = PACE_STYLE[activity.pace];
  const waiting = activity.ball === 'you' && activity.last?.by === 'them';
  return (
    <span title={activity.sentence} className={cn('inline-flex items-center gap-1.5', s.text, activity.pace !== 'fresh' && 'font-medium')}>
      <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', s.dot)} aria-hidden="true" />
      {activity.last ? agoLabel(activity.days_since) : 'Never'}
      {waiting && <Reply className="h-3 w-3 text-[var(--indigo-text)]" aria-label="They are waiting on you" />}
    </span>
  );
}

/* ── The deal page ────────────────────────────────────────────────────── */

const RHYTHM_TONE = { in: 'bg-emerald-500', out: 'bg-[var(--indigo)]', met: 'bg-amber-500' } as const;

/**
 * Four weeks of back and forth, a column a day, today on the right. Ours
 * stack in ink, theirs in green, meetings in amber: a deal that is alive
 * looks like a conversation; one that is dying looks like a row of ink
 * dots and then nothing.
 */
function Rhythm({ rhythm }: { rhythm: DealContactActivity['rhythm'] }) {
  const days = Array.from({ length: RHYTHM_DAYS }, (_, i) => RHYTHM_DAYS - 1 - i);
  const byDay = new Map<number, Array<'in' | 'out' | 'met'>>();
  for (const t of rhythm) byDay.set(t.days_ago, [...(byDay.get(t.days_ago) || []), t.kind]);
  const counts = { in: 0, out: 0, met: 0 };
  for (const t of rhythm) counts[t.kind]++;
  return (
    <div data-deal-rhythm>
      <div className="flex h-7 items-end gap-0.5 border-b border-[var(--border-default)] pb-1" role="img" aria-label={`Last ${RHYTHM_DAYS} days: ${counts.out} sent, ${counts.in} received, ${counts.met} meetings`}>
        {days.map((d) => {
          const marks = (byDay.get(d) || []).slice(0, 3);
          return (
            <div
              key={d}
              className="flex h-full flex-1 flex-col-reverse items-center gap-0.5"
              title={marks.length ? `${agoLabel(d)}: ${marks.map((k) => (k === 'in' ? 'they wrote' : k === 'out' ? 'you wrote' : 'meeting')).join(', ')}` : undefined}
            >
              {marks.map((k, i) => <span key={i} className={cn('h-1.5 w-1.5 rounded-full', RHYTHM_TONE[k])} />)}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-between text-micro text-[var(--text-tertiary)]">
        <span>4 weeks ago</span>
        <span className="flex items-center gap-2.5">
          <Legend tone={RHYTHM_TONE.out} label={`You ${counts.out}`} />
          <Legend tone={RHYTHM_TONE.in} label={`Them ${counts.in}`} />
          {counts.met > 0 && <Legend tone={RHYTHM_TONE.met} label={`Met ${counts.met}`} />}
        </span>
        <span>Today</span>
      </div>
    </div>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span className={cn('h-1.5 w-1.5 rounded-full', tone)} aria-hidden="true" />{label}
    </span>
  );
}

function Fact({ label, value, tone, title }: { label: string; value: string; tone?: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-[var(--bg-elevated)] px-2.5 py-2" title={title}>
      <p className="truncate text-micro text-[var(--text-tertiary)]">{label}</p>
      <p className={cn('mt-0.5 truncate text-body font-semibold tabular-nums', tone || 'text-[var(--text-primary)]')}>{value}</p>
    </div>
  );
}

/** Freshness as a bar: full today, empty at four weeks. */
function Recency({ person }: { person: DealPersonContact }) {
  const s = PACE_STYLE[person.pace];
  const fill = person.days === null ? 0 : Math.max(0.08, 1 - person.days / RHYTHM_DAYS);
  return (
    <span className="flex w-14 flex-shrink-0 flex-col items-end gap-1">
      <span className={cn('text-micro font-semibold tabular-nums', person.pace === 'fresh' ? 'text-[var(--text-secondary)]' : s.text)}>
        {person.days === null ? 'Never' : agoShort(person.days)}
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]" aria-hidden="true">
        <span className={cn('block h-full rounded-full', s.bar)} style={{ width: `${Math.round(fill * 100)}%` }} />
      </span>
    </span>
  );
}

function PersonRow({ person, onWrite }: { person: DealPersonContact; onWrite?: (email: string, name: string) => void }) {
  const s = PACE_STYLE[person.pace];
  return (
    <li className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-[var(--bg-hover)]" data-person-contact={person.pace}>
      <span className="relative flex-shrink-0">
        <Avatar name={person.name} email={person.email} size="sm" />
        <span className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--bg-surface)]', s.dot)} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-body font-medium text-[var(--text-primary)]">{person.name}</span>
          {person.primary && <Crown className="h-3 w-3 flex-shrink-0 text-amber-500" aria-label="Main contact" />}
          {person.role && (
            <span className="flex-shrink-0 rounded-full bg-[var(--bg-elevated)] px-1.5 text-micro font-medium text-[var(--text-tertiary)]">{person.role}</span>
          )}
        </span>
        <span className={cn('block truncate text-micro', person.pace === 'fresh' ? 'text-[var(--text-tertiary)]' : s.text)}>{person.line}</span>
      </span>
      {onWrite && (
        <button
          type="button"
          onClick={() => onWrite(person.email, person.name)}
          className="icon-btn h-6 w-6 flex-shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          title={`Write to ${person.name}`}
          aria-label={`Write to ${person.name}`}
        >
          <Mail className="h-3.5 w-3.5" />
        </button>
      )}
      <Recency person={person} />
    </li>
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
  const lastPerson = activity.last?.email ? activity.people.find((p) => p.email === activity.last?.email) : null;
  const waitingOn = activity.ball === 'you' && activity.last?.by === 'them' ? lastPerson : null;
  // The one person worth chasing: someone who matters and has gone longest without a word.
  const forgotten = open
    ? activity.people
      .filter((p) => (p.role === 'Decision maker' || p.primary) && (p.pace === 'quiet' || p.pace === 'never'))
      .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity))[0]
    : null;
  const anyRhythm = activity.rhythm.length > 0;

  return (
    <div className="record-section" data-deal-contact-panel>
      <div className="mb-3 flex items-center gap-2">
        <MessagesSquare className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <p className="text-caption font-medium text-[var(--text-tertiary)]">Last contact</p>
        <span className="flex-1" />
        {open && (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold', s.tint)} title={s.label}>
            <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden="true" />
            {s.name}
          </span>
        )}
      </div>

      {/* The headline: who, what, when. */}
      <div className="flex items-start gap-3">
        {lastPerson ? (
          <span className="relative flex-shrink-0">
            <Avatar name={lastPerson.name} email={lastPerson.email} size="md" />
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
              <Icon className={cn('h-2.5 w-2.5', activity.last?.by === 'them' ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--indigo-text)]')} />
            </span>
          </span>
        ) : (
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)]">
            <Icon className="h-4 w-4 text-[var(--text-tertiary)]" />
          </span>
        )}
        <p className="min-w-0 pt-0.5 text-strong font-semibold leading-snug text-[var(--text-primary)]">{activity.sentence}</p>
      </div>

      {waitingOn && open && onWrite && (
        <button
          type="button"
          onClick={() => onWrite(waitingOn.email, waitingOn.name)}
          className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--indigo)] text-caption font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Reply className="h-3.5 w-3.5" /> Reply to {waitingOn.name.split(/\s+/)[0]}
        </button>
      )}

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <Fact label="Heard from them" value={activity.last_heard ? agoLabel(activity.days_since_heard) : 'Not yet'} title={activity.last_heard?.name || undefined} />
        <Fact
          label="Next move"
          value={activity.ball === 'you' ? 'Yours' : activity.ball === 'them' ? 'Theirs' : '-'}
          tone={activity.ball === 'you' ? 'text-[var(--indigo-text)]' : undefined}
        />
        <Fact label="Talking" value={`${activity.engaged} of ${activity.total}`} title="People on the deal who have written back or met you" />
      </div>

      {anyRhythm && <div className="mt-3.5"><Rhythm rhythm={activity.rhythm} /></div>}

      {activity.people.length > 0 && (
        <ul className="-mx-1.5 mt-3 space-y-0.5 border-t border-[var(--border-subtle)] pt-2">
          {activity.people.map((p) => <PersonRow key={p.email} person={p} onWrite={onWrite} />)}
        </ul>
      )}

      {forgotten && !(waitingOn && waitingOn.email === forgotten.email) && (
        <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-amber-500/10 px-2.5 py-2 text-caption text-amber-700 dark:text-amber-400">
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

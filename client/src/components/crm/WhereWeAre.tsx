import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Clock, Handshake, CalendarClock, Megaphone, Hourglass, Plane } from 'lucide-react';
import { awayLabel, whereWeAre, dealStageLabel, formatMoney, formatDayMonth, formatWeekdayShort, formatTime } from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';
import { cn, formatRelativeTime } from '../../lib/utils';

/**
 * "Where are we with this person?" - answered before the page is read.
 *
 * Four facts: the last thing that happened and who did it, the deal and
 * how long it has sat there, what happens next, and what started it all.
 * Plus one warning, only when it applies: they answered, and nothing has
 * happened since. Replaces a strip of counts - received, opens - that
 * described the relationship without saying where it stood.
 */
export function WhereWeAre({ contactId, emails, activity, onBookMeeting, onNewDeal, away }: {
  contactId: string;
  /** From an out-of-office (shared/away): when the next email may go, and the date they gave. */
  away?: { until: string | null; returnsOn: string | null; note: string | null };
  emails: any[];
  activity: any[];
  onBookMeeting: () => void;
  onNewDeal: () => void;
}) {
  // Same key as the history below it, so this is one request, not two.
  const { data: summary } = useQuery({
    queryKey: ['contact-crm', contactId],
    queryFn: () => crmApi.contactSummary(contactId),
    enabled: !!contactId,
  });

  const w = whereWeAre({
    emails,
    activity,
    deals: (summary?.deals || []) as any,
    tasks: (summary?.tasks || []) as any,
    events: (summary?.events || []) as any,
  });

  const nextAt = w.next_step?.at ? new Date(w.next_step.at) : null;
  const awayNote = awayLabel(away?.until, away?.returnsOn);

  return (
    <div className="space-y-2" data-where-we-are>
      {awayNote && (
        <div className="flex items-start gap-2 rounded-xl border border-sky-500/25 bg-sky-500/8 px-3.5 py-2.5 text-body text-sky-800 dark:text-sky-300" data-away>
          <Plane className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            {awayNote}.{away?.note ? <span className="text-sky-700/80 dark:text-sky-300/80"> They said: "{away.note}"</span> : null}
          </span>
        </div>
      )}
      {w.quiet_days !== null && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5 text-body text-amber-800 dark:text-amber-300">
          <Hourglass className="h-4 w-4 flex-shrink-0" />
          <span>
            They replied {w.quiet_days} days ago and nothing has happened since - no answer, no meeting, no next step.
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact icon={Clock} label="Last touch">
          {w.last_touch ? (
            <>
              <Value>{w.last_touch.by === 'them' ? 'They replied' : `You ${w.last_touch.what}`}</Value>
              <Sub>{formatRelativeTime(w.last_touch.at)}{w.last_reply && w.last_touch.by === 'you' ? ` · last reply ${formatRelativeTime(w.last_reply.at)}` : ''}</Sub>
            </>
          ) : (
            <><Value muted>Nothing yet</Value><Sub>No emails either way</Sub></>
          )}
        </Fact>

        <Fact icon={Handshake} label="Deal">
          {w.deal ? (
            <>
              <Value>
                <Link to={`/deals/${w.deal.id}`} className="hover:text-[var(--indigo)] hover:underline">
                  {dealStageLabel(w.deal.stage)}{w.deal.value ? ` · ${formatMoney(w.deal.value, w.deal.currency, { compact: true })}` : ''}
                </Link>
              </Value>
              <Sub>
                {w.deal.open
                  ? (w.deal.days_in_stage !== null ? `${w.deal.days_in_stage === 0 ? 'Moved there today' : `${w.deal.days_in_stage} day${w.deal.days_in_stage === 1 ? '' : 's'} in this stage`}` : w.deal.title)
                  : w.deal.title}
              </Sub>
            </>
          ) : (
            <>
              <Value muted>No deal</Value>
              <button onClick={onNewDeal} className="mt-1.5 text-caption font-semibold text-[var(--indigo)] hover:underline">Open one</button>
            </>
          )}
        </Fact>

        <Fact icon={CalendarClock} label="Next step">
          {w.next_step ? (
            <>
              <Value>{w.next_step.what}</Value>
              {nextAt && w.next_step.kind === 'task' && nextAt.getTime() < Date.now() ? (
                // Overdue is the one thing on this strip that needs doing now.
                <p className="mt-0.5 truncate text-caption font-medium text-rose-600 dark:text-rose-400">
                  Overdue - was due {formatWeekdayShort(nextAt)} {formatDayMonth(nextAt)}
                </p>
              ) : (
                <Sub>
                  {nextAt
                    ? `${w.next_step.kind === 'meeting' ? 'Meeting' : 'Due'} ${formatWeekdayShort(nextAt)} ${formatDayMonth(nextAt)}${w.next_step.kind === 'meeting' ? `, ${formatTime(nextAt)}` : ''}`
                    : 'No date set'}
                </Sub>
              )}
            </>
          ) : (
            <>
              <Value muted>Nothing planned</Value>
              <button onClick={onBookMeeting} className="mt-1.5 text-caption font-semibold text-[var(--indigo)] hover:underline">Book a meeting</button>
            </>
          )}
        </Fact>

        <Fact icon={Megaphone} label="Started from">
          {w.started_from ? (
            <>
              <Value>{w.started_from.campaign}</Value>
              <Sub>First email {formatDayMonth(new Date(w.started_from.at))}</Sub>
            </>
          ) : (
            <><Value muted>Not from a campaign</Value><Sub>Added directly</Sub></>
          )}
        </Fact>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="card px-3.5 py-3 min-w-0">
      <p className="flex items-center gap-1.5 text-caption font-medium text-[var(--text-tertiary)]">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <div className="mt-1.5 min-w-0">{children}</div>
    </div>
  );
}

function Value({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <p className={cn('truncate text-strong font-semibold', muted ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]')}>
      {children}
    </p>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 truncate text-caption text-[var(--text-tertiary)]">{children}</p>;
}

import { useQuery } from '@tanstack/react-query';
import { DEAL_STAGES, stageTimeline } from '@lemlist/shared';
import type { Deal, DealStage, StageLeg } from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   How this deal got here.

   "Stalled 40 days in Proposal" is a fact. What to do about it depends
   entirely on the shape of the path behind it: a deal that took a quarter
   to walk Lead -> Qualified -> Proposal is being worked slowly, and one
   that was dropped straight into Proposal on day one and never touched
   again was never really qualified at all. The board showed neither.

   Deliberately quiet about what it does not know. Deals that existed
   before the history table did have exactly one recorded event, and this
   says so rather than drawing a confident single-step journey that would
   read as "this deal has never moved".
   ═══════════════════════════════════════════════════════════════════════ */

const DOT: Record<DealStage, string> = {
  lead: 'bg-slate-400',
  qualified: 'bg-[var(--indigo)]',
  proposal: 'bg-amber-500',
  won: 'bg-emerald-500',
  lost: 'bg-rose-500',
};

function label(stage: DealStage): string {
  return DEAL_STAGES.find((s) => s.id === stage)?.label || stage;
}

/** "4 days", "1 day", "today" - a duration a person would say out loud. */
function spell(days: number): string {
  if (days <= 0) return 'less than a day';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? 'about a month' : `about ${months} months`;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function Leg({ leg, first }: { leg: StageLeg; first: boolean }) {
  return (
    <li className="group relative flex gap-2.5 pb-3 last:pb-0">
      {/* The rail, drawn behind the dot and stopped on the last leg so it
          does not trail off into nothing. */}
      <span
        aria-hidden
        className="absolute bottom-0 left-[3.5px] top-3 w-px bg-[var(--border-subtle)] group-last:hidden"
      />
      <span className={cn('relative z-10 mt-[5px] h-2 w-2 flex-shrink-0 rounded-full', DOT[leg.stage])} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-[12.5px]">
          <span className="font-medium text-[var(--text-primary)]">{label(leg.stage)}</span>
          <span className={cn('text-[11.5px]', leg.current ? 'font-medium text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]')}>
            {leg.current ? `${spell(leg.days)} so far` : spell(leg.days)}
          </span>
        </p>
        {/* "Since" rather than "Created" on the opening leg: for a deal that
            predates the history table, that first row is the backfilled one
            and its date is when the stage was last known to change, which is
            not the same thing as when the deal was created. */}
        <p className="text-[11px] text-[var(--text-muted)]">
          {first ? 'Since' : 'Moved'} {when(leg.enteredAt)}
          {leg.reason ? ` · ${leg.reason}` : ''}
        </p>
      </div>
    </li>
  );
}

export function DealJourney({ deal }: { deal: Deal }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['crm', 'deal-history', deal.id],
    queryFn: () => crmApi.dealHistory(deal.id),
    // The history only changes when the deal moves, and moving the deal
    // invalidates the whole 'crm' key anyway.
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="flex justify-center py-3"><Spinner size="sm" /></div>;
  }
  if (isError) {
    return <p className="py-1 text-[12px] text-[var(--text-muted)]">Could not load this deal&rsquo;s history.</p>;
  }

  const legs = stageTimeline(data || []);
  if (legs.length === 0) {
    return (
      <p className="py-1 text-[12px] text-[var(--text-muted)]">
        No movement recorded yet. Every stage change from here on will show up.
      </p>
    );
  }

  const total = legs.reduce((n, l) => n + l.days, 0);

  return (
    <div>
      <ol className="mt-0.5">
        {legs.map((leg, i) => (
          <Leg key={`${leg.stage}-${leg.enteredAt}`} leg={leg} first={i === 0} />
        ))}
      </ol>
      {legs.length === 1 ? (
        /*
         * One leg means one of two things and it matters which: a deal
         * created after the history started that has genuinely never moved,
         * or an older deal whose earlier moves were never recorded. Saying
         * "open <n> days" is true either way.
         */
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          {spell(total)} in this stage. Nothing earlier was recorded.
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
          {legs.length - 1} move{legs.length - 1 === 1 ? '' : 's'} over {spell(total)}.
        </p>
      )}
    </div>
  );
}

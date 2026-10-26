import { useQuery } from '@tanstack/react-query';
import { Flame } from 'lucide-react';
import {
  describeEngagement, engagementBand, formatDate,
  type StoredEngagementFactors, type EngagementFactor,
} from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { AsyncPanel } from '../ui/AsyncPanel';
import { TONE, type Tone } from '../ui/tone';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   The engagement score, as a list cell and as a panel with its reasons.

   The number is computed on the server from shared/engagement. The list
   shows what was last stored; the contact page asks for it fresh, because
   that is where somebody wants to know why, and a stale "why" is worse
   than none.
   ═══════════════════════════════════════════════════════════════════════ */

type Band = ReturnType<typeof engagementBand>;

const BAND_TONE: Record<Band, Tone> = {
  hot: 'positive', warm: 'attention', cool: 'info', cold: 'neutral',
};

const BAND_WORD: Record<Band, string> = {
  hot: 'Hot', warm: 'Warm', cool: 'Cooling', cold: 'Cold',
};

/** The stored counts, in the shape describeEngagement reads. */
function factorsFrom(stored: StoredEngagementFactors | null | undefined): EngagementFactor[] {
  if (!stored) return [];
  const rows: [EngagementFactor['kind'], number][] = [
    ['reply', stored.replies], ['meeting', stored.meetings], ['click', stored.clicks], ['open', stored.opens],
  ];
  return rows.filter(([, n]) => n > 0).map(([kind, count]) => ({ kind, count, points: 0 }));
}

/** The list cell: a number and a bar, with the counts on hover. */
export function EngagementCell({ score, factors }: { score?: number | null; factors?: StoredEngagementFactors | null }) {
  if (score === null || score === undefined) {
    return <span className="text-caption text-[var(--text-tertiary)]" title="Not scored yet. Scores update every few hours.">-</span>;
  }
  const tone = TONE[BAND_TONE[engagementBand(score)]];
  const parts = factorsFrom(factors).map((f) => `${f.count} ${f.kind}${f.count === 1 ? '' : 's'}`).join(', ');
  return (
    <span className="flex items-center gap-2 min-w-0" title={parts ? `From ${parts} in the last six months` : 'Nothing in the last six months'}>
      <span className="w-6 text-right text-caption font-semibold tabular-nums text-[var(--text-primary)]">{score}</span>
      <span className="relative h-1.5 w-14 flex-shrink-0 overflow-hidden rounded-full bg-[var(--bg-muted)]" aria-hidden>
        <span className={cn('absolute inset-y-0 left-0 rounded-full', tone.solid)} style={{ width: `${Math.max(4, score)}%` }} />
      </span>
    </span>
  );
}

/** The contact page: the score, its band, and what it is made of. */
export function EngagementPanel({ contactId }: { contactId: string }) {
  const q = useQuery({
    queryKey: ['contact-engagement', contactId],
    queryFn: () => contactsApi.engagement(contactId),
    staleTime: 60_000,
  });
  return (
    <AsyncPanel query={q} skeleton="text" skeletonRows={2}>
      {(r) => {
        const band = engagementBand(r.score);
        const tone = TONE[BAND_TONE[band]];
        return (
          <div className="space-y-1.5" data-engagement-panel>
            <div className="flex items-center gap-2.5">
              <Flame className={cn('h-4 w-4', tone.icon)} />
              <span className="text-heading font-semibold tabular-nums text-[var(--text-primary)]">{r.score}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-caption font-medium', tone.bg, tone.text)}>
                {BAND_WORD[band]}
              </span>
            </div>
            <p className="text-caption text-[var(--text-secondary)]">{describeEngagement(r.factors)}</p>
            {r.last_at && (
              <p className="text-caption text-[var(--text-tertiary)]">
                Last activity {formatDate(r.last_at)}. Older activity counts for less.
              </p>
            )}
          </div>
        );
      }}
    </AsyncPanel>
  );
}

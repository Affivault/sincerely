import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { LIGHT_HINT, LIGHT_LABEL, SEND_LIGHTS, type SendLight } from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { LightDot } from '../contacts/EmailLights';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Who a campaign emails, by traffic light - chosen at launch, in front of
   the numbers.

   Green only is the default because it is what protects a sending domain.
   Amber is a judgement call (catch-alls are often real people); red is
   almost always a mistake, so it says so. The sender checks the light
   before every email, so this is a promise kept, not a filter at the door.
   ═══════════════════════════════════════════════════════════════════════ */

export function SendLightsPicker({ value, onChange, contactIds, compact }: {
  value: SendLight[];
  onChange: (next: SendLight[]) => void;
  /** The audience, for the counts. Omit to show the choice without them. */
  contactIds?: string[];
  compact?: boolean;
}) {
  const ids = contactIds || [];
  const { data: counts } = useQuery({
    queryKey: ['light-counts', ids.length, ids.slice(0, 50).join(',')],
    queryFn: () => contactsApi.lightCounts(ids),
    enabled: ids.length > 0,
    staleTime: 30_000,
  });

  const toggle = (l: SendLight) => {
    const next = value.includes(l) ? value.filter((x) => x !== l) : [...value, l];
    if (next.length > 0) onChange(SEND_LIGHTS.filter((x) => next.includes(x)));
  };

  const willSend = counts ? value.reduce((n, l) => n + (counts[l] || 0), 0) : null;
  const total = counts ? counts.green + counts.amber + counts.red : null;
  const amberUnchecked = counts?.unverified || 0;

  return (
    <div className="space-y-2" data-send-lights>
      {!compact && (
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-body font-semibold text-[var(--text-primary)]">Who gets emails</p>
          {willSend != null && total != null && (
            <p className="text-caption text-[var(--text-tertiary)] tabular">
              <strong className="text-[var(--text-primary)]">{willSend.toLocaleString()}</strong> of {total.toLocaleString()} will be emailed
            </p>
          )}
        </div>
      )}
      <div role="group" aria-label="Email these lights" className="grid gap-2 sm:grid-cols-3">
        {SEND_LIGHTS.map((l) => {
          const on = value.includes(l);
          return (
            <button
              key={l}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(l)}
              className={cn(
                'text-left rounded-lg border px-3 py-2 transition-colors',
                on
                  ? l === 'green' ? 'border-emerald-500/60 bg-emerald-500/10' : l === 'amber' ? 'border-amber-500/60 bg-amber-500/10' : 'border-rose-500/60 bg-rose-500/10'
                  : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] opacity-80',
              )}
              data-send-light={l}
            >
              <span className="flex items-center gap-2">
                <LightDot light={l} />
                <span className="text-body font-semibold text-[var(--text-primary)]">{LIGHT_LABEL[l]}</span>
                {counts && <span className="ml-auto text-caption font-semibold tabular text-[var(--text-secondary)]">{(counts[l] || 0).toLocaleString()}</span>}
              </span>
              <span className="block text-caption text-[var(--text-tertiary)] mt-0.5">{LIGHT_HINT[l]}</span>
            </button>
          );
        })}
      </div>
      {counts && value.length === 1 && value[0] === 'green' && counts.green === 0 && total ? (
        <p className="flex items-start gap-1.5 text-caption text-amber-700 dark:text-amber-400" data-no-green>
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
          Nobody in this audience is verified yet, so nothing would be sent. Verify them first (Leads page, select, Verify emails), or include Unsure.
        </p>
      ) : value.includes('red') ? (
        <p className="flex items-start gap-1.5 text-caption text-rose-700 dark:text-rose-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
          Bad addresses bounce, and bounces are what get a sending domain blocked. Only send to red if you know better than the check.
        </p>
      ) : !value.includes('amber') && amberUnchecked > 0 ? (
        <p className="flex items-start gap-1.5 text-caption text-[var(--text-secondary)]">
          <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 mt-px text-emerald-600" />
          {amberUnchecked.toLocaleString()} not checked yet: each is verified (free) before its first email, and only sent if it comes back verified.
        </p>
      ) : value.includes('amber') ? (
        <p className="flex items-start gap-1.5 text-caption text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
          Risky and catch-all addresses are sent. Many are real people; some will bounce.
        </p>
      ) : null}
    </div>
  );
}

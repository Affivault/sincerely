import { Snowflake, HeartHandshake, Info, AlertTriangle } from 'lucide-react';
import {
  CAMPAIGN_AUDIENCES, CAMPAIGN_TRIGGERS, triggerSpec, describeTriggerProblem,
  type CampaignAudience, type CampaignTrigger,
} from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Who is this sequence for?

   The most consequential question anybody answers about a campaign, and
   until now it was never asked - every sequence was cold, and the guards
   assumed it. A campaign that says "existing customers" is allowed to reach
   people a cold campaign must never touch: somebody mid-negotiation, or
   somebody filed only as a relationship. It is also the only kind that can
   start itself from what happens to a deal.

   Deliberately two large choices rather than a dropdown. The difference
   between these is not a setting, it is what the campaign IS, and getting
   it wrong means pitching your own customers.
   ═══════════════════════════════════════════════════════════════════════ */

const AUDIENCE_ICON: Record<CampaignAudience, React.ElementType> = {
  cold: Snowflake,
  post_sale: HeartHandshake,
};

export function CampaignAudienceCard({
  audience, trigger, offsetDays, onChange, disabled,
}: {
  audience: CampaignAudience;
  trigger: CampaignTrigger | null;
  offsetDays: number;
  onChange: (patch: {
    audience?: CampaignAudience;
    trigger_event?: CampaignTrigger | null;
    trigger_offset_days?: number;
  }) => void;
  disabled?: boolean;
}) {
  const spec = triggerSpec(trigger);
  const problem = describeTriggerProblem({
    audience, trigger_event: trigger, trigger_offset_days: offsetDays,
  });
  const isPostSale = audience === 'post_sale';
  const automatic = isPostSale && !!trigger && trigger !== 'manual';

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Who is this for?</h3>
        <p className="mt-0.5 text-[11.5px] text-[var(--text-secondary)] leading-snug">
          This decides who the sequence is allowed to reach, and whether it can start on its own.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {CAMPAIGN_AUDIENCES.map((a) => {
          const Icon = AUDIENCE_ICON[a.id];
          const active = audience === a.id;
          return (
            <button
              key={a.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange({
                audience: a.id,
                // Moving back to cold takes the trigger with it, rather than
                // leaving a setting behind that the database will refuse.
                ...(a.id === 'cold' ? { trigger_event: null, trigger_offset_days: 0 } : {}),
              })}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors disabled:opacity-50',
                active
                  ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-default)]',
              )}
            >
              <span className="flex items-center gap-2">
                <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', active ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')} />
                <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">{a.label}</span>
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-[var(--text-secondary)]">{a.blurb}</span>
            </button>
          );
        })}
      </div>

      {isPostSale && (
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
          <p className="text-[12px] font-semibold text-[var(--text-primary)]">What starts it?</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CAMPAIGN_TRIGGERS.map((t) => {
              const active = (trigger || 'manual') === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({
                    trigger_event: t.id === 'manual' ? 'manual' : t.id,
                    trigger_offset_days: t.defaultOffsetDays,
                  })}
                  title={t.effect}
                  className={cn(
                    'h-7 rounded-md border px-2.5 text-[11.5px] font-medium transition-colors disabled:opacity-50',
                    active
                      ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--border-default)]',
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* What will actually happen, in a sentence, before it happens. */}
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-[var(--text-secondary)]">
            <Info className="mt-[2px] h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)]" />
            {spec.effect}
          </p>

          {automatic && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                max={365}
                value={Number.isFinite(offsetDays) ? offsetDays : 0}
                disabled={disabled}
                onChange={(e) => onChange({ trigger_offset_days: Number(e.target.value) })}
                className="h-7 w-[70px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-[12px] tabular text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
              />
              <span className="text-[11.5px] text-[var(--text-secondary)]">{spec.offsetLabel}</span>
            </div>
          )}

          {automatic && (
            <p className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[11px] leading-snug text-[var(--text-secondary)]">
              {/* Says the surprising thing out loud. Every other campaign in
                  this app refuses to start without recipients. */}
              You do not add anyone. This sequence stays empty until a deal
              matches, then enrols the people on it — once per deal, per
              occasion. Anyone unsubscribed or on your suppression list is
              still never emailed.
            </p>
          )}
        </div>
      )}

      {problem && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-[2px] h-3 w-3 flex-shrink-0" />
          {problem}
        </p>
      )}
    </div>
  );
}

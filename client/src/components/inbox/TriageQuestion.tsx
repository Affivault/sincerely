import { SNOOZE_CHOICES, NOT_INTERESTED_REASONS } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   The one question two of the three decisions need first.

   "Not now" is meaningless without a when, and "not interested" is the one
   action here that reaches outside this screen - it suppresses somebody
   across every campaign and every list, forever. Both deserve a beat.

   Shared between the single-reply bar and the bulk bar deliberately. The
   question is the same question whether it is being asked about one reply
   or thirty, and two copies of it is how the wording drifts and how one of
   them quietly loses an option.
   ═══════════════════════════════════════════════════════════════════════ */

export function TriageQuestion({ kind, count = 1, pending, onAnswer, onCancel, compact }: {
  kind: 'later' | 'not_interested';
  /** How many replies this answer will apply to. 1 keeps the copy singular. */
  count?: number;
  pending?: boolean;
  /** days for 'later', a reason id for 'not_interested'. */
  onAnswer: (answer: { snooze_days?: number; reason?: string }) => void;
  onCancel: () => void;
  /** Sits in a toolbar rather than a panel: no border, single row. */
  compact?: boolean;
}) {
  const many = count > 1;
  const noun = many ? `${count} replies` : 'this';

  const options = kind === 'later'
    ? SNOOZE_CHOICES.map((c) => ({ key: c.id, label: c.label, answer: { snooze_days: c.days } }))
    : NOT_INTERESTED_REASONS.map((r) => ({ key: r.id, label: r.label, answer: { reason: r.id } }));

  const hoverBorder = kind === 'later' ? 'hover:border-[var(--indigo)]' : 'hover:border-rose-500/50';

  return (
    <div className={cn(
      !compact && 'rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2.5',
      compact && 'flex items-center gap-2 flex-wrap min-w-0',
    )}>
      <div className={cn(compact && 'flex items-baseline gap-2 flex-shrink-0')}>
        <p className={cn('text-[11.5px] font-medium text-[var(--text-secondary)]', !compact && 'mb-0.5')}>
          {kind === 'later'
            ? (many ? `Come back to ${noun} when?` : 'Come back to this when?')
            : 'Why not?'}
        </p>
        {kind === 'not_interested' && (
          <p className={cn('text-[10.5px] text-[var(--text-tertiary)]', !compact && 'mb-2')}>
            {many
              ? `All ${count} will be suppressed, so no campaign reaches them again.`
              : 'They will be suppressed, so no campaign reaches them again.'}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => onAnswer(o.answer)}
            disabled={pending}
            className={cn(
              'h-7 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-[11.5px] font-medium text-[var(--text-primary)] transition-colors disabled:opacity-50',
              hoverBorder,
            )}
          >
            {o.label}
          </button>
        ))}
        <button
          onClick={onCancel}
          disabled={pending}
          className="h-7 px-2 text-[11.5px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

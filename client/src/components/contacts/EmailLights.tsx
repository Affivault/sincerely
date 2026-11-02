import { EMAIL_LIGHTS, LIGHT_HINT, LIGHT_LABEL, type EmailLight } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   The traffic lights, drawn the same way everywhere: the chips above a
   list, the picker at launch, and the dot on a row.
   ═══════════════════════════════════════════════════════════════════════ */

export const LIGHT_DOT: Record<EmailLight, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  none: 'bg-slate-400 dark:bg-slate-500',
};

const LIGHT_ACTIVE: Record<EmailLight, string> = {
  green: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300',
  amber: 'border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  red: 'border-rose-500/60 bg-rose-500/10 text-rose-800 dark:text-rose-300',
  none: 'border-slate-400/70 bg-slate-500/10 text-[var(--text-primary)]',
};

export function LightDot({ light, className }: { light: EmailLight; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ring-2', LIGHT_DOT[light],
        light === 'green' ? 'ring-emerald-500/20' : light === 'amber' ? 'ring-amber-500/20' : light === 'red' ? 'ring-rose-500/20' : 'ring-slate-400/20', className)}
    />
  );
}

/**
 * Filter chips: All, then one per light with its count. Several lights can
 * be on at once ("green and amber"); none on means everyone.
 */
export function LightChips({ counts, active, onChange, total, lights = EMAIL_LIGHTS }: {
  counts: Record<EmailLight, number>;
  active: EmailLight[];
  onChange: (next: EmailLight[]) => void;
  total: number;
  lights?: EmailLight[];
}) {
  const toggle = (l: EmailLight) => onChange(active.includes(l) ? active.filter((x) => x !== l) : [...active, l]);
  return (
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by email status" data-light-chips>
      <button
        type="button"
        onClick={() => onChange([])}
        aria-pressed={active.length === 0}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-body font-medium border transition-colors',
          active.length === 0
            ? 'bg-[var(--indigo-subtle)] border-[var(--indigo)] text-[var(--indigo-text)]'
            : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        )}
      >
        All
        <span className="text-micro font-semibold tabular opacity-70">{total.toLocaleString()}</span>
      </button>
      {lights.map((l) => {
        const on = active.includes(l);
        return (
          <button
            key={l}
            type="button"
            onClick={() => toggle(l)}
            aria-pressed={on}
            title={LIGHT_HINT[l]}
            className={cn(
              'inline-flex items-center gap-2 h-8 px-3 rounded-full text-body font-medium border transition-colors',
              on ? LIGHT_ACTIVE[l] : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]',
            )}
            data-light={l}
          >
            <LightDot light={l} />
            {LIGHT_LABEL[l]}
            <span className="text-micro font-semibold tabular opacity-70">{(counts[l] || 0).toLocaleString()}</span>
          </button>
        );
      })}
    </div>
  );
}

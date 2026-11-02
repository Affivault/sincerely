import type { ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { EMAIL_LIGHTS, LIGHT_HINT, LIGHT_LABEL, type EmailLight } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   The traffic lights, drawn one way everywhere.

   The list's lights are a proportion before they are a filter: "most of
   this list is unchecked" is the thing to see first. So the header is a
   single bar split by light, with the four lights under it as the
   controls - click one to show only those people, click more to add them,
   and the bar dims what is not shown.
   ═══════════════════════════════════════════════════════════════════════ */

/** Solid fills, for dots and the bar. "No email" is a hatch: absence, not a colour. */
export const LIGHT_FILL: Record<EmailLight, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-400',
  red: 'bg-rose-500',
  none: 'bg-[repeating-linear-gradient(135deg,var(--border-strong)_0_3px,transparent_3px_6px)]',
};

const LIGHT_TEXT: Record<EmailLight, string> = {
  green: 'text-emerald-700 dark:text-emerald-400',
  amber: 'text-amber-700 dark:text-amber-400',
  red: 'text-rose-700 dark:text-rose-400',
  none: 'text-[var(--text-secondary)]',
};

const LIGHT_TINT: Record<EmailLight, string> = {
  green: 'bg-emerald-500/[0.07] border-emerald-500/40',
  amber: 'bg-amber-400/[0.09] border-amber-500/40',
  red: 'bg-rose-500/[0.07] border-rose-500/40',
  none: 'bg-[var(--bg-elevated)] border-[var(--border-strong)]',
};

export function LightDot({ light, size = 'md', className }: { light: EmailLight; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block rounded-full flex-shrink-0',
        size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2',
        light === 'none' ? 'border border-[var(--text-tertiary)] bg-transparent' : LIGHT_FILL[light],
        className,
      )}
    />
  );
}

/** A thin bar split by light. `dim` lights are drawn faint (filtered out). */
export function LightBar({ counts, lights = EMAIL_LIGHTS, dim = [], className }: {
  counts: Partial<Record<EmailLight, number>>;
  lights?: EmailLight[];
  dim?: EmailLight[];
  className?: string;
}) {
  const total = lights.reduce((n, l) => n + (counts[l] || 0), 0);
  return (
    <div className={cn('flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-[var(--bg-elevated)]', className)} aria-hidden="true">
      {total > 0 && lights.map((l) => {
        const n = counts[l] || 0;
        if (!n) return null;
        return (
          <span
            key={l}
            className={cn('h-full first:rounded-l-full last:rounded-r-full transition-opacity duration-200', LIGHT_FILL[l], dim.includes(l) && 'opacity-25')}
            style={{ width: `${(n / total) * 100}%`, minWidth: 4 }}
          />
        );
      })}
    </div>
  );
}

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

/**
 * The list header: how this list's addresses break down, and the filter.
 * Several lights can be on at once; none on means everyone.
 */
export function EmailHealth({ counts, active, onChange, aside }: {
  counts: Record<EmailLight, number>;
  active: EmailLight[];
  onChange: (next: EmailLight[]) => void;
  /** Something for the right of the title row (the LinkedIn count). */
  aside?: ReactNode;
}) {
  const total = EMAIL_LIGHTS.reduce((n, l) => n + (counts[l] || 0), 0);
  const toggle = (l: EmailLight) => onChange(active.includes(l) ? active.filter((x) => x !== l) : [...active, l]);
  const sendable = counts.green || 0;
  return (
    <section className="card px-4 pt-3.5 pb-3" aria-label="Email health" data-light-chips>
      <div className="flex items-center gap-3 mb-2.5">
        <h2 className="text-body font-semibold text-[var(--text-primary)] whitespace-nowrap">Email health</h2>
        <p className="hidden sm:block text-caption text-[var(--text-tertiary)] truncate">
          <span className="tabular font-medium text-[var(--text-secondary)]">{pct(sendable, total)}%</span> verified and safe to send
        </p>
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {active.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <X className="h-3 w-3" />
              Show everyone
            </button>
          )}
          {aside}
        </div>
      </div>

      <LightBar counts={counts} dim={active.length ? EMAIL_LIGHTS.filter((l) => !active.includes(l)) : []} />

      <div className="mt-2.5 grid grid-cols-2 md:grid-cols-4 gap-1.5" role="group" aria-label="Show only">
        {EMAIL_LIGHTS.map((l) => {
          const on = active.includes(l);
          const n = counts[l] || 0;
          return (
            <button
              key={l}
              type="button"
              onClick={() => toggle(l)}
              aria-pressed={on}
              title={LIGHT_HINT[l]}
              data-light={l}
              className={cn(
                'group relative flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                on ? LIGHT_TINT[l] : 'border-transparent hover:bg-[var(--bg-hover)]',
              )}
            >
              <LightDot light={l} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className={cn('text-body font-semibold tabular', on ? LIGHT_TEXT[l] : 'text-[var(--text-primary)]')}>{n.toLocaleString()}</span>
                  <span className="text-caption text-[var(--text-tertiary)] tabular">{pct(n, total)}%</span>
                </span>
                <span className="block text-caption text-[var(--text-secondary)] truncate">{LIGHT_LABEL[l]}</span>
              </span>
              <span className={cn(
                'flex h-4 w-4 items-center justify-center rounded border flex-shrink-0 transition-colors',
                on ? 'border-transparent bg-[var(--text-primary)] text-[var(--bg-surface)]' : 'border-[var(--border-default)] opacity-0 group-hover:opacity-100',
              )}>
                {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

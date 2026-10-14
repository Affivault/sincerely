/*
 * The one status language.
 *
 * Every pill, dot and notice in the app says one of six things, and each is
 * drawn the same way wherever it appears. Pages used to pick their own: a
 * running campaign was green with a border on one screen and a filled chip
 * on the next, an intent was a tinted pill here and a coloured word there,
 * and three banners on three pages were three different boxes.
 *
 *   neutral    - a fact with no judgement in it (draft, completed, other)
 *   positive   - going well, nothing to do (running, interested, valid)
 *   attention  - worth a look soon (paused, objection, risky)
 *   negative   - something is wrong or has stopped (bounced, failed)
 *   info       - a state worth knowing, neither good nor bad (scheduled)
 *   brand      - the best outcome, in the product's own ink (wants a meeting)
 */
export type Tone = 'neutral' | 'positive' | 'attention' | 'negative' | 'info' | 'brand';

interface ToneClasses {
  /** Soft ground for a pill. */
  bg: string;
  /** Text on that ground. */
  text: string;
  /** A dot, or the rule down the edge of a notice. */
  solid: string;
  /** An icon beside plain text. */
  icon: string;
}

export const TONE: Record<Tone, ToneClasses> = {
  neutral:   { bg: 'bg-[var(--bg-elevated)]', text: 'text-[var(--text-secondary)]', solid: 'bg-[var(--text-tertiary)]', icon: 'text-[var(--text-tertiary)]' },
  positive:  { bg: 'bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300', solid: 'bg-emerald-500', icon: 'text-emerald-600 dark:text-emerald-400' },
  attention: { bg: 'bg-amber-500/15', text: 'text-amber-800 dark:text-amber-300', solid: 'bg-amber-500', icon: 'text-amber-600 dark:text-amber-400' },
  negative:  { bg: 'bg-rose-500/10', text: 'text-rose-700 dark:text-rose-300', solid: 'bg-rose-500', icon: 'text-rose-600 dark:text-rose-400' },
  info:      { bg: 'bg-sky-500/10', text: 'text-sky-700 dark:text-sky-300', solid: 'bg-sky-500', icon: 'text-sky-600 dark:text-sky-400' },
  brand:     { bg: 'bg-[var(--indigo-subtle)]', text: 'text-[var(--indigo-text)]', solid: 'bg-[var(--indigo)]', icon: 'text-[var(--indigo-text)]' },
};

/** The pill: soft ground, toned text. Size and padding stay with the caller. */
export function tonePill(tone: Tone): string {
  return `${TONE[tone].bg} ${TONE[tone].text}`;
}

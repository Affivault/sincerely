import type { StageColor } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   What each stage colour looks like (migration 106).

   The database stores a colour by name; this is the one place that turns
   the name into classes. Every string is written out whole so Tailwind
   keeps it in the build.
   ═══════════════════════════════════════════════════════════════════════ */

export interface StageTone {
  /** A small dot or bar. */
  dot: string;
  /** A filled chip with white text. */
  solid: string;
  /** A tinted chip with coloured text. */
  soft: string;
  /** A coloured border. */
  border: string;
  /** Plain coloured text. */
  text: string;
}

export const STAGE_TONE: Record<StageColor, StageTone> = {
  slate: { dot: 'bg-slate-400', solid: 'bg-slate-500 text-white', soft: 'bg-slate-500/10 text-slate-700 dark:text-slate-300', border: 'border-slate-400', text: 'text-slate-600 dark:text-slate-300' },
  blue: { dot: 'bg-blue-500', solid: 'bg-blue-500 text-white', soft: 'bg-blue-500/10 text-blue-700 dark:text-blue-300', border: 'border-blue-500', text: 'text-blue-600 dark:text-blue-400' },
  indigo: { dot: 'bg-indigo-500', solid: 'bg-indigo-500 text-white', soft: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300', border: 'border-indigo-500', text: 'text-indigo-600 dark:text-indigo-400' },
  violet: { dot: 'bg-violet-500', solid: 'bg-violet-500 text-white', soft: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', border: 'border-violet-500', text: 'text-violet-600 dark:text-violet-400' },
  pink: { dot: 'bg-pink-500', solid: 'bg-pink-500 text-white', soft: 'bg-pink-500/10 text-pink-700 dark:text-pink-300', border: 'border-pink-500', text: 'text-pink-600 dark:text-pink-400' },
  rose: { dot: 'bg-rose-500', solid: 'bg-rose-500 text-white', soft: 'bg-rose-500/10 text-rose-700 dark:text-rose-300', border: 'border-rose-500', text: 'text-rose-600 dark:text-rose-400' },
  orange: { dot: 'bg-orange-500', solid: 'bg-orange-500 text-white', soft: 'bg-orange-500/10 text-orange-700 dark:text-orange-300', border: 'border-orange-500', text: 'text-orange-600 dark:text-orange-400' },
  amber: { dot: 'bg-amber-500', solid: 'bg-amber-500 text-white', soft: 'bg-amber-500/10 text-amber-700 dark:text-amber-300', border: 'border-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  emerald: { dot: 'bg-emerald-500', solid: 'bg-emerald-500 text-white', soft: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', border: 'border-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  teal: { dot: 'bg-teal-500', solid: 'bg-teal-500 text-white', soft: 'bg-teal-500/10 text-teal-700 dark:text-teal-300', border: 'border-teal-500', text: 'text-teal-600 dark:text-teal-400' },
  cyan: { dot: 'bg-cyan-500', solid: 'bg-cyan-500 text-white', soft: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300', border: 'border-cyan-500', text: 'text-cyan-600 dark:text-cyan-400' },
};

export const STAGE_COLOR_LABEL: Record<StageColor, string> = {
  slate: 'Slate', blue: 'Blue', indigo: 'Indigo', violet: 'Violet', pink: 'Pink', rose: 'Rose',
  orange: 'Orange', amber: 'Amber', emerald: 'Green', teal: 'Teal', cyan: 'Cyan',
};

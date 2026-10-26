/* ═══════════════════════════════════════════════════════════════════════
   How fast one mailbox sends: a daily limit and a gap between emails.

   Both protect the sending domain's reputation. Providers judge a mailbox
   on volume and on rhythm: forty emails in one minute reads as a bulk
   blast however good they are, forty spread across a working day reads as
   a person. The recommended values are the defaults; every mailbox can be
   set faster or slower, and the presets say what each choice trades.
   ═══════════════════════════════════════════════════════════════════════ */

/** Campaign emails a day from one mailbox, recommended for cold outreach. */
export const RECOMMENDED_DAILY_LIMIT = 40;

/** Seconds between campaign sends from one mailbox, recommended. */
export const RECOMMENDED_GAP = { min: 120, max: 300 } as const;

/** The longest gap that may be set, in seconds (the database agrees). */
export const MAX_GAP_SECONDS = 3600;

export interface DailyLimitPreset { value: number; label: string; note: string; recommended?: boolean }

export const DAILY_LIMIT_PRESETS: DailyLimitPreset[] = [
  { value: 20, label: '20', note: 'Careful: new domains and mailboxes still warming up.' },
  { value: RECOMMENDED_DAILY_LIMIT, label: '40', note: 'Recommended for cold outreach from one mailbox.', recommended: true },
  { value: 75, label: '75', note: 'For an established mailbox with a clean record.' },
  { value: 150, label: '150', note: 'Aggressive. Add another mailbox before going higher.' },
];

export interface GapPreset { min: number; max: number; label: string; note: string; recommended?: boolean }

export const GAP_PRESETS: GapPreset[] = [
  { min: 60, max: 120, label: '1-2 min', note: 'Faster. Fine for warm, established mailboxes.' },
  { min: RECOMMENDED_GAP.min, max: RECOMMENDED_GAP.max, label: '2-5 min', note: 'Recommended. Reads as a person sending, not a blast.', recommended: true },
  { min: 300, max: 600, label: '5-10 min', note: 'Careful. Best for new domains or after a bounce spike.' },
];

/** "2-5 min", "1 min", "30-90s" for a gap in seconds. */
export function formatGap(min: number, max: number): string {
  if (max <= 0) return 'No gap';
  const inMinutes = min % 60 === 0 && max % 60 === 0;
  const show = (sec: number) => String(inMinutes ? sec / 60 : sec);
  const unit = inMinutes ? ' min' : 's';
  return min === max ? `${show(min)}${unit}` : `${show(min)}-${show(max)}${unit}`;
}

/**
 * What a gap allows in a working day, so the two numbers can be read
 * together: a 5-10 minute gap cannot deliver 150 a day in an 8 hour window.
 */
export function gapCapacityPerDay(min: number, max: number, windowHours = 8): number {
  const avg = (Math.max(0, min) + Math.max(0, max)) / 2;
  if (avg <= 0) return Infinity;
  return Math.floor((windowHours * 3600) / avg);
}

/**
 * The highest daily limit that may be set on many mailboxes at once.
 *
 * One mailbox can be set to anything, unlimited included, by somebody
 * looking at it. Setting a fleet is one click, so it is held to a number a
 * real mailbox can plausibly send without being filtered.
 */
export const MAX_BULK_DAILY_LIMIT = 500;

/** Why a daily limit cannot be applied to many mailboxes, or null when it can. */
export function dailyLimitProblem(limit: number): string | null {
  if (!Number.isFinite(limit) || !Number.isInteger(limit)) return 'The daily limit must be a whole number.';
  if (limit < 1) return 'The daily limit must be at least 1 email a day.';
  if (limit > MAX_BULK_DAILY_LIMIT) return `A daily limit above ${MAX_BULK_DAILY_LIMIT} cannot be set on many mailboxes at once.`;
  return null;
}

/** Why a gap cannot be saved, or null when it can. */
export function gapProblem(min: number, max: number): string | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) return 'Gaps must be zero or more seconds.';
  if (max < min) return 'The longest gap must be at least the shortest.';
  if (max > MAX_GAP_SECONDS) return 'Gaps longer than an hour are not supported.';
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════
   Attachments you send, snoozes, nudges and who a conversation belongs to.

   The rules both ends have to agree on live here, so the composer refuses
   the same files the server would and the snooze menu offers the same
   times the server will accept. A limit enforced in only one place is a
   limit that is discovered by having a send fail.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The most a reply or a new message may carry, all files together.
 *
 * Ten megabytes is below what every mainstream mailbox accepts (Gmail and
 * Outlook take 20-25 MB), so a message within it is not bounced for size by
 * the server on the other end - which is a failure that arrives hours later
 * as a bounce, long after the person thought it had gone.
 */
export const OUTGOING_ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024;

/** More than this many files in one email is a shared folder, not an email. */
export const OUTGOING_ATTACHMENT_MAX_FILES = 10;

/**
 * What the SMTP relay can carry.
 *
 * The relay is a Vercel function, and Vercel refuses a request body over
 * 4.5 MB before the function runs. Files travel base64-encoded inside JSON,
 * which costs a third again, so 3 MB of files is what fits with room for
 * the message itself. Over this, a send cannot go through the relay at all.
 */
export const RELAY_ATTACHMENT_LIMIT_BYTES = 3 * 1024 * 1024;

/** One file as the composer hands it to the API. */
export interface OutgoingAttachment {
  filename: string;
  content_type: string;
  /** The file itself, base64 without a data: prefix. */
  content_base64: string;
}

/** What is kept about an attachment on the message row (migration 090). */
export interface AttachmentMeta {
  filename: string;
  content_type: string;
  size: number;
}

/** Bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(b64: string): number {
  const clean = b64.replace(/\s/g, '');
  if (!clean) return 0;
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

/**
 * Whether a set of files may be sent, and if not, the reason in words a
 * person can act on. Null means they may.
 */
export function attachmentProblem(files: Array<{ filename: string; size: number }>): string | null {
  if (files.length > OUTGOING_ATTACHMENT_MAX_FILES) {
    return `Attach up to ${OUTGOING_ATTACHMENT_MAX_FILES} files to one email.`;
  }
  const total = files.reduce((n, f) => n + (Number(f.size) || 0), 0);
  if (total > OUTGOING_ATTACHMENT_LIMIT_BYTES) {
    return `Attachments come to ${formatBytes(total)}; the most one email can carry is ${formatBytes(OUTGOING_ATTACHMENT_LIMIT_BYTES)}. Share a link to the larger files instead.`;
  }
  return null;
}

export function formatBytes(b: number): string {
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

/* ── Snooze ─────────────────────────────────────────────────────────── */

export type SnoozePresetId = 'later_today' | 'tomorrow' | 'next_week';

export interface SnoozePreset {
  id: SnoozePresetId;
  label: string;
  at: Date;
}

/**
 * The three times people actually mean.
 *
 * "Later today" is three hours on, rounded to the hour, and is left out
 * once that would land after 9pm - offering "later today" at 11pm and
 * delivering it at 2am is not what anybody asked for. "Tomorrow" and "next
 * week" are 8am local, the start of a working day; next week is the coming
 * Monday, never today even when today is Monday.
 */
export function snoozePresets(now: Date = new Date()): SnoozePreset[] {
  const out: SnoozePreset[] = [];

  const later = new Date(now.getTime() + 3 * 3_600_000);
  later.setMinutes(0, 0, 0);
  if (later.getHours() <= 21 && later.getDate() === now.getDate()) {
    out.push({ id: 'later_today', label: 'Later today', at: later });
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  out.push({ id: 'tomorrow', label: 'Tomorrow morning', at: tomorrow });

  const monday = new Date(now);
  const daysToMonday = ((8 - monday.getDay()) % 7) || 7;
  monday.setDate(monday.getDate() + daysToMonday);
  monday.setHours(8, 0, 0, 0);
  out.push({ id: 'next_week', label: 'Next week', at: monday });

  return out;
}

/** A snooze is at most a year out: further than that is archiving. */
export const SNOOZE_MAX_DAYS = 366;

/* ── Nudge: "remind me if no reply" ─────────────────────────────────── */

/** The choices offered. A number outside these is refused, not rounded. */
export const NUDGE_DAY_OPTIONS = [1, 2, 3, 5, 7, 14] as const;
export type NudgeDays = (typeof NUDGE_DAY_OPTIONS)[number];

export function isNudgeDays(n: unknown): n is NudgeDays {
  return typeof n === 'number' && (NUDGE_DAY_OPTIONS as readonly number[]).includes(n);
}

/** Why a conversation came back to the top of the inbox. */
export type ResurfacedReason = 'snooze' | 'nudge';

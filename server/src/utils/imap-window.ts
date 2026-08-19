/* ═══════════════════════════════════════════════════════════════════════
   Deciding what to ask an IMAP server for.

   None of this touches a socket, and that is deliberate: every bug the old
   sync had was in the decision, not in the conversation.

   Two of them are worth naming, because they are easy to write again.

   IMAP's SINCE and BEFORE compare *dates*, not instants (RFC 3501 §6.4.4).
   The old sync stored `last_inbox_sync_at` as a full timestamp and handed
   it straight to SINCE, so every run re-fetched the whole of the current
   day — and then spent one database round trip per message discovering it
   already had each one.

   And UIDs are only meaningful within a UIDVALIDITY generation. A server
   that renumbers the mailbox reuses UIDs from 1, so a stored "last UID
   seen" of 40,000 would silently skip everything until the mailbox grew
   past it again. The rule is to compare UIDVALIDITY first and treat a
   change as "this is a different mailbox".
   ═══════════════════════════════════════════════════════════════════════ */

import type { SyncWindowMonths } from '@lemlist/shared';

/** Messages pulled per backfill slice. Bounded so one run always finishes. */
export const BACKFILL_BATCH = 200;

/** How wide a slice of history one run reaches for. */
export const BACKFILL_SLICE_DAYS = 14;

/** Midnight UTC on the day of `at` — the granularity SINCE and BEFORE work at. */
export function floorToDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * The oldest instant this mailbox is meant to hold.
 *
 * Calendar months, not 30-day blocks: someone choosing "3 months" means
 * back to the same day three months ago, and a month is not 30 days.
 */
export function windowStart(months: SyncWindowMonths, now = new Date()): Date {
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - months);
  return floorToDay(start);
}

export interface ForwardPlan {
  /** UID range to fetch, when UIDs can be trusted. */
  uidRange: string | null;
  /** Date floor to fetch from, when they cannot. */
  since: Date | null;
  /** True when the stored UID state was discarded and the mailbox re-read. */
  uidReset: boolean;
}

/**
 * What to ask for to pick up mail that has arrived since last time.
 *
 * By UID wherever possible, because it is exact: `N+1:*` is precisely the
 * messages this mailbox has not seen, with no re-reading and no guessing.
 * The date path is only for a mailbox with no usable UID state — a first
 * connection, or a server that renumbered.
 */
export function planForward(
  state: { uid_validity: number | null; last_uid: number | null },
  mailbox: { uidValidity: number | null },
  fallbackSince: Date,
): ForwardPlan {
  const serverValidity = Number(mailbox.uidValidity) || null;
  const knownValidity = Number(state.uid_validity) || null;
  const lastUid = Number(state.last_uid) || 0;

  const validityChanged = Boolean(knownValidity && serverValidity && knownValidity !== serverValidity);

  if (!validityChanged && knownValidity && serverValidity && lastUid > 0) {
    return { uidRange: `${lastUid + 1}:*`, since: null, uidReset: false };
  }

  return {
    uidRange: null,
    // Floored, because SINCE ignores the time of day anyway — passing an
    // instant only creates the illusion of precision.
    since: floorToDay(fallbackSince),
    uidReset: validityChanged,
  };
}

export interface BackfillSlice {
  /** Inclusive date floor. */
  since: Date;
  /** Exclusive date ceiling. */
  before: Date;
  /** True when this slice reaches the edge of the window. */
  final: boolean;
}

/**
 * The next slice of history to reach for, or null when there is none.
 *
 * Walks backwards a fortnight at a time from wherever the last run stopped.
 * Bounded on purpose: a six-month backfill of a busy mailbox is tens of
 * thousands of messages, and one request that tries to do all of it is one
 * request that times out and leaves nothing behind to resume from.
 */
export function planBackfill(
  state: { backfill_cursor: string | null; backfill_done: boolean },
  months: SyncWindowMonths,
  now = new Date(),
): BackfillSlice | null {
  if (state.backfill_done) return null;

  const floor = windowStart(months, now);
  // No cursor yet: start from today and walk back.
  const cursor = state.backfill_cursor ? new Date(state.backfill_cursor) : floorToDay(now);
  if (!Number.isFinite(cursor.getTime())) return null;
  if (cursor.getTime() <= floor.getTime()) return null;

  const proposed = new Date(cursor.getTime() - BACKFILL_SLICE_DAYS * 86_400_000);
  const since = proposed.getTime() <= floor.getTime() ? floor : floorToDay(proposed);

  return { since, before: cursor, final: since.getTime() <= floor.getTime() };
}

/**
 * Where the cursor should sit after a slice completes.
 *
 * The slice's own floor, never the date of the oldest message found in it:
 * a fortnight with no mail in it would otherwise leave the cursor where it
 * was and the backfill would ask for the same empty fortnight forever.
 */
export function advanceCursor(slice: BackfillSlice): { cursor: string; done: boolean } {
  return { cursor: slice.since.toISOString(), done: slice.final };
}

/* ═══════════════════════════════════════════════════════════════════════
   Not losing twenty minutes of work to a closed tab.

   The campaign builder had a "Save draft" button and nothing else. No
   autosave, no warning on navigation, no local copy. Write a five-step
   sequence, hit back or let the laptop sleep, and it is gone - silently,
   with no indication it was ever at risk. For a tool whose whole job is
   composing sequences, that is the most expensive failure available.

   The rules this follows, which are the ones that make recovery
   trustworthy rather than annoying:

   NEVER RESTORE SILENTLY. A draft that reappears without being asked for
   is indistinguishable from the app losing your newer work. It is offered,
   with its age, and declining is one click.

   NEVER OFFER SOMETHING STALE. A draft from three weeks ago is not a
   rescue, it is a trap - by then the user has forgotten it and will not
   recognise what they are being shown.

   NEVER OFFER SOMETHING EMPTY. Restoring a blank form over a blank form
   is noise that teaches people to dismiss the prompt without reading,
   which is precisely when it matters that they read it.

   NEVER LOSE THE SERVER'S VERSION. A local draft is a safety net under
   unsaved work, not a source of truth. When the saved record is newer, it
   wins, because it is the one that survived.

   Pure functions over plain values, so the decisions can be asserted
   directly rather than by driving a component and hoping.
   ═══════════════════════════════════════════════════════════════════════ */

/** How long a local draft stays worth offering. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredDraft<T = unknown> {
  /** What was in the form. */
  data: T;
  /** When it was written, epoch ms. */
  saved_at: number;
  /**
   * The record this draft belongs to, or null for a brand-new one. Keeps a
   * draft of campaign A from being offered while editing campaign B.
   */
  record_id: string | null;
  /**
   * The form's shape when it was written. A draft from an older build can
   * carry fields that no longer exist, or miss ones now required, and
   * restoring it would put the form into a state it has no code for.
   */
  version: number;
}

export type DraftDecision =
  | { restore: false; reason: 'none' | 'stale' | 'empty' | 'other-record' | 'old-version' | 'server-newer' }
  | { restore: true; ageMs: number };

/**
 * Should this draft be offered back?
 *
 * Returns a reason on every refusal rather than a bare false, so the
 * calling code can be checked against each rule individually instead of
 * just "it did not offer".
 */
export function shouldOfferDraft<T>(
  draft: StoredDraft<T> | null,
  opts: {
    now?: number;
    recordId: string | null;
    version: number;
    /** True when the draft holds nothing worth restoring. */
    isEmpty: (data: T) => boolean;
    /** When the saved record was last updated, if there is one. */
    serverUpdatedAt?: string | number | null;
    maxAgeMs?: number;
  },
): DraftDecision {
  if (!draft || typeof draft.saved_at !== 'number') return { restore: false, reason: 'none' };

  const now = opts.now ?? Date.now();
  const maxAge = opts.maxAgeMs ?? DRAFT_MAX_AGE_MS;

  // A draft of a different campaign, or a new-campaign draft while editing
  // an existing one, is somebody else's work.
  if ((draft.record_id ?? null) !== (opts.recordId ?? null)) {
    return { restore: false, reason: 'other-record' };
  }

  if (draft.version !== opts.version) return { restore: false, reason: 'old-version' };

  const ageMs = now - draft.saved_at;
  // A clock that has gone backwards produces a negative age; treat it as
  // fresh rather than refusing, since the draft is certainly not stale.
  if (ageMs > maxAge) return { restore: false, reason: 'stale' };

  if (opts.isEmpty(draft.data)) return { restore: false, reason: 'empty' };

  /*
   * The saved record wins when it is newer. The local copy exists to
   * survive a closed tab, not to overwrite a save that actually happened -
   * somebody who saved on another device should not have it undone by a
   * stale draft sitting in this browser.
   */
  if (opts.serverUpdatedAt != null) {
    const serverMs = typeof opts.serverUpdatedAt === 'number'
      ? opts.serverUpdatedAt
      : Date.parse(opts.serverUpdatedAt);
    if (Number.isFinite(serverMs) && serverMs >= draft.saved_at) {
      return { restore: false, reason: 'server-newer' };
    }
  }

  return { restore: true, ageMs: Math.max(0, ageMs) };
}

/** "just now", "4 minutes ago", "2 hours ago", "3 days ago". */
export function draftAgeLabel(ageMs: number): string {
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The storage key for a form's draft. Scoped per record so they cannot collide. */
export function draftKey(form: string, recordId: string | null): string {
  return `sincerely:draft:${form}:${recordId ?? 'new'}`;
}

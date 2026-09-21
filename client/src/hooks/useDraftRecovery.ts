import { useCallback, useEffect, useRef, useState } from 'react';
import {
  draftKey, shouldOfferDraft, type StoredDraft, type DraftDecision,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Autosave to the browser, and a decision about offering it back.

   The policy lives in shared/draft-recovery where it can be asserted
   against plain values. This is the part that has to touch the browser:
   debounced writes, a read on mount, and the two things that make a local
   draft safe to keep - clearing it the moment the work is genuinely saved,
   and never letting a write throw.

   Every storage access is wrapped. localStorage throws in private windows,
   with site data blocked, and when the quota is full - and a form that
   crashes while trying to protect your work is worse than one that never
   tried.
   ═══════════════════════════════════════════════════════════════════════ */

export interface DraftRecovery<T> {
  /** A draft worth offering, with its age, or null. */
  offer: { data: T; ageMs: number } | null;
  /** Why nothing is on offer. Useful in tests and when debugging. */
  decision: DraftDecision;
  /** Take the draft. Clears the offer; restoring is the caller's job. */
  accept: () => T | null;
  /** Decline it, and remove it so it is never offered again. */
  dismiss: () => void;
  /** Work is saved for real — the safety net is no longer needed. */
  clear: () => void;
  /** When the current contents were last written locally, or null. */
  savedAt: number | null;
}

export function useDraftRecovery<T>(opts: {
  /** Names the form. Part of the storage key. */
  form: string;
  /** The record being edited, or null for a new one. */
  recordId: string | null;
  /** Bumped whenever the shape of `data` changes incompatibly. */
  version: number;
  /** The live form contents. */
  data: T;
  /** True once the form is ready to be saved from (not still loading). */
  enabled: boolean;
  /** Nothing worth keeping. */
  isEmpty: (data: T) => boolean;
  /** When the saved record was last updated, if there is one. */
  serverUpdatedAt?: string | number | null;
  /** Quiet period before a write. */
  debounceMs?: number;
}): DraftRecovery<T> {
  const {
    form, recordId, version, data, enabled, isEmpty, serverUpdatedAt, debounceMs = 1200,
  } = opts;

  const key = draftKey(form, recordId);
  const [offer, setOffer] = useState<{ data: T; ageMs: number } | null>(null);
  const [decision, setDecision] = useState<DraftDecision>({ restore: false, reason: 'none' });
  const [savedAt, setSavedAt] = useState<number | null>(null);

  /*
   * Writing is suspended once the offer has been answered one way or the
   * other, and until then. Autosaving over a draft the user has not yet
   * been asked about would destroy the thing being offered.
   */
  const answered = useRef(false);
  const cleared = useRef(false);

  // ── Read once, on mount ──
  useEffect(() => {
    if (!enabled) return;
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(key); } catch { /* blocked or private */ }

    let parsed: StoredDraft<T> | null = null;
    if (raw) {
      // A corrupt or hand-edited entry must not take the page down with it.
      try { parsed = JSON.parse(raw) as StoredDraft<T>; } catch { parsed = null; }
    }

    const verdict = shouldOfferDraft(parsed, {
      recordId, version, isEmpty, serverUpdatedAt,
    });
    setDecision(verdict);

    if (verdict.restore && parsed) {
      setOffer({ data: parsed.data, ageMs: verdict.ageMs });
      return;
    }

    /*
     * Nothing offerable. Anything left behind is noise, so drop it -
     * except when it belongs to another record, which is not ours to
     * delete. Written as an early return above rather than an else so the
     * refusal reason narrows: `restore: true` carries no `reason`, and a
     * verdict that restores can still land here when the entry failed to
     * parse.
     */
    answered.current = true;
    if (parsed && !verdict.restore && verdict.reason !== 'other-record') {
      try { window.localStorage.removeItem(key); } catch { /* ignore */ }
    }
    // Deliberately mount-only: re-reading after the user has started typing
    // would offer them their own older work back mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  // ── Write, debounced ──
  useEffect(() => {
    if (!enabled || !answered.current || cleared.current) return;
    if (isEmpty(data)) return;

    const timer = setTimeout(() => {
      const entry: StoredDraft<T> = {
        data, saved_at: Date.now(), record_id: recordId, version,
      };
      try {
        window.localStorage.setItem(key, JSON.stringify(entry));
        setSavedAt(entry.saved_at);
      } catch {
        /*
         * Quota exceeded, private window, site data blocked. Nothing to do
         * and nothing worth interrupting anybody over - the form still
         * works, it simply has no safety net. Never throw from here.
         */
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [enabled, data, key, recordId, version, isEmpty, debounceMs]);

  const accept = useCallback(() => {
    answered.current = true;
    const taken = offer?.data ?? null;
    setOffer(null);
    return taken;
  }, [offer]);

  const dismiss = useCallback(() => {
    answered.current = true;
    setOffer(null);
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  }, [key]);

  const clear = useCallback(() => {
    // Saved for real. Stop writing, and take the local copy away so it can
    // never be offered back over the saved version.
    cleared.current = true;
    answered.current = true;
    setOffer(null);
    setSavedAt(null);
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  }, [key]);

  return { offer, decision, accept, dismiss, clear, savedAt };
}

/* ═══════════════════════════════════════════════════════════════════════
   Warning before the work goes.

   beforeunload covers closing the tab, reloading and following a link out.
   It cannot cover an in-app route change, because that never unloads the
   document - which is the common case in a single-page app, and the one
   that loses the most work.
   ═══════════════════════════════════════════════════════════════════════ */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // The wording is the browser's; every engine ignores a custom one.
      // Setting returnValue is what actually triggers the prompt.
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

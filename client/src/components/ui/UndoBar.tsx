import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Undo2, Trash2 } from 'lucide-react';
import { UndoQueue, undoSecondsLeft, type PendingUndo, type UndoEntry } from '@lemlist/shared';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   The line that appears after you delete something.

   The queue itself is in shared, where its timing rules can be asserted
   against a fake clock. This is the part that has to touch the browser:
   one bar at the bottom of the screen, a countdown, and the two moments
   where a pending action has to be forced through rather than lost.

   Mounted at the app root and never unmounted, so a delete survives the
   page that started it. The timer lives in a plain object rather than in
   component state for the same reason - React tearing down a route must
   not silently cancel a deletion the user has already been told happened.
   ═══════════════════════════════════════════════════════════════════════ */

interface UndoApi {
  /** Do it in a few seconds, unless they take it back. */
  offer: (entry: UndoEntry) => void;
  /** Send any pending action now. Awaitable, for sign-out. */
  flush: () => Promise<void>;
  /**
   * Ids of rows that have been deleted but not yet committed, plus ones
   * whose delete has gone through and whose list has not caught up.
   *
   * Held here rather than per-page because a delete is often triggered from
   * a dialog over the list - deleting an activity from its own modal has to
   * hide the row in the history behind it, and a set owned by the modal
   * disappears with the modal.
   */
  hidden: ReadonlySet<string>;
  hide: (id: string) => void;
  unhide: (id: string) => void;
}

const UndoContext = createContext<UndoApi | null>(null);

/**
 * The bar itself, and the only one in the app.
 *
 * There are two undo mechanisms here on purpose - see UNDO_WINDOW_MS and
 * UNDO_REVERSE_WINDOW_MS in shared - and for a while they looked entirely
 * different, a toast in one place and this in another. The same gesture
 * wearing two faces reads as two features, so both render this.
 */
export function UndoBarShell({ label, onUndo, secondsLeft, action = 'Undo' }: {
  label: string;
  onUndo: () => void;
  /** Omitted when the action has already happened and is merely reversible. */
  secondsLeft?: number;
  action?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] py-2 pl-3.5 pr-2 shadow-[var(--shadow-xl)]">
      <Trash2 className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
      <span className="text-[12.5px] font-medium text-[var(--text-primary)]">{label}</span>
      <button
        type="button"
        onClick={onUndo}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold text-[var(--indigo)] transition-colors hover:bg-[var(--bg-hover)]"
        data-undo-action
      >
        <Undo2 className="h-3.5 w-3.5" />
        {action}
        {/* The countdown belongs only to the deferred kind, where it says
            how long until the thing actually happens. On a reversal it
            would be a countdown to nothing. */}
        {secondsLeft != null && (
          <span className="tabular-nums font-normal text-[var(--text-tertiary)]">{secondsLeft}s</span>
        )}
      </button>
    </div>
  );
}

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingUndo | null>(null);
  /** Ticks once a second, only while something is pending. */
  const [now, setNow] = useState(() => Date.now());

  /*
   * One queue for the life of the app. Built in a ref rather than state so
   * it is never reconstructed - a new queue would drop the timer of a
   * delete already in flight, and the row would quietly come back.
   */
  const queueRef = useRef<UndoQueue>();
  if (!queueRef.current) {
    queueRef.current = new UndoQueue({
      onChange: (next) => { setPending(next); setNow(Date.now()); },
      onError: (entry, error: any) => {
        // The row has already been put back by the queue. Say why.
        toast.error(
          error?.response?.data?.error || error?.message || `Could not complete: ${entry.label.toLowerCase()}`,
        );
      },
    });
  }
  const queue = queueRef.current;

  const offer = useCallback((entry: UndoEntry) => queue.push(entry), [queue]);
  const flush = useCallback(() => queue.flush(), [queue]);

  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const hide = useCallback((id: string) => setHidden((prev) => new Set(prev).add(id)), []);
  const unhide = useCallback((id: string) => setHidden((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  }), []);

  // Countdown. Nothing runs while the bar is down.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [pending]);

  /*
   * A tab closing mid-window.
   *
   * Two seconds into a six-second offer, the request has not been sent.
   * Closing the tab would lose it entirely and the record would be back on
   * the next visit - having already been reported gone. Flushing here is
   * best effort (the browser may cut the request off), but the alternative
   * is guaranteed loss rather than probable success.
   */
  useEffect(() => {
    const onHide = () => { void queue.flush(); };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [queue]);

  const api = useMemo<UndoApi>(() => ({ offer, flush, hidden, hide, unhide }), [offer, flush, hidden, hide, unhide]);
  const secondsLeft = undoSecondsLeft(pending, now);

  return (
    <UndoContext.Provider value={api}>
      {children}
      {pending && createPortal(
        <div
          className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2"
          style={{ animation: 'cmdkIn 180ms var(--ease-out) both' }}
          role="status"
          data-undo-bar
        >
          <UndoBarShell
            label={pending.label}
            onUndo={() => queue.undo(pending.id)}
            secondsLeft={secondsLeft}
          />
        </div>,
        document.body,
      )}
    </UndoContext.Provider>
  );
}

/**
 * @returns `defer(entry)` — removes it now, sends the request shortly.
 *
 * Named for what it does, because `hooks/useUndoable` already existed and
 * does the OPPOSITE: it runs the action immediately and offers a real
 * reversing call afterwards. Two hooks called useUndoable with different
 * signatures is a wrong import waiting to happen, and the wrong one here
 * either deletes something twice or not at all.
 *
 * With no provider mounted the action is run straight away rather than
 * dropped: a component rendered outside the app shell must still do what
 * it was asked, even if nothing can offer it back.
 */
export function useDeferredAction(): (entry: UndoEntry) => void {
  const ctx = useContext(UndoContext);
  return useCallback((entry: UndoEntry) => {
    if (ctx) { ctx.offer(entry); return; }
    void entry.commit();
  }, [ctx]);
}

/** The pending action, forced through. For sign-out and anything similar. */
export function useFlushUndo(): () => Promise<void> {
  const ctx = useContext(UndoContext);
  return useCallback(async () => { await ctx?.flush(); }, [ctx]);
}

/**
 * Rows on their way out.
 *
 * A row that stays on screen for six seconds after you delete it is the
 * same lie as a dialog nobody reads, pointing the other way. So the list
 * filters it out against a set of ids - no writing into the query cache,
 * whose shape differs on every list here and which a wrong guess would
 * corrupt silently.
 *
 * The set lives in the provider rather than in the page, because deleting
 * an activity from its own modal has to hide the row in the history behind
 * it, and a set owned by the modal goes when the modal does.
 *
 *     const gone = usePendingRemoval();
 *     ...
 *     {rows.filter((r) => !gone.hidden(r.id)).map(...)}
 *     ...
 *     gone.remove(t.id, 'Template deleted', () => del.mutateAsync(t.id))
 *
 * An id is only taken back out of the set on undo or on a failed request.
 * Clearing it after a successful delete would un-hide the row for the
 * moment between the request resolving and the list refetching.
 */
export function usePendingRemoval() {
  const ctx = useContext(UndoContext);
  const defer = useDeferredAction();

  const restore = useCallback((id: string) => ctx?.unhide(id), [ctx]);

  const remove = useCallback((id: string, label: string, commit: () => Promise<unknown>) => {
    ctx?.hide(id);
    defer({
      id,
      label,
      commit,
      // Called on undo and on a failed commit alike - both mean the row is
      // still there and the screen must say so.
      revert: () => { ctx?.unhide(id); },
    });
  }, [ctx, defer]);

  const hiddenIds = ctx?.hidden;
  return useMemo(() => ({
    hidden: (id: string) => !!hiddenIds?.has(id),
    remove,
    restore,
  }), [hiddenIds, remove, restore]);
}

import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { UNDO_REVERSE_WINDOW_MS } from '@lemlist/shared';
import { UndoBarShell } from '../components/ui/UndoBar';

/* ═══════════════════════════════════════════════════════════════════════
   Undo, meaning undo.

   Bulk actions here were instant and final. Suppressing three hundred
   contacts, pulling them out of a campaign mid-sequence, stripping a tag
   off a filtered selection — one click, no way back, and the selection
   that produced it gone the moment the list refetched. The only safety net
   was a confirmation dialog, which is a worse trade than it looks: it
   interrupts every correct action in order to catch the rare wrong one,
   and people learn to click through it without reading.

   So the confirmation goes, and a real reversal takes its place. Not an
   optimistic-update trick that only rolls back the screen — the undo runs
   the actual opposite call against the server, and reports honestly if
   that fails.

   Which means the rule for what belongs here is strict: only actions with
   a true inverse. Deleting contacts has none — the rows are gone.

   That gap is what `useDeferredAction` in components/ui/UndoBar covers: it
   does not run the action at all until the offer expires, which is the only
   honest way back from something with no inverse. The two are opposites and
   both are right for their own case, so the window they use, and the bar
   they draw, come from one place rather than two.
   ═══════════════════════════════════════════════════════════════════════ */

export interface UndoableAction<T> {
  /** Do the thing. Whatever it returns is handed to `undo`. */
  run: () => Promise<T>;
  /** Undo the thing, given what `run` returned. Must actually reverse it. */
  undo: (result: T) => Promise<unknown>;
  /** Past tense, for the toast: "312 contacts suppressed". */
  describe: (result: T) => string;
  /** Query keys to refresh after both the action and its reversal. */
  invalidate?: unknown[][];
}

/**
 * Run an action, then offer a real reversal for a few seconds.
 *
 * The toast holds the only reference to the undo, so dismissing it is a
 * decision too — and once it goes, so does the ability to take it back.
 * That is the honest version of this pattern.
 */
export function useUndoable() {
  const qc = useQueryClient();
  // One in flight at a time: two overlapping undos on the same list would
  // race, and the second would reverse a state the first had already moved.
  const busy = useRef(false);

  const refresh = useCallback((keys?: unknown[][]) => {
    for (const key of keys || []) qc.invalidateQueries({ queryKey: key as any });
  }, [qc]);

  return useCallback(async <T,>(action: UndoableAction<T>): Promise<T | null> => {
    if (busy.current) return null;
    busy.current = true;

    let result: T;
    try {
      result = await action.run();
    } catch (err: any) {
      busy.current = false;
      toast.error(err?.response?.data?.error || 'That did not work');
      return null;
    }

    refresh(action.invalidate);
    busy.current = false;

    toast.custom(
      (t) => (
        <div className={t.visible ? 'animate-in fade-in slide-in-from-bottom-2' : 'opacity-0'}>
          {/* No countdown: this already happened, so there is nothing to
              count down to. The offer simply stands until the toast goes. */}
          <UndoBarShell
            label={action.describe(result)}
            onUndo={async () => {
              toast.dismiss(t.id);
              try {
                await action.undo(result);
                refresh(action.invalidate);
                toast.success('Undone');
              } catch (err: any) {
                // Saying "undone" and meaning "we tried" is how a product
                // loses the right to be believed about anything else.
                toast.error(err?.response?.data?.error || 'Could not undo that — it stands as it is');
              }
            }}
          />
        </div>
      ),
      { duration: UNDO_REVERSE_WINDOW_MS },
    );

    return result;
  }, [refresh]);
}

/**
 * Offer a way back from something that has ALREADY been saved.
 *
 * `useUndoable` above runs the action for you, which is right for a bulk
 * button and wrong for a drag: it holds a `busy` flag that makes a second
 * call a no-op, so dragging two meetings in quick succession would drop
 * the second one on the floor. Dropping a move silently is worse than
 * having no undo at all.
 *
 * So this offers only the way back. The caller runs its own mutation -
 * which on the calendar is already optimistic, so the block stays where it
 * was dropped - and hands over the inverse:
 *
 *     move.mutate({ id, starts_at: next });
 *     offerUndo('Moved to Thu 10:00', () => move.mutateAsync({ id, starts_at: was }));
 *
 * WHY A COMPENSATING WRITE RATHER THAN A DEFERRED ONE. The other mechanism
 * in this app does not send the request until the offer expires, which is
 * the only honest way back from a delete. A calendar move has a true
 * inverse, so it can be saved at once - and it must be, because a drag
 * held for six seconds is a drag lost to a closed tab.
 */
export function useUndoLastChange() {
  const qc = useQueryClient();

  return useCallback((label: string, undo: () => Promise<unknown>, invalidate?: unknown[][]) => {
    toast.custom(
      (t) => (
        <div className={t.visible ? 'animate-in fade-in slide-in-from-bottom-2' : 'opacity-0'}>
          <UndoBarShell
            label={label}
            onUndo={async () => {
              toast.dismiss(t.id);
              try {
                await undo();
                for (const key of invalidate || []) qc.invalidateQueries({ queryKey: key as any });
                toast.success('Undone');
              } catch (err: any) {
                // Saying "undone" and meaning "we tried" is how a product
                // loses the right to be believed about anything else.
                toast.error(err?.response?.data?.error || 'Could not undo that — it stands as it is');
              }
            }}
          />
        </div>
      ),
      /*
       * One id for all of them, so a second drag REPLACES the first offer
       * rather than stacking a second bar on top of it. Two ways back on
       * screen at once, each pointing at a different change, is a thing
       * nobody can read and nobody can aim at.
       */
      { id: 'calendar-undo', duration: UNDO_REVERSE_WINDOW_MS },
    );
  }, [qc]);
}

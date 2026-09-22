import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import toast from 'react-hot-toast';
import { failureToast } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The screen moves when you click, not when the server answers.

   MEASURED BEFORE THIS LANDED: 189 mutations in this app, 10 of which
   updated the screen before the round trip. The other 179 froze - ticking
   a task, starring a message, moving a deal, archiving a reply - and this
   is the slowness people feel most sharply, because it is the slowness
   they personally caused.

   WHY A HELPER AND NOT 179 HAND-WRITTEN ONES

   The ten that existed were each written out longhand, and every one of
   them had the same gap:

       await qc.cancelQueries({ queryKey: ['crm', 'tasks'] });
       const prev = qc.getQueryData(['crm', 'tasks']);
       qc.setQueryData(['crm', 'tasks'], ...)

   `setQueryData` with an exact key patches ONE cache. The same task is
   also in ['crm','tasks',filter] and in the dashboard's today panel, and
   those were left showing the old value until something invalidated them.
   So a tick was instant in one place and lagged in two others, which is
   worse than being uniformly slow: it looks like a bug rather than a wait.

   This patches every cached query under a key PREFIX, and finds the row
   wherever it is in the response shape - a bare array, {items:[]},
   {messages:[],total} - because those differ per endpoint and a helper
   that only understood one of them would quietly do nothing for the rest.

   WHAT IT IS NOT FOR

   Creates, and anything whose result the client cannot predict. An
   optimistic create has to invent an id and then reconcile it, and a
   guessed value that turns out wrong is a worse experience than a short
   wait. This is for changes where the new state is already known at the
   moment of the click.
   ═══════════════════════════════════════════════════════════════════════ */

/** How deep to look for the row before giving up. */
const MAX_DEPTH = 4;

/**
 * Replace the object carrying `id` wherever it sits in a cached response.
 *
 * Returns the SAME REFERENCE when nothing matched, so React Query's
 * structural sharing and every memo downstream of it keep working - a
 * helper that returned a fresh object every time would re-render every
 * list in the app on every keystroke of every mutation.
 */
function patchRow(node: unknown, id: string, patch: (row: any) => object, depth = 0): unknown {
  if (depth > MAX_DEPTH || node == null || typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const v = patchRow(item, id, patch, depth + 1);
      if (v !== item) changed = true;
      return v;
    });
    return changed ? next : node;
  }

  const obj = node as Record<string, unknown>;

  // Dates, Maps and the like are not response rows and must not be spread.
  if (obj.constructor && obj.constructor !== Object) return node;

  if (obj.id === id) {
    const fields = patch(obj);
    /*
     * Only patch fields the row already has.
     *
     * The scope is a key prefix, so an unrelated object that happens to
     * carry the same id could be reached. Requiring the field to exist
     * already is what keeps this from inventing `is_done` on a company.
     */
    const applicable = Object.keys(fields).filter((k) => k in obj);
    if (applicable.length === 0) return node;
    const next = { ...obj } as Record<string, unknown>;
    for (const k of applicable) next[k] = (fields as any)[k];
    return next;
  }

  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const p = patchRow(v, id, patch, depth + 1);
    if (p !== v) changed = true;
    next[k] = p;
  }
  return changed ? next : node;
}

export interface OptimisticRowOptions<TVars> {
  /**
   * Key prefix of every cache this row can appear in, e.g. `['crm']`.
   *
   * A prefix rather than an exact key on purpose - see the note above
   * about a tick being instant in one list and late in two others.
   */
  scope: QueryKey;
  /** Which row this mutation is about. */
  id: (vars: TVars) => string | undefined;
  /**
   * The fields to change, given the row as it is now.
   *
   * Receives the current row so a toggle can be expressed as one - the
   * caller must not read state captured at render time, which is a
   * keystroke out of date by the time two clicks land in a row.
   */
  patch: (vars: TVars, row: any) => Record<string, unknown>;
  /**
   * Run after the rollback when the request fails.
   *
   * Optional. With nothing here the standard failure toast is shown, so a
   * mutation does not go quiet just because it opted into this - see the
   * note in onError about why that is not automatic.
   */
  onError?: (error: unknown, vars: TVars) => void;
}

interface Ctx { snapshots: Array<[QueryKey, unknown]> }

/**
 * The three handlers, ready to spread into a useMutation.
 *
 *     const optimistic = useOptimisticRow<CrmTask>({
 *       scope: ['crm'],
 *       id: (t) => t.id,
 *       patch: (_t, row) => ({
 *         is_done: !row.is_done,
 *         completed_at: !row.is_done ? new Date().toISOString() : null,
 *       }),
 *     });
 *     useMutation({ mutationFn: (t) => crmApi.toggleTask(t.id), ...optimistic });
 *
 * SPREAD IT LAST. An `onError` written after the spread replaces this
 * one, and the rollback goes with it - the row would stay showing a
 * change that never happened. optimistic-update-check.mts fails the build
 * on that ordering; use the `onError` option above instead.
 */
export function useOptimisticRow<TVars>(opts: OptimisticRowOptions<TVars>) {
  const qc = useQueryClient();
  const { scope, id, patch, onError } = opts;
  const scopeKey = JSON.stringify(scope);

  return useMemo(() => ({
    onMutate: async (vars: TVars): Promise<Ctx> => {
      const rowId = id(vars);
      if (!rowId) return { snapshots: [] };

      /*
       * Cancel first, always.
       *
       * A refetch already in flight resolves with the server's OLD value
       * and overwrites the optimistic one - so the row changes, changes
       * back, then changes again when the mutation settles. It is the
       * single most common way an optimistic update looks broken, and it
       * only shows up under a slow connection.
       */
      await qc.cancelQueries({ queryKey: scope });

      const snapshots = qc.getQueriesData({ queryKey: scope });
      qc.setQueriesData({ queryKey: scope }, (old: unknown) =>
        patchRow(old, rowId, (row) => patch(vars, row)));

      return { snapshots: snapshots as Array<[QueryKey, unknown]> };
    },

    onError: (error: unknown, vars: TVars, ctx: Ctx | undefined) => {
      for (const [key, data] of ctx?.snapshots || []) qc.setQueryData(key, data);

      /*
       * Say something, always.
       *
       * queryClient's mutationCache shows a failure toast only for
       * mutations with no onError of their own - and this helper gives
       * every mutation one. Without this line, opting into an optimistic
       * update would silently opt out of being told when it failed, and
       * the row would snap back with no explanation.
       */
      if (onError) onError(error, vars);
      else toast.error(failureToast(error, 'Could not save that'));
    },

    onSettled: () => {
      /*
       * Reconcile, but not in the middle of a burst.
       *
       * Ticking four tasks quickly leaves four mutations in flight.
       * Invalidating on the first one to settle refetches a list the other
       * three have already changed optimistically, and they all flicker
       * back to their old values. Only the last one out reconciles.
       */
      if (qc.isMutating() <= 1) void qc.invalidateQueries({ queryKey: scope });
    },
  }), [qc, scopeKey, id, patch, onError]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Exported for the harness, which asserts the shape-walking really works. */
export const __patchRow = patchRow;

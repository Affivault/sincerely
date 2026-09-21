import { QueryClient, MutationCache, QueryCache } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { failureToast, shouldAutoRetry } from '@lemlist/shared';

// A failed query silently resolves to `data: undefined` with no error surface of its
// own (unlike mutations, queries have no per-call onError in v5) — several pages ended
// up rendering a misleading "you have none of this" empty state on a fetch failure
// that was really a network blip. Surface it once per query so it reads as "couldn't
// load" rather than "empty" ­— retried background polls (e.g. unread-count) won't spam
// the same toast every interval; it resets once that query succeeds again. Pass
// `meta: { silentError: true }` on a query to opt out (e.g. deliberately-optional lookups).
const toastedQueryHashes = new Set<string>();

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error: any, query) => {
      if (query.meta?.silentError) return;
      if (toastedQueryHashes.has(query.queryHash)) return;
      toastedQueryHashes.add(query.queryHash);
      /*
       * One description of a failure, wherever it appears.
       *
       * This used to reach past the error for a server message and fall
       * back to error.message - which is how somebody offline got
       * "Network Error" in a toast and "Could not reach the server" in a
       * panel, for one event. describeFailure decides once; the toast is
       * the short form of the same answer.
       */
      toast.error(failureToast(error, 'Failed to load data'));
    },
    onSuccess: (_data, query) => {
      toastedQueryHashes.delete(query.queryHash);
    },
  }),
  // Fallback surface for mutations that forget their own onError handler —
  // without this, a failed delete/revoke/duplicate fails completely silently
  // and the user has no way to know the action didn't happen.
  mutationCache: new MutationCache({
    onError: (error: any, _variables, _context, mutation) => {
      if (mutation.options.onError) return;
      toast.error(failureToast(error, 'Something went wrong'));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      /*
       * Retry only what could plausibly succeed.
       *
       * A flat `retry: 1` retries a 404 and a 403 exactly as eagerly as a
       * dropped connection - two round trips to be told the same thing,
       * and the person finds out later than they needed to. shouldAutoRetry
       * reads the status.
       */
      retry: (failureCount, error) => shouldAutoRetry(failureCount, error, 2),
    },
  },
});

import { QueryClient, MutationCache, QueryCache } from '@tanstack/react-query';
import toast from 'react-hot-toast';

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
      toast.error(error?.response?.data?.error || error?.message || 'Failed to load data');
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
      toast.error(error?.response?.data?.error || error?.message || 'Something went wrong');
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

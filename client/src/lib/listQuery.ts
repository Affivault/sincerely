import { keepPreviousData } from '@tanstack/react-query';

/* ═══════════════════════════════════════════════════════════════════════
   Lists that do not blank when you change your mind about them.

   MEASURED BEFORE THIS LANDED: twenty-one queries in this app carry a
   search term, a tab, a page number or a date range in their key, and
   exactly one of them kept its data across a change. Every other one
   dropped to a skeleton:

       ['inbox', folder, tagFilter, search, messageLimit]
       ['suppression', page, search, reasonFilter]
       ['companies', debounced]
       ['analytics', 'trend', days]
       ['reply-queue', filter]

   React Query treats a changed key as a different question, and with no
   cached answer to that question it reports isLoading - so typing one
   letter in a search box wiped the table and rebuilt it, switching a tab
   blinked, and changing the analytics range cleared the charts.

   The worst instance: messageLimit is in the Unibox key, so pressing Load
   more threw away the fifty messages you were reading and replaced the
   whole list with a skeleton. React Query was holding those fifty rows the
   entire time.

   THE FIX IS ONE LINE PER QUERY, and it is this one.

   WHY THE AFFORDANCE IS NOT OPTIONAL
   ----------------------------------
   Keeping the previous rows means that for a couple of hundred
   milliseconds the screen shows the answer to the PREVIOUS question while
   the controls show the new one. Left unmarked that is a small lie of
   exactly the kind the rest of this codebase refuses: the filter says
   Archived and the rows are still the inbox.

   So a query that keeps its previous data has to say that it is doing so -
   `isPlaceholderData` drives either a busy search box or a progress bar
   over the list. list-continuity-check.mts fails the build on a query that
   takes the first half without the second.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Spread into any query whose key carries a filter, page, tab or search.
 *
 *     useQuery({
 *       queryKey: ['companies', debounced],
 *       queryFn: () => companiesApi.list(debounced || undefined),
 *       ...keepPrevious,
 *     })
 *
 * The previous result stays on screen and `isPlaceholderData` goes true
 * until the new one lands. `isLoading` stays false throughout, so a page
 * already written as `isLoading ? <Skeleton/> : <Rows/>` simply stops
 * taking the skeleton branch.
 *
 * NOT for a query whose key changes because the RECORD changed - a
 * contact detail keyed by id, say. There the previous data is a different
 * person's, and showing one person's details under another's name for a
 * few hundred milliseconds is worse than a skeleton, not better.
 */
export const keepPrevious = { placeholderData: keepPreviousData } as const;

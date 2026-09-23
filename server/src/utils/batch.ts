/* ═══════════════════════════════════════════════════════════════════════
   Asking about a lot of rows at once.

   PostgREST puts an `.in()` filter in the URL, and a URL has a ceiling.
   Four hundred uuids is roughly fifteen kilobytes of query string, which
   is past what the gateway in front of the database will accept - so a
   bulk action over a big selection did not fail slowly, it failed
   outright, and usually with an error nothing surfaced. Several services
   already chunked for this; the ones that did not were the ones people
   reach for with the biggest selections (add to list, tag, delete, add to
   campaign).

   Separately, a select comes back capped at a thousand rows unless it is
   paged, and a cap nobody asked for is a silent truncation: an export that
   stops at 1,000, a count that never goes past it.

   Two helpers, one for each.
   ═══════════════════════════════════════════════════════════════════════ */

/** Comfortably under the URL ceiling for a list of uuids. */
export const IN_CHUNK = 200;

/** PostgREST's default max rows per response. */
export const PAGE_ROWS = 1000;

export function chunk<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Run one query per slice of `items` and concatenate the rows.
 *
 * Throws the first error rather than returning what it has: a partial answer
 * here reads as "those rows do not exist", which is exactly the kind of wrong
 * that the callers (ownership checks, suppression checks) cannot afford.
 */
export async function selectInChunks<T, R = any>(
  items: readonly T[],
  run: (slice: T[]) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>,
  size = IN_CHUNK,
): Promise<R[]> {
  const rows: R[] = [];
  for (const slice of chunk(items, size)) {
    const { data, error } = await run(slice);
    if (error) throw new Error(error.message);
    if (data) rows.push(...data);
  }
  return rows;
}

/** Page through a query until a short page says there is nothing left. */
export async function fetchAllPages<R = any>(
  page: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: { message: string } | null }>,
  pageSize = PAGE_ROWS,
): Promise<R[]> {
  const rows: R[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const got = data || [];
    rows.push(...got);
    if (got.length < pageSize) break;
  }
  return rows;
}

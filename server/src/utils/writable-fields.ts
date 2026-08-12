/* ═══════════════════════════════════════════════════════════════════════
   What a request body is allowed to write.

   Four times now the same hole has turned up: a service takes `req.body`
   and hands it to Postgres. Every one of these tables has a `user_id`
   column, and an UPDATE scoped `WHERE id = ? AND user_id = me` will still
   happily SET user_id to somebody else — the row matches, then leaves.
   The record is gone from the owner's account and sitting in the
   attacker's, with whatever it carried.

   On smtp_accounts that is a connected mailbox and its stored credentials.
   It is also worse than a handover: `sends_today` is the counter the daily
   cap and the warm-up ramp are enforced on, so a body that sets it to zero
   removes the sending limits entirely, and `smtp_pass_encrypted` lets a
   caller write ciphertext straight past encrypt().

   Fixing each site as it is found has not worked, so this closes the class:

     · `writable()` filters a body down to named columns.
     · `assertNoProtectedColumns()` is a second line — it throws if a
       payload contains a column no request should ever set, whichever
       route built it, so a future write added without an allow-list fails
       loudly instead of silently being exploitable.
     · scripts/audit-write-paths.mts walks every service and fails if any
       request-derived write isn't filtered.
   ═══════════════════════════════════════════════════════════════════════ */

import { AppError } from '../middleware/error.middleware.js';

/**
 * Columns no HTTP request may ever set, on any table.
 *
 * Ownership and identity (a row must not be able to change hands or its
 * primary key), audit timestamps, and the counters that enforce sending
 * limits — those are the server's to move, and a client that could set
 * them could send without limit.
 */
const NEVER_WRITABLE = new Set([
  'id',
  'user_id',
  'org_id',
  'owner_id',
  'created_at',
  'updated_at',
  // Credential material — only ever written by the encrypt path.
  'smtp_pass_encrypted',
  'imap_pass_encrypted',
  'api_key_hash',
  'secret_hash',
  'access_token',
  'refresh_token',
  // Sending limits and reputation. Writable by a request means unlimited
  // sending on a mailbox that has not been warmed.
  'sends_today',
  'warmup_sent_today',
  'health_score',
  'bounce_count',
  'last_send_at',
]);

/**
 * Reduce a request body to the columns a caller is allowed to set.
 *
 * Unknown keys are dropped rather than rejected: clients legitimately echo
 * back whole objects they were given, and failing those requests would
 * break the app for no security gain. What matters is that nothing outside
 * the list reaches the database.
 */
export function writable<T extends string>(
  body: unknown,
  allowed: readonly T[] | ReadonlySet<T>,
): Record<string, any> {
  const set = allowed instanceof Set ? allowed : new Set(allowed as readonly T[]);
  const out: Record<string, any> = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (set.has(key as T) && !NEVER_WRITABLE.has(key)) out[key] = value;
  }
  return out;
}

/**
 * Throw if a payload carries a column no request should set.
 *
 * Belt to `writable()`'s braces, for payloads assembled by hand. Server-side
 * code that genuinely needs to set one of these — the encrypt path writing
 * `smtp_pass_encrypted`, the SSE engine moving `sends_today` — passes it in
 * `alsoAllowed`, which makes the exception visible at the call site rather
 * than implicit in the absence of a check.
 */
export function assertNoProtectedColumns(
  payload: Record<string, any>,
  alsoAllowed: readonly string[] = [],
): void {
  const permitted = new Set(alsoAllowed);
  const offending = Object.keys(payload).filter((k) => NEVER_WRITABLE.has(k) && !permitted.has(k));
  if (offending.length > 0) {
    throw new AppError(`These fields cannot be set: ${offending.join(', ')}`, 400);
  }
}

/** Exposed for the audit script and its tests. */
export function protectedColumns(): string[] {
  return [...NEVER_WRITABLE].sort();
}

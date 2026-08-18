/**
 * Sincerely API client.
 *
 * Imported only by the service worker. Content scripts and the popup never see
 * the API key — they message the worker instead. A content script shares its
 * world with the page, so a key there would be readable by any script on
 * LinkedIn or Gmail.
 *
 * Auth is an API key (sk_live_...), minted on the app's /developer page. The
 * server's apiKeyMiddleware maps GET/HEAD to the `read` scope and everything
 * else to `write`, so a key needs both for add/remove to work.
 */

import { getSettings } from './storage.js';

export class ApiError extends Error {
  /**
   * @param {string} message Server-authored text where available — the API
   *   already writes end-user-facing messages ("Selected contacts are not in
   *   this campaign's lead list…"), so we surface them verbatim rather than
   *   inventing our own.
   * @param {{status?: number, code?: string, retryAfterSeconds?: number, requiredScope?: string}} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = meta.status ?? 0;
    this.code = meta.code ?? null;
    this.retryAfterSeconds = meta.retryAfterSeconds ?? null;
    this.requiredScope = meta.requiredScope ?? null;
  }

  /** True when the fix is "go fix your settings", not "try again". */
  get isAuthProblem() {
    return this.status === 401 || this.code === 'NO_KEY' || this.code === 'SCOPE';
  }

  /** Plain object — Error instances don't survive chrome.runtime messaging. */
  toJSON() {
    return {
      message: this.message,
      status: this.status,
      code: this.code,
      retryAfterSeconds: this.retryAfterSeconds,
      requiredScope: this.requiredScope,
      isAuthProblem: this.isAuthProblem,
    };
  }
}

/** Comfortable ceiling for a server that's already awake. */
const REQUEST_TIMEOUT_MS = 20000;

/* ─────────────────────────── Rate-limit pacing ───────────────────────────
 * API keys are limited per minute, and this extension's ordinary work is
 * bursty by nature: one "add this person" is up to seven requests, and
 * checking a page of search results is dozens. So the limit gets reached
 * during entirely normal use.
 *
 * What made that a user-visible failure was not the limit — it was that
 * nothing here did anything about it. The 429 handler below has always read
 * `Retry-After` and attached it to the error, and nothing ever looked at it
 * again: the extension knew exactly how long to wait and gave up instead,
 * reporting "rate limit reached" for work that would have succeeded a few
 * seconds later.
 *
 * Two halves now. The server publishes the remaining budget on every reply,
 * so the last few requests of a window are spread across the time left
 * rather than fired into the wall. And if the wall is hit anyway, the
 * request waits out the server's own stated interval and goes again.
 * ───────────────────────────────────────────────────────────────────────── */

/** Start spreading requests out once the window has this little left. */
const PACE_THRESHOLD = 10;
/** However thin the budget, never stall a single request longer than this. */
const MAX_PACE_GAP_MS = 3000;
/** A Retry-After longer than this is not worth holding a click open for. */
const MAX_RETRY_WAIT_MS = 45000;
/** How many windows to wait out before admitting the limit is not lifting. */
const MAX_RATE_RETRIES = 2;

/** What the server last said about this key's budget. */
const budget = { remaining: Infinity, resetAt: 0 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Serialises the gate so concurrent callers queue rather than all reading the
 * same `remaining` and deciding, together, that there is room for one more.
 */
let paceQueue = Promise.resolve();

/** Hold this request back just long enough that the budget outlasts the window. */
function pace() {
  paceQueue = paceQueue.then(async () => {
    const msLeft = budget.resetAt - Date.now();
    if (msLeft <= 0) {
      // Window has rolled over; the recorded budget is stale, not spent.
      budget.remaining = Infinity;
      return;
    }
    if (budget.remaining > PACE_THRESHOLD) return;
    if (budget.remaining <= 0) {
      // Nothing left at all: the only useful thing to do is outlast it.
      await sleep(Math.min(msLeft + 250, MAX_RETRY_WAIT_MS));
      budget.remaining = Infinity;
      return;
    }
    // Spread what is left across the time that is left.
    await sleep(Math.min(msLeft / budget.remaining, MAX_PACE_GAP_MS));
  }, () => {});
  return paceQueue;
}

/** Record what the server just told us about the budget. */
function noteBudget(response) {
  const remaining = Number(response.headers.get('X-RateLimit-Remaining'));
  const reset = Number(response.headers.get('X-RateLimit-Reset'));
  if (!Number.isFinite(remaining) || !Number.isFinite(reset)) return;
  budget.remaining = remaining;
  budget.resetAt = Date.now() + reset * 1000;
}

/**
 * Second-chance timeout for a host that didn't answer the first time.
 *
 * Free-tier hosts (Render, Fly, Heroku-likes) spin the process down after a
 * few minutes idle and cold-start it on the next request, which regularly
 * takes 50-60s. Failing at 20s would make the extension look broken every
 * morning, so a timeout buys one longer retry rather than an error.
 */
const COLD_START_TIMEOUT_MS = 75000;

/** Thrown internally so the retry logic can tell a timeout from a dead host. */
class TimeoutError extends Error {}

/**
 * One request, with the per-minute budget respected on the way in and waited
 * out on the way back.
 *
 * Retrying a 429 is safe for every method, including writes: the limiter sits
 * in middleware and rejects before the route handler runs, so a rejected
 * request changed nothing and repeating it cannot double-write.
 *
 * @param {string} path Path below the API root, e.g. "/lists".
 * @param {{method?: string, body?: unknown, query?: Record<string, string|number|undefined>, timeoutMs?: number, retryOnTimeout?: boolean}} [opts]
 * @returns {Promise<any>} Parsed JSON, or null for 204.
 */
async function request(path, opts = {}) {
  for (let attemptNo = 0; ; attemptNo++) {
    await pace();
    try {
      return await attemptRequest(path, opts);
    } catch (err) {
      const rateLimited = err instanceof ApiError && err.code === 'RATE_LIMIT';
      // Bounded deliberately. Waiting out one window is recovery; waiting out
      // an unbounded number of them is a click that never returns, and at
      // that point the honest thing is to say the limit is not lifting.
      if (!rateLimited || attemptNo >= MAX_RATE_RETRIES) throw err;

      // A second refusal straight after the first is not a surprise: the
      // window rolls over with a full budget and whatever this extension had
      // queued goes at once, which can spend it again before this request is
      // served.
      const waitMs = Math.min((err.retryAfterSeconds || 60) * 1000 + 250, MAX_RETRY_WAIT_MS);
      console.warn(`[Sincerely] Rate limited; waiting ${Math.round(waitMs / 1000)}s before trying again.`);
      await sleep(waitMs);
      budget.remaining = Infinity;
      budget.resetAt = 0;
    }
  }
}

/**
 * @param {string} path
 * @param {{method?: string, body?: unknown, query?: Record<string, string|number|undefined>, timeoutMs?: number, retryOnTimeout?: boolean}} [opts]
 * @returns {Promise<any>}
 */
async function attemptRequest(path, opts = {}) {
  const { apiBaseUrl, apiKey } = await getSettings();

  if (!apiKey) {
    throw new ApiError('No API key set. Open the extension options and paste a key from your Sincerely /developer page.', {
      code: 'NO_KEY',
    });
  }

  const url = new URL(`${apiBaseUrl}${path}`);
  for (const [key, value] of Object.entries(opts.query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const origin = new URL(apiBaseUrl).origin;

  /**
   * One fetch attempt.
   * AbortSignal.timeout would be terser, but an explicit controller lets us
   * tell a timeout apart from a network failure.
   * @param {number} timeoutMs
   */
  const attempt = async (timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: opts.method || 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw new TimeoutError();
      // DNS failure, refused connection, blocked origin — no point retrying
      // with a longer clock, so surface it straight away.
      throw new ApiError(
        `Couldn't reach ${origin}. Check the API URL in options, and that the server is running.`,
        { code: 'NETWORK' }
      );
    } finally {
      clearTimeout(timer);
    }
  };

  const firstTimeout = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let response;
  try {
    response = await attempt(firstTimeout);
  } catch (err) {
    if (!(err instanceof TimeoutError)) throw err;
    if (opts.retryOnTimeout === false) {
      throw new ApiError(`${origin} didn't respond within ${Math.round(firstTimeout / 1000)}s.`, { code: 'TIMEOUT' });
    }

    // Nothing came back in time. Most likely the host is cold-starting, so
    // give it one long attempt before calling it dead.
    try {
      response = await attempt(COLD_START_TIMEOUT_MS);
    } catch (retryErr) {
      if (!(retryErr instanceof TimeoutError)) throw retryErr;
      throw new ApiError(
        `${origin} didn't respond within ${Math.round(COLD_START_TIMEOUT_MS / 1000)}s, even after waiting for a cold start.\n\n` +
          `If it's on a free hosting tier it may be suspended rather than merely asleep — open ${origin}/health in a tab and see whether it eventually loads.`,
        { code: 'TIMEOUT' }
      );
    }
  }

  noteBudget(response);

  if (response.status === 204) return null;

  // A misconfigured base URL often returns HTML (an app shell, a proxy error
  // page). Parsing that as JSON would throw something unhelpful, so say what
  // actually happened.
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      if (response.ok) {
        throw new ApiError(`Expected JSON from ${url.pathname} but got ${response.headers.get('content-type') || 'an unknown format'}. Is the API URL pointing at your API and not the web app?`, {
          status: response.status,
          code: 'BAD_RESPONSE',
        });
      }
    }
  }

  if (response.ok) return payload;

  const serverMessage = payload?.error || payload?.message;

  if (response.status === 401) {
    throw new ApiError(serverMessage || 'API key rejected. It may have been revoked or expired — mint a new one on /developer.', {
      status: 401,
      code: 'UNAUTHORIZED',
    });
  }

  if (response.status === 403 && payload?.required_scope) {
    throw new ApiError(`This key lacks the "${payload.required_scope}" scope. Create a key with both read and write scopes.`, {
      status: 403,
      code: 'SCOPE',
      requiredScope: payload.required_scope,
    });
  }

  if (response.status === 429) {
    const retryAfter = Number(payload?.retry_after_seconds || response.headers.get('Retry-After') || 0);
    throw new ApiError(serverMessage || `Rate limit reached. Try again in ${retryAfter || 60}s.`, {
      status: 429,
      code: 'RATE_LIMIT',
      retryAfterSeconds: retryAfter || 60,
    });
  }

  throw new ApiError(serverMessage || `Request failed (HTTP ${response.status}).`, {
    status: response.status,
    code: payload?.code ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Lead lists                                                         */
/* ------------------------------------------------------------------ */

/**
 * Every lead list on the account.
 *
 * Lists are what the extension adds people to. A campaign is bound to one list
 * and draws from it, so putting someone on the list is what actually gets them
 * emailed — enrolling them into a campaign directly was reaching past the thing
 * that owns membership.
 *
 * Returned already sorted by the server: the default list first, then by name.
 *
 * @returns {Promise<Array<{id: string, name: string, contact_count: number, is_default: boolean}>>}
 */
export async function listLists() {
  const lists = await request('/lists');
  return Array.isArray(lists) ? lists : [];
}

/**
 * Which lists actually feed a live campaign.
 *
 * Adding somebody to a list that no campaign draws from is a no-op dressed as
 * progress — the extension reported "Added", and nothing was ever sent. This is
 * the fact that turns that into an informed choice.
 *
 * One request for the whole picker rather than one per list, and failure is
 * silent: not knowing is a reason to say nothing, never a reason to block an
 * add that would have worked.
 *
 * @returns {Promise<Map<string, {live: number, paused: number, name: string|null}>>}
 *   list id → what is bound to it.
 */
export async function campaignsByList() {
  /** Anything that will send now or is scheduled to. */
  const LIVE = new Set(['running', 'scheduled']);
  const HELD = new Set(['draft', 'paused']);

  const byList = new Map();

  // Page through every campaign — the server caps a single page at 500, so an
  // account with more than that would otherwise have its later campaigns
  // (and the lists they draw from) silently missing, misreporting a working
  // list as "no campaign draws from this".
  for (let page = 1; ; page++) {
    const result = await request('/campaigns', { query: { limit: 500, page } });

    for (const campaign of result?.data || []) {
      const listId = campaign.list_id;
      if (!listId) continue;
      const status = String(campaign.status || '').toLowerCase();
      if (!LIVE.has(status) && !HELD.has(status)) continue;

      const entry = byList.get(listId) || { live: 0, paused: 0, name: null };
      if (LIVE.has(status)) {
        entry.live += 1;
        // Name the live one where there is a choice: that is the campaign that
        // will actually pick these people up.
        if (!entry.name || entry.live === 1) entry.name = campaign.name || null;
      } else {
        entry.paused += 1;
        if (!entry.name) entry.name = campaign.name || null;
      }
      byList.set(listId, entry);
    }

    const totalPages = result?.total_pages ?? 1;
    if (page >= totalPages) break;
  }

  return byList;
}

/**
 * Make a new lead list.
 *
 * The extension can create the destination it needs. Without this, somebody
 * connecting a fresh account met "No lead lists on this account yet. Create one
 * in Sincerely first." — a dead end in a popup, from a tool whose entire job is
 * putting people on lists.
 *
 * @param {string} name
 * @returns {Promise<{id: string, name: string, contact_count: number}>}
 */
export async function createList(name) {
  return request('/lists', { method: 'POST', body: { name } });
}

/**
 * Which lists a contact is on.
 *
 * The server answers with every list plus an `is_member` flag, so this narrows
 * it to the memberships — the only part the UI has any use for.
 *
 * @param {string} contactId
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function listsForContact(contactId) {
  const lists = await request(`/lists/contact/${contactId}`);
  return (Array.isArray(lists) ? lists : []).filter((list) => list.is_member);
}

/**
 * The contact ids already on a list.
 *
 * One request, rather than one membership lookup per person, which is what
 * makes it affordable to tell "added" from "was already there" on a bulk add —
 * the server upserts, so its reply counts a repeat as a success and cannot
 * distinguish them.
 *
 * @param {string} listId
 * @returns {Promise<Set<string>>}
 */
export async function listContactIds(listId) {
  const result = await request(`/lists/${listId}/contacts`);
  return new Set(result?.contact_ids || []);
}

/**
 * Put contacts on a list.
 *
 * Idempotent server-side (upsert on list_id + contact_id), so re-adding
 * somebody is a no-op rather than an error — which matters because the same
 * person turns up on a second page of a scan often.
 *
 * @param {string} listId
 * @param {string[]} contactIds
 * @returns {Promise<{success: number, failed: number}>}
 */
export async function addToList(listId, contactIds) {
  return request(`/lists/${listId}/contacts`, {
    method: 'POST',
    body: { contact_ids: contactIds },
  });
}

/**
 * Take contacts off a list.
 *
 * They stay in the account, and stay suppressed or not as before — this only
 * ends their membership of this one list.
 *
 * @param {string} listId
 * @param {string[]} contactIds
 */
export async function removeFromList(listId, contactIds) {
  return request(`/lists/${listId}/contacts`, {
    method: 'DELETE',
    body: { contact_ids: contactIds },
  });
}

/* ------------------------------------------------------------------ */
/* Contacts                                                           */
/* ------------------------------------------------------------------ */

/**
 * The server sanitises `search` by stripping % _ , ( ) before building its
 * ILIKE clause. An email containing one of those (john_doe@acme.com) would
 * therefore never match itself. Search the longest chunk that survives
 * sanitising instead, then match exactly on the client.
 *
 * @param {string} email
 * @returns {string}
 */
export function searchTokenFor(email) {
  const chunks = String(email).split(/[%_,()]/).filter(Boolean);
  if (chunks.length === 0) return email;
  return chunks.reduce((longest, chunk) => (chunk.length > longest.length ? chunk : longest), '');
}

/**
 * @param {string} email
 * @returns {Promise<object|null>} The contact, or null if this account doesn't have them.
 */
export async function findContactByEmail(email) {
  const wanted = String(email).trim().toLowerCase();
  if (!wanted) return null;

  const result = await request('/contacts', {
    query: { search: searchTokenFor(wanted), limit: 100 },
  });

  return (result?.data || []).find((c) => String(c.email || '').toLowerCase() === wanted) || null;
}

/**
 * Every contact this account has at a given domain, in one call.
 *
 * Bulk work on a team or directory page is overwhelmingly same-domain, so one
 * search per domain resolves the whole page instead of one lookup per person —
 * which would burn the per-key rate limit for no reason.
 *
 * @param {string} domain e.g. "acme.com"
 * @returns {Promise<Map<string, object>>} lowercased email → contact
 */
export async function contactsByDomain(domain) {
  const result = await request('/contacts', { query: { search: `@${domain}`, limit: 100 } });
  const byEmail = new Map();
  for (const contact of result?.data || []) {
    byEmail.set(String(contact.email || '').toLowerCase(), contact);
  }
  return byEmail;
}

/**
 * Create many contacts in one request. Returns counts, not ids — callers that
 * need ids re-read afterwards.
 *
 * @param {Array<object>} contacts Server caps this at 1000 per request.
 */
export async function bulkCreateContacts(contacts) {
  return request('/contacts/bulk', { method: 'POST', body: { contacts } });
}

/**
 * @param {{email: string, first_name?: string, last_name?: string, company?: string, job_title?: string, linkedin_url?: string}} person
 */
export async function createContact(person) {
  return request('/contacts', {
    method: 'POST',
    body: {
      email: person.email,
      first_name: person.first_name || null,
      last_name: person.last_name || null,
      company: person.company || null,
      job_title: person.job_title || null,
      linkedin_url: person.linkedin_url || null,
    },
  });
}

/**
 * Find the contact or create them, so the caller can go from "an email on a
 * page" to "enrolled" without a CSV round-trip.
 *
 * @param {object} person
 * @returns {Promise<{contact: object, created: boolean}>}
 */
/**
 * Fields a scrape can supply that are worth filling in on a contact that
 * already exists. Not `email` — that is the identity we looked them up by.
 */
const ENRICHABLE = ['first_name', 'last_name', 'company', 'job_title', 'linkedin_url'];

/**
 * What this scrape knows that the stored contact doesn't.
 *
 * Gaps only. A value already on the record wins, always: the user may have
 * corrected a name by hand, and a scrape must never argue with that.
 *
 * @param {Record<string, any>} existing
 * @param {Record<string, any>} person
 * @returns {Record<string, string>}
 */
function fillableGaps(existing, person) {
  const patch = {};
  for (const key of ENRICHABLE) {
    const have = String(existing?.[key] ?? '').trim();
    const found = String(person?.[key] ?? '').trim();
    if (!have && found) patch[key] = found;
  }
  return patch;
}

/** Update a contact in place. Only the keys given are touched. */
export async function updateContact(id, patch) {
  return request(`/contacts/${encodeURIComponent(id)}`, { method: 'PUT', body: patch });
}

export async function resolveOrCreateContact(person) {
  const existing = await findContactByEmail(person.email);
  if (existing) {
    /*
     * Re-adding somebody is the natural way to repair a thin record — it is
     * what anyone would try after finding a lead saved with an email and no
     * name. Until now it did nothing at all: the existing contact was returned
     * untouched, so a blank name stayed blank no matter how many times the
     * profile was scraped again.
     */
    const gaps = fillableGaps(existing, person);
    if (Object.keys(gaps).length > 0) {
      try {
        const updated = await updateContact(existing.id, gaps);
        return { contact: updated || existing, created: false, enriched: Object.keys(gaps) };
      } catch (err) {
        // Filling gaps is a bonus. Failing it must never fail the add, which
        // is what the user actually asked for.
        console.warn('[Sincerely] Could not fill in contact details:', err?.message);
      }
    }
    return { contact: existing, created: false };
  }

  try {
    return { contact: await createContact(person), created: true };
  } catch (err) {
    // 409 means someone (or another tab) created them between our lookup and
    // our insert. Re-read rather than surfacing a conflict the user can't act on.
    if (err instanceof ApiError && err.status === 409) {
      const found = await findContactByEmail(person.email);
      if (found) return { contact: found, created: false };
    }
    throw err;
  }
}

/**
 * Where this contact already stands — every lead list they're on.
 * @param {string} contactId
 */
export async function getContactLists(contactId) {
  return listsForContact(contactId);
}

/**
 * Free-text contact search across email, first/last name and company.
 *
 * This is what makes the extension useful on LinkedIn, which almost never
 * exposes an email: scrape the name, find the contact you already have, and
 * you can see their enrolments and remove them.
 *
 * @param {string} query
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
export async function searchContacts(query, limit = 10) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];
  const result = await request('/contacts', {
    query: { search: searchTokenFor(trimmed), limit },
  });
  return result?.data || [];
}

/** @param {string[]} contactIds @param {string[]} tagIds */
export async function tagContacts(contactIds, tagIds) {
  return request('/contacts/bulk-tag', { method: 'POST', body: { contact_ids: contactIds, tag_ids: tagIds } });
}

/**
 * What actually happened to this contact — sends, opens, clicks, replies.
 * Turns the extension into somewhere you check before reaching out, rather
 * than a one-way chute into a sequence.
 *
 * @param {string} contactId
 * @returns {Promise<Array<{activity_type: string, campaign_name: string, step_subject: string|null, occurred_at: string}>>}
 */
export async function getContactTimeline(contactId) {
  return request(`/analytics/contacts/${contactId}/timeline`);
}

/** @returns {Promise<Array<{id: string, name: string, color: string}>>} */
export async function listTags() {
  return request('/tags');
}

/**
 * Find a tag by name or create it, so callers can tag by label without
 * managing ids. Matching is case-insensitive because that's how people
 * remember tag names.
 *
 * @param {string} name
 * @param {string} [color]
 * @returns {Promise<{id: string, name: string}>}
 */
/**
 * The auto-tag, remembered.
 *
 * Every add applies the same tag, and resolving it meant listing every tag on
 * the account first — one wasted request on every single add, against a budget
 * that one add already spends five of. A tag id does not change once it
 * exists, so this is read once and kept.
 */
const tagCache = new Map();

/** Forget it, after a tag write fails or the configured name changes. */
export function invalidateTagCache() {
  tagCache.clear();
}

export async function ensureTag(name, color = '#5B5BF5') {
  const wanted = name.trim().toLowerCase();
  const cached = tagCache.get(wanted);
  if (cached) return cached;

  const existing = (await listTags()).find((t) => String(t.name).trim().toLowerCase() === wanted);
  if (existing) {
    tagCache.set(wanted, existing);
    return existing;
  }

  try {
    const created = await request('/tags', { method: 'POST', body: { name: name.trim(), color } });
    if (created) tagCache.set(wanted, created);
    return created;
  } catch (err) {
    // 409 means it appeared between our read and our write — re-read rather
    // than failing an add over a tag.
    if (err instanceof ApiError && err.status === 409) {
      const found = (await listTags()).find((t) => String(t.name).trim().toLowerCase() === wanted);
      if (found) {
        tagCache.set(wanted, found);
        return found;
      }
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Enrolment                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Suppression & verification                                         */
/* ------------------------------------------------------------------ */

/**
 * Add an address to the account-wide suppression list — the real
 * "never contact again". Unlike removal, this survives re-imports.
 *
 * @param {string} email
 * @param {string} [reason]
 * @param {string} [notes]
 */
export async function suppressEmail(email, reason = 'manual', notes = '') {
  return request('/suppression', { method: 'POST', body: { email, reason, notes } });
}

/** @param {string} email */
export async function isSuppressed(email) {
  const result = await request('/suppression/check', { query: { email } });
  return Boolean(result?.suppressed);
}

/**
 * The whole suppression list in one read, for checking many people at once.
 *
 * `isSuppressed` costs a request per address, which is fine for one person and
 * ruinous for a page of them — the per-key limit is 100/minute. This answers
 * for everybody in a single call.
 *
 * `complete` says whether the answer can be trusted as exhaustive: the endpoint
 * paginates, so an account with more suppressions than we asked for gives a
 * partial set, and callers must fall back rather than reporting "not
 * suppressed" for someone who is.
 *
 * @param {number} [limit]
 * @returns {Promise<{emails: Set<string>, complete: boolean}>}
 */
export async function listSuppressed(limit = 500) {
  const result = await request('/suppression', { query: { limit, page: 1 } });
  const rows = result?.data || [];
  const emails = new Set(rows.map((row) => String(row.email || '').toLowerCase()).filter(Boolean));
  const total = Number(result?.total ?? rows.length);
  return { emails, complete: rows.length >= total };
}

/**
 * Deliverability check before enrolling, so an obvious dud doesn't burn a
 * send and a bit of domain reputation.
 * @param {string} email
 */
export async function verifyEmail(email) {
  return request('/verification/email', { method: 'POST', body: { email } });
}

/**
 * Work out someone's address at a domain when no page publishes it.
 *
 * Slow by nature — DNS, then a conversation with the domain's mail server — so
 * it gets the cold-start budget rather than the default 20s.
 *
 * @param {{domain: string, first_name?: string, last_name?: string, full_name?: string}} payload
 */
export async function findEmail(payload) {
  return request('/verification/find-email', {
    method: 'POST',
    body: payload,
    timeoutMs: COLD_START_TIMEOUT_MS,
  });
}

/* ------------------------------------------------------------------ */
/* Prospector                                                         */
/* ------------------------------------------------------------------ */

/**
 * Whether a data provider is configured, and how many credits are left.
 * Returns {provider: null} when the account has no provider — the search and
 * reveal endpoints 503 in that case.
 */
export async function prospectorStatus() {
  return request('/prospecting/status');
}

/**
 * Search the people database. Never returns emails — that's what a reveal is
 * for — so this call is free.
 *
 * @param {{keywords?: string, companies?: string[], titles?: string[]}} filters
 */
export async function prospectSearch(filters) {
  return request('/prospecting/search', { method: 'POST', body: { filters, page: 1 } });
}

/**
 * Spend a credit to get someone's work email and save them as a contact.
 *
 * Per docs/PROSPECTOR.md the spend is atomic and automatically refunded when
 * no email is found, so a caller can honestly promise "only charged if we
 * find it". Revealing the same person twice is free.
 *
 * @param {string} providerPersonId
 * @returns {Promise<{found: boolean, email: string|null, contact_id: string|null, already_revealed?: boolean, credits: object}>}
 */
export async function prospectReveal(providerPersonId) {
  return request('/prospecting/reveal', {
    method: 'POST',
    body: { provider_person_id: providerPersonId },
  });
}

/* ------------------------------------------------------------------ */
/* Connection test                                                    */
/* ------------------------------------------------------------------ */

/**
 * Cheapest possible authenticated call, used by the options page's
 * "Test connection". Distinguishes the three failure modes that matter:
 * unreachable URL, bad key, and a key missing the write scope.
 *
 * @returns {Promise<{ok: true, listCount: number, canWrite: boolean}>}
 */
export async function testConnection() {
  // Generous from the outset: this is usually the first request of the
  // session, so it's the one that pays for waking a sleeping host.
  const lists = await request('/lists', { timeoutMs: COLD_START_TIMEOUT_MS });

  // Read worked. Probe write scope without changing anything: adding an empty
  // set of contacts to a list that cannot exist fails on validation or
  // ownership, but only after passing the scope gate — so a 403 here, and only
  // a 403, means the key is read-only.
  let canWrite = true;
  try {
    await request('/lists/00000000-0000-0000-0000-000000000000/contacts', {
      method: 'POST',
      body: { contact_ids: [] },
      // The server is demonstrably awake by now, so don't let this probe
      // stall the whole test if something else is wrong.
      retryOnTimeout: false,
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'SCOPE') canWrite = false;
  }

  return { ok: true, listCount: Array.isArray(lists) ? lists.length : 0, canWrite };
}

/* ------------------------------------------------------------------ */
/* LinkedIn agent                                                     */
/* ------------------------------------------------------------------ */
/**
 * The three calls the LinkedIn agent makes. Note what isn't here: nothing
 * sends a cookie, a session, or anything about the LinkedIn login. The
 * server answers with a public profile URL and the message the user already
 * wrote, and hears back only "done" or "failed".
 */

/** "Is there anything to do right now?" — usually the answer is no. */
export async function agentNext() {
  return request('/linkedin/agent/next');
}

export async function agentDone(taskId) {
  return request(`/linkedin/agent/tasks/${encodeURIComponent(taskId)}/done`, {
    method: 'POST',
    body: {},
  });
}

/** `fatal` stops the agent — a checkpoint is not something to retry into. */
export async function agentFailed(taskId, reason, fatal = false) {
  return request(`/linkedin/agent/tasks/${encodeURIComponent(taskId)}/failed`, {
    method: 'POST',
    body: { reason: String(reason || '').slice(0, 500), fatal: !!fatal },
  });
}

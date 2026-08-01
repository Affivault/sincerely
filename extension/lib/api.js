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
 * @param {string} path Path below the API root, e.g. "/lists".
 * @param {{method?: string, body?: unknown, query?: Record<string, string|number|undefined>, timeoutMs?: number, retryOnTimeout?: boolean}} [opts]
 * @returns {Promise<any>} Parsed JSON, or null for 204.
 */
async function request(path, opts = {}) {
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
export async function resolveOrCreateContact(person) {
  const existing = await findContactByEmail(person.email);
  if (existing) return { contact: existing, created: false };

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
export async function ensureTag(name, color = '#5B5BF5') {
  const wanted = name.trim().toLowerCase();
  const existing = (await listTags()).find((t) => String(t.name).trim().toLowerCase() === wanted);
  if (existing) return existing;

  try {
    return await request('/tags', { method: 'POST', body: { name: name.trim(), color } });
  } catch (err) {
    // 409 means it appeared between our read and our write — re-read rather
    // than failing an add over a tag.
    if (err instanceof ApiError && err.status === 409) {
      const found = (await listTags()).find((t) => String(t.name).trim().toLowerCase() === wanted);
      if (found) return found;
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

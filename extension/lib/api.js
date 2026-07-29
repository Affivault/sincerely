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
 * @param {string} path Path below the API root, e.g. "/campaigns".
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
/* Campaigns                                                          */
/* ------------------------------------------------------------------ */

/** Campaign statuses that will accept an enrolment (server rejects the rest). */
export const ENROLLABLE_STATUSES = ['draft', 'scheduled', 'running', 'paused'];

/**
 * Every campaign on the account, newest first.
 *
 * The server's status filter is a single-value equality check, so "all the
 * ones I can actually enrol into" has to be assembled client-side. Paginates
 * because the server caps limit at 100.
 *
 * @returns {Promise<Array<{id: string, name: string, status: string, total_contacts: number}>>}
 */
export async function listCampaigns() {
  const all = [];
  const MAX_PAGES = 10;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await request('/campaigns', { query: { page, limit: 100 } });
    const batch = result?.data || [];
    all.push(...batch);
    const totalPages = result?.total_pages ?? 1;
    if (page >= totalPages || batch.length === 0) break;
  }

  return all;
}

/**
 * A single campaign, including the lead list it's bound to — which is what
 * decides whether an existing enrolment blocks a new one.
 * @param {string} campaignId
 */
export async function getCampaign(campaignId) {
  return request(`/campaigns/${campaignId}`);
}

/**
 * Campaigns split into the ones you can enrol into and the ones you can't,
 * so the picker can show finished campaigns as disabled instead of letting a
 * click fail with a 400.
 */
export async function listCampaignsGrouped() {
  const campaigns = await listCampaigns();
  return {
    enrollable: campaigns.filter((c) => ENROLLABLE_STATUSES.includes(c.status)),
    finished: campaigns.filter((c) => !ENROLLABLE_STATUSES.includes(c.status)),
  };
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
 * Where this contact already stands — every campaign they're enrolled in,
 * with their per-campaign status and step.
 * @param {string} contactId
 */
export async function getContactCampaigns(contactId) {
  return request(`/contacts/${contactId}/campaigns`);
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

/**
 * Add contacts to a campaign.
 *
 * Uses /enroll rather than /contacts deliberately: campaigns are bound to a
 * lead list, and POST /campaigns/:id/contacts rejects anyone not already in
 * that list. /enroll adds them to the bound list first, then enrols — and
 * returns {added, skipped, total} so we can tell the user when the server
 * silently declined some of them.
 *
 * @param {string} campaignId
 * @param {string[]} contactIds Send them in one call; the default key limit is
 *   100 requests/minute, so per-contact calls would burn it needlessly.
 * @returns {Promise<{added: number, skipped: number, total: number}>}
 */
export async function enrollContacts(campaignId, contactIds) {
  return request(`/campaigns/${campaignId}/enroll`, {
    method: 'POST',
    body: { contact_ids: contactIds },
  });
}

/**
 * Remove contacts from one campaign.
 *
 * This deletes the enrolment only. The contact stays on the campaign's lead
 * list and can be re-enrolled by the next import — if the intent is "never
 * email this person again", call suppressEmail as well.
 *
 * @param {string} campaignId
 * @param {string[]} contactIds
 */
export async function removeFromCampaign(campaignId, contactIds) {
  return request(`/campaigns/${campaignId}/contacts`, {
    method: 'DELETE',
    body: { contact_ids: contactIds },
  });
}

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
 * Deliverability check before enrolling, so an obvious dud doesn't burn a
 * send and a bit of domain reputation.
 * @param {string} email
 */
export async function verifyEmail(email) {
  return request('/verification/email', { method: 'POST', body: { email } });
}

/* ------------------------------------------------------------------ */
/* Connection test                                                    */
/* ------------------------------------------------------------------ */

/**
 * Cheapest possible authenticated call, used by the options page's
 * "Test connection". Distinguishes the three failure modes that matter:
 * unreachable URL, bad key, and a key missing the write scope.
 *
 * @returns {Promise<{ok: true, campaignCount: number, canWrite: boolean}>}
 */
export async function testConnection() {
  // Generous from the outset: this is usually the first request of the
  // session, so it's the one that pays for waking a sleeping host.
  const result = await request('/campaigns', { query: { limit: 1 }, timeoutMs: COLD_START_TIMEOUT_MS });

  // Read worked. Probe write scope without changing anything: enrolling an
  // empty contact list is rejected by validation (400) but still passes
  // through the scope gate first, so a 403 here means read-only.
  let canWrite = true;
  try {
    await request('/campaigns/00000000-0000-0000-0000-000000000000/enroll', {
      method: 'POST',
      body: { contact_ids: [] },
      // The server is demonstrably awake by now, so don't let this probe
      // stall the whole test if something else is wrong.
      retryOnTimeout: false,
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === 'SCOPE') canWrite = false;
  }

  return { ok: true, campaignCount: result?.total ?? 0, canWrite };
}

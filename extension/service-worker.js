/**
 * Background service worker — the extension's only privileged surface.
 *
 * Every API call happens here. The popup and content scripts send messages and
 * get plain objects back, so the API key never enters a page's world or a
 * rendering context.
 *
 * MV3 workers are killed when idle and restarted on the next event, so all
 * listeners are registered at the top level and nothing is cached in module
 * scope that can't be rebuilt from chrome.storage.
 */

import * as api from './lib/api.js';
import { ApiError } from './lib/api.js';
import {
  ensureConnectScript,
  getSettings,
  normaliseBaseUrl,
  originPatternFor,
  setSettings,
} from './lib/storage.js';
import { CANDIDATE_PATHS, extractFromHtml, promisingLinks, rankResults } from './lib/harvest.js';

const MENU_ROOT = 'sincerely-root';
const MENU_ADD_LAST = 'sincerely-add-last';
const MENU_CAMPAIGN_PREFIX = 'sincerely-campaign:';
const MENU_SUPPRESS = 'sincerely-suppress';
const MAX_MENU_CAMPAIGNS = 10;

/**
 * Ceiling on one bulk action. Not a server limit — a judgement one: enrolling
 * a hundred scraped addresses in a click is more likely to be a mistake than
 * an intention, and the user can always run it twice.
 */
const BULK_LIMIT = 25;

const EMAIL_PATTERN = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Pull the first email address out of arbitrary text.
 * @param {string|undefined} text
 * @returns {string|null}
 */
function extractEmail(text) {
  if (!text) return null;
  const match = String(text).match(EMAIL_PATTERN);
  return match ? match[0].toLowerCase().replace(/[.,;:]+$/, '') : null;
}

/**
 * @param {string} title
 * @param {string} message
 */
function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title,
    message,
  });
}

/**
 * Errors don't survive chrome.runtime messaging, so every handler resolves to
 * {ok: true, data} or {ok: false, error: {...}} instead of throwing.
 * @param {unknown} err
 */
function toErrorPayload(err) {
  if (err instanceof ApiError) return { ok: false, error: err.toJSON() };
  return {
    ok: false,
    error: {
      message: err instanceof Error ? err.message : String(err),
      status: 0,
      code: 'UNKNOWN',
      isAuthProblem: false,
    },
  };
}

/** Badge nags only about the one thing the user must fix to make anything work. */
async function refreshBadge() {
  const { apiKey } = await getSettings();
  if (apiKey) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#d94f3d' });
}

/* ------------------------------------------------------------------ */
/* Per-tab status badge                                               */
/* ------------------------------------------------------------------ */

/**
 * Cache of email → standing, so browsing a list of profiles doesn't spend the
 * per-key rate limit re-asking about the same people. Short-lived on purpose:
 * enrolments change, and a stale badge is worse than no badge.
 */
const standingCache = new Map();
const STANDING_TTL_MS = 5 * 60_000;

/**
 * Drop the cache after anything that changes an enrolment. The cache exists to
 * spare the rate limit on repeated reads, not to survive our own writes — a
 * badge still reading "1" after the user just removed someone is a bug.
 */
function invalidateStandingCache() {
  standingCache.clear();
}

/** Only sites with a declared content script can be badged without a click. */
function canBadge(url) {
  return /^https:\/\/(www\.linkedin\.com|mail\.google\.com)\//.test(String(url || ''));
}

/**
 * @param {string} email
 * @returns {Promise<{enrolled: number, suppressed: boolean}|null>}
 */
async function standingFor(email) {
  const cached = standingCache.get(email);
  if (cached && Date.now() - cached.at < STANDING_TTL_MS) return cached.value;

  try {
    const contact = await api.findContactByEmail(email);
    let value = { enrolled: 0, suppressed: false };

    if (contact) {
      const [memberships, suppressed] = await Promise.all([
        api.getContactCampaigns(contact.id),
        api.isSuppressed(email).catch(() => false),
      ]);
      value = {
        enrolled: memberships.filter((m) => m.is_active).length,
        suppressed: Boolean(suppressed),
      };
    }

    standingCache.set(email, { value, at: Date.now() });
    return value;
  } catch {
    // A failed lookup should leave the badge blank, not show a wrong number.
    return null;
  }
}

/**
 * Mark the toolbar icon with what we already know about the person on this
 * tab, so "are they already in a sequence?" doesn't need a click.
 *
 * @param {number} tabId
 * @param {string} url
 */
async function updateTabBadge(tabId, url) {
  const { apiKey, showBadge } = await getSettings();
  if (!apiKey || !showBadge || !canBadge(url)) {
    // Leave the global "no key" badge alone; only clear per-tab marks.
    if (apiKey) await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    return;
  }

  const person = await scrapeTab(tabId).catch(() => null);
  if (!person?.email) {
    await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    return;
  }

  const standing = await standingFor(person.email);
  if (!standing) return;

  const text = standing.suppressed ? '✕' : standing.enrolled > 0 ? String(standing.enrolled) : '';
  const colour = standing.suppressed ? '#EF4444' : '#5B5BF5';

  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color: colour }).catch(() => {});
}

/**
 * Badge updates are debounced per tab: LinkedIn fires many navigation events
 * for a single profile view, and each one would otherwise cost an API call.
 */
const badgeTimers = new Map();
function scheduleBadge(tabId, url) {
  clearTimeout(badgeTimers.get(tabId));
  badgeTimers.set(
    tabId,
    setTimeout(() => {
      badgeTimers.delete(tabId);
      updateTabBadge(tabId, url).catch(() => {});
    }, 1200)
  );
}

/* ------------------------------------------------------------------ */
/* Context menus                                                      */
/* ------------------------------------------------------------------ */

/**
 * Rebuild the right-click menu from the cached campaign list.
 *
 * Cached rather than fetched: the menu has to exist before the user
 * right-clicks, and an API round-trip on every worker wake-up would be both
 * slow and wasteful of the per-key rate limit. The cache refreshes whenever
 * the popup lists campaigns.
 */
async function rebuildContextMenus() {
  await chrome.contextMenus.removeAll();

  const { cachedCampaigns = [], lastCampaignId } = await chrome.storage.local.get({
    cachedCampaigns: [],
    lastCampaignId: null,
  });

  const contexts = ['selection', 'link', 'page'];

  chrome.contextMenus.create({ id: MENU_ROOT, title: 'Sincerely', contexts });

  const last = cachedCampaigns.find((c) => c.id === lastCampaignId);
  if (last) {
    chrome.contextMenus.create({
      id: MENU_ADD_LAST,
      parentId: MENU_ROOT,
      title: `Add to "${last.name}"`,
      contexts,
    });
    chrome.contextMenus.create({
      id: 'sincerely-sep-1',
      parentId: MENU_ROOT,
      type: 'separator',
      contexts,
    });
  }

  for (const campaign of cachedCampaigns.slice(0, MAX_MENU_CAMPAIGNS)) {
    chrome.contextMenus.create({
      id: `${MENU_CAMPAIGN_PREFIX}${campaign.id}`,
      parentId: MENU_ROOT,
      title: `Add to: ${campaign.name}`,
      contexts,
    });
  }

  if (cachedCampaigns.length === 0) {
    chrome.contextMenus.create({
      id: 'sincerely-empty',
      parentId: MENU_ROOT,
      title: 'Open the extension once to load campaigns',
      enabled: false,
      contexts,
    });
  }

  chrome.contextMenus.create({
    id: 'sincerely-sep-2',
    parentId: MENU_ROOT,
    type: 'separator',
    contexts,
  });
  chrome.contextMenus.create({
    id: MENU_SUPPRESS,
    parentId: MENU_ROOT,
    title: 'Never contact again (suppress)',
    contexts,
  });
}

/**
 * Work out who the user right-clicked on: an explicit selection or mailto:
 * link wins, otherwise fall back to asking the page's scraper.
 *
 * @param {chrome.contextMenus.OnClickData} info
 * @param {chrome.tabs.Tab | undefined} tab
 * @returns {Promise<object|null>} A person shape, or null if nothing was found.
 */
async function personFromContext(info, tab) {
  const fromLink = info.linkUrl && info.linkUrl.startsWith('mailto:')
    ? extractEmail(decodeURIComponent(info.linkUrl.slice('mailto:'.length)))
    : null;
  const email = fromLink || extractEmail(info.selectionText);

  if (email) {
    // A bare email from a selection carries no name, but the page might —
    // merge in whatever the scraper finds for the same address.
    const scraped = tab?.id ? await scrapeTab(tab.id).catch(() => null) : null;
    if (scraped?.email && scraped.email.toLowerCase() === email) return scraped;
    return { email, source_url: tab?.url || null };
  }

  if (!tab?.id) return null;
  const scraped = await scrapeTab(tab.id).catch(() => null);
  return scraped?.email ? scraped : null;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const isCampaignItem =
    info.menuItemId === MENU_ADD_LAST || String(info.menuItemId).startsWith(MENU_CAMPAIGN_PREFIX);
  if (!isCampaignItem && info.menuItemId !== MENU_SUPPRESS) return;

  const person = await personFromContext(info, tab);
  if (!person?.email) {
    notify('No email found', 'Select an email address on the page, or open the extension to enter one.');
    return;
  }

  if (info.menuItemId === MENU_SUPPRESS) {
    const result = await handleSuppress({ email: person.email, removeFromActive: true });
    if (result.ok) {
      notify('Suppressed', `${person.email} will not be emailed again${result.data.removedFrom ? `, and was removed from ${result.data.removedFrom} campaign(s)` : ''}.`);
    } else {
      notify("Couldn't suppress", result.error.message);
    }
    return;
  }

  let campaignId;
  if (info.menuItemId === MENU_ADD_LAST) {
    ({ lastCampaignId: campaignId } = await getSettings());
  } else {
    campaignId = String(info.menuItemId).slice(MENU_CAMPAIGN_PREFIX.length);
  }
  if (!campaignId) {
    notify('No campaign selected', 'Open the extension and pick a campaign first.');
    return;
  }

  const result = await handleAddToCampaign({ campaignId, person });
  if (result.ok) {
    const { added, skipped, campaignName } = result.data;
    notify(
      added > 0 ? 'Added to campaign' : 'Already in this campaign',
      added > 0
        ? `${person.email} → ${campaignName}`
        : `${person.email} was already enrolled${skipped ? ` (${skipped} skipped)` : ''}.`
    );
  } else {
    notify("Couldn't add to campaign", result.error.message);
  }
});

/* ------------------------------------------------------------------ */
/* Scraping                                                           */
/* ------------------------------------------------------------------ */

/**
 * Ask the page what person it's showing.
 *
 * LinkedIn and Gmail get the content script declaratively via the manifest.
 * Everywhere else it's injected on demand under activeTab, which is why the
 * extension needs no broad host permission to work on arbitrary sites.
 *
 * @param {number} tabId
 * @returns {Promise<object|null>}
 */
async function scrapeTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'SINCERELY_SCRAPE' });
    if (response) return response;
  } catch {
    // No listener yet — fall through and inject.
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/scraper.js'] });
  } catch (err) {
    // chrome:// pages, the Web Store, and PDF viewers can't be scripted.
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'SINCERELY_SCRAPE' });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Boil the activity log down to the handful of facts worth a line in a popup:
 * has this person engaged, how much, and when did they last do anything.
 *
 * The timeline is newest-first (analyticsService orders by occurred_at desc),
 * so the first row is the most recent.
 *
 * @param {Array<{activity_type: string, occurred_at: string, campaign_name?: string}>} timeline
 */
function summariseEngagement(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return null;

  const counts = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
  for (const entry of timeline) {
    const type = String(entry.activity_type || '').toLowerCase();
    if (type in counts) counts[type] += 1;
  }

  const latest = timeline[0];
  return {
    ...counts,
    // A reply is the only signal that changes what you'd do next, so it's
    // surfaced separately rather than buried in a count.
    hasReplied: counts.replied > 0,
    lastActivityType: latest?.activity_type ?? null,
    lastActivityAt: latest?.occurred_at ?? null,
    lastCampaignName: latest?.campaign_name ?? null,
  };
}

/**
 * Everything the popup needs to render its first frame, in one round-trip.
 * @param {{tabId?: number}} payload
 */
/**
 * The origin of the configured API, when Chrome has not granted it yet.
 *
 * A key can be perfectly valid and still useless: an API on a host outside
 * host_permissions can't be fetched at all, and the failure surfaces as a bare
 * "Failed to fetch". Reporting it as its own state lets the UI ask for the grant
 * instead of showing a network error.
 *
 * @param {string} apiBaseUrl
 * @returns {Promise<string|null>}
 */
async function missingApiPermission(apiBaseUrl) {
  const pattern = originPatternFor(apiBaseUrl);
  if (!pattern) return null;
  const allowed = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
  if (allowed) return null;
  try {
    return new URL(apiBaseUrl).origin;
  } catch {
    return null;
  }
}

async function handleGetContext(payload) {
  const settings = await getSettings();
  const person = payload.tabId ? await scrapeTab(payload.tabId) : null;

  return {
    ok: true,
    data: {
      hasKey: Boolean(settings.apiKey),
      apiBaseUrl: settings.apiBaseUrl,
      keyPrefix: settings.apiKey ? `${settings.apiKey.slice(0, 12)}…` : null,
      lastCampaignId: settings.lastCampaignId,
      verifyBeforeAdd: settings.verifyBeforeAdd,
      appUrl: settings.appUrl,
      // So a popup reopened after the permission prompt closed it can pick the
      // flow back up instead of failing every request.
      needsPermission: settings.apiKey ? await missingApiPermission(settings.apiBaseUrl) : null,
      person,
    },
  };
}

/** Campaign list, split into enrollable and finished, and cached for the menus. */
async function handleListCampaigns() {
  try {
    const grouped = await api.listCampaignsGrouped();
    await chrome.storage.local.set({
      cachedCampaigns: grouped.enrollable.map((c) => ({ id: c.id, name: c.name, status: c.status })),
    });
    await rebuildContextMenus();
    return { ok: true, data: grouped };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/**
 * Look someone up without changing anything: do we know them, are they
 * suppressed, and which campaigns are they already in?
 * @param {{email: string}} payload
 */
async function handleLookupPerson(payload) {
  try {
    const email = String(payload.email || '').trim().toLowerCase();
    if (!email) return { ok: true, data: { contact: null, campaigns: [], suppressed: false } };

    const contact = await api.findContactByEmail(email);

    // Suppression is keyed on the address, so it's worth knowing even for
    // someone who isn't a contact yet.
    let suppressed = false;
    try {
      suppressed = await api.isSuppressed(email);
    } catch {
      // Non-fatal: an unavailable check shouldn't block the whole panel.
    }

    if (!contact) return { ok: true, data: { contact: null, campaigns: [], suppressed, engagement: null } };

    // Enrolments and activity are independent reads — one round-trip each,
    // in parallel, so the panel fills in one go.
    const [campaigns, timeline] = await Promise.all([
      api.getContactCampaigns(contact.id),
      // Activity is a bonus, not a blocker: an analytics hiccup shouldn't
      // stop the panel showing where someone stands.
      api.getContactTimeline(contact.id).catch(() => []),
    ]);

    return { ok: true, data: { contact, campaigns, suppressed, engagement: summariseEngagement(timeline) } };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/**
 * The main event: take a person off a page and put them in a campaign,
 * creating the contact first if this account has never seen them.
 *
 * @param {{campaignId: string, person: object, verify?: boolean}} payload
 */
async function handleAddToCampaign(payload) {
  try {
    const { campaignId, person } = payload;
    const email = String(person?.email || '').trim().toLowerCase();
    if (!campaignId) throw new ApiError('Pick a campaign first.', { code: 'NO_CAMPAIGN' });
    if (!EMAIL_PATTERN.test(email)) throw new ApiError(`"${email}" doesn't look like an email address.`, { code: 'BAD_EMAIL' });

    const settings = await getSettings();

    if (payload.verify ?? settings.verifyBeforeAdd) {
      const verdict = await api.verifyEmail(email);
      // The server scores rather than passes/fails; treat a dead domain or bad
      // syntax as disqualifying and let anything else through.
      if (verdict && (verdict.syntax_ok === false || verdict.domain_ok === false)) {
        throw new ApiError(
          `${email} failed verification (${verdict.fail_reason || 'undeliverable'}). Turn off "verify before adding" in options to add anyway.`,
          { code: 'VERIFY_FAILED' }
        );
      }
    }

    const { contact, created } = await api.resolveOrCreateContact({ ...person, email });

    let result;
    try {
      result = await api.enrollContacts(campaignId, [contact.id]);
    } catch (enrollErr) {
      // The exclusivity rule is the one refusal the user can actually resolve,
      // so turn it from a dead end into a choice: name the campaigns holding
      // this person and let the popup offer to move them.
      const blocking = await findBlockingEnrolments(contact.id, campaignId).catch(() => []);
      if (blocking.length > 0) {
        const payload = toErrorPayload(enrollErr);
        return {
          ok: false,
          error: { ...payload.error, code: 'BLOCKED_BY_CAMPAIGN', blocking, contactId: contact.id },
        };
      }
      throw enrollErr;
    }

    // Source attribution, so the channel can be measured later. Best-effort:
    // a tagging failure must never look like the enrolment failed, because
    // the enrolment already succeeded.
    if (settings.autoTag && settings.autoTagName) {
      try {
        const tag = await api.ensureTag(settings.autoTagName);
        await api.tagContacts([contact.id], [tag.id]);
      } catch (tagErr) {
        console.warn('[Sincerely] Could not tag contact:', tagErr?.message);
      }
    }

    await setSettings({ lastCampaignId: campaignId });
    invalidateStandingCache();

    const { cachedCampaigns = [] } = await chrome.storage.local.get({ cachedCampaigns: [] });
    const campaignName = cachedCampaigns.find((c) => c.id === campaignId)?.name || 'the campaign';

    return {
      ok: true,
      data: {
        contactId: contact.id,
        contactCreated: created,
        added: result?.added ?? 0,
        skipped: result?.skipped ?? 0,
        total: result?.total ?? 0,
        campaignId,
        campaignName,
      },
    };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/* ------------------------------------------------------------------ */
/* List pages: who do we already have, and bulk enrol                 */
/* ------------------------------------------------------------------ */

/**
 * Work out which of these people we already hold, and — the part that
 * matters — which are already being emailed.
 *
 * Apollo's "Net New" means "not in my database". That's the wrong question
 * for an outreach tool: a duplicate contact record is untidy, but a second
 * sequence landing on someone mid-conversation is what loses the reply. So
 * this reports active enrolment and suppression, not mere existence.
 *
 * LinkedIn rows carry no address, so matching is by name and company. That's
 * fuzzy, which is exactly why the result is a *selection the user can see and
 * correct* rather than an automatic action.
 *
 * @param {{people: Array<{full_name?: string, first_name?: string, last_name?: string, company?: string, linkedin_url: string}>}} payload
 */
/**
 * Does this account already hold this person?
 *
 * Searching on the *surname* is the whole trick. The server builds its filter
 * as `first_name ILIKE %q% OR last_name ILIKE %q% OR company ILIKE %q%`, so
 * searching a full name matches nothing — no single column contains
 * "Sam Rivera". Getting this wrong doesn't just fail to find people, it spends
 * a Prospector credit revealing someone already in the database, so both the
 * Net-new check and the enrol path go through here rather than each rolling
 * their own.
 *
 * @param {{first_name?: string, last_name?: string, full_name?: string, company?: string}} person
 * @param {object[]} [pool] Pre-fetched candidates, to avoid a search per person.
 * @returns {Promise<object|null>}
 */
async function findContactForPerson(person, pool) {
  const norm = (value) => String(value || '').trim().toLowerCase();
  const wantedName = norm([person.first_name, person.last_name].filter(Boolean).join(' ')) || norm(person.full_name);
  if (!wantedName) return null;

  const candidates = pool ?? (person.last_name ? await api.searchContacts(person.last_name, 25).catch(() => []) : []);
  const wantedCompany = norm(person.company);

  return (
    candidates.find((c) => {
      const name = norm([c.first_name, c.last_name].filter(Boolean).join(' '));
      if (!name || name !== wantedName) return false;
      // With no company on either side the name alone has to do; where both
      // carry one they must agree, or two people who share a name get merged.
      if (!wantedCompany || !c.company) return true;
      const company = norm(c.company);
      return company.includes(wantedCompany) || wantedCompany.includes(company);
    }) || null
  );
}

async function handleCheckKnown(payload) {
  try {
    const people = (payload.people || []).slice(0, 60);
    /** @type {Record<string, {contactId: string|null, enrolledActive: number, suppressed: boolean}>} */
    const byProfile = {};

    // One search per distinct surname rather than per person: a page of
    // results shares few surnames, and the per-key limit is 100/minute.
    const surnames = [...new Set(people.map((p) => p.last_name).filter(Boolean))].slice(0, 25);
    /** @type {object[]} */
    const pool = [];
    for (const surname of surnames) {
      try {
        pool.push(...(await api.searchContacts(surname, 25)));
      } catch {
        // Partial knowledge is still useful; carry on with what we have.
      }
    }

    for (const person of people) {
      const contact = await findContactForPerson(person, pool);

      if (!contact) {
        byProfile[person.linkedin_url] = { contactId: null, enrolledActive: 0, suppressed: false };
        continue;
      }

      const [memberships, suppressed] = await Promise.all([
        api.getContactCampaigns(contact.id).catch(() => []),
        api.isSuppressed(contact.email).catch(() => false),
      ]);

      byProfile[person.linkedin_url] = {
        contactId: contact.id,
        enrolledActive: memberships.filter((m) => m.is_active).length,
        suppressed: Boolean(suppressed),
      };
    }

    return { ok: true, data: { byProfile } };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/**
 * Enrol people picked off a LinkedIn list.
 *
 * These rows have no address, so anyone we don't already hold needs a
 * Prospector reveal — which costs a credit each. The rule here is that a
 * credit is only ever spent on someone the user explicitly ticked, and the
 * result reports exactly how many were spent and what's left.
 *
 * @param {{campaignId: string, people: object[]}} payload
 */
async function handleBulkEnrolProfiles(payload) {
  try {
    const { campaignId } = payload;
    if (!campaignId) throw new ApiError('Pick a campaign first.', { code: 'NO_CAMPAIGN' });

    const people = (payload.people || []).slice(0, BULK_LIMIT);
    if (people.length === 0) throw new ApiError('Nobody selected.', { code: 'NO_PEOPLE' });

    // One search per distinct surname up front, rather than one per person
    // inside the loop: 25 people would otherwise cost 25 searches on top of
    // the reveals, and the per-key limit is 100/minute.
    const surnames = [...new Set(people.map((p) => p.last_name).filter(Boolean))];
    /** @type {object[]} */
    const pool = [];
    for (const surname of surnames) {
      pool.push(...(await api.searchContacts(surname, 25).catch(() => [])));
    }

    /** @type {string[]} */
    const contactIds = [];
    let revealed = 0;
    let noEmail = 0;
    let creditsRemaining = null;

    for (const person of people) {
      // Already a contact? Then no reveal, no credit. Same matcher as the
      // Net-new check, so the two can never disagree about who we hold.
      const existing = await findContactForPerson(person, pool);

      if (existing) {
        contactIds.push(existing.id);
        continue;
      }

      const found = await handleProspectFind({ person });
      if (!found.ok || !found.data.match?.has_email) {
        noEmail += 1;
        continue;
      }

      const reveal = await handleProspectReveal({ providerPersonId: found.data.match.id });
      if (!reveal.ok || !reveal.data.found || !reveal.data.email) {
        noEmail += 1;
        continue;
      }

      revealed += 1;
      if (Number.isFinite(reveal.data.credits?.remaining)) {
        creditsRemaining = reveal.data.credits.remaining;
      }

      // The reveal saves the contact itself; fall back to a lookup if the
      // provider adapter didn't return an id.
      const contactId =
        reveal.data.contactId || (await api.findContactByEmail(reveal.data.email))?.id || null;
      if (contactId) contactIds.push(contactId);
      else noEmail += 1;
    }

    if (contactIds.length === 0) {
      throw new ApiError(
        `No addresses could be found for the ${people.length} selected. Nothing was enrolled.`,
        { code: 'NO_CONTACTS' }
      );
    }

    const result = await api.enrollContacts(campaignId, contactIds);
    await setSettings({ lastCampaignId: campaignId });
    invalidateStandingCache();

    const settings = await getSettings();
    if (settings.autoTag && settings.autoTagName) {
      try {
        const tag = await api.ensureTag(settings.autoTagName);
        await api.tagContacts(contactIds, [tag.id]);
      } catch (tagErr) {
        console.warn('[Sincerely] Could not tag enrolled profiles:', tagErr?.message);
      }
    }

    return {
      ok: true,
      data: {
        requested: people.length,
        added: result?.added ?? 0,
        skipped: result?.skipped ?? 0,
        revealed,
        noEmail,
        creditsRemaining,
      },
    };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/* ------------------------------------------------------------------ */
/* Site harvest                                                       */
/* ------------------------------------------------------------------ */

/** Pages fetched per scan. Enough to reach a contact and a team page. */
const SCAN_PAGE_LIMIT = 14;
/** Parallel fetches. Low on purpose — this is someone else's server. */
const SCAN_CONCURRENCY = 3;
const SCAN_TIMEOUT_MS = 8000;
/** Skip anything huge; a 5MB page is an app bundle, not a contact page. */
const SCAN_MAX_BYTES = 2_000_000;

/**
 * Fetch one page as text, giving up quickly and quietly.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow',
    });
    if (!response.ok) return null;

    const type = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(type)) return null;

    const length = Number(response.headers.get('content-length') || 0);
    if (length > SCAN_MAX_BYTES) return null;

    const text = await response.text();
    return text.length > SCAN_MAX_BYTES ? text.slice(0, SCAN_MAX_BYTES) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Run tasks with a small pool, so a scan doesn't hammer the site. */
async function pooled(items, worker, size) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Read a company's own site for addresses.
 *
 * This is the free half of the product. Enrichment vendors charge because they
 * licence a people database; a company's /contact page is public HTML, so the
 * only cost is a handful of HTTP requests the extension makes itself. No
 * server, no credits.
 *
 * Bounded deliberately: a fixed list of likely paths plus one round of
 * on-page links, same-origin only, capped pages, three at a time. A scan
 * should feel like a person clicking "Contact", not like a crawler.
 *
 * @param {{url: string}} payload The page the user is on; its origin is scanned.
 */
async function handleScanSite(payload) {
  try {
    let origin;
    let startUrl;
    try {
      const parsed = new URL(payload.url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('not http');
      origin = parsed.origin;
      startUrl = parsed.toString();
    } catch {
      throw new ApiError("This page can't be scanned — open the company's website first.", { code: 'BAD_URL' });
    }

    // Scanning a site means fetching from it, which needs a host grant. It's
    // requested from the popup (a user gesture); by here it must already exist.
    const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false);
    if (!granted) {
      throw new ApiError(`Chrome needs permission to read ${origin}. Allow it and scan again.`, {
        code: 'NEEDS_PERMISSION',
        origin,
      });
    }

    const queued = [startUrl, ...CANDIDATE_PATHS.map((path) => `${origin}${path}`)];
    const seen = new Set();
    const toVisit = [];
    for (const url of queued) {
      const normalised = url.replace(/\/+$/, '') || url;
      if (seen.has(normalised)) continue;
      seen.add(normalised);
      toVisit.push(url);
    }

    /** @type {Map<string, object>} */
    const found = new Map();
    const visited = [];
    /** @type {string[]} */
    const discovered = [];

    const visit = async (url) => {
      if (visited.length >= SCAN_PAGE_LIMIT) return;
      const html = await fetchPage(url);
      if (!html) return;
      visited.push(url);

      for (const result of extractFromHtml(html, url)) {
        // First sighting wins: the earlier pages are the likelier ones, and a
        // later page rarely improves on the name we already attributed.
        if (!found.has(result.email)) found.set(result.email, result);
      }

      // Only the entry page contributes new links — one hop keeps the scan
      // predictable and stops a big site turning into a crawl.
      if (url === startUrl) discovered.push(...promisingLinks(html, url, 8));
    };

    await pooled(toVisit.slice(0, SCAN_PAGE_LIMIT), visit, SCAN_CONCURRENCY);

    const extra = discovered.filter((url) => {
      const normalised = url.replace(/\/+$/, '');
      if (seen.has(normalised)) return false;
      seen.add(normalised);
      return true;
    });
    if (extra.length > 0 && visited.length < SCAN_PAGE_LIMIT) {
      await pooled(extra.slice(0, SCAN_PAGE_LIMIT - visited.length), visit, SCAN_CONCURRENCY);
    }

    const results = rankResults([...found.values()]);

    // Tell the user which of these they already have, so a scan doubles as a
    // gap analysis rather than a pile of unknowns.
    const known = new Map();
    const domains = [...new Set(results.map((r) => r.email.split('@')[1]).filter(Boolean))].slice(0, 5);
    for (const domain of domains) {
      try {
        const byEmail = await api.contactsByDomain(domain);
        for (const [email, contact] of byEmail) known.set(email, contact);
      } catch {
        // A lookup failure just means we can't annotate; the addresses stand.
      }
    }

    return {
      ok: true,
      data: {
        origin,
        pagesScanned: visited.length,
        results: results.map((r) => ({ ...r, alreadyAContact: known.has(r.email) })),
      },
    };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/**
 * Add every address found on a page to one campaign.
 *
 * Prospecting happens on list pages — a team page, a directory, a thread with
 * several participants — and doing those one at a time is the difference
 * between the extension being useful and being a demo.
 *
 * Deliberately frugal with requests, because the per-key limit is 100/minute:
 * one search per distinct domain rather than per person, one bulk create for
 * everyone missing, and a single enrol for the whole set.
 *
 * @param {{campaignId: string, emails: string[]}} payload
 */
async function handleBulkAdd(payload) {
  try {
    const { campaignId } = payload;
    if (!campaignId) throw new ApiError('Pick a campaign first.', { code: 'NO_CAMPAIGN' });

    // Accepts bare addresses or {email, first_name, ...} rows, so a harvest
    // can carry the names it worked out rather than throwing them away.
    const rows = (payload.people || payload.emails || []).map((entry) =>
      typeof entry === 'string' ? { email: entry } : entry || {}
    );

    /** @type {Map<string, object>} */
    const byEmail = new Map();
    for (const row of rows) {
      const email = String(row.email || '').trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email) || byEmail.has(email)) continue;
      byEmail.set(email, { ...row, email });
      if (byEmail.size >= BULK_LIMIT) break;
    }

    const emails = [...byEmail.keys()];
    if (emails.length === 0) throw new ApiError('No usable addresses on this page.', { code: 'NO_EMAILS' });

    const domains = [...new Set(emails.map((e) => e.split('@')[1]).filter(Boolean))];

    /** @type {Map<string, object>} */
    const known = new Map();
    for (const domain of domains) {
      const found = await api.contactsByDomain(domain);
      for (const [email, contact] of found) known.set(email, contact);
    }

    const missing = emails.filter((e) => !known.has(e));
    let created = 0;

    if (missing.length > 0) {
      const result = await api.bulkCreateContacts(
        missing.map((email) => {
          const row = byEmail.get(email) || {};
          return {
            email,
            first_name: row.first_name || null,
            last_name: row.last_name || null,
            company: row.company || null,
            job_title: row.job_title || null,
          };
        })
      );
      created = result?.imported ?? 0;

      // The bulk endpoint returns counts, not ids, so re-read the domains we
      // just wrote to. Still one call per domain rather than one per person.
      for (const domain of [...new Set(missing.map((e) => e.split('@')[1]))]) {
        const found = await api.contactsByDomain(domain);
        for (const [email, contact] of found) known.set(email, contact);
      }
    }

    const contactIds = emails.map((e) => known.get(e)?.id).filter(Boolean);
    if (contactIds.length === 0) {
      throw new ApiError('None of these addresses could be turned into contacts.', { code: 'NO_CONTACTS' });
    }

    const result = await api.enrollContacts(campaignId, contactIds);
    await setSettings({ lastCampaignId: campaignId });
    invalidateStandingCache();

    const settings = await getSettings();
    if (settings.autoTag && settings.autoTagName) {
      try {
        const tag = await api.ensureTag(settings.autoTagName);
        await api.tagContacts(contactIds, [tag.id]);
      } catch (tagErr) {
        console.warn('[Sincerely] Could not tag bulk contacts:', tagErr?.message);
      }
    }

    const { cachedCampaigns = [] } = await chrome.storage.local.get({ cachedCampaigns: [] });
    const campaignName = cachedCampaigns.find((c) => c.id === campaignId)?.name || 'the campaign';

    return {
      ok: true,
      data: {
        requested: emails.length,
        created,
        added: result?.added ?? 0,
        skipped: result?.skipped ?? 0,
        campaignId,
        campaignName,
      },
    };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/**
 * Which existing enrolments stand in the way of enrolling into `targetId`.
 *
 * The server refuses a contact who's already in another *active* campaign
 * bound to a *different* lead list. That message names the rule but not the
 * campaign, which leaves the user with a dead end — so work it out here and
 * hand back something they can act on.
 *
 * @param {string} contactId
 * @param {string} targetId
 * @returns {Promise<Array<{campaign_id: string, campaign_name: string|null}>>}
 */
async function findBlockingEnrolments(contactId, targetId) {
  const [memberships, target] = await Promise.all([
    api.getContactCampaigns(contactId),
    api.getCampaign(targetId),
  ]);

  return memberships
    .filter((m) => {
      if (!m.is_active || m.campaign_id === targetId) return false;
      // Same list is explicitly allowed, so it isn't blocking.
      const sameList = m.campaign_list_id && target?.list_id && m.campaign_list_id === target.list_id;
      return !sameList;
    })
    .map((m) => ({ campaign_id: m.campaign_id, campaign_name: m.campaign_name }));
}

/**
 * Take a contact out of the campaigns blocking this one, then enrol them.
 *
 * The escape hatch from the exclusivity rule: the user has seen which
 * campaign holds this person and decided this one matters more.
 *
 * @param {{campaignId: string, contactId: string, fromCampaignIds: string[]}} payload
 */
async function handleMoveToCampaign(payload) {
  try {
    const { campaignId, contactId, fromCampaignIds = [] } = payload;
    if (!campaignId || !contactId) throw new ApiError('Nothing to move.', { code: 'BAD_MOVE' });

    // Sequential: a burst of DELETEs is exactly what trips the per-key limit.
    const removedFrom = [];
    for (const fromId of fromCampaignIds) {
      await api.removeFromCampaign(fromId, [contactId]);
      removedFrom.push(fromId);
    }

    const result = await api.enrollContacts(campaignId, [contactId]);
    await setSettings({ lastCampaignId: campaignId });
    invalidateStandingCache();

    const { cachedCampaigns = [] } = await chrome.storage.local.get({ cachedCampaigns: [] });
    const campaignName = cachedCampaigns.find((c) => c.id === campaignId)?.name || 'the campaign';

    return {
      ok: true,
      data: {
        contactId,
        added: result?.added ?? 0,
        skipped: result?.skipped ?? 0,
        movedFrom: removedFrom.length,
        campaignId,
        campaignName,
      },
    };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/** @param {{campaignId: string, contactId: string}} payload */
async function handleRemoveFromCampaign(payload) {
  try {
    await api.removeFromCampaign(payload.campaignId, [payload.contactId]);
    invalidateStandingCache();
    return { ok: true, data: { removed: true } };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/**
 * "Never contact again", done properly.
 *
 * Removal alone only deletes the enrolment — the contact stays on the lead
 * list and the next import re-enrols them. Suppression is what actually
 * sticks, so this does both: suppress the address, then pull them out of every
 * campaign still in flight.
 *
 * @param {{email: string, contactId?: string, removeFromActive?: boolean}} payload
 */
async function handleSuppress(payload) {
  try {
    const email = String(payload.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) throw new ApiError(`"${email}" doesn't look like an email address.`, { code: 'BAD_EMAIL' });

    await api.suppressEmail(email, 'manual', 'Suppressed from the Chrome extension');

    let removedFrom = 0;
    if (payload.removeFromActive !== false) {
      const contact = payload.contactId
        ? { id: payload.contactId }
        : await api.findContactByEmail(email);

      if (contact) {
        const memberships = await api.getContactCampaigns(contact.id);
        const active = memberships.filter((m) => m.is_active);
        // Sequential rather than parallel: a burst of DELETEs from several
        // suppressions in a row is exactly what trips the per-key rate limit.
        for (const membership of active) {
          try {
            await api.removeFromCampaign(membership.campaign_id, [contact.id]);
            removedFrom += 1;
          } catch {
            // The suppression already landed, which is the part that matters;
            // report how far we got rather than failing the whole action.
          }
        }
      }
    }

    invalidateStandingCache();
    return { ok: true, data: { suppressed: true, removedFrom } };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/**
 * Name/company search, for pages that show a person but no address —
 * LinkedIn, mainly. Each hit comes back with its enrolments already resolved
 * so the popup can offer removal without a second round-trip per candidate.
 *
 * @param {{query: string}} payload
 */
async function handleSearchContacts(payload) {
  try {
    const contacts = await api.searchContacts(payload.query, 8);
    return {
      ok: true,
      data: contacts.map((c) => ({
        id: c.id,
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
        company: c.company,
      })),
    };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/* ------------------------------------------------------------------ */
/* Prospector                                                         */
/* ------------------------------------------------------------------ */

/**
 * LinkedIn URLs vary by locale subdomain, tracking query, and trailing slash.
 * Reduce to the part that identifies the person: the /in/<slug> path.
 * @param {string|null|undefined} url
 */
function linkedinSlug(url) {
  if (!url) return null;
  const match = String(url).match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : null;
}

/**
 * Pick the search result that is actually the person on screen.
 *
 * A profile-URL match is proof. A name-and-company match is a strong guess,
 * and is reported as such so the UI can say so before spending a credit —
 * revealing the wrong person still costs money.
 *
 * @param {Array<object>} results
 * @param {object} person
 * @returns {{match: object, confidence: 'exact'|'likely'}|null}
 */
function matchProspect(results, person) {
  const slug = linkedinSlug(person.linkedin_url);
  if (slug) {
    const byUrl = results.find((r) => linkedinSlug(r.linkedin_url) === slug);
    if (byUrl) return { match: byUrl, confidence: 'exact' };
  }

  const wantedName = [person.first_name, person.last_name].filter(Boolean).join(' ').trim().toLowerCase();
  if (!wantedName) return null;
  const wantedCompany = String(person.company || '').trim().toLowerCase();

  const byName = results.find((r) => {
    if (String(r.full_name || '').trim().toLowerCase() !== wantedName) return false;
    if (!wantedCompany) return true;
    const company = String(r.company || '').toLowerCase();
    return company.includes(wantedCompany) || wantedCompany.includes(company);
  });

  return byName ? { match: byName, confidence: 'likely' } : null;
}

/**
 * Find the person on screen in the prospect database, without spending
 * anything. Reveal is a separate, explicit step.
 *
 * @param {{person: object}} payload
 */
async function handleProspectFind(payload) {
  try {
    const person = payload.person || {};
    const name = [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
    if (!name) throw new ApiError('Need at least a name to search the prospect database.', { code: 'NO_NAME' });

    const status = await api.prospectorStatus();
    if (!status?.provider) {
      throw new ApiError(
        'Prospector is not set up on this account — no data provider is configured.',
        { code: 'NO_PROVIDER' }
      );
    }

    const filters = { keywords: name };
    if (person.company) filters.companies = [person.company];
    if (person.job_title) filters.titles = [person.job_title];

    const results = (await api.prospectSearch(filters))?.results || [];
    const found = matchProspect(results, person);

    if (!found) {
      return {
        ok: true,
        data: { match: null, credits: status.credits, provider: status.provider, searched: results.length },
      };
    }

    return {
      ok: true,
      data: {
        match: {
          id: found.match.id,
          full_name: found.match.full_name,
          job_title: found.match.job_title,
          company: found.match.company,
          location: found.match.location,
          has_email: found.match.has_email !== false,
          already_revealed: Boolean(found.match.already_revealed),
        },
        confidence: found.confidence,
        credits: status.credits,
        provider: status.provider,
      },
    };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/**
 * Spend the credit. Only ever called after the user has seen who they're
 * revealing and what it costs.
 *
 * @param {{providerPersonId: string}} payload
 */
async function handleProspectReveal(payload) {
  try {
    if (!payload.providerPersonId) throw new ApiError('Nothing to reveal.', { code: 'BAD_REVEAL' });
    const result = await api.prospectReveal(payload.providerPersonId);
    return {
      ok: true,
      data: {
        found: Boolean(result?.found),
        email: result?.email ?? null,
        contactId: result?.contact_id ?? null,
        alreadyRevealed: Boolean(result?.already_revealed),
        credits: result?.credits ?? null,
      },
    };
  } catch (err) {
    return toErrorPayload(err);
  }
}

async function handleTestConnection() {
  try {
    const result = await api.testConnection();
    await refreshBadge();
    return { ok: true, data: result };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/**
 * Runs inside the app's page, not in the extension. Serialized and injected by
 * handleConnectFromTab, so it can use nothing from this file's scope.
 *
 * Everything needed to connect is already in a signed-in app tab: the session
 * token in localStorage, and the API's address in the page's own network
 * history. Reading both from the tab means the extension never has to be told
 * which domain the app or the API lives on — which is what made the previous
 * approach fail on any deployment that wasn't the one baked into the manifest.
 *
 * The key is minted by the page itself so no host permission is needed to get
 * this far: the app is already allowed to call its own API.
 *
 * @param {string} keyName
 * @param {string} configuredBase The API URL already in settings, tried as a
 *   candidate: it may be the only right answer for an API on a host that can't
 *   be derived from the app's domain.
 * @returns {Promise<{ok: true, apiKey: string, apiBaseUrl: string}
 *   | {ok: false, reason: string, status?: number, tried?: string[]}>}
 */
async function mintKeyFromPage(keyName, configuredBase) {
  /** @type {string[]} */
  const bases = [];

  /** Reduce any URL that contains an /api/v<N> root down to that root. */
  const push = (raw) => {
    if (typeof raw !== 'string') return;
    const match = raw.match(/^https?:\/\/[^/]+(?:\/[^?#]*?)?\/api\/v\d+/i);
    if (match && !bases.includes(match[0])) bases.push(match[0]);
  };

  // An explicit hint from the app wins, when the app is new enough to give one.
  push(window.__SINCERELY_API_URL);
  push(document.querySelector('meta[name="sincerely-api-url"]')?.getAttribute('content'));

  // Otherwise: wherever this page has actually been calling. A signed-in app
  // page has made plenty of these, and it is true by construction. Resource
  // entries appear a moment after each request settles, so a page opened a
  // split second ago may not have them yet — hence the fallbacks below.
  for (const entry of performance.getEntriesByType('resource')) push(entry.name);

  // Whatever the extension is already pointed at. Ranked above the guesses
  // because it's a stated answer, and for an API on a host unrelated to the
  // app's domain it is the only one that can be right.
  push(configuredBase);

  // Last resorts for a page that hasn't called the API yet — the two shapes
  // real deployments use. Wrong guesses just fail the POST below.
  const { origin, hostname, protocol } = window.location;
  push(`${origin}/api/v1`);
  // api.<domain> only makes sense for a real hostname; an IP or a bare label
  // would produce nonsense like api.0.0.1.
  if (/[a-z]/i.test(hostname) && hostname.includes('.')) {
    const labels = hostname.split('.');
    const registrable = labels.length > 2 ? labels.slice(1).join('.') : hostname;
    push(`${protocol}//api.${registrable}/api/v1`);
  }

  let token = null;
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      token = parsed?.access_token || parsed?.currentSession?.access_token || null;
      if (token) break;
    }
  } catch {
    // Storage blocked by browser settings; handled as a missing session below.
  }

  if (!token) return { ok: false, reason: 'no-session' };

  let lastStatus = 0;
  const tried = [];
  for (const base of bases) {
    tried.push(base);
    try {
      const res = await fetch(`${base}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: keyName, rate_limit: 100 }),
      });
      lastStatus = res.status;
      if (!res.ok) continue;
      const body = await res.json().catch(() => null);
      if (body?.raw_key) return { ok: true, apiKey: body.raw_key, apiBaseUrl: base };
    } catch {
      // Wrong guess, blocked by CORS, or unreachable — try the next candidate.
    }
  }

  if (lastStatus === 401) return { ok: false, reason: 'unauthorized', tried };
  return { ok: false, reason: bases.length ? 'failed' : 'no-api-url', status: lastStatus, tried };
}

/**
 * Connect using the app tab the user is looking at.
 *
 * This is the seamless path, and it needs no deployed app change, no hardcoded
 * domain, and no permission prompt to get the key: clicking the toolbar icon
 * grants activeTab for that tab, which is enough to read the session and let
 * the page mint its own key.
 *
 * @param {{tabId: number}} payload
 */
async function handleConnectFromTab(payload) {
  try {
    const tabId = payload.tabId;
    if (typeof tabId !== 'number') {
      throw new ApiError('No tab to read. Open your Sincerely app, then click the extension.', {
        code: 'NO_TAB',
      });
    }

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!/^https?:/i.test(tab?.url || '')) {
      throw new ApiError(
        'Chrome will not let an extension read this kind of page. Open your Sincerely app in a tab, sign in, then click the extension there.',
        { code: 'BAD_TAB' }
      );
    }

    const current = await getSettings();

    let frames;
    try {
      frames = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: mintKeyFromPage,
        args: [`Chrome extension (${new Date().toLocaleDateString()})`, current.apiBaseUrl],
      });
    } catch (err) {
      throw new ApiError(
        `Chrome would not let the extension read this tab: ${err?.message || 'unknown reason'}. Make sure your Sincerely tab is the one in front when you click.`,
        { code: 'NO_INJECT' }
      );
    }

    const result = frames?.[0]?.result;
    if (!result) throw new ApiError('The page did not answer.', { code: 'NO_RESULT' });

    if (!result.ok) {
      /** @type {Record<string, string>} */
      const reasons = {
        'no-session':
          "You're not signed in to Sincerely on this page. Sign in, then click Connect again.",
        'no-api-url':
          "This page doesn't look like your Sincerely app. Open Sincerely, sign in, then click Connect from that tab.",
        unauthorized:
          'Your Sincerely sign-in has expired. Reload the page, sign in again, then click Connect.',
        failed: `Sincerely would not create a key from this page${result.status ? ` (HTTP ${result.status})` : ''}. You can still paste a key by hand in settings.`,
      };
      throw new ApiError(reasons[result.reason] || 'Could not create a key from this page.', {
        code: 'CONNECT_FAILED',
      });
    }

    // The API URL is proven, not guessed: it is the one that just answered.
    const settings = await setSettings({
      apiKey: result.apiKey,
      apiBaseUrl: result.apiBaseUrl,
      appUrl: new URL(tab.url).origin,
    });
    await ensureConnectScript(settings.appUrl);

    const needsPermission = await missingApiPermission(settings.apiBaseUrl);
    if (needsPermission) {
      return { ok: true, data: { apiBaseUrl: settings.apiBaseUrl, needsPermission } };
    }

    const test = await api.testConnection();
    await refreshBadge();
    return { ok: true, data: { apiBaseUrl: settings.apiBaseUrl, needsPermission: null, ...test } };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/**
 * Accept a key handed over by the web app's "Connect extension" button.
 *
 * Everything the options page would do on a manual paste happens here instead:
 * shape check, store, host-permission check, connection test. The page that sent
 * the key gets a plain result back so it can say what actually happened rather
 * than "sent, hopefully".
 *
 * A missing host permission is reported rather than requested:
 * chrome.permissions.request needs a user gesture in an extension page, which a
 * message from a content script isn't. The key is still saved, so the options
 * page's Save button can finish the job in one click.
 *
 * @param {{apiKey: string, apiBaseUrl?: string, appUrl?: string}} payload
 */
async function handleConnectApply(payload) {
  try {
    const apiKey = String(payload.apiKey || '').trim();
    if (!/^sk_live_[0-9a-f]{64}$/i.test(apiKey)) {
      throw new ApiError(
        'That key is not the right shape — it should be "sk_live_" followed by 64 hex characters.',
        { code: 'BAD_KEY_SHAPE' }
      );
    }

    /** @type {Record<string, string>} */
    const patch = { apiKey };
    // Only override the API URL when the app actually sent one; normalising an
    // empty string would silently reset a working self-hosted setup to the
    // default host.
    if (/^https?:\/\//i.test(String(payload.apiBaseUrl || ''))) {
      patch.apiBaseUrl = normaliseBaseUrl(payload.apiBaseUrl);
    }
    if (/^https?:\/\//i.test(String(payload.appUrl || ''))) {
      patch.appUrl = String(payload.appUrl).replace(/\/+$/, '');
    }

    const settings = await setSettings(patch);

    const needsPermission = await missingApiPermission(settings.apiBaseUrl);
    if (needsPermission) {
      // Saved, but not usable yet — and the fix needs a click in an extension
      // page, so report it rather than failing later as "can't reach".
      return { ok: true, data: { saved: true, needsPermission } };
    }

    const result = await api.testConnection();
    await refreshBadge();
    return { ok: true, data: { saved: true, ...result } };
  } catch (err) {
    return toErrorPayload(err);
  }
}

/* ------------------------------------------------------------------ */
/* Message routing                                                    */
/* ------------------------------------------------------------------ */

/** @type {Record<string, (payload: any) => Promise<any>>} */
const HANDLERS = {
  GET_CONTEXT: handleGetContext,
  LIST_CAMPAIGNS: handleListCampaigns,
  LOOKUP_PERSON: handleLookupPerson,
  SEARCH_CONTACTS: handleSearchContacts,
  PROSPECT_FIND: handleProspectFind,
  PROSPECT_REVEAL: handleProspectReveal,
  ADD_TO_CAMPAIGN: handleAddToCampaign,
  REMOVE_FROM_CAMPAIGN: handleRemoveFromCampaign,
  MOVE_TO_CAMPAIGN: handleMoveToCampaign,
  BULK_ADD: handleBulkAdd,
  SCAN_SITE: handleScanSite,
  CHECK_KNOWN: handleCheckKnown,
  BULK_ENROL_PROFILES: handleBulkEnrolProfiles,
  SUPPRESS_PERSON: handleSuppress,
  TEST_CONNECTION: handleTestConnection,
  CONNECT_APPLY: handleConnectApply,
  CONNECT_FROM_TAB: handleConnectFromTab,
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;

  handler(message.payload || {})
    .then(sendResponse)
    .catch((err) => sendResponse(toErrorPayload(err)));

  // Keeps the message channel open for the async reply above.
  return true;
});

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

/**
 * Keep the one-click connect relay registered for whatever app URL is
 * configured. The manifest covers the hosted app and the dev server; a
 * self-hosted or staging domain is only known at runtime, and a registration
 * can be lost if the extension is reloaded from disk.
 */
async function syncConnectScript() {
  const { appUrl } = await getSettings();
  if (appUrl) await ensureConnectScript(appUrl);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await rebuildContextMenus();
  await refreshBadge();
  await syncConnectScript();

  // First run: send them straight to setup, since nothing works without a key.
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await rebuildContextMenus();
  await refreshBadge();
  await syncConnectScript();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.apiKey) refreshBadge();
  if (changes.lastCampaignId) rebuildContextMenus();
  if (changes.appUrl?.newValue) ensureConnectScript(changes.appUrl.newValue);
});

// Badge the tab the user is actually looking at, on switch and on navigation.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) scheduleBadge(tabId, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // SPA navigations arrive as a url change with no status transition, so watch
  // both rather than waiting for 'complete'.
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  if (tab.active) scheduleBadge(tabId, changeInfo.url || tab.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTimeout(badgeTimers.get(tabId));
  badgeTimers.delete(tabId);
});

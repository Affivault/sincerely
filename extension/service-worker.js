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
import { getSettings, setSettings } from './lib/storage.js';

const MENU_ROOT = 'sincerely-root';
const MENU_ADD_LAST = 'sincerely-add-last';
const MENU_CAMPAIGN_PREFIX = 'sincerely-campaign:';
const MENU_SUPPRESS = 'sincerely-suppress';
const MAX_MENU_CAMPAIGNS = 10;

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

async function handleTestConnection() {
  try {
    const result = await api.testConnection();
    await refreshBadge();
    return { ok: true, data: result };
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
  ADD_TO_CAMPAIGN: handleAddToCampaign,
  REMOVE_FROM_CAMPAIGN: handleRemoveFromCampaign,
  MOVE_TO_CAMPAIGN: handleMoveToCampaign,
  SUPPRESS_PERSON: handleSuppress,
  TEST_CONNECTION: handleTestConnection,
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

chrome.runtime.onInstalled.addListener(async (details) => {
  await rebuildContextMenus();
  await refreshBadge();

  // First run: send them straight to setup, since nothing works without a key.
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await rebuildContextMenus();
  await refreshBadge();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.apiKey) refreshBadge();
  if (changes.lastCampaignId) rebuildContextMenus();
});

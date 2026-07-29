/**
 * Popup UI.
 *
 * Holds no credentials and talks to no API — every operation goes through the
 * service worker, which replies with {ok, data} or {ok, error}. All text from
 * the server or the page is written with textContent, never innerHTML.
 */

import { initTheme } from '../lib/theme.js';

const EMAIL_PATTERN = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * Per-campaign contact status → badge variant, matching the app's status
 * colours (CONTACT_STATUS_COLORS in client/src/lib/constants.ts).
 */
const STATUS_VARIANT = {
  pending: 'badge-warning',
  active: 'badge-brand',
  completed: 'badge-success',
  replied: 'badge-success',
  bounced: 'badge-error',
  unsubscribed: 'badge-error',
  suppressed: 'badge-error',
  error: 'badge-error',
};

/** Where the details came from, shown as a small badge in the panel header. */
const SOURCE_LABEL = {
  linkedin: 'LinkedIn',
  gmail: 'Gmail',
  generic: 'This page',
};

const el = {
  setup: document.getElementById('setup'),
  main: document.getElementById('main'),
  openOptions: document.getElementById('open-options'),
  setupOpenOptions: document.getElementById('setup-open-options'),

  email: document.getElementById('email'),
  candidatesWrap: document.getElementById('candidates-wrap'),
  candidates: document.getElementById('candidates'),
  firstName: document.getElementById('first-name'),
  lastName: document.getElementById('last-name'),
  company: document.getElementById('company'),
  jobTitle: document.getElementById('job-title'),

  sourceBadge: document.getElementById('source-badge'),
  sourceHint: document.getElementById('source-hint'),
  noEmailHelp: document.getElementById('no-email-help'),
  searchByName: document.getElementById('search-by-name'),
  nameMatches: document.getElementById('name-matches'),

  standing: document.getElementById('standing'),
  standingBody: document.getElementById('standing-body'),

  campaign: document.getElementById('campaign'),
  add: document.getElementById('add'),
  suppress: document.getElementById('suppress'),
  status: document.getElementById('status'),
};

/** Mirrors what the page gave us, plus whatever the user edits on top. */
const state = {
  person: null,
  contact: null,
  memberships: [],
  suppressed: false,
  suppressArmed: false,
  /** True while a lookup is in flight, so we don't flash a misleading verdict. */
  looking: false,
  /**
   * Form fields filled from an API result rather than typed or scraped. Only
   * these get cleared when the address changes — a name the user typed
   * themselves shouldn't vanish because they fixed a typo in the email.
   * @type {Set<'firstName'|'lastName'|'company'|'jobTitle'>}
   */
  backfilled: new Set(),
};

/**
 * Monotonic lookup counter. Typing is debounced but responses can still land
 * out of order, and applying a stale one would attribute one person's
 * enrolments to another address.
 */
let lookupSeq = 0;

/* ------------------------------------------------------------------ */
/* Messaging                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {string} type
 * @param {object} [payload]
 * @returns {Promise<{ok: boolean, data?: any, error?: {message: string, isAuthProblem?: boolean}}>}
 */
async function send(type, payload = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ type, payload });
    return response ?? { ok: false, error: { message: 'No response from the extension background worker.' } };
  } catch (err) {
    return { ok: false, error: { message: err?.message || 'The extension background worker is unavailable.' } };
  }
}

/* ------------------------------------------------------------------ */
/* Status line                                                        */
/* ------------------------------------------------------------------ */

/**
 * @param {string} message
 * @param {{variant?: 'error'|'success', actionLabel?: string, onAction?: () => void}} [opts]
 */
function setStatus(message, opts = {}) {
  el.status.textContent = '';
  el.status.className = `status${opts.variant ? ` ${opts.variant}` : ''}`;
  el.status.classList.remove('hidden');

  const line = document.createElement('div');
  line.textContent = message;
  el.status.appendChild(line);

  if (opts.actionLabel && opts.onAction) {
    const button = document.createElement('button');
    button.className = 'status-action';
    button.type = 'button';
    button.textContent = opts.actionLabel;
    button.addEventListener('click', opts.onAction);
    el.status.appendChild(button);
  }
}

function clearStatus() {
  el.status.classList.add('hidden');
  el.status.textContent = '';
}

/**
 * Auth failures are a settings problem, so point at settings rather than
 * leaving the user to guess.
 * @param {{message: string, isAuthProblem?: boolean}} error
 */
function showError(error) {
  setStatus(
    error.message,
    error.isAuthProblem
      ? { variant: 'error', actionLabel: 'Open settings', onAction: () => chrome.runtime.openOptionsPage() }
      : { variant: 'error' }
  );
}

/* ------------------------------------------------------------------ */
/* Form <-> state                                                     */
/* ------------------------------------------------------------------ */

/** @returns {{email: string, first_name: string, last_name: string, company: string, job_title: string, linkedin_url: string|null, source_url: string|null}} */
function readForm() {
  return {
    email: el.email.value.trim().toLowerCase(),
    first_name: el.firstName.value.trim(),
    last_name: el.lastName.value.trim(),
    company: el.company.value.trim(),
    job_title: el.jobTitle.value.trim(),
    linkedin_url: state.person?.linkedin_url || null,
    source_url: state.person?.source_url || null,
  };
}

/** @param {object|null} person */
function fillForm(person) {
  if (!person) {
    el.sourceHint.textContent = "Couldn't read this tab — enter the details yourself";
    return;
  }

  const label = SOURCE_LABEL[person.source];
  if (label) {
    el.sourceBadge.textContent = label;
    el.sourceBadge.classList.remove('hidden');
    el.sourceHint.textContent = 'Detected from the current tab';
  }

  el.email.value = person.email || '';
  el.firstName.value = person.first_name || '';
  el.lastName.value = person.last_name || '';
  el.company.value = person.company || '';
  el.jobTitle.value = person.job_title || '';

  const extras = (person.email_candidates || []).filter((e) => e && e !== person.email);
  if (extras.length > 0) {
    el.candidates.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = `${extras.length} other address${extras.length > 1 ? 'es' : ''} on this page…`;
    el.candidates.appendChild(placeholder);
    for (const candidate of extras) {
      const option = document.createElement('option');
      option.value = candidate;
      option.textContent = candidate;
      el.candidates.appendChild(option);
    }
    el.candidatesWrap.classList.remove('hidden');
  } else {
    el.candidatesWrap.classList.add('hidden');
  }
}

function currentEmailIsValid() {
  return EMAIL_PATTERN.test(el.email.value.trim());
}

function syncButtons() {
  const hasEmail = currentEmailIsValid();
  el.add.disabled = !hasEmail || !el.campaign.value;
  el.suppress.disabled = !hasEmail || state.suppressed;
  el.suppress.textContent = state.suppressed
    ? 'Already suppressed'
    : state.suppressArmed
      ? 'Click again to confirm'
      : 'Never contact again';
  el.noEmailHelp.classList.toggle('hidden', hasEmail);
}

/* ------------------------------------------------------------------ */
/* Rendering: where they stand                                        */
/* ------------------------------------------------------------------ */

/** @param {string} isoDate */
function formatDate(isoDate) {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderStanding() {
  el.standingBody.textContent = '';

  // Show the panel for any valid address, not just ones we already know:
  // "not in your contacts yet" is useful feedback, and hiding it made a
  // brand-new address look like the lookup had silently failed.
  const showPanel =
    currentEmailIsValid() || state.suppressed || Boolean(state.contact) || state.memberships.length > 0;
  el.standing.classList.toggle('hidden', !showPanel);
  if (!showPanel) return;

  // Say we're checking rather than briefly asserting "not in your contacts",
  // which reads as a verdict when it's really just an unfinished request.
  if (state.looking) {
    const pending = document.createElement('p');
    pending.className = 'note text-tertiary';
    pending.textContent = 'Checking…';
    el.standingBody.appendChild(pending);
    return;
  }

  if (state.suppressed) {
    const warning = document.createElement('p');
    warning.className = 'suppressed-note';
    warning.textContent = 'On your suppression list — campaigns will not email this address.';
    el.standingBody.appendChild(warning);
  }

  if (!state.contact) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Not in your contacts yet — adding them will create the contact.';
    el.standingBody.appendChild(note);
    return;
  }

  if (state.memberships.length === 0) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Known contact, not enrolled in any campaign.';
    el.standingBody.appendChild(note);
    return;
  }

  for (const membership of state.memberships) {
    const row = document.createElement('div');
    row.className = 'enrolment';

    const main = document.createElement('div');
    main.className = 'enrolment-main';

    const name = document.createElement('div');
    name.className = 'enrolment-name';
    name.textContent = membership.campaign_name || 'Untitled campaign';
    main.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'enrolment-meta';

    const status = String(membership.status || '').toLowerCase();
    const badge = document.createElement('span');
    badge.className = `badge ${STATUS_VARIANT[status] || ''}`.trim();
    const dot = document.createElement('span');
    dot.className = 'dot';
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode(membership.status || 'unknown'));
    meta.appendChild(badge);

    // Step order is a 0-based index server-side; show it 1-based.
    const bits = [`step ${Number(membership.current_step_order || 0) + 1}`];
    if (membership.campaign_status && membership.campaign_status !== 'running') {
      bits.push(`campaign ${membership.campaign_status}`);
    }
    const nextSend = formatDate(membership.next_send_at);
    if (nextSend && membership.is_active) bits.push(`next ${nextSend}`);

    const detail = document.createElement('span');
    detail.textContent = bits.join(' · ');
    meta.appendChild(detail);
    main.appendChild(meta);
    row.appendChild(main);

    const removeButton = document.createElement('button');
    removeButton.className = 'btn-secondary btn-xs remove-btn';
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.title = `Remove from "${membership.campaign_name}" — stops this sequence only`;
    removeButton.addEventListener('click', () => removeFrom(membership, removeButton));
    row.appendChild(removeButton);

    el.standingBody.appendChild(row);
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

/** Blank out only the fields a previous lookup filled in. */
function clearBackfilledFields() {
  for (const key of state.backfilled) {
    if (el[key]) el[key].value = '';
  }
  state.backfilled.clear();
}

/**
 * @param {'firstName'|'lastName'|'company'|'jobTitle'} key
 * @param {string|null} value
 */
function backfill(key, value) {
  if (el[key].value || !value) return;
  el[key].value = value;
  state.backfilled.add(key);
}

/** Re-read the person's standing from the API and repaint. */
async function refreshStanding() {
  const email = el.email.value.trim().toLowerCase();
  const seq = (lookupSeq += 1);

  // Drop everything tied to the previous address before going anywhere. A
  // stale panel is worse than an empty one: Remove acts on state.contact, so
  // showing one person's enrolments under another's address could remove the
  // wrong contact from a live campaign.
  state.contact = null;
  state.memberships = [];
  state.suppressed = false;
  clearBackfilledFields();

  if (!EMAIL_PATTERN.test(email)) {
    state.looking = false;
    renderStanding();
    syncButtons();
    return;
  }

  state.looking = true;
  renderStanding();

  const response = await send('LOOKUP_PERSON', { email });

  // A newer lookup started while this one was in flight — that one owns the UI.
  if (seq !== lookupSeq) return;
  state.looking = false;

  if (!response.ok) {
    renderStanding();
    syncButtons();
    showError(response.error);
    return;
  }

  state.contact = response.data.contact;
  state.memberships = response.data.campaigns || [];
  state.suppressed = Boolean(response.data.suppressed);

  // Fill blank name/company fields from the contact we already hold, so an
  // existing record isn't overwritten by a thinner scrape.
  if (state.contact) {
    backfill('firstName', state.contact.first_name);
    backfill('lastName', state.contact.last_name);
    backfill('company', state.contact.company);
    backfill('jobTitle', state.contact.job_title);
  }

  renderStanding();
  syncButtons();
}

/**
 * @param {object} membership
 * @param {HTMLButtonElement} button
 */
async function removeFrom(membership, button) {
  button.disabled = true;
  button.textContent = 'Removing…';
  clearStatus();

  const response = await send('REMOVE_FROM_CAMPAIGN', {
    campaignId: membership.campaign_id,
    contactId: state.contact.id,
  });

  if (!response.ok) {
    button.disabled = false;
    button.textContent = 'Remove';
    showError(response.error);
    return;
  }

  setStatus(`Removed from "${membership.campaign_name}". They stay on the lead list and can be re-enrolled.`, {
    variant: 'success',
  });
  await refreshStanding();
}

async function addToCampaign() {
  const campaignId = el.campaign.value;
  const person = readForm();
  if (!campaignId || !EMAIL_PATTERN.test(person.email)) return;

  el.add.disabled = true;
  el.add.textContent = 'Adding…';
  clearStatus();

  const response = await send('ADD_TO_CAMPAIGN', { campaignId, person });

  el.add.textContent = 'Add to campaign';
  el.add.disabled = false;

  if (!response.ok) {
    showError(response.error);
    return;
  }

  const { added, skipped, contactCreated, campaignName, contactId } = response.data;

  if (added > 0) {
    const parts = [`Added to "${campaignName}".`];
    if (contactCreated) parts.push('New contact created.');
    if (skipped > 0) parts.push(`${skipped} skipped.`);
    setStatus(parts.join(' '), {
      variant: 'success',
      actionLabel: 'Undo',
      onAction: async () => {
        const undo = await send('REMOVE_FROM_CAMPAIGN', { campaignId, contactId });
        if (undo.ok) {
          setStatus(`Removed from "${campaignName}" again.`);
          await refreshStanding();
        } else {
          showError(undo.error);
        }
      },
    });
  } else {
    setStatus(`Already enrolled in "${campaignName}" — nothing changed.`);
  }

  await refreshStanding();
}

/**
 * Two-step rather than a confirm() dialog: a native dialog in a popup is both
 * ugly and liable to dismiss the popup, and this is not an action to fire on a
 * stray click.
 */
async function suppressPerson() {
  const email = el.email.value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return;

  if (!state.suppressArmed) {
    state.suppressArmed = true;
    syncButtons();
    setStatus(
      `This blocks every future send to ${email} across all campaigns, and removes them from any campaign still running. Click again to confirm.`
    );
    return;
  }

  state.suppressArmed = false;
  el.suppress.disabled = true;
  el.suppress.textContent = 'Suppressing…';

  const response = await send('SUPPRESS_PERSON', {
    email,
    contactId: state.contact?.id || null,
    removeFromActive: true,
  });

  if (!response.ok) {
    syncButtons();
    showError(response.error);
    return;
  }

  const { removedFrom } = response.data;
  setStatus(
    removedFrom > 0
      ? `${email} suppressed, and removed from ${removedFrom} active campaign${removedFrom > 1 ? 's' : ''}.`
      : `${email} suppressed. No active campaigns to remove them from.`,
    { variant: 'success' }
  );

  await refreshStanding();
}

/** Name-based lookup for pages with no address (LinkedIn, mostly). */
async function searchByName() {
  const form = readForm();
  const query = [form.first_name, form.last_name].filter(Boolean).join(' ') || form.company;
  if (!query) {
    setStatus('Enter a name or company to search for.', { variant: 'error' });
    return;
  }

  el.searchByName.disabled = true;
  el.searchByName.textContent = 'Searching…';
  clearStatus();

  const response = await send('SEARCH_CONTACTS', { query });

  el.searchByName.disabled = false;
  el.searchByName.textContent = 'Search contacts by name';

  if (!response.ok) {
    showError(response.error);
    return;
  }

  el.nameMatches.textContent = '';
  if (response.data.length === 0) {
    el.nameMatches.classList.add('hidden');
    setStatus(`No contacts match "${query}".`);
    return;
  }

  for (const contact of response.data) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';

    const label = document.createElement('div');
    label.className = 'match-name';
    label.textContent = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;
    button.appendChild(label);

    const sub = document.createElement('div');
    sub.className = 'match-meta';
    sub.textContent = contact.company ? `${contact.email} · ${contact.company}` : contact.email;
    button.appendChild(sub);

    button.addEventListener('click', async () => {
      el.email.value = contact.email;
      if (contact.first_name) el.firstName.value = contact.first_name;
      if (contact.last_name) el.lastName.value = contact.last_name;
      if (contact.company) el.company.value = contact.company;
      el.nameMatches.classList.add('hidden');
      clearStatus();
      syncButtons();
      await refreshStanding();
    });

    item.appendChild(button);
    el.nameMatches.appendChild(item);
  }
  el.nameMatches.classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* Campaign picker                                                    */
/* ------------------------------------------------------------------ */

/** @param {string|null} preselectId */
async function loadCampaigns(preselectId) {
  const response = await send('LIST_CAMPAIGNS');

  el.campaign.textContent = '';

  if (!response.ok) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = "Couldn't load campaigns";
    el.campaign.appendChild(option);
    showError(response.error);
    syncButtons();
    return;
  }

  const { enrollable, finished } = response.data;

  if (enrollable.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No campaigns accept new contacts';
    el.campaign.appendChild(option);
  } else {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a campaign…';
    el.campaign.appendChild(placeholder);

    for (const campaign of enrollable) {
      const option = document.createElement('option');
      option.value = campaign.id;
      option.textContent = `${campaign.name} (${campaign.status})`;
      el.campaign.appendChild(option);
    }
  }

  // Completed and cancelled campaigns reject enrolment server-side, so list
  // them visibly disabled rather than hiding them and looking broken.
  if (finished.length > 0) {
    const group = document.createElement('optgroup');
    group.label = "Finished — can't accept contacts";
    for (const campaign of finished) {
      const option = document.createElement('option');
      option.value = '';
      option.disabled = true;
      option.textContent = `${campaign.name} (${campaign.status})`;
      group.appendChild(option);
    }
    el.campaign.appendChild(group);
  }

  if (preselectId && enrollable.some((c) => c.id === preselectId)) {
    el.campaign.value = preselectId;
  }
  syncButtons();
}

/* ------------------------------------------------------------------ */
/* Init                                                               */
/* ------------------------------------------------------------------ */

/** Debounce so typing an address doesn't fire a lookup per keystroke. */
function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function wireEvents() {
  el.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  el.setupOpenOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  el.email.addEventListener(
    'input',
    debounce(() => {
      state.suppressArmed = false;
      syncButtons();
      refreshStanding();
    }, 450)
  );

  el.candidates.addEventListener('change', () => {
    if (!el.candidates.value) return;
    el.email.value = el.candidates.value;
    state.suppressArmed = false;
    syncButtons();
    refreshStanding();
  });

  el.campaign.addEventListener('change', syncButtons);
  el.add.addEventListener('click', addToCampaign);
  el.suppress.addEventListener('click', suppressPerson);
  el.searchByName.addEventListener('click', searchByName);
}

async function init() {
  // Resolve the theme before first paint so the popup never flashes light on a
  // dark setup.
  await initTheme();
  wireEvents();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const context = await send('GET_CONTEXT', { tabId: tab?.id });

  if (!context.ok) {
    el.main.classList.remove('hidden');
    showError(context.error);
    return;
  }

  if (!context.data.hasKey) {
    el.setup.classList.remove('hidden');
    return;
  }

  el.main.classList.remove('hidden');
  state.person = context.data.person;
  fillForm(context.data.person);
  syncButtons();

  // Campaigns and standing are independent — fetch together.
  await Promise.all([loadCampaigns(context.data.lastCampaignId), refreshStanding()]);
}

init().catch((err) => {
  el.main.classList.remove('hidden');
  setStatus(err?.message || 'The popup failed to start.', { variant: 'error' });
});

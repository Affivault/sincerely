/**
 * Popup UI.
 *
 * Holds no credentials and talks to no API — every operation goes through the
 * service worker, which replies with {ok, data} or {ok, error}. All text from
 * the server or the page is written with textContent, never innerHTML.
 *
 * The layout answers three questions in order: who is this, what has already
 * happened with them, and which campaign should they go into. Editing their
 * details is a rarer job, so it lives behind a disclosure.
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

/** Where the details came from, for the sub-line under the name. */
const SOURCE_LABEL = {
  linkedin: 'LinkedIn',
  gmail: 'Gmail',
  generic: 'this page',
};

/**
 * The app's eight avatar gradients and hash, copied from
 * client/src/components/shared/Avatar.tsx so the same person gets the same
 * colour in both places.
 */
const AVATAR_GRADIENTS = [
  ['#5B5BF5', '#8B5CF6'],
  ['#8B5CF6', '#EC4899'],
  ['#06B6D4', '#5B5BF5'],
  ['#10B981', '#06B6D4'],
  ['#F59E0B', '#EF4444'],
  ['#EF4444', '#EC4899'],
  ['#5B5BF5', '#06B6D4'],
  ['#8B5CF6', '#5B5BF5'],
];

const el = {
  setup: document.getElementById('setup'),
  main: document.getElementById('main'),
  openOptions: document.getElementById('open-options'),
  setupOpenOptions: document.getElementById('setup-open-options'),

  avatar: document.getElementById('avatar'),
  personName: document.getElementById('person-name'),
  personSub: document.getElementById('person-sub'),
  verification: document.getElementById('verification'),
  standingStrip: document.getElementById('standing-strip'),

  campaignSearch: document.getElementById('campaign-search'),
  campaignList: document.getElementById('campaign-list'),
  add: document.getElementById('add'),
  addLabel: document.getElementById('add-label'),
  bulkAdd: document.getElementById('bulk-add'),
  bulkLabel: document.getElementById('bulk-label'),

  detailsToggle: document.getElementById('details-toggle'),
  detailsBody: document.getElementById('details-body'),
  detailsSummary: document.getElementById('details-summary'),

  email: document.getElementById('email'),
  candidatesWrap: document.getElementById('candidates-wrap'),
  candidates: document.getElementById('candidates'),
  firstName: document.getElementById('first-name'),
  lastName: document.getElementById('last-name'),
  company: document.getElementById('company'),
  jobTitle: document.getElementById('job-title'),
  suppress: document.getElementById('suppress'),

  noEmailHelp: document.getElementById('no-email-help'),
  prospectFind: document.getElementById('prospect-find'),
  prospectResult: document.getElementById('prospect-result'),
  searchByName: document.getElementById('search-by-name'),
  nameMatches: document.getElementById('name-matches'),

  standing: document.getElementById('standing'),
  standingBody: document.getElementById('standing-body'),

  status: document.getElementById('status'),
};

const state = {
  person: null,
  contact: null,
  memberships: [],
  engagement: null,
  suppressed: false,
  suppressArmed: false,
  bulkArmed: false,
  looking: false,
  /** All enrollable campaigns, and the filtered subset currently listed. */
  campaigns: [],
  finished: [],
  filtered: [],
  activeIndex: 0,
  selectedCampaignId: null,
  /** Web app origin, for "open in Sincerely" links. Empty disables them. */
  appUrl: '',
  /**
   * Form fields filled from an API result rather than typed or scraped. Only
   * these get cleared when the address changes.
   * @type {Set<'firstName'|'lastName'|'company'|'jobTitle'>}
   */
  backfilled: new Set(),
};

/** Guards against an out-of-order lookup repainting a newer one's result. */
let lookupSeq = 0;

/* ------------------------------------------------------------------ */
/* Messaging                                                          */
/* ------------------------------------------------------------------ */

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
 * @param {{variant?: 'error'|'success', actions?: Array<{label: string, primary?: boolean, onClick: () => void}>}} [opts]
 */
function setStatus(message, opts = {}) {
  el.status.textContent = '';
  el.status.className = `status${opts.variant ? ` ${opts.variant}` : ''}`;
  el.status.classList.remove('hidden');

  const line = document.createElement('div');
  line.textContent = message;
  el.status.appendChild(line);

  if (opts.actions?.length) {
    const row = document.createElement('div');
    row.className = 'status-actions';
    for (const action of opts.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `status-action${action.primary ? ' primary' : ''}`;
      const label = document.createElement('span');
      label.textContent = action.label;
      button.appendChild(label);
      button.addEventListener('click', action.onClick);
      row.appendChild(button);
    }
    el.status.appendChild(row);
  }
}

function clearStatus() {
  el.status.classList.add('hidden');
  el.status.textContent = '';
}

/**
 * @param {{message: string, isAuthProblem?: boolean, code?: string, blocking?: Array<{campaign_id: string, campaign_name: string}>, contactId?: string}} error
 */
function showError(error) {
  // The exclusivity rule is resolvable, so offer the resolution rather than
  // leaving the user staring at a refusal.
  if (error.code === 'BLOCKED_BY_CAMPAIGN' && error.blocking?.length) {
    const names = error.blocking.map((b) => `"${b.campaign_name}"`).join(', ');
    const target = state.campaigns.find((c) => c.id === state.selectedCampaignId);
    setStatus(
      `Already in ${names}, on a different lead list. A contact can only be in one active campaign per list.`,
      {
        variant: 'error',
        actions: [
          {
            label: `Move to "${target?.name ?? 'this campaign'}"`,
            primary: true,
            onClick: () =>
              moveToCampaign(
                error.contactId,
                error.blocking.map((b) => b.campaign_id)
              ),
          },
        ],
      }
    );
    return;
  }

  setStatus(error.message, {
    variant: 'error',
    actions: error.isAuthProblem
      ? [{ label: 'Open settings', onClick: () => chrome.runtime.openOptionsPage() }]
      : [],
  });
}

/* ------------------------------------------------------------------ */
/* Identity                                                           */
/* ------------------------------------------------------------------ */

function hashCode(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** @param {string} [name] @param {string} [email] */
function initialsFor(name, email) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return '··';
}

/**
 * Deliverability state, using the same thresholds as the contacts table
 * (emailStatus in client/src/pages/contacts/ContactsListPage.tsx) so a contact
 * never reads as Valid in one place and Risky in the other.
 *
 * @param {object|null} contact
 * @returns {{label: string, variant: string}|null}
 */
function verificationFor(contact) {
  if (!contact) return null;
  if (contact.is_bounced) return { label: 'Bounced', variant: 'pill-invalid' };

  const verified = Boolean(contact.dcs_verified_at) || contact.dcs_score != null;
  if (!verified) return { label: 'Unverified', variant: 'pill-neutral' };
  if (contact.dcs_syntax_ok === false) return { label: 'Invalid', variant: 'pill-invalid' };
  if (contact.dcs_domain_ok === false) return { label: 'Not found', variant: 'pill-neutral' };

  const score = contact.dcs_score ?? 0;
  if (contact.dcs_smtp_ok === true || score >= 80) return { label: 'Valid', variant: 'pill-valid' };
  if (score >= 50) return { label: 'Risky', variant: 'pill-risky' };
  return { label: 'Undeliverable', variant: 'pill-invalid' };
}

/**
 * A link that opens somewhere in the web app, or plain text when no app URL is
 * configured — a link to nowhere is worse than no link.
 *
 * @param {string} path Path within the app, e.g. "/campaigns/abc".
 * @param {string} label
 * @param {string} [title]
 * @returns {HTMLElement}
 */
function openInAppLink(path, label, title) {
  if (!state.appUrl) {
    const span = document.createElement('span');
    span.textContent = label;
    return span;
  }

  const link = document.createElement('a');
  link.className = 'app-link';
  link.href = `${state.appUrl}${path}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  if (title) link.title = title;
  return link;
}

function renderIdentity() {
  const form = readForm();
  const name = [form.first_name, form.last_name].filter(Boolean).join(' ');
  const display = name || form.email || 'Nobody detected';

  // Once they're a real contact, their name is the doorway to their full
  // record in the app.
  el.personName.textContent = '';
  el.personName.appendChild(
    state.contact
      ? openInAppLink(`/contacts/${state.contact.id}`, display, 'Open this contact in Sincerely')
      : document.createTextNode(display)
  );

  const seed = (name || form.email || '?').toLowerCase();
  const [from, to] = AVATAR_GRADIENTS[hashCode(seed) % AVATAR_GRADIENTS.length];
  el.avatar.style.background = `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
  el.avatar.textContent = initialsFor(name, form.email);

  const bits = [];
  if (form.job_title) bits.push(form.job_title);
  if (form.company) bits.push(form.company);
  if (bits.length === 0 && form.email && name) bits.push(form.email);
  if (bits.length === 0) {
    const source = SOURCE_LABEL[state.person?.source];
    bits.push(source ? `Detected from ${source}` : 'Open a profile or an email, or type an address below.');
  }
  el.personSub.textContent = bits.join(' · ');

  const verification = verificationFor(state.contact);
  if (verification) {
    el.verification.textContent = verification.label;
    el.verification.className = `pill ${verification.variant}`;
    el.verification.classList.remove('hidden');
  } else {
    el.verification.classList.add('hidden');
  }
}

/* ------------------------------------------------------------------ */
/* Standing strip                                                     */
/* ------------------------------------------------------------------ */

/** @param {string} isoDate */
function formatDate(isoDate) {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The one-line history above the picker. Ordered by what would change your
 * mind: suppressed first, then a reply, then engagement, then bare enrolment.
 */
function renderStandingStrip() {
  el.standingStrip.textContent = '';
  el.standingStrip.className = 'standing-strip';

  if (state.looking || !currentEmailIsValid()) {
    el.standingStrip.classList.add('hidden');
    return;
  }

  const engagement = state.engagement;
  const activeCount = state.memberships.filter((m) => m.is_active).length;
  let text = null;
  let tone = '';

  if (state.suppressed) {
    text = 'Suppressed — no campaign will email this address.';
    tone = 'suppressed';
  } else if (engagement?.hasReplied) {
    const when = formatDate(engagement.lastActivityAt);
    text = `Replied${engagement.lastCampaignName ? ` to "${engagement.lastCampaignName}"` : ''}${when ? ` · ${when}` : ''}`;
    tone = 'replied';
  } else if (engagement && (engagement.opened > 0 || engagement.clicked > 0)) {
    const parts = [];
    if (engagement.sent > 0) parts.push(`${engagement.sent} sent`);
    if (engagement.opened > 0) parts.push(`opened ${engagement.opened}×`);
    if (engagement.clicked > 0) parts.push(`clicked ${engagement.clicked}×`);
    text = parts.join(' · ');
  } else if (activeCount > 0) {
    text = `In ${activeCount} active campaign${activeCount > 1 ? 's' : ''}`;
  } else if (state.contact) {
    text = 'Known contact · no campaign activity yet';
  } else if (currentEmailIsValid()) {
    text = 'New contact — adding will create them';
  }

  if (!text) {
    el.standingStrip.classList.add('hidden');
    return;
  }

  if (tone) el.standingStrip.classList.add(tone);
  const label = document.createElement('span');
  label.textContent = text;
  el.standingStrip.appendChild(label);
  el.standingStrip.classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* Form <-> state                                                     */
/* ------------------------------------------------------------------ */

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
  if (!person) return;
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

/**
 * Every address the page offered, including the one in the form.
 *
 * Read from the DOM rather than from the scrape that produced it: the
 * candidates list is rendered from exactly the same data, and deriving from
 * what's on screen means the button can never disagree with what the user can
 * see. Deduplicated, since a page often lists the same person twice.
 *
 * @returns {string[]}
 */
function pageEmails() {
  const fromSelect = [...el.candidates.options].map((option) => option.value);
  const all = [el.email.value, ...fromSelect];
  return [...new Set(all.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_PATTERN.test(e)))];
}

function currentEmailIsValid() {
  return EMAIL_PATTERN.test(el.email.value.trim());
}

function syncButtons() {
  const hasEmail = currentEmailIsValid();
  el.add.disabled = !hasEmail || !state.selectedCampaignId;
  el.suppress.disabled = !hasEmail || state.suppressed;
  el.suppress.textContent = state.suppressed
    ? 'Already suppressed'
    : state.suppressArmed
      ? 'Click again to confirm'
      : 'Never contact again';

  const target = state.campaigns.find((c) => c.id === state.selectedCampaignId);
  el.addLabel.textContent = target ? `Add to ${target.name}` : 'Add to campaign';

  // Bulk is offered only when the page really does hold several people —
  // otherwise it's a button that does the same as the one above it.
  const bulk = pageEmails();
  el.bulkAdd.classList.toggle('hidden', bulk.length < 2);
  el.bulkAdd.disabled = !state.selectedCampaignId;
  el.bulkLabel.textContent = `Add all ${bulk.length} addresses on this page`;

  el.noEmailHelp.classList.toggle('hidden', hasEmail);

  // Nudge the user into the details when there's nothing to act on yet.
  const summary = hasEmail ? 'Edit details' : 'Enter an email address';
  el.detailsSummary.textContent = summary;
}

/* ------------------------------------------------------------------ */
/* Campaign picker                                                    */
/* ------------------------------------------------------------------ */

/**
 * Draw the filtered campaign list and keep the active row in view.
 * Finished campaigns are listed but disabled — hiding them makes the picker
 * look broken when a campaign the user expects is missing.
 */
function renderPicker() {
  el.campaignList.textContent = '';

  if (state.campaigns.length === 0 && state.finished.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'campaign-empty';
    empty.textContent = 'No campaigns on this account yet.';
    el.campaignList.appendChild(empty);
    return;
  }

  if (state.filtered.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'campaign-empty';
    empty.textContent = 'No campaigns match that.';
    el.campaignList.appendChild(empty);
  }

  state.filtered.forEach((campaign, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `campaign-option${index === state.activeIndex ? ' active' : ''}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(index === state.activeIndex));

    const dot = document.createElement('span');
    dot.className = `campaign-status-dot ${campaign.status}`;
    button.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'campaign-option-name';
    name.textContent = campaign.name;
    button.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'campaign-option-meta';
    meta.textContent = campaign.status;
    button.appendChild(meta);

    button.addEventListener('click', () => {
      state.activeIndex = index;
      selectActive();
      addToCampaign();
    });
    // Hovering shouldn't silently change what Enter does, but it should track
    // the pointer so click and keyboard agree.
    button.addEventListener('mousemove', () => {
      if (state.activeIndex === index) return;
      state.activeIndex = index;
      selectActive();
      renderPicker();
    });

    item.appendChild(button);
    el.campaignList.appendChild(item);
  });

  // Finished campaigns, shown so their absence isn't mistaken for a bug.
  const query = el.campaignSearch.value.trim().toLowerCase();
  const finishedMatches = state.finished.filter((c) => c.name.toLowerCase().includes(query));
  if (finishedMatches.length > 0) {
    const label = document.createElement('li');
    label.className = 'list-group-label';
    label.textContent = "Finished — can't accept contacts";
    el.campaignList.appendChild(label);

    for (const campaign of finishedMatches.slice(0, 4)) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'campaign-option';
      button.disabled = true;

      const dot = document.createElement('span');
      dot.className = 'campaign-status-dot';
      button.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'campaign-option-name';
      name.textContent = campaign.name;
      button.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'campaign-option-meta';
      meta.textContent = campaign.status;
      button.appendChild(meta);

      item.appendChild(button);
      el.campaignList.appendChild(item);
    }
  }

  el.campaignList.querySelector('.campaign-option.active')?.scrollIntoView({ block: 'nearest' });
}

function selectActive() {
  const campaign = state.filtered[state.activeIndex];
  state.selectedCampaignId = campaign?.id ?? null;
  syncButtons();
}

function applyFilter() {
  const query = el.campaignSearch.value.trim().toLowerCase();
  state.filtered = query
    ? state.campaigns.filter((c) => c.name.toLowerCase().includes(query))
    : state.campaigns.slice();
  state.activeIndex = 0;
  selectActive();
  renderPicker();
}

/** @param {string|null} preselectId */
async function loadCampaigns(preselectId) {
  const response = await send('LIST_CAMPAIGNS');

  if (!response.ok) {
    state.campaigns = [];
    state.filtered = [];
    renderPicker();
    showError(response.error);
    syncButtons();
    return;
  }

  state.campaigns = response.data.enrollable || [];
  state.finished = response.data.finished || [];
  state.filtered = state.campaigns.slice();

  // Start on the campaign they used last — that's overwhelmingly the one they
  // want again, and it makes Enter correct without any typing.
  const preselectIndex = state.campaigns.findIndex((c) => c.id === preselectId);
  state.activeIndex = preselectIndex >= 0 ? preselectIndex : 0;

  selectActive();
  renderPicker();
}

/* ------------------------------------------------------------------ */
/* Standing panel                                                     */
/* ------------------------------------------------------------------ */

function renderStanding() {
  el.standingBody.textContent = '';

  const showPanel = state.memberships.length > 0 || (state.contact && !state.looking);
  el.standing.classList.toggle('hidden', !showPanel);
  if (!showPanel) return;

  if (state.suppressed) {
    const warning = document.createElement('p');
    warning.className = 'suppressed-note';
    warning.textContent = 'On your suppression list — campaigns will not email this address.';
    el.standingBody.appendChild(warning);
  }

  if (state.memberships.length === 0) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Not enrolled in any campaign.';
    el.standingBody.appendChild(note);
    return;
  }

  for (const membership of state.memberships) {
    const row = document.createElement('div');
    row.className = 'enrolment';

    const main = document.createElement('div');
    main.className = 'enrolment-main';

    // The campaign name doubles as the way back into the app — the popup can
    // tell you where someone stands, but anything deeper belongs in Sincerely.
    const name = openInAppLink(
      `/campaigns/${membership.campaign_id}`,
      membership.campaign_name || 'Untitled campaign',
      `Open "${membership.campaign_name}" in Sincerely`
    );
    name.classList.add('enrolment-name');
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

function renderAll() {
  renderIdentity();
  renderStandingStrip();
  renderStanding();
  syncButtons();
}

/* ------------------------------------------------------------------ */
/* Lookup                                                             */
/* ------------------------------------------------------------------ */

function clearBackfilledFields() {
  for (const key of state.backfilled) {
    if (el[key]) el[key].value = '';
  }
  state.backfilled.clear();
}

/** @param {'firstName'|'lastName'|'company'|'jobTitle'} key @param {string|null} value */
function backfill(key, value) {
  if (el[key].value || !value) return;
  el[key].value = value;
  state.backfilled.add(key);
}

async function refreshStanding() {
  const email = el.email.value.trim().toLowerCase();
  const seq = (lookupSeq += 1);

  // Drop everything tied to the previous address before going anywhere. A
  // stale panel is worse than an empty one: Remove acts on state.contact, so
  // showing one person's enrolments under another's address could remove the
  // wrong contact from a live campaign.
  state.contact = null;
  state.memberships = [];
  state.engagement = null;
  state.suppressed = false;
  clearBackfilledFields();

  if (!EMAIL_PATTERN.test(email)) {
    state.looking = false;
    renderAll();
    return;
  }

  state.looking = true;
  renderAll();

  const response = await send('LOOKUP_PERSON', { email });

  // A newer lookup started while this one was in flight — that one owns the UI.
  if (seq !== lookupSeq) return;
  state.looking = false;

  if (!response.ok) {
    renderAll();
    showError(response.error);
    return;
  }

  state.contact = response.data.contact;
  state.memberships = response.data.campaigns || [];
  state.engagement = response.data.engagement || null;
  state.suppressed = Boolean(response.data.suppressed);

  if (state.contact) {
    backfill('firstName', state.contact.first_name);
    backfill('lastName', state.contact.last_name);
    backfill('company', state.contact.company);
    backfill('jobTitle', state.contact.job_title);
  }

  renderAll();
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

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
  const campaignId = state.selectedCampaignId;
  const person = readForm();
  if (!campaignId || !EMAIL_PATTERN.test(person.email)) return;

  el.add.disabled = true;
  el.addLabel.textContent = 'Adding…';
  clearStatus();

  const response = await send('ADD_TO_CAMPAIGN', { campaignId, person });

  el.add.disabled = false;

  if (!response.ok) {
    syncButtons();
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
      actions: [
        {
          label: 'Undo',
          onClick: async () => {
            const undo = await send('REMOVE_FROM_CAMPAIGN', { campaignId, contactId });
            if (undo.ok) {
              setStatus(`Removed from "${campaignName}" again.`);
              await refreshStanding();
            } else {
              showError(undo.error);
            }
          },
        },
      ],
    });
  } else {
    setStatus(`Already enrolled in "${campaignName}" — nothing changed.`);
  }

  await refreshStanding();
}

/**
 * Enrol every address on the page into the selected campaign.
 *
 * Two-step, like suppression: the first click says exactly what is about to
 * happen and to how many people, the second does it. Enrolling a page's worth
 * of strangers into a live sequence is not an undo-able-by-one-click action.
 */
async function bulkAdd() {
  const emails = pageEmails();
  const target = state.campaigns.find((c) => c.id === state.selectedCampaignId);
  if (!target || emails.length < 2) return;

  if (!state.bulkArmed) {
    state.bulkArmed = true;
    el.bulkLabel.textContent = `Add these ${emails.length}? Click again`;
    setStatus(
      `About to add ${emails.length} address${emails.length > 1 ? 'es' : ''} to "${target.name}":\n` +
        `${emails.slice(0, 8).join(', ')}${emails.length > 8 ? `, and ${emails.length - 8} more` : ''}`
    );
    return;
  }

  state.bulkArmed = false;
  el.bulkAdd.disabled = true;
  el.bulkLabel.textContent = 'Adding…';

  const response = await send('BULK_ADD', { campaignId: target.id, emails });

  el.bulkAdd.disabled = false;
  syncButtons();

  if (!response.ok) {
    showError(response.error);
    return;
  }

  const { requested, created, added, skipped, campaignName } = response.data;
  const parts = [`Added ${added} of ${requested} to "${campaignName}".`];
  if (created > 0) parts.push(`${created} new contact${created === 1 ? '' : 's'} created.`);
  if (skipped > 0) parts.push(`${skipped} skipped — already enrolled, or held by another campaign.`);
  setStatus(parts.join(' '), { variant: added > 0 ? 'success' : undefined });

  await refreshStanding();
}

/**
 * Resolve the exclusivity block: pull them out of the campaigns holding them,
 * then enrol here.
 *
 * @param {string} contactId
 * @param {string[]} fromCampaignIds
 */
async function moveToCampaign(contactId, fromCampaignIds) {
  const campaignId = state.selectedCampaignId;
  if (!campaignId || !contactId) return;

  setStatus('Moving…');

  const response = await send('MOVE_TO_CAMPAIGN', { campaignId, contactId, fromCampaignIds });
  if (!response.ok) {
    showError(response.error);
    return;
  }

  const { campaignName, movedFrom } = response.data;
  setStatus(
    `Moved to "${campaignName}" — removed from ${movedFrom} other campaign${movedFrom === 1 ? '' : 's'}.`,
    { variant: 'success' }
  );
  await refreshStanding();
}

async function suppressPerson() {
  const email = el.email.value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return;

  // Two-step rather than a confirm() dialog: a native dialog in a popup is
  // both ugly and liable to dismiss the popup, and this is not an action to
  // fire on a stray click.
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

/* ------------------------------------------------------------------ */
/* Prospector                                                         */
/* ------------------------------------------------------------------ */

/**
 * Look the person up in the prospect database. Free — this only finds the
 * record; getting the address is a separate, explicit spend.
 */
async function prospectFind() {
  const person = readForm();
  if (!person.first_name && !person.last_name) {
    setStatus('Add a name first — the prospect database searches on the person, not the page.', {
      variant: 'error',
    });
    return;
  }

  el.prospectFind.disabled = true;
  el.prospectFind.textContent = 'Searching…';
  el.prospectResult.classList.add('hidden');
  clearStatus();

  const response = await send('PROSPECT_FIND', { person });

  el.prospectFind.disabled = false;
  el.prospectFind.textContent = 'Find their email';

  if (!response.ok) {
    showError(response.error);
    return;
  }

  renderProspect(response.data, person);
}

/**
 * @param {{match: object|null, confidence?: string, credits?: object, searched?: number}} data
 * @param {object} person
 */
function renderProspect(data, person) {
  el.prospectResult.textContent = '';
  el.prospectResult.classList.remove('hidden');

  if (!data.match) {
    const note = document.createElement('p');
    note.className = 'prospect-note';
    note.style.marginTop = '0';
    note.textContent =
      `No match for ${[person.first_name, person.last_name].filter(Boolean).join(' ')}` +
      `${person.company ? ` at ${person.company}` : ''} in the prospect database. Nothing was charged.`;
    el.prospectResult.appendChild(note);
    return;
  }

  const { match } = data;

  const name = document.createElement('div');
  name.className = 'prospect-name';
  name.textContent = match.full_name;
  el.prospectResult.appendChild(name);

  const metaBits = [match.job_title, match.company, match.location].filter(Boolean);
  if (metaBits.length > 0) {
    const meta = document.createElement('div');
    meta.className = 'prospect-meta';
    meta.textContent = metaBits.join(' · ');
    el.prospectResult.appendChild(meta);
  }

  // A name-and-company match is a guess, and the guess costs money if it's
  // wrong — so say so rather than presenting it as certain.
  if (data.confidence === 'likely') {
    const note = document.createElement('span');
    note.className = 'prospect-note';
    note.textContent = 'Matched on name and company, not the profile URL — check this is the right person.';
    el.prospectResult.appendChild(note);
  }

  if (!match.has_email) {
    const note = document.createElement('span');
    note.className = 'prospect-note';
    note.textContent = 'The provider has no work email on record for them, so revealing would find nothing.';
    el.prospectResult.appendChild(note);
    return;
  }

  const actions = document.createElement('div');
  actions.className = 'prospect-actions';

  const revealButton = document.createElement('button');
  revealButton.type = 'button';
  revealButton.className = 'btn-primary btn-xs';
  revealButton.textContent = match.already_revealed ? 'Get email (free)' : 'Reveal email';
  revealButton.addEventListener('click', () => prospectReveal(match, revealButton));
  actions.appendChild(revealButton);

  const cost = document.createElement('span');
  cost.className = 'prospect-cost';
  const remaining = data.credits?.remaining;
  cost.textContent = match.already_revealed
    ? 'Already revealed — no credit'
    : `1 credit${Number.isFinite(remaining) ? ` · ${remaining} left` : ''}, refunded if no email is found`;
  actions.appendChild(cost);

  el.prospectResult.appendChild(actions);
}

/**
 * @param {object} match
 * @param {HTMLButtonElement} button
 */
async function prospectReveal(match, button) {
  button.disabled = true;
  button.textContent = 'Revealing…';

  const response = await send('PROSPECT_REVEAL', { providerPersonId: match.id });

  if (!response.ok) {
    button.disabled = false;
    button.textContent = 'Reveal email';
    showError(response.error);
    return;
  }

  const { found, email, credits } = response.data;

  if (!found || !email) {
    button.disabled = true;
    button.textContent = 'No email found';
    setStatus(
      `No work email on record for ${match.full_name}. The credit was refunded automatically${
        Number.isFinite(credits?.remaining) ? ` — ${credits.remaining} left` : ''
      }.`
    );
    return;
  }

  // Straight into the flow: the address is now the thing to act on.
  el.email.value = email;
  el.prospectResult.classList.add('hidden');
  setStatus(`Found ${email}. Pick a campaign and add them.`, { variant: 'success' });
  await refreshStanding();
  el.campaignSearch.focus();
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
      await refreshStanding();
    });

    item.appendChild(button);
    el.nameMatches.appendChild(item);
  }
  el.nameMatches.classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* Details disclosure                                                 */
/* ------------------------------------------------------------------ */

function toggleDetails(force) {
  const open = force ?? el.detailsBody.classList.contains('hidden');
  el.detailsBody.classList.toggle('hidden', !open);
  el.detailsToggle.setAttribute('aria-expanded', String(open));
  if (open) el.email.focus();
}

/* ------------------------------------------------------------------ */
/* Init                                                               */
/* ------------------------------------------------------------------ */

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
      renderIdentity();
      refreshStanding();
    }, 450)
  );

  for (const key of ['firstName', 'lastName', 'company', 'jobTitle']) {
    el[key].addEventListener('input', () => {
      // Once the user types into a field it's theirs, not the API's — drop the
      // backfill mark so the next lookup doesn't clear what they just wrote.
      state.backfilled.delete(key);
      renderIdentity();
    });
  }

  el.candidates.addEventListener('change', () => {
    if (!el.candidates.value) return;
    el.email.value = el.candidates.value;
    state.suppressArmed = false;
    refreshStanding();
  });

  el.campaignSearch.addEventListener('input', applyFilter);
  el.campaignSearch.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.activeIndex = Math.min(state.activeIndex + 1, state.filtered.length - 1);
      selectActive();
      renderPicker();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.activeIndex = Math.max(state.activeIndex - 1, 0);
      selectActive();
      renderPicker();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!el.add.disabled) addToCampaign();
    }
  });

  el.add.addEventListener('click', addToCampaign);
  el.bulkAdd.addEventListener('click', bulkAdd);
  el.suppress.addEventListener('click', suppressPerson);
  el.searchByName.addEventListener('click', searchByName);
  el.prospectFind.addEventListener('click', prospectFind);
  el.detailsToggle.addEventListener('click', () => toggleDetails());

  // Enter adds from anywhere except a textarea or the details fields, where
  // it would be surprising.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      window.close();
      return;
    }
    if (event.key === 'Enter' && event.target === document.body && !el.add.disabled) {
      event.preventDefault();
      addToCampaign();
    }
  });
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
  state.appUrl = String(context.data.appUrl || '').replace(/\/+$/, '');
  fillForm(context.data.person);
  renderAll();

  // The picker owns the keyboard from the moment the popup opens.
  el.campaignSearch.focus();

  // If the page gave us nothing usable, the details are where the work is.
  if (!context.data.person?.email) toggleDetails(true);

  await Promise.all([loadCampaigns(context.data.lastCampaignId), refreshStanding()]);
}

init().catch((err) => {
  el.main.classList.remove('hidden');
  setStatus(err?.message || 'The popup failed to start.', { variant: 'error' });
});

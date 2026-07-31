/**
 * Popup UI.
 *
 * Holds no credentials and talks to no API — every operation goes through the
 * service worker, which replies with {ok, data} or {ok, error}. All text from
 * the server or the page is written with textContent, never innerHTML.
 *
 * The layout answers three questions in order: who is this, what has already
 * happened with them, and which lead list should they go on. Editing their
 * details is a rarer job, so it lives behind a disclosure.
 */

import { initTheme } from '../lib/theme.js';
import { classifyEmail, rankResults } from '../lib/harvest.js';

const EMAIL_PATTERN = /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * Contact status → badge variant, matching the app's status
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
  actionBar: document.getElementById('action-bar'),
  setupOpenOptions: document.getElementById('setup-open-options'),
  setupConnectTab: document.getElementById('setup-connect-tab'),
  setupStatus: document.getElementById('setup-status'),
  setupGrant: document.getElementById('setup-grant'),

  avatar: document.getElementById('avatar'),
  personName: document.getElementById('person-name'),
  personSub: document.getElementById('person-sub'),
  verification: document.getElementById('verification'),
  standingStrip: document.getElementById('standing-strip'),

  listSearch: document.getElementById('list-search'),
  listPicker: document.getElementById('lead-lists'),
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

  scanBlock: document.getElementById('scan-block'),
  scanSub: document.getElementById('scan-sub'),
  scan: document.getElementById('scan'),
  scanBody: document.getElementById('scan-body'),
  scanToolbar: document.getElementById('scan-toolbar'),
  scanAll: document.getElementById('scan-all'),
  scanCount: document.getElementById('scan-count'),
  scanNewOnly: document.getElementById('scan-new-only'),
  scanResults: document.getElementById('scan-results'),
  scanAdd: document.getElementById('scan-add'),
  unlistedBlock: document.getElementById('unlisted-block'),
  unlistedTitle: document.getElementById('unlisted-title'),
  unlistedResults: document.getElementById('unlisted-results'),
  findAll: document.getElementById('find-all'),

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
  /** Every lead list, and the filtered subset currently listed. */
  lists: [],
  finished: [],
  filtered: [],
  activeIndex: 0,
  selectedListId: null,
  /** Web app origin, for "open in Sincerely" links. Empty disables them. */
  appUrl: '',
  /** The tab the popup was opened over, so a scan knows which site to read. */
  tabUrl: '',
  /** Harvest results, and which of them are ticked. */
  scanResults: [],
  scanSelected: new Set(),
  /** True once the whole site has been crawled, not just the open page. */
  scannedSite: false,
  /**
   * People the site names without publishing an address, each gaining a
   * `finding`/`found`/`failed` state as the finder works through them.
   * @type {Array<{first_name: string, last_name: string, job_title: string|null,
   *   state?: string, email?: string, confidence?: number, verified?: boolean,
   *   reason?: string}>}
   */
  unlisted: [],
  /** The site's own domain, which is what addresses get looked for at. */
  siteDomain: '',
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
 * @param {{variant?: 'error'|'success'|'working', actions?: Array<{label: string, primary?: boolean, onClick: () => void}>}} [opts]
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
 * Show a failure, with a way out of it where one exists.
 *
 * @param {{message: string, isAuthProblem?: boolean, code?: string, contactId?: string}} error
 */
function showError(error) {
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
 * @param {string} path Path within the app, e.g. "/contacts?list=abc".
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
    text = 'Suppressed — this address will not be emailed.';
    tone = 'suppressed';
  } else if (engagement?.hasReplied) {
    const when = formatDate(engagement.lastActivityAt);
    // Deliberately not naming which campaign: the extension deals in lists,
    // and "they have replied to you before" is the part that changes what you
    // do next.
    text = `Replied${when ? ` · ${when}` : ''}`;
    tone = 'replied';
  } else if (engagement && (engagement.opened > 0 || engagement.clicked > 0)) {
    const parts = [];
    if (engagement.sent > 0) parts.push(`${engagement.sent} sent`);
    if (engagement.opened > 0) parts.push(`opened ${engagement.opened}×`);
    if (engagement.clicked > 0) parts.push(`clicked ${engagement.clicked}×`);
    text = parts.join(' · ');
  } else if (activeCount > 0) {
    text = `On ${activeCount} lead list${activeCount > 1 ? 's' : ''}`;
  } else if (state.contact) {
    text = 'Known contact · no list membership yet';
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
  el.add.disabled = !hasEmail || !state.selectedListId;
  el.suppress.disabled = !hasEmail || state.suppressed;
  el.suppress.textContent = state.suppressed
    ? 'Already suppressed'
    : state.suppressArmed
      ? 'Click again to confirm'
      : 'Never contact again';

  const target = state.lists.find((l) => l.id === state.selectedListId);
  el.addLabel.textContent = target ? `Add to ${target.name}` : 'Add to list';

  // Bulk is offered only when the page really does hold several people —
  // otherwise it's a button that does the same as the one above it.
  if (state.scanResults.length > 0) syncScanToolbar();

  const bulk = pageEmails();
  el.bulkAdd.classList.toggle('hidden', bulk.length < 2);
  el.bulkAdd.disabled = !state.selectedListId;
  el.bulkLabel.textContent = `Add all ${bulk.length} addresses on this page`;

  el.noEmailHelp.classList.toggle('hidden', hasEmail);

  // Nudge the user into the details when there's nothing to act on yet.
  const summary = hasEmail ? 'Edit details' : 'Enter an email address';
  el.detailsSummary.textContent = summary;
}

/* ------------------------------------------------------------------ */
/* Lead list picker                                                   */
/* ------------------------------------------------------------------ */

/**
 * Draw the filtered lead lists and keep the active row in view.
 *
 * Lists, not campaigns. Every list can take a contact — there is no equivalent
 * of a finished campaign that has to be shown-but-disabled — so this is simply
 * the account's lists, with the default one first as the server orders them.
 */
function renderPicker() {
  el.listPicker.textContent = '';

  if (state.lists.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'campaign-empty';
    empty.textContent = 'No lead lists on this account yet. Create one in Sincerely first.';
    el.listPicker.appendChild(empty);
    return;
  }

  if (state.filtered.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'campaign-empty';
    empty.textContent = 'No lists match that.';
    el.listPicker.appendChild(empty);
  }

  state.filtered.forEach((list, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `campaign-option${index === state.activeIndex ? ' active' : ''}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(index === state.activeIndex));

    // The list's own colour, the same swatch the app shows it with — so a list
    // is recognisable here by the thing you already recognise it by.
    const swatch = document.createElement('span');
    swatch.className = 'list-swatch';
    swatch.style.background = list.color || 'var(--c-indigo)';
    button.appendChild(swatch);

    const name = document.createElement('span');
    name.className = 'campaign-option-name';
    name.textContent = list.name;
    button.appendChild(name);

    if (list.is_default) {
      const badge = document.createElement('span');
      badge.className = 'list-default';
      badge.textContent = 'Default';
      button.appendChild(badge);
    }

    const meta = document.createElement('span');
    meta.className = 'campaign-option-meta';
    // Size is the useful thing to know about a list at a glance.
    const size = list.contact_count ?? 0;
    meta.textContent = `${size} contact${size === 1 ? '' : 's'}`;
    button.appendChild(meta);

    button.addEventListener('click', () => {
      state.activeIndex = index;
      selectActive();
      addToList();
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
    el.listPicker.appendChild(item);
  });

  el.listPicker.querySelector('.campaign-option.active')?.scrollIntoView({ block: 'nearest' });
}

function selectActive() {
  const list = state.filtered[state.activeIndex];
  const changed = state.selectedListId !== (list?.id ?? null);
  state.selectedListId = list?.id ?? null;

  /*
   * Changing the destination cancels an armed bulk add. The armed message
   * names a list ("Add these 12 to 'Warm leads'? Click again"), and firing it
   * at a list picked afterwards would put a page of people somewhere the user
   * was never asked about.
   */
  if (changed && state.bulkArmed) {
    state.bulkArmed = false;
    clearStatus();
  }

  syncButtons();
}

function applyFilter() {
  const query = el.listSearch.value.trim().toLowerCase();
  state.filtered = query
    ? state.lists.filter((l) => l.name.toLowerCase().includes(query))
    : state.lists.slice();
  state.activeIndex = 0;
  selectActive();
  renderPicker();
}

/** @param {string|null} preselectId */
async function loadLists(preselectId) {
  const response = await send('LIST_LISTS');

  if (!response.ok) {
    state.lists = [];
    state.filtered = [];
    renderPicker();
    showError(response.error);
    syncButtons();
    return;
  }

  state.lists = response.data.lists || [];
  state.filtered = state.lists.slice();

  // Start on the list they used last — overwhelmingly the one they want again,
  // and it makes Enter correct without any typing.
  const preselectIndex = state.lists.findIndex((l) => l.id === preselectId);
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
    warning.textContent = 'On your suppression list — this address will not be emailed.';
    el.standingBody.appendChild(warning);
  }

  if (state.memberships.length === 0) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Not on any lead list yet.';
    el.standingBody.appendChild(note);
    return;
  }

  for (const membership of state.memberships) {
    const row = document.createElement('div');
    row.className = 'enrolment';

    const main = document.createElement('div');
    main.className = 'enrolment-main';

    // The list name doubles as the way back into the app — the popup can tell
    // you where someone stands, but anything deeper belongs in Sincerely.
    const name = openInAppLink(
      `/contacts?list=${membership.id}`,
      membership.name || 'Untitled list',
      `Open "${membership.name}" in Sincerely`
    );
    name.classList.add('enrolment-name');
    main.appendChild(name);

    if (Number.isFinite(membership.contact_count)) {
      const meta = document.createElement('div');
      meta.className = 'enrolment-meta';
      const detail = document.createElement('span');
      detail.textContent = `${membership.contact_count} contact${membership.contact_count === 1 ? '' : 's'}`;
      meta.appendChild(detail);
      main.appendChild(meta);
    }
    row.appendChild(main);

    const removeButton = document.createElement('button');
    removeButton.className = 'btn-secondary btn-xs remove-btn';
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.title = `Take them off "${membership.name}" — they stay in your contacts`;
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
  // wrong contact from a live list.
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
  state.memberships = response.data.lists || [];
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

  const response = await send('REMOVE_FROM_LIST', {
    listId: membership.id,
    contactId: state.contact.id,
  });

  if (!response.ok) {
    button.disabled = false;
    button.textContent = 'Remove';
    showError(response.error);
    return;
  }

  setStatus(`Taken off "${membership.name}". They stay in your contacts.`, { variant: 'success' });
  await refreshStanding();
}

async function addToList() {
  const listId = state.selectedListId;
  const person = readForm();
  if (!listId || !EMAIL_PATTERN.test(person.email)) return;

  el.add.disabled = true;
  el.addLabel.textContent = 'Adding…';
  clearStatus();

  const response = await send('ADD_TO_LIST', { listId, person });

  el.add.disabled = false;

  if (!response.ok) {
    syncButtons();
    showError(response.error);
    return;
  }

  const { added, contactCreated, alreadyOnList, listName, contactId } = response.data;

  if (added > 0 && !alreadyOnList) {
    const parts = [`Added to "${listName}".`];
    if (contactCreated) parts.push('New contact created.');
    setStatus(parts.join(' '), {
      variant: 'success',
      actions: [
        {
          label: 'Undo',
          onClick: async () => {
            const undo = await send('REMOVE_FROM_LIST', { listId, contactId });
            if (undo.ok) {
              setStatus(`Taken back off "${listName}".`);
              await refreshStanding();
            } else {
              showError(undo.error);
            }
          },
        },
      ],
    });
  } else {
    setStatus(`Already on "${listName}" — nothing changed.`);
  }

  await refreshStanding();
}

/**
 * Add every address on the page to the selected list.
 *
 * Two-step, like suppression: the first click says exactly what is about to
 * happen and to how many people, the second does it. Putting a page's worth of
 * strangers onto a list a live campaign draws from is not an
 * undo-in-one-click action.
 */
async function bulkAdd() {
  const emails = pageEmails();
  const target = state.lists.find((l) => l.id === state.selectedListId);
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

  const response = await send('BULK_ADD', { listId: target.id, emails });

  el.bulkAdd.disabled = false;
  syncButtons();

  if (!response.ok) {
    showError(response.error);
    return;
  }

  const { requested, created, added, alreadyOnList, failed, listName } = response.data;
  const parts = [`Added ${added} of ${requested} to "${listName}".`];
  if (created > 0) parts.push(`${created} new contact${created === 1 ? '' : 's'} created.`);
  if (alreadyOnList > 0) parts.push(`${alreadyOnList} were already on it.`);
  if (failed > 0) parts.push(`${failed} could not be added.`);
  setStatus(parts.join(' '), { variant: added > 0 ? 'success' : undefined });

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
      `This blocks every future send to ${email}, and takes them off every lead list. Click again to confirm.`
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
      ? `${email} suppressed, and taken off ${removedFrom} lead list${removedFrom > 1 ? 's' : ''}.`
      : `${email} suppressed. They were not on any lead list.`,
    { variant: 'success' }
  );

  await refreshStanding();
}

/* ------------------------------------------------------------------ */
/* Site scan                                                          */
/* ------------------------------------------------------------------ */

/** Only http(s) pages can be read; a chrome:// tab has nothing to offer. */
function scannableOrigin() {
  try {
    const url = new URL(state.tabUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function renderScanSub() {
  const origin = scannableOrigin();
  el.scanBlock.classList.toggle('hidden', !origin);
  if (!origin) return;

  const host = origin.replace(/^https?:\/\//, '');
  el.scanSub.textContent = state.scanResults.length
    ? `${state.scanResults.length} found${state.scannedSite ? ` across ${host}` : ' on this page'}`
    : `Nothing on this page — scan ${host} for its contact and team pages.`;
  el.scan.textContent = state.scannedSite ? 'Rescan' : 'Scan site';
}

/**
 * Show what's on the page the moment the popup opens, the way the free
 * scrapers do — no permission prompt and no crawl, because the content script
 * has already read this tab under activeTab. Scanning the rest of the site is
 * then an obvious next step rather than the only one.
 */
function showPageEmails() {
  const found = (state.person?.email_candidates || []).map((email) => email.toLowerCase());
  if (found.length === 0) {
    renderScanSub();
    return;
  }

  const person = state.person || {};
  state.scanResults = rankResults(
    [...new Set(found)]
      .map((email) => {
        const kind = classifyEmail(email);
        if (!kind) return null;
        // The page's own person gets their scraped name; the rest are bare
        // addresses until a scan or the user fills them in.
        const isFocus = email === String(person.email || '').toLowerCase();
        return {
          email,
          kind,
          first_name: isFocus ? person.first_name || null : null,
          last_name: isFocus ? person.last_name || null : null,
          company: person.company || null,
          source_url: person.source_url || state.tabUrl,
          alreadyAContact: false,
        };
      })
      .filter(Boolean)
  );

  state.scanSelected = new Set(state.scanResults.filter((r) => r.kind === 'person').map((r) => r.email));
  renderScan({ pagesScanned: 1, origin: scannableOrigin() || '' });
}

/**
 * Scan the site the popup was opened over.
 *
 * The host permission is requested here rather than declared in the manifest:
 * asking for one origin when the user presses Scan is both honest and far
 * likelier to survive review than blanket access to every site they visit.
 */
async function scanSite() {
  const origin = scannableOrigin();
  if (!origin) return;

  // Ask first, with nothing awaited before it. chrome.permissions.request must
  // run inside the user gesture that triggered it, and any prior `await`
  // breaks that chain — a permissions.contains() pre-check made every request
  // throw, which is why scanning a new site silently did nothing. Requesting a
  // permission already held resolves true straight away, so the pre-check
  // bought nothing anyway.
  const origins = [`${origin}/*`];
  const granted = await chrome.permissions.request({ origins }).catch(() => false);
  if (!granted) {
    setStatus(`Sincerely needs your permission to read ${origin}. Press Scan again to allow it.`, {
      variant: 'error',
    });
    return;
  }

  el.scan.disabled = true;
  el.scan.textContent = 'Scanning…';
  clearStatus();

  const response = await send('SCAN_SITE', { url: state.tabUrl });

  el.scan.disabled = false;
  el.scan.textContent = 'Scan';

  if (!response.ok) {
    showError(response.error);
    return;
  }

  state.scanResults = response.data.results || [];
  state.scannedSite = true;
  state.unlisted = (response.data.unlisted || []).map((person) => ({ ...person, state: 'idle' }));
  state.siteDomain = response.data.siteDomain || '';
  // Pre-tick the ones worth having: real people this account doesn't hold yet.
  state.scanSelected = new Set(
    state.scanResults.filter((r) => r.kind === 'person' && !r.alreadyAContact).map((r) => r.email)
  );

  renderScan(response.data);
}

/** @param {{pagesScanned: number, origin: string}} meta */
function renderScan(meta) {
  el.scanBody.classList.remove('hidden');
  el.scanResults.textContent = '';
  renderScanSub();

  if (state.scanResults.length === 0) {
    el.scanToolbar.classList.add('hidden');
    el.scanAdd.classList.add('hidden');
    const empty = document.createElement('li');
    empty.className = 'scan-empty';
    empty.textContent = state.scannedSite
      ? state.unlisted.length > 0
        ? `No addresses are published across ${meta.pagesScanned} page${meta.pagesScanned === 1 ? '' : 's'} — but the site names ${state.unlisted.length} ${state.unlisted.length === 1 ? 'person' : 'people'} below, and their addresses can be worked out.`
        : `No addresses found across ${meta.pagesScanned} page${meta.pagesScanned === 1 ? '' : 's'}. Many sites only publish them behind a contact form.`
      : 'No addresses on this page. Try scanning the whole site.';
    el.scanResults.appendChild(empty);
    renderUnlisted();
    return;
  }

  el.scanToolbar.classList.remove('hidden');
  el.scanAdd.classList.remove('hidden');

  for (const result of state.scanResults) {
    const item = document.createElement('li');
    item.className = 'scan-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = state.scanSelected.has(result.email);
    box.addEventListener('change', () => {
      if (box.checked) state.scanSelected.add(result.email);
      else state.scanSelected.delete(result.email);
      syncScanToolbar();
    });
    item.appendChild(box);

    const main = document.createElement('div');
    main.className = 'scan-main';

    const address = document.createElement('div');
    address.className = 'scan-email';
    address.textContent = result.email;
    main.appendChild(address);

    const meta2 = document.createElement('div');
    meta2.className = 'scan-meta';

    const name = [result.first_name, result.last_name].filter(Boolean).join(' ');
    if (name) meta2.appendChild(document.createTextNode(name));

    if (result.kind !== 'person') {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = result.kind === 'role' ? 'role account' : 'shared inbox';
      meta2.appendChild(badge);
    }
    if (result.alreadyAContact) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-info';
      badge.textContent = 'already a contact';
      meta2.appendChild(badge);
    }
    // Worked out rather than read off the page: say so, and say how sure.
    if (result.found) {
      const label = confidenceLabel(result.confidence ?? 0);
      const badge = document.createElement('span');
      badge.className = `confidence ${label.className}`;
      badge.textContent = label.text;
      meta2.appendChild(badge);
    }
    main.appendChild(meta2);
    item.appendChild(main);

    el.scanResults.appendChild(item);
  }

  renderUnlisted();
  syncScanToolbar();
}

/* ------------------------------------------------------------------ */
/* People named without an address                                    */
/* ------------------------------------------------------------------ */

/**
 * A confidence figure and the class that colours it.
 *
 * Shown on every found address without exception. A convention-based guess and
 * a mailbox the server confirmed look identical otherwise, and treating them
 * the same is how someone ends up emailing an address that never existed.
 *
 * @param {number} confidence
 */
function confidenceLabel(confidence) {
  if (confidence >= 90) return { text: 'confirmed', className: 'confidence-high' };
  if (confidence >= 60) return { text: `${confidence}% likely`, className: 'confidence-medium' };
  return { text: `${confidence}% — unconfirmed guess`, className: 'confidence-low' };
}

/**
 * Ask the server for one person's address at the scanned site's domain.
 *
 * @param {number} index Position in state.unlisted.
 */
async function findOneAddress(index) {
  const person = state.unlisted[index];
  if (!person || person.state === 'finding' || person.state === 'found') return;
  if (!state.siteDomain) return;

  person.state = 'finding';
  renderUnlisted();

  const response = await send('FIND_EMAIL', {
    domain: state.siteDomain,
    firstName: person.first_name,
    lastName: person.last_name,
  });

  if (!response.ok) {
    person.state = 'failed';
    person.reason = response.error?.message || 'Lookup failed.';
    renderUnlisted();
    return;
  }

  const data = response.data;
  if (!data.found || !data.email) {
    person.state = 'failed';
    person.reason = data.reason || 'No address could be established.';
    renderUnlisted();
    return;
  }

  person.state = 'found';
  person.email = data.email;
  person.confidence = data.confidence;
  person.verified = data.verified;
  person.reason = data.reason;

  // Fold it into the harvest list so it can be selected and enrolled like any
  // other address — a found address that can't be acted on is no use.
  if (!state.scanResults.some((result) => result.email === data.email)) {
    state.scanResults.push({
      email: data.email,
      kind: 'person',
      first_name: person.first_name,
      last_name: person.last_name,
      source_url: person.source_url || '',
      alreadyAContact: false,
      confidence: data.confidence,
      verified: data.verified,
      found: true,
    });
    // Only pre-tick what the mail server actually confirmed. A guess is the
    // user's call, not ours.
    if (data.verified) state.scanSelected.add(data.email);
  }

  renderScan({ pagesScanned: 0, origin: '' });
}

/** Work through everyone still unfound, a few at a time. */
async function findAllAddresses() {
  el.findAll.disabled = true;
  el.findAll.textContent = 'Finding…';
  try {
    const pending = state.unlisted
      .map((person, index) => ({ person, index }))
      .filter(({ person }) => person.state === 'idle' || person.state === 'failed');

    // Two at a time: each lookup holds an SMTP conversation open, and firing a
    // dozen at one mail server at once is how a sender gets itself blocked.
    const CONCURRENCY = 2;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
      while (cursor < pending.length) {
        const next = pending[cursor];
        cursor += 1;
        await findOneAddress(next.index);
      }
    });
    await Promise.all(workers);
  } finally {
    el.findAll.disabled = false;
    el.findAll.textContent = 'Find all';
  }
}

function renderUnlisted() {
  if (state.unlisted.length === 0) {
    el.unlistedBlock.classList.add('hidden');
    return;
  }

  el.unlistedBlock.classList.remove('hidden');
  el.unlistedTitle.textContent = state.siteDomain
    ? `Named on the site, no address published (@${state.siteDomain})`
    : 'Named on the site, no address published';
  el.unlistedResults.textContent = '';

  state.unlisted.forEach((person, index) => {
    const item = document.createElement('li');
    item.className = 'scan-row';

    const main = document.createElement('div');
    main.className = 'scan-main';

    const name = document.createElement('div');
    name.className = 'unlisted-name';
    name.textContent = [person.first_name, person.last_name].filter(Boolean).join(' ');
    main.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'scan-meta';

    if (person.state === 'found') {
      const address = document.createElement('span');
      address.textContent = person.email;
      meta.appendChild(address);

      const label = confidenceLabel(person.confidence ?? 0);
      const badge = document.createElement('span');
      badge.className = `confidence ${label.className}`;
      badge.textContent = label.text;
      meta.appendChild(badge);
    } else if (person.state === 'finding') {
      meta.textContent = 'Asking the mail server…';
    } else if (person.state === 'failed') {
      meta.textContent = person.reason || 'Nothing found.';
    } else if (person.job_title) {
      meta.textContent = person.job_title;
    } else {
      meta.textContent = 'No address on the site';
    }

    main.appendChild(meta);
    item.appendChild(main);

    if (person.state !== 'found') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-secondary btn-xs find-btn';
      button.textContent = person.state === 'finding' ? '…' : 'Find';
      button.disabled = person.state === 'finding' || !state.siteDomain;
      button.addEventListener('click', () => {
        findOneAddress(index).catch((err) => showError({ message: err?.message }));
      });
      item.appendChild(button);
    }

    el.unlistedResults.appendChild(item);
  });

  const pending = state.unlisted.filter((p) => p.state === 'idle').length;
  el.findAll.disabled = pending === 0 || !state.siteDomain;
  el.findAll.textContent = pending > 0 ? `Find all ${pending}` : 'Find all';
}

function syncScanToolbar() {
  const total = state.scanResults.length;
  const selected = state.scanSelected.size;
  el.scanCount.textContent = `${selected} of ${total} selected`;
  el.scanAll.checked = selected > 0 && selected === total;
  el.scanAll.indeterminate = selected > 0 && selected < total;
  el.scanAdd.disabled = selected === 0 || !state.selectedListId;

  const target = state.lists.find((l) => l.id === state.selectedListId);
  el.scanAdd.textContent = target
    ? `Add ${selected} to ${target.name}`
    : 'Pick a list above first';
}

/** Re-tick only the addresses this account doesn't already hold. */
function selectNewOnly() {
  state.scanSelected = new Set(
    state.scanResults.filter((r) => !r.alreadyAContact).map((r) => r.email)
  );
  for (const box of el.scanResults.querySelectorAll('input[type="checkbox"]')) {
    const row = box.closest('.scan-row');
    const email = row?.querySelector('.scan-email')?.textContent || '';
    box.checked = state.scanSelected.has(email);
  }
  syncScanToolbar();
}

async function addScanned() {
  const target = state.lists.find((l) => l.id === state.selectedListId);
  if (!target || state.scanSelected.size === 0) return;

  const people = state.scanResults.filter((r) => state.scanSelected.has(r.email));

  el.scanAdd.disabled = true;
  el.scanAdd.textContent = 'Adding…';
  clearStatus();

  // The harvested names travel with the addresses, so contacts arrive with
  // something to merge into a first-name token rather than a bare address.
  const response = await send('BULK_ADD', { listId: target.id, people });

  syncScanToolbar();

  if (!response.ok) {
    showError(response.error);
    return;
  }

  const { requested, created, added, alreadyOnList, failed, listName } = response.data;
  const parts = [`Added ${added} of ${requested} to "${listName}".`];
  if (created > 0) parts.push(`${created} new contact${created === 1 ? '' : 's'} created.`);
  if (alreadyOnList > 0) parts.push(`${alreadyOnList} were already on it.`);
  if (failed > 0) parts.push(`${failed} could not be added.`);
  setStatus(parts.join(' '), { variant: added > 0 ? 'success' : undefined });

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
  setStatus(`Found ${email}. Pick a list and add them.`, { variant: 'success' });
  await refreshStanding();
  el.listSearch.focus();
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

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

/** Origin waiting on a permission grant, if the connect stopped there. */
let pendingGrantOrigin = null;

/**
 * @param {string} message
 * @param {'error'|'warn'|null} [variant]
 */
function setSetupStatus(message, variant = null) {
  el.setupStatus.textContent = message;
  el.setupStatus.className = `setup-status${variant ? ` ${variant}` : ''}`;
  el.setupStatus.classList.remove('hidden');
}

/**
 * Show the "one more click" state. Chrome only grants a host permission from a
 * user gesture, so it cannot be folded into the connect itself.
 *
 * @param {string} origin
 */
function askForPermission(origin) {
  pendingGrantOrigin = origin;
  el.setupGrant.textContent = `Allow access to ${new URL(origin).host}`;
  el.setupGrant.classList.remove('hidden');
  el.setupConnectTab.classList.add('hidden');
  setSetupStatus(
    `Connected to ${new URL(origin).host}. Chrome needs your permission for the extension to talk to it — this is the last step.`,
    'warn'
  );
}

/**
 * Set the extension up from the app tab in front of the user.
 *
 * Clicking the toolbar icon grants activeTab for that tab, which is all this
 * needs: the page mints its own key from the session it already has. No key to
 * copy, no domain to configure, and nothing that depends on which host the app
 * or API happens to be deployed on.
 */
async function connectUsingTab() {
  el.setupConnectTab.disabled = true;
  el.setupConnectTab.textContent = 'Connecting…';
  setSetupStatus('Reading your Sincerely session from this tab…');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await send('CONNECT_FROM_TAB', { tabId: tab?.id });

    if (!response.ok) {
      setSetupStatus(response.error?.message || 'Could not connect.', 'error');
      return;
    }

    if (response.data.needsPermission) {
      askForPermission(response.data.needsPermission);
      return;
    }

    // Simpler and safer than patching the setup screen into the main one: the
    // popup restarts with a key in hand and takes its normal path.
    window.location.reload();
  } finally {
    el.setupConnectTab.disabled = false;
    el.setupConnectTab.textContent = 'Connect using this tab';
  }
}

/**
 * Ask Chrome for the API's origin. Requested as the first statement of the
 * click, since anything awaited beforehand breaks the user gesture.
 *
 * Chrome may close the popup while its prompt is up, which kills this function
 * mid-flight. That's survivable: the key is already stored, and GET_CONTEXT
 * reports the outstanding grant, so reopening the popup lands right back here.
 */
function grantApiPermission() {
  if (!pendingGrantOrigin) return;
  const origin = pendingGrantOrigin;
  chrome.permissions
    .request({ origins: [`${origin}/*`] })
    .then((granted) => {
      if (granted) {
        window.location.reload();
        return;
      }
      setSetupStatus(
        `Without access to ${new URL(origin).host} the extension can't reach your account. Press the button again and choose Allow.`,
        'error'
      );
    })
    .catch((err) => setSetupStatus(err?.message || 'Chrome refused the request.', 'error'));
}

function wireEvents() {
  el.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  el.setupOpenOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  el.setupConnectTab.addEventListener('click', () => {
    connectUsingTab().catch((err) =>
      setSetupStatus(err?.message || 'Something went wrong while connecting.', 'error')
    );
  });
  el.setupGrant.addEventListener('click', grantApiPermission);
  el.findAll.addEventListener('click', () => {
    findAllAddresses().catch((err) => showError({ message: err?.message }));
  });

  /*
   * Disarming is immediate; only the lookup is debounced.
   *
   * These used to share the 450ms debounce, which meant that editing the
   * address and confirming quickly fired the *armed* action against the *new*
   * address — the warning had named someone else entirely. Suppression blocks
   * every future send and clears every list, so hitting the wrong person is
   * not a recoverable mistake.
   */
  const disarm = () => {
    state.suppressArmed = false;
    state.bulkArmed = false;
  };

  el.email.addEventListener('input', () => {
    disarm();
    syncButtons();
  });
  el.email.addEventListener(
    'input',
    debounce(() => {
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
    disarm();
    refreshStanding();
  });

  el.listSearch.addEventListener('input', applyFilter);
  el.listSearch.addEventListener('keydown', (event) => {
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
      if (!el.add.disabled) addToList();
    }
  });

  el.add.addEventListener('click', addToList);
  el.bulkAdd.addEventListener('click', bulkAdd);
  el.suppress.addEventListener('click', suppressPerson);
  el.searchByName.addEventListener('click', searchByName);
  el.prospectFind.addEventListener('click', prospectFind);
  el.scan.addEventListener('click', scanSite);
  el.scanAdd.addEventListener('click', addScanned);
  el.scanNewOnly.addEventListener('click', selectNewOnly);
  el.scanAll.addEventListener('change', () => {
    state.scanSelected = el.scanAll.checked
      ? new Set(state.scanResults.map((r) => r.email))
      : new Set();
    for (const box of el.scanResults.querySelectorAll('input[type="checkbox"]')) {
      box.checked = el.scanAll.checked;
    }
    syncScanToolbar();
  });
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
      addToList();
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
    el.actionBar.classList.remove('hidden');
    showError(context.error);
    return;
  }

  if (!context.data.hasKey) {
    el.setup.classList.remove('hidden');
    return;
  }

  // A key with no permission to reach its API can't do anything, and every
  // request would fail as a bare network error. Finish setup instead.
  if (context.data.needsPermission) {
    el.setup.classList.remove('hidden');
    askForPermission(context.data.needsPermission);
    return;
  }

  el.main.classList.remove('hidden');
  el.actionBar.classList.remove('hidden');
  state.person = context.data.person;
  state.appUrl = String(context.data.appUrl || '').replace(/\/+$/, '');
  state.tabUrl = tab?.url || '';
  showPageEmails();
  fillForm(context.data.person);
  renderAll();

  // The picker owns the keyboard from the moment the popup opens.
  el.listSearch.focus();

  // If the page gave us nothing usable, the details are where the work is.
  if (!context.data.person?.email) toggleDetails(true);

  await Promise.all([
    loadLists(context.data.lastListId),
    refreshStanding(),
    deepenPerson(tab?.id),
  ]);
}

/**
 * Ask the page for LinkedIn's contact info, after the popup is already drawn.
 *
 * GET_CONTEXT takes the scraper's fast path, so the popup opens on the person's
 * name and title immediately rather than on an empty frame. On a LinkedIn
 * profile the address isn't in the page at all, so it needs a second, slower
 * request — which is fine once there is something on screen to wait in front of.
 *
 * Only runs when the fast pass said there was more to find, and never
 * overwrites an address the user has started typing.
 *
 * @param {number|undefined} tabId
 */
async function deepenPerson(tabId) {
  if (!tabId || !state.person?.contact_info_pending) return;

  const wasEmpty = el.email.value.trim() === '';
  if (wasEmpty) setStatus('Checking contact info…', { variant: 'working' });

  const response = await send('DEEP_SCRAPE', { tabId });
  const person = response.ok ? response.data.person : null;

  if (!person?.email) {
    if (wasEmpty && el.email.value.trim() === '') clearStatus();
    return;
  }

  state.person = { ...state.person, ...person, contact_info_pending: false };

  // The user may have typed while we were away; their address wins.
  if (el.email.value.trim() !== '') {
    renderAll();
    return;
  }

  fillForm(state.person);
  showPageEmails();
  renderAll();
  setStatus(`Found ${person.email} on this profile.`, { variant: 'success' });
  await refreshStanding();
}

init().catch((err) => {
  el.main.classList.remove('hidden');
  el.actionBar.classList.remove('hidden');
  setStatus(err?.message || 'The popup failed to start.', { variant: 'error' });
});

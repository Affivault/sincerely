/**
 * In-page side panel.
 *
 * This is the extension's primary surface on LinkedIn and Gmail, and it exists
 * because that's the shape the category has settled on: Apollo and lemlist both
 * put their tool *in* the page rather than behind a toolbar icon, so the person
 * you're looking at and what you know about them are visible at the same time.
 * A popup makes you click, look away from the profile, and click back.
 *
 * Everything lives in a shadow root — LinkedIn ships aggressive global CSS and
 * we must not leak ours into their page either. No credentials here: the panel
 * messages the service worker, same as the popup does.
 */

(() => {
  if (window.__sincerelyPanelLoaded) return;
  window.__sincerelyPanelLoaded = true;

  const sincerely = (window.__sincerely = window.__sincerely || {});

  const HOST_ID = 'sincerely-panel-host';
  const COLLAPSED_KEY = 'panelCollapsed';

  /** Where a panel is worth showing at all. */
  function panelContext() {
    const { hostname, pathname } = location;
    if (hostname.endsWith('linkedin.com') && /\/in\//.test(pathname)) return 'profile';
    if (hostname === 'mail.google.com') return 'gmail';
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* State                                                            */
  /* ---------------------------------------------------------------- */

  const state = {
    person: null,
    contact: null,
    memberships: [],
    engagement: null,
    suppressed: false,
    lists: [],
    selectedListId: null,
    appUrl: '',
    loading: true,
    collapsed: false,
    /** Prospector match, once searched. */
    prospect: undefined,
    /** Result of the free domain-based finder, once run. */
    found: null,
    /** Domain the user typed for that, so a re-render doesn't lose it. */
    findDomain: '',
    busy: false,
    message: null,
  };

  /** @param {string} type @param {object} [payload] */
  async function send(type, payload = {}) {
    try {
      const response = await chrome.runtime.sendMessage({ type, payload });
      return response ?? { ok: false, error: { message: 'No response from the extension.' } };
    } catch (err) {
      return { ok: false, error: { message: err?.message || 'Extension unavailable.' } };
    }
  }

  /* ---------------------------------------------------------------- */
  /* Shell                                                            */
  /* ---------------------------------------------------------------- */

  let root = null;

  function styles() {
    // Sincerely tokens, inlined — a shadow root can't inherit the extension's
    // stylesheet. Values track client/src/index.css.
    return `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

      .panel {
        position: fixed; top: 76px; right: 16px; width: 320px;
        max-height: calc(100vh - 100px);
        display: flex; flex-direction: column;
        background: #FFFFFF; color: #1B1B1F;
        border: 1px solid #ECEAE6; border-radius: 12px;
        box-shadow: 0 1px 2px rgba(27,27,31,.04), 0 8px 24px -8px rgba(27,27,31,.14);
        font-size: 13px; line-height: 1.5; letter-spacing: -0.005em;
        overflow: hidden;
      }
      .panel.collapsed { width: auto; }

      .head {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px; border-bottom: 1px solid #ECEAE6;
        cursor: grab; user-select: none;
      }
      .panel.collapsed .head { border-bottom: 0; }
      .head img { width: 18px; height: 18px; }
      .head .title { flex: 1; font-size: 13.5px; font-weight: 600; letter-spacing: -0.02em; }
      .head button {
        width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px;
        background: transparent; color: #8F8E97; cursor: pointer; font-size: 15px; line-height: 1;
      }
      .head button:hover { background: #EFEDEA; color: #1B1B1F; }

      .body { padding: 12px; overflow-y: auto; }
      .body::-webkit-scrollbar { width: 6px; }
      .body::-webkit-scrollbar-thumb { background: #E0DDD8; border-radius: 3px; }

      .who { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .avatar {
        width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 11.5px; font-weight: 700; color: #fff;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.18);
      }
      .who-text { min-width: 0; flex: 1; }
      .who-name { font-size: 14px; font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .who-sub { margin-top: 1px; font-size: 11.5px; color: #61606A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      a.link { color: inherit; text-decoration: none; }
      a.link:hover { color: #5B5BF5; text-decoration: underline; text-underline-offset: 2px; }

      .strip {
        padding: 7px 10px; margin-bottom: 10px; border-radius: 6px;
        font-size: 11.5px; background: #F3F2F0; color: #61606A;
      }
      .strip.replied { background: #ECFDF5; color: #047857; }
      .strip.suppressed { background: #FEF2F2; color: #BE123C; }

      .email-row {
        display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
        padding: 7px 9px; border: 1px solid #E0DDD8; border-radius: 6px; background: #F9F8F7;
      }
      .email-row .addr { flex: 1; min-width: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .email-row .addr.missing { color: #8F8E97; }
      .pill {
        flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px;
        padding: 1px 6px; border-radius: 999px; font-size: 10.5px; font-weight: 500;
      }
      .pill::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
      .pill.valid { color: #047857; background: rgba(16,185,129,.12); }
      .pill.risky { color: #B45309; background: rgba(245,158,11,.12); }
      .pill.invalid { color: #BE123C; background: rgba(244,63,94,.12); }
      .pill.neutral { color: #8F8E97; background: #F3F2F0; }
      .pill.ok { color: #047857; background: rgba(16,185,129,.12); }
      .pill.warn { color: #B45309; background: rgba(245,158,11,.12); }

      /* Domain box and its Find button on one line — typing a domain and
         pressing Find is one action, so it reads as one control. */
      .finder { display: flex; align-items: center; gap: 6px; }
      .finder input.txt { flex: 1; min-width: 0; }
      .finder .btn { width: auto; margin-top: 0; flex: 0 0 auto; padding: 0 14px; }

      .found-row {
        display: flex; align-items: center; gap: 6px; margin-top: 8px;
        padding: 7px 9px; border: 1px solid #E0DDD8; border-radius: 6px; background: #fff;
      }
      .found-row .addr { flex: 1; min-width: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      label.lbl { display: block; margin-bottom: 4px; font-size: 11px; font-weight: 500; color: #61606A; }

      select.sel, input.txt {
        width: 100%; height: 32px; padding: 0 9px;
        font-family: inherit; font-size: 12.5px; color: #1B1B1F;
        background: #F9F8F7; border: 1px solid #E0DDD8; border-radius: 6px;
      }
      select.sel:focus, input.txt:focus { outline: none; border-color: #5B5BF5; box-shadow: 0 0 0 3px rgba(99,102,241,.12); }

      .btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; height: 34px; margin-top: 8px; padding: 0 12px;
        border: 0; border-radius: 6px; cursor: pointer;
        font-family: inherit; font-size: 13px; font-weight: 500;
        background: #5B5BF5; color: #fff;
        box-shadow: 0 1px 2px rgba(15,15,25,.08);
      }
      .btn:hover:not(:disabled) { background: #4646E5; }
      .btn:disabled { opacity: .45; cursor: not-allowed; }
      .btn.secondary { background: #FFFFFF; color: #1B1B1F; border: 1px solid #E0DDD8; box-shadow: none; }
      .btn.secondary:hover:not(:disabled) { background: #EFEDEA; }

      .rows { margin-top: 10px; border-top: 1px solid #ECEAE6; padding-top: 8px; }
      .rows-title { font-size: 11px; font-weight: 500; color: #8F8E97; margin-bottom: 6px; }
      .row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #ECEAE6; }
      .row:last-child { border-bottom: 0; }
      .row-main { flex: 1; min-width: 0; }
      .row-name { font-size: 12.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .row-meta { margin-top: 1px; font-size: 11px; color: #8F8E97; }
      .row button {
        flex: 0 0 auto; height: 24px; padding: 0 8px;
        border: 1px solid #E0DDD8; border-radius: 6px; background: #fff;
        font-family: inherit; font-size: 11px; font-weight: 500; color: #1B1B1F; cursor: pointer;
      }
      .row button:hover { background: #EFEDEA; }

      .msg { margin-top: 9px; padding: 8px 10px; border-radius: 6px; font-size: 11.5px; line-height: 1.45; white-space: pre-wrap; background: #F3F2F0; color: #61606A; }
      .msg.success { background: #ECFDF5; color: #047857; }
      .msg.error { background: #FEF2F2; color: #BE123C; }
      .msg button {
        margin-top: 7px; height: 24px; padding: 0 8px;
        background: transparent; border: 1px solid currentColor; border-radius: 6px;
        color: inherit; font-family: inherit; font-size: 11px; font-weight: 500; cursor: pointer;
      }

      .muted { color: #8F8E97; font-size: 11.5px; }
      .cost { margin-top: 6px; font-size: 11px; color: #8F8E97; }
      .hidden { display: none !important; }

      @media (prefers-color-scheme: dark) {
        .panel { background: #191919; color: #F4F4F3; border-color: #262626;
                 box-shadow: 0 2px 4px -1px rgba(0,0,0,.4), 0 12px 28px -8px rgba(0,0,0,.55); }
        .head { border-bottom-color: #262626; }
        .head button:hover { background: #242424; color: #F4F4F3; }
        .who-sub, .row-meta, .muted, .cost, label.lbl { color: #A19FA6; }
        .strip { background: #202020; color: #A19FA6; }
        .strip.replied { background: rgba(34,197,94,.10); color: #4ADE80; }
        .strip.suppressed { background: rgba(239,68,68,.10); color: #F87171; }
        .email-row { background: #121212; border-color: #2E2E2E; }
        select.sel, input.txt { background: #121212; border-color: #2E2E2E; color: #F4F4F3; }
        .btn.secondary { background: #191919; color: #F4F4F3; border-color: #2E2E2E; }
        .btn.secondary:hover:not(:disabled) { background: #242424; }
        .rows, .row { border-color: #262626; }
        .row button { background: #191919; border-color: #2E2E2E; color: #F4F4F3; }
        .row button:hover { background: #242424; }
        .msg { background: #202020; color: #A19FA6; }
        .msg.success { background: rgba(34,197,94,.10); color: #4ADE80; }
        .msg.error { background: rgba(239,68,68,.10); color: #F87171; }
        .pill.neutral { background: #202020; }
      }
    `;
  }

  function ensureRoot() {
    if (root) return root;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000;';
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styles();
    root.appendChild(style);
    return root;
  }

  function removePanel() {
    document.getElementById(HOST_ID)?.remove();
    root = null;
  }

  /* ---------------------------------------------------------------- */
  /* Small builders                                                   */
  /* ---------------------------------------------------------------- */

  const GRADIENTS = [
    ['#5B5BF5', '#8B5CF6'], ['#8B5CF6', '#EC4899'], ['#06B6D4', '#5B5BF5'], ['#10B981', '#06B6D4'],
    ['#F59E0B', '#EF4444'], ['#EF4444', '#EC4899'], ['#5B5BF5', '#06B6D4'], ['#8B5CF6', '#5B5BF5'],
  ];

  function hashCode(value) {
    let h = 0;
    for (let i = 0; i < value.length; i += 1) h = ((h << 5) - h + value.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function initialsFor(name, email) {
    if (name) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return name.slice(0, 2).toUpperCase();
    }
    if (email) return email.slice(0, 2).toUpperCase();
    return '··';
  }

  /** Same thresholds as the app's contacts table. */
  function verificationFor(contact) {
    if (!contact) return null;
    if (contact.is_bounced) return { label: 'Bounced', variant: 'invalid' };
    const verified = Boolean(contact.dcs_verified_at) || contact.dcs_score != null;
    if (!verified) return { label: 'Unverified', variant: 'neutral' };
    if (contact.dcs_syntax_ok === false) return { label: 'Invalid', variant: 'invalid' };
    if (contact.dcs_domain_ok === false) return { label: 'Not found', variant: 'neutral' };
    const score = contact.dcs_score ?? 0;
    if (contact.dcs_smtp_ok === true || score >= 80) return { label: 'Valid', variant: 'valid' };
    if (score >= 50) return { label: 'Risky', variant: 'risky' };
    return { label: 'Undeliverable', variant: 'invalid' };
  }

  function el(tag, className, textContent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent != null) node.textContent = textContent;
    return node;
  }

  function link(href, label, className) {
    if (!state.appUrl) return el('span', className, label);
    const a = el('a', `link ${className || ''}`.trim(), label);
    a.href = `${state.appUrl}${href}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  function formatDate(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */

  function render() {
    const shadow = ensureRoot();
    shadow.querySelector('.panel')?.remove();

    const panel = el('div', `panel${state.collapsed ? ' collapsed' : ''}`);

    /* Header */
    const head = el('div', 'head');
    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('icons/icon-32.png');
    logo.alt = '';
    head.appendChild(logo);
    if (!state.collapsed) head.appendChild(el('span', 'title', 'sincerely'));

    const toggle = el('button', null, state.collapsed ? '‹' : '×');
    toggle.title = state.collapsed ? 'Open Sincerely' : 'Collapse';
    toggle.addEventListener('click', async () => {
      state.collapsed = !state.collapsed;
      await chrome.storage.local.set({ [COLLAPSED_KEY]: state.collapsed });
      render();
    });
    head.appendChild(toggle);
    panel.appendChild(head);

    if (state.collapsed) {
      shadow.appendChild(panel);
      return;
    }

    const body = el('div', 'body');
    panel.appendChild(body);

    if (state.loading) {
      body.appendChild(el('p', 'muted', 'Reading this page…'));
      shadow.appendChild(panel);
      return;
    }

    /* Who */
    const person = state.person || {};
    const name = [person.first_name, person.last_name].filter(Boolean).join(' ') || person.full_name || '';
    const display = name || person.email || 'Nobody detected';

    const who = el('div', 'who');
    const [from, to] = GRADIENTS[hashCode((name || person.email || '?').toLowerCase()) % GRADIENTS.length];
    const avatar = el('span', 'avatar', initialsFor(name, person.email));
    avatar.style.background = `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
    who.appendChild(avatar);

    const whoText = el('div', 'who-text');
    const whoName = el('div', 'who-name');
    whoName.appendChild(
      state.contact ? link(`/contacts/${state.contact.id}`, display) : document.createTextNode(display)
    );
    whoText.appendChild(whoName);
    const subBits = [person.job_title, person.company].filter(Boolean);
    whoText.appendChild(el('div', 'who-sub', subBits.join(' · ') || 'No title or company found'));
    who.appendChild(whoText);
    body.appendChild(who);

    /* One line of history */
    const strip = historyStrip();
    if (strip) body.appendChild(strip);

    /* Address */
    body.appendChild(emailRow());

    /* Lead-list picker + add */
    if (person.email || state.contact) {
      const label = el('label', 'lbl', 'Add to lead list');
      label.setAttribute('for', 'sx-list');
      body.appendChild(label);

      const select = el('select', 'sel');
      select.id = 'sx-list';
      if (state.lists.length === 0) {
        const option = el('option', null, 'No lead lists on this account');
        option.value = '';
        select.appendChild(option);
      }
      for (const list of state.lists) {
        const option = el(
          'option',
          null,
          `${list.name}${list.is_default ? ' (default)' : ''} · ${list.contact_count ?? 0}`
        );
        option.value = list.id;
        if (list.id === state.selectedListId) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        state.selectedListId = select.value;
      });
      body.appendChild(select);

      const add = el('button', 'btn', 'Add to list');
      add.disabled = state.busy || !person.email || state.lists.length === 0;
      add.addEventListener('click', addToList);
      body.appendChild(add);
    }

    /* Lists they're already on */
    if (state.memberships.length > 0) {
      const rows = el('div', 'rows');
      rows.appendChild(el('div', 'rows-title', 'On these lead lists'));
      for (const membership of state.memberships) {
        const row = el('div', 'row');
        const main = el('div', 'row-main');
        const rowName = el('div', 'row-name');
        rowName.appendChild(link(`/contacts?list=${membership.id}`, membership.name || 'Untitled'));
        main.appendChild(rowName);

        if (Number.isFinite(membership.contact_count)) {
          main.appendChild(
            el('div', 'row-meta', `${membership.contact_count} contact${membership.contact_count === 1 ? '' : 's'}`)
          );
        }
        row.appendChild(main);

        const remove = el('button', null, 'Remove');
        remove.addEventListener('click', () => removeFrom(membership, remove));
        row.appendChild(remove);
        rows.appendChild(row);
      }
      body.appendChild(rows);
    }

    /* Message */
    if (state.message) {
      const msg = el('div', `msg ${state.message.variant || ''}`.trim());
      msg.appendChild(el('div', null, state.message.text));
      if (state.message.action) {
        const button = el('button', null, state.message.action.label);
        button.addEventListener('click', state.message.action.onClick);
        msg.appendChild(button);
      }
      body.appendChild(msg);
    }

    shadow.appendChild(panel);
  }

  /** The one line that says what's already happened with this person. */
  function historyStrip() {
    if (state.suppressed) return el('div', 'strip suppressed', 'Suppressed — this address will not be emailed.');

    const engagement = state.engagement;
    if (engagement?.hasReplied) {
      const when = formatDate(engagement.lastActivityAt);
      return el('div', 'strip replied', `Replied${when ? ` · ${when}` : ''} — check the thread before emailing again.`);
    }
    if (engagement && (engagement.opened > 0 || engagement.clicked > 0)) {
      const parts = [];
      if (engagement.sent > 0) parts.push(`${engagement.sent} sent`);
      if (engagement.opened > 0) parts.push(`opened ${engagement.opened}×`);
      if (engagement.clicked > 0) parts.push(`clicked ${engagement.clicked}×`);
      return el('div', 'strip', parts.join(' · '));
    }
    const onLists = state.memberships.length;
    if (onLists > 0) return el('div', 'strip', `Already on ${onLists} lead list${onLists > 1 ? 's' : ''}.`);
    if (state.contact) return el('div', 'strip', 'Known contact · not on any lead list.');
    if (state.person?.email) return el('div', 'strip', 'New contact — adding will create them.');
    return null;
  }

  /**
   * The address, or the way to get one. On LinkedIn this row is the whole
   * point: the profile almost never carries an email.
   */
  function emailRow() {
    const wrap = el('div');
    const person = state.person || {};

    const row = el('div', 'email-row');
    if (person.email) {
      row.appendChild(el('span', 'addr', person.email));
      const verification = verificationFor(state.contact);
      if (verification) {
        row.appendChild(el('span', `pill ${verification.variant}`, verification.label));
      }
    } else {
      row.appendChild(el('span', 'addr missing', 'No email on this profile'));
    }
    wrap.appendChild(row);

    if (person.email) return wrap;

    /*
     * No address. Work it out from the company's domain first: that costs
     * nothing, where the prospect database costs a credit per reveal. The domain
     * comes from the profile's own listed website when there is one, and is
     * editable because LinkedIn shows a company's name far more often than its
     * domain.
     */
    const finderRow = el('div', 'finder');
    const domainInput = el('input', 'txt');
    domainInput.type = 'text';
    domainInput.placeholder = 'company.com';
    domainInput.value = state.findDomain || person.company_domain || '';
    domainInput.addEventListener('input', () => {
      state.findDomain = domainInput.value.trim();
    });
    finderRow.appendChild(domainInput);

    const findAt = el('button', 'btn secondary', 'Find');
    findAt.disabled = state.busy;
    findAt.addEventListener('click', () => findAtDomain(domainInput.value.trim()));
    finderRow.appendChild(findAt);
    wrap.appendChild(finderRow);
    wrap.appendChild(el('div', 'cost', 'Free — works out the address from the company’s own convention and asks their mail server.'));

    if (state.found) {
      if (state.found.email) {
        const hit = el('div', 'found-row');
        hit.appendChild(el('span', 'addr', state.found.email));
        hit.appendChild(
          el(
            'span',
            `pill ${state.found.verified ? 'ok' : 'warn'}`,
            state.found.verified ? 'confirmed' : `${state.found.confidence}%`
          )
        );
        wrap.appendChild(hit);
        wrap.appendChild(el('div', 'cost', state.found.reason || ''));

        const use = el('button', 'btn', 'Use this address');
        use.disabled = state.busy;
        use.addEventListener('click', () => {
          state.person = { ...(state.person || {}), email: state.found.email };
          state.found = null;
          refresh();
        });
        wrap.appendChild(use);
      } else {
        wrap.appendChild(el('div', 'cost', state.found.reason || 'No address could be established.'));
      }
    }

    // Then the paid route, for when the domain gives nothing.
    if (state.prospect === undefined) {
      const find = el('button', 'btn secondary', 'Find their email');
      find.disabled = state.busy;
      find.addEventListener('click', findEmail);
      wrap.appendChild(find);
    } else if (state.prospect === null) {
      wrap.appendChild(el('div', 'cost', 'No match in the prospect database. Nothing was charged.'));
    } else {
      const match = state.prospect;
      wrap.appendChild(
        el('div', 'cost', `${match.full_name}${match.company ? ` · ${match.company}` : ''}`)
      );
      if (match.confidence === 'likely') {
        wrap.appendChild(el('div', 'cost', 'Matched on name and company — check this is the right person.'));
      }
      if (match.has_email) {
        const reveal = el('button', 'btn', match.already_revealed ? 'Get email (free)' : 'Reveal email');
        reveal.disabled = state.busy;
        reveal.addEventListener('click', () => revealEmail(match));
        wrap.appendChild(reveal);
        wrap.appendChild(
          el(
            'div',
            'cost',
            match.already_revealed
              ? 'Already revealed — no credit'
              : `1 credit${Number.isFinite(match.remaining) ? ` · ${match.remaining} left` : ''}, refunded if nothing is found`
          )
        );
      } else {
        wrap.appendChild(el('div', 'cost', 'No work email on record for them.'));
      }
    }

    const manual = el('input', 'txt');
    manual.type = 'email';
    manual.placeholder = 'or type an address…';
    manual.style.marginTop = '8px';
    manual.addEventListener('change', () => {
      const value = manual.value.trim().toLowerCase();
      if (!value) return;
      state.person = { ...(state.person || {}), email: value };
      refresh();
    });
    wrap.appendChild(manual);

    return wrap;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */

  function setMessage(text, variant, action) {
    state.message = text ? { text, variant, action } : null;
    render();
  }

  async function addToList() {
    const listId = state.selectedListId;
    if (!listId || !state.person?.email) return;

    state.busy = true;
    setMessage('Adding…');

    const response = await send('ADD_TO_LIST', { listId, person: state.person });
    state.busy = false;

    if (!response.ok) return setMessage(response.error.message, 'error');

    const { added, alreadyOnList, listName, contactId } = response.data;

    // Re-read before announcing: rendering "Added to X" next to a stale
    // "not on any list" makes the panel look broken for a beat.
    await refresh();

    if (added > 0 && !alreadyOnList) {
      setMessage(`Added to "${listName}".`, 'success', {
        label: 'Undo',
        onClick: async () => {
          const undo = await send('REMOVE_FROM_LIST', { listId, contactId });
          await refresh();
          setMessage(undo.ok ? `Taken off "${listName}".` : undo.error.message, undo.ok ? undefined : 'error');
        },
      });
    } else {
      setMessage(`Already on "${listName}".`);
    }
  }

  async function removeFrom(membership, button) {
    button.disabled = true;
    button.textContent = '…';
    const response = await send('REMOVE_FROM_LIST', {
      listId: membership.id,
      contactId: state.contact.id,
    });
    if (!response.ok) return setMessage(response.error.message, 'error');
    await refresh();
    setMessage(`Taken off "${membership.name}". They stay in your contacts.`, 'success');
  }

  /**
   * Work out this person's address at a company domain. Costs nothing.
   *
   * @param {string} domain
   */
  async function findAtDomain(domain) {
    if (!domain) {
      return setMessage("Type the company's domain — linkedin shows the name, not the domain.", 'error');
    }

    state.busy = true;
    state.findDomain = domain;
    setMessage(`Working out their address at ${domain}…`);

    const response = await send('FIND_EMAIL', {
      domain,
      firstName: state.person?.first_name || undefined,
      lastName: state.person?.last_name || undefined,
      fullName: state.person?.full_name || undefined,
    });
    state.busy = false;

    if (!response.ok) {
      state.found = null;
      return setMessage(response.error.message, 'error');
    }

    state.found = {
      email: response.data.found ? response.data.email : null,
      confidence: response.data.confidence,
      verified: response.data.verified,
      reason: response.data.reason,
    };
    setMessage(null);
  }

  async function findEmail() {
    state.busy = true;
    setMessage('Searching the prospect database…');

    const response = await send('PROSPECT_FIND', { person: state.person });
    state.busy = false;

    if (!response.ok) {
      state.prospect = undefined;
      return setMessage(response.error.message, 'error');
    }

    state.prospect = response.data.match
      ? { ...response.data.match, confidence: response.data.confidence, remaining: response.data.credits?.remaining }
      : null;
    setMessage(null);
  }

  async function revealEmail(match) {
    state.busy = true;
    setMessage('Revealing…');

    const response = await send('PROSPECT_REVEAL', { providerPersonId: match.id });
    state.busy = false;

    if (!response.ok) return setMessage(response.error.message, 'error');

    const { found, email, credits } = response.data;
    if (!found || !email) {
      return setMessage(
        `No work email on record. The credit was refunded${Number.isFinite(credits?.remaining) ? ` — ${credits.remaining} left` : ''}.`
      );
    }

    state.person = { ...state.person, email };
    state.prospect = undefined;
    await refresh();
    setMessage(`Found ${email}.`, 'success');
  }

  /* ---------------------------------------------------------------- */
  /* Load                                                             */
  /* ---------------------------------------------------------------- */

  /** Re-read everything we know about the person currently on screen. */
  async function refresh() {
    if (!state.person?.email) {
      state.contact = null;
      state.memberships = [];
      state.engagement = null;
      state.suppressed = false;
      render();
      return;
    }

    const response = await send('LOOKUP_PERSON', { email: state.person.email });
    if (response.ok) {
      state.contact = response.data.contact;
      state.memberships = response.data.lists || [];
      state.engagement = response.data.engagement || null;
      state.suppressed = Boolean(response.data.suppressed);
    }
    render();
  }

  async function load() {
    state.loading = true;
    state.prospect = undefined;
    state.message = null;
    render();

    const stored = await chrome.storage.local.get({ [COLLAPSED_KEY]: false });
    state.collapsed = Boolean(stored[COLLAPSED_KEY]);

    // The scraper is the sibling content script; it has already run. Awaited
    // because on LinkedIn it fetches the contact info rather than reading the
    // DOM, which is what makes an address available without the user opening
    // the Contact info dialog.
    state.person = sincerely.scrape ? await sincerely.scrape().catch(() => null) : null;

    const context = await send('GET_CONTEXT', {});
    if (context.ok) {
      state.appUrl = String(context.data.appUrl || '').replace(/\/+$/, '');
      state.selectedListId = context.data.lastListId;
      if (!context.data.hasKey) {
        state.loading = false;
        setMessage('Connect the extension in settings to use it here.', 'error');
        return;
      }
    }

    const lists = await send('LIST_LISTS');
    if (lists.ok) {
      state.lists = lists.data.lists || [];
      if (!state.lists.some((l) => l.id === state.selectedListId)) {
        state.selectedListId = state.lists[0]?.id ?? null;
      }
    }

    state.loading = false;
    await refresh();
  }

  /* ---------------------------------------------------------------- */
  /* Mount                                                            */
  /* ---------------------------------------------------------------- */

  function mountIfRelevant() {
    if (!panelContext()) {
      removePanel();
      return;
    }
    load().catch(() => {});
  }

  // LinkedIn and Gmail are SPAs: the document never reloads, so watch the URL.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    mountIfRelevant();
  }, 1200);

  /**
   * Last-resort watcher for an address appearing in the DOM after load.
   *
   * The scraper now fetches LinkedIn's contact info directly, so this should
   * almost never be what finds the address. It stays for the cases that fetch
   * can't cover: LinkedIn changing its internals, a signed-out session, or an
   * address that only ever appears in a page's own markup — and it costs
   * nothing while an address is already known.
   */
  let rescanTimer = null;
  const watcher = new MutationObserver(() => {
    if (state.loading || state.person?.email) return;
    // The scraper opening LinkedIn's own dialog mutates the page. Reacting to
    // that would ask it to scrape again mid-flight, which is how one quiet
    // click becomes a loop.
    if (sincerely.isOverlayBusy?.()) return;
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(async () => {
      if (state.person?.email || !sincerely.scrape) return;
      const fresh = await sincerely.scrape().catch(() => null);
      if (!fresh?.email) return;
      state.person = { ...state.person, ...fresh };
      state.prospect = undefined;
      setMessage(`Found ${fresh.email} on this profile.`, 'success');
      refresh().catch(() => {});
    }, 500);
  });
  watcher.observe(document.documentElement, { childList: true, subtree: true });

  sincerely.reloadPanel = mountIfRelevant;
  mountIfRelevant();
})();

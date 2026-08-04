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
    /** True once the user has picked a list themselves, so the default stops. */
    listChosenByUser: false,
    appUrl: '',
    loading: true,
    collapsed: false,
    /** Prospector match, once searched. */
    prospect: undefined,
    /** True while the deep contact-info pass is in flight. */
    lookingForEmail: false,
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
        border: 1px solid #ECEAE6; border-radius: 14px;
        box-shadow: 0 1px 2px rgba(27,27,31,.04), 0 12px 32px -10px rgba(27,27,31,.18);
        font-size: 13px; line-height: 1.5; letter-spacing: -0.005em;
        overflow: hidden;
      }
      .panel.collapsed { width: auto; }

      .head {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px; border-bottom: 1px solid #ECEAE6;
        background: #FDFCFB;
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
      .email-row .addr.looking { color: #5B5BF5; }
      .email-row .addr.looking::after { content: ''; display: inline-block; width: 6px; height: 6px; margin-left: 6px; border-radius: 50%; background: currentColor; animation: sx-pulse 1s ease-in-out infinite; vertical-align: middle; }
      @keyframes sx-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
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
      /* Destination and verb on one line: which list, then go. */
      .decide { display: flex; align-items: stretch; gap: 6px; margin-top: 2px; }
      .decide select.sel { flex: 1 1 auto; min-width: 0; }
      .decide .btn { width: auto; flex: 0 0 auto; margin-top: 0; height: 32px; padding: 0 14px; }

      .finder { display: flex; align-items: center; gap: 6px; }
      .finder input.txt { flex: 1; min-width: 0; }
      .finder .btn { width: auto; margin-top: 0; flex: 0 0 auto; padding: 0 14px; }

      .found-row {
        display: flex; align-items: center; gap: 6px; margin-top: 8px;
        padding: 7px 9px; border: 1px solid #E0DDD8; border-radius: 6px; background: #fff;
      }
      .found-row .addr { flex: 1; min-width: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      /* Uppercase micro-labels, as the app labels its sections. */
      label.lbl {
        display: block; margin-bottom: 5px;
        font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
        color: #8F8E97;
      }

      select.sel, input.txt {
        width: 100%; height: 32px; padding: 0 9px;
        font-family: inherit; font-size: 12.5px; color: #1B1B1F;
        background: #F9F8F7; border: 1px solid #E0DDD8; border-radius: 6px;
      }
      select.sel:focus-visible, input.txt:focus-visible {
        outline: none; border-color: #5B5BF5; box-shadow: 0 0 0 3px rgba(99,102,241,.12);
      }
      .btn:focus-visible {
        outline: none; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #5B5BF5;
      }

      /* Matches the app's primary button exactly: a vertical sheen, an inner
         highlight and a coloured drop shadow. A flat fill is most of why an
         injected panel reads as a third-party add-on rather than the product. */
      .btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; height: 34px; margin-top: 8px; padding: 0 12px;
        border: 0; border-radius: 6px; cursor: pointer;
        font-family: inherit; font-size: 13px; font-weight: 500;
        background: linear-gradient(180deg, #6E6EF8 0%, #5B5BF5 100%); color: #fff;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.18), 0 1px 2px rgba(67,56,202,.35);
        transition: background 150ms cubic-bezier(.22,1,.36,1), box-shadow 150ms cubic-bezier(.22,1,.36,1), transform 120ms;
      }
      .btn:hover:not(:disabled) {
        background: linear-gradient(180deg, #5A5AF0 0%, #4646E5 100%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 2px 8px rgba(67,56,202,.45);
      }
      .btn:active:not(:disabled) { transform: translateY(.5px); }
      .btn:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
      /* Already on the list is a satisfied state, not a failure. */
      .btn.done, .btn.done:disabled {
        opacity: 1; background: #ECFDF5; color: #047857;
        border: 1px solid rgba(16,185,129,.35); box-shadow: none;
      }
      /* Native select arrows look like the operating system, not the product. */
      select.sel {
        appearance: none; -webkit-appearance: none;
        padding-right: 28px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238F8E97' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: right 9px center;
      }
      .btn.secondary {
        background: #FFFFFF; color: #1B1B1F; border: 1px solid #E0DDD8;
        box-shadow: 0 1px 0 rgba(0,0,0,.015);
      }
      .btn.secondary:hover:not(:disabled) { background: #EFEDEA; border-color: #C9C5BE; box-shadow: none; }

      .rows { margin-top: 12px; border-top: 1px solid #ECEAE6; padding-top: 10px; }
      .rows-title {
        font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
        color: #8F8E97; margin-bottom: 7px;
      }
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

      /* Skeletons — the same shimmer the app uses while data lands. */
      .skeleton-who { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .sk-lines { flex: 1; min-width: 0; }
      .sk {
        display: block; position: relative; overflow: hidden;
        background: #F3F2F0; border-radius: 6px;
      }
      .sk::after {
        content: ''; position: absolute; inset: 0; transform: translateX(-100%);
        background: linear-gradient(90deg, transparent, rgba(27,27,31,.06), transparent);
        animation: sx-shimmer 1.4s infinite;
      }
      .sk-avatar { width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%; }
      .sk-line { height: 9px; border-radius: 999px; }
      .sk-line.short { width: 60%; margin-top: 7px; }
      .sk-block { height: 34px; margin-bottom: 8px; }
      .sk-block.tall { height: 58px; }
      @keyframes sx-shimmer { 100% { transform: translateX(100%); } }
      @media (prefers-reduced-motion: reduce) { .sk::after { animation: none; } }

      .muted { color: #8F8E97; font-size: 11.5px; }
      .cost { margin-top: 6px; font-size: 11px; color: #8F8E97; }
      .hidden { display: none !important; }

      /* Dark, tracked from the app's .dark palette. */
      @media (prefers-color-scheme: dark) {
        .head { background: #1E1E1E; }
        .btn:focus-visible { box-shadow: 0 0 0 2px #191919, 0 0 0 4px #6366F1; }

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
        .sk { background: #202020; }
        .sk::after { background: linear-gradient(90deg, transparent, rgba(255,255,255,.06), transparent); }
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

  let lastSignature = null;

  function removePanel() {
    lastSignature = null;
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

  /**
   * Everything a render depends on, as a comparable string.
   *
   * Cheap insurance against redundant work: several things call render() —
   * the lookup, the deep read, the DOM watcher, the list picker — and they
   * frequently fire in quick succession with nothing actually different
   * between them.
   */
  function renderSignature() {
    return JSON.stringify([
      state.loading,
      state.collapsed,
      state.busy,
      state.lookingForEmail,
      state.person?.email ?? null,
      state.person?.full_name ?? null,
      state.person?.job_title ?? null,
      state.person?.company ?? null,
      state.person?.contact_info_pending ?? null,
      state.contact?.id ?? null,
      state.memberships.map((m) => m.id),
      state.suppressed,
      state.engagement,
      state.lists.map((l) => `${l.id}:${l.contact_count}`),
      state.selectedListId,
      state.prospect === undefined ? 'none' : state.prospect,
      state.found,
      state.message,
    ]);
  }

  function render() {
    /*
     * Rebuilding the DOM is the only way this panel updates, so a render that
     * changes nothing is not free — it drops focus out of the domain box
     * mid-typing, resets the scroll position, and makes the panel visibly
     * flicker. Skipping the identical ones fixes all three.
     */
    const signature = renderSignature();
    if (signature === lastSignature && ensureRoot().querySelector('.panel')) return;
    lastSignature = signature;

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
      /*
       * A skeleton in the shape of what's coming, not a line of text. Reading a
       * profile involves opening LinkedIn's own dialog, so this is on screen for
       * a second or so — long enough that "Reading this page…" reads as a stall.
       */
      const skeleton = el('div', 'skeleton-who');
      skeleton.appendChild(el('span', 'sk sk-avatar'));
      const lines = el('div', 'sk-lines');
      lines.appendChild(el('span', 'sk sk-line'));
      lines.appendChild(el('span', 'sk sk-line short'));
      skeleton.appendChild(lines);
      body.appendChild(skeleton);
      body.appendChild(el('span', 'sk sk-block'));
      body.appendChild(el('span', 'sk sk-block tall'));
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
      /*
       * No label above the picker. It used to read "Add to lead list" directly
       * above a button reading "Add to list" — two controls both carrying the
       * verb, which is exactly the duplication the popup had. The select is the
       * destination, the button is the action, and the row reads as one
       * sentence left to right.
       */
      const row = el('div', 'decide');

      const select = el('select', 'sel');
      select.id = 'sx-list';
      select.setAttribute('aria-label', 'Lead list to add to');
      if (state.lists.length === 0) {
        const option = el('option', null, 'No lead lists on this account');
        option.value = '';
        select.appendChild(option);
      }
      const isMember = (list) => state.memberships.some((m) => m.id === list.id);

      for (const list of state.lists) {
        // Say which ones they are already on, right in the options — picking a
        // destination only to be told "already on it" is a wasted step.
        const suffix = isMember(list) ? ' · already on' : ` · ${list.contact_count ?? 0}`;
        const option = el('option', null, `${list.name}${list.is_default ? ' (default)' : ''}${suffix}`);
        option.value = list.id;
        if (list.id === state.selectedListId) option.selected = true;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        state.selectedListId = select.value;
        state.listChosenByUser = true;
        render();
      });
      row.appendChild(select);

      /*
       * The button says what pressing it will do, matching the popup. Offering
       * "Add to list" for somebody already on the selected one reports a change
       * that never happens — the server upserts, so it succeeds and means
       * nothing.
       */
      const target = state.lists.find((l) => l.id === state.selectedListId);
      const alreadyOn = Boolean(target) && isMember(target);

      // The verb only; the select beside it names the destination.
      const add = el('button', `btn${alreadyOn ? ' done' : ''}`, alreadyOn ? 'On list' : 'Add');
      add.disabled = state.busy || !person.email || state.lists.length === 0 || alreadyOn;
      add.title = target
        ? alreadyOn
          ? `Already on "${target.name}"`
          : `Add to "${target.name}"`
        : 'Choose a lead list first';
      add.addEventListener('click', addToList);
      row.appendChild(add);
      body.appendChild(row);
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
    } else if (state.lookingForEmail) {
      /* "Still looking" and "there is nothing here" are different answers, and
         showing the second while the first is true is what made this look
         broken — people saw "No email", reached for the finder, and the address
         appeared underneath them a second later. */
      row.appendChild(el('span', 'addr looking', 'Checking contact info…'));
    } else {
      row.appendChild(el('span', 'addr missing', 'No email on this profile'));
    }
    wrap.appendChild(row);

    // Nothing to offer while the answer is still on its way.
    if (person.email || state.lookingForEmail) return wrap;

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
    chooseDefaultList();
    render();
  }

  /**
   * Move off a destination they are already on.
   *
   * Memberships are only known after the lookup, so the initial choice is made
   * blind. Landing on a list they are already on leaves the primary button
   * inert and the panel looking like it cannot do anything.
   *
   * Called before render rather than after: the panel rebuilds its DOM on every
   * render, so a second pass costs a visible flash and any focus in the panel.
   */
  function chooseDefaultList() {
    if (state.listChosenByUser) return;
    if (!state.memberships.some((m) => m.id === state.selectedListId)) return;
    const addable = state.lists.find((l) => !state.memberships.some((m) => m.id === l.id));
    if (addable) state.selectedListId = addable.id;
  }

  async function load() {
    state.loading = true;
    state.prospect = undefined;
    state.message = null;
    state.lookingForEmail = false;
    state.found = null;
    render();

    const stored = await chrome.storage.local.get({ [COLLAPSED_KEY]: false });
    state.collapsed = Boolean(stored[COLLAPSED_KEY]);

    /* The fast scrape: DOM only, settles within a tick, so the panel can show
       who this is straight away. The address, which on LinkedIn has to be
       fetched, arrives separately — see deepen() below. */
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

    // Not awaited: the panel is already usable, and this is what used to keep it
    // from being drawn at all.
    deepen();
  }

  /**
   * Second pass for LinkedIn's contact info.
   *
   * Runs behind an already-rendered panel, so the wait costs nobody anything.
   * Guarded three ways: only when the fast pass said there was more to find,
   * only once per profile, and abandoned if the user navigated while it ran —
   * an address landing on the wrong person's card would be worse than none.
   */
  /**
   * The deep read currently in flight, or null.
   *
   * A promise rather than a boolean, because the boolean version dropped work:
   * navigating to another profile while a deep read was running made the new
   * profile's `deepen()` return immediately, and by the time the old run
   * finished there was nothing left to trigger a new one. The second profile
   * simply never got its address. Now a later call waits for the earlier run
   * instead of skipping.
   */
  let deepRun = null;

  async function deepen() {
    if (!sincerely.scrapeDeep) return;
    if (!state.person?.contact_info_pending) return;

    const startedAt = location.href;

    // Serialise behind anything still finishing for a previous profile.
    const previous = deepRun;
    if (previous) await previous.catch(() => {});

    // Re-check after the wait: the user may have moved on again, or the fast
    // watcher may have found the address in the meantime.
    if (location.href !== startedAt) return;
    if (!state.person?.contact_info_pending) return;

    state.lookingForEmail = true;
    render();

    const run = (async () => {
      const deep = await sincerely.scrapeDeep().catch(() => null);
      if (location.href !== startedAt) return;

      state.lookingForEmail = false;
      if (!deep?.email) {
        // Say so, rather than leaving "looking" up forever.
        state.person = { ...state.person, contact_info_pending: false };
        render();
        return;
      }

      state.person = { ...state.person, ...deep, contact_info_pending: false };
      state.prospect = undefined;
      await refresh();
    })();

    deepRun = run;
    try {
      await run;
    } finally {
      state.lookingForEmail = false;
      if (deepRun === run) deepRun = null;
    }

    /*
     * One last look, after the flag has cleared.
     *
     * The DOM watcher ignores mutations while the scraper is driving LinkedIn's
     * overlay — it has to, or our own dialog would send it round in circles. But
     * that leaves a window: if the user opens Contact info themselves *during*
     * the deep read, the mutation is skipped and the deep read has already taken
     * its own snapshot, so nobody ever looks again and a visible address goes
     * unnoticed. Re-checking once here closes it.
     */
    if (!state.person?.email && location.href === startedAt && sincerely.scrape) {
      const late = await sincerely.scrape().catch(() => null);
      if (late?.email && !state.person?.email) {
        state.person = { ...state.person, ...late, contact_info_pending: false };
        state.prospect = undefined;
        setMessage(`Found ${late.email} on this profile.`, 'success');
        await refresh();
      }
    }
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
    /*
     * Ignore the address bar while the scraper is driving LinkedIn's overlay.
     * It opens Contact info by pushing that overlay's URL — which is a URL
     * change like any other, so this watcher would treat it as the user
     * navigating and tear the panel down in the middle of the read.
     */
    if (sincerely.isOverlayBusy?.()) return;
    lastUrl = location.href;
    /* Addresses captured from LinkedIn's traffic on the previous profile must
       never be offered as this one's. A wrong address is far worse than none. */
    sincerely.forgetNetEmails?.();
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
    // Same reasoning for the deep pass: it is already going to answer, and a
    // second scrape racing it just doubles the work.
    if (deepRun) return;
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

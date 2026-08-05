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
    /** Which collapsible sections are open. Absent means open. */
    openSections: {},
    /** Briefly true after Copy, so the button can confirm it worked. */
    copied: false,
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

      /*
       * A docked full-height rail, not a floating card.
       *
       * The card shape was most of why this read as a bolted-on add-on beside
       * Apollo's: 320px of everything-the-same-size, floating over the page with
       * a drop shadow. A rail that owns its edge of the window reads as part of
       * the workspace, and the height is what buys room for hierarchy — a real
       * name, labelled sections, and space between them.
       */
      .panel {
        position: fixed; top: 0; right: 0; bottom: 0; width: 372px;
        display: flex; flex-direction: column;
        background: #FFFFFF; color: #1B1B1F;
        border-left: 1px solid #E6E3DE;
        box-shadow: -8px 0 24px -12px rgba(27,27,31,.18);
        font-size: 13px; line-height: 1.5; letter-spacing: -0.005em;
        overflow: hidden;
      }
      /* Collapsed is a tab on the edge, not a shrunken panel. */
      .panel.collapsed {
        top: 84px; bottom: auto; width: auto; border-radius: 10px 0 0 10px;
        border: 1px solid #E6E3DE; border-right: 0;
      }

      .head {
        flex: 0 0 auto;
        display: flex; align-items: center; gap: 9px;
        padding: 13px 14px 13px 16px; border-bottom: 1px solid #ECEAE6;
        background: #FFFFFF;
        user-select: none;
      }
      .panel.collapsed .head { border-bottom: 0; padding: 10px 12px; }
      .head img { width: 19px; height: 19px; border-radius: 5px; }
      .head .title { flex: 1; font-size: 14px; font-weight: 600; letter-spacing: -0.02em; }
      .head button {
        width: 27px; height: 27px; padding: 0; border: 0; border-radius: 7px;
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; color: #8F8E97; cursor: pointer; font-size: 15px; line-height: 1;
      }
      .head button:hover { background: #F3F2F0; color: #1B1B1F; }

      .body { flex: 1 1 auto; padding: 0 0 20px; overflow-y: auto; }

      .body::-webkit-scrollbar { width: 6px; }
      .body::-webkit-scrollbar-thumb { background: #E0DDD8; border-radius: 3px; }

      /*
       * Identity, given the room to be the headline.
       *
       * It used to be a 14px name on one line with title and company crushed
       * into 11.5px grey beneath — the same weight as every control under it, so
       * nothing said whose profile this was. Whose record this is is the first
       * question the panel answers, so it is the biggest thing on it.
       */
      .who { padding: 18px 20px 0; }
      .who-top { display: flex; align-items: center; gap: 11px; }
      .avatar {
        width: 40px; height: 40px; flex: 0 0 auto; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: 700; color: #fff;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.18);
      }
      .who-text { min-width: 0; flex: 1; }
      .who-name {
        font-size: 19px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.25;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .who-role { margin-top: 3px; font-size: 13px; color: #1B1B1F; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .who-org { margin-top: 1px; font-size: 12.5px; color: #8F8E97; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .who-sub { margin-top: 3px; font-size: 12.5px; color: #8F8E97; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      /*
       * The three things worth doing, as one card of equal-weight actions.
       *
       * Apollo's version of this is the clearest thing in their panel: a single
       * card, round icon buttons, a word under each. It works because it answers
       * "what can I do here" before you have read anything else.
       */
      .quick {
        display: flex; margin: 16px 20px 0; padding: 15px 6px 13px;
        border: 1px solid #ECEAE6; border-radius: 14px; background: #FDFCFB;
      }
      .quick-btn {
        flex: 1 1 0; min-width: 0;
        display: flex; flex-direction: column; align-items: center; gap: 7px;
        padding: 0 2px; border: 0; background: transparent; cursor: pointer;
        font-family: inherit; color: #1B1B1F;
      }
      .quick-btn:disabled { opacity: .4; cursor: not-allowed; }
      .quick-ico {
        width: 42px; height: 42px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        background: #F0EFEC; color: #1B1B1F;
        transition: background 140ms cubic-bezier(.22,1,.36,1), transform 120ms;
      }
      .quick-btn:hover:not(:disabled) .quick-ico { background: #E4E2DD; }
      .quick-btn:active:not(:disabled) .quick-ico { transform: translateY(.5px); }
      .quick-btn.primary .quick-ico {
        background: linear-gradient(180deg, #6E6EF8 0%, #5B5BF5 100%); color: #fff;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 2px 6px rgba(67,56,202,.34);
      }
      .quick-btn.primary:hover:not(:disabled) .quick-ico {
        background: linear-gradient(180deg, #5A5AF0 0%, #4646E5 100%);
      }
      /* Done is a *result*, not a disabled control: it stays fully opaque. */
      .quick-btn.done, .quick-btn.done:disabled { opacity: 1; cursor: default; }
      .quick-btn.done .quick-ico {
        background: #ECFDF5; color: #047857; box-shadow: inset 0 0 0 1px rgba(16,185,129,.35);
      }
      .quick-btn.done .quick-label { color: #047857; }
      .quick-label {
        font-size: 11.5px; font-weight: 500; line-height: 1.3; text-align: center;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
      }
      .quick-btn:focus-visible .quick-ico { outline: 2px solid #5B5BF5; outline-offset: 2px; }

      /*
       * Sections, divided and labelled.
       *
       * Everything below the identity used to be one undifferentiated stack in a
       * 12px box. Naming the groups and ruling between them is what lets the eye
       * skip to the one it wants.
       */
      .sec { border-top: 1px solid #ECEAE6; margin-top: 16px; }
      .sec:first-of-type { margin-top: 18px; }
      .sec-head {
        display: flex; align-items: center; gap: 8px; width: 100%;
        padding: 13px 20px; border: 0; background: transparent; cursor: pointer;
        font-family: inherit; font-size: 13.5px; font-weight: 600; color: #1B1B1F;
        letter-spacing: -0.015em; text-align: left;
      }
      .sec-head:hover { background: #FBFAF9; }
      .sec-title { flex: 1; min-width: 0; }
      .sec-count { font-size: 11.5px; font-weight: 500; color: #8F8E97; }
      .sec-chev { flex: 0 0 auto; color: #8F8E97; transition: transform 160ms cubic-bezier(.22,1,.36,1); }
      .sec.open .sec-chev { transform: rotate(180deg); }
      .sec-body { padding: 0 20px 16px; }
      .sec:not(.open) .sec-body { display: none; }
      .dest { margin: 14px 20px 0; }
      .field-label { margin-bottom: 6px; font-size: 11.5px; font-weight: 500; color: #8F8E97; }
      .field-label + .field-label { margin-top: 14px; }
      a.link { color: inherit; text-decoration: none; }
      a.link:hover { color: #5B5BF5; text-decoration: underline; text-underline-offset: 2px; }

      /* Sits directly under the name: what has already happened with this
         person, before any control offers to do something else. */
      .strip {
        padding: 8px 11px; margin: 14px 20px 0; border-radius: 8px;
        font-size: 11.5px; background: #F3F2F0; color: #61606A;
      }
      .strip.replied { background: #ECFDF5; color: #047857; }
      .strip.suppressed { background: #FEF2F2; color: #BE123C; }

      .email-row {
        display: flex; align-items: center; gap: 6px;
        padding: 9px 11px; border: 1px solid #E0DDD8; border-radius: 8px; background: #F9F8F7;
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

      .finder { display: flex; align-items: center; gap: 6px; }
      .finder input.txt { flex: 1; min-width: 0; }
      .finder .btn { width: auto; margin-top: 0; flex: 0 0 auto; padding: 0 14px; }

      .found-row {
        display: flex; align-items: center; gap: 6px; margin-top: 8px;
        padding: 7px 9px; border: 1px solid #E0DDD8; border-radius: 6px; background: #fff;
      }
      .found-row .addr { flex: 1; min-width: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      /* Uppercase micro-labels, as the app labels its sections. */

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

      .rows { margin: 0; }
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

      .msg { margin: 14px 20px 0; padding: 9px 11px; border-radius: 6px; font-size: 11.5px; line-height: 1.45; white-space: pre-wrap; background: #F3F2F0; color: #61606A; }
      .msg.success { background: #ECFDF5; color: #047857; }
      .msg.error { background: #FEF2F2; color: #BE123C; }
      .msg button {
        margin-top: 7px; height: 24px; padding: 0 8px;
        background: transparent; border: 1px solid currentColor; border-radius: 6px;
        color: inherit; font-family: inherit; font-size: 11px; font-weight: 500; cursor: pointer;
      }

      /* Skeletons — the same shimmer the app uses while data lands. */
      .skeleton-who { display: flex; align-items: center; gap: 11px; padding: 18px 20px 0; }
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
      .sk-block { height: 34px; margin: 14px 20px 0; }
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
                 box-shadow: -8px 0 24px -12px rgba(0,0,0,.6); }
        .head { border-bottom-color: #262626; }
        .head button:hover { background: #242424; color: #F4F4F3; }
        .who-sub, .who-org, .row-meta, .muted, .cost, label.lbl, .field-label, .sec-count { color: #A19FA6; }
        .who-role { color: #F4F4F3; }

        .quick { background: #1E1E1E; border-color: #2E2E2E; }
        .quick-btn { color: #F4F4F3; }
        .quick-ico { background: #262626; color: #F4F4F3; }
        .quick-btn:hover:not(:disabled) .quick-ico { background: #303030; }
        .quick-btn.done .quick-ico { background: rgba(34,197,94,.12); color: #4ADE80; box-shadow: inset 0 0 0 1px rgba(34,197,94,.3); }
        .quick-btn.done .quick-label { color: #4ADE80; }

        .sec { border-top-color: #262626; }
        .sec-head { color: #F4F4F3; }
        .sec-head:hover { background: #1E1E1E; }
        .sec-chev { color: #A19FA6; }
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

  let copiedTimer = null;

  function removePanel() {
    lastSignature = null;
    clearTimeout(copiedTimer);
    copiedTimer = null;
    state.copied = false;
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
      state.openSections,
      state.copied,
      state.prospect === undefined ? 'none' : state.prospect,
      state.found,
      state.message,
    ]);
  }

  /** Inline SVG, sized for the round action buttons and section chevrons. */
  const ICONS = {
    add: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    block: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    open: '<path d="M14 3h7v7"/><path d="M21 3 10 14"/><path d="M19 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
  };

  /**
   * @param {keyof ICONS} name
   * @param {number} [size]
   */
  function icon(name, size = 18) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.9');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  /**
   * One round action in the card under the name.
   *
   * @param {{label: string, glyph: keyof ICONS, variant?: string, disabled?: boolean,
   *          title?: string, onClick: () => void}} spec
   */
  function quickAction(spec) {
    const button = el('button', `quick-btn${spec.variant ? ` ${spec.variant}` : ''}`);
    button.type = 'button';
    button.disabled = Boolean(spec.disabled);
    if (spec.title) button.title = spec.title;
    const ring = el('span', 'quick-ico');
    ring.appendChild(icon(spec.glyph, 19));
    button.appendChild(ring);
    button.appendChild(el('span', 'quick-label', spec.label));
    button.addEventListener('click', spec.onClick);
    return button;
  }

  /**
   * A titled, collapsible group.
   *
   * Which sections are open is remembered on `state.openSections` rather than in
   * the DOM, because every update rebuilds this panel from scratch — reading it
   * back off the element would reset every group on each render.
   *
   * @param {string} key Stable id for the open/closed memory.
   * @param {string} title
   * @param {{count?: string}} [opts]
   * @returns {{wrap: HTMLElement, body: HTMLElement}}
   */
  function section(key, title, opts = {}) {
    const open = state.openSections[key] !== false;
    const wrap = el('div', `sec${open ? ' open' : ''}`);

    const head = el('button', 'sec-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(open));
    head.appendChild(el('span', 'sec-title', title));
    if (opts.count) head.appendChild(el('span', 'sec-count', opts.count));
    const chev = icon('chevron', 15);
    chev.classList.add('sec-chev');
    head.appendChild(chev);
    head.addEventListener('click', () => {
      state.openSections[key] = !open;
      render();
    });
    wrap.appendChild(head);

    const body = el('div', 'sec-body');
    wrap.appendChild(body);
    return { wrap, body };
  }

  function render() {
    /*
     * Never build a panel on a page that should not have one.
     *
     * `ensureRoot()` recreates its host if it has gone, so *any* render that
     * lands after the panel was taken down puts it back — and several do land
     * late: the copy confirmation's timer, and `setMessage` from an add that
     * was still in flight when the user navigated. Without this the panel
     * reappears on the LinkedIn feed seconds after leaving a profile. One guard
     * here covers every one of those paths, where patching each caller would
     * miss the next one.
     */
    if (!panelContext()) {
      removePanel();
      return;
    }

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

    /*
     * Chevrons, not a cross. On a docked rail a × reads as "dismiss this", and
     * a panel that looks dismissed-for-good is one people do not try to get
     * back. An arrow pointing at the edge says where it is going.
     */
    const toggle = el('button', null, state.collapsed ? '‹' : '›');
    toggle.title = state.collapsed ? 'Open Sincerely' : 'Hide the panel';
    toggle.setAttribute('aria-label', state.collapsed ? 'Open Sincerely' : 'Hide the Sincerely panel');
    toggle.setAttribute('aria-expanded', String(!state.collapsed));
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
    const whoTop = el('div', 'who-top');
    const [from, to] = GRADIENTS[hashCode((name || person.email || '?').toLowerCase()) % GRADIENTS.length];
    const avatar = el('span', 'avatar', initialsFor(name, person.email));
    avatar.style.background = `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
    whoTop.appendChild(avatar);

    const whoText = el('div', 'who-text');
    const whoName = el('div', 'who-name');
    whoName.appendChild(
      state.contact ? link(`/contacts/${state.contact.id}`, display) : document.createTextNode(display)
    );
    whoText.appendChild(whoName);
    /*
     * Role and company on separate lines rather than joined by a separator.
     * "Founder · Buildable" clipped at this width reads as neither of them;
     * stacked, the role stays legible even when the company truncates.
     */
    if (person.job_title) whoText.appendChild(el('div', 'who-role', person.job_title));
    if (person.company) whoText.appendChild(el('div', 'who-org', person.company));
    if (!person.job_title && !person.company) {
      whoText.appendChild(el('div', 'who-sub', 'No title or company on this profile'));
    }
    whoTop.appendChild(whoText);
    who.appendChild(whoTop);
    body.appendChild(who);

    /* One line of history */
    const strip = historyStrip();
    if (strip) body.appendChild(strip);

    /* What can be done here, before anything has to be read. */
    body.appendChild(quickCard());

    /* Where an add would go. The object of the verb above — not a second one. */
    if (person.email || state.contact) body.appendChild(destinationRow());

    /* Address */
    const contactSection = section('contact', 'Contact information');
    contactSection.body.appendChild(el('div', 'field-label', 'Email'));
    contactSection.body.appendChild(emailRow());
    body.appendChild(contactSection.wrap);

    /* Lists they're already on */
    if (state.memberships.length > 0) {
      const onLists = section('lists', 'Lead lists', { count: String(state.memberships.length) });
      const rows = el('div', 'rows');
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
      onLists.body.appendChild(rows);
      body.appendChild(onLists.wrap);
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
   * The action card under the name.
   *
   * There is exactly one Add in this panel and it is here. The destination
   * lives in its own row below as a chooser with no verb on it — a select
   * reading "Conference — Q3" beside a button reading "Add to list" was the
   * two-buttons-that-both-say-add problem, and putting the verb on a card does
   * not make a second copy of it acceptable.
   */
  function quickCard() {
    const person = state.person || {};
    const card = el('div', 'quick');

    const target = state.lists.find((l) => l.id === state.selectedListId);
    const alreadyOn = Boolean(target) && state.memberships.some((m) => m.id === target.id);

    /*
     * Already on the chosen list is a *satisfied* state, not a failure. Drawn
     * as a plain disabled button it reads as broken — the old primary button
     * had a green "done" treatment for exactly this reason and rebuilding the
     * card lost it.
     */
    card.appendChild(
      quickAction({
        label: alreadyOn ? 'On list' : 'Add to list',
        glyph: alreadyOn ? 'check' : 'add',
        variant: alreadyOn ? 'done' : 'primary',
        disabled: state.busy || !person.email || state.lists.length === 0 || alreadyOn,
        /*
         * Name the thing that is actually missing. This used to say "choose a
         * lead list below" whenever no list was selected — including when the
         * profile has no address, where the picker below isn't drawn at all, so
         * it pointed at a control that wasn't on screen.
         */
        title: !person.email
          ? 'No address for this person yet'
          : state.lists.length === 0
            ? 'No lead lists on this account yet'
            : alreadyOn
              ? `Already on "${target.name}"`
              : target
                ? `Add to "${target.name}"`
                : 'Choose a lead list below first',
        onClick: addToList,
      })
    );

    /*
     * The second slot follows the address rather than sitting dead half the time.
     *
     * With one, copying it is the thing people actually want. Without one, this
     * takes you to the finder — it does **not** run the prospect search. That
     * search costs a credit, and promoting it to a top-level icon with no price
     * next to it, clickable while the free contact-info read was still running,
     * was a way to spend money by accident. The paid route keeps its own button
     * further down, under the free one, with the cost written beside it.
     */
    if (person.email) {
      card.appendChild(
        quickAction({
          label: state.copied ? 'Copied' : 'Copy email',
          glyph: state.copied ? 'check' : 'copy',
          variant: state.copied ? 'done' : undefined,
          disabled: state.busy,
          title: `Copy ${person.email}`,
          onClick: () => copyEmail(person.email),
        })
      );
    } else {
      card.appendChild(
        quickAction({
          label: 'Find email',
          glyph: 'search',
          disabled: state.busy || state.lookingForEmail,
          title: state.lookingForEmail
            ? 'Still reading this profile’s contact info…'
            : 'Go to the finder — nothing is charged',
          onClick: () => {
            state.openSections.contact = true;
            render();
            focusFinder();
          },
        })
      );
    }

    card.appendChild(
      quickAction({
        label: 'Open',
        glyph: 'open',
        disabled: !state.appUrl,
        title: state.appUrl ? 'Open in Sincerely' : 'Set your app URL in the extension settings',
        onClick: () => {
          if (!state.appUrl) return;
          const path = state.contact ? `/contacts/${state.contact.id}` : '/contacts';
          window.open(`${state.appUrl}${path}`, '_blank', 'noopener,noreferrer');
        },
      })
    );

    return card;
  }

  /**
   * Put the cursor in the domain box, wherever the section happens to be.
   *
   * Done straight after render rather than through a state flag: a flag has to
   * survive the no-op render guard, and pressing Find a second time changes
   * nothing about the state, so the guard would skip the repaint and the focus
   * with it.
   */
  function focusFinder() {
    const input = ensureRoot().querySelector('.finder input.txt');
    if (!input) return;
    input.focus();
    input.scrollIntoView?.({ block: 'nearest' });
  }

  /**
   * Put the address on the clipboard.
   *
   * @param {string} address
   */
  async function copyEmail(address) {
    if (!address) return;
    let ok = false;

    try {
      await navigator.clipboard.writeText(address);
      ok = true;
    } catch {
      /*
       * The Clipboard API needs a secure context and user activation, and a
       * page's permissions policy can refuse it outright. The selection trick
       * still works in all of those cases.
       */
      try {
        const scratch = document.createElement('textarea');
        scratch.value = address;
        scratch.setAttribute('readonly', '');
        scratch.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
        document.body.appendChild(scratch);
        scratch.select();
        ok = document.execCommand('copy');
        scratch.remove();
      } catch {
        ok = false;
      }
    }

    if (!ok) {
      return setMessage('Could not reach the clipboard — select the address and copy it.', 'error');
    }

    state.copied = true;
    render();
    // Long enough to be seen, short enough that the button doesn't stay lying
    // about its own state. Cleared on teardown so it can't fire into a panel
    // that has gone.
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      state.copied = false;
      render();
    }, 1600);
  }

  /**
   * Which lead list an add would go to. The object of the verb on the card
   * above — deliberately not a second control carrying the verb itself.
   */
  function destinationRow() {
    const wrap = el('div', 'dest');
    wrap.appendChild(el('div', 'field-label', 'Destination list'));

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

    wrap.appendChild(select);
    return wrap;
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
    wrap.appendChild(el('div', 'field-label', 'Find an address'));

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
    wrap.appendChild(el('div', 'cost', 'Free — guesses from the company’s own convention, then asks their mail server.'));

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

    wrap.appendChild(el('div', 'field-label', 'Or enter it yourself'));
    const manual = el('input', 'txt');
    manual.type = 'email';
    manual.placeholder = 'name@company.com';
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

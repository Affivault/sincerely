/**
 * Content script: works out who the current page is about.
 *
 * A classic script, not a module — MV3 content scripts declared in the manifest
 * can't use `import`, so everything this needs is inline. It's also injected
 * programmatically on non-LinkedIn/Gmail pages, so it must tolerate running
 * twice in the same document.
 *
 * It holds no credentials and makes no API calls. It reads the DOM and asks the
 * service worker to do anything privileged.
 */

(() => {
  // Injected on top of the declarative registration, or twice on an SPA
  // navigation — either way, don't rebind listeners or stack up buttons.
  if (window.__sincerelyScraperLoaded) return;
  window.__sincerelyScraperLoaded = true;

  // Shared namespace. Content scripts declared in the manifest can't be ES
  // modules, so the panel and list-selection scripts reach the scraper through
  // this rather than through imports.
  const sincerely = (window.__sincerely = window.__sincerely || {});

  const EMAIL_PATTERN = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

  /**
   * Non-global twin of the pattern above, for one-off tests.
   *
   * A /g regex carries lastIndex between calls, so reusing EMAIL_PATTERN with
   * .test() in a loop silently skips every other match — addresses would
   * disappear at random from pages with several of them.
   */
  const EMAIL_TEST = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

  // Role accounts — never the person you're prospecting.
  const NOISE_EMAIL = /^(no-?reply|do-?not-?reply|postmaster|mailer-daemon|abuse|support|info|hello|admin|webmaster|notifications?|bounce)@/i;

  // Domains that only ever appear as page infrastructure. Fully anchored on
  // purpose: matching these as substrings would throw away real prospects
  // (someone at google.com or linkedin.com is a legitimate contact, and
  // "protest.com" contains "test.com").
  const NOISE_DOMAIN = /^(?:[a-z0-9-]+\.)*(gstatic|googletagmanager|doubleclick|google-analytics|sentry|cloudflareinsights)\.(com|io|net)$/i;

  /* ---------------------------------------------------------------- */
  /* Generic helpers                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * @param {string} email
   * @returns {boolean} False for role accounts and tracking-pixel domains.
   */
  function isPlausibleEmail(email) {
    if (!email || email.length > 254) return false;
    if (NOISE_EMAIL.test(email)) return false;
    const domain = email.split('@')[1] || '';
    if (NOISE_DOMAIN.test(domain)) return false;
    // Bundled asset names ("icon@2x.png") read as emails to a loose regex.
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(email)) return false;
    return true;
  }

  /**
   * Split a display name into first/last.
   * Trailing credentials ("Jane Doe, MBA") and LinkedIn's degree badges
   * ("Jane Doe 2nd") would otherwise end up in the last name.
   *
   * @param {string} full
   * @returns {{first_name: string|null, last_name: string|null}}
   */
  function splitName(full) {
    const cleaned = String(full || '')
      .replace(/\s*\|\s*LinkedIn\s*$/i, '')
      .replace(/\s*[·•]\s*\d+(st|nd|rd|th)\s*$/i, '')
      .replace(/\s+\d+(st|nd|rd|th)\s*$/i, '')
      .replace(/,.*$/, '')
      .replace(/\s*\(.*?\)\s*/g, ' ')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return { first_name: null, last_name: null };
    const parts = cleaned.split(' ').filter(Boolean);
    if (parts.length === 1) return { first_name: parts[0], last_name: null };
    return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
  }

  /** @param {Element|null} el */
  function text(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  /**
   * @param {string[]} selectors Tried in order; first non-empty wins.
   * @param {ParentNode} [root]
   * @returns {string}
   */
  function firstText(selectors, root = document) {
    for (const selector of selectors) {
      const value = text(root.querySelector(selector));
      if (value) return value;
    }
    return '';
  }

  /**
   * Every plausible email on the page, best-first: mailto: links are far more
   * reliable than a regex sweep of body text.
   * @returns {string[]}
   */
  function collectEmails() {
    const found = new Set();

    for (const link of document.querySelectorAll('a[href^="mailto:"]')) {
      const raw = decodeURIComponent(link.getAttribute('href').slice('mailto:'.length)).split('?')[0];
      const email = (raw.match(EMAIL_PATTERN) || [])[0];
      if (email && isPlausibleEmail(email.toLowerCase())) found.add(email.toLowerCase());
    }

    // Gmail and several CRMs stash the real address in an attribute.
    for (const node of document.querySelectorAll('[email], [data-email]')) {
      const value = (node.getAttribute('email') || node.getAttribute('data-email') || '').toLowerCase();
      if (EMAIL_TEST.test(value) && isPlausibleEmail(value)) found.add(value);
    }

    // Body text last, and capped — innerText on a huge page is expensive and
    // the tail end is almost always footer noise.
    const body = document.body ? document.body.innerText.slice(0, 60000) : '';
    for (const match of body.match(EMAIL_PATTERN) || []) {
      const email = match.toLowerCase();
      if (isPlausibleEmail(email)) found.add(email);
      if (found.size > 25) break;
    }

    return [...found];
  }

  /** The user's current selection, if it happens to be an email. */
  function emailFromSelection() {
    const selection = String(window.getSelection?.() || '').trim();
    const match = selection.match(EMAIL_PATTERN);
    return match ? match[0].toLowerCase() : null;
  }

  /* ---------------------------------------------------------------- */
  /* Site adapters                                                    */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /* LinkedIn contact info                                            */
  /* ---------------------------------------------------------------- */

  /**
   * The profile slug in the current URL, e.g. "jane-doe-1234" from
   * /in/jane-doe-1234/. Null on anything that isn't a profile.
   */
  function linkedInPublicId() {
    const match = location.pathname.match(/\/in\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  /**
   * LinkedIn's CSRF token, which is simply the JSESSIONID cookie's value.
   * Required on its internal API, and absent when the user is signed out.
   */
  function linkedInCsrfToken() {
    const match = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
    return match ? match[1] : null;
  }

  /** Every address in an arbitrary object graph, however deeply nested. */
  function emailsInJson(value, found = new Set(), depth = 0) {
    if (depth > 8 || found.size > 10) return found;
    if (typeof value === 'string') {
      if (EMAIL_TEST.test(value) && isPlausibleEmail(value.toLowerCase())) {
        found.add(value.toLowerCase());
      }
      return found;
    }
    if (Array.isArray(value)) {
      for (const item of value) emailsInJson(item, found, depth + 1);
      return found;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) emailsInJson(item, found, depth + 1);
    }
    return found;
  }

  /** Websites listed on a profile, used to work out the company's domain. */
  function websitesInJson(value, found = new Set(), depth = 0) {
    if (depth > 8 || found.size > 6) return found;
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value) && !/linkedin\.com|licdn\.com/i.test(value)) found.add(value);
      return found;
    }
    if (Array.isArray(value)) {
      for (const item of value) websitesInJson(item, found, depth + 1);
      return found;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) websitesInJson(item, found, depth + 1);
    }
    return found;
  }

  /**
   * Cache per profile for the life of the page, so an SPA navigation back to a
   * profile — or the panel and the popup asking at the same moment — doesn't
   * re-request. Keyed by slug; a Map is enough, this never grows large.
   */
  const contactInfoCache = new Map();

  /** fetch with a deadline, so a hung request can't stall a scrape. */
  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read a profile's contact details without the user opening the overlay.
   *
   * The address on a LinkedIn profile lives behind the "Contact info" link, so
   * it is genuinely not in the page until that dialog is opened. Waiting for a
   * click is not a fix: on a profile where the email is right there, the
   * extension appeared to find nothing.
   *
   * So ask LinkedIn the same question the dialog asks, using the user's own
   * signed-in session. Two routes, because LinkedIn's internals move:
   *
   *  1. The endpoint the overlay itself calls. Fastest and returns structured
   *     fields.
   *  2. The overlay's own URL, scanned for addresses. Slower, but survives the
   *     first route being renamed.
   *
   * Both are same-origin requests from a linkedin.com page carrying the user's
   * cookies — the extension sees exactly what the user would see by clicking,
   * and nothing more. Failure is always silent: the DOM scrape still runs, so a
   * blocked or changed API degrades to the old behaviour rather than breaking.
   *
   * @param {string} publicId
   * @returns {Promise<{emails: string[], websites: string[]}>}
   */
  /** Resolve once `test()` returns something truthy, or null at the deadline. */
  function waitFor(test, timeoutMs, intervalMs = 100) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        let value = null;
        try {
          value = test();
        } catch {
          value = null;
        }
        if (value) return resolve(value);
        if (Date.now() - started >= timeoutMs) return resolve(null);
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  /** The "Contact info" control on a profile, however LinkedIn has labelled it. */
  function contactInfoTrigger() {
    return (
      document.getElementById('top-card-text-details-contact-info') ||
      document.querySelector('a[href*="/overlay/contact-info"]') ||
      [...document.querySelectorAll('main a, main button')].find((node) =>
        /^\s*contact info\s*$/i.test(node.textContent || '')
      ) ||
      null
    );
  }

  /**
   * Open the Contact info dialog, read it, and put the page back.
   *
   * This is the path that actually works, and it is first for that reason.
   * LinkedIn's internal API endpoints move and get locked down; its own UI
   * cannot, because that is what the user clicks. Driving that UI does exactly
   * what the user would do by hand — the extension has no more access than they
   * do — and produces the address on a profile they are merely looking at,
   * which is the whole point.
   *
   * The dialog is hidden while it is open, so the page doesn't flash. The style
   * is removed in a `finally`, so a throw can't leave LinkedIn's modals
   * invisible for the rest of the session.
   *
   * @returns {Promise<string[]>}
   */
  async function readContactInfoOverlay() {
    const trigger = contactInfoTrigger();
    if (!trigger) return [];

    const wasAt = location.href;
    const style = document.createElement('style');
    style.setAttribute('data-sincerely', 'overlay-hide');
    // Opacity rather than display: LinkedIn's modal measures itself on open, and
    // an undisplayed dialog can decide it has nothing to render.
    style.textContent =
      '.artdeco-modal-overlay,.artdeco-modal,[role="dialog"]{opacity:0!important;pointer-events:none!important;}';
    document.head.appendChild(style);

    try {
      trigger.click();

      const modal = await waitFor(
        () =>
          document.querySelector('.pv-contact-info') ||
          document.querySelector('.artdeco-modal[role="dialog"]') ||
          document.querySelector('[role="dialog"]'),
        4000
      );
      if (!modal) return [];

      // The shell appears before its contents, so wait for something to read.
      await waitFor(
        () => modal.querySelector('a[href^="mailto:"]') || EMAIL_TEST.test(modal.textContent || ''),
        3000
      );

      const found = new Set();
      for (const link of modal.querySelectorAll('a[href^="mailto:"]')) {
        const address = decodeURIComponent(link.getAttribute('href').slice(7)).split('?')[0].toLowerCase();
        if (EMAIL_TEST.test(address) && isPlausibleEmail(address)) found.add(address);
      }
      /*
       * Text nodes one at a time, not the dialog's whole textContent. Adjacent
       * elements concatenate with no separator, so a dismiss button labelled "x"
       * sitting beside the address yields "xjane.doe@acme.com" — a plausible
       * address that does not exist.
       */
      const walker = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node && found.size <= 5; node = walker.nextNode()) {
        for (const match of (node.nodeValue || '').match(EMAIL_PATTERN) || []) {
          const address = match.toLowerCase();
          if (isPlausibleEmail(address)) found.add(address);
        }
      }

      // Put it back the way we found it, by LinkedIn's own dismiss where there
      // is one, then Escape, then history as a last resort.
      const dismiss = modal.closest('.artdeco-modal')?.querySelector('.artdeco-modal__dismiss') ||
        document.querySelector('button[aria-label*="Dismiss" i]');
      if (dismiss) {
        dismiss.click();
      } else {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })
        );
      }
      await waitFor(() => !document.querySelector('[role="dialog"]'), 1500);

      /*
       * Dismissing usually pops the history entry LinkedIn pushed, but
       * history.back() is asynchronous — the URL is still the overlay's for a
       * moment afterwards. Checking too early and "helpfully" going back again
       * takes the user off the profile entirely, one entry further back than
       * they ever were. So wait for the URL to settle, and only step back if it
       * genuinely didn't.
       */
      const restored = await waitFor(() => location.href === wasAt, 1200);
      if (!restored && /overlay\/contact-info/.test(location.href)) {
        history.back();
        await waitFor(() => location.href === wasAt, 1200);
      }

      return [...found];
    } catch {
      return [];
    } finally {
      style.remove();
    }
  }

  async function linkedInContactInfo(publicId) {
    if (contactInfoCache.has(publicId)) return contactInfoCache.get(publicId);

    const result = { emails: [], websites: [] };

    // The reliable route first. Anything else costs seconds of network waiting
    // before the thing that was going to work anyway.
    result.emails = await readContactInfoOverlay();
    if (result.emails.length > 0) {
      contactInfoCache.set(publicId, result);
      return result;
    }

    const token = linkedInCsrfToken();

    if (token) {
      try {
        const response = await fetchWithTimeout(
          `${location.origin}/voyager/api/identity/profiles/${encodeURIComponent(publicId)}/profileContactInfo`,
          {
            credentials: 'include',
            headers: {
              accept: 'application/vnd.linkedin.normalized+json+2.1',
              'csrf-token': token,
              'x-restli-protocol-version': '2.0.0',
            },
          },
          4000
        );
        if (response.ok) {
          const body = await response.json();
          result.emails = [...emailsInJson(body)];
          result.websites = [...websitesInJson(body)];
        }
      } catch {
        // Signed out, endpoint moved, or offline — route 2 gets a turn.
      }
    }

    if (result.emails.length === 0) {
      try {
        const response = await fetchWithTimeout(
          `${location.origin}/in/${encodeURIComponent(publicId)}/overlay/contact-info/`,
          { credentials: 'include', headers: { accept: 'text/html' } },
          4000
        );
        if (response.ok) {
          const html = await response.text();
          const found = new Set();
          // The addresses arrive inside embedded JSON, so entity-decode first;
          // an unescaped &#64; would otherwise hide one.
          const decoded = html
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
            .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
            .replace(/&amp;/g, '&');
          for (const match of decoded.match(EMAIL_PATTERN) || []) {
            const email = match.toLowerCase();
            if (isPlausibleEmail(email)) found.add(email);
            if (found.size > 5) break;
          }
          result.emails = [...found];
        }
      } catch {
        // Nothing more to try; the DOM scrape below still applies.
      }
    }

    contactInfoCache.set(publicId, result);
    return result;
  }

  /**
   * LinkedIn profile pages.
   *
   * Fields come from the DOM; the address comes from the contact-info endpoint
   * above, because it is never in the DOM until the user opens that dialog.
   *
   * Selectors are deliberately layered: LinkedIn reskins often, and a stale
   * single selector would silently return nothing.
   */
  async function scrapeLinkedIn() {
    const publicId = linkedInPublicId();
    if (!publicId) return null;

    const name = firstText([
      'main h1',
      '.pv-text-details__left-panel h1',
      '.text-heading-xlarge',
      'h1',
    ]);

    const headline = firstText([
      '.text-body-medium.break-words',
      '.pv-text-details__left-panel .text-body-medium',
      'main .text-body-medium',
    ]);

    // The top card's current-company button is the most reliable company
    // signal; the experience section is the fallback.
    let company = firstText([
      'button[aria-label^="Current company"] .pv-text-details__right-panel-item-text',
      '.pv-text-details__right-panel-item-text',
      '[data-field="experience_company_logo"] + div span[aria-hidden="true"]',
    ]);

    // Headlines are overwhelmingly "Title at Company".
    let jobTitle = headline;
    const atMatch = headline.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
    if (atMatch) {
      jobTitle = atMatch[1].trim();
      if (!company) company = atMatch[2].trim();
    }

    // Anything already in the DOM (the overlay may be open), plus what the
    // contact-info endpoint gives us. Order matters: a selection the user made
    // beats everything, then the profile's own address.
    const domEmails = collectEmails();
    const contact = await linkedInContactInfo(publicId).catch(() => ({ emails: [], websites: [] }));

    const emails = [...new Set([...contact.emails, ...domEmails])];

    // The company's domain, for finding an address when the profile has none.
    // A personal site is a better signal than nothing, and the finder rejects
    // consumer hosts anyway.
    const companyDomain = contact.websites
      .map((url) => {
        try {
          return new URL(url).hostname.replace(/^www\./, '');
        } catch {
          return null;
        }
      })
      .filter(Boolean)[0] || null;

    return {
      ...splitName(name),
      full_name: name || null,
      email: emailFromSelection() || emails[0] || null,
      email_candidates: emails,
      company: company || null,
      company_domain: companyDomain,
      job_title: jobTitle || null,
      linkedin_url: `${location.origin}${location.pathname}`.replace(/\/$/, ''),
      source: 'linkedin',
      source_url: location.href,
    };
  }

  /**
   * Gmail — the sender of the open message.
   *
   * Gmail's class names are generated, but it has annotated sender spans with
   * `email` and `name` attributes for many years; that's what this leans on.
   */
  function scrapeGmail() {
    // Prefer the sender inside an expanded message over anything in the list view.
    const senderNode =
      document.querySelector('.gs .gD[email]') ||
      document.querySelector('h3.iw span[email]') ||
      document.querySelector('span[email]:not([email=""])');

    if (!senderNode) return null;

    const email = (senderNode.getAttribute('email') || '').toLowerCase();
    const name = senderNode.getAttribute('name') || text(senderNode);

    if (!email || !isPlausibleEmail(email)) return null;

    return {
      ...splitName(name),
      full_name: name || null,
      email,
      email_candidates: [email, ...collectEmails().filter((e) => e !== email)],
      company: null,
      job_title: null,
      linkedin_url: null,
      source: 'gmail',
      source_url: location.href,
    };
  }

  /**
   * Anything else: the selection, a mailto: link, page metadata, body text.
   */
  function scrapeGeneric() {
    const emails = collectEmails();
    const selected = emailFromSelection();

    const name = firstText([
      '[itemprop="name"]',
      'h1',
      'meta[property="profile:first_name"]',
    ]) || document.title;

    const company =
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || null;

    return {
      ...splitName(name),
      full_name: name || null,
      email: selected || emails[0] || null,
      email_candidates: selected ? [selected, ...emails.filter((e) => e !== selected)] : emails,
      company,
      job_title: null,
      linkedin_url: null,
      source: 'generic',
      source_url: location.href,
    };
  }

  /**
   * Run the adapter matching the current host, falling back to generic when a
   * site-specific one finds nothing (e.g. a LinkedIn feed rather than a profile).
   *
   * Async because LinkedIn's address has to be fetched rather than read off the
   * page. The generic and Gmail paths still resolve immediately.
   *
   * @returns {Promise<object>}
   */
  async function scrape() {
    const host = location.hostname;
    let result = null;

    if (host.endsWith('linkedin.com')) result = await scrapeLinkedIn();
    else if (host === 'mail.google.com') result = scrapeGmail();

    if (!result || !result.email) {
      const generic = scrapeGeneric();
      // Keep the richer site-specific fields, fill the gaps from generic.
      result = result
        ? {
            ...generic,
            ...Object.fromEntries(Object.entries(result).filter(([, v]) => v !== null && v !== '')),
            email: result.email || generic.email,
            email_candidates: result.email_candidates?.length
              ? result.email_candidates
              : generic.email_candidates,
          }
        : generic;
    }

    return result;
  }

  /* ---------------------------------------------------------------- */
  /* In-page UI                                                       */
  /* ---------------------------------------------------------------- */

  const HOST_ID = 'sincerely-ext-host';

  /**
   * All injected UI lives in a shadow root: LinkedIn and Gmail ship
   * aggressive global CSS, and we mustn't leak ours into their page either.
   * @returns {ShadowRoot}
   */
  function ensureShadowRoot() {
    let host = document.getElementById(HOST_ID);
    if (host?.shadowRoot) return host.shadowRoot;

    host = document.createElement('div');
    host.id = HOST_ID;
    // Fixed positioning on the host keeps it out of the page's layout flow.
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000;';
    document.documentElement.appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    // Sincerely tokens, inlined: a shadow root can't inherit the extension's
    // stylesheet, and the page's own CSS must not reach in here. Values track
    // client/src/index.css. Light surfaces only — this floats over someone
    // else's page, where a dark slab would read as a third-party ad.
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      .toast {
        position: fixed; right: 20px; bottom: 68px;
        max-width: 330px; padding: 11px 13px;
        border-radius: 10px;
        background: #FFFFFF; color: #1B1B1F;
        border: 1px solid #ECEAE6;
        font-size: 12.5px; line-height: 1.5; letter-spacing: -0.005em;
        box-shadow: 0 1px 2px rgba(27,27,31,.04), 0 8px 20px -6px rgba(27,27,31,.10);
      }
      .toast.success { background: #ECFDF5; border-color: #D1FAE5; color: #10B981; }
      .toast.error { background: #FEF2F2; border-color: #FEE2E2; color: #EF4444; }
      .toast .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
      .toast button {
        height: 26px; padding: 0 9px;
        border: 1px solid currentColor; border-radius: 6px;
        background: transparent; color: inherit;
        font-family: inherit; font-size: 12px; font-weight: 500;
        cursor: pointer; opacity: .85;
      }
      .toast button:hover { opacity: 1; }

      @media (prefers-color-scheme: dark) {
        .toast { background: #191919; color: #F4F4F3; border-color: #262626;
                 box-shadow: 0 2px 4px -1px rgba(0,0,0,.35), 0 12px 24px -6px rgba(0,0,0,.45); }
        .toast.success { background: rgba(34,197,94,.10); border-color: rgba(34,197,94,.2); color: #4ADE80; }
        .toast.error { background: rgba(239,68,68,.10); border-color: rgba(239,68,68,.2); color: #F87171; }
      }
    `;
    root.appendChild(style);
    return root;
  }

  let toastTimer = null;

  /**
   * @param {string} message
   * @param {{variant?: 'error'|'success', actionLabel?: string, onAction?: () => void, timeout?: number}} [opts]
   */
  function showToast(message, opts = {}) {
    const root = ensureShadowRoot();
    root.querySelector('.toast')?.remove();
    if (toastTimer) clearTimeout(toastTimer);

    const toast = document.createElement('div');
    toast.className = `toast${opts.variant ? ` ${opts.variant}` : ''}`;
    const label = document.createElement('div');
    label.textContent = message;
    toast.appendChild(label);

    if (opts.actionLabel && opts.onAction) {
      const row = document.createElement('div');
      row.className = 'row';
      const button = document.createElement('button');
      button.textContent = opts.actionLabel;
      button.addEventListener('click', () => {
        toast.remove();
        opts.onAction();
      });
      row.appendChild(button);
      toast.appendChild(row);
    }

    root.appendChild(toast);
    toastTimer = setTimeout(() => toast.remove(), opts.timeout ?? 6000);
  }

  /* ---------------------------------------------------------------- */
  /* Wiring                                                           */
  /* ---------------------------------------------------------------- */

  // Published for the other content scripts on this page.
  sincerely.scrape = scrape;
  sincerely.splitName = splitName;
  sincerely.isPlausibleEmail = isPlausibleEmail;
  sincerely.collectEmails = collectEmails;
  sincerely.ensureShadowRoot = ensureShadowRoot;
  sincerely.showToast = showToast;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'SINCERELY_SCRAPE') return false;
    // Returning true keeps the channel open for the async reply below.
    scrape().then(sendResponse, () => sendResponse(null));
    return true;
  });

})();

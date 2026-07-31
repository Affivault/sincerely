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

  /**
   * The same results again, but settled and readable *synchronously*.
   *
   * The fast scrape must never await anything, and it must still report an
   * address that a previous deep read already established — otherwise every
   * re-render on a profile shows "no email" for a beat before the deep result
   * lands again. A promise can't be read without awaiting it; this can.
   */
  const contactInfoSettled = new Map();

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

  /**
   * The one element it is safe to click: the profile's own Contact info link.
   *
   * Deliberately narrow. An earlier version also matched any `<button>` in
   * `main` whose text read "Contact info", which on a real profile picks up the
   * wrong control — LinkedIn's buttons carry nested visually-hidden text, the
   * label is translated on non-English accounts, and a near-miss means clicking
   * Message or Connect on somebody's profile. Clicking the wrong thing on a
   * page the user is only looking at is far worse than finding no address, so
   * the rule is: an anchor whose href is this profile's contact-info overlay,
   * or nothing at all.
   *
   * @param {string} publicId
   * @returns {HTMLAnchorElement|null}
   */
  function contactInfoTrigger(publicId) {
    const anchors = [...document.querySelectorAll('a[href*="/overlay/contact-info"]')];
    const mine = anchors.filter((anchor) => {
      const href = anchor.getAttribute('href') || '';
      // "People also viewed" and similar carry other people's overlay links.
      // Only this profile's slug is ours to open.
      const slug = href.match(/\/in\/([^/?#]+)/);
      return !slug || decodeURIComponent(slug[1]) === publicId;
    });
    // The top card's link is the canonical one where several match.
    return mine.find((anchor) => anchor.closest('main')) || mine[0] || null;
  }

  /**
   * Is this dialog the contact-info one, rather than something else that
   * happened to open?
   *
   * Checked before reading and before dismissing. Without it, a message
   * composer or a cookie notice that appeared at the wrong moment would be
   * scraped for addresses and then closed on the user's behalf.
   *
   * @param {Element} dialog
   */
  function looksLikeContactInfo(dialog) {
    if (dialog.querySelector('.pv-contact-info, [class*="contact-info" i]')) return true;
    if (dialog.querySelector('a[href^="mailto:"]')) return true;
    const heading = dialog.querySelector('h1, h2, [role="heading"]');
    return /contact\s*info/i.test(heading?.textContent || '');
  }

  /** True while we are driving LinkedIn's UI, so other watchers stay out of it. */
  let overlayBusy = false;

  /**
   * Open the profile's Contact info dialog, read it, and put the page back.
   *
   * This is the route that actually works. LinkedIn's internal API endpoints
   * move and get locked down; its own UI cannot, because that is what the user
   * clicks. Driving it does exactly what they would do by hand — the extension
   * sees no more than they would — and produces the address on a profile they
   * are merely looking at, which is the whole point.
   *
   * Everything here is written to fail closed. It clicks one specific anchor or
   * nothing; it only accepts a dialog that appeared *after* that click and
   * looks like contact info; it dismisses only within that dialog; and the
   * hiding stylesheet is removed in a `finally`, so a throw can't leave
   * LinkedIn's own modals invisible for the rest of the session.
   *
   * @param {string} publicId
   * @returns {Promise<string[]>}
   */
  async function readContactInfoOverlay(publicId) {
    const trigger = contactInfoTrigger(publicId);
    if (!trigger) return [];

    // Anything already open is the page's own business — never ours to read or
    // to close. Only a dialog that wasn't here before the click counts.
    const before = new Set(document.querySelectorAll('[role="dialog"], .artdeco-modal'));

    const wasAt = location.href;
    const style = document.createElement('style');
    style.setAttribute('data-sincerely', 'overlay-hide');
    // Opacity rather than display: LinkedIn's modal measures itself on open, and
    // an undisplayed dialog can decide it has nothing to render.
    /*
     * The last clause is the important one. LinkedIn locks body scroll while a
     * modal is open, so hiding the dialog but leaving the lock in place is worse
     * than doing nothing: the page looks normal and simply refuses to move for a
     * couple of seconds. That is the "buffer" — not slowness, a frozen page. The
     * lock is overridden for as long as we're driving, and the rule is removed
     * in the `finally` below, so LinkedIn's own modals still lock normally.
     */
    style.textContent =
      '.artdeco-modal-overlay,.artdeco-modal,[role="dialog"]{opacity:0!important;pointer-events:none!important;}' +
      'html,body{overflow:auto!important;position:static!important;}';
    document.head.appendChild(style);
    overlayBusy = true;

    /** Close only what we opened, and only from inside it. */
    const dismiss = (dialog) => {
      const button =
        dialog.querySelector('.artdeco-modal__dismiss') ||
        dialog.querySelector('button[aria-label*="dismiss" i], button[aria-label*="close" i]');
      if (button) button.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    };

    try {
      trigger.click();

      /*
       * Short deadlines on purpose. This runs last, after the network routes
       * have already had their turn, and every millisecond here is a millisecond
       * of somebody's profile being driven underneath them. If LinkedIn hasn't
       * produced the dialog in a second and a half it isn't going to.
       */
      const modal = await waitFor(
        () =>
          [...document.querySelectorAll('[role="dialog"], .artdeco-modal')].find(
            (node) => !before.has(node)
          ),
        1500
      );
      if (!modal) return [];

      // The shell appears before its contents, so wait for something to read.
      await waitFor(
        () => modal.querySelector('a[href^="mailto:"]') || EMAIL_TEST.test(modal.textContent || ''),
        1500
      );

      if (!looksLikeContactInfo(modal)) {
        // Something else opened. Put it back and take nothing from it.
        dismiss(modal);
        return [];
      }

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

      dismiss(modal);
      await waitFor(() => !modal.isConnected, 1500);

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
      overlayBusy = false;
    }
  }

  /**
   * Route 1: the endpoint the Contact info overlay itself calls.
   *
   * Same-origin, carrying the user's own cookies, returning structured fields —
   * the fastest answer available and completely invisible to the page.
   *
   * @param {string} publicId
   * @returns {Promise<{emails: string[], websites: string[]}>} Empty on any failure.
   */
  async function fetchVoyagerContactInfo(publicId) {
    const token = linkedInCsrfToken();
    if (!token) return { emails: [], websites: [] };

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
      if (!response.ok) return { emails: [], websites: [] };
      const body = await response.json();
      return { emails: [...emailsInJson(body)], websites: [...websitesInJson(body)] };
    } catch {
      // Signed out, endpoint moved, or offline — the other routes get a turn.
      return { emails: [], websites: [] };
    }
  }

  /**
   * Route 2: the overlay's own URL, fetched and scanned.
   *
   * Slower and unstructured, but it survives route 1 being renamed, which
   * LinkedIn does periodically.
   *
   * @param {string} publicId
   * @returns {Promise<string[]>} Empty on any failure.
   */
  async function fetchOverlayHtml(publicId) {
    try {
      const response = await fetchWithTimeout(
        `${location.origin}/in/${encodeURIComponent(publicId)}/overlay/contact-info/`,
        { credentials: 'include', headers: { accept: 'text/html' } },
        4000
      );
      if (!response.ok) return [];

      const html = await response.text();
      const found = new Set();
      // The addresses arrive inside embedded JSON, so entity-decode first; an
      // unescaped &#64; would otherwise hide one.
      const decoded = html
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&amp;/g, '&');
      for (const match of decoded.match(EMAIL_PATTERN) || []) {
        const email = match.toLowerCase();
        if (isPlausibleEmail(email)) found.add(email);
        if (found.size > 5) break;
      }
      return [...found];
    } catch {
      return [];
    }
  }

  async function linkedInContactInfo(publicId) {
    /*
     * The cache holds the in-flight promise, not just the finished value, and
     * that is the point. The panel, the popup and the DOM watcher all scrape
     * the same page, often within the same second; without this each one opens
     * the dialog again, which on a real profile is the difference between one
     * quiet click and the page visibly thrashing. Failures are cached too — a
     * profile with no contact-info link must be asked once, not on every
     * mutation.
     */
    if (contactInfoCache.has(publicId)) return contactInfoCache.get(publicId);

    const run = (async () => {
      const result = { emails: [], websites: [] };

      // Nothing to open if the address is already on the page — the user may
      // have opened the dialog themselves, or LinkedIn may have inlined it.
      const visible = collectEmails();
      if (visible.length > 0) {
        result.emails = visible;
        return result;
      }

      /*
       * Network routes first, and both at once.
       *
       * They used to run after the dialog-driving route, on the reasoning that
       * the reliable thing should go first. That was the wrong trade. Driving
       * LinkedIn's own UI takes over the page the user is reading — modal opens,
       * scroll locks, focus moves — so putting it first means every profile
       * freezes for a couple of seconds before anything is shown, including the
       * profiles where a plain fetch would have answered instantly and
       * invisibly. Sequentially, the two fetches also cost up to eight seconds
       * between them; in parallel they cost four, and usually a few hundred
       * milliseconds.
       *
       * So: ask quietly, twice, at the same time. Only if neither answers do we
       * touch the page.
       */
      const [viaApi, viaOverlayFetch] = await Promise.all([
        fetchVoyagerContactInfo(publicId),
        fetchOverlayHtml(publicId),
      ]);

      if (viaApi.emails.length > 0) {
        result.emails = viaApi.emails;
        result.websites = viaApi.websites;
        return result;
      }
      // Websites are worth keeping even when the API had no address: they give
      // the finder a company domain to work from.
      result.websites = viaApi.websites;

      if (viaOverlayFetch.length > 0) {
        result.emails = viaOverlayFetch;
        return result;
      }

      // Last resort. Opening a dialog on someone's page is the one thing here
      // that the user can see happening, so it is switchable — off means the
      // quiet routes above are all there is.
      const { autoOpenContactInfo = true } = await chrome.storage.local
        .get({ autoOpenContactInfo: true })
        .catch(() => ({ autoOpenContactInfo: true }));

      if (autoOpenContactInfo) {
        result.emails = await readContactInfoOverlay(publicId);
      }

      return result;
    })();

    contactInfoCache.set(publicId, run);
    run.then(
      (value) => contactInfoSettled.set(publicId, value),
      () => contactInfoSettled.set(publicId, { emails: [], websites: [] })
    );
    return run;
  }

  /**
   * LinkedIn profile pages.
   *
   * Fields come from the DOM; the address comes from the contact-info routes
   * above, because it is never in the DOM until the user opens that dialog.
   *
   * Selectors are deliberately layered: LinkedIn reskins often, and a stale
   * single selector would silently return nothing.
   *
   * Two speeds, and the difference matters more than anything else in this file:
   *
   *  - **fast** (the default) reads the DOM and returns. It awaits nothing that
   *    can take time, so the panel and the popup can paint the person's name,
   *    title and company immediately. If a deep read already ran for this
   *    profile its address is included, straight from the settled cache.
   *  - **deep** additionally waits for the contact-info routes. Only ever run
   *    from a surface that has already shown something, so the wait happens
   *    behind a rendered UI rather than in front of a blank one.
   *
   * Before this split, everything awaited the deep path — which is why a profile
   * sat there doing nothing for seconds before the extension showed any sign of
   * life, and why the page itself felt frozen while that happened.
   *
   * @param {{deep?: boolean}} [options]
   */
  async function scrapeLinkedIn({ deep = false } = {}) {
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
    // contact-info routes gave us. Order matters: a selection the user made
    // beats everything, then the profile's own address.
    const domEmails = collectEmails();
    const contact = deep
      ? await linkedInContactInfo(publicId).catch(() => ({ emails: [], websites: [] }))
      : contactInfoSettled.get(publicId) || { emails: [], websites: [] };

    const emails = [...new Set([...contact.emails, ...domEmails])];

    /*
     * Is there more to come if somebody asks for it?
     *
     * The panel uses this to decide between "no email on this profile" and "still
     * looking" — two very different things to tell somebody, and showing the
     * first while the second is true is what made the extension look broken.
     */
    const pendingContactInfo = !deep && !contactInfoSettled.has(publicId) && emails.length === 0;

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
      contact_info_pending: pendingContactInfo,
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
   * Async for shape, not because it waits: with `deep` false — the default, and
   * what every surface calls first — nothing here awaits anything slower than
   * reading the DOM, so it settles within a tick on every site.
   *
   * @param {{deep?: boolean}} [options]
   * @returns {Promise<object>}
   */
  async function scrape({ deep = false } = {}) {
    const host = location.hostname;
    let result = null;

    if (host.endsWith('linkedin.com')) result = await scrapeLinkedIn({ deep });
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
  /** The same scrape, but willing to wait for LinkedIn's contact info. */
  sincerely.scrapeDeep = () => scrape({ deep: true });
  // The panel's DOM watcher consults this: our own dialog mutates the page, and
  // re-scraping on those mutations would drive it round in circles.
  sincerely.isOverlayBusy = () => overlayBusy;
  sincerely.splitName = splitName;
  sincerely.isPlausibleEmail = isPlausibleEmail;
  sincerely.collectEmails = collectEmails;
  sincerely.ensureShadowRoot = ensureShadowRoot;
  sincerely.showToast = showToast;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    /*
     * Two messages, one handler. SINCERELY_SCRAPE answers from the DOM and
     * returns at once — that is what the popup opens on and what the toolbar
     * badge uses, and neither may ever be blocked behind a network round trip
     * or, worse, a dialog opening on the user's page. SINCERELY_SCRAPE_DEEP is
     * the follow-up, asked only once something is already on screen.
     */
    const deep = message?.type === 'SINCERELY_SCRAPE_DEEP';
    if (!deep && message?.type !== 'SINCERELY_SCRAPE') return false;
    // Returning true keeps the channel open for the async reply below.
    scrape({ deep }).then(sendResponse, () => sendResponse(null));
    return true;
  });

})();

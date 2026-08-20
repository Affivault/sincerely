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

  /**
   * A LinkedIn member profile, as opposed to the feed, search, or a company
   * page. Only here is the page "about one person", which is what makes
   * scoping the email sweep both possible and necessary.
   */
  const ON_LINKEDIN_PROFILE =
    /(^|\.)linkedin\.com$/i.test(location.hostname) && /^\/in\//.test(location.pathname);

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

  /**
   * Screen-reader-only text. LinkedIn's design system clips these off-screen
   * rather than hiding them, so `textContent` picks them up and `innerText`
   * does too — clipping is not `display:none`.
   */
  const SR_ONLY = '.visually-hidden, .a11y-text, .sr-only, .screen-reader-text';

  /**
   * A string that is the same thing twice — "Ada LovelaceAda Lovelace" — is
   * one thing. LinkedIn prints the name once for sighted users and once for
   * screen readers, so this is the exact shape that reaches us when the
   * stripping above misses a variant class name.
   *
   * @param {string} value
   * @returns {string}
   */
  function collapseDoubled(value) {
    const v = String(value || '').trim();
    if (v.length < 4) return v;

    // Joined with no separator: even length, both halves identical.
    if (v.length % 2 === 0) {
      const half = v.length / 2;
      if (v.slice(0, half) === v.slice(half)) return v.slice(0, half).trim();
    }
    // Joined by whitespace, which is what a normalising pass leaves behind.
    const mid = Math.floor(v.length / 2);
    for (const cut of [mid, mid + 1]) {
      const left = v.slice(0, cut).trim();
      const right = v.slice(cut).trim();
      if (left && left === right) return left;
    }
    return v;
  }

  /**
   * Visible text of an element.
   *
   * Not `textContent`: LinkedIn renders the same string twice on profile
   * headings — once in a `span[aria-hidden="true"]` for sighted users, once in
   * a clipped span for screen readers — and `textContent` concatenates both.
   * That is what produced names like "Ada LovelaceAda Lovelace", and the
   * surname of every scraped lead was wrong because of it.
   *
   * @param {Element|null} el
   */
  function text(el) {
    if (!el) return '';

    // Cloned so nothing is removed from the live page; the scraper must never
    // change what the user is looking at.
    let source = el;
    if (el.querySelector && el.querySelector(SR_ONLY)) {
      source = el.cloneNode(true);
      for (const hidden of source.querySelectorAll(SR_ONLY)) hidden.remove();
    }

    const raw = String(source.textContent || '').replace(/\s+/g, ' ').trim();
    return collapseDoubled(raw);
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

    /*
     * On a LinkedIn profile, "everything on the page" is mostly OTHER PEOPLE:
     * People also viewed, the feed rail, suggested connections, and the
     * viewer's own account details in embedded payloads. Sweeping all of it
     * attributed a stranger's address — often the user's own — to whichever
     * profile happened to be open, and wrote it to the contact record.
     *
     * So on a profile the sweep is scoped to the parts that belong to THIS
     * person: the profile body and any open dialog, which on this page means
     * the Contact info overlay.
     */
    const profileScoped = ON_LINKEDIN_PROFILE;
    const scopes = profileScoped
      ? [document.querySelector('main')].filter(Boolean)
      : [document.body].filter(Boolean);

    for (const link of document.querySelectorAll('a[href^="mailto:"]')) {
      // A mailto in the sidebar is somebody else's.
      if (profileScoped && !scopes.some((scope) => scope.contains(link))
        && !link.closest('[role="dialog"], .artdeco-modal')) continue;
      const href = link.getAttribute('href').slice('mailto:'.length);
      // A malformed %-escape throws; one bad mailto: shouldn't blank the
      // whole scrape (name, company, title, every other candidate email).
      let raw;
      try {
        raw = decodeURIComponent(href).split('?')[0];
      } catch {
        raw = href.split('?')[0];
      }
      const email = (raw.match(EMAIL_PATTERN) || [])[0];
      if (email && isPlausibleEmail(email.toLowerCase())) found.add(email.toLowerCase());
    }

    // Gmail and several CRMs stash the real address in an attribute. Same
    // scoping rule: on a profile, an attribute outside the profile body
    // belongs to somebody else.
    for (const node of document.querySelectorAll('[email], [data-email]')) {
      if (profileScoped && !scopes.some((scope) => scope.contains(node))
        && !node.closest('[role="dialog"], .artdeco-modal')) continue;
      const value = (node.getAttribute('email') || node.getAttribute('data-email') || '').toLowerCase();
      if (EMAIL_TEST.test(value) && isPlausibleEmail(value)) found.add(value);
    }

    /*
     * Anything in an open dialog, before the capped body sweep.
     *
     * A modal is appended at the end of the document, so its text lands at the
     * *end* of innerText — past the 60k cap on a long profile. That is the
     * literal case of "the email is on my screen and it says there is none":
     * the user had opened Contact info themselves and the sweep never reached
     * it. Dialogs are small and few, so they are read in full.
     */
    for (const dialog of document.querySelectorAll('[role="dialog"], .artdeco-modal')) {
      for (const hit of (dialog.innerText || '').match(EMAIL_PATTERN) || []) {
        const email = hit.toLowerCase();
        if (isPlausibleEmail(email)) found.add(email);
      }
    }

    // Text sweep last, and capped — innerText on a huge page is expensive and
    // the tail end is almost always footer noise. Scoped to the profile body
    // on LinkedIn, for the reason above; the whole page everywhere else,
    // where a page is about one thing.
    for (const scope of scopes) {
      const body = (scope.innerText || '').slice(0, 60000);
      for (const match of body.match(EMAIL_PATTERN) || []) {
        const email = match.toLowerCase();
        if (isPlausibleEmail(email)) found.add(email);
        if (found.size > 25) break;
      }
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

  /** Page names that are not people, however name-shaped they look. */
  const PAGE_TITLE_NOISE =
    /^(contact info|feed|messaging|notifications|my network|jobs|search|linkedin|home|sign ?up|log ?in)$/i;

  /**
   * The profile's name, taken from the document title.
   *
   * The last line of defence, and the only one that survives the deep read:
   * opening Contact info pushes a new route, LinkedIn re-renders, and the
   * profile heading leaves the DOM entirely — but the tab still says who this
   * is. Without this, a profile whose first read happened while the overlay
   * was already open had no name available anywhere.
   *
   * Conservative by design. Anything that doesn't look like a person's name is
   * rejected rather than guessed at: a wrong name is worse than none.
   *
   * @param {string} [title]
   * @returns {string}
   */
  function nameFromDocumentTitle(title = document.title) {
    let t = String(title || '')
      .replace(/^\(\d+\+?\)\s*/, '')            // "(20) " unread badge
      .replace(/\s*[|·]\s*LinkedIn\s*$/i, '')
      .trim();
    // Older titles read "Name - Title - Company".
    if (t.includes(' - ')) t = t.split(' - ')[0].trim();

    if (!t || t.length > 60) return '';
    if (PAGE_TITLE_NOISE.test(t)) return '';
    if (/[@\/]|https?:/i.test(t)) return '';

    const words = t.split(/\s+/);
    if (words.length < 2 || words.length > 5) return '';
    // Every word starts with a letter — \p{L}, not \w, so "Björn Åkesson"
    // and non-Latin names are not thrown away.
    if (!words.every((w) => /^\p{L}/u.test(w))) return '';
    return t;
  }

  /**
   * Who this profile is, remembered across reads.
   *
   * The deep read opens LinkedIn's Contact info overlay to find an address.
   * While that overlay is up the profile's own heading is no longer in the
   * DOM, so re-reading the page at that moment returns an empty name, an
   * empty company and an empty title. The lead was then saved with an email
   * and nothing else — the name that had been on screen a second earlier was
   * simply gone.
   *
   * Identity is therefore captured on the first (fast) read and only ever
   * filled in, never blanked: a later read that finds nothing keeps what is
   * already known.
   */
  const identityByProfile = new Map();

  /**
   * @param {string} publicId
   * @param {{name: string, headline: string, company: string, jobTitle: string}} found
   * @returns {{name: string, headline: string, company: string, jobTitle: string}}
   */
  function rememberIdentity(publicId, found) {
    const known = identityByProfile.get(publicId)
      || { name: '', headline: '', company: '', jobTitle: '' };
    for (const key of ['name', 'headline', 'company', 'jobTitle']) {
      const value = String(found[key] || '').trim();
      // Only ever an upgrade. An empty read means the overlay is open, not
      // that the profile has no name.
      if (value && !known[key]) known[key] = value;
    }
    identityByProfile.set(publicId, known);
    evictOldest(identityByProfile, 20);
    return known;
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
    if (depth > 12 || found.size > 10) return found;
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

  /**
   * This content script lives for the whole tab session (SPA navigation never
   * reloads it), so a long prospecting run visiting hundreds of profiles would
   * otherwise grow both caches without bound. Evict the oldest entry — Map
   * preserves insertion order — once a cache passes this size.
   */
  const CONTACT_INFO_CACHE_LIMIT = 300;
  /** Works on a Map or a Set: both preserve insertion order and expose keys(). */
  function evictOldest(map, limit) {
    while (map.size > limit) {
      map.delete(map.keys().next().value);
    }
  }

  /**
   * How long to wait for LinkedIn to draw the Contact info link before deciding
   * the profile hasn't got one.
   *
   * This constant is the whole bug, in one number that used to be zero.
   *
   * Content scripts run at `document_idle`, which on a LinkedIn profile is well
   * before the top card exists — it is rendered client-side, after hydration,
   * and on a slow connection that is seconds later. The old code looked for the
   * anchor once, at the first possible moment, found nothing, and concluded the
   * profile had no contact info. The anchor is of course there: it is the link
   * the user clicks themselves.
   */
  const CONTACT_INFO_TRIGGER_WAIT_MS = 8000;

  /**
   * Once the profile itself has rendered, how much longer the link gets.
   *
   * Waiting the full deadline on every profile would mean eight seconds of
   * "still looking" on everyone whose contact info simply isn't shared with the
   * viewer — which is a lot of people, and is the sort of dead waiting that made
   * this feel slow before. A top card that has arrived without the link is the
   * signal that there isn't one; this is the benefit of the doubt on top.
   */
  const CONTACT_INFO_TRIGGER_GRACE_MS = 2000;

  /**
   * Failures are allowed to be retried; successes are not re-fetched.
   *
   * The previous version cached *both* for the life of the page, which is what
   * made every earlier fix to the routes pointless. One empty result — from a
   * read that ran before the profile had rendered — was remembered forever, so
   * none of those routes ever got a second chance no matter how good they were.
   * A profile is asked again on the next scrape, a few times, before we accept
   * that there is genuinely nothing there.
   */
  const CONTACT_INFO_ATTEMPTS = 3;
  const contactInfoAttempts = new Map();

  /**
   * Profiles whose answer is settled for good — nothing more to try.
   *
   * The retry above exists for exactly one situation: a read that ran before
   * LinkedIn had drawn the profile. Once the profile *is* drawn and a full read
   * has still found nothing, asking again cannot produce a different answer, and
   * doing it anyway is what puts the panel back into "Checking contact info…"
   * every few seconds on everyone whose address simply isn't shared. So the
   * retry is spent on the case it was written for and no other.
   */
  const contactInfoFinal = new Set();

  /** Has LinkedIn drawn the profile itself yet? `main h1` is the person's name. */
  function profileRendered() {
    return Boolean(document.querySelector('main h1'));
  }

  function attemptsSoFar(publicId) {
    return contactInfoAttempts.get(publicId) || 0;
  }

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
    /*
     * Every selector here identifies the control structurally — by href, or by
     * an id LinkedIn assigns to this one link. None of them match on visible
     * text, which is what made the earlier version click Message or Connect:
     * LinkedIn's buttons carry nested visually-hidden text and the label is
     * translated on non-English accounts.
     *
     * Widened because relying on the href alone meant that any layout not
     * rendering that anchor left no way into the overlay at all.
     */
    const candidates = [
      ...document.querySelectorAll(
        [
          'a[href*="/overlay/contact-info"]',
          '#top-card-text-details-contact-info',
          'a[data-control-name="contact_see_more"]',
          'a[id*="contact-info" i]',
          'button[id*="contact-info" i]',
        ].join(',')
      ),
    ];

    const mine = candidates.filter((node) => {
      const href = node.getAttribute('href') || '';
      if (!href) return true;
      // "People also viewed" and similar carry other people's overlay links.
      // Only this profile's slug is ours to open.
      const slug = href.match(/\/in\/([^/?#]+)/);
      return !slug || decodeURIComponent(slug[1]) === publicId;
    });

    // The top card's link is the canonical one where several match.
    return mine.find((node) => node.closest('main')) || mine[0] || null;
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
  /**
   * The Contact info link, waited for rather than looked for once.
   *
   * @param {string} publicId
   * @returns {Promise<Element|null>}
   */
  async function waitForContactInfoTrigger(publicId) {
    // Already rendered — the common case on a profile that has been open a
    // moment, and the only case the old code handled.
    const present = contactInfoTrigger(publicId);
    if (present) return present;

    /*
     * Otherwise wait for either the link or the profile around it, whichever
     * lands first. `main h1` is the person's name: if that is on screen the
     * profile has rendered, so a missing link means this viewer doesn't get one
     * rather than that it hasn't arrived yet.
     */
    const settled = await waitFor(
      () => contactInfoTrigger(publicId) || (document.querySelector('main h1') ? 'rendered' : null),
      CONTACT_INFO_TRIGGER_WAIT_MS
    );

    if (!settled) return null;
    if (settled !== 'rendered') return settled;
    return waitFor(() => contactInfoTrigger(publicId), CONTACT_INFO_TRIGGER_GRACE_MS);
  }

  async function readContactInfoOverlay(publicId) {
    /*
     * Find the way in *before* touching the page.
     *
     * Two reasons, and the first is the fix. LinkedIn renders the top card after
     * document_idle, so the link is reliably absent at the moment this used to
     * look for it — waiting for it is the difference between "this profile has
     * no contact info" and reading it without a click.
     *
     * The second is why the wait happens here rather than inside the opener:
     * everything below installs a stylesheet that hides dialogs and overrides
     * LinkedIn's scroll lock. Waiting with that already in place would suppress
     * LinkedIn's own modals, and unlock its scrolling, for the whole wait.
     */
    const trigger = await waitForContactInfoTrigger(publicId);

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

    /** @type {'click'|'router'|null} */
    let openedBy = null;

    try {
      openedBy = openContactInfoOverlay(publicId, trigger);
      if (!openedBy) return [];

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

      if (!modal) {
        /*
         * No dialog where we expected one — but opening the overlay makes
         * LinkedIn *fetch* the contact info regardless of what it does with the
         * markup, and the response lands in the document's embedded payloads.
         * Reading that is independent of every class name and every layout
         * variant, which is exactly what kept failing before.
         *
         * One settle-and-check rather than a poll: scanning the payloads means
         * JSON.parsing every `code` block in the document, which on a real
         * profile is far too heavy to run fifteen times over a second and a half.
         */
        await new Promise((resolve) => setTimeout(resolve, 600));
        // The tap does not need the dialog to have rendered — only for LinkedIn
        // to have fetched, which opening the overlay makes it do.
        return [...new Set([...netEmails, ...emailsFromEmbeddedPayloads()])];
      }

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
        const href = link.getAttribute('href').slice(7);
        // A malformed %-escape throws; one bad mailto: shouldn't discard
        // everything already gathered and skip the dismiss(modal) below.
        let raw;
        try {
          raw = decodeURIComponent(href);
        } catch {
          raw = href;
        }
        const address = raw.split('?')[0].toLowerCase();
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

      // Belt and braces: whatever the modal rendered, take what LinkedIn
      // fetched too. Costs nothing and survives a markup change.
      for (const address of emailsFromEmbeddedPayloads()) found.add(address);
      for (const address of netEmails) found.add(address);

      dismiss(modal);
      let closed = await waitFor(() => !modal.isConnected, 1500);

      /*
       * If the dismiss button did not take, try Escape before giving up.
       *
       * This matters because the hiding stylesheet is removed in the `finally`
       * below: a dialog we opened and failed to close does not stay invisible,
       * it becomes a modal the user never asked for, sitting over the profile
       * they were reading. `dismiss` only falls back to Escape when there was
       * no button to click at all, which is the rarer case.
       */
      if (!closed) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })
        );
        closed = await waitFor(() => !modal.isConnected, 1000);
      }

      // Still there: remove it ourselves rather than leave it on screen. We
      // opened it, so it is ours to clear up.
      if (!closed && modal.isConnected) {
        modal.remove();
        document.querySelector('.artdeco-modal-overlay')?.remove();
      }

      /*
       * Dismissing usually pops the history entry LinkedIn pushed, but
       * history.back() is asynchronous — the URL is still the overlay's for a
       * moment afterwards. Checking too early and "helpfully" going back again
       * takes the user off the profile entirely, one entry further back than
       * they ever were. So wait for the URL to settle, and only step back if it
       * genuinely didn't.
       */
      return [...found];
    } catch {
      return [];
    } finally {
      /*
       * Restoring the address bar belongs here, not on the happy path.
       *
       * When the overlay is opened by pushing its URL and no dialog appears,
       * the read returns early — and a restore placed after the modal handling
       * never ran, leaving the page parked on the overlay URL. The panel's own
       * SPA watcher then saw a changed URL, remounted, scraped again, pushed
       * again: a loop, from a single missed cleanup path.
       */
      await restoreUrl(wasAt, openedBy);
      style.remove();
      overlayBusy = false;
    }
  }

  /**
   * Put the address bar back after driving the overlay.
   *
   * @param {string} wasAt Where the user actually was.
   * @param {'click'|'router'|null} openedBy
   */
  async function restoreUrl(wasAt, openedBy) {
    if (location.href === wasAt) return;

    /*
     * Give whoever else might pop it a moment first. LinkedIn's own dismiss
     * handler calls history.back(), and so does ours — going back twice takes
     * the user off the profile entirely, one entry further than they ever were.
     * A short grace is enough to see that happen; a long one is dead time.
     */
    if (await waitFor(() => location.href === wasAt, openedBy === 'router' ? 400 : 1000)) return;

    /*
     * Only ever step back while still parked on the overlay URL. That check —
     * not "did we push it" — is what makes a double-back impossible: once the
     * address bar is anywhere else, going back is somebody else's history.
     */
    if (/overlay\/contact-info/.test(location.href)) {
      history.back();
      if (await waitFor(() => location.href === wasAt, 1000)) return;
    }

    /*
     * Last resort, and deliberately not another history.back(). Rewriting the
     * address bar in place restores what they were looking at without touching
     * their history.
     */
    if (location.href !== wasAt && /^https?:/.test(location.href)) {
      history.replaceState(history.state, '', wasAt);
    }
  }

  /* ---------------------------------------------------------------- */
  /* What LinkedIn's own traffic gave up                              */
  /* ---------------------------------------------------------------- */

  /**
   * Addresses seen in LinkedIn's own API responses, newest first.
   *
   * Filled by content/net-tap.js, which runs in the page's world and reads what
   * LinkedIn itself receives. This is the one route that depends on no markup,
   * no class name, no endpoint path and no element to click — so it is the one
   * that keeps working when everything else has been renamed.
   *
   * @type {string[]}
   */
  let netEmails = [];

  window.addEventListener('message', (event) => {
    // Same-window only, and only our own channel.
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'SINCERELY_NET_EMAILS' || !Array.isArray(data.emails)) return;

    for (const raw of data.emails) {
      const email = String(raw || '').toLowerCase();
      if (!EMAIL_TEST.test(email) || !isPlausibleEmail(email)) continue;
      if (!netEmails.includes(email)) netEmails.unshift(email);
    }
    // A prospecting session visits a lot of profiles; this is a cache, not a log.
    if (netEmails.length > 20) netEmails.length = 20;
  });

  /**
   * Reset on navigation. Addresses captured on one profile must never be
   * offered as another's — a wrong address is far worse than none.
   */
  function forgetNetEmails() {
    netEmails = [];
  }

  /** Which profile netEmails belongs to, so a navigation can be detected. */
  let netEmailsProfile = null;

  /**
   * Route 0: LinkedIn's own embedded API payloads.
   *
   * LinkedIn is an Ember app that ships its API responses inside the document,
   * in `<code id="bpr-guid-…">` elements holding JSON. Anything the page has
   * already fetched — including contact info, once the overlay has been opened
   * in this session — is sitting there in the markup.
   *
   * Free, instant, invisible, and it needs no endpoint, no CSRF token and no
   * element to click, which is why it goes first. It is also the only route
   * that keeps working when LinkedIn renames things, because it reads whatever
   * LinkedIn itself decided to embed.
   *
   * @returns {string[]}
   */
  /**
   * Addresses that were already embedded in the page before anyone asked
   * about this profile — LinkedIn's own bootstrap, which carries the SIGNED-IN
   * member's account details.
   *
   * Taken once, on load, and subtracted from every later read. Without it, a
   * profile with no published email came back with the viewer's own address
   * and wrote it to the lead: every prospect in the list ended up being you.
   *
   * Snapshotting rather than trying to identify "the viewer's email" is
   * deliberate — it needs no knowledge of LinkedIn's payload shape, so it
   * cannot be broken by a rename.
   */
  let ambientEmails = null;
  /**
   * Which profile the snapshot belongs to. LinkedIn is a single-page app, so
   * without this the address fetched for the person you looked at a minute ago
   * is still sitting in the payloads and reads as "fresh" on the next profile
   * — attributing one prospect's email to another, which is worse than
   * attributing none.
   */
  let ambientPath = null;

  function ambientEmailSnapshot() {
    // Keyed on the profile, not the path: the deep read pushes an overlay route
    // onto the same person, and re-snapshotting there would capture the
    // address LinkedIn had just fetched and then subtract it as "ambient".
    const key = linkedInPublicId() || location.pathname;
    if (ambientEmails && ambientPath === key) return ambientEmails;
    ambientPath = key;
    ambientEmails = new Set(scanEmbeddedPayloads());
    return ambientEmails;
  }

  /** The raw scan. `emailsFromEmbeddedPayloads` is this, minus the ambient set. */
  function scanEmbeddedPayloads() {
    const found = new Set();
    // `code` is the documented carrier; the id prefix varies by release, so
    // every `code` block is considered and non-JSON ones simply fail to parse.
    for (const node of document.querySelectorAll('code')) {
      const raw = node.textContent || '';
      // Cheap reject before paying for JSON.parse on a large blob.
      if (!raw || raw.length > 400000 || raw.indexOf('@') === -1) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      for (const email of emailsInJson(parsed)) {
        if (isPlausibleEmail(email)) found.add(email);
      }
      if (found.size > 5) break;
    }
    return [...found];
  }

  /**
   * What LinkedIn fetched for THIS profile: everything in the payloads now,
   * less whatever was already there when the page loaded.
   * @returns {string[]}
   */
  function emailsFromEmbeddedPayloads() {
    const ambient = ambientEmailSnapshot();
    return scanEmbeddedPayloads().filter((email) => !ambient.has(email));
  }

  /**
   * Open the Contact info overlay without needing a button to click.
   *
   * This is the fix for the complaint that kept coming back: the extension
   * found nothing unless the user opened Contact info themselves. The reason
   * was that opening it depended entirely on locating one specific anchor in
   * LinkedIn's markup, and when that anchor was absent — a layout variant, a
   * profile that renders the link differently — there was no way in at all, so
   * the address was reported as missing when it plainly existed.
   *
   * LinkedIn's router opens that overlay in response to the *URL*. Pushing the
   * overlay path and firing a popstate makes LinkedIn open its own dialog, with
   * its own data fetch, using nothing but a route it already owns. No element
   * has to exist, nothing gets clicked, and there is no text to match — so it
   * cannot click the wrong control, which was the previous failure in the other
   * direction.
   *
   * @param {string} publicId
   * @param {Element|null} [resolved] The anchor, already waited for by the
   *   caller. Passed in rather than looked up here because the wait has to
   *   happen before the caller hides the page's dialogs — see
   *   `readContactInfoOverlay`. Looked up directly when absent.
   * @returns {'click'|'router'|null} How it got in, so the restore can be exact.
   */
  function openContactInfoOverlay(publicId, resolved) {
    const trigger = resolved || contactInfoTrigger(publicId);
    if (trigger) {
      trigger.click();
      return 'click';
    }

    try {
      const overlayUrl = `/in/${encodeURIComponent(publicId)}/overlay/contact-info/`;
      history.pushState({}, '', overlayUrl);
      // Ember and every other history router listens for this. Dispatched on
      // the shared window, so the page's own listeners receive it.
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      return 'router';
    } catch {
      return null;
    }
  }

  /**
   * Route 2: the legacy REST endpoint the overlay used to call.
   *
   * Same-origin and invisible, so it is cheap to try, but it is a legacy path:
   * LinkedIn has moved this behind GraphQL with rotating query ids, so on most
   * accounts it now answers 404 and contributes nothing. Kept because it costs
   * one parallel request and still works on some sessions — but nothing here
   * depends on it, which was the mistake before.
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
     * quiet click and the page visibly thrashing.
     *
     * What it must *not* do is remember a failure forever, which is what it used
     * to do and what made this feature look permanently broken. The first read
     * of a profile happens before LinkedIn has rendered it; that read found
     * nothing, the nothing was cached, and no route below — however good — was
     * ever run again for that profile. The address only ever appeared when the
     * user opened Contact info by hand, which is precisely the complaint.
     *
     * So: an answer is kept, an empty result is kept only until the next ask,
     * and a profile that has come back empty this many times is accepted as
     * having nothing rather than being reopened on every mutation for the life
     * of the tab.
     */
    const inFlight = contactInfoCache.get(publicId);
    if (inFlight) return inFlight;

    const previous = contactInfoSettled.get(publicId);
    if (previous && contactInfoFinal.has(publicId)) return previous;

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
       * Then whatever LinkedIn's own traffic already handed over. Free, and
       * independent of every class name and endpoint path — on a profile whose
       * payload carries the address, this is the whole answer with nothing
       * opened and nothing clicked.
       */
      if (netEmails.length > 0) {
        result.emails = [...netEmails];
        return result;
      }

      /*
       * Then LinkedIn's own embedded payloads, before any network call. Costs
       * nothing, touches nothing, and on a profile whose contact info has
       * already been fetched in this session it simply has the answer.
       */
      const embedded = emailsFromEmbeddedPayloads();
      if (embedded.length > 0) {
        result.emails = embedded;
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
    evictOldest(contactInfoCache, CONTACT_INFO_CACHE_LIMIT);
    contactInfoAttempts.set(publicId, attemptsSoFar(publicId) + 1);
    evictOldest(contactInfoAttempts, CONTACT_INFO_CACHE_LIMIT);

    const settle = (value) => {
      contactInfoSettled.set(publicId, value);
      evictOldest(contactInfoSettled, CONTACT_INFO_CACHE_LIMIT);
      /*
       * Is there any point asking again?
       *
       * Only when the read came back empty *and* the profile still had not
       * rendered — that is the early-read case the retry exists for. An address
       * found, a profile that rendered, or a spent budget all mean this is the
       * answer, and the entry stays cached so nothing reopens the dialog.
       */
      const worthRetrying =
        value.emails.length === 0 &&
        !profileRendered() &&
        attemptsSoFar(publicId) < CONTACT_INFO_ATTEMPTS;

      if (worthRetrying) {
        if (contactInfoCache.get(publicId) === run) contactInfoCache.delete(publicId);
      } else {
        contactInfoFinal.add(publicId);
        evictOldest(contactInfoFinal, CONTACT_INFO_CACHE_LIMIT);
      }
    };

    run.then(settle, () => settle({ emails: [], websites: [] }));
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

    // netEmails is a flat, unkeyed list — an address net-tap captured for the
    // last profile must not be offered as this one's the moment the SPA
    // navigates to a new person.
    if (netEmailsProfile !== publicId) {
      netEmailsProfile = publicId;
      forgetNetEmails();
    }

    const rawName = firstText([
      'main h1',
      '.pv-text-details__left-panel h1',
      '.text-heading-xlarge',
      'h1',
    ]);

    const rawHeadline = firstText([
      '.text-body-medium.break-words',
      '.pv-text-details__left-panel .text-body-medium',
      'main .text-body-medium',
    ]);

    // The top card's current-company button is the most reliable company
    // signal; the experience section is the fallback.
    let rawCompany = firstText([
      'button[aria-label^="Current company"] .pv-text-details__right-panel-item-text',
      '.pv-text-details__right-panel-item-text',
      '[data-field="experience_company_logo"] + div span[aria-hidden="true"]',
    ]);

    // Headlines are overwhelmingly "Title at Company".
    let rawJobTitle = rawHeadline;
    const atMatch = rawHeadline.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
    if (atMatch) {
      rawJobTitle = atMatch[1].trim();
      if (!rawCompany) rawCompany = atMatch[2].trim();
    }

    /*
     * Fold this read into what is already known about the profile. On the deep
     * pass the Contact info overlay is open and every selector above comes
     * back empty; taking that at face value is what stripped the name off a
     * lead the moment its email was found.
     */
    const identity = rememberIdentity(publicId, {
      // The title is the fallback that outlives the overlay.
      name: rawName || nameFromDocumentTitle(),
      headline: rawHeadline,
      company: rawCompany,
      jobTitle: rawJobTitle,
    });
    const name = identity.name;
    const company = identity.company;
    const jobTitle = identity.jobTitle;

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
    /*
     * "More to come if somebody asks" now includes a profile that has been asked
     * and came back empty, while retries remain. That is not pedantry: the panel
     * only starts a deep read when this is true, so the old version — false the
     * instant one empty result settled — is what stopped the retry from ever
     * being attempted, no matter how many mutations later the page rendered.
     */
    const pendingContactInfo = !deep && emails.length === 0 && !contactInfoFinal.has(publicId);

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
      /*
       * Built from the slug, never from the live path. The deep read pushes
       * /in/<id>/overlay/contact-info/ before reading, so anything taken from
       * location at that moment saved a URL that is not the person's profile.
       */
      linkedin_url: `${location.origin}/in/${encodeURIComponent(publicId)}`,
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
    // The last fallback stays scoped to `.gs` (the sender header block) too —
    // an unscoped `span[email]` also matches To/CC/BCC recipient chips in an
    // open reply/forward compose box, which would attribute a recipient's
    // address to "the sender" whenever those chips render before the header.
    const senderNode =
      document.querySelector('.gs .gD[email]') ||
      document.querySelector('h3.iw span[email]') ||
      document.querySelector('.gs span[email]:not([email=""])');

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
  sincerely.forgetNetEmails = forgetNetEmails;
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

  /*
   * Take the ambient snapshot now, while the page holds only what LinkedIn
   * embedded at load. Waiting until the first read would fold this profile's
   * own fetched address into the "ignore" set — the snapshot is only
   * meaningful if it is taken before anybody asks about this person.
   */
  if (ON_LINKEDIN_PROFILE) ambientEmailSnapshot();

})();

/**
 * Reads LinkedIn's own API responses, in the page's world.
 *
 * Everything else this extension has tried to do for contact info depends on
 * LinkedIn's markup or its endpoints: find the anchor, open the dialog, read the
 * modal, call the endpoint the modal calls. All of it breaks when LinkedIn
 * renames a class, moves a route, or renders a layout variant — and it has,
 * repeatedly, which is why the address kept coming back as "not found" on
 * profiles that plainly had one.
 *
 * This does not care about any of that. It patches `fetch` and `XMLHttpRequest`
 * before LinkedIn's own code runs, and reads whatever LinkedIn itself receives.
 * If the address is in any response the page gets — the initial profile payload,
 * the contact-info fetch, anything — it is seen, with no element to find, no
 * dialog to open and nothing to click.
 *
 * It runs in the MAIN world because that is the only place LinkedIn's `fetch`
 * exists; a content script's isolated world has its own copy that LinkedIn never
 * calls. Findings are handed to the isolated world by postMessage, which is the
 * one channel that crosses that boundary.
 *
 * Scope: it observes responses the user's own session is already receiving, on
 * linkedin.com only, and passes on nothing but email addresses. It sends
 * nothing anywhere and holds no credentials.
 */

(() => {
  if (window.__sincerelyNetTap) return;
  window.__sincerelyNetTap = true;

  const CHANNEL = 'SINCERELY_NET_EMAILS';
  const EMAIL = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

  /** Role accounts and LinkedIn's own infrastructure addresses. */
  const NOISE =
    /^(no-?reply|do-?not-?reply|postmaster|mailer-daemon|abuse|support|info|hello|admin|webmaster|notifications?|bounce|messages-noreply|invitations|jobs-listings|inmail-hit-reply|updates|security|linkedin)@/i;

  /** LinkedIn's own domains — never a prospect's address. */
  const OWN = /@(linkedin|licdn)\.com$/i;

  /**
   * Only responses that could plausibly carry profile data, and only ones small
   * enough to be worth scanning. LinkedIn ships megabytes of tracking and asset
   * traffic that would be pure cost to read.
   *
   * @param {string} url
   */
  function worthReading(url) {
    if (typeof url !== 'string') return false;
    if (!/linkedin\.com/i.test(url) && !url.startsWith('/')) return false;
    return /\/voyager\/|\/graphql|profile|contact|identity/i.test(url);
  }

  /** @param {string} text @returns {string[]} */
  function emailsIn(text) {
    if (!text || text.length > 2_000_000 || text.indexOf('@') === -1) return [];
    const found = new Set();
    for (const raw of text.match(EMAIL) || []) {
      const email = raw.toLowerCase();
      if (NOISE.test(email) || OWN.test(email)) continue;
      if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(email)) continue;
      found.add(email);
      if (found.size > 8) break;
    }
    return [...found];
  }

  /**
   * Hand findings to the isolated world.
   *
   * Same-window postMessage: the extension's content script listens for it, and
   * so could LinkedIn, which is why nothing but addresses already present in
   * their own response goes across.
   *
   * @param {string[]} emails
   * @param {string} url
   */
  function publish(emails, url) {
    if (emails.length === 0) return;
    window.postMessage({ type: CHANNEL, emails, url: String(url).slice(0, 300) }, window.location.origin);
  }

  /* ---- fetch ---- */

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function patchedFetch(...args) {
      const url = args[0] instanceof Request ? args[0].url : args[0];
      const promise = nativeFetch.apply(this, args);

      if (worthReading(url)) {
        promise
          .then((response) => {
            // Never consume the caller's body: clone, or LinkedIn's own code
            // gets an already-read stream and the page breaks.
            const copy = response.clone();
            return copy.text().then((text) => publish(emailsIn(text), url));
          })
          .catch(() => {
            // A failed read is not our business to surface.
          });
      }

      return promise;
    };
  }

  /* ---- XMLHttpRequest ---- */

  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    this.__sincerelyUrl = url;
    return nativeOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    if (worthReading(this.__sincerelyUrl)) {
      this.addEventListener('load', () => {
        try {
          // responseText throws on some responseTypes; that is fine, skip it.
          const text = this.responseType === '' || this.responseType === 'text' ? this.responseText : '';
          publish(emailsIn(text), this.__sincerelyUrl);
        } catch {
          // Not readable in this form.
        }
      });
    }
    return nativeSend.apply(this, args);
  };
})();

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

  const EMAIL_PATTERN = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

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
      if (EMAIL_PATTERN.test(value) && isPlausibleEmail(value)) found.add(value);
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

  /**
   * LinkedIn profile pages.
   *
   * LinkedIn almost never exposes an email address, so this adapter's job is
   * the *other* fields — name, company, title, profile URL. The popup then
   * matches an existing contact by name, or takes an address the user pastes.
   *
   * Selectors are deliberately layered: LinkedIn reskins often, and a stale
   * single selector would silently return nothing.
   */
  function scrapeLinkedIn() {
    const isProfile = /\/in\//.test(location.pathname);
    if (!isProfile) return null;

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

    const emails = collectEmails();

    return {
      ...splitName(name),
      full_name: name || null,
      email: emailFromSelection() || emails[0] || null,
      email_candidates: emails,
      company: company || null,
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
   * @returns {object}
   */
  function scrape() {
    const host = location.hostname;
    let result = null;

    if (host.endsWith('linkedin.com')) result = scrapeLinkedIn();
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
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .pill {
        position: fixed; right: 20px; bottom: 20px;
        display: inline-flex; align-items: center; gap: 8px;
        padding: 10px 14px; border: 0; border-radius: 999px;
        background: #1f2937; color: #fff; font-size: 13px; font-weight: 600;
        box-shadow: 0 6px 20px rgba(0,0,0,.28); cursor: pointer;
        max-width: 320px;
      }
      .pill:hover { background: #111827; }
      .pill:disabled { opacity: .6; cursor: default; }
      .pill .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .toast {
        position: fixed; right: 20px; bottom: 74px;
        max-width: 340px; padding: 12px 14px; border-radius: 10px;
        background: #111827; color: #f9fafb; font-size: 13px; line-height: 1.45;
        box-shadow: 0 8px 24px rgba(0,0,0,.32);
      }
      .toast.error { background: #7f1d1d; }
      .toast.success { background: #14532d; }
      .toast .row { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
      .toast button {
        border: 1px solid rgba(255,255,255,.35); background: transparent; color: inherit;
        border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer;
      }
      .toast button:hover { background: rgba(255,255,255,.12); }
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

  /**
   * A one-click "add to the campaign I'm working out of" button.
   *
   * Only rendered once a campaign has been chosen in the popup, and it names
   * that campaign — enrolling someone into a live sequence shouldn't be
   * possible without knowing which one. The result toast offers an undo.
   */
  async function renderPill() {
    if (!/^(www\.)?linkedin\.com$|^mail\.google\.com$/.test(location.hostname)) return;

    const { lastCampaignId = null, cachedCampaigns = [] } = await chrome.storage.local.get({
      lastCampaignId: null,
      cachedCampaigns: [],
    });
    const campaign = cachedCampaigns.find((c) => c.id === lastCampaignId);

    const root = ensureShadowRoot();
    root.querySelector('.pill')?.remove();
    if (!campaign) return;

    const person = scrape();
    if (!person?.email) return;

    const button = document.createElement('button');
    button.className = 'pill';
    button.innerHTML = '<span aria-hidden="true">+</span>';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = `Add to ${campaign.name}`;
    button.appendChild(label);
    button.title = `Add ${person.email} to "${campaign.name}"`;

    button.addEventListener('click', async () => {
      button.disabled = true;
      label.textContent = 'Adding…';

      const response = await chrome.runtime.sendMessage({
        type: 'ADD_TO_CAMPAIGN',
        payload: { campaignId: campaign.id, person },
      });

      button.disabled = false;
      label.textContent = `Add to ${campaign.name}`;

      if (!response?.ok) {
        showToast(response?.error?.message || 'Something went wrong.', { variant: 'error', timeout: 9000 });
        return;
      }

      const { added, skipped, contactId } = response.data;
      if (added > 0) {
        showToast(`${person.email} added to "${campaign.name}".`, {
          variant: 'success',
          actionLabel: 'Undo',
          onAction: async () => {
            const undo = await chrome.runtime.sendMessage({
              type: 'REMOVE_FROM_CAMPAIGN',
              payload: { campaignId: campaign.id, contactId },
            });
            showToast(
              undo?.ok ? `Removed ${person.email} from "${campaign.name}".` : undo?.error?.message || 'Undo failed.',
              { variant: undo?.ok ? undefined : 'error' }
            );
          },
        });
      } else {
        showToast(
          `${person.email} was already enrolled in "${campaign.name}"${skipped ? ` (${skipped} skipped)` : ''}.`,
          { timeout: 7000 }
        );
      }
    });

    root.appendChild(button);
  }

  /* ---------------------------------------------------------------- */
  /* Wiring                                                           */
  /* ---------------------------------------------------------------- */

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'SINCERELY_SCRAPE') return false;
    try {
      sendResponse(scrape());
    } catch {
      sendResponse(null);
    }
    return true;
  });

  // LinkedIn and Gmail are SPAs: the document never reloads, so re-render the
  // button on URL changes. Polling the URL is crude but far cheaper and more
  // reliable than observing their mutation-heavy DOM trees.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      renderPill().catch(() => {});
    }
  }, 1500);

  renderPill().catch(() => {});
})();

/**
 * Row selection on LinkedIn list pages.
 *
 * The other half of what Apollo does: a search or a company's People tab is a
 * list of prospects, and working it one profile at a time is the difference
 * between a tool you use and a tool you demo.
 *
 * Apollo's "Net New" means "not already in my database". Ours means something
 * stricter and more useful — not already *being emailed*. A duplicate contact
 * is untidy; a second sequence landing on someone mid-conversation is the thing
 * that costs a reply.
 *
 * Classic script sharing window.__sincerely with the scraper and the panel.
 */

(() => {
  if (window.__sincerelyListLoaded) return;
  window.__sincerelyListLoaded = true;

  const sincerely = (window.__sincerely = window.__sincerely || {});

  const BAR_ID = 'sincerely-bulk-host';
  const MARK = 'data-sincerely-row';

  /** List pages worth decorating. */
  function isListPage() {
    const { hostname, pathname } = location;
    if (!hostname.endsWith('linkedin.com')) return false;
    return (
      /^\/search\/results\/(people|all)/.test(pathname) ||
      /^\/company\/[^/]+\/people/.test(pathname) ||
      /^\/mynetwork\//.test(pathname)
    );
  }

  /* ---------------------------------------------------------------- */
  /* Reading rows                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Find the result rows on the page.
   *
   * Layered like the profile selectors, and for the same reason: LinkedIn
   * reskins often and a single stale selector would silently find nothing.
   * The last resort walks up from profile links, which survives a reskin
   * because the links themselves are the stable part.
   */
  function findRows() {
    const selectors = [
      'li.reusable-search__result-container',
      'li.org-people-profile-card__profile-card-spacing',
      'div.entity-result',
      'li.artdeco-list__item',
    ];

    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].filter((node) =>
        node.querySelector('a[href*="/in/"]')
      );
      if (found.length > 0) return found;
    }

    // Fallback: the nearest list item above each profile link.
    const containers = new Set();
    for (const link of document.querySelectorAll('a[href*="/in/"]')) {
      const container = link.closest('li') || link.closest('div[data-view-name]');
      if (container && container.querySelector('a[href*="/in/"]')) containers.add(container);
    }
    return [...containers];
  }

  /**
   * Pull a person out of one row.
   * @param {Element} row
   */
  function readRow(row) {
    const link = row.querySelector('a[href*="/in/"]');
    if (!link) return null;

    let profileUrl;
    try {
      const url = new URL(link.getAttribute('href'), location.origin);
      url.search = '';
      url.hash = '';
      profileUrl = url.toString().replace(/\/$/, '');
    } catch {
      return null;
    }

    // The visible name is usually the link's own text, but LinkedIn hides a
    // duplicate for screen readers — prefer the aria-hidden span when present.
    const nameNode =
      link.querySelector('span[aria-hidden="true"]') ||
      row.querySelector('.entity-result__title-text span[aria-hidden="true"]') ||
      link;
    const rawName = String(nameNode.textContent || '').replace(/\s+/g, ' ').trim();
    if (!rawName) return null;

    const subtitle = String(
      row.querySelector('.entity-result__primary-subtitle')?.textContent ||
        row.querySelector('.t-14.t-black.t-normal')?.textContent ||
        ''
    )
      .replace(/\s+/g, ' ')
      .trim();

    const { first_name, last_name } = sincerely.splitName
      ? sincerely.splitName(rawName)
      : { first_name: rawName.split(' ')[0] || null, last_name: null };

    let company = null;
    let jobTitle = subtitle || null;
    const atMatch = subtitle.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
    if (atMatch) {
      jobTitle = atMatch[1].trim();
      company = atMatch[2].trim();
    }

    return {
      first_name,
      last_name,
      full_name: rawName,
      job_title: jobTitle,
      company,
      linkedin_url: profileUrl,
      source: 'linkedin',
      source_url: location.href,
    };
  }

  /* ---------------------------------------------------------------- */
  /* State                                                            */
  /* ---------------------------------------------------------------- */

  /** profileUrl -> {person, standing, box} */
  const rows = new Map();
  const selected = new Set();
  let barRoot = null;
  let checking = false;

  async function send(type, payload = {}) {
    try {
      const response = await chrome.runtime.sendMessage({ type, payload });
      return response ?? { ok: false, error: { message: 'No response from the extension.' } };
    } catch (err) {
      return { ok: false, error: { message: err?.message || 'Extension unavailable.' } };
    }
  }

  /* ---------------------------------------------------------------- */
  /* Injected checkboxes                                              */
  /* ---------------------------------------------------------------- */

  function checkboxStyles() {
    return `
      .sx-box {
        position: absolute; top: 10px; left: -26px; z-index: 5;
        width: 16px; height: 16px; margin: 0;
        accent-color: #5B5BF5; cursor: pointer;
      }
    `;
  }

  /** Put a checkbox on every row we can read, once. */
  function decorateRows() {
    const found = findRows();
    if (found.length === 0) return 0;

    let added = 0;
    for (const row of found) {
      if (row.hasAttribute(MARK)) continue;
      const person = readRow(row);
      if (!person) continue;

      row.setAttribute(MARK, person.linkedin_url);

      // The row needs a positioning context for the absolutely-placed box; a
      // static row would push it to the page corner.
      if (getComputedStyle(row).position === 'static') row.style.position = 'relative';

      const host = document.createElement('div');
      host.className = 'sincerely-box-host';
      host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0;';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = checkboxStyles();
      shadow.appendChild(style);

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'sx-box';
      box.title = `Select ${person.full_name}`;
      box.addEventListener('change', () => {
        if (box.checked) selected.add(person.linkedin_url);
        else selected.delete(person.linkedin_url);
        renderBar();
      });
      shadow.appendChild(box);

      row.appendChild(host);
      // Hold the element rather than re-finding it later: the profile URL
      // makes a poor attribute selector (CSS.escape mangles it for quoted
      // values) and the row contains LinkedIn's own divs before ours.
      rows.set(person.linkedin_url, { person, standing: null, box });
      added += 1;
    }
    return added;
  }

  function setChecked(profileUrl, checked) {
    const box = rows.get(profileUrl)?.box;
    if (box) box.checked = checked;
    if (checked) selected.add(profileUrl);
    else selected.delete(profileUrl);
  }

  /* ---------------------------------------------------------------- */
  /* The bar                                                          */
  /* ---------------------------------------------------------------- */

  function barStyles() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      .bar {
        position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
        display: flex; align-items: center; gap: 10px;
        padding: 9px 12px; border-radius: 12px;
        background: #FFFFFF; color: #1B1B1F; border: 1px solid #ECEAE6;
        box-shadow: 0 1px 2px rgba(27,27,31,.06), 0 10px 28px -8px rgba(27,27,31,.20);
        font-size: 12.5px; letter-spacing: -0.005em; max-width: 92vw;
      }
      .bar img { width: 17px; height: 17px; flex: 0 0 auto; }
      .count { font-weight: 600; white-space: nowrap; }
      .sep { width: 1px; height: 20px; background: #ECEAE6; flex: 0 0 auto; }
      button {
        height: 28px; padding: 0 10px; border-radius: 6px; cursor: pointer;
        font-family: inherit; font-size: 12px; font-weight: 500; white-space: nowrap;
        background: #FFFFFF; color: #1B1B1F; border: 1px solid #E0DDD8;
      }
      button:hover:not(:disabled) { background: #EFEDEA; }
      button.primary { background: #5B5BF5; color: #fff; border-color: #5B5BF5; }
      button.primary:hover:not(:disabled) { background: #4646E5; }
      button:disabled { opacity: .45; cursor: not-allowed; }
      select {
        height: 28px; max-width: 190px; padding: 0 8px; border-radius: 6px;
        font-family: inherit; font-size: 12px; color: #1B1B1F;
        background: #F9F8F7; border: 1px solid #E0DDD8;
      }
      .note { color: #61606A; white-space: nowrap; }
      .warn { color: #B45309; }
      @media (prefers-color-scheme: dark) {
        .bar { background: #191919; color: #F4F4F3; border-color: #262626;
               box-shadow: 0 2px 4px -1px rgba(0,0,0,.4), 0 14px 32px -8px rgba(0,0,0,.6); }
        .sep { background: #2E2E2E; }
        button { background: #191919; color: #F4F4F3; border-color: #2E2E2E; }
        button:hover:not(:disabled) { background: #242424; }
        select { background: #121212; color: #F4F4F3; border-color: #2E2E2E; }
        .note { color: #A19FA6; }
        .warn { color: #FBBF24; }
      }
    `;
  }

  function ensureBarRoot() {
    if (barRoot) return barRoot;
    const host = document.createElement('div');
    host.id = BAR_ID;
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000;';
    document.documentElement.appendChild(host);
    barRoot = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = barStyles();
    barRoot.appendChild(style);
    return barRoot;
  }

  const barState = { lists: [], listId: null, message: null, busy: false, netNewReady: false };

  function renderBar() {
    const shadow = ensureBarRoot();
    shadow.querySelector('.bar')?.remove();

    if (rows.size === 0) return;

    const bar = document.createElement('div');
    bar.className = 'bar';

    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('icons/icon-32.png');
    logo.alt = '';
    bar.appendChild(logo);

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = `${selected.size} of ${rows.size} selected`;
    bar.appendChild(count);

    const sep = document.createElement('span');
    sep.className = 'sep';
    bar.appendChild(sep);

    const all = document.createElement('button');
    all.textContent = selected.size === rows.size ? 'Clear' : 'Select all';
    all.addEventListener('click', () => {
      const selectAll = selected.size !== rows.size;
      for (const url of rows.keys()) setChecked(url, selectAll);
      renderBar();
    });
    bar.appendChild(all);

    const netNew = document.createElement('button');
    netNew.textContent = checking ? 'Checking…' : 'Net new';
    netNew.disabled = checking || barState.busy;
    netNew.title =
      'Select only people who are not already on one of your lead lists — not merely those missing from your contacts.';
    netNew.addEventListener('click', selectNetNew);
    bar.appendChild(netNew);

    const select = document.createElement('select');
    if (barState.lists.length === 0) {
      const option = document.createElement('option');
      option.textContent = 'No lead lists';
      select.appendChild(option);
    }
    for (const list of barState.lists) {
      const option = document.createElement('option');
      option.value = list.id;
      option.textContent = list.name;
      if (list.id === barState.listId) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      barState.listId = select.value;
    });
    bar.appendChild(select);

    const add = document.createElement('button');
    add.className = 'primary';
    add.textContent = barState.busy ? 'Working…' : `Add ${selected.size}`;
    add.disabled = barState.busy || selected.size === 0 || !barState.listId;
    add.addEventListener('click', addSelected);
    bar.appendChild(add);

    if (barState.message) {
      const note = document.createElement('span');
      note.className = `note${barState.message.warn ? ' warn' : ''}`;
      note.textContent = barState.message.text;
      bar.appendChild(note);
    }

    shadow.appendChild(bar);
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Tick only the people who aren't already on one of your lead lists.
   *
   * LinkedIn rows carry no address, so "do we know them?" is answered by name
   * and company. That's a fuzzy match, so the result is a selection the user
   * can see and correct — never an automatic spend or send.
   */
  async function selectNetNew() {
    checking = true;
    barState.message = null;
    renderBar();

    const people = [...rows.values()].map((entry) => entry.person);
    const response = await send('CHECK_KNOWN', { people });

    checking = false;

    if (!response.ok) {
      barState.message = { text: response.error.message, warn: true };
      renderBar();
      return;
    }

    const known = new Map(Object.entries(response.data.byProfile || {}));
    for (const [url, entry] of rows) {
      entry.standing = known.get(url) || null;
      // Enrolled in something live, or suppressed → not net new.
      const skip = entry.standing?.onLists > 0 || entry.standing?.suppressed;
      setChecked(url, !skip);
    }

    const skipped = [...rows.values()].filter(
      (e) => e.standing?.onLists > 0 || e.standing?.suppressed
    ).length;
    barState.message = skipped
      ? { text: `${skipped} skipped — already on a list, or suppressed` }
      : { text: 'Nobody here is already being emailed' };
    barState.netNewReady = true;
    renderBar();
  }

  async function addSelected() {
    if (!barState.listId || selected.size === 0) return;

    const people = [...selected].map((url) => rows.get(url)?.person).filter(Boolean);

    barState.busy = true;
    barState.message = { text: 'Finding addresses…' };
    renderBar();

    const response = await send('BULK_ADD_PROFILES', {
      listId: barState.listId,
      people,
    });

    barState.busy = false;

    if (!response.ok) {
      barState.message = { text: response.error.message, warn: true };
      renderBar();
      return;
    }

    const { added, revealed, noEmail, creditsRemaining } = response.data;
    const parts = [`Added ${added}`];
    if (revealed > 0) parts.push(`${revealed} revealed`);
    if (noEmail > 0) parts.push(`${noEmail} had no address`);
    if (Number.isFinite(creditsRemaining)) parts.push(`${creditsRemaining} credits left`);
    barState.message = { text: parts.join(' · ') };

    for (const url of [...selected]) setChecked(url, false);
    renderBar();
  }

  /* ---------------------------------------------------------------- */
  /* Mount                                                            */
  /* ---------------------------------------------------------------- */

  async function loadLists() {
    const response = await send('LIST_LISTS');
    if (!response.ok) return;
    barState.lists = response.data.lists || [];
    const { lastListId } = await chrome.storage.local.get({ lastListId: null });
    barState.listId = barState.lists.some((l) => l.id === lastListId)
      ? lastListId
      : barState.lists[0]?.id ?? null;
  }

  function teardown() {
    document.getElementById(BAR_ID)?.remove();
    barRoot = null;

    // Un-mark the rows and pull our checkboxes out. LinkedIn reuses DOM nodes
    // across an SPA navigation, so leaving the marker attribute behind makes
    // decorateRows skip those rows forever — the bar would never come back
    // after moving from one search to the next.
    for (const row of document.querySelectorAll(`[${MARK}]`)) {
      row.removeAttribute(MARK);
      row.querySelector('.sincerely-box-host')?.remove();
    }

    rows.clear();
    selected.clear();
    barState.message = null;
  }

  let scanTimer = null;
  function scheduleDecorate() {
    clearTimeout(scanTimer);
    // LinkedIn renders results in bursts as you scroll; a debounce keeps this
    // to one pass per burst instead of one per mutation.
    scanTimer = setTimeout(() => {
      if (!isListPage()) return;
      if (decorateRows() > 0) renderBar();
    }, 600);
  }

  async function mount() {
    if (!isListPage()) {
      teardown();
      return;
    }
    if (rows.size === 0) {
      await loadLists();
      // The observer may have drawn the bar while the lists were still in
      // flight; repaint so the picker isn't stuck on "No lead lists".
      if (rows.size > 0) renderBar();
    }
    scheduleDecorate();
  }

  const observer = new MutationObserver(() => {
    if (isListPage()) scheduleDecorate();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    teardown();
    mount().catch(() => {});
  }, 1200);

  sincerely.remountList = mount;
  mount().catch(() => {});
})();

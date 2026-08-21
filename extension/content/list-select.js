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
      /^\/mynetwork\//.test(pathname) ||
      // Sales Navigator: search results, saved lead lists, and a company's
      // people tab. This is the list view the paying customer actually works
      // from, and it had no bulk bar because every path test here predated
      // Sales Navigator support entirely.
      isSalesNavList(pathname)
    );
  }

  /** Sales Navigator's own list surfaces. */
  function isSalesNavList(pathname = location.pathname) {
    return (
      /^\/sales\/search\/people/.test(pathname) ||
      /^\/sales\/lists\/people/.test(pathname) ||
      /^\/sales\/company\/[^/]+\/people/.test(pathname)
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
    if (isSalesNavList()) return findSalesNavRows();

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
   * Rows in a Sales Navigator list.
   *
   * Anchored on `data-anonymize="person-name"` rather than on a profile
   * link, because a Sales Navigator result row often has no /in/ link at
   * all — it links to /sales/lead/. The name marker is put there by
   * LinkedIn's own screenshot-blur feature, which makes it both semantic
   * and far more durable than the generated class names around it.
   */
  function findSalesNavRows() {
    const containers = new Set();
    for (const marker of document.querySelectorAll('[data-anonymize="person-name"]')) {
      const container =
        marker.closest('li') ||
        marker.closest('tr') ||
        marker.closest('div[data-x-search-result]') ||
        marker.closest('div[data-sn-view-name]');
      // A container holding two names is an ancestor of several rows, not a
      // row — taking it would collapse the whole page into one selection.
      if (container && container.querySelectorAll('[data-anonymize="person-name"]').length === 1) {
        containers.add(container);
      }
    }
    return [...containers];
  }

  /**
   * Pull a person out of one row.
   * @param {Element} row
   */
  function readRow(row) {
    if (isSalesNavList()) return readSalesNavRow(row);

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

  /**
   * Pull a person out of one Sales Navigator row.
   *
   * The public profile link is preferred and often absent: Sales Navigator
   * links to its own /sales/lead/ route. Storing the lead URL when that is
   * all there is beats storing nothing, because a link that only works for
   * this account still leads back to a person.
   */
  function readSalesNavRow(row) {
    const nameNode = row.querySelector('[data-anonymize="person-name"]');
    const rawName = String(nameNode?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!rawName) return null;

    const read = (field) => {
      const node = row.querySelector(`[data-anonymize="${field}"]`);
      return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
    };

    let jobTitle = read('title') || read('job-title') || null;
    let company = read('company-name') || null;

    // Rows that give one blob rather than two marked fields still tend to
    // read "Title at Company".
    if (!jobTitle || !company) {
      const headline = read('headline');
      const atMatch = headline.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
      if (atMatch) {
        if (!jobTitle) jobTitle = atMatch[1].trim();
        if (!company) company = atMatch[2].trim();
      } else if (!jobTitle && headline) {
        jobTitle = headline;
      }
    }

    let url = null;
    for (const link of row.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || '';
      if (!/\/in\/|\/sales\/lead\//.test(href)) continue;
      try {
        const parsed = new URL(href, location.origin);
        parsed.search = '';
        parsed.hash = '';
        /*
         * Sales Navigator appends how you arrived at a lead --
         * /sales/lead/<id>,NAME_SEARCH -- and the same person reached from a
         * search and from a saved list would otherwise be stored twice, with
         * two URLs that do not match the one the lead page itself produces.
         */
        parsed.pathname = parsed.pathname.replace(
          /^(\/sales\/(?:lead|people)\/[^/,]+),.*$/,
          '$1',
        );
        const candidate = parsed.toString().replace(/\/$/, '');
        // A public profile is worth more than a lead link, so keep looking
        // once a lead link is found but stop the moment a /in/ one turns up.
        if (/\/in\//.test(parsed.pathname)) { url = candidate; break; }
        if (!url) url = candidate;
      } catch { /* a malformed href is not a reason to drop the row */ }
    }
    if (!url) return null;

    const { first_name, last_name } = sincerely.splitName
      ? sincerely.splitName(rawName)
      : { first_name: rawName.split(' ')[0] || null, last_name: null };

    return {
      first_name,
      last_name,
      full_name: rawName,
      job_title: jobTitle,
      company,
      linkedin_url: url,
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
  /* Keyboard triage                                                  */
  /* ---------------------------------------------------------------- */

  /*
   * Working a page of results one checkbox at a time means a mouse trip per
   * person, and these pages are worked in volume — twenty-five results, most of
   * them a yes or a no on sight. J and K move, space picks, Enter adds the
   * selection.
   *
   * Deliberately narrow about when it listens: LinkedIn's own search box, the
   * message composer and every other field on the page must keep their letters.
   * So it only acts when focus is on the page body, and never with a modifier
   * held.
   */
  let cursor = -1;

  /** The row the cursor is on, marked so it is visible without hunting. */
  function paintCursor() {
    for (const [url, row] of rows) {
      const node = document.querySelector(`[${MARK}="${CSS.escape(url)}"]`);
      if (!node) continue;
      const on = [...rows.keys()][cursor] === url;
      node.style.outline = on ? '2px solid #5B5BF5' : '';
      node.style.outlineOffset = on ? '2px' : '';
      if (on) node.scrollIntoView({ block: 'nearest' });
      void row;
    }
  }

  function moveCursor(delta) {
    const urls = [...rows.keys()];
    if (urls.length === 0) return;
    cursor = Math.max(0, Math.min(urls.length - 1, cursor < 0 ? 0 : cursor + delta));
    paintCursor();
  }

  function typingSomewhere() {
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    const tag = active.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      active.isContentEditable === true
    );
  }

  document.addEventListener('keydown', (event) => {
    if (!isListPage() || rows.size === 0) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (typingSomewhere()) return;

    const urls = [...rows.keys()];

    if (event.key === 'j' || event.key === 'J') {
      event.preventDefault();
      moveCursor(1);
    } else if (event.key === 'k' || event.key === 'K') {
      event.preventDefault();
      moveCursor(-1);
    } else if (event.key === ' ') {
      if (cursor < 0) return;
      event.preventDefault();
      const url = urls[cursor];
      setChecked(url, !selected.has(url));
      renderBar();
      paintCursor();
    } else if (event.key === 'Enter') {
      if (selected.size === 0) return;
      event.preventDefault();
      addSelected();
    }
  });

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
      /* Shortcuts nobody knows about are shortcuts nobody uses. */
      .keys {
        font-size: 10.5px; color: #A8A6AE; letter-spacing: .02em; white-space: nowrap;
        padding: 2px 6px; border: 1px solid #E8E6E1; border-radius: 5px;
      }
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
  /** How many rows the last standing check covered, so it is not re-run per scroll. */
  let standingFor = 0;
  /*
   * Set when a quiet check failed.
   *
   * Without it the auto-resolve is a loop: it fails, calls renderBar to say
   * so, and renderBar sees an unresolved selection and asks again — forever,
   * as fast as the network will allow. Pressing Net New clears it, because
   * an explicit retry is a different thing from an automatic one.
   */
  let standingFailed = false;
  /** The check currently running, so a second caller joins it rather than giving up. */
  let inFlight = null;
  /*
   * Whether the running check is one the user asked for.
   *
   * The Net New button only becomes "Checking…" for a check somebody
   * started. A background one must leave it alone: replacing the button
   * with a disabled label, for work nobody requested, takes away the thing
   * they were reaching for at the moment they reach for it.
   */
  let checkingLoud = false;

  /**
   * How many of the selected people already have an address, and how many
   * would have to be found.
   *
   * Null until the standing check has run, because a confident-looking
   * "0 need finding" that simply means "not asked yet" is worse than saying
   * nothing at all.
   */
  function addressSplit() {
    if (!barState.netNewReady || selected.size === 0) return null;
    let have = 0;
    let missing = 0;
    for (const url of selected) {
      const standing = rows.get(url)?.standing;
      if (!standing) { missing += 1; continue; }
      if (standing.hasEmail) have += 1;
      else missing += 1;
    }
    return { have, missing };
  }

  function renderBar() {
    const shadow = ensureBarRoot();
    // Every bar, not the first one. A single querySelector here is what let a
    // re-entrant render leave a stale bar sitting permanently on top of the
    // live one, and the guarantee is worth more than the microseconds.
    for (const stale of shadow.querySelectorAll('.bar')) stale.remove();

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
    // Shortcuts nobody knows about are shortcuts nobody uses.
    count.title = 'J and K move · Space selects · Enter adds';
    bar.appendChild(count);

    /*
     * What this add is actually going to do, before it does it.
     *
     * A LinkedIn row carries no email address, so anyone not already held
     * as a contact needs a Prospector reveal, and a reveal costs a credit.
     * The old bar said nothing about this: you selected eighteen people,
     * pressed Add, and found out afterwards how many credits had gone and
     * how many arrived with no address at all.
     */
    const split = addressSplit();
    if (split) {
      const detail = document.createElement('span');
      detail.className = split.missing > 0 ? 'note warn' : 'note';
      detail.textContent = split.missing > 0
        ? `${split.have} have addresses · ${split.missing} need finding`
        : `all ${split.have} have addresses`;
      detail.title = split.missing > 0
        ? `${split.missing} of the selected people are not in your contacts yet, so adding them spends ${split.missing} Prospector credit${split.missing === 1 ? '' : 's'} looking for an address.`
        : 'Every selected person is already a contact with an address — this add costs no credits.';
      bar.appendChild(detail);
    } else if (selected.size > 0) {
      const detail = document.createElement('span');
      detail.className = 'note';
      detail.textContent = 'checking addresses…';
      bar.appendChild(detail);
      /*
       * Selecting is the first moment the answer matters, and so the first
       * moment it is worth a request. Kicked from here rather than from the
       * checkbox handler because the keyboard and Select all reach the same
       * state without ever touching it.
       *
       * Deferred, and that is not a detail. resolveStanding repaints, so
       * calling it from inside a render re-enters this function halfway
       * through — after the old bar has been removed and before the new one
       * is appended — and the nested render appends its own. Two bars, and
       * every later render removes only the first, so the stale one stays on
       * top forever. A timeout puts it after this render has finished.
       */
      if (!checking) setTimeout(() => resolveStanding(false), 0);
    }

    const keys = document.createElement('span');
    keys.className = 'keys';
    keys.textContent = 'J K · space · ⏎';
    keys.title = 'J and K move between results, space selects, Enter adds them';
    bar.appendChild(keys);

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
    // Only a check the user started takes the button away. Pressing it during
    // a background one joins that check rather than starting a second.
    netNew.textContent = checkingLoud ? 'Checking…' : 'Net new';
    netNew.disabled = checkingLoud || barState.busy;
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
   * Ask the server what it already knows about the people on this page.
   *
   * Shared by Net New and by the address count on the bar, and run at most
   * once per set of rows. The service worker memoises the searches behind
   * it, so a second call inside a minute costs nothing — but a third one
   * from a third caller would still be a request nobody asked for.
   *
   * Failure is silent by design when nobody pressed anything: the bar
   * simply says less rather than putting a red error in front of someone
   * who was only scrolling.
   *
   * @param {boolean} [loud] Report failures on the bar.
   * @returns {Promise<boolean>} Whether standing is now known.
   */
  async function resolveStanding(loud) {
    if (rows.size === 0) return false;
    if (standingFor === rows.size && barState.netNewReady) return true;

    /*
     * Join an in-flight check rather than declining because of it.
     *
     * Declining is what broke Net New: selecting anything kicks off a quiet
     * check, so pressing the button a moment later found one already
     * running, gave up, and left the bar with nothing selected and nothing
     * said. A press must never be swallowed by work it was going to wait
     * for anyway.
     */
    if (inFlight) {
      const joined = await inFlight;
      if (joined || !loud) return joined;
      // A quiet failure that has now been explicitly retried falls through.
    }
    if (standingFailed && !loud) return false;

    if (loud) barState.message = null;
    checking = true;
    checkingLoud = Boolean(loud);
    standingFailed = false;

    /*
     * Assigned before anything repaints. renderBar starts a check when it
     * sees an unresolved selection, so painting first — while inFlight was
     * still null — meant the repaint started a second check, which
     * repainted, which started a third. That is the recursion, and it does
     * not stop.
     */
    const run = runStandingCheck(loud);
    inFlight = run;
    renderBar();

    try {
      return await run;
    } finally {
      inFlight = null;
      checking = false;
      checkingLoud = false;
    }
  }

  /** The check itself. Only ever called by resolveStanding. */
  async function runStandingCheck(loud) {
    const people = [...rows.values()].map((entry) => entry.person);
    const response = await send('CHECK_KNOWN', { people });

    if (!response.ok) {
      standingFailed = true;
      checking = false;
      checkingLoud = false;
      if (loud) barState.message = { text: response.error.message, warn: true };
      renderBar();
      return false;
    }

    const known = new Map(Object.entries(response.data.byProfile || {}));
    for (const [url, entry] of rows) entry.standing = known.get(url) || null;
    barState.netNewReady = true;
    standingFor = rows.size;
    checking = false;
    checkingLoud = false;
    renderBar();
    return true;
  }

  /**
   * Tick only the people who aren't already on one of your lead lists.
   */
  async function selectNetNew() {
    if (!(await resolveStanding(true))) return;

    for (const [url, entry] of rows) {
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

    const {
      added, revealed, noEmail, creditsRemaining,
      campaignName, sending, daysToReach,
    } = response.data;

    const parts = [`Added ${added}`];
    if (revealed > 0) parts.push(`${revealed} revealed`);
    if (noEmail > 0) parts.push(`${noEmail} had no address`);
    if (Number.isFinite(creditsRemaining)) parts.push(`${creditsRemaining} credits left`);

    /*
     * And what happens to them, which is the question that was actually
     * being asked. "Added 18" told you where they were filed; it did not
     * tell you whether anything would ever be sent to them, and a list no
     * campaign draws from is the most expensive misunderstanding this
     * extension can create.
     */
    if (sending && campaignName) {
      parts.push(daysToReach && daysToReach > 1
        ? `"${campaignName}" reaches them in ~${daysToReach} days`
        : `"${campaignName}" picks them up next run`);
    } else if (campaignName) {
      parts.push(`"${campaignName}" is not running — nothing sends yet`);
    }

    barState.message = { text: parts.join(' · '), warn: !sending && noEmail > 0 };

    for (const url of [...selected]) setChecked(url, false);
    renderBar();
  }

  /* ---------------------------------------------------------------- */
  /* Mount                                                            */
  /* ---------------------------------------------------------------- */

  /** @returns {Promise<boolean>} True once the lists have actually been read. */
  async function loadLists() {
    const response = await send('LIST_LISTS');
    if (!response.ok) return false;
    barState.lists = response.data.lists || [];
    const { lastListId } = await chrome.storage.local.get({ lastListId: null });
    barState.listId = barState.lists.some((l) => l.id === lastListId)
      ? lastListId
      : barState.lists[0]?.id ?? null;
    // The bar may already be on screen from an earlier decorate pass, drawn
    // while this request was still in flight and therefore showing "No lead
    // lists". Repaint now that there is something to show.
    if (rows.size > 0) renderBar();
    return true;
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
    standingFor = 0;
    standingFailed = false;
    inFlight = null;
    checkingLoud = false;
    cursor = -1;
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

  /**
   * Whether the lead lists have been fetched, successfully or not.
   *
   * Separate from `barState.lists.length`, so an account that genuinely has no
   * lists isn't re-asked on every navigation, while a failed fetch still is.
   */
  let listsLoaded = false;

  async function mount() {
    if (!isListPage()) {
      teardown();
      return;
    }

    /*
     * Lead lists belong to the account, not to the page, so they are fetched
     * once and kept across navigations.
     *
     * This used to be guarded on `rows.size === 0` — the count of decorated
     * result rows, which is a different thing entirely. Two faults came out of
     * that: `teardown()` clears `rows`, so every LinkedIn search re-fetched the
     * lists and spent the 100/minute key budget for nothing; and the repaint
     * that followed was dead code, because `decorateRows()` had not run yet in
     * this cycle, so `rows.size` was still 0 and `renderBar()` returns early at
     * zero rows anyway. The picker it was meant to un-stick never got repainted.
     */
    if (!listsLoaded) {
      listsLoaded = await loadLists();
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
    /*
     * Ignore the address bar while the scraper is driving LinkedIn's overlay.
     * It opens Contact info by pushing that overlay's URL — which is a URL
     * change like any other, so this watcher would treat it as the user
     * navigating and tear the panel down in the middle of the read.
     */
    if (sincerely.isOverlayBusy?.()) return;
    lastUrl = location.href;
    teardown();
    mount().catch(() => {});
  }, 1200);

  sincerely.remountList = mount;
  mount().catch(() => {});
})();

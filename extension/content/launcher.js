/**
 * The in-page way into the sidebar.
 *
 * This replaces the panel that used to be injected into LinkedIn. That panel
 * was a good panel, but it made the extension two different products: a sidebar
 * on LinkedIn profiles and a popup everywhere else, with separate layouts and
 * separate code paths for the same job. Chrome has a real sidebar of its own,
 * it stays open across navigations and tabs, and it does not have to fight a
 * host page's CSS — so that is where the whole extension lives now.
 *
 * All this leaves in the page is a button to open it, because the toolbar icon
 * is a long way from the profile you are reading.
 *
 * Nothing here reads the page or holds credentials: the scraper does the
 * reading and the service worker does everything privileged.
 */

(() => {
  if (window.__sincerelyLauncherLoaded) return;
  window.__sincerelyLauncherLoaded = true;

  const HOST_ID = 'sincerely-launcher-host';
  const HIDDEN_KEY = 'launcherHidden';

  /** Where a launcher is worth showing. Everywhere else, the toolbar icon. */
  function relevant() {
    const { hostname, pathname } = location;
    if (hostname.endsWith('linkedin.com')) {
      // A member profile on the main site.
      if (/^\/in\//.test(pathname)) return true;
      // A lead in Sales Navigator, which is where anyone paying for a tool
      // like this actually prospects — and where, until now, the extension
      // put nothing on the page at all.
      if (/^\/sales\/(?:lead|people)\//.test(pathname)) return true;
      return false;
    }
    return hostname === 'mail.google.com';
  }

  function remove() {
    document.getElementById(HOST_ID)?.remove();
  }

  function mount() {
    if (!relevant()) return remove();
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000;';
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

      /* Clear of LinkedIn's own right-hand rail, and clear of the sidebar when
         it opens — Chrome insets the page rather than covering it, so a fixed
         element on the right edge stays visible and stays clickable. */
      .launch {
        position: fixed; top: 50%; right: 0; transform: translateY(-50%);
        display: flex; align-items: center; gap: 8px;
        height: 40px; padding: 0 12px 0 10px;
        border: 1px solid #E6E3DE; border-right: 0; border-radius: 10px 0 0 10px;
        background: #FFFFFF; color: #1B1B1F; cursor: pointer;
        font-size: 13px; font-weight: 500; letter-spacing: -0.01em;
        box-shadow: -2px 0 12px -4px rgba(27,27,31,.22);
        transition: padding 140ms cubic-bezier(.22,1,.36,1), background 140ms;
      }
      .launch:hover { background: #FBFAF9; }
      .launch:focus-visible { outline: 2px solid #5B5BF5; outline-offset: -2px; }
      .launch img { width: 20px; height: 20px; border-radius: 5px; }

      /* The label is the affordance; without it this is an unexplained dot on
         someone's profile. It collapses once it has been used at least once. */
      .label { white-space: nowrap; }

      .dismiss {
        width: 18px; height: 18px; padding: 0; border: 0; border-radius: 5px;
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; color: #8F8E97; cursor: pointer; font-size: 13px; line-height: 1;
      }
      .dismiss:hover { background: #EFEDEA; color: #1B1B1F; }

      @media (prefers-color-scheme: dark) {
        .launch { background: #191919; color: #F4F4F3; border-color: #2E2E2E; }
        .launch:hover { background: #202020; }
        .dismiss:hover { background: #242424; color: #F4F4F3; }
      }
    `;
    shadow.appendChild(style);

    const button = document.createElement('button');
    button.className = 'launch';
    button.type = 'button';
    button.title = 'Open the Sincerely sidebar';

    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('icons/icon-32.png');
    logo.alt = '';
    button.appendChild(logo);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Sincerely';
    button.appendChild(label);

    button.addEventListener('click', () => {
      /*
       * Opening the sidebar has to happen in the service worker — the API is
       * not exposed to content scripts — and it must be traceable to a real
       * click, which this is. If Chrome refuses anyway the user still has the
       * toolbar icon, so there is nothing useful to say here.
       */
      chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL', payload: {} }).catch(() => {});
    });

    const dismiss = document.createElement('button');
    dismiss.className = 'dismiss';
    dismiss.type = 'button';
    dismiss.textContent = '×';
    dismiss.title = 'Hide this button';
    dismiss.setAttribute('aria-label', 'Hide the Sincerely button');
    dismiss.addEventListener('click', (event) => {
      // Not the launcher's own click as well — that would open the sidebar on
      // the way to hiding the thing that opens it.
      event.stopPropagation();
      chrome.storage.local.set({ [HIDDEN_KEY]: true }).catch(() => {});
      remove();
    });
    button.appendChild(dismiss);

    shadow.appendChild(button);
  }

  async function mountIfWanted() {
    const stored = await chrome.storage.local
      .get({ [HIDDEN_KEY]: false })
      .catch(() => ({ [HIDDEN_KEY]: false }));
    if (stored[HIDDEN_KEY]) return remove();
    mount();
  }

  mountIfWanted();

  /*
   * LinkedIn routes client-side, so the launcher has to appear and disappear
   * with the URL rather than only on load. Polling rather than patching
   * history: it costs nothing at this interval and cannot be defeated by a
   * router that replaces its own methods.
   */
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    mountIfWanted();
  }, 1200);

  // Un-hiding is done from the options page, so listen for it.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[HIDDEN_KEY]) return;
    if (changes[HIDDEN_KEY].newValue) remove();
    else mount();
  });
})();

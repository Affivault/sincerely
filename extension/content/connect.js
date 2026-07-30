/**
 * One-click connect, running on the Sincerely web app's own pages.
 *
 * Asking someone to mint an API key, find it, unmask it, copy it and paste it
 * into a second window is four chances to get it wrong — and the commonest
 * failure (copying the masked text) produces a key that *looks* right and is
 * rejected with no explanation. The app is already authenticated as the user,
 * so it can create the key and hand it over directly. Nobody types anything.
 *
 * The page and this script talk over window.postMessage rather than
 * chrome.runtime, because that needs the extension's ID and an unpacked
 * extension's ID changes with its folder. This needs no ID at all.
 *
 * This file only relays. Validating the key, storing it and testing it happen
 * in the service worker — the extension's only privileged surface, and the only
 * place that can check host permissions, which content scripts cannot.
 *
 * Messages are only accepted from the page's own window, so another tab or an
 * iframe can't push a key into the extension.
 */

(() => {
  if (window.__sincerelyConnectLoaded) return;
  window.__sincerelyConnectLoaded = true;

  const PING = 'SINCERELY_EXTENSION_PING';
  const PONG = 'SINCERELY_EXTENSION_HERE';
  const CONNECT = 'SINCERELY_EXTENSION_CONNECT';
  const CONNECTED = 'SINCERELY_EXTENSION_CONNECTED';

  /** @param {object} message */
  function toPage(message) {
    window.postMessage(message, window.location.origin);
  }

  /** Tell the page we exist, so it can show the button rather than guess. */
  function announce() {
    toPage({ type: PONG, version: chrome.runtime.getManifest().version });
  }

  window.addEventListener('message', async (event) => {
    // Same-window only: postMessage from an iframe or another origin has a
    // different source, and a key must never arrive from one.
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === PING) {
      announce();
      return;
    }

    if (data.type !== CONNECT) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CONNECT_APPLY',
        payload: {
          apiKey: String(data.apiKey || ''),
          apiBaseUrl: String(data.apiBaseUrl || ''),
          // The app it came from is the app to link back to.
          appUrl: window.location.origin,
        },
      });

      if (!response?.ok) {
        toPage({
          type: CONNECTED,
          ok: false,
          error: response?.error?.message || 'The extension could not save the key.',
        });
        return;
      }

      toPage({ type: CONNECTED, ok: true, ...response.data });
    } catch (err) {
      // Thrown when the worker can't be reached at all — typically the
      // extension was reloaded or removed while this page stayed open.
      toPage({
        type: CONNECTED,
        ok: false,
        error: err?.message || 'The extension did not respond. Reload this page and try again.',
      });
    }
  });

  // The page may have loaded before this script ran, so announce immediately
  // as well as on request.
  announce();
})();

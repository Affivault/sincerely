/**
 * Settings storage.
 *
 * Everything lives in chrome.storage.local, never storage.sync — sync would
 * replicate the API key to every Chrome profile the user is signed into, and
 * a credential should stay on the machine it was entered on.
 */

/** @typedef {{apiBaseUrl: string, apiKey: string, lastCampaignId: string|null, verifyBeforeAdd: boolean, autoTag: boolean, autoTagName: string, appUrl: string, showBadge: boolean}} Settings */

export const DEFAULT_API_BASE = 'https://api.usesincerely.com/api/v1';
export const LOCAL_API_BASE = 'http://localhost:3001/api/v1';

/** Where the web app lives — used for "open in Sincerely" links. */
export const DEFAULT_APP_URL = 'https://usesincerely.com';
export const LOCAL_APP_URL = 'http://localhost:5173';

/** @type {Settings} */
const DEFAULTS = {
  apiBaseUrl: DEFAULT_API_BASE,
  apiKey: '',
  lastCampaignId: null,
  verifyBeforeAdd: false,
  /** Tag everything added from the extension, so the channel is measurable. */
  autoTag: true,
  autoTagName: 'chrome-extension',
  appUrl: DEFAULT_APP_URL,
  /** Mark the toolbar icon when the current tab's person is already known. */
  showBadge: true,
};

/**
 * Best guess at the web app's URL from the API URL, used only to prefill the
 * setting. The hosted setup is api.<domain> → <domain>, but a self-hosted API
 * on an unrelated host (a Render subdomain, say) isn't derivable at all — hence
 * a real setting rather than deriving it at call time.
 *
 * @param {string} apiBaseUrl
 * @returns {string|null} null when no confident guess is possible.
 */
export function guessAppUrl(apiBaseUrl) {
  try {
    const { protocol, host } = new URL(apiBaseUrl);
    if (host.startsWith('api.')) return `${protocol}//${host.slice(4)}`;
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return LOCAL_APP_URL;
    return null;
  } catch {
    return null;
  }
}

/**
 * Accepts whatever the user pasted and returns a usable API root.
 *
 * People reliably paste the app URL, the bare API host, or a URL with a
 * trailing slash. Rather than fail with an opaque 404 later, normalise here:
 * strip trailing slashes and append /api/v1 when it's missing.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normaliseBaseUrl(raw) {
  let url = String(raw || '').trim().replace(/\/+$/, '');
  if (!url) return DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!/\/api\/v\d+$/i.test(url)) url = `${url}/api/v1`;
  return url;
}

/** @returns {Promise<Settings>} */
export async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

/**
 * @param {Partial<Settings>} patch
 * @returns {Promise<Settings>}
 */
export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
  return getSettings();
}

/** Forget the API key without touching the user's other preferences. */
export async function clearApiKey() {
  await chrome.storage.local.remove('apiKey');
}

/**
 * The origin the API base URL points at, in the pattern form
 * chrome.permissions wants (e.g. "https://api.example.com/*").
 *
 * host_permissions is static in the manifest, so a self-hosted API on some
 * other domain needs a runtime grant. Returns null for the origins already
 * declared in the manifest, which need no request.
 *
 * @param {string} baseUrl
 * @returns {string|null}
 */
export function originPatternFor(baseUrl) {
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return null;
  }
  const declared = [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'https://api.usesincerely.com',
  ];
  if (declared.includes(origin)) return null;
  return `${origin}/*`;
}

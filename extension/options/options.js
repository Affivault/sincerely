/**
 * Options page: connect the extension to an account.
 *
 * Writes settings to chrome.storage and asks the service worker to do the
 * actual connection test, so this page never builds an authenticated request
 * itself.
 */

import {
  DEFAULT_API_BASE,
  DEFAULT_APP_URL,
  LOCAL_API_BASE,
  LOCAL_APP_URL,
  guessAppUrl,
  getSettings,
  normaliseBaseUrl,
  originPatternFor,
  setSettings,
  clearApiKey,
} from '../lib/storage.js';
import { getThemeMode, initTheme, setThemeMode } from '../lib/theme.js';

const el = {
  theme: document.getElementById('theme'),
  appUrl: document.getElementById('app-url'),
  showBadge: document.getElementById('show-badge'),
  autoTag: document.getElementById('auto-tag'),
  autoTagName: document.getElementById('auto-tag-name'),
  apiUrl: document.getElementById('api-url'),
  apiKey: document.getElementById('api-key'),
  save: document.getElementById('save'),
  forget: document.getElementById('forget'),
  result: document.getElementById('result'),
  useProduction: document.getElementById('use-production'),
  useLocal: document.getElementById('use-local'),
  verifyBeforeAdd: document.getElementById('verify-before-add'),
};

/**
 * A real key is "sk_live_" followed by 64 hex characters — 72 in total.
 *
 * Checking the shape here turns the server's flat "Invalid or expired API key"
 * into something actionable. The common mistake is copying the *masked*
 * display from the Developer page (`sk_live_1234abcd••••••••`) instead of
 * using its copy button: it starts with sk_live_, so a prefix-only check waves
 * it through and the server rejects it with no explanation.
 *
 * @param {string} key
 * @returns {string|null} A description of the problem, or null if it looks right.
 */
function describeKeyProblem(key) {
  if (!key.startsWith('sk_live_')) {
    return 'That does not look like a Sincerely API key. Keys start with "sk_live_" and come from Developer → API keys — a Supabase session token or anon key will not work here.';
  }
  if (/[•·*…]/.test(key)) {
    return 'That key is still masked — it contains the dots used to hide it on screen. Use the copy button next to the key rather than selecting the text, then paste again.';
  }
  const body = key.slice('sk_live_'.length);
  if (body.length < 64) {
    return `That key looks truncated: ${key.length} characters, but a full key is 72. Create a new key and use the copy button beside it — the key is only shown once.`;
  }
  if (body.length > 64) {
    return `That key is ${key.length} characters, but a full key is 72. Check nothing extra was pasted along with it.`;
  }
  if (!/^[0-9a-f]{64}$/i.test(body)) {
    return 'That key contains characters a real key never has. Copy it again with the copy button on the Developer page.';
  }
  return null;
}

/**
 * @param {string} message
 * @param {'success'|'error'|'warn'|null} [variant]
 */
function showResult(message, variant = null) {
  el.result.textContent = message;
  el.result.className = `result${variant ? ` ${variant}` : ''}`;
  el.result.classList.remove('hidden');
}

async function load() {
  const settings = await getSettings();
  el.apiUrl.value = settings.apiBaseUrl;
  // Never render the stored key back into the field — show that one exists and
  // let the user overwrite it if they want to change it.
  el.apiKey.value = '';
  el.apiKey.placeholder = settings.apiKey ? `${settings.apiKey.slice(0, 12)}… (saved)` : 'sk_live_…';
  el.verifyBeforeAdd.checked = Boolean(settings.verifyBeforeAdd);
  el.appUrl.value = settings.appUrl || '';
  el.showBadge.checked = Boolean(settings.showBadge);
  el.autoTag.checked = Boolean(settings.autoTag);
  el.autoTagName.value = settings.autoTagName || '';
  el.autoTagName.disabled = !settings.autoTag;
  el.theme.value = await getThemeMode();
}

/**
 * host_permissions in the manifest covers localhost and the hosted API. A
 * self-hosted API on another domain needs a runtime grant, which must be
 * requested from a user gesture — hence doing it here on click.
 *
 * @param {string} baseUrl
 * @returns {Promise<boolean>} False if the user declined.
 */
async function ensureHostPermission(baseUrl) {
  const pattern = originPatternFor(baseUrl);
  if (!pattern) return true;

  // Requested with nothing awaited beforehand: chrome.permissions.request has
  // to run inside the click that triggered it, and an earlier `await` — even a
  // permissions.contains() check — breaks the gesture chain and makes it throw.
  // Requesting something already granted resolves true immediately.
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

async function save() {
  el.save.disabled = true;
  el.save.textContent = 'Testing…';

  try {
    const apiBaseUrl = normaliseBaseUrl(el.apiUrl.value);
    el.apiUrl.value = apiBaseUrl;

    const typedKey = el.apiKey.value.trim();
    const existing = await getSettings();
    const apiKey = typedKey || existing.apiKey;

    if (!apiKey) {
      showResult('Paste an API key first — create one in the app under Developer → API keys.', 'error');
      return;
    }

    if (typedKey) {
      const problem = describeKeyProblem(typedKey);
      if (problem) {
        showResult(problem, 'error');
        return;
      }
    }

    const granted = await ensureHostPermission(apiBaseUrl);
    if (!granted) {
      showResult(
        `Chrome needs permission to talk to ${new URL(apiBaseUrl).origin}. Save again and accept the prompt.`,
        'error'
      );
      return;
    }

    // Trailing slashes would double up in every deep link.
    const appUrl = el.appUrl.value.trim().replace(/\/+$/, '');
    el.appUrl.value = appUrl;

    await setSettings({ apiBaseUrl, apiKey, appUrl, verifyBeforeAdd: el.verifyBeforeAdd.checked });

    // A free-tier host that has spun down takes the better part of a minute to
    // answer. Say so, or a slow first connect looks like a hang.
    showResult(`Contacting ${new URL(apiBaseUrl).origin}…\n\nIf the server is on a free tier and has gone to sleep, waking it can take up to a minute. Leave this page open.`);

    const response = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' });

    if (!response?.ok) {
      let message = response?.error?.message || 'Connection test failed.';
      if (response?.error?.status === 401) {
        message +=
          `\n\nThe key being sent starts ${apiKey.slice(0, 16)}… — compare that with the list on your Developer page. ` +
          'If it is not there, or shows as Revoked, create a new one. If it is there and active, check the API URL above points at the same environment the key was created in.';
      }
      showResult(message, 'error');
      return;
    }

    const { campaignCount, canWrite } = response.data;

    if (!canWrite) {
      showResult(
        `Connected, and ${campaignCount} campaign(s) are visible — but this key is read-only, so adding and removing people will fail. Create a key with both read and write scopes.`,
        'warn'
      );
      return;
    }

    showResult(
      `Connected. ${campaignCount} campaign(s) on the account, and the key can add and remove people. You're ready to go.`,
      'success'
    );
    await load();
  } finally {
    el.save.disabled = false;
    el.save.textContent = 'Save & test connection';
  }
}

async function forget() {
  await clearApiKey();
  await load();
  showResult('Key forgotten on this machine. Revoke it in the app too if it may have leaked.', null);
}

el.save.addEventListener('click', () => {
  save().catch((err) => showResult(err?.message || 'Something went wrong.', 'error'));
});
el.forget.addEventListener('click', () => {
  forget().catch((err) => showResult(err?.message || 'Something went wrong.', 'error'));
});
el.useProduction.addEventListener('click', () => {
  el.apiUrl.value = DEFAULT_API_BASE;
  el.appUrl.value = DEFAULT_APP_URL;
});
el.useLocal.addEventListener('click', () => {
  el.apiUrl.value = LOCAL_API_BASE;
  el.appUrl.value = LOCAL_APP_URL;
});

// Offer a guess when the app URL is blank but the API URL implies one, so the
// common api.<domain> setup needs no typing.
el.apiUrl.addEventListener('change', () => {
  if (el.appUrl.value.trim()) return;
  const guess = guessAppUrl(normaliseBaseUrl(el.apiUrl.value));
  if (guess) el.appUrl.value = guess;
});

el.showBadge.addEventListener('change', () => {
  setSettings({ showBadge: el.showBadge.checked });
});
el.verifyBeforeAdd.addEventListener('change', () => {
  setSettings({ verifyBeforeAdd: el.verifyBeforeAdd.checked });
});
el.theme.addEventListener('change', () => {
  setThemeMode(/** @type {'light'|'dark'|'system'} */ (el.theme.value));
});
el.autoTag.addEventListener('change', () => {
  el.autoTagName.disabled = !el.autoTag.checked;
  setSettings({ autoTag: el.autoTag.checked });
});
el.autoTagName.addEventListener('change', () => {
  // Fall back to the default rather than storing a blank, which would silently
  // disable tagging while the checkbox still says it's on.
  const name = el.autoTagName.value.trim() || 'chrome-extension';
  el.autoTagName.value = name;
  setSettings({ autoTagName: name });
});

initTheme()
  .then(load)
  .catch((err) => showResult(err?.message || 'Failed to load settings.', 'error'));

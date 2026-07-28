/**
 * Options page: connect the extension to an account.
 *
 * Writes settings to chrome.storage and asks the service worker to do the
 * actual connection test, so this page never builds an authenticated request
 * itself.
 */

import {
  DEFAULT_API_BASE,
  LOCAL_API_BASE,
  getSettings,
  normaliseBaseUrl,
  originPatternFor,
  setSettings,
  clearApiKey,
} from '../lib/storage.js';

const el = {
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

  const origins = [pattern];
  if (await chrome.permissions.contains({ origins })) return true;

  try {
    return await chrome.permissions.request({ origins });
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

    if (typedKey && !typedKey.startsWith('sk_live_')) {
      showResult(
        'That does not look like a Sincerely API key. Keys start with "sk_live_" and come from Developer → API keys — a Supabase session token or anon key will not work here.',
        'error'
      );
      return;
    }

    const granted = await ensureHostPermission(apiBaseUrl);
    if (!granted) {
      showResult(
        `Chrome needs permission to talk to ${new URL(apiBaseUrl).origin}. Save again and accept the prompt.`,
        'error'
      );
      return;
    }

    await setSettings({ apiBaseUrl, apiKey, verifyBeforeAdd: el.verifyBeforeAdd.checked });

    // A free-tier host that has spun down takes the better part of a minute to
    // answer. Say so, or a slow first connect looks like a hang.
    showResult(`Contacting ${new URL(apiBaseUrl).origin}…\n\nIf the server is on a free tier and has gone to sleep, waking it can take up to a minute. Leave this page open.`);

    const response = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' });

    if (!response?.ok) {
      showResult(response?.error?.message || 'Connection test failed.', 'error');
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
});
el.useLocal.addEventListener('click', () => {
  el.apiUrl.value = LOCAL_API_BASE;
});
el.verifyBeforeAdd.addEventListener('change', () => {
  setSettings({ verifyBeforeAdd: el.verifyBeforeAdd.checked });
});

load().catch((err) => showResult(err?.message || 'Failed to load settings.', 'error'));

/**
 * Theme resolution, mirroring client/src/context/ThemeContext.tsx.
 *
 * The app stores 'light' | 'dark' | 'system' and toggles a `.dark` class on
 * <html>. The extension can't read the app's localStorage (different origin),
 * so it keeps its own copy of the same three-way choice in chrome.storage and
 * applies the class identically. Default is 'system'.
 */

/** @typedef {'light'|'dark'|'system'} ThemeMode */

const STORAGE_KEY = 'theme';

/** @returns {Promise<ThemeMode>} */
export async function getThemeMode() {
  const { [STORAGE_KEY]: mode } = await chrome.storage.local.get({ [STORAGE_KEY]: 'system' });
  return mode === 'light' || mode === 'dark' ? mode : 'system';
}

/** @param {ThemeMode} mode */
export async function setThemeMode(mode) {
  await chrome.storage.local.set({ [STORAGE_KEY]: mode });
  applyResolved(resolve(mode));
}

/**
 * @param {ThemeMode} mode
 * @returns {'light'|'dark'}
 */
function resolve(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** @param {'light'|'dark'} resolved */
function applyResolved(resolved) {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

/**
 * Apply the stored theme and keep following the OS while the page is open —
 * a popup left open across a system theme switch should track it, same as the
 * app does.
 */
export async function initTheme() {
  const mode = await getThemeMode();
  applyResolved(resolve(mode));

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', async () => {
    if ((await getThemeMode()) === 'system') applyResolved(resolve('system'));
  });

  // Changing the theme in options should repaint an open popup too.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) applyResolved(resolve(changes[STORAGE_KEY].newValue));
  });
}

/**
 * Where Chromium is.
 *
 * Every suite used to hardcode /opt/pw-browsers/chromium, which is true on the
 * machine these were written on and true nowhere else — so the whole browser
 * half of the suite was unrunnable on CI, or on anyone's laptop, without
 * editing ten files. Since nothing ran them automatically, that never came up.
 *
 * Order: an explicit CHROMIUM_PATH wins, then the local convention if it is
 * really there, then `undefined` — which hands the decision to Playwright's
 * own resolution of `channel: 'chromium'`, i.e. whatever `playwright install`
 * put down.
 */
import { existsSync } from 'node:fs';

const LOCAL = '/opt/pw-browsers/chromium';

export const CHROMIUM =
  process.env.CHROMIUM_PATH || (existsSync(LOCAL) ? LOCAL : undefined);

/**
 * Open an extension page, out of the way of the install-time options tab.
 *
 * On a fresh profile the service worker's onInstalled handler calls
 * openOptionsPage(), and Chrome will happily satisfy that by taking over a
 * blank tab that already exists — including the one a suite has just created
 * for itself. The navigation the test asked for then dies with "interrupted by
 * another navigation to .../options/options.html", or, worse, lands and is
 * quietly replaced a moment later.
 *
 * Whether that collision happens depends on which side of the handler the new
 * tab is created on, so a suite can pass for months and then fail on a commit
 * that touches nothing in this directory. It is not confined to one suite
 * either: every browser suite here creates its first page seconds after
 * launching a fresh persistent context, which is exactly the window.
 *
 * Retried rather than suppressed. Sending a first-run install straight to
 * setup is the extension working — nothing in it is usable without a key — and
 * a test that switches that off to stay green stops covering what ships.
 *
 * `init` runs after the tab exists and before it is navigated, which is where
 * pageerror listeners have to attach if they are to see load-time failures.
 */
export async function openExtensionPage(context, url, { init, attempts = 6 } = {}) {
  const page = await context.newPage();
  if (init) await init(page);

  let last = 'never navigated';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await page.goto(url);
      await page.waitForLoadState('domcontentloaded');
      // If the options tab is going to take this one, it does so about now.
      await page.waitForTimeout(150);
      if (page.url().startsWith(url)) return page;
      last = `landed on ${page.url()}`;
    } catch (error) {
      // Anything that is not the collision is a real failure of the thing
      // under test, and swallowing it would be worse than the flake.
      if (!/interrupted by another navigation/i.test(error.message)) throw error;
      last = error.message;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`${url} would not stay open after ${attempts} attempts — ${last}`);
}

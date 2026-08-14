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

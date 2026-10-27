/**
 * Copies the Geist weights the app uses out of the `geist` npm package, so the
 * extension ships the same typeface without a runtime call to Google Fonts.
 * Extensions should never depend on a remote font: it leaks a request per
 * page and simply fails offline.
 *
 *   node extension/tools/fetch-fonts.mjs extension/fonts
 *
 * Geist is under the SIL Open Font License; the licence travels with the files.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(process.argv[2] || 'extension/fonts');
const VERSION = '1.3.1';
mkdirSync(OUT, { recursive: true });

const work = mkdtempSync(join(tmpdir(), 'geist-'));
execFileSync('npm', ['pack', `geist@${VERSION}`, '--silent'], { cwd: work });
execFileSync('tar', ['xzf', `geist-${VERSION}.tgz`], { cwd: work });
const fonts = join(work, 'package', 'dist', 'fonts');

const files = [
  ['geist-sans/Geist-Regular.woff2', 'geist-400.woff2'],
  ['geist-sans/Geist-Medium.woff2', 'geist-500.woff2'],
  ['geist-sans/Geist-SemiBold.woff2', 'geist-600.woff2'],
  ['geist-sans/Geist-Bold.woff2', 'geist-700.woff2'],
  ['geist-mono/GeistMono-Regular.woff2', 'geist-mono-400.woff2'],
  ['geist-mono/GeistMono-Medium.woff2', 'geist-mono-500.woff2'],
];
for (const [from, to] of files) {
  copyFileSync(join(fonts, from), join(OUT, to));
  console.log(to);
}
copyFileSync(join(work, 'package', 'LICENSE.TXT'), join(OUT, 'GEIST-LICENSE.txt'));
console.log('GEIST-LICENSE.txt');

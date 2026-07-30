/**
 * Downloads the Inter weights the app uses, latin subset only, so the
 * extension can ship the same typeface without a runtime call to Google.
 * Extensions should never depend on a remote font: it leaks a request per
 * page and simply fails offline.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function grab(family, weights) {
  const url = `https://fonts.googleapis.com/css2?family=${family}:wght@${weights.join(';')}&display=swap`;
  const css = await fetch(url, { headers: { 'User-Agent': UA } }).then((r) => r.text());

  // Each weight appears once per unicode-range; keep the latin block only.
  const blocks = css.split('@font-face').slice(1);
  const wanted = [];

  for (const block of blocks) {
    const range = block.match(/unicode-range:\s*([^;]+);/)?.[1] || '';
    // The plain "latin" subset is the one containing U+0000-00FF.
    if (!/U\+0000-00FF/.test(range)) continue;
    const weight = block.match(/font-weight:\s*(\d+)/)?.[1];
    const src = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (weight && src) wanted.push({ weight, src });
  }

  for (const { weight, src } of wanted) {
    const bytes = Buffer.from(await fetch(src, { headers: { 'User-Agent': UA } }).then((r) => r.arrayBuffer()));
    const name = `${family.toLowerCase().replace(/\+/g, '-')}-${weight}.woff2`;
    writeFileSync(join(OUT, name), bytes);
    console.log(`${name}  ${(bytes.length / 1024).toFixed(1)} KB`);
  }
}

await grab('Inter', [400, 500, 600, 700]);
await grab('JetBrains+Mono', [400, 500]);

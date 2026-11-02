/**
 * Build the zip that goes to the Chrome Web Store.
 *
 *   node extension/tools/package.mjs [out.zip]
 *
 * The unpacked extension in this folder keeps its local-development hosts
 * (localhost:3001, localhost:5173), because the test suites drive it against
 * a mock API there. The store copy must not ask for them: a reviewer sees
 * "read and change your data on localhost" and asks why. So the manifest is
 * rewritten on the way into the zip, and tests/ and tools/ are left out.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const out = resolve(process.argv[2] || join(root, `sincerely-extension-${manifest.version}.zip`));

const isDev = (pattern) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(pattern);
manifest.host_permissions = (manifest.host_permissions || []).filter((p) => !isDev(p));
for (const cs of manifest.content_scripts || []) cs.matches = cs.matches.filter((p) => !isDev(p));
manifest.content_scripts = (manifest.content_scripts || []).filter((cs) => cs.matches.length > 0);

const stage = mkdtempSync(join(tmpdir(), 'sincerely-ext-'));
try {
  cpSync(root, stage, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(root.length).replace(/^[\\/]/, '');
      return !/^(tests|tools|node_modules)(\/|$)/.test(rel) && !rel.endsWith('.zip') && rel !== 'README.md';
    },
  });
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  rmSync(out, { force: true });
  execFileSync('zip', ['-qr', out, '.'], { cwd: stage });
  console.log(`${manifest.name} ${manifest.version} -> ${out}`);
  console.log(`hosts: ${manifest.host_permissions.join(', ')}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}

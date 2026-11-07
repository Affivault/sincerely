/*
 * Email signatures: the Gmail-style "which emails get it" setting, the
 * warnings the editor shows, image uploads, and the missing-column retry
 * that lets a save go through before migration 117 is run.
 */
import assert from 'node:assert';
import { resolveSignatureUse, signatureAppliesTo, signatureProblems, describeSignatureUse } from '@lemlist/shared';

process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
const { parseImageDataUrl } = await import('../src/services/signature-image.service.js');
const { stripMissingColumnKey } = await import('../src/services/smtp.service.js');

let failed = 0;
let passed = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

console.log('\nwhich emails get the signature');
is('an inbox from before 117 with "always add" reads as all', resolveSignatureUse({ signature_auto: true }) === 'all');
is('and without it as none', resolveSignatureUse({ signature_auto: false }) === 'none');
is('the stored setting wins over the old flag', resolveSignatureUse({ signature_use: 'replies', signature_auto: true }) === 'replies');
is('a nonsense value falls back to the flag', resolveSignatureUse({ signature_use: 'sometimes', signature_auto: false }) === 'none');
is('no inbox, no signature', resolveSignatureUse(null) === 'none');
is('all: new and replies', signatureAppliesTo('all', 'new') && signatureAppliesTo('all', 'reply'));
is('new only: not on replies', signatureAppliesTo('new', 'new') && !signatureAppliesTo('new', 'reply'));
is('replies only: not on new emails', !signatureAppliesTo('replies', 'new') && signatureAppliesTo('replies', 'reply'));
is('none: never on its own', !signatureAppliesTo('none', 'new') && !signatureAppliesTo('none', 'reply'));
is('each setting has words', ['all', 'new', 'replies', 'none'].every((u) => describeSignatureUse(u as any).length > 5));

console.log('\nwhat the editor warns about');
is('a clean signature has nothing to say', signatureProblems('<b>Alex</b> <a href="https://x.com">x</a>').length === 0);
is('a pasted-in image is called out', signatureProblems('<img src="data:image/png;base64,AAA" width="80" alt="x">').some((p) => /pasted in/.test(p.message)));
is('an http image is called out', signatureProblems('<img src="http://x.com/a.png" width="80" alt="x">').some((p) => /http:\/\//.test(p.message)));
is('an image with no width is mentioned', signatureProblems('<img src="https://x.com/a.png" alt="x">').some((p) => /width/.test(p.message)));
is('a link with no scheme is called out', signatureProblems('<a href="www.x.com">x</a>').some((p) => /link/i.test(p.message)));
is('mailto and tel links are fine', signatureProblems('<a href="mailto:a@b.co">a</a><a href="tel:+44">t</a>').length === 0);
is('over Gmail’s 10,000 characters is called out', signatureProblems('x'.repeat(10_001)).some((p) => /10,000/.test(p.message)));

console.log('\nsignature images');
const png = `data:image/png;base64,${Buffer.from('fakepngbytes').toString('base64')}`;
is('a small PNG is accepted', parseImageDataUrl(png).mime === 'image/png');
is('image/jpg is read as jpeg', parseImageDataUrl(`data:image/jpg;base64,${Buffer.from('x').toString('base64')}`).mime === 'image/jpeg');
is('SVG is refused (mail apps do not show it)', throws(() => parseImageDataUrl(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`)));
is('a non-image is refused', throws(() => parseImageDataUrl('hello')));
is('over 400 KB is refused', throws(() => parseImageDataUrl(`data:image/png;base64,${Buffer.alloc(401 * 1024).toString('base64')}`)));

console.log('\nsaving before migration 117 is run');
const row1: Record<string, any> = { signature_use: 'new', label: 'x' };
is('PostgREST’s wording drops the missing column', stripMissingColumnKey("Could not find the 'signature_use' column of 'smtp_accounts' in the schema cache", row1) && !('signature_use' in row1));
const row2: Record<string, any> = { reply_to: 'a' };
is('Postgres’s wording still does', stripMissingColumnKey('column "reply_to" of relation "smtp_accounts" does not exist', row2) && !('reply_to' in row2));
is('an unrelated error is not retried', !stripMissingColumnKey('permission denied', { label: 'x' }));

console.log(`\n${passed} passed, ${failed} failed`);
assert.equal(failed, 0, `${failed} signature check(s) failed`);

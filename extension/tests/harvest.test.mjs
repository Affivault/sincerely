/** Unit tests for the harvesting parser — the part most likely to be wrong. */
import {
  classifyEmail,
  decodeCfEmail,
  deobfuscate,
  extractFromHtml,
  nameFor,
  promisingLinks,
  rankResults,
} from '../lib/harvest.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
};

/* ---- Cloudflare ---- */

/** Encode the way Cloudflare does, so the decoder is tested against real input. */
function cfEncode(email, key = 0x2a) {
  let hex = key.toString(16).padStart(2, '0');
  for (const char of email) hex += (char.charCodeAt(0) ^ key).toString(16).padStart(2, '0');
  return hex;
}

check(
  'decodes a Cloudflare-protected address',
  decodeCfEmail(cfEncode('jane.doe@acme.com')) === 'jane.doe@acme.com',
  decodeCfEmail(cfEncode('jane.doe@acme.com'))
);
check('rejects non-hex cfemail payloads', decodeCfEmail('zzzz') === null);
check('rejects a cfemail payload that decodes to junk', decodeCfEmail(cfEncode('not an email')) === null);

/* ---- Obfuscation ---- */

check(
  'undoes "(at)" and "(dot)"',
  /jane@acme\.com/.test(deobfuscate('jane (at) acme (dot) com')),
  deobfuscate('jane (at) acme (dot) com')
);
check(
  'undoes spelled-out at/dot',
  /jane@acme\.com/.test(deobfuscate('jane at acme dot com')),
  deobfuscate('jane at acme dot com')
);
check(
  'undoes [at] with brackets',
  /jane@acme\.com/.test(deobfuscate('jane [at] acme [dot] com')),
  deobfuscate('jane [at] acme [dot] com')
);
check(
  'decodes @ and . written as HTML entities',
  /jane@acme\.com/.test(deobfuscate('jane&#64;acme&#46;com')),
  deobfuscate('jane&#64;acme&#46;com')
);
check(
  'strips zero-width padding inside an address',
  /jane@acme\.com/.test(deobfuscate('jane​@​ackme.com'.replace('acme', 'acme'))) ||
    /jane@acme\.com/.test(deobfuscate('ja​ne@ac​me.com')),
  deobfuscate('ja​ne@ac​me.com')
);

/* ---- Classification ---- */

check('a personal address is a person', classifyEmail('jane.doe@acme.com') === 'person');
check('info@ is generic, not discarded', classifyEmail('info@acme.com') === 'generic');
check('no-reply@ is a role account', classifyEmail('no-reply@acme.com') === 'role');
check('an image filename is not an address', classifyEmail('logo@2x.png') === null);
check('a tracking domain is discarded', classifyEmail('abc@googletagmanager.com') === null);
check('a long hex local part is discarded', classifyEmail('a1b2c3d4e5f60718@acme.com') === null);
check('a real company on a noisy-looking domain survives', classifyEmail('jane@google.com') === 'person');

/* ---- Name attribution ---- */

check(
  'takes the name from text just before the address',
  JSON.stringify(nameFor('x@acme.com', 'Our team. Jane Doe, Head of Trading — ')) ===
    JSON.stringify({ first_name: 'Jane', last_name: 'Doe' }),
  JSON.stringify(nameFor('x@acme.com', 'Our team. Jane Doe, Head of Trading — '))
);
check(
  'falls back to the shape of the local part',
  JSON.stringify(nameFor('ben.oyelaran@acme.com', 'no name here')) ===
    JSON.stringify({ first_name: 'Ben', last_name: 'Oyelaran' })
);
check(
  'a job title next to an address is not mistaken for a name',
  JSON.stringify(nameFor('x@acme.com', 'Ana Silva. Managing Partner — ')) ===
    JSON.stringify({ first_name: 'Ana', last_name: 'Silva' }),
  JSON.stringify(nameFor('x@acme.com', 'Ana Silva. Managing Partner — '))
);
check(
  'takes the nearest person when a page lists several',
  JSON.stringify(nameFor('x@acme.com', 'Ana Silva. Ben Oyelaran. ')) ===
    JSON.stringify({ first_name: 'Ben', last_name: 'Oyelaran' }),
  JSON.stringify(nameFor('x@acme.com', 'Ana Silva. Ben Oyelaran. '))
);
check(
  'gives up rather than inventing a name',
  JSON.stringify(nameFor('info@acme.com', 'Contact us')) ===
    JSON.stringify({ first_name: null, last_name: null }),
  JSON.stringify(nameFor('info@acme.com', 'Contact us'))
);

/* ---- Whole-page extraction ---- */

const PAGE = `<!doctype html><html><body>
  <h1>Our team</h1>
  <div class="member"><strong>Jane Doe</strong><span>Head of Trading</span>
    <a href="mailto:jane.doe@acme.com">Email Jane</a></div>
  <div class="member"><strong>Ben Oyelaran</strong>
    <a class="__cf_email__" data-cfemail="${cfEncode('ben@acme.com')}">[email&#160;protected]</a></div>
  <div class="member">Cara Dunne — cara (at) acme (dot) com</div>
  <p>General enquiries: info&#64;acme&#46;com</p>
  <p>Do not reply: no-reply@acme.com</p>
  <img src="sprite@2x.png" alt="">
  <script>var t="tracking@googletagmanager.com";</script>
</body></html>`;

const extracted = extractFromHtml(PAGE, 'https://acme.com/team');
const emails = extracted.map((r) => r.email).sort();

check(
  'finds the mailto address',
  emails.includes('jane.doe@acme.com'),
  JSON.stringify(emails)
);
check('finds the Cloudflare-protected address', emails.includes('ben@acme.com'), JSON.stringify(emails));
check('finds the (at)/(dot) address', emails.includes('cara@acme.com'), JSON.stringify(emails));
check('finds the entity-encoded address', emails.includes('info@acme.com'), JSON.stringify(emails));
check('keeps the role address rather than dropping it', emails.includes('no-reply@acme.com'));
check('ignores the image filename', !emails.some((e) => e.includes('sprite')), JSON.stringify(emails));
check(
  'ignores addresses inside script tags on tracking domains',
  !emails.some((e) => e.includes('googletagmanager')),
  JSON.stringify(emails)
);
check(
  'attributes the name next to the address',
  extracted.find((r) => r.email === 'jane.doe@acme.com')?.first_name === 'Jane'
);
check(
  'records which page each address came from',
  extracted.every((r) => r.source_url === 'https://acme.com/team')
);

/* ---- Ranking ---- */

const ranked = rankResults(extracted);
check('named people rank above shared inboxes', ranked[0].kind === 'person', ranked[0].email);
check('role accounts rank last', ranked[ranked.length - 1].kind === 'role', ranked[ranked.length - 1].email);

/* ---- Link discovery ---- */

const LINKS = `<a href="/contact">Contact</a>
  <a href="/about-us">About</a>
  <a href="https://twitter.com/acme">Twitter</a>
  <a href="/blog/post-1">Blog</a>
  <a href="/team/">Team</a>
  <a href="/style.css">css</a>
  <a href="/contact">Contact again</a>`;
const links = promisingLinks(LINKS, 'https://acme.com/');

check('follows contact and about links', links.some((l) => l.endsWith('/contact')) && links.some((l) => l.endsWith('/about-us')));
check('follows a team link', links.some((l) => l.includes('/team')));
check('does not follow off-site links', !links.some((l) => l.includes('twitter.com')), JSON.stringify(links));
check('does not follow uninteresting pages', !links.some((l) => l.includes('/blog/')), JSON.stringify(links));
check('does not follow assets', !links.some((l) => l.endsWith('.css')));
check('deduplicates repeated links', new Set(links).size === links.length);

console.log(failed === 0 ? '\nharvest parser: all checks passed' : `\nharvest parser: ${failed} failed`);
process.exit(failed ? 1 : 0);

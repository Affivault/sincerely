/* ═══════════════════════════════════════════════════════════════════════
   Moments: who to email today, and why - from the account's own data and
   the websites of companies it already has people at.

   Run: npx tsx scripts/signals-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  comeBackDate, signalScore, isoWeek, pageText, addedText, pageFingerprint, findWatchPages, robotsAllows,
  SIGNAL_KINDS, SIGNAL_KIND_LABELS, writingProblems, NOT_NOW_DEFAULT_DAYS,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');
const shared = (p: string) => readFileSync(join(here, '../../shared/src', p), 'utf8');

console.log('\n"not now" - and when to come back');
{
  const at = '2026-10-09T10:00:00Z';
  const due = (t: string) => comeBackDate(t, at).due;
  is('next quarter is the start of the next quarter', due('Try me next quarter.') === '2027-01-01', due('Try me next quarter.'));
  is('Q2 is the next April', due('Can we revisit in Q2?') === '2027-04-01', due('Can we revisit in Q2?'));
  is('Q4 already started means next year\'s', due('maybe Q4') === '2027-10-01', due('maybe Q4'));
  is('in a couple of months', due("Let's talk in a couple of months") === '2026-12-08', due("Let's talk in a couple of months"));
  is('in 3 weeks', due('Ping me in 3 weeks') === '2026-10-30', due('Ping me in 3 weeks'));
  is('after the summer is September', due('after the summer works') === '2027-09-01', due('after the summer works'));
  is('in January', due('Get back to me in January') === '2027-01-01', due('Get back to me in January'));
  is('next year', due('Budget is set until next year') === '2027-01-10', due('Budget is set until next year'));
  const none = comeBackDate('Not right now, thanks.', at);
  is(`no time given means about ${NOT_NOW_DEFAULT_DAYS} days`, none.due === '2027-01-07' && none.phrase === null, JSON.stringify(none));
  is('the words are kept for the headline', comeBackDate('Try me next quarter.', at).phrase === 'next quarter');
}

console.log('\nwhat comes first');
{
  const now = Date.parse('2026-10-09T12:00:00Z');
  is('strength counts', signalScore(3, '2026-10-09T12:00:00Z', now) === 3 && signalScore(1, '2026-10-09T12:00:00Z', now) === 1);
  is('a week halves it', Math.abs(signalScore(2, '2026-10-02T12:00:00Z', now) - 1) < 0.01);
  is('a strong moment last week ranks with a good one today', Math.abs(signalScore(3, '2026-10-02T12:00:00Z', now) - 1.5) < 0.01);
  is('weeks are ISO weeks', isoWeek('2026-10-09T12:00:00Z') === '2026-W41' && isoWeek('2027-01-01T00:00:00Z') === '2026-W53');
  is('every kind has a label', SIGNAL_KINDS.every((k) => !!SIGNAL_KIND_LABELS[k]));
}

console.log('\nreading a page, and what changed');
{
  const html = '<html><head><title>x</title><style>.a{}</style></head><body><nav><a href="/">Home</a></nav><script>track()</script><h1>Careers</h1><ul><li>Head of Operations, Leeds</li><li>Support Lead</li></ul><p>&copy; 2026 Acme &amp; Co</p></body></html>';
  const text = pageText(html);
  is('scripts and styles are not words', !/track\(\)|\.a\{\}/.test(text));
  is('blocks become lines', text.split('\n').includes('Head of Operations, Leeds'));
  is('entities are decoded', /Acme & Co/.test(text));
  const before = 'Careers\nSupport Lead\nPosted 3 days ago\n© 2025 Acme';
  const after = 'Careers\nSupport Lead\nPosted 5 days ago\n© 2026 Acme\nHead of Operations, Leeds';
  is('only the new line is new', addedText(before, after) === 'Head of Operations, Leeds', JSON.stringify(addedText(before, after)));
  is('a page that only changed its numbers has not changed', pageFingerprint('Posted 3 days ago\n© 2025') === pageFingerprint('Posted 5 days ago\n© 2026'));
  is('a page with new words has', pageFingerprint('Support Lead') !== pageFingerprint('Support Lead\nHead of Ops'));

  const home = `<a href="/careers">Careers</a><a href="/about/careers/open-roles">All roles</a><a href="https://acme.com/news">News</a>
    <a href="https://boards.greenhouse.io/acme">Jobs</a><a href="https://techcrunch.com/news/acme">Press</a><a href="mailto:x@acme.com">Mail</a>`;
  const pages = findWatchPages(home, 'https://acme.com/', 'acme.com');
  const careers = pages.find((p) => p.kind === 'careers')?.url;
  const news = pages.find((p) => p.kind === 'news')?.url;
  is('the careers page is found, shortest path first', careers === 'https://acme.com/careers', careers);
  is('the news page is found on their own site', news === 'https://acme.com/news', news);
  is('a job board counts for careers', findWatchPages('<a href="https://jobs.lever.co/acme">Join us</a>', 'https://acme.com/', 'acme.com')[0]?.url === 'https://jobs.lever.co/acme');
  is('someone else\'s site never counts for news', !findWatchPages('<a href="https://techcrunch.com/news/acme">News</a>', 'https://acme.com/', 'acme.com').length);
}

console.log('\nrobots.txt is respected');
{
  is('no robots.txt means yes', robotsAllows('', '/careers'));
  is('Disallow: / means no', !robotsAllows('User-agent: *\nDisallow: /', '/careers'));
  is('the longest rule wins', robotsAllows('User-agent: *\nDisallow: /\nAllow: /careers', '/careers/ops'));
  is('a group for us beats the general one', !robotsAllows('User-agent: *\nAllow: /\n\nUser-agent: SincerelyBot\nDisallow: /news', '/news/1'));
  is('an empty Disallow allows everything', robotsAllows('User-agent: *\nDisallow:', '/anything'));
}

console.log('\nwhat Relay may say');
{
  const svc = src('services/signals.service.ts');
  const tpl = svc.slice(svc.indexOf('export function momentTemplate'), svc.indexOf('export const signalsService'));
  const kinds = [...tpl.matchAll(/^\s{4}(\w+): \{ subject:/gm)].map((m) => m[1]);
  is('a plain email exists for every kind', SIGNAL_KINDS.every((k) => kinds.includes(k)), kinds.join(','));
  const copy = [...tpl.matchAll(/`((?:[^`\\]|\\.)*)`|'((?:[^'\\\n]|\\.)*)'/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ' ').replace(/\\n/g, '\n')).join('\n');
  is('the plain emails are read', /Picking it up as promised/.test(copy) && /Tuesday or Thursday afternoon/.test(copy));
  is('the plain emails meet the writing standard', writingProblems(copy).length === 0, writingProblems(copy).join(' | '));
  is('they never mention opens, clicks or tracking', !/\b(open(ed|s)?|click(ed|s)?|track|saw you|noticed you)\b/i.test(copy));
  const ai = src('services/ai.service.ts');
  is('nor does Relay\'s draft', /Never mention tracking, opens or clicks/.test(ai) && /Do not say how you found out/.test(ai));
  is('a website change is judged strictly, against this account\'s offer', /Be strict/.test(ai) && /what the salesperson sells/.test(ai) && /When in doubt, it is not relevant/.test(ai));
  is('topics are suggested from the account\'s own offer', /Given what they sell, list 4 to 6 changes/.test(ai));
  is('no industry is built in', !/\b(ISA|broker|forex|affiliate)\b/i.test(shared('signals.ts')) && !/\b(ISA|broker|forex|affiliate)\b/i.test(svc));
}

console.log('\nthe watcher');
{
  const svc = src('services/signals.service.ts');
  is('a judgement must quote the page, or it is not shown', /if \(!squash\(added\)\.includes\(squash\(verdict\.quote\)\)\) continue;/.test(svc));
  is('robots.txt is checked before reading', /robotsAllows\(robots\.get\(url\.origin\)/.test(svc));
  is('pages are read through the guarded fetch', /await safeGetText\(page\.url\)/.test(svc) && !/\bfetch\(/.test(svc));
  is('it is bounded per run', /const PAGES_PER_RUN = 20;/.test(svc) && /const JUDGEMENTS_PER_RUN = 10;/.test(svc) && /\.limit\(PAGES_PER_RUN\)/.test(svc));
  is('weekly per page', /const PAGE_EVERY_MS = 7 \* DAY;/.test(svc));
  is('it needs the switch, a topic, Claude and an offer', /if \(!web \|\| !on\.length \|\| !aiAvailable\(\)\) return 0;/.test(svc) && /if \(!offer\) return 0;/.test(svc));
  is('only companies with someone reachable are watched', /\.eq\('is_unsubscribed', false\)\.eq\('is_bounced', false\)/.test(svc));
  is('a first read is a baseline, except careers', /if \(!page\.fingerprint\) added = page\.kind === 'careers'/.test(svc));
  is('a page that keeps failing is left alone', /\.lt\('failures', MAX_FAILURES\)/.test(svc));
  const fetcher = src('utils/safe-fetch.ts');
  is('the fetcher refuses private addresses, on every hop', /addresses\.some\(isPrivateOrReservedIp\)/.test(fetcher) && /for \(let hop = 0; hop <= MAX_REDIRECTS; hop\+\+\)/.test(fetcher) && /const ok = await check\(current\);/.test(fetcher));
  is('and pins the connection to the checked address', /lookup: pinnedLookup\(addresses\)/.test(fetcher));
  is('and caps what it reads', /size > maxBytes/.test(fetcher));
  is('carrier-grade NAT counts as private', /a === 100 && b >= 64 && b <= 127/.test(src('services/webhook.service.ts')));
}

console.log('\nown data');
{
  const svc = src('services/signals.service.ts');
  is('six detectors, each failing alone', (svc.match(/\['(re_engaged|not_now_due|lost_deal_return|company_buzz|stalled_positive|left_company)', \(\) =>/g) || []).length === 6 && /try \{ raised \+= await raise/.test(svc));
  is('opens alone need two different days', /e\.clicks > 0 \|\| e\.days\.size >= 2/.test(svc));
  is('reading again means two quiet weeks first', /if \(quietDays < 14\) continue;/.test(svc));
  is('a "not now" with anything said since is not raised', /Anything said since, in either direction/.test(svc));
  is('a moment is raised once', /onConflict: 'user_id,dedupe_key', ignoreDuplicates: true/.test(svc));
  is('people who unsubscribed or bounced are never suggested', (svc.match(/is_unsubscribed \|\| c\.is_bounced/g) || []).length >= 4);
  is('someone who left is not who you write to', /contactOk && row\.kind !== 'left_company' \? person\(row\.contact\) : null/.test(svc));
  is('writing to a colleague must be someone at that company', /That person is not at this company/.test(svc));
  is('adding to a campaign makes the moment their first line', /first_line: row\.opener/.test(svc) && /campaignContactsService\.add\(campaign\.id, \[c\.id\]\)/.test(svc));
  is('the campaign must be theirs', /from\('campaigns'\)\.select\('id, name, status'\)\.eq\('id', input\.campaign_id\)\.eq\('user_id', userId\)/.test(svc));
}

console.log('\nwhere it lives');
{
  is('the routes are mounted behind sign-in', /routes\.use\('\/signals', signalsRoutes\)/.test(src('routes/index.ts')) && src('routes/index.ts').indexOf('routes.use(authMiddleware)') < src('routes/index.ts').indexOf("routes.use('/signals'"));
  is('hourly, with a heartbeat', /beat\('signals', tick\)/.test(src('jobs/schedulers/signals.scheduler.ts')) && /startSignalsScheduler\(\)/.test(src('index.ts')));
  is('system status knows the job', /id: 'signals', label: 'Moments'/.test(shared('system-status.ts')));
  is('a Home tab, next to Flow', /label: 'Moments', href: '\/moments'/.test(client('lib/sections.ts')) && /path="\/moments"/.test(client('App.tsx')));
  const page = client('pages/moments/MomentsPage.tsx');
  is('each moment shows its evidence', /m\.evidence_quote/.test(page) && /rel="noopener noreferrer"/.test(page));
  is('write, add, or dismiss with undo', /Write email/.test(page) && /Add to campaign/.test(page) && /useDeferredAction/.test(page));
  is('switching on watching suggests what to watch for', /if \(on && s\.topics\.length === 0\) suggest\.mutate\(\);/.test(page));
  const migration = readFileSync(join(here, '../../supabase/migrations/083_signals.sql'), 'utf8');
  is('migration 083: moments, pages, settings', /create table if not exists signals/.test(migration) && /create table if not exists company_pages/.test(migration) && /signals_web boolean not null default false/.test(migration));
  is('website watching is off until switched on', /signals_web boolean not null default false/.test(migration));
  is('the migration is ASCII with no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(begin|commit)\s*;/im.test(migration));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

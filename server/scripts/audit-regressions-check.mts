/* ═══════════════════════════════════════════════════════════════════════
   The bugs a full-repo audit found, held shut.

   Each of these failed silently in production: nothing threw, a page
   simply showed the wrong thing or a job simply never ran. That is the
   kind of bug that comes back without anyone noticing, so each gets an
   assertion here - behavioural where the code can be driven without a
   database, and against the source where the bug was a wiring mistake.

   Run: npx tsx scripts/audit-regressions-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const srv = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const cli = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

console.log('one router per path');
{
  // Two routers on one path answer GET / in mount order, so the second is
  // unreachable. That is how the segment revenue report received the list
  // of saved segments instead of a report.
  const index = srv('routes/index.ts');
  const mounts = [...index.matchAll(/routes\.use\('([^']+)'/g)].map((m) => m[1]);
  const dupes = mounts.filter((p, i) => mounts.indexOf(p) !== i);
  is('no path is mounted twice', dupes.length === 0, dupes.join(', '));
  is('the revenue report has its own path', mounts.includes('/segment-revenue'));
  is('and the client asks it there', /'\/segment-revenue'/.test(cli('api/segments.api.ts')));
}

console.log('\nscheduled campaigns start');
{
  const seq = srv('services/sequence.service.ts');
  const worker = srv('jobs/workers/sequence.worker.ts');
  is('something promotes a due scheduled campaign to running',
     /export async function promoteDueScheduledCampaigns/.test(seq)
     && /\.eq\('status', 'scheduled'\)/.test(seq.slice(seq.indexOf('promoteDueScheduledCampaigns'))));
  is('and the worker runs it', /promoteDueScheduledCampaigns/.test(worker));
  is('a failing stage cannot starve the others',
     (worker.match(/await stage\(/g) || []).length >= 4);

  const campaigns = srv('services/campaigns.service.ts');
  const pause = campaigns.slice(campaigns.indexOf('async pause('), campaigns.indexOf('async resume('));
  is('a scheduled campaign can be held', /'scheduled'/.test(pause));
  const cancel = campaigns.slice(campaigns.indexOf('async cancel('), campaigns.indexOf('async clone('));
  is('and called off', /'scheduled'/.test(cancel));
}

console.log('\nlaunch is the only way to start a campaign');
{
  const campaigns = srv('services/campaigns.service.ts');
  const list = campaigns.slice(
    campaigns.indexOf('const UPDATABLE_CAMPAIGN_FIELDS'),
    campaigns.indexOf(']);', campaigns.indexOf('const UPDATABLE_CAMPAIGN_FIELDS')),
  );
  is('status is not a writable field', !/'status'/.test(list), list);
  is('a lifetime bounce rate does not wall off every future launch',
     /ACKNOWLEDGEABLE = new Set\(\['bounce_rate', 'capacity'\]\)/.test(campaigns));
}

console.log('\na restart does not hand out a second day of sending');
{
  const sse = srv('services/sse.service.ts');
  const reset = sse.slice(sse.indexOf('export async function resetDailySendCounts'));
  is('the daily reset is guarded by the row, not by process memory',
     /last_send_reset_at\.lt\./.test(reset.slice(0, 1200)));
  is('and both counters move together',
     /sends_today: 0/.test(reset.slice(0, 1200)) && /warmup_sent_today: 0/.test(reset.slice(0, 1200)));
}

console.log('\nevery lifecycle written is one the database accepts');
{
  // CHECK (lifecycle IN ('prospect', 'contact', 'customer')) - anything else
  // fails the write, and every caller here swallows the failure.
  const booking = srv('services/booking.service.ts');
  const written = [...booking.matchAll(/lifecycle: '([a-z_]+)'/g)].map((m) => m[1]);
  is('the booking page only writes real lifecycles',
     written.every((v) => ['prospect', 'contact', 'customer'].includes(v)), written.join(', '));
}

console.log('\nreplies go to the other person');
{
  const inbox = srv('services/inbox.service.ts');
  is('a reply is addressed by direction',
     /function replyRecipient/.test(inbox) && /original\.direction === 'outbound' \? original\.to_email : original\.from_email/.test(inbox));
  is('and never straight to from_email', !/to: original\.from_email/.test(inbox));
  is('archive reaches the server the sync reads', /imapHostFor\(account\)/.test(inbox));
  is('a failed scheduled send is kept, not passed off as sent',
     /sara_status: isTransient \? 'scheduled' : 'failed'/.test(inbox));
}

console.log('\nlong id lists are asked in slices');
{
  const { chunk, selectInChunks, fetchAllPages, IN_CHUNK } = await import('../src/utils/batch.js');
  const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
  is('four hundred and fifty ids make three slices', chunk(ids).length === 3 && IN_CHUNK === 200);

  const seen: number[] = [];
  const rows = await selectInChunks(ids, async (slice) => {
    seen.push(slice.length);
    return { data: slice.map((id) => ({ id })), error: null };
  });
  is('every slice is asked, and every row comes back',
     rows.length === 450 && seen.join(',') === '200,200,50', seen.join(','));

  let threw = false;
  await selectInChunks(ids, async () => ({ data: null, error: { message: 'too long' } })).catch(() => { threw = true; });
  is('a refused slice is an error, not an empty answer', threw);

  let calls = 0;
  const paged = await fetchAllPages(async (from, to) => {
    calls++;
    const total = 2350;
    const n = Math.max(0, Math.min(to, total - 1) - from + 1);
    return { data: Array.from({ length: n }, (_, i) => from + i), error: null };
  });
  is('paging reads past the first thousand', paged.length === 2350 && calls === 3, `${paged.length} in ${calls}`);

  const contacts = srv('services/contacts.service.ts');
  is('a list filter is a join, not an id list',
     /in_list:list_contacts!inner\(list_id\)/.test(contacts)
     && !/\.from\('list_contacts'\)\s*\.select\('contact_id'\)\s*\.eq\('list_id', params\.list_id\)/.test(contacts));
  const exp = contacts.slice(contacts.indexOf('async export('), contacts.indexOf('async verificationBreakdown('));
  is('an export pages rather than stopping at 1,000', /fetchAllPages/.test(exp));
}

console.log('\nsigning in returns you to where you were going');
{
  const { safeReturnPath } = await import('../../client/src/lib/returnTo.ts');
  is('an in-app path is kept, with its query', safeReturnPath('/inbox?message=abc') === '/inbox?message=abc');
  is('another site is not', safeReturnPath('https://evil.example/') === null);
  is('nor a protocol-relative one', safeReturnPath('//evil.example') === null);
  is('nor a backslash trick', safeReturnPath('/\\evil.example') === null);
  is('nor the sign-in page itself', safeReturnPath('/login?x=1') === null);
  is('the guard remembers the way back', /rememberReturnTo\(/.test(cli('App.tsx')));
}

console.log('\na calendar day is the day it says, west of Greenwich too');
{
  // Where the bug showed: UTC midnight on the 30th is the 29th here.
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  const { parseDay, formatDate } = await import('@lemlist/shared');
  const d = parseDay('2026-09-30');
  is('a bare date is that day, locally', !!d && d.getDate() === 30 && d.getMonth() === 8, String(d));
  is('and formats as that day', /30/.test(formatDate('2026-09-30')), formatDate('2026-09-30'));
  const instant = parseDay('2026-09-30T00:00:00Z');
  is('an instant still means the instant', !!instant && instant.getTime() === Date.UTC(2026, 8, 30));
  if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;

  const triage = srv('services/triage.service.ts');
  is('a follow-up is stored as an instant, not a bare date',
     !/due_date: due\.toISOString\(\)\.slice\(0, 10\)/.test(triage));
}

console.log('\nsecond pass: what else failed quietly');
{
  const schedules = srv('services/sending-schedules.service.ts');
  is('deleting the default schedule names a new default', /set_default_sending_schedule/.test(schedules.slice(schedules.indexOf('delete('))));
  const team = srv('services/team.service.ts');
  const accept = team.slice(team.indexOf('acceptInvite'));
  is('an invite is only used up once the membership is written',
     accept.indexOf('if (joinError)') > 0
     && accept.indexOf('if (joinError)') < accept.indexOf(".from('team_invites').delete()"));
  is('a template keeps its plain-text body', /body_text/.test(srv('services/template.service.ts')));
  const mail = srv('services/booking-mail.service.ts');
  is('a booking confirmation is sent from a verified mailbox, never a seed',
     /is_verified/.test(mail) && /is_seed/.test(mail));
  const finder = srv('services/email-finder.service.ts');
  is('the email finder resolves over HTTPS, where port 53 is blocked',
     /resolveDoh\(/.test(finder) && !/from 'node:dns'|from 'dns'/.test(finder));
  const analytics = srv('services/analytics.service.ts');
  is('analytics joins on the owner instead of listing every campaign id',
     /campaigns!inner\(user_id\)/.test(analytics) && !/\.in\('campaign_id', campaignIds\)/.test(analytics));
  const verification = srv('services/verification.service.ts');
  const batch = verification.slice(verification.indexOf('export async function batchVerify'));
  is('a failed batch lookup is an error, not "nothing to verify"', /selectErr/.test(batch.slice(0, 1500)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

/* ═══════════════════════════════════════════════════════════════════════
   Is everything running - and would we find out if not?

   - every background job beats, through one wrapper, at its schedule
   - a heartbeat is read fairly: one slow tick is not an outage, a stuck
     run is not "healthy", an erroring job is "failing"
   - the account's own quiet failures are found, and told once

   Run: npx tsx scripts/system-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOBS, jobHealth, overallLevel, type JobBeat, type StatusJob } from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

console.log('\nevery job beats');
{
  const dirs = ['jobs/schedulers', 'jobs/workers'];
  const files = dirs.flatMap((d) => readdirSync(join(here, '../src', d)).map((f) => `${d}/${f}`));
  for (const f of files) {
    const s = src(f);
    const timers = (s.match(/set(Interval|Timeout)\(/g) || []).length;
    const wrapped = (s.match(/set(Interval|Timeout)\(\(\) => beat\('/g) || []).length;
    // Delays that are not a tick (a setTimeout for something else) are allowed only when every interval is wrapped.
    const intervals = (s.match(/setInterval\(/g) || []).length;
    const wrappedIntervals = (s.match(/setInterval\(\(\) => beat\('/g) || []).length;
    is(`${f}: every schedule is wrapped`, intervals === wrappedIntervals && wrapped >= intervals, `${wrapped}/${timers} timers, ${wrappedIntervals}/${intervals} intervals`);
  }
  const ids = new Set(JOBS.map((j) => j.id));
  const used = new Set<string>();
  for (const f of files) for (const m of src(f).matchAll(/beat\('([a-z_]+)'/g)) used.add(m[1]);
  is('every beat names a known job', [...used].every((u) => ids.has(u as any)), [...used].join(','));
  is('every known job beats somewhere', [...ids].every((i) => used.has(i)), [...ids].filter((i) => !used.has(i)).join(','));
  const hb = src('utils/heartbeat.ts');
  is('an overlapping tick does not count as a run', /if \(inFlight\.has\(job\)\) return;/.test(hb));
  is('a heartbeat that cannot be written never stops the job', /persist\(b\)\.catch\(\(\) => \{\}\)/.test(hb));
  is('a database without the table still answers from memory', /tableMissing = true/.test(hb) && /for \(const \[job, b\] of memory\)/.test(hb));
}

console.log('\na heartbeat is read fairly');
{
  const now = Date.UTC(2026, 8, 1, 12);
  const beat = (finishedMinsAgo: number | null, extra: Partial<JobBeat> = {}): JobBeat => ({
    job: 'sending', last_started_at: finishedMinsAgo === null ? null : new Date(now - finishedMinsAgo * 60_000 - 1000).toISOString(),
    last_finished_at: finishedMinsAgo === null ? null : new Date(now - finishedMinsAgo * 60_000).toISOString(),
    last_ok_at: finishedMinsAgo === null ? null : new Date(now - finishedMinsAgo * 60_000).toISOString(),
    last_error: null, last_error_at: null, duration_ms: 1000, ...extra,
  });
  const five = 5 * 60_000;
  is('just ran: ok', jobHealth(beat(1), five, now) === 'ok');
  is('one slow tick is not a problem', jobHealth(beat(9), five, now) === 'ok');
  is('three missed beats: behind', jobHealth(beat(16), five, now) === 'late');
  is('six missed beats: stopped', jobHealth(beat(31), five, now) === 'stalled');
  is('never ran: starting, not an outage', jobHealth(null, five, now) === 'never');
  is('started long ago and never finished: stopped',
     jobHealth({ ...beat(null), last_started_at: new Date(now - 40 * 60_000).toISOString() }, five, now) === 'stalled');
  const erroring = beat(1, { last_ok_at: new Date(now - 20 * 60_000).toISOString(), last_error: 'boom', last_error_at: new Date(now - 60_000).toISOString() });
  is('runs but errors every time: failing', jobHealth(erroring, five, now) === 'failing');
  const oneError = beat(1, { last_ok_at: new Date(now - 6 * 60_000).toISOString(), last_error: 'blip', last_error_at: new Date(now - 60_000).toISOString() });
  is('one error after a good run: still ok', jobHealth(oneError, five, now) === 'ok');

  const job = (id: string, core: boolean, health: any): StatusJob => ({ id: id as any, label: id, what: '', core, health, last_ok_at: null, last_error: null, every_ms: five });
  is('all running, no issues: ok', overallLevel([job('sending', true, 'ok')], []) === 'ok');
  is('a background extra behind: attention', overallLevel([job('placement', false, 'late')], []) === 'attention');
  is('sending stopped: down', overallLevel([job('sending', true, 'stalled')], []) === 'down');
}

console.log('\nthe account\'s quiet failures are found, and told once');
{
  const svc = src('services/system-status.service.ts');
  for (const [label, re] of [
    ['a mailbox that cannot sign in', /mailbox-signin:/],
    ['replies that stopped syncing', /mailbox-sync-error:/],
    ['replies that went stale', /mailbox-sync-stale:/],
    ['every mailbox resting', /autopilot-all-resting/],
    ['a stalled campaign', /campaign-stalled:/],
    ['emails piling up past their time', /sending-backlog/],
    ['a core job stopped', /key: `job:\$\{j\.id\}`/],
  ] as const) is(`found: ${label}`, re.test(svc));
  is('a new issue is told once', /if \(known\.has\(i\.key\)\) continue;/.test(svc) && /fireEvent\(userId, 'system\.attention'/.test(svc));
  is('and its clearing once', /fireEvent\(userId, 'system\.resolved'/.test(svc) && /\.is\('resolved_at', null\)\s*\.select\('title'\)/.test(svc));
  is('the self-test signs every mailbox in, one at a time', /for \(const b of boxes \|\| \[\]\) \{\s*try \{\s*const r: any = await smtpService\.test/.test(svc));
  is('the watchdog starts with the server', /startWatchdogScheduler\(\)/.test(src('index.ts')));
  is('the routes are mounted', /routes\.use\('\/system', systemRoutes\)/.test(src('routes/index.ts')));
  is('Slack hears about it', /case 'system\.attention':/.test(src('services/integrations.service.ts')));
  const migration = readFileSync(join(here, '../../supabase/migrations/078_system_status.sql'), 'utf8');
  is('migration 078 creates both tables', /create table if not exists job_heartbeats/.test(migration) && /create table if not exists system_alerts/.test(migration));
  is('heartbeats are server-only', /alter table job_heartbeats enable row level security;/.test(migration) && !/on job_heartbeats for/.test(migration));
  is('the migration is ASCII with no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(begin|commit)\s*;/im.test(migration));
  is('Settings lists it', /href: '\/system'/.test(client('lib/sections.ts')));
  is('Home says so only when something is wrong', /if \(!data \|\| data\.level === 'ok'\) return null;/.test(client('components/dashboard/SystemNote.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

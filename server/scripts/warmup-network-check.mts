/*
 * The shared warm-up network (migration 108).
 *
 * What this pins down:
 *  - a mailbox that joins reaches other accounts' mailboxes, preferring a
 *    different provider, and one that has not joined never does
 *  - nobody receives network mail without joining, while resting, while
 *    bouncing, or past the daily cap
 *  - the summary counts mail by mailbox, so mail from another account
 *    shows up, and never shows another account's addresses
 *  - warm-up mail never reaches the Unibox or reply detection
 *  - warm-up content is varied, not six fixed bodies
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));

/* ─── A small in-memory table store ─────────────────────────────────── */
const tables: Record<string, any[]> = { smtp_accounts: [], warmup_emails: [] };
// Stands in for a database where migration 108 has not been run.
let noNetworkColumn = false;

function from(name: string): any {
  const preds: Array<(r: any) => boolean> = [];
  let mode: 'select' | 'update' = 'select';
  let patch: any = null;
  let single = false;
  const rows = () => (tables[name] || []).filter((r) => preds.every((p) => p(r)));
  let touchesNetwork = false;
  const run = () => {
    if (noNetworkColumn && touchesNetwork) return { data: null, error: { message: 'column smtp_accounts.warmup_network does not exist' } };
    if (mode === 'update') { const hit = rows(); for (const r of hit) Object.assign(r, patch); return { data: single ? (hit[0] ?? null) : hit, error: null }; }
    const out = rows();
    return { data: single ? (out[0] ?? null) : out, error: null };
  };
  const chain: any = {
    select: () => chain,
    eq: (c: string, v: any) => { if (c === 'warmup_network') touchesNetwork = true; preds.push((r) => (r[c] ?? (typeof v === 'boolean' ? false : null)) === v); return chain; },
    in: (c: string, vs: any[]) => { preds.push((r) => vs.includes(r[c])); return chain; },
    is: (c: string, v: any) => { preds.push((r) => (r[c] ?? null) === v); return chain; },
    gte: (c: string, v: any) => { preds.push((r) => String(r[c]) >= String(v)); return chain; },
    or: (expr: string) => {
      const parts = [...expr.matchAll(/(\w+)\.in\.\(([^)]*)\)/g)].map((m) => ({ col: m[1], vals: m[2].split(',') }));
      preds.push((r) => parts.some((p) => p.vals.includes(r[p.col])));
      return chain;
    },
    order: () => chain, limit: () => chain,
    maybeSingle: () => { single = true; return chain; },
    single: () => { single = true; return chain; },
    update: (p: any) => { mode = 'update'; patch = p; return chain; },
    insert: (row: any) => { (tables[name] ||= []).push({ sent_at: new Date().toISOString(), ...row }); return Promise.resolve({ data: null, error: null }); },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = from;
const { encrypt } = await import('../src/utils/encryption.js');
const shared = await import('@lemlist/shared');
const { warmupService } = await import('../src/services/warmup.service.js');

const pass_ = encrypt('pw');
let n = 0;
const mailbox = (user: string, email: string, host: string, extra: any = {}) => ({
  id: `acct-${++n}`, user_id: user, email_address: email, from_name: null, label: email,
  // Port 1 on localhost refuses at once, and the tick logs who it chose.
  smtp_host: host, smtp_port: 1, smtp_secure: false, smtp_user: email, smtp_pass_encrypted: pass_,
  is_active: true, is_verified: true, is_seed: false, warmup_mode: false, warmup_network: false,
  warmup_started_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), warmup_sent_today: 0,
  warmup_start_volume: 4, warmup_daily_target: 40, warmup_ramp_days: 30, daily_send_limit: 40,
  autopilot_state: 'active', bounce_rate_7d: 0, health_score: 90, created_at: '2026-01-01',
  ...extra,
});

/*
 * sendViaSmtp is a named import inside the service and cannot be swapped,
 * so the send is pointed at a closed port and the choice is read from the
 * warning the tick logs: "send failed FROM → TO".
 */
async function tickChoices(): Promise<Array<[string, string]>> {
  const seen: Array<[string, string]> = [];
  const warn = console.warn;
  console.warn = (msg: any) => {
    const m = /send failed (\S+) → (\S+):/.exec(String(msg));
    if (m) seen.push([m[1], m[2]]); else warn(msg);
  };
  // The real SMTP client would otherwise try the actual host; every host
  // here is localhost.
  try { await warmupService.runWarmupTick(); } finally { console.warn = warn; }
  return seen;
}
const reset = (accounts: any[], emails: any[] = []) => { tables.smtp_accounts = accounts; tables.warmup_emails = emails; };

console.log('\nShared helpers');
{
  is('a warm-up Message-ID is recognised', shared.isWarmupMessageId('<wu-0123456789abcdef01234567@acme.com>'));
  is('without angle brackets too', shared.isWarmupMessageId('wu-0123456789abcdef@acme.com'));
  is('an ordinary Message-ID is not', !shared.isWarmupMessageId('<CAF=abc123@mail.gmail.com>'));
  is('nor one that merely contains wu-', !shared.isWarmupMessageId('<abc.wu-0123456789@acme.com>'));
  is('nor nothing', !shared.isWarmupMessageId(null) && !shared.isWarmupMessageId(''));

  const base = { id: 'x', user_id: 'u', email_address: 'a@b.com', warmup_network: true };
  is('a joined, healthy mailbox is eligible', shared.networkEligible(base));
  is('one that has not joined is not', !shared.networkEligible({ ...base, warmup_network: false }));
  is('nor one resting', !shared.networkEligible({ ...base, autopilot_state: 'resting' }));
  is('nor one bouncing 8%', !shared.networkEligible({ ...base, bounce_rate_7d: 0.08 }));
  is('8 read as a percentage is bouncing too', !shared.networkEligible({ ...base, bounce_rate_7d: 8 }));
  is('2% is fine', shared.networkEligible({ ...base, bounce_rate_7d: 0.02 }));

  const d1 = new Date('2026-11-02T10:00:00Z'), d2 = new Date('2026-11-03T10:00:00Z');
  is('the rotation moves from one day to the next', shared.rotationSeed('m1', 0, d1) !== shared.rotationSeed('m1', 0, d2));
  is('and differs between mailboxes', shared.rotationSeed('m1', 0, d1) !== shared.rotationSeed('m2', 0, d1));
  is('and advances with each send', shared.rotationSeed('m1', 1, d1) === shared.rotationSeed('m1', 0, d1) + 1);

  const sender = { from_name: 'Scott Miles', email_address: 'scott@acme.com' };
  const recipient = { from_name: 'Priya Shah', email_address: 'priya@other.io' };
  const bodies = new Set<string>(), subjects = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const m = shared.composeWarmupMessage(sender, recipient);
    bodies.add(m.body); subjects.add(m.subject);
  }
  is('bodies vary a great deal', bodies.size > 150, String(bodies.size));
  is('subjects vary', subjects.size > 15, String(subjects.size));
  const one = shared.composeWarmupMessage(sender, recipient);
  is('addressed to the recipient by name', /Priya/.test(one.body), one.body);
  is('and signed by the sender', /\nScott$/.test(one.body), one.body);
  const noName = shared.composeWarmupMessage({ email_address: 'x9@acme.com' }, { email_address: 'info@other.io' });
  is('a nameless recipient gets a plain greeting, not "Hi there there"', /^(Hi|Hey|Hello|Hi there|Morning),\n/.test(noName.body) && !/\{first\}/.test(noName.body), noName.body);
  is('a reply is signed by whoever replies', /\n\nPriya$/.test(shared.composeWarmupReply(recipient)));
  is('content is plain ASCII', [...bodies].every((b) => /^[\x00-\x7f]*$/.test(b)));
}

console.log('\nWho the tick sends to');
{
  // Account A: two mailboxes at one provider. B and C: Gmail.
  const a1 = mailbox('A', 'scott@acme.com', 'localhost', { warmup_mode: true, warmup_network: true });
  const a2 = mailbox('A', 'invest@acme.com', 'localhost');
  const b1 = mailbox('B', 'priya@other.io', 'smtp.gmail.com', { warmup_network: true });
  const c1 = mailbox('C', 'not-joined@third.io', 'smtp.gmail.com');
  reset([a1, a2, b1, c1]);
  let picks = await tickChoices();
  is('a joined mailbox reaches another account at a different provider', picks.length === 1 && picks[0][1] === b1.email_address, JSON.stringify(picks));

  reset([{ ...a1, warmup_network: false }, a2, b1, c1]);
  picks = await tickChoices();
  is('one that has not joined stays within its own account', picks.length === 1 && picks[0][1] === a2.email_address, JSON.stringify(picks));

  reset([a1, a2, { ...b1, warmup_network: false }, c1]);
  picks = await tickChoices();
  is('nobody receives network mail without joining', picks.every(([, to]) => to !== b1.email_address && to !== c1.email_address), JSON.stringify(picks));

  reset([a1, a2, { ...b1, autopilot_state: 'resting' }, c1]);
  picks = await tickChoices();
  is('a resting mailbox is left alone', picks.every(([, to]) => to !== b1.email_address), JSON.stringify(picks));

  reset([a1, a2, { ...b1, bounce_rate_7d: 0.2 }, c1]);
  picks = await tickChoices();
  is('so is one that is bouncing', picks.every(([, to]) => to !== b1.email_address), JSON.stringify(picks));

  const today = Array.from({ length: shared.NETWORK_DAILY_RECEIVE_CAP }, (_, i) => ({
    id: `w${i}`, user_id: 'Z', from_account_id: 'elsewhere', to_account_id: b1.id, is_reply: false, sent_at: new Date().toISOString(),
  }));
  reset([a1, a2, b1, c1], today);
  picks = await tickChoices();
  is(`a mailbox that has had ${shared.NETWORK_DAILY_RECEIVE_CAP} today gets no more`, picks.length === 1 && picks[0][1] === a2.email_address, JSON.stringify(picks));

  const solo = mailbox('D', 'only@solo.com', 'localhost', { warmup_mode: true, warmup_network: true });
  reset([solo, b1]);
  picks = await tickChoices();
  is('a single mailbox can warm up through the network alone', picks.length === 1 && picks[0][1] === b1.email_address, JSON.stringify(picks));
}

console.log('\nWhat the summary reports');
{
  const a1 = mailbox('A', 'scott@acme.com', 'localhost', { warmup_mode: true, warmup_network: true });
  const b1 = mailbox('B', 'priya@other.io', 'smtp.gmail.com', { warmup_mode: true, warmup_network: true });
  const b2 = mailbox('B', 'raj@other.io', 'smtp.gmail.com', { warmup_network: true });
  const now = new Date().toISOString();
  reset([a1, b1, b2], [
    // A wrote to B; B replied. The original belongs to account A.
    { id: 'e1', user_id: 'A', from_account_id: a1.id, to_account_id: b1.id, is_reply: false, sent_at: now, opened_at: now, replied_at: now },
    { id: 'e2', user_id: 'B', from_account_id: b1.id, to_account_id: a1.id, is_reply: true, sent_at: now },
  ]);
  const sb = await warmupService.summary('B');
  const rowB = sb.accounts.find((a) => a.id === b1.id)!;
  is('mail from another account counts as received', rowB.received_7d === 1, JSON.stringify(rowB));
  is('and as replied to', rowB.replied_7d === 1);
  is('the network is counted without your own mailboxes', sb.network_peers === 1, String(sb.network_peers));
  is('and how many of yours joined', sb.network_joined === 2);
  is('the account row says it is in the network', rowB.warmup_network === true);
  is('no other account\'s address appears anywhere', !JSON.stringify(sb).includes('scott@acme.com'));

  const sa = await warmupService.summary('A');
  is('the sender sees its sent mail', sa.sent_7d === 1 && sa.accounts[0].sent_7d === 1, JSON.stringify(sa.accounts[0]));
  is('and the reply it earned', sa.replied_7d === 1);
  is('a lone Spacemail mailbox in the network reads as reaching other providers', sa.pool_quality === 'mixed', sa.pool_quality);
}

console.log('\nBefore migration 108 is run');
{
  const a1 = mailbox('A', 'scott@acme.com', 'localhost', { warmup_mode: true });
  const a2 = mailbox('A', 'invest@acme.com', 'localhost');
  reset([a1, a2]);
  noNetworkColumn = true;
  const sm = await warmupService.summary('A');
  is('the panel is told the network is not switched on', sm.network_available === false);
  is('and the summary still works', sm.accounts.length === 2 && sm.network_peers === 0);
  const picks = await tickChoices();
  is('own-account warm-up carries on', picks.length === 1 && picks[0][1] === a2.email_address, JSON.stringify(picks));
  noNetworkColumn = false;
  const after = await warmupService.summary('A');
  is('once it is run, the network shows', after.network_available === true);
  const panel = readFileSync(join(here, '../../client/src/pages/smtp/WarmupPanel.tsx'), 'utf8');
  is('the panel hides the network card until then', /summary\.network_available === false\) return null;/.test(panel));
}

console.log('\nJoining and leaving');
{
  const a1 = mailbox('A', 'scott@acme.com', 'localhost', { warmup_mode: true });
  reset([a1]);
  await warmupService.setWarmup('A', a1.id, { warmup_network: true });
  is('joining sets the flag', tables.smtp_accounts[0].warmup_network === true);
  is('and leaves warm-up itself as it was', tables.smtp_accounts[0].warmup_mode === true);
  await warmupService.setWarmup('A', a1.id, { warmup_network: false });
  is('leaving clears it', tables.smtp_accounts[0].warmup_network === false);
  let refused = false;
  try { await warmupService.setWarmup('B', a1.id, { warmup_network: true }); } catch { refused = true; }
  is('another account cannot join your mailbox', refused && tables.smtp_accounts[0].warmup_network === false);
}

console.log('\nWarm-up mail stays out of the inbox');
{
  const sync = readFileSync(join(here, '../src/services/inbox-sync.service.ts'), 'utf8');
  const svc = readFileSync(join(here, '../src/services/warmup.service.ts'), 'utf8');
  const mig = readFileSync(join(here, '../../supabase/migrations/108_warmup_network.sql'), 'utf8');
  is('the sync skips warm-up mail before downloading it', /wanted = heads\.filter\(\(h\) => h\.uid > 0 && !isWarmupMessageId\(h\.messageId\)/.test(sync));
  is('and ingest refuses it too', /if \(isWarmupMessageId\(messageId\)\) return false;/.test(sync));
  is('opened warm-up mail is filed in its own folder', /const WARMUP_FOLDER = 'Sincerely Warm-up'/.test(svc) && /messageMove\(String\(uid\), WARMUP_FOLDER/.test(svc));
  is('replies thread under the email they answer', /'In-Reply-To': row\.message_id/.test(svc));
  is('a reply belongs to the account that sent it', /user_id: account\.user_id,/.test(svc));
  is('migration 108 is ASCII with no BEGIN/COMMIT', /^[\x00-\x7f]*$/.test(mig) && !/^\s*(BEGIN|COMMIT)\b/im.test(mig));
  is('and off by default', /warmup_network boolean NOT NULL DEFAULT false/.test(mig));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

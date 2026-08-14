/* ═══════════════════════════════════════════════════════════════════════
   What actually goes out.

   Six separate pieces of logic now run inside the send path — merge tags,
   spintax, recipient-timezone windows, the per-company throttle, the
   bounce guard, and per-account tracking domains — and each was only ever
   tested on its own. "Every piece works alone" is not the same claim as
   "a real send still works", and the gap between those two is where
   integration bugs live.

   So this drives the real engine. Supabase is a recorder, the SMTP relay
   is a capture point (setting SMTP_RELAY_URL routes sending through fetch
   rather than a socket, which is what makes this possible at all), and the
   assertions are on the message that would genuinely have left the
   building: its subject, its HTML, its recipient and its links.
   ═══════════════════════════════════════════════════════════════════════ */

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'audit';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'audit';
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_BASE_URL = 'https://app.sincerely.io';
// Routes sending through fetch instead of a socket, so the outbound message
// can be captured without opening a connection to anything.
process.env.SMTP_RELAY_URL = 'https://relay.test/api/send-email';
process.env.SMTP_RELAY_SECRET = 'relay-secret';

const { supabaseAdmin } = await import('../src/config/supabase.js');
const { encrypt } = await import('../src/utils/encryption.js');

/* ─── The world this send happens in ────────────────────────────────── */

const USER = '00000000-0000-0000-0000-0000000000u1';
const CAMPAIGN = '00000000-0000-0000-0000-0000000000c1';
const CC = '00000000-0000-0000-0000-000000000cc1';

interface World {
  contact: Record<string, any>;
  step: Record<string, any>;
  campaign: Record<string, any>;
  settings: Record<string, any>;
  trackingDomain: Record<string, any> | null;
  smtpAccount: Record<string, any>;
  /** activity_type -> count, for the guard's counting queries. */
  activityCounts: Record<string, number>;
}

let world: World;
let sent: any = null;
let updates: { table: string; payload: any }[] = [];
let rpcCalls: { fn: string; args: any }[] = [];

function freshWorld(): World {
  return {
    contact: {
      id: 'contact-1',
      email: 'maud@northbeam.io',
      first_name: 'Maud',
      last_name: 'Grevstad',
      company: 'Northbeam',
      job_title: 'Head of Growth',
      location: 'London, England, United Kingdom',
      custom_fields: { region: 'EMEA' },
      is_unsubscribed: false,
      is_bounced: false,
    },
    step: {
      id: 'step-1',
      campaign_id: CAMPAIGN,
      step_order: 0,
      step_type: 'email',
      subject: '{Quick|Short} question about {{company}}',
      body_html: '<p>{Hi|Hey} {{first_name|there}}, we help {{industry|teams}} in {{city}}.</p>'
        + '<p>Best,<br>{{sender_name}}</p><p><a href="https://acme.example/demo">Book a demo</a></p>',
      subject_b: null,
      body_html_b: null,
      skip_if_replied: true,
      delay_days: 0, delay_hours: 0, delay_minutes: 0,
    },
    campaign: {
      id: CAMPAIGN,
      user_id: USER,
      status: 'running',
      timezone: 'UTC',
      send_window_start: '00:00',
      send_window_end: '23:59',
      send_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      daily_limit: 0,
      stop_on_reply: true,
      track_opens: true,
      track_clicks: true,
      include_unsubscribe: true,
      smtp_account_id: 'smtp-1',
      send_in_recipient_timezone: false,
    },
    settings: {
      first_name: 'Jordan', last_name: 'Lee', company: 'Sincerely',
      bounce_guard_enabled: true, bounce_guard_threshold: 8,
      domain_hourly_limit: 5,
      stop_all_campaigns_on_reply: false,
    },
    trackingDomain: null,
    smtpAccount: {
      id: 'smtp-1', user_id: USER, label: 'Primary', email_address: 'jordan@sincerely.io',
      from_name: 'Jordan Lee', smtp_host: 'smtp.test', smtp_port: 587, smtp_secure: false,
      smtp_user: 'jordan', smtp_pass_encrypted: encrypt('hunter2'),
      is_active: true, is_verified: true, daily_send_limit: 500, sends_today: 0,
      health_score: 100, warmup_mode: 'off',
    },
    activityCounts: {},
  };
}

/* ─── Supabase, standing in ─────────────────────────────────────────── */

/**
 * Honour the eq() filters the caller applied.
 *
 * Without this the harness hands back a row the real query would have
 * excluded — and it did: the "unverified tracking domain is ignored" case
 * failed against a stub that ignored `.eq('verified', true)`, which made the
 * test wrong rather than the code. Only columns the row actually carries are
 * checked, so a filter on a column this fixture does not model is not treated
 * as a mismatch.
 */
function matchesFilters(row: any, filters: [string, any[]][]): boolean {
  if (!row) return false;
  for (const [op, args] of filters) {
    if (op !== 'eq') continue;
    const [col, value] = args;
    if (!(col in row)) continue;
    if (row[col] !== value) return false;
  }
  return true;
}

function rowsFor(table: string, filters: [string, any[]][]): any {
  const row = rowFixture(table);
  return matchesFilters(row, filters) ? row : null;
}

function rowFixture(table: string): any {
  switch (table) {
    case 'campaign_contacts':
      return {
        id: CC, campaign_id: CAMPAIGN, contact_id: 'contact-1',
        status: 'active', current_step_order: 0, next_send_at: new Date().toISOString(),
        contact_timezone: null,
        campaigns: world.campaign, contacts: world.contact,
      };
    case 'campaigns': return world.campaign;
    case 'campaign_steps': return world.step;
    case 'contacts': return world.contact;
    case 'user_settings': return world.settings;
    case 'smtp_accounts': return world.smtpAccount;
    case 'tracking_domains': return world.trackingDomain;
    case 'campaign_smtp_accounts': return null;
    case 'campaign_activities': return null;
    default: return null;
  }
}

(supabaseAdmin as any).from = (table: string) => {
  const filters: [string, any[]][] = [];
  let single = false;
  let write: string | null = null;
  const chain: any = new Proxy(() => {}, {
    get(_t, p: string) {
      if (p === 'single' || p === 'maybeSingle') return () => { single = true; return chain; };
      if (p === 'then') {
        return (resolve: any) => {
          if (write) resolve({ data: rowsFor(table, filters), error: null, count: 0 });
          else {
            const row = rowsFor(table, filters);
            const typeFilter = filters.find(([k, v]) => k === 'eq' && v[0] === 'activity_type');
            resolve({
              data: single ? row : (row ? [row] : []),
              error: null,
              count: typeFilter ? (world.activityCounts[String(typeFilter[1][1])] || 0) : 0,
            });
          }
        };
      }
      if (p === 'insert' || p === 'update' || p === 'upsert') {
        return (payload: any) => { write = p; if (p === 'update') updates.push({ table, payload }); return chain; };
      }
      return (...args: any[]) => { filters.push([p, args]); return chain; };
    },
    apply() { return chain; },
  });
  return chain;
};

(supabaseAdmin as any).rpc = async (fn: string, args: any) => {
  rpcCalls.push({ fn, args });
  // Every reservation succeeds unless a scenario says otherwise.
  if (fn === 'reserve_email_quota') return { data: true, error: null };
  if (fn === 'reserve_campaign_daily_send') return { data: true, error: null };
  if (fn === 'reserve_domain_send') return { data: (world as any).__domainGranted ?? true, error: null };
  if (fn === 'reserve_warmup_send') return { data: true, error: null };
  return { data: null, error: null };
};

globalThis.fetch = (async (url: any, init: any) => {
  const target = String(url);
  if (target.includes('relay.test')) {
    sent = JSON.parse(init.body);
    if ((world as any).__relayRejects) {
      // 502 with a JSON verdict, which is exactly what api/send-email.ts
      // returns when the *destination* rejects the message. This fixture used
      // to answer 200, which is a status the relay never sends on a failure —
      // so the whole 5xx branch of the caller went unexercised and a bug
      // sitting in it passed every run.
      return {
        ok: false, status: 502, statusText: 'Bad Gateway', headers: new Headers(),
        json: async () => ({
          success: false,
          error: (world as any).__relayRejects,
          ...((world as any).__relayCode ? { responseCode: (world as any).__relayCode } : {}),
        }),
        text: async () => '',
      } as any;
    }
    // A dead relay: a proxy's HTML error page, no JSON verdict anywhere.
    // The caller must fall back to a direct send for this and only this.
    if ((world as any).__relayDead) {
      return {
        ok: false, status: 502, statusText: 'Bad Gateway', headers: new Headers(),
        json: async () => { throw new Error('not json'); },
        text: async () => '<html>502 Bad Gateway</html>',
      } as any;
    }
    return {
      ok: true, status: 200, statusText: 'OK', headers: new Headers(),
      json: async () => ({ success: true, messageId: '<relayed@test>', accepted: [JSON.parse(init.body).to] }),
      text: async () => '',
    } as any;
  }
  throw new Error(`unexpected fetch to ${target}`);
}) as any;

/*
 * Direct SMTP, recorded rather than attempted.
 *
 * The direct path is the fallback for a broken relay, and whether it runs is
 * itself the thing under test: a direct retry after the relay has already
 * reported a verdict is a duplicate send. Left unstubbed it did a real DNS
 * lookup for smtp.test on every scenario, which was slow, and — worse —
 * failed in a way indistinguishable from the failures being asserted on.
 *
 * nodemailer is CJS, so its default export is a plain object and the property
 * can be swapped; the service reads it at call time.
 */
const nodemailer = (await import('nodemailer')).default as any;
const directAttempts: any[] = [];
nodemailer.createTransport = (options: any) => {
  directAttempts.push(options);
  return {
    sendMail: async () => {
      throw Object.assign(new Error('direct SMTP is not reachable from this harness'), { code: 'ESOCKET' });
    },
    // The service closes the transport in a finally block; without this the
    // stub throws over the top of the failure actually being tested.
    close: () => {},
    verify: async () => true,
  };
};

const billing = await import('../src/services/billing.service.js');
// The plan lookup is not what this harness is testing, and letting it fall
// through to a stubbed table would silently gate the send on a plan tier.
(billing.billingService as any).getLimits = async () => ({ emailsPerMonth: 100000 });
(billing.billingService as any).hasFeature = async () => true;

const { processNextStep } = await import('../src/services/sequence.service.js');

/* ─── Running one send ──────────────────────────────────────────────── */

const tracking = await import('../src/services/tracking-domain.service.js');
const throttle = await import('../src/services/domain-throttle.service.js');
const guard = await import('../src/services/bounce-guard.service.js');

async function send(mutate?: (w: World) => void) {
  world = freshWorld();
  mutate?.(world);
  // Each of these memoises per user for a few minutes. That is correct in
  // production — every writer invalidates — but between scenarios here it
  // would carry the previous world's answer into the next one.
  tracking.invalidateTrackingBaseUrl(USER);
  throttle.invalidateDomainLimit(USER);
  guard.invalidateGuardSettings(USER);
  sent = null; updates = []; rpcCalls = []; directAttempts.length = 0;
  await processNextStep(CC);
  return sent;
}

let pass = 0, fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

console.log('\na send actually happens, and everything composes');
{
  const m = await send();
  is('a message reached the relay', !!m, JSON.stringify(m)?.slice(0, 200));
  if (m) {
    is('addressed to the contact', m.to === 'maud@northbeam.io', m.to);
    is('from the mailbox, with its display name', m.from === '"Jordan Lee" <jordan@sincerely.io>', m.from);

    console.log('\n  merge tags');
    is('contact tag resolved', m.html.includes('Maud'), m.html);
    is('company resolved in the subject', m.subject.includes('Northbeam'), m.subject);
    is('city derived from location', m.html.includes('London'), m.html);
    is('sender tag resolved from settings', m.html.includes('Jordan Lee'), m.html);
    is('unknown tag with a fallback used the fallback', m.html.includes('teams'), m.html);
    is('NOTHING left in braces — the bug that started all this',
       !/\{\{/.test(m.html) && !/\{\{/.test(m.subject), `${m.subject} | ${m.html}`);

    console.log('\n  spintax');
    is('subject picked one option', /^(Quick|Short) question/.test(m.subject), m.subject);
    is('body picked one option', /(Hi|Hey) Maud/.test(m.html), m.html);
    is('no spin braces survive', !/\{[^}]*\|/.test(m.html), m.html);

    console.log('\n  tracking');
    is('click link wrapped', m.html.includes('/api/track/click/'), m.html);
    is('open pixel injected', m.html.includes('/api/track/open/'), m.html);
    is('unsubscribe link present', m.html.includes('/api/track/unsubscribe/'), m.html);
    is('links use the shared host when no custom domain',
       m.html.includes('https://app.sincerely.io/api/track/'), m.html);

    console.log('\n  plaintext part');
    is('text part exists', typeof m.text === 'string' && m.text.length > 0);
    is('text agrees with the html on the spin choice',
       m.text.includes(m.html.includes('Hi Maud') ? 'Hi Maud' : 'Hey Maud'),
       `${m.text?.slice(0, 60)} vs ${m.html.slice(0, 60)}`);
    is('no raw tags in the text part', !/\{\{/.test(m.text || ''), m.text);
  }
}

console.log('\nthe same contact always gets the same wording');
{
  const a = await send();
  const b = await send();
  is('subject stable across runs', a.subject === b.subject, `${a.subject} vs ${b.subject}`);
  is('body stable across runs', a.html === b.html);
}

console.log('\na verified tracking domain takes over every link');
{
  const m = await send((w) => {
    w.trackingDomain = { domain: 'track.sincerely.io', verified: true };
  });
  is('click links use it', m.html.includes('https://track.sincerely.io/api/track/click/'), m.html);
  is('open pixel uses it', m.html.includes('https://track.sincerely.io/api/track/open/'));
  is('unsubscribe uses it', m.html.includes('https://track.sincerely.io/api/track/unsubscribe/'));
  is('the shared host appears nowhere', !m.html.includes('app.sincerely.io'), m.html);
}

console.log('\nan unverified tracking domain is ignored, not trusted');
{
  const m = await send((w) => {
    w.trackingDomain = { domain: 'track.sincerely.io', verified: false };
  });
  is('falls back to the shared host', m.html.includes('https://app.sincerely.io/api/track/'), m.html);
  is('the unverified domain is never used', !m.html.includes('track.sincerely.io'), m.html);
}

console.log('\nthe per-company throttle defers instead of sending');
{
  const m = await send((w) => { (w as any).__domainGranted = false; });
  is('nothing was sent', m === null);
  const deferred = updates.find((u) => u.table === 'campaign_contacts' && u.payload.next_send_at);
  is('the contact was rescheduled', !!deferred, JSON.stringify(updates));
  is('rescheduled to a future hour',
     !!deferred && new Date(deferred.payload.next_send_at).getTime() > Date.now(),
     deferred?.payload?.next_send_at);
}

console.log('\na consumer address is never throttled');
{
  await send((w) => { w.contact.email = 'maud@gmail.com'; });
  is('no domain reservation was attempted',
     !rpcCalls.some((c) => c.fn === 'reserve_domain_send'),
     JSON.stringify(rpcCalls.map((c) => c.fn)));
}

console.log('\na contact with no first name gets the fallback, not "Hi ,"');
{
  const m = await send((w) => { w.contact.first_name = null; });
  is('fallback word used', /(Hi|Hey) there,/.test(m.html), m.html);
  is('no empty greeting', !/(Hi|Hey) ,/.test(m.html), m.html);
}

console.log('\nrecipient-timezone sending defers a contact outside their window');
{
  const m = await send((w) => {
    w.campaign.send_in_recipient_timezone = true;
    // A window that is currently open in UTC but shut in Tokyo, or the other
    // way round — either way the two clocks disagree, which is the feature.
    w.campaign.send_window_start = '09:00';
    w.campaign.send_window_end = '17:00';
    w.contact.location = 'Tokyo, Japan';
  });
  const utcHour = new Date().getUTCHours();
  const tokyoHour = (utcHour + 9) % 24;
  const openInTokyo = tokyoHour >= 9 && tokyoHour < 17;
  is(`judged on Tokyo's clock (hour ${tokyoHour}, ${openInTokyo ? 'open' : 'shut'})`,
     openInTokyo ? m !== null : m === null,
     `sent=${m !== null}`);
}

console.log('\na hard bounce must be recorded as a bounce, not a generic error');
{
  // What a mailbox provider says when the address does not exist. Anything
  // that is not classified as a bounce never reaches the bounce guard, never
  // sets contacts.is_bounced, and never appears in the bounce rate.
  await send((w) => { (w as any).__relayRejects = '550 5.1.1 <maud@northbeam.io> User unknown'; });

  const ccUpdate = updates.find((u) => u.table === 'campaign_contacts' && u.payload.status);
  is('the contact was marked bounced (not "error")',
     ccUpdate?.payload?.status === 'bounced',
     `status was "${ccUpdate?.payload?.status}"`);

  const contactUpdate = updates.find((u) => u.table === 'contacts' && 'is_bounced' in (u.payload || {}));
  is('the contact is flagged bounced platform-wide, so other campaigns skip them',
     contactUpdate?.payload?.is_bounced === true,
     JSON.stringify(updates.map((u) => `${u.table}:${JSON.stringify(u.payload).slice(0, 60)}`)));
}

console.log('\na relay that answered must not be second-guessed by a direct retry');
{
  /*
   * The relay reports every SMTP failure as HTTP 502. The caller used to read
   * only the status, see 5xx, decide the relay was broken and re-send over
   * direct SMTP — which on the hosts this relay exists for (Render blocks
   * outbound SMTP) simply times out, so a bounce arrived as a timeout and the
   * contact was never marked bounced.
   *
   * And 502 is also what the relay returns for its own deadline, which fires
   * while the destination may have already accepted the message. The retry
   * put the same email in the prospect's inbox twice.
   */
  await send((w) => {
    (w as any).__relayRejects = '550 5.1.1 <maud@northbeam.io> User unknown';
    (w as any).__relayCode = 550;
  });
  is('a 502 carrying a verdict is not treated as a dead relay',
     !directAttempts.length,
     `direct SMTP was attempted ${directAttempts.length} time(s) — that is a duplicate send`);

  const ccUpdate = updates.find((u) => u.table === 'campaign_contacts' && u.payload.status);
  is('and the bounce inside it is recorded',
     ccUpdate?.payload?.status === 'bounced',
     `status was "${ccUpdate?.payload?.status}"`);
}
{
  // The other half: a relay that genuinely is not there must still fall back,
  // or a proxy hiccup would stop the campaign instead of routing around it.
  await send((w) => { (w as any).__relayDead = true; });
  is('a 502 with no verdict does fall back to direct SMTP', directAttempts.length > 0,
     'the relay was unreachable and nothing was tried directly');
}

console.log('\na rejected mailbox password must not be blamed on the recipient');
{
  // 535 is 5xx, so "5xx is permanent" reads it as a hard bounce — and since
  // every send from that mailbox fails identically, an expired app password
  // would walk the whole list marking live prospects dead across every
  // campaign they are in. It is our login that failed, not their address.
  await send((w) => { (w as any).__relayRejects = 'Invalid login: 535 5.7.8 Authentication failed'; });

  const ccUpdate = updates.find((u) => u.table === 'campaign_contacts' && u.payload.status);
  is('the contact is errored, not bounced',
     ccUpdate?.payload?.status === 'error',
     `status was "${ccUpdate?.payload?.status}"`);

  is('the contact is NOT flagged undeliverable platform-wide',
     !updates.some((u) => u.table === 'contacts' && (u.payload || {}).is_bounced === true),
     JSON.stringify(updates.map((u) => `${u.table}:${JSON.stringify(u.payload).slice(0, 60)}`)));

  const stall = updates.find((u) => u.table === 'campaigns' && 'stall_reason' in (u.payload || {}));
  is('the campaign says why it stopped sending',
     /password/i.test(String(stall?.payload?.stall_reason || '')),
     `stall_reason was ${JSON.stringify(stall?.payload?.stall_reason)}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

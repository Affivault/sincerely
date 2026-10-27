/*
 * Team round-robin booking (097).
 *
 * Drives the real publicBookingService and roundRobinService against a fake
 * database that honours filters, with each teammate's diary stubbed, and
 * pins down the promises the feature makes:
 *
 *   - off by default, and off means a round-robin link takes nothing (it
 *     never quietly becomes its owner's), while ordinary links are untouched
 *   - the booking goes to a host free at that time, fewest recent first,
 *     and falls through to the next when the first is taken at the last
 *     instant
 *   - the meeting, its contact and its follow-through belong to the host
 *   - a host who paused themselves, or left the team, is never offered
 *   - only an owner or admin can switch it, and only teammates can host
 */
import assert from 'node:assert';

process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.TRACKING_BASE_URL ||= 'https://app.sincerely.io';
process.env.CLIENT_URL ||= 'https://app.sincerely.io';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
async function refuses(label: string, fn: () => Promise<unknown>, status: number) {
  try {
    await fn();
    is(label, false, 'it went through');
  } catch (e: any) {
    is(label, e?.statusCode === status || e?.status === status, `got ${e?.statusCode ?? e?.status}: ${e?.message}`);
  }
}

const {
  rankHosts, mergeSlotLists, hostIsBookable,
} = await import('@lemlist/shared');

/* ── The pure rules ─────────────────────────────────────────────────── */

console.log('\nRanking');
{
  const h = (user_id: string, recent: number, priority = 1, last: string | null = null) =>
    ({ user_id, recent, priority, last_assigned_at: last });
  is('fewest recent meetings first',
    rankHosts([h('a', 3), h('b', 1), h('c', 2)], 'balanced').join() === 'b,c,a');
  is('a tie goes to whoever was given one least recently',
    rankHosts([h('a', 1, 1, '2026-10-02T00:00:00Z'), h('b', 1, 1, '2026-10-01T00:00:00Z')], 'balanced')[0] === 'b');
  is('never assigned beats assigned on a tie',
    rankHosts([h('a', 0, 1, '2026-10-01T00:00:00Z'), h('b', 0, 1, null)], 'balanced')[0] === 'b');
  is('priority puts 1 first even with more meetings',
    rankHosts([h('a', 9, 1), h('b', 0, 2)], 'priority')[0] === 'a');
  is('equal priorities are then balanced',
    rankHosts([h('a', 4, 1), h('b', 2, 1), h('c', 0, 3)], 'priority').join() === 'b,a,c');
  is('the order does not depend on input order',
    rankHosts([h('b', 0), h('a', 0)], 'balanced').join() === rankHosts([h('a', 0), h('b', 0)], 'balanced').join());
}

console.log('\nMerging times');
{
  const t = (iso: string) => ({ start: new Date(iso), end: new Date(new Date(iso).getTime() + 30 * 60_000) });
  const merged = mergeSlotLists([
    [t('2026-11-02T10:00:00Z'), t('2026-11-02T11:00:00Z')],
    [t('2026-11-02T10:00:00Z'), t('2026-11-02T09:00:00Z')],
  ]);
  is('each start once', merged.length === 3);
  is('in order', merged.map((s) => new Date(s.start).getUTCHours()).join() === '9,10,11');
  is('a host away is not bookable', !hostIsBookable({ is_active: true, host_paused: true }));
  is('a host left out is not bookable', !hostIsBookable({ is_active: false, host_paused: false }));
}

/* ── A world: one team, a manager and three reps, one outsider ─────── */

const ORG = 'org-1';
const OWNER = '00000000-0000-0000-0000-00000000000a';   // runs the link, admin
const AMY = '00000000-0000-0000-0000-0000000000a1';
const BEN = '00000000-0000-0000-0000-0000000000b1';
const CAT = '00000000-0000-0000-0000-0000000000c1';
const MEMBER = '00000000-0000-0000-0000-0000000000d1';  // plain member, not a host
const OUTSIDER = '00000000-0000-0000-0000-0000000000ee';
const LINK = 'link-rr';
const SINGLE = 'link-single';
const SLOT = '2026-11-03T10:00:00.000Z';

let world: Record<string, any[]>;
let taken: Set<string>;          // hosts whose book_slot raises SLOT_TAKEN
let busy: Set<string>;           // hosts canBook() says are not free
let mails: { userId: string }[];
let pushes: string[];
let seq = 0;

function reset(opts: { enabled?: boolean } = {}) {
  seq = 0;
  taken = new Set();
  busy = new Set();
  mails = [];
  pushes = [];
  const recent = (user_id: string, n: number) => Array.from({ length: n }, (_, i) => ({
    id: `old-${user_id}-${i}`, user_id, booking_link_id: LINK, status: 'confirmed',
    booked_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(), starts_at: SLOT,
  }));
  world = {
    organizations: [{ id: ORG, name: 'Northbeam', owner_id: 'someone-else', round_robin_enabled: opts.enabled ?? false }],
    team_members: [
      { org_id: ORG, user_id: OWNER, email: 'owner@nb.io', role: 'admin' },
      { org_id: ORG, user_id: AMY, email: 'amy@nb.io', role: 'member' },
      { org_id: ORG, user_id: BEN, email: 'ben@nb.io', role: 'member' },
      { org_id: ORG, user_id: CAT, email: 'cat@nb.io', role: 'member' },
      { org_id: ORG, user_id: MEMBER, email: 'mem@nb.io', role: 'member' },
      { org_id: 'org-2', user_id: OUTSIDER, email: 'x@else.io', role: 'owner' },
    ],
    user_settings: [
      { user_id: OWNER, first_name: 'Olive', last_name: 'Owner' },
      { user_id: AMY, first_name: 'Amy', last_name: 'A' },
      { user_id: BEN, first_name: 'Ben', last_name: 'B' },
      { user_id: CAT, first_name: 'Cat', last_name: 'C' },
    ],
    booking_links: [
      {
        id: LINK, user_id: OWNER, slug: 'team-intro', headline: 'Intro call', blurb: null,
        duration_minutes: 30, is_active: true, archived_at: null, collect_phone: false,
        collect_company: false, question: null, event_type_id: null, create_deal: false,
        deal_stage: null, notify_organiser: true, confirmation_note: null,
        assignment: 'round_robin', round_robin_strategy: 'balanced', views: 0, bookings: 0,
      },
      {
        id: SINGLE, user_id: OWNER, slug: 'olive', headline: 'Meet Olive', blurb: null,
        duration_minutes: 30, is_active: true, archived_at: null, collect_phone: false,
        collect_company: false, question: null, event_type_id: null, create_deal: false,
        deal_stage: null, notify_organiser: true, confirmation_note: null,
        assignment: 'single', round_robin_strategy: 'balanced', views: 0, bookings: 0,
      },
    ],
    booking_link_hosts: [
      { link_id: LINK, user_id: AMY, priority: 2, is_active: true, host_paused: false, last_assigned_at: null },
      { link_id: LINK, user_id: BEN, priority: 1, is_active: true, host_paused: false, last_assigned_at: null },
      { link_id: LINK, user_id: CAT, priority: 3, is_active: true, host_paused: false, last_assigned_at: null },
    ],
    // Amy 2, Ben 3, Cat 1 meetings from this link in the last month.
    crm_events: [...recent(AMY, 2), ...recent(BEN, 3), ...recent(CAT, 1)],
    contacts: [],
    crm_notes: [],
    booking_link_visits: [],
    campaign_contacts: [],
    campaigns: [],
    deals: [],
  };
}

/* ── A fake PostgREST: filters, the embeds this feature reads, upserts ─ */

const EMBED_KEY: Record<string, string> = {
  organizations: 'org_id', booking_links: 'link_id', calendar_event_types: 'event_type_id',
  contacts: 'contact_id', campaigns: 'campaign_id',
};

function embeds(select: string | undefined): { alias: string; target: string; key: string }[] {
  if (!select) return [];
  const out: { alias: string; target: string; key: string }[] = [];
  const re = /(?:(\w+):)?(\w+)(?:!(\w+))?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(select))) {
    const target = m[2];
    const alias = m[1] || target;
    const key = m[3]?.includes('source_campaign') ? 'source_campaign_id' : EMBED_KEY[target];
    if (key) out.push({ alias, target, key });
  }
  return out;
}

function match(row: any, f: { op: string; col: string; value: any }): boolean {
  const v = row[f.col];
  switch (f.op) {
    case 'eq': return String(v) === String(f.value);
    case 'neq': return String(v) !== String(f.value);
    case 'in': return (f.value as any[]).map(String).includes(String(v));
    case 'is': return f.value === null || f.value === 'null' ? v === null || v === undefined : v === f.value;
    case 'notnull': return v !== null && v !== undefined;
    case 'gte': return v >= f.value;
    case 'ilike': return String(v).toLowerCase() === String(f.value).replace(/\\(.)/g, '$1').toLowerCase();
    default: return true;
  }
}

function from(name: string): any {
  const filters: { op: string; col: string; value: any }[] = [];
  let single = false;
  let select: string | undefined;
  let op: 'read' | 'update' | 'delete' | 'insert' = 'read';
  let patch: any = null;
  let inserted: any[] = [];

  const run = () => {
    const rows = (world[name] ??= []);
    if (op === 'insert') {
      const data = single ? inserted[0] : inserted;
      return { data, error: null };
    }
    const hit = rows.filter((r) => filters.every((f) => match(r, f)));
    if (op === 'update') { for (const r of hit) Object.assign(r, patch); }
    if (op === 'delete') { world[name] = rows.filter((r) => !hit.includes(r)); }
    const shaped = hit.map((r) => {
      const out = { ...r };
      for (const e of embeds(select)) {
        const id = r[e.key];
        out[e.alias] = (world[e.target] ?? []).find((t) => t.id === id) ?? null;
      }
      return out;
    });
    return { data: single ? (shaped[0] ?? null) : shaped, error: null };
  };

  const chain: any = {
    select: (s?: string) => { if (op === 'read') select = s; else select = s ?? select; return chain; },
    eq: (col: string, value: any) => { filters.push({ op: 'eq', col, value }); return chain; },
    neq: (col: string, value: any) => { filters.push({ op: 'neq', col, value }); return chain; },
    in: (col: string, value: any) => { filters.push({ op: 'in', col, value }); return chain; },
    is: (col: string, value: any) => { filters.push({ op: 'is', col, value }); return chain; },
    not: (col: string, _o: string, _v: any) => { filters.push({ op: 'notnull', col, value: null }); return chain; },
    gte: (col: string, value: any) => { filters.push({ op: 'gte', col, value }); return chain; },
    ilike: (col: string, value: any) => { filters.push({ op: 'ilike', col, value }); return chain; },
    order: () => chain,
    limit: () => chain,
    single: () => { single = true; return chain; },
    maybeSingle: () => { single = true; return chain; },
    update: (p: any) => { op = 'update'; patch = p; return chain; },
    delete: () => { op = 'delete'; return chain; },
    insert: (p: any) => {
      op = 'insert';
      inserted = (Array.isArray(p) ? p : [p]).map((r) => ({ id: `${name}-${++seq}`, ...r }));
      (world[name] ??= []).push(...inserted);
      return chain;
    },
    upsert: (p: any, o?: { onConflict?: string }) => {
      op = 'insert';
      const keys = (o?.onConflict || 'id').split(',');
      inserted = [];
      for (const r of (Array.isArray(p) ? p : [p])) {
        const existing = (world[name] ??= []).find((x) => keys.every((k) => String(x[k]) === String(r[k])));
        if (existing) { Object.assign(existing, r); inserted.push(existing); }
        else {
          const row = { id: `${name}-${++seq}`, host_paused: false, last_assigned_at: null, ...r };
          world[name].push(row); inserted.push(row);
        }
      }
      return chain;
    },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = from;
(supabaseAdmin as any).auth = {
  admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id.slice(-2)}@nb.io` } } }) },
};
(supabaseAdmin as any).rpc = async (fn: string, args: any) => {
  if (fn === 'book_slot') {
    if (taken.has(args.p_user_id)) return { data: null, error: { message: 'SLOT_TAKEN' } };
    const id = `evt-${++seq}`;
    world.crm_events.push({
      id, user_id: args.p_user_id, booking_link_id: args.p_link_id, status: 'confirmed',
      starts_at: args.p_starts_at, ends_at: args.p_ends_at, contact_id: args.p_contact_id,
      contact_name: args.p_contact_name, contact_email: args.p_contact_email,
      manage_token: args.p_manage_token, booked_at: new Date().toISOString(),
    });
    return { data: id, error: null };
  }
  return { data: null, error: null };
};

// Diaries: every host free at SLOT unless named busy; each offers 9:00 and SLOT.
const { availabilityService } = await import('../src/services/calendar.service.js');
const PREFS: any = {
  timezone: 'Europe/London', buffer_before_minutes: 0, buffer_after_minutes: 0,
  minimum_notice_minutes: 0, booking_horizon_days: 30, slot_interval_minutes: 30, max_bookings_per_day: null,
};
(availabilityService as any).getPrefs = async (u: string) =>
  ({ ...PREFS, booking_horizon_days: u === CAT ? 60 : 30 });
(availabilityService as any).canBook = async (u: string) => !busy.has(u);
(availabilityService as any).slots = async (u: string) => {
  const hours = u === AMY ? [9, 10] : u === BEN ? [10, 11] : u === CAT ? [14] : [10];
  return hours.map((h) => ({
    start: new Date(`2026-11-03T${String(h).padStart(2, '0')}:00:00.000Z`),
    end: new Date(`2026-11-03T${String(h).padStart(2, '0')}:30:00.000Z`),
  }));
};

const { bookingMail } = await import('../src/services/booking-mail.service.js');
(bookingMail as any).confirmed = async (ctx: any) => { mails.push({ userId: ctx.userId }); return { invitee: true }; };
(bookingMail as any).canSend = async (u: string) => u !== CAT;
const { calendarSync } = await import('../src/services/calendar-sync.service.js');
(calendarSync as any).pushEvent = async (u: string) => { pushes.push(u); };

const { publicBookingService, bookingService } = await import('../src/services/booking.service.js');
const { roundRobinService } = await import('../src/services/round-robin.service.js');

const visitor = { start: SLOT, name: 'Maud Lee', email: 'maud@prospect.io', timezone: 'Europe/Paris' };
const newEvent = () => world.crm_events.find((e) => e.contact_email === 'maud@prospect.io');

/* ── Off by default ─────────────────────────────────────────────────── */

console.log('\nOff (the default)');
reset();
await refuses('a round-robin page is closed while the team has it off', () => publicBookingService.page('team-intro'), 403);
await refuses('its times are not offered', () => publicBookingService.slots('team-intro', new Date(), new Date(Date.now() + 86_400_000)), 403);
await refuses('and nobody can book it', () => publicBookingService.book('team-intro', { ...visitor }), 403);
is('...without the meeting quietly going to its owner', !newEvent());
{
  const page = await publicBookingService.page('olive');
  is('an ordinary link is unaffected', page.organiser === 'Olive Owner');
  await publicBookingService.book('olive', { ...visitor });
  is('and books its owner as before', newEvent()?.user_id === OWNER);
}
await refuses('a link cannot be switched to round robin while off',
  () => bookingService.updateLink(OWNER, SINGLE, { assignment: 'round_robin' }), 403);
{
  const kept = await bookingService.updateLink(OWNER, LINK, { headline: 'Intro call (team)' });
  is('but an existing round-robin link can still be edited', kept.headline === 'Intro call (team)');
  is('and reports why it is closed', kept.round_robin_blocked === 'team_off');
  const back = await bookingService.updateLink(OWNER, LINK, { assignment: 'single' });
  is('and can always be set back to just its owner', back.assignment === 'single' && !back.round_robin_blocked);
}

/* ── Who may switch it ──────────────────────────────────────────────── */

console.log('\nThe switch');
reset();
await refuses('a plain member cannot switch it on', () => roundRobinService.setEnabled(MEMBER, true), 403);
is('...and it stays off', world.organizations[0].round_robin_enabled === false);
{
  const s = await roundRobinService.setEnabled(OWNER, true);
  is('an admin can switch it on', s.enabled && world.organizations[0].round_robin_enabled === true);
  is('the hosts on offer are this team only', s.members.every((m) => m.user_id !== OUTSIDER) && s.members.length === 5);
}

/* ── On: who gets the meeting ───────────────────────────────────────── */

console.log('\nOn: sharing meetings out');
reset({ enabled: true });
{
  const page = await publicBookingService.page('team-intro');
  is('the page is the team\'s, not one person\'s', page.organiser === 'Northbeam');
  is('it looks as far ahead as the furthest host', page.horizon_days === 60);
  const slots = await publicBookingService.slots('team-intro', new Date(), new Date(Date.now() + 86_400_000));
  is('it offers every time anyone is free, once each',
    slots.map((s: any) => new Date(s.start).getUTCHours()).join() === '9,10,11,14');

  const done = await publicBookingService.book('team-intro', { ...visitor });
  const evt = newEvent();
  is('the free host with the fewest recent meetings gets it (Cat, 1)', evt?.user_id === CAT, `went to ${evt?.user_id}`);
  is('the confirmation names who they are meeting', done.organiser === 'Cat C');
  const contact = world.contacts.find((c) => c.email === 'maud@prospect.io');
  is('the contact is made in the host\'s account', contact?.user_id === CAT);
  is('and the meeting points at it', evt?.contact_id === contact?.id);
  is('the confirmation goes from the host', mails.length === 1 && mails[0].userId === CAT);
  is('it goes into the host\'s own calendar', pushes.join() === CAT);
  is('the host is stamped for the next tie-break',
    !!world.booking_link_hosts.find((h) => h.user_id === CAT).last_assigned_at);
}

reset({ enabled: true });
busy.add(CAT);
await publicBookingService.book('team-intro', { ...visitor });
is('somebody not free at that time is skipped (Amy, 2, over Ben, 3)', newEvent()?.user_id === AMY);

reset({ enabled: true });
taken.add(CAT);
await publicBookingService.book('team-intro', { ...visitor });
is('a host taken in the last instant passes it to the next', newEvent()?.user_id === AMY);
is('and no stray contact is left in the account that lost the race',
  !world.contacts.some((c) => c.user_id === CAT));

reset({ enabled: true });
taken.add(AMY); taken.add(BEN); taken.add(CAT);
await refuses('when everyone is taken at once the visitor is told, not given a 500',
  () => publicBookingService.book('team-intro', { ...visitor }), 409);

reset({ enabled: true });
busy.add(AMY); busy.add(BEN); busy.add(CAT);
await refuses('a time nobody is free at is refused', () => publicBookingService.book('team-intro', { ...visitor }), 409);

reset({ enabled: true });
world.booking_links[0].round_robin_strategy = 'priority';
await publicBookingService.book('team-intro', { ...visitor });
is('by priority, priority 1 (Ben) gets it despite the most meetings', newEvent()?.user_id === BEN);

/* ── Who can be offered at all ──────────────────────────────────────── */

console.log('\nWho is in the rotation');
reset({ enabled: true });
world.booking_link_hosts.find((h) => h.user_id === CAT).host_paused = true;
await publicBookingService.book('team-intro', { ...visitor });
is('a host who paused themselves is not offered', newEvent()?.user_id === AMY);

reset({ enabled: true });
world.team_members = world.team_members.filter((m) => m.user_id !== CAT);
await publicBookingService.book('team-intro', { ...visitor });
is('a host who left the team is not offered, whatever is stored', newEvent()?.user_id === AMY);

reset({ enabled: true });
for (const h of world.booking_link_hosts) h.host_paused = true;
await refuses('with everyone away the page closes', () => publicBookingService.page('team-intro'), 403);
{
  const [l] = (await bookingService.listLinks(OWNER)).filter((x: any) => x.id === LINK);
  is('and the owner is told why', l.round_robin_blocked === 'no_hosts');
}

/* ── Managing hosts ─────────────────────────────────────────────────── */

console.log('\nManaging hosts');
reset({ enabled: true });
await refuses('somebody off the team cannot be made a host',
  () => roundRobinService.setHosts(OWNER, LINK, [{ user_id: OUTSIDER, priority: 1 }]), 400);
await refuses('a link that is not yours cannot have its hosts changed',
  () => roundRobinService.setHosts(AMY, LINK, [{ user_id: AMY, priority: 1 }]), 404);
world.booking_link_hosts.find((h) => h.user_id === AMY).host_paused = true;
{
  const hosts = await roundRobinService.setHosts(OWNER, LINK, [
    { user_id: AMY, priority: 1, is_active: true },
    { user_id: BEN, priority: 2, is_active: false },
  ]);
  is('saving the list keeps a host\'s own pause', hosts.find((h) => h.user_id === AMY)?.host_paused === true);
  is('the owner can leave somebody out', hosts.find((h) => h.user_id === BEN)?.is_active === false);
  is('a host dropped from the list is removed', !hosts.some((h) => h.user_id === CAT));
}
{
  const hosts = await roundRobinService.setHosts(OWNER, LINK, [
    { user_id: AMY, priority: 1 }, { user_id: CAT, priority: 2 },
  ]);
  is('a host with no mailbox is flagged, one with is not',
    hosts.find((h) => h.user_id === CAT)?.can_email === false && hosts.find((h) => h.user_id === AMY)?.can_email === true);
}
{
  const hosts = await roundRobinService.hosts(OWNER, LINK);
  is('hosts carry their recent count', hosts.find((h) => h.user_id === AMY)?.recent_bookings === 2);
}

console.log('\nA host pausing themselves');
reset({ enabled: true });
{
  const mine = await roundRobinService.hostedLinks(AMY);
  is('a host sees the links they take meetings for', mine.length === 1 && mine[0].owner_name === 'Olive Owner');
  const after = await roundRobinService.setHostPaused(AMY, LINK, true);
  is('and can pause themselves', after[0].host_paused === true);
  await refuses('somebody who is not a host cannot', () => roundRobinService.setHostPaused(MEMBER, LINK, true), 404);
  is('someone on no rotation sees nothing', (await roundRobinService.hostedLinks(MEMBER)).length === 0);
}

console.log('\nLeaving the team');
reset({ enabled: true });
world.team_members = world.team_members.filter((m) => m.user_id !== BEN);
await roundRobinService.forgetMember(ORG, BEN);
is('a teammate who leaves is taken off the rotation', !world.booking_link_hosts.some((h) => h.user_id === BEN));

/* ── The owner's view of a team link ────────────────────────────────── */

console.log('\nThe owner\'s view');
reset({ enabled: true });
await publicBookingService.book('team-intro', { ...visitor });
{
  const rows = await bookingService.linkBookings(OWNER, LINK);
  const mine = rows.find((r: any) => r.contact_email === 'maud@prospect.io');
  is('the owner sees meetings their link gave teammates', !!mine);
  is('with who took each one', mine?.host_name === 'Cat C');
  is('no row leaks which account holds it', rows.every((r: any) => !('user_id' in r)));
  await refuses('nobody else can read a link\'s bookings', () => bookingService.linkBookings(AMY, LINK), 404);
}

console.log('\n{{booking_link}} in a sequence');
{
  const { defaultBookingLinkUrl } = await import('../src/services/booking.service.js');
  reset();
  is('a closed round-robin link is passed over for the next live one',
    (await defaultBookingLinkUrl(OWNER))?.endsWith('/b/olive') === true);
  reset({ enabled: true });
  is('an open one is used as the oldest live link',
    (await defaultBookingLinkUrl(OWNER))?.endsWith('/b/team-intro') === true);
}

console.log('\nA campaign visitor given to a teammate');
reset({ enabled: true });
{
  const { signBookingIdentity, NO_STEP } = await import('../src/utils/booking-token.js');
  const CC = '00000000-0000-0000-0000-0000000000cc';
  world.campaigns.push({ id: 'camp-1', user_id: OWNER, name: 'Q4 outbound' });
  world.contacts.push({ id: 'owner-contact', user_id: OWNER, email: 'maud@prospect.io', first_name: 'Maud' });
  world.campaign_contacts.push({ id: CC, campaign_id: 'camp-1', contact_id: 'owner-contact' });
  world.booking_link_visits.push({ id: 'v1', link_id: LINK, contact_id: 'owner-contact', booked_event_id: null });

  await publicBookingService.book('team-intro', { ...visitor }, signBookingIdentity(CC, NO_STEP));
  const evt = world.crm_events.find((e) => e.contact_email === 'maud@prospect.io');
  is('it still goes by the rules (Cat)', evt?.user_id === CAT);
  is('the teammate gets a contact of their own, not the owner\'s', evt?.contact_id !== 'owner-contact'
    && world.contacts.find((c) => c.id === evt?.contact_id)?.user_id === CAT);
  is('the owner\'s campaign is not written onto a teammate\'s meeting', !evt?.source_campaign_id);
  is('the owner\'s record of the contact says where it went',
    world.crm_notes.some((n) => n.user_id === OWNER && n.contact_id === 'owner-contact' && /with Cat C/.test(n.body)));
  is('the visit is marked as booked', world.booking_link_visits[0].booked_event_id === evt?.id);
}

console.log(`\n${pass} passed, ${fail} failed`);
assert.equal(fail, 0);

/*
 * The admin backend.
 *
 * Pins down what "only the owner can even see it" means, and what the
 * account controls promise:
 *
 *   - the owner's address is on the server only: not in the shared package,
 *     not anywhere in the client's source
 *   - the billing summary marks the owner, and says nothing to anyone else
 *   - every admin endpoint 404s for anyone but the owner
 *   - a suspended account is turned away on every request, whichever way it
 *     signed in, and billing gives it no sends and no credits; the owner can
 *     never be suspended
 *   - given credits are bonus credits, taken credits come off the month, and
 *     every change is written to the audit log
 *   - a paying account's plan is changed in Stripe itself, so Stripe's next
 *     event cannot quietly put the old plan back
 *   - "view as" is read-only, and a forged one is just a bad token
 *   - "sign out everywhere" refuses tokens issued before it
 *   - a sending hold stops every send; refunds only touch the account's own
 *     payments; the owners can never be deleted
 *   - an account's own limits and switches win over its plan's; the owners'
 *     plan limits and prices apply everywhere at once and can be put back;
 *     the stop-all-sending switch stops every account; bad settings are refused
 *   - bulk actions are bounded, need what each action needs, and one account
 *     failing does not stop the rest; alert switches are kept
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.SUPABASE_JWT_SECRET = 'admin-check-jwt-secret';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const OWNER = 'steven@usesincerely.com';
const OWNER_ID = '00000000-0000-0000-0000-00000000000a';
const USER_ID = '00000000-0000-0000-0000-0000000000b1';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* ── A fake database ────────────────────────────────────────────────── */

let controls: Record<string, any> = {};
let ledger: any[] = [];
let audit: any[] = [];
let bans: Record<string, string> = {};
let payments: any[] = [];
let platformRows: Record<string, any> = {};
const subscription: any = { plan: 'growth', status: 'active' };

function from(name: string): any {
  const filters: Record<string, any> = {};
  const run = () => {
    if (name === 'account_controls') return { data: controls[filters.user_id] ?? null, error: null };
    if (name === 'subscriptions') return { data: subscription, error: null };
    if (name === 'platform_settings') return { data: filters.key ? (platformRows[filters.key] ?? null) : Object.values(platformRows), error: null };
    if (name === 'billing_payments') return { data: payments.find((p) => p.stripe_ref === filters.stripe_ref) ?? null, error: null };
    if (name === 'prospect_credit_ledger') return { data: ledger.filter((r) => r.user_id === filters.user_id && (!filters.bucket || r.bucket === filters.bucket)), error: null };
    return { data: null, error: null };
  };
  const chain: any = {
    select: () => chain,
    eq: (c: string, v: any) => { filters[c] = v; return chain; },
    gte: () => chain, in: () => chain, order: () => chain, limit: () => chain, range: () => chain,
    maybeSingle: () => chain, single: () => chain,
    insert: (row: any) => {
      if (name === 'platform_settings') return { data: filters.key ? (platformRows[filters.key] ?? null) : Object.values(platformRows), error: null };
    if (name === 'billing_payments') return { data: payments.find((p) => p.stripe_ref === filters.stripe_ref) ?? null, error: null };
    if (name === 'prospect_credit_ledger') ledger.push(row);
      if (name === 'admin_audit_log') audit.push(row);
      return Promise.resolve({ data: null, error: null });
    },
    upsert: (row: any) => {
      if (name === 'platform_settings') platformRows[row.key] = row;
      if (name === 'account_controls') controls[row.user_id] = { ...(controls[row.user_id] || {}), ...row };
      return Promise.resolve({ data: null, error: null });
    },
    delete: () => { if (name === 'platform_settings') { const d: any = { eq: (_c: string, k: string) => { delete platformRows[k]; return Promise.resolve({ data: null, error: null }); } }; return d; } return chain; },
    update: (patch: any) => { if (name === 'subscriptions') Object.assign(subscription, patch); return chain; },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = from;
(supabaseAdmin as any).auth.admin.getUserById = async (id: string) => ({
  data: { user: { id, email: id === OWNER_ID ? OWNER : 'someone@example.com', created_at: new Date().toISOString() } }, error: null,
});
// Tokens we did not sign go to Supabase, which turns them down.
(supabaseAdmin as any).auth.getUser = async () => ({ data: { user: null }, error: { message: 'invalid JWT' } });
(supabaseAdmin as any).auth.admin.updateUserById = async (id: string, attrs: any) => { bans[id] = attrs.ban_duration; return { data: {}, error: null }; };

const { isOwnerEmail } = await import('../src/config/admin.js');
const { adminOnly } = await import('../src/middleware/admin.middleware.js');
const { authMiddleware } = await import('../src/middleware/auth.middleware.js');
const { billingService } = await import('../src/services/billing.service.js');
const { accountControls } = await import('../src/services/account-controls.service.js');
const { adminAccountsService } = await import('../src/services/admin-accounts.service.js');
const shared = await import('@lemlist/shared');
const jwt = (await import('jsonwebtoken')).default;

function fakeRes() {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
async function call(mw: any, req: any) {
  const res = fakeRes();
  let passed = false;
  await mw(req, res, () => { passed = true; });
  return { res, passed };
}
const bearer = (sub: string, email: string, method = 'GET', iat?: number) => ({
  method,
  headers: { authorization: `Bearer ${jwt.sign(iat ? { sub, email, iat } : { sub, email }, process.env.SUPABASE_JWT_SECRET!)}` },
});
const withToken = (token: string, method = 'GET') => ({ method, headers: { authorization: `Bearer ${token}` } });

console.log('\nThe owner is known to the server alone');
{
  is('the owner is recognised, in any case', isOwnerEmail(OWNER) && isOwnerEmail('  Steven@UseSincerely.com '));
  is('the second owner is recognised', isOwnerEmail('affivault@gmail.com') && isOwnerEmail(' AffiVault@Gmail.com'));
  is('nobody else is', !isOwnerEmail('someone@example.com') && !isOwnerEmail('') && !isOwnerEmail(undefined));
  is('the shared package does not export an admin list', !('ADMIN_EMAILS' in shared));

  const leaks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { if (entry !== 'node_modules' && entry !== 'dist') walk(full); continue; }
      if (/\.(ts|tsx|js|json|html|css)$/.test(entry) && readFileSync(full, 'utf8').toLowerCase().includes(OWNER)) leaks.push(full.slice(root.length + 1));
    }
  };
  walk(join(root, 'client', 'src'));
  walk(join(root, 'shared', 'src'));
  is('the owner\'s address is nowhere in the client or shared source', leaks.length === 0, leaks.join(', '));
}

console.log('\nEvery admin endpoint is hidden from everyone else');
{
  const stranger = await call(adminOnly, { userEmail: 'someone@example.com' });
  is('a stranger gets a 404, as if nothing were there', stranger.res.statusCode === 404 && !stranger.passed);
  const anon = await call(adminOnly, {});
  is('so does a request with no account', anon.res.statusCode === 404 && !anon.passed);
  const owner = await call(adminOnly, { userEmail: OWNER });
  is('the owner gets through', owner.passed);
}

console.log('\nA suspended account is turned away');
{
  controls = {};
  const before = await call(authMiddleware, bearer(USER_ID, 'someone@example.com'));
  is('an account in good standing gets through', before.passed);

  await adminAccountsService.suspend(OWNER, USER_ID, 'chargeback');
  is('suspending records when and why', !!controls[USER_ID]?.suspended_at && controls[USER_ID]?.suspended_reason === 'chargeback');
  is('and bans them at sign-in', bans[USER_ID] === '876000h');
  is('and is written to the audit log', audit.some((a) => a.action === 'suspend' && a.target_user_id === USER_ID && a.actor_email === OWNER));

  const after = await call(authMiddleware, bearer(USER_ID, 'someone@example.com'));
  is('their next request is refused, at once', !after.passed && after.res.statusCode === 403 && after.res.body?.code === 'ACCOUNT_SUSPENDED');
  const viaKey = await call(authMiddleware, { headers: {}, userId: USER_ID, userEmail: 'someone@example.com', authMethod: 'apikey' });
  is('an API key of theirs is refused too', !viaKey.passed && viaKey.res.statusCode === 403);

  const limits = await billingService.getLimits(USER_ID);
  is('billing gives them no sends and no inboxes', limits.emailsPerMonth === 0 && limits.maxInboxes === 0);
  is('and no credits', (await billingService.getCreditAllowance(USER_ID)) === 0);

  try { await adminAccountsService.suspend(OWNER, OWNER_ID); is('the owner cannot be suspended', false); }
  catch (e: any) { is('the owner cannot be suspended', e?.statusCode === 400 && !controls[OWNER_ID]); }
  controls[OWNER_ID] = { suspended_at: new Date().toISOString() };
  accountControls.forget(OWNER_ID);
  const ownerIn = await call(authMiddleware, bearer(OWNER_ID, OWNER));
  is('and is never locked out, whatever the table says', ownerIn.passed);
  delete controls[OWNER_ID];

  await adminAccountsService.unsuspend(OWNER, USER_ID);
  const back = await call(authMiddleware, bearer(USER_ID, 'someone@example.com'));
  is('lifting it lets them straight back in', back.passed && bans[USER_ID] === 'none');
  is('with their plan back', (await billingService.getCreditAllowance(USER_ID)) === shared.PLANS.growth.prospectCredits);
}

console.log('\nGiving and taking credits');
{
  ledger = []; audit = [];
  await adminAccountsService.adjustCredits(OWNER, USER_ID, 50, 'goodwill');
  is('given credits are bonus credits that never expire', ledger[0]?.bucket === 'purchased' && ledger[0]?.delta === 50 && ledger[0]?.kind === 'adjustment');
  await adminAccountsService.adjustCredits(OWNER, USER_ID, -20.04, 'mistake');
  is('taken credits come off this month, to a tenth', ledger[1]?.bucket === 'plan' && ledger[1]?.delta === -20);
  is('and they are kept out of the usage reports, under their own label', shared.CREDIT_ACTION_LABELS.adjustment === 'Credit adjustments');
  is('both are in the audit log with the note', audit.filter((a) => a.action === 'credits').map((a) => a.details.note).join() === 'goodwill,mistake');
  for (const [amount, note, label] of [[0, 'x', 'zero'], [50, '  ', 'no note'], [Number.NaN, 'x', 'not a number'], [1e7, 'x', 'too many']] as const) {
    try { await adminAccountsService.adjustCredits(OWNER, USER_ID, amount, note); is(`${label} is refused`, false); }
    catch (e: any) { is(`${label} is refused`, e?.statusCode === 400); }
  }
}

console.log('\nA paying account is changed in Stripe too');
{
  const { stripeService } = await import('../src/services/stripe.service.js');
  const calls: string[] = [];
  const fake: any = { id: 'sub_1', status: 'active' };
  let reachable = true;
  Object.assign(stripeService as any, {
    isConfigured: () => true,
    liveSubscription: async () => { if (!reachable) throw new Error('down'); return fake; },
    changeSubscriptionPlan: async (_s: any, plan: string) => { calls.push(`change:${plan}`); },
    cancelSubscriptionNow: async () => { calls.push('cancel'); },
  });
  const reset = () => { Object.assign(subscription, { plan: 'growth', status: 'active', stripe_subscription_id: 'sub_1' }); calls.length = 0; audit = []; };

  reset();
  const up = await adminAccountsService.setPlan(OWNER, USER_ID, 'starter');
  is('Starter or Growth swaps the price in Stripe', up.stripe === 'changed' && calls.join() === 'change:starter');
  is('and the log says Stripe was changed', audit[0]?.details?.stripe === 'changed');

  reset();
  const free = await adminAccountsService.setPlan(OWNER, USER_ID, 'free');
  is('Free cancels the Stripe subscription', free.stripe === 'canceled' && calls.join() === 'cancel' && subscription.plan === 'free');

  reset();
  await adminAccountsService.setPlan(OWNER, USER_ID, 'lifetime');
  is('Lifetime cancels it too, so they are not charged for a free plan', calls.join() === 'cancel' && subscription.plan === 'lifetime');

  reset();
  try { await adminAccountsService.setPlan(OWNER, USER_ID, 'scale'); is('Scale on a paying account is refused, not half done', false); }
  catch (e: any) { is('Scale on a paying account is refused, not half done', e?.statusCode === 400 && calls.length === 0 && subscription.plan === 'growth'); }

  reset(); reachable = false;
  try { await adminAccountsService.setPlan(OWNER, USER_ID, 'free'); is('Stripe down: nothing is changed', false); }
  catch (e: any) { is('Stripe down: nothing is changed', e?.statusCode === 502 && subscription.plan === 'growth' && audit.length === 0); }
  reachable = true;

  Object.assign(subscription, { plan: 'growth', status: 'active', stripe_subscription_id: null });
}

console.log('\nViewing the app as an account');
{
  const { viewAs } = await import('../src/services/view-as.service.js');
  const { token } = viewAs.mint(USER_ID, 'someone@example.com', OWNER);
  const read = await call(authMiddleware, withToken(token, 'GET'));
  is('it reads as them', read.passed);
  const req: any = withToken(token, 'GET');
  await call(authMiddleware, req);
  is('as that account, with who is looking', req.userId === USER_ID && req.viewAsBy === OWNER);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const w = await call(authMiddleware, withToken(token, m));
    is(`and cannot ${m}`, !w.passed && w.res.statusCode === 403 && w.res.body?.code === 'VIEW_AS_READ_ONLY');
  }
  const forged = jwt.sign({ sub: USER_ID, email: 'someone@example.com', act: OWNER }, 'not-our-key', { issuer: 'sincerely-view-as', expiresIn: '30m' });
  const f = await call(authMiddleware, withToken(forged));
  is('a forged one is refused', !f.passed && f.res.statusCode === 401);
  const expired = jwt.sign({ sub: USER_ID, email: 'someone@example.com', act: OWNER, exp: Math.floor(Date.now() / 1000) - 60 }, 'x');
  is('and an expired or foreign one is not a view-as token at all', viewAs.verify(expired) === null);
}

console.log('\nSigning out everywhere');
{
  controls = {}; accountControls.forget(USER_ID);
  const old = Math.floor(Date.now() / 1000) - 120;
  controls[USER_ID] = { user_id: USER_ID, sessions_revoked_at: new Date(Date.now() - 60_000).toISOString() };
  accountControls.forget(USER_ID);
  const before = await call(authMiddleware, bearer(USER_ID, 'someone@example.com', 'GET', old));
  is('a token issued before it is refused', !before.passed && before.res.statusCode === 401);
  const after = await call(authMiddleware, bearer(USER_ID, 'someone@example.com', 'GET'));
  is('signing in again works', after.passed);
  controls = {}; accountControls.forget(USER_ID);
}

console.log('\nA hold on sending, refunds, deleting');
{
  controls = { [USER_ID]: { user_id: USER_ID, sending_paused_at: new Date().toISOString() } };
  accountControls.forget(USER_ID);
  is('a held account has no email quota', (await billingService.hasEmailQuota(USER_ID)) === false);
  is('and cannot reserve a send', (await billingService.reserveEmailQuota(USER_ID)) === false);
  controls = {}; accountControls.forget(USER_ID);

  const { adminControlService } = await import('../src/services/admin-control.service.js');
  const { stripeService } = await import('../src/services/stripe.service.js');
  let refunded = '';
  Object.assign(stripeService as any, { isConfigured: () => true, refundPayment: async (ref: string) => { refunded = ref; return { refunded_usd: 99 }; } });
  payments = [{ stripe_ref: 'in_theirs', amount_usd: 99, kind: 'subscription', user_id: USER_ID }, { stripe_ref: 'in_other', amount_usd: 99, kind: 'subscription', user_id: 'someone-else' }];
  try { await adminControlService.refund(OWNER, USER_ID, 'in_other'); is('another account\'s payment cannot be refunded from here', false); }
  catch (e: any) { is('another account\'s payment cannot be refunded from here', e?.statusCode === 404 && refunded === ''); }
  try { await adminControlService.refund(OWNER, USER_ID, 'in_theirs', 150); is('nor more than was paid', false); }
  catch (e: any) { is('nor more than was paid', e?.statusCode === 400 && refunded === ''); }
  await adminControlService.refund(OWNER, USER_ID, 'in_theirs');
  is('their own is refunded, and logged', refunded === 'in_theirs' && audit.some((a) => a.action === 'refund'));

  try { await adminControlService.deleteAccount(OWNER, OWNER_ID, OWNER); is('an owner account cannot be deleted', false); }
  catch (e: any) { is('an owner account cannot be deleted', e?.statusCode === 400); }
  try { await adminControlService.deleteAccount(OWNER, USER_ID, 'wrong@example.com'); is('deleting needs their email typed exactly', false); }
  catch (e: any) { is('deleting needs their email typed exactly', e?.statusCode === 400); }
}

console.log('\nPlatform settings and an account\'s own limits');
{
  const { platformSettings } = await import('../src/services/platform-settings.service.js');
  const { adminPlatformService } = await import('../src/services/admin-platform.service.js');
  Object.assign(subscription, { plan: 'growth', status: 'active', stripe_subscription_id: null, credit_allowance: null });
  controls = {}; accountControls.forget(USER_ID); platformRows = {}; platformSettings.reset();

  controls[USER_ID] = { user_id: USER_ID, limit_overrides: { maxInboxes: 60 }, feature_overrides: { abTesting: false } };
  accountControls.forget(USER_ID);
  const own = await billingService.getLimits(USER_ID);
  is('an account\'s own inbox limit wins over the plan\'s', own.maxInboxes === 60);
  is('and its own switch turns a plan feature off', own.features.abTesting === false && own.features.sara === true);
  is('what it leaves blank stays the plan\'s', own.emailsPerMonth === shared.PLANS.growth.emailsPerMonth);
  controls = {}; accountControls.forget(USER_ID);

  try { await adminPlatformService.setOverrides(OWNER, USER_ID, { limits: { maxInboxes: -5 } }); is('a nonsense limit is refused', false); }
  catch (e: any) { is('a nonsense limit is refused', e?.statusCode === 400); }

  const growthCredits = shared.PLANS.growth.prospectCredits;
  const reveal = shared.CREDIT_PRICES.reveal;
  await adminPlatformService.savePlans(OWNER, { growth: { prospectCredits: 1500, emailsPerMonth: 20000 } });
  is('the owners\' plan credits apply at once', (await billingService.getCreditAllowance(USER_ID)) === 1500);
  is('and so do their plan limits', (await billingService.getLimits(USER_ID)).emailsPerMonth === 20000);
  await adminPlatformService.savePrices(OWNER, { reveal: 1.5 });
  is('a new price is what is charged', shared.CREDIT_PRICES.reveal === 1.5);
  is('and what the price list says', shared.CREDIT_PRICE_LIST.find((r) => r.action === 'reveal')?.price === 1.5);
  await adminPlatformService.savePlans(OWNER, {});
  await adminPlatformService.savePrices(OWNER, {});
  is('clearing them puts the defaults back', shared.PLANS.growth.prospectCredits === growthCredits && shared.CREDIT_PRICES.reveal === reveal);
  is('each change is in the log', audit.filter((a) => /^setting_/.test(a.action)).length === 4);

  for (const [label, fn] of [
    ['unlimited credits are refused', () => adminPlatformService.savePlans(OWNER, { growth: { prospectCredits: -1 } })],
    ['a negative price is refused', () => adminPlatformService.savePrices(OWNER, { search: -1 })],
    ['an unknown sign-up mode is refused', () => adminPlatformService.saveSignups(OWNER, { mode: 'maybe', allow: [] })],
    ['a bad address on the invite list is refused', () => adminPlatformService.saveSignups(OWNER, { mode: 'invite', allow: ['not an address'] })],
    ['an announcement over 280 characters is refused', () => adminPlatformService.saveAnnouncement(OWNER, { text: 'x'.repeat(281) })],
    ['a javascript: link is refused', () => adminPlatformService.saveAnnouncement(OWNER, { text: 'hi', link_url: 'javascript:alert(1)' })],
    ['stopping all sending needs a reason', () => adminPlatformService.setKillSwitch(OWNER, true, '  ')],
  ] as const) {
    try { await (fn as any)(); is(label, false); } catch (e: any) { is(label, e?.statusCode === 400); }
  }

  await adminPlatformService.saveSignups(OWNER, { mode: 'invite', allow: ['@Acme.com', 'jane@x.io'] });
  is('the invite list is kept, lower case', JSON.stringify((await platformSettings.get()).signups) === JSON.stringify({ mode: 'invite', allow: ['@acme.com', 'jane@x.io'] }));
  const pub = await platformSettings.publicInfo();
  is('the public info says invite-only and nothing more about who', pub.signups === 'invite' && !('allow' in (pub as any)));
  await adminPlatformService.saveSignups(OWNER, { mode: 'open', allow: [] });

  await adminPlatformService.setKillSwitch(OWNER, true, 'incident');
  is('the platform switch stops every account\'s sending', (await billingService.reserveEmailQuota(USER_ID)) === false && (await accountControls.isSendingPaused(USER_ID)) === true);
  await adminPlatformService.setKillSwitch(OWNER, false);
  is('and turning it off lets them send again', (await accountControls.isSendingPaused(USER_ID)) === false);
  platformSettings.reset();
}

console.log('\nBulk actions and alerts');
{
  const { adminInsightsService } = await import('../src/services/admin-insights.service.js');
  for (const [label, fn] of [
    ['picking nobody is refused', () => adminInsightsService.bulk(OWNER, 'hold_sending', [], {})],
    ['more than 200 at once is refused', () => adminInsightsService.bulk(OWNER, 'hold_sending', Array.from({ length: 201 }, (_, i) => `id-${i}`), {})],
    ['giving credits needs an amount and a reason', () => adminInsightsService.bulk(OWNER, 'give_credits', [USER_ID], { amount: 50, note: ' ' })],
    ['an unknown action is refused', () => adminInsightsService.bulk(OWNER, 'nuke' as any, [USER_ID], {})],
  ] as const) {
    try { await (fn as any)(); is(label, false); } catch (e: any) { is(label, e?.statusCode === 400); }
  }
  controls = {}; audit = [];
  const r = await adminInsightsService.bulk(OWNER, 'suspend', [OWNER_ID, USER_ID, USER_ID], { reason: 'abuse' });
  is('one that fails (an owner) does not stop the rest', r.done === 1 && r.failed.length === 1 && r.failed[0].id === OWNER_ID);
  is('and each one done is logged as if by hand', audit.filter((a) => a.action === 'suspend').length === 1 && !!controls[USER_ID]?.suspended_at);
  await adminAccountsService.unsuspend(OWNER, USER_ID);

  platformRows = {};
  await adminInsightsService.saveAlertSettings(OWNER, { new_paying: true, icypeas_low: false, bogus: true } as any);
  const a = await adminInsightsService.alertSettings();
  is('alert switches are kept', a.ready && a.enabled.new_paying === true && a.enabled.icypeas_low === false && a.enabled.payment_failed === true && !('bogus' in a.enabled));
  platformRows = {};
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

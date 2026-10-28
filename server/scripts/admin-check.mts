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
const subscription: any = { plan: 'growth', status: 'active' };

function from(name: string): any {
  const filters: Record<string, any> = {};
  const run = () => {
    if (name === 'account_controls') return { data: controls[filters.user_id] ?? null, error: null };
    if (name === 'subscriptions') return { data: subscription, error: null };
    if (name === 'prospect_credit_ledger') return { data: ledger.filter((r) => r.user_id === filters.user_id && (!filters.bucket || r.bucket === filters.bucket)), error: null };
    return { data: null, error: null };
  };
  const chain: any = {
    select: () => chain,
    eq: (c: string, v: any) => { filters[c] = v; return chain; },
    gte: () => chain, in: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: () => chain, single: () => chain,
    insert: (row: any) => {
      if (name === 'prospect_credit_ledger') ledger.push(row);
      if (name === 'admin_audit_log') audit.push(row);
      return Promise.resolve({ data: null, error: null });
    },
    upsert: (row: any) => {
      if (name === 'account_controls') controls[row.user_id] = { ...(controls[row.user_id] || {}), ...row };
      return Promise.resolve({ data: null, error: null });
    },
    update: () => chain,
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return chain;
}

const { supabaseAdmin } = await import('../src/config/supabase.js');
(supabaseAdmin as any).from = from;
(supabaseAdmin as any).auth.admin.getUserById = async (id: string) => ({
  data: { user: { id, email: id === OWNER_ID ? OWNER : 'someone@example.com', created_at: new Date().toISOString() } }, error: null,
});
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
const bearer = (sub: string, email: string) => ({ headers: { authorization: `Bearer ${jwt.sign({ sub, email }, process.env.SUPABASE_JWT_SECRET!)}` } });

console.log('\nThe owner is known to the server alone');
{
  is('the owner is recognised, in any case', isOwnerEmail(OWNER) && isOwnerEmail('  Steven@UseSincerely.com '));
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
  is('and they are kept out of the usage reports, under their own label', shared.CREDIT_ACTION_LABELS.adjustment === 'Admin adjustments');
  is('both are in the audit log with the note', audit.filter((a) => a.action === 'credits').map((a) => a.details.note).join() === 'goodwill,mistake');
  for (const [amount, note, label] of [[0, 'x', 'zero'], [50, '  ', 'no note'], [Number.NaN, 'x', 'not a number'], [1e7, 'x', 'too many']] as const) {
    try { await adminAccountsService.adjustCredits(OWNER, USER_ID, amount, note); is(`${label} is refused`, false); }
    catch (e: any) { is(`${label} is refused`, e?.statusCode === 400); }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

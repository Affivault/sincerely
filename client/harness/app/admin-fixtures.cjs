// The credits page and the owner's admin backend. HARNESS_OWNER=1 signs the
// harness in as the platform owner; without it the account is an ordinary one.
const DAY = 86400000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const ago = (d) => iso(now - d * DAY);
const ahead = (d) => iso(now + d * DAY);
const month = (o = 0) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + o, 1)).toISOString().slice(0, 7); };
const owner = () => process.env.HARNESS_OWNER === '1';

const credits = { allowance: 1000, used: 212.5, plan_remaining: 787.5, purchased: 50, remaining: 837.5, resets_at: ahead(18) };
const report = {
  credits,
  prices: [
    { action: 'search', label: 'Search: each new page of 25 people', price: 0.5, note: 'Pages loaded in the last 10 minutes and match counts are free.' },
    { action: 'reveal', label: 'Find a work email', price: 1, note: 'Only when an email is found. People you already revealed are free.' },
    { action: 'verify', label: 'Verify an email (deep check)', price: 0.1, note: 'Only when the free checks cannot settle it.' },
    { action: 'enrich', label: 'Enrich a contact', price: 2, note: 'Refunded when nothing is found.' },
  ],
  trial_capped: false,
  by_action: [{ action: 'reveal', credits: 141, count: 141 }, { action: 'search', credits: 52.5, count: 105 }, { action: 'enrich', credits: 16, count: 8 }, { action: 'verify', credits: 3, count: 30 }],
  history: [
    { id: 'l1', delta: -1, kind: 'spend', action: 'reveal', reason: 'reveal', created_at: ago(0.1) },
    { id: 'l2', delta: 1, kind: 'refund', action: 'reveal', reason: 'no_email_found', created_at: ago(0.2) },
    { id: 'l3', delta: -0.5, kind: 'spend', action: 'search', reason: 'search', created_at: ago(0.3) },
    { id: 'l4', delta: 50, kind: 'adjustment', action: 'adjustment', reason: 'Goodwill after the outage', created_at: ago(2) },
  ],
};

const emails = ['maud@northbeam.io', 'tomas@latticelabs.com', 'priya@brightwave.co', 'jonas@fernhill.de', 'amara@kestrelpay.com', 'liam@harborco.ie', 'free.user@gmail.com', 'trial@tessellate.io', 'steven@usesincerely.com'];
const plans = [['growth', 'active'], ['starter', 'active'], ['growth', 'trialing'], ['lifetime', 'active'], ['free', 'free'], ['scale', 'active'], ['free', 'free'], ['starter', 'trialing'], ['lifetime', 'active']];
const accounts = emails.map((email, i) => {
  const [plan, status] = plans[i];
  const allowance = { growth: 1000, starter: 250, scale: 5000, lifetime: 1000, free: 25 }[plan] * (status === 'trialing' ? 0 : 1) || (status === 'trialing' ? 100 : 25);
  const used = [612, 240, 96, 30, 25, 1400, 3, 12, 0][i];
  const cost = Math.round(used * 0.6 * 0.019 * 100) / 100;
  const revenue = [99, 39, 0, 0, 0, 299, 0, 0, 0][i];
  const fees = revenue ? revenue * 0.029 + 0.3 : 0;
  return {
    id: `0000000${i}-aaaa-bbbb-cccc-00000000000${i}`, email, created_at: ago(60 - i * 6), last_sign_in_at: i === 6 ? null : ago(i * 0.7),
    email_confirmed: i !== 7, plan, status, effective_plan: plan, suspended: i === 4, has_stripe: revenue > 0,
    credits_used: used, credit_allowance: i === 5 ? 7500 : allowance, custom_allowance: i === 5, cost_usd: cost, revenue_usd: revenue,
    profit_usd: Math.round((revenue - fees - cost) * 100) / 100, lifetime_revenue_usd: revenue * 3, lifetime_profit_usd: Math.round((revenue * 3 - fees * 3 - cost * 2.5) * 100) / 100,
    losing: cost > 0 && cost > revenue - fees,
  };
});

const audit = [
  { id: 'a1', actor_email: 'steven@usesincerely.com', action: 'credits', target_user_id: accounts[0].id, target_email: accounts[0].email, details: { amount: 50, note: 'Goodwill after the outage' }, created_at: ago(2) },
  { id: 'a2', actor_email: 'steven@usesincerely.com', action: 'suspend', target_user_id: accounts[4].id, target_email: accounts[4].email, details: { reason: 'Chargeback' }, created_at: ago(3) },
  { id: 'a3', actor_email: 'steven@usesincerely.com', action: 'plan', target_user_id: accounts[5].id, target_email: accounts[5].email, details: { from: { plan: 'growth', status: 'active' }, to: { plan: 'scale', status: 'active' } }, created_at: ago(9) },
  { id: 'a4', actor_email: 'steven@usesincerely.com', action: 'allowance', target_user_id: accounts[5].id, target_email: accounts[5].email, details: { from: null, to: 7500 }, created_at: ago(9) },
  { id: 'a5', actor_email: 'steven@usesincerely.com', action: 'lifetime_grant', target_user_id: accounts[3].id, target_email: accounts[3].email, details: {}, created_at: ago(20) },
];

function detail(id) {
  const a = accounts.find((x) => x.id === id) || accounts[0];
  const months = [0, -1, -2, -3, -4, -5].map((o, i) => ({ month: month(o), credits_used: Math.max(0, a.credits_used - i * 90), provider_credits: Math.max(0, a.credits_used * 0.6 - i * 50), cost_usd: Math.max(0, a.cost_usd - i * 0.9), revenue_usd: i < 3 ? a.revenue_usd : 0, fees_usd: i < 3 && a.revenue_usd ? 3.17 : 0, profit_usd: (i < 3 ? a.revenue_usd - 3.17 : 0) - Math.max(0, a.cost_usd - i * 0.9) }));
  return {
    account: a,
    subscription: { plan: a.plan, status: a.status, trial_ends_at: a.status === 'trialing' ? ahead(9) : null, current_period_end: ahead(18), stripe_customer_id: a.has_stripe ? 'cus_Q1w2e3r4' : null, stripe_subscription_id: a.has_stripe ? 'sub_9z8y7x' : null, credit_allowance: a.custom_allowance ? a.credit_allowance : null },
    controls: { suspended_at: a.suspended ? ago(3) : null, suspended_reason: a.suspended ? 'Chargeback' : null, note: a.custom_allowance ? 'Scale deal: 7,500 credits a month, billed annually.' : null },
    credits: { allowance: a.credit_allowance, used: a.credits_used, plan_remaining: Math.max(0, a.credit_allowance - a.credits_used), bonus: 50, remaining: Math.max(0, a.credit_allowance - a.credits_used) + 50, resets_at: ahead(18) },
    emails: { sent: 1874, limit: 10000, inboxes: 3, inbox_limit: 10 },
    totals: { lifetime_revenue_usd: a.lifetime_revenue_usd, lifetime_cost_usd: a.cost_usd * 2.5, lifetime_fees_usd: 9.51, lifetime_profit_usd: a.lifetime_profit_usd, lifetime_credits_used: a.credits_used * 2.4 },
    months,
    ledger: report.history.concat(Array.from({ length: 12 }, (_, i) => ({ id: `lx${i}`, delta: -0.5, kind: 'spend', bucket: 'plan', action: 'search', reason: 'search', created_at: ago(1 + i / 3) }))),
    calls: Array.from({ length: 8 }, (_, i) => ({ id: `pc${i}`, action: i % 2 ? 'search' : 'reveal', endpoint: i % 2 ? '/find-people' : '/email-search', provider_credits: i % 2 ? 0.5 : 1, cost_usd: i % 2 ? 0.0095 : 0.019, created_at: ago(i / 4) })),
    payments: a.revenue_usd ? [0, 1, 2].map((m) => ({ id: `pay${m}`, kind: 'subscription', amount_usd: a.revenue_usd, currency: 'usd', stripe_ref: `in_1Q${m}abc`, paid_at: ago(m * 30 + 2) })) : [],
    resources: { mailboxes: 3, domains: 1, contacts: 1240, campaigns: 6 },
    audit: audit.filter((e) => e.target_user_id === a.id),
    controls_ready: true,
  };
}

function adminAnswer(method, path) {
  if (path === '/billing/usage' || path === '/billing/refresh') {
    const u = { plan: 'growth', planName: 'Growth', status: 'active', trialEndsAt: null, periodStart: ago(12).slice(0, 10), currentPeriodEnd: ahead(18), emailsSent: 1874, emailsLimit: 10000, inboxes: 3, inboxLimit: 10, features: { sara: true, abTesting: true }, hasBilling: true };
    return owner() ? { ...u, isOwner: true } : u;
  }
  if (path === '/billing/credits') return report;
  if (!path.startsWith('/admin')) return undefined;
  // The server hides every admin endpoint from anyone but the owner.
  if (!owner()) return { __status: 404, __body: { error: 'Not found' } };
  if (method === 'POST') {
    if (/\/plan$/.test(path)) return { stripe_managed: false };
    return { success: true };
  }
  if (path === '/admin/stats') return { total_users: 312, lifetime_users: 4, paying_users: 41, free_users: 267, mailboxes: 388, domains: 97, contacts: 184220, campaigns: 520 };
  if (path === '/admin/usage') {
    const users = accounts.filter((a) => a.credits_used || a.revenue_usd).map((a) => ({ user_id: a.id, email: a.email, plan: a.plan, status: a.status, credits_charged: a.credits_used, provider_credits: a.credits_used * 0.6, cost_usd: a.cost_usd, revenue_usd: a.revenue_usd, fees_usd: a.revenue_usd ? 3.17 : 0, profit_usd: a.profit_usd, losing: a.losing }));
    return { month: month(), usd_per_provider_credit: 0.019, totals: { provider_credits: 1428.4, cost_usd: 27.14, revenue_usd: 437, fees_usd: 13.57, profit_usd: 396.29, credits_charged: 2418.5 }, unattributed_cost_usd: 0.42,
      by_action: [{ action: 'reveal', calls: 812, provider_credits: 812, cost_usd: 15.43, credits_charged: 1203 }, { action: 'search', calls: 410, provider_credits: 205, cost_usd: 3.9, credits_charged: 1010.5 }, { action: 'enrich', calls: 120, provider_credits: 380, cost_usd: 7.22, credits_charged: 180 }, { action: 'verify', calls: 314, provider_credits: 31.4, cost_usd: 0.6, credits_charged: 25 }],
      users, provider_balance: { credits: 8420, low: false, note: null }, revenue_synced: true };
  }
  if (path === '/admin/accounts') return { month: month(), accounts, controls_ready: true };
  if (/^\/admin\/accounts\/[^/]+$/.test(path)) return detail(path.split('/').pop());
  if (path === '/admin/audit') return { entries: audit, controls_ready: true };
  return undefined;
}

module.exports = { adminAnswer };

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
  { id: 'a6', actor_email: 'steven@usesincerely.com', action: 'setting_signups', target_user_id: null, target_email: null, details: { mode: 'invite', allowed: 2 }, created_at: ago(1) },
  { id: 'a7', actor_email: 'steven@usesincerely.com', action: 'overrides', target_user_id: accounts[5].id, target_email: accounts[5].email, details: { limits: { maxInboxes: 60 }, features: {} }, created_at: ago(1.5) },
  { id: 'a5', actor_email: 'steven@usesincerely.com', action: 'lifetime_grant', target_user_id: accounts[3].id, target_email: accounts[3].email, details: {}, created_at: ago(20) },
];

function detail(id) {
  const a = accounts.find((x) => x.id === id) || accounts[0];
  const months = [0, -1, -2, -3, -4, -5].map((o, i) => ({ month: month(o), credits_used: Math.max(0, a.credits_used - i * 90), provider_credits: Math.max(0, a.credits_used * 0.6 - i * 50), cost_usd: Math.max(0, a.cost_usd - i * 0.9), revenue_usd: i < 3 ? a.revenue_usd : 0, fees_usd: i < 3 && a.revenue_usd ? 3.17 : 0, profit_usd: (i < 3 ? a.revenue_usd - 3.17 : 0) - Math.max(0, a.cost_usd - i * 0.9) }));
  return {
    account: a,
    subscription: { plan: a.plan, status: a.status, trial_ends_at: a.status === 'trialing' ? ahead(9) : null, current_period_end: ahead(18), stripe_customer_id: a.has_stripe ? 'cus_Q1w2e3r4' : null, stripe_subscription_id: a.has_stripe ? 'sub_9z8y7x' : null, credit_allowance: a.custom_allowance ? a.credit_allowance : null },
    controls: { suspended_at: a.suspended ? ago(3) : null, suspended_reason: a.suspended ? 'Chargeback' : null, note: a.custom_allowance ? 'Scale deal: 7,500 credits a month, billed annually.' : null, sessions_revoked_at: null, sending_paused_at: a.plan === 'starter' && a.status === 'active' ? ago(1) : null, overrides: a.plan === 'scale' ? { limits: { maxInboxes: 60 }, features: {} } : { limits: {}, features: a.plan === 'starter' ? { sara: true } : {} } },
    plan_limits: { maxInboxes: a.plan === 'starter' ? 3 : 25, emailsPerMonth: a.plan === 'starter' ? 1500 : 15000, features: { sara: a.plan !== 'starter', abTesting: a.plan !== 'starter' } },
    stripe: a.has_stripe ? { status: a.status, price_usd: a.revenue_usd, interval: 'month', cancel_at_period_end: a.plan === 'growth', cancel_at: a.plan === 'growth' ? ahead(18) : null, trial_end: null, current_period_end: ahead(18), discount: a.plan === 'scale' ? '20% off for 3 months' : null, balance_usd: a.plan === 'scale' ? -25 : 0 } : null,
    live_campaigns: a.suspended ? 0 : 3,
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

const planDefaults = { free: { name: 'Free', maxInboxes: 1, emailsPerMonth: 100, prospectCredits: 25 }, trial: { name: 'Trial', maxInboxes: 25, emailsPerMonth: 15000, prospectCredits: 100 }, starter: { name: 'Starter', maxInboxes: 3, emailsPerMonth: 1500, prospectCredits: 250 }, growth: { name: 'Growth', maxInboxes: 25, emailsPerMonth: 15000, prospectCredits: 1000 }, scale: { name: 'Scale', maxInboxes: -1, emailsPerMonth: -1, prospectCredits: 5000 }, lifetime: { name: 'Lifetime', maxInboxes: -1, emailsPerMonth: -1, prospectCredits: 1000 } };
const announcement = process.env.HARNESS_ANNOUNCE === '1' ? { id: 'a1', text: 'Scheduled maintenance on Sunday 2 to 3am UTC. Sending pauses for that hour.', tone: 'info', link_url: '/settings', link_label: 'Details' } : null;
const settings = () => ({
  settings: { plans: { starter: { emailsPerMonth: 2000 } }, credit_prices: { reveal: 1.5 }, signups: { mode: 'invite', allow: ['@northbeam.io', 'jane@acme.com'] }, announcement: { id: 'a1', text: 'Scheduled maintenance on Sunday 2 to 3am UTC.', tone: 'info', link_url: null, link_label: null }, kill_switch: null },
  defaults: { plans: planDefaults, credit_prices: { search: 0.5, reveal: 1, verify: 0.1, enrich: 2 } },
  ready: true,
  updated: { signups: { by: 'steven@usesincerely.com', at: ago(1) }, plans: { by: 'steven@usesincerely.com', at: ago(4) } },
});
function sending() {
  const boxes = accounts.flatMap((a, i) => (a.plan === 'free' ? [] : [0, 1].map((k) => {
    const sent = [420, 260, 180, 90, 0, 1210, 0, 40, 0][i] - k * 30;
    const bounced = i === 1 ? 31 - k * 4 : Math.round(sent * 0.012);
    const complained = i === 1 ? 2 : 0;
    return { id: `mb${i}${k}`, user_id: a.id, email: `${['sales', 'hello'][k]}@${a.email.split('@')[1]}`, owner_email: a.email, is_active: !(i === 5 && k === 1), is_verified: true, autopilot_state: i === 2 && k === 0 ? 'slowed' : 'active', sent: Math.max(0, sent), bounced, complained, bounce_rate: sent > 0 ? bounced / sent : 0, complaint_rate: sent > 0 ? complained / sent : 0, flagged: i === 1 };
  })));
  return { days: 7, totals: { sent: 3820, bounced: 118, complained: 4, bounce_rate: 0.0309, complaint_rate: 0.001, mailboxes: boxes.length, paused_mailboxes: 1 },
    mailboxes: boxes.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.bounce_rate - a.bounce_rate),
    domains: accounts.filter((a) => a.plan !== 'free').map((a, i) => ({ id: `d${i}`, user_id: a.id, domain: a.email.split('@')[1], owner_email: a.email, spf_ok: i !== 2, dkim_ok: i !== 2 && i !== 4, dmarc_ok: i % 2 === 0, last_checked_at: ago(i) })),
    risky: [{ id: accounts[1].id, email: accounts[1].email, sent: 470, bounce_rate: 0.123, complaint_rate: 0.0085, reasons: ['12.3% bounced', '0.85% marked as spam'], held: true }],
    kill_switch: null, thresholds: { bounce: 0.05, complaint: 0.003, min_sent: 20 } };
}

function adminAnswer(method, path) {
  if (path === '/api/platform') return { signups: process.env.HARNESS_SIGNUPS || 'open', announcement, credit_prices: { search: 0.5, reveal: 1, verify: 0.1, enrich: 2 }, plans: planDefaults };
  if (path === '/billing/usage' || path === '/billing/refresh') {
    const u = { plan: 'growth', planName: 'Growth', status: 'active', trialEndsAt: null, periodStart: ago(12).slice(0, 10), currentPeriodEnd: ahead(18), emailsSent: 1874, emailsLimit: 10000, inboxes: 3, inboxLimit: 10, features: { sara: true, abTesting: true }, hasBilling: true };
    return owner() ? { ...u, isOwner: true } : u;
  }
  if (path === '/billing/credits') return report;
  if (!path.startsWith('/admin')) return undefined;
  // The server hides every admin endpoint from anyone but the owner.
  if (!owner()) return { __status: 404, __body: { error: 'Not found' } };
  if (method === 'POST') {
    if (/\/plan$/.test(path)) return { stripe: 'changed' };
    if (/\/(stripe-)?sync$/.test(path)) return { synced: true };
    if (/\/view-as$/.test(path)) return { token: 'harness-view-as', expires_at: ahead(1 / 48), email: 'maud@northbeam.io' };
    if (/\/sign-in-link$/.test(path)) return { link: 'https://app.usesincerely.com/auth/v1/verify?token=harness&type=magiclink' };
    if (/\/pause-campaigns$/.test(path)) return { paused: 3 };
    if (/\/refund$/.test(path)) return { refunded_usd: 99 };
    if (/\/extend-trial$/.test(path)) return { until: ahead(16) };
    if (path.startsWith('/admin/settings')) return settings();
    if (/\/overrides$/.test(path)) return { limits: {}, features: {} };
    if (path === '/admin/bulk') return { done: 2, failed: [] };
    if (path === '/admin/alerts') return { enabled: { icypeas_low: true, payment_failed: true, risky_sending: true, new_paying: true }, last_sent: {}, ready: true };
    return { success: true };
  }
  if (path === '/admin/stats') return { total_users: 312, lifetime_users: 4, paying_users: 41, free_users: 267, mailboxes: 388, domains: 97, contacts: 184220, campaigns: 520, trialing_users: 9, past_due_users: 2, active_7d: 128, signups_30d: 37, est_mrr_usd: 3261 };
  if (path === '/admin/usage') {
    const users = accounts.filter((a) => a.credits_used || a.revenue_usd).map((a) => ({ user_id: a.id, email: a.email, plan: a.plan, status: a.status, credits_charged: a.credits_used, provider_credits: a.credits_used * 0.6, cost_usd: a.cost_usd, revenue_usd: a.revenue_usd, fees_usd: a.revenue_usd ? 3.17 : 0, profit_usd: a.profit_usd, losing: a.losing }));
    return { month: month(), usd_per_provider_credit: 0.019, totals: { provider_credits: 1428.4, cost_usd: 27.14, revenue_usd: 437, fees_usd: 13.57, profit_usd: 396.29, credits_charged: 2418.5 }, unattributed_cost_usd: 0.42,
      by_action: [{ action: 'reveal', calls: 812, provider_credits: 812, cost_usd: 15.43, credits_charged: 1203 }, { action: 'search', calls: 410, provider_credits: 205, cost_usd: 3.9, credits_charged: 1010.5 }, { action: 'enrich', calls: 120, provider_credits: 380, cost_usd: 7.22, credits_charged: 180 }, { action: 'verify', calls: 314, provider_credits: 31.4, cost_usd: 0.6, credits_charged: 25 }],
      users, provider_balance: { credits: 8420, low: false, note: null }, revenue_synced: true };
  }
  if (path === '/admin/accounts') return { month: month(), accounts, controls_ready: true };
  if (/^\/admin\/accounts\/[^/]+$/.test(path)) return detail(path.split('/').pop());
  if (path === '/admin/billing') {
    const payments = accounts.filter((a) => a.revenue_usd).flatMap((a, i) => [{ id: `bp${i}`, user_id: a.id, email: a.email, kind: 'subscription', amount_usd: a.revenue_usd, stripe_ref: `in_1Q${i}abc`, paid_at: ago(i * 3 + 1) }]);
    payments.push({ id: 'bp-pack', user_id: accounts[1].id, email: accounts[1].email, kind: 'credit_pack', amount_usd: 49, stripe_ref: 'cs_test_a1', paid_at: ago(5) }, { id: 'bp-ref', user_id: accounts[0].id, email: accounts[0].email, kind: 'refund', amount_usd: -20, stripe_ref: 're_1Qabc', paid_at: ago(6) });
    return { month: month(), payments, totals: { gross_usd: 486, refunds_usd: 20, net_usd: 466, fees_usd: 15.29, count: payments.length },
      plan_mix: [{ plan: 'free', status: 'free', count: 267 }, { plan: 'starter', status: 'active', count: 18 }, { plan: 'growth', status: 'active', count: 17 }, { plan: 'growth', status: 'trialing', count: 9 }, { plan: 'scale', status: 'active', count: 4 }, { plan: 'growth', status: 'past_due', count: 2 }, { plan: 'lifetime', status: 'active', count: 4 }],
      est_mrr_usd: 3261, past_due: [{ id: accounts[2].id, email: accounts[2].email, plan: 'growth' }], revenue_synced: true };
  }
  if (path === '/admin/settings') return settings();
  if (path === '/admin/alerts') return { enabled: { icypeas_low: true, payment_failed: true, risky_sending: true, new_paying: false }, last_sent: { icypeas_low: ago(2) }, ready: true };
  if (path === '/admin/insights') {
    const ms = Array.from({ length: 12 }, (_, i) => month(i - 11));
    return {
      months: ms.map((m, i) => ({ month: m, signups: [8, 11, 9, 14, 18, 16, 22, 27, 25, 31, 37, 19][i], active_senders: [3, 5, 6, 8, 11, 13, 15, 19, 22, 26, 31, 28][i], revenue_usd: [0, 39, 98, 196, 316, 455, 612, 790, 1020, 1288, 1576, 1103][i], payers: [0, 1, 2, 4, 6, 8, 11, 14, 18, 22, 27, 21][i], churned: i === 11 ? null : [0, 0, 0, 0, 1, 0, 1, 1, 2, 1, 2][i], trials_ended: [0, 1, 2, 3, 3, 4, 5, 6, 6, 8, 9, 3][i], trials_converted: [0, 1, 1, 2, 1, 2, 3, 3, 4, 5, 5, 1][i] })),
      est_mrr_usd: 3261,
      top_cost: accounts.filter((a) => a.cost_usd > 0).sort((a, b) => b.cost_usd - a.cost_usd).slice(0, 6).map((a) => ({ user_id: a.id, email: a.email, plan: a.plan, cost_usd: a.cost_usd, revenue_usd: a.revenue_usd, profit_usd: a.profit_usd })),
      provider_balance: { credits: 8420, low: false, note: null },
    };
  }
  if (path === '/admin/sending') return sending();
  if (path === '/admin/audit') return { entries: audit, controls_ready: true };
  return undefined;
}

module.exports = { adminAnswer };

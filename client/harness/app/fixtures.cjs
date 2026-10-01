// A realistic, established account: what a user a few weeks in would see.
const DAY = 86400000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const ago = (d) => iso(now - d * DAY);
const ahead = (d) => iso(now + d * DAY);
const base = { user_id: 'u1', created_at: ago(20), updated_at: ago(1) };

const people = [
  ['Maud', 'Grevstad', 'Northbeam', 'Head of Growth', 'maud@northbeam.io'],
  ['Tomas', 'Reyes', 'Lattice Labs', 'VP Sales', 'tomas@latticelabs.com'],
  ['Priya', 'Nair', 'Brightwave', 'CMO', 'priya@brightwave.co'],
  ['Jonas', 'Keller', 'Fernhill', 'Founder', 'jonas@fernhill.de'],
  ['Amara', 'Okafor', 'Kestrel Pay', 'Partnerships Lead', 'amara@kestrelpay.com'],
  ['Liam', 'Walsh', 'Harbor & Co', 'COO', 'liam@harborco.ie'],
  ['Sofia', 'Marin', 'Tessellate', 'Head of Ops', 'sofia@tessellate.io'],
  ['Kenji', 'Mori', 'Obelisk', 'CTO', 'kenji@obelisk.jp'],
  ['Hannah', 'Price', 'Meridian FX', 'Director', 'hannah@meridianfx.com'],
  ['Omar', 'Haddad', 'Sandline', 'CEO', 'omar@sandline.ae'],
  ['Elena', 'Petrova', 'Crestview', 'Marketing Manager', 'elena@crestview.eu'],
  ['Marcus', 'Bell', 'Quarry Capital', 'Partner', 'marcus@quarrycap.com'],
];
const contacts = people.map(([f, l, c, t, e], i) => ({
  ...base, id: `c${i + 1}`, email: e, first_name: f, last_name: l, company: c, job_title: t,
  phone: null, linkedin_url: `https://linkedin.com/in/${f.toLowerCase()}${l.toLowerCase()}`, website: null, location: 'London, UK',
  custom_fields: {}, source: 'import', lifecycle: i < 3 ? 'contact' : i === 11 ? 'customer' : 'prospect', engaged_at: i < 5 ? ago(i) : null,
  is_unsubscribed: false, is_bounced: i === 9, dcs_score: 70 + (i * 7) % 30, dcs_syntax_ok: true, dcs_domain_ok: true, dcs_smtp_ok: i !== 9,
  dcs_verified_at: ago(5), dcs_fail_reason: null, list_count: 1, company_id: `co${i + 1}`, tags: i % 3 === 0 ? [{ id: 't1', name: 'Fintech', color: '#6366f1' }] : [],
}));

const campaigns = [
  ['Q3 Fintech outreach', 'running', 480, 312, 41],
  ['Broker partnerships - EU', 'running', 220, 190, 22],
  ['Webinar follow-up', 'paused', 150, 150, 9],
  ['APAC expansion', 'draft', 0, 0, 0],
  ['Re-engage cold leads', 'completed', 600, 600, 18],
].map(([name, status, contactsN, sent, replied], i) => ({
  ...base, id: `cmp${i + 1}`, name, status, smtp_account_id: 'm1', scheduled_at: null, started_at: status === 'draft' ? null : ago(14 - i),
  completed_at: status === 'completed' ? ago(2) : null, timezone: 'Europe/London', send_window_start: '09:00', send_window_end: '17:00',
  send_days: ['mon', 'tue', 'wed', 'thu', 'fri'], total_contacts: contactsN, dcs_threshold: 60, daily_limit: 50, delay_between_emails: 120,
  delay_between_emails_min: 90, delay_between_emails_max: 180, stop_on_reply: true, ab_auto_promote: false, send_in_recipient_timezone: true,
  paused_reason: status === 'paused' ? 'Paused by you' : null, track_opens: true, track_clicks: true, include_unsubscribe: true,
  steps_count: 3, contacts_count: contactsN, sent_count: sent, opened_count: Math.round(sent * 0.52), clicked_count: Math.round(sent * 0.08),
  replied_count: replied, bounced_count: Math.round(sent * 0.012), active_contacts: status === 'running' ? Math.round(contactsN - sent / 3) : 0,
  completed_contacts: Math.round(sent / 3), replied_contacts: replied, bounced_contacts: Math.round(sent * 0.012), unsubscribed_contacts: 3,
  suppressed_contacts: 1, open_rate: sent ? 52 : 0, click_rate: sent ? 8 : 0, reply_rate: sent ? Math.round((replied / sent) * 1000) / 10 : 0,
  bounce_rate: sent ? 1.2 : 0,
}));

const intents = ['meeting', 'interested', 'objection', 'not_now', 'interested', 'out_of_office', 'other', 'interested'];
const bodies = [
  'Thanks for reaching out - this is timely. Could we do a call Thursday or Friday afternoon? Happy to bring our head of partnerships.',
  'Interesting. What would pricing look like for a team of 12? We are evaluating two other tools this quarter.',
  'We already work with a provider for this and are locked in until March. Not sure it makes sense right now.',
  'Not a priority this quarter - circle back in January?',
  'Yes, please send over the case study you mentioned. Keen to understand the onboarding timeline.',
  'I am out of the office until Monday with limited access to email.',
  'Who else at your company should I loop in on this?',
  'Sounds good. Can you share a short deck I can forward to our CEO?',
];
const inbox = intents.map((intent, i) => {
  const c = contacts[i];
  return {
    ...base, id: `msg${i + 1}`, campaign_id: 'cmp1', campaign_contact_id: `cc${i}`, contact_id: c.id, smtp_account_id: 'm1',
    from_email: c.email, to_email: 'alex@affivault.com', subject: 'Re: Quick question about your partner program',
    body_html: `<p>${bodies[i]}</p><p>${c.first_name}</p>`, body_text: `${bodies[i]}\n\n${c.first_name}`, in_reply_to: null, message_id: `<m${i}@x>`,
    is_read: i > 2, auto_reply_kind: intent === 'out_of_office' ? 'out_of_office' : null, sara_intent: intent, sara_confidence: 0.9,
    sara_draft_reply: intent === 'meeting' ? `Hi ${c.first_name},\n\nThursday at 2pm works well - I'll send an invite now.\n\nAlex` : null,
    sara_action: 'reply', sara_status: intent === 'meeting' ? 'pending_review' : 'none', sara_reviewed_at: null, sara_reviewed_by: null,
    triage_decision: null, triaged_at: null, triage_ref: null, received_at: iso(now - (i * 5 + 1) * 3600000), created_at: iso(now - (i * 5 + 1) * 3600000),
    contact_name: `${c.first_name} ${c.last_name}`, campaign_name: 'Q3 Fintech outreach',
    mail_kind: 'person', sender_name: `${c.first_name} ${c.last_name}`,
    relay_summary: i < 3 ? ['Wants pricing for 50 seats before a call.', 'Asks for Thursday at 2pm.', 'Already uses a competitor; open to a comparison.'][i] : null,
    relay_next_step: i < 3 ? ['Send pricing and offer two call times.', 'Send the invite for Thursday 2pm.', 'Share one line on how you differ.'][i] : null,
    relay_engine: i < 3 ? 'ai' : null,
  };
});

// Mail: newsletters, notifications, receipts. Out of the inbox and every count.
const otherMail = [
  ['info@mc.gomarkets.com', 'GO Markets', 'From Nvidia earnings to an 80k Bitcoin surge', 'bulk',
    'https://click.mc.gomarkets.com/?qs=ABB7InYiOjEsImQiOjQ5ODI9AAoAAAAABH_BeQ6aMQ https://click.mc.gomarkets.com/?qs=ABB7InYiOjEsImQiOjQ5OTZ9AAoAAAAABKn',
    '<p>From Nvidia\'s earnings win to an 80k Bitcoin surge.</p><img src="https://t.example/p.gif" width="1" height="1"><a href="https://click.mc.gomarkets.com/x">Read more</a><p>You are receiving this email because you subscribed. <a href="https://click.mc.gomarkets.com/u">Unsubscribe</a> | Manage preferences</p>'],
  ['notifications@github.com', 'GitHub', '[Affivault/sincerely] Full-app walkthrough fixes (PR #513)', 'notification', 'vercel[bot] left a comment.', null],
  ['hello@spaceship.com', 'Spaceship', 'Spacemail Business subscription auto-renewed', 'transactional', 'Your order summary.', null],
].map(([from, name, subject, kind, text, html], i) => ({
  ...base, id: `om${i + 1}`, campaign_id: null, campaign_contact_id: null, contact_id: null, smtp_account_id: 'm1',
  from_email: from, to_email: 'alex@affivault.com', subject, body_text: text, body_html: html, in_reply_to: null, message_id: `<om${i}@x>`,
  is_read: i > 0, auto_reply_kind: null, sara_intent: null, sara_confidence: null, sara_draft_reply: null, sara_action: null, sara_status: 'none',
  sara_reviewed_at: null, sara_reviewed_by: null, triage_decision: null, triaged_at: null, triage_ref: null,
  received_at: iso(now - (i * 7 + 2) * 3600000), created_at: iso(now - (i * 7 + 2) * 3600000),
  contact_name: null, campaign_name: null, mail_kind: kind, sender_name: name, relay_summary: null, relay_next_step: null, relay_engine: null,
}));

const stages = ['lead', 'qualified', 'proposal', 'proposal', 'qualified', 'lead', 'won', 'lost'];
const deals = stages.map((stage, i) => {
  const c = contacts[i];
  return {
    ...base, id: `d${i + 1}`, title: `${c.company} - partner program`, company: c.company, company_id: c.company_id,
    contact_name: `${c.first_name} ${c.last_name}`, contact_email: c.email, contact_id: c.id, value: [12000, 24000, 48000, 9500, 18000, 6000, 30000, 15000][i],
    currency: 'USD', stage, expected_close_date: ahead(10 + i * 4), notes: null, position: i, probability: null, outcome_reason: stage === 'lost' ? 'Went with a competitor' : null,
    closed_at: stage === 'won' || stage === 'lost' ? ago(3) : null, label: i === 2 ? 'hot' : null, source: 'reply', recurring_amount: null, recurring_period: null,
    one_off_amount: null, term_months: null, stage_changed_at: ago(i * 3 + 1),
  };
});

const tasks = [
  ['Send case study to Priya', 0, 'high', 'c3'], ['Call Tomas about pricing', -1, 'normal', 'c2'], ['Prep proposal for Northbeam', 1, 'high', 'c1'],
  ['Follow up with Jonas', 3, 'normal', 'c4'], ['LinkedIn: connect with Kenji', 0, 'low', 'c8'],
].map(([title, d, priority, cid], i) => {
  const c = contacts.find((x) => x.id === cid);
  return {
    ...base, id: `t${i + 1}`, title, due_date: ahead(d), is_done: false, completed_at: null, priority, type: 'todo', all_day: true, deal_id: i === 2 ? 'd1' : null,
    contact_id: cid, contact_name: `${c.first_name} ${c.last_name}`, notes: null,
  };
});

const events = [
  ['Intro call - Northbeam', 0.08, 'c1'], ['Pricing review - Lattice Labs', 1, 'c2'], ['Demo - Brightwave', 2, 'c3'], ['Check-in - Fernhill', -1, 'c4'],
].map(([title, d, cid], i) => {
  const c = contacts.find((x) => x.id === cid);
  return {
    ...base, id: `e${i + 1}`, title, type: 'meeting', starts_at: iso(now + d * DAY), ends_at: iso(now + d * DAY + 1800000), all_day: false, contact_id: cid,
    contact_name: `${c.first_name} ${c.last_name}`, contact_email: c.email, location: null, notes: null, outcome: null, event_type_id: null, colour: null,
    status: 'confirmed', conferencing_url: 'https://meet.google.com/abc-defg-hij', timezone: 'Europe/London', deal_id: i === 0 ? 'd1' : null,
  };
});

const mailboxes = ['alex@affivault.com', 'alex@affivault.io', 'partners@affivault.com'].map((e, i) => ({
  ...base, id: `m${i + 1}`, label: e, from_name: 'Alex Morgan', reply_to: null, email_address: e, smtp_host: 'smtp.gmail.com', smtp_port: 465, smtp_secure: true,
  smtp_user: e, imap_host: 'imap.gmail.com', imap_port: 993, imap_secure: true, imap_user: e, daily_send_limit: 50, sends_today: 12 + i * 7,
  is_active: true, is_verified: true, is_seed: false, last_tested_at: ago(1), warmup_enabled: i === 2, last_inbox_sync_at: ago(0.01), last_inbox_sync_error: null,
  health_score: 92 - i * 4, signature_html: null, signature_auto: true, total_sent: 1200 - i * 300, warmup_mode: i === 2,
  // CALM=1: every mailbox at full speed, for the quiet-state screenshots.
  autopilot_state: process.env.CALM ? 'active' : ['active', 'resting', 'recovering'][i],
  autopilot_reason: process.env.CALM ? null : [null, '3 receiving servers refused it as a sender in the last 7 days', 'coming back gradually after a rest'][i],
  autopilot_rest_until: !process.env.CALM && i === 1 ? ahead(1.3) : null,
  autopilot_recovery_day: i === 2 ? 1 : 0,
}));

const autopilotStatus = () => {
  const calm = !!process.env.CALM;
  return {
    ready: !process.env.NO_AUTOPILOT, enabled: true, last_run_at: ago(0.003),
    mailboxes: mailboxes.map((m, i) => ({
      id: m.id, label: m.label, email_address: m.email_address,
      state: m.autopilot_state, reason: m.autopilot_reason, since: ago(i === 1 ? 0.7 : 1.5), rest_until: m.autopilot_rest_until,
      share: calm ? 1 : [1, 0, 0.5][i],
      evidence: calm ? { sent: 212 - i * 40, bounced: 3, blocked: 0 } : [{ sent: 312, bounced: 6, blocked: 0 }, { sent: 140, bounced: 9, blocked: 3 }, { sent: 18, bounced: 0, blocked: 0 }][i],
    })),
    holds: calm ? [] : [{ provider: 'outlook.com', held_until: ahead(0.3), reason: '4 of 38 sends to outlook.com were refused in the last day' }],
    events: calm ? [
      { id: 'e0', kind: 'weekly', title: 'A quiet week: every mailbox stayed healthy', detail: 'Nothing bounced or was refused enough to act on.', smtp_account_id: null, provider: null, created_at: ago(2) },
    ] : [
      { id: 'e1', kind: 'hold', title: 'Paused sending to outlook.com for 12 hours', detail: '4 of 38 sends to outlook.com were refused in the last day. Sending more into a wall teaches outlook.com to block you for longer - those emails wait and go out when the pause ends.', smtp_account_id: null, provider: 'outlook.com', created_at: ago(0.2) },
      { id: 'e2', kind: 'rest', title: 'Rested alex@affivault.io for 2 days', detail: '3 receiving servers refused it as a sender in the last 7 days. Its campaigns keep sending through your other mailboxes.', smtp_account_id: 'm2', provider: null, created_at: ago(0.7) },
      { id: 'e3', kind: 'bounces_found', title: 'Found 14 bounces in delivery notices', detail: 'Returned-mail notices that used to sit unread in Other mail. Those addresses have left their sequences, and each bounce now counts against the mailbox that sent it.', smtp_account_id: null, provider: null, created_at: ago(0.71) },
      { id: 'e4', kind: 'recovery_step', title: 'partners@affivault.com is up to 50% of its volume', detail: 'Recovery continuing, nothing bouncing.', smtp_account_id: 'm3', provider: null, created_at: ago(0.5) },
      { id: 'e5', kind: 'recovering', title: 'partners@affivault.com is back, at a quarter of its usual volume', detail: 'The rest is over. It ramps back up over 3 days, and goes straight back to rest if the bouncing starts again.', smtp_account_id: 'm3', provider: null, created_at: ago(1.5) },
      { id: 'e6', kind: 'weekly', title: 'This week the autopilot rested 1 mailbox, caught 14 bounces from returned-mail notices', detail: 'Your campaigns kept sending through the healthy mailboxes throughout.', smtp_account_id: null, provider: null, created_at: ago(3) },
    ],
    week: calm ? { rests: 0, slowdowns: 0, recoveries: 0, holds: 0, bounces_found: 0, rested_hours: 0 } : { rests: 2, slowdowns: 1, recoveries: 1, holds: 1, bounces_found: 14, rested_hours: 96 },
  };
};

const trend = Array.from({ length: 30 }, (_, i) => {
  const s = 30 + Math.round(20 * Math.sin(i / 3) + i);
  return { date: iso(now - (29 - i) * DAY).slice(0, 10), sent: s, opened: Math.round(s * 0.5), clicked: Math.round(s * 0.07), replied: Math.round(s * 0.06), bounced: i % 7 === 0 ? 1 : 0 };
});

const page = (data) => ({ data, total: data.length, page: 1, limit: 50, total_pages: 1 });

function flow() {
  const items = [];
  items.push({ key: 'meeting:e1', kind: 'meeting', rank: 100, why: 'Coming up', meeting: { event_id: 'e1', title: events[0].title, starts_at: events[0].starts_at, ends_at: events[0].ends_at, contact_id: 'c1', contact_email: 'maud@northbeam.io', contact_name: 'Maud Grevstad', deal_id: 'd1', conferencing_url: events[0].conferencing_url, location: null, needs_outcome: false } });
  inbox.slice(0, 5).forEach((m, i) => items.push({ key: `reply:${m.id}`, kind: 'reply', rank: 90 - i * 4, why: m.sara_intent === 'meeting' ? 'Wants to meet' : 'Waiting on your reply', reply: { message_id: m.id, from_email: m.from_email, contact_id: m.contact_id, contact_name: m.contact_name, company: contacts[i].company, subject: m.subject, snippet: bodies[i], intent: m.sara_intent, urgency: i === 0 ? 'overdue' : 'due-soon', waited_ms: (i + 2) * 3600000, draft: m.sara_draft_reply, deal_value: null } }));
  items.push({ key: 'meeting:e4', kind: 'meeting', rank: 72, why: 'How did it go?', meeting: { event_id: 'e4', title: events[3].title, starts_at: events[3].starts_at, ends_at: events[3].ends_at, contact_id: 'c4', contact_email: 'jonas@fernhill.de', contact_name: 'Jonas Keller', deal_id: null, conferencing_url: null, location: null, needs_outcome: true } });
  tasks.slice(0, 3).forEach((t, i) => items.push({ key: `task:${t.id}`, kind: 'task', rank: 60 - i, why: i === 1 ? 'Overdue' : 'Due today', task: { task_id: t.id, title: t.title, due_date: t.due_date, priority: t.priority, deal_id: t.deal_id, contact_name: t.contact_name, overdue: i === 1 } }));
  const counts = { mailbox: 0, meeting: 2, reply: 5, deal: 0, task: 3 };
  return { items, counts, generated_at: iso(now) };
}

// PRELAUNCH=1: an account that has never sent, for the pre-launch dashboard.
const PRE = !!process.env.PRELAUNCH;

const dnsRecords = [
  { id: 'spf', label: 'SPF', type: 'TXT', host: '@', value: 'v=spf1 include:_spf.google.com ~all', purpose: 'Says which servers may send for you', status: 'missing' },
  { id: 'dkim', label: 'DKIM', type: 'TXT', host: 'google._domainkey', value: 'v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2x', purpose: 'Signs each email', status: 'missing' },
  { id: 'dmarc', label: 'DMARC', type: 'TXT', host: '_dmarc', value: 'v=DMARC1; p=none; rua=mailto:dmarc@affivault.com', purpose: 'Tells receivers what to do with failures', status: 'verified' },
];
function replyCheckResult(kind) {
  const base = { from_mailbox: 'alex@affivault.com', to_mailbox: 'sam@affivault.io', ran_at: ago(0.2), skipped: false };
  if (kind === 'failed') return { ...base, ok: false, seconds: 104, reached: ['sent', 'replied'], failed_at: 'arrived',
    detail: "The answer never reached alex@affivault.com's inbox as far as inbox sync can see. Either delivery is slow, it went to spam, or inbox sync is not reading new mail. Until this passes, replies may not stop sequences." };
  return { ...base, ok: true, seconds: 34, reached: ['sent', 'replied', 'arrived', 'matched', 'stopped'], failed_at: null,
    detail: 'sam@affivault.io answered alex@affivault.com, inbox sync found the answer, matched it and stopped the sequence - in 34 seconds.' };
}

function answer(method, path, q) {
  if (method === 'POST' && /\/campaigns\/write-sequence$/.test(path)) {
    return { name: 'ISA platforms - affiliate partnership', rationale: 'Leads with the partner economics.', engine: 'ai', leads: 58, personalized: 52, personalize_requested: true,
      steps: [
        { delay_days: 0, subject: 'partnering with {{company|your team}}', body_text: 'Hi {{first_name|there}},\n\n{{first_line}}\n\nWe run affiliate partnerships for UK investment platforms.', body_html: '<p>Hi {{first_name|there}},</p><p>{{first_line|Came across your team and had a quick idea worth sharing.}}</p><p>We run affiliate partnerships for UK investment platforms.</p>' },
        { delay_days: 3, subject: 'Re: partnering with {{company|your team}}', body_text: 'Hi {{first_name|there}},\n\nOne more thing.', body_html: '<p>Hi {{first_name|there}},</p><p>One more thing.</p>' },
        { delay_days: 4, subject: 'Re: partnering with {{company|your team}}', body_text: 'Hi {{first_name|there}},\n\nI will leave it here.', body_html: '<p>Hi {{first_name|there}},</p><p>I will leave it here.</p>' },
      ] };
  }
  if (method === 'POST' && path === '/domains') return { domain: { id: 'dom2', domain: 'affivault.io' }, dns: {}, records: dnsRecords };
  if (method === 'POST' && /^\/domains\/[^/]+\/verify$/.test(path)) return { domain: {}, dns: {}, records: dnsRecords };
  if (method === 'POST' && path === '/system/self-test') {
    return { results: [
      { id: 'database', label: 'Database', ok: true, detail: 'Answered in 41 ms.' },
      { id: 'mailbox:m1', label: 'alex@affivault.com', ok: true, detail: 'Signed in, sent a test to itself, and read its inbox.' },
      { id: 'mailbox:m2', label: 'alex@affivault.io', ok: false, detail: 'IMAP: login refused - check the app password.' },
      { id: 'job:sending', label: 'Sending', ok: true, detail: 'Running - last finished 12:04 UTC.' },
    ] };
  }
  if (method === 'POST' && path === '/system/reply-check') return replyCheckResult('ok');
  if (method === 'POST' && path === '/notifications/test') return { sent: true, from: 'alex@affivault.com', to: 'alex@affivault.com' };
  if (method === 'POST' && path === '/notifications/digest') return { sent: true, subject: 'Your week: 420 sent, 21 replies, 3 meetings' };
  if (method !== 'GET') return { success: true };
  const P = path.replace(/\/+$/, '');
  const seg = P.split('/');
  switch (P) {
    case '/billing/usage': return { plan: 'growth', planName: 'Growth', status: 'active', trialEndsAt: null, periodStart: ago(12).slice(0, 10), currentPeriodEnd: ahead(18), emailsSent: 1874, emailsLimit: 10000, inboxes: 3, inboxLimit: 10, features: { sara: true, abTesting: true }, hasBilling: true };
    case '/inbox/unread-count': return { count: 3 };
    case '/inbox/counts': return { unread: 3, needs_triage: 5, intents: { interested: 3, meeting: 1, objection: 1, not_now: 1, out_of_office: 1, other: 1 }, other: otherMail.length, other_unread: 1, sorting: false };
    case '/inbox/relay-status': return { ai: true, review: [{ message_id: 'msg2', contact_id: 'c2', email: contacts[1].email, name: `${contacts[1].first_name} ${contacts[1].last_name}`, company: contacts[1].company, subject: 'Re: Quick question', excerpt: 'Sounds good - Thursday works.', now_reads_as: 'meeting', received_at: ago(2) }] };
    case '/setup': {
      // PRELAUNCH: mailbox and contacts done, the rest to do.
      const doneIds = PRE ? ['mailbox', 'contacts'] : ['mailbox', 'domain', 'contacts', 'sequence', 'launch'];
      return { steps: ['mailbox', 'domain', 'contacts', 'sequence', 'launch'].map((id) => ({ id, label: id, detail: '', done: doneIds.includes(id), current: false, href: '/', cta: 'Go', progress: null, warning: null })), done_count: doneIds.length, complete: !PRE, fresh: PRE };
    }
    case '/analytics/overview': if (PRE) return { total_campaigns: 0, active_campaigns: 0, total_contacts: 62, total_sent: 0, total_opened: 0, total_clicked: 0, total_replied: 0, avg_open_rate: 0, avg_click_rate: 0, avg_reply_rate: 0, suppressed_count: 0, avg_dcs_score: 97, verified_contacts: 60, bounced_contacts: 0, sent_change: null, opened_change: null, clicked_change: null, replied_change: null };
      return { total_campaigns: 5, active_campaigns: 2, total_contacts: 1450, total_sent: 1252, total_opened: 651, total_clicked: 100, total_replied: 90, avg_open_rate: 52, avg_click_rate: 8, avg_reply_rate: 7.2, suppressed_count: 14, avg_dcs_score: 84, verified_contacts: 1320, bounced_contacts: 15, sent_change: 12, opened_change: 4, clicked_change: -2, replied_change: 18 };
    case '/analytics/trend': return trend;
    case '/analytics/campaigns': if (PRE) return []; return campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, created_at: c.created_at, sent: c.sent_count, opened: c.opened_count, clicked: c.clicked_count, replied: c.replied_count, bounced: c.bounced_count, open_rate: c.open_rate, click_rate: c.click_rate, reply_rate: c.reply_rate, bounce_rate: c.bounce_rate }));
    case '/inbox': return page(q.get('folder') === 'sent' ? [] : q.get('folder') === 'other'
      ? otherMail.filter((m) => !q.get('mail_kind') || m.mail_kind === q.get('mail_kind'))
      : inbox.filter((m) => !q.get('contact_id') || m.contact_id === q.get('contact_id')).slice(0, Number(q.get('limit')) || 50));
    case '/inbox/scheduled': return [];
    case '/inbox/sync/progress': return mailboxes.map((b) => ({ smtp_account_id: b.id, email_address: b.email_address, window_months: 6, oldest_synced_at: ago(180), history_complete: true, stored: 412, last_synced_at: ago(0.01), last_error: null }));
    case '/smtp-accounts': return mailboxes;
    case '/autopilot': return autopilotStatus();
    case '/autopilot/complaints': return process.env.COMPLAINTS
      ? { total: 2, sent: 1840, items: [
        { id: 'cp-a', at: ago(0.4), email: 'j.doe@yahoo.com', provider: 'Yahoo', campaign_id: 'cmp1', campaign_name: 'UK brokers - Q4', mailbox: 'alex@affivault.com' },
        { id: 'cp-b', at: ago(3), email: null, provider: 'Microsoft', campaign_id: 'cmp2', campaign_name: 'Fintech EU', mailbox: 'sam@affivault.io' },
      ] }
      : { total: 0, sent: 1840, items: [] };
    case '/system/status': {
      const ok = !!process.env.CALM;
      const job = (id, label, what, core, health, every) => ({ id, label, what, core, health, every_ms: every, last_ok_at: ago(health === 'ok' ? 0.001 : 0.05), last_error: health === 'failing' ? 'IMAP connect timeout' : null });
      return {
        persisted: true, level: ok ? 'ok' : 'attention', checked_at: ago(0.0005),
        headline: ok ? 'Everything is running.' : '3 things need a look - starting with: replies to alex@affivault.io are not coming in',
        jobs: [
          job('sending', 'Sending', 'Campaign emails go out on schedule', true, 'ok', 30000),
          job('inbox', 'Inbox sync', 'Replies arrive in the inbox and stop sequences', true, 'ok', 300000),
          job('autopilot', 'Deliverability autopilot', 'Struggling mailboxes are rested; bounce notices are read', true, 'ok', 600000),
          job('warmup_send', 'Warm-up sending', 'Warm-up mail builds new mailboxes a reputation', true, 'ok', 720000),
          job('placement', 'Inbox placement', 'Placement tests find their probe emails', false, ok ? 'ok' : 'late', 120000),
          job('verification', 'Email verification', 'Queued addresses are verified', false, 'ok', 20000),
        ],
        // REPLY=ok|failed|running|none
        reply_check: {
          last: process.env.REPLY === 'none' ? null : replyCheckResult(process.env.REPLY === 'failed' ? 'failed' : 'ok'),
          last_ok_at: ago(1.2), daily: true, running: process.env.REPLY === 'running', persisted: true,
        },
        issues: ok ? [] : [
          { key: 'mailbox-sync-error:m2', level: 'attention', title: 'Replies to alex@affivault.io are not coming in', detail: 'The last inbox sync failed: IMAP login refused. Replies are not being read and sequences will not stop for them.', href: '/email-accounts?mailbox=m2', since: ago(0.08) },
          { key: 'campaign-stalled:cp1', level: 'attention', title: '"UK brokers - Q4" is not sending', detail: 'All accounts have reached their daily sending limit', href: '/campaigns/cp1', since: ago(0.1) },
          { key: 'sending-backlog', level: 'attention', title: '42 emails are more than 30 minutes late', detail: 'They are due but have not gone out.', href: '/campaigns', since: null },
        ],
      };
    }
    case '/settings': return { ...base, id: 's1', first_name: 'Alex', last_name: 'Morgan', company: 'AffiVault', job_title: 'CEO', timezone: 'Europe/London', email_notifications: true, campaign_alerts: true, reply_notifications: true, weekly_digest: true, default_signature: '', theme: 'light', sara_enabled: true, sara_auto_classify: true, sara_auto_execute: false, sara_confidence_threshold: 0.8, sara_auto_unsubscribe: true, sara_auto_bounce: true, sara_draft_replies: true, ai_tagging_enabled: true, auto_verify_contacts: true, crm_auto_deals: true, stop_all_campaigns_on_reply: true, pause_company_on_reply: false, bounce_guard_enabled: true, bounce_guard_threshold: 5, domain_hourly_limit: 20 };
    case '/contacts': return { ...page(contacts), total: 1450, total_pages: 58, limit: 25 };
    case '/contacts/stats': return { total: 1450, verified: 1320, unverified: 110, bounced: 15, unsubscribed: 5 };
    case '/contacts/lifecycle-counts': return { prospect: 1300, contact: 130, customer: 20, total: 1450 };
    case '/contacts/verification-breakdown': return { total: 1450, valid: 1180, risky: 140, invalid: 15, not_found: 5, unverified: 110, with_linkedin: 900 };
    case '/contacts/companies': return contacts.map((c) => ({ company: c.company, count: 3 }));
    case '/lists': return [{ ...base, id: 'l1', name: 'Fintech EU', description: null, contact_count: 420, kind: 'contact', folder_id: null }, { ...base, id: 'l2', name: 'Brokers - Tier 1', description: null, contact_count: 180, kind: 'contact', folder_id: null }];
    case '/segments': return [];
    case '/tags': return [{ id: 't1', name: 'Fintech', color: '#6366f1' }];
    case '/campaigns': return page(q.get('status') ? campaigns.filter((c) => c.status === q.get('status')) : campaigns);
    case '/crm/deals': return deals;
    case '/crm/deals/health': return Object.fromEntries(deals.map((d, i) => [d.id, { score: [82, 64, 38, 71, 55, 90, 100, 0][i], grade: i === 2 ? 'at_risk' : i === 4 ? 'watch' : 'healthy', summary: i === 2 ? 'No reply in 9 days' : 'On track', reasons: [{ text: i === 2 ? 'No reply in 9 days' : 'Replied recently', impact: i === 2 ? -20 : 10 }], next_action: i === 2 ? 'follow_up' : 'none' }]));
    case '/crm/tasks': return tasks;
    case '/crm/events': return events;
    case '/crm/notes': return [];
    case '/flow': return flow();
    case '/companies': return contacts.map((c, i) => ({ ...base, id: c.company_id, name: c.company, domain: c.email.split('@')[1], industry: 'Financial services', size: '51-200', contact_count: 1 + (i % 3), deal_count: i < 8 ? 1 : 0 }));
    case '/domains': return [{ ...base, id: 'dom1', domain: 'affivault.com', is_verified: !PRE, spf_ok: !PRE, dkim_ok: !PRE, dmarc_ok: false, spf_status: 'verified', dkim_status: 'verified', dmarc_status: 'verified', status: 'verified', last_checked_at: ago(1) }];
  }
  if (/^\/campaigns\/cmp\d+$/.test(P)) { const c = campaigns.find((x) => x.id === seg[2]); return { ...c, steps: c.status === 'draft' ? [] : steps.map((st) => ({ ...st, campaign_id: c.id })) }; }
  if (/^\/contacts\/c\d+$/.test(P)) return contacts.find((x) => x.id === seg[2]);
  if (/^\/lists\/[^/]+\/contacts$/.test(P)) return { contact_ids: contacts.map((c) => c.id) };
  if (/^\/inbox\/(msg|om)\d+$/.test(P)) return [...inbox, ...otherMail].find((x) => x.id === seg[2]);
  if (/^\/inbox\/(msg|om)\d+\/thread$/.test(P)) return [[...inbox, ...otherMail].find((x) => x.id === seg[2])];
  return more(P, q, seg);
}

/* ─── The rest of the app ─────────────────────────────────────────── */
const steps = [1, 2, 3].map((n) => ({
  ...base, id: `st${n}`, campaign_id: 'cmp1', step_order: n, step_type: 'email',
  subject: n === 1 ? 'Quick question about your partner program' : n === 2 ? 'Re: Quick question' : 'Closing the loop',
  subject_b: n === 1 ? 'Partnering with {{company}}?' : null, body_html: '<p>Hi {{first_name}},</p><p>Short note.</p>', body_html_b: null, body_text: null,
  delay_days: n === 1 ? 0 : 3, delay_hours: 0, delay_minutes: 0, skip_if_replied: true, condition_field: null, condition_operator: null, condition_value: null,
  true_branch_step: null, false_branch_step: null, webhook_event: null, webhook_timeout_hours: null, send_at_local_time: null,
}));
const arm = (sent, pos) => ({ sent, positive: pos, won: Math.floor(pos / 3), won_value: Math.floor(pos / 3) * 12000, meetings_per_100: Math.round((pos / sent) * 1000) / 10, revenue_per_100: Math.round((pos / 3 / sent) * 1200000) });
const revRow = (c, i) => ({ id: c.id, name: c.name, status: c.status, created_at: c.created_at, sent: c.sent_count, replied: c.replied_count, deals: [4, 2, 1, 0, 2][i], won: [1, 1, 0, 0, 1][i], lost: [1, 0, 0, 0, 1][i], open: [2, 1, 1, 0, 0][i], won_value: [30000, 12000, 0, 0, 9500][i], strong_won_value: [30000, 12000, 0, 0, 0][i], weighted_open: [14400, 6000, 2400, 0, 0][i], win_rate: [0.5, 1, null, null, 0.5][i], average_won: [30000, 12000, null, null, 9500][i], value_per_reply: [731, 545, 0, null, 527][i] });
const placementSummary = (inb, sp, miss) => ({ inbox: inb, spam: sp, missing: miss, pending: 0, errored: 0, answered: inb + sp + miss, total: inb + sp + miss, inboxRate: inb / (inb + sp + miss), verdict: inb / (inb + sp + miss) > 0.8 ? 'good' : 'mixed', headline: `${inb} of ${inb + sp + miss} reached the inbox` });
const eventTypes = [['Intro call', '#6366f1', 30, true], ['Demo', '#10b981', 45, false], ['Check-in', '#f59e0b', 15, false]].map(([name, colour, d, def], i) => ({ ...base, id: `et${i + 1}`, name, colour, duration_minutes: d, location_kind: 'video', is_default: def, archived_at: null }));
const notes = [{ ...base, id: 'n1', contact_id: 'c1', deal_id: 'd1', body: 'Budget signed off for Q4. Wants a pilot with 2 brokers first.', pinned: true }, { ...base, id: 'n2', contact_id: 'c1', deal_id: 'd1', body: 'Mentioned they are also talking to one competitor.', pinned: false, created_at: ago(4) }];
const history = (id) => [{ id: `h${id}1`, deal_id: id, from_stage: null, to_stage: 'lead', reason: null, changed_at: ago(18) }, { id: `h${id}2`, deal_id: id, from_stage: 'lead', to_stage: 'qualified', reason: null, changed_at: ago(9) }];

function more(P, q, seg) {
  switch (P) {
    case '/reply-queue': return { counts: { open: 5, overdue: 1, dueSoon: 2, unassigned: 5, parked: 0, mine: 0 }, items: inbox.slice(0, 5).map((m, i) => ({ id: m.id, contact_id: m.contact_id, campaign_id: 'cmp1', from_email: m.from_email, to_email: m.to_email, subject: m.subject, body_text: m.body_text, received_at: m.received_at, is_read: m.is_read, sara_intent: m.sara_intent, sara_confidence: 0.9, triage_decision: null, assigned_to: null, assigned_at: null, snoozed_until: null, snooze_note: null, deal_value: i === 0 ? 12000 : null, contact_name: m.contact_name, company: contacts[i].company, state: { urgency: i === 0 ? 'overdue' : i < 3 ? 'due-soon' : 'waiting', waitedMs: (i + 2) * 3600000, remainingMs: i === 0 ? null : (4 - i) * 3600000, slaMs: 4 * 3600000, unassigned: true }, priority: 90 - i * 5 })) };
    case '/segment-revenue': return { dimension: q.get('dimension') || 'industry', rows: [['Financial services', 420, 38, 6, 2, 3], ['Software', 310, 21, 2, 3, 2], ['Crypto', 150, 12, 1, 1, 1]].map(([value, reached, replied, won, lost, open]) => ({ value, reached, replied, replyRate: replied / reached, won, lost, open, closed: won + lost, wonValue: won * 14000, winRate: won / (won + lost), confidentWinRate: won / (won + lost) * 0.8, lift: value === 'Financial services' ? 1.6 : 0.7, valuePerContact: Math.round(won * 14000 / reached), note: '' })), baseline: { reached: 880, replied: 71, won: 9, lost: 6, closed: 15, wonValue: 126000, winRate: 0.6, confidentWinRate: 0.45 }, compared: 3, unknown: 40, verdict: 'Financial services closes at 1.6x your average.' };
    case '/analytics/revenue': return campaigns.map(revRow);
    case '/placement': return [{ id: 'pl1', smtp_account_id: 'm1', campaign_id: 'cmp1', subject: 'Quick question about your partner program', status: 'complete', started_at: ago(2), completed_at: ago(2), error: null, summary: placementSummary(9, 1, 0) }, { id: 'pl2', smtp_account_id: 'm2', campaign_id: null, subject: 'Placement test', status: 'complete', started_at: ago(6), completed_at: ago(6), error: null, summary: placementSummary(6, 3, 1) }];
    case '/placement/seeds': return ['gmail', 'outlook', 'yahoo'].map((provider, i) => ({ id: `seed${i}`, email_address: `seed${i}@${provider}.com`, provider, readable: true, is_verified: true }));
    case '/sending-schedules': return [{ id: 'ss1', name: 'Business hours (London)', timezone: 'Europe/London', send_window_start: '09:00', send_window_end: '17:00', send_days: ['mon', 'tue', 'wed', 'thu', 'fri'], is_default: true, created_at: ago(30) }, { id: 'ss2', name: 'US East mornings', timezone: 'America/New_York', send_window_start: '08:00', send_window_end: '11:00', send_days: ['tue', 'wed', 'thu'], is_default: false, created_at: ago(10) }];
    case '/templates/sequences': return [{ ...base, id: 'seq1', name: 'Partner intro - 3 steps', description: 'Short intro, bump, break-up.', category: 'cold_outreach', steps: steps.map((s) => ({ step_order: s.step_order, subject: s.subject, body_html: s.body_html, delay_days: s.delay_days, delay_hours: 0 })), tags: [], is_preset: false, usage_count: 4 }];
    case '/templates/emails': return [['Intro - partner program', 'Quick question about {{company}}'], ['Follow-up bump', 'Re: Quick question'], ['Meeting confirmation', 'Confirmed: {{meeting_time}}']].map(([name, subject], i) => ({ ...base, id: `tpl${i + 1}`, name, subject, body_html: `<p>Hi {{first_name}},</p><p>${name} body text goes here.</p>`, category: 'cold_outreach', tags: [], is_preset: false, usage_count: 3 - i }));
    case '/templates/presets': return [];
    case '/campaign-folders': return [{ id: 'f1', name: 'Q3 outbound', color: '#6366f1', icon: 'folder', position: 0, parent_id: null, campaign_count: 2, created_at: ago(20) }];
    case '/analytics/deliverability': return { dcs_distribution: [{ label: 'High (≥80)', value: 1180, color: '#10B981' }, { label: 'Medium (50–79)', value: 140, color: '#F59E0B' }, { label: 'Low (<50)', value: 15, color: '#EF4444' }, { label: 'Unscored', value: 110, color: '#94A3B8' }], bounced_contacts: 15, suppression_by_reason: [{ label: 'Unsubscribed', value: 9, color: '#6366f1' }, { label: 'Bounced', value: 5, color: '#ef4444' }] };
    case '/list-folders': return [];
    case '/leads': return contacts.slice(0, 4).map((c, i) => ({ ...base, id: `ld${i + 1}`, contact_id: c.id, title: `${c.company} - interested`, company: c.company, company_id: c.company_id, value: [12000, null, 8000, null][i], currency: 'USD', label: null, source: 'reply', campaign_id: 'cmp1', note: null, status: q.get('status') === 'all' && i === 3 ? 'converted' : 'open', converted_deal_id: null, converted_at: null, archived_reason: null, archived_at: null, contact: { id: c.id, email: c.email, first_name: c.first_name, last_name: c.last_name, company: c.company, company_id: c.company_id, job_title: c.job_title } }));
    case '/crm/insights': return { deals: deals.map((d) => ({ id: d.id, title: d.title, stage: d.stage, value: d.value, currency: 'USD', probability: null, source: d.source, label: d.label, outcome_reason: d.outcome_reason, closed_at: d.closed_at, created_at: d.created_at, stage_changed_at: d.stage_changed_at, recurring_amount: null, recurring_period: null, one_off_amount: null, term_months: null })), history: Object.fromEntries(deals.map((d) => [d.id, history(d.id)])), windowDays: Number(q.get('days')) || 180 };
    case '/linkedin/status': return { settings: { user_id: 'u1', enabled: true, daily_connect_limit: 20, daily_message_limit: 40, daily_visit_limit: 60, min_gap_seconds: 60, max_gap_seconds: 240, work_start: '09:00', work_end: '17:00', work_days: [1, 2, 3, 4, 5], timezone: 'Europe/London', paused_until: null, pause_reason: null, last_seen_at: ago(0.02) }, queued: 7, today: { connects: 6, messages: 11, visits: 23 }, connected: true };
    case '/linkedin/queue': case '/linkedin/actions': return [];
    case '/calendar/connections': return { available: true, connections: [{ id: 'cc1', provider: 'google', account_email: 'alex@affivault.com', read_busy: true, write_events: true, broken_at: null, broken_reason: null, last_synced_at: ago(0.01) }] };
    case '/calendar/availability': return { windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 540, end_minute: 1020 })), prefs: { timezone: 'Europe/London', buffer_before_minutes: 0, buffer_after_minutes: 10, minimum_notice_minutes: 240, max_bookings_per_day: 6, slot_interval_minutes: 30, booking_horizon_days: 21 } };
    case '/calendar/slots': { const out = []; for (let d = 1; d <= 5; d++) for (const h of [10, 11, 14, 15.5]) { const t = new Date(now + d * DAY); t.setUTCHours(Math.floor(h), (h % 1) * 60, 0, 0); out.push({ start: t.toISOString(), end: new Date(t.getTime() + 1800000).toISOString() }); } return out; }
    case '/calendar/types': return eventTypes;
    case '/booking-links': return [{ ...base, id: 'bl1', slug: 'alex-intro', event_type_id: 'et1', duration_minutes: null, headline: 'Intro call with Alex', blurb: '30 minutes to see if a partnership makes sense.', collect_phone: false, collect_company: true, question: null, is_active: true, views: 84, bookings: 12, create_deal: true, deal_stage: 'qualified', notify_organiser: true, confirmation_note: null, archived_at: null, event_type: { id: 'et1', name: 'Intro call', colour: '#6366f1', duration_minutes: 30, location_kind: 'video' } }];
    case '/booking-links/readiness': return { can_email: true };
    case '/readiness': return { verdict: 'risky', summary: 'Sending works, but one domain is not authenticated.', checks: [{ id: 'domain_auth', group: 'identity', label: 'Domain authentication', status: 'warn', headline: '1 of 2 domains authenticated', detail: 'affivault.io has no SPF or DKIM.', fix: { label: 'Fix DNS', href: '/email-accounts?tab=domains', inline: 'recheck_domains' }, facts: [] }, { id: 'safeguards', group: 'safeguards', label: 'Automatic protection', status: 'warn', headline: 'The bounce guard is switched off.', detail: 'Nothing will stop a campaign that starts bouncing heavily.', fix: { label: 'Turn it on', href: '/settings', inline: 'enable_bounce_guard' }, facts: [] }, { id: 'cap', group: 'capacity', label: 'Daily capacity', status: 'pass', headline: '150 sends a day across 3 mailboxes', detail: null, fix: null, facts: [{ label: 'Today', value: '57 sent' }] }], capacity_today: 150, capacity_ceiling: 150, generated_at: iso(now) };
    case '/prospecting/rules': return [{ ...base, id: 'pr1', name: 'Fintech heads of growth, UK', filters: { titles: ['Head of Growth'], industries: ['Financial services'], locations: ['United Kingdom'] }, campaign_id: 'cmp1', list_id: null, daily_cap: 25, cadence: 'daily', min_score: 70, is_active: true, next_run_at: ahead(0.5), last_run_at: ago(0.5), last_result: { found: 31, enrolled: 25, skipped: 6 }, total_enrolled: 212, campaign: { id: 'cmp1', name: 'Q3 Fintech outreach', status: 'running' } }];
    case '/prospecting/status': return { provider: 'apollo', credits: { allowance: 1000, used: 212, plan_remaining: 788, purchased: 0, remaining: 788, resets_at: ahead(18) } };
    case '/sse/dashboard': return mailboxes.map((b, i) => ({ id: b.id, label: b.label, email_address: b.email_address, health_score: b.health_score, sends_today: b.sends_today, daily_send_limit: 50, utilization_pct: Math.round(b.sends_today / 50 * 100), bounce_rate_7d: [0.8, 1.4, 0.4][i], warmup_mode: i === 2, is_available: true }));
    case '/assets/templates': return [];
    case '/assets/templates/presets': return [];
    case '/webhooks/endpoints': return [{ ...base, id: 'wh1', url: 'https://hooks.zapier.com/hooks/catch/123/abc', label: 'Zapier - new replies', secret: null, is_active: true, events: ['reply.received', 'lead.created'] }];
    case '/integrations': return [];
    case '/integrations/oauth-availability': return { hubspot: true, slack: true, salesforce: false, pipedrive: true };
    case '/suppression': return { data: [['bounce@deadco.com', 'bounced'], ['no@thanks.io', 'unsubscribed'], ['legal@bigcorp.com', 'manual']].map(([email, reason], i) => ({ id: `sup${i}`, user_id: 'u1', email, reason, notes: undefined, created_at: ago(i * 3), updated_at: ago(i * 3) })), total: 14, page: 1, limit: 25, total_pages: 1 };
    case '/verification/stats': return { total: 1450, verified: 1320, unverified: 130, avg_score: 84, score_distribution: [{ range: '0-49', count: 20 }, { range: '50-69', count: 140 }, { range: '70-89', count: 700 }, { range: '90-100', count: 460 }], smtp: { available: true, consecutive_failures: 0, last_reason: '', retry_after_seconds: null } };
    case '/team/org': return { id: 'org1', name: 'AffiVault', owner_id: 'u1', created_at: ago(90) };
    case '/team/members': return [{ id: 'tm1', org_id: 'org1', user_id: 'u1', email: 'alex@affivault.com', role: 'owner', created_at: ago(90) }, { id: 'tm2', org_id: 'org1', user_id: 'u2', email: 'jordan@affivault.com', role: 'member', created_at: ago(20) }];
    case '/team/invites': return [{ id: 'ti1', org_id: 'org1', email: 'sam@affivault.com', role: 'member', token: 't', expires_at: ahead(5), created_at: ago(2) }];
    case '/tracking-domains': case '/tracking-domain': return [];
    case '/segments': return [];
    case '/webhooks/deliveries': return [];
    case '/search': {
      const t = (q.get('q') || '').toLowerCase();
      const hits = [
        ...contacts.filter((c) => `${c.first_name} ${c.last_name} ${c.email} ${c.company}`.toLowerCase().includes(t)).slice(0, 4).map((c) => ({ type: 'contact', id: c.id, title: `${c.first_name} ${c.last_name}`, subtitle: `${c.job_title} · ${c.company}`, href: `/contacts/${c.id}` })),
        ...deals.filter((d) => d.title.toLowerCase().includes(t)).slice(0, 3).map((d) => ({ type: 'deal', id: d.id, title: d.title, subtitle: `${d.stage} · $${d.value.toLocaleString()}`, href: `/deals/${d.id}` })),
        ...campaigns.filter((c) => c.name.toLowerCase().includes(t)).slice(0, 2).map((c) => ({ type: 'campaign', id: c.id, title: c.name, subtitle: c.status, href: `/campaigns/${c.id}` })),
      ];
      return { hits, took_ms: 12 };
    }
    case '/flow/since': return { since: ago(2), replies: 6, positive_replies: 3, meetings_booked: 1, deals_created: 2, deals_won: 1, won_value: 30000, bounces: 1, campaigns_completed: 1 };
  }
  if (/^\/analytics\/revenue\/cmp\d+$/.test(P)) {
    const c = campaigns.find((x) => x.id === seg[3]) || campaigns[0]; const r = revRow(c, campaigns.indexOf(c));
    return { campaign: { id: c.id, name: c.name, status: c.status, created_at: c.created_at }, funnel: [{ label: 'Sent', count: c.sent_count, ofPrevious: null }, { label: 'Replied', count: c.replied_count, ofPrevious: c.replied_count / c.sent_count }, { label: 'Deals', count: r.deals, ofPrevious: r.deals / c.replied_count }, { label: 'Won', count: r.won, ofPrevious: r.won / Math.max(1, r.deals) }], totals: (({ id, name, status, created_at, ...t }) => t)(r), steps: steps.map((s, i) => ({ id: s.id, step_order: s.step_order, step_type: 'email', subject: s.subject, sent: [312, 280, 240][i], replied: [22, 12, 7][i], deals: [3, 1, 0][i], won: [1, 0, 0][i], won_value: [30000, 0, 0][i], value_per_reply: [1364, 0, 0][i] })), unrecorded_step: null, deals: deals.slice(0, 3).map((d) => ({ id: d.id, title: d.title, stage: d.stage, contact_id: d.contact_id, contact_name: d.contact_name, contact_email: d.contact_email, attribution: 'thread', source_step_id: 'st1', value: d.value, closed_at: d.closed_at, created_at: d.created_at })) };
  }
  const cm = P.match(/^\/(?:analytics\/)?campaigns\/(cmp\d+)(\/.*)?$/);
  if (cm) {
    const c = campaigns.find((x) => x.id === cm[1]) || campaigns[0]; const rest = cm[2] || '';
    if (P.startsWith('/analytics/')) {
      if (!rest) return { campaign_id: c.id, total_contacts: c.total_contacts, sent: c.sent_count, opened: c.opened_count, clicked: c.clicked_count, replied: c.replied_count, bounced: c.bounced_count, errors: 0, open_rate: c.open_rate, click_rate: c.click_rate, reply_rate: c.reply_rate, bounce_rate: c.bounce_rate };
      if (rest === '/ab-test') return { has_ab_test: true, steps: [{ step_number: 1, step_id: 'st1', subject_a: steps[0].subject, subject_b: steps[0].subject_b, variant_a: { sent: 156, opened: 80, clicked: 12, replied: 12, open_rate: 51, click_rate: 7.7, reply_rate: 7.7 }, variant_b: { sent: 156, opened: 84, clicked: 13, replied: 17, open_rate: 54, click_rate: 8.3, reply_rate: 10.9 }, winner: null, leading: 'b', significant: false, p_value: 0.31, has_enough_data: false, min_sample: 200, untracked_sent: 0 }] };
      if (rest === '/outcomes') return { steps: steps.map((s, i) => ({ ...arm([312, 280, 240][i], [9, 4, 2][i]), step_id: s.id, step_order: s.step_order, subject: s.subject, subject_b: s.subject_b, split: i === 0, a: i === 0 ? arm(156, 4) : null, b: i === 0 ? arm(156, 5) : null, suggestion: null })), total_positive: 15, headline: 'Step 1 books most of the meetings.' };
      if (rest === '/trend') return trend.slice(-14);
      if (rest === '/steps') return { total_sent: c.sent_count, total_replied: c.replied_count, steps: [], recommended_length: null, headline: '' };
      if (rest === '/heatmap') return { cells: [], max: 0 };
      if (rest === '/funnel') return [];
      if (rest === '/contacts') return { contacts: [] };
    }
    if (rest === '/health') return { level: c.status === 'paused' ? 'attention' : 'ok', summary: c.status === 'paused' ? 'Paused by you' : 'Sending on schedule', issues: [], sent_24h: 48, pending: c.active_contacts, errored: 0, capacity_today: 150, days_to_clear: 4, generated_at: iso(now) };
    if (rest === '/forecast') return { days: Array.from({ length: 10 }, (_, i) => ({ date: ahead(i).slice(0, 10), sends: i < 5 ? 48 : i < 7 ? 0 : 30, capacity: 150, sending_day: !(i === 5 || i === 6) })), total_sends: 330, finish_day: 9, finish_date: ahead(9).slice(0, 10), first_touch_day: 0, bottleneck: 'daily_limit', daily_capacity: 150, projection: { replies: 24, positive: 9, reply_rate: 0.072, positive_rate: 0.027, basis_sent: 1252, assumed: false }, warnings: [] };
    if (rest === '/sender-pool') return ['m1', 'm2'];
    if (rest === '/steps') return steps;
    if (rest === '/contacts') return { data: contacts.slice(0, 8).map((ct, i) => ({ id: `cc${q.get('page') || 1}_${i}`, campaign_id: c.id, contact_id: ct.id, status: ['active', 'active', 'replied', 'completed', 'active', 'bounced', 'active', 'active'][i], current_step: 1 + (i % 3), next_send_at: ahead(1), last_sent_at: ago(1), created_at: ago(10), contact: { email: ct.email, first_name: ct.first_name, last_name: ct.last_name } })), total: c.contacts_count, page: 1, limit: 100, total_pages: 5 };
    if (rest === '/personalization') return { total_contacts: c.contacts_count, tags: [], timezone_coverage: null };
    if (rest === '/reach') return { reachable: c.contacts_count, excluded: 0, reasons: [] };
    if (rest === '/webhook-token') return { token: 'tok', url: 'https://example.com/hook' };
  }
  if (/^\/crm\/deals\/d\d+\/detail$/.test(P)) {
    const d = deals.find((x) => x.id === seg[3]) || deals[0]; const ct = contacts.find((x) => x.id === d.contact_id);
    return { deal: { ...d, contact: { id: ct.id, email: ct.email, first_name: ct.first_name, last_name: ct.last_name, company: ct.company, job_title: ct.job_title } }, participants: [{ id: 'dp1', deal_id: d.id, contact_id: 'c7', role: 'Economic buyer', note: null, created_at: ago(5), contact: { id: 'c7', email: contacts[6].email, first_name: 'Sofia', last_name: 'Marin', company: contacts[6].company, job_title: contacts[6].job_title } }], tasks: tasks.filter((t) => t.deal_id === d.id), events: events.filter((e) => e.deal_id === d.id), notes, history: history(d.id), emails: inbox.slice(0, 3).map((m) => ({ id: m.id, subject: m.subject, from_email: m.from_email, to_email: m.to_email, direction: 'inbound', received_at: m.received_at, body_text: m.body_text, is_read: true, contact_id: m.contact_id })) };
  }
  if (/^\/placement\/pl\d+$/.test(P)) {
    const probes = ['gmail', 'gmail', 'gmail', 'outlook', 'outlook', 'outlook', 'yahoo', 'yahoo', 'yahoo', 'other'].map((provider, i) => ({ id: `pb${i}`, seed_account_id: `seed${i % 3}`, seed_email: `seed${i}@${provider}.com`, provider, placement: i === 4 ? 'spam' : 'inbox', folder: i === 4 ? 'Junk' : 'INBOX', send_error: null, found_at: ago(2) }));
    return { test: { id: seg[2], smtp_account_id: 'm1', campaign_id: 'cmp1', step_id: 'st1', subject: 'Quick question about your partner program', body_html: '<p>Hi</p>', status: 'complete', error: null, started_at: ago(2), completed_at: ago(2) }, results: probes, summary: placementSummary(9, 1, 0) };
  }
  if (/^\/crm\/deals\/d\d+\/history$/.test(P)) return history(seg[3]);
  if (/^\/companies\/co\d+\/summary$/.test(P)) {
    const i = Number(seg[2].slice(2)) - 1; const c = contacts[i] || contacts[0];
    return { company: { ...base, id: seg[2], name: c.company, normalized_name: c.company.toLowerCase(), domain: c.email.split('@')[1], website: `https://${c.email.split('@')[1]}`, industry: 'Financial services', size: '51-200', location: 'London, UK', linkedin_url: null, notes: null }, contacts: [c, contacts[(i + 6) % 12]].map((x) => ({ id: x.id, email: x.email, first_name: x.first_name, last_name: x.last_name, job_title: x.job_title, dcs_score: x.dcs_score })), deals: deals.filter((d) => d.company_id === seg[2]) };
  }
  if (/^\/companies\/co\d+\/activity$/.test(P)) {
    const i = Number(seg[2].slice(2)) - 1; const c = contacts[i] || contacts[0];
    return { contacts: [{ id: c.id, email: c.email, first_name: c.first_name, last_name: c.last_name }], messages: inbox.filter((m) => m.contact_id === c.id).map((m) => ({ id: m.id, subject: m.subject, from_email: m.from_email, to_email: m.to_email, contact_email: c.email, contact_name: m.contact_name, direction: 'inbound', received_at: m.received_at, body_text: m.body_text })), notes: [], tasks: tasks.filter((t) => t.contact_id === c.id), events: events.filter((e) => e.contact_id === c.id) };
  }
  if (/^\/crm\/contact\/c\d+\/summary$/.test(P)) {
    const own = deals.filter((d) => d.contact_id === seg[3]);
    return {
      deals: own, tasks: tasks.filter((t) => t.contact_id === seg[3]), events: events.filter((e) => e.contact_id === seg[3]), notes: seg[3] === 'c1' ? notes : [],
      stage_events: own.flatMap((d, i) => [
        { id: `se-${d.id}-0`, deal_id: d.id, from_stage: null, to_stage: 'lead', reason: null, changed_at: ago(12 + i) },
        ...(d.stage !== 'lead' ? [{ id: `se-${d.id}-1`, deal_id: d.id, from_stage: 'lead', to_stage: d.stage, reason: d.stage === 'lost' ? 'Went with a competitor' : null, changed_at: ago(3 + i) }] : []),
      ]),
    };
  }
  if (/^\/domains\/[^/]+\/records$/.test(P)) return { domain: {}, dns: {}, records: dnsRecords };
  if (/^\/analytics\/contacts\/c\d+\/timeline$/.test(P)) {
    const cmp = { campaign_id: 'cp1', campaign_name: 'UK brokers - Q4' };
    return [
      { id: 't1', activity_type: 'sent', ...cmp, step_order: 0, step_subject: 'Quick question about your partner program', metadata: {}, occurred_at: ago(14) },
      { id: 't2', activity_type: 'opened', ...cmp, step_order: 0, step_subject: 'Quick question about your partner program', metadata: {}, occurred_at: ago(13.8) },
      { id: 't3', activity_type: 'opened', ...cmp, step_order: 0, step_subject: 'Quick question about your partner program', metadata: {}, occurred_at: ago(13.2) },
      { id: 't4', activity_type: 'opened', ...cmp, step_order: 0, step_subject: 'Quick question about your partner program', metadata: {}, occurred_at: ago(11) },
      { id: 't5', activity_type: 'clicked', ...cmp, step_order: 0, step_subject: 'Quick question about your partner program', metadata: { url: 'https://affivault.com/partners' }, occurred_at: ago(11) },
      { id: 't6', activity_type: 'sent', ...cmp, step_order: 1, step_subject: 'Re: Quick question about your partner program', metadata: {}, occurred_at: ago(10) },
      ...(seg[3] === 'c2' ? [{ id: 't7', activity_type: 'bounced', ...cmp, step_order: 1, step_subject: null, metadata: { source: 'notice', bounce_kind: 'address', reason: 'user unknown' }, occurred_at: ago(9.9) }] : []),
    ].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }
  if (/^\/lists\/contact\/c\d+$/.test(P)) return [];
  if (/^\/contacts\/c\d+\/campaigns$/.test(P)) return [];
  if (/^\/flow\/meetings\/e\d+\/brief$/.test(P)) return null;
  return undefined;
}
module.exports = { answer, contacts, campaigns, deals, inbox, otherMail };

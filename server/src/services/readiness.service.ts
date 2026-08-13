import { supabaseAdmin } from '../config/supabase.js';
import { settingsService } from './settings.service.js';
import { trackingDomainService } from './tracking-domain.service.js';
import { MIN_SENDS_BEFORE_GUARD } from './bounce-guard.service.js';
import { warmupAllowance, warmupDayNumber, emailDomain, isFreeMailDomain, worseStatus } from '@lemlist/shared';
import type {
  ReadinessCheck, ReadinessReport, ReadinessStatus, SmtpAccount,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Am I safe to send?

   Every input to that question was already being collected. None of it was
   ever put in one place, so answering it meant visiting five pages and
   holding the result in your head — which is to say it was never answered
   before a launch, only afterwards, by the bounce rate.

   Three rules this report holds itself to:

     · Only say `fail` when a send genuinely cannot succeed, or would cost
       something that cannot be undone. A report that cries wolf gets
       ignored precisely when it is right.

     · Never invent a problem out of missing data. A pre-migration database
       returns nothing for half of this; "not measured" is reported as a
       pass with an honest headline, never as a failure.

     · Every non-pass carries the link that fixes it. A checklist that
       tells you something is wrong and leaves you to find the page is a
       worse experience than not being told.
   ═══════════════════════════════════════════════════════════════════════ */

/** Below this health score a mailbox is doing measurable harm. */
const HEALTH_WARN = 70;
const HEALTH_FAIL = 40;

/** Bounce rate over the whole account, judged against the same scale as the guard. */
const ACCOUNT_BOUNCE_WARN = 5;

/** A mailbox this new sending at full volume is the classic way to burn one. */
const YOUNG_MAILBOX_DAYS = 30;
const YOUNG_MAILBOX_SENDS = 500;

function check(c: Partial<ReadinessCheck> & Pick<ReadinessCheck, 'id' | 'group' | 'label' | 'status' | 'headline'>): ReadinessCheck {
  return { detail: null, fix: null, facts: [], ...c };
}

const pct = (n: number) => `${n.toFixed(1)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything the send path will consult, assembled once.
 *
 * Deliberately tolerant: each source is allowed to fail without taking the
 * report down with it, because a readiness page that errors is the least
 * useful thing it could possibly do.
 */
async function gather(userId: string) {
  const [accountsRes, domainsRes, settings, tracking, campaignsRes] = await Promise.all([
    supabaseAdmin.from('smtp_accounts').select('*').eq('user_id', userId),
    supabaseAdmin.from('sending_domains').select('*').eq('user_id', userId),
    settingsService.get(userId).catch(() => null),
    trackingDomainService.get(userId).catch(() => null),
    supabaseAdmin.from('campaigns').select('id, name, status, paused_reason').eq('user_id', userId),
  ]);

  const campaigns = campaignsRes.data || [];
  const campaignIds = campaigns.map((c: any) => c.id);

  // Account-wide bounce rate. Counted over every campaign rather than the
  // last N days: a bad list burns the domain once, and the damage does not
  // expire from a rolling window just because the calendar moved on.
  let sent = 0;
  let bounced = 0;
  if (campaignIds.length > 0) {
    const [sentRes, bouncedRes] = await Promise.all([
      supabaseAdmin.from('campaign_activities')
        .select('*', { count: 'exact', head: true })
        .in('campaign_id', campaignIds).eq('activity_type', 'sent'),
      supabaseAdmin.from('campaign_activities')
        .select('*', { count: 'exact', head: true })
        .in('campaign_id', campaignIds).eq('activity_type', 'bounced'),
    ]);
    sent = sentRes.count || 0;
    bounced = bouncedRes.count || 0;
  }

  return {
    accounts: (accountsRes.data || []) as SmtpAccount[],
    domains: domainsRes.data || [],
    settings,
    tracking,
    campaigns,
    sent,
    bounced,
  };
}

/** Is a mailbox usable for a real campaign send right now? */
function sendable(a: SmtpAccount): boolean {
  return a.is_active && a.is_verified;
}

function mailboxCheck(accounts: SmtpAccount[]): ReadinessCheck {
  const usable = accounts.filter(sendable);
  const fix = { label: 'Manage mailboxes', href: '/email-accounts?tab=mailboxes' };

  if (accounts.length === 0) {
    return check({
      id: 'mailboxes', group: 'identity', label: 'Sending mailbox', status: 'fail',
      headline: 'No mailbox connected.',
      detail: 'Nothing can send until at least one mailbox is connected and verified.',
      fix,
    });
  }
  if (usable.length === 0) {
    const why = accounts.some((a) => !a.is_verified)
      ? 'none have passed a connection test'
      : 'all of them are switched off';
    return check({
      id: 'mailboxes', group: 'identity', label: 'Sending mailbox', status: 'fail',
      headline: `${plural(accounts.length, 'mailbox', 'mailboxes')} connected, but ${why}.`,
      detail: 'Run "Test" on the mailbox — a campaign will stall on its first send otherwise.',
      fix,
      facts: [{ label: 'Connected', value: String(accounts.length) }],
    });
  }

  // One mailbox is not a fault, but it is a single point of failure: the
  // day it is throttled, every campaign stops at once.
  const status: ReadinessStatus = usable.length === 1 ? 'warn' : 'pass';
  return check({
    id: 'mailboxes', group: 'identity', label: 'Sending mailbox', status,
    headline: `${plural(usable.length, 'mailbox', 'mailboxes')} ready to send.`,
    detail: status === 'warn'
      ? 'Everything runs through one mailbox — if it gets throttled, every campaign stops at once. A second one spreads the volume.'
      : null,
    fix: status === 'warn' ? { label: 'Add a mailbox', href: '/email-accounts?tab=mailboxes' } : null,
    facts: [
      { label: 'Ready', value: String(usable.length) },
      ...(accounts.length > usable.length
        ? [{ label: 'Unusable', value: String(accounts.length - usable.length) }]
        : []),
    ],
  });
}

function domainAuthCheck(accounts: SmtpAccount[], domains: any[]): ReadinessCheck {
  const fix = { label: 'Fix DNS', href: '/email-accounts?tab=domains' };
  const usable = accounts.filter(sendable);

  // Only the domains actually being sent from matter. A domain added and
  // then abandoned is not a reason to tell someone they are unsafe.
  const sendingDomains = [...new Set(usable.map((a) => emailDomain(a.email_address)).filter(Boolean))];
  if (sendingDomains.length === 0) {
    return check({
      id: 'domain_auth', group: 'identity', label: 'Domain authentication', status: 'pass',
      headline: 'Nothing to check until a mailbox is connected.',
    });
  }

  const match = (d: string) =>
    domains.find((sd: any) => d === String(sd.domain).toLowerCase() || d.endsWith(`.${String(sd.domain).toLowerCase()}`));

  const unauthenticated: string[] = [];
  const partial: string[] = [];
  const consumer: string[] = [];
  let weakDmarc = 0;

  for (const d of sendingDomains) {
    // A consumer mailbox is authenticated by its provider and cannot be
    // authenticated by the customer. Reporting it as broken DNS would be
    // telling someone to fix something they have no access to.
    if (isFreeMailDomain(d)) { consumer.push(d); continue; }
    const row = match(d);
    if (!row || !row.is_verified) { unauthenticated.push(d); continue; }
    if (!row.spf_ok || !row.dkim_ok) { partial.push(d); continue; }
    if (!row.dmarc_ok) weakDmarc++;
  }

  const facts = [
    { label: 'Sending domains', value: String(sendingDomains.length) },
    ...(consumer.length ? [{ label: 'Consumer mailboxes', value: String(consumer.length) }] : []),
  ];

  if (unauthenticated.length > 0) {
    return check({
      id: 'domain_auth', group: 'identity', label: 'Domain authentication', status: 'fail',
      headline: `${unauthenticated.join(', ')} ${unauthenticated.length === 1 ? 'is' : 'are'} not authenticated.`,
      detail: 'Gmail and Yahoo reject or spam-folder bulk mail from a domain without SPF and DKIM. This is the single largest thing standing between you and the inbox.',
      fix, facts,
    });
  }
  if (partial.length > 0) {
    return check({
      id: 'domain_auth', group: 'identity', label: 'Domain authentication', status: 'fail',
      headline: `${partial.join(', ')} ${partial.length === 1 ? 'is' : 'are'} missing SPF or DKIM.`,
      detail: 'Ownership is proven but the records that make receivers trust your mail are incomplete.',
      fix, facts,
    });
  }
  if (weakDmarc > 0) {
    return check({
      id: 'domain_auth', group: 'identity', label: 'Domain authentication', status: 'warn',
      headline: `SPF and DKIM pass, but ${plural(weakDmarc, 'domain')} ${weakDmarc === 1 ? 'has' : 'have'} no DMARC record.`,
      detail: 'Gmail and Yahoo require DMARC from bulk senders. Start at p=none to watch, then tighten.',
      fix, facts,
    });
  }
  if (consumer.length === sendingDomains.length) {
    return check({
      id: 'domain_auth', group: 'identity', label: 'Domain authentication', status: 'warn',
      headline: `Sending from ${consumer.join(', ')} — a consumer mailbox.`,
      detail: 'Cold email from a free provider is filtered hard and cannot be authenticated as your own brand. A domain you own does considerably better.',
      fix: { label: 'Add a domain', href: '/email-accounts?tab=domains' },
      facts,
    });
  }
  return check({
    id: 'domain_auth', group: 'identity', label: 'Domain authentication', status: 'pass',
    headline: `SPF, DKIM and DMARC pass on ${plural(sendingDomains.length - consumer.length, 'domain')}.`,
    facts,
  });
}

function trackingCheck(tracking: any): ReadinessCheck {
  const fix = { label: 'Set up tracking domain', href: '/email-accounts?tab=domains' };
  if (!tracking) {
    return check({
      id: 'tracking_domain', group: 'identity', label: 'Link tracking domain', status: 'warn',
      headline: 'Open pixels and links point at the shared Sincerely host.',
      detail: 'Spam filters judge the domains inside a message, not only the one it came from. A shared link host makes your deliverability depend on everyone else using it.',
      fix,
    });
  }
  if (!tracking.verified) {
    return check({
      id: 'tracking_domain', group: 'identity', label: 'Link tracking domain', status: 'warn',
      headline: `${tracking.domain} is set up but not verified yet.`,
      detail: tracking.last_error
        ? `Last check: ${tracking.last_error}. Links stay on the shared host until it passes.`
        : 'Links stay on the shared host until DNS and HTTPS both pass.',
      fix: { label: 'Verify it', href: '/email-accounts?tab=domains' },
    });
  }
  return check({
    id: 'tracking_domain', group: 'identity', label: 'Link tracking domain', status: 'pass',
    headline: `Links and open pixels run through ${tracking.domain}.`,
  });
}

function healthCheck(accounts: SmtpAccount[]): ReadinessCheck {
  const usable = accounts.filter(sendable);
  const fix = { label: 'Review mailboxes', href: '/email-accounts?tab=mailboxes' };
  if (usable.length === 0) {
    return check({
      id: 'mailbox_health', group: 'reputation', label: 'Mailbox health', status: 'pass',
      headline: 'Nothing to score until a mailbox is ready.',
    });
  }

  const worst = usable.reduce((lo, a) => (a.health_score < lo.health_score ? a : lo), usable[0]);
  const failing = usable.filter((a) => a.health_score < HEALTH_FAIL);
  const struggling = usable.filter((a) => a.health_score < HEALTH_WARN);

  if (failing.length > 0) {
    return check({
      id: 'mailbox_health', group: 'reputation', label: 'Mailbox health', status: 'fail',
      headline: `${plural(failing.length, 'mailbox', 'mailboxes')} below ${HEALTH_FAIL}% health.`,
      detail: `${worst.email_address} is at ${worst.health_score}%. Health drops on every bounce and recovers on engagement — sending more from it now deepens the hole.`,
      fix,
      facts: [{ label: 'Lowest', value: `${worst.health_score}%` }],
    });
  }
  if (struggling.length > 0) {
    return check({
      id: 'mailbox_health', group: 'reputation', label: 'Mailbox health', status: 'warn',
      headline: `${plural(struggling.length, 'mailbox', 'mailboxes')} under ${HEALTH_WARN}% health.`,
      detail: `${worst.email_address} is at ${worst.health_score}%. Clean the list it is sending to before adding volume.`,
      fix,
      facts: [{ label: 'Lowest', value: `${worst.health_score}%` }],
    });
  }
  return check({
    id: 'mailbox_health', group: 'reputation', label: 'Mailbox health', status: 'pass',
    headline: `Every mailbox is at ${HEALTH_WARN}% health or better.`,
    facts: [{ label: 'Lowest', value: `${worst.health_score}%` }],
  });
}

function bounceRateCheck(sent: number, bounced: number, thresholdPercent: number): ReadinessCheck {
  const fix = { label: 'Verify your lists', href: '/verification' };
  if (sent < MIN_SENDS_BEFORE_GUARD) {
    return check({
      id: 'bounce_rate', group: 'reputation', label: 'Bounce rate', status: 'pass',
      headline: sent === 0
        ? 'Nothing sent yet — no bounce history to judge.'
        : `Only ${plural(sent, 'send')} so far, too few to read anything into.`,
    });
  }
  const rate = (bounced / sent) * 100;
  const facts = [
    { label: 'Bounced', value: `${bounced.toLocaleString()} of ${sent.toLocaleString()}` },
    { label: 'Rate', value: pct(rate) },
  ];

  if (rate >= thresholdPercent) {
    return check({
      id: 'bounce_rate', group: 'reputation', label: 'Bounce rate', status: 'fail',
      headline: `${pct(rate)} of everything you have sent bounced.`,
      detail: `That is at or above your ${thresholdPercent}% limit. Mailbox providers read a rate this high as a spam signal, and stopping afterwards does not give the reputation back. Verify the list before the next launch.`,
      fix, facts,
    });
  }
  if (rate >= ACCOUNT_BOUNCE_WARN) {
    return check({
      id: 'bounce_rate', group: 'reputation', label: 'Bounce rate', status: 'warn',
      headline: `${pct(rate)} of everything you have sent bounced.`,
      detail: `Under your ${thresholdPercent}% limit, but a healthy cold list sits at two or three percent. Worth verifying before you scale up.`,
      fix, facts,
    });
  }
  return check({
    id: 'bounce_rate', group: 'reputation', label: 'Bounce rate', status: 'pass',
    headline: `${pct(rate)} of your sends bounced — a healthy list.`,
    facts,
  });
}

function warmupCheck(accounts: SmtpAccount[]): ReadinessCheck {
  const usable = accounts.filter(sendable);
  const fix = { label: 'Start warm-up', href: '/email-accounts?tab=warmup' };
  if (usable.length === 0) {
    return check({
      id: 'warmup', group: 'reputation', label: 'Warm-up', status: 'pass',
      headline: 'Nothing to warm up yet.',
    });
  }

  const warming = usable.filter((a) => a.warmup_mode);
  // A mailbox is "young" until it has either been running a while or has
  // real volume behind it. total_sent is the honest measure — a mailbox
  // added today may well have been sending for years elsewhere.
  const cold = usable.filter((a) => {
    if (a.warmup_mode) return false;
    const daysOld = warmupDayNumber(a.created_at);
    return daysOld < YOUNG_MAILBOX_DAYS && a.total_sent < YOUNG_MAILBOX_SENDS;
  });

  const facts = [
    { label: 'Warming', value: `${warming.length} of ${usable.length}` },
    ...(warming.length
      ? [{
          label: 'Ramp day',
          value: String(Math.max(...warming.map((a) => warmupDayNumber(a.warmup_started_at)))),
        }]
      : []),
  ];

  if (cold.length > 0) {
    return check({
      id: 'warmup', group: 'reputation', label: 'Warm-up', status: 'warn',
      headline: `${plural(cold.length, 'new mailbox', 'new mailboxes')} sending at full volume with no warm-up.`,
      detail: `${cold.map((a) => a.email_address).slice(0, 3).join(', ')} ${cold.length === 1 ? 'has' : 'have'} little sending history. Going straight to full volume is the fastest way to get a new mailbox filtered.`,
      fix, facts,
    });
  }
  if (warming.length > 0) {
    return check({
      id: 'warmup', group: 'reputation', label: 'Warm-up', status: 'pass',
      headline: `${plural(warming.length, 'mailbox', 'mailboxes')} on a warm-up ramp — volume is capped to today's allowance.`,
      facts,
    });
  }
  return check({
    id: 'warmup', group: 'reputation', label: 'Warm-up', status: 'pass',
    headline: 'Every mailbox has enough history to send at full volume.',
    facts,
  });
}

function capacityCheck(accounts: SmtpAccount[]): { check: ReadinessCheck; remaining: number | null; ceiling: number | null } {
  const usable = accounts.filter(sendable);
  const fix = { label: 'Adjust limits', href: '/email-accounts?tab=mailboxes' };

  if (usable.length === 0) {
    return {
      check: check({
        id: 'capacity', group: 'capacity', label: "Today's capacity", status: 'pass',
        headline: 'No capacity to report until a mailbox is ready.',
      }),
      remaining: 0,
      ceiling: 0,
    };
  }

  // limit 0 means uncapped, so the ceiling becomes unknowable rather than
  // zero — reporting "0 remaining" for an unlimited mailbox would be the
  // exact opposite of the truth.
  let uncapped = false;
  let ceiling = 0;
  let remaining = 0;
  for (const a of usable) {
    const limit = warmupAllowance(a);
    if (limit <= 0) { uncapped = true; continue; }
    ceiling += limit;
    remaining += Math.max(0, limit - a.sends_today);
  }

  const facts = uncapped
    ? [{ label: 'Uncapped mailboxes', value: 'yes' }]
    : [
        { label: 'Remaining today', value: remaining.toLocaleString() },
        { label: 'Daily ceiling', value: ceiling.toLocaleString() },
      ];

  if (uncapped) {
    return {
      check: check({
        id: 'capacity', group: 'capacity', label: "Today's capacity", status: 'pass',
        headline: 'At least one mailbox has no daily cap.',
        detail: 'An uncapped mailbox will send as fast as the sequence asks it to. A limit is what stops one bad day becoming a blocked domain.',
        fix, facts,
      }),
      remaining: null,
      ceiling: null,
    };
  }
  if (remaining === 0) {
    return {
      check: check({
        id: 'capacity', group: 'capacity', label: "Today's capacity", status: 'fail',
        headline: 'Every mailbox has hit its limit for today.',
        detail: `${ceiling.toLocaleString()} sends used. Campaigns will wait until the counters reset rather than fail — nothing is lost, but nothing goes out today either.`,
        fix, facts,
      }),
      remaining, ceiling,
    };
  }
  const used = ceiling - remaining;
  if (remaining < ceiling * 0.15) {
    return {
      check: check({
        id: 'capacity', group: 'capacity', label: "Today's capacity", status: 'warn',
        headline: `${remaining.toLocaleString()} of ${ceiling.toLocaleString()} sends left today.`,
        detail: 'Launching a large campaign now means most of it waits for tomorrow.',
        fix, facts,
      }),
      remaining, ceiling,
    };
  }
  return {
    check: check({
      id: 'capacity', group: 'capacity', label: "Today's capacity", status: 'pass',
      headline: `${remaining.toLocaleString()} sends available today${used > 0 ? `, ${used.toLocaleString()} already used` : ''}.`,
      facts,
    }),
    remaining, ceiling,
  };
}

function safeguardCheck(settings: any, campaigns: any[]): ReadinessCheck {
  const fix = { label: 'Open settings', href: '/settings' };
  const enabled = settings ? settings.bounce_guard_enabled !== false : true;
  const threshold = Number(settings?.bounce_guard_threshold) > 0 ? Number(settings.bounce_guard_threshold) : 8;
  const throttle = Number(settings?.domain_hourly_limit) || 0;

  // Campaigns the guard has already stopped. Worth surfacing here even
  // though it is history: it is the clearest evidence that a list needs
  // attention before the next launch.
  const autoPaused = campaigns.filter(
    (c: any) => c.status === 'paused' && /Paused automatically/i.test(String(c.paused_reason || '')),
  );

  const facts = [
    { label: 'Bounce limit', value: enabled ? `${threshold}%` : 'off' },
    { label: 'Per-company throttle', value: throttle > 0 ? `${throttle}/hour` : 'off' },
  ];

  if (!enabled) {
    return check({
      id: 'safeguards', group: 'safeguards', label: 'Automatic protection', status: 'warn',
      headline: 'The bounce guard is switched off.',
      detail: 'Nothing will stop a campaign that starts bouncing heavily. Domain reputation is the one thing a cold-email mistake does not give back.',
      fix, facts,
    });
  }
  if (autoPaused.length > 0) {
    return check({
      id: 'safeguards', group: 'safeguards', label: 'Automatic protection', status: 'warn',
      headline: `The guard has already stopped ${plural(autoPaused.length, 'campaign')}.`,
      detail: `${autoPaused.map((c: any) => c.name).slice(0, 3).join(', ')} bounced past your ${threshold}% limit. Verify the list before resuming or launching anything similar.`,
      fix: { label: 'Review campaigns', href: '/campaigns' },
      facts,
    });
  }
  return check({
    id: 'safeguards', group: 'safeguards', label: 'Automatic protection', status: 'pass',
    headline: `Campaigns pause automatically above a ${threshold}% bounce rate${throttle > 0 ? `, and no company gets more than ${throttle} emails an hour` : ''}.`,
    facts,
  });
}

/** The one sentence at the top, written from what actually went wrong. */
function summarise(verdict: string, failed: ReadinessCheck[], warned: ReadinessCheck[]): string {
  if (verdict === 'blocked') {
    const names = failed.map((c) => c.label.toLowerCase());
    return failed.length === 1
      ? `Not safe to send yet — ${names[0]} needs fixing first.`
      : `Not safe to send yet — ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} need fixing first.`;
  }
  if (verdict === 'risky') {
    return warned.length === 1
      ? `You can send, but ${warned[0].label.toLowerCase()} will cost you deliverability.`
      : `You can send, but ${plural(warned.length, 'thing')} on this list will cost you deliverability.`;
  }
  return 'Safe to send — domain, mailboxes and safeguards all check out.';
}

export const readinessService = {
  /**
   * The whole answer, in one call.
   *
   * Read by a page someone opens before launching, so it is computed fresh
   * every time rather than cached: a stale "safe to send" is worse than a
   * slow one.
   */
  async report(userId: string): Promise<ReadinessReport> {
    const { accounts, domains, settings, tracking, campaigns, sent, bounced } = await gather(userId);
    const threshold = Number(settings?.bounce_guard_threshold) > 0 ? Number(settings?.bounce_guard_threshold) : 8;

    const capacity = capacityCheck(accounts);
    const checks: ReadinessCheck[] = [
      mailboxCheck(accounts),
      domainAuthCheck(accounts, domains),
      trackingCheck(tracking),
      healthCheck(accounts),
      bounceRateCheck(sent, bounced, threshold),
      warmupCheck(accounts),
      capacity.check,
      safeguardCheck(settings, campaigns),
    ];

    const worst = checks.reduce<ReadinessStatus>((acc, c) => worseStatus(acc, c.status), 'pass');
    const verdict = worst === 'fail' ? 'blocked' : worst === 'warn' ? 'risky' : 'ready';
    const failed = checks.filter((c) => c.status === 'fail');
    const warned = checks.filter((c) => c.status === 'warn');

    return {
      verdict,
      summary: summarise(verdict, failed, warned),
      checks,
      capacity_today: capacity.remaining,
      capacity_ceiling: capacity.ceiling,
      generated_at: new Date().toISOString(),
    };
  },
};

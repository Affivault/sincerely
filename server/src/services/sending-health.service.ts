/* ═══════════════════════════════════════════════════════════════════════
   Sending health: every mailbox, in one read.

   The page this feeds used to need six requests (mailboxes, domains,
   warm-up, autopilot, placement, and the activity behind a bounce trend)
   and then had to stitch them together in the browser, each with its own
   idea of what a mailbox's domain was. Gathered here instead, in parallel,
   and judged once by shared/sending-health so the verdict cannot drift
   from the rules the autopilot acts on.

   Every source but the mailboxes themselves is optional. A database
   without the placement tables (070) or the autopilot columns (077) still
   gets a page; the missing part reads as "not measured", never as "fine".
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { fetchAllPages } from '../utils/batch.js';
import {
  autopilotAllowance, warmupAllowance, warmupDayNumber, warmupIsComplete, judgeSendingHealth, placementSummary,
  percentOf, RECOMMENDED_GAP,
  type AutopilotState, type MailboxHealth, type SendingHealthDay, type SendingHealthDomain,
  type SendingHealthPlacement, type SendingHealthReport, type SendingHealthStatus,
} from '@lemlist/shared';

const TREND_DAYS = 14;
const DAY = 86_400_000;

function domainOf(email: string): string {
  return (String(email || '').split('@')[1] || '').toLowerCase().trim();
}

/** The registered domain that covers this address: exact, or a parent of it. */
function matchDomain<T extends { domain: string }>(domains: T[], email: string): T | null {
  const d = domainOf(email);
  if (!d) return null;
  return domains.find((sd) => d === sd.domain.toLowerCase() || d.endsWith('.' + sd.domain.toLowerCase())) || null;
}

interface ActivityRow { activity_type: string; occurred_at: string; account: string | null; bounce_kind: string | null }

/** Sends, bounces and spam reports from the last two weeks, by mailbox. */
async function readActivity(userId: string, since: Date): Promise<ActivityRow[]> {
  // The two metadata fields by JSON path rather than the whole blob: the
  // rest of it (headers, message ids) is most of the bytes and none of the
  // answer, and a busy account has tens of thousands of these rows.
  return fetchAllPages<ActivityRow>((from, to) => supabaseAdmin
    .from('campaign_activities')
    .select('activity_type, occurred_at, account:metadata->>smtp_account_id, bounce_kind:metadata->>bounce_kind, campaigns!inner(user_id)')
    .eq('campaigns.user_id', userId)
    .in('activity_type', ['sent', 'bounced', 'complained'])
    .gte('occurred_at', since.toISOString())
    .order('occurred_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to));
}

/** The latest finished placement test per mailbox, or null when the tables are missing. */
async function latestPlacement(userId: string): Promise<Map<string, SendingHealthPlacement> | null> {
  const { data: tests, error } = await supabaseAdmin
    .from('placement_tests')
    .select('id, smtp_account_id, status, completed_at, started_at')
    .eq('user_id', userId)
    .eq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return null;

  const latest = new Map<string, any>();
  for (const t of tests || []) if (t.smtp_account_id && !latest.has(t.smtp_account_id)) latest.set(t.smtp_account_id, t);
  const out = new Map<string, SendingHealthPlacement>();
  if (latest.size === 0) return out;

  const ids = [...latest.values()].map((t) => t.id);
  const { data: results, error: rErr } = await supabaseAdmin
    .from('placement_results')
    .select('test_id, provider, placement, folder')
    .in('test_id', ids);
  if (rErr) return out;

  for (const [accountId, t] of latest) {
    const summary = placementSummary(((results || []) as any[]).filter((r) => r.test_id === t.id));
    out.set(accountId, {
      test_id: t.id,
      at: t.completed_at || t.started_at,
      verdict: summary.verdict,
      inbox_rate: summary.inboxRate,
      headline: summary.headline,
    });
  }
  return out;
}

export const sendingHealthService = {
  async report(userId: string, now = new Date()): Promise<SendingHealthReport> {
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (TREND_DAYS - 1) * DAY);

    const [accountsRes, domainsRes, activity, placements] = await Promise.all([
      supabaseAdmin.from('smtp_accounts').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
      supabaseAdmin.from('sending_domains').select('id, domain, spf_ok, dkim_ok, dmarc_ok, last_checked_at').eq('user_id', userId),
      readActivity(userId, since),
      latestPlacement(userId),
    ]);
    if (accountsRes.error) throw new AppError(accountsRes.error.message, 500);
    // A missing domains table reads as "never checked", which is honest.
    const domains = (domainsRes.data || []) as Array<{ id: string; domain: string; spf_ok: boolean; dkim_ok: boolean; dmarc_ok: boolean; last_checked_at: string | null }>;

    // A seed mailbox receives placement probes and never sends.
    const accounts = ((accountsRes.data || []) as any[]).filter((a) => !a.is_seed);

    const dayKeys: string[] = [];
    for (let i = 0; i < TREND_DAYS; i++) dayKeys.push(new Date(since.getTime() + i * DAY).toISOString().slice(0, 10));
    const trendFor = new Map<string, Map<string, SendingHealthDay>>();
    const totals = new Map<string, { sent: number; bounced: number; blocked: number; complained: number }>();
    for (const a of accounts) {
      trendFor.set(a.id, new Map(dayKeys.map((date) => [date, { date, sent: 0, bounced: 0, complained: 0 }])));
      totals.set(a.id, { sent: 0, bounced: 0, blocked: 0, complained: 0 });
    }
    for (const r of activity) {
      if (!r.account) continue;
      const days = trendFor.get(r.account);
      const t = totals.get(r.account);
      if (!days || !t) continue;
      const day = days.get(String(r.occurred_at).slice(0, 10));
      if (r.activity_type === 'sent') { t.sent++; if (day) day.sent++; }
      else if (r.activity_type === 'complained') { t.complained++; if (day) day.complained++; }
      else {
        // A block refuses the sender, a bounce the address; both are a
        // refusal on the trend line, and the autopilot weighs them apart.
        if (r.bounce_kind === 'blocked') t.blocked++; else t.bounced++;
        if (day) day.bounced++;
      }
    }

    const mailboxes: MailboxHealth[] = accounts.map((a) => {
      const reg = matchDomain(domains, a.email_address);
      const domain: SendingHealthDomain = {
        domain: reg?.domain || domainOf(a.email_address),
        domain_id: reg?.id ?? null,
        // A row that has never been looked up says nothing yet.
        checked: !!reg && !!reg.last_checked_at,
        spf: !!reg?.spf_ok,
        dkim: !!reg?.dkim_ok,
        dmarc: !!reg?.dmarc_ok,
        last_checked_at: reg?.last_checked_at ?? null,
      };
      const t = totals.get(a.id)!;
      const state = ((a.autopilot_state as AutopilotState) || 'active');
      const gapMin = Number.isFinite(a.send_gap_min_seconds) ? a.send_gap_min_seconds : RECOMMENDED_GAP.min;
      const gapMax = Number.isFinite(a.send_gap_max_seconds) ? a.send_gap_max_seconds : RECOMMENDED_GAP.max;
      const placement = placements?.get(a.id) ?? null;
      const warmTarget = a.warmup_daily_target > 0 ? a.warmup_daily_target : a.daily_send_limit;

      return {
        id: a.id,
        label: a.label,
        email_address: a.email_address,
        is_active: !!a.is_active,
        is_verified: !!a.is_verified,
        sends_today: a.sends_today || 0,
        daily_send_limit: a.daily_send_limit ?? 0,
        allowance_today: autopilotAllowance(a, now).limit,
        gap_min: gapMin,
        gap_max: gapMax,
        next_send_allowed_at: a.next_send_allowed_at ?? null,
        warmup: {
          on: !!a.warmup_mode,
          day: warmupDayNumber(a.warmup_started_at),
          ramp_days: a.warmup_ramp_days > 0 ? a.warmup_ramp_days : 30,
          allowance: warmupAllowance(a),
          target: warmTarget,
          complete: warmupIsComplete(a),
        },
        autopilot: { state, reason: a.autopilot_reason ?? null, rest_until: a.autopilot_rest_until ?? null },
        totals_14d: {
          ...t,
          bounce_rate: percentOf(t.bounced + t.blocked, t.sent),
          complaint_rate: percentOf(t.complained, t.sent),
        },
        trend: [...trendFor.get(a.id)!.values()],
        domain,
        placement,
        health: judgeSendingHealth({
          is_active: !!a.is_active,
          is_verified: !!a.is_verified,
          last_send_error: a.last_send_error ?? null,
          created_at: a.created_at ?? null,
          daily_send_limit: a.daily_send_limit ?? 0,
          gap_min: gapMin,
          gap_max: gapMax,
          warmup_on: !!a.warmup_mode,
          autopilot_state: state,
          autopilot_reason: a.autopilot_reason ?? null,
          sent_14d: t.sent,
          bounced_14d: t.bounced,
          blocked_14d: t.blocked,
          complained_14d: t.complained,
          domain,
          placement,
        }, now),
      };
    });

    // Worst first, so the page opens on what needs doing.
    const rank: Record<SendingHealthStatus, number> = { at_risk: 0, watch: 1, healthy: 2 };
    mailboxes.sort((x, y) => rank[x.health.status] - rank[y.health.status]);

    const counts: Record<SendingHealthStatus, number> = { healthy: 0, watch: 0, at_risk: 0 };
    for (const m of mailboxes) counts[m.health.status]++;

    return { generated_at: now.toISOString(), mailboxes, counts, placement_available: placements !== null };
  },
};

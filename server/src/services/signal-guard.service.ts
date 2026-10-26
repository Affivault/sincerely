import { supabaseAdmin } from '../config/supabase.js';
import { autoPause } from './bounce-guard.service.js';
import { chunk } from '../utils/batch.js';
import {
  judgeComplaints, judgeOpenCollapse,
  DEFAULT_COMPLAINT_THRESHOLD_PERCENT, DEFAULT_OPEN_DROP_PERCENT,
  OPEN_SETTLE_HOURS, OPEN_RECENT_SENDS, OPEN_BASELINE_SENDS,
  type ComplaintJudgement, type OpenJudgement, type OpenSample,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Stop a campaign that recipients are reporting, or that has gone quiet
   in a way that means spam folder.

   See shared/signal-guard for how each is judged. This is the half that
   reads the numbers and acts, following the bounce guard: settings read
   briefly memoised and never throwing, the pause conditioned on 'running',
   the reason written on the campaign and campaign.paused raised so the
   owner is told (shared/notify, "Campaign alerts").

     · Complaints are checked the moment one is recorded (complaint-intake),
       because each one is the evidence changing.
     · The open rate is checked by a sweep (jobs/campaign-guard), because
       its evidence is the absence of an event - nothing happens at the
       moment a send goes unopened.

   Both count only from `guard_since` when it is set (091): resuming a
   campaign one of these paused is the user saying they dealt with it, and
   judging it again on the very evidence it was paused for would pause it
   again on the next tick.
   ═══════════════════════════════════════════════════════════════════════ */

interface SignalSettings {
  complaintEnabled: boolean;
  complaintThreshold: number;
  openEnabled: boolean;
  openDrop: number;
}

const DEFAULTS: SignalSettings = {
  complaintEnabled: true,
  complaintThreshold: DEFAULT_COMPLAINT_THRESHOLD_PERCENT,
  openEnabled: true,
  openDrop: DEFAULT_OPEN_DROP_PERCENT,
};

const cache = new Map<string, { value: SignalSettings; expires: number }>();
const CACHE_MS = 60_000;

/**
 * The account's guard settings. A database without 091 has none of the
 * columns, and that reads as the protective defaults, not as "switched off" -
 * the same choice the bounce guard makes for a database without 045.
 */
async function signalSettings(userId: string): Promise<SignalSettings> {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value = DEFAULTS;
  try {
    const { data, error } = await supabaseAdmin
      .from('user_settings')
      .select('complaint_guard_enabled, complaint_guard_threshold, open_guard_enabled, open_guard_drop')
      .eq('user_id', userId)
      .maybeSingle();
    if (!error && data) {
      const d = data as any;
      value = {
        complaintEnabled: d.complaint_guard_enabled !== false,
        complaintThreshold: Number(d.complaint_guard_threshold) > 0 ? Number(d.complaint_guard_threshold) : DEFAULTS.complaintThreshold,
        openEnabled: d.open_guard_enabled !== false,
        openDrop: Number(d.open_guard_drop) > 0 ? Number(d.open_guard_drop) : DEFAULTS.openDrop,
      };
    }
  } catch {
    // Fall through with the protective defaults.
  }
  cache.set(userId, { value, expires: Date.now() + CACHE_MS });
  return value;
}

/** Drop a user's memoised settings after they change them. */
export function invalidateSignalGuardSettings(userId: string): void {
  cache.delete(userId);
}

/** The campaign, read with `*` so a database without guard_since still answers. */
async function campaignRow(campaignId: string): Promise<any | null> {
  const { data } = await supabaseAdmin.from('campaigns').select('*').eq('id', campaignId).maybeSingle();
  return data || null;
}

/* ── Spam complaints ─────────────────────────────────────────────────── */

export async function assessComplaints(userId: string, campaign: any): Promise<ComplaintJudgement> {
  const { complaintThreshold } = await signalSettings(userId);
  const since: string | null = campaign?.guard_since || null;
  const count = (type: string) => {
    let q = supabaseAdmin.from('campaign_activities')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id).eq('activity_type', type);
    if (since) q = q.gte('occurred_at', since);
    return q;
  };
  const [{ count: sent }, { count: complaints }] = await Promise.all([count('sent'), count('complained')]);
  return judgeComplaints(sent || 0, complaints || 0, complaintThreshold);
}

/**
 * Check a campaign after a spam complaint and stop it if they are adding up.
 * Never throws: a failure here must not lose the complaint itself.
 */
export async function guardAfterComplaint(userId: string, campaignId: string): Promise<ComplaintJudgement | null> {
  try {
    const { complaintEnabled } = await signalSettings(userId);
    if (!complaintEnabled) return null;
    const campaign = await campaignRow(campaignId);
    if (!campaign || campaign.status !== 'running') return null;

    const verdict = await assessComplaints(userId, campaign);
    if (!verdict.trip) return verdict;

    const paused = await autoPause(
      userId,
      campaignId,
      'complaint_rate',
      `Paused automatically: ${verdict.note} Mailbox providers start filtering a sender whose mail is reported this often.`,
      {
        sent: verdict.sent,
        complaints: verdict.complaints,
        complaint_rate: Math.round(verdict.rate * 10000) / 100,
        threshold_percent: verdict.thresholdPercent,
      },
    );
    if (paused) {
      console.warn(`[SignalGuard] Paused campaign ${campaignId} - ${verdict.complaints}/${verdict.sent} complaints (limit ${verdict.thresholdPercent}%)`);
    }
    return verdict;
  } catch (err: any) {
    console.error(`[SignalGuard] Complaint check failed for campaign ${campaignId}:`, err?.message || err);
    return null;
  }
}

/* ── Open-rate collapse ──────────────────────────────────────────────── */

/**
 * The settled sends, newest first, each marked opened or not.
 *
 * Bounded on purpose: at most RECENT + BASELINE sends and their opens, so a
 * fifty-thousand-send campaign costs the sweep what a thousand-send one does.
 * An open is matched to the send it answers by enrolment and step, and only
 * 'opened' counts - privacy-proxy and scanner hits are filed as
 * 'machine_open' by the tracker and are not a person reading anything.
 */
async function settledSends(campaignId: string): Promise<Array<OpenSample & { at: string }>> {
  const settled = new Date(Date.now() - OPEN_SETTLE_HOURS * 3_600_000).toISOString();
  const { data: sends, error } = await supabaseAdmin
    .from('campaign_activities')
    .select('campaign_contact_id, step_id, occurred_at')
    .eq('campaign_id', campaignId)
    .eq('activity_type', 'sent')
    .lte('occurred_at', settled)
    .order('occurred_at', { ascending: false })
    .limit(OPEN_RECENT_SENDS + OPEN_BASELINE_SENDS);
  if (error) throw new Error(error.message);
  const rows = (sends || []) as Array<{ campaign_contact_id: string | null; step_id: string | null; occurred_at: string }>;

  const ccIds = [...new Set(rows.map((r) => r.campaign_contact_id).filter(Boolean))] as string[];
  const opened = new Set<string>();
  for (const ids of chunk(ccIds)) {
    const { data: opens, error: openErr } = await supabaseAdmin
      .from('campaign_activities')
      .select('campaign_contact_id, step_id')
      .eq('campaign_id', campaignId)
      .eq('activity_type', 'opened')
      .in('campaign_contact_id', ids);
    if (openErr) throw new Error(openErr.message);
    for (const o of opens || []) opened.add(`${(o as any).campaign_contact_id}:${(o as any).step_id || ''}`);
  }

  return rows.map((r) => ({
    step_id: r.step_id,
    at: r.occurred_at,
    opened: opened.has(`${r.campaign_contact_id}:${r.step_id || ''}`)
      // An open recorded without its step still belongs to this person.
      || opened.has(`${r.campaign_contact_id}:`),
  }));
}

export async function assessOpens(userId: string, campaign: any): Promise<OpenJudgement | null> {
  // No pixel, no opens: silence then means nothing at all.
  if (campaign?.track_opens === false) return null;
  const { openDrop } = await signalSettings(userId);
  const sends = await settledSends(campaign.id);
  const since = campaign?.guard_since ? Date.parse(campaign.guard_since) : null;
  const eligible = since ? sends.filter((s) => Date.parse(s.at) >= since) : sends;
  const recent = eligible.slice(0, OPEN_RECENT_SENDS);
  const baseline = sends.slice(sends.indexOf(recent[recent.length - 1]) + 1);
  return judgeOpenCollapse(recent, recent.length ? baseline : [], openDrop);
}

/** Check one campaign's opens and stop it if they have fallen off a cliff. Never throws. */
export async function guardOpens(userId: string, campaignId: string): Promise<OpenJudgement | null> {
  try {
    const { openEnabled } = await signalSettings(userId);
    if (!openEnabled) return null;
    const campaign = await campaignRow(campaignId);
    if (!campaign || campaign.status !== 'running') return null;
    const verdict = await assessOpens(userId, campaign);
    if (!verdict?.trip) return verdict;

    const paused = await autoPause(
      userId,
      campaignId,
      'open_collapse',
      `Paused automatically: ${verdict.note} A fall that sudden usually means mail has started landing in spam.`,
      {
        recent_sends: verdict.recentSends,
        recent_rate: Math.round(verdict.recentRate * 1000) / 10,
        baseline_rate: Math.round(verdict.expectedRate * 1000) / 10,
        drop_percent: verdict.dropPercent,
      },
    );
    if (paused) {
      console.warn(`[SignalGuard] Paused campaign ${campaignId} - opens ${(verdict.recentRate * 100).toFixed(1)}% vs ${(verdict.expectedRate * 100).toFixed(1)}% expected`);
    }
    return verdict;
  } catch (err: any) {
    console.error(`[SignalGuard] Open check failed for campaign ${campaignId}:`, err?.message || err);
    return null;
  }
}

/** Every running campaign with opens tracked. Cross-tenant: the scheduler's, never a route's. */
export async function runOpenGuardSweep(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, user_id, track_opens')
    .eq('status', 'running');
  if (error) throw new Error(error.message);
  let paused = 0;
  for (const c of (data || []) as Array<{ id: string; user_id: string; track_opens: boolean | null }>) {
    if (c.track_opens === false) continue;
    const verdict = await guardOpens(c.user_id, c.id);
    if (verdict?.trip) paused++;
  }
  return paused;
}

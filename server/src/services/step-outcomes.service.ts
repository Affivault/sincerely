/* ═══════════════════════════════════════════════════════════════════════
   Which step - and which version of it - produces meetings and money.

   The step table answers "which step gets replies", and the A/B panel
   judges subject lines on opens. Neither is the question: an email can be
   opened by everyone and book nobody. This credits each interested or
   meeting reply to the last email the person received before writing, and
   each won deal to the step recorded on it, then reports both per hundred
   emails sent - for each step and, where a step is split, for each arm.

   When one arm books meetings at a clearly better rate, it says so, with
   the number of people still to receive that step, and the page offers
   the switch.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { readVariant, twoProportionPValue, dealValue, type StepOutcomes, type StepOutcomeRow } from '@lemlist/shared';
import { fetchAllPages } from '../utils/batch.js';

const POSITIVE = ['interested', 'meeting'];
/** Sends per arm before a meeting-rate comparison is worth making. */
const MIN_ARM = 50;
/** Looser than the open-rate test: meetings are rarer, and this only suggests. */
const ALPHA = 0.1;

export async function stepOutcomes(userId: string, campaignId: string): Promise<StepOutcomes> {
  const { data: campaign } = await supabaseAdmin.from('campaigns')
    .select('id, user_id').eq('id', campaignId).maybeSingle();
  if (!campaign || campaign.user_id !== userId) throw new AppError('Campaign not found', 404);

  const { data: steps, error: sErr } = await supabaseAdmin.from('campaign_steps')
    .select('id, step_order, step_type, subject, subject_b, body_html_b')
    .eq('campaign_id', campaignId).order('step_order', { ascending: true });
  if (sErr) throw new AppError(sErr.message, 500);
  const emailSteps = (steps || []).filter((s: any) => !s.step_type || s.step_type === 'email');

  const sends = await fetchAllPages<{ contact_id: string; step_id: string | null; occurred_at: string; metadata: any }>(
    async (from, to) => await supabaseAdmin.from('campaign_activities')
      .select('contact_id, step_id, occurred_at, metadata')
      .eq('campaign_id', campaignId).eq('activity_type', 'sent')
      .range(from, to),
  );

  const positives = await fetchAllPages<{ contact_id: string | null; received_at: string }>(
    async (from, to) => await supabaseAdmin.from('inbox_messages')
      .select('contact_id, received_at')
      .eq('user_id', userId).eq('campaign_id', campaignId).in('sara_intent', POSITIVE)
      .range(from, to),
  );

  const { data: deals, error: dErr } = await supabaseAdmin.from('deals')
    .select('id, stage, value, recurring_amount, recurring_period, one_off_amount, term_months, contact_id, source_step_id')
    .eq('user_id', userId).eq('source_campaign_id', campaignId);
  if (dErr) throw new AppError(dErr.message, 500);

  // Per step and arm: sends; and each contact's sends in time order, to credit replies.
  type Arm = { sent: number; positive: number; won: number; won_value: number };
  const blank = (): Arm => ({ sent: 0, positive: 0, won: 0, won_value: 0 });
  const byStep = new Map<string, { all: Arm; a: Arm; b: Arm }>();
  for (const s of emailSteps) byStep.set(s.id, { all: blank(), a: blank(), b: blank() });
  const timeline = new Map<string, { at: number; step: string; variant: 'a' | 'b' | null }[]>();
  const variantOf = new Map<string, 'a' | 'b' | null>();
  for (const s of sends) {
    if (!s.step_id || !byStep.has(s.step_id)) continue;
    const v = readVariant(s.metadata);
    const row = byStep.get(s.step_id)!;
    row.all.sent++;
    if (v) row[v].sent++;
    variantOf.set(`${s.contact_id}:${s.step_id}`, v);
    const at = Date.parse(s.occurred_at);
    if (Number.isFinite(at)) timeline.set(s.contact_id, [...(timeline.get(s.contact_id) || []), { at, step: s.step_id, variant: v }]);
  }
  for (const list of timeline.values()) list.sort((x, y) => x.at - y.at);

  // One positive reply per person, credited to the email just before it.
  const credited = new Set<string>();
  for (const p of positives.sort((x, y) => x.received_at.localeCompare(y.received_at))) {
    if (!p.contact_id || credited.has(p.contact_id)) continue;
    const at = Date.parse(p.received_at);
    const before = (timeline.get(p.contact_id) || []).filter((e) => e.at <= at);
    const last = before[before.length - 1];
    if (!last) continue;
    credited.add(p.contact_id);
    const row = byStep.get(last.step)!;
    row.all.positive++;
    if (last.variant) row[last.variant].positive++;
  }

  for (const d of deals || []) {
    if (d.stage !== 'won' || !d.source_step_id || !byStep.has(d.source_step_id)) continue;
    const row = byStep.get(d.source_step_id)!;
    const value = dealValue(d as any);
    row.all.won++; row.all.won_value += value;
    const v = d.contact_id ? variantOf.get(`${d.contact_id}:${d.source_step_id}`) : null;
    if (v) { row[v].won++; row[v].won_value += value; }
  }

  /*
   * How many people are still to receive a step, for "send it to the
   * remaining N". A head count rather than reading the rows: a select is
   * capped at 1,000, which made every big campaign "the remaining 1,000".
   */
  const stillToReceive = async (stepOrder: number) => {
    const { count, error } = await supabaseAdmin.from('campaign_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId).in('status', ['pending', 'active'])
      .lte('current_step_order', stepOrder);
    if (error) throw new AppError(error.message, 500);
    return count || 0;
  };

  const per100 = (x: number, n: number) => (n > 0 ? (x / n) * 100 : 0);
  const rows: StepOutcomeRow[] = emailSteps.map((s: any) => {
    const r = byStep.get(s.id)!;
    const split = !!(s.subject_b || s.body_html_b);
    let suggestion: StepOutcomeRow['suggestion'] = null;
    if (split && r.a.sent >= MIN_ARM && r.b.sent >= MIN_ARM) {
      const p = twoProportionPValue(r.a.positive, r.a.sent, r.b.positive, r.b.sent);
      const aRate = r.a.positive / r.a.sent;
      const bRate = r.b.positive / r.b.sent;
      if (p !== null && p < ALPHA && aRate !== bRate) {
        const better: 'a' | 'b' = bRate > aRate ? 'b' : 'a';
        const lead = `Version ${better.toUpperCase()} books ${per100(better === 'b' ? r.b.positive : r.a.positive, better === 'b' ? r.b.sent : r.a.sent).toFixed(1)} meetings per 100 against ${per100(better === 'b' ? r.a.positive : r.b.positive, better === 'b' ? r.a.sent : r.b.sent).toFixed(1)}.`;
        suggestion = { variant: better, remaining: 0, text: lead };
      }
    }
    const arm = (x: Arm) => ({ ...x, meetings_per_100: per100(x.positive, x.sent), revenue_per_100: per100(x.won_value, x.sent) });
    return {
      step_id: s.id,
      step_order: s.step_order,
      subject: s.subject || `Step ${s.step_order}`,
      subject_b: split ? (s.subject_b || null) : null,
      split,
      ...arm(r.all),
      a: split ? arm(r.a) : null,
      b: split ? arm(r.b) : null,
      suggestion,
    };
  });

  // Only the steps that earned a suggestion pay for a count.
  await Promise.all(rows.filter((r) => r.suggestion).map(async (r) => {
    const remaining = await stillToReceive(r.step_order);
    r.suggestion = { ...r.suggestion!, remaining, text: `${r.suggestion!.text} Send it to the remaining ${remaining.toLocaleString()}?` };
  }));

  const best = rows.filter((r) => r.sent >= 25).sort((x, y) => y.meetings_per_100 - x.meetings_per_100)[0];
  return {
    steps: rows,
    total_positive: rows.reduce((n, r) => n + r.positive, 0),
    headline: !best || best.positive === 0
      ? 'No interested replies credited to a step yet.'
      : `Step ${best.step_order} books the most meetings: ${best.meetings_per_100.toFixed(1)} per 100 emails.`,
  };
}

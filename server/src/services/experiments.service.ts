/* ═══════════════════════════════════════════════════════════════════════
   Campaigns that improve themselves - the engine.

   The rules (what to test, when a test is over, what is allowed to
   change) are in shared/experiments. This keeps one campaign's loop
   going, hourly, for every campaign whose owner switched it on:

     nothing live   pick the email, have Relay write one challenger,
                    check it, and propose it - or start it at once when
                    the campaign runs tests without asking
     proposed       wait for Approve / Edit / Skip
     running        count each version's sends and replies since the test
                    began; when it is decided, make the winner the email
                    (or keep the original) and say so in a sentence

   Tests ride the A/B split the builder already uses: the challenger is
   written into subject_b / body_html_b, the sender splits on it and
   records which version each person got, and replies are credited to the
   version that person received. Opens are never read.

   Stored in campaign_experiments (migration 082).
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  IMPROVE, judge, experimentSummary, nextElement, challengerProblems, readVariant,
  type Experiment, type ExperimentStatus, type ImproveElement, type ImproveStatus, type ArmNumbers,
} from '@lemlist/shared';
import { aiAvailable, writeChallenger } from './ai.service.js';
import { settingsService } from './settings.service.js';
import { fireEvent } from './webhook.service.js';
import { htmlToText } from './sequence.service.js';
import { stripQuoted } from '../utils/mail-kind.js';

const DAY = 86_400_000;
/** After a skip, wait before proposing again; after a result, a little less. */
const COOLDOWN_AFTER_SKIP_MS = 3 * DAY;
const COOLDOWN_AFTER_RESULT_MS = 1 * DAY;

let tableMissing = false;
const missing = (m: string) => /campaign_experiments|relay_improve/.test(m);

function toExperiment(r: any): Experiment {
  return {
    id: r.id, campaign_id: r.campaign_id, step_id: r.step_id, email_number: r.email_number,
    element: r.element, status: r.status, why: r.why || '',
    original: r.original || { subject: null, body_html: null },
    challenger: r.challenger || { subject: null, body_html: null },
    a: { sent: r.a_sent || 0, replies: r.a_replies || 0 },
    b: { sent: r.b_sent || 0, replies: r.b_replies || 0 },
    probability_b_better: r.probability_b_better == null ? null : Number(r.probability_b_better),
    summary: r.summary, created_at: r.created_at, started_at: r.started_at, decided_at: r.decided_at,
  };
}

async function ownCampaign(userId: string, campaignId: string) {
  const { data, error } = await supabaseAdmin
    .from('campaigns').select('id, user_id, name, status, relay_improve, relay_improve_auto')
    .eq('id', campaignId).eq('user_id', userId).maybeSingle();
  if (error) {
    if (missing(error.message)) throw new AppError('Run migration 082 to let Relay improve campaigns.', 409);
    throw new AppError(error.message, 500);
  }
  if (!data) throw new AppError('Campaign not found', 404);
  return data as any;
}

async function emailSteps(campaignId: string) {
  const { data } = await supabaseAdmin
    .from('campaign_steps')
    .select('id, step_order, step_type, subject, subject_b, body_html, body_html_b')
    .eq('campaign_id', campaignId)
    .order('step_order', { ascending: true });
  return ((data || []) as any[]).filter((s) => (s.step_type || 'email') === 'email');
}

/** Each version's sends and replies on one email since the test began. */
async function armNumbers(campaignId: string, stepId: string, since: string): Promise<{ a: ArmNumbers; b: ArmNumbers }> {
  const variantOf = new Map<string, 'a' | 'b'>();
  const a: ArmNumbers = { sent: 0, replies: 0 }; const b: ArmNumbers = { sent: 0, replies: 0 };
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('campaign_activities').select('contact_id, metadata')
      .eq('campaign_id', campaignId).eq('step_id', stepId).eq('activity_type', 'sent')
      .gte('occurred_at', since).range(from, from + 999);
    if (error) throw new Error(`experiment sends: ${error.message}`);
    for (const r of data || []) {
      const v = readVariant((r as any).metadata);
      if (!v || variantOf.has((r as any).contact_id)) continue;
      variantOf.set((r as any).contact_id, v);
      (v === 'a' ? a : b).sent++;
    }
    if (!data || data.length < 1000) break;
  }
  const { data: replies } = await supabaseAdmin
    .from('campaign_activities').select('contact_id')
    .eq('campaign_id', campaignId).eq('step_id', stepId).eq('activity_type', 'replied')
    .gte('occurred_at', since).limit(20_000);
  const counted = new Set<string>();
  for (const r of replies || []) {
    const c = (r as any).contact_id; const v = variantOf.get(c);
    if (!v || counted.has(c)) continue;
    counted.add(c);
    (v === 'a' ? a : b).replies++;
  }
  return { a, b };
}

/** People who will still receive this email. */
async function remainingFor(campaignId: string, stepOrder: number): Promise<number> {
  const { count } = await supabaseAdmin
    .from('campaign_contacts').select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId).in('status', ['pending', 'active']).lte('current_step_order', stepOrder);
  return count || 0;
}

async function history(campaignId: string): Promise<Experiment[]> {
  const { data, error } = await supabaseAdmin
    .from('campaign_experiments').select('*').eq('campaign_id', campaignId)
    .order('created_at', { ascending: false }).limit(30);
  if (error) {
    if (missing(error.message)) { tableMissing = true; return []; }
    throw new AppError(error.message, 500);
  }
  return (data || []).map(toExperiment);
}

async function setStatus(id: string, patch: Record<string, unknown>, onlyFrom: ExperimentStatus[]): Promise<boolean> {
  const { data } = await supabaseAdmin.from('campaign_experiments').update(patch).eq('id', id).in('status', onlyFrom).select('id');
  return !!data?.length;
}

/** Put the challenger into the A/B slot of its email. */
async function writeIntoStep(e: Experiment): Promise<void> {
  const patch = e.element === 'subject'
    ? { subject_b: e.challenger.subject, body_html_b: null }
    : { body_html_b: e.challenger.body_html, subject_b: null };
  const { error } = await supabaseAdmin.from('campaign_steps').update(patch).eq('id', e.step_id).eq('campaign_id', e.campaign_id);
  if (error) throw new AppError(error.message, 500);
}

async function clearStep(e: Experiment): Promise<void> {
  await supabaseAdmin.from('campaign_steps').update({ subject_b: null, body_html_b: null }).eq('id', e.step_id).eq('campaign_id', e.campaign_id);
}

/** Is the email still the one the test was set up on? A person editing it mid-test ends the test. */
async function stepUnchanged(e: Experiment): Promise<boolean> {
  const { data: s } = await supabaseAdmin.from('campaign_steps').select('subject, body_html, subject_b, body_html_b').eq('id', e.step_id).maybeSingle();
  if (!s) return false;
  const st = s as any;
  const same = (x: string | null, y: string | null) => (x || '').trim() === (y || '').trim();
  if (e.element === 'subject') return same(st.subject_b, e.challenger.subject) && same(st.subject, e.original.subject);
  return same(st.body_html_b, e.challenger.body_html) && same(st.body_html, e.original.body_html);
}

async function start(userId: string, e: Experiment, campaignName: string): Promise<void> {
  await writeIntoStep(e);
  const ok = await setStatus(e.id, { status: 'running', started_at: new Date().toISOString() }, ['proposed']);
  if (!ok) { await clearStep(e); return; }
  fireEvent(userId, 'relay.test_started', { campaign_id: e.campaign_id, campaign_name: campaignName, element: e.element, email_number: e.email_number, why: e.why }).catch(() => {});
}

async function decide(userId: string, e: Experiment, campaignName: string): Promise<Experiment> {
  if (!(await stepUnchanged(e))) {
    await setStatus(e.id, { status: 'stopped', decided_at: new Date().toISOString(), summary: 'Stopped: the email was edited while the test was running.' }, ['running']);
    await clearStep(e);
    return { ...e, status: 'stopped' };
  }
  const { a, b } = await armNumbers(e.campaign_id, e.step_id, e.started_at!);
  const v = judge(a, b, e.started_at);
  const live = { a_sent: a.sent, a_replies: a.replies, b_sent: b.sent, b_replies: b.replies, probability_b_better: Math.round(v.probability * 1000) / 1000 };
  if (!v.decided) {
    await supabaseAdmin.from('campaign_experiments').update(live).eq('id', e.id).eq('status', 'running');
    return { ...e, a, b, probability_b_better: v.probability };
  }
  const summary = experimentSummary(e, a, b, v.outcome, v.reason);
  const ok = await setStatus(e.id, { ...live, status: v.outcome, decided_at: new Date().toISOString(), summary }, ['running']);
  if (!ok) return e;
  if (v.outcome === 'won') {
    const patch = e.element === 'subject'
      ? { subject: e.challenger.subject, subject_b: null, body_html_b: null }
      : { body_html: e.challenger.body_html, body_text: htmlToText(e.challenger.body_html || ''), subject_b: null, body_html_b: null };
    await supabaseAdmin.from('campaign_steps')
      .update({ ...patch, ab_promoted_variant: 'b', ab_promoted_at: new Date().toISOString() })
      .eq('id', e.step_id).eq('campaign_id', e.campaign_id);
  } else {
    await clearStep(e);
  }
  fireEvent(userId, 'relay.test_decided', { campaign_id: e.campaign_id, campaign_name: campaignName, outcome: v.outcome, summary }).catch(() => {});
  return { ...e, status: v.outcome, a, b, summary };
}

/** Write one challenger for the email that most deserves it. Null when there is nothing worth testing. */
async function propose(userId: string, campaign: any, past: Experiment[]): Promise<Experiment | null> {
  const steps = await emailSteps(campaign.id);
  if (!steps.length) return null;
  const ours = new Set(past.filter((x) => x.status === 'running').map((x) => x.step_id));

  let best: { step: any; emailNumber: number; remaining: number } | null = null;
  for (const [i, s] of steps.entries()) {
    // A test the person set up by hand is theirs; never written over.
    if ((s.subject_b || s.body_html_b) && !ours.has(s.id)) continue;
    if (!(s.body_html || '').trim()) continue;
    const remaining = await remainingFor(campaign.id, s.step_order);
    if (remaining >= IMPROVE.MIN_REMAINING && (!best || remaining > best.remaining)) best = { step: s, emailNumber: i + 1, remaining };
  }
  if (!best) return null;

  const tried = past.filter((x) => x.step_id === best!.step.id).map((x) => x.element as ImproveElement).reverse();
  const element = nextElement(best.emailNumber, tried);
  const settings = await settingsService.get(userId).catch(() => null);
  const { data: replies } = await supabaseAdmin
    .from('inbox_messages').select('sara_intent, relay_summary, body_text')
    .eq('user_id', userId).eq('campaign_id', campaign.id).eq('direction', 'inbound')
    .order('received_at', { ascending: false }).limit(25);
  const original = { subject: best.step.subject || null, body_html: best.step.body_html || null };

  let written: Awaited<ReturnType<typeof writeChallenger>> = null;
  for (let attempt = 0; attempt < 2 && !written; attempt++) {
    const draft = await writeChallenger({
      element, emailNumber: best.emailNumber, subject: original.subject, bodyHtml: original.body_html,
      offer: (settings as any)?.relay_offer || '', tone: (settings as any)?.relay_tone || 'friendly',
      replies: (replies || []).map((r: any) => ({ intent: r.sara_intent, text: r.relay_summary || stripQuoted(r.body_text || '').text })),
      learned: past.filter((x) => x.summary).map((x) => x.summary!),
    });
    if (!draft) break;
    const challenger = { subject: draft.subject, body_html: draft.body_html };
    const problems = challengerProblems(original, challenger, element);
    if (problems.length === 0) written = draft;
    else console.warn(`[Improve] ${campaign.id}: challenger rejected (${problems.join(' ')})`);
  }
  if (!written) return null;

  const { data, error } = await supabaseAdmin.from('campaign_experiments').insert({
    user_id: userId, campaign_id: campaign.id, step_id: best.step.id, email_number: best.emailNumber,
    element, status: 'proposed', why: written.why, original,
    challenger: { subject: written.subject, body_html: written.body_html },
  }).select('*').single();
  if (error) {
    // The one-live-test index: another server proposed first.
    if (/idx_campaign_experiments_one_live|duplicate key/.test(error.message)) return null;
    throw new Error(error.message);
  }
  const e = toExperiment(data);
  if (campaign.relay_improve_auto) await start(userId, e, campaign.name);
  else fireEvent(userId, 'relay.test_proposed', { campaign_id: campaign.id, campaign_name: campaign.name, element, email_number: e.email_number, why: e.why }).catch(() => {});
  return e;
}

/** One campaign's turn of the loop. */
async function step(userId: string, campaign: any): Promise<void> {
  const past = await history(campaign.id);
  const live = past.find((x) => x.status === 'running' || x.status === 'proposed');
  if (live?.status === 'running') { await decide(userId, live, campaign.name); return; }
  if (live) return; // waiting on the person
  if (campaign.status !== 'running' || !aiAvailable()) return;
  const last = past[0];
  if (last?.decided_at) {
    const wait = last.status === 'skipped' ? COOLDOWN_AFTER_SKIP_MS : COOLDOWN_AFTER_RESULT_MS;
    if (Date.now() - Date.parse(last.decided_at) < wait) return;
  }
  await propose(userId, campaign, past);
}

export const experimentsService = {
  async status(userId: string, campaignId: string): Promise<ImproveStatus> {
    let campaign: any;
    try { campaign = await ownCampaign(userId, campaignId); } catch (err: any) {
      if (err?.statusCode === 409) return { enabled: false, auto: false, ai: aiAvailable(), waiting: null, current: null, history: [], ready: false };
      throw err;
    }
    const past = await history(campaignId);
    let current = past.find((x) => x.status === 'running' || x.status === 'proposed') || null;
    if (current?.status === 'running' && current.started_at) {
      const { a, b } = await armNumbers(campaignId, current.step_id, current.started_at);
      current = { ...current, a, b, probability_b_better: judge(a, b, current.started_at).probability };
    }
    let waiting: string | null = null;
    if (campaign.relay_improve && !current) {
      if (!aiAvailable()) waiting = 'Relay needs Claude to write new versions. Add ANTHROPIC_API_KEY on the server.';
      else if (campaign.status !== 'running') waiting = 'Relay starts once the campaign is running.';
      else {
        const steps = await emailSteps(campaignId);
        const counts = await Promise.all(steps.map((s) => remainingFor(campaignId, s.step_order)));
        const most = Math.max(0, ...counts);
        waiting = most < IMPROVE.MIN_REMAINING
          ? `Not enough people left to learn from: the most any email still has to go to is ${most.toLocaleString('en-GB')}, and a fair test needs ${IMPROVE.MIN_REMAINING}.`
          : 'Relay is writing the next version to test. It appears here within the hour.';
      }
    }
    return {
      enabled: !!campaign.relay_improve, auto: !!campaign.relay_improve_auto, ai: aiAvailable(),
      waiting, current, history: past.filter((x) => x !== current && x.id !== current?.id), ready: !tableMissing,
    };
  },

  async configure(userId: string, campaignId: string, patch: { enabled?: boolean; auto?: boolean }): Promise<ImproveStatus> {
    const campaign = await ownCampaign(userId, campaignId);
    const update: Record<string, boolean> = {};
    if (typeof patch.enabled === 'boolean') update.relay_improve = patch.enabled;
    if (typeof patch.auto === 'boolean') update.relay_improve_auto = patch.auto;
    if (Object.keys(update).length) {
      const { error } = await supabaseAdmin.from('campaigns').update(update).eq('id', campaignId).eq('user_id', userId);
      if (error) throw new AppError(error.message, 500);
    }
    // Switching it off ends a live test and leaves the original in place.
    if (patch.enabled === false) {
      const live = (await history(campaignId)).find((x) => x.status === 'running' || x.status === 'proposed');
      if (live) await this.stop(userId, live.id);
    }
    if (patch.enabled === true) {
      // Propose now, not on the next hourly turn.
      step(userId, { ...campaign, ...update }).catch((e) => console.warn(`[Improve] ${campaignId}: ${e?.message || e}`));
    }
    return this.status(userId, campaignId);
  },

  /** Approve a proposed test, optionally with the person's own wording. */
  async approve(userId: string, id: string, edits?: { subject?: string | null; body_html?: string | null }): Promise<void> {
    const { data } = await supabaseAdmin.from('campaign_experiments').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (!data) throw new AppError('Test not found', 404);
    let e = toExperiment(data);
    if (e.status !== 'proposed') throw new AppError('This test has already been decided.', 409);
    if (edits) {
      const challenger = e.element === 'subject'
        ? { subject: (edits.subject ?? e.challenger.subject)?.trim() || null, body_html: null }
        : { subject: null, body_html: (edits.body_html ?? e.challenger.body_html)?.trim() || null };
      if (e.element === 'subject' ? !challenger.subject : !challenger.body_html) throw new AppError('The new version cannot be empty.', 400);
      await supabaseAdmin.from('campaign_experiments').update({ challenger }).eq('id', id);
      e = { ...e, challenger };
    }
    const campaign = await ownCampaign(userId, e.campaign_id);
    await start(userId, e, campaign.name);
  },

  /** Skip a proposal, or end a running test with the original in place. */
  async stop(userId: string, id: string): Promise<void> {
    const { data } = await supabaseAdmin.from('campaign_experiments').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (!data) throw new AppError('Test not found', 404);
    const e = toExperiment(data);
    const now = new Date().toISOString();
    if (e.status === 'proposed') { await setStatus(id, { status: 'skipped', decided_at: now }, ['proposed']); return; }
    if (e.status === 'running') {
      if (await setStatus(id, { status: 'stopped', decided_at: now, summary: 'Stopped by hand before there was an answer. The original stays.' }, ['running'])) await clearStep(e);
      return;
    }
    throw new AppError('This test has already been decided.', 409);
  },

  /** Put the original back after a win. Only while the email is still the winning version. */
  async undo(userId: string, id: string): Promise<void> {
    const { data } = await supabaseAdmin.from('campaign_experiments').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
    if (!data) throw new AppError('Test not found', 404);
    const e = toExperiment(data);
    if (e.status !== 'won') throw new AppError('Only a win can be undone.', 409);
    const { data: s } = await supabaseAdmin.from('campaign_steps').select('subject, body_html').eq('id', e.step_id).maybeSingle();
    const current = e.element === 'subject' ? (s as any)?.subject : (s as any)?.body_html;
    const winner = e.element === 'subject' ? e.challenger.subject : e.challenger.body_html;
    if ((current || '').trim() !== (winner || '').trim()) throw new AppError('The email has been changed since, so there is nothing to undo.', 409);
    const patch = e.element === 'subject'
      ? { subject: e.original.subject }
      : { body_html: e.original.body_html, body_text: htmlToText(e.original.body_html || '') };
    await supabaseAdmin.from('campaign_steps').update({ ...patch, ab_promoted_variant: null, ab_promoted_at: null }).eq('id', e.step_id).eq('campaign_id', e.campaign_id);
    await setStatus(id, { status: 'undone' }, ['won']);
  },
};

/** Every campaign that opted in, one turn each. Cross-tenant; scheduler only. */
export async function runImproveSweep(): Promise<{ campaigns: number }> {
  const { data, error } = await supabaseAdmin
    .from('campaigns').select('id, user_id, name, status, relay_improve, relay_improve_auto')
    .eq('relay_improve', true).in('status', ['running', 'paused']).limit(500);
  if (error) {
    if (missing(error.message)) { tableMissing = true; return { campaigns: 0 }; }
    throw new Error(`improve campaigns: ${error.message}`);
  }
  tableMissing = false;
  for (const c of data || []) {
    try { await step((c as any).user_id, c); } catch (err: any) {
      console.error(`[Improve] ${(c as any).id}: ${err?.message || err}`);
    }
  }
  return { campaigns: (data || []).length };
}

/** Results decided in a window, for the weekly digest. */
export async function learnedSince(userId: string, sinceIso: string): Promise<string[]> {
  if (tableMissing) return [];
  const { data, error } = await supabaseAdmin
    .from('campaign_experiments').select('summary, campaigns!inner(name)')
    .eq('user_id', userId).in('status', ['won', 'kept']).gte('decided_at', sinceIso)
    .order('decided_at', { ascending: false }).limit(6);
  if (error) return [];
  return (data || []).filter((r: any) => r.summary).map((r: any) => `${r.campaigns?.name}: ${r.summary}`);
}

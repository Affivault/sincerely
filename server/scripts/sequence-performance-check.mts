/* ═══════════════════════════════════════════════════════════════════════
   "Which step earns the replies" has to survive the shrinking pool.

   The trap this exists to stay out of: a follow-up's reply rate is measured
   over the survivors. Everyone who replied, bounced or unsubscribed has
   already left the sequence, so the pool shrinks at every step and the rate
   flatters whatever comes last. Two replies out of eighteen is 11%, reads as
   the strongest step in the campaign, and is noise.

   Telling somebody to delete a step is advice that costs replies if it is
   wrong, so the assertions here are mostly about restraint: what must NOT be
   called a problem, and where the recommendation must refuse to cut.

   Run: npx tsx scripts/sequence-performance-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'check';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'check';
process.env.TRACKING_SECRET ||= 'check-secret-at-least-16';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.STRIPE_SECRET_KEY ||= '';

const { supabaseAdmin } = await import('../src/config/supabase.js');

const USER = '00000000-0000-0000-0000-000000000001';
const CAMPAIGN = '00000000-0000-0000-0000-0000000000c1';
const HOUR = 3_600_000;

interface Activity {
  contact_id: string;
  step_id: string | null;
  activity_type: string;
  occurred_at: string;
}

interface World {
  campaigns: any[];
  campaign_steps: any[];
  campaign_activities: Activity[];
}

let world: World;

/**
 * One step's worth of traffic.
 *
 * `sent` contacts are numbered per step so the same person can appear at
 * several steps, which is what a real sequence looks like — and what makes
 * the pool shrink.
 */
function traffic(stepId: string, opts: { sent: number; replied?: number; bounced?: number; unsubscribed?: number; opened?: number; replyAfterHours?: number }) {
  const rows: Activity[] = [];
  const base = Date.parse('2026-08-01T09:00:00Z');
  for (let i = 0; i < opts.sent; i++) {
    const contact = `${stepId}-c${i}`;
    rows.push({ contact_id: contact, step_id: stepId, activity_type: 'sent', occurred_at: new Date(base).toISOString() });
    if (i < (opts.opened ?? 0)) {
      rows.push({ contact_id: contact, step_id: stepId, activity_type: 'opened', occurred_at: new Date(base + HOUR).toISOString() });
    }
    if (i < (opts.replied ?? 0)) {
      rows.push({
        contact_id: contact, step_id: stepId, activity_type: 'replied',
        occurred_at: new Date(base + (opts.replyAfterHours ?? 5) * HOUR).toISOString(),
      });
    }
    if (i >= opts.sent - (opts.bounced ?? 0)) {
      rows.push({ contact_id: contact, step_id: stepId, activity_type: 'bounced', occurred_at: new Date(base).toISOString() });
    }
    if (i >= opts.sent - (opts.unsubscribed ?? 0)) {
      rows.push({ contact_id: contact, step_id: stepId, activity_type: 'unsubscribed', occurred_at: new Date(base + 2 * HOUR).toISOString() });
    }
  }
  return rows;
}

function step(order: number, over: Partial<any> = {}) {
  return { id: `s${order}`, campaign_id: CAMPAIGN, step_order: order, subject: `Step ${order}`, delay_days: order === 1 ? 0 : 3, step_type: 'email', ...over };
}

function stub(table: string): any {
  let single = false;
  const eqs: [string, any][] = [];
  let from = 0;
  let to = 999;

  const resolve = () => {
    let out: any[] = (world as any)[table] ?? [];
    for (const [col, value] of eqs) out = out.filter((r) => !(col in r) || r[col] === value);
    if (single) {
      return out[0] ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    }
    return { data: out.slice(from, to + 1), error: null };
  };

  const chain: any = new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return chain; };
      if (prop === 'eq') return (col: string, value: any) => { eqs.push([col, value]); return chain; };
      if (prop === 'range') return (a: number, b: number) => { from = a; to = b; return chain; };
      if (prop === 'then') return (res: any) => res(resolve());
      return () => chain;
    },
    apply() { return chain; },
  });
  return chain;
}

(supabaseAdmin as any).from = stub;
(supabaseAdmin as any).rpc = () => Promise.resolve({ data: null, error: null });

const { analyticsService } = await import('../src/services/analytics.service.js');

async function report(steps: any[], activities: Activity[]) {
  world = {
    campaigns: [{ id: CAMPAIGN, user_id: USER }],
    campaign_steps: steps,
    campaign_activities: activities,
  };
  return analyticsService.sequencePerformance(USER, CAMPAIGN);
}

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

const verdicts = (r: any) => r.steps.map((s: any) => `${s.step_number}:${s.verdict}`).join(' ');

console.log('\nthe shrinking pool must not flatter the last step');
{
  // Step 1 works. Step 4 reaches a handful of survivors and gets two of them
  // — a higher *rate* than step 1, and a twentieth of the replies.
  const r = await report(
    [step(1), step(2), step(3), step(4)],
    [
      ...traffic('s1', { sent: 800, replied: 48 }),
      ...traffic('s2', { sent: 600, replied: 24 }),
      ...traffic('s3', { sent: 400, replied: 8 }),
      ...traffic('s4', { sent: 18, replied: 2 }),
    ],
  );
  const s1 = r.steps[0];
  const s4 = r.steps[3];
  is('step 4 has the higher raw reply rate', s4.reply_rate > s1.reply_rate,
     `${(s1.reply_rate * 100).toFixed(1)}% vs ${(s4.reply_rate * 100).toFixed(1)}%`);
  is('and step 1 still gets the credit, because share does not shrink',
     s1.share_of_replies > s4.share_of_replies,
     `${s1.share_of_replies.toFixed(3)} vs ${s4.share_of_replies.toFixed(3)}`);
  is('step 4 is not held up as a success on 18 sends', s4.verdict === 'too_early', verdicts(r));
  is('and the recommendation does not cut on that evidence',
     r.recommended_length === null || r.recommended_length === 4, String(r.recommended_length));
}

console.log('\na step that has genuinely stopped working');
{
  const r = await report(
    [step(1), step(2), step(3)],
    [
      ...traffic('s1', { sent: 800, replied: 48 }),
      ...traffic('s2', { sent: 600, replied: 30 }),
      ...traffic('s3', { sent: 500, replied: 0 }),
    ],
  );
  is('500 emails and no replies is called unproductive',
     r.steps[2].verdict === 'unproductive', verdicts(r));
  is('the sequence is recommended to stop at step 2', r.recommended_length === 2, String(r.recommended_length));
  is('and the headline says what it cost', /500/.test(r.headline) && /no replies/.test(r.headline), r.headline);
}

console.log('\nwhere the recommendation must refuse to cut');
{
  // A weak middle step followed by a strong one. Cutting here would delete
  // the step earning a third of the replies.
  const r = await report(
    [step(1), step(2), step(3)],
    [
      ...traffic('s1', { sent: 800, replied: 40 }),
      ...traffic('s2', { sent: 500, replied: 0 }),
      ...traffic('s3', { sent: 400, replied: 24 }),
    ],
  );
  is('the weak step in the middle is still flagged', r.steps[1].verdict === 'unproductive', verdicts(r));
  is('but the sequence is NOT trimmed to it', r.recommended_length === 3, String(r.recommended_length));
}

console.log('\nrestraint on thin evidence');
{
  const r = await report([step(1), step(2)], [
    ...traffic('s1', { sent: 10, replied: 0 }),
    ...traffic('s2', { sent: 4, replied: 0 }),
  ]);
  is('a campaign that has barely started judges nothing',
     r.steps.every((s: any) => s.verdict === 'too_early'), verdicts(r));
  is('and says so instead of recommending a length',
     r.recommended_length === null && /Not enough sends/i.test(r.headline), r.headline);
}
{
  const r = await report([step(1), step(2)], [
    ...traffic('s1', { sent: 400, replied: 0 }),
    ...traffic('s2', { sent: 300, replied: 0 }),
  ]);
  is('with no replies anywhere, no step is blamed',
     r.steps.every((s: any) => s.verdict !== 'unproductive'), verdicts(r));
  is('and the advice is about copy, not trimming',
     r.recommended_length === 2 && /copy/i.test(r.headline), r.headline);
}

console.log('\nthe numbers themselves');
{
  const r = await report([step(1), step(2)], [
    ...traffic('s1', { sent: 200, replied: 20, opened: 90, bounced: 6, unsubscribed: 4, replyAfterHours: 6 }),
    ...traffic('s2', { sent: 100, replied: 5, replyAfterHours: 30 }),
  ]);
  const s1 = r.steps[0];
  is('sent, replied, opened, bounced and unsubscribed all counted',
     s1.sent === 200 && s1.replied === 20 && s1.opened === 90 && s1.bounced === 6 && s1.unsubscribed === 4,
     JSON.stringify({ sent: s1.sent, replied: s1.replied, opened: s1.opened, bounced: s1.bounced, unsub: s1.unsubscribed }));
  is('shares sum to one across the sequence',
     Math.abs(r.steps.reduce((n: number, s: any) => n + s.share_of_replies, 0) - 1) < 1e-9,
     JSON.stringify(r.steps.map((s: any) => s.share_of_replies)));
  is('totals agree with the steps', r.total_sent === 300 && r.total_replied === 25,
     `${r.total_sent}/${r.total_replied}`);
  is('replies per 100 is the rate in the units people budget in',
     Math.abs(s1.replies_per_100 - 10) < 1e-9, String(s1.replies_per_100));
  is('the confident rate is never above the observed one',
     r.steps.every((s: any) => s.confident_reply_rate <= s.reply_rate + 1e-9),
     JSON.stringify(r.steps.map((s: any) => [s.confident_reply_rate, s.reply_rate])));
  is('time to reply is measured from that step, not the campaign start',
     s1.median_hours_to_reply === 6 && r.steps[1].median_hours_to_reply === 30,
     `${s1.median_hours_to_reply} / ${r.steps[1].median_hours_to_reply}`);
}

console.log('\nsteps that cannot earn a reply are not blamed for not earning one');
{
  const r = await report(
    [step(1), step(2, { step_type: 'linkedin' }), step(3)],
    [...traffic('s1', { sent: 400, replied: 24 }), ...traffic('s3', { sent: 300, replied: 12 })],
  );
  is('a LinkedIn step is left out of the email report', r.steps.length === 2,
     JSON.stringify(r.steps.map((s: any) => s.step_number)));
  is('so it cannot be the worst performer', !r.steps.some((s: any) => s.step_number === 2), verdicts(r));
}
{
  const r = await report([step(1, { step_type: 'linkedin' })], []);
  is('a sequence with no email steps says so rather than dividing by zero',
     r.steps.length === 0 && r.total_sent === 0 && /No email steps/i.test(r.headline), r.headline);
}

console.log('\nan out-of-office is not a reply');
{
  const base = traffic('s1', { sent: 200, replied: 10 });
  for (let i = 100; i < 140; i++) {
    base.push({ contact_id: `s1-c${i}`, step_id: 's1', activity_type: 'auto_reply', occurred_at: '2026-08-01T12:00:00Z' });
  }
  const r = await report([step(1)], base);
  is('40 autoresponders do not become 40 replies', r.steps[0].replied === 10, String(r.steps[0].replied));
}

console.log('\npaging, because a real campaign has more than a thousand rows');
{
  const r = await report([step(1), step(2)], [
    ...traffic('s1', { sent: 1200, replied: 60 }),
    ...traffic('s2', { sent: 900, replied: 30 }),
  ]);
  is('nothing is truncated at the 1000-row page boundary',
     r.total_sent === 2100 && r.total_replied === 90, `${r.total_sent}/${r.total_replied}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

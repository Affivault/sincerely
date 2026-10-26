import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { LINKEDIN_WAIT_CONNECTED_MAX_DAYS } from '@lemlist/shared';

/**
 * Columns a client may write on a step. Both add() and update() used to spread
 * the request body straight into Postgres, which meant `campaign_id` was
 * writable — an update could move a step into another campaign, and `id` was
 * open too. Unknown keys are dropped rather than rejected, so a client posting
 * back a whole step still works.
 */
const STEP_KEYS = [
  'step_type', 'step_order', 'subject', 'subject_b', 'body_html', 'body_html_b',
  'body_text', 'delay_days', 'delay_hours', 'delay_minutes', 'skip_if_replied',
  'condition_field', 'condition_operator', 'condition_value',
  'true_branch_step', 'false_branch_step', 'webhook_event', 'webhook_timeout_hours',
  'linkedin_note', 'thread_mode', 'linkedin_wait_days',
] as const;

function pickStep(input: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of STEP_KEYS) if (input[k] !== undefined) out[k] = input[k];
  if ('thread_mode' in out && !['reply', 'new', null].includes(out.thread_mode)) {
    throw new AppError('thread_mode must be reply, new or null', 400);
  }
  if ('linkedin_wait_days' in out && out.linkedin_wait_days !== null) {
    const n = Math.round(Number(out.linkedin_wait_days));
    if (!Number.isFinite(n) || n < 0 || n > LINKEDIN_WAIT_CONNECTED_MAX_DAYS) {
      throw new AppError(`linkedin_wait_days must be between 0 and ${LINKEDIN_WAIT_CONNECTED_MAX_DAYS}`, 400);
    }
    out.linkedin_wait_days = n;
  }
  return out;
}

/**
 * A write that names thread_mode on a database without migration 089 would
 * fail outright. The rest of the step is worth more than that one choice,
 * so it is retried without it (the email then goes out as before 089).
 * linkedin_wait_days (095) is treated the same way: without it the message
 * step simply sends as soon as it is due, as it always did.
 */
function withoutMissingThreadMode<T extends Record<string, any>>(error: { message: string } | null, patch: T): T | null {
  if (!error) return null;
  const rest: Record<string, any> = { ...patch };
  let dropped = false;
  for (const col of ['thread_mode', 'linkedin_wait_days']) {
    if (col in rest && new RegExp(col).test(error.message)) {
      delete rest[col];
      dropped = true;
    }
  }
  return dropped ? (rest as T) : null;
}

export const campaignStepsService = {
  async list(campaignId: string) {
    const { data, error } = await supabaseAdmin
      .from('campaign_steps')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('step_order');

    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async add(campaignId: string, input: any) {
    const patch = pickStep(input);
    // Callers that build the whole sequence client-side always send
    // step_order, but a caller that omits it (e.g. a headless API-key
    // integration appending one step at a time) would otherwise fall through
    // to the column's default of 0 on every insert, colliding with any
    // existing step and corrupting send ordering.
    if (patch.step_order === undefined) {
      const { count, error: countError } = await supabaseAdmin
        .from('campaign_steps')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId);
      if (countError) throw new AppError(countError.message, 500);
      patch.step_order = count ?? 0;
    }

    let { data, error } = await supabaseAdmin
      .from('campaign_steps')
      .insert({ ...patch, campaign_id: campaignId })
      .select()
      .single();
    const retry = withoutMissingThreadMode(error, patch);
    if (retry) {
      ({ data, error } = await supabaseAdmin
        .from('campaign_steps')
        .insert({ ...retry, campaign_id: campaignId })
        .select()
        .single());
    }

    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async update(campaignId: string, stepId: string, input: any) {
    const patch = pickStep(input);
    if (Object.keys(patch).length === 0) throw new AppError('Nothing to update', 400);
    let { data, error } = await supabaseAdmin
      .from('campaign_steps')
      .update(patch)
      .eq('id', stepId)
      .eq('campaign_id', campaignId)
      .select()
      .maybeSingle();
    const retry = withoutMissingThreadMode(error, patch);
    if (retry && Object.keys(retry).length > 0) {
      ({ data, error } = await supabaseAdmin
        .from('campaign_steps')
        .update(retry)
        .eq('id', stepId)
        .eq('campaign_id', campaignId)
        .select()
        .maybeSingle());
    }

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Step not found', 404);
    return data;
  },

  async delete(campaignId: string, stepId: string) {
    const { data: allSteps } = await supabaseAdmin
      .from('campaign_steps')
      .select('id, step_order, true_branch_step, false_branch_step')
      .eq('campaign_id', campaignId)
      .order('step_order');

    const step = (allSteps || []).find((s: any) => s.id === stepId);
    if (!step) throw new AppError('Step not found', 404);

    const { error } = await supabaseAdmin
      .from('campaign_steps')
      .delete()
      .eq('id', stepId);

    if (error) throw new AppError(error.message, 500);

    const remaining = (allSteps || []).filter((s: any) => s.id !== stepId);
    // Old step_order -> new step_order, so condition-step branch targets keep pointing
    // at the same step after the deleted step's order slot collapses.
    const oldOrderToNewOrder = new Map(remaining.map((s: any, i: number) => [s.step_order, i]));

    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      const update: any = { step_order: i };
      for (const branch of ['true_branch_step', 'false_branch_step'] as const) {
        if (s[branch] !== null && s[branch] !== undefined) {
          update[branch] = oldOrderToNewOrder.has(s[branch])
            ? oldOrderToNewOrder.get(s[branch])
            : null; // branch target was the deleted step — clear it rather than point at the wrong step
        }
      }
      const { error: reorderErr } = await supabaseAdmin
        .from('campaign_steps')
        .update(update)
        .eq('id', s.id);
      if (reorderErr) throw new AppError(`Failed to reorder steps: ${reorderErr.message}`, 500);
    }
  },

  async reorder(campaignId: string, stepIds: string[]) {
    const { data: allSteps } = await supabaseAdmin
      .from('campaign_steps')
      .select('id, step_order, true_branch_step, false_branch_step')
      .eq('campaign_id', campaignId);

    const oldOrderToNewOrder = new Map<number, number>(
      (allSteps || [])
        .map((s: any): [number, number] => [s.step_order, stepIds.indexOf(s.id)])
        .filter(([, i]) => i !== -1)
    );

    for (let i = 0; i < stepIds.length; i++) {
      const s = (allSteps || []).find((x: any) => x.id === stepIds[i]);
      const update: any = { step_order: i };
      if (s) {
        for (const branch of ['true_branch_step', 'false_branch_step'] as const) {
          if (s[branch] !== null && s[branch] !== undefined) {
            const mapped = oldOrderToNewOrder.get(s[branch]);
            update[branch] = mapped !== undefined ? mapped : null;
          }
        }
      }
      const { error } = await supabaseAdmin
        .from('campaign_steps')
        .update(update)
        .eq('id', stepIds[i])
        .eq('campaign_id', campaignId);
      if (error) throw new AppError(`Failed to reorder step ${stepIds[i]}: ${error.message}`, 500);
    }
  },
};

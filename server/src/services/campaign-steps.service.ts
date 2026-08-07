import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';

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
  'linkedin_note',
] as const;

function pickStep(input: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of STEP_KEYS) if (input[k] !== undefined) out[k] = input[k];
  return out;
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
    const { data, error } = await supabaseAdmin
      .from('campaign_steps')
      .insert({ ...pickStep(input), campaign_id: campaignId })
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async update(campaignId: string, stepId: string, input: any) {
    const patch = pickStep(input);
    if (Object.keys(patch).length === 0) throw new AppError('Nothing to update', 400);
    const { data, error } = await supabaseAdmin
      .from('campaign_steps')
      .update(patch)
      .eq('id', stepId)
      .eq('campaign_id', campaignId)
      .select()
      .maybeSingle();

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

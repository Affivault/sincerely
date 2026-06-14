import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';

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
      .insert({ ...input, campaign_id: campaignId })
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async update(campaignId: string, stepId: string, input: any) {
    const { data, error } = await supabaseAdmin
      .from('campaign_steps')
      .update(input)
      .eq('id', stepId)
      .eq('campaign_id', campaignId)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Step not found', 404);
    return data;
  },

  async delete(campaignId: string, stepId: string) {
    const { data: step } = await supabaseAdmin
      .from('campaign_steps')
      .select('step_order')
      .eq('id', stepId)
      .eq('campaign_id', campaignId)
      .single();

    if (!step) throw new AppError('Step not found', 404);

    const { error } = await supabaseAdmin
      .from('campaign_steps')
      .delete()
      .eq('id', stepId);

    if (error) throw new AppError(error.message, 500);

    // Reorder remaining steps
    const { data: remaining } = await supabaseAdmin
      .from('campaign_steps')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('step_order');

    if (remaining) {
      for (let i = 0; i < remaining.length; i++) {
        const { error: reorderErr } = await supabaseAdmin
          .from('campaign_steps')
          .update({ step_order: i })
          .eq('id', remaining[i].id);
        if (reorderErr) throw new AppError(`Failed to reorder steps: ${reorderErr.message}`, 500);
      }
    }
  },

  async reorder(campaignId: string, stepIds: string[]) {
    for (let i = 0; i < stepIds.length; i++) {
      const { error } = await supabaseAdmin
        .from('campaign_steps')
        .update({ step_order: i })
        .eq('id', stepIds[i])
        .eq('campaign_id', campaignId);
      if (error) throw new AppError(`Failed to reorder step ${stepIds[i]}: ${error.message}`, 500);
    }
  },
};

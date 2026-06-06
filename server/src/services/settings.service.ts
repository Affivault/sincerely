import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';

export interface UserSettings {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  company: string;
  job_title: string;
  timezone: string;
  email_notifications: boolean;
  campaign_alerts: boolean;
  reply_notifications: boolean;
  weekly_digest: boolean;
  default_signature: string;
  theme: string;
  sara_enabled: boolean;
  sara_auto_classify: boolean;
  sara_auto_execute: boolean;
  sara_confidence_threshold: number;
  sara_auto_unsubscribe: boolean;
  sara_auto_bounce: boolean;
  sara_draft_replies: boolean;
  ai_tagging_enabled: boolean;
  created_at: string;
  updated_at: string;
}

const DEFAULTS: Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  first_name: '',
  last_name: '',
  company: '',
  job_title: '',
  timezone: 'America/New_York',
  email_notifications: true,
  campaign_alerts: true,
  reply_notifications: true,
  weekly_digest: false,
  default_signature: '',
  theme: 'system',
  sara_enabled: true,
  sara_auto_classify: true,
  sara_auto_execute: true,
  sara_confidence_threshold: 85,
  sara_auto_unsubscribe: true,
  sara_auto_bounce: true,
  sara_draft_replies: true,
  ai_tagging_enabled: true,
};

export const settingsService = {
  async get(userId: string): Promise<UserSettings> {
    const { data, error } = await supabaseAdmin
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No row found — create default settings for this user
      const { data: newRow, error: insertError } = await supabaseAdmin
        .from('user_settings')
        .insert({ user_id: userId, ...DEFAULTS })
        .select('*')
        .single();

      if (insertError) throw new AppError(insertError.message, 500);
      return newRow as UserSettings;
    }

    if (error) throw new AppError(error.message, 500);
    return data as UserSettings;
  },

  async update(userId: string, updates: Partial<Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>): Promise<UserSettings> {
    // Ensure the row exists first (upsert-like pattern)
    await settingsService.get(userId);

    const { data, error } = await supabaseAdmin
      .from('user_settings')
      .update(updates)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) throw new AppError(error.message, 500);
    return data as UserSettings;
  },

  async deleteAccount(userId: string): Promise<void> {
    // Delete user settings
    await supabaseAdmin.from('user_settings').delete().eq('user_id', userId);

    // webhook_deliveries has no user_id column — must delete by endpoint_id first
    const { data: userEndpoints } = await supabaseAdmin
      .from('webhook_endpoints')
      .select('id')
      .eq('user_id', userId);
    if (userEndpoints && userEndpoints.length > 0) {
      await supabaseAdmin
        .from('webhook_deliveries')
        .delete()
        .in('endpoint_id', userEndpoints.map((e: any) => e.id));
    }

    // Delete user data from all tables (order matters for foreign keys)
    const tables = [
      'campaign_activities',
      'campaign_contacts',
      'campaign_smtp_accounts',
      'campaign_steps',
      'campaigns',
      'contact_tags',
      'list_contacts',
      'contact_lists',
      'saved_segments',
      'contacts',
      'tags',
      'inbox_messages',
      'smtp_accounts',
      'sending_domains',
      'email_templates',
      'sequence_templates',
      'asset_templates',
      'suppression_list',
      'webhook_endpoints',
      'api_keys',
    ];

    for (const table of tables) {
      await supabaseAdmin.from(table).delete().eq('user_id', userId);
    }

    // Delete the auth user via Supabase admin
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new AppError(`Failed to delete auth user: ${error.message}`, 500);
  },
};

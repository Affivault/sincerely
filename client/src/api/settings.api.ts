import { apiClient } from './client';

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
  monthly_results?: boolean;
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
  auto_verify_contacts: boolean;
  crm_auto_deals: boolean;
  /** When someone replies to one campaign, stop every other one for them. */
  stop_all_campaigns_on_reply: boolean;
  /** A positive reply pauses outreach to everyone else at that company. */
  pause_company_on_reply: boolean;
  /** Auto-pause a campaign whose bounce rate is damaging the sending domain. */
  bounce_guard_enabled: boolean;
  bounce_guard_threshold: number;
  /** Auto-pause a campaign recipients mark as spam past this percent of sends. */
  complaint_guard_enabled?: boolean;
  complaint_guard_threshold?: number;
  /** Auto-pause a campaign whose human opens fall this many percent below its usual rate. */
  open_guard_enabled?: boolean;
  open_guard_drop?: number;
  /** Days nothing is sent, account-wide. YYYY-MM-DD once, MM-DD every year. */
  blackout_dates?: string[];
  /** Most sends to one recipient company per hour. 0 = no limit. */
  domain_hourly_limit: number;
  /** Prospects move to Contacts on their own when they engage. Off = by hand only. */
  contact_auto_promote?: boolean;
  contact_promote_on_reply?: 'any' | 'positive' | 'off';
  contact_promote_on_meeting?: boolean;
  contact_promote_on_deal?: boolean;
  /** Send the no-show follow-up by itself (096). Off: offered instead. */
  no_show_auto_send?: boolean;
  /** Empty or null: the built-in wording from shared/no-show. */
  no_show_subject?: string | null;
  no_show_body?: string | null;
  /** What you sell - Relay's drafts and the sequence writer start here. */
  relay_offer?: string;
  relay_tone?: 'friendly' | 'direct' | 'formal';
  created_at: string;
  updated_at: string;
}

export const settingsApi = {
  get: async () => {
    const { data } = await apiClient.get<UserSettings>('/settings');
    return data;
  },

  update: async (updates: Partial<UserSettings>) => {
    const { data } = await apiClient.put<UserSettings>('/settings', updates);
    return data;
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const { data } = await apiClient.post<{ success: boolean; message: string }>(
      '/settings/change-password',
      { current_password: currentPassword, new_password: newPassword }
    );
    return data;
  },

  deleteAccount: async (confirmation: string) => {
    const { data } = await apiClient.post<{ success: boolean; message: string }>(
      '/settings/delete-account',
      { confirmation }
    );
    return data;
  },
};

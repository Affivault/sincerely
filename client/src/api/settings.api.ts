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

  changePassword: async (newPassword: string) => {
    const { data } = await apiClient.post<{ success: boolean; message: string }>(
      '/settings/change-password',
      { new_password: newPassword }
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

import { apiClient } from './client';

export interface LinkedinSettings {
  user_id: string;
  enabled: boolean;
  daily_connect_limit: number;
  daily_message_limit: number;
  daily_visit_limit: number;
  min_gap_seconds: number;
  max_gap_seconds: number;
  work_start: string;
  work_end: string;
  work_days: number[];
  timezone: string;
  paused_until: string | null;
  pause_reason: string | null;
  last_seen_at: string | null;
}

export interface LinkedinStatus {
  settings: LinkedinSettings;
  /** Steps waiting on the agent right now. */
  queued: number;
  today: { connects: number; messages: number; visits: number };
  /** The extension has checked in within the last few minutes. */
  connected: boolean;
}

export const linkedinApi = {
  status: async () => (await apiClient.get<LinkedinStatus>('/linkedin/status')).data,
  update: async (input: Partial<LinkedinSettings>) =>
    (await apiClient.put<LinkedinSettings>('/linkedin/settings', input)).data,
};

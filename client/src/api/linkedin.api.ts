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
  /* Migration 093; absent on a database that predates it. */
  weekly_connect_limit?: number;
  skip_task_after_days?: number;
  /** 'restricted' or 'logged_out' wait for the user to resume by hand. */
  pause_kind?: string | null;
  /* Migration 095; absent on a database that predates it. */
  daily_check_limit?: number;
  daily_withdraw_limit?: number;
  daily_inbox_limit?: number;
  daily_enrich_limit?: number;
  /** Withdraw invites still pending after this many days; 0 never. */
  withdraw_after_days?: number;
}

export interface LinkedinStatus {
  settings: LinkedinSettings;
  /** Steps waiting on the agent right now. */
  queued: number;
  today: {
    connects: number; messages: number; visits: number;
    /* The agent's own upkeep (095); 0 before it. */
    checks?: number; withdrawals?: number; inbox_reads?: number; enrichments?: number;
  };
  /** Invites this week; null before migration 093. */
  week?: { connects: number } | null;
  /** Paused for a restriction or sign-out, until the user resumes it. */
  needs_resume?: boolean;
  /** The extension has checked in within the last few minutes. */
  connected: boolean;
  /** On, and the extension has gone quiet: Chrome is closed or the extension is off. */
  offline?: boolean;
  /** The extension has checked in at least once, ever. */
  ever_connected?: boolean;
  /** Acceptance checks, inbox reads, withdrawals and enrichment are available (095). */
  upkeep?: boolean;
  invites?: { pending: number; accepted_30d: number } | null;
}

/** One line of the agent's activity log. */
export interface LinkedinActivityItem {
  id: string;
  at: string;
  /** connect, message, visit (campaign steps); check, withdraw, inbox, enrich, attention, agent. */
  kind: string;
  /** queued, done, skipped, failed. */
  state: string;
  contact_id: string | null;
  contact_name: string | null;
  detail: string | null;
}

export const linkedinApi = {
  status: async () => (await apiClient.get<LinkedinStatus>('/linkedin/status')).data,
  activity: async (limit = 60) =>
    (await apiClient.get<{ items: LinkedinActivityItem[] }>('/linkedin/activity', { params: { limit } })).data.items,
  update: async (input: Partial<LinkedinSettings>) =>
    (await apiClient.put<LinkedinSettings>('/linkedin/settings', input)).data,
};

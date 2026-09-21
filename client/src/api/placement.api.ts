import { apiClient } from './client';
import type { MailProvider, ProbePlacement, PlacementSummary } from '@lemlist/shared';

export interface PlacementSeed {
  id: string;
  email_address: string;
  provider: MailProvider;
  /** False when the mailbox has no IMAP server, so nothing can be read back. */
  readable: boolean;
  is_verified: boolean;
}

export interface PlacementProbe {
  id: string;
  seed_account_id: string;
  seed_email: string;
  provider: MailProvider;
  placement: ProbePlacement;
  folder: string | null;
  send_error: string | null;
  found_at: string | null;
}

export interface PlacementTest {
  id: string;
  smtp_account_id: string;
  campaign_id: string | null;
  step_id: string | null;
  subject: string;
  body_html: string | null;
  status: 'sending' | 'waiting' | 'complete' | 'failed';
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface PlacementDetail {
  test: PlacementTest;
  results: PlacementProbe[];
  summary: PlacementSummary;
}

export type PlacementListRow = Pick<
  PlacementTest, 'id' | 'smtp_account_id' | 'campaign_id' | 'subject' | 'status' | 'started_at' | 'completed_at' | 'error'
> & { summary: PlacementSummary };

export const placementApi = {
  seeds: async (): Promise<PlacementSeed[]> => {
    const { data } = await apiClient.get<PlacementSeed[]>('/placement/seeds');
    return data;
  },

  setSeed: async (id: string, isSeed: boolean) => {
    const { data } = await apiClient.patch(`/placement/seeds/${id}`, { is_seed: isSeed });
    return data;
  },

  list: async (): Promise<PlacementListRow[]> => {
    const { data } = await apiClient.get<PlacementListRow[]>('/placement');
    return data;
  },

  get: async (id: string): Promise<PlacementDetail> => {
    const { data } = await apiClient.get<PlacementDetail>(`/placement/${id}`);
    return data;
  },

  start: async (input: {
    smtp_account_id: string;
    campaign_id?: string | null;
    step_id?: string | null;
    subject?: string;
    body_html?: string;
  }): Promise<PlacementDetail> => {
    const { data } = await apiClient.post<PlacementDetail>('/placement', input);
    return data;
  },

  /** Look again now, rather than waiting out the poller's sweep. */
  refresh: async (id: string): Promise<PlacementDetail> => {
    const { data } = await apiClient.post<PlacementDetail>(`/placement/${id}/refresh`);
    return data;
  },
};

import { apiClient } from './client';
import type { FlowSummary, MeetingBrief } from '@lemlist/shared';

export const flowApi = {
  /** Everything that needs a decision, most urgent first. */
  get: async () => (await apiClient.get<FlowSummary>('/flow')).data,
  /** Nobody is waiting on this reply any more - it was handled elsewhere. */
  handled: async (messageId: string) => { await apiClient.post(`/flow/replies/${messageId}/handled`); },
};

export const briefApi = {
  get: async (eventId: string) => (await apiClient.get<MeetingBrief>(`/flow/meetings/${eventId}/brief`)).data,
};

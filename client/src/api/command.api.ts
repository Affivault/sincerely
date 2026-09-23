import { apiClient } from './client';
import type { EnrolResult } from '@lemlist/shared';

export const commandApi = {
  pause: async (target: string) =>
    (await apiClient.post<{ paused: number; contacts: number; label: string }>('/commands/pause', { target })).data,
  resume: async (target: string) =>
    (await apiClient.post<{ resumed: number; label: string }>('/commands/resume', { target })).data,
  enroll: async (email: string, campaign: string) =>
    (await apiClient.post<{ campaign: { id: string; name: string }; contact_id: string; created_contact: boolean; result: EnrolResult }>(
      '/commands/enroll', { email, campaign })).data,
};

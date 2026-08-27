import { apiClient } from './client';
import type { SetupState } from '@lemlist/shared';

export const setupApi = {
  get: async () => {
    const { data } = await apiClient.get<SetupState>('/setup');
    return data;
  },
};

export type { SetupState };

import { apiClient } from './client';
import type { SystemStatus, SelfTestResult } from '@lemlist/shared';

export const systemApi = {
  status: async () => (await apiClient.get<SystemStatus>('/system/status')).data,
  selfTest: async () => (await apiClient.post<{ results: SelfTestResult[] }>('/system/self-test', {}, { timeout: 120_000 })).data,
};

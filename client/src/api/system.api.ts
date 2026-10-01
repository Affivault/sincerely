import { apiClient } from './client';
import type { SystemStatus, SelfTestResult, ReplyCheckResult } from '@lemlist/shared';

export const systemApi = {
  status: async () => (await apiClient.get<SystemStatus>('/system/status')).data,
  selfTest: async () => (await apiClient.post<{ results: SelfTestResult[] }>('/system/self-test', {}, { timeout: 120_000 })).data,
  /** Sends, waits for the answer to come back through IMAP: up to two minutes. */
  replyCheck: async () => (await apiClient.post<ReplyCheckResult>('/system/reply-check', {}, { timeout: 180_000 })).data,
  setReplyCheckDaily: async (daily: boolean) => (await apiClient.put<{ daily: boolean }>('/system/reply-check/daily', { daily })).data,
};

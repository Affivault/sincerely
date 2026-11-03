import { apiClient } from './client';
import type { DriveBackupStatus } from '@lemlist/shared';

/** Google Drive backup (migration 112). */
export const backupApi = {
  status: async () => (await apiClient.get<DriveBackupStatus>('/backup')).data,
  /** With credentials, so the browser keeps the cookie that finishes the sign-in. */
  authorize: async () => (await apiClient.get<{ url: string }>('/backup/authorize', { withCredentials: true })).data,
  setEnabled: async (enabled: boolean) => (await apiClient.post<DriveBackupStatus>('/backup/enabled', { enabled })).data,
  backupNow: async () => (await apiClient.post<{ started: boolean; busy?: boolean }>('/backup/now')).data,
  disconnect: async () => (await apiClient.delete<{ disconnected: boolean }>('/backup')).data,
};

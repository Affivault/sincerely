import { apiClient } from './client';
import type { DriveBackupStatus, FileBackupsStatus, FileBackupProvider, S3BackupConfig } from '@lemlist/shared';

/** Google Drive backup (migration 112). */
export const backupApi = {
  status: async () => (await apiClient.get<DriveBackupStatus>('/backup')).data,
  /** With credentials, so the browser keeps the cookie that finishes the sign-in. */
  authorize: async () => (await apiClient.get<{ url: string }>('/backup/authorize', { withCredentials: true })).data,
  setEnabled: async (enabled: boolean) => (await apiClient.post<DriveBackupStatus>('/backup/enabled', { enabled })).data,
  backupNow: async () => (await apiClient.post<{ started: boolean; busy?: boolean }>('/backup/now')).data,
  disconnect: async () => (await apiClient.delete<{ disconnected: boolean }>('/backup')).data,
};

/** OneDrive, Dropbox and S3-compatible storage (migration 113). */
export const fileBackupApi = {
  status: async () => (await apiClient.get<FileBackupsStatus>('/backup/files')).data,
  authorize: async (provider: 'onedrive' | 'dropbox') =>
    (await apiClient.get<{ url: string }>(`/backup/files/${provider}/authorize`, { withCredentials: true })).data,
  saveS3: async (input: S3BackupConfig & { secret_access_key?: string }) =>
    (await apiClient.post<FileBackupsStatus>('/backup/files/s3', input, { timeout: 60_000 })).data,
  update: async (provider: FileBackupProvider, input: { enabled?: boolean; keep_days?: number }) =>
    (await apiClient.patch<FileBackupsStatus>(`/backup/files/${provider}`, input)).data,
  backupNow: async (provider: FileBackupProvider) =>
    (await apiClient.post<{ started: boolean; busy?: boolean }>(`/backup/files/${provider}/now`)).data,
  disconnect: async (provider: FileBackupProvider) =>
    (await apiClient.delete<{ disconnected: boolean }>(`/backup/files/${provider}`)).data,
};

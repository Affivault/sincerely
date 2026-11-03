/* ═══════════════════════════════════════════════════════════════════════
   Where a Sincerely backup can go (migrations 112 and 113).

   Google Drive keeps a live spreadsheet, row by row, about a minute
   behind. OneDrive, Dropbox and S3-compatible storage keep files: a
   "latest" folder rewritten a few minutes after anything changes, and a
   dated copy each day, kept for as long as is chosen. All of them carry
   the same tabs or files, built from the same rows (drive-backup.ts).
   ═══════════════════════════════════════════════════════════════════════ */

export type BackupProvider = 'google_drive' | 'onedrive' | 'dropbox' | 's3';
export type FileBackupProvider = Exclude<BackupProvider, 'google_drive'>;

export interface BackupProviderMeta {
  id: BackupProvider;
  name: string;
  /** One line under the name. */
  tagline: string;
  /** What lands there, in a few words. */
  format: string;
  /** How often it is brought up to date. */
  cadence: string;
  /** How it connects. */
  connect: 'oauth' | 'keys';
  /** What access is asked for, in plain words. */
  access: string;
  /** Tile colour (a brand-like hue, not a logo). */
  color: string;
}

export const BACKUP_PROVIDERS: BackupProviderMeta[] = [
  {
    id: 'google_drive', name: 'Google Drive', tagline: 'A live spreadsheet you can open anywhere',
    format: 'Google Sheet, one tab per record type', cadence: 'About a minute behind',
    connect: 'oauth', access: 'Only the spreadsheet Sincerely makes', color: '#1E8E3E',
  },
  {
    id: 'onedrive', name: 'OneDrive', tagline: 'CSV files in your Microsoft 365 or personal OneDrive',
    format: 'CSV files, plus a dated copy every day', cadence: 'A few minutes behind',
    connect: 'oauth', access: 'Only its own app folder', color: '#0F6CBD',
  },
  {
    id: 'dropbox', name: 'Dropbox', tagline: 'CSV files in a Sincerely folder in your Dropbox',
    format: 'CSV files, plus a dated copy every day', cadence: 'A few minutes behind',
    connect: 'oauth', access: 'Only its own app folder', color: '#0061FE',
  },
  {
    id: 's3', name: 'Amazon S3 and compatible', tagline: 'Your own bucket: AWS S3, Cloudflare R2, Backblaze B2, Wasabi',
    format: 'CSV files, plus a dated copy every day', cadence: 'A few minutes behind',
    connect: 'keys', access: 'One bucket, with keys you create and can revoke', color: '#C2410C',
  },
];

export const BACKUP_PROVIDER: Record<BackupProvider, BackupProviderMeta> =
  Object.fromEntries(BACKUP_PROVIDERS.map((p) => [p.id, p])) as Record<BackupProvider, BackupProviderMeta>;

/** The files in every file backup, in this order. */
export const BACKUP_FILES = [
  { file: 'people.csv', what: 'Every lead and contact' },
  { file: 'companies.csv', what: 'Every company' },
  { file: 'no-email.csv', what: 'People waiting for an address' },
  { file: 'lists.csv', what: 'Each list and its size' },
  { file: 'change-log.csv', what: 'Every change, with its time' },
  { file: 'README.txt', what: 'What these files are, and how to restore' },
] as const;

export const KEEP_DAYS_CHOICES = [7, 30, 90, 365] as const;

/** S3 settings as typed in. The secret never comes back to the browser. */
export interface S3BackupConfig {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  access_key_id: string;
}

export interface FileBackupSnapshot {
  day: string;
  folder: string;
  files: number;
  bytes: number;
  people: number;
  created_at: string;
}

export interface FileBackupStatus {
  provider: FileBackupProvider;
  configured: boolean;
  connected: boolean;
  account_label: string | null;
  enabled: boolean;
  keep_days: number;
  broken_reason: string | null;
  last_error: string | null;
  last_write_at: string | null;
  last_bytes: number | null;
  pending: number;
  writing: boolean;
  counts: { people: number; companies: number; held: number; lists: number; log: number };
  location: string | null;
  s3?: Partial<S3BackupConfig> | null;
  snapshots: FileBackupSnapshot[];
}

export interface FileBackupsStatus {
  unavailable?: boolean;
  destinations: FileBackupStatus[];
}

/** S3 settings, checked before anything is saved. */
export function s3ConfigProblems(c: Partial<S3BackupConfig> & { secret_access_key?: string }, opts: { needSecret?: boolean } = {}): string[] {
  const out: string[] = [];
  const endpoint = String(c.endpoint || '').trim();
  if (endpoint && !/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(endpoint)) out.push('The endpoint must be an https address with no path, like https://s3.eu-west-2.amazonaws.com');
  if (!/^[a-z0-9.-]{3,63}$/.test(String(c.bucket || '').trim())) out.push('A bucket name is 3 to 63 lower-case letters, numbers, dots or dashes');
  if (!String(c.region || '').trim()) out.push('Add the region (for R2 use "auto")');
  if (!String(c.access_key_id || '').trim()) out.push('Add the access key ID');
  if (opts.needSecret && !String(c.secret_access_key || '').trim()) out.push('Add the secret access key');
  if (/(^|\/)\.\.(\/|$)/.test(String(c.prefix || ''))) out.push('The folder cannot contain ".."');
  return out;
}

/** "12.4 MB" */
export function formatBackupBytes(n: number | null | undefined): string {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

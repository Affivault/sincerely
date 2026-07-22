export interface SmtpAccount {
  id: string;
  user_id: string;
  label: string;
  /** Human display name shown to recipients in the From header (e.g. "Thomas Vance"). Falls back to label when unset. */
  from_name: string | null;
  /** Optional Reply-To address — replies go here instead of the From address */
  reply_to?: string | null;
  email_address: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean | null;
  daily_send_limit: number;
  sends_today: number;
  last_send_reset_at: string;
  is_verified: boolean;
  is_active: boolean;
  // SSE Health fields
  health_score: number;
  total_sent: number;
  total_bounced: number;
  total_opened: number;
  bounce_rate_7d: number;
  last_bounce_at: string | null;
  warmup_mode: boolean;
  /** Target daily volume the warm-up ramp climbs toward. */
  warmup_daily_target: number;
  /** When the warm-up ramp started (null = never enrolled). */
  warmup_started_at: string | null;
  /** Day-one warm-up allowance the ramp starts from. */
  warmup_start_volume: number;
  /** Number of days the ramp takes to reach the target. */
  warmup_ramp_days: number;
  /** Warm-up emails sent to peer inboxes today (separate from campaign sends_today). */
  warmup_sent_today: number;
  /** HTML signature for this inbox, surfaced in the composer. */
  signature_html: string | null;
  /** When true, the signature is added by default on every new compose/reply from this inbox. */
  signature_auto: boolean;
  created_at: string;
  updated_at: string;
}

export interface SmtpAccountHealthSummary {
  id: string;
  label: string;
  email_address: string;
  health_score: number;
  sends_today: number;
  daily_send_limit: number;
  utilization_pct: number;
  bounce_rate_7d: number;
  warmup_mode: boolean;
  is_available: boolean;
}

export interface SseSelectionResult {
  account: SmtpAccount | null;
  reason: string;
  all_exhausted: boolean;
}

/* ─── Warm-up ramp math (shared by the send-gating engine and the UI) ───
   A new mailbox must not jump straight to full volume, or providers throttle
   and spam-folder it. The ramp starts low and climbs linearly to the target
   over `ramp_days`, so real campaign volume is capped to today's allowance. */

export interface WarmupPlanFields {
  warmup_mode: boolean;
  warmup_started_at: string | null;
  warmup_start_volume: number;
  warmup_daily_target: number;
  warmup_ramp_days: number;
  daily_send_limit: number;
}

/** Whole days elapsed since the ramp began (day 0 = the first day). */
export function warmupDayNumber(startedAt: string | null): number {
  if (!startedAt) return 0;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return 0;
  const ms = Date.now() - started;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * Today's maximum real-campaign send allowance for a mailbox. When warm-up is
 * off (or never enrolled) this is simply the account's daily_send_limit, so the
 * same helper can gate every account uniformly.
 */
export function warmupAllowance(a: WarmupPlanFields): number {
  if (!a.warmup_mode || !a.warmup_started_at) return a.daily_send_limit;
  const target = a.warmup_daily_target > 0 ? a.warmup_daily_target : a.daily_send_limit;
  const start = Math.max(1, a.warmup_start_volume > 0 ? a.warmup_start_volume : 4);
  const ramp = Math.max(1, a.warmup_ramp_days > 0 ? a.warmup_ramp_days : 30);
  const day = warmupDayNumber(a.warmup_started_at);
  if (day >= ramp) return target;
  return Math.max(start, Math.round(start + (target - start) * (day / ramp)));
}

/** True once the ramp has run its course and the mailbox can graduate to full volume. */
export function warmupIsComplete(a: WarmupPlanFields): boolean {
  if (!a.warmup_mode || !a.warmup_started_at) return false;
  return warmupDayNumber(a.warmup_started_at) >= Math.max(1, a.warmup_ramp_days > 0 ? a.warmup_ramp_days : 30);
}

/** How many warm-up emails to send to peer inboxes today (a gentle, capped curve). */
export function warmupSendTarget(a: WarmupPlanFields): number {
  if (!a.warmup_mode || !a.warmup_started_at) return 0;
  const day = warmupDayNumber(a.warmup_started_at);
  return Math.min(4 + day, 20);
}

export interface WarmupAccountStatus {
  id: string;
  email_address: string;
  from_name: string | null;
  label: string;
  warmup_mode: boolean;
  is_verified: boolean;
  health_score: number;
  /** Ramp progress */
  day: number;
  ramp_days: number;
  allowance: number;
  target: number;
  start_volume: number;
  complete: boolean;
  /** Engagement metrics over the last 7 days */
  sent_7d: number;
  received_7d: number;
  replied_7d: number;
  rescued_7d: number;
}

export interface WarmupSummary {
  accounts: WarmupAccountStatus[];
  peer_pool: number;
  total_warming: number;
  sent_7d: number;
  replied_7d: number;
}

export interface SetWarmupInput {
  enabled: boolean;
  warmup_daily_target?: number;
  warmup_start_volume?: number;
  warmup_ramp_days?: number;
}

export interface CreateSmtpAccountInput {
  label: string;
  from_name?: string | null;
  /** Optional Reply-To address — replies go here instead of the From address */
  reply_to?: string | null;
  email_address: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  imap_host?: string;
  imap_port?: number;
  imap_secure?: boolean;
  daily_send_limit?: number;
  signature_html?: string | null;
  signature_auto?: boolean;
}

export interface UpdateSmtpAccountInput extends Partial<CreateSmtpAccountInput> {}

/** Raw credentials for a pre-save "check connection" that does not persist anything. */
export interface VerifySmtpInput {
  email_address: string;
  from_name?: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  /** Optional IMAP leg — when host is provided, "Check connection" logs in too. */
  imap_host?: string;
  imap_port?: number;
  imap_secure?: boolean;
  imap_user?: string;
}

/** Result of one leg (SMTP or IMAP) of a connection check. */
export interface VerifyLegResult {
  ok: boolean;
  /** 'skipped' when no IMAP details were supplied */
  status: 'ok' | 'fail' | 'skipped';
  message: string;
}

export interface VerifySmtpResult {
  success: boolean;
  message: string;
  /** Per-service detail so the UI can show SMTP and IMAP independently. */
  smtp?: VerifyLegResult;
  imap?: VerifyLegResult;
}

export interface SmtpPreset {
  name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean | null;
  /** Domains that map to this provider (for auto-detection) */
  domains?: string[];
  /** Default username format hint */
  username_hint?: string;
  /** Password type hint */
  password_hint?: string;
  /** Whether this provider requires domain DNS setup */
  requires_domain_setup?: boolean;
  /** Default daily send limit recommendation */
  recommended_daily_limit?: number;
}

export const SMTP_PRESETS: SmtpPreset[] = [
  {
    name: 'Gmail',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_secure: false,
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_secure: true,
    domains: ['gmail.com'],
    username_hint: 'Your full Gmail address',
    password_hint: '16-character App Password',
    recommended_daily_limit: 500,
  },
  {
    name: 'Google Workspace',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_secure: false,
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_secure: true,
    domains: [],
    username_hint: 'Your workspace email',
    password_hint: '16-character App Password',
    recommended_daily_limit: 2000,
  },
  {
    name: 'Outlook / Microsoft 365',
    smtp_host: 'smtp.office365.com',
    smtp_port: 587,
    smtp_secure: false,
    imap_host: 'outlook.office365.com',
    imap_port: 993,
    imap_secure: true,
    domains: ['outlook.com', 'hotmail.com', 'live.com'],
    username_hint: 'Your full email address',
    password_hint: 'Your account password',
    recommended_daily_limit: 300,
  },
  {
    name: 'Yahoo Mail',
    smtp_host: 'smtp.mail.yahoo.com',
    smtp_port: 587,
    smtp_secure: false,
    imap_host: 'imap.mail.yahoo.com',
    imap_port: 993,
    imap_secure: true,
    domains: ['yahoo.com', 'yahoo.co.uk'],
    username_hint: 'Your full Yahoo email',
    password_hint: 'App-specific password',
    recommended_daily_limit: 200,
  },
  {
    name: 'Zoho Mail',
    smtp_host: 'smtp.zoho.com',
    smtp_port: 587,
    smtp_secure: false,
    imap_host: 'imap.zoho.com',
    imap_port: 993,
    imap_secure: true,
    domains: ['zoho.com', 'zohomail.com'],
    username_hint: 'Your full Zoho email',
    password_hint: 'App-specific password',
    recommended_daily_limit: 200,
  },
  {
    name: 'SendGrid',
    smtp_host: 'smtp.sendgrid.net',
    smtp_port: 587,
    smtp_secure: false,
    imap_host: null,
    imap_port: null,
    imap_secure: null,
    domains: [],
    username_hint: 'Always use "apikey"',
    password_hint: 'Your SendGrid API key',
    requires_domain_setup: true,
    recommended_daily_limit: 10000,
  },
  {
    name: 'Mailgun',
    smtp_host: 'smtp.mailgun.org',
    smtp_port: 587,
    smtp_secure: false,
    imap_host: null,
    imap_port: null,
    imap_secure: null,
    domains: [],
    username_hint: 'postmaster@your-domain.com',
    password_hint: 'SMTP password from Mailgun dashboard',
    requires_domain_setup: true,
    recommended_daily_limit: 10000,
  },
  {
    name: 'Amazon SES',
    smtp_host: 'email-smtp.us-east-1.amazonaws.com',
    smtp_port: 587,
    smtp_secure: false,
    imap_host: null,
    imap_port: null,
    imap_secure: null,
    domains: [],
    username_hint: 'SMTP IAM username',
    password_hint: 'SMTP IAM password (not AWS secret key)',
    requires_domain_setup: true,
    recommended_daily_limit: 50000,
  },
  {
    name: 'Fastmail',
    smtp_host: 'smtp.fastmail.com',
    smtp_port: 587,
    smtp_secure: false,
    imap_host: 'imap.fastmail.com',
    imap_port: 993,
    imap_secure: true,
    domains: ['fastmail.com', 'fastmail.fm'],
    username_hint: 'Your full Fastmail email',
    password_hint: 'App-specific password',
    recommended_daily_limit: 300,
  },
  {
    name: 'iCloud Mail',
    smtp_host: 'smtp.mail.me.com',
    smtp_port: 587,
    smtp_secure: false,
    imap_host: 'imap.mail.me.com',
    imap_port: 993,
    imap_secure: true,
    domains: ['icloud.com', 'me.com', 'mac.com'],
    username_hint: 'Your Apple ID email',
    password_hint: 'App-specific password',
    recommended_daily_limit: 200,
  },
  {
    name: 'ProtonMail Bridge',
    smtp_host: '127.0.0.1',
    smtp_port: 1025,
    smtp_secure: false,
    imap_host: '127.0.0.1',
    imap_port: 1143,
    imap_secure: false,
    domains: ['protonmail.com', 'proton.me', 'pm.me'],
    username_hint: 'Your ProtonMail address',
    password_hint: 'Bridge-generated password',
    recommended_daily_limit: 150,
  },
];

/** Auto-detect SMTP preset from email domain */
export function detectPresetFromEmail(email: string): SmtpPreset | null {
  const parts = email.trim().split('@');
  const domain = parts.length >= 2 ? parts[parts.length - 1]?.trim().toLowerCase() : undefined;
  if (!domain) return null;

  // Check exact domain match first
  for (const preset of SMTP_PRESETS) {
    if (preset.domains?.includes(domain)) {
      return preset;
    }
  }

  // For custom domains, suggest Google Workspace if MX points to google
  // (this is a hint — actual detection would need DNS lookup)
  return null;
}

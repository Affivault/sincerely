export interface SmtpAccount {
  id: string;
  user_id: string;
  label: string;
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
  warmup_daily_target: number;
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

export interface CreateSmtpAccountInput {
  label: string;
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
  const domain = email.split('@')[1]?.toLowerCase();
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

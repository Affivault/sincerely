import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Mail,
  Server,
  Key,
  CheckCircle2,
  AlertCircle,
  Copy,
  Globe,
  Shield,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { smtpApi } from '../../api/smtp.api';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button';

interface Provider {
  name: string;
  host: string;
  port: string;
  security: string;
  notes: string;
  steps: string[];
  username: string;
  password_type: string;
  requires_domain_setup?: boolean;
  dns_steps?: string[];
  daily_limit?: string;
  links?: { label: string; url: string }[];
}

const providers: Provider[] = [
  {
    name: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: '587 (TLS)',
    security: 'STARTTLS',
    notes: 'Requires 2-Step Verification and App Password. Works for both @gmail.com and Google Workspace custom domains.',
    username: 'Your full email address',
    password_type: '16-character App Password (not your Google password)',
    daily_limit: '500/day (Gmail) or 2,000/day (Workspace)',
    steps: [
      'Enable 2-Step Verification: Google Account > Security > 2-Step Verification',
      'Generate App Password: Google Account > Security > App passwords',
      'Select "Mail" as the app and your device',
      'Copy the 16-character password (remove spaces)',
      'Use this as your SMTP password in SkySend',
    ],
    dns_steps: [
      'Google Workspace handles SPF/DKIM automatically for your domain',
      'Verify your domain in Google Admin Console > Domains',
      'SPF: Add TXT record: v=spf1 include:_spf.google.com ~all',
      'DKIM: Admin Console > Apps > Google Workspace > Gmail > Authenticate email > Generate DKIM key',
      'Add the CNAME or TXT record Google provides to your DNS',
      'DMARC (recommended): Add TXT record at _dmarc.yourdomain.com: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com',
    ],
    links: [
      { label: 'Generate App Password', url: 'https://myaccount.google.com/apppasswords' },
      { label: 'Google DKIM Setup', url: 'https://support.google.com/a/answer/174124' },
    ],
  },
  {
    name: 'Microsoft 365 / Outlook',
    host: 'smtp.office365.com',
    port: '587',
    security: 'STARTTLS',
    notes: 'SMTP AUTH must be enabled for your account. Admin may need to enable it in the Microsoft 365 admin center.',
    username: 'Your full email address',
    password_type: 'Your Microsoft 365 password (or App Password if MFA enabled)',
    daily_limit: '10,000/day (M365) or 300/day (Outlook.com)',
    steps: [
      'Sign in to Microsoft 365 admin center (admin.microsoft.com)',
      'Go to Users > Active Users > Select user > Mail tab',
      'Enable "Authenticated SMTP" (SMTP AUTH)',
      'If MFA is enabled, generate an App Password in Security settings',
      'Use your full email as username and password/app password',
    ],
    dns_steps: [
      'SPF: Add TXT record: v=spf1 include:spf.protection.outlook.com -all',
      'DKIM: Microsoft 365 admin > Settings > Domains > Select domain > DNS records',
      'Add CNAME records: selector1._domainkey → selector1-domain._domainkey.tenant.onmicrosoft.com',
      'Add CNAME records: selector2._domainkey → selector2-domain._domainkey.tenant.onmicrosoft.com',
      'Enable DKIM signing in Exchange admin center > Email authentication > DKIM',
      'DMARC: Add TXT at _dmarc.yourdomain.com: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com',
    ],
    links: [
      { label: 'Enable SMTP AUTH', url: 'https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission' },
      { label: 'DKIM Setup Guide', url: 'https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/email-authentication-dkim-configure' },
    ],
  },
  {
    name: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: '587 (TLS)',
    security: 'TLS',
    notes: 'Username is always "apikey". You must verify your sending domain with DNS records.',
    username: 'apikey (literally the word "apikey")',
    password_type: 'Your SendGrid API key (starts with SG.)',
    daily_limit: '100/day (free) or based on plan',
    requires_domain_setup: true,
    steps: [
      'Create a SendGrid account at sendgrid.com',
      'Go to Settings > API Keys > Create API Key',
      'Give it "Mail Send" permissions (Full Access or Restricted)',
      'Copy the API key (starts with SG.xxx) — you won\'t see it again',
      'Username: "apikey" | Password: your API key',
    ],
    dns_steps: [
      'Go to Settings > Sender Authentication > Authenticate Your Domain',
      'Choose your DNS host and enter your domain name',
      'SendGrid will provide 3 CNAME records to add to your DNS:',
      'CNAME 1: em1234.yourdomain.com → u1234.wl.sendgrid.net',
      'CNAME 2: s1._domainkey.yourdomain.com → s1.domainkey.u1234.wl.sendgrid.net',
      'CNAME 3: s2._domainkey.yourdomain.com → s2.domainkey.u1234.wl.sendgrid.net',
      'Wait for DNS propagation (up to 48 hours) then click "Verify" in SendGrid',
    ],
    links: [
      { label: 'SendGrid Domain Auth', url: 'https://app.sendgrid.com/settings/sender_auth/domain/create' },
      { label: 'API Key Setup', url: 'https://app.sendgrid.com/settings/api_keys' },
    ],
  },
  {
    name: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: '587',
    security: 'TLS',
    notes: 'Requires domain verification. Free tier allows sending to authorized recipients only.',
    username: 'postmaster@your-domain.com (or custom credentials)',
    password_type: 'SMTP password from Mailgun domain settings',
    daily_limit: 'Based on plan',
    requires_domain_setup: true,
    steps: [
      'Sign up at mailgun.com and add your sending domain',
      'Go to Sending > Domains > Add New Domain',
      'Add the DNS records Mailgun provides (see Domain DNS Setup)',
      'Wait for verification to complete',
      'Go to Domain Settings > SMTP Credentials to get/create credentials',
    ],
    dns_steps: [
      'Mailgun will provide these DNS records when you add your domain:',
      'TXT (SPF): v=spf1 include:mailgun.org ~all',
      'TXT (DKIM): Add the DKIM key as a TXT record at the selector Mailgun specifies',
      'CNAME: email.yourdomain.com → mailgun.org (for tracking)',
      'MX records (if receiving): mxa.mailgun.org (priority 10) and mxb.mailgun.org (priority 10)',
      'Wait for DNS propagation, then click "Verify DNS Settings" in Mailgun',
    ],
    links: [
      { label: 'Mailgun Dashboard', url: 'https://app.mailgun.com/mg/dashboard' },
    ],
  },
  {
    name: 'Amazon SES',
    host: 'email-smtp.[region].amazonaws.com',
    port: '587 or 465',
    security: 'TLS/SSL',
    notes: 'Replace [region] with your AWS region (e.g., us-east-1). New accounts start in sandbox mode.',
    username: 'SMTP IAM credentials (NOT your AWS access key)',
    password_type: 'SMTP IAM password (generated in SES console)',
    daily_limit: '200/day (sandbox) or 50,000+/day (production)',
    requires_domain_setup: true,
    steps: [
      'Open Amazon SES in AWS Console',
      'Verify your domain: Identities > Create identity > Domain',
      'Add the DNS records AWS provides for verification',
      'Request production access: Account Dashboard > Request production access',
      'Create SMTP credentials: Account Dashboard > SMTP settings > Create credentials',
      'Save the SMTP username and password (shown only once)',
    ],
    dns_steps: [
      'When you verify a domain in SES, AWS provides:',
      'TXT record for domain verification (unique to your domain)',
      '3 CNAME records for DKIM (Easy DKIM):',
      'CNAME: abc123._domainkey.yourdomain.com → abc123.dkim.amazonses.com',
      'SPF: v=spf1 include:amazonses.com ~all',
      'DMARC: Add TXT at _dmarc.yourdomain.com: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com',
    ],
    links: [
      { label: 'SES Console', url: 'https://console.aws.amazon.com/ses/' },
    ],
  },
  {
    name: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: '587 (TLS)',
    security: 'TLS',
    notes: 'Use your Zoho email credentials. App-specific password needed if 2FA is enabled.',
    username: 'Your full Zoho email address',
    password_type: 'Your Zoho password or app-specific password',
    daily_limit: '500/day (free) based on plan',
    steps: [
      'Log in to Zoho Mail at mail.zoho.com',
      'If 2FA is enabled: Go to Zoho Accounts > Security > App Passwords',
      'Generate an app-specific password for "Desktop Mail Client"',
      'Use your full email as username and the app password',
      'Ensure IMAP access is enabled: Settings > Mail Accounts > IMAP Access',
    ],
    dns_steps: [
      'If using a custom domain with Zoho:',
      'MX records: mx.zoho.com (priority 10), mx2.zoho.com (priority 20), mx3.zoho.com (priority 50)',
      'SPF: Add TXT record: v=spf1 include:zoho.com ~all',
      'DKIM: Zoho Admin > Email Authentication > DKIM > Add Selector',
      'Add the TXT record Zoho provides at selector._domainkey.yourdomain.com',
      'DMARC: Add TXT at _dmarc.yourdomain.com: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com',
    ],
    links: [
      { label: 'Zoho App Passwords', url: 'https://accounts.zoho.com/u/h#security/app_password' },
    ],
  },
  {
    name: 'Custom SMTP',
    host: 'Your SMTP server hostname',
    port: '587 (TLS) or 465 (SSL)',
    security: 'TLS or SSL',
    notes: 'For any SMTP server not listed above. Contact your email provider or hosting company for credentials.',
    username: 'Usually your full email address',
    password_type: 'Your email password or API key',
    steps: [
      'Get SMTP credentials from your email provider or hosting control panel (cPanel, Plesk, etc.)',
      'Common locations: Email settings, Server settings, or SMTP configuration page',
      'Note the SMTP hostname (often mail.yourdomain.com or smtp.yourdomain.com)',
      'Port 587 with STARTTLS is most common; port 465 uses implicit SSL',
      'Enter your full email address as username and your email/app password',
    ],
    dns_steps: [
      'For best deliverability with a custom domain, set up these DNS records:',
      'SPF: Add TXT record: v=spf1 include:[your-provider] a mx ~all',
      'DKIM: Check your hosting provider\'s email authentication settings for DKIM key generation',
      'DMARC: Add TXT record at _dmarc.yourdomain.com: v=DMARC1; p=none; rua=mailto:postmaster@yourdomain.com',
      'Tip: Start with DMARC policy "none" to monitor, then move to "quarantine" or "reject"',
    ],
  },
];

function CopyButton({ text }: { text: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    toast.success('Copied!');
  };
  return (
    <button onClick={handleCopy} className="p-1 rounded hover:bg-hover text-tertiary hover:text-secondary transition-colors">
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

function DnsCheckResult({ result }: { result: any }) {
  const Item = ({ label, found, detail }: { label: string; found: boolean; detail?: string }) => (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-elevated border border-subtle">
      <div className={`mt-0.5 ${found ? 'text-green-500' : 'text-amber-500'}`}>
        {found ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-primary">{label}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${found ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
            {found ? 'Found' : 'Missing'}
          </span>
        </div>
        {detail && <p className="text-xs text-secondary mt-1 break-all">{detail}</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <Item label="MX Records" found={result.mx.found} detail={result.mx.found ? result.mx.records.map((r: any) => `${r.exchange} (priority ${r.priority})`).join(', ') : 'No MX records found'} />
      <Item label="SPF Record" found={result.spf.found} detail={result.spf.found ? result.spf.record : 'No SPF record — add a TXT record starting with v=spf1'} />
      <Item label="DKIM Record" found={result.dkim.found} detail={result.dkim.note} />
      <Item label="DMARC Policy" found={result.dmarc.found} detail={result.dmarc.found ? `${result.dmarc.record} (policy: ${result.dmarc.policy})` : 'No DMARC record — add TXT at _dmarc.yourdomain.com'} />
      {result.provider_hint && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-elevated border border-subtle">
          <Search className="h-4 w-4 text-secondary" />
          <span className="text-sm text-secondary">Detected provider: <strong className="text-primary">{result.provider_hint}</strong></span>
        </div>
      )}
    </div>
  );
}

export function SmtpGuidePage() {
  const [selectedProvider, setSelectedProvider] = useState(providers[0]);
  const [showDns, setShowDns] = useState(false);
  const [domainInput, setDomainInput] = useState('');

  const checkDomainMutation = useMutation({
    mutationFn: (domain: string) => smtpApi.checkDomain(domain),
    onError: (err: any) => toast.error(err.response?.data?.error || 'DNS check failed'),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <Link to="/smtp-accounts" className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary mb-4 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to SMTP Accounts
        </Link>
        <h1 className="text-2xl font-semibold text-primary">SMTP Connection Guide</h1>
        <p className="text-sm text-secondary mt-1">Complete guide for connecting your email provider to SkySend, including DNS setup for custom domains.</p>
      </div>

      {/* What You'll Need */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-subtle bg-surface p-4">
          <Server className="h-5 w-5 text-primary mb-3" />
          <h3 className="text-sm font-medium text-primary mb-1">SMTP Host</h3>
          <p className="text-xs text-secondary">Server address for outgoing mail</p>
        </div>
        <div className="rounded-lg border border-subtle bg-surface p-4">
          <Globe className="h-5 w-5 text-primary mb-3" />
          <h3 className="text-sm font-medium text-primary mb-1">Port & Security</h3>
          <p className="text-xs text-secondary">587 (TLS) or 465 (SSL)</p>
        </div>
        <div className="rounded-lg border border-subtle bg-surface p-4">
          <Key className="h-5 w-5 text-primary mb-3" />
          <h3 className="text-sm font-medium text-primary mb-1">Credentials</h3>
          <p className="text-xs text-secondary">Username + password/API key</p>
        </div>
        <div className="rounded-lg border border-subtle bg-surface p-4">
          <Shield className="h-5 w-5 text-primary mb-3" />
          <h3 className="text-sm font-medium text-primary mb-1">DNS Records</h3>
          <p className="text-xs text-secondary">SPF, DKIM, DMARC for deliverability</p>
        </div>
      </div>

      {/* Domain DNS Checker */}
      <div className="rounded-lg border border-default bg-surface">
        <button
          onClick={() => setShowDns(!showDns)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-hover transition-colors rounded-lg"
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-elevated border border-subtle">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-primary">Domain DNS Checker</h2>
              <p className="text-sm text-secondary">Verify SPF, DKIM, DMARC records for your sending domain</p>
            </div>
          </div>
          {showDns ? <ChevronDown className="h-5 w-5 text-tertiary" /> : <ChevronRight className="h-5 w-5 text-tertiary" />}
        </button>

        {showDns && (
          <div className="p-5 pt-0 space-y-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && domainInput && checkDomainMutation.mutate(domainInput)}
                placeholder="yourdomain.com"
                className="flex-1 rounded-md border border-default bg-surface px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)]"
              />
              <Button
                onClick={() => domainInput && checkDomainMutation.mutate(domainInput)}
                disabled={!domainInput || checkDomainMutation.isPending}
              >
                <Search className="h-4 w-4" />
                {checkDomainMutation.isPending ? 'Checking...' : 'Check DNS'}
              </Button>
            </div>

            {checkDomainMutation.data && <DnsCheckResult result={checkDomainMutation.data} />}

            <div className="rounded-lg bg-elevated p-4 border border-subtle">
              <h4 className="text-xs font-medium text-secondary uppercase tracking-wide mb-2">Why DNS records matter</h4>
              <div className="space-y-2 text-sm text-secondary">
                <p><strong className="text-primary">SPF</strong> — Tells receiving servers which mail servers can send email for your domain. Without it, emails may land in spam.</p>
                <p><strong className="text-primary">DKIM</strong> — Adds a digital signature proving emails haven't been tampered with. Set up through your email provider.</p>
                <p><strong className="text-primary">DMARC</strong> — Tells receivers what to do with emails that fail SPF/DKIM. Start with <code className="px-1 py-0.5 bg-surface rounded text-xs">p=none</code> to monitor.</p>
              </div>
              <div className="mt-3 pt-3 border-t border-subtle">
                <Link
                  to="/domains"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-2"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Set up and verify your domain records
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Provider Selection */}
      <div>
        <h2 className="text-sm font-medium text-secondary uppercase tracking-wide mb-3">Choose Your Provider</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {providers.map((provider) => (
            <button
              key={provider.name}
              onClick={() => setSelectedProvider(provider)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                selectedProvider.name === provider.name
                  ? 'bg-[var(--text-primary)] text-[var(--bg-app)]'
                  : 'bg-surface border border-subtle text-secondary hover:text-primary hover:bg-hover'
              }`}
            >
              {provider.name}
            </button>
          ))}
        </div>

        {/* Provider Details */}
        <div className="rounded-lg border border-subtle bg-surface">
          <div className="p-5 border-b border-subtle">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-primary">{selectedProvider.name}</h3>
                <p className="text-sm text-secondary mt-1">{selectedProvider.notes}</p>
              </div>
              {selectedProvider.requires_domain_setup && (
                <span className="px-2 py-1 text-xs font-medium rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  Domain Setup Required
                </span>
              )}
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* Connection Details */}
            <div>
              <h4 className="text-xs font-medium text-secondary uppercase tracking-wide mb-3">Connection Details</h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-md bg-elevated p-3 border border-subtle">
                  <p className="text-xs text-tertiary mb-1">SMTP Host</p>
                  <div className="flex items-center justify-between">
                    <code className="text-sm text-primary">{selectedProvider.host}</code>
                    <CopyButton text={selectedProvider.host} />
                  </div>
                </div>
                <div className="rounded-md bg-elevated p-3 border border-subtle">
                  <p className="text-xs text-tertiary mb-1">Port</p>
                  <div className="flex items-center justify-between">
                    <code className="text-sm text-primary">{selectedProvider.port}</code>
                    <CopyButton text={selectedProvider.port.split(' ')[0]} />
                  </div>
                </div>
                <div className="rounded-md bg-elevated p-3 border border-subtle">
                  <p className="text-xs text-tertiary mb-1">Username</p>
                  <p className="text-sm text-primary">{selectedProvider.username}</p>
                </div>
                <div className="rounded-md bg-elevated p-3 border border-subtle">
                  <p className="text-xs text-tertiary mb-1">Password</p>
                  <p className="text-sm text-primary">{selectedProvider.password_type}</p>
                </div>
              </div>
              {selectedProvider.daily_limit && (
                <div className="mt-3 rounded-md bg-elevated p-3 border border-subtle">
                  <p className="text-xs text-tertiary">Recommended Daily Send Limit</p>
                  <p className="text-sm text-primary font-medium">{selectedProvider.daily_limit}</p>
                </div>
              )}
            </div>

            {/* SMTP Setup Steps */}
            <div>
              <h4 className="text-xs font-medium text-secondary uppercase tracking-wide mb-3">SMTP Setup Steps</h4>
              <div className="space-y-2">
                {selectedProvider.steps.map((step, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 rounded-md bg-elevated border border-subtle">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-surface border border-subtle text-primary flex items-center justify-center text-xs font-medium">
                      {index + 1}
                    </div>
                    <p className="text-sm text-secondary pt-0.5">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* DNS Setup */}
            {selectedProvider.dns_steps && (
              <div>
                <h4 className="text-xs font-medium text-secondary uppercase tracking-wide mb-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5" />
                    Domain DNS Setup
                  </span>
                </h4>
                <div className="space-y-2">
                  {selectedProvider.dns_steps.map((step, index) => (
                    <div key={index} className="flex items-start gap-3 p-3 rounded-md bg-elevated border border-subtle">
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-surface border border-subtle text-primary flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </div>
                      <p className="text-sm text-secondary pt-0.5 break-all">{step}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Links */}
            {selectedProvider.links && selectedProvider.links.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-secondary uppercase tracking-wide mb-3">Useful Links</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedProvider.links.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-subtle bg-elevated text-sm text-secondary hover:text-primary hover:bg-hover transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tips */}
      <div className="rounded-lg border border-default bg-elevated p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-primary flex-shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-primary mb-2">Deliverability Tips</h3>
            <ul className="space-y-1.5 text-sm text-secondary">
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />Always set up SPF, DKIM, and DMARC records for custom domains</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />Use app-specific passwords instead of your main account password</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />Test your connection before sending campaigns</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />Start with low volume and warm up new accounts gradually</li>
              <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />Use the Domain DNS Checker above to verify your records</li>
            </ul>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="rounded-lg border border-subtle bg-surface p-4 text-center">
        <h3 className="font-medium text-primary mb-2">Ready to connect?</h3>
        <p className="text-sm text-secondary mb-4">Add your SMTP credentials to start sending campaigns.</p>
        <Link
          to="/smtp-accounts"
          className="btn-primary inline-flex items-center gap-2 px-4 py-2 bg-[var(--text-primary)] text-[var(--bg-app)] text-sm font-medium rounded-md hover:opacity-90 transition-opacity"
        >
          <Mail className="h-4 w-4" />
          Add SMTP Account
        </Link>
      </div>
    </div>
  );
}

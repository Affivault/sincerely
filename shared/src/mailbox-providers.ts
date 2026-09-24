/* ═══════════════════════════════════════════════════════════════════════
   How to sign in to each provider, said where the password is typed.

   The commonest reason a mailbox fails to connect is not a wrong server -
   the presets fill those in - but the wrong KIND of password. Gmail wants
   a 16-character app password, not the account password; Microsoft 365
   turns SMTP sign-in off by default; Zoho wants IMAP switched on first.
   The old form said "16-character App Password" in a placeholder and left
   the rest to a separate guide page nobody had open.

   So each provider carries the three or four steps that actually get a
   working password, with a link that opens the right settings page, and
   the one thing most likely to go wrong. Keyed by preset name.
   ═══════════════════════════════════════════════════════════════════════ */

export interface ProviderGuide {
  /** What to call the thing they paste in. */
  secret: string;
  /** Short, imperative, in order. */
  steps: string[];
  link?: { label: string; url: string };
  /** The one thing that most often goes wrong, in a sentence. */
  gotcha?: string;
}

export const PROVIDER_GUIDES: Record<string, ProviderGuide> = {
  Gmail: {
    secret: 'App password',
    steps: [
      'Turn on 2-Step Verification for this Google account.',
      'Open App passwords and create one called "Sincerely".',
      'Copy the 16 characters Google shows and paste them here.',
    ],
    link: { label: 'Open Google app passwords', url: 'https://myaccount.google.com/apppasswords' },
    gotcha: 'Your normal Google password will not work here, and the App passwords page only appears once 2-Step Verification is on.',
  },
  'Google Workspace': {
    secret: 'App password',
    steps: [
      'Turn on 2-Step Verification for this account.',
      'Open App passwords and create one called "Sincerely".',
      'Copy the 16 characters and paste them here.',
    ],
    link: { label: 'Open Google app passwords', url: 'https://myaccount.google.com/apppasswords' },
    gotcha: 'If App passwords is missing, your Workspace admin has turned it off - ask them to allow it for your account.',
  },
  'Outlook / Microsoft 365': {
    secret: 'Password or app password',
    steps: [
      'Personal Outlook/Hotmail: create an app password under Security > Advanced security options.',
      'Microsoft 365 (work): ask your admin to enable "Authenticated SMTP" for this mailbox.',
      'Paste the app password (or your mailbox password if your admin allows it).',
    ],
    link: { label: 'Open Microsoft security info', url: 'https://mysignins.microsoft.com/security-info' },
    gotcha: 'Microsoft 365 switches SMTP sign-in off by default. "Authentication unsuccessful" almost always means it needs enabling in the admin centre.',
  },
  'Yahoo Mail': {
    secret: 'App password',
    steps: [
      'Open Yahoo Account security.',
      'Choose "Generate app password" and name it "Sincerely".',
      'Paste the password Yahoo shows.',
    ],
    link: { label: 'Open Yahoo account security', url: 'https://login.yahoo.com/account/security' },
  },
  'Zoho Mail': {
    secret: 'App-specific password',
    steps: [
      'In Zoho Mail, go to Settings > Mail Accounts and switch IMAP access on.',
      'Open Zoho Accounts > Security > App passwords and generate one.',
      'Paste it here.',
    ],
    link: { label: 'Open Zoho app passwords', url: 'https://accounts.zoho.com/home#security/app_password' },
    gotcha: 'Zoho refuses IMAP until it is switched on in Mail settings, even with the right password.',
  },
  SendGrid: {
    secret: 'API key',
    steps: [
      'Create an API key with "Mail Send" permission.',
      'The username is the word "apikey" - it is filled in for you.',
      'Paste the API key as the password.',
    ],
    link: { label: 'Open SendGrid API keys', url: 'https://app.sendgrid.com/settings/api_keys' },
    gotcha: 'SendGrid only sends - it has no inbox, so replies will not appear in Sincerely.',
  },
  Mailgun: {
    secret: 'SMTP password',
    steps: [
      'Open your sending domain in Mailgun.',
      'Under SMTP credentials, create or reset a login.',
      'Use that login as the username and paste its password.',
    ],
    link: { label: 'Open Mailgun', url: 'https://app.mailgun.com/' },
    gotcha: 'Mailgun only sends - it has no inbox, so replies will not appear in Sincerely.',
  },
  'Amazon SES': {
    secret: 'SMTP password',
    steps: [
      'In the SES console, open SMTP settings.',
      'Create SMTP credentials (this makes an IAM user).',
      'Use the SMTP username and password it shows - not your AWS keys.',
    ],
    link: { label: 'Open Amazon SES', url: 'https://console.aws.amazon.com/ses/' },
    gotcha: 'New SES accounts are in the sandbox and can only send to verified addresses until AWS lifts it.',
  },
  Fastmail: {
    secret: 'App password',
    steps: [
      'Open Settings > Privacy & Security > App passwords.',
      'Create one with access to IMAP and SMTP.',
      'Paste it here.',
    ],
    link: { label: 'Open Fastmail app passwords', url: 'https://app.fastmail.com/settings/security/devicekeys' },
  },
  'iCloud Mail': {
    secret: 'App-specific password',
    steps: [
      'Sign in to your Apple Account.',
      'Under Sign-In and Security, create an app-specific password.',
      'Paste it here.',
    ],
    link: { label: 'Open Apple Account', url: 'https://account.apple.com/account/manage' },
  },
  'ProtonMail Bridge': {
    secret: 'Bridge password',
    steps: [
      'Install and sign in to Proton Mail Bridge.',
      'Copy the mailbox password Bridge shows.',
      'Paste it here.',
    ],
    gotcha: 'Bridge runs on your own computer, so Sincerely cannot reach it from the cloud. Proton mailboxes generally cannot be connected.',
  },
  Spacemail: {
    secret: 'Mailbox password',
    steps: ['Use the password you set for this mailbox in Spaceship.'],
  },
  'Namecheap Private Email': {
    secret: 'Mailbox password',
    steps: ['Use the password you set for this mailbox in Namecheap.'],
  },
  Titan: {
    secret: 'Mailbox password',
    steps: ['Use the password you set for this mailbox in Titan.'],
  },
};

/** The guide for a preset, or a sensible generic one. */
export function providerGuide(presetName: string | null | undefined): ProviderGuide {
  return (presetName && PROVIDER_GUIDES[presetName]) || {
    secret: 'Password',
    steps: ['Use the password for this mailbox. If your provider offers app passwords, create one for Sincerely - it is safer and survives password changes.'],
  };
}

/** Providers that send but have no inbox to read replies from. */
export function isSendOnlyProvider(presetName: string | null | undefined): boolean {
  return presetName === 'SendGrid' || presetName === 'Mailgun' || presetName === 'Amazon SES';
}

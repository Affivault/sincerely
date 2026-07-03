import { LegalShell } from './LegalShell';

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="July 3, 2026">
      <p>
        This Privacy Policy explains how Sincerely ("<strong>we</strong>", "<strong>us</strong>") collects, uses,
        and shares personal data when you use <a href="https://usesincerely.com">usesincerely.com</a> (the
        "<strong>Service</strong>").
      </p>

      <h2>1. Data We Collect</h2>
      <h3>Account data</h3>
      <p>Your name, email address, password (stored as a hash by our authentication provider), and profile/settings you configure.</p>
      <h3>Billing data</h3>
      <p>
        Payments are processed by <strong>Stripe</strong>. We never see or store your full card number — we store
        only your subscription status, plan, and Stripe customer reference. Stripe's handling of your payment data
        is described in <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">Stripe's privacy policy</a>.
      </p>
      <h3>Connected email accounts</h3>
      <p>
        To send and receive email on your behalf we store your SMTP/IMAP settings. Email account passwords are
        <strong> encrypted at rest</strong> and used only to send and sync email as you direct.
      </p>
      <h3>Your contacts and messages</h3>
      <p>
        Contact lists you upload and the content of campaigns, replies, and inbox messages processed through the
        Service. For this data <strong>you are the data controller and we act as your processor</strong> — we
        process it only to provide the Service to you.
      </p>
      <h3>Usage data</h3>
      <p>
        Standard technical logs (IP address, browser type, pages viewed) and product events (emails sent, opens
        and clicks recorded via tracking pixels/links in the campaigns you send) used to operate and improve the Service.
      </p>

      <h2>2. How We Use Data</h2>
      <ul>
        <li>To provide, operate, and secure the Service (including sending your campaigns and syncing your inbox).</li>
        <li>To bill you and manage your subscription.</li>
        <li>To communicate with you about the Service (transactional messages, security notices, support).</li>
        <li>To monitor for abuse — including spam-complaint and bounce monitoring — and to comply with legal obligations.</li>
      </ul>
      <p>We do <strong>not</strong> sell personal data, and we do not use the contents of your emails or contact lists for advertising.</p>

      <h2>3. Sharing</h2>
      <p>We share data only with service providers that help us run the Service, under contracts limiting their use of it:</p>
      <ul>
        <li><strong>Supabase</strong> — database, authentication, and storage.</li>
        <li><strong>Stripe</strong> — payment processing.</li>
        <li><strong>Render / Vercel</strong> — application hosting.</li>
        <li>Your own email providers — when the Service sends or syncs mail via the accounts you connected.</li>
      </ul>
      <p>We may also disclose data if required by law, or in connection with a merger or acquisition (with notice to you).</p>

      <h2>4. International Transfers</h2>
      <p>
        Our providers may process data in the United States and other countries. Where required, transfers are
        protected by appropriate safeguards such as Standard Contractual Clauses offered by our providers.
      </p>

      <h2>5. Retention &amp; Deletion</h2>
      <ul>
        <li>We keep your data while your account is active.</li>
        <li>Deleting your account (Settings → Delete account) cancels any subscription and permanently deletes your account data, contacts, messages, and connected-account credentials from the Service.</li>
        <li>Billing records may be retained by Stripe and in our financial records as required by law.</li>
      </ul>

      <h2>6. Your Rights</h2>
      <p>
        Depending on where you live (e.g. under the GDPR or UK GDPR), you may have rights to access, correct,
        export, restrict, or delete your personal data, and to object to certain processing. You can exercise most
        of these directly in the app; for anything else, email us and we will respond within the legally required
        timeframe. If you are a recipient of email sent by one of our customers, your data is controlled by that
        customer — contact them directly, or contact us and we will refer your request to them.
      </p>

      <h2>7. Cookies</h2>
      <p>
        We use only cookies and local storage necessary to operate the Service (such as keeping you signed in).
        We do not use third-party advertising cookies.
      </p>

      <h2>8. Security</h2>
      <p>
        We use industry-standard measures including TLS in transit, encryption of connected-account credentials at
        rest, and role-based access controls. No system is perfectly secure; notify us immediately at the address
        below if you suspect unauthorized access to your account.
      </p>

      <h2>9. Changes</h2>
      <p>
        We may update this policy from time to time. Material changes will be announced via the Service or by
        email before they take effect.
      </p>

      <h2>10. Contact</h2>
      <p>
        Privacy questions or requests: <a href="mailto:info@affivault.com">info@affivault.com</a>.
      </p>
    </LegalShell>
  );
}

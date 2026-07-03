import { LegalShell } from './LegalShell';

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="July 3, 2026">
      <p>
        These Terms of Service ("<strong>Terms</strong>") govern your access to and use of Sincerely — the
        cold-email outreach platform available at <a href="https://usesincerely.com">usesincerely.com</a> (the
        "<strong>Service</strong>"). By creating an account or using the Service you agree to these Terms. If you
        are using the Service on behalf of a company, you represent that you have authority to bind that company,
        and "you" refers to that company.
      </p>

      <h2>1. The Service</h2>
      <p>
        Sincerely provides tools for sending email campaigns from email accounts you connect, including sequence
        automation, inbox management, reply classification ("SARA"), analytics, and related features. You send
        email through your own connected email accounts (SMTP/IMAP); Sincerely is not the sender of your email
        and does not provide you with email addresses or sending infrastructure of its own.
      </p>

      <h2>2. Your Account</h2>
      <ul>
        <li>You must provide accurate information and keep your credentials secure. You are responsible for all activity under your account.</li>
        <li>You must be at least 18 years old and legally able to enter into contracts.</li>
        <li>You are responsible for the security of the email accounts you connect and confirm you are authorized to use them.</li>
      </ul>

      <h2>3. Acceptable Use — Anti-Spam</h2>
      <p>
        You are the sender of every email dispatched through the Service, and <strong>you are solely responsible for
        complying with all laws that apply to your messages</strong>, including (as applicable) the CAN-SPAM Act, the
        GDPR and ePrivacy rules, PECR, CASL, and equivalent laws in any jurisdiction you send to. In particular you agree to:
      </p>
      <ul>
        <li>Send only to recipients you have a lawful basis to contact.</li>
        <li>Identify yourself truthfully — no false or misleading sender names, subject lines, or header information.</li>
        <li>Honor opt-outs promptly and maintain your suppression list.</li>
        <li>Include any sender-identification information required by law in your messages.</li>
        <li>Not send content that is illegal, deceptive, fraudulent, harassing, or malicious (including phishing or malware).</li>
        <li>Not use purchased, scraped, or harvested lists of recipients who have no relationship with you where doing so is unlawful.</li>
      </ul>
      <p>
        We may suspend or terminate accounts that generate excessive bounces or spam complaints, or that we
        reasonably believe violate this section, with or without notice.
      </p>

      <h2>4. Plans, Billing &amp; Trials</h2>
      <ul>
        <li>Paid plans are billed in advance on a monthly or annual basis via our payment processor, Stripe. Prices are shown at checkout.</li>
        <li>Plan limits (such as connected inboxes and monthly email volume) are enforced by the Service and described on the billing page.</li>
        <li>New paid subscriptions may include a free trial (currently 10 days). A payment method is required; if you do not cancel before the trial ends, the subscription begins and your payment method is charged. Trials are limited to one per customer.</li>
        <li>Plan changes take effect immediately and are prorated. Subscriptions renew automatically until canceled.</li>
        <li>You can cancel anytime from the billing page ("Manage billing"); your plan remains active until the end of the paid period. Except where required by law, payments are non-refundable.</li>
        <li>We may change prices with at least 30 days' notice; changes apply from your next renewal.</li>
      </ul>

      <h2>5. Your Content &amp; Data</h2>
      <p>
        You retain all rights to the content you create and the contact data you upload. You grant us a limited
        license to host and process that content solely to operate the Service. You are responsible for having the
        right to upload and use your contact data. Our handling of personal data is described in the{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>6. Termination &amp; Account Deletion</h2>
      <p>
        You may delete your account at any time from Settings; deletion cancels any active subscription and
        permanently removes your data from the Service. We may suspend or terminate your access for breach of
        these Terms. Sections that by their nature should survive termination (including limitation of liability)
        survive.
      </p>

      <h2>7. Disclaimers</h2>
      <p>
        The Service is provided "as is" and "as available" without warranties of any kind, express or implied. We
        do not warrant that email sent through the Service will be delivered, reach the inbox, or achieve any
        particular result, and we are not responsible for the actions of your email providers or recipients'
        mail systems.
      </p>

      <h2>8. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, neither party is liable for indirect, incidental, special,
        consequential, or punitive damages, or lost profits, revenue, or data. Our total aggregate liability
        arising out of or relating to the Service is limited to the amounts you paid us in the 12 months before
        the event giving rise to the claim. Nothing in these Terms excludes liability that cannot be excluded by law.
      </p>

      <h2>9. Indemnity</h2>
      <p>
        You will indemnify and hold us harmless from claims arising out of your content, your recipient lists,
        or your violation of law (including anti-spam and data-protection law) or of these Terms.
      </p>

      <h2>10. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be notified via the Service or by
        email at least 14 days before they take effect. Continued use after the effective date constitutes acceptance.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about these Terms: <a href="mailto:info@affivault.com">info@affivault.com</a>.
      </p>
    </LegalShell>
  );
}

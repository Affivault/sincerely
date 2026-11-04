import { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Copy, ExternalLink, Send, ShieldCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Gmail and Google Workspace, connected with an app password.

   Google still accepts app passwords for Gmail and Workspace (with 2-Step
   Verification on), at no cost. Signing in with Google instead would need
   Google's paid yearly security review for full mail access, so this makes
   the app-password way as easy as it can be:

   - each Google page opens already signed in as the address being
     connected (?authuser=), so nobody creates a password on the wrong
     account - the commonest reason it fails;
   - the 16 letters can be pasted with Google's spaces; they are removed,
     and the field counts to 16;
   - Workspace accounts get the two admin switches, ready to send.
   ═══════════════════════════════════════════════════════════════════════ */

export function isGooglePreset(name: string | null | undefined): boolean {
  return name === 'Gmail' || name === 'Google Workspace';
}

const authuser = (email: string) => (/@/.test(email) ? `?authuser=${encodeURIComponent(email.trim())}` : '');

/** Google shows app passwords as "abcd efgh ijkl mnop"; only the letters count. */
export function cleanAppPassword(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export function GoogleAppPasswordGuide({ email, password, workspace }: { email: string; password: string; workspace: boolean }) {
  const [adminOpen, setAdminOpen] = useState(false);
  const letters = cleanAppPassword(password).length;
  const steps = [
    {
      title: 'Turn on 2-Step Verification',
      body: 'App passwords only appear once it is on. Skip this if it already is.',
      link: { label: 'Open 2-Step Verification', url: `https://myaccount.google.com/signinoptions/twosv${authuser(email)}` },
    },
    {
      title: 'Create an app password called "Sincerely"',
      body: 'Google shows 16 letters in four groups. Copy them.',
      link: { label: 'Open App passwords', url: `https://myaccount.google.com/apppasswords${authuser(email)}` },
    },
    {
      title: 'Paste them here',
      body: letters === 0 ? 'Spaces are fine - they are removed for you.' : letters === 16 ? 'That is all 16 letters.' : `${letters} of 16 letters so far.`,
      link: null,
      done: letters === 16,
    },
  ];
  return (
    <div className="rounded-xl border border-[var(--indigo)]/15 bg-[var(--indigo-subtle)]/40 p-3.5" data-google-guide>
      <p className="flex items-center gap-1.5 text-caption font-semibold text-[var(--text-primary)]">
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--indigo-text)]" /> Connecting {workspace ? 'Google Workspace' : 'Gmail'} with an app password
      </p>
      <ol className="mt-2.5 space-y-2.5">
        {steps.map((st, i) => (
          <li key={st.title} className="flex gap-2.5">
            <span className={cn(
              'mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-micro font-bold',
              st.done ? 'bg-emerald-500 text-white' : 'bg-[var(--bg-surface)] text-[var(--indigo-text)]',
            )}>
              {st.done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-caption font-semibold text-[var(--text-primary)]">{st.title}</p>
              <p className="text-caption leading-snug text-[var(--text-secondary)]">{st.body}</p>
              {st.link && (
                <a href={st.link.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-caption font-semibold text-[var(--indigo-text)] hover:underline" data-google-link>
                  {st.link.label} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-caption leading-snug text-[var(--text-tertiary)]">
        {/@/.test(email) ? <>The links open as <strong className="font-semibold text-[var(--text-secondary)]">{email.trim()}</strong>, so the password is made for the right account. </> : null}
        Your normal Google password will not work here.
      </p>
      {workspace && (
        <div className="mt-2.5 border-t border-[var(--border-subtle)] pt-2.5">
          <p className="text-caption leading-snug text-[var(--text-secondary)]">
            <strong className="font-semibold text-[var(--text-primary)]">No App passwords page?</strong> Your Workspace admin has 2-Step Verification or IMAP switched off for the organisation.
          </p>
          <button type="button" onClick={() => setAdminOpen(true)} className="mt-1 inline-flex items-center gap-1 text-caption font-semibold text-[var(--indigo-text)] hover:underline" data-google-admin>
            <Send className="h-3 w-3" /> Steps for my Workspace admin
          </button>
          <GoogleAdminModal isOpen={adminOpen} onClose={() => setAdminOpen(false)} email={email} />
        </div>
      )}
    </div>
  );
}

/** For a Workspace admin. CRLF breaks, so the email-app version keeps its lines. */
export function googleAdminText(email: string): string {
  return [
    'Hi,',
    '',
    `I want to send email from ${email.trim() || 'my Google Workspace mailbox'} with Sincerely. It connects with an app password, which needs two settings an admin controls:`,
    '',
    '1. ALLOW 2-STEP VERIFICATION',
    'Admin console (admin.google.com) > Security > Authentication > 2-Step Verification > tick "Allow users to turn on 2-Step Verification" > Save.',
    '',
    '2. ALLOW IMAP',
    'Admin console > Apps > Google Workspace > Gmail > End User Access > "POP and IMAP access" > tick "Enable IMAP access for all users" > Save.',
    '',
    'If our organisation enforces security keys only, or uses Advanced Protection, app passwords are not available for that account.',
    '',
    'Changes can take up to an hour to apply. Thank you!',
  ].join('\r\n');
}

function GoogleAdminModal({ isOpen, onClose, email }: { isOpen: boolean; onClose: () => void; email: string }) {
  const [admin, setAdmin] = useState('');
  const text = googleAdminText(email);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied - paste it into a message to your admin'); } catch { toast.error('Could not copy; select the text and copy it'); }
  };
  const mailto = `mailto:${encodeURIComponent(admin.trim())}?subject=${encodeURIComponent('Please allow app passwords and IMAP for Sincerely')}&body=${encodeURIComponent(text)}`;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Steps for your Workspace admin" description="Two settings in the Google Admin console. Send them this; it takes a few minutes." size="lg">
      <div className="space-y-3">
        <input
          type="email"
          value={admin}
          onChange={(e) => setAdmin(e.target.value)}
          placeholder="admin@yourcompany.com"
          aria-label="Your Workspace admin's email"
          className="h-9 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15"
        />
        <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 font-sans text-caption leading-relaxed text-[var(--text-secondary)]">{text.replace(/\r\n/g, '\n')}</pre>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={copy}><Copy className="h-3.5 w-3.5" /> Copy text</button>
          <a className="btn-primary" href={mailto} onClick={() => setTimeout(onClose, 300)}><Send className="h-3.5 w-3.5" /> Open in my email app</a>
        </div>
      </div>
    </Modal>
  );
}

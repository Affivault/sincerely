import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ChevronDown, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { microsoftMailApi } from '../../api/smtp.api';
import { ProviderLogo } from './ProviderLogo';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   "Connect with Microsoft": an Outlook or Microsoft 365 mailbox signed in
   with Microsoft, no password or app password (migration 114).

   Microsoft no longer accepts passwords for Outlook.com and Hotmail and is
   retiring them for Microsoft 365, so for those mailboxes this is the way
   in, not an alternative. Shown large when the address is a Microsoft one,
   and as a single line otherwise.
   ═══════════════════════════════════════════════════════════════════════ */

const MICROSOFT_DOMAINS = /@(outlook|hotmail|live|msn|passport)\.[a-z.]+$/i;

export function looksMicrosoft(email: string | null | undefined, presetName?: string | null): boolean {
  return MICROSOFT_DOMAINS.test(String(email || '').trim()) || /outlook|microsoft|office ?365|hotmail/i.test(String(presetName || ''));
}

export function useMicrosoftMail() {
  return useQuery({ queryKey: ['mailbox-oauth'], queryFn: microsoftMailApi.status, staleTime: 60_000, retry: false, meta: { silentError: true } });
}

export function useConnectMicrosoft() {
  return useMutation({
    mutationFn: (email?: string) => microsoftMailApi.authorize(email),
    onSuccess: ({ url }) => { window.location.href = url; },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not start connecting with Microsoft'),
  });
}

export function MicrosoftConnectButton({ email, label = 'Connect with Microsoft', className }: { email?: string; label?: string; className?: string }) {
  const connect = useConnectMicrosoft();
  return (
    <button
      type="button"
      onClick={() => connect.mutate(email)}
      disabled={connect.isPending}
      className={cn('btn-secondary', className)}
      data-connect-microsoft
    >
      {connect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ProviderLogo name="Outlook / Microsoft 365" className="h-4 w-4" />}
      {label}
    </button>
  );
}

/** In the add-mailbox flow. Nothing at all when the deployment has no Microsoft app. */
export function MicrosoftConnectCard({ email, highlighted }: { email?: string; highlighted: boolean }) {
  const { data } = useMicrosoftMail();
  const [guide, setGuide] = useState(false);
  if (!data?.microsoft) return null;
  const hint = email && /@/.test(email) ? email.trim() : undefined;
  if (!highlighted) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5" data-microsoft-connect="slim">
        <ProviderLogo name="Outlook / Microsoft 365" className="h-4 w-4" />
        <p className="flex-1 min-w-[200px] text-caption text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">Outlook or Microsoft 365?</span> Sign in with Microsoft instead - no app password.
        </p>
        <MicrosoftConnectButton email={hint} className="h-8" />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--indigo)]/30 bg-[var(--indigo-subtle)]/50 p-4" data-microsoft-connect="highlighted">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <ProviderLogo name="Outlook / Microsoft 365" />
        </span>
        <div className="flex-1 min-w-[220px]">
          <p className="text-body font-semibold text-[var(--text-primary)]">Sign in with Microsoft</p>
          <p className="mt-0.5 text-caption leading-relaxed text-[var(--text-secondary)]">
            The way to connect Outlook, Hotmail and Microsoft 365 now: Microsoft no longer accepts passwords for them. Sign in once and Sincerely sends, syncs replies and warms up with it.
          </p>
          <p className="mt-1.5 flex items-start gap-1.5 text-caption text-[var(--text-tertiary)]">
            <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 mt-px" /> Sincerely can send mail and read this inbox - nothing in your OneDrive, calendar or contacts.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setGuide((o) => !o)}
          aria-expanded={guide}
          className="inline-flex items-center gap-1 text-caption font-medium text-[var(--indigo-text)] hover:underline"
          data-microsoft-guide-toggle
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', guide && 'rotate-180')} />
          {guide ? 'Hide the guide' : 'Step-by-step guide, and what to check first'}
        </button>
        <MicrosoftConnectButton email={hint} className="btn-primary" />
      </div>
      {guide && <MicrosoftConnectGuide />}
    </div>
  );
}

/* ── The step-by-step guide ──────────────────────────────────────────── */

/**
 * How to connect an Outlook or Microsoft 365 mailbox for cold email, in the
 * order it happens, then what to set up so the mail lands, then what the
 * two common failures mean.
 */
export function MicrosoftConnectGuide() {
  return (
    <div className="mt-3 space-y-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-caption leading-relaxed text-[var(--text-secondary)]" data-microsoft-guide>
      <section>
        <p className="mb-1.5 text-body font-semibold text-[var(--text-primary)]">Connecting, step by step</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Click <strong className="text-[var(--text-primary)]">Connect with Microsoft</strong> and choose the account you want to send from.</li>
          <li>Microsoft asks whether Sincerely may send mail and read the inbox. Click <strong className="text-[var(--text-primary)]">Accept</strong>.</li>
          <li>You come back to Sincerely. It sends a test message to the mailbox itself and signs in to the inbox; when both work, the mailbox is ready for campaigns.</li>
        </ol>
      </section>
      <section>
        <p className="mb-1.5 text-body font-semibold text-[var(--text-primary)]">Work or school accounts (Microsoft 365)</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            The mailbox needs <strong className="text-[var(--text-primary)]">Authenticated SMTP</strong> and <strong className="text-[var(--text-primary)]">IMAP</strong> switched on. An admin does this in the Microsoft 365 admin centre:
            Users &gt; Active users &gt; the person &gt; Mail &gt; Manage email apps &gt; tick both &gt; Save. It can take up to an hour to apply.
          </li>
          <li>If Microsoft says <em>Need admin approval</em>, your IT admin approves Sincerely once for the organisation, then everyone can connect.</li>
        </ul>
      </section>
      <section>
        <p className="mb-1.5 text-body font-semibold text-[var(--text-primary)]">For cold email that lands</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Send from a Microsoft 365 mailbox on your own domain. Free Outlook.com and Hotmail addresses have low daily limits and are blocked quickly for cold outreach.</li>
          <li>Authenticate the domain under Email accounts &gt; Domains: SPF must include <code className="rounded bg-[var(--bg-elevated)] px-1">include:spf.protection.outlook.com</code>, switch DKIM on in Microsoft Defender (Email authentication settings &gt; DKIM), and add DMARC.</li>
          <li>New mailboxes start at 40 emails a day with warm-up available. Keep it at 20 to 40 for the first two to three weeks, and add mailboxes rather than pushing one hard.</li>
        </ul>
      </section>
      <section>
        <p className="mb-1.5 text-body font-semibold text-[var(--text-primary)]">If something goes wrong</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><em>Authenticated SMTP is switched off</em>: the admin step above.</li>
          <li><em>Reconnect with Microsoft</em> on a mailbox: its access was removed or the account password changed. Click it and sign in again; nothing else is lost.</li>
        </ul>
      </section>
    </div>
  );
}

/* ── Signed in with Microsoft? Send from that mailbox too ────────────── */

/**
 * Someone who signs in to Sincerely with Microsoft usually sends from that
 * same mailbox. When it is not connected yet, offer it in one click.
 */
export function SuggestMicrosoftMailbox({ connected }: { connected: string[] }) {
  const { user } = useAuth();
  const { data } = useMicrosoftMail();
  const identity = (user?.identities || []).find((i) => i.provider === 'azure');
  const email = String((identity?.identity_data as any)?.email || '').trim().toLowerCase();
  if (!data?.microsoft || !email || connected.some((c) => c.toLowerCase() === email)) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[var(--indigo)]/25 bg-[var(--indigo-subtle)]/40 px-4 py-3" data-suggest-microsoft>
      <ProviderLogo name="Outlook / Microsoft 365" className="h-5 w-5" />
      <p className="flex-1 min-w-[220px] text-body text-[var(--text-secondary)]">
        You sign in with Microsoft as <strong className="font-semibold text-[var(--text-primary)]">{email}</strong>. Send campaigns from it too?
      </p>
      <MicrosoftConnectButton email={email} label={`Connect ${email}`} className="btn-primary h-8" />
    </div>
  );
}

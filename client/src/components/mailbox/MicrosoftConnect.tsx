import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2, ShieldCheck } from 'lucide-react';
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
      <div className="mt-3 flex justify-end">
        <MicrosoftConnectButton email={hint} className="btn-primary" />
      </div>
    </div>
  );
}

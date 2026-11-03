import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, HelpCircle, Loader2, RefreshCw, ShieldCheck, X as XIcon } from 'lucide-react';
import { deepCheckSkipped, emailState, LIGHT_LABEL, STATE_LIGHT, type EmailState } from '@lemlist/shared';
import { verificationApi } from '../../api/verification.api';
import { cn, formatRelativeTime } from '../../lib/utils';
import { useFocusTrap } from '../../hooks/useFocusTrap';

/* ═══════════════════════════════════════════════════════════════════════
   "Why is this address amber?"

   The dot and the badge said a word - Risky, Unverified - and nothing
   else. This says what the word means for sending, which checks passed,
   who checked and when, and offers the one thing to do about it: check
   again. Used on the list and in the person's side panel.
   ═══════════════════════════════════════════════════════════════════════ */

const STATE_WORD: Record<EmailState, string> = {
  valid: 'Valid', risky: 'Risky', unverified: 'Unverified', invalid: 'Invalid',
  not_found: 'Not found', bounced: 'Bounced', no_email: 'No email',
};

const MEANS: Record<EmailState, string> = {
  valid: 'The mailbox exists and accepts mail. Safe to send to.',
  risky: 'The domain accepts mail for any address (catch-all), or the mailbox could not be confirmed. Usually a real person; some bounce.',
  unverified: 'Not checked yet. Campaigns that only send to verified addresses check it (free) before the first email.',
  invalid: 'The address is malformed or the mailbox rejects mail. Sending would bounce.',
  not_found: 'The domain has no mail server, so nothing can be delivered to it.',
  bounced: 'An email to this address bounced. It is kept out of campaigns so it cannot hurt your sending domain.',
  no_email: 'There is no address to check.',
};

const BY: Record<string, string> = {
  icypeas: 'Icypeas mailbox check',
  mail_server: 'Their mail server',
  dns: 'Address and domain only (the mail server could not be reached)',
};

const DOT: Record<string, string> = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', none: 'bg-slate-400' };

function Check3({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-caption text-[var(--text-secondary)]">
      {ok === true ? <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} />
        : ok === false ? <XIcon className="h-3 w-3 text-rose-500" strokeWidth={3} />
          : <HelpCircle className="h-3 w-3 text-[var(--text-tertiary)]" />}
      {label}
    </span>
  );
}

export interface EmailStatusFields {
  id: string;
  email?: string | null;
  is_bounced?: boolean | null;
  dcs_verified_at?: string | null;
  dcs_score?: number | null;
  dcs_syntax_ok?: boolean | null;
  dcs_domain_ok?: boolean | null;
  dcs_smtp_ok?: boolean | null;
  dcs_fail_reason?: string | null;
  email_verified_by?: string | null;
}

/**
 * Wraps a trigger (the dot or the badge). Clicking it opens the
 * explanation instead of the row underneath.
 */
export function EmailStatusPopover({ c, children, className }: { c: EmailStatusFields; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const qc = useQueryClient();
  // Keyboard focus stays inside while it is open, and goes back to the dot after.
  useFocusTrap(panel, open);

  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const W = 300;
    const H = panel.current?.offsetHeight || 260;
    const above = r.bottom + H + 12 > window.innerHeight && r.top > H + 12;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), window.innerWidth - W - 8);
    setPos({ top: above ? r.top - H - 6 : r.bottom + 6, left, above });
  }, []);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || trigger.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    const move = () => place();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', move, true);
    window.addEventListener('resize', move);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc, true);
      window.removeEventListener('scroll', move, true);
      window.removeEventListener('resize', move);
    };
  }, [open, place]);

  const verify = useMutation({
    mutationFn: () => verificationApi.verifyContact(c.id),
    onSuccess: (r) => {
      if (r.deep_skipped === 'no_credits') toast(deepCheckSkipped(), { icon: 'ℹ️' });
      else toast.success(`Checked: ${r.score}/100`);
      for (const k of ['contacts', 'contact-stats', 'verification-breakdown']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Verification failed'),
  });

  const state = emailState(c);
  const light = STATE_LIGHT[state];
  const checked = !!c.dcs_verified_at;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Email status: ${STATE_WORD[state]}. Show details`}
        className={cn('inline-flex items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--indigo)]/40', className)}
        data-email-status
      >
        {children}
      </button>
      {open && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label="Email status"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[70] w-[300px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-xl)] animate-fade-in"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
          data-email-status-panel
        >
          <div className="px-3.5 pt-3 pb-2.5 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full', DOT[light])} />
              <span className="text-strong font-semibold text-[var(--text-primary)]">{STATE_WORD[state]}</span>
              <span className="text-caption text-[var(--text-tertiary)]">· {LIGHT_LABEL[light]}</span>
              {typeof c.dcs_score === 'number' && checked && (
                <span className="ml-auto text-caption font-semibold tabular text-[var(--text-secondary)]">{c.dcs_score}/100</span>
              )}
            </div>
            <p className="mt-1 text-caption leading-relaxed text-[var(--text-secondary)]">{MEANS[state]}</p>
          </div>

          {checked && (
            <div className="px-3.5 py-2.5 space-y-2 border-b border-[var(--border-subtle)]">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <Check3 ok={c.dcs_syntax_ok} label="Format" />
                <Check3 ok={c.dcs_domain_ok} label="Mail server" />
                <Check3 ok={c.email_verified_by === 'dns' ? null : c.dcs_smtp_ok} label="Mailbox" />
              </div>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-caption">
                <dt className="text-[var(--text-tertiary)]">Checked</dt>
                <dd className="text-[var(--text-primary)]" title={c.dcs_verified_at || undefined}>{formatRelativeTime(c.dcs_verified_at!)}</dd>
                {c.email_verified_by && (<>
                  <dt className="text-[var(--text-tertiary)]">By</dt>
                  <dd className="text-[var(--text-primary)]">{BY[c.email_verified_by] || c.email_verified_by}</dd>
                </>)}
                {c.dcs_fail_reason && (<>
                  <dt className="text-[var(--text-tertiary)]">Detail</dt>
                  <dd className="text-[var(--text-primary)]">{c.dcs_fail_reason}</dd>
                </>)}
              </dl>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
            <span className="text-caption text-[var(--text-tertiary)] truncate">{c.email}</span>
            {state !== 'no_email' && (
              <button
                type="button"
                onClick={() => verify.mutate()}
                disabled={verify.isPending}
                className="btn-secondary flex-shrink-0"
                data-verify-again
              >
                {verify.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : checked ? <RefreshCw className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                {verify.isPending ? 'Checking...' : checked ? 'Verify again' : 'Verify now'}
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

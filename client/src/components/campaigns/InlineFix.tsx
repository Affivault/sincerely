import { lazy, Suspense, useState } from 'react';
import { Check, Loader2, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import type { InlineFixKind, ReadinessCheck } from '@lemlist/shared';
import { smtpApi } from '../../api/smtp.api';
import { domainApi } from '../../api/domain.api';
import { trackingDomainApi } from '../../api/tracking-domain.api';
import { settingsApi } from '../../api/settings.api';

// The connect wizard is large and needed only when this row says so.
const SmtpAccountModal = lazy(() =>
  import('../../pages/smtp/SmtpAccountModal').then((m) => ({ default: m.SmtpAccountModal })));

/* ═══════════════════════════════════════════════════════════════════════
   The fix, where the problem is.

   The preflight used to end every row with a link to a settings page -
   correct, and it walked someone away from the Launch button they had just
   pressed, into a page with no memory of why they came. The fixes that are
   one action and nothing else from the person run here instead, and the
   dialog re-reads the report afterwards so the row changes in front of
   them.

   Which checks qualify is decided by the server (`fix.inline`), next to
   the logic that knows what is wrong, not guessed here from a headline.
   ═══════════════════════════════════════════════════════════════════════ */

type Outcome = { ok: boolean; message: string };

async function runFix(kind: Exclude<InlineFixKind, 'connect_mailbox'>): Promise<Outcome> {
  switch (kind) {
    case 'test_mailboxes': {
      const accounts = await smtpApi.list();
      const untested = accounts.filter((a) => !a.is_verified);
      if (untested.length === 0) return { ok: true, message: 'Every mailbox has passed its test' };
      const results = await Promise.allSettled(untested.map((a) => smtpApi.test(a.id)));
      const passed = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
      if (passed === untested.length) {
        return { ok: true, message: passed === 1 ? 'Mailbox passed its test' : `All ${passed} mailboxes passed` };
      }
      const first = results.find((r) => r.status === 'fulfilled' && !r.value.success);
      const why = first && first.status === 'fulfilled' ? first.value.message : 'the connection was refused';
      return { ok: passed > 0, message: `${passed} of ${untested.length} passed - ${why}` };
    }
    case 'recheck_domains': {
      const domains = await domainApi.list();
      const unsettled = domains.filter((d: any) => !(d.is_verified && d.spf_ok && d.dkim_ok && d.dmarc_ok));
      if (unsettled.length === 0) {
        return { ok: false, message: 'Add the sending domain first - there is nothing to re-check yet' };
      }
      const results = await Promise.allSettled(unsettled.map((d: any) => domainApi.verify(d.id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      return failed === results.length
        ? { ok: false, message: 'Could not reach DNS just now' }
        : { ok: true, message: 'DNS re-read' };
    }
    case 'verify_tracking': {
      const res = await trackingDomainApi.verify();
      return res.verified
        ? { ok: true, message: `${res.domain} is live` }
        : { ok: false, message: res.checks.find((c) => !c.ok)?.detail || 'Not passing yet - DNS can take a while' };
    }
    case 'enable_bounce_guard': {
      await settingsApi.update({ bounce_guard_enabled: true });
      return { ok: true, message: 'Bounce guard on' };
    }
  }
}

export function InlineFix({ check, onFixed }: { check: ReadinessCheck; onFixed: () => void }) {
  const kind = check.fix?.inline;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [connecting, setConnecting] = useState(false);

  if (!kind || check.status === 'pass') return null;

  const run = async () => {
    if (kind === 'connect_mailbox') { setConnecting(true); return; }
    setBusy(true);
    try {
      const out = await runFix(kind);
      if (out.ok) { toast.success(out.message); setDone(true); }
      else toast.error(out.message);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'That did not work - the link beside it has the full page');
    } finally {
      setBusy(false);
      // Re-read whatever happened: a partial pass still changes the row.
      onFixed();
    }
  };

  const label = kind === 'recheck_domains' ? 'Check again' : check.fix!.label;

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        data-inline-fix={kind}
        className="mt-[1px] inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-[var(--indigo)] px-2 py-1 text-caption font-semibold text-white hover:bg-[var(--indigo-hover)] disabled:opacity-60 transition-colors"
      >
        {busy
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : done ? <Check className="h-3 w-3" strokeWidth={3} /> : <Wrench className="h-3 w-3" />}
        {label}
      </button>
      {connecting && (
        <Suspense fallback={null}>
          <SmtpAccountModal
            open
            onClose={() => { setConnecting(false); onFixed(); }}
            onConnected={() => { setDone(true); onFixed(); }}
          />
        </Suspense>
      )}
    </>
  );
}

/** Whether a check's link is redundant next to its in-place fix. */
export function inlineReplacesLink(check: ReadinessCheck): boolean {
  const kind = check.fix?.inline;
  // DNS records are changed at the registrar, so "Check again" sits beside
  // the link to them rather than instead of it.
  return !!kind && kind !== 'recheck_domains';
}

import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi } from '../../api/campaigns.api';
import type { ReadinessReport } from '@lemlist/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CheckRow } from '../delivery/ReadinessPanel';
import { AlertTriangle, Rocket, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   The last thing between a draft and several thousand emails.

   Sincerely has known how to answer "am I safe to send?" for a while. It
   answered on a settings page — the one page nobody is on in the second
   before pressing Launch. There are three ways to launch a campaign and
   only one of them ever mentioned it, so the usual way to find out the
   domain was unauthenticated was the bounce report.

   The server decides, not this dialog. It refuses a blocked launch outright
   and a risky one once, and this is what that refusal looks like. Two
   states, and the difference matters:

     blocked  nothing can be sent. No override, because there is nothing to
              consent to — a campaign with no verified mailbox does not send
              a worse email, it sends no email.
     risky    it will send, and it will cost something. That is a real
              decision, and it belongs to the person making it — but made
              once, in front of the reasons, rather than by default.
   ═══════════════════════════════════════════════════════════════════════ */

export type Refusal = { report: ReadinessReport; kind: 'blocked' | 'risky' };

/**
 * Launch a campaign, showing the preflight when the server asks for it.
 *
 * Every launch button on the platform goes through this, so the check
 * cannot be forgotten by whichever page adds the next one.
 */
export function useLaunchPreflight(options?: { onLaunched?: () => void }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<{ id: string; name?: string } | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const done = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['campaigns'] });
    qc.invalidateQueries({ queryKey: ['campaign'] });
    qc.invalidateQueries({ queryKey: ['readiness'] });
    qc.invalidateQueries({ queryKey: ['setup-state'] });
    options?.onLaunched?.();
  }, [qc, options]);

  const launch = useMutation({
    mutationFn: ({ id, acknowledge }: { id: string; acknowledge: boolean }) =>
      campaignsApi.launch(id, acknowledge),
    onSuccess: () => {
      setRefusal(null);
      setPending(null);
      toast.success('Campaign launched');
      done();
    },
    onError: (err: any) => {
      const status = err?.response?.status;
      const report: ReadinessReport | undefined = err?.response?.data?.readiness;

      // 422 and 409 are the preflight talking. Anything else is an ordinary
      // failure and should read as one.
      if (report && (status === 422 || status === 409)) {
        setRefusal({ report, kind: status === 422 ? 'blocked' : 'risky' });
        return;
      }
      setPending(null);
      toast.error(err?.response?.data?.error || 'Could not launch this campaign');
    },
  });

  const start = useCallback((id: string, name?: string) => {
    setPending({ id, name });
    setRefusal(null);
    launch.mutate({ id, acknowledge: false });
  }, [launch]);

  const dismiss = useCallback(() => {
    setRefusal(null);
    setPending(null);
  }, []);

  const proceed = useCallback(() => {
    if (!pending) return;
    launch.mutate({ id: pending.id, acknowledge: true });
  }, [launch, pending]);

  const dialog = refusal ? (
    <PreflightDialog
      refusal={refusal}
      campaignName={pending?.name}
      busy={launch.isPending}
      onClose={dismiss}
      onProceed={proceed}
    />
  ) : null;

  return {
    launch: start,
    dialog,
    /** True while a specific campaign is being checked or launched. */
    isLaunching: (id: string) => launch.isPending && pending?.id === id,
    isPending: launch.isPending,
  };
}

export function PreflightDialog({
  refusal,
  campaignName,
  busy,
  onClose,
  onProceed,
}: {
  refusal: Refusal;
  campaignName?: string;
  busy: boolean;
  onClose: () => void;
  onProceed: () => void;
}) {
  const { report, kind } = refusal;
  const blocked = kind === 'blocked';

  // Only what is wrong. A launch dialog is not the place to read eleven
  // passing checks — the panel on the email accounts page is for that.
  const problems = report.checks.filter((c) => (blocked ? c.status === 'fail' : c.status !== 'pass'));

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={blocked ? 'This campaign cannot send yet' : 'Launch anyway?'}
      description={campaignName ? `Before launching ${campaignName}.` : undefined}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {blocked ? 'Close' : 'Not yet'}
          </Button>
          {!blocked && (
            <Button onClick={onProceed} disabled={busy}>
              {busy ? 'Launching…' : 'Launch anyway'}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3.5">
        <div
          className={cnBanner(blocked)}
        >
          {blocked
            ? <ShieldAlert className="mt-px h-4 w-4 flex-shrink-0" />
            : <AlertTriangle className="mt-px h-4 w-4 flex-shrink-0" />}
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold leading-snug">{report.summary}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed opacity-90">
              {blocked
                ? 'These have to be fixed first — with them unresolved nothing goes out at all, so there is nothing to override.'
                : 'This will send. These are the costs of sending it as things stand, so you are choosing them knowingly rather than finding out from the bounce rate.'}
            </p>
          </div>
        </div>

        <ul className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
          {problems.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>

        {!blocked && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            <Rocket className="mt-px h-3 w-3 flex-shrink-0" />
            Fixing these later still helps — the checks are re-read on every launch, and a domain that
            authenticates halfway through a campaign improves the rest of it.
          </p>
        )}
      </div>
    </Modal>
  );
}

function cnBanner(blocked: boolean): string {
  return [
    'flex items-start gap-2.5 rounded-xl px-3.5 py-3',
    blocked
      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
      : 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  ].join(' ');
}

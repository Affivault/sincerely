import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Check, Loader2, ShieldCheck } from 'lucide-react';
import { CREDIT_PRICES, LIGHT_LABEL, SEND_LIGHTS, creditsLabel, deepCheckSkipped, type SendLight } from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { verificationApi } from '../../api/verification.api';
import { LightDot, LightBar } from '../contacts/EmailLights';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Who a campaign emails, by traffic light - chosen at launch, in front of
   the numbers.

   Green only is the default because it is what protects a sending domain.
   Amber is a judgement call (catch-alls are often real people); red is
   almost always a mistake, so it says so. The sender checks the light
   before every email, so this is a promise kept, not a filter at the door.

   When under half the audience is verified, it says so and offers to
   check the unsure ones there and then, so "green only" is not a
   campaign that sends to almost nobody.
   ═══════════════════════════════════════════════════════════════════════ */

export function SendLightsPicker({ value, onChange, contactIds, compact }: {
  value: SendLight[];
  onChange: (next: SendLight[]) => void;
  /** The audience, for the counts. Omit to show the choice without them. */
  contactIds?: string[];
  compact?: boolean;
}) {
  const ids = contactIds || [];
  const qc = useQueryClient();
  const { data: counts } = useQuery({
    queryKey: ['light-counts', ids.length, ids.slice(0, 50).join(',')],
    queryFn: () => contactsApi.lightCounts(ids, { amberIds: !compact }),
    enabled: ids.length > 0,
    staleTime: 30_000,
  });
  const [checking, setChecking] = useState<{ done: number; of: number } | null>(null);
  const stop = useRef(false);

  // The unsure ones, 25 at a time (what one deep-check request handles),
  // with progress, stopping at the first "out of credits".
  const verifyUnsure = async () => {
    const todo = counts?.amber_ids || [];
    if (todo.length === 0) return;
    stop.current = false;
    let green = 0; let noCredits = 0; let done = 0;
    setChecking({ done: 0, of: todo.length });
    try {
      for (let i = 0; i < todo.length && !stop.current; i += 25) {
        const r = await verificationApi.batchVerify(todo.slice(i, i + 25));
        green += r.verified;
        done = Math.min(todo.length, i + 25);
        setChecking({ done, of: todo.length });
        if (r.no_credits) { noCredits += r.no_credits; break; }
      }
      toast.success(`Checked ${done.toLocaleString()}: ${green.toLocaleString()} now verified`);
      if (noCredits) toast(deepCheckSkipped(noCredits), { duration: 6000 });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Verification stopped');
    } finally {
      setChecking(null);
      for (const k of ['light-counts', 'contacts', 'verification-breakdown']) qc.invalidateQueries({ queryKey: [k] });
    }
  };

  const toggle = (l: SendLight) => {
    const next = value.includes(l) ? value.filter((x) => x !== l) : [...value, l];
    if (next.length > 0) onChange(SEND_LIGHTS.filter((x) => next.includes(x)));
  };

  const willSend = counts ? value.reduce((n, l) => n + (counts[l] || 0), 0) : null;
  const total = counts ? counts.green + counts.amber + counts.red : null;
  const amberUnchecked = counts?.unverified || 0;
  const unsure = counts?.amber_ids?.length || 0;
  const lowVerified = !compact && total != null && total >= 10 && counts!.green / total < 0.5 && unsure > 0;

  const DESC: Record<SendLight, string> = {
    green: 'Mailbox confirmed. Safe for your sending domain.',
    amber: 'Catch-all, risky or not checked yet. Usually real, some bounce.',
    red: 'Invalid, no mail server, or already bounced.',
  };

  return (
    <div className="space-y-3" data-send-lights>
      {!compact && (
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-body font-semibold text-[var(--text-primary)]">Who gets emails</p>
            <p className="text-caption text-[var(--text-tertiary)]">Pick by email health. Checked again before every send.</p>
          </div>
          {willSend != null && total != null && (
            <p className="text-right leading-tight">
              <span className="block text-title font-semibold tabular text-[var(--text-primary)]">{willSend.toLocaleString()}</span>
              <span className="text-caption text-[var(--text-tertiary)] tabular">of {total.toLocaleString()} will be emailed</span>
            </p>
          )}
        </div>
      )}

      {counts && !compact && (
        <LightBar counts={counts} lights={SEND_LIGHTS} dim={SEND_LIGHTS.filter((l) => !value.includes(l))} />
      )}

      <div role="group" aria-label="Email these lights" className="rounded-lg border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)] overflow-hidden">
        {SEND_LIGHTS.map((l) => {
          const on = value.includes(l);
          const n = counts ? counts[l] || 0 : null;
          return (
            <button
              key={l}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(l)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                on ? 'bg-[var(--bg-surface)]' : 'bg-[var(--bg-elevated)]/40 hover:bg-[var(--bg-hover)]',
              )}
              data-send-light={l}
            >
              <span className={cn(
                'flex h-4 w-4 items-center justify-center rounded border flex-shrink-0 transition-colors',
                on ? 'border-transparent bg-[var(--indigo)] text-white' : 'border-[var(--border-strong)] bg-[var(--bg-surface)]',
              )}>
                {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
              </span>
              <LightDot light={l} />
              <span className="flex-1 min-w-0">
                <span className={cn('flex items-center gap-2 text-body font-semibold', on ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
                  {LIGHT_LABEL[l]}
                  {l === 'green' && <span className="inline-flex items-center h-[18px] px-1.5 rounded bg-emerald-500/10 text-micro font-semibold text-emerald-700 dark:text-emerald-400">Recommended</span>}
                </span>
                <span className="block text-caption text-[var(--text-tertiary)] truncate">{DESC[l]}</span>
              </span>
              {n != null && (
                <span className={cn('text-body font-semibold tabular', on ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>{n.toLocaleString()}</span>
              )}
            </button>
          );
        })}
      </div>

      {(lowVerified || checking) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-amber-400/[0.10] px-2.5 py-2 text-caption text-amber-800 dark:text-amber-300" data-low-verified>
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1 min-w-[200px] leading-relaxed">
            {checking
              ? <>Checking {checking.done.toLocaleString()} of {checking.of.toLocaleString()}...</>
              : <>Only {Math.round((counts!.green / total!) * 100)}% of this audience is verified. Check the {unsure.toLocaleString()} unsure now - free checks first, the deep check (up to {creditsLabel(CREDIT_PRICES.verify * unsure)}) only where they cannot settle it.</>}
          </span>
          {checking ? (
            <button type="button" className="btn-secondary h-7" onClick={() => { stop.current = true; }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Stop
            </button>
          ) : (
            <button type="button" className="btn-primary h-7" onClick={verifyUnsure} data-verify-unsure>
              <ShieldCheck className="h-3.5 w-3.5" /> Verify {unsure.toLocaleString()} now
            </button>
          )}
        </div>
      )}

      {counts && value.length === 1 && value[0] === 'green' && counts.green === 0 && total ? (
        <Callout tone="warn" data-no-green>
          Nobody in this audience is verified yet, so nothing would be sent. Verify them first{unsure > 0 ? ' (the button above)' : ' (Leads, select, Verify emails)'}, or include Unsure.
        </Callout>
      ) : value.includes('red') ? (
        <Callout tone="danger">Bad addresses bounce, and bounces are what get a sending domain blocked. Only include them if you know better than the check.</Callout>
      ) : !value.includes('amber') && amberUnchecked > 0 ? (
        <Callout tone="ok">{amberUnchecked.toLocaleString()} not checked yet: each is verified free before its first email and sent only if it comes back verified.</Callout>
      ) : value.includes('amber') ? (
        <Callout tone="warn">Unsure addresses are sent. Most are real people; a few will bounce.</Callout>
      ) : null}
    </div>
  );
}

function Callout({ tone, children, ...rest }: { tone: 'ok' | 'warn' | 'danger'; children: React.ReactNode } & Record<string, unknown>) {
  const Icon = tone === 'ok' ? ShieldCheck : AlertTriangle;
  return (
    <p
      {...rest}
      className={cn(
        'flex items-start gap-2 rounded-md px-2.5 py-2 text-caption leading-relaxed',
        tone === 'ok' && 'bg-emerald-500/[0.07] text-emerald-800 dark:text-emerald-300',
        tone === 'warn' && 'bg-amber-400/[0.10] text-amber-800 dark:text-amber-300',
        tone === 'danger' && 'bg-rose-500/[0.08] text-rose-800 dark:text-rose-300',
      )}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
      <span>{children}</span>
    </p>
  );
}

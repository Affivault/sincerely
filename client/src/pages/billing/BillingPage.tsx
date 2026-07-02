import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/shared/PageHeader';
import { SettingsShell } from '../../components/shared/SettingsShell';
import { billingApi } from '../../api/billing.api';
import { PLANS, isUnlimited, type PlanId } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { CreditCard, Mail, Inbox, Check, Sparkles, Zap, Building2, ExternalLink } from 'lucide-react';

// Customer-facing plans, in display order. (Trial is internal-only.)
const DISPLAY_PLANS: PlanId[] = ['starter', 'growth', 'scale'];
type Interval = 'monthly' | 'annual';

function fmtLimit(n: number): string {
  return isUnlimited(n) ? 'Unlimited' : n.toLocaleString();
}

/** A dashboard-grade usage tile: big number, quiet unit, thin progress track. */
function UsageMeter({ icon: Icon, label, used, limit }: {
  icon: React.ElementType; label: string; used: number; limit: number;
}) {
  const unlimited = isUnlimited(limit);
  const pct = unlimited ? 0 : Math.min(100, limit > 0 ? (used / limit) * 100 : 0);
  // Restrained by default; the meter only warms as a functional signal near the cap.
  const color = pct >= 90 ? '#EF4444' : pct >= 75 ? '#F59E0B' : 'var(--indigo)';
  const remaining = unlimited ? null : Math.max(0, limit - used);

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
        <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} style={{ color: 'var(--indigo)' }} />
        <span className="text-[12.5px] font-medium truncate">{label}</span>
        {!unlimited && (
          <span className="ml-auto text-[11.5px] font-medium tabular text-[var(--text-tertiary)] flex-shrink-0">
            {Math.round(pct)}%
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[28px] font-semibold text-[var(--text-primary)] tabular leading-none tracking-[-0.03em]">
          {used.toLocaleString()}
        </span>
        <span className="text-[13px] text-[var(--text-tertiary)]">/ {fmtLimit(limit)}</span>
      </div>

      <div className="mt-3 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        {unlimited
          ? <div className="h-full w-full rounded-full bg-[var(--indigo)] opacity-25" />
          : <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />}
      </div>
      <p className="mt-2 text-[11.5px] text-[var(--text-tertiary)] truncate">
        {unlimited ? 'Unlimited on your plan' : `${remaining!.toLocaleString()} remaining this month`}
      </p>
    </div>
  );
}

export function BillingPage() {
  const [interval, setInterval] = useState<Interval>('monthly');
  const [busy, setBusy] = useState<PlanId | 'portal' | null>(null);

  const queryClient = useQueryClient();
  const { data: usage, isLoading } = useQuery({
    queryKey: ['billing', 'usage'],
    queryFn: billingApi.usage,
  });

  // Toast + refresh plan on return from Stripe Checkout (so the nag clears once paid).
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('status');
    if (status === 'success') {
      toast.success('Subscription started — welcome aboard!');
      queryClient.invalidateQueries({ queryKey: ['billing', 'usage'] });
    } else if (status === 'cancel') {
      toast('Checkout canceled.', { icon: '↩️' });
    }
    if (status) window.history.replaceState({}, '', '/billing');
  }, [queryClient]);

  const onUpgrade = async (planId: PlanId) => {
    if (busy) return;
    if (planId === 'scale') {
      window.location.href = 'mailto:info@affivault.com?subject=Sincerely%20Scale%20plan';
      return;
    }
    if (planId !== 'starter' && planId !== 'growth') return;
    setBusy(planId);
    try {
      const { url } = await billingApi.checkout(planId, interval);
      if (typeof url !== 'string' || !url) throw new Error('No checkout URL returned');
      window.location.href = url;
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not start checkout. Please try again.');
      setBusy(null);
    }
  };

  const onManageBilling = async () => {
    if (busy) return;
    setBusy('portal');
    try {
      const { url } = await billingApi.portal();
      if (typeof url !== 'string' || !url) throw new Error('No portal URL returned');
      window.location.href = url;
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not open the billing portal.');
      setBusy(null);
    }
  };

  const currentPlan = usage?.plan;
  const isTrialing = usage?.status === 'trialing';
  const renewLabel = usage?.currentPeriodEnd
    ? new Date(usage.currentPeriodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <SettingsShell>
    <div>
      <PageHeader
        className="!mx-0 !mt-0 rounded-xl border border-[var(--border-subtle)]"
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <CreditCard className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Billing & Usage"
        description="Your plan, this month's usage, and upgrade options."
        actions={
          usage?.hasBilling && (
            <button
              onClick={onManageBilling}
              disabled={busy === 'portal'}
              className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {busy === 'portal' ? 'Opening…' : 'Manage billing'}
            </button>
          )
        }
      />

      {/* Current plan summary */}
      <div className="panel p-5 mb-4">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-[var(--text-tertiary)]">Current plan</p>
            <div className="mt-1 flex items-center gap-2.5">
              <h3 className="text-[24px] font-semibold text-[var(--text-primary)] tracking-[-0.02em] leading-none">
                {usage ? usage.planName : '—'}
              </h3>
              {isTrialing && (
                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  Trial
                </span>
              )}
            </div>
            <p className="mt-2 text-[12.5px] text-[var(--text-tertiary)]">
              {isTrialing && usage?.trialEndsAt
                ? `Trial ends ${new Date(usage.trialEndsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
                : renewLabel
                  ? `Renews ${renewLabel}`
                  : 'No active subscription'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <FeatureChip label="SARA replies" on={!!usage?.features.sara} />
            <FeatureChip label="A/B testing" on={!!usage?.features.abTesting} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
          <UsageMeter icon={Mail} label="Emails this month" used={usage?.emailsSent ?? 0} limit={usage?.emailsLimit ?? 0} />
          <UsageMeter icon={Inbox} label="Connected inboxes" used={usage?.inboxes ?? 0} limit={usage?.inboxLimit ?? 0} />
        </div>
      </div>

      {/* Plans */}
      <div className="flex items-center justify-between mb-4 mt-8">
        <div>
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)] tracking-[-0.01em]">Plans</h3>
          <p className="text-[12.5px] text-[var(--text-tertiary)] mt-0.5">Upgrade any time — changes are prorated.</p>
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
          {(['monthly', 'annual'] as Interval[]).map((i) => (
            <button
              key={i}
              onClick={() => setInterval(i)}
              className={cn(
                'h-7 px-3 rounded-md text-[12px] font-medium capitalize transition-colors',
                interval === i ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              {i}
              {i === 'annual' && <span className="text-[var(--indigo)] font-semibold"> · save 2mo</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {DISPLAY_PLANS.map((id) => {
          const plan = PLANS[id];
          const isCurrent = currentPlan === id;
          const featured = id === 'growth';
          const Icon = id === 'scale' ? Building2 : id === 'growth' ? Zap : Sparkles;
          const price = interval === 'annual' ? plan.priceAnnual : plan.priceMonthly;
          return (
            <div
              key={id}
              className={cn(
                'relative panel p-5 flex flex-col gap-5',
                featured && 'ring-1 ring-[var(--indigo)] shadow-[0_8px_30px_-12px_rgba(91,91,245,0.35)]',
                isCurrent && !featured && 'border-[var(--indigo)]'
              )}
            >
              {featured && !isCurrent && (
                <span className="absolute -top-2.5 left-5 text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-[var(--indigo)] text-white shadow-sm">
                  Most popular
                </span>
              )}

              <div className="flex items-center justify-between">
                <span className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-xl',
                  featured ? 'bg-[var(--indigo)]' : 'bg-[var(--indigo-subtle)]'
                )}>
                  <Icon className={cn('h-4 w-4', featured ? 'text-white' : 'text-[var(--indigo)]')} />
                </span>
                {isCurrent && (
                  <span className="flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" /> Current
                  </span>
                )}
              </div>

              <div>
                <h4 className="text-[15px] font-semibold text-[var(--text-primary)]">{plan.name}</h4>
                <div className="mt-1.5 flex items-baseline gap-1">
                  {price === null ? (
                    <span className="text-[26px] font-semibold text-[var(--text-primary)] tracking-[-0.02em]">Custom</span>
                  ) : (
                    <>
                      <span className="text-[26px] font-semibold text-[var(--text-primary)] tabular tracking-[-0.02em]">
                        ${interval === 'annual' ? Math.round(price / 12) : price}
                      </span>
                      <span className="text-[13px] text-[var(--text-tertiary)]">/mo</span>
                    </>
                  )}
                </div>
                <p className="text-[11.5px] text-[var(--text-tertiary)] mt-1 h-4">
                  {price === null
                    ? 'Tailored to your volume'
                    : interval === 'annual'
                      ? `$${price.toLocaleString()} billed yearly`
                      : 'billed monthly'}
                </p>
              </div>

              <div className="h-px bg-[var(--border-subtle)]" />

              <ul className="space-y-2 text-[12.5px] text-[var(--text-secondary)]">
                <PlanLine>{fmtLimit(plan.maxInboxes)} sending inbox{plan.maxInboxes === 1 ? '' : 'es'}</PlanLine>
                <PlanLine>{fmtLimit(plan.emailsPerMonth)} emails / month</PlanLine>
                <PlanLine muted={!plan.features.sara}>SARA autonomous replies</PlanLine>
                <PlanLine muted={!plan.features.abTesting}>A/B subject &amp; body testing</PlanLine>
              </ul>

              <button
                disabled={isCurrent || busy === id}
                onClick={() => onUpgrade(id)}
                className={cn(
                  'mt-auto h-10 rounded-lg text-[13px] font-semibold transition-colors',
                  isCurrent
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] cursor-default'
                    : featured
                      ? 'bg-[var(--indigo)] text-white hover:opacity-90 disabled:opacity-60'
                      : 'border border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-60'
                )}
              >
                {isCurrent ? 'Your current plan' : busy === id ? 'Starting…' : id === 'scale' ? 'Contact sales' : 'Upgrade'}
              </button>
            </div>
          );
        })}
      </div>

      {isLoading && <p className="text-[12px] text-[var(--text-tertiary)] mt-4">Loading usage…</p>}
    </div>
    </SettingsShell>
  );
}

function FeatureChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={cn(
      'flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1 rounded-full border',
      on
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
        : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] border-[var(--border-subtle)]'
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-emerald-500' : 'bg-[var(--text-muted)]')} />
      {label}
    </span>
  );
}

function PlanLine({ muted = false, children }: { muted?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className={cn('h-3.5 w-3.5 mt-0.5 flex-shrink-0', muted ? 'text-[var(--text-muted)]' : 'text-[var(--indigo)]')} />
      <span className={cn(muted && 'text-[var(--text-tertiary)]')}>{children}</span>
    </li>
  );
}

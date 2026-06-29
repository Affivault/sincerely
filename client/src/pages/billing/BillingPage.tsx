import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { PageHeader } from '../../components/shared/PageHeader';
import { billingApi } from '../../api/billing.api';
import { PLANS, isUnlimited, type PlanId } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { CreditCard, Mail, Inbox, Check, X, Sparkles, Zap, Building2, ExternalLink } from 'lucide-react';

// Customer-facing plans, in display order. (Trial is internal-only.)
const DISPLAY_PLANS: PlanId[] = ['starter', 'growth', 'scale'];
type Interval = 'monthly' | 'annual';

function fmtLimit(n: number): string {
  return isUnlimited(n) ? 'Unlimited' : n.toLocaleString();
}

function UsageMeter({ icon: Icon, label, used, limit }: {
  icon: React.ElementType; label: string; used: number; limit: number;
}) {
  const unlimited = isUnlimited(limit);
  const pct = unlimited ? 0 : Math.min(100, limit > 0 ? (used / limit) * 100 : 0);
  const color = pct >= 90 ? '#EF4444' : pct >= 75 ? '#F59E0B' : '#6366F1';
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--indigo-subtle)]">
          <Icon className="h-3.5 w-3.5 text-[var(--indigo)]" />
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[22px] font-bold tabular-nums tracking-[-0.02em] text-[var(--text-primary)]">{used.toLocaleString()}</span>
        <span className="text-[12px] text-[var(--text-tertiary)]">/ {fmtLimit(limit)}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        {unlimited
          ? <div className="h-full rounded-full bg-[var(--indigo)] opacity-30" style={{ width: '100%' }} />
          : <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />}
      </div>
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
      if (!url) throw new Error('No checkout URL returned');
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
      if (!url) throw new Error('No portal URL returned');
      window.location.href = url;
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not open the billing portal.');
      setBusy(null);
    }
  };

  const currentPlan = usage?.plan;

  return (
    <div>
      <PageHeader
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <CreditCard className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Billing & Usage"
        description="Your plan, this month's usage, and upgrade options."
      />

      {/* Current plan + usage */}
      <div className="panel p-4 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                {usage ? usage.planName : '—'} plan
              </h3>
              {usage?.status === 'trialing' && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  Trial
                </span>
              )}
            </div>
            {usage?.trialEndsAt && (
              <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">
                Trial ends {new Date(usage.trialEndsAt).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <FeatureChip label="SARA" on={!!usage?.features.sara} />
            <FeatureChip label="A/B testing" on={!!usage?.features.abTesting} />
            {usage?.hasBilling && (
              <button
                onClick={onManageBilling}
                disabled={busy === 'portal'}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {busy === 'portal' ? 'Opening…' : 'Manage billing'}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <UsageMeter icon={Mail} label="Emails this month" used={usage?.emailsSent ?? 0} limit={usage?.emailsLimit ?? 0} />
          <UsageMeter icon={Inbox} label="Connected inboxes" used={usage?.inboxes ?? 0} limit={usage?.inboxLimit ?? 0} />
        </div>
      </div>

      {/* Plans */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Plans</h3>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-elevated)]">
          {(['monthly', 'annual'] as Interval[]).map((i) => (
            <button
              key={i}
              onClick={() => setInterval(i)}
              className={cn(
                'h-7 px-3 rounded-md text-[12px] font-medium capitalize transition-colors',
                interval === i ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)]'
              )}
            >
              {i}{i === 'annual' && <span className="text-[var(--indigo)]"> · save</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {DISPLAY_PLANS.map((id) => {
          const plan = PLANS[id];
          const isCurrent = currentPlan === id;
          const Icon = id === 'scale' ? Building2 : id === 'growth' ? Zap : Sparkles;
          const price = interval === 'annual' ? plan.priceAnnual : plan.priceMonthly;
          return (
            <div
              key={id}
              className={cn(
                'panel p-5 flex flex-col gap-4',
                id === 'growth' && 'ring-1 ring-[var(--indigo)]',
                isCurrent && 'border-[var(--indigo)]'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)]">
                  <Icon className="h-4 w-4 text-[var(--indigo)]" />
                </span>
                {id === 'growth' && !isCurrent && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--indigo)] text-white">Most popular</span>
                )}
                {isCurrent && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Current plan</span>
                )}
              </div>

              <div>
                <h4 className="text-[15px] font-semibold text-[var(--text-primary)]">{plan.name}</h4>
                <div className="mt-1 flex items-baseline gap-1">
                  {price === null ? (
                    <span className="text-[22px] font-bold text-[var(--text-primary)]">Custom</span>
                  ) : (
                    <>
                      <span className="text-[22px] font-bold text-[var(--text-primary)]">${price}</span>
                      <span className="text-[12px] text-[var(--text-tertiary)]">/{interval === 'annual' ? 'yr' : 'mo'}</span>
                    </>
                  )}
                </div>
                {interval === 'annual' && price !== null && (
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">billed annually</p>
                )}
              </div>

              <ul className="space-y-1.5 text-[12px] text-[var(--text-secondary)]">
                <PlanLine ok>{fmtLimit(plan.maxInboxes)} sending inbox{plan.maxInboxes === 1 ? '' : 'es'}</PlanLine>
                <PlanLine ok>{fmtLimit(plan.emailsPerMonth)} emails / month</PlanLine>
                <PlanLine ok={plan.features.sara}>SARA autonomous replies</PlanLine>
                <PlanLine ok={plan.features.abTesting}>A/B subject & body testing</PlanLine>
              </ul>

              <button
                disabled={isCurrent || busy === id}
                onClick={() => onUpgrade(id)}
                className={cn(
                  'mt-auto h-9 rounded-lg text-[13px] font-semibold transition-colors',
                  isCurrent
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] cursor-default'
                    : 'bg-[var(--indigo)] text-white hover:opacity-90 disabled:opacity-60'
                )}
              >
                {isCurrent ? 'Current plan' : busy === id ? 'Starting…' : id === 'scale' ? 'Contact sales' : 'Upgrade'}
              </button>
            </div>
          );
        })}
      </div>

      {isLoading && <p className="text-[12px] text-[var(--text-tertiary)] mt-4">Loading usage…</p>}
    </div>
  );
}

function FeatureChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={cn(
      'flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full',
      on ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
    )}>
      {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </span>
  );
}

function PlanLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {ok
        ? <Check className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
        : <X className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />}
      <span className={cn(!ok && 'text-[var(--text-tertiary)] line-through')}>{children}</span>
    </li>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Sparkles, X, Check, Zap, ArrowRight, Lock } from 'lucide-react';
import { billingApi } from '../api/billing.api';
import { PLANS, type PlanId } from '@lemlist/shared';
import { onUpgradePrompt } from '../lib/upgradeNag';
import { cn } from '../lib/utils';

type Interval = 'monthly' | 'annual';
const PAID: PlanId[] = ['starter', 'growth'];
// How often the modal re-pops for free users who close it (ms).
const NAG_INTERVAL = 120_000;

export function UpgradeNag() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | undefined>();
  const [interval, setInterval_] = useState<Interval>('monthly');
  const [busy, setBusy] = useState<PlanId | null>(null);

  const { data: usage } = useQuery({
    queryKey: ['billing', 'usage'],
    queryFn: billingApi.usage,
    staleTime: 60_000,
  });

  const isFree = usage?.plan === 'free';
  const onBilling = location.pathname.startsWith('/billing');

  // Limit-hit (403 UPGRADE_REQUIRED) → open immediately with the reason.
  useEffect(() => {
    return onUpgradePrompt((r) => {
      setReason(r);
      setOpen(true);
    });
  }, []);

  // Auto-open shortly after load, then keep re-popping on an interval — until they pay.
  useEffect(() => {
    if (!isFree || onBilling) return;
    const first = window.setTimeout(() => setOpen(true), 2000);
    const timer = window.setInterval(() => setOpen(true), NAG_INTERVAL);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [isFree, onBilling]);

  const startCheckout = async (plan: PlanId) => {
    if (plan !== 'starter' && plan !== 'growth') return;
    setBusy(plan);
    try {
      const { url } = await billingApi.checkout(plan, interval);
      window.location.href = url;
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not start checkout.');
      setBusy(null);
    }
  };

  if (!isFree) return null;

  return (
    <>
      {/* Persistent banner — always there for free users. */}
      {!onBilling && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-white"
          style={{ background: 'linear-gradient(100deg,#4F86F7,#8B5CF6)' }}>
          <div className="flex items-center gap-2 text-[13px]">
            <Lock className="h-4 w-4 flex-shrink-0" />
            <span><strong>You're on the Free plan</strong> — 1 inbox, {PLANS.free.emailsPerMonth} emails/mo. Upgrade to send at scale and unlock SARA + A/B.</span>
          </div>
          <button
            onClick={() => { setReason(undefined); setOpen(true); }}
            className="flex-shrink-0 inline-flex items-center gap-1 rounded-lg bg-white/95 px-3 py-1.5 text-[12.5px] font-semibold text-[#5B5BF5] hover:bg-white transition-colors"
          >
            Upgrade <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* The recurring modal. */}
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(8,8,14,0.6)', backdropFilter: 'blur(3px)' }}>
          <div className="w-full max-w-[560px] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl overflow-hidden">
            <div className="relative px-6 pt-6 pb-5 text-white" style={{ background: 'linear-gradient(120deg,#4F86F7,#8B5CF6)' }}>
              <button onClick={() => setOpen(false)} aria-label="Close" className="absolute right-4 top-4 text-white/80 hover:text-white">
                <X className="h-5 w-5" />
              </button>
              <Sparkles className="h-6 w-6 mb-2" />
              <h2 className="text-[20px] font-bold leading-tight">Upgrade to keep growing</h2>
              <p className="text-[13px] text-white/85 mt-1">
                {reason || `The Free plan caps you at 1 inbox and ${PLANS.free.emailsPerMonth} emails a month. Unlock real sending in seconds.`}
              </p>
            </div>

            <div className="p-5">
              <div className="flex justify-center mb-4">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-elevated)]">
                  {(['monthly', 'annual'] as Interval[]).map((i) => (
                    <button key={i} onClick={() => setInterval_(i)}
                      className={cn('h-7 px-3 rounded-md text-[12px] font-medium capitalize transition-colors',
                        interval === i ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)]')}>
                      {i}{i === 'annual' && <span className="text-[var(--indigo)]"> · save</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {PAID.map((id) => {
                  const plan = PLANS[id];
                  const price = interval === 'annual' ? plan.priceAnnual : plan.priceMonthly;
                  const Icon = id === 'growth' ? Zap : Sparkles;
                  return (
                    <div key={id} className={cn('rounded-xl border p-4 flex flex-col gap-3',
                      id === 'growth' ? 'border-[var(--indigo)] ring-1 ring-[var(--indigo)]' : 'border-[var(--border-default)]')}>
                      <div className="flex items-center justify-between">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--indigo-subtle)]">
                          <Icon className="h-4 w-4 text-[var(--indigo)]" />
                        </span>
                        {id === 'growth' && <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--indigo)] text-white">POPULAR</span>}
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-[var(--text-primary)]">{plan.name}</div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-[19px] font-bold text-[var(--text-primary)]">${price}</span>
                          <span className="text-[11px] text-[var(--text-tertiary)]">/{interval === 'annual' ? 'yr' : 'mo'}</span>
                        </div>
                      </div>
                      <ul className="space-y-1 text-[11.5px] text-[var(--text-secondary)]">
                        <li className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" /> {plan.maxInboxes} inboxes</li>
                        <li className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" /> {plan.emailsPerMonth.toLocaleString()} emails/mo</li>
                        {plan.features.sara && <li className="flex items-center gap-1.5"><Check className="h-3 w-3 text-emerald-500" /> SARA + A/B</li>}
                      </ul>
                      <button onClick={() => startCheckout(id)} disabled={busy === id}
                        className={cn('mt-auto h-9 rounded-lg text-[12.5px] font-semibold transition-colors',
                          id === 'growth' ? 'bg-[var(--indigo)] text-white hover:opacity-90' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                          'disabled:opacity-60')}>
                        {busy === id ? 'Starting…' : 'Start 10-day trial'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <button onClick={() => { setOpen(false); navigate('/billing'); }} className="text-[12px] text-[var(--indigo)] hover:underline">
                  See all plans
                </button>
                <button onClick={() => setOpen(false)} className="text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                  Maybe later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

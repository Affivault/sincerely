import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Sparkles, X, Check, Zap, ArrowRight, Lock, Mail, Inbox } from 'lucide-react';
import { billingApi } from '../api/billing.api';
import { PLANS, type PlanId } from '@lemlist/shared';
import { onUpgradePrompt } from '../lib/upgradeNag';
import { Button } from './ui/Button';
import { cn } from '../lib/utils';

type Interval = 'monthly' | 'annual';
const PAID: PlanId[] = ['starter', 'growth'];
// How often the modal re-pops for free users who close it (ms).
const NAG_INTERVAL = 120_000;

/** % saved on the annual plan vs paying monthly for a year. */
function annualSavings(id: PlanId): number {
  const p = PLANS[id];
  if (!p.priceMonthly || !p.priceAnnual) return 0;
  return Math.round((1 - p.priceAnnual / (p.priceMonthly * 12)) * 100);
}

const PLAN_META: Record<'starter' | 'growth', {
  tagline: string;
  icon: typeof Sparkles;
  features: (plan: (typeof PLANS)[PlanId]) => string[];
}> = {
  starter: {
    tagline: 'For getting off the ground',
    icon: Sparkles,
    features: (p) => [
      `${p.maxInboxes} connected inboxes`,
      `${p.emailsPerMonth.toLocaleString()} emails / month`,
      'Domain authentication & warm-up tools',
    ],
  },
  growth: {
    tagline: 'For teams sending at scale',
    icon: Zap,
    features: (p) => [
      `${p.maxInboxes} connected inboxes`,
      `${p.emailsPerMonth.toLocaleString()} emails / month`,
      'SARA — AI inbox replies',
      'A/B subject & body testing',
    ],
  },
};

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
  const onBilling = location.pathname === '/billing';

  // Track in-flight checkout so the interval doesn't re-pop over the Stripe redirect.
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy !== null; }, [busy]);

  // Limit-hit (403 UPGRADE_REQUIRED) → open immediately with the reason (free users only).
  useEffect(() => {
    return onUpgradePrompt((r) => {
      if (!isFree) return;
      setReason(r);
      setOpen(true);
    });
  }, [isFree]);

  // Auto-open shortly after load, then keep re-popping on an interval — until they pay.
  useEffect(() => {
    if (!isFree || onBilling) return;
    const first = window.setTimeout(() => { if (!busyRef.current) setOpen(true); }, 2000);
    const timer = window.setInterval(() => { if (!busyRef.current) setOpen(true); }, NAG_INTERVAL);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [isFree, onBilling]);

  // Standard modal behaviour: Escape closes, page behind doesn't scroll.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const startCheckout = async (plan: PlanId) => {
    if (plan !== 'starter' && plan !== 'growth') return;
    setBusy(plan);
    try {
      const { url } = await billingApi.checkout(plan, interval);
      if (typeof url !== 'string' || !url) throw new Error('No checkout URL returned');
      window.location.href = url;
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not start checkout.');
      setBusy(null);
    }
  };

  if (!isFree) return null;

  const maxSave = Math.max(...PAID.map((id) => annualSavings(id)));

  return (
    <>
      {/* Persistent banner — always there for free users. */}
      {!onBilling && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
          style={{ background: 'linear-gradient(100deg,#5B5BF5,#8B5CF6)' }}>
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
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-[3px] animate-fade-in" onClick={() => setOpen(false)} />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Upgrade your plan"
            className="relative w-full max-w-[620px] rounded-[14px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-xl)] overflow-hidden"
            style={{ animation: 'cmdkIn 200ms var(--ease-out) both' }}
          >
            {/* Brand hairline */}
            <span className="absolute inset-x-0 top-0 h-[2.5px] [background:linear-gradient(90deg,#5B5BF5,#8B5CF6,#5B5BF5)]" />

            {/* Header */}
            <div className="px-6 pt-5 pb-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)] flex-shrink-0 mt-0.5">
                  <Sparkles className="h-[18px] w-[18px] text-[var(--indigo)]" />
                </span>
                <div className="flex-1 min-w-0">
                  <h2 className="text-[17px] font-semibold text-[var(--text-primary)] tracking-[-0.01em] leading-tight">
                    Upgrade to keep growing
                  </h2>
                  <p className="mt-1 text-[12.5px] text-[var(--text-secondary)] leading-snug">
                    Real cold-email volume needs more than one inbox. Pick a plan and start sending in minutes.
                  </p>
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap text-[11.5px] text-[var(--text-tertiary)]">
                    <span className="inline-flex items-center gap-1"><Inbox className="h-3 w-3" /> Free plan: 1 inbox</span>
                    <span className="sep-dot" />
                    <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {PLANS.free.emailsPerMonth} emails/mo</span>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex-shrink-0 rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors -mr-1 -mt-0.5"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Why the modal opened (limit hit) */}
              {reason && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
                  <Lock className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{reason}</span>
                </div>
              )}
            </div>

            <div className="px-6 py-5">
              {/* Billing interval */}
              <div className="flex items-center justify-between mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Choose a plan</p>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                  {(['monthly', 'annual'] as Interval[]).map((i) => (
                    <button
                      key={i}
                      onClick={() => setInterval_(i)}
                      className={cn(
                        'h-7 px-2.5 rounded-md text-[12px] font-medium capitalize transition-colors',
                        interval === i
                          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                          : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                      )}
                    >
                      {i === 'annual' ? <>Annual <span className={cn(interval === i ? 'text-[var(--indigo)]' : 'text-[var(--text-muted)]')}>−{maxSave}%</span></> : 'Monthly'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Plan cards */}
              <div className="grid sm:grid-cols-2 gap-3">
                {PAID.map((id) => {
                  const plan = PLANS[id];
                  const meta = PLAN_META[id as 'starter' | 'growth'];
                  const Icon = meta.icon;
                  const popular = id === 'growth';
                  const monthlyEq = interval === 'annual' && plan.priceAnnual != null
                    ? Math.round(plan.priceAnnual / 12)
                    : plan.priceMonthly ?? 0;
                  const save = annualSavings(id);
                  return (
                    <div
                      key={id}
                      className={cn(
                        'relative rounded-xl border p-4 flex flex-col bg-[var(--bg-surface)]',
                        popular
                          ? 'border-[rgba(91,91,245,0.45)] ring-1 ring-[rgba(91,91,245,0.25)] shadow-[0_10px_30px_-12px_rgba(91,91,245,0.4)]'
                          : 'border-[var(--border-subtle)] shadow-[var(--shadow-sm)]'
                      )}
                    >
                      {popular && (
                        <span className="absolute -top-2.5 left-4 inline-flex items-center gap-1 px-2 h-[19px] rounded-full text-[10px] font-semibold text-white [background:var(--indigo-grad)] shadow-[0_2px_6px_rgba(91,91,245,0.4)]">
                          <Zap className="h-2.5 w-2.5" /> MOST POPULAR
                        </span>
                      )}

                      <div className="flex items-center gap-2.5 mb-3">
                        <span className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0',
                          popular ? 'bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]' : 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)]'
                        )}>
                          <Icon className={cn('h-4 w-4', popular ? 'text-[var(--indigo)]' : 'text-[var(--text-secondary)]')} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-semibold text-[var(--text-primary)] leading-tight">{plan.name}</p>
                          <p className="text-[11px] text-[var(--text-tertiary)] leading-tight">{meta.tagline}</p>
                        </div>
                      </div>

                      <div className="mb-3">
                        <div className="flex items-baseline gap-1">
                          <span className="text-[26px] font-semibold text-[var(--text-primary)] tabular tracking-[-0.02em] leading-none">${monthlyEq}</span>
                          <span className="text-[12px] text-[var(--text-tertiary)]">/mo</span>
                        </div>
                        <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                          {interval === 'annual'
                            ? <>billed ${plan.priceAnnual}/yr · <span className="text-emerald-600 dark:text-emerald-400 font-medium">save {save}%</span></>
                            : 'billed monthly'}
                        </p>
                      </div>

                      <ul className="space-y-1.5 mb-4">
                        {meta.features(plan).map((f) => (
                          <li key={f} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/10 flex-shrink-0 mt-[1px]">
                              <Check className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />
                            </span>
                            {f}
                          </li>
                        ))}
                      </ul>

                      <Button
                        variant={popular ? 'primary' : 'secondary'}
                        className="mt-auto w-full"
                        onClick={() => startCheckout(id)}
                        disabled={busy !== null}
                      >
                        {busy === id ? 'Redirecting…' : 'Start 10-day trial'}
                      </Button>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="mt-4 flex items-center justify-between">
                <button
                  onClick={() => { setOpen(false); navigate('/billing'); }}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--indigo)] hover:underline"
                >
                  Compare all plans <ArrowRight className="h-3 w-3" />
                </button>
                <div className="flex items-center gap-3">
                  <span className="hidden sm:inline text-[11px] text-[var(--text-muted)]">10-day trial · cancel anytime</span>
                  <button onClick={() => setOpen(false)} className="text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
                    Maybe later
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

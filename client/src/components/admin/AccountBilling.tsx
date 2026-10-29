import { useEffect, useState } from 'react';
import { CalendarPlus, CreditCard, Gift, Percent, ShieldCheck, Undo2 } from 'lucide-react';
import { PLANS, formatCredits, formatDate, formatDateTime, isUnlimited, type AdminAccountDetail, type PlanId } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { Card, Row, inputBase, inputCls, useAdminAction } from './adminUi';
import { usd } from './adminFormat';

const STATUSES = [
  { id: 'active', label: 'Active' },
  { id: 'trialing', label: 'Trialing' },
  { id: 'free', label: 'Free' },
  { id: 'past_due', label: 'Past due' },
  { id: 'canceled', label: 'Canceled' },
];

const limitLabel = (n: number) => (isUnlimited(n) ? 'unlimited' : n.toLocaleString());
const planLine = (p: { emailsPerMonth: number; maxInboxes: number; prospectCredits: number }) =>
  `${limitLabel(p.emailsPerMonth)} emails, ${limitLabel(p.maxInboxes)} inboxes, ${formatCredits(p.prospectCredits)} credits a month`.replace(/^./, (c) => c.toUpperCase());

/*
 * Plan and money: the plan (changed in Stripe too when they pay there), what
 * Stripe says about the subscription, the things the owner can do to it, and
 * every payment with a refund.
 */
export function AccountBilling({ id, data }: { id: string; data: AdminAccountDetail }) {
  const confirm = useConfirm();
  const { account: a, subscription: sub, stripe } = data;
  const [plan, setPlan] = useState(a.plan);
  const [status, setStatus] = useState(a.status);
  const [days, setDays] = useState('7');
  const [credit, setCredit] = useState('');
  const [creditNote, setCreditNote] = useState('');
  const [percent, setPercent] = useState('20');
  const [months, setMonths] = useState('3');
  const [refunding, setRefunding] = useState<{ ref: string; max: number } | null>(null);
  const [refundAmount, setRefundAmount] = useState('');

  useEffect(() => { setPlan(a.plan); }, [a.plan]);
  useEffect(() => { setStatus(a.status); }, [a.status]);

  const paysInStripe = !!sub?.stripe_subscription_id && a.plan !== 'lifetime' && ['active', 'trialing', 'past_due'].includes(a.status);
  const live = !!stripe && ['active', 'trialing', 'past_due', 'unpaid'].includes(stripe.status);
  const planChanged = plan !== a.plan || status !== a.status;

  const planMut = useAdminAction(() => adminApi.setPlan(id, plan, status), (r) => r.stripe === 'changed'
    ? 'Plan changed in Stripe too. The new price starts at their next renewal.'
    : r.stripe === 'canceled' ? 'Plan saved, and their Stripe subscription is cancelled.' : 'Plan saved.', 'The plan could not be changed.');
  const cancelMut = useAdminAction((when: 'now' | 'period_end') => adminApi.cancelSubscription(id, when),
    (_r, when) => (when === 'now' ? 'Subscription cancelled. Stripe has stopped billing them.' : 'They will be cancelled at the end of the paid period.'), 'The subscription could not be cancelled.');
  const resumeMut = useAdminAction(() => adminApi.resumeSubscription(id), 'The cancellation is called off. They keep their plan.', 'The subscription could not be resumed.');
  const trialMut = useAdminAction(() => adminApi.extendTrial(id, Number(days)), (r) => `Free until ${formatDate(new Date(r.until))}.`, 'The trial could not be extended.');
  const creditMut = useAdminAction(() => adminApi.stripeCredit(id, Number(credit), creditNote), () => `${usd(Number(credit))} credit added. It comes off their next invoices.`, 'The credit could not be added.');
  const discountMut = useAdminAction(() => adminApi.discount(id, Number(percent), Number(months)), 'Discount applied in Stripe.', 'The discount could not be applied.');
  const undiscountMut = useAdminAction(() => adminApi.removeDiscount(id), 'Discount removed.', 'The discount could not be removed.');
  const refundMut = useAdminAction((v: { ref: string; amount: number | null }) => adminApi.refund(id, v.ref, v.amount),
    (r) => `${usd(r.refunded_usd)} refunded. It reaches their card in 5 to 10 days.`, 'The refund failed.');

  const savePlan = () => {
    if (!paysInStripe || plan === a.plan) return planMut.mutate(undefined);
    const cancels = plan === 'free' || plan === 'lifetime';
    const name = PLANS[plan as PlanId]?.name;
    confirm({
      title: cancels ? 'Cancel their Stripe subscription?' : `Move them to ${name} in Stripe?`,
      body: cancels
        ? `${a.email} stops being billed now, with no refund, and goes on ${name}.`
        : `${a.email} is billed the ${name} price from their next renewal. Nothing is charged now.`,
      confirmLabel: cancels ? 'Cancel and save' : 'Change in Stripe',
    }, () => planMut.mutate(undefined));
  };

  return (
    <div className="space-y-4">
      <Card title="Plan" icon={ShieldCheck}>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-caption text-[var(--text-tertiary)]">
            Plan
            <select value={plan} onChange={(e) => setPlan(e.target.value)} className={cn(inputCls, 'mt-1 px-2')}>
              {Object.values(PLANS).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-caption text-[var(--text-tertiary)]">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(inputCls, 'mt-1 px-2')}>
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <p className="mt-2 text-micro text-[var(--text-tertiary)]">
          {PLANS[plan as PlanId] ? `${planLine(PLANS[plan as PlanId])}.` : ''}
          {paysInStripe && ' They pay through Stripe: Starter and Growth change the Stripe price from the next renewal, and Free or Lifetime cancel the subscription.'}
        </p>
        <Button className="mt-3" disabled={!planChanged || planMut.isPending} onClick={savePlan}>
          {planMut.isPending ? 'Saving…' : 'Save plan'}
        </Button>
      </Card>

      <Card
        title="Stripe subscription"
        icon={CreditCard}
        aside={sub?.stripe_customer_id && (
          <a href={`https://dashboard.stripe.com/customers/${sub.stripe_customer_id}`} target="_blank" rel="noreferrer" className="text-caption text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Open in Stripe ↗</a>
        )}
      >
        {!sub?.stripe_subscription_id ? (
          <p className="text-body text-[var(--text-tertiary)]">They have never subscribed through Stripe.{a.plan !== 'free' ? ` Their ${PLANS[a.plan as PlanId]?.name || a.plan} plan was set by hand.` : ''}</p>
        ) : !stripe ? (
          <p className="text-body text-[var(--text-tertiary)]">Stripe could not be reached just now. Try Refresh.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Fact k="Status" v={stripe.status.replace('_', ' ')} tone={stripe.status === 'past_due' || stripe.status === 'unpaid' ? 'bad' : undefined} />
              <Fact k="Price" v={stripe.price_usd == null ? '—' : `${usd(stripe.price_usd)} / ${stripe.interval || 'period'}`} />
              <Fact
                k={stripe.cancel_at_period_end ? 'Ends' : stripe.status === 'trialing' ? 'Trial ends' : 'Renews'}
                v={(() => { const d = stripe.cancel_at || (stripe.status === 'trialing' ? stripe.trial_end : stripe.current_period_end); return d ? formatDate(new Date(d)) : '—'; })()}
                tone={stripe.cancel_at_period_end ? 'bad' : undefined}
              />
              <Fact k="Discount" v={stripe.discount || 'None'} />
              {stripe.balance_usd > 0 && <Fact k="Credit on account" v={usd(stripe.balance_usd)} />}
            </dl>

            {live ? (
              <div>
                <Row
                  title={stripe.cancel_at_period_end ? 'Cancellation scheduled' : 'Cancel'}
                  sub={stripe.cancel_at_period_end ? 'They keep their plan until the end of the period, then drop to Free.' : 'At the end of the paid period they drop to Free. Or end it now, with no refund.'}
                >
                  {stripe.cancel_at_period_end ? (
                    <Button size="sm" variant="secondary" disabled={resumeMut.isPending} onClick={() => resumeMut.mutate(undefined)}>Keep subscription</Button>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={cancelMut.isPending} onClick={() => confirm({ title: 'Cancel at the end of the period?', body: `${a.email} keeps ${PLANS[a.plan as PlanId]?.name || a.plan} until it ends, then drops to Free.`, confirmLabel: 'Schedule cancellation' }, () => cancelMut.mutate('period_end'))}>At period end</Button>
                  )}
                  <Button size="sm" variant="danger" disabled={cancelMut.isPending} onClick={() => confirm({ title: 'Cancel now?', body: `${a.email} stops being billed and drops to Free right away. Nothing is refunded; refund a payment below if you want to.`, confirmLabel: 'Cancel now', tone: 'danger' }, () => cancelMut.mutate('now'))}>Now</Button>
                </Row>
                <Row title="Extend free time" sub={stripe.status === 'trialing' ? 'Pushes the trial’s end out.' : 'Their next charge moves out by these days; the time between is free.'}>
                  <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days" className={cn(inputBase, 'w-20')} />
                  <Button size="sm" variant="secondary" disabled={trialMut.isPending || !(Number(days) >= 1)} onClick={() => trialMut.mutate(undefined)}><CalendarPlus className="h-3.5 w-3.5" /> Add days</Button>
                </Row>
                <Row title="Discount" sub={stripe.discount ? `Now: ${stripe.discount}. A new one replaces it.` : 'A percentage off their invoices. 0 months means forever.'}>
                  <input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} aria-label="Percent off" className={cn(inputBase, 'w-16')} />
                  <span className="text-caption text-[var(--text-tertiary)]">% for</span>
                  <input type="number" min={0} max={36} value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Months" className={cn(inputBase, 'w-16')} />
                  <span className="text-caption text-[var(--text-tertiary)]">mo</span>
                  <Button size="sm" variant="secondary" disabled={discountMut.isPending} onClick={() => discountMut.mutate(undefined)}><Percent className="h-3.5 w-3.5" /> Apply</Button>
                  {stripe.discount && <Button size="sm" variant="ghost" disabled={undiscountMut.isPending} onClick={() => undiscountMut.mutate(undefined)}>Remove</Button>}
                </Row>
              </div>
            ) : (
              <p className="text-body text-[var(--text-tertiary)]">This subscription has ended; there is nothing left to change on it.</p>
            )}
          </>
        )}
        {sub?.stripe_customer_id && (
          <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
            <Row title="Give account credit" sub="Money on their Stripe balance, taken off their next invoices. For a free month, give one month’s price.">
              <input type="number" min={0.01} step={0.01} value={credit} onChange={(e) => setCredit(e.target.value)} placeholder={stripe?.price_usd ? String(stripe.price_usd) : '$'} aria-label="Amount in dollars" className={cn(inputBase, 'w-24')} />
              <input type="text" value={creditNote} onChange={(e) => setCreditNote(e.target.value)} placeholder="Why" aria-label="Why" maxLength={300} className={cn(inputBase, 'w-36')} />
              <Button size="sm" variant="secondary" disabled={creditMut.isPending || !(Number(credit) > 0) || !creditNote.trim()} onClick={() => confirm({ title: `Give ${usd(Number(credit))} credit?`, body: `${a.email}: “${creditNote.trim()}”. It comes off their next invoices.`, confirmLabel: 'Give credit' }, () => creditMut.mutate(undefined))}><Gift className="h-3.5 w-3.5" /> Give</Button>
            </Row>
          </div>
        )}
      </Card>

      <Card title="Payments" icon={CreditCard} aside={<span className="text-caption text-[var(--text-tertiary)] tabular">{usd(data.totals.lifetime_revenue_usd)} all time</span>}>
        {data.payments.length === 0 ? (
          <p className="text-body text-[var(--text-tertiary)]">No payments recorded.</p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] -my-2">
            {data.payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2 text-body">
                <span className={cn('w-20 shrink-0 text-right tabular font-medium', p.amount_usd < 0 ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-primary)]')}>{usd(p.amount_usd)}</span>
                <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)]">
                  {p.kind === 'refund' ? 'Refund' : p.kind === 'credit_pack' ? 'Credit pack' : 'Subscription'}
                  <span className="text-[var(--text-tertiary)] font-mono text-caption"> · {p.stripe_ref}</span>
                </span>
                <span className="shrink-0 text-caption text-[var(--text-tertiary)] tabular hidden sm:inline">{formatDateTime(p.paid_at)}</span>
                {p.kind !== 'refund' && p.amount_usd > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => { setRefunding({ ref: p.stripe_ref, max: p.amount_usd }); setRefundAmount(''); }}>
                    <Undo2 className="h-3.5 w-3.5" /> Refund
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        isOpen={!!refunding}
        onClose={() => setRefunding(null)}
        title="Refund this payment"
        description={refunding ? `Up to ${usd(refunding.max)}, back to the card they paid with. Their plan does not change.` : undefined}
        size="sm"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRefunding(null)}>Keep it</Button>
            <Button
              variant="danger"
              disabled={refundMut.isPending || (refundAmount.trim() !== '' && !(Number(refundAmount) > 0 && Number(refundAmount) <= (refunding?.max || 0)))}
              onClick={() => refunding && refundMut.mutate({ ref: refunding.ref, amount: refundAmount.trim() === '' ? null : Number(refundAmount) }, { onSuccess: () => setRefunding(null) })}
            >
              {refundMut.isPending ? 'Refunding…' : refundAmount.trim() === '' ? `Refund ${usd(refunding?.max || 0)}` : `Refund ${usd(Number(refundAmount) || 0)}`}
            </Button>
          </div>
        )}
      >
        <label className="block text-caption text-[var(--text-tertiary)]">
          Amount (leave empty for the full payment)
          <input type="number" min={0.01} step={0.01} max={refunding?.max} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={refunding ? String(refunding.max) : ''} className={cn(inputCls, 'mt-1')} autoFocus />
        </label>
      </Modal>
    </div>
  );
}

function Fact({ k, v, tone }: { k: string; v: string; tone?: 'bad' }) {
  return (
    <div>
      <dt className="text-caption text-[var(--text-tertiary)]">{k}</dt>
      <dd className={cn('text-body font-medium', tone === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-primary)]')}>{v.charAt(0).toUpperCase() + v.slice(1)}</dd>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle, ArrowLeft, Ban, Check, Copy, CreditCard, ExternalLink, Gauge, History, Mail, NotebookPen,
  PlusCircle, ShieldCheck, Wallet,
} from 'lucide-react';
import { CREDIT_ACTION_LABELS, PLANS, formatCredits, formatDateTime, isUnlimited, type PlanId } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { Avatar } from '../shared/Avatar';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { PlanBadge, describeAudit, moneyTone, monthLabel, relTime, usd } from './adminFormat';

const inputCls = 'h-9 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-3 text-strong text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)] transition-[border-color,box-shadow]';
const STATUSES = [
  { id: 'active', label: 'Active' },
  { id: 'trialing', label: 'Trialing' },
  { id: 'free', label: 'Free' },
  { id: 'past_due', label: 'Past due' },
  { id: 'canceled', label: 'Canceled' },
];

const errMsg = (e: any, fallback: string) => e?.response?.data?.error || fallback;

function Card({ title, icon: Icon, children, className, aside }: { title: string; icon: any; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={cn('rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]', className)}>
      <header className="flex items-center gap-2 px-4 h-11 border-b border-[var(--border-subtle)]">
        <Icon className="h-3.5 w-3.5 text-[var(--indigo-text)]" />
        <h2 className="text-strong font-semibold text-[var(--text-primary)]">{title}</h2>
        <span className="flex-1" />
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
      <p className="text-caption font-medium text-[var(--text-tertiary)]">{label}</p>
      <p className={cn('mt-1 text-heading font-semibold tabular leading-tight', tone || 'text-[var(--text-primary)]')}>{value}</p>
      {sub && <p className="text-micro text-[var(--text-tertiary)] mt-0.5">{sub}</p>}
    </div>
  );
}

const limitLabel = (n: number) => (isUnlimited(n) ? 'unlimited' : n.toLocaleString());

/*
 * One account in full: what it is on, what it has used and cost us, what it
 * has paid, and every control the owner has over it. Every change made here
 * is written to the activity log.
 */
export function AdminAccountDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'account', id],
    queryFn: () => adminApi.account(id),
  });

  const [plan, setPlan] = useState('free');
  const [status, setStatus] = useState('free');
  const [allowance, setAllowance] = useState('');
  const [amount, setAmount] = useState('');
  const [creditNote, setCreditNote] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);

  // The form follows the account when it loads or changes underneath.
  useEffect(() => {
    if (!data) return;
    setPlan(data.account.plan);
    setStatus(data.account.status);
    setAllowance(data.subscription?.credit_allowance == null ? '' : String(data.subscription.credit_allowance));
    setNote(data.controls.note || '');
  }, [data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });
  const done = (msg: string) => () => { refresh(); toast.success(msg); };

  const planMut = useMutation({
    mutationFn: () => adminApi.setPlan(id, plan, status),
    onSuccess: (r) => {
      refresh();
      toast.success(r.stripe_managed
        ? 'Plan saved. This account pays through Stripe, so Stripe will set the plan again at its next change.'
        : 'Plan saved.');
    },
    onError: (e) => toast.error(errMsg(e, 'The plan could not be changed.')),
  });
  const allowanceMut = useMutation({
    mutationFn: (v: number | null) => adminApi.setAllowance(id, v),
    onSuccess: done('Credit allowance saved.'),
    onError: (e) => toast.error(errMsg(e, 'The allowance could not be saved.')),
  });
  const creditsMut = useMutation({
    mutationFn: () => adminApi.adjustCredits(id, Number(amount), creditNote),
    onSuccess: () => { done(Number(amount) > 0 ? 'Credits given.' : 'Credits taken.')(); setAmount(''); setCreditNote(''); },
    onError: (e) => toast.error(errMsg(e, 'The credits could not be changed.')),
  });
  const noteMut = useMutation({
    mutationFn: () => adminApi.setNote(id, note),
    onSuccess: done('Note saved.'),
    onError: (e) => toast.error(errMsg(e, 'The note could not be saved.')),
  });
  const suspendMut = useMutation({
    mutationFn: () => adminApi.suspend(id, reason),
    onSuccess: () => { done('Account suspended. They are signed out and nothing of theirs runs.')(); setReason(''); },
    onError: (e) => toast.error(errMsg(e, 'The account could not be suspended.')),
  });
  const unsuspendMut = useMutation({
    mutationFn: () => adminApi.unsuspend(id),
    onSuccess: done('Suspension lifted. They can sign in again.'),
    onError: (e) => toast.error(errMsg(e, 'The suspension could not be lifted.')),
  });

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>;
  if (isError || !data) {
    return (
      <div className="py-16 text-center">
        <p className="text-body text-[var(--text-tertiary)]">{errMsg(error, 'This account could not be loaded.')}</p>
        <Link to="/admin/accounts" className="mt-3 inline-flex items-center gap-1 text-body text-[var(--indigo-text)] hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> All accounts</Link>
      </div>
    );
  }

  const { account: a, credits, emails, totals, controls, subscription: sub } = data;
  const planChanged = plan !== a.plan || status !== a.status;
  const allowanceValue = allowance.trim() === '' ? null : Number(allowance);
  const allowanceChanged = allowanceValue !== (sub?.credit_allowance ?? null);
  const amountN = Number(amount);
  const canAdjust = amount.trim() !== '' && Number.isFinite(amountN) && amountN !== 0 && creditNote.trim().length > 0;
  const creditPct = credits.allowance > 0 ? Math.min(100, (credits.used / credits.allowance) * 100) : 0;

  const copyId = async () => {
    try { await navigator.clipboard.writeText(a.id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <div className="space-y-4">
      <Link to="/admin/accounts" className="inline-flex items-center gap-1 text-body text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
        <ArrowLeft className="h-3.5 w-3.5" /> All accounts
      </Link>

      {/* Who */}
      <div className="flex items-start gap-3 flex-wrap">
        <Avatar email={a.email} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-title font-semibold text-[var(--text-primary)] tracking-[-0.01em] truncate">{a.email}</h2>
          <div className="mt-1 flex items-center gap-2 flex-wrap text-caption text-[var(--text-tertiary)]">
            <PlanBadge plan={a.plan} status={a.status} suspended={a.suspended} />
            {a.effective_plan !== a.plan && a.plan !== 'lifetime' && <span>runs as {PLANS[a.effective_plan as PlanId]?.name || a.effective_plan}</span>}
            <span>Joined {formatDateTime(a.created_at)}</span>
            <span>Last seen {relTime(a.last_sign_in_at)}</span>
            {!a.email_confirmed && <span className="text-amber-700 dark:text-amber-400">Email not confirmed</span>}
            <button onClick={copyId} className="inline-flex items-center gap-1 font-mono hover:text-[var(--text-primary)]" aria-label="Copy account id">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{a.id.slice(0, 8)}
            </button>
            {sub?.stripe_customer_id && (
              <a href={`https://dashboard.stripe.com/customers/${sub.stripe_customer_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]">
                <CreditCard className="h-3 w-3" /> Stripe <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>
      </div>

      {a.suspended && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex-wrap">
          <Ban className="h-4 w-4 text-red-600 dark:text-red-400" />
          <p className="flex-1 text-body text-[var(--text-primary)]">
            Suspended {controls.suspended_at ? relTime(controls.suspended_at).toLowerCase() : ''}{controls.suspended_reason ? `: ${controls.suspended_reason}` : '.'} They cannot sign in, and their campaigns and searches do not run.
          </p>
          <Button size="sm" variant="secondary" disabled={unsuspendMut.isPending} onClick={() => unsuspendMut.mutate()}>
            {unsuspendMut.isPending ? 'Lifting…' : 'Lift suspension'}
          </Button>
        </div>
      )}
      {!data.controls_ready && (
        <p className="flex items-center gap-1.5 text-caption text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" /> Run database migration 101 to turn on suspension, the private note and this account’s activity.
        </p>
      )}

      {/* The numbers */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile
          label="Credits this month"
          value={<>{formatCredits(credits.used)} <span className="text-body font-normal text-[var(--text-tertiary)]">/ {formatCredits(credits.allowance)}</span></>}
          sub={<>
            <span className="block h-1 rounded-full bg-[var(--bg-muted)] overflow-hidden my-1"><span className={cn('block h-full', creditPct >= 100 ? 'bg-red-500' : creditPct >= 80 ? 'bg-amber-500' : 'bg-[var(--indigo)]')} style={{ width: `${creditPct}%` }} /></span>
            {formatCredits(credits.remaining)} left{credits.bonus > 0 ? `, ${formatCredits(credits.bonus)} bonus` : ''}
          </>}
        />
        <Tile label="Profit this month" value={usd(a.profit_usd)} tone={moneyTone(a.profit_usd)} sub={`${usd(a.revenue_usd)} paid, ${usd(a.cost_usd)} cost`} />
        <Tile label="Lifetime revenue" value={usd(totals.lifetime_revenue_usd)} sub={`${data.payments.length} payment${data.payments.length === 1 ? '' : 's'}`} />
        <Tile label="Lifetime profit" value={usd(totals.lifetime_profit_usd)} tone={moneyTone(totals.lifetime_profit_usd)} sub={`${usd(totals.lifetime_cost_usd)} Icypeas, ${usd(totals.lifetime_fees_usd)} fees`} />
        <Tile label="Emails this month" value={emails.sent.toLocaleString()} sub={`of ${limitLabel(emails.limit)}`} />
        <Tile label="Inboxes" value={emails.inboxes.toLocaleString()} sub={`of ${limitLabel(emails.inbox_limit)}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <Card title="Last six months" icon={Gauge}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-body">
                <thead>
                  <tr className="text-caption text-[var(--text-tertiary)]">
                    <th className="pb-2 pr-4 font-medium">Month</th>
                    <th className="pb-2 pr-4 font-medium text-right">Credits used</th>
                    <th className="pb-2 pr-4 font-medium text-right">Icypeas credits</th>
                    <th className="pb-2 pr-4 font-medium text-right">Cost</th>
                    <th className="pb-2 pr-4 font-medium text-right">Paid</th>
                    <th className="pb-2 font-medium text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((m) => (
                    <tr key={m.month} className="border-t border-[var(--border-subtle)]">
                      <td className="py-2 pr-4 text-[var(--text-primary)]">{monthLabel(m.month)}</td>
                      <td className="py-2 pr-4 text-right tabular">{formatCredits(m.credits_used)}</td>
                      <td className="py-2 pr-4 text-right tabular text-[var(--text-secondary)]">{formatCredits(m.provider_credits)}</td>
                      <td className="py-2 pr-4 text-right tabular text-[var(--text-secondary)]">{usd(m.cost_usd)}</td>
                      <td className="py-2 pr-4 text-right tabular text-[var(--text-secondary)]">{usd(m.revenue_usd)}</td>
                      <td className={cn('py-2 text-right tabular font-medium', moneyTone(m.profit_usd))}>{usd(m.profit_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Credit activity" icon={Wallet} aside={<span className="text-caption text-[var(--text-tertiary)]">{totals.lifetime_credits_used ? `${formatCredits(totals.lifetime_credits_used)} used all time` : ''}</span>}>
            {data.ledger.length === 0 ? (
              <p className="text-body text-[var(--text-tertiary)]">No credit activity in the last six months.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)] max-h-[360px] overflow-y-auto -my-2">
                {data.ledger.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2 text-body">
                    <span className={cn('w-14 shrink-0 text-right tabular font-medium', r.delta < 0 ? 'text-[var(--text-primary)]' : 'text-emerald-700 dark:text-emerald-400')}>
                      {r.delta > 0 ? '+' : ''}{formatCredits(r.delta)}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)]">
                      {CREDIT_ACTION_LABELS[r.action || ''] || r.action || r.kind}
                      {r.kind === 'refund' && <span className="text-[var(--text-tertiary)]"> · refund</span>}
                      {r.reason && r.kind !== 'spend' && <span className="text-[var(--text-tertiary)]"> · {r.reason.replace(/_/g, ' ')}</span>}
                    </span>
                    <span className="shrink-0 text-caption text-[var(--text-tertiary)] tabular">{formatDateTime(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="What they cost us" icon={Gauge} aside={<span className="text-caption text-[var(--text-tertiary)]">Paid Icypeas calls</span>}>
            {data.calls.length === 0 ? (
              <p className="text-body text-[var(--text-tertiary)]">No paid calls in the last six months.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)] max-h-[300px] overflow-y-auto -my-2">
                {data.calls.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2 text-body">
                    <span className="w-16 shrink-0 text-right tabular text-[var(--text-primary)]">{usd(c.cost_usd)}</span>
                    <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)]">
                      {CREDIT_ACTION_LABELS[c.action] || c.action}
                      <span className="text-[var(--text-tertiary)]"> · {formatCredits(c.provider_credits)} Icypeas · <span className="font-mono">{c.endpoint}</span></span>
                    </span>
                    <span className="shrink-0 text-caption text-[var(--text-tertiary)] tabular">{formatDateTime(c.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Payments" icon={CreditCard}>
            {data.payments.length === 0 ? (
              <p className="text-body text-[var(--text-tertiary)]">No payments recorded.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)] -my-2">
                {data.payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2 text-body">
                    <span className="w-20 shrink-0 text-right tabular font-medium text-[var(--text-primary)]">{usd(p.amount_usd)}</span>
                    <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)] capitalize">{p.kind.replace('_', ' ')}<span className="normal-case text-[var(--text-tertiary)] font-mono"> · {p.stripe_ref}</span></span>
                    <span className="shrink-0 text-caption text-[var(--text-tertiary)] tabular">{formatDateTime(p.paid_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Controls */}
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
              {PLANS[plan as PlanId] ? `${limitLabel(PLANS[plan as PlanId].emailsPerMonth)} emails, ${limitLabel(PLANS[plan as PlanId].maxInboxes)} inboxes, ${formatCredits(PLANS[plan as PlanId].prospectCredits)} credits a month.` : ''}
              {sub?.stripe_subscription_id && ' Pays through Stripe: Stripe sets the plan again at its next change.'}
            </p>
            <Button className="mt-3 w-full" disabled={!planChanged || planMut.isPending} onClick={() => planMut.mutate()}>
              {planMut.isPending ? 'Saving…' : 'Save plan'}
            </Button>
          </Card>

          <Card title="Credits" icon={Wallet}>
            <label className="block text-caption text-[var(--text-tertiary)]">
              Monthly allowance
              <input
                type="number" min={0} step={0.1} inputMode="decimal" value={allowance}
                onChange={(e) => setAllowance(e.target.value)}
                placeholder={`Plan default (${formatCredits(PLANS[a.effective_plan as PlanId]?.prospectCredits ?? 0)})`}
                className={cn(inputCls, 'mt-1')}
              />
            </label>
            <div className="mt-2 flex gap-2">
              <Button size="sm" className="flex-1" disabled={!allowanceChanged || allowanceMut.isPending || (allowanceValue !== null && !Number.isFinite(allowanceValue))} onClick={() => allowanceMut.mutate(allowanceValue)}>
                Save allowance
              </Button>
              {sub?.credit_allowance != null && (
                <Button size="sm" variant="ghost" disabled={allowanceMut.isPending} onClick={() => { setAllowance(''); allowanceMut.mutate(null); }}>Use plan’s</Button>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
              <p className="text-caption font-medium text-[var(--text-secondary)] flex items-center gap-1.5"><PlusCircle className="h-3.5 w-3.5" /> Give or take credits</p>
              <p className="text-micro text-[var(--text-tertiary)] mt-0.5">Given credits never expire and are used after the plan’s. A minus number takes them off this month’s allowance.</p>
              <form
                className="mt-2 space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!canAdjust) return;
                  confirm({
                    title: amountN > 0 ? `Give ${formatCredits(amountN)} credits?` : `Take ${formatCredits(-amountN)} credits?`,
                    body: `${a.email} — “${creditNote.trim()}”. This goes in the activity log.`,
                    confirmLabel: amountN > 0 ? 'Give credits' : 'Take credits',
                  }, () => creditsMut.mutate());
                }}
              >
                <input type="number" step={0.1} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 50 or -20" aria-label="Credits to give or take" className={inputCls} />
                <input type="text" value={creditNote} onChange={(e) => setCreditNote(e.target.value)} maxLength={300} placeholder="Why, for the record" aria-label="Why" className={inputCls} />
                <Button type="submit" size="sm" variant="secondary" className="w-full" disabled={!canAdjust || creditsMut.isPending}>
                  {creditsMut.isPending ? 'Saving…' : amountN < 0 ? 'Take credits' : 'Give credits'}
                </Button>
              </form>
            </div>
          </Card>

          <Card title="Private note" icon={NotebookPen} aside={<span className="text-micro text-[var(--text-tertiary)]">Only you see this</span>}>
            <textarea
              value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} rows={4}
              placeholder="Deal terms, who they are, what they asked for…"
              aria-label="Private note"
              disabled={!data.controls_ready}
              className={cn(inputCls, 'h-auto py-2 resize-y')}
            />
            <Button size="sm" variant="secondary" className="mt-2 w-full" disabled={!data.controls_ready || note === (controls.note || '') || noteMut.isPending} onClick={() => noteMut.mutate()}>
              {noteMut.isPending ? 'Saving…' : 'Save note'}
            </Button>
          </Card>

          <Card title="On the platform" icon={Mail}>
            <dl className="grid grid-cols-2 gap-y-2 text-body">
              {([['Mailboxes', data.resources.mailboxes], ['Domains', data.resources.domains], ['Contacts', data.resources.contacts], ['Campaigns', data.resources.campaigns]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-caption text-[var(--text-tertiary)]">{k}</dt><dd className="tabular text-[var(--text-primary)]">{v.toLocaleString()}</dd></div>
              ))}
            </dl>
            {sub && (
              <p className="mt-3 text-micro text-[var(--text-tertiary)]">
                {sub.trial_ends_at && `Trial ends ${formatDateTime(sub.trial_ends_at)}. `}
                {sub.current_period_end && `Paid to ${formatDateTime(sub.current_period_end)}.`}
              </p>
            )}
          </Card>

          <Card title="Activity on this account" icon={History}>
            {data.audit.length === 0 ? (
              <p className="text-body text-[var(--text-tertiary)]">No changes made from here yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.audit.map((e) => (
                  <li key={e.id} className="text-body">
                    <p className="text-[var(--text-primary)]">{describeAudit(e)}</p>
                    <p className="text-micro text-[var(--text-tertiary)]">{formatDateTime(e.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {!a.suspended && (
            <section className="rounded-xl border border-red-500/30 bg-[var(--bg-surface)] p-4">
              <p className="text-strong font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5"><Ban className="h-3.5 w-3.5" /> Suspend account</p>
              <p className="mt-1 text-caption text-[var(--text-tertiary)]">Signs them out and stops them signing in. Their campaigns stop sending and nothing paid runs. Their data is kept, and you can lift it any time.</p>
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (only you see it)" aria-label="Reason for suspending" className={cn(inputCls, 'mt-2')} disabled={!data.controls_ready} />
              <Button
                size="sm" variant="danger" className="mt-2 w-full"
                disabled={!data.controls_ready || suspendMut.isPending}
                onClick={() => confirm({
                  title: `Suspend ${a.email}?`,
                  body: 'They are signed out at once and cannot sign back in until you lift it. Campaigns stop sending.',
                  confirmLabel: 'Suspend',
                  tone: 'danger',
                }, () => suspendMut.mutate())}
              >
                {suspendMut.isPending ? 'Suspending…' : 'Suspend account'}
              </Button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

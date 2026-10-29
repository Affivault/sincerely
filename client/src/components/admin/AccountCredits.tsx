import { useEffect, useState } from 'react';
import { Gauge, PlusCircle, Wallet } from 'lucide-react';
import { CREDIT_ACTION_LABELS, PLANS, formatCredits, formatDateTime, type AdminAccountDetail, type PlanId } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { Card, inputCls, useAdminAction } from './adminUi';
import { usd } from './adminFormat';

/* Credits: the monthly allowance, giving or taking, and where they went. */
export function AccountCredits({ id, data }: { id: string; data: AdminAccountDetail }) {
  const confirm = useConfirm();
  const { account: a, subscription: sub, totals } = data;
  const [allowance, setAllowance] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const saved = sub?.credit_allowance ?? null;
  useEffect(() => { setAllowance(saved == null ? '' : String(saved)); }, [saved]);

  const allowanceValue = allowance.trim() === '' ? null : Number(allowance);
  const allowanceChanged = allowanceValue !== saved;
  const amountN = Number(amount);
  const canAdjust = amount.trim() !== '' && Number.isFinite(amountN) && amountN !== 0 && note.trim().length > 0;

  const allowanceMut = useAdminAction((v: number | null) => adminApi.setAllowance(id, v), 'Credit allowance saved.', 'The allowance could not be saved.');
  const creditsMut = useAdminAction(() => adminApi.adjustCredits(id, amountN, note), () => (amountN > 0 ? 'Credits given.' : 'Credits taken.'), 'The credits could not be changed.');

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
      <div className="space-y-4 min-w-0">
        <Card title="Credit activity" icon={Wallet} aside={<span className="text-caption text-[var(--text-tertiary)]">{totals.lifetime_credits_used ? `${formatCredits(totals.lifetime_credits_used)} used all time` : ''}</span>}>
          {data.ledger.length === 0 ? (
            <p className="text-body text-[var(--text-tertiary)]">No credit activity in the last six months.</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)] max-h-[420px] overflow-y-auto -my-2">
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
            <ul className="divide-y divide-[var(--border-subtle)] max-h-[320px] overflow-y-auto -my-2">
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
      </div>

      <Card title="Allowance" icon={Wallet}>
        <label className="block text-caption text-[var(--text-tertiary)]">
          Credits a month
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
          {saved != null && (
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
                body: `${a.email}: “${note.trim()}”. This goes in the activity log.`,
                confirmLabel: amountN > 0 ? 'Give credits' : 'Take credits',
              }, () => creditsMut.mutate(undefined, { onSuccess: () => { setAmount(''); setNote(''); } }));
            }}
          >
            <input type="number" step={0.1} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 50 or -20" aria-label="Credits to give or take" className={inputCls} />
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why, for the record" aria-label="Why" className={inputCls} />
            <Button type="submit" size="sm" variant="secondary" className="w-full" disabled={!canAdjust || creditsMut.isPending}>
              {creditsMut.isPending ? 'Saving…' : amountN < 0 ? 'Take credits' : 'Give credits'}
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}

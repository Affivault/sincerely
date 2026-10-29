import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Ban, Check, Copy, CreditCard, ExternalLink, Eye, Gauge, History, Mail, NotebookPen, PauseCircle, RefreshCw, X,
} from 'lucide-react';
import { PLANS, formatCredits, formatDate, formatDateTime, isUnlimited, type AdminAccountDetail, type PlanId } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Avatar } from '../shared/Avatar';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { openModals } from '../ui/Modal';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { startViewAs } from '../../lib/viewAs';
import { cn } from '../../lib/utils';
import { AccountBilling } from './AccountBilling';
import { AccountCredits } from './AccountCredits';
import { AccountControls } from './AccountControls';
import { Banner, Card, Tile, errMsg, inputCls, useAdminAction } from './adminUi';
import { PlanBadge, describeAudit, moneyTone, monthLabel, relTime, usd } from './adminFormat';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'billing', label: 'Billing' },
  { id: 'credits', label: 'Credits' },
  { id: 'account', label: 'Account' },
  { id: 'history', label: 'History' },
] as const;
type Tab = typeof TABS[number]['id'];

const limitLabel = (n: number) => (isUnlimited(n) ? 'unlimited' : n.toLocaleString());

/*
 * One account in full, sliding in over the accounts list so the list keeps
 * its place: who they are and the quick actions on top, then a tab each for
 * the overview, billing, credits, the account itself and its history.
 */
export function AccountPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const setTab = (t: Tab) => { const next = new URLSearchParams(params); if (t === 'overview') next.delete('tab'); else next.set('tab', t); setParams(next, { replace: true }); };

  const panelRef = useRef<HTMLDivElement>(null);
  const identity = useRef({});
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isTopmost = useCallback(() => openModals[openModals.length - 1] === identity.current, []);
  useFocusTrap(panelRef, true, { topmost: isTopmost });

  // On the shared overlay stack, so Escape in a dialog opened from here closes only that dialog.
  useEffect(() => {
    const self = identity.current;
    openModals.push(self);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && openModals[openModals.length - 1] === self) onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = openModals.lastIndexOf(self);
      if (at !== -1) openModals.splice(at, 1);
      document.body.style.overflow = overflow;
    };
  }, []);

  const { data, isLoading, isError, error } = useQuery({ queryKey: ['admin', 'account', id], queryFn: () => adminApi.account(id) });

  return createPortal(
    <div className="fixed inset-0 z-[57]">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] animate-[fadeIn_120ms_ease-out]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={data ? `Account ${data.account.email}` : 'Account'}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 w-full sm:w-[min(920px,94vw)] bg-[var(--bg-app)] shadow-2xl flex flex-col outline-none animate-[slideInRight_160ms_ease-out]"
      >
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>
        ) : isError || !data ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-body text-[var(--text-tertiary)]">{errMsg(error, 'This account could not be loaded.')}</p>
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <PanelHeader id={id} data={data} onClose={onClose} />
            <nav aria-label="Account sections" className="flex gap-1 px-4 sm:px-6 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-x-auto shrink-0">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? 'page' : undefined}
                  className={cn(
                    'relative shrink-0 h-10 px-3 text-body font-medium transition-colors',
                    tab === t.id
                      ? 'text-[var(--text-primary)] after:absolute after:inset-x-2 after:-bottom-px after:h-[2px] after:rounded-full after:bg-[var(--indigo)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </nav>
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
              {tab === 'overview' && <OverviewTab id={id} data={data} />}
              {tab === 'billing' && <AccountBilling id={id} data={data} />}
              {tab === 'credits' && <AccountCredits id={id} data={data} />}
              {tab === 'account' && <AccountControls id={id} data={data} onDeleted={onClose} />}
              {tab === 'history' && <HistoryTab data={data} />}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function PanelHeader({ id, data, onClose }: { id: string; data: AdminAccountDetail; onClose: () => void }) {
  const { account: a, subscription: sub } = data;
  const [copied, setCopied] = useState(false);
  const syncMut = useAdminAction(() => adminApi.syncStripe(id), 'Synced from Stripe.', 'Stripe could not be reached.');
  const viewMut = useAdminAction(() => adminApi.viewAs(id), 'Opened in a new tab, read-only for 30 minutes.', 'Could not open their view.');

  const copyId = async () => {
    try { await navigator.clipboard.writeText(a.id); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <header className="shrink-0 px-4 sm:px-6 pt-4 pb-3 bg-[var(--bg-surface)]">
      <div className="flex items-start gap-3">
        <Avatar email={a.email} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-heading font-semibold text-[var(--text-primary)] tracking-[-0.01em] truncate">{a.email}</h2>
          <div className="mt-1 flex items-center gap-x-2.5 gap-y-1 flex-wrap text-caption text-[var(--text-tertiary)]">
            <PlanBadge plan={a.plan} status={a.status} suspended={a.suspended} />
            {a.effective_plan !== a.plan && a.plan !== 'lifetime' && <span>runs as {PLANS[a.effective_plan as PlanId]?.name || a.effective_plan}</span>}
            <span>Joined {formatDate(new Date(a.created_at))}</span>
            <span>Seen {relTime(a.last_sign_in_at).toLowerCase()}</span>
            {!a.email_confirmed && <span className="text-amber-700 dark:text-amber-400">Email not confirmed</span>}
            <button onClick={copyId} className="inline-flex items-center gap-1 font-mono hover:text-[var(--text-primary)]" aria-label="Copy account id">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{a.id.slice(0, 8)}
            </button>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="secondary" disabled={viewMut.isPending} onClick={() => viewMut.mutate(undefined, { onSuccess: (r) => startViewAs(r) })}>
          <Eye className="h-3.5 w-3.5" /> View as them
        </Button>
        {sub?.stripe_customer_id && (
          <>
            <Button size="sm" variant="ghost" disabled={syncMut.isPending} onClick={() => syncMut.mutate(undefined)}>
              <RefreshCw className={cn('h-3.5 w-3.5', syncMut.isPending && 'animate-spin')} /> Sync from Stripe
            </Button>
            <a href={`https://dashboard.stripe.com/customers/${sub.stripe_customer_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-body text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
              <CreditCard className="h-3.5 w-3.5" /> Stripe <ExternalLink className="h-3 w-3" />
            </a>
          </>
        )}
        <a href={`mailto:${a.email}`} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-body text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
          <Mail className="h-3.5 w-3.5" /> Email
        </a>
      </div>
    </header>
  );
}

function OverviewTab({ id, data }: { id: string; data: AdminAccountDetail }) {
  const { account: a, credits, emails, totals, controls, stripe } = data;
  const [note, setNote] = useState(controls.note || '');
  const savedNote = controls.note || '';
  useEffect(() => { setNote(savedNote); }, [savedNote]);
  const noteMut = useAdminAction(() => adminApi.setNote(id, note), 'Note saved.', 'The note could not be saved.');
  const creditPct = credits.allowance > 0 ? Math.min(100, (credits.used / credits.allowance) * 100) : 0;

  return (
    <div className="space-y-4">
      {a.suspended && (
        <Banner tone="danger" icon={Ban}>
          Suspended {controls.suspended_at ? relTime(controls.suspended_at).toLowerCase() : ''}{controls.suspended_reason ? ` (${controls.suspended_reason.replace(/[.\s]+$/, '')})` : ''}. They cannot sign in, and nothing of theirs runs.
        </Banner>
      )}
      {controls.sending_paused_at && <Banner tone="warn" icon={PauseCircle}>Sending is on hold since {formatDateTime(controls.sending_paused_at)}. Lift it under Account.</Banner>}
      {a.status === 'past_due' && <Banner tone="danger" icon={CreditCard}>Their last payment failed. Stripe is retrying; until it succeeds they run as Free.</Banner>}
      {stripe?.cancel_at_period_end && <Banner tone="warn" icon={CreditCard}>Cancelling: they drop to Free on {formatDate(new Date(stripe.cancel_at || stripe.current_period_end || Date.now()))}.</Banner>}
      {!data.controls_ready && <Banner tone="warn" icon={AlertTriangle}>Run database migration 101 to turn on suspension, the private note and this account’s history.</Banner>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Tile
          label="Credits this month"
          value={<>{formatCredits(credits.used)} <span className="text-body font-normal text-[var(--text-tertiary)]">/ {formatCredits(credits.allowance)}</span></>}
          sub={<>
            <span className="block h-1 rounded-full bg-[var(--bg-muted)] overflow-hidden my-1"><span className={cn('block h-full', creditPct >= 100 ? 'bg-red-500' : creditPct >= 80 ? 'bg-amber-500' : 'bg-[var(--indigo)]')} style={{ width: `${creditPct}%` }} /></span>
            {formatCredits(credits.remaining)} left{credits.bonus > 0 ? `, ${formatCredits(credits.bonus)} bonus` : ''}
          </>}
        />
        <Tile label="Profit this month" value={usd(a.profit_usd)} tone={moneyTone(a.profit_usd)} sub={`${usd(a.revenue_usd)} paid, ${usd(a.cost_usd)} cost`} />
        <Tile label="Lifetime profit" value={usd(totals.lifetime_profit_usd)} tone={moneyTone(totals.lifetime_profit_usd)} sub={`${usd(totals.lifetime_revenue_usd)} paid, ${usd(totals.lifetime_cost_usd)} Icypeas`} />
        <Tile label="Emails this month" value={emails.sent.toLocaleString()} sub={`of ${limitLabel(emails.limit)}`} />
        <Tile label="Inboxes" value={emails.inboxes.toLocaleString()} sub={`of ${limitLabel(emails.inbox_limit)}`} />
        <Tile label="On the platform" value={data.resources.contacts.toLocaleString()} sub={`contacts, ${data.resources.campaigns} campaigns, ${data.resources.domains} domains`} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
        <Card title="Last six months" icon={Gauge}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full min-w-[480px] text-left text-body">
              <thead>
                <tr className="text-caption text-[var(--text-tertiary)]">
                  <th className="pb-2 px-1 font-medium">Month</th>
                  <th className="pb-2 px-1 font-medium text-right">Credits</th>
                  <th className="pb-2 px-1 font-medium text-right">Cost</th>
                  <th className="pb-2 px-1 font-medium text-right">Paid</th>
                  <th className="pb-2 px-1 font-medium text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map((m) => (
                  <tr key={m.month} className="border-t border-[var(--border-subtle)]">
                    <td className="py-2 px-1 text-[var(--text-primary)]">{monthLabel(m.month)}</td>
                    <td className="py-2 px-1 text-right tabular">{formatCredits(m.credits_used)}</td>
                    <td className="py-2 px-1 text-right tabular text-[var(--text-secondary)]">{usd(m.cost_usd)}</td>
                    <td className="py-2 px-1 text-right tabular text-[var(--text-secondary)]">{usd(m.revenue_usd)}</td>
                    <td className={cn('py-2 px-1 text-right tabular font-medium', moneyTone(m.profit_usd))}>{usd(m.profit_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Private note" icon={NotebookPen} aside={<span className="text-micro text-[var(--text-tertiary)]">Only admins see this</span>}>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} maxLength={5000} rows={6}
            placeholder="Deal terms, who they are, what they asked for…"
            aria-label="Private note"
            disabled={!data.controls_ready}
            className={cn(inputCls, 'h-auto py-2 resize-y')}
          />
          <Button size="sm" variant="secondary" className="mt-2 w-full" disabled={!data.controls_ready || note === savedNote || noteMut.isPending} onClick={() => noteMut.mutate(undefined)}>
            {noteMut.isPending ? 'Saving…' : 'Save note'}
          </Button>
        </Card>
      </div>
    </div>
  );
}

function HistoryTab({ data }: { data: AdminAccountDetail }) {
  return (
    <Card title="Changes made from the admin backend" icon={History}>
      {data.audit.length === 0 ? (
        <p className="text-body text-[var(--text-tertiary)]">No changes made from here yet.</p>
      ) : (
        <ol className="relative border-l border-[var(--border-subtle)] ml-1.5 space-y-3">
          {data.audit.map((e) => (
            <li key={e.id} className="pl-4">
              <span className="absolute -left-[4.5px] mt-1.5 h-2 w-2 rounded-full bg-[var(--indigo)]" aria-hidden />
              <p className="text-body text-[var(--text-primary)]">{describeAudit(e)}</p>
              <p className="text-micro text-[var(--text-tertiary)]">{formatDateTime(e.created_at)} · {e.actor_email}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

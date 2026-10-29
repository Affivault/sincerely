import { Crown } from 'lucide-react';
import { PLANS, type PlanId, formatDate, formatCredits } from '@lemlist/shared';
import type { AdminAuditEntry } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* Small pieces every admin screen shares: money, times, plan badges and the
   sentence each audit-log entry reads as. */

export const usd = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function relTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d < 1) { const h = Math.floor(diff / 3600000); return h < 1 ? 'Just now' : `${h}h ago`; }
  if (d < 30) return `${d}d ago`;
  return formatDate(new Date(iso));
}

export function thisMonth(offset = 0): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
}

/** "2026-10" -> "Oct 2026", in the viewer's language. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const PLAN_BADGE: Record<string, string> = {
  lifetime: 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)] border border-[rgba(47,63,156,0.3)]',
  growth: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  starter: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  scale: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
  trial: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  free: 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
};

export const planName = (plan: string) => PLANS[plan as PlanId]?.name || plan;

export function PlanBadge({ plan, status, suspended }: { plan: string; status?: string; suspended?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className={cn('inline-flex items-center gap-1 px-1.5 h-[19px] text-micro font-medium rounded', PLAN_BADGE[plan] || PLAN_BADGE.free)}>
        {plan === 'lifetime' && <Crown className="h-2.5 w-2.5" />}
        {planName(plan)}
      </span>
      {status === 'trialing' && plan !== 'lifetime' && <span className="text-micro text-amber-700 dark:text-amber-400">trial</span>}
      {status && !['active', 'free', 'trialing'].includes(status) && <span className="text-micro text-[var(--text-tertiary)]">{status.replace('_', ' ')}</span>}
      {suspended && (
        <span className="inline-flex items-center px-1.5 h-[19px] text-micro font-semibold rounded bg-red-500/10 text-red-700 dark:text-red-400">Suspended</span>
      )}
    </span>
  );
}

export const moneyTone = (n: number) =>
  n < 0 ? 'text-red-600 dark:text-red-400' : n > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-[var(--text-secondary)]';

/** One audit-log entry as a sentence: "Changed the plan from Free to Growth". */
export function describeAudit(e: AdminAuditEntry): string {
  const d = e.details || {};
  switch (e.action) {
    case 'plan': {
      const from = d.from ? `${planName(d.from.plan)}${d.from.status && d.from.status !== 'active' && d.from.status !== 'free' ? ` (${d.from.status})` : ''}` : 'none';
      const to = d.to ? `${planName(d.to.plan)}${d.to.status && d.to.status !== 'active' && d.to.status !== 'free' ? ` (${d.to.status})` : ''}` : '?';
      const inStripe = d.stripe === 'changed' ? ', in Stripe too' : d.stripe === 'canceled' ? ' and cancelled their Stripe subscription' : '';
      return `Changed the plan from ${from} to ${to}${inStripe}`;
    }
    case 'allowance':
      return d.to === null || d.to === undefined
        ? 'Put the credit allowance back to the plan’s'
        : `Set the credit allowance to ${formatCredits(Number(d.to))} a month`;
    case 'credits': {
      const n = Number(d.amount) || 0;
      return `${n > 0 ? 'Gave' : 'Took'} ${formatCredits(Math.abs(n))} credits${d.note ? `: “${d.note}”` : ''}`;
    }
    case 'suspend': return `Suspended the account${d.reason ? `: “${d.reason}”` : ''}`;
    case 'unsuspend': return 'Lifted the suspension';
    case 'note': return d.length ? 'Updated the private note' : 'Cleared the private note';
    case 'lifetime_grant': return 'Granted lifetime access';
    case 'lifetime_revoke': return 'Revoked lifetime access';
    case 'stripe_sync': return 'Synced the account from Stripe';
    case 'cancel_subscription': return d.when === 'now' ? 'Cancelled their Stripe subscription now' : 'Set their subscription to cancel at the period end';
    case 'resume_subscription': return 'Kept their subscription (undid the cancellation)';
    case 'extend_trial': return `Extended the trial by ${d.days} day${d.days === 1 ? '' : 's'}`;
    case 'stripe_credit': return `Gave ${usd(Number(d.amount_usd) || 0)} account credit in Stripe${d.note ? `: “${d.note}”` : ''}`;
    case 'discount': return `Applied ${d.percent}% off${d.months ? ` for ${d.months} month${d.months === 1 ? '' : 's'}` : ' for good'}`;
    case 'discount_removed': return 'Removed their discount';
    case 'refund': return `Refunded ${usd(Number(d.amount_usd) || 0)}`;
    case 'sign_in_link': return 'Made a one-time sign-in link';
    case 'reset_link': return 'Made a password reset link';
    case 'reset_email': return 'Sent a password reset email';
    case 'email': return `Changed the email from ${d.from} to ${d.to}`;
    case 'verify_email': return 'Marked the email as confirmed';
    case 'sign_out': return 'Signed them out everywhere';
    case 'pause_campaigns': return `Paused ${d.paused ?? 0} campaign${d.paused === 1 ? '' : 's'}`;
    case 'hold_sending': return 'Put all sending on hold';
    case 'release_sending': return 'Lifted the sending hold';
    case 'view_as': return 'Viewed the app as them (read-only)';
    case 'delete_account': return 'Deleted the account';
    case 'overrides': {
      const l = d.limits || {}; const f = d.features || {};
      const parts = [
        l.maxInboxes !== undefined ? `${l.maxInboxes < 0 ? 'unlimited' : l.maxInboxes} inboxes` : '',
        l.emailsPerMonth !== undefined ? `${l.emailsPerMonth < 0 ? 'unlimited' : Number(l.emailsPerMonth).toLocaleString()} emails a month` : '',
        ...Object.entries(f).map(([k, v]) => `${k === 'sara' ? 'Relay' : k === 'abTesting' ? 'A/B tests' : k} ${v ? 'on' : 'off'}`),
      ].filter(Boolean);
      return parts.length ? `Set their own limits: ${parts.join(', ')}` : 'Put their limits back to the plan’s';
    }
    case 'mailbox_paused': return `Paused the mailbox ${d.mailbox}`;
    case 'mailbox_resumed': return `Turned the mailbox ${d.mailbox} back on`;
    case 'setting_plans': return 'Changed the plan limits for everyone';
    case 'setting_credit_prices': return 'Changed the credit prices';
    case 'setting_signups': return d.mode === 'open' ? 'Opened sign-ups' : d.mode === 'closed' ? 'Closed sign-ups' : `Made sign-ups invite-only (${d.allowed ?? 0} on the list)`;
    case 'setting_announcement': return d.text ? `Posted the announcement: “${d.text}”` : 'Took the announcement down';
    case 'setting_kill_switch': return d.on ? `Stopped all sending on the platform: “${d.reason}”` : 'Turned sending back on for the platform';
    default: return e.action;
  }
}

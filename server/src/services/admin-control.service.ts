import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { isOwnerEmail } from '../config/admin.js';
import { AppError } from '../middleware/error.middleware.js';
import { accountControls } from './account-controls.service.js';
import { adminAccountsService, getSubscriptionRow, getUser, stripeLive, writeControls } from './admin-accounts.service.js';
import { settingsService } from './settings.service.js';
import { stripeService } from './stripe.service.js';
import { viewAs } from './view-as.service.js';

/*
 * The owner's hands on one account: billing done in Stripe itself (cancel,
 * resume, extend a trial, credit, discount, refund), and the account
 * (sign-in links, email, sign out everywhere, pause campaigns, hold sending,
 * view as them, delete). Every action is written to the activity log.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Run a Stripe call, turning its failure into one clear message. */
async function inStripe<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (!stripeService.isConfigured()) throw new AppError('Stripe is not configured on the server.', 503);
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(`Stripe refused to ${what}: ${(err as Error).message}`, 502);
  }
}

async function target(userId: string) {
  const user = await getUser(userId);
  return { user, ref: { id: userId, email: user.email || null } };
}

async function liveSubscriptionOf(userId: string) {
  const sub = await getSubscriptionRow(userId);
  const live = await stripeLive(sub?.stripe_subscription_id);
  if (!live) throw new AppError('This account has no live Stripe subscription.', 400);
  return live;
}

export const adminControlService = {
  /* ─── Billing ──────────────────────────────────────────────────────── */

  /** What Stripe says right now, for the account page. Never fails the page. */
  async stripeSummary(userId: string) {
    const sub = await getSubscriptionRow(userId);
    if (!sub?.stripe_subscription_id || !stripeService.isConfigured()) return null;
    try {
      return await stripeService.subscriptionSummary(sub.stripe_subscription_id);
    } catch (err) {
      console.warn(`[Admin] Could not read ${userId}'s subscription from Stripe: ${(err as Error).message}`);
      return null;
    }
  },

  async cancelSubscription(actor: string, userId: string, when: 'now' | 'period_end') {
    const { ref } = await target(userId);
    const live = await liveSubscriptionOf(userId);
    if (when === 'now') {
      await inStripe('cancel the subscription', () => stripeService.cancelSubscriptionNow(live));
    } else {
      await inStripe('schedule the cancellation', () => stripeService.setCancelAtPeriodEnd(live.id, true));
    }
    await adminAccountsService.audit(actor, 'cancel_subscription', ref, { when });
  },

  async resumeSubscription(actor: string, userId: string) {
    const { ref } = await target(userId);
    const live = await liveSubscriptionOf(userId);
    await inStripe('resume the subscription', () => stripeService.setCancelAtPeriodEnd(live.id, false));
    await adminAccountsService.audit(actor, 'resume_subscription', ref);
  },

  async extendTrial(actor: string, userId: string, days: number) {
    const n = Math.round(Number(days));
    if (!Number.isFinite(n) || n < 1 || n > 365) throw new AppError('Give between 1 and 365 days.', 400);
    const { ref } = await target(userId);
    const live = await liveSubscriptionOf(userId);
    const until = await inStripe('extend the trial', () => stripeService.extendTrial(live.id, n));
    await adminAccountsService.audit(actor, 'extend_trial', ref, { days: n, until });
    return { until };
  },

  async creditBalance(actor: string, userId: string, amountUsd: number, note: string) {
    const amount = Math.round(Number(amountUsd) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) throw new AppError('Give between $0.01 and $10,000.', 400);
    const why = String(note || '').trim().slice(0, 300);
    if (!why) throw new AppError('Add a note saying why, for the record.', 400);
    const { ref } = await target(userId);
    const sub = await getSubscriptionRow(userId);
    if (!sub?.stripe_customer_id) throw new AppError('This account has never paid through Stripe, so there is nothing to credit.', 400);
    await inStripe('add the credit', () => stripeService.creditBalance(sub.stripe_customer_id, amount, why));
    await adminAccountsService.audit(actor, 'stripe_credit', ref, { amount_usd: amount, note: why });
  },

  async applyDiscount(actor: string, userId: string, percent: number, months: number) {
    const p = Math.round(Number(percent));
    const m = Math.round(Number(months));
    if (!Number.isFinite(p) || p < 1 || p > 100) throw new AppError('The discount must be between 1% and 100%.', 400);
    if (!Number.isFinite(m) || m < 0 || m > 36) throw new AppError('Months must be between 0 (forever) and 36.', 400);
    const { ref } = await target(userId);
    const live = await liveSubscriptionOf(userId);
    await inStripe('apply the discount', () => stripeService.applyDiscount(live.id, p, m));
    await adminAccountsService.audit(actor, 'discount', ref, { percent: p, months: m });
  },

  async removeDiscount(actor: string, userId: string) {
    const { ref } = await target(userId);
    const live = await liveSubscriptionOf(userId);
    await inStripe('remove the discount', () => stripeService.removeDiscount(live.id));
    await adminAccountsService.audit(actor, 'discount_removed', ref);
  },

  async refund(actor: string, userId: string, paymentRef: string, amountUsd?: number | null) {
    const { ref } = await target(userId);
    const { data: payment } = await supabaseAdmin.from('billing_payments').select('stripe_ref, amount_usd, kind, user_id').eq('stripe_ref', String(paymentRef || '')).maybeSingle();
    if (!payment || payment.user_id !== userId || payment.kind === 'refund') throw new AppError('That payment is not one of this account’s.', 404);
    const amount = amountUsd == null || (amountUsd as any) === '' ? null : Math.round(Number(amountUsd) * 100) / 100;
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0 || amount > Number(payment.amount_usd))) {
      throw new AppError(`Refund between $0.01 and $${Number(payment.amount_usd).toFixed(2)}.`, 400);
    }
    const result = await inStripe('refund the payment', () => stripeService.refundPayment(payment.stripe_ref, amount ?? undefined));
    await adminAccountsService.audit(actor, 'refund', ref, { payment: payment.stripe_ref, amount_usd: result.refunded_usd });
    return result;
  },

  /* ─── The account ──────────────────────────────────────────────────── */

  /** A one-time sign-in link (or a set-a-new-password link) for the owner to pass on. */
  async signInLink(actor: string, userId: string, kind: 'magiclink' | 'recovery') {
    const { user, ref } = await target(userId);
    if (!user.email) throw new AppError('This account has no email address.', 400);
    const redirectTo = kind === 'recovery' ? `${env.CLIENT_URL}/reset-password` : `${env.CLIENT_URL}/dashboard`;
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: kind, email: user.email, options: { redirectTo } } as any);
    const link = (data as any)?.properties?.action_link;
    if (error || !link) throw new AppError(error?.message || 'Supabase did not return a link.', 502);
    await adminAccountsService.audit(actor, kind === 'recovery' ? 'reset_link' : 'sign_in_link', ref);
    return { link };
  },

  /** Email them Supabase's own "reset your password" message. */
  async sendPasswordReset(actor: string, userId: string) {
    const { user, ref } = await target(userId);
    if (!user.email) throw new AppError('This account has no email address.', 400);
    const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error } = await anon.auth.resetPasswordForEmail(user.email, { redirectTo: `${env.CLIENT_URL}/reset-password` });
    if (error) throw new AppError(`The email could not be sent: ${error.message}`, 502);
    await adminAccountsService.audit(actor, 'reset_email', ref);
  },

  async changeEmail(actor: string, userId: string, email: string) {
    const next = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(next)) throw new AppError('Enter a valid email address.', 400);
    const { user, ref } = await target(userId);
    if (isOwnerEmail(user.email)) throw new AppError('The owner accounts’ email addresses are set on the server.', 400);
    if ((user.email || '').toLowerCase() === next) throw new AppError('That is already their email.', 400);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { email: next, email_confirm: true });
    if (error) throw new AppError(error.message, /already|registered|exists/i.test(error.message) ? 409 : 500);
    // Keep Stripe's receipts going to the same place.
    const sub = await getSubscriptionRow(userId);
    if (sub?.stripe_customer_id && stripeService.isConfigured()) {
      await stripeService.updateCustomerEmail(sub.stripe_customer_id, next).catch((err) =>
        console.warn(`[Admin] Stripe customer email not updated for ${userId}: ${(err as Error).message}`));
    }
    await adminAccountsService.audit(actor, 'email', ref, { from: user.email, to: next });
  },

  async verifyEmail(actor: string, userId: string) {
    const { user, ref } = await target(userId);
    if (user.email_confirmed_at) return;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { email_confirm: true });
    if (error) throw new AppError(error.message, 500);
    await adminAccountsService.audit(actor, 'verify_email', ref);
  },

  /** End every session on every device; tokens already issued are refused too. */
  async signOutEverywhere(actor: string, userId: string) {
    const { user, ref } = await target(userId);
    if (isOwnerEmail(user.email)) throw new AppError('Sign the owner accounts out from their own settings.', 400);
    const { error } = await supabaseAdmin.rpc('admin_sign_out_user', { p_user_id: userId });
    if (error) {
      if (/admin_sign_out_user|function|schema cache/i.test(error.message)) throw new AppError('This needs database migration 102 to be run first.', 503);
      throw new AppError(error.message, 500);
    }
    await writeControls(userId, { sessions_revoked_at: new Date().toISOString() });
    accountControls.forget(userId);
    await adminAccountsService.audit(actor, 'sign_out', ref);
  },

  /** Pause every running or scheduled campaign. They can start them again themselves. */
  async pauseCampaigns(actor: string, userId: string) {
    const { ref } = await target(userId);
    const now = new Date().toISOString();
    const attempt = (patch: Record<string, any>) => supabaseAdmin.from('campaigns').update(patch)
      .eq('user_id', userId).in('status', ['running', 'scheduled']).select('id');
    let { data, error } = await attempt({ status: 'paused', paused_reason: 'Paused by Sincerely', paused_at: now });
    if (error && /paused_reason|paused_at/.test(error.message)) ({ data, error } = await attempt({ status: 'paused' }));
    if (error) throw new AppError(error.message, 500);
    const paused = (data || []).length;
    await adminAccountsService.audit(actor, 'pause_campaigns', ref, { paused });
    return { paused };
  },

  /** Hold everything this account sends until lifted, whatever its campaigns say. */
  async setSendingHold(actor: string, userId: string, hold: boolean) {
    const { ref } = await target(userId);
    try {
      await writeControls(userId, { sending_paused_at: hold ? new Date().toISOString() : null });
    } catch (err) {
      if (err instanceof AppError && /sending_paused_at/.test(err.message)) throw new AppError('This needs database migration 102 to be run first.', 503);
      throw err;
    }
    accountControls.forget(userId);
    await adminAccountsService.audit(actor, hold ? 'hold_sending' : 'release_sending', ref);
  },

  async viewAs(actor: string, userId: string) {
    const { user, ref } = await target(userId);
    if (!user.email) throw new AppError('This account has no email address.', 400);
    const minted = viewAs.mint(userId, user.email, actor);
    await adminAccountsService.audit(actor, 'view_as', ref);
    return { ...minted, email: user.email };
  },

  /** Delete the account and everything in it. Stripe is cancelled first, as when they delete it themselves. */
  async deleteAccount(actor: string, userId: string, confirmEmail: string) {
    const { user, ref } = await target(userId);
    if (isOwnerEmail(user.email)) throw new AppError('The owner accounts cannot be deleted from here.', 400);
    if (String(confirmEmail || '').trim().toLowerCase() !== (user.email || '').toLowerCase()) {
      throw new AppError('Type their email address exactly to confirm.', 400);
    }
    // Logged first: once the account is gone there is no email to put against it.
    await adminAccountsService.audit(actor, 'delete_account', ref);
    await settingsService.deleteAccount(userId);
    await supabaseAdmin.from('account_controls').delete().eq('user_id', userId).then(() => undefined, () => undefined);
    accountControls.forget(userId);
  },
};


import Stripe from 'stripe';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { STRIPE_PRICES, PRICE_TO_PLAN, TRIAL_DAYS, type BillingInterval } from '../config/billing.config.js';
import type { PlanId } from '@lemlist/shared';

let stripe: Stripe | null = null;
if (env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(env.STRIPE_SECRET_KEY);
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.warn(
      '[Stripe] STRIPE_WEBHOOK_SECRET is not set — subscription webhooks WILL fail, ' +
        'so paying customers would stay on the Free plan. Set it before charging customers.',
    );
  }
} else {
  console.log('STRIPE_SECRET_KEY not set — billing/checkout disabled');
}

function requireStripe(): Stripe {
  if (!stripe) throw new AppError('Billing is not configured.', 503);
  return stripe;
}

/** Find or create the Stripe customer for a user and persist its id. */
async function getOrCreateCustomer(userId: string, email: string | undefined): Promise<string> {
  const s = requireStripe();
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (sub?.stripe_customer_id) return sub.stripe_customer_id;

  const customer = await s.customers.create({
    email: email || undefined,
    metadata: { user_id: userId },
  });

  // Persist the customer id. A brand-new placeholder row MUST start on Free —
  // never the feature-rich internal "trial" plan the table default used to
  // grant (an abandoned checkout would otherwise hand out full features free,
  // forever). If a row already exists, touch only the customer id so we never
  // clobber a live plan/status a webhook may have written.
  if (sub) {
    await supabaseAdmin
      .from('subscriptions')
      .update({ stripe_customer_id: customer.id })
      .eq('user_id', userId);
  } else {
    const { error: insertErr } = await supabaseAdmin
      .from('subscriptions')
      .insert({ user_id: userId, stripe_customer_id: customer.id, plan: 'free', status: 'free' });
    if (insertErr) {
      // Lost a race to a concurrent getOrCreateCustomer call for the same
      // user (e.g. a double-click on "Upgrade") — a row now exists. Don't
      // insert a duplicate; just make sure a customer id is persisted,
      // preferring whichever one won the race.
      if (insertErr.code === '23505') {
        const { data: existing } = await supabaseAdmin
          .from('subscriptions')
          .select('stripe_customer_id')
          .eq('user_id', userId)
          .maybeSingle();
        if (existing?.stripe_customer_id) return existing.stripe_customer_id;
        await supabaseAdmin
          .from('subscriptions')
          .update({ stripe_customer_id: customer.id })
          .eq('user_id', userId);
      } else {
        throw new AppError(insertErr.message, 500);
      }
    }
  }

  return customer.id;
}

export const stripeService = {
  isConfigured(): boolean {
    return !!stripe;
  },

  async createCheckoutSession(
    userId: string,
    email: string | undefined,
    plan: 'starter' | 'growth',
    interval: BillingInterval,
  ): Promise<string> {
    const s = requireStripe();
    const priceId = STRIPE_PRICES[plan]?.[interval];
    if (!priceId) throw new AppError('Unknown plan or billing interval.', 400);

    const customerId = await getOrCreateCustomer(userId, email);

    // One live subscription per customer. If one already exists, change its
    // price in place (prorated) instead of creating a second subscription
    // through Checkout — that would double-charge the customer.
    const existing = await s.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    const live = existing.data.find((sub) => sub.status === 'active' || sub.status === 'trialing');
    if (live) {
      const item = live.items.data[0];
      if (!item) throw new AppError('Your subscription looks unusual — please contact support.', 500);
      if (item.price?.id === priceId) throw new AppError("You're already on this plan.", 400);
      const updated = await s.subscriptions.update(live.id, {
        items: [{ id: item.id, price: priceId }],
        proration_behavior: 'create_prorations',
        metadata: { user_id: userId },
      });
      await this.syncSubscription(updated, Math.floor(Date.now() / 1000));
      return `${env.CLIENT_URL}/billing?status=changed`;
    }
    if (existing.data.some((sub) => sub.status === 'past_due' || sub.status === 'unpaid')) {
      throw new AppError(
        'Your subscription has an unpaid invoice. Open "Manage billing" to update your payment method first.',
        400,
      );
    }

    // The free trial is for first-time subscribers only — a canceled customer
    // re-subscribing must not get a fresh trial every time.
    const hadSubscription = existing.data.length > 0;

    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // 10-day trial, but card is required up front and the sub cancels if no
      // payment method is on file when the trial ends.
      subscription_data: {
        ...(hadSubscription
          ? {}
          : {
              trial_period_days: TRIAL_DAYS,
              trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            }),
        metadata: { user_id: userId },
      },
      payment_method_collection: 'always',
      client_reference_id: userId,
      allow_promotion_codes: true,
      success_url: `${env.CLIENT_URL}/billing?status=success`,
      cancel_url: `${env.CLIENT_URL}/billing?status=cancel`,
    });

    if (!session.url) throw new AppError('Failed to create checkout session.', 502);
    return session.url;
  },

  async createPortalSession(userId: string): Promise<string> {
    const s = requireStripe();
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      throw new AppError('No billing account yet — start a subscription first.', 400);
    }

    const session = await s.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${env.CLIENT_URL}/billing`,
    });
    return session.url;
  },

  /** Verify a webhook payload and persist the resulting subscription state. */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const s = requireStripe();
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new AppError('Webhook secret not configured.', 500);
    }

    let event: Stripe.Event;
    try {
      event = s.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      throw new AppError(`Webhook signature verification failed: ${err.message}`, 400);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const sub = await s.subscriptions.retrieve(session.subscription as string);
          await this.syncSubscription(sub, event.created);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await this.syncSubscription(event.data.object as Stripe.Subscription, event.created);
        break;
      }
      default:
        // Ignore other event types.
        break;
    }
  },

  /** Upsert our subscriptions row from a Stripe Subscription object. */
  async syncSubscription(sub: Stripe.Subscription, eventCreated: number): Promise<void> {
    const userId =
      (sub.metadata?.user_id as string | undefined) ||
      (await this.userIdForCustomer(sub.customer as string));
    if (!userId) {
      console.error(`[Stripe] No user_id for subscription ${sub.id} (customer ${String(sub.customer)})`);
      return;
    }

    // Ordering guard: ignore events older than the last one we applied, so a
    // replayed or out-of-order webhook can't overwrite newer subscription state.
    const eventAtIso = new Date(eventCreated * 1000).toISOString();
    const { data: existing } = await supabaseAdmin
      .from('subscriptions')
      .select('last_event_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing?.last_event_at && new Date(existing.last_event_at).getTime() > new Date(eventAtIso).getTime()) {
      console.log(`[Stripe] Skipping stale event for ${userId} (event ${eventAtIso} < stored ${existing.last_event_at})`);
      return;
    }

    const item = sub.items.data[0];
    const priceId = item?.price?.id;
    // Unknown price → Free, never silently grant a paid tier.
    const plan: PlanId = (priceId && PRICE_TO_PLAN[priceId]) || 'free';
    // current_period_end moved from the Subscription to the line item in recent
    // Stripe API versions — read whichever is present.
    const periodEnd =
      ((sub as any).current_period_end as number | undefined) ??
      ((item as any)?.current_period_end as number | undefined);

    const { error } = await supabaseAdmin.from('subscriptions').upsert(
      {
        user_id: userId,
        // Store the real plan; planFromSubscription() downgrades non-active
        // statuses (canceled/past_due) to Free at read time.
        plan,
        status: sub.status,
        trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        stripe_customer_id: sub.customer as string,
        stripe_subscription_id: sub.id,
        last_event_at: eventAtIso,
      },
      { onConflict: 'user_id' },
    );
    if (error) {
      // Throw so the webhook returns non-2xx and Stripe retries — otherwise a
      // transient DB error would permanently drop the subscription sync.
      throw new AppError(`Failed to sync subscription for ${userId}: ${error.message}`, 500);
    }
  },

  /**
   * Cancel every live Stripe subscription for a user. Used on account deletion:
   * once the subscriptions row is wiped the customer→user mapping is gone, so a
   * still-active Stripe subscription would keep charging a user who no longer
   * has an account, with no way for webhooks to ever correct it. Callers must
   * NOT delete billing rows if this throws.
   */
  async cancelAllSubscriptionsForUser(userId: string): Promise<void> {
    if (!stripe) return; // Billing never configured — nothing can be live.
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!sub) return;

    if (sub.stripe_customer_id) {
      // Cancel by customer rather than the single stored subscription id so
      // any stray duplicate subscriptions are cleaned up too.
      const list = await stripe.subscriptions.list({
        customer: sub.stripe_customer_id,
        status: 'all',
        limit: 100,
      });
      for (const s of list.data) {
        if (s.status !== 'canceled' && s.status !== 'incomplete_expired') {
          await stripe.subscriptions.cancel(s.id);
        }
      }
    } else if (sub.stripe_subscription_id) {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
    }
  },

  /**
   * Pull current subscription state straight from Stripe and persist it — a
   * safety net for missed or misconfigured webhooks (e.g. right after checkout).
   */
  async refreshFromStripe(userId: string): Promise<void> {
    if (!stripe) return;
    const { data: row } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!row?.stripe_customer_id) return;

    const subs = await stripe.subscriptions.list({
      customer: row.stripe_customer_id,
      status: 'all',
      limit: 100,
    });
    if (subs.data.length === 0) return;
    // Prefer a live subscription; otherwise the most recently created one.
    const best =
      subs.data.find((s) => s.status === 'active' || s.status === 'trialing') ||
      subs.data.reduce((a, b) => (a.created > b.created ? a : b));
    await this.syncSubscription(best, Math.floor(Date.now() / 1000));
  },

  async userIdForCustomer(customerId: string): Promise<string | null> {
    const { data } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    return data?.user_id ?? null;
  },
};

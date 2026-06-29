import Stripe from 'stripe';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { STRIPE_PRICES, PRICE_TO_PLAN, TRIAL_DAYS, type BillingInterval } from '../config/billing.config.js';
import type { PlanId } from '@lemlist/shared';

let stripe: Stripe | null = null;
if (env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(env.STRIPE_SECRET_KEY);
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

  await supabaseAdmin
    .from('subscriptions')
    .upsert({ user_id: userId, stripe_customer_id: customer.id }, { onConflict: 'user_id' });

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

    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // 10-day trial, but card is required up front and the sub cancels if no
      // payment method is on file when the trial ends.
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
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
          await this.syncSubscription(sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await this.syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        // Ignore other event types.
        break;
    }
  },

  /** Upsert our subscriptions row from a Stripe Subscription object. */
  async syncSubscription(sub: Stripe.Subscription): Promise<void> {
    const userId =
      (sub.metadata?.user_id as string | undefined) ||
      (await this.userIdForCustomer(sub.customer as string));
    if (!userId) {
      console.error(`[Stripe] No user_id for subscription ${sub.id} (customer ${String(sub.customer)})`);
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
      },
      { onConflict: 'user_id' },
    );
    if (error) {
      // Throw so the webhook returns non-2xx and Stripe retries — otherwise a
      // transient DB error would permanently drop the subscription sync.
      throw new AppError(`Failed to sync subscription for ${userId}: ${error.message}`, 500);
    }
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

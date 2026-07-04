import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorMiddleware } from './middleware/error.middleware.js';
import { routes } from './routes/index.js';
import { assetController } from './controllers/asset.controller.js';
import { webhookInboundRoutes } from './routes/webhook-inbound.routes.js';
import { trackingRoutes } from './routes/tracking.routes.js';
import { billingController } from './controllers/billing.controller.js';

const app = express();

// Middleware
app.use(helmet());

// CORS — reflect any origin (all routes require JWT auth so this is safe)
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('dev'));

// Stripe webhook — must read the RAW body for signature verification, so it is
// mounted BEFORE express.json() and outside the authenticated routes.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingController.webhook);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Public asset render endpoint (no auth - used in email images)
app.get('/api/assets/render/:templateId', assetController.render);

// Public inbound webhook endpoint (no auth - external systems call this)
app.use('/api/webhooks/inbound', webhookInboundRoutes);

// Public tracking endpoints (no auth - used in email opens/clicks)
app.use('/api/track', trackingRoutes);

// Routes (authenticated)
app.use('/api/v1', routes);

// Friendly root response so hitting the bare API URL returns 200 (a status
// ping) instead of a 404. The app itself lives on the separate frontend.
app.get('/', (_req, res) => {
  res.json({ service: 'sincerely-api', status: 'ok' });
});

// Health check with diagnostics
app.get('/health', async (_req, res) => {
  const diagnostics: Record<string, any> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: 'v7-smtp-relay',
  };

  // Check SMTP relay config
  const { env: envConfig } = await import('./config/env.js');
  diagnostics.smtp_relay = envConfig.SMTP_RELAY_URL
    ? { configured: true, url: envConfig.SMTP_RELAY_URL }
    : { configured: false, note: 'SMTP_RELAY_URL not set — using direct SMTP (blocked on Render free tier)' };

  // Ping the relay if configured
  if (envConfig.SMTP_RELAY_URL) {
    try {
      const healthUrl = envConfig.SMTP_RELAY_URL.replace('/api/send-email', '/api/health');
      const relayResp = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      const relayData = await relayResp.json() as any;
      diagnostics.smtp_relay.reachable = true;
      diagnostics.smtp_relay.relay_status = relayData;
    } catch (err: any) {
      diagnostics.smtp_relay.reachable = false;
      diagnostics.smtp_relay.relay_error = err.message;
    }
  }

  // Check Redis
  try {
    const { redisConnection } = await import('./config/redis.js');
    if (!redisConnection) {
      diagnostics.redis = 'not configured (REDIS_URL not set)';
    } else if (redisConnection.status === 'ready') {
      diagnostics.redis = 'connected';
    } else {
      diagnostics.redis = `status: ${redisConnection.status}`;
    }
  } catch (err: any) {
    diagnostics.redis = `error: ${err.message}`;
  }

  // Check Supabase connectivity
  try {
    const { supabaseAdmin } = await import('./config/supabase.js');
    const { count, error } = await supabaseAdmin
      .from('campaigns')
      .select('*', { count: 'exact', head: true });
    diagnostics.supabase = error ? `error: ${error.message}` : `ok (${count} campaigns)`;
  } catch (err: any) {
    diagnostics.supabase = `error: ${err.message}`;
  }

  // Aggregate operational counts only — this endpoint is public and unauthenticated,
  // so it must never return per-tenant data (account emails, campaign names, error text).
  try {
    const { supabaseAdmin } = await import('./config/supabase.js');
    const { count: activeSmtpCount } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);
    diagnostics.active_smtp_accounts = activeSmtpCount ?? 0;

    const { count: runningCount } = await supabaseAdmin
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'running');
    diagnostics.running_campaigns = runningCount ?? 0;

    const { count: dueCount } = await supabaseAdmin
      .from('campaign_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .not('next_send_at', 'is', null)
      .lte('next_send_at', new Date().toISOString());
    diagnostics.due_contacts = dueCount ?? 0;
  } catch (err: any) {
    diagnostics.operational_counts = `error: ${err.message}`;
  }

  res.json(diagnostics);
});


// Error handler (must be last)
app.use(errorMiddleware);

export { app };

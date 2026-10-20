import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorMiddleware } from './middleware/error.middleware.js';
import { routes } from './routes/index.js';
import { assetController } from './controllers/asset.controller.js';
import { webhookInboundRoutes } from './routes/webhook-inbound.routes.js';
import { trackingRoutes } from './routes/tracking.routes.js';
import { publicBookingRoutes } from './routes/booking.routes.js';
import { publicResultsRoutes } from './routes/results.routes.js';
import { integrationsOAuthRoutes } from './routes/integrations-oauth.routes.js';
import { calendarOAuthRoutes } from './routes/calendar-oauth.routes.js';
import { billingController } from './controllers/billing.controller.js';

const app = express();

// Middleware
app.use(helmet());

// CORS — reflect any origin (all routes require JWT auth so this is safe).
//
// exposedHeaders matters: a browser client cannot read a non-simple response
// header unless it is listed here, so the rate-limit budget the API-key
// middleware publishes would be invisible to exactly the clients that need to
// pace themselves against it — and they would be back to discovering the
// limit by hitting it.
app.use(cors({
  origin: true,
  credentials: true,
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
}));
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

// Public OAuth callbacks for integrations (no auth — identity comes from
// the HMAC-signed state parameter; the browser arrives via provider redirect)
app.use('/api/oauth/integrations', integrationsOAuthRoutes);

// Public Google Calendar callback (no auth - identity is in the signed state)
app.use('/api/oauth/calendar', calendarOAuthRoutes);

// Public booking pages (no auth - a stranger with a link is the point).
// Rate limited in the router; every response is a hand-written whitelist.
app.use('/api/book', publicBookingRoutes);
// Shared results pages: read-only, the token is the key (services/results-share).
app.use('/api/report', publicResultsRoutes);

// Routes (authenticated)
app.use('/api/v1', routes);

// Friendly root response so hitting the bare API URL returns 200 (a status
// ping) instead of a 404. The app itself lives on the separate frontend.
app.get('/', (_req, res) => {
  res.json({ service: 'sincerely-api', status: 'ok' });
});

/*
 * Liveness: is this process up and serving? Cheap and always 200 while it
 * is - it is what Render/Railway's healthCheckPath polls, so it must not
 * depend on the database (a Supabase blip would otherwise get a healthy
 * server restarted in a loop). It used to run four count queries, one over
 * every campaign_contacts row, and hand cross-tenant totals to anyone who
 * asked; those now live behind the admin gate at /api/v1/admin/health.
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: 'v7-smtp-relay',
    uptime_s: Math.round(process.uptime()),
  });
});

/*
 * Readiness: can this server actually do its job? 503 when the database does
 * not answer, or when the sending job has not finished a run in three of its
 * intervals (the heartbeat in utils/heartbeat). Not used as the platform
 * health check, deliberately - restarting on a stalled job is a decision,
 * not a reflex - but it is what an uptime monitor should watch.
 */
app.get('/ready', async (_req, res) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  try {
    const { supabaseAdmin } = await import('./config/supabase.js');
    const { error } = await supabaseAdmin.from('job_heartbeats').select('job', { head: true }).limit(1);
    // A database without migration 078 still answers; only a failure to answer is not ready.
    checks.database = error && !/job_heartbeats/.test(error.message) ? { ok: false, detail: 'query failed' } : { ok: true };
  } catch {
    checks.database = { ok: false, detail: 'unreachable' };
  }
  try {
    const { readBeats } = await import('./utils/heartbeat.js');
    const { JOB_BY_ID } = await import('@lemlist/shared');
    const { beats } = await readBeats();
    const b = beats.get('sending');
    const every = JOB_BY_ID.sending.everyMs;
    const last = b?.last_finished_at ? Date.parse(b.last_finished_at) : 0;
    // Grace after boot: the first run has not had a chance to finish yet.
    const booting = process.uptime() * 1000 < 3 * every;
    checks.sending = booting || (last && Date.now() - last <= 3 * every)
      ? { ok: true }
      : { ok: false, detail: last ? 'last run finished too long ago' : 'has not run' };
  } catch {
    checks.sending = { ok: false, detail: 'heartbeat unreadable' };
  }
  const ready = Object.values(checks).every((c) => c.ok);
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
});


// Error handler (must be last)
app.use(errorMiddleware);

export { app };

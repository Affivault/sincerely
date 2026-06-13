import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorMiddleware } from './middleware/error.middleware.js';
import { routes } from './routes/index.js';
import { assetController } from './controllers/asset.controller.js';
import { webhookInboundRoutes } from './routes/webhook-inbound.routes.js';
import { trackingRoutes } from './routes/tracking.routes.js';

const app = express();

// Middleware
app.use(helmet());

// CORS — reflect any origin (all routes require JWT auth so this is safe)
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('dev'));
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

  // Check SMTP accounts
  try {
    const { supabaseAdmin } = await import('./config/supabase.js');
    const { data: accounts } = await supabaseAdmin
      .from('smtp_accounts')
      .select('id, label, is_active, is_verified, email_address');
    diagnostics.smtp_accounts = (accounts || []).map((a: any) => ({
      label: a.label,
      email: a.email_address,
      active: a.is_active,
      verified: a.is_verified,
    }));
  } catch (err: any) {
    diagnostics.smtp_accounts = `error: ${err.message}`;
  }

  // Check running campaigns
  try {
    const { supabaseAdmin } = await import('./config/supabase.js');
    const { data: running } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, status, started_at')
      .eq('status', 'running');
    diagnostics.running_campaigns = running || [];

    // Check due contacts
    const { data: dueContacts, error: dueErr } = await supabaseAdmin
      .from('campaign_contacts')
      .select('id, campaign_id, status, current_step_order, next_send_at, error_message')
      .eq('status', 'active')
      .not('next_send_at', 'is', null)
      .lte('next_send_at', new Date().toISOString())
      .limit(10);
    diagnostics.due_contacts = dueErr ? `error: ${dueErr.message}` : (dueContacts || []);
  } catch (err: any) {
    diagnostics.running_campaigns = `error: ${err.message}`;
  }

  res.json(diagnostics);
});

// Diagnostic: attempt to send a real test email via SMTP
// Requires X-Debug-Secret header matching TRACKING_SECRET to prevent unauthorized use.
// Usage: POST /debug/send-email { "to": "you@gmail.com" }
app.post('/debug/send-email', async (req, res) => {
  const { env: envConfig } = await import('./config/env.js');
  const rawSecret = req.headers['x-debug-secret'];
  const secret = Array.isArray(rawSecret) ? rawSecret[0] : rawSecret;
  if (!secret || secret !== envConfig.TRACKING_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const steps: string[] = [];
  try {
    const { to } = req.body || {};
    if (!to) {
      return res.status(400).json({ error: 'POST body must include "to" email address' });
    }
    steps.push(`1. Target: ${to}`);

    const { supabaseAdmin } = await import('./config/supabase.js');
    const { decrypt } = await import('./utils/encryption.js');
    const { sendViaSmtp } = await import('./services/email-sender.service.js');

    // Find any SMTP account
    const { data: accounts, error: accErr } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('is_active', true)
      .limit(5);

    if (accErr) {
      steps.push(`2. FAIL: DB error fetching SMTP accounts: ${accErr.message}`);
      return res.json({ success: false, steps });
    }
    if (!accounts || accounts.length === 0) {
      steps.push('2. FAIL: No active SMTP accounts found in database');
      return res.json({ success: false, steps });
    }
    steps.push(`2. Found ${accounts.length} active SMTP account(s): ${accounts.map((a: any) => `${a.label} (${a.email_address}, verified=${a.is_verified})`).join(', ')}`);

    const account = accounts[0];
    steps.push(`3. Using: ${account.label} — ${account.smtp_host}:${account.smtp_port} (secure=${account.smtp_secure}) user=${account.smtp_user}`);

    // Decrypt password
    let password: string;
    try {
      password = decrypt(account.smtp_pass_encrypted);
      steps.push('4. Password decrypted OK');
    } catch (err: any) {
      steps.push(`4. FAIL: Password decrypt error: ${err.message}`);
      return res.json({ success: false, steps });
    }

    // Check relay config
    if (envConfig.SMTP_RELAY_URL && envConfig.SMTP_RELAY_SECRET) {
      steps.push(`5. SMTP relay configured: ${envConfig.SMTP_RELAY_URL}`);
    } else {
      steps.push('5. WARNING: SMTP relay NOT configured (SMTP_RELAY_URL/SMTP_RELAY_SECRET missing) — using direct SMTP which may be blocked on Render');
    }

    // Send test email via relay or direct SMTP
    try {
      const result = await sendViaSmtp({
        smtpHost: account.smtp_host,
        smtpPort: account.smtp_port,
        smtpSecure: account.smtp_secure,
        smtpUser: account.smtp_user,
        smtpPass: password,
        from: account.email_address,
        to,
        subject: `[SkySend Debug] Test email at ${new Date().toISOString()}`,
        html: '<h2>SkySend Debug Test</h2><p>If you see this email, your SMTP configuration is working correctly.</p>',
        text: 'SkySend Debug Test - If you see this email, your SMTP configuration is working correctly.',
      });
      steps.push(`5. EMAIL SENT OK — messageId: ${result.messageId}, accepted: ${JSON.stringify(result.accepted)}, rejected: ${JSON.stringify(result.rejected)}`);
    } catch (err: any) {
      steps.push(`5. FAIL: Send error: ${err.message}`);
      return res.json({ success: false, steps });
    }

    // Auto-verify the account
    await supabaseAdmin
      .from('smtp_accounts')
      .update({ is_verified: true })
      .eq('id', account.id);
    steps.push('7. SMTP account marked as verified');

    res.json({ success: true, steps });
  } catch (err: any) {
    steps.push(`UNEXPECTED ERROR: ${err.message}`);
    res.json({ success: false, steps });
  }
});

// Error handler (must be last)
app.use(errorMiddleware);

export { app };

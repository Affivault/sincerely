import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import type {
  WebhookEndpoint,
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
  WebhookDelivery,
  WebhookPayload,
} from '@lemlist/shared';

/**
 * Webhook Event Bus Service
 * Fires outbound webhooks on every system state change.
 */

/** True for loopback, private, link-local (incl. the cloud metadata address), and other non-routable ranges. */
function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true; // link-local / unique-local
    if (lower.startsWith('::ffff:')) return isPrivateOrReservedIp(lower.slice(7)); // IPv4-mapped
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata (169.254.169.254)
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast/reserved
  return false;
}

/**
 * Reject webhook URLs that aren't safe for the server to fetch: non-HTTP(S)
 * schemes, and hosts that resolve to loopback/private/link-local addresses
 * (including the cloud metadata IP) — otherwise a user can turn the webhook
 * delivery pipeline into an SSRF proxy against internal infrastructure.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError('Invalid webhook URL', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('Webhook URL must use http or https', 400);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new AppError('Webhook URL may not target localhost', 400);
  }
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) throw new AppError('Webhook URL may not target a private or internal address', 400);
    return;
  }
  let addresses: string[];
  try {
    addresses = (await dns.promises.lookup(hostname, { all: true })).map((a) => a.address);
  } catch {
    throw new AppError('Webhook URL host could not be resolved', 400);
  }
  if (addresses.some(isPrivateOrReservedIp)) {
    throw new AppError('Webhook URL may not target a private or internal address', 400);
  }
}

// ============================================
// Endpoint CRUD
// ============================================

export async function listEndpoints(userId: string): Promise<WebhookEndpoint[]> {
  const { data } = await supabaseAdmin
    .from('webhook_endpoints')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  // Never ship the signing secret in a list response — it's only shown once,
  // right after creation or a deliberate regenerate, via their dedicated
  // endpoints. Listing endpoints should not leak it on every page load.
  return (data || []).map(({ secret, ...rest }: WebhookEndpoint) => ({ ...rest, secret: null }));
}

export async function getEndpoint(userId: string, id: string): Promise<WebhookEndpoint | null> {
  const { data } = await supabaseAdmin
    .from('webhook_endpoints')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  return data;
}

export async function createEndpoint(
  userId: string,
  input: CreateWebhookEndpointInput
): Promise<WebhookEndpoint> {
  await assertSafeWebhookUrl(input.url);
  const { data, error } = await supabaseAdmin
    .from('webhook_endpoints')
    .insert({
      user_id: userId,
      url: input.url,
      label: input.label || 'My Webhook',
      secret: input.secret || crypto.randomBytes(32).toString('hex'),
      events: input.events,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateEndpoint(
  userId: string,
  id: string,
  input: UpdateWebhookEndpointInput
): Promise<WebhookEndpoint> {
  // Never let an update clear the signing secret — a falsy/empty value here
  // (e.g. an empty-string PATCH) would silently downgrade the endpoint to
  // sending unsigned deliveries with no warning to the receiver.
  const { secret, ...rest } = input as UpdateWebhookEndpointInput & { secret?: string };
  const update: UpdateWebhookEndpointInput & { secret?: string } = { ...rest };
  if (secret) update.secret = secret;
  if (update.url) await assertSafeWebhookUrl(update.url);

  const { data, error } = await supabaseAdmin
    .from('webhook_endpoints')
    .update(update)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Rotate an endpoint's signing secret and return the new value once so the
 * caller can copy it into their receiver's verification config. Never
 * retrievable again after this — same reveal-once pattern as API keys.
 */
export async function regenerateSecret(userId: string, id: string): Promise<WebhookEndpoint> {
  const newSecret = crypto.randomBytes(32).toString('hex');
  const { data, error } = await supabaseAdmin
    .from('webhook_endpoints')
    .update({ secret: newSecret })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteEndpoint(userId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('webhook_endpoints')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

// ============================================
// Delivery Log
// ============================================

export async function getDeliveries(
  userId: string,
  endpointId?: string,
  limit = 50
): Promise<WebhookDelivery[]> {
  let query = supabaseAdmin
    .from('webhook_deliveries')
    .select('*, webhook_endpoints!inner(user_id)')
    .eq('webhook_endpoints.user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (endpointId) {
    query = query.eq('endpoint_id', endpointId);
  }

  const { data } = await query;
  return (data || []).map(({ webhook_endpoints, ...rest }: any) => rest);
}

// ============================================
// Fire Webhook Events
// ============================================

/**
 * Sign a webhook payload with HMAC-SHA256.
 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Fire a webhook event to all matching endpoints for a user.
 * This is the core event bus - called by other services when state changes occur.
 */
export async function fireEvent(
  userId: string,
  eventType: string,
  data: Record<string, any>
): Promise<void> {
  // Find active endpoints subscribed to this event
  const { data: endpoints, error: endpointsError } = await supabaseAdmin
    .from('webhook_endpoints')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .contains('events', [eventType]);

  if (endpointsError) {
    console.error('[Webhook] Failed to query endpoints:', endpointsError.message);
    return;
  }
  if (!endpoints || endpoints.length === 0) return;

  const payload: WebhookPayload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    data,
  };

  const payloadStr = JSON.stringify(payload);

  // Fire to all matching endpoints (non-blocking)
  for (const endpoint of endpoints) {
    deliverWebhook(endpoint, eventType, payloadStr).catch(() => {
      // Silently fail - delivery is logged in the database
    });
  }
}

/**
 * Deliver a webhook to a single endpoint with retry.
 */
async function deliverWebhook(
  endpoint: WebhookEndpoint,
  eventType: string,
  payloadStr: string
): Promise<void> {
  const signature = endpoint.secret ? signPayload(payloadStr, endpoint.secret) : undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Sincerely-Webhook/1.0',
    'X-Sincerely-Event': eventType,
  };
  if (signature) {
    headers['X-Sincerely-Signature'] = signature;
  }

  let statusCode: number | null = null;
  let responseBody = '';
  let success = false;
  let actualAttempts = 0;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    actualAttempts = attempt;
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers,
        body: payloadStr,
        signal: AbortSignal.timeout(15000),
      });

      statusCode = response.status;
      responseBody = await response.text().catch(() => '');
      success = response.ok;

      if (success) break;
      // 4xx = permanent client error (bad URL, auth, payload) — no point retrying
      if (statusCode >= 400 && statusCode < 500) break;
    } catch (err: any) {
      console.error(`[Webhook] Delivery attempt ${attempt} to ${endpoint.url} failed:`, err.message);
      statusCode = 0;
      responseBody = err.message || 'Network error';
      success = false;
    }

    // Exponential backoff before retry
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }

  // Log delivery
  const { error: logErr } = await supabaseAdmin
    .from('webhook_deliveries')
    .insert({
      endpoint_id: endpoint.id,
      event_type: eventType,
      payload: JSON.parse(payloadStr),
      status_code: statusCode,
      response_body: responseBody.substring(0, 1000),
      success,
      attempts: actualAttempts,
      last_attempt_at: new Date().toISOString(),
    });
  if (logErr) {
    console.error('[Webhook] Failed to log delivery for endpoint', endpoint.id, ':', logErr.message);
  }
}

/**
 * Test a webhook endpoint by sending a test event.
 */
export async function testEndpoint(userId: string, endpointId: string): Promise<{ success: boolean; status_code: number | null }> {
  const endpoint = await getEndpoint(userId, endpointId);
  if (!endpoint) throw new Error('Endpoint not found');

  const payload: WebhookPayload = {
    event: 'test.ping',
    timestamp: new Date().toISOString(),
    data: { message: 'This is a test webhook from Sincerely' },
  };

  const payloadStr = JSON.stringify(payload);
  const signature = endpoint.secret ? signPayload(payloadStr, endpoint.secret) : undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Sincerely-Webhook/1.0',
    'X-Sincerely-Event': 'test.ping',
  };
  if (signature) {
    headers['X-Sincerely-Signature'] = signature;
  }

  try {
    await assertSafeWebhookUrl(endpoint.url);
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body: payloadStr,
      signal: AbortSignal.timeout(10000),
    });
    return { success: response.ok, status_code: response.status };
  } catch {
    return { success: false, status_code: null };
  }
}

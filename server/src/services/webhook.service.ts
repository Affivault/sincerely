import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { dispatchEvent as dispatchToIntegrations } from './integrations.service.js';
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';
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
 *
 * Returns the validated IP address(es) so callers that go on to make the
 * actual request can connect directly to them instead of re-resolving the
 * hostname — re-resolving would reopen a DNS-rebinding TOCTOU gap where the
 * name is repointed at an internal address between this check and the fetch.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<string[]> {
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
    return [hostname];
  }
  let addresses: string[];
  try {
    addresses = (await dns.promises.lookup(hostname, { all: true })).map((a) => a.address);
  } catch {
    throw new AppError('Webhook URL host could not be resolved', 400);
  }
  if (addresses.length === 0) {
    throw new AppError('Webhook URL host could not be resolved', 400);
  }
  if (addresses.some(isPrivateOrReservedIp)) {
    throw new AppError('Webhook URL may not target a private or internal address', 400);
  }
  return addresses;
}

/**
 * Custom `lookup` for http(s).request that pins the connection to addresses
 * already validated by assertSafeWebhookUrl, instead of letting Node resolve
 * the hostname again at connect time (which is what let DNS rebinding slip
 * a private IP in between the safety check and the real request).
 */
function pinnedLookup(addresses: string[]): (hostname: string, options: any, callback: any) => void {
  return (_hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    // Node's happy-eyeballs connection logic (autoSelectFamily, on by default
    // since Node 20) calls lookup with { all: true } and expects the full
    // { address, family }[] shape back, not a single address.
    if (options?.all) {
      callback(null, addresses.map((a) => ({ address: a, family: net.isIP(a) })));
      return;
    }
    const family = options?.family;
    const match = family === 4
      ? addresses.find((a) => net.isIP(a) === 4)
      : family === 6
        ? addresses.find((a) => net.isIP(a) === 6)
        : undefined;
    const address = match || addresses[0];
    callback(null, address, net.isIP(address));
  };
}

/**
 * POST a payload to a URL, pinned to pre-validated addresses (see
 * pinnedLookup) so the request can never land on a different host than the
 * one that was SSRF-checked. Does not follow redirects — a redirect to an
 * internal address would otherwise bypass the check entirely.
 *
 * Exported for integrations that accept arbitrary user URLs (n8n) so they
 * go through the exact same SSRF-hardened path as webhook deliveries.
 */
export function pinnedPost(
  rawUrl: string,
  addresses: string[],
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<{ statusCode: number; body: string }> {
  const parsed = new URL(rawUrl);
  const client = parsed.protocol === 'https:' ? https : http;
  const bodyBuf = Buffer.from(body, 'utf8');

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(bodyBuf.length) },
        lookup: pinnedLookup(addresses),
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
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
  // Same reveal-once rule as listEndpoints: viewing an endpoint's detail page
  // is not the creation/regenerate moment, so the secret stays redacted here too.
  if (!data) return data;
  const { secret, ...rest } = data as WebhookEndpoint;
  return { ...rest, secret: null } as WebhookEndpoint;
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
  // An update (e.g. toggling is_active, editing the label) is not the
  // reveal-once moment either — redact, same as getEndpoint/listEndpoints.
  const { secret: _secret, ...updatedRest } = data as WebhookEndpoint;
  return { ...updatedRest, secret: null } as WebhookEndpoint;
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
  // Fan out to third-party integrations (Slack, CRMs, Zapier, …) first —
  // they ride the same bus but must not depend on whether any raw webhook
  // endpoint happens to be subscribed (this function returns early below
  // when none are).
  dispatchToIntegrations(userId, eventType, data).catch((err) => {
    console.error('[Webhook] Integration dispatch error:', err?.message ?? String(err));
  });

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
  // Endpoint URLs are only host-validated at create/update/test time. Re-validate
  // on every delivery too, so a hostname that resolved to a public IP back then
  // can't be silently re-pointed at an internal/metadata address later (DNS
  // rebinding) and have every future event delivered there unchecked. The
  // resolved addresses are then pinned for the actual request below, so a
  // rebind between this check and the connection can't slip through either.
  let safeAddresses: string[];
  try {
    safeAddresses = await assertSafeWebhookUrl(endpoint.url);
  } catch (err: any) {
    await supabaseAdmin.from('webhook_deliveries').insert({
      endpoint_id: endpoint.id,
      event_type: eventType,
      payload: JSON.parse(payloadStr),
      status_code: null,
      response_body: `Blocked: ${err.message || 'unsafe destination'}`.substring(0, 1000),
      success: false,
      attempts: 0,
      last_attempt_at: new Date().toISOString(),
    });
    return;
  }

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
      const response = await pinnedPost(endpoint.url, safeAddresses, headers, payloadStr, 15000);

      statusCode = response.statusCode;
      responseBody = response.body;
      success = statusCode >= 200 && statusCode < 300;

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
  // Deliberately bypass getEndpoint()'s secret redaction: a test delivery must
  // be signed with the endpoint's real secret, the same as a live fireEvent
  // delivery, or a receiver validating HMAC signatures against "Send test"
  // will always see it fail even though production traffic is signed fine.
  const { data } = await supabaseAdmin
    .from('webhook_endpoints')
    .select('*')
    .eq('id', endpointId)
    .eq('user_id', userId)
    .single();
  const endpoint = data as WebhookEndpoint | null;
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
    const safeAddresses = await assertSafeWebhookUrl(endpoint.url);
    const response = await pinnedPost(endpoint.url, safeAddresses, headers, payloadStr, 10000);
    return { success: response.statusCode >= 200 && response.statusCode < 300, status_code: response.statusCode };
  } catch {
    return { success: false, status_code: null };
  }
}

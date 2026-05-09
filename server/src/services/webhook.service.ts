import { supabaseAdmin } from '../config/supabase.js';
import crypto from 'crypto';
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

// ============================================
// Endpoint CRUD
// ============================================

export async function listEndpoints(userId: string): Promise<WebhookEndpoint[]> {
  const { data } = await supabaseAdmin
    .from('webhook_endpoints')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
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
  const { data, error } = await supabaseAdmin
    .from('webhook_endpoints')
    .update(input)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteEndpoint(userId: string, id: string): Promise<void> {
  await supabaseAdmin
    .from('webhook_endpoints')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
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
  const { data: endpoints } = await supabaseAdmin
    .from('webhook_endpoints')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .contains('events', [eventType]);

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
    'User-Agent': 'SkySend-Webhook/1.0',
    'X-SkySend-Event': eventType,
  };
  if (signature) {
    headers['X-SkySend-Signature'] = signature;
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
    } catch (err: any) {
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
  await supabaseAdmin
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
    data: { message: 'This is a test webhook from SkySend' },
  };

  const payloadStr = JSON.stringify(payload);
  const signature = endpoint.secret ? signPayload(payloadStr, endpoint.secret) : undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'SkySend-Webhook/1.0',
    'X-SkySend-Event': 'test.ping',
  };
  if (signature) {
    headers['X-SkySend-Signature'] = signature;
  }

  try {
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

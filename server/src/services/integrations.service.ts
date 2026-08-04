import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  getIntegrationMeta,
  type IntegrationProviderId,
  type UserIntegration,
  type ConnectIntegrationInput,
  type UpdateIntegrationInput,
  type IntegrationActivity,
  type IntegrationTestResult,
} from '@lemlist/shared';

/**
 * Third-party integrations engine.
 *
 * Each provider is a small runtime: validate the user-supplied config, run a
 * live test against the real API, and handle events from the webhook bus
 * (webhook.service.fireEvent calls dispatchEvent below). Outbound requests
 * only ever go to each provider's own hostnames — configs are host-allowlisted
 * at validate time AND at send time, so this can't be turned into an SSRF
 * relay the way an arbitrary-URL webhook could.
 */

// ============================================
// HTTP + formatting helpers
// ============================================

async function httpJson(
  method: 'GET' | 'POST',
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {}
): Promise<{ status: number; text: string; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'User-Agent': 'Sincerely-Integrations/1.0',
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body is fine */ }
    return { status: res.status, text, json };
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? 'timed out' : (err?.message || 'network error');
    throw new Error(`Request to ${new URL(url).hostname} ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Parse an https URL and check its hostname against a provider allowlist. */
function assertProviderUrl(raw: string, hostOk: (host: string) => boolean, what: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(`${what} is not a valid URL`, 400);
  }
  if (url.protocol !== 'https:') throw new AppError(`${what} must use https`, 400);
  if (!hostOk(url.hostname.toLowerCase())) {
    throw new AppError(`${what} must point at the provider's own domain`, 400);
  }
  return url;
}

/** Human-readable one-liner for notification providers. */
function describeEvent(eventType: string, data: Record<string, any>): string {
  switch (eventType) {
    case 'email.sent':
      return `📤 Email sent to ${data.to || 'a contact'}${data.subject ? ` — “${data.subject}”` : ''}`;
    case 'email.opened':
      return '👀 A contact opened your email';
    case 'email.clicked':
      return `🔗 A contact clicked a link${data.url ? `: ${data.url}` : ''}`;
    case 'email.replied':
      return `📩 New reply from ${data.from || 'a contact'}${data.subject ? ` — “${data.subject}”` : ''}`;
    case 'email.bounced':
      return '📛 An email bounced';
    case 'campaign.launched':
      return `🚀 Campaign “${data.campaign?.name || data.campaign_id || ''}” launched`;
    case 'campaign.paused':
      return `⏸️ Campaign “${data.campaign?.name || data.campaign_id || ''}” paused`;
    case 'campaign.completed':
      return '🏁 A campaign finished — every contact has completed the sequence';
    case 'lead.unsubscribed':
      return '🚪 A lead unsubscribed';
    case 'sara.intent_classified':
      return `🤖 SARA classified a reply as “${data.intent || 'unknown'}”${typeof data.confidence === 'number' ? ` (${Math.round(data.confidence * 100)}% confident)` : ''}`;
    case 'contact.created':
      return `👤 New contact added: ${data.contact?.email || ''}`;
    default:
      return `🔔 ${eventType}`;
  }
}

/** Load the contact a CRM event refers to (or null when there isn't one). */
async function loadEventContact(userId: string, data: Record<string, any>) {
  const contactId = data.contact_id;
  if (!contactId) return null;
  const { data: contact } = await supabaseAdmin
    .from('contacts')
    .select('id, email, first_name, last_name, company, job_title, phone, website')
    .eq('id', contactId)
    .eq('user_id', userId)
    .single();
  return contact || null;
}

/** CRM sync fires on replies and on positive SARA intents only. */
function crmShouldSync(eventType: string, data: Record<string, any>): boolean {
  if (eventType === 'email.replied') return true;
  if (eventType === 'sara.intent_classified') {
    return data.intent === 'interested' || data.intent === 'meeting';
  }
  return false;
}

function crmNoteText(eventType: string, data: Record<string, any>): string {
  if (eventType === 'email.replied') {
    return `Replied to a Sincerely campaign email${data.subject ? ` — “${data.subject}”` : ''}.`;
  }
  return `Sincerely SARA classified this lead's reply as “${data.intent}”${typeof data.confidence === 'number' ? ` (${Math.round(data.confidence * 100)}% confidence)` : ''}.`;
}

// ============================================
// Provider runtimes
// ============================================

interface ProviderRuntime {
  /** Throws AppError(400) when the config shape/host is wrong. */
  validate(config: Record<string, string>): void;
  /** Live round-trip against the provider's real API. Never throws. */
  test(config: Record<string, string>): Promise<IntegrationTestResult>;
  /**
   * React to one bus event. Returns a summary line for the activity log,
   * or null to skip silently (event not relevant). Throws on real failures.
   */
  handleEvent(
    userId: string,
    config: Record<string, string>,
    eventType: string,
    data: Record<string, any>
  ): Promise<string | null>;
}

const slackRuntime: ProviderRuntime = {
  validate(config) {
    const url = assertProviderUrl(config.webhook_url || '', (h) => h === 'hooks.slack.com', 'Slack webhook URL');
    if (!url.pathname.startsWith('/services/')) {
      throw new AppError('That does not look like a Slack incoming-webhook URL (expected /services/…)', 400);
    }
  },
  async test(config) {
    try {
      const res = await httpJson('POST', config.webhook_url, {
        body: { text: '👋 Sincerely is connected! Campaign notifications will appear in this channel.' },
      });
      return res.status === 200
        ? { success: true, detail: 'Test message posted to your Slack channel.' }
        : { success: false, detail: `Slack rejected the message (${res.status}: ${res.text.slice(0, 120)})` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(_userId, config, eventType, data) {
    const text = describeEvent(eventType, data);
    const res = await httpJson('POST', config.webhook_url, { body: { text } });
    if (res.status !== 200) throw new Error(`Slack returned ${res.status}: ${res.text.slice(0, 120)}`);
    return text;
  },
};

const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']);
const discordRuntime: ProviderRuntime = {
  validate(config) {
    const url = assertProviderUrl(config.webhook_url || '', (h) => DISCORD_HOSTS.has(h), 'Discord webhook URL');
    if (!url.pathname.startsWith('/api/webhooks/')) {
      throw new AppError('That does not look like a Discord channel webhook URL (expected /api/webhooks/…)', 400);
    }
  },
  async test(config) {
    try {
      const res = await httpJson('POST', config.webhook_url, {
        body: { content: '👋 Sincerely is connected! Campaign notifications will appear in this channel.', username: 'Sincerely' },
      });
      return res.status >= 200 && res.status < 300
        ? { success: true, detail: 'Test message posted to your Discord channel.' }
        : { success: false, detail: `Discord rejected the message (${res.status}: ${res.text.slice(0, 120)})` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(_userId, config, eventType, data) {
    const content = describeEvent(eventType, data);
    const res = await httpJson('POST', config.webhook_url, { body: { content, username: 'Sincerely' } });
    if (res.status < 200 || res.status >= 300) throw new Error(`Discord returned ${res.status}: ${res.text.slice(0, 120)}`);
    return content;
  },
};

const telegramRuntime: ProviderRuntime = {
  validate(config) {
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(config.bot_token || '')) {
      throw new AppError('That does not look like a Telegram bot token (expected 123456:ABC…, from @BotFather)', 400);
    }
    if (!/^(-?\d+|@[A-Za-z0-9_]{5,})$/.test(config.chat_id || '')) {
      throw new AppError('Chat ID must be a number (user/group ID) or a public @channelname', 400);
    }
  },
  async test(config) {
    try {
      const res = await httpJson('POST', `https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
        body: { chat_id: config.chat_id, text: '👋 Sincerely is connected! Campaign notifications will arrive here.' },
      });
      if (res.status === 200 && res.json?.ok) {
        return { success: true, detail: 'Test message delivered on Telegram.' };
      }
      const why = res.json?.description || res.text.slice(0, 120);
      return { success: false, detail: `Telegram rejected the message: ${why}` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(_userId, config, eventType, data) {
    const text = describeEvent(eventType, data);
    const res = await httpJson('POST', `https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
      body: { chat_id: config.chat_id, text },
    });
    if (!(res.status === 200 && res.json?.ok)) {
      throw new Error(`Telegram: ${res.json?.description || res.text.slice(0, 120)}`);
    }
    return text;
  },
};

/** Zapier/Make get the full structured payload — they exist to map fields. */
function automationRuntime(hostOk: (h: string) => boolean, label: string): ProviderRuntime {
  return {
    validate(config) {
      assertProviderUrl(config.webhook_url || '', hostOk, `${label} webhook URL`);
    },
    async test(config) {
      try {
        const res = await httpJson('POST', config.webhook_url, {
          body: {
            event: 'test.ping',
            timestamp: new Date().toISOString(),
            data: { message: `This is a test event from Sincerely — use it to map fields in ${label}.` },
          },
        });
        return res.status >= 200 && res.status < 300
          ? { success: true, detail: `Test event delivered — check your ${label} trigger for the sample payload.` }
          : { success: false, detail: `${label} returned ${res.status}: ${res.text.slice(0, 120)}` };
      } catch (err: any) {
        return { success: false, detail: err.message };
      }
    },
    async handleEvent(_userId, config, eventType, data) {
      const res = await httpJson('POST', config.webhook_url, {
        body: { event: eventType, timestamp: new Date().toISOString(), data },
      });
      if (res.status < 200 || res.status >= 300) throw new Error(`${label} returned ${res.status}: ${res.text.slice(0, 120)}`);
      return `Forwarded ${eventType} to ${label}`;
    },
  };
}

const zapierRuntime = automationRuntime((h) => h === 'hooks.zapier.com', 'Zapier');
const makeRuntime = automationRuntime(
  (h) => h === 'hook.integromat.com' || h === 'hook.make.com' || /^hook\.[a-z0-9-]+\.make\.com$/.test(h),
  'Make'
);

const hubspotRuntime: ProviderRuntime = {
  validate(config) {
    if (!(config.access_token || '').trim()) {
      throw new AppError('HubSpot access token is required', 400);
    }
  },
  async test(config) {
    try {
      const res = await httpJson('GET', 'https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
        headers: { Authorization: `Bearer ${config.access_token.trim()}` },
      });
      if (res.status === 200) return { success: true, detail: 'Connected — HubSpot accepted the token.' };
      if (res.status === 401) return { success: false, detail: 'HubSpot rejected the token (401). Check you copied the private-app access token.' };
      if (res.status === 403) return { success: false, detail: 'Token is valid but missing scopes — enable crm.objects.contacts read + write on the private app.' };
      return { success: false, detail: `HubSpot returned ${res.status}: ${res.text.slice(0, 120)}` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(userId, config, eventType, data) {
    if (!crmShouldSync(eventType, data)) return null;
    const contact = await loadEventContact(userId, data);
    if (!contact?.email) return null;

    const properties: Record<string, string> = { email: contact.email };
    if (contact.first_name) properties.firstname = contact.first_name;
    if (contact.last_name) properties.lastname = contact.last_name;
    if (contact.company) properties.company = contact.company;
    if (contact.job_title) properties.jobtitle = contact.job_title;
    if (contact.phone) properties.phone = contact.phone;
    if (contact.website) properties.website = contact.website;

    const res = await httpJson('POST', 'https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', {
      headers: { Authorization: `Bearer ${config.access_token.trim()}` },
      body: { inputs: [{ idProperty: 'email', id: contact.email, properties }] },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HubSpot upsert failed (${res.status}): ${res.json?.message || res.text.slice(0, 160)}`);
    }
    return `Synced ${contact.email} to HubSpot — ${crmNoteText(eventType, data)}`;
  },
};

const pipedriveRuntime: ProviderRuntime = {
  validate(config) {
    if (!/^[a-f0-9]{20,}$/i.test((config.api_token || '').trim())) {
      throw new AppError('That does not look like a Pipedrive API token (Personal preferences → API)', 400);
    }
  },
  async test(config) {
    try {
      const token = encodeURIComponent(config.api_token.trim());
      const res = await httpJson('GET', `https://api.pipedrive.com/v1/users/me?api_token=${token}`);
      if (res.status === 200 && res.json?.success) {
        const who = res.json.data?.name || res.json.data?.email || 'your account';
        return { success: true, detail: `Connected to Pipedrive as ${who}.` };
      }
      if (res.status === 401) return { success: false, detail: 'Pipedrive rejected the token (401). Copy it from Personal preferences → API.' };
      return { success: false, detail: `Pipedrive returned ${res.status}: ${res.text.slice(0, 120)}` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(userId, config, eventType, data) {
    if (!crmShouldSync(eventType, data)) return null;
    const contact = await loadEventContact(userId, data);
    if (!contact?.email) return null;

    const token = encodeURIComponent(config.api_token.trim());
    const base = 'https://api.pipedrive.com/v1';

    // Find an existing person by email, else create one.
    let personId: number | undefined;
    const search = await httpJson(
      'GET',
      `${base}/persons/search?term=${encodeURIComponent(contact.email)}&fields=email&exact_match=true&api_token=${token}`
    );
    if (search.status === 200 && search.json?.success) {
      personId = search.json.data?.items?.[0]?.item?.id;
    }
    let action = 'Updated';
    if (!personId) {
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;
      const created = await httpJson('POST', `${base}/persons?api_token=${token}`, {
        body: {
          name,
          email: [{ value: contact.email, primary: true }],
          ...(contact.phone ? { phone: [{ value: contact.phone, primary: true }] } : {}),
        },
      });
      if (!(created.status >= 200 && created.status < 300 && created.json?.success)) {
        throw new Error(`Pipedrive person create failed (${created.status}): ${created.json?.error || created.text.slice(0, 160)}`);
      }
      personId = created.json.data?.id;
      action = 'Created';
    }
    if (!personId) throw new Error('Pipedrive did not return a person id');

    const note = await httpJson('POST', `${base}/notes?api_token=${token}`, {
      body: { content: crmNoteText(eventType, data), person_id: personId },
    });
    if (!(note.status >= 200 && note.status < 300 && note.json?.success)) {
      throw new Error(`Pipedrive note failed (${note.status}): ${note.json?.error || note.text.slice(0, 160)}`);
    }
    return `${action} ${contact.email} in Pipedrive and attached a note`;
  },
};

const RUNTIMES: Record<IntegrationProviderId, ProviderRuntime> = {
  slack: slackRuntime,
  discord: discordRuntime,
  telegram: telegramRuntime,
  zapier: zapierRuntime,
  make: makeRuntime,
  hubspot: hubspotRuntime,
  pipedrive: pipedriveRuntime,
};

// ============================================
// Config redaction
// ============================================

function maskValue(value: string): string {
  if (value.startsWith('http')) {
    try {
      const url = new URL(value);
      return `${url.origin}/…${value.slice(-4)}`;
    } catch { /* fall through to generic masking */ }
  }
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Secrets never leave the server readable — the client gets a preview only. */
function redact(row: UserIntegration): UserIntegration {
  const meta = getIntegrationMeta(row.provider);
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.config || {})) {
    const field = meta?.fields.find((f) => f.key === key);
    config[key] = field && !field.secret ? String(value) : maskValue(String(value));
  }
  return { ...row, config };
}

// ============================================
// CRUD
// ============================================

export async function listIntegrations(userId: string): Promise<UserIntegration[]> {
  const { data, error } = await supabaseAdmin
    .from('user_integrations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(redact);
}

/**
 * Merge a submitted config over an existing one: empty strings mean "keep
 * what's stored" so users can edit non-secret fields without re-pasting
 * secrets (which are only ever shown back to them masked).
 */
function mergeConfig(
  providerId: IntegrationProviderId,
  existing: Record<string, string>,
  submitted: Record<string, string>
): Record<string, string> {
  const meta = getIntegrationMeta(providerId)!;
  const merged: Record<string, string> = {};
  for (const field of meta.fields) {
    const incoming = (submitted[field.key] ?? '').trim();
    const kept = (existing[field.key] ?? '').trim();
    const value = incoming || kept;
    if (!value) throw new AppError(`${field.label} is required`, 400);
    merged[field.key] = value;
  }
  return merged;
}

function sanitizeEvents(providerId: IntegrationProviderId, events: string[] | undefined): string[] {
  const meta = getIntegrationMeta(providerId)!;
  const requested = events && events.length ? events : meta.defaultEvents;
  const supported = new Set(meta.supportedEvents);
  const filtered = requested.filter((e) => supported.has(e));
  if (filtered.length === 0) throw new AppError('Select at least one event', 400);
  return filtered;
}

/**
 * Connect (or reconnect) a provider: validate the config shape, run a live
 * test against the provider's API, and only store it if the test passes —
 * a connected integration is one that has actually worked at least once.
 */
export async function connectIntegration(
  userId: string,
  providerId: string,
  input: ConnectIntegrationInput
): Promise<{ integration: UserIntegration; test: IntegrationTestResult }> {
  const meta = getIntegrationMeta(providerId);
  if (!meta) throw new AppError('Unknown integration provider', 404);
  const runtime = RUNTIMES[meta.id];

  const { data: existing } = await supabaseAdmin
    .from('user_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', meta.id)
    .maybeSingle();

  const config = mergeConfig(meta.id, existing?.config || {}, input.config || {});
  runtime.validate(config);

  const test = await runtime.test(config);
  if (!test.success) {
    throw new AppError(`Connection test failed: ${test.detail}`, 400);
  }

  const events = sanitizeEvents(meta.id, input.events);
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('user_integrations')
    .upsert(
      {
        user_id: userId,
        provider: meta.id,
        config,
        events,
        is_active: true,
        last_success_at: now,
        last_error: null,
        updated_at: now,
      },
      { onConflict: 'user_id,provider' }
    )
    .select()
    .single();
  if (error) throw error;
  return { integration: redact(data), test };
}

export async function updateIntegration(
  userId: string,
  id: string,
  input: UpdateIntegrationInput
): Promise<UserIntegration> {
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('user_integrations')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  if (fetchErr || !existing) throw new AppError('Integration not found', 404);

  const update: Record<string, any> = { updated_at: new Date().toISOString() };

  if (input.config) {
    const config = mergeConfig(existing.provider, existing.config || {}, input.config);
    RUNTIMES[existing.provider as IntegrationProviderId].validate(config);
    update.config = config;
  }
  if (input.events) {
    update.events = sanitizeEvents(existing.provider, input.events);
  }
  if (typeof input.is_active === 'boolean') {
    update.is_active = input.is_active;
  }

  const { data, error } = await supabaseAdmin
    .from('user_integrations')
    .update(update)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return redact(data);
}

export async function deleteIntegration(userId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_integrations')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function testIntegration(userId: string, id: string): Promise<IntegrationTestResult> {
  const { data: row } = await supabaseAdmin
    .from('user_integrations')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  if (!row) throw new AppError('Integration not found', 404);

  const result = await RUNTIMES[row.provider as IntegrationProviderId].test(row.config || {});
  await supabaseAdmin
    .from('user_integrations')
    .update(
      result.success
        ? { last_success_at: new Date().toISOString(), last_error: null }
        : { last_error: result.detail }
    )
    .eq('id', id);
  await logActivity(row.id, 'test.ping', result.success ? 'Manual test succeeded' : 'Manual test failed', result.success, result.detail);
  return result;
}

export async function getActivity(userId: string, id: string, limit = 30): Promise<IntegrationActivity[]> {
  // Ownership check first — activity rows only join back to the integration.
  const { data: row } = await supabaseAdmin
    .from('user_integrations')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  if (!row) throw new AppError('Integration not found', 404);

  const { data } = await supabaseAdmin
    .from('integration_activity')
    .select('*')
    .eq('integration_id', id)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

// ============================================
// Event dispatch (called from webhook.service.fireEvent)
// ============================================

async function logActivity(
  integrationId: string,
  eventType: string,
  summary: string,
  success: boolean,
  detail?: string | null
): Promise<void> {
  const { error } = await supabaseAdmin.from('integration_activity').insert({
    integration_id: integrationId,
    event_type: eventType,
    summary: summary.slice(0, 500),
    success,
    detail: detail ? detail.slice(0, 1000) : null,
  });
  if (error) console.error('[Integrations] Failed to log activity:', error.message);
}

/**
 * Fan one bus event out to every active integration subscribed to it.
 * Fire-and-forget from the caller's perspective; failures land in the
 * activity log and on the integration's last_error, never in the caller.
 */
export async function dispatchEvent(
  userId: string,
  eventType: string,
  data: Record<string, any>
): Promise<void> {
  const { data: rows, error } = await supabaseAdmin
    .from('user_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .contains('events', [eventType]);
  if (error) {
    console.error('[Integrations] Failed to query integrations:', error.message);
    return;
  }
  if (!rows || rows.length === 0) return;

  await Promise.allSettled(
    rows.map(async (row) => {
      const runtime = RUNTIMES[row.provider as IntegrationProviderId];
      if (!runtime) return;
      try {
        const summary = await runtime.handleEvent(userId, row.config || {}, eventType, data);
        if (summary === null) return; // event not relevant for this provider
        await logActivity(row.id, eventType, summary, true);
        await supabaseAdmin
          .from('user_integrations')
          .update({ last_success_at: new Date().toISOString(), last_error: null })
          .eq('id', row.id);
      } catch (err: any) {
        const message = err?.message || 'Delivery failed';
        console.error(`[Integrations] ${row.provider} delivery failed:`, message);
        await logActivity(row.id, eventType, `Failed to deliver ${eventType}`, false, message);
        await supabaseAdmin
          .from('user_integrations')
          .update({ last_error: message.slice(0, 500) })
          .eq('id', row.id);
      }
    })
  );
}

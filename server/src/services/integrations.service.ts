import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import { assertSafeWebhookUrl, pinnedPost } from './webhook.service.js';
import { ensureFreshHubspotToken } from './integrations-oauth.service.js';
import {
  getIntegrationMeta,
  type IntegrationProviderId,
  type UserIntegration,
  type ConnectIntegrationInput,
  type UpdateIntegrationInput,
  type IntegrationActivity,
  type IntegrationTestResult,
  type IntegrationResourcesResult,
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

/**
 * Context looked up once per event and shared by every integration that
 * receives it — contact and campaign details make notifications and CRM
 * records dramatically more useful than raw IDs.
 */
export interface EventContext {
  contact?: {
    id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    job_title: string | null;
    phone: string | null;
    website: string | null;
  } | null;
  campaignName?: string | null;
}

export async function buildEventContext(userId: string, data: Record<string, any>): Promise<EventContext> {
  const ctx: EventContext = {};
  const lookups: Promise<void>[] = [];
  if (data.contact_id) {
    lookups.push((async () => {
      const { data: row } = await supabaseAdmin
        .from('contacts')
        .select('id, email, first_name, last_name, company, job_title, phone, website')
        .eq('id', data.contact_id)
        .eq('user_id', userId)
        .single();
      ctx.contact = row || null;
    })());
  }
  if (data.campaign?.name) {
    ctx.campaignName = data.campaign.name;
  } else if (data.campaign_id) {
    lookups.push((async () => {
      const { data: row } = await supabaseAdmin
        .from('campaigns')
        .select('name')
        .eq('id', data.campaign_id)
        .eq('user_id', userId)
        .single();
      ctx.campaignName = row?.name || null;
    })());
  }
  await Promise.allSettled(lookups);
  return ctx;
}

/** Load the contact a CRM event refers to (shared ctx first, DB fallback). */
async function loadEventContact(userId: string, data: Record<string, any>, ctx?: EventContext) {
  if (ctx && 'contact' in ctx) return ctx.contact ?? null;
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

/**
 * Structured rich card for notification providers: headline plus labeled
 * facts, rendered natively per platform (Slack Block Kit, Discord embed,
 * Teams Adaptive Card, Telegram multiline).
 */
interface RichEvent {
  headline: string;
  facts: [string, string][];
  /** Deep link back into Sincerely, when there's a sensible destination. */
  link?: { label: string; url: string };
  /** Accent for platforms that support one (Discord embed strip). */
  color: number;
}

function appUrl(path: string): string {
  return `${env.CLIENT_URL.replace(/\/+$/, '')}${path}`;
}

function contactLabel(ctx?: EventContext): string | null {
  const c = ctx?.contact;
  if (!c) return null;
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  if (name && c.email) return `${name} <${c.email}>`;
  return name || c.email || null;
}

function richEvent(eventType: string, data: Record<string, any>, ctx?: EventContext): RichEvent {
  const facts: [string, string][] = [];
  const who = contactLabel(ctx);
  if (who) facts.push(['Contact', who]);
  if (ctx?.contact?.company) facts.push(['Company', ctx.contact.company]);
  if (ctx?.campaignName) facts.push(['Campaign', ctx.campaignName]);

  const GREEN = 0x16a34a, RED = 0xdc2626, INDIGO = 0x6366f1, AMBER = 0xd97706;

  switch (eventType) {
    case 'email.replied':
      if (data.subject) facts.push(['Subject', String(data.subject)]);
      return {
        headline: `📩 New reply${who ? ` from ${who.split(' <')[0]}` : data.from ? ` from ${data.from}` : ''}`,
        facts,
        link: { label: 'Open in Unibox', url: appUrl('/inbox') },
        color: GREEN,
      };
    case 'email.sent':
      if (data.subject) facts.push(['Subject', String(data.subject)]);
      if (data.to) facts.push(['To', String(data.to)]);
      return { headline: '📤 Email sent', facts, color: INDIGO };
    case 'email.opened':
      return {
        headline: `👀 Email opened${who ? ` by ${who.split(' <')[0]}` : ''}`,
        facts,
        color: INDIGO,
      };
    case 'email.clicked':
      if (data.url) facts.push(['Link', String(data.url)]);
      return { headline: `🔗 Link clicked${who ? ` by ${who.split(' <')[0]}` : ''}`, facts, color: INDIGO };
    case 'email.bounced':
      return { headline: '📛 Email bounced', facts, color: RED };
    case 'campaign.launched':
      return {
        headline: `🚀 Campaign launched: ${data.campaign?.name || ctx?.campaignName || ''}`.trim(),
        facts,
        link: data.campaign?.id ? { label: 'View campaign', url: appUrl(`/campaigns/${data.campaign.id}`) } : undefined,
        color: INDIGO,
      };
    case 'campaign.paused':
      return { headline: `⏸️ Campaign paused: ${data.campaign?.name || ctx?.campaignName || ''}`.trim(), facts, color: AMBER };
    case 'campaign.completed':
      return {
        headline: '🏁 Campaign completed — every contact finished the sequence',
        facts,
        link: data.campaign_id ? { label: 'View campaign', url: appUrl(`/campaigns/${data.campaign_id}`) } : undefined,
        color: GREEN,
      };
    case 'lead.unsubscribed':
      return { headline: `🚪 Lead unsubscribed${who ? `: ${who.split(' <')[0]}` : ''}`, facts, color: AMBER };
    case 'sara.intent_classified': {
      const intent = String(data.intent || 'unknown');
      const pct = typeof data.confidence === 'number' ? ` (${Math.round(data.confidence * 100)}%)` : '';
      facts.push(['Intent', `${intent}${pct}`]);
      const positive = intent === 'interested' || intent === 'meeting';
      return {
        headline: positive
          ? `🎯 ${intent === 'meeting' ? 'Meeting request' : 'Interested lead'}${who ? `: ${who.split(' <')[0]}` : ''}`
          : `🤖 SARA classified a reply as “${intent}”`,
        facts,
        link: { label: 'Open in Unibox', url: appUrl('/inbox') },
        color: positive ? GREEN : INDIGO,
      };
    }
    case 'contact.created':
      return { headline: `👤 New contact: ${data.contact?.email || who || ''}`.trim(), facts, color: INDIGO };
    case 'test.ping':
      return { headline: '👋 Sincerely is connected! Notifications will appear here.', facts: [], color: INDIGO };
    default:
      return { headline: `🔔 ${eventType}`, facts, color: INDIGO };
  }
}

/** Plain-text rendering of a rich event (Telegram, fallbacks, activity log). */
function renderText(rich: RichEvent): string {
  const lines = [rich.headline, ...rich.facts.map(([k, v]) => `${k}: ${v}`)];
  if (rich.link) lines.push(`${rich.link.label}: ${rich.link.url}`);
  return lines.join('\n');
}

/** Slack Block Kit rendering (incoming webhooks support blocks natively). */
function renderSlackBlocks(rich: RichEvent): Record<string, any> {
  const blocks: any[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${rich.headline}*` } },
  ];
  if (rich.facts.length) {
    blocks.push({
      type: 'section',
      fields: rich.facts.slice(0, 10).map(([k, v]) => ({ type: 'mrkdwn', text: `*${k}*\n${v}` })),
    });
  }
  if (rich.link) {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: rich.link.label }, url: rich.link.url }],
    });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: 'Sincerely' }] });
  return { text: rich.headline, blocks };
}

/** Discord embed rendering. */
function renderDiscordEmbed(rich: RichEvent): Record<string, any> {
  return {
    username: 'Sincerely',
    embeds: [
      {
        title: rich.headline.slice(0, 256),
        color: rich.color,
        fields: rich.facts.slice(0, 25).map(([k, v]) => ({ name: k, value: String(v).slice(0, 1024), inline: true })),
        ...(rich.link ? { description: `[${rich.link.label}](${rich.link.url})` } : {}),
        timestamp: new Date().toISOString(),
        footer: { text: 'Sincerely' },
      },
    ],
  };
}

/** Teams Adaptive Card rendering (with legacy-connector text fallback). */
function renderTeamsCard(rich: RichEvent): Record<string, any> {
  const body: any[] = [
    { type: 'TextBlock', text: rich.headline, weight: 'Bolder', size: 'Medium', wrap: true },
  ];
  if (rich.facts.length) {
    body.push({ type: 'FactSet', facts: rich.facts.map(([k, v]) => ({ title: k, value: String(v) })) });
  }
  return {
    type: 'message',
    text: renderText(rich),
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          ...(rich.link ? { actions: [{ type: 'Action.OpenUrl', title: rich.link.label, url: rich.link.url }] } : {}),
        },
      },
    ],
  };
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
  validate(config: Record<string, string>): void | Promise<void>;
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
    data: Record<string, any>,
    ctx?: EventContext
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
        body: renderSlackBlocks(richEvent('test.ping', {})),
      });
      return res.status === 200
        ? { success: true, detail: 'Test message posted to your Slack channel.' }
        : { success: false, detail: `Slack rejected the message (${res.status}: ${res.text.slice(0, 120)})` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(_userId, config, eventType, data, ctx) {
    const rich = richEvent(eventType, data, ctx);
    const res = await httpJson('POST', config.webhook_url, { body: renderSlackBlocks(rich) });
    if (res.status !== 200) throw new Error(`Slack returned ${res.status}: ${res.text.slice(0, 120)}`);
    return rich.headline;
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
        body: renderDiscordEmbed(richEvent('test.ping', {})),
      });
      return res.status >= 200 && res.status < 300
        ? { success: true, detail: 'Test message posted to your Discord channel.' }
        : { success: false, detail: `Discord rejected the message (${res.status}: ${res.text.slice(0, 120)})` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(_userId, config, eventType, data, ctx) {
    const rich = richEvent(eventType, data, ctx);
    const res = await httpJson('POST', config.webhook_url, { body: renderDiscordEmbed(rich) });
    if (res.status < 200 || res.status >= 300) throw new Error(`Discord returned ${res.status}: ${res.text.slice(0, 120)}`);
    return rich.headline;
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
        body: { chat_id: config.chat_id, text: renderText(richEvent('test.ping', {})) },
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
  async handleEvent(_userId, config, eventType, data, ctx) {
    const rich = richEvent(eventType, data, ctx);
    const res = await httpJson('POST', `https://api.telegram.org/bot${config.bot_token}/sendMessage`, {
      body: { chat_id: config.chat_id, text: renderText(rich) },
    });
    if (!(res.status === 200 && res.json?.ok)) {
      throw new Error(`Telegram: ${res.json?.description || res.text.slice(0, 120)}`);
    }
    return rich.headline;
  },
};

const TEAMS_HOST_OK = (h: string) =>
  h === 'webhook.office.com' ||
  h.endsWith('.webhook.office.com') ||
  h.endsWith('.logic.azure.com');

const teamsRuntime: ProviderRuntime = {
  validate(config) {
    assertProviderUrl(config.webhook_url || '', TEAMS_HOST_OK, 'Teams webhook URL');
  },
  async test(config) {
    try {
      const res = await httpJson('POST', config.webhook_url, {
        body: renderTeamsCard(richEvent('test.ping', {})),
      });
      // Workflows answers 202, the legacy connector 200.
      return res.status >= 200 && res.status < 300
        ? { success: true, detail: 'Test message sent to your Teams channel.' }
        : { success: false, detail: `Teams rejected the message (${res.status}: ${res.text.slice(0, 120)})` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(_userId, config, eventType, data, ctx) {
    const rich = richEvent(eventType, data, ctx);
    const res = await httpJson('POST', config.webhook_url, { body: renderTeamsCard(rich) });
    if (res.status < 200 || res.status >= 300) throw new Error(`Teams returned ${res.status}: ${res.text.slice(0, 120)}`);
    return rich.headline;
  },
};

/**
 * n8n is the one provider whose webhook can live anywhere (self-hosted), so
 * its URL goes through the same SSRF pipeline as raw webhook endpoints:
 * resolve + private-range check, then a connection pinned to the vetted IPs.
 */
const n8nRuntime: ProviderRuntime = {
  async validate(config) {
    await assertSafeWebhookUrl(config.webhook_url || '');
  },
  async test(config) {
    try {
      const addresses = await assertSafeWebhookUrl(config.webhook_url);
      const res = await pinnedPost(
        config.webhook_url,
        addresses,
        { 'Content-Type': 'application/json', 'User-Agent': 'Sincerely-Integrations/1.0' },
        JSON.stringify({
          event: 'test.ping',
          timestamp: new Date().toISOString(),
          data: { message: 'This is a test event from Sincerely — use it to map fields in n8n.' },
        }),
        12000
      );
      return res.statusCode >= 200 && res.statusCode < 300
        ? { success: true, detail: 'Test event delivered — check the executions list on your n8n workflow.' }
        : { success: false, detail: `n8n returned ${res.statusCode}: ${res.body.slice(0, 120)}` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(_userId, config, eventType, data) {
    const addresses = await assertSafeWebhookUrl(config.webhook_url);
    const res = await pinnedPost(
      config.webhook_url,
      addresses,
      { 'Content-Type': 'application/json', 'User-Agent': 'Sincerely-Integrations/1.0' },
      JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), data }),
      12000
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`n8n returned ${res.statusCode}: ${res.body.slice(0, 120)}`);
    }
    return `Forwarded ${eventType} to n8n`;
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
  async handleEvent(userId, config, eventType, data, ctx) {
    if (!crmShouldSync(eventType, data)) return null;
    const contact = await loadEventContact(userId, data, ctx);
    if (!contact?.email) return null;

    const properties: Record<string, string> = { email: contact.email };
    if (contact.first_name) properties.firstname = contact.first_name;
    if (contact.last_name) properties.lastname = contact.last_name;
    if (contact.company) properties.company = contact.company;
    if (contact.job_title) properties.jobtitle = contact.job_title;
    if (contact.phone) properties.phone = contact.phone;
    if (contact.website) properties.website = contact.website;

    const auth = { Authorization: `Bearer ${config.access_token.trim()}` };
    const res = await httpJson('POST', 'https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', {
      headers: auth,
      body: { inputs: [{ idProperty: 'email', id: contact.email, properties }] },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HubSpot upsert failed (${res.status}): ${res.json?.message || res.text.slice(0, 160)}`);
    }
    let summary = `Synced ${contact.email} to HubSpot — ${crmNoteText(eventType, data)}`;

    // Positive intent → open a deal in the default pipeline, associated to
    // the contact. A deal failure downgrades to a warning rather than
    // failing the delivery: the contact sync above already succeeded.
    const positiveIntent =
      eventType === 'sara.intent_classified' && (data.intent === 'interested' || data.intent === 'meeting');
    if (positiveIntent && config.create_deals !== 'no') {
      const hubspotContactId = res.json?.results?.[0]?.id;
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;
      const dealRes = await httpJson('POST', 'https://api.hubapi.com/crm/v3/objects/deals', {
        headers: auth,
        body: {
          properties: {
            dealname: `${name}${contact.company ? ` (${contact.company})` : ''} — Sincerely`,
            pipeline: 'default',
            dealstage: 'appointmentscheduled',
          },
          ...(hubspotContactId
            ? {
                associations: [
                  {
                    to: { id: hubspotContactId },
                    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
                  },
                ],
              }
            : {}),
        },
      });
      if (dealRes.status >= 200 && dealRes.status < 300) {
        summary += ' · deal created';
      } else {
        summary += ` · deal creation failed (${dealRes.status}: ${dealRes.json?.message || 'check deal scopes'})`;
      }
    }
    return summary;
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
  async handleEvent(userId, config, eventType, data, ctx) {
    if (!crmShouldSync(eventType, data)) return null;
    const contact = await loadEventContact(userId, data, ctx);
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
    let summary = `${action} ${contact.email} in Pipedrive and attached a note`;

    // Positive intent → open a deal tied to the person (same downgrade-to-
    // warning semantics as HubSpot).
    const positiveIntent =
      eventType === 'sara.intent_classified' && (data.intent === 'interested' || data.intent === 'meeting');
    if (positiveIntent && config.create_deals !== 'no') {
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;
      const deal = await httpJson('POST', `${base}/deals?api_token=${token}`, {
        body: { title: `${name}${contact.company ? ` (${contact.company})` : ''} — Sincerely`, person_id: personId },
      });
      if (deal.status >= 200 && deal.status < 300 && deal.json?.success) {
        summary += ' · deal created';
      } else {
        summary += ` · deal creation failed (${deal.status}: ${deal.json?.error || 'unknown'})`;
      }
    }
    return summary;
  },
};

const NOTION_VERSION = '2022-06-28';

/** Notion database IDs appear with or without dashes — normalize to bare hex. */
function notionDatabaseId(raw: string): string {
  return (raw || '').trim().replace(/-/g, '').toLowerCase();
}

const notionRuntime: ProviderRuntime = {
  validate(config) {
    if (!(config.token || '').trim()) {
      throw new AppError('Notion integration secret is required', 400);
    }
    if (!/^[0-9a-f]{32}$/.test(notionDatabaseId(config.database_id))) {
      throw new AppError('Database ID should be the 32-character string from the database URL', 400);
    }
  },
  async test(config) {
    try {
      const res = await httpJson('GET', `https://api.notion.com/v1/databases/${notionDatabaseId(config.database_id)}`, {
        headers: { Authorization: `Bearer ${config.token.trim()}`, 'Notion-Version': NOTION_VERSION },
      });
      if (res.status === 200) {
        const title = res.json?.title?.map((t: any) => t?.plain_text || '').join('') || 'your database';
        return { success: true, detail: `Connected to “${title}” in Notion.` };
      }
      if (res.status === 401) return { success: false, detail: 'Notion rejected the secret (401). Copy it from notion.so/my-integrations.' };
      if (res.status === 404) {
        return { success: false, detail: 'Notion can’t see that database (404). Open the database → ⋯ → Connections and add your integration, and double-check the ID.' };
      }
      return { success: false, detail: `Notion returned ${res.status}: ${res.json?.message || res.text.slice(0, 120)}` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(userId, config, eventType, data, ctx) {
    if (!crmShouldSync(eventType, data)) return null;
    const contact = await loadEventContact(userId, data, ctx);
    if (!contact?.email) return null;

    const headers = {
      Authorization: `Bearer ${config.token.trim()}`,
      'Notion-Version': NOTION_VERSION,
    };
    const dbId = notionDatabaseId(config.database_id);

    // Property names vary per database — the title property is the only
    // guaranteed slot, so find its actual name first.
    const db = await httpJson('GET', `https://api.notion.com/v1/databases/${dbId}`, { headers });
    if (db.status !== 200) {
      throw new Error(`Notion database read failed (${db.status}): ${db.json?.message || db.text.slice(0, 120)}`);
    }
    const titleProp = Object.entries(db.json?.properties || {}).find(
      ([, p]: [string, any]) => p?.type === 'title'
    )?.[0];
    if (!titleProp) throw new Error('Notion database has no title property');

    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
    const pageTitle = name ? `${name} (${contact.email})` : contact.email;
    const lines = [
      crmNoteText(eventType, data),
      `Email: ${contact.email}`,
      contact.company ? `Company: ${contact.company}` : null,
      contact.job_title ? `Role: ${contact.job_title}` : null,
      contact.phone ? `Phone: ${contact.phone}` : null,
    ].filter(Boolean) as string[];

    const res = await httpJson('POST', 'https://api.notion.com/v1/pages', {
      headers,
      body: {
        parent: { database_id: dbId },
        properties: {
          [titleProp]: { title: [{ text: { content: pageTitle.slice(0, 200) } }] },
        },
        children: lines.map((line) => ({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }] },
        })),
      },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Notion page create failed (${res.status}): ${res.json?.message || res.text.slice(0, 160)}`);
    }
    return `Added ${contact.email} to your Notion database`;
  },
};

/** Fields Sincerely can fill when the user's Airtable table has them. */
const AIRTABLE_FIELDS = ['Email', 'Name', 'Company', 'Event', 'Notes'] as const;

async function airtableTableFields(config: Record<string, string>): Promise<{ fields: string[]; error?: string }> {
  const res = await httpJson(
    'GET',
    `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(config.base_id.trim())}/tables`,
    { headers: { Authorization: `Bearer ${config.token.trim()}` } }
  );
  if (res.status === 401) return { fields: [], error: 'Airtable rejected the token (401). Create one at airtable.com/create/tokens.' };
  if (res.status === 403) return { fields: [], error: 'Token can’t read the base schema — add the schema.bases:read scope and grant the base.' };
  if (res.status === 404) return { fields: [], error: 'Base not found (404). Check the base ID (starts with app…) and that the token has access to it.' };
  if (res.status !== 200) return { fields: [], error: `Airtable returned ${res.status}: ${res.json?.error?.message || res.text.slice(0, 120)}` };

  const wanted = config.table_name.trim().toLowerCase();
  const table = (res.json?.tables || []).find(
    (t: any) => t?.name?.toLowerCase() === wanted || t?.id === config.table_name.trim()
  );
  if (!table) {
    const names = (res.json?.tables || []).map((t: any) => t.name).slice(0, 10).join(', ');
    return { fields: [], error: `No table named “${config.table_name}” in that base. Found: ${names || 'none'}` };
  }
  const present = new Set((table.fields || []).map((f: any) => String(f.name)));
  const usable = AIRTABLE_FIELDS.filter((f) => present.has(f));
  if (!usable.includes('Email')) {
    return { fields: [], error: `Table “${table.name}” needs an “Email” field (optional extras Sincerely fills: ${AIRTABLE_FIELDS.slice(1).join(', ')}).` };
  }
  return { fields: usable };
}

const airtableRuntime: ProviderRuntime = {
  validate(config) {
    if (!(config.token || '').trim()) throw new AppError('Airtable personal access token is required', 400);
    if (!/^app[a-zA-Z0-9]{14,}$/.test((config.base_id || '').trim())) {
      throw new AppError('Base ID should start with “app” (find it in the base URL)', 400);
    }
    if (!(config.table_name || '').trim()) throw new AppError('Table name is required', 400);
  },
  async test(config) {
    try {
      const { fields, error } = await airtableTableFields(config);
      if (error) return { success: false, detail: error };
      return { success: true, detail: `Connected — Sincerely will fill: ${fields.join(', ')}.` };
    } catch (err: any) {
      return { success: false, detail: err.message };
    }
  },
  async handleEvent(userId, config, eventType, data, ctx) {
    if (!crmShouldSync(eventType, data)) return null;
    const contact = await loadEventContact(userId, data, ctx);
    if (!contact?.email) return null;

    const { fields: usable, error } = await airtableTableFields(config);
    if (error) throw new Error(error);

    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
    const candidate: Record<string, string> = {
      Email: contact.email,
      Name: name,
      Company: contact.company || '',
      Event: eventType,
      Notes: crmNoteText(eventType, data),
    };
    const fields: Record<string, string> = {};
    for (const key of usable) {
      if (candidate[key]) fields[key] = candidate[key];
    }

    const res = await httpJson(
      'POST',
      `https://api.airtable.com/v0/${encodeURIComponent(config.base_id.trim())}/${encodeURIComponent(config.table_name.trim())}`,
      {
        headers: { Authorization: `Bearer ${config.token.trim()}` },
        body: { records: [{ fields }], typecast: true },
      }
    );
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Airtable record create failed (${res.status}): ${res.json?.error?.message || res.text.slice(0, 160)}`);
    }
    return `Added ${contact.email} to Airtable table “${config.table_name}”`;
  },
};

const RUNTIMES: Record<IntegrationProviderId, ProviderRuntime> = {
  slack: slackRuntime,
  discord: discordRuntime,
  telegram: telegramRuntime,
  teams: teamsRuntime,
  zapier: zapierRuntime,
  make: makeRuntime,
  n8n: n8nRuntime,
  hubspot: hubspotRuntime,
  pipedrive: pipedriveRuntime,
  notion: notionRuntime,
  airtable: airtableRuntime,
};

/** Exported for the integration test-bench (scripts/, not the HTTP API). */
export const PROVIDER_RUNTIMES = RUNTIMES;

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

/**
 * Non-credential metadata keys (written by OAuth connect) that are safe to
 * show readable — the connected workspace/channel names make the UI say
 * "Connected to #wins in Acme" instead of a masked string.
 */
const SAFE_META_KEYS = new Set(['auth_kind', 'channel', 'workspace', 'guild', 'expires_at']);

/** Secrets never leave the server readable — the client gets a preview only. */
function redact(row: UserIntegration): UserIntegration {
  const meta = getIntegrationMeta(row.provider);
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.config || {})) {
    const field = meta?.fields.find((f) => f.key === key);
    const safe = (field && !field.secret) || SAFE_META_KEYS.has(key);
    config[key] = safe ? String(value) : maskValue(String(value));
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
export function mergeConfig(
  providerId: IntegrationProviderId,
  existing: Record<string, string>,
  submitted: Record<string, string>
): Record<string, string> {
  const meta = getIntegrationMeta(providerId)!;
  // Start from the stored config so keys OAuth wrote (tokens, workspace
  // metadata, refresh_token) survive a manual edit of the catalog fields.
  const merged: Record<string, string> = { ...existing };
  for (const field of meta.fields) {
    const incoming = (submitted[field.key] ?? '').trim();
    const kept = (existing[field.key] ?? '').trim();
    if (field.toggle) {
      // Toggles are two-state with a default of on; absent means "on".
      merged[field.key] = (incoming || kept) === 'no' ? 'no' : 'yes';
      continue;
    }
    const value = incoming || kept;
    if (!value) {
      if (field.optional) continue;
      throw new AppError(`${field.label} is required`, 400);
    }
    merged[field.key] = value;
  }
  return merged;
}

export function sanitizeEvents(providerId: IntegrationProviderId, events: string[] | undefined): string[] {
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

  let config = mergeConfig(meta.id, existing?.config || {}, input.config || {});
  await runtime.validate(config);

  // Re-saving an OAuth-connected row later (e.g. only changing events) may
  // arrive with an expired short-lived token — freshen before the live test.
  if (existing?.id) {
    config = await prepareConfig(meta.id, existing.id, config);
  }

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
    await RUNTIMES[existing.provider as IntegrationProviderId].validate(config);
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

  let config: Record<string, string> = row.config || {};
  try {
    config = await prepareConfig(row.provider, row.id, config);
  } catch (err: any) {
    // A dead refresh token is itself a test failure worth reporting.
    const result = { success: false, detail: err?.message || 'Could not refresh credentials' };
    await supabaseAdmin.from('user_integrations').update({ last_error: result.detail }).eq('id', id);
    await logActivity(row.id, 'test.ping', 'Manual test failed', false, result.detail);
    return result;
  }
  const result = await RUNTIMES[row.provider as IntegrationProviderId].test(config);
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
// Live resource pickers (Notion databases, Airtable bases/tables)
// ============================================

/**
 * List pickable remote resources so the UI can show dropdowns instead of
 * making users copy IDs. Works pre-save (submitted config) and post-save
 * (stored config); submitted values win so a freshly pasted token is used.
 */
export async function getResources(
  userId: string,
  providerId: string,
  submitted: Record<string, string> = {}
): Promise<IntegrationResourcesResult> {
  const meta = getIntegrationMeta(providerId);
  if (!meta) throw new AppError('Unknown integration provider', 404);

  const { data: existing } = await supabaseAdmin
    .from('user_integrations')
    .select('config')
    .eq('user_id', userId)
    .eq('provider', meta.id)
    .maybeSingle();
  const stored: Record<string, string> = existing?.config || {};
  const val = (key: string) => (submitted[key] ?? '').trim() || (stored[key] ?? '').trim();

  if (meta.id === 'notion') {
    const token = val('token');
    if (!token) throw new AppError('Enter your Notion integration secret first', 400);
    const res = await httpJson('POST', 'https://api.notion.com/v1/search', {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION },
      body: { filter: { property: 'object', value: 'database' }, page_size: 100 },
    });
    if (res.status !== 200) {
      throw new AppError(`Notion: ${res.json?.message || `error ${res.status}`}`, 400);
    }
    return {
      notion_databases: (res.json?.results || []).map((d: any) => ({
        id: String(d.id || '').replace(/-/g, ''),
        name: (d.title || []).map((t: any) => t?.plain_text || '').join('') || 'Untitled database',
      })),
    };
  }

  if (meta.id === 'airtable') {
    const token = val('token');
    if (!token) throw new AppError('Enter your Airtable personal access token first', 400);
    const auth = { Authorization: `Bearer ${token}` };
    const basesRes = await httpJson('GET', 'https://api.airtable.com/v0/meta/bases', { headers: auth });
    if (basesRes.status !== 200) {
      throw new AppError(`Airtable: ${basesRes.json?.error?.message || `error ${basesRes.status}`}`, 400);
    }
    const out: IntegrationResourcesResult = {
      airtable_bases: (basesRes.json?.bases || []).map((b: any) => ({ id: b.id, name: b.name })),
    };
    const baseId = val('base_id');
    if (baseId) {
      const tablesRes = await httpJson('GET', `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(baseId)}/tables`, { headers: auth });
      if (tablesRes.status === 200) {
        out.airtable_tables = (tablesRes.json?.tables || []).map((t: any) => ({ id: t.name, name: t.name }));
      }
    }
    return out;
  }

  throw new AppError('This provider has no pickable resources', 400);
}

// ============================================
// Event dispatch (called from webhook.service.fireEvent)
// ============================================

/**
 * Freshen short-lived OAuth credentials before use. Currently only HubSpot
 * OAuth tokens expire; manual credentials pass through untouched.
 */
async function prepareConfig(
  providerId: string,
  integrationId: string,
  config: Record<string, string>
): Promise<Record<string, string>> {
  if (providerId === 'hubspot') {
    return ensureFreshHubspotToken(integrationId, config);
  }
  return config;
}

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

  // One context lookup shared by every integration receiving this event.
  const ctx = await buildEventContext(userId, data);

  await Promise.allSettled(
    rows.map(async (row) => {
      const runtime = RUNTIMES[row.provider as IntegrationProviderId];
      if (!runtime) return;
      try {
        const config = await prepareConfig(row.provider, row.id, row.config || {});
        const summary = await runtime.handleEvent(userId, config, eventType, data, ctx);
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

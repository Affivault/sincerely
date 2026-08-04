import { WebhookEventType } from './enums.js';
import type { IntegrationProviderMeta } from './integration.types.js';

/**
 * Static catalog of every integration Sincerely supports. Shared between the
 * client (renders the cards, setup guides, and config forms from this) and the
 * server (validates that submitted configs/events match the provider's shape).
 *
 * Every provider here works with a credential the user can create themselves
 * in a couple of minutes — no OAuth app registration required.
 */

const E = WebhookEventType;

/** Events that make sense as human-readable notifications. */
const NOTIFY_EVENTS: string[] = [
  E.EmailSent,
  E.EmailOpened,
  E.EmailClicked,
  E.EmailReplied,
  E.EmailBounced,
  E.CampaignLaunched,
  E.CampaignPaused,
  E.CampaignCompleted,
  E.LeadUnsubscribed,
  E.SaraIntentClassified,
  E.ContactCreated,
];

/** High-signal defaults — replies and campaign lifecycle, not every open. */
const NOTIFY_DEFAULTS: string[] = [
  E.EmailReplied,
  E.EmailBounced,
  E.CampaignLaunched,
  E.CampaignCompleted,
  E.SaraIntentClassified,
];

/** Events a CRM sync can act on (they carry a contact_id). */
const CRM_EVENTS: string[] = [E.EmailReplied, E.SaraIntentClassified];

export const INTEGRATION_CATALOG: IntegrationProviderMeta[] = [
  {
    id: 'slack',
    name: 'Slack',
    kind: 'notification',
    description:
      'Get replies, bounces, and campaign milestones posted to a Slack channel the moment they happen.',
    setupSteps: [
      'Open api.slack.com/messaging/webhooks and click “Create your Slack app”.',
      'Create the app in your workspace, then enable “Incoming Webhooks”.',
      'Click “Add New Webhook to Workspace” and pick the channel to post to.',
      'Copy the webhook URL (starts with https://hooks.slack.com/services/…) and paste it below.',
    ],
    docsUrl: 'https://api.slack.com/messaging/webhooks',
    fields: [
      {
        key: 'webhook_url',
        label: 'Incoming webhook URL',
        placeholder: 'https://hooks.slack.com/services/T000/B000/XXXX',
        secret: true,
        help: 'Found under your Slack app → Incoming Webhooks.',
      },
    ],
    supportedEvents: NOTIFY_EVENTS,
    defaultEvents: NOTIFY_DEFAULTS,
  },
  {
    id: 'discord',
    name: 'Discord',
    kind: 'notification',
    description:
      'Send campaign activity straight into a Discord channel via a channel webhook.',
    setupSteps: [
      'In Discord, open the channel’s settings (gear icon) → Integrations → Webhooks.',
      'Click “New Webhook”, name it (e.g. “Sincerely”), and pick the channel.',
      'Click “Copy Webhook URL” and paste it below.',
    ],
    docsUrl: 'https://support.discord.com/hc/en-us/articles/228383668',
    fields: [
      {
        key: 'webhook_url',
        label: 'Channel webhook URL',
        placeholder: 'https://discord.com/api/webhooks/…',
        secret: true,
      },
    ],
    supportedEvents: NOTIFY_EVENTS,
    defaultEvents: NOTIFY_DEFAULTS,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    kind: 'notification',
    description:
      'A Telegram bot messages you (or a group) whenever something important happens in your campaigns.',
    setupSteps: [
      'Message @BotFather on Telegram, send /newbot, and follow the prompts.',
      'Copy the bot token BotFather gives you (looks like 123456:ABC-DEF…).',
      'Start a chat with your new bot (press Start) — or add it to a group.',
      'Get your chat ID: message @userinfobot, or add the bot to a group and use the group ID.',
    ],
    docsUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
    fields: [
      {
        key: 'bot_token',
        label: 'Bot token',
        placeholder: '123456789:AAF-abc123…',
        secret: true,
        help: 'From @BotFather after /newbot.',
      },
      {
        key: 'chat_id',
        label: 'Chat ID',
        placeholder: '123456789 or @channelname',
        secret: false,
        help: 'Your user ID, a group ID (negative number), or a public @channel.',
      },
    ],
    supportedEvents: NOTIFY_EVENTS,
    defaultEvents: NOTIFY_DEFAULTS,
  },
  {
    id: 'zapier',
    name: 'Zapier',
    kind: 'automation',
    description:
      'Pipe Sincerely events into 6,000+ apps — Google Sheets, Salesforce, Airtable, anything Zapier connects to.',
    setupSteps: [
      'In Zapier, create a new Zap and choose “Webhooks by Zapier” as the trigger.',
      'Pick the “Catch Hook” trigger event and continue.',
      'Copy the custom webhook URL Zapier shows you and paste it below.',
      'Connect here, then click “Send test” so Zapier catches a sample payload to map fields from.',
    ],
    docsUrl: 'https://zapier.com/apps/webhook/integrations',
    fields: [
      {
        key: 'webhook_url',
        label: 'Catch-hook URL',
        placeholder: 'https://hooks.zapier.com/hooks/catch/…',
        secret: true,
      },
    ],
    supportedEvents: NOTIFY_EVENTS,
    defaultEvents: NOTIFY_EVENTS,
  },
  {
    id: 'make',
    name: 'Make',
    kind: 'automation',
    description:
      'Trigger Make (formerly Integromat) scenarios from Sincerely events and automate anything downstream.',
    setupSteps: [
      'In Make, create a new scenario and add the “Webhooks → Custom webhook” module.',
      'Click “Add” to create a new webhook and copy its URL.',
      'Paste the URL below, connect, then click “Send test” while the Make scenario is listening — Make uses it to learn the payload structure.',
    ],
    docsUrl: 'https://www.make.com/en/help/tools/webhooks',
    fields: [
      {
        key: 'webhook_url',
        label: 'Custom webhook URL',
        placeholder: 'https://hook.eu1.make.com/…',
        secret: true,
      },
    ],
    supportedEvents: NOTIFY_EVENTS,
    defaultEvents: NOTIFY_EVENTS,
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    kind: 'crm',
    description:
      'Automatically syncs contacts into HubSpot the moment they reply or SARA flags them as interested.',
    setupSteps: [
      'In HubSpot go to Settings → Integrations → Private Apps and click “Create a private app”.',
      'Name it (e.g. “Sincerely”), then under Scopes enable crm.objects.contacts.read and crm.objects.contacts.write.',
      'Create the app and copy the access token (starts with pat-).',
      'Paste the token below — Sincerely verifies it live before saving.',
    ],
    docsUrl: 'https://developers.hubspot.com/docs/api/private-apps',
    fields: [
      {
        key: 'access_token',
        label: 'Private app access token',
        placeholder: 'pat-na1-…',
        secret: true,
        help: 'Needs crm.objects.contacts read + write scopes.',
      },
    ],
    supportedEvents: CRM_EVENTS,
    defaultEvents: CRM_EVENTS,
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    kind: 'crm',
    description:
      'Creates or updates a Pipedrive person and attaches a note whenever a lead replies to your outreach.',
    setupSteps: [
      'In Pipedrive click your avatar → Personal preferences → API.',
      'Copy your personal API token.',
      'Paste it below — Sincerely verifies it against your account before saving.',
    ],
    docsUrl: 'https://pipedrive.readme.io/docs/how-to-find-the-api-token',
    fields: [
      {
        key: 'api_token',
        label: 'API token',
        placeholder: 'f23a…',
        secret: true,
      },
    ],
    supportedEvents: CRM_EVENTS,
    defaultEvents: CRM_EVENTS,
  },
];

export function getIntegrationMeta(id: string): IntegrationProviderMeta | undefined {
  return INTEGRATION_CATALOG.find((p) => p.id === id);
}

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
    id: 'teams',
    name: 'Microsoft Teams',
    kind: 'notification',
    description:
      'Post campaign activity into a Teams channel through a Workflows webhook — no bot install needed.',
    setupSteps: [
      'In Teams, open the channel → ⋯ menu → Workflows.',
      'Pick the template “Post to a channel when a webhook request is received” and add it.',
      'Copy the HTTP URL the workflow gives you and paste it below.',
      'Legacy “Incoming Webhook” connector URLs (…webhook.office.com) work too.',
    ],
    docsUrl: 'https://support.microsoft.com/en-us/office/browse-and-add-workflows-in-microsoft-teams-4998095c-8b72-4b0e-984c-f2ad39e6ba9a',
    fields: [
      {
        key: 'webhook_url',
        label: 'Workflow webhook URL',
        placeholder: 'https://prod-xx.westus.logic.azure.com/workflows/…',
        secret: true,
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
    id: 'n8n',
    name: 'n8n',
    kind: 'automation',
    description:
      'Trigger self-hosted or cloud n8n workflows with the full event payload — build any automation you can imagine.',
    setupSteps: [
      'In n8n, add a “Webhook” trigger node to your workflow (method: POST).',
      'Copy the production webhook URL (switch off test mode first).',
      'The URL must be publicly reachable — localhost and private-network addresses are rejected.',
      'Paste it below, then click “Send test” to deliver a sample payload.',
    ],
    docsUrl: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/',
    fields: [
      {
        key: 'webhook_url',
        label: 'Webhook URL',
        placeholder: 'https://your-n8n.example.com/webhook/…',
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
  {
    id: 'notion',
    name: 'Notion',
    kind: 'crm',
    description:
      'Logs every reply and interested lead as a new page in a Notion database — your lightweight CRM inside Notion.',
    setupSteps: [
      'Go to notion.so/my-integrations and create a new internal integration; copy its secret (starts with ntn_ or secret_).',
      'Open the Notion database you want leads in → ⋯ menu → Connections → add your integration.',
      'Copy the database ID: the 32-character string in the database URL, between the last / and the ?.',
      'Paste both below — Sincerely verifies it can see the database before saving.',
    ],
    docsUrl: 'https://developers.notion.com/docs/create-a-notion-integration',
    fields: [
      {
        key: 'token',
        label: 'Integration secret',
        placeholder: 'ntn_… or secret_…',
        secret: true,
      },
      {
        key: 'database_id',
        label: 'Database ID',
        placeholder: '32-character ID from the database URL',
        secret: false,
        help: 'Remember to share the database with your integration via Connections.',
      },
    ],
    supportedEvents: CRM_EVENTS,
    defaultEvents: CRM_EVENTS,
  },
  {
    id: 'airtable',
    name: 'Airtable',
    kind: 'crm',
    description:
      'Appends a record to an Airtable table whenever a lead replies or is flagged interested — with contact details filled in.',
    setupSteps: [
      'Go to airtable.com/create/tokens and create a personal access token with scopes data.records:write and schema.bases:read, granting access to your base.',
      'In your base, use (or create) a table with an “Email” field. Optional extra fields Sincerely will also fill: Name, Company, Event, Notes.',
      'Find your base ID (starts with app…) in the base URL, e.g. airtable.com/appXXXX/…',
      'Paste the token, base ID, and table name below — Sincerely checks the table and its fields before saving.',
    ],
    docsUrl: 'https://airtable.com/developers/web/guides/personal-access-tokens',
    fields: [
      {
        key: 'token',
        label: 'Personal access token',
        placeholder: 'pat….…',
        secret: true,
        help: 'Needs data.records:write and schema.bases:read on the base.',
      },
      {
        key: 'base_id',
        label: 'Base ID',
        placeholder: 'appXXXXXXXXXXXXXX',
        secret: false,
      },
      {
        key: 'table_name',
        label: 'Table name',
        placeholder: 'Leads',
        secret: false,
      },
    ],
    supportedEvents: CRM_EVENTS,
    defaultEvents: CRM_EVENTS,
  },
];

export function getIntegrationMeta(id: string): IntegrationProviderMeta | undefined {
  return INTEGRATION_CATALOG.find((p) => p.id === id);
}

# One-click OAuth setup for Integrations

Each provider's "Connect with …" button lights up automatically once its app
credentials are set in the **server** environment. Without them, that provider
simply keeps offering manual setup — nothing breaks.

Register each app **once** as the platform operator; after that, every
Sincerely user gets one-click connect with zero keys to copy.

Your callback URLs are built from `API_BASE_URL`. With
`API_BASE_URL=https://api.yourdomain.com` they are:

```
https://api.yourdomain.com/api/oauth/integrations/slack/callback
https://api.yourdomain.com/api/oauth/integrations/discord/callback
https://api.yourdomain.com/api/oauth/integrations/hubspot/callback
https://api.yourdomain.com/api/oauth/integrations/notion/callback
```

---

## Slack (~5 min)

1. Go to https://api.slack.com/apps → **Create New App** → *From scratch*.
   Name: `Sincerely`, pick your workspace (any — the app can be installed to
   any workspace later).
2. **OAuth & Permissions** → *Redirect URLs* → add your Slack callback URL
   from above → Save.
3. Same page, *Scopes → Bot Token Scopes*: add `incoming-webhook`.
4. **Basic Information** → copy **Client ID** and **Client Secret**.
5. To let ANY Slack workspace connect (not just yours): **Manage Distribution**
   → *Activate Public Distribution*.

```
SLACK_CLIENT_ID=…
SLACK_CLIENT_SECRET=…
```

When a user clicks Connect, Slack itself shows the channel picker — the
granted webhook lands scoped to exactly that channel.

## Discord (~3 min)

1. https://discord.com/developers/applications → **New Application** → name it
   `Sincerely`.
2. **OAuth2** → add your Discord callback URL under *Redirects* → Save.
3. Copy **Client ID** and **Client Secret** from the same page.

```
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

Discord shows a server + channel picker on its consent screen
(`webhook.incoming` scope); the granted webhook is stored automatically.

## HubSpot (~5 min)

1. You need a (free) developer account: https://developers.hubspot.com →
   create a **developer account**, then **Create app**. Name: `Sincerely`.
2. **Auth** tab → add your HubSpot callback URL under *Redirect URLs*.
3. Same tab, **Scopes** → add: `crm.objects.contacts.read`,
   `crm.objects.contacts.write`, `crm.objects.deals.read`,
   `crm.objects.deals.write`.
4. Copy **Client ID** and **Client secret**.

```
HUBSPOT_CLIENT_ID=…
HUBSPOT_CLIENT_SECRET=…
```

OAuth tokens expire every 30 minutes — the server refreshes them
automatically; users never notice.

## Notion (~4 min)

1. https://www.notion.so/my-integrations → **New integration** → change type
   to **Public**. Name: `Sincerely`.
2. Fill the required OAuth fields; set *Redirect URIs* to your Notion callback
   URL from above.
3. Copy the **OAuth client ID** and **OAuth client secret**.

```
NOTION_CLIENT_ID=…
NOTION_CLIENT_SECRET=…
```

Notion's consent screen lets the user share specific pages/databases; after
returning, Sincerely pops the database picker to finish (one dropdown, no IDs).

---

## Notes

- Set the env vars on the **server** deployment (Railway/Render), then
  restart. The buttons appear on the Integrations page immediately.
- Rotating a secret? Just update the env var — existing user connections
  keep working (their tokens are already stored); only new connects use the
  app credentials.
- Deliberately no OAuth for: Telegram (bot-token model), Teams (Workflows
  URL model), Zapier/Make/n8n (their webhooks ARE the integration),
  Airtable/Pipedrive (their token flow is already 2 minutes; can be added
  later the same way if wanted).

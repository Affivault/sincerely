# Sincerely for Zapier

The Sincerely app in Zapier, built on the public API (`/v1`). Nothing here talks to the database: every step is an ordinary API call with the person's API key, so the same rules apply as anywhere else.

## What it does

**Instant triggers.** Each one is a REST hook: turning a Zap on creates a webhook in Sincerely for that one event, and turning it off deletes it.

- Replies: New Interested Reply, New Reply, Reply Classified
- Contacts: New Contact, Updated Contact, Contact Unsubscribed
- Email: Email Opened, Link Clicked, Email Bounced, Email Sent
- Campaigns: Campaign Completed, Campaign Paused

Reply and email triggers can be limited to one campaign.

**Actions**

- Create or Update Contact
- Add Contact to Campaign: says whether the person was added, and if not, why
- Remove Contact from Campaign
- Add Contact to List
- Unsubscribe Contact
- Pause Campaign
- Resume Campaign

**Searches**

- Find Contact (paired with Create as "Find or Create Contact")
- Find Campaign

## Testing

```bash
npm ci && npm test
```

The tests validate the app against Zapier's schema and run every step against a mocked API. `server/scripts/public-api-check.mts` also drives this app against the real server.

## Deploying

The **Deploy the Zapier app** workflow pushes this folder to Zapier on every merge to `main` that changes it. It needs these settings under GitHub > Settings > Secrets and variables > Actions:

- `ZAPIER_DEPLOY_KEY` (secret): from developer.zapier.com > Settings > Deploy Keys.
- `ZAPIER_APP_ID` (variable): the number in the integration's address on developer.zapier.com.
- `SINCERELY_API_URL` (variable, optional): only needed if the API is not at `https://skysend-api.onrender.com`.

Raise `version` in `package.json` for a release; pushing the same version again updates it while it is private.

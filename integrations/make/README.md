# Sincerely for Make

The Sincerely app in Make, built on the public API (`/v1`). Each module is an ordinary API call with the person's API key, so the same rules apply as anywhere else.

## What it does

**Instant triggers.** Each one is a dedicated webhook: turning a scenario on creates a webhook in Sincerely for that one event, and deleting it removes it.

- Replies: interested replies, replies, classified replies
- Contacts: new contacts, updated contacts, unsubscribes
- Email: opens, link clicks, bounces, sent emails
- Campaigns: completed campaigns, paused campaigns

**Actions**

- Create or Update a Contact
- Add a Contact to a Campaign: the output says added, skipped or not found, and why, in words
- Remove a Contact from a Campaign (by email)
- Add a Contact to a List
- Unsubscribe an Email Address: works whether or not the address is a contact yet
- Pause a Campaign
- Resume a Campaign

**Searches:** Search Contacts, Search Replies and Search Campaigns. Each pages through every result, up to the limit you set.

**Make an API Call** reaches any endpoint with the same connection.

## Layout

- `app/definition.js`: every section (base, connection, webhooks, RPCs, modules, groups) as data.
- `deploy.js`: uploads it through Make's SDK API, using the same calls Make's own Apps Editor makes. Components are found again by name, so every run updates in place.
- `vendor/make-schemas`: Make's IML JSON schemas (MIT), which the tests validate every section against.

## Testing

```bash
npm ci && npm test
```

Run `npm run build:shared` at the repo root first, so the tests can also check that every endpoint the app calls exists in the public API.

## Deploying

The **Deploy the Make app** workflow uploads on every merge to `main` that changes the app. It needs these settings under GitHub > Settings > Secrets and variables > Actions:

- `MAKE_API_TOKEN` (secret): a Make API token with the `sdk-apps` scopes.
- `MAKE_ZONE` (variable): the start of your Make address, for example `eu1.make.com`.
- `MAKE_APP_ID` (variable): the custom app's name in Make, for example `sincerely-a1b2c3`.
- `SINCERELY_API_URL` (variable, optional): only needed if the API is not at `https://skysend-api.onrender.com`.

`node deploy.js --dry-run` shows what would change without writing anything.

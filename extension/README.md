# Sincerely — Chrome extension

Add and remove people from Sincerely campaigns without leaving the page you're
on. Works on LinkedIn profiles, Gmail threads, and any page with an email
address on it.

There is **no build step and no Google account needed** to run this. It's plain
ES modules loaded straight from this folder.

---

## Install it (2 minutes)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `extension/` folder.
4. The options page opens automatically on first install. If it doesn't, click
   the extension icon → **Settings**.

Chrome will show a "Disable developer mode extensions" balloon on startup.
Dismiss it — it's expected for unpacked extensions and harmless.

Works the same in Edge, Brave, and other Chromium browsers.

The extension ID is derived from this folder's path, so it changes if you move
the clone. Nothing here depends on a fixed ID, so that's harmless — a `key` in
the manifest would pin it, but it also has to be removed before a Web Store
upload, so it's deliberately left out.

## Connect it

**Mint an API key.** In the Sincerely web app, go to **Developer → API keys** →
**Create Key**. It needs both `read` and `write` scopes (the default). The raw
key is shown **once** and stored hashed, so copy it there and then.

**Point the extension at your API.** On the options page:

| Environment | API URL |
| --- | --- |
| Production | `https://api.usesincerely.com` |
| Local dev | `http://localhost:3001` |

Paste the host — `/api/v1` is appended automatically. There are one-click
buttons for both. Then paste the key and hit **Save & test connection**.

The test tells you which of the three setup failures you've hit, if any:

- **Can't reach the URL** — wrong host, or the local server isn't running.
- **Key rejected (401)** — revoked, expired, or mistyped.
- **Read-only key** — connects fine but add/remove will fail. Create a key with
  the `write` scope too.

### "Invalid or expired API key"

Almost always the key itself. The extension checks the shape before sending, so
it can tell you which:

- **"still masked"** — you copied the on-screen `sk_live_1234abcd••••••••`
  rather than using the copy button beside it. Copy it again with the button.
- **"looks truncated"** — a partial copy. A full key is exactly 72 characters:
  `sk_live_` plus 64 hex.
- **Rejected by the server** — the message names the prefix being sent. Compare
  it with the list on your Developer page. If it isn't there or shows Revoked,
  make a new one. If it is there and active, check the API URL points at the
  same environment the key was created in.

### If your API is on a free hosting tier

Free tiers (Render, Fly, and similar) spin the server down after a few minutes
idle and cold-start it on the next request, which routinely takes 50–60 seconds.
The extension handles this: the connection test waits up to 75s, and ordinary
requests that time out at 20s are retried once with the longer budget. So the
first action after a quiet spell may take up to a minute, and everything after
it is fast.

If it still times out after the long wait, the server is suspended rather than
asleep. Open `<your-api-host>/health` in a browser tab and leave it — if that
never loads either, the problem is the deployment, not the extension.

For a self-hosted API on some other domain, Chrome will ask for permission to
talk to that origin when you save. Accept it, or requests will be blocked.

## Use it

**From the popup** (extension icon, or `Alt+Shift+S`) — works on any page, and
is where you scan a website or type someone in by hand:

- The person on the current page is detected and pre-filled. Every field is
  editable, so you can correct a bad scrape or type someone in by hand.
- **Where they stand** lists every campaign they're already enrolled in, with
  their status and step, each with its own **Remove** button.
- Pick a campaign and **Add to campaign**. A successful add offers **Undo**.
- **Never contact again** suppresses the address account-wide and pulls them out
  of every campaign still running. Two clicks, deliberately.

**On any website** — open the popup and the addresses on that page are already
listed, no permission prompt and no waiting. Tick the ones you want and add
them. Press **Scan site** to go further and read the site's own contact, about
and team pages too. This costs nothing to run: enrichment vendors charge because they
licence a people database, but a company's `/contact` page is public HTML, so the
only cost is a handful of requests the extension makes itself. No credits, no
server.

It handles the obfuscations real sites use, which is where most free scrapers
give up: Cloudflare's `data-cfemail` protection, `&#64;` entities,
`name (at) example (dot) com`, and zero-width padding. It also attributes names
— from `first.last@` where the address carries one, otherwise from the text
beside it on a team page — so contacts arrive with something for your merge tags
rather than a bare address.

Results are ranked: named people first, shared inboxes (`info@`, `sales@`) next,
role accounts (`no-reply@`, `press@`) last but never discarded — sometimes the
shared inbox *is* the way in. Anything you already hold is labelled, so a scan
doubles as a gap analysis, and **New only** ticks just the ones you're missing.

The scan asks Chrome for permission to read that one site, at the moment you
press the button. The extension never holds blanket access to everything you
browse. It reads at most 14 pages, same-origin only, three at a time — it should
feel like a person clicking "Contact", not like a crawler.

> Addresses on a public site are still personal data. Under GDPR you need a
> lawful basis to email them, and B2B cold outreach rules vary by country. This
> reads what's published; deciding who to contact is yours.

**On a page with several people** — a team page, a directory, a thread with
multiple participants — the popup offers **Add all N addresses on this page**.
It's two-click, like suppression: the first click lists exactly who is about to
be enrolled and where, the second does it. Capped at 25 per action.

**On LinkedIn search results and a company's People tab** — every row gets a
checkbox and a bar appears at the bottom with **Select all**, **Net new**, a
campaign picker and the count.

**Net new** is where this differs from Apollo. Theirs means "not already in my
database". Ours means **not already being emailed** — it excludes anyone in an
active campaign or on the suppression list, not merely anyone missing from your
contacts. A duplicate contact record is untidy; a second sequence landing on
someone mid-conversation is what loses the reply.

Rows carry no address, so anyone you don't already hold needs a Prospector
reveal. A credit is only ever spent on someone you explicitly ticked, and the
bar reports what it added, how many it revealed, how many had no address on
record, and what your balance is afterwards. Matching by name and company is
fuzzy, which is exactly why Net new produces a *selection you can see and
correct* rather than an automatic send.

**From the right-click menu** — select an email address (or right-click a
`mailto:` link) → **Sincerely** → *Add to "<campaign>"*. The menu lists your
last-used campaign first, then up to ten others. Results come back as a
notification. Open the popup once after installing to populate the list.

**From the panel on a LinkedIn profile** — this is the main surface, and it
opens by itself. It shows who the profile is, one line of what's already
happened with them (suppressed, replied, engagement, or which campaigns they're
in), the address or the way to get one, and the campaign picker. Collapse it
with the × and it stays collapsed until you reopen it.

### On LinkedIn, there's usually no email

LinkedIn almost never exposes addresses, so the extension offers two ways
forward when it can't find one:

- **Find their email** searches the Prospector database using the profile URL
  first and name + company as a fallback, then shows you the match, how
  confident it is, and what a reveal costs *before* spending anything. Revealing
  costs one credit and is refunded automatically when no address is found;
  someone you've already revealed is free. If no data provider is configured on
  the account the API returns 503 and the extension says so plainly.
- **Search my contacts** finds someone you already have by name — which is what
  makes *removal* work on LinkedIn, where there's no address to look up.

A match on the profile URL is proof. A match on name and company is a guess, and
the extension labels it as one, because a wrong guess still costs a credit.

## Add vs. remove vs. suppress

This trips people up, so it's worth being precise:

| Action | What it does | Sticks? |
| --- | --- | --- |
| **Add** | Puts them on the campaign's lead list and enrols them, creating the contact if needed | — |
| **Remove** | Deletes that one enrolment | **No** — they stay on the lead list, and a future import can re-enrol them |
| **Never contact again** | Suppresses the address account-wide *and* removes them from every active campaign | **Yes** |

If someone asks you to stop emailing them, use **Never contact again**. Remove
alone is not enough.

## When "Add" legitimately fails

These are the server's rules, not bugs. The extension shows the server's own
message verbatim:

- **"Already enrolled in other active campaigns with different lead lists"** — a
  contact can't be in two active campaigns bound to different lists. Remove them
  from the other one first, or bind both campaigns to the same list.
- **"This campaign has finished"** — `completed` and `cancelled` campaigns reject
  enrolment. They're listed in the picker as disabled so you can see why.
- **Rate limit (429)** — API keys default to 100 requests/minute. The message
  tells you how long to wait.

Re-adding someone who's already enrolled is safe: the server never resets an
in-flight contact's progress.

## Developing on it

Edit a file → `chrome://extensions` → click the **reload** arrow on the card.
Content script changes also need the host page refreshed, because the old script
stays injected until then.

There are **three separate consoles**, and an error in one is invisible from the
others:

| Surface | Where to look | What shows up there |
| --- | --- | --- |
| Service worker | `chrome://extensions` → card → **service worker** | All API calls and failures |
| Popup | Right-click the toolbar icon → **Inspect popup** | Picker and form errors |
| Content script | Page DevTools → console → switch **context** to this extension | Scraping and injection errors |

The **Network** tab inside the service worker's DevTools is the useful one — it
shows the real request and the server's JSON error body.

### Worth testing deliberately

The happy path is the easy part. These are the paths that actually break:

1. Add someone already in another active campaign on a different list → expect a
   clear 400, not a silent failure.
2. Pick a `completed` campaign → should be disabled in the picker.
3. Revoke the key in the app, then try to add → expect a 401 with an
   **Open settings** button.
4. Add the same person twice → second add reports "already enrolled", no
   progress reset.
5. Suppress someone in two running campaigns → both enrolments should disappear.

Point the extension at a `draft` campaign bound to a throwaway list while you're
testing. Add and remove write to real data.

## Architecture

```
manifest.json          MV3, no build step
service-worker.js      The only place the API key is read; all fetches happen here
lib/api.js             API client — auth, error normalising, domain calls
lib/storage.js         chrome.storage.local wrapper + URL normalising
lib/theme.css          Design system, ported from client/src/index.css
lib/theme.js           Light/dark/system resolution, mirroring ThemeContext
fonts/                 Inter + JetBrains Mono (bundled, never fetched)
content/scraper.js     Classic script: LinkedIn/Gmail/generic adapters, floating button
popup/                 Main UI
options/               Setup + connection test
```

### Design

`lib/theme.css` is a direct port of `client/src/index.css` — same token names,
same values, same control geometry (32px controls, 6px radii, Inter at 13.5px,
warm paper neutrals, `#5B5BF5` indigo). **`client/src/index.css` is the source
of truth: when a token changes there, change it here too.** The popup and
options stylesheets only do layout; every colour, border, and control style
comes from the shared file.

Dark mode works the way the app's does — a `.dark` class on `<html>`, resolved
from a `light | dark | system` preference (`lib/theme.js`, mirroring
`ThemeContext.tsx`). The extension can't read the app's `localStorage` across
origins, so it keeps its own copy of that choice; the picker is on the options
page.

Inter and JetBrains Mono are bundled as woff2 rather than loaded from Google
Fonts: an extension that fetches a remote font leaks a request from every page
it renders on and breaks offline.

The toolbar icon is generated from `client/public/favicon.png`, the platform's
own brand mark, so it's the same gradient "S" users see in the app. Both assets
are reproducible from `extension/tools/` when the brand or type changes:

```sh
node extension/tools/make-icons.mjs client/public/favicon.png extension/icons
node extension/tools/fetch-fonts.mjs extension/fonts
```

Two rules hold this together:

**The API key never leaves the service worker.** Content scripts share a world
with the page — a key there would be readable by any script on LinkedIn or
Gmail. The popup and content scripts send messages; the worker does the work.

**The key is in `chrome.storage.local`, never `storage.sync`.** Sync would
replicate the credential to every Chrome profile the user is signed into.

Site access is deliberately narrow: LinkedIn and Gmail are declared in the
manifest, and every other site is handled by injecting the scraper on demand
under `activeTab` — which is why using it on an arbitrary page needs no
all-sites permission.

## Publishing later

Unpacked is fine indefinitely. To hand it to other people:

| Path | Account | Cost | Review |
| --- | --- | --- | --- |
| Load unpacked | none | free | none |
| Web Store, **unlisted** | Chrome Web Store developer | $5 one-time | yes, private link |
| Web Store, public | same | same $5 | review + privacy policy + data disclosures |

The $5 is a one-time lifetime registration covering all your extensions.
Self-hosted `.crx` files are a dead end — Chrome blocks them outside enterprise
policy.

Because this handles personal data (email addresses), a public listing needs a
privacy policy URL and honest data-use declarations. Bump `version` in
`manifest.json` for each upload; the Web Store rejects a repeat version.

## API endpoints used

All under `/api/v1`, all with `Authorization: Bearer sk_live_…`:

| Purpose | Call |
| --- | --- |
| Campaign picker | `GET /campaigns` |
| Find a contact | `GET /contacts?search=` |
| Create a contact | `POST /contacts` |
| Where they stand | `GET /contacts/:id/campaigns` |
| Add to campaign | `POST /campaigns/:id/enroll` |
| Remove from campaign | `DELETE /campaigns/:id/contacts` |
| Suppress | `POST /suppression`, `GET /suppression/check` |
| Verify (optional) | `POST /verification/email` |
| Engagement | `GET /analytics/contacts/:id/timeline` |
| Source tag | `GET`/`POST /tags`, `POST /contacts/bulk-tag` |
| Find an email | `GET /prospecting/status`, `POST /prospecting/search`, `POST /prospecting/reveal` |

`POST /campaigns/:id/enroll` is used rather than `POST /campaigns/:id/contacts`
because campaigns are bound to a lead list: `/enroll` adds someone to that list
first and then enrols them, and returns `{added, skipped, total}` so the UI can
report what the server actually did.

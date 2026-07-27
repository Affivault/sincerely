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

For a self-hosted API on some other domain, Chrome will ask for permission to
talk to that origin when you save. Accept it, or requests will be blocked.

## Use it

**From the popup** (extension icon, or `Alt+Shift+S`) — the main surface:

- The person on the current page is detected and pre-filled. Every field is
  editable, so you can correct a bad scrape or type someone in by hand.
- **Where they stand** lists every campaign they're already enrolled in, with
  their status and step, each with its own **Remove** button.
- Pick a campaign and **Add to campaign**. A successful add offers **Undo**.
- **Never contact again** suppresses the address account-wide and pulls them out
  of every campaign still running. Two clicks, deliberately.

**From the right-click menu** — select an email address (or right-click a
`mailto:` link) → **Sincerely** → *Add to "<campaign>"*. The menu lists your
last-used campaign first, then up to ten others. Results come back as a
notification. Open the popup once after installing to populate the list.

**From the floating button** on LinkedIn and Gmail — appears only once you've
picked a campaign in the popup, and it names that campaign so a one-click add
is never ambiguous. The confirmation toast has an **Undo**.

### On LinkedIn, there's usually no email

LinkedIn almost never exposes addresses. The extension scrapes the name,
company, title, and profile URL, then offers **Search contacts by name** so you
can find someone you already have — which is what makes *removal* work there.
To go from a LinkedIn profile to a new contact you need an address from
somewhere else (paste it in, or use Prospector in the app).

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
content/scraper.js     Classic script: LinkedIn/Gmail/generic adapters, floating button
popup/                 Main UI
options/               Setup + connection test
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

`POST /campaigns/:id/enroll` is used rather than `POST /campaigns/:id/contacts`
because campaigns are bound to a lead list: `/enroll` adds someone to that list
first and then enrols them, and returns `{added, skipped, total}` so the UI can
report what the server actually did.

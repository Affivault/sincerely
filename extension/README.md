# Sincerely — Chrome extension

Add and remove people from Sincerely lead lists without leaving the page you're
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

### One click, nothing to copy

An API key isn't something you already have from somewhere else — it's a
password the extension uses to prove it's you, created inside your own Sincerely
account. So the extension creates it for you:

1. Open Sincerely in a tab and sign in.
2. Click the Sincerely icon in the Chrome toolbar.
3. Press **Connect using this tab**.

That's it. Works on whatever domain your app is deployed to, and needs no change
to the app itself.

**How it works.** Clicking the toolbar icon grants `activeTab` — access to that
one tab, on any origin, with no prompt and nothing in the manifest. The service
worker injects `mintKeyFromPage` into the page, which:

- reads the Supabase session from `localStorage` (`sb-*-auth-token`);
- works out the API's address, in this order: `window.__SINCERELY_API_URL`, a
  `<meta name="sincerely-api-url">` tag, any `/api/v<N>` URL in the page's own
  resource timeline (i.e. wherever it has actually been calling), the address
  already in the extension's settings, then `<origin>/api/v1` and
  `api.<domain>/api/v1`;
- `POST`s `/api-keys` with the session token, from the page — so the app mints
  the key itself, exactly as pressing a button in the UI would.

The session token is used for that one request and never stored. The API address
that gets saved is the one that answered, not a guess.

`POST /api-keys` is `jwtOnly` server-side, so an API key can never mint another
key — only a real session can.

**Why not do it from inside the app?** There is also a **Connect extension**
button on **Webhooks → API keys**, which relays a key via
`window.postMessage` (`content/connect.js`, same-window messages only, never an
iframe or another origin). It works, but a content script only runs on origins
the manifest names — declared here for `usesincerely.com`, any subdomain of it,
and `localhost:5173` — so it silently does nothing on a domain the build didn't
anticipate. The toolbar route has no such limit, which is why it's the primary
one. For any other app URL, set **Web app URL** on the options page and press
**Open Sincerely**: that asks Chrome for the origin and registers the relay at
runtime.

### Or paste a key by hand

**Mint an API key.** In the Sincerely web app, go to **Webhooks → API keys** →
**Create Key**. It needs both `read` and `write` scopes (the default). The raw
key is shown **once** and stored hashed, so use the **copy button** beside it
there and then — selecting the text copies the dots that mask it.

**Point the extension at your API.** On the options page, expand **Or paste a
key by hand**:

| Environment | API URL |
| --- | --- |
| Production | `https://skysend-api.onrender.com` |
| Local dev | `http://localhost:3001` |

Production must match the deployment's `VITE_API_URL`. It appears in three
places that have to agree: `DEFAULT_API_BASE` in `lib/storage.js`, the declared
list in `originPatternFor()`, and `host_permissions` in the manifest. Miss the
last two and the extension asks Chrome for access it was never granted.

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
  it with the list on **Webhooks → API keys**. If it isn't there or shows
  Revoked, make a new one. If it is there and active, check the API URL points
  at the same environment the key was created in.

All three go away if you use **Connect extension** instead of pasting.

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
- **Where they stand** lists every lead list they're already on, each with its
  own **Remove** button.
- Pick a lead list and **Add to list**. A successful add offers **Undo**.
- **Never contact again** suppresses the address account-wide and takes them off
  every lead list. Two clicks, deliberately.

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
list picker and the count.

**Net new** is where this differs from Apollo. Theirs means "not already in my
database". Ours means **not already being emailed** — it excludes anyone in an
lead list or on the suppression list, not merely anyone missing from your
contacts. A duplicate contact record is untidy; a second sequence landing on
someone mid-conversation is what loses the reply.

Rows carry no address, so anyone you don't already hold needs a Prospector
reveal. A credit is only ever spent on someone you explicitly ticked, and the
bar reports what it added, how many it revealed, how many had no address on
record, and what your balance is afterwards. Matching by name and company is
fuzzy, which is exactly why Net new produces a *selection you can see and
correct* rather than an automatic send.

**From the right-click menu** — select an email address (or right-click a
`mailto:` link) → **Sincerely** → *Add to "<list>"*. The menu lists your
last-used lead list first, then up to ten others. Results come back as a
notification. Open the popup once after installing to populate the list.

**From the panel on a LinkedIn profile** — this is the main surface, and it
opens by itself. It shows who the profile is, one line of what's already
happened with them (suppressed, replied, engagement, or which lead lists
they're on), the address or the way to get one, and the list picker. Collapse it
with the × and it stays collapsed until you reopen it.

### On LinkedIn, the address is read without opening Contact info

A profile's email lives inside the **Contact info** dialog, so it is genuinely
not in the page until that dialog is opened. Waiting for the user to click it was
not acceptable: on a profile where the address *is* available, the extension
appeared to find nothing.

So the extension asks for it itself. Five layers, and the first one is the only
one that depends on nothing LinkedIn can rename:

0. **LinkedIn's own network traffic.** `content/net-tap.js` runs in the page's
   world at `document_start` and patches `fetch` and `XMLHttpRequest` before
   LinkedIn's code runs, reading whatever LinkedIn itself receives. If the
   address is in any response the page gets — the profile payload, the
   contact-info fetch, anything — it is seen, with no element to find, no dialog
   to open and nothing to click.

   This exists because every other layer below depends on LinkedIn's markup or
   its endpoint paths, and all of them broke, repeatedly, on profiles that
   plainly had an address. It runs in the MAIN world because a content script's
   isolated world has its own `fetch` that LinkedIn never calls; findings cross
   back by same-window `postMessage`. It observes responses the user's session is
   already receiving, passes on nothing but addresses, and is cleared on every
   navigation so one profile's address can never be offered as another's.

The rest, in order:

0. **LinkedIn's own embedded payloads.** It is an Ember app that ships its API
   responses inside the document, in `<code id="bpr-guid-…">` elements holding
   JSON. Free, instant, invisible, and independent of every class name — so it
   goes first, and it is the layer most likely to survive a LinkedIn reskin.
1. `/voyager/api/identity/profiles/<slug>/profileContactInfo` — a legacy REST
   endpoint. LinkedIn has moved this behind GraphQL with rotating query ids, so
   on most accounts it now answers 404. Kept because it costs one parallel
   request, but nothing depends on it.
2. `/in/<slug>/overlay/contact-info/` fetched and scanned. Also weak: LinkedIn
   is a single-page app, so this returns the shell rather than rendered contact
   info on most sessions.
3. **The Contact info overlay**, opened and read.

**0, 1 and 2 run first, and in parallel.** Both are plain same-origin fetches: the
user sees nothing, the page is untouched, and on most profiles one of them
answers in a few hundred milliseconds. Only when neither returns an address does
the extension fall through to driving the UI.

That ordering used to be the other way round, on the reasoning that the route
which can't drift should go first. It was the wrong trade. Opening the dialog
takes over the page somebody is reading — modal opens, LinkedIn locks body
scroll, focus moves — so leading with it meant *every* profile froze for a couple
of seconds, including the ones a quiet fetch would have answered instantly.
Running the two fetches in sequence also cost up to eight seconds between them;
in parallel they cost four at worst.

#### Fast and deep

The scrape has two speeds, and the split is what keeps the UI responsive:

- **Fast** (`SINCERELY_SCRAPE`) reads the DOM and returns within a tick. Name,
  title, company, anything already on the page. It awaits nothing. The popup
  opens on this, the in-page panel paints from this, and the toolbar badge uses
  **only** this — the badge runs on every tab update for somebody who hasn't
  asked for anything, so it must never make a profile do work.
- **Deep** (`SINCERELY_SCRAPE_DEEP`) additionally waits for the three layers
  above. It is only ever run from a surface that has already rendered, so the
  wait happens behind a visible UI rather than in front of a blank one.

A fast scrape reports `contact_info_pending: true` when a deep read could still
turn something up. That distinction matters: "no email on this profile" and
"still looking" are different answers, and showing the first while the second was
true is what made the extension look broken. Both the panel and the popup say
*Checking contact info…* instead, and fill the address in when it lands.

Once a deep read has settled, its result is readable synchronously, so later
fast scrapes report the address immediately without re-opening anything.

While the extension is driving the dialog it also overrides LinkedIn's body
scroll lock, restoring it afterwards. Hiding the modal but leaving the lock in
place is worse than doing nothing: the page looks normal and simply refuses to
move.

#### Opening the overlay without a button to click

This was the bug that kept coming back: the extension found nothing unless the
user opened Contact info themselves and left it on screen.

The cause was that opening it depended entirely on locating one specific anchor.
When that anchor was absent — a layout variant, a profile that renders the link
differently — there was no way in at all, and the extension reported "no email"
for somebody who plainly had one. Layers 1 and 2 above were supposed to be the
safety net and are both weak in production, so in practice there was exactly one
route and it was the fragile one.

**LinkedIn's router opens that overlay in response to the URL.** Pushing the
overlay path and firing a `popstate` makes LinkedIn open its own dialog, with
its own data fetch, using a route it already owns. No element has to exist,
nothing gets clicked, and there is no text to match — so it cannot click the
wrong control, which was the failure in the other direction.

Two consequences worth knowing:

- The address bar changes while this runs. The panel's and the bulk bar's SPA
  watchers skip URL changes while `isOverlayBusy()`, or they would treat it as
  the user navigating and tear themselves down mid-read.
- Restoring the URL happens in a `finally`, and only steps back **while still
  parked on the overlay URL**. Guarding on "did we push it" instead is not
  enough: LinkedIn's own dismiss handler also calls `history.back()`, and two
  backs take the user off the profile entirely.

**When it does click, it only ever clicks one element: an anchor or button
identified structurally — by href, or by an id LinkedIn assigns to this one
link.** An earlier version also matched any button in `main`
whose text read "Contact info", which on a real profile hits the wrong control —
LinkedIn's buttons carry nested visually-hidden text, the label is translated on
non-English accounts, and a near-miss means clicking Message or Connect on
somebody's profile. Clicking the wrong thing on a page the user is only looking
at is far worse than finding no address, so it is that one anchor or nothing.
The slug in the href must match the current profile, which rules out the
contact-info links belonging to "People also viewed".

Everything else fails closed too:

- Dialogs open **before** the click are the page's own business — never read,
  never dismissed. Only one that appears afterwards counts.
- That dialog is checked to actually be contact info (a `pv-contact-info`
  element, a `mailto:` link, or a matching heading) before anything is read from
  it. If something else opened, it is closed again and nothing is taken.
- Dismissal is scoped to that dialog. An earlier version fell back to
  `document.querySelector('button[aria-label*="Dismiss"]')`, which could close
  an unrelated LinkedIn dialog.
- The result — including failure — is cached per profile as an in-flight
  promise, so the panel, the popup and the DOM watcher share one run. Without
  that they each open the dialog, and the watcher reacts to the mutations the
  dialog itself causes, which is a loop.
- **Preferences → "Read LinkedIn's Contact info without clicking"** turns it off.
  The API routes still run; they are just less likely to find anything.

Restoring the page is more delicate than it looks. `history.back()` is
asynchronous, so checking the URL immediately after dismissing and "helpfully"
going back again lands the user one entry further back than they ever were —
off the profile entirely. The code waits for the URL to settle before deciding.
Addresses are read from text nodes individually rather than the dialog's whole
`textContent`, because adjacent elements concatenate: a dismiss button labelled
"x" beside the address yields `xjane.doe@acme.com`, a plausible address that
does not exist.

The DOM mutation watcher stays as a last resort for the cases a fetch can't
cover — signed-out sessions, and addresses that only ever appear in markup.

Two notes on this. LinkedIn's internal endpoints are undocumented and change
without warning, which is why there are three layers and why none of them is
load-bearing on its own. And scraping LinkedIn is against its terms of service
regardless of how it's done — the same is true of every extension in this
category, but it's your account that carries the risk, so it's worth knowing.

### Working out an address that was never published

Harvesting only returns what a page prints. Most people at a company are named
on a team page with no address beside them, and they're the ones worth reaching.

`POST /verification/find-email` takes a name and a domain and works out the
address, in descending order of what the answer is worth:

1. **The account's own contacts at that domain.** If `jane.doe@acme.com` is on
   file and her name is Jane Doe, the convention is `first.last` and every other
   guess at acme.com follows from it. Free, instant, and better than a heuristic.
2. **The mail server.** `RCPT TO` is the only way to *prove* a mailbox exists.
   Done strictly here, so ambiguity is never scored as a pass.
3. **Which conventions are common**, as a last resort, reported as a guess.

A random local part is probed first: a domain that accepts it accepts anything,
so no address there can be confirmed, and that's said rather than hidden.

### Outbound port 25, and why verification may not run

**Render blocks outbound connections on port 25, and there is no setting to
change it.** So do Heroku, Fly, Vercel and App Engine — it is how a platform
stops itself being used to send spam, not a misconfiguration on the account.
Nothing in this repo can open it.

That leaves three real options, and it's a business decision, not a technical
one:

| Option | What it costs | What you get |
| --- | --- | --- |
| Leave it | Nothing | Convention-based addresses at 45–70% confidence, honestly labelled. The pattern learned from your own contacts at a domain is the strongest signal, and it needs no network at all |
| A verification API (ZeroBounce, NeverBounce, Bouncer, …) | Per-address, typically $0.003–0.01 | Real mailbox verification, from a provider whose whole business is keeping port 25 open and their IPs trusted |
| Move the API to a VPS with port 25 open, or run a small probe service on one | A few dollars a month, plus IP reputation to manage | Verification in-house; the probing IP has to stay off blocklists or answers get worse over time |

The recommendation is a verification API if this matters commercially: running
your own prober well is a reputation-management job, not a coding one.

`smtp-reachability.service.ts` makes the current state visible and cheap rather
than pretending. Three failed connections in a row and it stops dialling for 15
minutes, so a batch of ten answers immediately instead of stalling 10s each. One
success clears it, so opening the port — or moving host — starts working without
a restart. `GET /verification/stats` reports it, and the Verification page shows
a banner when checks aren't running.

**This also fixed a real bug.** `verification.service.ts` treated an unreachable
mail server as "assumed valid" and awarded the SMTP layer full marks, so on
Render every address with an MX record scored **100/100** and the deliverability
score meant nothing. An unrun check now scores nothing and caps the total at 60.
Any score recorded before this was measured, not proven — re-verify anything
you're relying on.

**Every result carries a confidence and a reason, and the UI shows both.** 90+
means a mail server accepted the exact address. Under 60 is a convention guess.
The popup pre-ticks only confirmed addresses; a guess is the user's call.

Two places use it, both free — no credits, no provider:

- **Site scan** now returns `unlisted`: people the site names with no address.
  Each gets a **Find** button, or **Find all** which works through them two at a
  time (each lookup holds an SMTP conversation open, and a dozen at once is how
  a sender gets itself blocked).
- **The LinkedIn panel** offers a domain box and **Find**, prefilled from the
  profile's listed website. LinkedIn shows a company's *name* far more often
  than its domain, hence editable.

### The Prospector, when the domain gives nothing

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

## Lists, not campaigns

The extension adds people to **lead lists**. It has no campaign controls at all,
and that is deliberate.

A campaign is bound to one lead list and draws from it. Enrolling someone into a
campaign directly reached past the thing that actually owns membership, and
dragged in a rule that made a simple "add this person" fail in ways nobody could
predict from the page they were standing on: a contact could not be in two
active campaigns bound to different lists, so adding from LinkedIn would be
refused because of a campaign the user wasn't thinking about. Putting someone on
the list is what gets them emailed, and it always works.

Adding is an upsert server-side, so a repeat is a no-op rather than a duplicate
or an error — which is what makes re-running a scan safe. The extension checks
membership before adding so it can say "already on this list" rather than
claiming a second add.

## Add vs. remove vs. suppress

This trips people up, so it's worth being precise:

| Action | What it does | Sticks? |
| --- | --- | --- |
| **Add** | Puts them on a lead list, creating the contact if needed | — |
| **Remove** | Takes them off that one list | **No** — they stay in your contacts and on any other list |
| **Never contact again** | Suppresses the address account-wide *and* takes them off every lead list | **Yes** |

If someone asks you to stop emailing them, use **Never contact again**. Remove
alone is not enough.

## When "Add" legitimately fails

These are the server's rules, not bugs. The extension shows the server's own
message verbatim:

- **Rate limit (429)** — API keys default to 100 requests/minute. The message
  tells you how long to wait.
- **A read-only key** — adding needs the `write` scope. The options page's
  connection test says so explicitly rather than letting the first add fail.
- **No lead lists on the account** — create one in Sincerely first; the picker
  says so rather than showing an empty box.

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

### Running the tests

```bash
cd extension/tests
npm install
node run.mjs
```

Ten suites, driving the real unpacked extension in Chromium against a mock API.
Run them before opening a PR — they catch the wiring and timing faults that
reading a diff does not. See [tests/README.md](tests/README.md).

### Worth testing deliberately

The happy path is the easy part. These are the paths that actually break:

1. Add someone already on the chosen list → expect "already on this list", no
   duplicate row, and no error.
2. Connect with a read-only key → the connection test should say so, rather than
   the first add failing.
3. Revoke the key in the app, then try to add → expect a 401 with an
   **Open settings** button.
4. Add the same person twice → second add reports "already enrolled", no
   progress reset.
5. Suppress someone on two lead lists → they should come off both.
6. Open a LinkedIn profile → the panel and the popup must show the name and
   title *immediately*, before any address is known, and the page must stay
   scrollable throughout. If it stalls or freezes, the fast/deep split has been
   broken somewhere.

Point the extension at a throwaway lead list while you're testing. Add and
remove write to real data.

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
content/launcher.js    In-page button that opens the sidebar
content/list-select.js Row checkboxes + bulk bar on search results
content/connect.js     Runs on the app's own pages; relays a key on one-click connect
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

Matching the tokens is not the same as matching the product, and the gap showed.
The app's primary button is `--indigo-grad` with an inner white highlight and a
coloured drop shadow (see `client/src/components/ui/Button.tsx`); the extension
had a flat `--indigo` fill, which is most of why it read as a lookalike. The
gradient, the highlight, the focus ring with its offset, and the category
accents are all ported now, and the in-page panel — which can't share a
stylesheet, being in a shadow root — carries the same values inline.

Layout follows the app's own rhythm: content sits in cards on `--bg-app`, each
region carries an uppercase micro-label, and lists show the colour swatch the
app files them under, so a list is recognisable here by the mark you already
know it by.

Two things that were costing time rather than looks:

- **The primary action is pinned.** It used to sit inline, so on any page with
  scan results you scrolled past the picker to reach it. It now sits over a
  blurred edge at the foot of the popup, always in reach.
- **Loading is a skeleton, not a sentence.** Reading a LinkedIn profile means
  opening its Contact info dialog, which takes about a second — long enough that
  "Reading this page…" reads as a stall. The skeleton is the shape of what's
  coming, so nothing jumps when it lands.

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
| List picker | `GET /lists` |
| Find a contact | `GET /contacts?search=` |
| Create a contact | `POST /contacts` |
| Where they stand | `GET /lists/contact/:id` |
| Add to a list | `POST /lists/:id/contacts` |
| Remove from a list | `DELETE /lists/:id/contacts` |
| Who is on a list | `GET /lists/:id/contacts` |
| Suppress | `POST /suppression`, `GET /suppression/check` |
| Verify (optional) | `POST /verification/email` |
| Work out an unpublished address | `POST /verification/find-email` |
| Engagement | `GET /analytics/contacts/:id/timeline` |
| Source tag | `GET`/`POST /tags`, `POST /contacts/bulk-tag` |
| Find an email | `GET /prospecting/status`, `POST /prospecting/search`, `POST /prospecting/reveal` |

There is no campaign endpoint in that list, and that is the point — see
**Lists, not campaigns** above.

`GET /lists/:id/contacts` is fetched before a bulk add so the result can tell
"added" from "was already there": the server upserts, so its reply counts a
repeat as a success and cannot distinguish them. One request covers the whole
batch, rather than a membership lookup per person.


## LinkedIn agent

The extension also runs the LinkedIn steps of your Sincerely campaigns —
connection requests, messages and profile visits — in **your own browser**, in
**your own logged-in session**.

### Why an extension and not a server

LinkedIn has no API for connection requests or messages to people you aren't
connected to. The alternative is storing your LinkedIn session cookie on a
server and replaying it from a datacentre IP, which is what gets accounts
restricted and would mean handing your login to someone else.

Here, nothing about your LinkedIn session ever leaves this browser. The
extension asks Sincerely one question — "is there anything to do?" — and reports
back "done" or "failed". The only data it receives is a public profile URL and
the message you already wrote.

### What keeps it safe

- **Your session, your IP.** The same browser you use LinkedIn in anyway.
- **Conservative ceilings.** 15 invites a day by default; LinkedIn starts
  restricting accounts somewhere around 100 invites a week.
- **Random gaps.** 45–180 seconds between actions, never a fixed interval.
- **Working hours only.** Weekdays 9–5 in your timezone by default.
- **Stops on trouble.** A checkpoint, a warning or the weekly invite limit
  pauses everything for an hour instead of retrying into it.
- **Background tabs.** Profiles open inactive, so the machine stays yours.
- **One at a time.** Never a batch — batching is the pattern that gets noticed.

All of these are editable in Sincerely under **Tools → LinkedIn**. Pause it just
on this machine from the checkbox on this options page.

### Honest limits

LinkedIn's User Agreement prohibits automated activity. This is the same
approach lemlist, Apollo and Snov.io take, and the caps above are set to keep
usage indistinguishable from a busy person — but the risk is not zero and it is
yours. Start below the defaults on a new or low-activity account.

Selectors track LinkedIn's markup, which changes. A step failing with "No
Connect button on this profile" is usually that.

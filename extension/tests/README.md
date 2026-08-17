# Extension tests

```bash
cd extension/tests
npm install
node run.mjs              # every suite
node run.mjs fastpath     # just one
```

Needs a Chromium and `openssl` on PATH. The browser is found in this order:
`CHROMIUM_PATH` if set, then `/opt/pw-browsers/chromium` if it exists, then
whatever `npx playwright install chromium` put down. Nothing to configure on a
fresh machine:

```bash
npx playwright install chromium
```

CI runs the whole thing on every push (`.github/workflows/ci.yml`).

## What these are

They drive the **real unpacked extension** in Chromium — service worker, content
scripts, popup, options page — against a mock API that mirrors the server's
response shapes.

That is deliberate. Nearly every bug this extension has shipped was a wiring or
timing fault rather than a logic one: a message type nothing handled, a scrape
that blocked the UI until the page looked frozen, a key that saved but was never
verified, a connection probe pointed at an endpoint that no longer existed. None
of those are visible to a unit test of a pure function, and all of them are
obvious the moment you drive the actual extension.

`run.mjs` starts the mock, resets it between suites, and runs everything.

| Suite | Covers |
|---|---|
| `defaults.test.mjs` | The production API host agrees across `storage.js`, the manifest, `.env.example`, the options page and the README. Pure file reads. |
| `harvest.test.mjs` | The site-harvest parser: Cloudflare decoding, obfuscation, link ranking. Pure functions. |
| `smoke.mjs` | The main path end to end — options page, key validation, content-script injection, the popup's identity/picker/add/remove/suppress flows, bulk add, scanning. |
| `connect.mjs` | Connecting from the app's own **Connect extension** button. |
| `tabconnect.mjs` | Connecting from the toolbar, against whatever tab is open. |
| `coldstart.mjs` | A sleeping free-tier host: the first request must wait, not fail. |
| `panel.mjs` | The in-page panel on LinkedIn — detection, Prospector reveal, adding. |
| `listbar.mjs` | Row checkboxes and the bulk bar on LinkedIn search results. |
| `scan.mjs` | Scanning a company site and putting the results on a list. |
| `fastpath.mjs` | Connect deep-links to the API keys tab; LinkedIn never blocks the UI. |
| `ratelimit.mjs` | A key that runs out of budget: the client paces itself, waits out a 429 and retries, and still reports a wall that will not lift. |
| `agent.mjs` | The LinkedIn agent, both halves — `act.js` clicking the real button markup, and the worker's ask/open/act/report loop. |
| `regressions.mjs` | Bugs that shipped once and must not ship again. |
| `shots.mjs` | Screenshots of every surface. Asserts nothing; produces the images the UI is judged from. |

## The LinkedIn stub

`fastpath.mjs` and the LinkedIn suites need pages that are *genuinely* on
`linkedin.com`: the scraper picks its adapter off `location.hostname`, and the
manifest only injects content scripts on `https://www.linkedin.com/*`.

Playwright's request interception can't provide that — a route-fulfilled response
does not get content scripts injected at all, which is a silent and thoroughly
confusing way for these tests to "pass". So `linkedin-stub.mjs` serves the pages
over TLS and Chromium is launched with a `--host-resolver-rules` mapping.

The certificate is generated on demand by `tls.mjs` into a gitignored `.tls/`.
Chromium is pinned to that one key's SPKI fingerprint rather than run with
blanket `--ignore-certificate-errors`, because the blanket flag marks the page
insecure and Chrome then refuses to inject content scripts into it.

## The fixture API key

`fixtures.mjs` assembles the test key from parts rather than writing it out.

The extension validates a key as `sk_live_` followed by 64 hex characters, so a
fixture has to have exactly that shape to exercise the validation at all — which
means a literal looks precisely like a live credential to a secret scanner, and
GitHub's push protection duly blocked it. Import `TEST_API_KEY` / `TEST_AUTH`
rather than pasting one back in.

Nothing there is or was secret; the mock accepts that one value and rejects
everything else. The deliberately *invalid* keys in `smoke.mjs` — the masked one
and the truncated one — stay inline, because being malformed is the point of
them.

## Two traps worth knowing

**Content scripts run in an isolated world.** `page.evaluate(() => window.__sincerely)`
returns nothing, no matter how correctly the script loaded. Talk to content
scripts through `chrome.tabs.sendMessage` from the service worker — which is the
production path anyway — and use `page.evaluate` only for what the *page* can
see (dialogs opening, scroll locking).

**A test that never exercises its subject passes.** The cold-start suite armed a
delay on `/campaigns` long after the connection probe moved to `/lists`, so it
reported green while testing nothing. If a suite is suspiciously fast or its
timings read `0s`, check that the thing it arms is the thing the code calls.

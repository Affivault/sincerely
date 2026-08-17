/**
 * Stands in for linkedin.com over TLS, so the extension's LinkedIn adapter is
 * genuinely exercised.
 *
 * It has to be a real HTTPS origin on that hostname: the scraper picks its
 * adapter off `location.hostname`, and the manifest only injects the content
 * scripts on `https://www.linkedin.com/*`. Playwright's request interception
 * isn't enough — a route-fulfilled response does not get content scripts
 * injected at all — so the test maps the hostname at Chromium's resolver and
 * this serves it.
 *
 * Two profiles, because there are two routes worth proving:
 *
 *   /in/priya-raman/    Voyager and the overlay fetch both refuse, so the only
 *                       way to the address is driving LinkedIn's own UI. This is
 *                       the path that used to freeze the page.
 *   /in/quiet-profile/  Voyager answers. Nothing may be clicked at all.
 *
 * Both reproduce what made the real page feel broken: the address is nowhere in
 * the document, opening the overlay locks body scroll exactly as LinkedIn's
 * modal does, and somebody else's overlay link sits in the sidebar waiting to be
 * misclicked.
 *
 * The TLS material is generated on the fly by tests/tls.mjs — nothing secret is
 * committed, and the cert is only ever trusted by the throwaway browser profile
 * the tests launch.
 */
import { createServer } from 'node:https';
import { ensureCert } from './tls.mjs';

const PORT = Number(process.env.LINKEDIN_STUB_PORT || 3443);

/** Voyager only answers for this slug, so one run can prove both routes. */
const QUIET_SLUG = 'quiet-profile';

/**
 * The profile that reproduces the reported failure exactly.
 *
 * No contact-info anchor anywhere in the markup, no working legacy endpoint,
 * and the address nowhere in the document — so every route the extension used
 * to have comes up empty and it reports "no email" for somebody who plainly
 * has one. The only way in is LinkedIn's own router: push the overlay URL and
 * the app opens the dialog itself, exactly as it does when the user clicks.
 */
const ROUTER_SLUG = 'router-only';

/**
 * The hardest case, and the one the reports keep describing.
 *
 * No contact-info link. Nothing in the markup. No dialog, ever. The address
 * exists in exactly one place: a JSON response the page fetches for itself on
 * load — which is what LinkedIn does for profiles it will let you see the
 * address of. Every markup-reading and endpoint-guessing route comes up empty
 * here; only reading LinkedIn's own traffic finds it.
 */
const TAP_SLUG = 'tap-only';
const TAP_ADDRESS = 'marcus.webb@northwind.example.org';
const ADDRESS = 'priya.raman@northwind.example.org';

const profile = (slug, name, headline) => `<!doctype html><html><head><title>${name} | LinkedIn</title></head>
<body>
  <main>
    <h1>${name}</h1>
    <div class="text-body-medium break-words">${headline}</div>
    <a href="/in/${slug}/overlay/contact-info/" id="ci">Contact info</a>
    <button aria-label="Message ${name}">Message</button>
    <button aria-label="Connect with ${name}">Connect</button>
  </main>
  <aside><a href="/in/someone-else/overlay/contact-info/">Contact info</a></aside>
  <script>
    window.__dialogOpens = 0;
    document.getElementById('ci').addEventListener('click', function (e) {
      e.preventDefault();
      window.__dialogOpens += 1;
      // LinkedIn locks scroll while a modal is up. Reproduced verbatim: this is
      // what makes the page feel frozen when the extension drives the overlay.
      document.body.style.overflow = 'hidden';
      setTimeout(function () {
        var dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.className = 'artdeco-modal';
        dialog.innerHTML =
          '<h2>Contact info</h2>' +
          '<button class="artdeco-modal__dismiss" aria-label="Dismiss">x</button>' +
          '<a href="mailto:${ADDRESS}">${ADDRESS}</a>';
        dialog.querySelector('.artdeco-modal__dismiss').addEventListener('click', function () {
          dialog.remove();
          document.body.style.overflow = '';
        });
        document.body.appendChild(dialog);
      }, 250);
    });
  </script>
</body></html>`;

/**
 * A profile shaped for the LinkedIn agent, with LinkedIn's real button markup.
 *
 * The detail that matters: every control carries BOTH visible text and an
 * aria-label, and they say different things. LinkedIn's Connect button reads
 * "Connect" and is labelled "Invite Rowan Fitz to connect"; Send reads "Send"
 * and is labelled "Send now". Any matcher that concatenates the two before
 * testing sees "connect invite rowan fitz to connect" and matches neither.
 */
const AGENT_SLUG = 'agent-target';
const AGENT_PROFILE = `<!doctype html><html><head><title>Rowan Fitz | LinkedIn</title></head>
<body>
  <main>
    <h1>Rowan Fitz</h1>
    <div class="text-body-medium break-words">VP Engineering at Northwind Capital</div>
    <button aria-label="Message Rowan Fitz"><span aria-hidden="true">Message</span></button>
    <button id="connect" aria-label="Invite Rowan Fitz to connect"><span aria-hidden="true">Connect</span></button>
  </main>
  <script>
    window.__agent = { invitesSent: 0, note: null, noteOpened: 0 };
    document.getElementById('connect').addEventListener('click', function () {
      if (document.getElementById('invite-modal')) return;
      var modal = document.createElement('div');
      modal.id = 'invite-modal';
      modal.setAttribute('role', 'dialog');
      modal.innerHTML =
        '<h2>Add a note to your invitation?</h2>' +
        '<button id="add-note" aria-label="Add a note to your invitation"><span>Add a note</span></button>' +
        '<button id="send-btn" aria-label="Send now"><span>Send</span></button>';
      document.body.appendChild(modal);
      document.getElementById('add-note').addEventListener('click', function () {
        window.__agent.noteOpened += 1;
        if (document.getElementById('custom-message')) return;
        var field = document.createElement('textarea');
        field.id = 'custom-message';
        field.name = 'message';
        modal.appendChild(field);
      });
      document.getElementById('send-btn').addEventListener('click', function () {
        var field = document.getElementById('custom-message');
        window.__agent.note = field ? field.value : null;
        window.__agent.invitesSent += 1;
        modal.remove();
      });
    });
  </script>
</body></html>`;

const ROUTER_ONLY_PROFILE = `<!doctype html><html><head><title>Dana Okafor | LinkedIn</title></head>
<body>
  <main>
    <h1>Dana Okafor</h1>
    <div class="text-body-medium break-words">Partner at Northwind Capital</div>
    <button aria-label="Message Dana">Message</button>
    <button aria-label="Connect with Dana">Connect</button>
  </main>
  <script>
    window.__dialogOpens = 0;
    // Stands in for LinkedIn's router: the overlay is a route, and the app
    // opens it whenever the URL says so.
    function openFromRoute() {
      if (!location.pathname.includes('/overlay/contact-info')) return;
      if (document.querySelector('[role="dialog"]')) return;
      window.__dialogOpens += 1;
      document.body.style.overflow = 'hidden';
      setTimeout(function () {
        var dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.className = 'artdeco-modal';
        dialog.innerHTML =
          '<h2>Contact info</h2>' +
          '<button class="artdeco-modal__dismiss" aria-label="Dismiss">x</button>' +
          '<a href="mailto:dana.okafor@northwind.example.org">dana.okafor@northwind.example.org</a>';
        dialog.querySelector('.artdeco-modal__dismiss').addEventListener('click', function () {
          dialog.remove();
          document.body.style.overflow = '';
          history.back();
        });
        document.body.appendChild(dialog);
      }, 200);
    }
    window.addEventListener('popstate', openFromRoute);
    openFromRoute();
  </script>
</body></html>`;

/**
 * The profile that reproduces the real complaint.
 *
 * Every other fixture here renders its Contact info link in the initial HTML,
 * which is why four consecutive fixes for "the email isn't found unless I click
 * Contact info" passed their tests and changed nothing on linkedin.com. Real
 * LinkedIn renders the top card client-side, after `document_idle` — so at the
 * moment a content script first looks, the link genuinely is not there.
 *
 * Here it appears 2.5 seconds in, and nothing else can answer: no address in the
 * markup, no embedded payload, no Voyager, no overlay HTML, no self-fetch for
 * the tap to read. Waiting for the link is the only way through, and a build
 * that looks once reports "no email" — exactly as it did in production.
 */
const LATE_SLUG = 'late-anchor';
const LATE_ADDRESS = 'nadia.hassan@northwind.example.org';

const LATE_ANCHOR_PROFILE = `<!doctype html><html><head><title>Nadia Hassan | LinkedIn</title></head>
<body>
  <main><div id="shell"></div></main>
  <script>
    window.__dialogOpens = 0;
    // The top card, drawn late — as LinkedIn draws it.
    setTimeout(function () {
      document.getElementById('shell').innerHTML =
        '<h1>Nadia Hassan</h1>' +
        '<div class="text-body-medium break-words">VP Sales at Northwind Capital</div>' +
        '<a href="/in/${LATE_SLUG}/overlay/contact-info/" id="ci">Contact info</a>' +
        '<button aria-label="Message Nadia">Message</button>';
      document.getElementById('ci').addEventListener('click', function (e) {
        e.preventDefault();
        window.__dialogOpens += 1;
        document.body.style.overflow = 'hidden';
        setTimeout(function () {
          var dialog = document.createElement('div');
          dialog.setAttribute('role', 'dialog');
          dialog.className = 'artdeco-modal';
          dialog.innerHTML =
            '<h2>Contact info</h2>' +
            '<button class="artdeco-modal__dismiss" aria-label="Dismiss">x</button>' +
            '<a href="mailto:${LATE_ADDRESS}">${LATE_ADDRESS}</a>';
          dialog.querySelector('.artdeco-modal__dismiss').addEventListener('click', function () {
            dialog.remove();
            document.body.style.overflow = '';
          });
          document.body.appendChild(dialog);
        }, 200);
      });
    }, 2500);
  </script>
</body></html>`;

const TAP_ONLY_PROFILE = `<!doctype html><html><head><title>Marcus Webb | LinkedIn</title></head>
<body>
  <main>
    <h1>Marcus Webb</h1>
    <div class="text-body-medium break-words">Director at Northwind Capital</div>
    <button aria-label="Message Marcus">Message</button>
  </main>
  <script>
    // Exactly what LinkedIn does: the page fetches its own profile data. The
    // address is in the response and nowhere else — not in the DOM, not in an
    // embedded payload, and behind no clickable control.
    fetch('/voyager/api/identity/profiles/${TAP_SLUG}/payload')
      .then(function (r) { return r.json(); })
      .then(function () {});
  </script>
</body></html>`;

const { key, cert } = await ensureCert();

createServer({ key, cert }, (req, res) => {
  const url = new URL(req.url, 'https://www.linkedin.com');

  if (url.pathname.includes(`/voyager/api/identity/profiles/${TAP_SLUG}/payload`)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        profile: { firstName: 'Marcus', lastName: 'Webb' },
        contact: { emailAddress: { emailAddress: TAP_ADDRESS } },
      })
    );
  }

  if (url.pathname.includes('/voyager/')) {
    if (url.pathname.includes(QUIET_SLUG)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ emailAddress: { emailAddress: ADDRESS } }));
    }
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end('{}');
  }

  if (url.pathname.includes('/overlay/contact-info')) {
    /*
     * Slow for priya, instant for the quiet profile.
     *
     * The deep read has to still be running when the panel's 1200ms URL poller
     * notices an SPA navigation, or the regression test for "navigating
     * mid-read loses the next profile" has no overlap to catch and passes
     * against the broken build. Real LinkedIn responses are not instant either.
     * Kept under the scraper's 1500ms modal budget so the dialog route still
     * succeeds afterwards.
     */
    const delay = url.pathname.includes(QUIET_SLUG) ? 0 : 1200;
    return setTimeout(() => {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('');
    }, delay);
  }

  // A JSESSIONID is what the scraper reads as the CSRF token; without it the
  // Voyager route is skipped entirely, which would make the quiet profile pass
  // for the wrong reason.
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Set-Cookie': 'JSESSIONID="ajax:1234567890"; Path=/',
  });

  if (url.pathname.includes(AGENT_SLUG)) return res.end(AGENT_PROFILE);
  if (url.pathname.includes(LATE_SLUG)) return res.end(LATE_ANCHOR_PROFILE);
  if (url.pathname.includes(TAP_SLUG)) return res.end(TAP_ONLY_PROFILE);
  if (url.pathname.includes(ROUTER_SLUG)) return res.end(ROUTER_ONLY_PROFILE);
  if (url.pathname.includes(QUIET_SLUG)) {
    return res.end(profile(QUIET_SLUG, 'Quiet Profile', 'Analyst at Northwind Capital'));
  }
  res.end(profile('priya-raman', 'Priya Raman', 'Head of Partnerships at Northwind Capital'));
}).listen(PORT, () => console.log(`linkedin stub on https://127.0.0.1:${PORT}`));

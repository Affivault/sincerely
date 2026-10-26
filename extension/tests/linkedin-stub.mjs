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

/**
 * Everything around a top card that the agent must never touch.
 *
 * Real profiles carry "People you may know" and "People also viewed", full of
 * other people's Connect buttons labelled "Invite <them> to connect" - the
 * same label the agent looks for. Any click on one is counted, and every
 * agent test asserts the count stays at zero.
 */
const SIDEBAR = `
    <section class="pymk">
      <h2>People you may know</h2>
      <button data-sidebar aria-label="Invite Kim Else to connect"><span aria-hidden="true">Connect</span></button>
      <button data-sidebar aria-label="Message Kim Else"><span aria-hidden="true">Message</span></button>
    </section>`;
const ASIDE = `
  <aside>
    <h2>People also viewed</h2>
    <button data-sidebar aria-label="Invite Sam Other to connect"><span aria-hidden="true">Connect</span></button>
    <button data-sidebar aria-label="Pending, click to withdraw invitation sent to Sam Other"><span>Pending</span></button>
  </aside>`;

/**
 * Shared page script for the agent profiles: LinkedIn's invite modal, its
 * docked conversation windows, and the counters the tests read back.
 */
const AGENT_LIB = `
    window.__agent = { invitesSent: 0, note: null, noteOpened: 0, sidebarClicks: 0, messages: [], inmailSent: 0 };
    document.querySelectorAll('[data-sidebar]').forEach(function (b) {
      b.addEventListener('click', function () { window.__agent.sidebarClicks += 1; });
    });
    function openInvite(opts, onSent) {
      if (document.getElementById('invite-modal')) return;
      var modal = document.createElement('div');
      modal.id = 'invite-modal';
      modal.setAttribute('role', 'dialog');
      modal.innerHTML = opts && opts.noNote
        ? '<h2>You can send a limited number of personalized invitations</h2>' +
          '<button id="send-btn" aria-label="Send without a note"><span>Send without a note</span></button>'
        : '<h2>Add a note to your invitation?</h2>' +
          '<button id="add-note" aria-label="Add a note to your invitation"><span>Add a note</span></button>' +
          '<button id="send-btn" aria-label="Send now"><span>Send</span></button>';
      document.body.appendChild(modal);
      var add = document.getElementById('add-note');
      if (add) add.addEventListener('click', function () {
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
        if (onSent) onSent();
      });
    }
    function openConversation(name, opts) {
      var open = Array.prototype.find.call(
        document.querySelectorAll('.msg-overlay-conversation-bubble'),
        function (b) { return b.dataset.to === name; });
      if (open) return;
      var inmail = !!(opts && opts.inmail);
      var b = document.createElement('div');
      b.className = 'msg-overlay-conversation-bubble';
      b.dataset.to = name;
      b.innerHTML =
        '<header class="msg-overlay-bubble-header"><h2 class="msg-overlay-bubble-header__title">' +
        (inmail ? 'New message' : name) + '</h2></header>' +
        (inmail ? '<input name="subject" placeholder="Subject (optional)">' : '') +
        '<div class="msg-form__contenteditable" contenteditable="true" role="textbox" style="min-height:20px"></div>' +
        '<button class="send" disabled>Send</button>';
      document.body.appendChild(b);
      var box = b.querySelector('[contenteditable]');
      var send = b.querySelector('.send');
      box.addEventListener('input', function () { send.disabled = !box.textContent.trim(); });
      send.addEventListener('click', function () {
        if (inmail) window.__agent.inmailSent += 1;
        window.__agent.messages.push({ to: name, text: box.textContent });
        box.textContent = '';
        send.disabled = true;
      });
    }
    function wireMore() {
      var more = document.getElementById('more');
      var menu = document.getElementById('more-menu');
      if (!more || !menu) return;
      more.addEventListener('click', function () {
        var open = menu.style.display !== 'none';
        menu.style.display = open ? 'none' : 'block';
        more.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    }
    wireMore();`;

const AGENT_PROFILE = `<!doctype html><html><head><title>Rowan Fitz | LinkedIn</title></head>
<body>
  <main>
    <section class="pv-top-card">
      <h1>Rowan Fitz</h1>
      <div class="text-body-medium break-words">VP Engineering at Northwind Capital</div>
      <button aria-label="Message Rowan Fitz"><span aria-hidden="true">Message</span></button>
      <button id="connect" aria-label="Invite Rowan Fitz to connect"><span aria-hidden="true">Connect</span></button>
    </section>${SIDEBAR}
  </main>${ASIDE}
  <script>${AGENT_LIB}
    document.getElementById('connect').addEventListener('click', function () {
      openInvite({}, function () {
        // LinkedIn swaps Connect for Pending once the invite is real.
        var c = document.getElementById('connect');
        c.outerHTML = '<button id="pending" aria-label="Pending, click to withdraw invitation sent to Rowan Fitz"><span aria-hidden="true">Pending</span></button>';
      });
    });
  </script>
</body></html>`;

/**
 * Connect under "More". The card shows Message (Premium and open profiles
 * do), so a check that reads Message-without-Connect as "already
 * connected" skips the invite this person was meant to get.
 */
const AGENT_MORE_PROFILE = `<!doctype html><html><head><title>Mara Quinn | LinkedIn</title></head>
<body>
  <main>
    <section class="pv-top-card">
      <h1>Mara Quinn</h1>
      <div class="text-body-medium break-words">COO at Brightline</div>
      <button aria-label="Message Mara Quinn"><span aria-hidden="true">Message</span></button>
      <div class="artdeco-dropdown">
        <button id="more" aria-label="More actions" aria-expanded="false" aria-controls="more-menu"><span aria-hidden="true">More</span></button>
        <div id="more-menu" class="artdeco-dropdown__content" style="display:none">
          <div role="button" class="artdeco-dropdown__item" aria-label="Save to PDF"><span>Save to PDF</span></div>
          <div role="button" id="menu-connect" class="artdeco-dropdown__item" aria-label="Invite Mara Quinn to connect"><span>Connect</span></div>
        </div>
      </div>
    </section>${SIDEBAR}
  </main>${ASIDE}
  <script>${AGENT_LIB}
    document.getElementById('menu-connect').addEventListener('click', function () {
      document.getElementById('more').click();
      openInvite({}, function () {
        var item = document.getElementById('menu-connect');
        item.setAttribute('aria-label', 'Withdraw invitation sent to Mara Quinn');
        item.innerHTML = '<span>Pending</span>';
      });
    });
  </script>
</body></html>`;

/**
 * A first-degree connection: Message on the card, no Connect anywhere of
 * theirs, "Remove connection" under More - and a conversation with somebody
 * else already open, which is the window a careless agent types into.
 */
const AGENT_FIRST_PROFILE = `<!doctype html><html><head><title>Jonas Berg | LinkedIn</title></head>
<body>
  <main>
    <section class="pv-top-card">
      <h1>Jonas Berg</h1>
      <div class="text-body-medium break-words">Head of Data at Meridian Labs</div>
      <button id="message" aria-label="Message Jonas Berg"><span aria-hidden="true">Message</span></button>
      <div class="artdeco-dropdown">
        <button id="more" aria-label="More actions" aria-expanded="false" aria-controls="more-menu"><span aria-hidden="true">More</span></button>
        <div id="more-menu" class="artdeco-dropdown__content" style="display:none">
          <div role="button" class="artdeco-dropdown__item" aria-label="Save to PDF"><span>Save to PDF</span></div>
          <div role="button" class="artdeco-dropdown__item" aria-label="Remove your connection to Jonas Berg"><span>Remove connection</span></div>
        </div>
      </div>
    </section>${SIDEBAR}
  </main>${ASIDE}
  <script>${AGENT_LIB}
    openConversation('Priya Raman');
    document.getElementById('message').addEventListener('click', function () {
      setTimeout(function () { openConversation('Jonas Berg'); }, 200);
    });
  </script>
</body></html>`;

/** Message on a stranger: LinkedIn offers InMail, which spends credits. */
const AGENT_INMAIL_PROFILE = `<!doctype html><html><head><title>Lena Fox | LinkedIn</title></head>
<body>
  <main>
    <section class="pv-top-card">
      <h1>Lena Fox</h1>
      <div class="text-body-medium break-words">Founder at Fox and Field</div>
      <button id="message" aria-label="Message Lena Fox"><span aria-hidden="true">Message</span></button>
    </section>${SIDEBAR}
  </main>${ASIDE}
  <script>${AGENT_LIB}
    document.getElementById('message').addEventListener('click', function () {
      setTimeout(function () { openConversation('Lena Fox', { inmail: true }); }, 200);
    });
  </script>
</body></html>`;

/** Out of personalised invites: the modal offers only "Send without a note". */
const AGENT_NONOTE_PROFILE = `<!doctype html><html><head><title>Theo Marsh | LinkedIn</title></head>
<body>
  <main>
    <section class="pv-top-card">
      <h1>Theo Marsh</h1>
      <div class="text-body-medium break-words">CTO at Harbor</div>
      <button id="connect" aria-label="Invite Theo Marsh to connect"><span aria-hidden="true">Connect</span></button>
    </section>${SIDEBAR}
  </main>${ASIDE}
  <script>${AGENT_LIB}
    document.getElementById('connect').addEventListener('click', function () {
      openInvite({ noNote: true });
    });
  </script>
</body></html>`;

/** The public profile LinkedIn shows a signed-out visitor. */
const AGENT_PUBLIC_PROFILE = `<!doctype html><html><head><title>Ada Park | LinkedIn</title></head>
<body>
  <header>
    <nav><a href="/signup">Join now</a> <a href="/login">Sign in</a></nav>
  </header>
  <main>
    <section class="top-card-layout">
      <h1>Ada Park</h1>
      <button aria-label="Sign in to connect with Ada Park">Connect</button>
    </section>
  </main>
</body></html>`;

/**
 * A first-degree connection, shaped as LinkedIn ships the top card: the
 * "· 1st" badge, a headline, a location line and the current-company
 * button. The acceptance check reads it as accepted, and the enrichment
 * reads the card - never the sidebar, whose headlines are other people's.
 */
const AGENT_ACCEPTED_PROFILE = `<!doctype html><html><head><title>Ines Duarte | LinkedIn</title></head>
<body>
  <main>
    <section class="pv-top-card">
      <h1>Ines Duarte</h1>
      <span class="dist-value">1st</span>
      <div class="text-body-medium break-words">Head of Growth at Acme Robotics</div>
      <span class="text-body-small inline t-black--light">Lisbon, Portugal</span>
      <button aria-label="Current company: Acme Robotics. Click to skip to experience card"><span>Acme Robotics</span></button>
      <button aria-label="Message Ines Duarte"><span aria-hidden="true">Message</span></button>
    </section>
    <section class="pymk">
      <h2>People you may know</h2>
      <div class="text-body-medium">Chief Everything at Sidebar Corp</div>
      <span class="text-body-small inline t-black--light">Nowhere, Atlantis</span>
      <button data-sidebar aria-label="Invite Kim Else to connect"><span aria-hidden="true">Connect</span></button>
    </section>
  </main>${ASIDE}
  <script>${AGENT_LIB}</script>
</body></html>`;

/**
 * An invite still pending. Pending opens LinkedIn's confirm dialog, and
 * Withdraw in it turns the card back to Connect. The aside carries
 * somebody else's Pending, which must never be the one clicked.
 */
const AGENT_PENDING_PROFILE = `<!doctype html><html><head><title>Theo Pike | LinkedIn</title></head>
<body>
  <main>
    <section class="pv-top-card">
      <h1>Theo Pike</h1>
      <span class="dist-value">2nd</span>
      <div class="text-body-medium break-words">Founder, Pike and Co</div>
      <button id="pending" aria-label="Pending, click to withdraw invitation sent to Theo Pike"><span aria-hidden="true">Pending</span></button>
    </section>${SIDEBAR}
  </main>${ASIDE}
  <script>${AGENT_LIB}
    window.__agent.withdrawn = 0;
    document.getElementById('pending').addEventListener('click', function () {
      var modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.innerHTML = '<h2>Withdraw invitation</h2><p>If you withdraw now, you will not be able to resend for up to 3 weeks.</p>' +
        '<button id="cancel"><span>Cancel</span></button><button id="confirm-withdraw" aria-label="Withdraw"><span>Withdraw</span></button>';
      document.body.appendChild(modal);
      document.getElementById('cancel').addEventListener('click', function () { modal.remove(); });
      document.getElementById('confirm-withdraw').addEventListener('click', function () {
        window.__agent.withdrawn += 1;
        modal.remove();
        var p = document.getElementById('pending');
        p.outerHTML = '<button id="connect" aria-label="Invite Theo Pike to connect"><span aria-hidden="true">Connect</span></button>';
      });
    });
  </script>
</body></html>`;

/** No invite out any more: Connect is back on the card. */
const AGENT_DECLINED_PROFILE = `<!doctype html><html><head><title>Lou Marr | LinkedIn</title></head>
<body>
  <main>
    <section class="pv-top-card">
      <h1>Lou Marr</h1>
      <div class="text-body-medium break-words">Engineer</div>
      <button aria-label="Invite Lou Marr to connect"><span aria-hidden="true">Connect</span></button>
    </section>${SIDEBAR}
  </main>${ASIDE}
  <script>${AGENT_LIB}</script>
</body></html>`;

/**
 * The messaging page: a conversation list and a thread pane that renders
 * whichever conversation was clicked, a moment later, as LinkedIn's does.
 *
 *   Rowan Fitz  - watched; we wrote, then two messages from them. Reported.
 *   Kim Else    - not on the watchlist. Never opened.
 *   Jonas Berg  - watched, but "You: ..." - we spoke last. Never opened.
 *
 * A thread for somebody else is open when the page loads, which is the
 * pane a careless reader reports as the first watched person's.
 */
const THREADS = {
  'rowan-thread': {
    name: 'Rowan Fitz',
    events: [
      { mine: true, sender: 'Me Myself', id: 'urn:li:msg:1', text: 'Thanks for connecting, Rowan. Worth a chat about platform teams?' },
      { mine: false, sender: 'Rowan Fitz', id: 'urn:li:msg:2', text: 'Hi! Yes, happy to talk.' },
      { mine: false, sender: null, id: 'urn:li:msg:3', text: 'Does Thursday work?' },
    ],
  },
  'kim-thread': { name: 'Kim Else', events: [{ mine: false, sender: 'Kim Else', id: 'urn:li:msg:9', text: 'Unrelated hello' }] },
  'jonas-thread': {
    name: 'Jonas Berg',
    events: [
      { mine: false, sender: 'Jonas Berg', id: 'urn:li:msg:20', text: 'Old message from Jonas' },
      { mine: true, sender: 'Me Myself', id: 'urn:li:msg:21', text: 'Our follow-up' },
    ],
  },
  'priya-thread': { name: 'Priya Raman', events: [{ mine: false, sender: 'Priya Raman', id: 'urn:li:msg:30', text: 'Not who you are looking for' }] },
};

const MESSAGING_PAGE = `<!doctype html><html><head><title>Messaging | LinkedIn</title></head>
<body>
  <nav id="global-nav"><a href="/feed/">Home</a></nav>
  <main>
    <div class="msg-conversations-container">
      <ul class="msg-conversations-container__conversations-list">
        <li class="msg-conversation-listitem"><a href="/messaging/thread/kim-thread/" data-thread="kim-thread">
          <h3 class="msg-conversation-listitem__participant-names">Kim Else</h3>
          <p class="msg-conversation-card__message-snippet">Kim: Unrelated hello</p></a></li>
        <li class="msg-conversation-listitem"><a href="/messaging/thread/rowan-thread/" data-thread="rowan-thread">
          <h3 class="msg-conversation-listitem__participant-names">Rowan Fitz</h3>
          <p class="msg-conversation-card__message-snippet">Rowan: Does Thursday work?</p></a></li>
        <li class="msg-conversation-listitem"><a href="/messaging/thread/jonas-thread/" data-thread="jonas-thread">
          <h3 class="msg-conversation-listitem__participant-names">Jonas Berg</h3>
          <p class="msg-conversation-card__message-snippet">You: Our follow-up</p></a></li>
      </ul>
    </div>
    <div id="pane"></div>
  </main>
  <script>
    var THREADS = ${JSON.stringify(THREADS)};
    window.__inbox = { opened: [] };
    function render(id) {
      var t = THREADS[id];
      var html = '<div class="msg-convo-wrapper"><h2 class="msg-entity-lockup__entity-title">' + t.name + '</h2>' +
        '<ul class="msg-s-message-list">';
      t.events.forEach(function (e) {
        html += '<li class="msg-s-message-list__event">' +
          (e.sender ? '<span class="msg-s-message-group__name">' + e.sender + '</span>' : '') +
          '<time datetime="2026-10-20T10:00:00Z"></time>' +
          '<div class="msg-s-event-listitem ' + (e.mine ? 'msg-s-event-listitem--self' : 'msg-s-event-listitem--other') +
          '" data-event-urn="' + e.id + '"><p class="msg-s-event-listitem__body">' + e.text + '</p></div></li>';
      });
      document.getElementById('pane').innerHTML = html + '</ul></div>';
    }
    render('priya-thread');
    document.querySelectorAll('a[data-thread]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        var id = a.getAttribute('data-thread');
        window.__inbox.opened.push(id);
        setTimeout(function () { render(id); }, 250);
      });
    });
  </script>
</body></html>`;

/** Where a signed-out tab ends up. act.js is never injected here. */
const AUTHWALL = `<!doctype html><html><head><title>Sign Up | LinkedIn</title></head>
<body><main><h1>Join LinkedIn</h1><a href="/login">Sign in</a></main></body></html>`;

/*
 * Markup variants, one per shape LinkedIn actually ships.
 *
 * The adapter carries a fallback chain per field — four selectors for the
 * name, three for the headline, three for the company — and the existing
 * fixtures only ever exercise the last one in each chain. So the top-card
 * markup, which is what most real profiles use and the most reliable company
 * signal the adapter has, was never read by a test. Nor was any of the name
 * cleaning: LinkedIn appends pronouns, connection degree and credentials to
 * the visible name, and every one of those ends up in a stored last name if
 * it is not stripped.
 */
const VARIANTS = {
  // The top card: name and company in the panels, not in a bare h1.
  'variant-topcard': `
    <div class="pv-text-details__left-panel">
      <h1>Ines Okonkwo</h1>
      <div class="text-body-medium">Chief Revenue Officer</div>
    </div>
    <button aria-label="Current company: Northwind Capital. Click to skip to experience card">
      <span class="pv-text-details__right-panel-item-text">Northwind Capital</span>
    </button>`,

  // "Title @ Company" rather than "Title at Company".
  'variant-at-sign': `
    <h1>Tomas Bergqvist</h1>
    <div class="text-body-medium break-words">Partner @ Northwind Capital</div>`,

  // A headline that is a title and nothing else.
  'variant-no-company': `
    <h1>Ruth Adeyemi</h1>
    <div class="text-body-medium break-words">Software Engineer</div>`,

  // Pronouns and the connection degree, both appended to the visible name.
  'variant-pronouns': `
    <h1>Priya Raman (she/her) · 2nd</h1>
    <div class="text-body-medium break-words">Head of Partnerships at Northwind Capital</div>`,

  // Trailing credentials.
  'variant-credentials': `
    <h1>Jane Doe, MBA, CFA</h1>
    <div class="text-body-medium break-words">Analyst at Northwind Capital</div>`,

  // The name printed twice — once for sighted users, once for screen readers.
  'variant-doubled': `
    <h1>Ada Lovelace<span class="visually-hidden">Ada Lovelace</span></h1>
    <div class="text-body-medium break-words">Mathematician at Northwind Capital</div>`,
};

const variantPage = (slug) => `<!doctype html><html><head><title>Profile | LinkedIn</title></head>
<body><main>${VARIANTS[slug]}</main></body></html>`;

/* ------------------------------------------------------------------ */
/* Sales Navigator                                                    */
/* ------------------------------------------------------------------ */

/*
 * Sales Navigator is a separate application on the same domain, and until
 * now the extension did nothing there at all — every entry point was gated
 * on /in/. These fixtures stand for the two things that matter about it:
 * the markup is anchored on data-anonymize rather than on class names, and
 * a lead page carries other people's names in its right-hand rail, so an
 * unscoped read returns a colleague instead of the lead.
 */

/** A lead page, with a rail of other people at the same company. */
const SALES_LEAD = `<!doctype html><html><head><title>Sales Navigator</title></head>
<body>
  <main>
    <section id="profile-card-section">
      <h1 data-anonymize="person-name">Ana Beltr\u00e1n</h1>
      <span data-anonymize="headline">VP Revenue Operations at Northwind Capital</span>
      <span data-anonymize="job-title">VP Revenue Operations</span>
      <a data-anonymize="company-name" href="/sales/company/9931">Northwind Capital</a>
      <a href="https://www.linkedin.com/in/ana-beltran-77/?trk=nav">View LinkedIn profile</a>
      <a href="https://northwind.example/about">northwind.example</a>
    </section>

    <!-- The trap: the rail is full of person-name nodes for other people. -->
    <aside id="lead-rail">
      <div><span data-anonymize="person-name">Marcus Webb</span></div>
      <div><span data-anonymize="person-name">Ruth Adeyemi</span></div>
    </aside>
  </main>
</body></html>`;

/** A lead with no link out to the public profile, which is common. */
const SALES_LEAD_NO_PUBLIC = `<!doctype html><html><head><title>Sales Navigator</title></head>
<body>
  <main>
    <section id="profile-card-section">
      <h1 data-anonymize="person-name">Tomas Nowak</h1>
      <span data-anonymize="headline">Head of Growth @ Brightline</span>
    </section>
  </main>
</body></html>`;

/** A search results page: rows link to /sales/lead/, never to /in/. */
const SALES_SEARCH = `<!doctype html><html><head><title>Sales Navigator</title></head>
<body>
  <main>
    <ol>
      <li>
        <a href="/sales/lead/ACwAAA001,NAME_SEARCH">
          <span data-anonymize="person-name">Dana Okafor</span>
        </a>
        <span data-anonymize="title">Partner</span>
        <span data-anonymize="company-name">Northwind Capital</span>
      </li>
      <li>
        <a href="/sales/lead/ACwAAA002,NAME_SEARCH">
          <span data-anonymize="person-name">Priya Raman</span>
        </a>
        <span data-anonymize="headline">Head of Partnerships at Brightline</span>
      </li>
      <li>
        <a href="/sales/lead/ACwAAA003,NAME_SEARCH">
          <span data-anonymize="person-name">Ines Okonkwo</span>
        </a>
        <span data-anonymize="title">Chief Revenue Officer</span>
        <span data-anonymize="company-name">Meridian Labs</span>
      </li>
    </ol>
  </main>
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
 * A profile whose own dismiss handler pops the history entry late.
 *
 * This is the condition the other router fixture cannot produce. There, the
 * page's dismiss calls history.back() immediately, so the restore sees the URL
 * settle inside its grace period and never steps back itself — the double-pop
 * has no opportunity to happen and a broken restore still passes.
 *
 * Real LinkedIn does not pop on a fixed schedule. When its dismiss runs after
 * the grace expires, a restore that steps back fires first, and the page's pop
 * lands on top of it: two pops, and the tab ends up one entry further back
 * than the user has ever been. On a tab opened from a search engine that entry
 * is the search engine, which is what "it redirects me to Google" is.
 */
const SLOW_SLUG = 'slow-dismiss';

const SLOW_DISMISS_PROFILE = `<!doctype html><html><head><title>Iris Vance | LinkedIn</title></head>
<body>
  <main>
    <h1>Iris Vance</h1>
    <div class="text-body-medium break-words">Partner at Northwind Capital</div>
  </main>
  <script>
    function openFromRoute() {
      if (!location.pathname.includes('/overlay/contact-info')) return;
      if (document.querySelector('[role="dialog"]')) return;
      document.body.style.overflow = 'hidden';
      setTimeout(function () {
        var dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.className = 'artdeco-modal';
        dialog.innerHTML =
          '<h2>Contact info</h2>' +
          '<button class="artdeco-modal__dismiss" aria-label="Dismiss">x</button>' +
          '<a href="mailto:iris.vance@northwind.example.org">iris.vance@northwind.example.org</a>';
        dialog.querySelector('.artdeco-modal__dismiss').addEventListener('click', function () {
          dialog.remove();
          document.body.style.overflow = '';
          // The whole point of this fixture: the pop comes well after the
          // restore has given up waiting for it.
          setTimeout(function () { history.back(); }, 1600);
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
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('');
    }, delay);
  }

  // Signed out: LinkedIn bounces a profile visit to its authwall.
  if (url.pathname.includes('/in/agent-signedout')) {
    res.writeHead(302, { Location: '/authwall?sessionRedirect=1' });
    return res.end();
  }

  // A JSESSIONID is what the scraper reads as the CSRF token; without it the
  // Voyager route is skipped entirely, which would make the quiet profile pass
  // for the wrong reason.
  res.writeHead(200, {
    // charset declared, as linkedin.com does. Without it the browser decodes
    // UTF-8 as latin-1 and a middot arrives as "Â·" — which is a fault in the
    // fixture, not in the page it stands for, and would have been read as one.
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': 'JSESSIONID="ajax:1234567890"; Path=/',
  });

  // Sales Navigator lives on the same host under /sales/.
  if (url.pathname.startsWith('/sales/search/people')) return res.end(SALES_SEARCH);
  if (url.pathname.includes('/sales/lead/nopublic')) return res.end(SALES_LEAD_NO_PUBLIC);
  if (url.pathname.startsWith('/sales/lead/')) return res.end(SALES_LEAD);

  for (const slug of Object.keys(VARIANTS)) {
    if (url.pathname.includes(slug)) return res.end(variantPage(slug));
  }
  if (url.pathname.includes(AGENT_SLUG)) return res.end(AGENT_PROFILE);
  if (url.pathname.includes('/in/agent-more')) return res.end(AGENT_MORE_PROFILE);
  if (url.pathname.includes('/in/agent-first')) return res.end(AGENT_FIRST_PROFILE);
  if (url.pathname.includes('/in/agent-inmail')) return res.end(AGENT_INMAIL_PROFILE);
  if (url.pathname.includes('/in/agent-nonote')) return res.end(AGENT_NONOTE_PROFILE);
  if (url.pathname.includes('/in/agent-public')) return res.end(AGENT_PUBLIC_PROFILE);
  if (url.pathname.includes('/in/agent-accepted')) return res.end(AGENT_ACCEPTED_PROFILE);
  if (url.pathname.includes('/in/agent-pending')) return res.end(AGENT_PENDING_PROFILE);
  if (url.pathname.includes('/in/agent-declined')) return res.end(AGENT_DECLINED_PROFILE);
  if (url.pathname.startsWith('/messaging')) return res.end(MESSAGING_PAGE);
  if (url.pathname.startsWith('/authwall')) return res.end(AUTHWALL);
  if (url.pathname.includes(LATE_SLUG)) return res.end(LATE_ANCHOR_PROFILE);
  if (url.pathname.includes(TAP_SLUG)) return res.end(TAP_ONLY_PROFILE);
  if (url.pathname.includes(ROUTER_SLUG)) return res.end(ROUTER_ONLY_PROFILE);
  if (url.pathname.includes(SLOW_SLUG)) return res.end(SLOW_DISMISS_PROFILE);
  if (url.pathname.includes(QUIET_SLUG)) {
    return res.end(profile(QUIET_SLUG, 'Quiet Profile', 'Analyst at Northwind Capital'));
  }
  res.end(profile('priya-raman', 'Priya Raman', 'Head of Partnerships at Northwind Capital'));
}).listen(PORT, () => console.log(`linkedin stub on https://127.0.0.1:${PORT}`));

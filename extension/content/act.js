/**
 * LinkedIn agent — the hands.
 *
 * Runs on a profile page and does one thing: click the button a person would
 * click. It reads nothing it doesn't need and sends nothing anywhere — the
 * service worker asked it to act, and it answers ok or not.
 *
 * It stops the moment LinkedIn shows a checkpoint, a warning, or a limit
 * notice. Those are not conditions to retry into; retrying into one is the
 * fastest way to get an account restricted.
 *
 * LinkedIn's markup changes constantly, so every selector here is a list of
 * candidates matched on visible text rather than one brittle class name, and
 * anything unrecognised fails loudly instead of clicking something at random.
 *
 * Every lookup is scoped. A profile page carries other people's buttons too:
 * "People you may know" and "People also viewed" are full of "Invite X to
 * connect", and an unscoped search for Connect could send the invite to a
 * stranger in the sidebar instead of the person the campaign is about. So the
 * profile's own buttons are only ever looked for in its top card, and the
 * invite and message controls only in the dialog or overlay that opened for
 * this person.
 */

(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** The pause a person takes between seeing something and acting on it. */
  const beat = () => sleep(400 + Math.random() * 1400);

  /** LinkedIn's own limit on an invitation note. */
  const NOTE_MAX = 300;

  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const norm = (raw) => String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();

  /* ── Where to look ───────────────────────────────────────────────────── */

  /** The profile's name heading: the anchor everything else is found from. */
  function profileHeading() {
    return document.querySelector('main h1') || document.querySelector('h1');
  }

  /**
   * The top card: the block holding this person's name and their buttons.
   * The section around the name is it on every layout LinkedIn has shipped;
   * failing that, the main column, with other people's sections filtered out
   * by inScope below.
   */
  function topCard() {
    const h1 = profileHeading();
    if (!h1) return null;
    return h1.closest('.pv-top-card, #profile-card-section, section')
      || h1.closest('main')
      || h1.parentElement;
  }

  /**
   * Inside the card, and not inside somebody else's block nested in it. On
   * the layouts where the card is the whole main column, the recommendation
   * rails are asides and sections of their own, and nothing in them is ours.
   */
  function inScope(el, root) {
    if (!root || !root.contains(el)) return false;
    const h1 = profileHeading();
    // A dialog or a message window is all one person's already.
    if (!h1 || !root.contains(h1)) return true;
    const aside = el.closest('aside');
    if (aside && aside !== root && root.contains(aside)) return false;
    const section = el.closest('section');
    if (section && section !== root && root.contains(section) && !(h1 && section.contains(h1))) return false;
    return true;
  }

  const CLICKABLE = 'button, a[role="button"], [role="button"], [role="menuitem"], .artdeco-dropdown__item';

  /**
   * Find a control by the words on it, which outlive class-name churn.
   *
   * Each label is tested on its own, and that is the whole point. LinkedIn's
   * controls carry visible text and an aria-label that say different things —
   * Connect reads "Connect" and is labelled "Invite Rowan Fitz to connect";
   * Send reads "Send" and is labelled "Send now". Joining them first gives
   * "connect invite rowan fitz to connect", which matches neither /^connect$/
   * nor /^invite .* to connect$/.
   *
   * `root` is required. There is no document-wide search here on purpose.
   */
  function buttonByText(patterns, root) {
    if (!root) return null;
    for (const el of root.querySelectorAll(CLICKABLE)) {
      if (!visible(el) || !inScope(el, root)) continue;
      const labels = [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')]
        .map(norm)
        .filter(Boolean);
      if (labels.some((label) => patterns.some((p) => p.test(label)))) return el;
    }
    return null;
  }

  async function waitFor(find, timeoutMs = 8000) {
    const started = Date.now();
    for (;;) {
      const el = find();
      if (el) return el;
      if (Date.now() - started > timeoutMs) return null;
      await sleep(250);
    }
  }

  /** Visible dialogs, newest last — LinkedIn appends its modals to the body. */
  function dialogs() {
    return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], .artdeco-modal')]
      .filter((d) => visible(d) && !d.parentElement?.closest('[role="dialog"], .artdeco-modal'));
  }

  /** The dialog that appeared after `before` was taken, if any. */
  function newDialog(before) {
    const fresh = dialogs().filter((d) => !before.includes(d));
    return fresh[fresh.length - 1] || null;
  }

  /* ── Stop conditions ─────────────────────────────────────────────────── */

  /**
   * Signed out. LinkedIn sends a signed-out visitor to /login or /authwall,
   * or shows the public version of the profile with "Sign in" and "Join now"
   * where the navigation bar would be. Nothing can be done from there, and
   * failing the task would spend its attempts on something that is not
   * wrong with the task.
   */
  function loggedOut() {
    if (/\/(login|uas\/login|authwall|signup)\b/.test(location.pathname)) return true;
    if (document.querySelector('#global-nav, .global-nav, [data-test-global-nav]')) return false;
    const header = document.querySelector('header, nav') || document.body;
    const links = [...header.querySelectorAll('a, button')].filter(visible).map((el) => norm(el.innerText));
    return links.includes('sign in') && links.includes('join now');
  }

  /** Anything that means "stop", rather than "try again". */
  function blocker() {
    if (/\/checkpoint\//.test(location.pathname)) {
      return {
        kind: 'restricted',
        reason: 'LinkedIn asked for a security check. Clear it in your browser, then resume the agent in Sincerely.',
      };
    }
    if (loggedOut()) {
      return { kind: 'logged_out', reason: 'LinkedIn is signed out in this browser. Sign in, then resume the agent in Sincerely.' };
    }
    const body = (document.body?.innerText || '').toLowerCase();
    if (body.includes('reached the weekly invitation limit') || body.includes('weekly invitation limit')) {
      return { kind: 'weekly_limit', reason: 'Weekly invitation limit reached — invites resume next week.' };
    }
    if (body.includes('your account has been restricted') || body.includes('we restricted your account')) {
      return { kind: 'restricted', reason: 'LinkedIn has restricted this account — the agent has stopped.' };
    }
    return null;
  }

  const stopped = (b) => ({ ok: false, fatal: true, kind: b.kind, reason: b.reason });

  /* ── Connection request ───────────────────────────────────────────────
     Connect sits on the profile sometimes and behind "More" others. Both
     are normal, so both are tried before anything is concluded. */

  const PENDING = [/^pending/, /invitation sent/, /^withdraw( invitation)?$/, /^withdraw invitation sent to /];
  const CONNECT = [/^connect$/, /^invite .* to connect$/];

  /** Open the card's "More" menu and return where its items live. */
  async function openMore(card) {
    const more = buttonByText([/^more actions$/, /^more$/], card);
    if (!more) return null;
    more.click();
    await beat();
    const controlled = more.getAttribute('aria-controls');
    const menu = (controlled && document.getElementById(controlled))
      || more.closest('.artdeco-dropdown')
      || card;
    return { more, menu };
  }

  async function closeMore(opened) {
    if (!opened) return;
    // The same toggle closes it. Left open, its items stay visible and get
    // in the way of the card's own buttons on the next look.
    if (opened.more.getAttribute('aria-expanded') !== 'false') opened.more.click();
    await sleep(200);
  }

  /** The invite went out: the card (or its More menu) now says Pending. */
  async function confirmPending(card, viaMore) {
    const shown = await waitFor(() => buttonByText(PENDING, card), 6000);
    if (shown) return true;
    if (!viaMore) return false;
    const opened = await openMore(card);
    const inMenu = opened ? buttonByText(PENDING, opened.menu) : null;
    await closeMore(opened);
    return !!inMenu;
  }

  async function connect(note) {
    const card = topCard();
    if (!card) return { ok: false, reason: 'Could not find the profile card on this page' };

    const text = String(note || '').trim();
    // The server skips a step whose note is too long; this is the backstop,
    // because cutting a note off mid-sentence sends words nobody wrote.
    if (text.length > NOTE_MAX) {
      return { ok: false, reason: `The note is ${text.length} characters; LinkedIn allows ${NOTE_MAX}. Nothing was sent.` };
    }

    if (buttonByText(PENDING, card)) return { ok: true, already: true };

    let btn = buttonByText(CONNECT, card);
    let viaMore = false;
    if (!btn) {
      // Not on the card itself, so it may be under More. Only once More has
      // been looked in can "no Connect" mean anything: a second-degree
      // contact with Message on the card (Premium, open profile) keeps
      // Connect in there, and reading Message as "already connected" skipped
      // their invite entirely.
      const opened = await openMore(card);
      if (opened) {
        btn = buttonByText(CONNECT, opened.menu);
        if (btn) viaMore = true;
        else {
          const pendingInMenu = buttonByText(PENDING, opened.menu);
          const connected = buttonByText([/^remove connection/, /^remove your connection/], opened.menu);
          await closeMore(opened);
          if (pendingInMenu) return { ok: true, already: true };
          if (connected) return { ok: true, already: true };
        }
      }
    }
    if (!btn) {
      // No Connect anywhere, Message on the card: a first-degree connection,
      // which is what the step wanted. Move on rather than fail.
      if (buttonByText([/^message$/, /^message .*/], card)) return { ok: true, already: true };
      return { ok: false, reason: 'No Connect button on this profile' };
    }

    const before = dialogs();
    btn.click();
    await beat();

    const dialog = await waitFor(() => newDialog(before), 6000);
    if (!dialog) return { ok: false, reason: 'The invitation dialog did not open' };

    // "How do you know this person?" asks for their email address. Guessing
    // one is not an option, and sending without it is not possible.
    if (dialog.querySelector('input[type="email"], input[name="email"]')) {
      return { ok: false, reason: 'LinkedIn wants their email address before it will send this invite' };
    }

    if (text) {
      const addNote = await waitFor(() => buttonByText([/^add a note/], dialog), 5000);
      if (!addNote) {
        // Free accounts run out of personalised invites, and LinkedIn then
        // offers only "Send without a note". The campaign asked for a note;
        // sending without one is a different message from the one written.
        return { ok: false, reason: 'LinkedIn did not offer "Add a note", so the invite was not sent without the note' };
      }
      addNote.click();
      await beat();
      const field = await waitFor(
        () => dialog.querySelector('textarea[name="message"], textarea#custom-message, #custom-message, textarea'),
        5000,
      );
      if (!field) return { ok: false, reason: 'The note box did not appear, so the invite was not sent' };
      // Through the native setter, so React sees it. Assigning .value
      // directly leaves React's internal state on the old value and the
      // note sends empty.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await beat();
      if (field.value !== text) return { ok: false, reason: 'The note did not take, so the invite was not sent' };
    }

    // With a note, only a plain Send: "Send without a note" would throw
    // the note away at the last step.
    const sendPatterns = text
      ? [/^send$/, /^send invitation$/, /^send now$/]
      : [/^send$/, /^send invitation$/, /^send now$/, /^send without a note$/];
    const send = await waitFor(() => {
      const el = buttonByText(sendPatterns, dialog);
      return el && !el.disabled ? el : null;
    }, 6000);
    if (!send) return { ok: false, reason: 'Could not find the Send button' };
    send.click();
    await sleep(1500);

    const blocked = blocker();
    if (blocked) return stopped(blocked);

    // A click is not a sent invite. LinkedIn turns Connect into Pending once
    // the invite is real; until the card says so, this is not reported done.
    if (!(await confirmPending(card, viaMore))) {
      return { ok: false, reason: 'Clicked Send, but LinkedIn never showed the invite as pending' };
    }
    return { ok: true };
  }

  /* ── Message ──────────────────────────────────────────────────────────
     Only works with an existing connection. LinkedIn hides Message
     otherwise, or offers InMail — which costs credits and isn't what the
     step asked for, so either is a clean failure. */

  /** The conversation windows LinkedIn docks at the bottom of the page. */
  function overlays() {
    return [...document.querySelectorAll(
      '.msg-overlay-conversation-bubble, [data-msg-overlay-conversation-bubble], .msg-convo-wrapper, [role="dialog"]',
    )].filter(visible);
  }

  function overlayTitle(el) {
    const head = el.querySelector(
      '.msg-overlay-bubble-header__title, .msg-overlay-bubble-header, header, h2, h3',
    );
    return norm(head?.innerText || head?.textContent || '');
  }

  /** The window whose header names this person, not one left open for someone else. */
  function overlayFor(name) {
    const wanted = norm(name);
    const first = wanted.split(' ')[0];
    if (!wanted) return null;
    const all = overlays();
    return all.find((el) => overlayTitle(el).includes(wanted))
      || (first.length > 1 ? all.find((el) => overlayTitle(el).split(' ').includes(first)) : null)
      || null;
  }

  /** A subject line means InMail, which spends credits the step never asked for. */
  function isInMail(root) {
    return !!root?.querySelector(
      'input[name="subject"], input[placeholder*="ubject"], .msg-form__subject, [aria-label="Subject"]',
    );
  }

  async function message(text, contactName) {
    if (!text || !text.trim()) return { ok: false, reason: 'No message text on the step' };

    const card = topCard();
    if (!card) return { ok: false, reason: 'Could not find the profile card on this page' };
    const name = contactName || profileHeading()?.innerText || '';

    const btn = buttonByText([/^message$/, /^message .*/], card);
    if (!btn) return { ok: false, reason: 'Not connected yet — no Message button' };
    btn.click();

    const overlay = await waitFor(() => {
      const mine = overlayFor(name);
      if (mine) return mine;
      // InMail opens as its own dialog, sometimes without the name in it.
      return overlays().find(isInMail) || null;
    }, 8000);
    if (!overlay) return { ok: false, reason: `The conversation with ${name || 'this person'} did not open` };
    if (isInMail(overlay)) {
      return { ok: false, reason: 'LinkedIn offered InMail instead of a message, which costs credits. Nothing was sent.' };
    }

    const box = await waitFor(
      () => overlay.querySelector('div.msg-form__contenteditable[contenteditable="true"], div[role="textbox"][contenteditable="true"]'),
      8000,
    );
    if (!box) return { ok: false, reason: 'Message box did not open' };

    box.focus();
    await beat();
    // execCommand is deprecated but is the one path LinkedIn's editor reacts
    // to consistently — setting textContent leaves Send disabled.
    document.execCommand('insertText', false, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await beat();

    const send = await waitFor(() => {
      const el = buttonByText([/^send$/], overlay);
      return el && !el.disabled ? el : null;
    }, 6000);
    if (!send) return { ok: false, reason: 'Send never became available' };
    send.click();
    await sleep(1200);

    const blocked = blocker();
    return blocked ? stopped(blocked) : { ok: true };
  }

  /* ── Visit ────────────────────────────────────────────────────────────
     Loading the page is the action. Staying a moment and scrolling makes it
     register as a real view rather than a bounce. */
  async function visit() {
    await sleep(2500 + Math.random() * 3000);
    window.scrollTo({ top: 400 + Math.random() * 600, behavior: 'smooth' });
    await sleep(1500);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'AGENT_ACT') return false;

    (async () => {
      const blocked = blocker();
      if (blocked) { sendResponse(stopped(blocked)); return; }

      // Let the page settle. Acting on a half-rendered profile is how you end
      // up clicking the wrong button.
      await sleep(1200 + Math.random() * 1500);

      try {
        const { channel, message: text, contact_name: contactName } = msg.action || {};
        if (channel === 'linkedin_connect') sendResponse(await connect(text));
        else if (channel === 'linkedin_message') sendResponse(await message(text, contactName));
        else if (channel === 'linkedin_visit') sendResponse(await visit());
        else sendResponse({ ok: false, reason: `Unknown action: ${channel}` });
      } catch (err) {
        sendResponse({ ok: false, reason: String(err?.message || err) });
      }
    })();

    return true; // keeps the channel open for the async reply
  });
})();

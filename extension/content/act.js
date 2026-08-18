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
 */

(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** The pause a person takes between seeing something and acting on it. */
  const beat = () => sleep(400 + Math.random() * 1400);

  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /**
   * Find a button by the words on it, which outlive class-name churn.
   *
   * Each label is tested on its own, and that is the whole point. LinkedIn's
   * controls carry visible text and an aria-label that say different things —
   * Connect reads "Connect" and is labelled "Invite Rowan Fitz to connect";
   * Send reads "Send" and is labelled "Send now". Joining them first gives
   * "connect invite rowan fitz to connect", which matches neither /^connect$/
   * nor /^invite .* to connect$/, so the agent reported "No Connect button on
   * this profile" for a profile that plainly had one — and, because the
   * already-connected check is also an anchored match, reported the same
   * thing for people the account was connected to already.
   */
  function buttonByText(patterns) {
    for (const el of document.querySelectorAll('button, a[role="button"]')) {
      if (!visible(el)) continue;
      const labels = [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title')]
        .map((raw) => String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase())
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

  /** Anything that means "stop", rather than "try again". */
  function blocker() {
    if (/\/checkpoint\/|\/authwall|\/uas\/login/.test(location.href)) {
      return 'LinkedIn asked for verification — clear it in your browser and the agent resumes.';
    }
    const body = (document.body?.innerText || '').toLowerCase();
    if (body.includes('reached the weekly invitation limit')) {
      return 'Weekly invitation limit reached — invites resume next week.';
    }
    if (body.includes('your account has been restricted') || body.includes('we restricted your account')) {
      return 'LinkedIn has restricted this account — the agent has stopped.';
    }
    return null;
  }

  /* ── Connection request ───────────────────────────────────────────────
     Connect sits on the profile sometimes and behind "More" others. Both
     are normal, so both are tried before giving up. */
  async function connect(note) {
    if (buttonByText([/^pending/, /invitation sent/])) return { ok: true, already: true };
    // Already connected: Message is present and Connect isn't. Nothing to
    // send, and the sequence should move on rather than treat this as failure.
    if (buttonByText([/^message$/]) && !buttonByText([/^connect$/])) {
      return { ok: true, already: true };
    }

    let btn = buttonByText([/^connect$/, /^invite .* to connect$/]);
    if (!btn) {
      const more = buttonByText([/^more actions$/, /^more$/]);
      if (more) {
        more.click();
        await beat();
        btn = buttonByText([/^connect$/, /^invite .* to connect$/]);
      }
    }
    if (!btn) return { ok: false, reason: 'No Connect button on this profile' };

    btn.click();
    await beat();

    if (note && note.trim()) {
      const addNote = await waitFor(() => buttonByText([/add a note/]), 5000);
      if (addNote) {
        addNote.click();
        await beat();
        const field = await waitFor(
          () => document.querySelector('textarea[name="message"], textarea#custom-message, #custom-message'),
          5000,
        );
        if (field) {
          // Through the native setter, so React sees it. Assigning .value
          // directly leaves React's internal state on the old value and the
          // note sends empty.
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value',
          ).set;
          setter.call(field, note.slice(0, 300));
          field.dispatchEvent(new Event('input', { bubbles: true }));
          await beat();
        }
      }
    }

    const send = await waitFor(
      () => buttonByText([/^send$/, /^send invitation$/, /^send now$/, /^send without a note$/]),
      6000,
    );
    if (!send) return { ok: false, reason: 'Could not find the Send button' };
    send.click();
    await sleep(1500);

    const blocked = blocker();
    return blocked ? { ok: false, reason: blocked, fatal: true } : { ok: true };
  }

  /* ── Message ──────────────────────────────────────────────────────────
     Only works with an existing connection. LinkedIn hides Message
     otherwise, or offers InMail — which costs credits and isn't what the
     step asked for, so a missing button is a clean failure. */
  async function message(text) {
    if (!text || !text.trim()) return { ok: false, reason: 'No message text on the step' };

    const btn = buttonByText([/^message$/, /^message .*/]);
    if (!btn) return { ok: false, reason: 'Not connected yet — no Message button' };
    btn.click();

    const box = await waitFor(
      () => document.querySelector(
        'div.msg-form__contenteditable[contenteditable="true"], div[role="textbox"][contenteditable="true"]',
      ),
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
      const el = buttonByText([/^send$/]);
      return el && !el.disabled ? el : null;
    }, 6000);
    if (!send) return { ok: false, reason: 'Send never became available' };
    send.click();
    await sleep(1200);

    const blocked = blocker();
    return blocked ? { ok: false, reason: blocked, fatal: true } : { ok: true };
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
      if (blocked) { sendResponse({ ok: false, reason: blocked, fatal: true }); return; }

      // Let the page settle. Acting on a half-rendered profile is how you end
      // up clicking the wrong button.
      await sleep(1200 + Math.random() * 1500);

      try {
        const { channel, message: text } = msg.action || {};
        if (channel === 'linkedin_connect') sendResponse(await connect(text));
        else if (channel === 'linkedin_message') sendResponse(await message(text));
        else if (channel === 'linkedin_visit') sendResponse(await visit());
        else sendResponse({ ok: false, reason: `Unknown action: ${channel}` });
      } catch (err) {
        sendResponse({ ok: false, reason: String(err?.message || err) });
      }
    })();

    return true; // keeps the channel open for the async reply
  });
})();

/* ═══════════════════════════════════════════════════════════════════════
   Keyboard rules shared by everything that binds a global key.

   Both guards existed three times over — once in AppLayout, once in
   SidebarContext, once implied wherever else somebody added a listener.
   Three copies of "is the user typing right now?" is three chances for one
   of them to say no while somebody is halfway through an email address.
   ═══════════════════════════════════════════════════════════════════════ */

/** Focus is somewhere that swallows plain letters. */
export function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * A dialog is up.
 *
 * Global shortcuts must not fire behind one — focus resting on a button
 * inside a modal would otherwise let `n` navigate away and discard whatever
 * the modal was holding.
 */
export function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null;
}

/* ── Multi-stroke sequences ───────────────────────────────────────────── */

/**
 * When the app is waiting for the second stroke of a `g` sequence.
 *
 * MEASURED: `g` then `e` in the Unibox ARCHIVED THE OPEN CONVERSATION.
 * Not a near miss - a live bug, today. The go-to sequence is handled in
 * AppLayout and every page-level shortcut is its own window listener, so
 * both hear the second stroke: AppLayout finds no `e` in its map and gives
 * up, and the Unibox treats the same keypress as its own archive key.
 * Pressing `g`, changing your mind, and pressing anything at all ran
 * whatever that key meant on the page behind.
 *
 * It is module state rather than context because the listeners that need
 * it are plain `window` handlers in a dozen files, and a context would
 * mean re-rendering all of them to carry a fact that changes for 1.4
 * seconds and is read synchronously inside an event.
 *
 * A DEADLINE rather than a boolean: a flag left standing by an unmounted
 * component, a lost keyup or an alt-tab would deafen the whole app to
 * every shortcut it has, with nothing on screen to explain it. The worst
 * a stale deadline can do is expire.
 */
let sequenceUntil = 0;

/** A prefix key was pressed: the next stroke belongs to the sequence. */
export function holdKeySequence(ms: number): void {
  sequenceUntil = Date.now() + ms;
}

/** The sequence resolved or was abandoned. */
export function releaseKeySequence(): void {
  sequenceUntil = 0;
}

export function isKeySequencePending(): boolean {
  return Date.now() < sequenceUntil;
}

/**
 * Neither typing, nor behind a dialog, nor mid-sequence: safe to treat a
 * bare key as a command.
 */
export function acceptsShortcut(target: EventTarget | null): boolean {
  return !isTypingTarget(target) && !isModalOpen() && !isKeySequencePending();
}

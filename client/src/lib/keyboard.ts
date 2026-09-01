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

/** Neither typing nor behind a dialog: safe to treat a bare key as a command. */
export function acceptsShortcut(target: EventTarget | null): boolean {
  return !isTypingTarget(target) && !isModalOpen();
}

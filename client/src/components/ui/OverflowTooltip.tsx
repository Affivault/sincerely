import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ═══════════════════════════════════════════════════════════════════════
   If a value is cut off, you can read it.

   MEASURED BEFORE THIS LANDED: 246 elements in this app use `truncate`
   or `line-clamp`. FIVE of them carried a title. So the other 241 ended
   in an ellipsis and there was no way at all to see the rest - and in an
   outreach CRM the clipped string IS the record: the address you are
   writing to, the company, the subject line of the reply you are triaging.
   The only way to read a cut-off value was to open the thing it belonged
   to and come back.

   WHY THIS IS ONE LISTENER AND NOT 241 EDITS

   The obvious fix is `title={x}` on every one of them. It is 241 edits
   that must each pick the right string out of the JSX, it misses every
   element written afterwards, and a title is wrong on the majority of
   those elements most of the time: `truncate` says "clip IF too long",
   and text that fits needs no tooltip at all. A blanket title gives you a
   tooltip on everything, which is noise, and noise gets ignored.

   So this measures instead. On hover or focus it asks the element whether
   it is ACTUALLY clipped - scrollWidth past clientWidth, or scrollHeight
   past clientHeight for a clamp - and only then offers the full text.
   Nothing to add at a call site, and it covers everything written later.

   WHY NOT THE NATIVE title ATTRIBUTE

   It never appears on keyboard focus, so it would help nobody navigating
   without a mouse; it waits about a second; and it is an OS tooltip in
   the middle of an app that has a designed surface for everything else.
   ═══════════════════════════════════════════════════════════════════════ */

/** How long a pointer must rest before the full value appears. */
const HOVER_DELAY_MS = 350;

/** Classes that mean "this may be visually cut off". */
const CLIPPED = /(^|\s)(truncate|text-ellipsis|line-clamp-\d+)(\s|$)/;

interface Shown { text: string; rect: DOMRect }

/**
 * Whether an element's content is genuinely wider or taller than its box.
 *
 * The +1 is not superstition: sub-pixel layout means a comfortably fitting
 * element frequently reports a scrollWidth a fraction above its
 * clientWidth, and without the tolerance a third of the app would sprout
 * tooltips for text that is plainly readable.
 */
function isClipped(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

/**
 * Mounted once at the app shell. Renders nothing until something is cut off.
 */
export function OverflowTooltip() {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const cancel = () => {
      if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
      setShown(null);
    };

    const consider = (target: EventTarget | null, immediate: boolean) => {
      const el = target as HTMLElement | null;
      if (!el || typeof el.closest !== 'function') return;

      const clipped = el.closest<HTMLElement>('.truncate, .text-ellipsis, [class*="line-clamp-"]');
      if (!clipped || !CLIPPED.test(clipped.className || '')) return;

      // Something that already explains itself is left alone: the five
      // existing titles, and any input whose own value is visible on click.
      if (clipped.hasAttribute('title') || clipped.closest('input, textarea')) return;

      const text = (clipped.innerText || clipped.textContent || '').trim();
      if (!text || !isClipped(clipped)) return;

      const show = () => setShown({ text, rect: clipped.getBoundingClientRect() });
      if (immediate) show();
      else timer.current = window.setTimeout(show, HOVER_DELAY_MS);
    };

    const onOver = (e: Event) => { cancel(); consider(e.target, false); };
    // Keyboard navigation gets it without the delay - arriving on a field
    // by Tab is already a deliberate act, unlike a pointer crossing one.
    const onFocus = (e: Event) => { cancel(); consider(e.target, true); };

    document.addEventListener('pointerover', onOver, { passive: true, capture: true });
    document.addEventListener('pointerdown', cancel, { passive: true, capture: true });
    document.addEventListener('focusin', onFocus, { passive: true, capture: true });
    document.addEventListener('focusout', cancel, { passive: true, capture: true });
    // A tooltip anchored to a rect is wrong the moment anything moves.
    window.addEventListener('scroll', cancel, { passive: true, capture: true });
    window.addEventListener('resize', cancel, { passive: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    document.addEventListener('keydown', onKey);

    return () => {
      cancel();
      document.removeEventListener('pointerover', onOver, { capture: true } as any);
      document.removeEventListener('pointerdown', cancel, { capture: true } as any);
      document.removeEventListener('focusin', onFocus, { capture: true } as any);
      document.removeEventListener('focusout', cancel, { capture: true } as any);
      window.removeEventListener('scroll', cancel, { capture: true } as any);
      window.removeEventListener('resize', cancel);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!shown) return null;

  /*
   * Above the element if there is room, below if there is not, and never
   * off the side. A tooltip that explains a value by going off-screen has
   * not explained anything.
   */
  const MARGIN = 8;
  const above = shown.rect.top > 120;
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.max(MARGIN, Math.min(shown.rect.left, window.innerWidth - 360 - MARGIN)),
    maxWidth: 360,
    ...(above
      ? { top: shown.rect.top - MARGIN, transform: 'translateY(-100%)' }
      : { top: shown.rect.bottom + MARGIN }),
  };

  return createPortal(
    <div
      style={style}
      className="pointer-events-none z-[90] rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-body leading-snug text-[var(--text-primary)] shadow-[var(--shadow-lg)]"
      role="tooltip"
      data-overflow-tooltip
    >
      {/* The whole value, wrapped. Truncating the thing that exists to
          show an untruncated value would be absurd, but a pathological
          string still must not cover the screen. */}
      <span className="block max-h-40 overflow-hidden whitespace-pre-wrap break-words">
        {shown.text}
      </span>
    </div>,
    document.body,
  );
}

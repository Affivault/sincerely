import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   Give a region the height that is actually left on the screen.

   A kanban column that is `max-h-full` inside an auto-height parent is
   unbounded: `max-height: 100%` resolves against a parent that is itself
   sized by its content, so it never constrains anything. The column grows
   to fit every card, its `overflow-y: auto` never has anything to scroll,
   and the board turns into a two-thousand-pixel wall that takes the stage
   headers, the totals and the filter bar off the top of the screen with it.

   The fix has to come from the viewport, and the viewport is not something
   CSS can hand to an element sitting an unknown distance down the page. So
   it is measured: where does this element start in the document, and how
   much room is below it.

   Deliberately measured against the document rather than the current
   scroll position. Using `rect.top` alone would make the height depend on
   how far the page happens to be scrolled, which means the board resizes
   while you scroll it — the answer has to be stable.
   ═══════════════════════════════════════════════════════════════════════ */

interface Options {
  /** Breathing room between the bottom of the region and the window edge. */
  gap?: number;
  /**
   * Never shrink below this. On a short window the page will scroll instead,
   * which is the right trade: a 120px-tall board is worse than a scrollbar.
   */
  min?: number;
}

export function useFillViewport<T extends HTMLElement>({ gap = 24, min = 360 }: Options = {}) {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Where the element starts in the document, independent of scroll.
    const documentTop = el.getBoundingClientRect().top + window.scrollY;
    const available = window.innerHeight - documentTop - gap;
    setHeight(Math.round(Math.max(min, available)));
  }, [gap, min]);

  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    window.addEventListener('resize', measure);

    /*
     * Everything above the region can change height without the region
     * moving in the DOM — a filter row wrapping onto two lines, the bulk
     * bar appearing, an alert being dismissed. Watching the region's own
     * offset is not enough, so watch the page box it lives in.
     */
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      const parent = el.parentElement;
      if (parent) observer.observe(parent);
      observer.observe(document.documentElement);
    }

    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure]);

  return { ref, height, remeasure: measure };
}

/* ═══════════════════════════════════════════════════════════════════════
   Drag a card past the bottom of a column and the column should follow.

   Once columns scroll, a drag can reach cards that are off-screen — and
   without this there is no way to get to them, because the pointer is
   already held down and the wheel is not a drag gesture in every browser.
   ═══════════════════════════════════════════════════════════════════════ */

const EDGE = 56;   // how close to an edge counts as "at the edge"
const SPEED = 14;  // pixels per frame at the very edge

/** Scroll `el` vertically when the pointer is near its top or bottom edge. */
export function autoScrollY(el: HTMLElement | null, clientY: number) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (clientY < r.top + EDGE) {
    el.scrollTop -= SPEED * Math.min(1, (r.top + EDGE - clientY) / EDGE);
  } else if (clientY > r.bottom - EDGE) {
    el.scrollTop += SPEED * Math.min(1, (clientY - (r.bottom - EDGE)) / EDGE);
  }
}

/** Scroll `el` horizontally when the pointer is near its left or right edge. */
export function autoScrollX(el: HTMLElement | null, clientX: number) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (clientX < r.left + EDGE) {
    el.scrollLeft -= SPEED * Math.min(1, (r.left + EDGE - clientX) / EDGE);
  } else if (clientX > r.right - EDGE) {
    el.scrollLeft += SPEED * Math.min(1, (clientX - (r.right - EDGE)) / EDGE);
  }
}

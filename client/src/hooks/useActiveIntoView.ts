import { useEffect, useRef } from 'react';

/**
 * Keeps the current item of a horizontally scrolling strip in view.
 *
 * On a phone the settings menu and the section tabs scroll sideways, and
 * the page you were on could sit off the edge - "Email a..." cut in half,
 * as if you were somewhere else. Scrolls the strip, never the page.
 */
export function useActiveIntoView<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const strip = ref.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const active = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    const left = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
  }, [key]);
  return ref;
}

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the person has asked their system for less motion.
 *
 * index.css already switches CSS animation and transition off under this
 * media query, but Recharts animates in JavaScript (requestAnimationFrame
 * interpolating SVG attributes), which CSS cannot reach. Charts pass
 * `isAnimationActive={!reduced}` so they draw in their final state instead.
 *
 * Follows the setting live: flipping it in the OS while the page is open
 * takes effect without a reload.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(QUERY).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

import { lazy, type ComponentType } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   Route chunks start downloading when you look at a link, not when you
   click it.

   Every screen in this app is a separate chunk - which is why the first
   paint is small, and also why the SECOND paint has a gap in it. Clicking
   Campaigns downloads 41 kB, Inbox 117 kB, Compose 125 kB, and the route
   skeleton sits there until it lands. On an ordinary connection that is
   150-400 ms of nothing happening after a click, every time, on a link the
   pointer had already been resting on for half a second.

   That resting half-second is the fix. Moving a pointer onto a link, or
   tabbing onto it, is a reliable signal that a click is coming, and it
   arrives 200-400 ms early - which is most of the gap. So the chunk is
   requested on hover and by the time the click lands it is usually in the
   module cache and the page renders on the same frame.

   ONE LISTENER, NOT A SWEEP
   -------------------------
   The obvious implementation is a <PrefetchLink> and a hundred call sites
   changed to use it, which works until somebody writes a plain <Link>,
   which is immediately and forever. This listens at the document instead
   and reads the href off whatever was hovered, so it covers every link in
   the app including the ones not written yet, and there is no call site to
   keep in step.

   WHAT IT WILL NOT DO
   -------------------
   Prefetching spends somebody else's bandwidth on a guess. On a metered or
   slow connection that is a bad trade, so it does not happen at all - see
   worthPrefetching. There is a cap for the same reason: dragging a pointer
   down the sidebar crosses fifteen links in under a second and none of
   those are intent.
   ═══════════════════════════════════════════════════════════════════════ */

/** path pattern (as written in App.tsx) -> the route's dynamic import. */
const routes = new Map<string, () => Promise<unknown>>();

/** Patterns already asked for. A chunk is only ever fetched once. */
const asked = new Set<string>();

/**
 * How many speculative fetches this page load is allowed.
 *
 * Twelve is roughly "the sidebar, if you read all of it" - enough that
 * normal browsing never hits the cap, low enough that a pointer dragged
 * across the nav does not pull down the entire application.
 */
const MAX_PREFETCHES = 12;

/**
 * Declare a route and its chunk in one place.
 *
 * The path given here is the same string the <Route> uses, and
 * first-paint-check.mts fails the build if the two ever disagree - a
 * prefetch registered under a path nothing routes to is dead weight that
 * downloads the wrong screen, and it is invisible until you measure.
 */
export function lazyRoute<M>(
  path: string | string[],
  load: () => Promise<M>,
  pick: (m: M) => ComponentType<any>,
): ComponentType<any> {
  // A handful of screens answer to more than one path - the contacts list
  // is both /leads and /contacts, the campaign editor is both /campaigns/new
  // and /campaigns/:id/edit - and a link to the second one has to warm the
  // same chunk as a link to the first.
  for (const p of Array.isArray(path) ? path : [path]) routes.set(p, load);
  return lazy(() => load().then((m) => ({ default: pick(m) })));
}

/** Whether a pattern segment stands in for anything: `:id`, `:slug`. */
const isParam = (seg: string) => seg.startsWith(':');

/**
 * Which registered pattern a real href belongs to.
 *
 * `/deals/8f21` has to find `/deals/:id`, or every link into a detail page
 * misses. Segment count first, then segment-by-segment with parameters
 * matching anything - the same rule the router uses, and small enough that
 * it cannot drift from it in a way that matters here (a wrong answer costs
 * a prefetch, not a navigation).
 */
export function matchRoute(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  let best: string | null = null;

  for (const pattern of routes.keys()) {
    const pp = pattern.split('/').filter(Boolean);
    if (pp.length !== parts.length) continue;
    if (!pp.every((seg, i) => isParam(seg) || seg === parts[i])) continue;
    /*
     * Fewest wildcards wins, and this is not a refinement.
     *
     * /deals/:id and /deals/insights are the same shape, and /deals/:id is
     * declared first in App.tsx - so taking the first match would hover
     * Insights and download the deal detail page instead. That is a wasted
     * request and a missing one at the same time, from a link that looks
     * like it is working, which is the failure mode this whole file has to
     * be careful about: prefetching correctly and prefetching the wrong
     * thing look identical from the outside.
     *
     * There was a `routes.has(pathname)` short-circuit above this that
     * made the same decision first. It was removed rather than kept as a
     * second opinion - two rules that agree are the state immediately
     * before one of them is edited, and the harness proved this one was
     * never running.
     */
    if (!best || pp.filter(isParam).length < best.split('/').filter(isParam).length) {
      best = pattern;
    }
  }
  return best;
}

/**
 * Whether speculating is fair on this connection.
 *
 * Save-Data is an explicit request not to spend bandwidth on things the
 * person did not ask for, and this is exactly that. The slow effective
 * types are the same judgement made for them: on 2G a speculative 117 kB
 * competes with the page they are actually waiting for, and prefetching
 * would make the app slower, not faster.
 */
function worthPrefetching(): boolean {
  const c = (navigator as any).connection;
  if (!c) return true;
  if (c.saveData) return false;
  return !/^(slow-)?2g$/.test(c.effectiveType || '');
}

/**
 * Start fetching the chunk behind an in-app href, at most once.
 *
 * Exported so a screen can warm a destination it knows is next - a wizard
 * warming its own final step, for instance - without going through a
 * hover.
 */
export function prefetchHref(href: string): void {
  if (asked.size >= MAX_PREFETCHES) return;
  if (!worthPrefetching()) return;

  let pathname: string;
  try {
    // Relative hrefs, query strings and hashes all resolve here. A link to
    // another origin throws nothing but produces a different origin, which
    // is caught below.
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    pathname = url.pathname;
  } catch {
    return;
  }

  // The screen you are already on is already loaded.
  if (pathname === window.location.pathname) return;

  const pattern = matchRoute(pathname);
  if (!pattern || asked.has(pattern)) return;

  const load = routes.get(pattern);
  if (!load) return;

  asked.add(pattern);
  // A failed speculative fetch is not an event. React.lazy will ask again
  // on navigation and that failure has somewhere to be shown.
  void load().catch(() => { asked.delete(pattern); });
}

/**
 * Listen for intent, once, for the life of the app.
 *
 * `pointerover` covers mouse and pen and fires on the way in rather than
 * on the way out. `focusin` covers keyboard navigation, which otherwise
 * gets none of this. `touchstart` is the touch equivalent and buys the
 * ~120 ms between a finger landing and lifting.
 *
 * Returns its own teardown so the caller's effect can clean up; in
 * practice the app shell mounts it once and never unmounts.
 */
export function listenForRouteIntent(): () => void {
  const onIntent = (e: Event) => {
    const el = e.target as Element | null;
    if (!el || typeof (el as any).closest !== 'function') return;
    const a = el.closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    prefetchHref(a.getAttribute('href') || '');
  };

  document.addEventListener('pointerover', onIntent, { passive: true, capture: true });
  document.addEventListener('focusin', onIntent, { passive: true, capture: true });
  document.addEventListener('touchstart', onIntent, { passive: true, capture: true });

  return () => {
    document.removeEventListener('pointerover', onIntent, { capture: true } as any);
    document.removeEventListener('focusin', onIntent, { capture: true } as any);
    document.removeEventListener('touchstart', onIntent, { capture: true } as any);
  };
}

/** Test and diagnostics seam: which patterns are registered. */
export function registeredRoutes(): string[] {
  return [...routes.keys()];
}

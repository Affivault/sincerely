import { lazy, type ComponentType } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   A tab left open across a deploy.

   Every screen is its own chunk with a content hash in its name
   (ContactsListPage-BtAfMcOk.js). A deploy replaces those files with new
   hashes. A tab that loaded the app before the deploy still holds the old
   index, so the first time it opens a screen it has not visited yet it asks
   for a file that no longer exists, and the import fails with "Failed to
   fetch dynamically imported module".

   Nothing is broken except that tab's idea of which files exist. Reloading
   picks up the new index and the click works. So that is what happens: a
   chunk that fails to load reloads the page once, quietly, on the same URL
   the person was going to. They see a slightly slower navigation, not an
   error.

   Guarded against loops. If a reload happened moments ago and a chunk still
   fails, the cause is something a reload will not fix (offline, an outage),
   and the error boundary shows a plain explanation with a Reload button
   instead of the page reloading forever.
   ═══════════════════════════════════════════════════════════════════════ */

const KEY = 'sincerely:chunk-reload-at';
/** A second failure inside this window after an automatic reload is not a stale tab. */
const WINDOW_MS = 15_000;

/** The messages browsers use for a dynamic import that could not be fetched. */
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (CSS )?chunk [\w-]+ failed|ChunkLoadError|'text\/html' is not a valid JavaScript MIME type/i;

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: unknown; message?: unknown };
  const text = `${typeof e.name === 'string' ? e.name : ''} ${typeof e.message === 'string' ? e.message : String(err)}`;
  return CHUNK_ERROR.test(text);
}

/**
 * Reload to pick up the current deploy, unless that was just tried.
 * Returns true when a reload is under way.
 */
export function reloadForNewVersion(): boolean {
  // Offline, a reload swaps the app for the browser's offline page.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (last && Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // No session storage means no loop guard, so no automatic reload.
    // The error boundary still offers one by hand.
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * Wrap a dynamic import so a stale chunk reloads the page instead of failing.
 * While the reload is under way the promise never settles, so the Suspense
 * fallback stays on screen rather than an error flashing up first.
 */
export function withChunkReload<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((err: unknown) => {
      if (isChunkLoadError(err) && reloadForNewVersion()) {
        return new Promise<T>(() => {});
      }
      throw err;
    });
}

/** React.lazy for a named export, with the stale-chunk reload built in. */
export function lazyNamed<M, P = any>(
  load: () => Promise<M>,
  pick: (m: M) => ComponentType<P>,
): ComponentType<P> {
  return lazy(withChunkReload(() => load().then((m) => ({ default: pick(m) })))) as unknown as ComponentType<P>;
}

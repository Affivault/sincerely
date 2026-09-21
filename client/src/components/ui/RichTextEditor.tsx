import { lazy, Suspense, useCallback, useState } from 'react';
import type { RichTextEditorProps } from './RichTextEditor.types';

export type { RichTextEditorProps, Template } from './RichTextEditor.types';

/* ═══════════════════════════════════════════════════════════════════════
   The door to the editor.

   MEASURED BEFORE THIS LANDED: 1,113 kB of JavaScript was fetched and
   parsed before the first screen of this app appeared, and 366 kB of it -
   one third - was ProseMirror. It was on the critical path of the LOGIN
   page, the landing page and the booking pages, none of which contain an
   editor, because index.html carried a modulepreload for it.

   The route that put it there was five ordinary imports long and every
   link in it was correct: AppLayout mounts the peek drawer, the drawer
   shows contact history, history offers a quick reply, a reply needs an
   editor. Nobody imported a word processor into the login page. It just
   turned out that they had.

   So the implementation moved behind a dynamic import and this stayed
   behind - a file with no ProseMirror in it, which every existing call
   site keeps importing exactly as before.

   THE PART THAT MATTERS AS MUCH AS THE SPLIT
   ------------------------------------------
   Deferring something until it is needed makes the first paint faster and
   the first CLICK slower, and that trade is usually a bad one: waiting for
   a text box after you have already decided to write is worse than waiting
   once at the start. So it is not deferred until needed - it is fetched
   during the first idle moment after the app shell mounts (see
   warmRichTextEditor, called from AppLayout). By the time anyone opens a
   composer the chunk is in the module cache and it mounts synchronously.

   The result is that the editor costs nothing on the way in and nothing on
   the way to using it. The fallback below exists for the narrow case of
   clicking Reply within the first second on a slow connection, and it is
   drawn at the exact size of the editor so that nothing moves when the
   real one arrives.
   ═══════════════════════════════════════════════════════════════════════ */

const load = () => import('./RichTextEditorImpl');
const Impl = lazy(load);

/** Whether the chunk has been asked for yet. Idempotent by design. */
let warming: Promise<unknown> | null = null;

/**
 * Fetch the editor during idle time, off the critical path.
 *
 * Called once from the app shell, which only mounts for a signed-in
 * session - so the login and landing pages, which have no editor on them,
 * never fetch one. Safe to call repeatedly; the import is cached and the
 * promise is kept so concurrent callers share it.
 *
 * Failure is swallowed on purpose. This is a head start, not a load: if
 * the network drops the request, the Suspense boundary below will ask for
 * it again when somebody actually opens a composer, and THAT failure is
 * the one worth surfacing.
 */
export function warmRichTextEditor(): void {
  if (warming) return;
  if (typeof window === 'undefined') return;
  const go = () => { warming = load().catch(() => { warming = null; }); };
  const idle = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => void)
    | undefined;
  // Safari has no requestIdleCallback. A timeout is a poor substitute for
  // "when the main thread is free", but it is still after first paint,
  // which is the only property this actually depends on.
  if (idle) idle(go, { timeout: 4000 });
  else window.setTimeout(go, 1200);
}

/**
 * The editor's shape with nothing in it.
 *
 * A spinner here would be the wrong answer twice over: it says "wait" when
 * the wait is a few hundred milliseconds at worst, and it occupies no
 * space, so the page jumps when the editor lands. This holds the toolbar
 * strip and the body at their real heights instead.
 */
function EditorPlaceholder({ minHeight = '200px', bare = false }: { minHeight?: string; bare?: boolean }) {
  return (
    <div
      className={bare
        ? 'overflow-hidden'
        : 'overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]'}
      aria-busy
      data-editor-loading
    >
      <div className={`flex items-center gap-1.5 px-2 py-1.5 ${
        bare
          ? 'border-b border-[var(--border-subtle)]/60'
          : 'border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
      }`}>
        {/* Eleven stubs, the eleven toolbar buttons. The strip is the same
            height either way; matching the count keeps it from reflowing. */}
        {Array.from({ length: 11 }).map((_, i) => (
          <span
            key={i}
            className="h-6 w-6 flex-shrink-0 animate-pulse rounded-md bg-[var(--bg-hover)]"
            style={{ animationDelay: `${i * 40}ms` }}
          />
        ))}
      </div>
      <div style={{ minHeight }} className="px-4 py-3">
        <span className="block h-3 w-2/5 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
    </div>
  );
}

/**
 * Unchanged from every call site's point of view.
 *
 * The Suspense boundary is HERE rather than left to an ancestor on
 * purpose. Without it the first render of an editor suspends up to the
 * route boundary in App.tsx and replaces the whole page with a skeleton -
 * you press Reply and the mail you were replying to disappears.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense fallback={<EditorPlaceholder minHeight={props.minHeight} bare={props.bare} />}>
      <Impl {...props} />
    </Suspense>
  );
}

/**
 * HTML + plain text from the editor, tracked by the parent.
 *
 * Deliberately on this side of the split: it is four lines of React state
 * and touches no ProseMirror, and several screens call it at the top level
 * while their editor is closed. A hook cannot be lazy - if this lived in
 * the implementation, importing it would have dragged the whole chunk back
 * onto the critical path and quietly undone the split.
 */
export function useRichTextEditorRef() {
  const [html, setHtml] = useState('');
  const [text, setText] = useState('');

  const handleChange = useCallback((newHtml: string, newText: string) => {
    setHtml(newHtml);
    setText(newText);
  }, []);

  // Clears the tracked html/text independently of the mounted <RichTextEditor>.
  // Needed because this hook's state lives in the parent and is NOT reset just
  // by remounting/unmounting the editor element (e.g. via a changing `key`).
  const reset = useCallback(() => {
    setHtml('');
    setText('');
  }, []);

  return { html, text, handleChange, reset, isEmpty: !text.trim() };
}

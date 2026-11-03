import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/* ═══════════════════════════════════════════════════════════════════════
   Peek — open a record over whatever you're doing.

   State lives in the URL (`?peek=contact:<id>`) rather than in React state,
   for three reasons: a peek is shareable, back closes it, and any page can
   open one without threading props or a provider through the tree.
   ═══════════════════════════════════════════════════════════════════════ */

export type PeekType = 'contact' | 'deal' | 'company';

export interface PeekTarget { type: PeekType; id: string }

const PARAM = 'peek';
const VALID: PeekType[] = ['contact', 'deal', 'company'];

export function parsePeek(raw: string | null): PeekTarget | null {
  if (!raw) return null;
  const idx = raw.indexOf(':');
  if (idx < 1) return null;
  const type = raw.slice(0, idx) as PeekType;
  const id = raw.slice(idx + 1);
  if (!VALID.includes(type) || !id) return null;
  return { type, id };
}

export function usePeek() {
  const [params, setParams] = useSearchParams();
  const target = useMemo(() => parsePeek(params.get(PARAM)), [params]);

  const openPeek = useCallback((type: PeekType, id: string) => {
    const next = new URLSearchParams(params);
    next.set(PARAM, `${type}:${id}`);
    // A peek is a detour, not a destination — replacing keeps the back
    // button meaning "leave this page", not "step back through peeks".
    setParams(next, { replace: true });
  }, [params, setParams]);

  const closePeek = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete(PARAM);
    setParams(next, { replace: true });
  }, [params, setParams]);

  return { target, openPeek, closePeek };
}

/* ── The list a peek was opened from ────────────────────────────────────
   So the drawer can step to the next or previous person without closing:
   the page that opens peeks publishes its current rows here (ids, in the
   order on screen), and the drawer reads them. A page that publishes
   nothing simply gets no arrows. */

type Sequence = { type: PeekType; ids: string[]; label: string };
let sequence: Sequence | null = null;
const listeners = new Set<() => void>();

export function setPeekSequence(next: Sequence | null): void {
  const same = sequence && next && sequence.type === next.type && sequence.label === next.label
    && sequence.ids.length === next.ids.length && sequence.ids.every((id, i) => id === next.ids[i]);
  if (same || (!sequence && !next)) return;
  sequence = next;
  listeners.forEach((l) => l());
}

export function getPeekSequence(): Sequence | null {
  return sequence;
}

export function subscribePeekSequence(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

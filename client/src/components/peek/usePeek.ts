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

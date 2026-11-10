import { useCallback, useEffect, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   Hiding the launch checklist on Home.

   The checklist retires by itself once every step is done, but some people
   would rather finish setup in their own order and not have the panel take
   up half of Home until then. This remembers that choice per user, in this
   browser, and Settings > Preferences can bring the panel back.

   Kept in localStorage rather than user_settings: it is a view preference,
   it needs no migration, and losing it only means the panel reappears.
   ═══════════════════════════════════════════════════════════════════════ */

const EVENT = 'sincerely:setup-checklist-hidden';

function keyFor(userId: string | undefined): string {
  return `home.setupChecklist.hidden:${userId ?? 'anon'}`;
}

export function readSetupChecklistHidden(userId: string | undefined): boolean {
  try {
    return localStorage.getItem(keyFor(userId)) === '1';
  } catch {
    return false;
  }
}

export function writeSetupChecklistHidden(userId: string | undefined, hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(keyFor(userId), '1');
    else localStorage.removeItem(keyFor(userId));
  } catch {
    /* storage blocked: the choice lasts for this page view only */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** The hidden flag for this user, kept in step across components and tabs. */
export function useSetupChecklistHidden(userId: string | undefined): [boolean, (hidden: boolean) => void] {
  const [hidden, setHiddenState] = useState(() => readSetupChecklistHidden(userId));

  useEffect(() => {
    const sync = () => setHiddenState(readSetupChecklistHidden(userId));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [userId]);

  const setHidden = useCallback(
    (next: boolean) => {
      setHiddenState(next);
      writeSetupChecklistHidden(userId, next);
    },
    [userId],
  );

  return [hidden, setHidden];
}

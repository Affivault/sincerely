import { useEffect, useState } from 'react';
import { Eye, X } from 'lucide-react';
import { endViewAs, viewAsSession } from '../../lib/viewAs';

/*
 * Shown on every page of a tab that is viewing the app as an account, so it
 * can never be mistaken for the owner's own. Read-only: the server refuses
 * every change made with the token.
 */
export function ViewAsBanner() {
  const [session, setSession] = useState(() => viewAsSession());
  const [, tick] = useState(0);
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => { tick((n) => n + 1); setSession(viewAsSession()); }, 15_000);
    return () => clearInterval(t);
  }, [session]);
  if (!session) return null;

  const mins = Math.max(0, Math.round((new Date(session.expires_at).getTime() - Date.now()) / 60_000));
  const exit = () => {
    endViewAs();
    window.close();
    // A tab the browser will not close goes back to the owner's admin.
    window.location.href = '/admin/accounts';
  };

  return (
    <div role="status" className="sticky top-0 z-50 flex items-center gap-3 px-4 py-2 bg-amber-400 text-amber-950 text-body font-medium">
      <Eye className="h-4 w-4 shrink-0" />
      <p className="flex-1 min-w-0 truncate">
        Viewing as <span className="font-semibold">{session.email}</span>. Read-only, ends in {mins} min.
      </p>
      <button onClick={exit} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-amber-950/10 hover:bg-amber-950/20">
        <X className="h-3.5 w-3.5" /> Exit
      </button>
    </div>
  );
}

import type { ReactNode } from 'react';
import { useIsOwner } from '../../hooks/useIsOwner';

/**
 * Setup detail meant for the people who run Sincerely - "migration 077",
 * a file name to paste into Supabase. Customers can do nothing with it, so
 * they never see it; the sentence beside it says what it means for them.
 */
export function ForOwner({ children }: { children: ReactNode }) {
  const { isOwner } = useIsOwner();
  if (!isOwner) return null;
  return <span className="ml-1 font-mono text-micro text-[var(--text-tertiary)]">(owner: {children})</span>;
}


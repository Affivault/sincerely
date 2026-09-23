import { useMemo } from 'react';
import { AlertTriangle, Crown, Users } from 'lucide-react';
import { buyingCommittee, type CommitteeStanding, type CompanyActivityMessage } from '@lemlist/shared';
import { usePeek } from '../peek/usePeek';
import { cn, formatRelativeTime } from '../../lib/utils';

const COLUMNS: { id: CommitteeStanding; label: string; tone: string }[] = [
  { id: 'engaged', label: 'Engaged', tone: 'text-emerald-600 dark:text-emerald-400' },
  { id: 'contacted', label: 'Contacted, no reply', tone: 'text-amber-600 dark:text-amber-400' },
  { id: 'untouched', label: 'Not contacted', tone: 'text-[var(--text-tertiary)]' },
];

/** The account's people by where they stand, with the gap named. */
export function BuyingCommitteeStrip({ contacts, messages }: {
  contacts: { id: string; email: string; first_name: string | null; last_name: string | null; job_title?: string | null }[];
  messages: CompanyActivityMessage[];
}) {
  const { openPeek } = usePeek();
  const c = useMemo(() => buyingCommittee(contacts, messages), [contacts, messages]);
  if (contacts.length === 0) return null;

  return (
    <div className="border-b border-[var(--border-subtle)] px-4 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <Users className="h-3 w-3" /> Buying committee
      </p>
      {c.gap && (
        <p className="mb-2.5 flex items-start gap-1.5 rounded-lg bg-amber-500/[0.07] px-2.5 py-1.5 text-caption text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />{c.gap}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {COLUMNS.map((col) => {
          const people = c.members.filter((m) => m.standing === col.id);
          return (
            <div key={col.id} className="min-w-0">
              <p className={cn('mb-1 text-caption font-semibold', col.tone)}>{col.label} · {people.length}</p>
              <ul className="space-y-0.5">
                {people.slice(0, 6).map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => openPeek('contact', m.id)}
                      className="flex w-full min-w-0 items-center gap-1 text-left text-caption text-[var(--text-secondary)] hover:text-[var(--indigo)]"
                      title={[m.job_title, m.last_inbound_at ? `last replied ${formatRelativeTime(m.last_inbound_at)}` : null].filter(Boolean).join(' · ')}
                    >
                      {m.seniority === 'decision_maker' && <Crown className="h-3 w-3 flex-shrink-0 text-amber-500" />}
                      <span className="truncate">{m.name}</span>
                      {m.job_title && <span className="truncate text-[var(--text-tertiary)]">· {m.job_title}</span>}
                    </button>
                  </li>
                ))}
                {people.length > 6 && <li className="text-caption text-[var(--text-tertiary)]">+{people.length - 6} more</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

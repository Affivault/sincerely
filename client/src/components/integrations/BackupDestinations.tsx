import { Link } from 'react-router-dom';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { ProviderTile, useBackupSummaries } from '../settings/BackupHub';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Integrations > Backup: the four places a backup can go, in one band,
   each saying whether it is set up. They are managed in Settings > Backup;
   this is the way in from where people look for connections.
   ═══════════════════════════════════════════════════════════════════════ */

const WORD: Record<string, { word: string; cls: string }> = {
  fresh: { word: 'Backing up', cls: 'text-emerald-700 dark:text-emerald-400' },
  writing: { word: 'Writing', cls: 'text-[var(--indigo-text)]' },
  stale: { word: 'Behind', cls: 'text-amber-700 dark:text-amber-300' },
  paused: { word: 'Paused', cls: 'text-[var(--text-tertiary)]' },
  stopped: { word: 'Needs attention', cls: 'text-rose-700 dark:text-rose-400' },
  off: { word: '', cls: '' },
};

export function BackupDestinations() {
  const { summaries } = useBackupSummaries();
  const live = summaries.filter((s) => s.health !== 'off').length;
  return (
    <section className="space-y-2.5" aria-label="Backup" data-integrations-backup>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-body font-medium text-[var(--text-tertiary)]">Backup</h2>
        <Link to="/settings?tab=backup" className="inline-flex items-center gap-1 text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          Manage backups <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border-subtle)] px-4 py-3">
          <ShieldCheck className={cn('h-4 w-4', live ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-tertiary)]')} />
          <p className="text-body text-[var(--text-secondary)]">
            {live
              ? <>Your leads, contacts and companies are copied to <strong className="font-semibold text-[var(--text-primary)]">{live === 1 ? 'one place' : `${live} places`}</strong> you own, and follow every change.</>
              : 'Keep a copy of your leads, contacts and companies somewhere you own. Each one follows every change on its own.'}
          </p>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-subtle)]">
          {summaries.map((s) => {
            const w = WORD[s.health];
            return (
              <li key={s.meta.id}>
                <Link
                  to={`/settings?tab=backup&provider=${s.meta.id}`}
                  className="group flex h-full flex-col gap-3 p-4 transition-colors hover:bg-[var(--bg-hover)]"
                  data-integration-backup={s.meta.id}
                >
                  <span className="flex items-center gap-3">
                    <ProviderTile id={s.meta.id} />
                    <span className="min-w-0">
                      <span className="block text-strong font-semibold leading-snug text-[var(--text-primary)]">{s.meta.name}</span>
                      <span className={cn('block text-caption', s.health === 'off' ? 'text-[var(--text-tertiary)]' : w.cls)}>
                        {s.health === 'off' ? 'Not set up' : w.word}
                      </span>
                    </span>
                  </span>
                  <span className="text-caption leading-relaxed text-[var(--text-secondary)]">{s.meta.tagline}. {s.meta.cadence}.</span>
                  <span className="mt-auto inline-flex items-center gap-1 text-caption font-semibold text-[var(--indigo-text)]">
                    {s.health === 'off' ? 'Set up' : 'Manage'}
                    <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

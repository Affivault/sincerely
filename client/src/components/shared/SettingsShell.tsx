import { type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { SETTINGS_GROUPS, locate } from '../../lib/sections';
import { InsetHeaderContext } from './PageHeader';
import { useActiveIntoView } from '../../hooks/useActiveIntoView';

/**
 * Unified settings workspace — everything you set up once (workspace,
 * sending and deliverability, data hygiene, connections) shares one shell
 * with a persistent grouped nav. AppLayout applies it to every settings
 * route, so no page can forget to; the groups come from lib/sections.
 */
const GROUPS = SETTINGS_GROUPS;

export function SettingsShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // One answer for "which item is this page", shared with the sidebar - so
  // the mailbox guide lights up Email accounts, not nothing.
  const current = locate(pathname).settings?.href ?? (pathname.startsWith('/smtp-accounts') ? '/email-accounts' : null);
  const strip = useActiveIntoView<HTMLElement>(current);
  return (
    <div className="flex gap-8 items-start">
      {/* Grouped settings nav — persistent across every admin page */}
      <aside className="hidden lg:block w-[216px] flex-shrink-0 sticky top-[calc(var(--chrome-h,56px)+16px)]">
        <h2 className="px-2.5 mb-4 text-title font-semibold text-[var(--text-primary)] tracking-[-0.015em]">Settings</h2>
        <nav className="space-y-5">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <p className="px-2.5 mb-1 text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">{g.label}</p>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <NavLink
                    key={it.href}
                    to={it.href}
                    className={() => cn(
                      'relative flex items-center gap-2.5 h-[30px] px-2.5 rounded-lg text-body font-medium border transition-colors',
                      current === it.href
                        // Raised-card active state — same language as the app sidebar
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-subtle)] shadow-[0_1px_2px_rgba(27,27,31,0.05)]'
                        : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {() => (
                      <>
                        <it.icon
                          className={cn('h-[15px] w-[15px] flex-shrink-0', current === it.href ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')}
                          strokeWidth={1.75}
                        />
                        <span className="truncate">{it.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Below the width where the grouped menu fits beside the page, the
            same links as one scrolling strip. The menu was simply hidden
            there, so on a phone or tablet the only way from General to Team
            was back out through the app menu. */}
        <nav ref={strip} className="lg:hidden -mx-4 sm:-mx-6 mb-4 flex gap-1.5 overflow-x-auto scrollbar-none px-4 sm:px-6 pb-1" aria-label="Settings">
          {GROUPS.flatMap((g) => g.items).map((it) => (
            <NavLink
              key={it.href}
              to={it.href}
              aria-current={current === it.href ? 'page' : undefined}
              className={() => cn(
                'inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-full border px-3 text-body font-medium transition-colors',
                current === it.href
                  ? 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(27,27,31,0.05)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <it.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <InsetHeaderContext.Provider value={true}>{children}</InsetHeaderContext.Provider>
      </div>
    </div>
  );
}

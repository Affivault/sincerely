import { Search, Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCommandPalette } from '../../context/CommandPaletteContext';
import { useSidebar } from '../../context/SidebarContext';
import { SincerelyLogo } from '../SincerelyLogo';
import { AccountMenu, CreateButton, CreateMenu } from './ShellMenus';

/** Height of the top bar, on the screens that have one. */
export const HEADER_H = 56;

/**
 * The top bar - on a phone or a narrow tablet only.
 *
 * On a desktop there is no top bar: the sidebar holds the logo, search,
 * Create and the account, and the page gets the full height of the
 * window. A bar across the top that held five small controls and a lot of
 * nothing was the first thing that made the app look like every other
 * admin template. Below the breakpoint the sidebar is a drawer, and
 * something has to open it - so the bar comes back, carrying only that.
 */
export function Header() {
  const { user } = useAuth();
  const { openPalette } = useCommandPalette();
  const { toggle, narrow, drawerOpen } = useSidebar();
  if (!narrow) return null;

  return (
    <header
      className="fixed top-0 inset-x-0 z-50 flex items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-app)]/90 backdrop-blur-xl px-2"
      style={{ height: HEADER_H }}
    >
      <button
        onClick={toggle}
        aria-label={drawerOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={drawerOpen}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        {drawerOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
      </button>
      <span className="flex items-center overflow-hidden"><SincerelyLogo /></span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={openPalette}
          aria-label="Search"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <Search className="h-[17px] w-[17px]" />
        </button>
        <CreateMenu placement="below-right" trigger={(t, o) => <CreateButton toggle={t} open={o} compact />} />
        <AccountMenu
          placement="below-right"
          trigger={(t) => (
            <button onClick={t} aria-label="Account" className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--text-primary)] text-caption font-semibold text-[var(--bg-surface)]">
              {user?.email?.charAt(0)?.toUpperCase() || 'U'}
            </button>
          )}
        />
      </div>
    </header>
  );
}

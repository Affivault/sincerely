import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ErrorBoundary } from '../ErrorBoundary';
import { CommandPalette } from '../CommandPalette';
import { ThemeProvider } from '../../context/ThemeContext';
import { SidebarProvider, useSidebar } from '../../context/SidebarContext';
import { CommandPaletteProvider, useCommandPalette } from '../../context/CommandPaletteContext';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { cn } from '../../lib/utils';

function AppContent() {
  const { collapsed } = useSidebar();
  const { open, closePalette, togglePalette } = useCommandPalette();
  const unreadCount = useUnreadCount();

  useEffect(() => {
    document.title = unreadCount > 0 ? `SkySend (${unreadCount})` : 'SkySend';
    return () => { document.title = 'SkySend'; };
  }, [unreadCount]);

  // Global ⌘K / Ctrl+K to summon the command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePalette]);

  return (
    <div className="min-h-screen bg-[var(--bg-app)]" style={{ backgroundImage: 'var(--gradient-page)' }}>
      <Sidebar />
      <div className={cn(
        'transition-[padding] duration-200',
        collapsed ? 'pl-[60px]' : 'pl-[244px]'
      )}>
        <Header />
        <main className="px-8 py-7 max-w-[1440px] mx-auto">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette open={open} onClose={closePalette} />
    </div>
  );
}

export function AppLayout() {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <CommandPaletteProvider>
          <AppContent />
        </CommandPaletteProvider>
      </SidebarProvider>
    </ThemeProvider>
  );
}

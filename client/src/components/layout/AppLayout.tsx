import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ErrorBoundary } from '../ErrorBoundary';
import { ThemeProvider } from '../../context/ThemeContext';
import { SidebarProvider, useSidebar } from '../../context/SidebarContext';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { cn } from '../../lib/utils';

function AppContent() {
  const { collapsed } = useSidebar();
  const unreadCount = useUnreadCount();

  useEffect(() => {
    document.title = unreadCount > 0 ? `SkySend (${unreadCount})` : 'SkySend';
    return () => { document.title = 'SkySend'; };
  }, [unreadCount]);

  return (
    <div className="min-h-screen bg-[var(--bg-app)]" style={{ backgroundImage: 'var(--gradient-page)' }}>
      <Sidebar />
      <div className={cn(
        'transition-[padding] duration-200',
        collapsed ? 'pl-[56px]' : 'pl-[232px]'
      )}>
        <Header />
        <main className="px-8 py-7 max-w-[1440px] mx-auto">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export function AppLayout() {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <AppContent />
      </SidebarProvider>
    </ThemeProvider>
  );
}

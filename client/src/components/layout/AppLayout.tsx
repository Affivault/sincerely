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
        collapsed ? 'pl-[52px]' : 'pl-[220px]'
      )}>
        <Header />
        <main className="px-6 py-5">
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

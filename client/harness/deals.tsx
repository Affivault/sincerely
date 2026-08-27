/*
 * A stand-alone mount of DealsPage inside the same wrapper the real app puts
 * every route in, so layout bugs that only exist in context (a fixed overlay
 * trapped by the route wrapper's transform, a column that never scrolls
 * because nothing above it is height-bounded) reproduce here exactly.
 *
 * Not part of the app build. Served by `vite --config vite.harness.config.ts`.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { DealsPage } from '../src/pages/crm/DealsPage';
import '../src/index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function Shell() {
  return (
    <div className="min-h-screen bg-[var(--bg-app)]">
      <header className="fixed top-0 inset-x-0 z-50 flex h-[56px] items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-xl gap-3 pr-6">
        <span className="pl-6 text-[13px] font-semibold text-[var(--text-primary)]">Sincerely</span>
      </header>
      <div className="pt-[56px] pl-[240px]">
        <main className="px-8 py-7 max-w-[1760px] mx-auto">
          <div className="route-fade">
            <DealsPage />
          </div>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <Shell />
        <Toaster position="top-right" />
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

/* The leads inbox on its own. See vite.harness.config.ts. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { LeadsPage } from '../src/pages/leads/LeadsPage';
import '../src/index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-[var(--bg-app)]">
          <header className="fixed inset-x-0 top-0 z-50 flex h-[56px] items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 pr-6 backdrop-blur-xl">
            <span className="pl-6 text-[13px] font-semibold text-[var(--text-primary)]">Sincerely</span>
          </header>
          <div className="pl-[240px] pt-[56px]">
            <main className="mx-auto max-w-[1760px] px-8 py-7">
              <div className="route-fade"><LeadsPage /></div>
            </main>
          </div>
        </div>
        <Toaster position="top-right" />
      </QueryClientProvider>
    </MemoryRouter>
  </React.StrictMode>,
);

/*
 * Email accounts - the mailbox list, the connect wizard and the mailbox
 * panel - inside the same wrapper the real app puts every route in.
 * ?path= picks the starting URL (e.g. /email-accounts?connect=1).
 * See vite.harness.config.ts.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ConfirmProvider } from '../src/components/ui/ConfirmDialog';
import { EmailAccountsPage } from '../src/pages/smtp/EmailAccountsPage';
import '../src/index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const start = new URLSearchParams(location.search).get('path') || '/email-accounts';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={[start]}>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <div className="min-h-screen bg-[var(--bg-app)]">
            <header className="fixed inset-x-0 top-0 z-50 flex h-[56px] items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 pr-6 backdrop-blur-xl">
              <span className="pl-6 text-body font-semibold text-[var(--text-primary)]">Sincerely</span>
            </header>
            <div className="pl-[240px] pt-[56px]">
              <main className="mx-auto max-w-[1200px] px-8 py-7">
                <div className="route-fade">
                  <Routes><Route path="/email-accounts" element={<EmailAccountsPage />} /></Routes>
                </div>
              </main>
            </div>
          </div>
          <Toaster position="top-right" />
        </ConfirmProvider>
      </QueryClientProvider>
    </MemoryRouter>
  </React.StrictMode>,
);

/*
 * The deal detail page on its own, at /deals/<id>, inside the same wrapper
 * AppLayout puts every route in. See vite.harness.config.ts.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { DealDetailPage } from '../src/pages/crm/DealDetailPage';
import '../src/index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// The driver picks the deal by appending ?deal=<id> to the harness URL.
const dealId = new URLSearchParams(location.search).get('deal') || 'd0';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={[`/deals/${dealId}`]}>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-[var(--bg-app)]">
          <header className="fixed inset-x-0 top-0 z-50 flex h-[56px] items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 pr-6 backdrop-blur-xl">
            <span className="pl-6 text-[13px] font-semibold text-[var(--text-primary)]">Sincerely</span>
          </header>
          <div className="pl-[240px] pt-[56px]">
            <main className="mx-auto max-w-[1760px] px-8 py-7">
              <div className="route-fade">
                <Routes>
                  <Route path="/deals/:id" element={<DealDetailPage />} />
                </Routes>
              </div>
            </main>
          </div>
        </div>
        <Toaster position="top-right" />
      </QueryClientProvider>
    </MemoryRouter>
  </React.StrictMode>,
);

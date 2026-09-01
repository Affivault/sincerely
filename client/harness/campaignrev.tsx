/* One campaign's revenue detail. See vite.harness.config.ts. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampaignRevenuePage } from '../src/pages/analytics/CampaignRevenuePage';
import '../src/index.css';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={['/analytics/revenue/a']}>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-[var(--bg-app)]">
          <main className="mx-auto max-w-[1400px] px-8 py-7">
            <Routes><Route path="/analytics/revenue/:id" element={<CampaignRevenuePage />} /></Routes>
          </main>
        </div>
      </QueryClientProvider>
    </MemoryRouter>
  </React.StrictMode>,
);

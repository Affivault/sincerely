/* The revenue report on its own. See vite.harness.config.ts. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RevenuePage } from '../src/pages/analytics/RevenuePage';
import '../src/index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-[var(--bg-app)]">
          <main className="mx-auto max-w-[1500px] px-8 py-7"><RevenuePage /></main>
        </div>
      </QueryClientProvider>
    </MemoryRouter>
  </React.StrictMode>,
);

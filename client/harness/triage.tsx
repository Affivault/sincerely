/* The reply-triage bar on its own. See vite.harness.config.ts. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ReplyTriage } from '../src/components/inbox/ReplyTriage';
import '../src/index.css';
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const p = new URLSearchParams(location.search);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-[var(--bg-app)]">
          <main className="mx-auto max-w-[760px] px-8 py-10">
            <ReplyTriage messageId="msg-1" contactId={p.get('nocontact') ? null : 'c1'} />
          </main>
        </div>
        <Toaster position="top-right" />
      </QueryClientProvider>
    </MemoryRouter>
  </React.StrictMode>,
);

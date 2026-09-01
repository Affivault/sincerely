/* One contact's profile. See vite.harness.config.ts. */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ConfirmProvider } from '../src/components/ui/ConfirmDialog';
import { ContactDetailPage } from '../src/pages/contacts/ContactDetailPage';
import '../src/index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter initialEntries={['/contacts/c1']}>
      <QueryClientProvider client={queryClient}>
        <ConfirmProvider>
          <div className="min-h-screen bg-[var(--bg-app)]">
            <div className="pt-4">
              <main className="mx-auto max-w-[1760px] px-8 py-7">
                <Routes>
                  <Route path="/contacts/:id" element={<ContactDetailPage />} />
                </Routes>
              </main>
            </div>
          </div>
          <Toaster position="top-right" />
        </ConfirmProvider>
      </QueryClientProvider>
    </MemoryRouter>
  </React.StrictMode>,
);

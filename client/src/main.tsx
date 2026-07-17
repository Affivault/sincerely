import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { queryClient } from './lib/queryClient';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
          <Toaster
            position="top-right"
            gutter={10}
            toastOptions={{
              // Theme-aware via CSS vars (resolve against the .dark class on <html>)
              duration: 3200,
              style: {
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-lg)',
                fontSize: '13px',
                fontWeight: 500,
                padding: '10px 14px',
                maxWidth: '400px',
              },
              success: { iconTheme: { primary: 'var(--success)', secondary: 'var(--bg-surface)' } },
              error: { iconTheme: { primary: 'var(--error)', secondary: 'var(--bg-surface)' } },
              loading: { iconTheme: { primary: 'var(--indigo)', secondary: 'var(--bg-surface)' } },
            }}
          />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);

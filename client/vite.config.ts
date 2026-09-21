import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lemlist/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:   ['react', 'react-dom', 'react-router-dom'],
          charts:   ['recharts'],
          icons:    ['lucide-react'],
          toast:    ['react-hot-toast'],
          query:    ['@tanstack/react-query'],
          supabase: ['@supabase/supabase-js'],
          editor:   [
            '@tiptap/react', '@tiptap/starter-kit',
            '@tiptap/extension-link', '@tiptap/extension-placeholder',
            '@tiptap/extension-underline',
          ],
          dnd:      ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          utils:    ['axios', 'date-fns', 'clsx'],
          /*
           * CSV parsing, on its own.
           *
           * It was in `utils` beside axios and clsx, which the app shell
           * needs on every page, so grouping them meant every first paint
           * carried a CSV parser - for two screens, both of them behind a
           * click. Splitting it out is 19 kB off the critical path and
           * costs those two screens one extra request they were already
           * making several of.
           */
          csv:      ['papaparse'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/t': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});

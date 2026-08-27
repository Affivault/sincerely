import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/* ═══════════════════════════════════════════════════════════════════════
   Serves client/harness/*.html - a single page mounted on its own, inside
   the same wrapper the real app puts every route in.

   For layout bugs that only exist in context and cannot be seen by reading
   the CSS: a fixed overlay trapped by an ancestor's transform, a kanban
   column that never scrolls because nothing above it is height-bounded.
   Drive it with Playwright and measure; screenshots alone will not tell you
   a column is two thousand pixels tall.

       npx vite --config vite.harness.config.ts     # then hit :5199/deals.html

   Not part of the app build, and never deployed. Supabase credentials are
   stubbed rather than read from the environment so this runs with no setup:
   the harness fulfils every API call itself.
   ═══════════════════════════════════════════════════════════════════════ */
export default defineConfig({
  root: path.resolve(__dirname, 'harness'),
  plugins: [react()],
  resolve: {
    alias: {
      '@lemlist/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  define: {
    // Enough to satisfy the client's startup assertion. Nothing is ever
    // sent here — the driver intercepts the network.
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:1'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('harness'),
  },
  server: { port: 5199, strictPort: true },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/* ═══════════════════════════════════════════════════════════════════════
   The whole app - router, sidebar, header, command bar - with no backend.

   The page harnesses (vite.harness.config.ts) mount one screen on its own.
   This one serves the real index.html, so a driver can walk the app the
   way a person does: land, navigate, open things, press keys, at any
   width. Supabase and the API point at an address nothing listens on; the
   driver (harness/app/drive.cjs) plants a session and answers every call
   from harness/app/fixtures.cjs, a realistic account a few weeks in.

       npx vite --config vite.app-harness.config.ts      # serves :5198
       node harness/app/tour.cjs /dashboard /inbox        # screenshots + errors

   Not part of the app build, and never deployed.
   ═══════════════════════════════════════════════════════════════════════ */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lemlist/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:1'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('harness'),
    'import.meta.env.VITE_API_URL': JSON.stringify('http://127.0.0.1:1/api/v1'),
  },
  server: { port: 5198, strictPort: true },
});

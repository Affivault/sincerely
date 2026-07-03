import { useEffect, useState } from 'react';
import { API_URL } from '../../lib/constants';

/**
 * Public self-diagnostics page (/status). Runs connectivity checks from the
 * visitor's browser against everything the app depends on and explains any
 * failure in plain English. No auth required; exposes no secrets (the anon
 * key is public by design and only its presence/length is shown).
 */

type CheckResult = {
  name: string;
  ok: boolean | null; // null = running
  detail: string;
  fix?: string;
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function apiRootFromApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/api\/v1\/?$/, '');
}

async function runChecks(update: (r: CheckResult[]) => void): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const push = (r: CheckResult) => { results.push(r); update([...results]); };

  // 1. Baked-in configuration
  const isProdHost = !['localhost', '127.0.0.1'].includes(window.location.hostname);

  push({
    name: 'App configuration: Supabase URL',
    ok: !!SUPABASE_URL,
    detail: SUPABASE_URL ? `Set (${new URL(SUPABASE_URL).host})` : 'MISSING from this build',
    fix: SUPABASE_URL ? undefined : 'In Vercel → Settings → Environment Variables, add VITE_SUPABASE_URL for the Production environment, then Redeploy.',
  });

  push({
    name: 'App configuration: Supabase key',
    ok: !!ANON_KEY,
    detail: ANON_KEY ? `Set (${ANON_KEY.length} chars)` : 'MISSING from this build',
    fix: ANON_KEY ? undefined : 'In Vercel → Settings → Environment Variables, add VITE_SUPABASE_ANON_KEY for the Production environment, then Redeploy.',
  });

  const apiLooksLocal = /localhost|127\.0\.0\.1/.test(API_URL);
  push({
    name: 'App configuration: API address',
    ok: !(isProdHost && apiLooksLocal),
    detail: `This build calls: ${API_URL}`,
    fix: isProdHost && apiLooksLocal
      ? 'VITE_API_URL is missing from this build, so it fell back to localhost. In Vercel → Settings → Environment Variables, set VITE_API_URL (e.g. https://skysend-api.onrender.com/api/v1) for the Production environment — check the environment checkboxes! — then Deployments → Redeploy.'
      : undefined,
  });

  // 2. Supabase reachability (auth service — this is what sign-in talks to)
  if (SUPABASE_URL && ANON_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: ANON_KEY } });
      push({
        name: 'Sign-in service (Supabase Auth)',
        ok: res.ok,
        detail: res.ok ? 'Reachable and healthy' : `Responded with HTTP ${res.status}`,
        fix: res.ok ? undefined : 'Check the Supabase project is active (not paused) at supabase.com, and that VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in Vercel match Project Settings → API.',
      });
    } catch (err: any) {
      push({
        name: 'Sign-in service (Supabase Auth)',
        ok: false,
        detail: `Could not connect: ${err?.message || err}`,
        fix: 'The Supabase URL in this build may be wrong, or the project is paused. Compare VITE_SUPABASE_URL in Vercel with Supabase → Project Settings → API.',
      });
    }
  } else {
    push({ name: 'Sign-in service (Supabase Auth)', ok: false, detail: 'Skipped — Supabase configuration missing (see above)' });
  }

  // 3. API server reachability
  const healthUrl = `${apiRootFromApiUrl(API_URL)}/health`;
  try {
    const res = await fetch(healthUrl);
    const body = await res.json().catch(() => null);
    const ok = res.ok && body?.status === 'ok';
    push({
      name: 'API server',
      ok,
      detail: ok ? `Reachable and healthy (${healthUrl})` : `Unexpected response HTTP ${res.status} from ${healthUrl}`,
      fix: ok ? undefined : 'Check the Render service is live (dashboard.render.com) and that VITE_API_URL in Vercel points at it.',
    });
  } catch (err: any) {
    push({
      name: 'API server',
      ok: false,
      detail: `Could not connect to ${healthUrl}: ${err?.message || err}`,
      fix: 'The API address this build uses is unreachable from your browser. Most common causes: the domain does not exist in DNS, or VITE_API_URL is wrong. Set VITE_API_URL in Vercel to https://skysend-api.onrender.com/api/v1 and Redeploy.',
    });
  }

  // 4. Signed-in session (informational)
  try {
    const raw = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    push({
      name: 'Browser session',
      ok: true,
      detail: raw ? 'A sign-in session exists in this browser' : 'No session yet (not signed in on this device)',
    });
  } catch {
    push({ name: 'Browser session', ok: false, detail: 'This browser blocks local storage — sign-in cannot persist. Disable strict privacy blocking for this site.' });
  }

  return results;
}

export function StatusPage() {
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    runChecks(setChecks).then(() => setDone(true));
  }, []);

  const failures = checks.filter((c) => c.ok === false);

  const report = () => JSON.stringify({
    when: new Date().toISOString(),
    origin: window.location.origin,
    userAgent: navigator.userAgent,
    apiUrl: API_URL,
    supabaseHost: SUPABASE_URL ? new URL(SUPABASE_URL).host : null,
    checks: checks.map(({ name, ok, detail }) => ({ name, ok, detail })),
  }, null, 2);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFC', color: '#1E1E2A', fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif" }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px 80px' }}>
        <img src="/logo.svg" alt="Sincerely" style={{ height: 32, marginBottom: 28 }} />
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 }}>System check</h1>
        <p style={{ fontSize: 14, color: '#64748B', marginBottom: 28 }}>
          Testing this app's connections from your browser. {done ? (failures.length === 0 ? 'Everything looks good.' : `${failures.length} problem${failures.length > 1 ? 's' : ''} found — details below.`) : 'Running…'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {checks.map((c) => (
            <div key={c.name} style={{
              background: '#fff', border: `1px solid ${c.ok === false ? '#FECACA' : '#E8E8F0'}`,
              borderRadius: 12, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  background: c.ok === null ? '#CBD5E1' : c.ok ? '#10B981' : '#EF4444',
                }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: c.ok === null ? '#94A3B8' : c.ok ? '#059669' : '#DC2626' }}>
                  {c.ok === null ? '…' : c.ok ? 'OK' : 'PROBLEM'}
                </span>
              </div>
              <p style={{ fontSize: 13, color: '#64748B', margin: '6px 0 0 20px', wordBreak: 'break-all' }}>{c.detail}</p>
              {c.fix && (
                <p style={{ fontSize: 13, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 10px', margin: '8px 0 0 20px' }}>
                  <strong>How to fix:</strong> {c.fix}
                </p>
              )}
            </div>
          ))}
        </div>

        {done && (
          <button
            onClick={copyReport}
            style={{
              marginTop: 24, height: 40, padding: '0 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: '#5B5BF5', color: '#fff', fontSize: 13.5, fontWeight: 600,
            }}
          >
            {copied ? 'Copied ✓' : 'Copy report to clipboard'}
          </button>
        )}
        <p style={{ fontSize: 12.5, color: '#94A3B8', marginTop: 12 }}>
          Copy the report and paste it to support — it contains no passwords or secrets.
        </p>
      </div>
    </div>
  );
}

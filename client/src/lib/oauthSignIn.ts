import { useQuery } from '@tanstack/react-query';

/* ═══════════════════════════════════════════════════════════════════════
   Signing in with Google or Microsoft: which are switched on, which was
   used last, and what went wrong when one comes back with an error.

   Which providers are on is asked of Supabase itself (its public
   /auth/v1/settings), so a button never leads to Supabase's raw
   "provider is not enabled" page. Google is assumed on while that answer
   is on its way, as it always has been; Microsoft shows once Supabase
   says it is on.
   ═══════════════════════════════════════════════════════════════════════ */

export type SignInProvider = 'google' | 'azure';

const URL_BASE = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const LAST_KEY = 'sincerely:last-sign-in';
const ERROR_KEY = 'sincerely:oauth-error';

export function useSignInProviders(): { google: boolean; azure: boolean; checked: boolean } {
  const { data, isSuccess } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: async () => {
      const res = await fetch(`${URL_BASE}/auth/v1/settings`, { headers: { apikey: ANON || '' } });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      return { google: !!json?.external?.google, azure: !!json?.external?.azure };
    },
    staleTime: 10 * 60_000,
    retry: 1,
    meta: { silentError: true },
  });
  return { google: data ? data.google : true, azure: !!data?.azure, checked: isSuccess };
}

export function lastSignIn(): SignInProvider | 'email' | null {
  try {
    const v = localStorage.getItem(LAST_KEY);
    return v === 'google' || v === 'azure' || v === 'email' ? v : null;
  } catch { return null; }
}

export function rememberSignIn(p: SignInProvider | 'email') {
  try { localStorage.setItem(LAST_KEY, p); } catch { /* storage blocked */ }
}

/** Supabase's error, in words that say what to do. */
export function friendlyOAuthError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('provider is not enabled') || s.includes('unsupported provider')) {
    return 'That sign-in option is not switched on yet. Use your email and password for now.';
  }
  if (s.includes('email') && (s.includes('external provider') || s.includes('not verified') || s.includes('unverified'))) {
    return 'Microsoft or Google did not share a confirmed email address, so no account could be matched. Try again, or use your email and password.';
  }
  if (s.includes('access_denied') || s.includes('cancel') || s.includes('denied')) return 'Sign-in was cancelled.';
  if (s.includes('signup') && (s.includes('disabled') || s.includes('not allowed'))) {
    return 'Sign-ups are closed or by invitation right now, so no new account was made.';
  }
  if (s.includes('aadsts')) return 'Microsoft would not sign you in. If this is a work account, your IT admin may need to approve Sincerely.';
  return raw.length > 200 ? `${raw.slice(0, 200)}...` : raw;
}

/**
 * Run once at start-up: a sign-in that failed comes back with
 * ?error=...&error_description=... (or the same in the #hash). Keep the
 * message for the login page and take it out of the address bar.
 */
export function captureOAuthError(): void {
  if (typeof window === 'undefined') return;
  try {
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const err = q.get('error') || h.get('error');
    if (!err) return;
    const desc = q.get('error_description') || h.get('error_description') || err;
    sessionStorage.setItem(ERROR_KEY, friendlyOAuthError(desc.replace(/\+/g, ' ')));
    ['error', 'error_code', 'error_description'].forEach((k) => q.delete(k));
    const qs = q.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  } catch { /* storage or history blocked */ }
}

export function takeOAuthError(): string | null {
  try {
    const v = sessionStorage.getItem(ERROR_KEY);
    if (v) sessionStorage.removeItem(ERROR_KEY);
    return v;
  } catch { return null; }
}

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { GoogleIcon, MicrosoftIcon } from '../AuthShell';
import { lastSignIn, rememberSignIn, useSignInProviders, friendlyOAuthError, type SignInProvider } from '../../lib/oauthSignIn';

/* ═══════════════════════════════════════════════════════════════════════
   "Continue with Google" and "Continue with Microsoft".

   Each button carries the provider's own mark on a quiet tile, says what
   it does, and shows it is working the moment it is pressed (the browser
   then leaves for Google or Microsoft, which can take a second). The one
   used last time is marked, so a returning person picks the same door.
   ═══════════════════════════════════════════════════════════════════════ */

const PROVIDERS: Array<{ id: SignInProvider; name: string; Icon: () => JSX.Element }> = [
  { id: 'google', name: 'Google', Icon: GoogleIcon },
  { id: 'azure', name: 'Microsoft', Icon: MicrosoftIcon },
];

export function OAuthButtons({ onError }: { onError?: (message: string) => string }) {
  const { signInWithOAuth } = useAuth();
  const available = useSignInProviders();
  const [busy, setBusy] = useState<SignInProvider | null>(null);
  const last = lastSignIn();
  const shown = PROVIDERS.filter((p) => available[p.id]);
  if (shown.length === 0) return null;

  const go = async (p: SignInProvider) => {
    if (busy) return;
    setBusy(p);
    rememberSignIn(p);
    const { error } = await signInWithOAuth(p);
    if (error) {
      setBusy(null);
      const friendly = friendlyOAuthError(error.message);
      toast.error(onError ? onError(friendly) : friendly);
    }
    // On success the browser is already on its way to Google or Microsoft.
  };

  return (
    <div className="md-auth__sso" data-oauth-buttons>
      {shown.map(({ id, name, Icon }) => (
        <button
          key={id}
          type="button"
          className="md-auth__sso-btn"
          onClick={() => go(id)}
          disabled={!!busy && busy !== id}
          aria-busy={busy === id}
          data-oauth={id}
        >
          <span className="md-auth__sso-mark" aria-hidden="true">
            {busy === id ? <span className="md-auth__sso-spin" /> : <Icon />}
          </span>
          <span className="md-auth__sso-label">{busy === id ? `Opening ${name}...` : `Continue with ${name}`}</span>
          {last === id && busy !== id && <span className="md-auth__sso-last">Last used</span>}
        </button>
      ))}
    </div>
  );
}

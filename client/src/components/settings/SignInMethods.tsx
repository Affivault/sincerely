import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import type { UserIdentity } from '@supabase/supabase-js';
import { Loader2, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { GoogleIcon, MicrosoftIcon } from '../AuthShell';
import { useSignInProviders, friendlyOAuthError, type SignInProvider } from '../../lib/oauthSignIn';

/* ═══════════════════════════════════════════════════════════════════════
   Settings > Account > Sign-in methods.

   Which ways into this account work: email and password, Google,
   Microsoft. Linking Google or Microsoft here means "Continue with ..." on
   the login page opens this same account, whatever address it uses, and
   the last way in can never be unlinked.
   ═══════════════════════════════════════════════════════════════════════ */

const LABEL: Record<string, string> = { email: 'Email and password', google: 'Google', azure: 'Microsoft' };

function Mark({ provider }: { provider: string }) {
  return (
    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      {provider === 'google' ? <GoogleIcon /> : provider === 'azure' ? <MicrosoftIcon /> : <Mail className="h-4 w-4 text-[var(--text-secondary)]" />}
    </span>
  );
}

export function SignInMethods() {
  const { user } = useAuth();
  const available = useSignInProviders();
  const [identities, setIdentities] = useState<UserIdentity[]>(user?.identities || []);
  const [busy, setBusy] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const load = async () => {
    const { data } = await supabase.auth.getUserIdentities();
    if (data?.identities) setIdentities(data.identities);
  };
  useEffect(() => { load(); }, [user?.id]);

  // Back from linking.
  useEffect(() => {
    if (params.get('linked')) {
      toast.success(`${LABEL[params.get('linked') || ''] || 'That account'} is linked - you can sign in with it now`);
      const next = new URLSearchParams(params);
      next.delete('linked');
      setParams(next, { replace: true });
      load();
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (provider: SignInProvider) => {
    setBusy(provider);
    const { error } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo: `${window.location.origin}/settings?tab=account&linked=${provider}`,
        ...(provider === 'azure' ? { scopes: 'openid email profile' } : {}),
      },
    });
    if (error) {
      setBusy(null);
      toast.error(/manual linking/i.test(error.message)
        ? 'Linking is switched off for this workspace. An admin turns on "Allow manual linking" in Supabase (Authentication > Sign In / Providers).'
        : friendlyOAuthError(error.message), { duration: 9000 });
    }
  };

  const unlink = async (identity: UserIdentity) => {
    setBusy(identity.provider);
    const { error } = await supabase.auth.unlinkIdentity(identity);
    setBusy(null);
    if (error) { toast.error(friendlyOAuthError(error.message)); return; }
    toast.success(`${LABEL[identity.provider] || identity.provider} unlinked`);
    load();
  };

  const has = (p: string) => identities.find((i) => i.provider === p);
  const rows = (['email', 'google', 'azure'] as const).filter((p) => p === 'email' || available[p] || has(p));

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden" data-sign-in-methods>
      <div className="px-5 pt-4 pb-3">
        <p className="text-strong font-medium text-[var(--text-primary)]">Sign-in methods</p>
        <p className="text-body text-[var(--text-tertiary)]">The ways into this account. Link Google or Microsoft to sign in with one click.</p>
      </div>
      <ul className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {rows.map((p) => {
          const identity = has(p);
          const email = (identity?.identity_data as any)?.email as string | undefined;
          return (
            <li key={p} className="flex flex-wrap items-center gap-3 px-5 py-3" data-sign-in-method={p}>
              <Mark provider={p} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-[var(--text-primary)]">{LABEL[p]}</span>
                <span className="block truncate text-caption text-[var(--text-tertiary)]">
                  {identity ? (email ? `Linked to ${email}` : 'Linked') : p === 'email' ? 'Not set' : 'Not linked'}
                </span>
              </span>
              {p !== 'email' && (identity ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={identities.length < 2 || busy === p}
                  title={identities.length < 2 ? 'This is the only way into the account, so it stays' : undefined}
                  onClick={() => unlink(identity)}
                >
                  {busy === p ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Unlink
                </button>
              ) : (
                <button type="button" className="btn-secondary" disabled={busy === p} onClick={() => link(p)} data-link-provider={p}>
                  {busy === p ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Link {LABEL[p]}
                </button>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { type Session, type User, type Provider } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { readPersistedUser } from '../lib/persistedSession';
import { queryClient } from '../lib/queryClient';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  resendConfirmation: (email: string) => Promise<{ error: Error | null }>;
  signInWithOAuth: (provider: Provider) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  /*
   * Start from what the browser already knows.
   *
   * Every route is behind `loading`, so starting it true meant EVERY page
   * load - including a reload of the page you were already on - showed a
   * skeleton until supabase answered, and the app could not begin
   * fetching its data until it cleared.
   *
   * supabase persists the session in localStorage and hands it back
   * through a promise; the storage read itself is synchronous. So the
   * information needed to render the right screen is in memory the whole
   * time the skeleton is up. readPersistedUser returns a user only when
   * the stored token has real time left on it, and null whenever there is
   * any doubt - a wrong null costs a skeleton that would have been there
   * anyway.
   *
   * Nothing here is trusted as authentication. Every request is still
   * authorised by the server, and if it disagrees, getSession resolves
   * with null a moment later and the redirect happens then.
   */
  const optimisticUser = useState(() => readPersistedUser())[0];

  const [user, setUser] = useState<User | null>(optimisticUser);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!optimisticUser);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    }).catch((err) => {
      console.error('Failed to load session:', err);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    return { error: error ? new Error(error.message) : null };
  };

  const resendConfirmation = async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error ? new Error(error.message) : null };
  };

  const signInWithOAuth = async (provider: Provider) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
        queryParams: provider === 'google'
          ? { access_type: 'offline', prompt: 'consent' }
          : undefined,
      },
    });
    return { error: error ? new Error(error.message) : null };
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Sign out request failed (clearing local session anyway):', err);
    } finally {
      setUser(null);
      setSession(null);
      // Query keys aren't scoped by user id, so a stale cache would otherwise let the
      // next account signed into this tab briefly see the previous user's cached data.
      queryClient.clear();
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, resendConfirmation, signInWithOAuth, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

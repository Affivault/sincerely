import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { ArrowRight, KeyRound, AlertTriangle } from 'lucide-react';
import { SkySendLogo } from '../../components/SkySendLogo';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    // Supabase puts the recovery token in the URL hash; onAuthStateChange
    // fires PASSWORD_RECOVERY when it parses it successfully.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });

    // Also check if there's already a session with a recovery token in the hash
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true);
      } else if (!window.location.hash.includes('access_token')) {
        // No token at all — link is invalid or expired
        setInvalid(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      toast.error(error.message);
      setLoading(false);
    } else {
      toast.success('Password updated — signing you in.');
      // Short delay so toast is visible, then redirect
      setTimeout(() => navigate('/dashboard'), 1200);
    }
  };

  if (invalid) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] px-6 py-12">
        <div className="w-full max-w-[420px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Link expired or invalid</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            This password reset link has expired or already been used.
          </p>
          <Link
            to="/forgot-password"
            className="mt-6 inline-flex items-center gap-2 btn-primary py-2 px-4 rounded-lg text-sm"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] px-6 py-12">
      <div className="w-full max-w-[420px]">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <Link to="/">
            <span className="text-xl"><SkySendLogo /></span>
          </Link>
        </div>

        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'rgba(99,102,241,0.1)' }}>
            <KeyRound className="h-6 w-6" style={{ color: '#818CF8' }} />
          </div>
          <h1 className="text-[18px] font-semibold text-[var(--text-primary)] tracking-tight">
            Set new password
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Choose a strong password of at least 6 characters.
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                New password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
                className="input-field"
                disabled={!ready}
              />
            </div>

            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your new password"
                required
                minLength={6}
                className="input-field"
                disabled={!ready}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !ready}
              className="w-full btn-primary justify-center py-2.5 rounded-xl"
            >
              {loading ? 'Updating...' : !ready ? 'Verifying link...' : 'Update password'}
              {!loading && ready && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

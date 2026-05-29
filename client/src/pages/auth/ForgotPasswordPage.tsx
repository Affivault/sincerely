import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { ArrowRight, ArrowLeft, Mail } from 'lucide-react';
import { SkySendLogo } from '../../components/SkySendLogo';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
    }

    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] px-6 py-12">
      <div className="w-full max-w-[420px]">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <Link to="/">
            <span className="text-xl"><SkySendLogo /></span>
          </Link>
        </div>

        {sent ? (
          /* Success state */
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <Mail className="h-6 w-6 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">Check your email</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              We sent a password reset link to <strong>{email}</strong>. It expires in 1 hour.
            </p>
            <p className="mt-4 text-xs text-[var(--text-tertiary)]">
              Didn't receive it? Check your spam folder, or{' '}
              <button
                onClick={() => setSent(false)}
                className="font-medium underline"
                style={{ color: '#818CF8' }}
              >
                try again
              </button>
              .
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium"
              style={{ color: '#818CF8' }}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </div>
        ) : (
          /* Form state */
          <>
            <div className="mb-8 text-center">
              <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                Reset your password
              </h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Enter your email and we'll send you a reset link.
              </p>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-[var(--text-primary)] mb-1.5">
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="input-field"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full btn-primary justify-center py-2.5 rounded-xl"
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                  {!loading && <ArrowRight className="h-4 w-4" />}
                </button>
              </form>
            </div>

            <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
              <Link
                to="/login"
                className="inline-flex items-center gap-1 font-medium"
                style={{ color: '#818CF8' }}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

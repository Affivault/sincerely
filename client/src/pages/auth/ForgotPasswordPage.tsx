import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { ArrowLeft, Mail } from 'lucide-react';
import { AuthShell, BrandMetrics, BrandQuote } from '../../components/AuthShell';
import '../sincerely-landing.css';

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

  const brand = (
    <>
      <h1 className="md-auth__headline">
        Locked out?<br />
        Let's <em>fix that</em>.
      </h1>
      <p className="md-auth__lede">
        Enter the email on your account and we'll send a secure link to get you
        back into your workspace in seconds.
      </p>
      <BrandMetrics />
    </>
  );

  return (
    <AuthShell brand={brand} brandFooter={<BrandQuote />}>
      {sent ? (
        <div style={{ textAlign: 'center' }}>
          <div className="md-auth__badge md-auth__badge--ok">
            <Mail className="h-6 w-6" />
          </div>
          <h1 className="md-auth__form-h1">Check your email</h1>
          <p className="md-auth__form-sub">
            We sent a password reset link to <strong style={{ color: 'var(--txt)' }}>{email}</strong>. It expires in 1 hour.
          </p>
          <p className="md-auth__fine">
            Didn't receive it? Check your spam folder, or{' '}
            <button type="button" onClick={() => setSent(false)} className="md-auth__notice-btn" style={{ marginTop: 0 }}>
              try again
            </button>.
          </p>
          <Link to="/login" className="md-auth__back">
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <h1 className="md-auth__form-h1">Reset your password</h1>
          <p className="md-auth__form-sub">Enter your email and we'll send you a secure reset link.</p>

          <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
            <div className="md-auth__field">
              <label htmlFor="email" className="md-auth__label">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="md-auth__input"
              />
            </div>

            <button type="submit" disabled={loading} className="md-auth__submit">
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>

          <p className="md-auth__foot">
            <Link to="/login" className="md-auth__back" style={{ marginTop: 0 }}>
              <ArrowLeft className="h-4 w-4" />
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}

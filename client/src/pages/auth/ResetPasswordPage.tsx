import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
import { AuthShell, BrandMetrics, BrandQuote } from '../../components/AuthShell';
import '../sincerely-landing.css';

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

  const brand = (
    <>
      <h1 className="md-auth__headline">
        Almost<br />
        <em>there</em>.
      </h1>
      <p className="md-auth__lede">
        Choose a new password and we'll sign you straight back into your
        workspace — right where you left off.
      </p>
      <BrandMetrics />
    </>
  );

  return (
    <AuthShell brand={brand} brandFooter={<BrandQuote />}>
      {invalid ? (
        <div style={{ textAlign: 'center' }}>
          <div className="md-auth__badge md-auth__badge--warn">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="md-auth__form-h1">Link expired or invalid</h1>
          <p className="md-auth__form-sub">
            This password reset link has expired or has already been used.
          </p>
          <Link to="/forgot-password" className="md-auth__submit">
            Request a new link
          </Link>
        </div>
      ) : (
        <>
          <h1 className="md-auth__form-h1">Set a new password</h1>
          <p className="md-auth__form-sub">Choose a strong password of at least 6 characters.</p>

          <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
            <div className="md-auth__field">
              <label htmlFor="password" className="md-auth__label">New password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
                className="md-auth__input"
                disabled={!ready}
              />
            </div>

            <div className="md-auth__field">
              <label htmlFor="confirm" className="md-auth__label">Confirm password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your new password"
                required
                minLength={6}
                className="md-auth__input"
                disabled={!ready}
              />
            </div>

            <button type="submit" disabled={loading || !ready} className="md-auth__submit">
              {loading ? 'Updating…' : !ready ? 'Verifying link…' : 'Update password'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

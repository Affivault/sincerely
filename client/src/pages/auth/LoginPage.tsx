import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { AuthShell, BrandPreview, GoogleIcon } from '../../components/AuthShell';
import '../sincerely-landing.css';
import { takeSignupRefusal } from '../../lib/platform';

const SUSPENDED = 'This account has been suspended. Contact Sincerely support if you think this is a mistake.';

export function LoginPage() {
  const { signIn, signInWithOAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Sent here because the account was suspended mid-session.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('sincerely:suspended')) {
        sessionStorage.removeItem('sincerely:suspended');
        toast.error(SUSPENDED, { duration: 8000 });
      }
    } catch { /* storage blocked */ }
    if (takeSignupRefusal()) toast.error('Sign-ups are closed or by invitation right now, so no new account was made.', { duration: 8000 });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) {
      // Network-level failures aren't the user's fault — send them to the
      // self-diagnostics page instead of showing a cryptic fetch error.
      const isConnectionProblem = /fetch|network|load failed|connection/i.test(error.message);
      toast.error(
        isConnectionProblem
          ? 'Connection problem — visit usesincerely.com/status to see what\'s wrong.'
          : /banned/i.test(error.message) ? SUSPENDED : error.message,
        { duration: 6000 },
      );
    }
    setLoading(false);
  };

  const brand = (
    <>
      <h1 className="md-auth__headline">
        Cold email that<br />
        books the meeting.
      </h1>
      <p className="md-auth__lede">
        Send from your own mailboxes, read every reply in one place, and let
        Relay draft the answer while you decide what to say.
      </p>
      <BrandPreview />
    </>
  );

  return (
    <AuthShell brand={brand}>
      <h1 className="md-auth__form-h1">Welcome back</h1>
      <p className="md-auth__form-sub">Sign in to your workspace to continue</p>

      <button
        type="button"
        className="md-auth__oauth"
        onClick={async () => {
          const { error } = await signInWithOAuth('google');
          if (error) toast.error(error.message);
        }}
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="md-auth__divider">or with email</div>

      <form onSubmit={handleSubmit}>
        <div className="md-auth__field">
          <label htmlFor="email" className="md-auth__label">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="md-auth__input"
          />
        </div>

        <div className="md-auth__field">
          <label htmlFor="password" className="md-auth__label">
            <span>Password</span>
            <Link to="/forgot-password" className="md-auth__link" style={{ fontSize: 12 }}>Forgot password?</Link>
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            className="md-auth__input"
          />
        </div>

        <button type="submit" disabled={loading} className="md-auth__submit">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="md-auth__foot">
        Don't have an account?{' '}
        <Link to="/signup" className="md-auth__link">Create a free account</Link>
      </p>
    </AuthShell>
  );
}

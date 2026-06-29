import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import '../sincerely-landing.css';

/* Sincerely brand mark + wordmark — matches the landing header. */
function SincerelyLogo() {
  return (
    <a className="lp-header__logo" href="/" style={{ textDecoration: 'none' }}>
      <span className="lp-header__logo-mark">
        <svg width="28" height="28" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="md-auth-mark" x1="8" y1="8" x2="32" y2="33" gradientUnits="userSpaceOnUse">
              <stop stopColor="#4F86F7" /><stop offset="1" stopColor="#8B5CF6" />
            </linearGradient>
          </defs>
          <path d="M27 12.5C24.7 9.3 19.6 8.3 15.6 9.6 11 11.1 9.8 15.6 13.2 18.2 15.6 20 20.2 20.4 23.8 21.8 28.8 23.7 29.4 28.4 26 31.2 22.8 33.8 17.4 33.2 13.8 30" stroke="url(#md-auth-mark)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="lp-header__logo-name">sincerely</span>
    </a>
  );
}

export function LoginPage() {
  const { signIn, signInWithOAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) toast.error(error.message);
    setLoading(false);
  };

  const metrics = [
    { v: '18.4%', l: 'Avg reply rate' },
    { v: '97%', l: 'Inbox placement' },
    { v: '4.2M', l: 'Sent this week' },
  ];

  return (
    <div className="md-auth">
      {/* Brand showpiece */}
      <div className="md-auth__brand">
        <div className="md-auth__brand-bg" />
        <div className="md-auth__brand-inner">
          <SincerelyLogo />
          <h1 className="md-auth__headline">
            Cold email that<br />
            books the <em>meeting</em>.
          </h1>
          <p className="md-auth__lede">
            The deliverability-first outbound platform thousands of teams use to run
            personalized campaigns at scale — with an AI co-pilot in every inbox.
          </p>
          <div className="md-auth__metrics">
            {metrics.map((m) => (
              <div key={m.l} className="md-auth__metric">
                <div className="md-auth__metric-v">{m.v}</div>
                <div className="md-auth__metric-l">{m.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="md-auth__quote">
          <p>"We went from 2% to 18% reply rates in two weeks. Sincerely is the first tool that made our outbound feel effortless."</p>
          <div className="md-auth__quote-author">
            <div className="md-auth__quote-av">SR</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Sarah Rodriguez</div>
              <div style={{ fontSize: 11.5, color: 'rgba(246,246,247,0.45)' }}>VP of Sales, TechCorp</div>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="md-auth__form-wrap">
        <div className="md-auth__form">
          <div className="md-auth__mobile-logo"><SincerelyLogo /></div>

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
            <svg className="h-4 w-4" width="16" height="16" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          <div className="md-auth__divider">or with email</div>

          <form onSubmit={handleSubmit}>
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

            <div className="md-auth__field">
              <label htmlFor="password" className="md-auth__label">
                <span>Password</span>
                <Link to="/forgot-password" className="md-auth__link" style={{ fontSize: 12 }}>Forgot password?</Link>
              </label>
              <input
                id="password"
                type="password"
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
        </div>
      </div>
    </div>
  );
}

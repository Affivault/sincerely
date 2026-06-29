import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { AuthShell, BrandMetrics, BrandQuote, GoogleIcon } from '../../components/AuthShell';
import '../sincerely-landing.css';

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

  const brand = (
    <>
      <h1 className="md-auth__headline">
        Cold email that<br />
        books the <em>meeting</em>.
      </h1>
      <p className="md-auth__lede">
        The deliverability-first outbound platform thousands of teams use to run
        personalized campaigns at scale — with an AI co-pilot in every inbox.
      </p>
      <BrandMetrics />
    </>
  );

  return (
    <AuthShell brand={brand} brandFooter={<BrandQuote />}>
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
    </AuthShell>
  );
}

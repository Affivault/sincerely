import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { AuthShell, GoogleIcon } from '../../components/AuthShell';
import '../sincerely-landing.css';

export function SignupPage() {
  const { signUp, resendConfirmation, signInWithOAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    const { error } = await signUp(email, password);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Account created! Check your email for confirmation.');
      setSubmitted(true);
    }

    setLoading(false);
  };

  const handleResend = async () => {
    if (!email) {
      toast.error('Enter your email first');
      return;
    }
    setResending(true);
    const { error } = await resendConfirmation(email);
    if (error) toast.error(error.message);
    else toast.success('Confirmation email resent — check your inbox.');
    setResending(false);
  };

  const steps = [
    { n: '01', t: 'Connect your mailbox', d: 'SMTP or Google in two clicks' },
    { n: '02', t: 'Import your leads', d: 'CSV upload with smart mapping' },
    { n: '03', t: 'Launch & watch replies', d: 'AI sorts every response by intent' },
  ];

  const brand = (
    <>
      <p className="md-auth__eyebrow">Free to start</p>
      <h1 className="md-auth__headline">
        Start closing deals<br />
        <em>on autopilot</em>.
      </h1>
      <p className="md-auth__lede">
        Launch your first campaign in minutes and watch the replies roll in.
        No credit card required.
      </p>
      <ol className="md-auth__steps">
        {steps.map((s) => (
          <li key={s.n} className="md-auth__step">
            <span className="md-auth__step-n">{s.n}</span>
            <span className="md-auth__step-body">
              <span className="md-auth__step-t">{s.t}</span>
              <span className="md-auth__step-d">{s.d}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  );

  const brandFooter = (
    <div className="md-auth__quote">
      <p>"We onboarded our entire SDR team in a single afternoon. The templates and AI suggestions made it effortless to get started."</p>
      <div className="md-auth__quote-author">
        <div className="md-auth__quote-av">MK</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Marcus Kim</div>
          <div style={{ fontSize: 11.5, color: 'rgba(246,246,247,0.45)' }}>Head of Growth, ScaleUp.io</div>
        </div>
      </div>
    </div>
  );

  return (
    <AuthShell brand={brand} brandFooter={brandFooter}>
      <h1 className="md-auth__form-h1">Create your account</h1>
      <p className="md-auth__form-sub">Get started for free — no credit card required</p>

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
          <label htmlFor="email" className="md-auth__label">Work email</label>
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
          <label htmlFor="password" className="md-auth__label">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            required
            className="md-auth__input"
          />
        </div>

        <div className="md-auth__field">
          <label htmlFor="confirmPassword" className="md-auth__label">Confirm password</label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm your password"
            required
            className="md-auth__input"
          />
        </div>

        <button type="submit" disabled={loading} className="md-auth__submit">
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      {submitted && (
        <div className="md-auth__notice md-auth__notice--center">
          We sent a confirmation link to <strong>{email}</strong>. Didn't get it?
          <br />
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="md-auth__notice-btn"
          >
            {resending ? 'Resending…' : 'Resend confirmation email'}
          </button>
        </div>
      )}

      <p className="md-auth__fine">
        By signing up, you agree to our{' '}
        <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.
      </p>

      <p className="md-auth__foot">
        Already have an account?{' '}
        <Link to="/login" className="md-auth__link">Sign in</Link>
      </p>
    </AuthShell>
  );
}

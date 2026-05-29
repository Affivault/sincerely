import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { ArrowRight } from 'lucide-react';
import { SkySendLogo } from '../../components/SkySendLogo';

export function LoginPage() {
  const { signIn, signInWithOAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);
    if (error) {
      toast.error(error.message);
    }

    setLoading(false);
  };

  return (
    <div className="flex min-h-screen">
      {/* Left Panel - Brand */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-12 bg-[#0A0A0B]">
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-full h-full">
          <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full border border-white/[0.04]" />
          <div className="absolute bottom-[-15%] left-[-10%] w-[600px] h-[600px] rounded-full border border-indigo-500/10" />
          <div className="absolute top-[40%] left-[30%] w-[300px] h-[300px] rounded-full border border-white/[0.03]" />
          {/* Indigo glow */}
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)' }} />
        </div>

        <div className="relative z-10">
          {/* Logo */}
          <Link to="/" className="inline-flex items-center">
            <span className="text-2xl"><SkySendLogo inverted /></span>
          </Link>

          {/* Tagline */}
          <div className="mt-16">
            <h1 className="text-4xl font-bold text-white leading-tight">
              Outreach that<br />
              <span style={{ color: '#818CF8' }}>actually converts.</span>
            </h1>
            <p className="mt-4 text-lg text-white/60 max-w-md">
              Join thousands of sales teams using SkySend to automate personalized email campaigns at scale.
            </p>
          </div>

          {/* Feature bullets */}
          <div className="mt-12 space-y-6">
            <div className="flex items-start gap-4">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)' }}>
                <svg className="h-4 w-4" style={{ color: '#818CF8' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-white">Multi-channel sequences</p>
                <p className="mt-1 text-sm text-white/50">Email, LinkedIn, and calls in one automated workflow</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)' }}>
                <svg className="h-4 w-4" style={{ color: '#818CF8' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-white">AI personalization</p>
                <p className="mt-1 text-sm text-white/50">Every message feels hand-written with smart variables</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)' }}>
                <svg className="h-4 w-4" style={{ color: '#818CF8' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-white">Real-time analytics</p>
                <p className="mt-1 text-sm text-white/50">Track opens, clicks, and replies with detailed insights</p>
              </div>
            </div>
          </div>
        </div>

        {/* Testimonial */}
        <div className="relative z-10 mt-auto pt-12">
          <div className="rounded-2xl p-6" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)', backdropFilter: 'blur(12px)' }}>
            <p className="text-white/80 text-sm leading-relaxed italic">
              "SkySend transformed our outbound strategy. We went from 2% to 18% reply rates in just two weeks. The automation saves our team 20+ hours per week."
            </p>
            <div className="mt-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full flex items-center justify-center text-white font-semibold text-sm" style={{ background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.3)' }}>
                SR
              </div>
              <div>
                <p className="text-sm font-medium text-white">Sarah Rodriguez</p>
                <p className="text-xs text-white/50">VP of Sales, TechCorp</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-[var(--bg-app)] px-6 py-12">
        <div className="w-full max-w-[420px]">
          {/* Mobile Logo */}
          <div className="mb-8 lg:hidden">
            <Link to="/" className="inline-flex items-center">
              <span className="text-xl"><SkySendLogo /></span>
            </Link>
          </div>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Sign in to your account to continue
            </p>
          </div>

          {/* Google OAuth - top placement */}
          <button
            type="button"
            onClick={async () => {
              const { error } = await signInWithOAuth('google');
              if (error) toast.error(error.message);
            }}
            className="w-full btn-secondary justify-center py-2.5 rounded-xl"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--border-subtle)]" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-[var(--bg-app)] px-4 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                or continue with email
              </span>
            </div>
          </div>

          {/* Form Card */}
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

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-[var(--text-primary)]">
                    Password
                  </label>
                  <Link to="/forgot-password" className="text-xs font-medium transition-colors" style={{ color: '#818CF8' }}>
                    Forgot password?
                  </Link>
                </div>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="input-field"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary justify-center py-2.5 rounded-xl"
              >
                {loading ? 'Signing in...' : 'Sign in'}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          </div>

          {/* Signup link */}
          <p className="mt-8 text-center text-sm text-[var(--text-secondary)]">
            Don't have an account?{' '}
            <Link to="/signup" className="font-semibold transition-colors" style={{ color: '#818CF8' }}>
              Create a free account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

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
    <div className="flex min-h-screen bg-[var(--bg-app)]">
      {/* Left Panel — Brand showpiece */}
      <div className="hidden lg:flex lg:w-[46%] relative overflow-hidden flex-col justify-between p-12 bg-[#08080B]">
        {/* Layered ambient field */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0" style={{ background: 'radial-gradient(900px 600px at 20% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(700px 500px at 90% 100%, rgba(139,92,246,0.12), transparent 60%)' }} />
          <div className="absolute inset-0 opacity-[0.4]" style={{ backgroundImage: 'radial-gradient(circle at center, rgba(255,255,255,0.10) 1px, transparent 1.5px)', backgroundSize: '24px 24px', maskImage: 'radial-gradient(ellipse 70% 60% at 30% 20%, black, transparent 75%)', WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 30% 20%, black, transparent 75%)' }} />
          <div className="absolute top-[-12%] right-[-8%] w-[520px] h-[520px] rounded-full border border-white/[0.05]" />
          <div className="absolute top-[6%] right-[-2%] w-[380px] h-[380px] rounded-full border border-indigo-500/[0.12]" />
          <div className="absolute bottom-[-18%] left-[-12%] w-[640px] h-[640px] rounded-full border border-white/[0.03]" />
        </div>

        <div className="relative z-10">
          <Link to="/" className="inline-flex items-center">
            <span className="text-2xl"><SkySendLogo inverted /></span>
          </Link>

          <div className="mt-20">
            <p className="font-data text-[11px] uppercase tracking-[0.2em] text-indigo-300/70 mb-5">Cold outreach, refined</p>
            <h1 className="text-[44px] font-semibold text-white leading-[1.05] tracking-[-0.03em]">
              Outreach that<br />
              <span style={{ background: 'linear-gradient(120deg,#A5B4FC,#818CF8 50%,#C4B5FD)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>actually converts.</span>
            </h1>
            <p className="mt-5 text-[15px] text-white/55 max-w-md leading-relaxed">
              The deliverability-first sending platform thousands of teams use to run personalized campaigns at scale.
            </p>
          </div>

          {/* Live metric strip — the "see the product working" cue */}
          <div className="mt-12 grid grid-cols-3 gap-3 max-w-md">
            {[
              { v: '18.4%', l: 'Avg reply rate' },
              { v: '99.2%', l: 'Inbox placement' },
              { v: '4.2M', l: 'Sent this week' },
            ].map((m) => (
              <div key={m.l} className="rounded-xl px-3.5 py-3 border border-white/[0.07] bg-white/[0.025]">
                <p className="font-data text-[20px] font-semibold text-white tracking-[-0.02em] leading-none">{m.v}</p>
                <p className="text-[10.5px] text-white/40 mt-1.5 leading-tight">{m.l}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Testimonial */}
        <div className="relative z-10 mt-auto pt-12">
          <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)' }}>
            <p className="text-white/80 text-[14px] leading-relaxed">
              "We went from 2% to 18% reply rates in two weeks. MeetDrive is the first tool that made our outbound feel effortless."
            </p>
            <div className="mt-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full flex items-center justify-center text-white font-semibold text-[12px]" style={{ background: 'linear-gradient(135deg,#6366F1,#8B5CF6)' }}>
                SR
              </div>
              <div>
                <p className="text-[13px] font-medium text-white">Sarah Rodriguez</p>
                <p className="text-[11.5px] text-white/45">VP of Sales, TechCorp</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex w-full lg:w-[54%] items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px] stagger">
          {/* Mobile Logo */}
          <div className="mb-8 lg:hidden">
            <Link to="/" className="inline-flex items-center">
              <span className="text-xl"><SkySendLogo /></span>
            </Link>
          </div>

          {/* Header */}
          <div className="mb-7">
            <h1 className="text-[24px] font-semibold text-[var(--text-primary)] tracking-[-0.02em]">
              Welcome back
            </h1>
            <p className="mt-1.5 text-[13.5px] text-[var(--text-secondary)]">
              Sign in to your workspace to continue
            </p>
          </div>

          {/* Google OAuth - top placement */}
          <button
            type="button"
            onClick={async () => {
              const { error } = await signInWithOAuth('google');
              if (error) toast.error(error.message);
            }}
            className="w-full btn-secondary justify-center h-11 rounded-xl text-[13.5px]"
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
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--border-subtle)]" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-[var(--bg-app)] px-3 font-data text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-[0.12em]">
                or with email
              </span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[12.5px] font-medium text-[var(--text-secondary)] mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="input-field !h-11 rounded-xl text-[13.5px]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-[12.5px] font-medium text-[var(--text-secondary)]">
                  Password
                </label>
                <Link to="/forgot-password" className="text-[12px] font-medium text-[var(--indigo)] hover:underline underline-offset-2">
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
                className="input-field !h-11 rounded-xl text-[13.5px]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary justify-center h-11 rounded-xl text-[13.5px] group"
            >
              {loading ? 'Signing in…' : 'Sign in'}
              {!loading && <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />}
            </button>
          </form>

          {/* Signup link */}
          <p className="mt-7 text-center text-[13px] text-[var(--text-secondary)]">
            Don't have an account?{' '}
            <Link to="/signup" className="font-semibold text-[var(--indigo)] hover:underline underline-offset-2">
              Create a free account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

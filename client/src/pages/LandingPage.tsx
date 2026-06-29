import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './sincerely-landing.css';

/* Sincerely marketing site — ported from the Sincerely Landing design.
   Dark premium aesthetic; everything is scoped under `.md-landing`. The
   design-tool tweak panel is intentionally dropped; the brand mood / flat
   atmosphere / roomy density defaults are baked onto the wrapper. */

type IconProps = React.SVGProps<SVGSVGElement>;

const Icon: Record<string, (p: IconProps) => React.ReactElement> = {
  Logo: (p) => <svg width="16" height="16" viewBox="0 0 40 40" fill="none" {...p}><path d="M27 12.5C24.7 9.3 19.6 8.3 15.6 9.6 11 11.1 9.8 15.6 13.2 18.2 15.6 20 20.2 20.4 23.8 21.8 28.8 23.7 29.4 28.4 26 31.2 22.8 33.8 17.4 33.2 13.8 30" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  Mark: (p) => <svg width="28" height="28" viewBox="0 0 40 40" fill="none" {...p}><defs><linearGradient id="md-mark" x1="8" y1="8" x2="32" y2="33" gradientUnits="userSpaceOnUse"><stop stopColor="#4F86F7" /><stop offset="1" stopColor="#8B5CF6" /></linearGradient></defs><path d="M27 12.5C24.7 9.3 19.6 8.3 15.6 9.6 11 11.1 9.8 15.6 13.2 18.2 15.6 20 20.2 20.4 23.8 21.8 28.8 23.7 29.4 28.4 26 31.2 22.8 33.8 17.4 33.2 13.8 30" stroke="url(#md-mark)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  Send: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 11l18-8-8 18-2-8-8-2z" /></svg>,
  Mail: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></svg>,
  Inbox: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-6Z" /></svg>,
  Mega: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>,
  Chart: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 3v18h18" /><path d="M7 16v-5" /><path d="M12 16V8" /><path d="M17 16v-3" /></svg>,
  Users: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
  Settings: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  Sparkles: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9.94 14.06a1 1 0 0 1 .6-.61L13 12.5l-2.46-.95a1 1 0 0 1-.6-.61L9 8.5l-.94 2.44a1 1 0 0 1-.6.61L5 12.5l2.46.95a1 1 0 0 1 .6.61L9 16.5z" /><path d="M19 4v4M21 6h-4M19 16v3M20.5 17.5h-3" /></svg>,
  Shield: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>,
  Zap: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>,
  Check: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5" /></svg>,
  CheckCircle: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" /></svg>,
  ArrowRight: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14M12 5l7 7-7 7" /></svg>,
  Plus: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14M12 5v14" /></svg>,
  Clock: (p) => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  GitBranch: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>,
  Play: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}><polygon points="6 4 20 12 6 20 6 4" /></svg>,
  Lock: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
  Globe: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>,
  Calendar: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></svg>,
  Filter: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>,
  Twitter: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>,
  LinkedIn: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 1 1 8.3 6.5a1.78 1.78 0 0 1-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0 0 13 14.19a.66.66 0 0 0 0 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 0 1 2.7-1.4c1.55 0 3.36.86 3.36 3.66z" /></svg>,
  Github: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.84-2.34 4.68-4.57 4.93.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" /></svg>,
  Discord: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M19.27 5.33A17.42 17.42 0 0 0 14.84 4a12.4 12.4 0 0 0-.66 1.36 16.06 16.06 0 0 0-4.36 0A12.4 12.4 0 0 0 9.16 4a17.42 17.42 0 0 0-4.43 1.33C2 9.41 1.35 13.4 1.65 17.32A17.62 17.62 0 0 0 6.92 20a13.07 13.07 0 0 0 1.13-1.85 11.41 11.41 0 0 1-1.78-.86c.15-.11.3-.22.43-.34a12.4 12.4 0 0 0 10.6 0c.13.12.28.23.43.34a11.4 11.4 0 0 1-1.79.86A13.07 13.07 0 0 0 17.07 20a17.65 17.65 0 0 0 5.28-2.68c.36-4.55-.73-8.5-3.08-11.99zM8.52 14.91c-1.06 0-1.93-.98-1.93-2.18s.85-2.18 1.93-2.18 1.94.98 1.93 2.18c0 1.2-.85 2.18-1.93 2.18zm7.13 0c-1.06 0-1.93-.98-1.93-2.18s.85-2.18 1.93-2.18 1.94.98 1.93 2.18c0 1.2-.85 2.18-1.93 2.18z" /></svg>,
  Trend: (p) => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>,
};

function Header({ light, onToggle }: { light: boolean; onToggle: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`lp-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="lp-header__inner">
        <a className="lp-header__logo" href="#top">
          <span className="lp-header__logo-mark"><Icon.Mark /></span>
          <span className="lp-header__logo-name">sincerely</span>
        </a>
        <nav className="lp-header__nav">
          <a className="lp-header__link" href="#how">How it works</a>
          <a className="lp-header__link" href="#sequences">Sequences</a>
          <a className="lp-header__link" href="#sara">SARA</a>
          <a className="lp-header__link" href="#pricing">Pricing</a>
          <a className="lp-header__link" href="#faq">FAQ</a>
        </nav>
        <div className="lp-header__actions">
          <button type="button" className="lp-header__theme" onClick={onToggle} aria-label="Toggle light or dark theme" title="Toggle theme">
            {light
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>}
          </button>
          <Link className="lp-header__login" to="/login">Log in</Link>
          <Link className="lp-btn lp-btn--primary" to="/signup">Start free <Icon.ArrowRight className="lp-btn__arrow" /></Link>
        </div>
      </div>
    </header>
  );
}

function useCountUp(target: number, duration = 1400, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf: number;
    let t0: number | undefined;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (ts: number) => {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / duration);
      setValue(target * ease(p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);
  return value;
}

function Hero() {
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 480); return () => clearTimeout(t); }, []);
  const sent = useCountUp(5276, 1600, ready);
  const opens = useCountUp(72.4, 1600, ready);
  const clicks = useCountUp(22.8, 1600, ready);
  const replies = useCountUp(28.4, 1600, ready);

  const heights = [42, 58, 64, 51, 73, 88, 66, 79, 92, 78, 95, 84, 100, 92];
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S', 'M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <section className="lp-hero" id="top">
      <div className="lp-hero__bg">
        <div className="lp-hero__grid" />
        <div className="lp-hero__aurora" />
        <div className="lp-hero__beam" />
      </div>
      <div className="lp-wrap lp-hero__body">
        <a className="lp-pill" href="#sara">
          <span className="lp-pill__dot" />
          <span className="lp-pill__label">New</span>
          <span className="lp-pill__divider" />
          <span className="lp-pill__text">SARA · AI inbox assist is live</span>
          <span className="lp-pill__chevron">→</span>
        </a>
        <h1 className="lp-hero__headline">
          Cold email that<br />
          books the <span className="lp-hero__em">meeting</span>.
        </h1>
        <p className="lp-hero__sub">
          Sincerely ships your outbound at scale &mdash; with deliverability, sequencing,
          and an AI co-pilot that turns every reply into a booked meeting.
        </p>
        <div className="lp-hero__ctas">
          <Link className="lp-btn lp-btn--hero" to="/signup">Start sending free <Icon.ArrowRight className="lp-btn__arrow" /></Link>
          <a className="lp-btn lp-btn--ghost" href="#how"><Icon.Play /> Watch 90s demo</a>
        </div>
        <p className="lp-hero__trust">
          <span><Icon.Check /> No card required</span>
          <span><Icon.Check /> 500 emails free</span>
          <span><Icon.Check /> Cancel anytime</span>
        </p>

        <div className="mk">
          <div className="mk__chrome">
            <span className="mk__dot" />
            <span className="mk__dot" />
            <span className="mk__dot" />
            <div className="mk__url"><Icon.Lock /> app.usesincerely.com / campaigns</div>
            <span className="mk__live"><span className="mk__live-dot" />Live</span>
          </div>
          <div className="mk__body">
            <div className="mk__rail">
              <div className="mk__rail-logo"><Icon.Logo /></div>
              <div className="mk__rail-item"><Icon.Chart /></div>
              <div className="mk__rail-item is-active"><Icon.Mega /></div>
              <div className="mk__rail-item"><Icon.Inbox /></div>
              <div className="mk__rail-item"><Icon.Users /></div>
              <div className="mk__rail-item"><Icon.Settings /></div>
            </div>
            <div className="mk__nav">
              <div className="mk__nav-section">Outbound</div>
              <div className="mk__nav-item"><Icon.Chart /> Dashboard</div>
              <div className="mk__nav-item is-active"><Icon.Mega /> Campaigns <span className="mk__nav-badge">12</span></div>
              <div className="mk__nav-item"><Icon.Users /> Leads</div>
              <div className="mk__nav-item"><Icon.GitBranch /> Sequences</div>
              <div className="mk__nav-section">Inbox</div>
              <div className="mk__nav-item"><Icon.Inbox /> Unified <span className="mk__nav-badge">38</span></div>
              <div className="mk__nav-item"><Icon.Sparkles /> SARA queue</div>
              <div className="mk__nav-item"><Icon.Calendar /> Meetings</div>
            </div>
            <div className="mk__main">
              <div className="mk__main-head">
                <div>
                  <div className="mk__main-title">Q4 Outbound · Series A founders</div>
                </div>
                <div className="mk__main-actions">
                  <button className="mk__main-btn"><Icon.Filter /> Filter</button>
                  <button className="mk__main-btn mk__main-btn--prim"><Icon.Plus /> New campaign</button>
                </div>
              </div>
              <div className="mk__kpis">
                <div className="mk__kpi">
                  <div className="mk__kpi-l">Sent</div>
                  <div className="mk__kpi-v">{Math.round(sent).toLocaleString()}</div>
                  <div className="mk__kpi-d"><Icon.Trend /> +12% wk</div>
                </div>
                <div className="mk__kpi">
                  <div className="mk__kpi-l">Open rate</div>
                  <div className="mk__kpi-v">{opens.toFixed(1)}%</div>
                  <div className="mk__kpi-d"><Icon.Trend /> +4.1%</div>
                </div>
                <div className="mk__kpi">
                  <div className="mk__kpi-l">Click rate</div>
                  <div className="mk__kpi-v">{clicks.toFixed(1)}%</div>
                  <div className="mk__kpi-d"><Icon.Trend /> +1.6%</div>
                </div>
                <div className="mk__kpi">
                  <div className="mk__kpi-l">Reply rate</div>
                  <div className="mk__kpi-v">{replies.toFixed(1)}%</div>
                  <div className="mk__kpi-d"><Icon.Trend /> +8.2%</div>
                </div>
              </div>
              <div className="mk__chart-card">
                <div className="mk__chart-head">
                  <span className="mk__chart-title">Sending activity · Last 14 days</span>
                  <div className="mk__chart-tabs">
                    <span className="mk__chart-tab">7d</span>
                    <span className="mk__chart-tab is-active">14d</span>
                    <span className="mk__chart-tab">30d</span>
                  </div>
                </div>
                <div className="mk__chart">
                  {heights.map((h, i) => (
                    <div
                      key={i}
                      className="mk__bar"
                      style={{ height: `${h}%`, animationDelay: `${800 + i * 50}ms` }}
                    >
                      {(i === 6 || i === 13) && <span className="mk__bar-day">{days[i]}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Logos() {
  const logos: { name: string; mark?: React.ReactElement; italic?: boolean }[] = [
    { name: 'NORTHSTAR', mark: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 14.5 9 22 9 16 13.5 18 21 12 16.5 6 21 8 13.5 2 9 9.5 9" /></svg> },
    { name: 'Brightline', italic: true },
    { name: 'NIMBUS', mark: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg> },
    { name: 'peachfin', italic: true },
    { name: 'THE LOOP', mark: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /></svg> },
    { name: 'FLUXCAP', mark: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg> },
    { name: 'atlas.io', italic: true },
    { name: 'VAULTLINE', mark: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h18M12 3v18" /></svg> },
  ];
  return (
    <section className="lp-logos">
      <div className="lp-wrap">
        <div className="lp-logos__head">
          <p className="lp-logos__eyebrow">Trusted by 4,200+ outbound teams worldwide</p>
        </div>
        <div className="lp-logos__row">
          {logos.map((l, i) => (
            <span key={i} className={`lp-logo ${l.italic ? 'lp-logo--italic' : ''}`}>
              {l.mark}{l.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: '01', icon: <Icon.Shield />, title: 'Connect & warm up', body: 'Plug in your sending inboxes. Sincerely auto-warms your domains across 50+ provider networks so you land in the primary inbox from day one.' },
    { n: '02', icon: <Icon.GitBranch />, title: 'Build & launch', body: 'Compose branching sequences with CRM-backed personalization, then launch to thousands of leads in under 30 seconds.' },
    { n: '03', icon: <Icon.Sparkles />, title: 'SARA books the meeting', body: 'Every reply is read, classified, and answered in your tone. Hot leads get booked straight onto your calendar — hands free.' },
  ];
  return (
    <section className="lp-section how" id="how">
      <div className="lp-wrap">
        <div className="lp-section-head reveal">
          <span className="lp-eyebrow">How it works</span>
          <h2 className="lp-h2">From cold list to <em>booked calendar</em>.</h2>
          <p className="lp-lede">Three steps from a raw list of prospects to meetings on your calendar — most teams are live the same afternoon.</p>
        </div>
        <div className="how__grid">
          <div className="how__line" />
          {steps.map((s, i) => (
            <div key={i} className="how__step reveal" style={{ transitionDelay: `${i * 90}ms` }}>
              <div className="how__step-top">
                <div className="how__icon">{s.icon}</div>
                <span className="how__num">{s.n}</span>
              </div>
              <h3 className="how__title">{s.title}</h3>
              <p className="how__body">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Sequences() {
  const tabs = [
    { id: 'builder', label: 'Builder', icon: <Icon.GitBranch /> },
    { id: 'audience', label: 'Audience', icon: <Icon.Users /> },
    { id: 'schedule', label: 'Schedule', icon: <Icon.Clock /> },
  ];
  const [tab, setTab] = useState('builder');

  const builder = (
    <>
      <div className="seq__step-row">
        <div className="seq__rail-col">
          <div className="seq__rail-dot">1</div>
          <div className="seq__rail-line" />
        </div>
        <div style={{ flex: 1 }}>
          <div className="seq__step">
            <div className="seq__step-head">
              <span className="seq__step-type"><Icon.Mail /> Email · Day 0</span>
              <span className="seq__step-wait"><Icon.Clock /> Wait 3 days</span>
            </div>
            <div className="seq__step-subject">Quick question, <span className="seq__var">{'{firstName}'}</span></div>
            <div className="seq__step-preview">
              Saw <span className="seq__var">{'{company}'}</span> just raised your Series A &mdash; congrats. We help teams like yours hit 28%+ reply rates on outbound. Worth a 15&#8209;min call?
            </div>
          </div>
        </div>
      </div>

      <div className="seq__cond">
        <Icon.GitBranch /> If no reply
      </div>

      <div className="seq__step-row">
        <div className="seq__rail-col">
          <div className="seq__rail-dot is-active">2</div>
          <div className="seq__rail-line" />
        </div>
        <div style={{ flex: 1 }}>
          <div className="seq__step is-active">
            <div className="seq__step-head">
              <span className="seq__step-type"><Icon.Mail /> Email · Day 3</span>
              <span className="seq__step-wait"><Icon.Clock /> Wait 4 days</span>
            </div>
            <div className="seq__step-subject">Re: Quick question, <span className="seq__var">{'{firstName}'}</span></div>
            <div className="seq__step-preview">
              Bumping this in case it got buried. Two of <span className="seq__var">{'{competitor}'}</span>'s peers
              hit a 4.2× reply lift in the first month. Curious if that's worth 15&nbsp;min for <span className="seq__var">{'{company}'}</span>?
            </div>
          </div>
        </div>
      </div>

      <div className="seq__cond" style={{ background: 'rgba(99,102,241,0.06)', borderColor: 'rgba(99,102,241,0.3)', color: 'var(--indigo-soft)' }}>
        <Icon.Sparkles /> SARA branch: detected interest &rarr; book meeting
      </div>

      <div className="seq__step-row">
        <div className="seq__rail-col">
          <div className="seq__rail-dot">3</div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="seq__step">
            <div className="seq__step-head">
              <span className="seq__step-type"><Icon.Calendar /> Auto-book · Day 7</span>
              <span className="seq__step-wait">via SARA</span>
            </div>
            <div className="seq__step-subject">Calendar link · 30-min intro</div>
            <div className="seq__step-preview">
              SARA proposes 3 time slots based on <span className="seq__var">{'{recipientTz}'}</span> and confirms automatically.
            </div>
          </div>
        </div>
      </div>
    </>
  );

  const audience = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['Series A · last 90 days', 'Title contains "Head of Growth"', 'Company size 11-50', 'Geography: US, CA, UK', 'Excludes: opened in last 30d'].map(t => (
          <span key={t} style={{ fontSize: 12, fontWeight: 500, padding: '7px 12px', borderRadius: 100, background: 'rgba(99,102,241,0.1)', color: 'var(--indigo-soft)', border: '1px solid rgba(99,102,241,0.22)' }}>{t}</span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginTop: 12 }}>
        {[
          { l: 'Total matched', v: '4,812', d: 'leads' },
          { l: 'New since yesterday', v: '+128', d: 'auto-synced' },
          { l: 'Avg score', v: '8.4', d: 'of 10' },
          { l: 'Est. reply rate', v: '24%', d: 'forecast' },
        ].map(k => (
          <div key={k.l} style={{ padding: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 11 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{k.l}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.04em', marginTop: 6, fontFeatureSettings: '"tnum"' }}>{k.v}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 4 }}>{k.d}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 11 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)', marginBottom: 14 }}>Lead score distribution</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 80 }}>
          {[14, 22, 38, 56, 72, 84, 92, 78, 62, 44].map((h, i) => (
            <div key={i} style={{ flex: 1, height: `${h}%`, background: i >= 5 ? 'linear-gradient(to top, #6366F1, #A5B4FC)' : 'linear-gradient(to top, rgba(255,255,255,0.12), rgba(255,255,255,0.05))', borderRadius: '3px 3px 0 0' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 10, color: 'var(--txt-3)' }}>
          <span>Score 1</span><span>Score 10</span>
        </div>
      </div>
    </div>
  );

  const schedule = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d}</div>
        ))}
        {Array.from({ length: 7 * 6 }, (_, i) => {
          const hour = Math.floor(i / 7);
          const day = i % 7;
          const intensity = (day >= 5 ? 0 : Math.sin((hour + 1) / 6 * Math.PI)) * (day === 1 || day === 2 || day === 3 ? 1 : 0.55);
          const opacity = Math.max(0.05, intensity);
          return <div key={i} style={{ height: 30, borderRadius: 5, background: `rgba(99,102,241,${opacity})`, border: `1px solid rgba(99,102,241,${opacity * 0.4})` }} />;
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.18)', borderRadius: 11 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Optimal send window detected</div>
          <div style={{ fontSize: 12, color: 'var(--txt-2)', marginTop: 3 }}>Tue&ndash;Thu, 9:30&ndash;11:00 recipient&apos;s local time</div>
        </div>
        <button style={{ fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 8, background: 'var(--green)', color: '#06160c', border: 'none', cursor: 'pointer' }}>Apply</button>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--txt-2)', padding: '7px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 100, border: '1px solid var(--border)' }}><Icon.Globe /> 14 timezones supported</span>
        <span style={{ fontSize: 12, color: 'var(--txt-2)', padding: '7px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 100, border: '1px solid var(--border)' }}><Icon.Clock /> Throttled 30/min per inbox</span>
        <span style={{ fontSize: 12, color: 'var(--txt-2)', padding: '7px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 100, border: '1px solid var(--border)' }}>Pauses on weekends</span>
      </div>
    </div>
  );

  return (
    <section className="lp-feat" id="sequences">
      <div className="lp-wrap">
        <div className="lp-feat__inner">
          <div className="lp-feat__text">
            <span className="lp-eyebrow">Sequences</span>
            <h2 className="lp-h2">Multi-step <em>flows</em> that adapt to every reply.</h2>
            <p className="lp-lede">Build branching outbound that reacts in real time. Reply detected? Pause. Out-of-office? Reschedule. Interested? SARA books the meeting for you.</p>
            <ul className="lp-feat__bullets">
              <li><Icon.Check /><span><b>Conditional branches</b> that respond to opens, clicks, replies, and intent &mdash; not just timers.</span></li>
              <li><Icon.Check /><span><b>Personalization variables</b> backed by your CRM, enrichment data, or custom fields.</span></li>
              <li><Icon.Check /><span><b>A/B test subject lines and bodies</b> with automatic winner promotion at 95% confidence.</span></li>
            </ul>
            <a className="lp-link" href="#sequences">Tour the sequence builder <Icon.ArrowRight /></a>
          </div>

          <div className="seq">
            <div className="seq__tabs">
              {tabs.map(tb => (
                <span key={tb.id} className={`seq__tab ${tab === tb.id ? 'is-active' : ''}`} onClick={() => setTab(tb.id)}>
                  {tb.icon} {tb.label}
                </span>
              ))}
            </div>
            <div className="seq__body">
              {tab === 'builder' && builder}
              {tab === 'audience' && audience}
              {tab === 'schedule' && schedule}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type InboxItem = {
  id: number; name: string; initials: string; color: string; time: string;
  intent: string; intentLabel: string; subject: string; preview: string;
  role: string; campaign?: string; message?: string; draft?: string;
};

function SARA() {
  const items: InboxItem[] = [
    {
      id: 0, name: 'Maya Chen', initials: 'MC', color: 'linear-gradient(135deg,#fbbf24,#f59e0b)',
      time: '2m', intent: 'interested', intentLabel: 'INTERESTED',
      subject: 'Re: Quick question, Maya',
      preview: "This is actually pretty timely &mdash; we're evaluating outbound tools this quarter. Could you send some times?",
      role: 'Head of Growth · Stripe',
      campaign: 'Q4 Outbound · Series A founders',
      message: "Hey,\n\nThis is actually pretty timely &mdash; we're evaluating outbound tools this quarter. Could you send some times next week to chat?\n\nMaya",
      draft: "Hi Maya,\n\nGreat to hear &mdash; happy to walk you through Sincerely. I have a few slots open next week:\n\n• Tue Apr 14, 10:00 AM PT\n• Wed Apr 15, 2:00 PM PT\n• Thu Apr 16, 9:30 AM PT\n\nIf none of those work, here's my calendar. I'll plan for 30 minutes and tailor the demo to your current outbound stack.\n\nBest,\nAlex",
    },
    {
      id: 1, name: 'David Okafor', initials: 'DO', color: 'linear-gradient(135deg,#34d399,#10b981)',
      time: '14m', intent: 'meeting', intentLabel: 'BOOK MEETING',
      subject: 'Re: Cold outreach for Brightline',
      preview: 'Sure, send me your Calendly. Tuesday or Thursday work best.',
      role: 'VP Sales · Brightline',
    },
    {
      id: 2, name: 'Priya Shah', initials: 'PS', color: 'linear-gradient(135deg,#f472b6,#ec4899)',
      time: '1h', intent: 'later', intentLabel: 'NURTURE',
      subject: 'Re: Reply rates for Nimbus?',
      preview: 'Not the right time &mdash; we just signed with another vendor. Check back in Q3?',
      role: 'Director, Demand Gen · Nimbus',
    },
    {
      id: 3, name: 'Out of Office', initials: 'OO', color: 'linear-gradient(135deg,#94a3b8,#64748b)',
      time: '3h', intent: 'ooo', intentLabel: 'AUTO-REPLY',
      subject: 'OOO &mdash; back Mar 11',
      preview: "I'll be out of office until Tuesday. For anything urgent, please reach&hellip;",
      role: 'Auto-detected · Reschedule for Mar 11',
    },
    {
      id: 4, name: 'Lena Park', initials: 'LP', color: 'linear-gradient(135deg,#818cf8,#6366f1)',
      time: '5h', intent: 'interested', intentLabel: 'INTERESTED',
      subject: 'Re: 15 minutes about your outbound',
      preview: 'Tell me more about how the AI inbox works.',
      role: 'COO · Atlas.io',
    },
  ];

  const [active, setActive] = useState(0);
  const cur = items[active];

  const [typed, setTyped] = useState('');
  useEffect(() => {
    setTyped('');
    const draft = cur.draft || '';
    if (!draft) return;
    let i = 0;
    let cancelled = false;
    const initialDelay = setTimeout(() => {
      const step = () => {
        if (cancelled) return;
        const ch = draft.charAt(i);
        i += 1;
        setTyped(draft.slice(0, i));
        if (i < draft.length) {
          const delay = ch === '\n' ? 80 : ch === ' ' ? 18 : 14 + Math.random() * 10;
          setTimeout(step, delay);
        }
      };
      step();
    }, 480);
    return () => { cancelled = true; clearTimeout(initialDelay); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <section className="lp-feat lp-feat--rev" id="sara">
      <div className="lp-wrap">
        <div className="lp-feat__inner lp-feat__inner--rev">
          <div className="sara">
            <div className="sara__list">
              <div className="sara__list-head">
                <div className="sara__list-title">
                  Unified inbox
                  <span className="sara__list-pill">SARA active</span>
                </div>
                <div className="sara__filter">
                  <span className="sara__filter-item is-active">All</span>
                  <span className="sara__filter-item">Hot</span>
                  <span className="sara__filter-item">Booked</span>
                </div>
              </div>
              {items.map((it, i) => (
                <div
                  key={it.id}
                  className={`sara__item ${i === active ? 'is-active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  <div className="sara__item-row1">
                    <div className="sara__item-name">
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: i === active || it.intent === 'interested' || it.intent === 'meeting' ? 'var(--indigo-hi)' : 'transparent', flexShrink: 0 }} />
                      {it.name}
                    </div>
                    <span className="sara__item-time">{it.time}</span>
                  </div>
                  <div className="sara__item-subj" dangerouslySetInnerHTML={{ __html: it.subject }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className={`sara__intent sara__intent--${it.intent}`}>{it.intentLabel}</span>
                    <span className="sara__item-prev" dangerouslySetInnerHTML={{ __html: it.preview }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="sara__detail">
              <div className="sara__detail-head">
                <div>
                  <h3 className="sara__detail-subj" dangerouslySetInnerHTML={{ __html: cur.subject }} />
                  <div className="sara__detail-meta">
                    <span><b>{cur.role}</b></span>
                    <span>·</span>
                    <span>{cur.campaign || 'Outbound campaign'}</span>
                  </div>
                </div>
                <span className={`sara__intent sara__intent--${cur.intent}`}>{cur.intentLabel}</span>
              </div>

              <div className="sara__msg">
                <div className="sara__msg-head">
                  <div className="sara__avatar sara__avatar--user" style={{ background: cur.color }}>{cur.initials}</div>
                  <div>
                    <div className="sara__msg-from">{cur.name} <small>· {cur.time} ago</small></div>
                  </div>
                </div>
                <div style={{ whiteSpace: 'pre-line' }} dangerouslySetInnerHTML={{ __html: cur.message || cur.preview }} />
              </div>

              {cur.draft && (
                <div className="sara__draft">
                  <div className="sara__draft-head">
                    <div className="sara__avatar sara__avatar--sara"><Icon.Sparkles /></div>
                    <div>
                      <span className="sara__draft-label"><Icon.Sparkles /> Drafted by SARA</span>
                      <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 3 }}>Personalized · Matches your tone &middot; Review before sending</div>
                    </div>
                  </div>
                  <div className="sara__draft-body" style={{ whiteSpace: 'pre-line' }}>
                    {typed}
                    <span className="sara__draft-cursor" />
                  </div>
                  <div className="sara__draft-actions">
                    <button className="sara__draft-btn sara__draft-btn--prim"><Icon.Send /> Send</button>
                    <button className="sara__draft-btn">Edit</button>
                    <button className="sara__draft-btn"><Icon.Sparkles /> Regenerate</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lp-feat__text">
            <span className="lp-eyebrow">SARA · AI Inbox</span>
            <h2 className="lp-h2">An AI co-pilot for <em>every reply</em>.</h2>
            <p className="lp-lede">SARA reads every inbound, classifies intent in milliseconds, and drafts a response that sounds like you. Out-of-office? Auto-reschedules. Hot lead? Books the meeting. Wrong fit? Politely closes.</p>
            <ul className="lp-feat__bullets">
              <li><Icon.Check /><span><b>Intent classification</b> across 9 categories &mdash; from hot lead to unsubscribe, with 96% accuracy.</span></li>
              <li><Icon.Check /><span><b>Drafts in your tone</b>, trained on your top-performing replies. You stay in control of every send.</span></li>
              <li><Icon.Check /><span><b>Auto-handles OOO replies</b>, calendar back-and-forth, and follow-ups so your team only sees real conversations.</span></li>
            </ul>
            <a className="lp-link" href="#sara">See SARA in action <Icon.ArrowRight /></a>
          </div>
        </div>
      </div>
    </section>
  );
}

function CountNum({ to, visible, duration = 1300 }: { to: number; visible: boolean; duration?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!visible) return;
    let raf: number;
    let t0: number | undefined;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (ts: number) => { if (!t0) t0 = ts; const p = Math.min(1, (ts - t0) / duration); setV(to * ease(p)); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, to, duration]);
  return <>{Math.round(v)}<span style={{ fontSize: '60%', color: 'rgba(255,255,255,0.4)' }}>%</span></>;
}

function Deliverability() {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.25 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const score = 97;
  const r = 76;
  const C = 2 * Math.PI * r;
  const target = visible ? C * (1 - score / 100) : C;

  const rows = [
    { name: 'SPF', val: 100, color: '#22C55E' },
    { name: 'DKIM', val: 100, color: '#22C55E' },
    { name: 'DMARC', val: 100, color: '#22C55E' },
    { name: 'Domain age', val: 98, color: '#22C55E' },
    { name: 'Spam triggers', val: 96, color: '#22C55E' },
    { name: 'Engagement', val: 92, color: '#A5B4FC' },
  ];

  return (
    <section className="lp-feat" id="deliverability" ref={ref}>
      <div className="lp-wrap">
        <div className="lp-feat__inner">
          <div className="lp-feat__text">
            <span className="lp-eyebrow">Deliverability</span>
            <h2 className="lp-h2">Every email lands in the <em>primary inbox</em>.</h2>
            <p className="lp-lede">Auto-warmup across 50+ provider networks, real-time inbox placement monitoring, and a domain reputation engine that catches issues before Google or Outlook ever do.</p>
            <ul className="lp-feat__bullets">
              <li><Icon.Check /><span><b>Auto-warmup at scale</b> &mdash; new domains hit production volume in 14 days, not 6 weeks.</span></li>
              <li><Icon.Check /><span><b>Live placement tests</b> across Gmail, Outlook, Yahoo, and corporate filters every send window.</span></li>
              <li><Icon.Check /><span><b>One-click SPF / DKIM / DMARC</b> with guided setup for every major DNS provider.</span></li>
            </ul>
            <a className="lp-link" href="#deliverability">Read the deliverability playbook <Icon.ArrowRight /></a>
          </div>

          <div className="del">
            <div className="del__head">
              <div>
                <div className="del__head-title">Domain health · acme.com</div>
                <div className="del__head-sub">Updated 14 seconds ago &middot; checked every 60s</div>
              </div>
              <span className="del__score-pill"><Icon.CheckCircle /> Excellent</span>
            </div>

            <div className="del__gauge-wrap">
              <div className="del__gauge">
                <svg viewBox="0 0 180 180">
                  <defs>
                    <linearGradient id="gscore" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#4ADE80" />
                      <stop offset="55%" stopColor="#A5B4FC" />
                      <stop offset="100%" stopColor="#818CF8" />
                    </linearGradient>
                  </defs>
                  <circle cx="90" cy="90" r={r} className="del__gauge-track" />
                  <circle
                    cx="90" cy="90" r={r}
                    className="del__gauge-fill"
                    stroke="url(#gscore)"
                    strokeDasharray={C}
                    strokeDashoffset={target}
                  />
                </svg>
                <div className="del__gauge-center">
                  <div className="del__gauge-num">
                    <CountNum to={score} visible={visible} />
                  </div>
                  <div className="del__gauge-label">Inbox rate</div>
                </div>
              </div>
              <div className="del__breakdown">
                {rows.map(row => (
                  <div key={row.name} className="del__row">
                    <div className="del__row-name">{row.name}</div>
                    <div className="del__row-bar">
                      <div
                        className="del__row-bar-fill"
                        style={{ width: visible ? `${row.val}%` : '0%', background: `linear-gradient(to right, ${row.color}88, ${row.color})` }}
                      />
                    </div>
                    <div className="del__row-val">{row.val}%</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="del__check-grid">
              <div className="del__check">
                <div className="del__check-icon"><Icon.Check /></div>
                <div><b>SPF</b><div style={{ fontSize: 11, color: 'var(--txt-3)' }}>v=spf1 include:_spf...</div></div>
              </div>
              <div className="del__check">
                <div className="del__check-icon"><Icon.Check /></div>
                <div><b>DKIM</b><div style={{ fontSize: 11, color: 'var(--txt-3)' }}>2048-bit · verified</div></div>
              </div>
              <div className="del__check">
                <div className="del__check-icon"><Icon.Check /></div>
                <div><b>DMARC</b><div style={{ fontSize: 11, color: 'var(--txt-3)' }}>p=quarantine, pct=100</div></div>
              </div>
              <div className="del__check">
                <div className="del__check-icon"><Icon.Check /></div>
                <div><b>MX records</b><div style={{ fontSize: 11, color: 'var(--txt-3)' }}>3 healthy · 0 errors</div></div>
              </div>
              <div className="del__check">
                <div className="del__check-icon"><Icon.Check /></div>
                <div><b>Warmup</b><div style={{ fontSize: 11, color: 'var(--txt-3)' }}>Day 14 of 14 · complete</div></div>
              </div>
              <div className="del__check">
                <div className="del__check-icon del__check-icon--warn"><Icon.Zap /></div>
                <div><b>Blocklists</b><div style={{ fontSize: 11, color: 'var(--txt-3)' }}>0 of 87 · clean</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Integrations() {
  const apps = [
    { name: 'Salesforce', cat: 'CRM', letter: 'sf' },
    { name: 'HubSpot', cat: 'CRM', letter: 'hs' },
    { name: 'Pipedrive', cat: 'CRM', letter: 'pd' },
    { name: 'Gmail', cat: 'Mailbox', letter: 'gm' },
    { name: 'Outlook', cat: 'Mailbox', letter: 'ol' },
    { name: 'Apollo', cat: 'Enrichment', letter: 'ap' },
    { name: 'Clearbit', cat: 'Enrichment', letter: 'cb' },
    { name: 'Slack', cat: 'Notifications', letter: 'sl' },
    { name: 'Calendly', cat: 'Scheduling', letter: 'cal' },
    { name: 'Zapier', cat: 'Automation', letter: 'zp' },
    { name: 'Segment', cat: 'Data', letter: 'sg' },
    { name: 'Webhooks', cat: 'Developer', letter: '{ }' },
  ];
  return (
    <section className="lp-section intg" id="integrations">
      <div className="lp-wrap">
        <div className="lp-section-head reveal">
          <span className="lp-eyebrow">Integrations</span>
          <h2 className="lp-h2">Plugs into your <em>whole stack</em>.</h2>
          <p className="lp-lede">Two-way sync with your CRM, enrichment, and scheduling tools — plus a full REST API and webhooks when you need to go custom.</p>
        </div>
        <div className="intg__grid">
          {apps.map((a, i) => (
            <div key={i} className="intg__card reveal" style={{ transitionDelay: `${(i % 4) * 60}ms` }}>
              <span className="intg__mono">{a.letter}</span>
              <div className="intg__meta">
                <div className="intg__name">{a.name}</div>
                <div className="intg__cat">{a.cat}</div>
              </div>
              <span className="intg__plug"><Icon.Check /></span>
            </div>
          ))}
        </div>
        <div className="intg__foot reveal"><span><Icon.Globe /> 60+ native integrations · REST API · Webhooks · Zapier</span></div>
      </div>
    </section>
  );
}

function Stats() {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.3 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  const stats = [
    { v: '97%', l: 'Median inbox placement' },
    { v: '4.2×', l: 'More meetings booked' },
    { v: '12M+', l: 'Emails sent every month' },
    { v: '< 30s', l: 'To launch a campaign' },
  ];
  return (
    <section className={`lp-stats ${visible ? 'is-visible' : ''}`} ref={ref}>
      <div className="lp-wrap">
        <div className="lp-stats__grid">
          {stats.map((s, i) => (
            <div key={i} className="lp-stats__item">
              <span className="lp-stats__value">{s.v}</span>
              <span className="lp-stats__label">{s.l}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const [annual, setAnnual] = useState(true);

  type Feat = [string, boolean, boolean?];
  const tiers: { name: string; pitch: string; m: number | string; y: number | string; cta: string; featured?: boolean; badge?: string; feats: Feat[] }[] = [
    {
      name: 'Starter',
      pitch: 'For solo founders and small outbound teams getting started.',
      m: 39, y: 348,
      cta: 'Start free trial',
      feats: [
        ['Up to 3 sending inboxes', true],
        ['1,500 emails / month', true],
        ['Sequence builder with branches', true],
        ['Unified inbox', true],
        ['Auto-warmup included', true],
        ['Email support', true],
      ],
    },
    {
      name: 'Growth',
      pitch: 'Scale outbound across your team with SARA inbox assist.',
      m: 59, y: 499,
      featured: true, badge: 'MOST POPULAR',
      cta: 'Start free trial',
      feats: [
        ['Up to 25 sending inboxes', true],
        ['15,000 emails / month', true],
        ['Everything in Starter', true, true],
        ['SARA AI inbox assist', true],
        ['A/B testing & winner promotion', true],
        ['Custom domain warmup', true],
        ['Priority Slack support', true],
      ],
    },
    {
      name: 'Scale',
      pitch: 'For agencies and revenue teams running outbound as a system.',
      m: 'Custom', y: 'Custom',
      cta: 'Talk to sales',
      feats: [
        ['Unlimited sending inboxes', true],
        ['Unlimited volume', true],
        ['Everything in Growth', true, true],
        ['Multi-workspace & client roles', true],
        ['SAML SSO + audit log', true],
        ['Dedicated CSM', true],
        ['SLA + 24/7 support', true],
      ],
    },
  ];

  return (
    <section className="lp-pricing" id="pricing">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Pricing</span>
          <h2 className="lp-h2">Pricing that <em>scales</em> with you.</h2>
          <p className="lp-lede">Start with a 10-day free trial. Pay only for active inboxes &mdash; never for seats.</p>
          <div className="lp-pricing__toggle">
            <button className={`lp-pricing__toggle-btn ${!annual ? 'is-active' : ''}`} onClick={() => setAnnual(false)}>Monthly</button>
            <button className={`lp-pricing__toggle-btn ${annual ? 'is-active' : ''}`} onClick={() => setAnnual(true)}>
              Annual <span className="lp-pricing__save">SAVE up to 30%</span>
            </button>
          </div>
        </div>

        <div className="lp-pricing__grid">
          {tiers.map(t => {
            const price = annual ? t.y : t.m;
            const isNum = typeof price === 'number';
            return (
              <div key={t.name} className={`lp-tier ${t.featured ? 'lp-tier--feat' : ''}`}>
                {t.badge && <span className="lp-tier__badge">{t.badge}</span>}
                <div className="lp-tier__name">{t.name}</div>
                <p className="lp-tier__pitch">{t.pitch}</p>

                <div className="lp-tier__price">
                  {isNum ? (
                    <>
                      <span className="lp-tier__price-curr">$</span>
                      <span className="lp-tier__price-num">{price}</span>
                      <span className="lp-tier__price-per">/ {annual ? 'yr' : 'mo'}</span>
                    </>
                  ) : (
                    <span className="lp-tier__price-num" style={{ fontSize: 36 }}>{price}</span>
                  )}
                </div>
                <p className="lp-tier__price-note">
                  {isNum
                    ? (annual ? 'Billed once annually · 10-day free trial' : '10-day free trial · cancel anytime')
                    : 'Volume pricing · annual contract'}
                </p>

                <Link to="/signup" className={`lp-tier__btn ${t.featured ? 'lp-tier__btn--prim' : ''}`}>
                  {t.cta}
                </Link>

                <ul className="lp-tier__feats">
                  {t.feats.map(([label, , divider], i) => (
                    divider
                      ? <li key={i} className="lp-tier__feats-divider" style={{ listStyle: 'none', display: 'block' }}>{label}</li>
                      : <li key={i}><Icon.Check /> <span>{label}</span></li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  const quotes = [
    {
      body: "We replaced three tools with Sincerely and our reply rate doubled in the first month. SARA alone saves our team about 12 hours a week.",
      stat: '2.4×', statLabel: 'reply rate growth in 30 days', name: 'Maya Chen', role: 'Head of Growth, Brightline', initials: 'MC',
    },
    {
      body: "Deliverability has been a non&#8209;issue since switching. We went from 60% inbox placement on Gmail to a consistent 96+. That's the whole game.",
      stat: '96%', statLabel: 'inbox placement on Gmail', name: 'David Okafor', role: 'VP Sales, Nimbus', initials: 'DO',
    },
    {
      body: "I was skeptical about AI in the inbox &mdash; until SARA started drafting replies that sounded more like me than my own follow-ups did. It just works.",
      stat: '12 hrs', statLabel: 'saved per rep, per week', name: 'Priya Shah', role: 'Founder, Peachfin', initials: 'PS',
    },
  ];
  return (
    <section className="lp-testi" id="customers">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="lp-eyebrow">Customers</span>
          <h2 className="lp-h2">Loved by teams that <em>actually</em> send.</h2>
          <p className="lp-lede">4,200+ outbound teams ship more pipeline with Sincerely &mdash; here's what a few of them say.</p>
        </div>
        <div className="lp-testi__grid">
          {quotes.map((q, i) => (
            <div key={i} className="lp-quote">
              <div className="lp-quote__mark">&ldquo;</div>
              <p className="lp-quote__body" dangerouslySetInnerHTML={{ __html: q.body }} />
              <div className="lp-quote__stat">
                <div className="lp-quote__stat-num">{q.stat}</div>
                <div className="lp-quote__stat-label">{q.statLabel}</div>
              </div>
              <div className="lp-quote__author">
                <div className="lp-quote__avatar">{q.initials}</div>
                <div>
                  <div className="lp-quote__name">{q.name}</div>
                  <div className="lp-quote__role">{q.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const qs = [
    { q: 'How fast can I start sending?', a: 'Most teams launch their first campaign the same afternoon. Connect an inbox, import a list, and Sincerely handles warmup and throttling automatically in the background.' },
    { q: 'Do you provide domains and inboxes?', a: 'Yes. Bring your own, or spin up managed sending domains and mailboxes inside Sincerely — pre-configured with SPF, DKIM, and DMARC and warmed for you.' },
    { q: 'How does warmup actually work?', a: 'New domains ramp to production volume over 14 days across 50+ provider networks, building real engagement signals and sender reputation before you send a single campaign.' },
    { q: 'Will SARA sound like a robot?', a: 'SARA trains on your top-performing replies and drafts in your tone. Every draft is yours to review, edit, or send — you stay in control of every message that goes out.' },
    { q: 'Can I keep my existing CRM?', a: 'Two-way sync with Salesforce, HubSpot, Pipedrive and more keeps leads, activity, and booked meetings flowing in both directions in real time.' },
    { q: 'What if a domain gets flagged?', a: 'Real-time blocklist and inbox-placement monitoring catches issues before Google or Outlook do, and automatically pauses affected inboxes while it remediates.' },
  ];
  return (
    <section className="lp-section faq" id="faq">
      <div className="lp-wrap lp-wrap--narrow">
        <div className="lp-section-head reveal">
          <span className="lp-eyebrow">FAQ</span>
          <h2 className="lp-h2">Questions, <em>answered</em>.</h2>
        </div>
        <div className="faq__list">
          {qs.map((item, i) => (
            <details key={i} className="faq__item reveal" style={{ transitionDelay: `${i * 50}ms` }}>
              <summary className="faq__q">{item.q}<span className="faq__icon"><Icon.Plus /></span></summary>
              <div className="faq__a">{item.a}</div>
            </details>
          ))}
        </div>
        <div className="faq__cta reveal">Still curious? <a href="#top">Talk to our team <Icon.ArrowRight /></a></div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="lp-cta">
      <div className="lp-wrap">
        <div className="lp-cta__block">
          <div className="lp-cta__inner">
            <h2 className="lp-cta__title">
              Turn cold email into<br />
              <em>booked meetings</em>.
            </h2>
            <p className="lp-cta__sub">
              Free for 14 days. No credit card. Bring your own domain or use one of ours &mdash; we'll have you sending by lunch.
            </p>
            <div className="lp-cta__ctas">
              <Link className="lp-btn lp-btn--hero" to="/signup">Start sending free <Icon.ArrowRight className="lp-btn__arrow" /></Link>
              <a className="lp-btn lp-btn--ghost" href="#top"><Icon.Calendar /> Book a demo</a>
            </div>
            <p className="lp-cta__trust">No credit card required &middot; 500 emails free &middot; Cancel anytime</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const cols: { title: string; links: [string, string?][] }[] = [
    { title: 'Product', links: [['Sequences'], ['SARA · AI inbox'], ['Deliverability'], ['Analytics'], ['Integrations'], ['Changelog', 'NEW']] },
    { title: 'Solutions', links: [['For founders'], ['For sales teams'], ['For agencies'], ['For recruiters'], ['Lead enrichment'], ['CRM sync']] },
    { title: 'Resources', links: [['Docs'], ['API reference'], ['Deliverability guide'], ['Outbound playbook'], ['Cold email examples'], ['Help center']] },
    { title: 'Company', links: [['About'], ['Customers'], ['Careers', 'HIRING'], ['Blog'], ['Security'], ['Contact']] },
  ];
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-footer__inner">
          <div className="lp-footer__brand">
            <a className="lp-header__logo" href="#top">
              <span className="lp-header__logo-mark"><Icon.Mark /></span>
              <span className="lp-header__logo-name">sincerely</span>
            </a>
            <p className="lp-footer__tagline">Cold email that books meetings. Built for outbound teams that care about both scale and signal.</p>
            <div className="lp-footer__socials">
              <a className="lp-footer__social" href="#top" aria-label="Twitter"><Icon.Twitter /></a>
              <a className="lp-footer__social" href="#top" aria-label="LinkedIn"><Icon.LinkedIn /></a>
              <a className="lp-footer__social" href="#top" aria-label="GitHub"><Icon.Github /></a>
              <a className="lp-footer__social" href="#top" aria-label="Discord"><Icon.Discord /></a>
            </div>
          </div>
          <div className="lp-footer__cols">
            {cols.map(c => (
              <div key={c.title}>
                <h4 className="lp-footer__col-title">{c.title}</h4>
                <ul className="lp-footer__links">
                  {c.links.map(([label, tag], i) => (
                    <li key={i}>
                      <a className="lp-footer__link" href="#top">
                        {label}
                        {tag && <span className="lp-footer__link-tag">{tag}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="lp-footer__bottom">
          <p className="lp-footer__copy">&copy; 2026 Sincerely, Inc. &middot; All rights reserved.</p>
          <a className="lp-footer__status" href="#top">
            <span className="lp-footer__status-dot" />
            All systems operational
          </a>
          <p className="lp-footer__copy">
            <a className="lp-footer__link" href="#top" style={{ marginRight: 16 }}>Privacy</a>
            <a className="lp-footer__link" href="#top" style={{ marginRight: 16 }}>Terms</a>
            <a className="lp-footer__link" href="#top">DPA</a>
          </p>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage() {
  const ref = useRef<HTMLDivElement>(null);
  const [light, setLight] = useState(() => {
    try { return localStorage.getItem('sincerely-landing-theme') === 'light'; } catch { return false; }
  });
  const toggleTheme = () => setLight((v) => {
    const nv = !v;
    try { localStorage.setItem('sincerely-landing-theme', nv ? 'light' : 'dark'); } catch { /* ignore */ }
    return nv;
  });

  // Scroll-reveal — mirror the design's IntersectionObserver, scoped to this page.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('.reveal'));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { els.forEach(el => el.classList.add('is-visible')); return; }
    const show = (el: Element) => el.classList.add('is-visible');
    els.forEach(el => { const r = el.getBoundingClientRect(); if (r.top < window.innerHeight * 0.92) show(el); });
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { show(e.target); obs.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(el => { if (!el.classList.contains('is-visible')) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  // Match the page background to the landing theme while the site is mounted.
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = light ? '#FFFFFF' : '#070A14';
    return () => { document.body.style.background = prev; };
  }, [light]);

  return (
    <div className={`md-landing ${light ? 'is-light' : ''}`} data-atmosphere="flat" data-density="roomy" ref={ref}>
      <Header light={light} onToggle={toggleTheme} />
      <div className="lp-stage">
        <Hero />
        <Logos />
        <HowItWorks />
        <Sequences />
        <SARA />
        <Deliverability />
        <Integrations />
        <Stats />
        <Pricing />
        <Testimonials />
        <FAQ />
        <CTA />
        <Footer />
      </div>
    </div>
  );
}

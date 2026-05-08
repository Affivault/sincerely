import { Link } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import {
  ArrowRight,
  Check,
  BarChart3,
  Users,
  Zap,
  Sparkles,
  ChevronRight,
  TrendingUp,
  Mail,
  Shield,
} from 'lucide-react';
import { SkySendLogo } from '../components/SkySendLogo';

// ─── Static data ────────────────────────────────────────────────────────────

const logos = ['Vercel', 'Stripe', 'Linear', 'Figma', 'Notion', 'Loom', 'Raycast', 'Arc'];

const stats = [
  { value: '10M+', label: 'Emails sent monthly' },
  { value: '98.7%', label: 'Deliverability rate' },
  { value: '3.2×', label: 'Reply rate lift' },
  { value: '500+', label: 'Enterprise teams' },
];

const lifetimeFeatures = [
  'Unlimited email campaigns',
  'Unlimited sequences & steps',
  'AI send-time optimisation',
  'AI Assist (inbox reply assistant)',
  'Deliverability engine & warmup',
  'Real-time analytics dashboard',
  'A/B testing for subjects & body',
  'Custom domain setup',
  'All future updates included',
  'Priority support',
];

const testimonials = [
  {
    quote: 'We replaced three tools with SkySend. The platform saved us $40K annually while improving every metric across the board.',
    author: 'David Kim',
    role: 'CRO, Meridian',
    metric: '$40K',
    metricLabel: 'saved annually',
    initials: 'DK',
  },
  {
    quote: 'AI Assist handles our reply triage. What used to take my team 3 hours a day now takes 15 minutes — with better accuracy.',
    author: 'Emily Park',
    role: 'Director of Marketing, ScaleUp',
    metric: '12×',
    metricLabel: 'faster triage',
    initials: 'EP',
  },
  {
    quote: 'Deliverability went from 89% to 98.7% in under two weeks. Our meeting rate followed immediately.',
    author: 'Marcus Johnson',
    role: 'VP Sales, GrowthLabs',
    metric: '98.7%',
    metricLabel: 'deliverability',
    initials: 'MJ',
  },
];

const mockBarData = [38, 52, 47, 68, 61, 79, 72, 88, 83, 94, 89, 97];
const mockDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// ─── Scroll reveal ──────────────────────────────────────────────────────────

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('is-visible')),
      { threshold: 0.07, rootMargin: '0px 0px -60px 0px' }
    );
    ref.current?.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LandingPage() {
  const page = useReveal();

  return (
    <div ref={page} className="lp">

      {/* ══════════════════════════ NAV ══════════════════════════════════════ */}
      <header className="lp-header">
        <div className="lp-header__inner">
          <Link to="/" className="lp-header__logo"><SkySendLogo inverted /></Link>

          <nav className="lp-header__nav">
            <a href="#features" className="lp-header__link">Features</a>
            <a href="#pricing"  className="lp-header__link">Pricing</a>
            <a href="#reviews"  className="lp-header__link">Reviews</a>
          </nav>

          <div className="lp-header__actions">
            <Link to="/login"  className="lp-header__login">Log in</Link>
            <Link to="/signup" className="lp-btn lp-btn--primary">
              Get started <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* ══════════════════════════ HERO ═════════════════════════════════════ */}
      <section className="lp-hero">
        {/* Grid + glow */}
        <div className="lp-hero__grid" />
        <div className="lp-hero__glow" />

        <div className="lp-wrap lp-hero__body">

          {/* Announcement */}
          <div className="lp-pill lp-hero__pill">
            <span className="lp-pill__dot" />
            <span className="lp-pill__label">New</span>
            <span className="lp-pill__divider" />
            <span className="lp-pill__text">AI Assist now powered by GPT-4o</span>
            <ChevronRight size={12} className="lp-pill__arrow" />
          </div>

          {/* Headline */}
          <h1 className="lp-hero__headline">
            Cold outreach,<br />
            <em className="lp-hero__em">engineered</em> to convert.
          </h1>

          <p className="lp-hero__sub">
            The AI-powered outreach platform that puts every email in the primary inbox
            and turns cold prospects into booked meetings — at enterprise scale.
          </p>

          <div className="lp-hero__ctas">
            <Link to="/signup" className="lp-btn lp-btn--hero">
              Start for free <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="lp-btn lp-btn--ghost">
              View dashboard
            </Link>
          </div>

          <p className="lp-hero__trust">
            Free 14-day trial · No credit card required · Cancel anytime
          </p>

          <div style={{ marginTop: 14 }}>
            <Link
              to="/lp2"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.45)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
                padding: '6px 12px', textDecoration: 'none',
                background: 'rgba(255,255,255,0.04)',
              }}
            >
              ✦ Preview new design
            </Link>
          </div>

        </div>

        {/* ── App Mockup ── */}
        <div className="lp-wrap lp-hero__mockup-wrap">
          <div className="lp-mockup">

            {/* Chrome bar */}
            <div className="lp-mockup__chrome">
              <span className="lp-mockup__dot" />
              <span className="lp-mockup__dot" />
              <span className="lp-mockup__dot" />
              <span className="lp-mockup__chrome-title">SkySend · Campaign Analytics</span>
              <div className="lp-mockup__chrome-live">
                <span className="lp-mockup__live-dot" />
                Live
              </div>
            </div>

            {/* Dashboard layout */}
            <div className="lp-mockup__layout">

              {/* Sidebar */}
              <aside className="lp-mockup__sidebar">
                {[Mail, Users, BarChart3, Sparkles, Shield].map((Icon, i) => (
                  <div key={i} className={`lp-mockup__nav-item${i === 2 ? ' is-active' : ''}`}>
                    <Icon size={16} />
                  </div>
                ))}
              </aside>

              {/* Main */}
              <div className="lp-mockup__main">

                {/* KPI row */}
                <div className="lp-mockup__kpi-row">
                  {[
                    { label: 'Emails Sent', value: '5,276', delta: '+12%', up: true },
                    { label: 'Open Rate',   value: '72.4%', delta: '+8%',  up: true },
                    { label: 'Reply Rate',  value: '28.4%', delta: '+19%', up: true },
                    { label: 'Booked',      value: '143',   delta: '+31%', up: true },
                  ].map((k, i) => (
                    <div key={i} className="lp-mockup__kpi">
                      <span className="lp-mockup__kpi-label">{k.label}</span>
                      <span className="lp-mockup__kpi-value">{k.value}</span>
                      <span className="lp-mockup__kpi-delta">{k.delta}</span>
                    </div>
                  ))}
                </div>

                {/* Chart */}
                <div className="lp-mockup__chart-wrap">
                  <div className="lp-mockup__chart-header">
                    <span className="lp-mockup__chart-title">Reply rate — last 14 days</span>
                    <span className="lp-mockup__chart-legend">
                      <span className="lp-mockup__legend-dot lp-mockup__legend-dot--indigo" />replies
                    </span>
                  </div>
                  <div className="lp-mockup__chart">
                    {mockBarData.map((h, i) => (
                      <div key={i} className="lp-mockup__bar-wrap">
                        <div
                          className="lp-mockup__bar"
                          style={{ height: `${h}%` }}
                        />
                        <span className="lp-mockup__bar-label">{mockDays[i]}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Campaign rows */}
                <div className="lp-mockup__table">
                  <div className="lp-mockup__table-head">
                    <span>Campaign</span><span>Open</span><span>Reply</span>
                  </div>
                  {[
                    { name: 'Q4 Outreach — Series A', open: '67.2%', reply: '18.4%', live: true  },
                    { name: 'Partnership Discovery',   open: '72.8%', reply: '22.1%', live: true  },
                    { name: 'Enterprise Demos',        open: '81.4%', reply: '31.8%', live: true  },
                  ].map((row, i) => (
                    <div key={i} className={`lp-mockup__table-row${i === 0 ? ' is-selected' : ''}`}>
                      <div className="lp-mockup__table-name">
                        <span className={`lp-mockup__status${row.live ? ' is-live' : ''}`} />
                        {row.name}
                      </div>
                      <span className="lp-mockup__table-cell">{row.open}</span>
                      <span className={`lp-mockup__table-cell${parseFloat(row.reply) > 20 ? ' is-green' : ''}`}>
                        {row.reply}
                      </span>
                    </div>
                  ))}
                </div>

              </div>
            </div>
          </div>
        </div>

      </section>

      {/* ══════════════════════════ LOGOS ════════════════════════════════════ */}
      <div className="lp-logos">
        <div className="lp-wrap lp-logos__inner">
          <p className="lp-logos__eyebrow">Trusted by teams at</p>
          <div className="lp-logos__row">
            {logos.map((n) => <span key={n} className="lp-logos__name">{n}</span>)}
          </div>
        </div>
      </div>

      {/* ══════════════════════════ STATS ════════════════════════════════════ */}
      <section className="lp-stats">
        <div className="lp-wrap">
          <div className="lp-stats__grid">
            {stats.map((s, i) => (
              <div key={i} className="reveal lp-stats__item">
                <span className="lp-stats__value">{s.value}</span>
                <span className="lp-stats__label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════ FEATURES ═════════════════════════════════ */}
      <section id="features" className="lp-features">

        {/* Header */}
        <div className="lp-wrap">
          <div className="reveal lp-features__header">
            <h2 className="lp-h2">Everything serious<br />sales teams need.</h2>
            <p className="lp-body lp-features__sub">
              From the first send to the signed contract — one platform, zero compromises.
            </p>
          </div>
        </div>

        {/* Feature 1 — Sequences */}
        <div className="lp-feature-row lp-feature-row--normal">
          <div className="lp-wrap lp-feature-row__inner">

            <div className="reveal lp-feature-row__text">
              <p className="lp-overline">01 — Intelligent Sequences</p>
              <h3 className="lp-h3">Campaigns that adapt,<br />automatically.</h3>
              <p className="lp-body">
                Multi-step sequences with AI-optimised send windows, smart
                delays, and conditional branching based on what each prospect
                actually does. Set it once, let it run.
              </p>
              <ul className="lp-checklist">
                {['AI send-time optimisation', 'Conditional branching on opens & clicks', 'Unlimited sequence steps', 'A/B test subjects and body copy'].map(f => (
                  <li key={f} className="lp-checklist__item">
                    <Check size={14} className="lp-checklist__icon" />{f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="reveal lp-feature-row__visual">
              {/* Sequence flow visual */}
              <div className="lp-seq">
                <div className="lp-seq__header">Email Sequence Builder</div>
                {[
                  { step: 1, label: 'Initial outreach',  delay: null,   status: 'sent' },
                  { step: 2, label: 'Follow-up #1',      delay: '3 days', status: 'sent' },
                  { step: 3, label: 'Follow-up #2',      delay: '5 days', status: 'active' },
                  { step: 4, label: 'Break-up email',    delay: '7 days', status: 'pending' },
                ].map((step, i) => (
                  <div key={i} className="lp-seq__item">
                    {step.delay && (
                      <div className="lp-seq__delay">
                        <span className="lp-seq__delay-line" />
                        <span className="lp-seq__delay-label">{step.delay}</span>
                      </div>
                    )}
                    <div className={`lp-seq__step lp-seq__step--${step.status}`}>
                      <div className="lp-seq__step-num">{step.step}</div>
                      <span className="lp-seq__step-label">{step.label}</span>
                      <span className={`lp-seq__badge lp-seq__badge--${step.status}`}>
                        {step.status === 'sent' ? 'Sent' : step.status === 'active' ? 'Active' : 'Scheduled'}
                      </span>
                    </div>
                  </div>
                ))}
                <div className="lp-seq__branch">
                  <div className="lp-seq__branch-header">Conditional logic</div>
                  <div className="lp-seq__branch-row">
                    <div className="lp-seq__branch-card lp-seq__branch-card--positive">
                      <Zap size={12} /> Opened → Send meeting link
                    </div>
                    <div className="lp-seq__branch-card lp-seq__branch-card--neutral">
                      No open → Mark complete
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Feature 2 — Deliverability */}
        <div className="lp-feature-row lp-feature-row--reverse">
          <div className="lp-wrap lp-feature-row__inner">

            <div className="reveal lp-feature-row__visual">
              {/* Deliverability score visual */}
              <div className="lp-deliv">
                <div className="lp-deliv__header">
                  <span>Deliverability Engine</span>
                  <span className="lp-deliv__status">● Active</span>
                </div>
                <div className="lp-deliv__score">
                  <div className="lp-deliv__score-ring">
                    <svg viewBox="0 0 120 120" className="lp-deliv__svg">
                      <circle cx="60" cy="60" r="50" className="lp-deliv__track" />
                      <circle cx="60" cy="60" r="50" className="lp-deliv__arc"
                        strokeDasharray="314" strokeDashoffset="4" />
                    </svg>
                    <div className="lp-deliv__score-inner">
                      <span className="lp-deliv__pct">98.7%</span>
                      <span className="lp-deliv__pct-label">delivered</span>
                    </div>
                  </div>
                </div>
                <div className="lp-deliv__checks">
                  {[
                    { label: 'Domain health',    value: 'Excellent' },
                    { label: 'Spam score',        value: '0.1 / 10'  },
                    { label: 'Email warmup',      value: 'Active'    },
                    { label: 'DKIM / SPF / DMARC',value: 'Passing'   },
                  ].map((c, i) => (
                    <div key={i} className="lp-deliv__check">
                      <span className="lp-deliv__check-dot" />
                      <span className="lp-deliv__check-label">{c.label}</span>
                      <span className="lp-deliv__check-value">{c.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="reveal lp-feature-row__text">
              <p className="lp-overline">02 — Deliverability Engine</p>
              <h3 className="lp-h3">Primary inbox,<br />every time.</h3>
              <p className="lp-body">
                Built-in email warmup, reputation monitoring, and real-time
                domain health scoring. We obsess over deliverability so
                you never have to wonder where your emails went.
              </p>
              <ul className="lp-checklist">
                {['Automated email warmup', 'Real-time spam score monitoring', 'Domain health & DKIM scoring', 'Inbox placement testing'].map(f => (
                  <li key={f} className="lp-checklist__item">
                    <Check size={14} className="lp-checklist__icon" />{f}
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>

        {/* Feature 3 — SARA AI */}
        <div className="lp-feature-row lp-feature-row--normal">
          <div className="lp-wrap lp-feature-row__inner">

            <div className="reveal lp-feature-row__text">
              <p className="lp-overline">03 — AI Assist</p>
              <h3 className="lp-h3">Reply faster.<br />Close more.</h3>
              <p className="lp-body">
                AI Assist automatically classifies every reply by intent and
                drafts context-aware responses in seconds. Your team focuses
                on conversations that close — not inbox admin.
              </p>
              <ul className="lp-checklist">
                {['Automatic intent classification', 'AI-drafted replies in seconds', 'One-click send or edit', 'Full thread context awareness'].map(f => (
                  <li key={f} className="lp-checklist__item">
                    <Check size={14} className="lp-checklist__icon" />{f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="reveal lp-feature-row__visual">
              {/* SARA AI inbox visual */}
              <div className="lp-sara">
                <div className="lp-sara__header">
                  <Sparkles size={14} style={{ color: '#818CF8' }} />
                  AI Assist · Reply Assistant
                </div>
                <div className="lp-sara__email">
                  <div className="lp-sara__email-from">
                    <div className="lp-sara__avatar">JD</div>
                    <div>
                      <div className="lp-sara__email-name">James Dalton</div>
                      <div className="lp-sara__email-sub">Re: Your outreach · 2 min ago</div>
                    </div>
                    <div className="lp-sara__intent-badge">Interested</div>
                  </div>
                  <p className="lp-sara__email-body">
                    "Thanks for reaching out! We've been looking for a solution
                    like this. Can you send over pricing and a quick demo slot?"
                  </p>
                </div>
                <div className="lp-sara__divider">
                  <span className="lp-sara__divider-label">
                    <Sparkles size={11} /> AI draft ready
                  </span>
                </div>
                <div className="lp-sara__draft">
                  <p className="lp-sara__draft-body">
                    Hi James, great to hear from you! I'd love to show you SkySend
                    in action. Here's a link to book a 20-minute demo at your
                    convenience: [calendly link]. Pricing starts at $149/mo for
                    the Professional plan...
                  </p>
                </div>
                <div className="lp-sara__actions">
                  <button className="lp-sara__send">Send reply</button>
                  <button className="lp-sara__edit">Edit</button>
                  <button className="lp-sara__discard">Discard</button>
                </div>
              </div>
            </div>

          </div>
        </div>

      </section>

      {/* ══════════════════════════ HERO QUOTE ═══════════════════════════════ */}
      <section className="lp-hero-quote">
        <div className="lp-wrap">
          <div className="reveal lp-hero-quote__inner">
            <div className="lp-hero-quote__mark">"</div>
            <blockquote className="lp-hero-quote__text">
              We went from 2% to 12% reply rates in three weeks.
              The AI-driven send optimisation alone was worth the switch.
            </blockquote>
            <div className="lp-hero-quote__author">
              <div className="lp-hero-quote__avatar">SC</div>
              <div>
                <div className="lp-hero-quote__name">Sarah Chen</div>
                <div className="lp-hero-quote__role">Head of Sales, TechCorp</div>
              </div>
              <div className="lp-hero-quote__metric">
                <span className="lp-hero-quote__metric-num">6×</span>
                <span className="lp-hero-quote__metric-label">reply rate increase</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ REVIEWS ══════════════════════════════════ */}
      <section id="reviews" className="lp-reviews">
        <div className="lp-wrap">
          <h2 className="reveal lp-reviews__heading">Real teams. Real results.</h2>
          <div className="lp-reviews__grid">
            {testimonials.map((t, i) => (
              <div key={i} className="reveal lp-review-card">
                <div className="lp-review-card__metric">{t.metric}</div>
                <div className="lp-review-card__metric-label">{t.metricLabel}</div>
                <div className="lp-review-card__rule" />
                <p className="lp-review-card__quote">"{t.quote}"</p>
                <div className="lp-review-card__author">
                  <div className="lp-review-card__avatar">{t.initials}</div>
                  <div>
                    <div className="lp-review-card__name">{t.author}</div>
                    <div className="lp-review-card__role">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════ PRICING ══════════════════════════════════ */}
      <section id="pricing" className="lp-pricing">
        <div className="lp-wrap">
          <div className="reveal lp-pricing__header">
            <h2 className="lp-h2">One price.<br />Yours forever.</h2>
            <p className="lp-body lp-pricing__sub">
              No subscriptions. No per-seat fees. No annual renewals. Pay once and own it.
            </p>
          </div>

          <div className="lp-pricing__lifetime-wrap">
            <div className="reveal lp-lifetime">

              <div className="lp-lifetime__tag">
                <span className="lp-lifetime__tag-dot" />
                One-time payment · Lifetime access
              </div>

              <div className="lp-lifetime__price-row">
                <span className="lp-lifetime__currency">£</span>
                <span className="lp-lifetime__amount">299</span>
                <div className="lp-lifetime__after">
                  <span className="lp-lifetime__forever">forever</span>
                  <span className="lp-lifetime__note">one-time · no renewal</span>
                </div>
              </div>

              <p className="lp-lifetime__desc">
                Every feature SkySend offers, permanently unlocked. For your entire team. Today, tomorrow, always.
              </p>

              <Link to="/signup" className="lp-btn lp-btn--hero lp-lifetime__cta">
                Get lifetime access <ArrowRight size={16} />
              </Link>

              <div className="lp-lifetime__rule" />

              <div className="lp-lifetime__features">
                {lifetimeFeatures.map((f) => (
                  <div key={f} className="lp-lifetime__feature">
                    <div className="lp-lifetime__check">
                      <Check size={11} />
                    </div>
                    <span>{f}</span>
                  </div>
                ))}
              </div>

              <div className="lp-lifetime__trust">
                <div className="lp-lifetime__trust-item">
                  <Shield size={13} />
                  <span>30-day money-back guarantee</span>
                </div>
                <div className="lp-lifetime__trust-item">
                  <Zap size={13} />
                  <span>Instant access after payment</span>
                </div>
                <div className="lp-lifetime__trust-item">
                  <TrendingUp size={13} />
                  <span>All future updates included</span>
                </div>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ FINAL CTA ════════════════════════════════ */}
      <section className="lp-cta">
        <div className="lp-wrap">
          <div className="reveal lp-cta__inner">
            <div className="lp-cta__glow" />
            <p className="lp-overline lp-cta__eyebrow">Ready to grow?</p>
            <h2 className="lp-cta__headline">
              Start booking more<br />meetings today.
            </h2>
            <p className="lp-body lp-cta__sub">
              Join 500+ enterprise sales teams that use SkySend to
              hit their pipeline goals — consistently.
            </p>
            <Link to="/signup" className="lp-btn lp-btn--cta">
              Start your free trial <ArrowRight size={16} />
            </Link>
            <p className="lp-cta__trust">
              Free 14-day trial · No credit card · Cancel anytime
            </p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════ FOOTER ═══════════════════════════════════ */}
      <footer className="lp-footer">
        <div className="lp-wrap lp-footer__inner">
          <div className="lp-footer__brand">
            <SkySendLogo inverted />
            <p className="lp-footer__tagline">The AI-powered outreach platform for serious B2B sales teams.</p>
          </div>
          <div className="lp-footer__cols">
            {[
              { title: 'Product', links: ['Features', 'Pricing', 'Changelog', 'Roadmap'] },
              { title: 'Company', links: ['About', 'Blog', 'Careers', 'Contact'] },
              { title: 'Legal',   links: ['Privacy', 'Terms', 'Security'] },
            ].map((col) => (
              <div key={col.title} className="lp-footer__col">
                <p className="lp-footer__col-title">{col.title}</p>
                <ul className="lp-footer__links">
                  {col.links.map((l) => <li key={l}><a href="#" className="lp-footer__link">{l}</a></li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="lp-wrap lp-footer__bottom">
          <p className="lp-footer__copy">© 2024 SkySend. All rights reserved.</p>
          <p className="lp-footer__copy">Built for the world's best sales teams.</p>
        </div>
      </footer>

    </div>
  );
}

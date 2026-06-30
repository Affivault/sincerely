import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './landing.css';

/* Sincerely marketing site — light, modern, flat. Mirrors the app's refined
   aesthetic: near-monochrome, one indigo accent, hairline borders. */

type IP = React.SVGProps<SVGSVGElement>;
const I = {
  arrow: (p: IP) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14M12 5l7 7-7 7" /></svg>,
  check: (p: IP) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5" /></svg>,
  plus: (p: IP) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12h14M12 5v14" /></svg>,
  lock: (p: IP) => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>,
  shield: (p: IP) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>,
  branch: (p: IP) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="6" x2="6" y1="3" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>,
  spark: (p: IP) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9.94 14.06a1 1 0 0 1 .6-.61L13 12.5l-2.46-.95a1 1 0 0 1-.6-.61L9 8.5l-.94 2.44a1 1 0 0 1-.6.61L5 12.5l2.46.95a1 1 0 0 1 .6.61L9 16.5z" /><path d="M19 4v4M21 6h-4" /></svg>,
  chart: (p: IP) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 3v18h18" /><path d="M7 16v-5M12 16V8M17 16v-3" /></svg>,
  mega: (p: IP) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></svg>,
  inbox: (p: IP) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-6Z" /></svg>,
};

/* Brand-coloured integration glyphs (self-hosted, white-on-tile). */
const IntgGlyph: Record<string, React.ReactElement> = {
  salesforce: <svg viewBox="0 0 24 24" fill="none"><path d="M17.4 19a4.4 4.4 0 0 0 .7-8.74A5 5 0 0 0 8.8 8.2a3.6 3.6 0 0 0-5.3 3.2 3.7 3.7 0 0 0 3.7 3.7" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M7 19h10.4" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" /></svg>,
  hubspot: <svg viewBox="0 0 24 24" fill="none"><circle cx="8.5" cy="15" r="4" stroke="#fff" strokeWidth="2" /><circle cx="17" cy="6.5" r="2.6" fill="#fff" /><path d="M17 9.1v3.3M11.2 12.4 14.8 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></svg>,
  gmail: <svg viewBox="0 0 24 24" fill="none"><path d="M4 7.2A1.6 1.6 0 0 1 6.6 6L12 10l5.4-4A1.6 1.6 0 0 1 20 7.2V17a1 1 0 0 1-1 1h-2.2v-7.1L12 14.4 7.2 10.9V18H5a1 1 0 0 1-1-1V7.2z" fill="#fff" /></svg>,
  outlook: <svg viewBox="0 0 24 24" fill="none"><rect x="10" y="6" width="10" height="12" rx="1.4" stroke="#fff" strokeWidth="1.8" /><path d="M10 9.5 15 13l5-3.5" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" /><ellipse cx="6.5" cy="12" rx="4.5" ry="5" fill="#fff" /><ellipse cx="6.5" cy="12" rx="1.8" ry="2.4" fill="#0F6CBD" /></svg>,
  slack: <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round"><path d="M9.3 4 7.7 20M16.3 4l-1.6 16M4 9.3h16M3.7 14.7h16" /></svg>,
  zapier: <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5 4.2 16.5" /></svg>,
  calendly: <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5.5" width="16" height="14.5" rx="2.4" stroke="#fff" strokeWidth="1.9" /><path d="M4 9.5h16M8.5 3.5v4M15.5 3.5v4" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" /></svg>,
  segment: <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round"><path d="M20.2 9.4A8.2 8.2 0 0 0 5.6 6.3" /><path d="M3.8 14.6a8.2 8.2 0 0 0 14.6 3.1" /></svg>,
};

function Header() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on(); window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`lx-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="lx-wrap lx-header__inner">
        <a className="lx-header__logo" href="#top" aria-label="Sincerely"><img src="/logo.svg" alt="Sincerely" /></a>
        <nav className="lx-nav">
          <a className="lx-nav__link" href="#features">Features</a>
          <a className="lx-nav__link" href="#integrations">Integrations</a>
          <a className="lx-nav__link" href="#pricing">Pricing</a>
          <a className="lx-nav__link" href="#faq">FAQ</a>
        </nav>
        <div className="lx-header__actions">
          <Link className="lx-login" to="/login">Log in</Link>
          <Link className="lx-btn lx-btn--primary" to="/signup">Start free <I.arrow className="lx-btn__arr" /></Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const bars = [42, 58, 64, 51, 73, 66, 79, 92, 78, 95, 84, 100];
  return (
    <section className="lx-hero" id="top">
      <div className="lx-hero__bg" />
      <div className="lx-hero__grid" />
      <div className="lx-wrap lx-hero__inner">
        <a className="lx-pill" href="#features"><span className="lx-pill__tag">New</span> SARA — AI inbox assist is live <span className="lx-pill__arr">→</span></a>
        <h1 className="lx-hero__h1">Cold email that<br />books the <em>meeting</em>.</h1>
        <p className="lx-hero__sub">
          Sincerely ships your outbound at scale — deliverability, sequencing, and an AI
          co-pilot that turns every reply into a booked meeting.
        </p>
        <div className="lx-hero__ctas">
          <Link className="lx-btn lx-btn--primary lx-btn--lg" to="/signup">Start sending free <I.arrow className="lx-btn__arr" /></Link>
          <a className="lx-btn lx-btn--outline lx-btn--lg" href="#features">See how it works</a>
        </div>
        <p className="lx-hero__trust">
          <span><I.check /> No card to start</span>
          <span><I.check /> 100 emails free monthly</span>
          <span><I.check /> Cancel anytime</span>
        </p>

        <div className="lx-mock">
          <div className="lx-mock__bar">
            <span className="lx-mock__dot" /><span className="lx-mock__dot" /><span className="lx-mock__dot" />
            <div className="lx-mock__url"><I.lock /> app.usesincerely.com / campaigns</div>
            <span className="lx-mock__live">Live</span>
          </div>
          <div className="lx-mock__body">
            <div className="lx-mock__nav">
              <div className="lx-mock__navlabel">Outbound</div>
              <div className="lx-mock__navitem"><I.chart /> Dashboard</div>
              <div className="lx-mock__navitem is-active"><I.mega /> Campaigns <span className="lx-mock__badge">12</span></div>
              <div className="lx-mock__navitem"><I.branch /> Sequences</div>
              <div className="lx-mock__navlabel">Inbox</div>
              <div className="lx-mock__navitem"><I.inbox /> Unified <span className="lx-mock__badge">38</span></div>
              <div className="lx-mock__navitem"><I.spark /> SARA queue</div>
            </div>
            <div className="lx-mock__main">
              <div className="lx-mock__title">Q4 Outbound · Series A founders</div>
              <div className="lx-mock__kpis">
                {[['Sent', '5,276', '+12%'], ['Open rate', '72.4%', '+4.1%'], ['Click rate', '22.8%', '+1.6%'], ['Reply rate', '28.4%', '+8.2%']].map(([l, v, d]) => (
                  <div key={l} className="lx-mock__kpi"><div className="lx-mock__kpi-l">{l}</div><div className="lx-mock__kpi-v">{v}</div><div className="lx-mock__kpi-d">↑ {d}</div></div>
                ))}
              </div>
              <div className="lx-mock__chart">
                <div className="lx-mock__chart-h">Sending activity · Last 14 days</div>
                <div className="lx-mock__bars">{bars.map((h, i) => <div key={i} style={{ height: `${h}%` }} />)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Logos() {
  return (
    <section className="lx-wrap lx-logos">
      <p className="lx-logos__label">Trusted by 4,200+ outbound teams worldwide</p>
      <div className="lx-logos__row">
        {['NORTHSTAR', 'Brightline', 'NIMBUS', 'peachfin', 'THE LOOP', 'FLUXCAP', 'atlas.io'].map((n) => <span key={n}>{n}</span>)}
      </div>
    </section>
  );
}

function Features() {
  const items = [
    { n: 'Sequences', icon: <I.branch />, t: 'Flows that adapt to every reply', b: 'Branching outbound that reacts in real time — reply detected, pause; out-of-office, reschedule; interested, book the meeting.' },
    { n: 'SARA · AI inbox', icon: <I.spark />, t: 'A co-pilot for every reply', b: 'SARA reads every inbound, classifies intent in milliseconds, and drafts a response in your tone. You stay in control of every send.' },
    { n: 'Deliverability', icon: <I.shield />, t: 'Every email lands in the primary inbox', b: 'Auto-warmup across 50+ provider networks, live placement monitoring, and one-click SPF / DKIM / DMARC.' },
  ];
  return (
    <section className="lx-section" id="features">
      <div className="lx-wrap">
        <div className="lx-head">
          <span className="lx-eyebrow">Everything you need to send</span>
          <h2 className="lx-h2">From cold list to booked calendar.</h2>
          <p className="lx-lede">Three steps from a raw list of prospects to meetings on your calendar — most teams are live the same afternoon.</p>
        </div>
        <div className="lx-grid">
          {items.map((it) => (
            <div key={it.n} className="lx-feature">
              <div className="lx-feature__icon">{it.icon}</div>
              <div className="lx-feature__n">{it.n}</div>
              <h3 className="lx-feature__t">{it.t}</h3>
              <p className="lx-feature__b">{it.b}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Integrations() {
  const apps = [
    { name: 'Salesforce', cat: 'CRM', key: 'salesforce', color: '#00A1E0' },
    { name: 'HubSpot', cat: 'CRM', key: 'hubspot', color: '#FF7A59' },
    { name: 'Gmail', cat: 'Mailbox', key: 'gmail', color: '#EA4335' },
    { name: 'Outlook', cat: 'Mailbox', key: 'outlook', color: '#0F6CBD' },
    { name: 'Slack', cat: 'Notifications', key: 'slack', color: '#4A154B' },
    { name: 'Calendly', cat: 'Scheduling', key: 'calendly', color: '#006BFF' },
    { name: 'Zapier', cat: 'Automation', key: 'zapier', color: '#FF4F00' },
    { name: 'Segment', cat: 'Data', key: 'segment', color: '#52BD94' },
  ];
  return (
    <section className="lx-section lx-section--tight" id="integrations">
      <div className="lx-wrap">
        <div className="lx-head">
          <span className="lx-eyebrow">Integrations</span>
          <h2 className="lx-h2">Plugs into your whole stack.</h2>
          <p className="lx-lede">Two-way sync with your CRM, enrichment and scheduling tools — plus a full REST API and webhooks.</p>
        </div>
        <div className="lx-intg">
          {apps.map((a) => (
            <div key={a.key} className="lx-intg__card">
              <span className="lx-intg__logo" style={{ background: a.color }}>{IntgGlyph[a.key]}</span>
              <div><div className="lx-intg__name">{a.name}</div><div className="lx-intg__cat">{a.cat}</div></div>
              <span className="lx-intg__chk"><I.check /></span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats() {
  const stats = [['97%', 'Median inbox placement'], ['4.2×', 'More meetings booked'], ['12M+', 'Emails sent monthly'], ['< 30s', 'To launch a campaign']];
  return (
    <section className="lx-stats">
      <div className="lx-wrap lx-stats__grid">
        {stats.map(([v, l]) => <div key={l} className="lx-stat"><div className="lx-stat__v">{v}</div><div className="lx-stat__l">{l}</div></div>)}
      </div>
    </section>
  );
}

function Pricing() {
  const [annual, setAnnual] = useState(true);
  const tiers = [
    { name: 'Starter', pitch: 'For solo founders and small teams getting started.', m: 39, y: 348, cta: 'Start free trial', feats: ['Up to 3 sending inboxes', '1,500 emails / month', 'Sequence builder', 'Unified inbox', 'Auto-warmup included'] },
    { name: 'Growth', pitch: 'Scale outbound across your team with SARA.', m: 59, y: 499, feat: true, cta: 'Start free trial', feats: ['Up to 25 sending inboxes', '15,000 emails / month', 'SARA AI inbox assist', 'A/B testing', 'Priority support'] },
    { name: 'Scale', pitch: 'For agencies and revenue teams running outbound as a system.', m: null, y: null, cta: 'Talk to sales', feats: ['Unlimited inboxes', 'Unlimited volume', 'Multi-workspace & roles', 'SAML SSO + audit log', 'Dedicated CSM'] },
  ];
  return (
    <section className="lx-section" id="pricing">
      <div className="lx-wrap">
        <div className="lx-head">
          <span className="lx-eyebrow">Pricing</span>
          <h2 className="lx-h2">Pricing that scales with you.</h2>
          <p className="lx-lede">Start with a 10-day free trial on paid plans. Pay only for active inboxes — never for seats.</p>
          <div className="lx-toggle">
            <button className={!annual ? 'is-active' : ''} onClick={() => setAnnual(false)}>Monthly</button>
            <button className={annual ? 'is-active' : ''} onClick={() => setAnnual(true)}>Annual <span className="lx-toggle__save">· save 30%</span></button>
          </div>
        </div>
        <div className="lx-price">
          {tiers.map((t) => {
            const price = annual ? t.y : t.m;
            return (
              <div key={t.name} className={`lx-tier ${t.feat ? 'lx-tier--feat' : ''}`}>
                {t.feat && <span className="lx-tier__badge">Most popular</span>}
                <div className="lx-tier__name">{t.name}</div>
                <p className="lx-tier__pitch">{t.pitch}</p>
                <div className="lx-tier__price">
                  {price === null
                    ? <span className="lx-tier__price-num" style={{ fontSize: 34 }}>Custom</span>
                    : <><span className="lx-tier__price-cur">$</span><span className="lx-tier__price-num">{price}</span><span className="lx-tier__price-per">/ {annual ? 'yr' : 'mo'}</span></>}
                </div>
                <p className="lx-tier__note">{price === null ? 'Volume pricing · annual contract' : annual ? 'Billed annually · 10-day free trial' : '10-day free trial · cancel anytime'}</p>
                <Link to="/signup" className={`lx-btn ${t.feat ? 'lx-btn--primary' : 'lx-btn--outline'}`} style={{ width: '100%' }}>{t.cta}</Link>
                <ul className="lx-tier__feats">
                  {t.feats.map((f) => <li key={f}><I.check /> {f}</li>)}
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
    { body: 'We replaced three tools with Sincerely and our reply rate doubled in the first month. SARA alone saves us ~12 hours a week.', name: 'Maya Chen', role: 'Head of Growth, Brightline', initials: 'MC' },
    { body: 'Deliverability has been a non-issue since switching. We went from 60% inbox placement to a consistent 96+. That’s the whole game.', name: 'David Okafor', role: 'VP Sales, Nimbus', initials: 'DO' },
    { body: 'SARA drafts replies that sound more like me than my own follow-ups did. I was skeptical about AI in the inbox — it just works.', name: 'Priya Shah', role: 'Founder, Peachfin', initials: 'PS' },
  ];
  return (
    <section className="lx-section lx-section--tight">
      <div className="lx-wrap">
        <div className="lx-head">
          <span className="lx-eyebrow">Customers</span>
          <h2 className="lx-h2">Loved by teams that actually send.</h2>
        </div>
        <div className="lx-quotes">
          {quotes.map((q) => (
            <div key={q.name} className="lx-quote">
              <p className="lx-quote__body">“{q.body}”</p>
              <div className="lx-quote__by">
                <div className="lx-quote__av">{q.initials}</div>
                <div><div className="lx-quote__name">{q.name}</div><div className="lx-quote__role">{q.role}</div></div>
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
    { q: 'How fast can I start sending?', a: 'Most teams launch their first campaign the same afternoon. Connect an inbox, import a list, and Sincerely handles warmup and throttling automatically.' },
    { q: 'Do you provide domains and inboxes?', a: 'Yes. Bring your own, or spin up managed sending domains and mailboxes inside Sincerely — pre-configured with SPF, DKIM and DMARC and warmed for you.' },
    { q: 'Will SARA sound like a robot?', a: 'SARA trains on your top-performing replies and drafts in your tone. Every draft is yours to review, edit or send — you stay in control of every message.' },
    { q: 'Can I keep my existing CRM?', a: 'Two-way sync with Salesforce, HubSpot, Pipedrive and more keeps leads, activity and booked meetings flowing in both directions in real time.' },
    { q: 'What if a domain gets flagged?', a: 'Real-time blocklist and inbox-placement monitoring catches issues before Google or Outlook do, and automatically pauses affected inboxes while it remediates.' },
  ];
  return (
    <section className="lx-section" id="faq">
      <div className="lx-wrap lx-wrap--narrow">
        <div className="lx-head"><span className="lx-eyebrow">FAQ</span><h2 className="lx-h2">Questions, answered.</h2></div>
        <div className="lx-faq">
          {qs.map((item) => (
            <details key={item.q} className="lx-faq__item">
              <summary className="lx-faq__q">{item.q}<I.plus /></summary>
              <div className="lx-faq__a">{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="lx-cta">
      <div className="lx-wrap">
        <div className="lx-cta__box">
          <h2 className="lx-cta__h">Turn cold email into booked meetings.</h2>
          <p className="lx-cta__sub">Start free — no credit card. Paid plans include a 10-day trial. We'll have you sending by lunch.</p>
          <div className="lx-cta__ctas">
            <Link className="lx-btn lx-btn--primary lx-btn--lg" to="/signup">Start sending free <I.arrow className="lx-btn__arr" /></Link>
            <Link className="lx-btn lx-btn--outline lx-btn--lg" to="/login">Log in</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const cols = [
    { t: 'Product', links: ['Sequences', 'SARA · AI inbox', 'Deliverability', 'Analytics', 'Integrations'] },
    { t: 'Company', links: ['About', 'Customers', 'Careers', 'Blog', 'Contact'] },
    { t: 'Resources', links: ['Docs', 'API reference', 'Deliverability guide', 'Help center'] },
  ];
  return (
    <footer className="lx-footer">
      <div className="lx-wrap">
        <div className="lx-footer__top">
          <div className="lx-footer__brand">
            <img src="/logo.svg" alt="Sincerely" />
            <p className="lx-footer__tag">Cold email that books meetings. Built for outbound teams that care about both scale and signal.</p>
          </div>
          {cols.map((c) => (
            <div key={c.t}>
              <p className="lx-footer__ct">{c.t}</p>
              <ul className="lx-footer__links">{c.links.map((l) => <li key={l}><a href="#top">{l}</a></li>)}</ul>
            </div>
          ))}
        </div>
        <div className="lx-footer__bottom">
          <span className="lx-footer__copy">© 2026 Sincerely, Inc. · All rights reserved.</span>
          <span className="lx-footer__copy">Privacy · Terms · DPA</span>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="lx">
      <Header />
      <Hero />
      <Logos />
      <Features />
      <Integrations />
      <Stats />
      <Pricing />
      <Testimonials />
      <FAQ />
      <CTA />
      <Footer />
    </div>
  );
}

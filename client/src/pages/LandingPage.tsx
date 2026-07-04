import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Check, Inbox, Sparkles, Table2, FlaskConical,
  BarChart3, ShieldCheck, Flame, CalendarCheck2,
} from 'lucide-react';
import { PLANS, type PlanId } from '@lemlist/shared';
import './landing.css';

/* Sincerely marketing site — the landing page speaks the product's design
   language: warm paper, ink typography, hairline material, and REAL product
   screenshots (generated from the app itself) instead of illustrations. */

function LdHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`ld-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="ld-wrap ld-header__inner">
        <a className="ld-header__logo" href="#top" aria-label="Sincerely"><img src="/logo.svg" alt="Sincerely" /></a>
        <nav className="ld-nav">
          <a href="#features">Features</a>
          <a href="#leads">Leads</a>
          <a href="#sara">SARA</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="ld-header__actions">
          <Link className="ld-login" to="/login">Sign in</Link>
          <Link className="ld-btn ld-btn--primary" to="/signup">Start free <ArrowRight size={14} strokeWidth={2.2} /></Link>
        </div>
      </div>
    </header>
  );
}

function Frame({ src, alt, url }: { src: string; alt: string; url: string }) {
  return (
    <div className="ld-frame">
      <div className="ld-frame__bar">
        <span className="ld-frame__dot" /><span className="ld-frame__dot" /><span className="ld-frame__dot" />
        <span className="ld-frame__url">{url}</span>
      </div>
      <img src={src} alt={alt} loading="lazy" />
    </div>
  );
}

const FEATURES = [
  { icon: Inbox, tint: 'rgba(91,91,245,.10)', color: '#5B5BF5', title: 'One unibox for every inbox', desc: 'Every reply from every sending account lands in a single inbox, threaded and classified — nothing slips through.' },
  { icon: Sparkles, tint: 'rgba(139,92,246,.10)', color: '#7C4DDC', title: 'SARA, your reply agent', desc: 'Classifies every reply — interested, objection, meeting, unsubscribe — and drafts the response for your approval.' },
  { icon: Table2, tint: 'rgba(16,185,129,.10)', color: '#059669', title: 'Spreadsheet-grade lead lists', desc: 'A real data grid: typed columns, verification status, tags and lists — as fast to work in as a spreadsheet.' },
  { icon: ShieldCheck, tint: 'rgba(6,182,212,.10)', color: '#0891B2', title: 'Deliverability built in', desc: 'Warm-up throttling, health scores per inbox, bounce protection and a global suppression list, on by default.' },
  { icon: FlaskConical, tint: 'rgba(245,158,11,.12)', color: '#B45309', title: 'A/B everything', desc: 'Split-test subjects and bodies per step, with a deterministic 50/50 split and results you can act on.' },
  { icon: BarChart3, tint: 'rgba(244,63,94,.10)', color: '#E11D48', title: 'Analytics that answer', desc: 'A command-center dashboard: what needs you now, how sending is trending, and which campaigns convert.' },
];

const FAQS = [
  { q: 'Do I need my own email accounts?', a: 'Yes — Sincerely sends through inboxes you connect (Google Workspace, Outlook, or any SMTP provider). That keeps your sending reputation yours, and lets you scale by adding inboxes.' },
  { q: 'How does the free plan work?', a: 'The free plan includes 1 connected inbox and 100 emails a month, forever — no card required. Paid plans start a 10-day free trial when you subscribe.' },
  { q: 'What exactly does SARA do?', a: 'SARA reads incoming replies, classifies the intent (interested, objection, meeting request, out-of-office, unsubscribe, bounce) and drafts a contextual reply. You approve or edit before anything sends — high-confidence unsubscribes and bounces are handled automatically.' },
  { q: 'Will this hurt my domain reputation?', a: 'The opposite is the goal: per-inbox daily caps, warm-up mode for new accounts, live health scores, automatic bounce handling, and a suppression list all exist to protect deliverability.' },
  { q: 'Can I cancel anytime?', a: 'Yes. Manage or cancel from the billing page in two clicks — your plan stays active until the end of the period you paid for.' },
];

function PlanCard({ id, hot }: { id: PlanId; hot?: boolean }) {
  const p = PLANS[id];
  const custom = p.priceMonthly === null;
  return (
    <div className={`ld-plan ${hot ? 'ld-plan--hot' : ''}`}>
      {hot && <span className="ld-plan__flag">MOST POPULAR</span>}
      <h3>{p.name}</h3>
      <div className="ld-plan__price">
        {custom ? <b>Custom</b> : <><b>${p.priceMonthly}</b><span>/month</span></>}
      </div>
      <p className="ld-plan__note">
        {custom ? 'Tailored to your volume' : `or $${p.priceAnnual} billed yearly — 2 months free`}
      </p>
      <ul>
        <li><Check size={14} strokeWidth={2.4} /> {p.maxInboxes < 0 ? 'Unlimited' : p.maxInboxes} sending inbox{p.maxInboxes === 1 ? '' : 'es'}</li>
        <li><Check size={14} strokeWidth={2.4} /> {p.emailsPerMonth < 0 ? 'Unlimited' : p.emailsPerMonth.toLocaleString()} emails / month</li>
        <li className={p.features.sara ? '' : 'is-off'}><Check size={14} strokeWidth={2.4} /> SARA autonomous replies</li>
        <li className={p.features.abTesting ? '' : 'is-off'}><Check size={14} strokeWidth={2.4} /> A/B subject &amp; body testing</li>
        <li><Check size={14} strokeWidth={2.4} /> Unified inbox &amp; analytics</li>
      </ul>
      <Link className={`ld-btn ${hot ? 'ld-btn--accent' : 'ld-btn--ghost'}`} to="/signup" style={{ width: '100%' }}>
        {custom ? 'Contact sales' : 'Start 10-day trial'}
      </Link>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="ld" id="top">
      <LdHeader />

      {/* ── Hero ── */}
      <section className="ld-hero">
        <div className="ld-wrap">
          <a className="ld-eyebrow ld-rise" href="#sara"><b>NEW</b> SARA — the autonomous reply agent <ArrowRight size={12} /></a>
          <h1 className="ld-rise" style={{ animationDelay: '60ms' }}>
            Cold outreach that<br />books the <em>meeting</em>.
          </h1>
          <p className="ld-hero__sub ld-rise" style={{ animationDelay: '120ms' }}>
            Sincerely runs your outbound end to end — multi-inbox sending with
            built-in warm-up, spreadsheet-grade lead lists, and an AI agent that
            turns replies into booked meetings.
          </p>
          <div className="ld-hero__ctas ld-rise" style={{ animationDelay: '180ms' }}>
            <Link className="ld-btn ld-btn--primary ld-btn--lg" to="/signup">Start sending free <ArrowRight size={15} strokeWidth={2.2} /></Link>
            <a className="ld-btn ld-btn--ghost ld-btn--lg" href="#features">See the product</a>
          </div>
          <p className="ld-hero__trust ld-rise" style={{ animationDelay: '240ms' }}>
            <span><Check size={13} strokeWidth={2.6} /> Free plan, no card</span>
            <span><Check size={13} strokeWidth={2.6} /> 10-day trial on paid plans</span>
            <span><Check size={13} strokeWidth={2.6} /> Cancel anytime</span>
          </p>

          <div className="ld-shot ld-shot--fade ld-rise" style={{ animationDelay: '300ms' }}>
            <Frame src="/shots/dashboard.png" alt="The Sincerely dashboard — attention queue, performance trends and campaign leaderboard" url="app.usesincerely.com/dashboard" />
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="ld-section ld-center" id="features">
        <div className="ld-wrap">
          <div className="ld-kicker">The platform</div>
          <h2 className="ld-h2">Everything outbound needs.<br />Nothing it doesn't.</h2>
          <p className="ld-lede">Six tools that usually live in six tabs, built as one calm product.</p>
          <div className="ld-features">
            {FEATURES.map((f) => (
              <div key={f.title} className="ld-feature">
                <span className="ld-feature__icon" style={{ background: f.tint, color: f.color }}>
                  <f.icon size={17} strokeWidth={1.9} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Leads grid ── */}
      <section className="ld-section" id="leads">
        <div className="ld-wrap">
          <div className="ld-split ld-split--flip">
            <div>
              <Frame src="/shots/leads.png" alt="Sincerely lead lists — a spreadsheet-grade data grid with typed columns and verification status" url="app.usesincerely.com/contacts" />
            </div>
            <div className="ld-split__copy">
              <div className="ld-kicker">Lead lists</div>
              <h3>Your leads, in a grid that works like a spreadsheet.</h3>
              <p>
                Typed columns, verification status on every address, tags, lists and
                bulk actions — the speed of a sheet with the structure of a CRM.
              </p>
              <ul className="ld-checks">
                <li><Check size={14} strokeWidth={2.4} /> Import any CSV and map fields in seconds</li>
                <li><Check size={14} strokeWidth={2.4} /> Built-in email verification before you send</li>
                <li><Check size={14} strokeWidth={2.4} /> Segments, tags and suppression that sync with campaigns</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── SARA ── */}
      <section className="ld-section" id="sara">
        <div className="ld-wrap">
          <div className="ld-split">
            <div className="ld-split__copy">
              <div className="ld-kicker">SARA — Sincerely Autonomous Reply Agent</div>
              <h3>Replies handled while you sleep.</h3>
              <p>
                Every reply is read, classified and triaged. Interested? A draft is
                waiting for your approval. Unsubscribe or bounce? Handled and
                suppressed automatically. Your job shrinks to one click: send.
              </p>
              <ul className="ld-checks">
                <li><Check size={14} strokeWidth={2.4} /> Intent detection: interested, objection, meeting, OOO, unsubscribe</li>
                <li><Check size={14} strokeWidth={2.4} /> Context-aware reply drafts, ready for one-click approval</li>
                <li><Check size={14} strokeWidth={2.4} /> Auto-stops sequences when someone replies or bounces</li>
              </ul>
            </div>
            <div className="ld-sara">
              <div className="ld-sara__msg">
                <div className="ld-sara__meta">
                  <span className="ld-sara__who">Sarah Chen</span> · VP Marketing, Northbeam
                  <span className="ld-sara__intent" style={{ background: 'rgba(16,185,129,.12)', color: '#059669' }}><Flame size={10} style={{ marginRight: 3 }} /> INTERESTED</span>
                </div>
                <p>"This actually looks relevant to what we're rebuilding this quarter. How does pricing work for a team of five?"</p>
              </div>
              <div className="ld-sara__msg ld-sara__draft">
                <div className="ld-sara__meta">
                  <span className="ld-sara__who" style={{ color: '#5B5BF5' }}>SARA · draft ready</span>
                  <span className="ld-sara__intent" style={{ background: 'rgba(91,91,245,.10)', color: '#5B5BF5' }}>AWAITING APPROVAL</span>
                </div>
                <p>"Great to hear, Sarah! For a team of five you'd be on Growth. Happy to walk you through it — would a quick call Thursday work?"</p>
              </div>
              <div className="ld-sara__msg">
                <div className="ld-sara__meta">
                  <span className="ld-sara__who">Marcus Webb</span> · Founder, Flowlane
                  <span className="ld-sara__intent" style={{ background: 'rgba(59,130,246,.12)', color: '#2563EB' }}><CalendarCheck2 size={10} style={{ marginRight: 3 }} /> MEETING</span>
                </div>
                <p>"Sounds good — send me your calendar link and let's find a slot next week."</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="ld-section ld-center" id="pricing">
        <div className="ld-wrap">
          <div className="ld-kicker">Pricing</div>
          <h2 className="ld-h2">Simple, honest pricing.</h2>
          <p className="ld-lede">Start free. Paid plans include a 10-day trial — cancel anytime from the billing page.</p>
          <div className="ld-plans">
            <PlanCard id="starter" />
            <PlanCard id="growth" hot />
            <PlanCard id="scale" />
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="ld-section ld-center" id="faq">
        <div className="ld-wrap">
          <div className="ld-kicker">FAQ</div>
          <h2 className="ld-h2">Fair questions.</h2>
          <div className="ld-faq">
            {FAQS.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="ld-cta">
        <div className="ld-wrap">
          <h2>Ready to fill your calendar?</h2>
          <p>Connect an inbox, import your list, and send your first campaign this afternoon.</p>
          <div className="ld-cta__row">
            <Link className="ld-btn ld-btn--ghost ld-btn--lg" to="/signup">Get started free</Link>
            <Link className="ld-btn ld-btn--accent ld-btn--lg" to="/login">Sign in <ArrowRight size={15} strokeWidth={2.2} /></Link>
          </div>
          <p className="ld-cta__fine">Free plan to start · 10-day trial on paid plans · Cancel anytime</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="ld-footer">
        <div className="ld-wrap ld-footer__inner">
          <img className="ld-footer__logo" src="/logo.svg" alt="Sincerely" />
          <span>© {new Date().getFullYear()} Sincerely · All rights reserved.</span>
          <div className="ld-footer__links">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/status">Status</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

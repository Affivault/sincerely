import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/* ─────────────── CSS ─────────────────────────────────────────────────────── */
const CSS = `
  *, *::before, *::after { box-sizing: border-box; }

  .r  { opacity:0; transform:translateY(26px); transition:opacity .62s cubic-bezier(.16,1,.3,1),transform .62s cubic-bezier(.16,1,.3,1); }
  .r.on { opacity:1; transform:none; }
  .r.d1{transition-delay:.07s} .r.d2{transition-delay:.14s} .r.d3{transition-delay:.21s}
  .r.d4{transition-delay:.28s} .r.d5{transition-delay:.35s} .r.d6{transition-delay:.42s}

  @keyframes fl  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-13px)} }
  @keyframes f2  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
  @keyframes f3  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
  @keyframes lgs { from{transform:translateX(0)} to{transform:translateX(-50%)} }
  @keyframes inA { from{opacity:0;transform:translateY(22px)} to{opacity:1;transform:none} }
  @keyframes pg  { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(2.5);opacity:0} }
  @keyframes cnt { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }

  .bp {
    display:inline-flex;align-items:center;gap:8px;text-decoration:none;
    background:linear-gradient(135deg,#6D28D9 0%,#7C3AED 45%,#0EA5E9 100%);
    color:#fff;border:none;padding:13px 26px;border-radius:11px;
    font-size:15px;font-weight:600;cursor:pointer;letter-spacing:-.025em;
    box-shadow:0 4px 18px rgba(109,40,217,.28),inset 0 1px 0 rgba(255,255,255,.15);
    transition:all .2s cubic-bezier(.16,1,.3,1);
  }
  .bp:hover { transform:translateY(-2px); box-shadow:0 10px 34px rgba(109,40,217,.42),inset 0 1px 0 rgba(255,255,255,.15); }

  .bg {
    display:inline-flex;align-items:center;gap:8px;text-decoration:none;
    background:transparent;color:#4B5563;
    border:1.5px solid #D4D9E3;padding:12px 22px;
    border-radius:11px;font-size:15px;font-weight:500;cursor:pointer;transition:all .18s;
  }
  .bg:hover { border-color:#A78BFA;color:#6D28D9;background:rgba(109,40,217,.04); }

  .bw {
    display:inline-flex;align-items:center;gap:8px;text-decoration:none;
    background:white;color:#0F172A;border:none;padding:13px 26px;
    border-radius:11px;font-size:15px;font-weight:600;cursor:pointer;
    box-shadow:0 2px 8px rgba(0,0,0,.12);transition:all .18s;
  }
  .bw:hover { transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,.16); }

  .na { color:#4B5563;font-size:13.5px;font-weight:500;text-decoration:none;
    letter-spacing:-.02em;transition:color .15s; }
  .na:hover { color:#0F172A; }

  .fc {
    background:#fff;border:1px solid #E8ECF0;border-radius:14px;padding:26px;
    box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);transition:all .22s;
  }
  .fc:hover { border-color:#C4B5FD;box-shadow:0 6px 28px rgba(109,40,217,.1);transform:translateY(-3px); }

  .tc {
    background:#fff;border:1px solid #E8ECF0;border-radius:16px;padding:30px;
    box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.03);transition:all .22s;
  }
  .tc:hover { border-color:#C4B5FD;box-shadow:0 6px 26px rgba(109,40,217,.1); }

  .fa { font-size:13.5px;color:#94A3B8;text-decoration:none;letter-spacing:-.01em;transition:color .15s; }
  .fa:hover { color:#F1F5F9; }

  @media(max-width:960px){
    .hg{grid-template-columns:1fr!important} .mw{display:none!important}
    .h1{font-size:46px!important} .fg{grid-template-columns:1fr 1fr!important}
    .sg{grid-template-columns:1fr 1fr!important} .tg{grid-template-columns:1fr!important}
    .ftg{grid-template-columns:1fr 1fr!important} .hwg{grid-template-columns:1fr!important}
  }
  @media(max-width:620px){
    .h1{font-size:34px!important} .fg{grid-template-columns:1fr!important}
    .ftg{grid-template-columns:1fr!important} .nnl{display:none!important}
    .sg{grid-template-columns:1fr 1fr!important}
  }
`;

/* ─────────────── LOGO ────────────────────────────────────────────────────── */
/*
 * NEW brand mark: a geometric paper plane, gradient #6D28D9→#8B5CF6→#0EA5E9
 * Standalone icon (no background box) — clean, scalable, distinctive.
 * Wordmark: "Sky" dark + "Send" gradient.
 */
function Logo({ s = 1, dark = false }: { s?: number; dark?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 * s, userSelect: 'none' }}>
      <svg width={30 * s} height={27 * s} viewBox="0 0 30 27" fill="none">
        <defs>
          <linearGradient id="la" x1="0" y1="27" x2="30" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#6D28D9" />
            <stop offset="48%"  stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#0EA5E9" />
          </linearGradient>
          <linearGradient id="lb" x1="0" y1="27" x2="30" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#5B21B6" stopOpacity=".75" />
            <stop offset="100%" stopColor="#0369A1" stopOpacity=".75" />
          </linearGradient>
        </defs>
        {/* Main plane body */}
        <path d="M2 24L28 13.5L2 3L6.5 13.5L2 24Z" fill="url(#la)" />
        {/* Underside fold — gives depth */}
        <path d="M6.5 13.5L9 19.5L2 24" fill="url(#lb)" />
        {/* Crease highlight */}
        <line x1="6.5" y1="13.5" x2="28" y2="13.5" stroke="white" strokeWidth=".75" strokeOpacity=".28" />
      </svg>

      <span style={{ fontSize: 18 * s, fontWeight: 700, letterSpacing: '-.04em', fontFamily: 'inherit' }}>
        <span style={{ color: dark ? '#fff' : '#0F172A' }}>Sky</span>
        <span style={{
          background: dark
            ? 'linear-gradient(90deg,rgba(255,255,255,.88),rgba(255,255,255,.62))'
            : 'linear-gradient(135deg,#7C3AED,#0EA5E9)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>Send</span>
      </span>
    </div>
  );
}

/* ─────────────── HERO MOCKUP (light theme) ───────────────────────────────── */
function HeroMockup() {
  const rows = [
    { name: 'Q4 Enterprise Outbound',  live: true,  rate: .47, col: '#7C3AED' },
    { name: 'SaaS Cold Sequence v3',   live: true,  rate: .81, col: '#059669' },
    { name: 'Re-engagement Oct',       live: false, rate: .31, col: '#D97706' },
  ];
  return (
    <div style={{
      background: '#fff', border: '1px solid #E2E8F0', borderRadius: 18, padding: 22, width: 400,
      boxShadow: '0 8px 28px rgba(0,0,0,.08),0 28px 60px rgba(0,0,0,.06)',
    }}>
      {/* Titlebar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) => (
            <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
          ))}
        </div>
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.08em', color: '#94A3B8' }}>SINCERELY</span>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1.5 4.5H7.5M4.5 1.5L7.5 4.5L4.5 7.5" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Campaign rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{
            background: '#F8FAFC', border: '1px solid #E8ECF0', borderRadius: 10,
            padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: r.live ? r.col : '#CBD5E1',
              boxShadow: r.live ? `0 0 6px ${r.col}55` : undefined,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <div style={{ flex: 1, height: 2.5, borderRadius: 2, background: '#E2E8F0', overflow: 'hidden' }}>
                  <div style={{ width: `${r.rate * 100}%`, height: '100%', background: r.col, borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 10, color: '#94A3B8', flexShrink: 0 }}>{Math.round(r.rate * 100)}% open</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Sparkline */}
      <div style={{ marginTop: 14, padding: '11px 12px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #E8ECF0' }}>
        <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 8 }}>ACTIVITY · LAST 7 DAYS</div>
        <svg width="100%" height="36" viewBox="0 0 360 36" preserveAspectRatio="none">
          <defs>
            <linearGradient id="mcg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#7C3AED" stopOpacity=".18" />
              <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0,34 C30,30 55,26 90,20 C120,14 140,23 170,16 C200,9 220,7 255,5 C280,4 315,4 360,2 L360,36 L0,36 Z" fill="url(#mcg)" />
          <path d="M0,34 C30,30 55,26 90,20 C120,14 140,23 170,16 C200,9 220,7 255,5 C280,4 315,4 360,2" fill="none" stroke="#7C3AED" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}

/* ─────────────── PAGE ────────────────────────────────────────────────────── */
export function LandingPageV2() {
  const [sent, setSent] = useState(1_849_321);

  useEffect(() => {
    const t = setInterval(() => setSent(n => n + Math.floor(Math.random() * 3 + 1)), 2100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const els = document.querySelectorAll('.r');
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) (e.target as HTMLElement).classList.add('on'); }),
      { threshold: 0.1 },
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const features = [
    { icon: '⟳', title: 'Smart Sequences',      desc: 'Multi-touch campaigns that adapt in real time based on how each lead engages. Stop sending into the void.', col: '#7C3AED' },
    { icon: '◎', title: 'Inbox-First Delivery', desc: '98.7% inbox placement. Warm-up automation, domain health, and bounce protection — all built in.',            col: '#059669' },
    { icon: '✦', title: 'AI Personalization',   desc: 'Generate opening lines, icebreakers, and entire sequences tailored to every prospect in seconds.',           col: '#D97706' },
    { icon: '↗', title: 'Real-Time Analytics',  desc: 'See opens, clicks, and replies as they happen. Know what\'s working and double down with precision.',        col: '#DC2626' },
    { icon: '⊞', title: 'Team Collaboration',   desc: 'Shared inboxes, campaign templates, and reply ownership. No lead ever slips through the cracks.',            col: '#0EA5E9' },
    { icon: '⚡', title: 'CRM Sync',             desc: 'Bi-directional sync with HubSpot, Salesforce, and Pipedrive. Your pipeline, always current.',               col: '#7C3AED' },
  ];

  const stats = [
    { val: '10M+',    lbl: 'Emails sent monthly' },
    { val: '98.7%',   lbl: 'Inbox delivery rate' },
    { val: '3.2×',    lbl: 'Higher reply rates' },
    { val: '< 2 min', lbl: 'Time to first send' },
  ];

  const testimonials = [
    { q: '"We went from 2% to 14% reply rate in six weeks. Nothing else even comes close."',                        name: 'Sarah Chen',  role: 'Head of Sales · Acme Corp',   av: '#7C3AED', m: '+600%', ml: 'reply rate lift' },
    { q: '"The deliverability alone justifies the cost. Our entire outbound pipeline now runs through Sincerely."',  name: 'Marcus Reid', role: 'Founder · TechFlow',           av: '#059669', m: '98.7%', ml: 'inbox rate' },
    { q: '"Finally an outreach tool our reps actually want to use. The UI is miles ahead of everything else."',    name: 'Priya Nair',  role: 'VP Sales · Growthly',          av: '#DC2626', m: '3×',    ml: 'pipeline growth' },
  ];

  const logos = ['Salesforce', 'HubSpot', 'Pipedrive', 'Notion', 'Stripe', 'Intercom', 'Zendesk', 'Linear', 'Loom', 'Figma'];
  const avC   = ['#7C3AED', '#059669', '#D97706', '#DC2626', '#0EA5E9'];
  const avL   = ['S', 'M', 'J', 'A', 'R'];

  return (
    <div style={{ background: '#fff', color: '#0F172A', minHeight: '100vh', overflowX: 'hidden', fontFamily: `-apple-system,'Inter','SF Pro Display','Segoe UI',sans-serif` }}>
      <style>{CSS}</style>

      {/* ── NAV ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        background: 'rgba(255,255,255,.88)', backdropFilter: 'blur(18px) saturate(180%)',
        borderBottom: '1px solid rgba(0,0,0,.07)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <Logo s={1} />
          <div className="nnl" style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            {['Features', 'Pricing', 'Customers', 'Docs'].map(item => (
              <a key={item} href="#" className="na">{item}</a>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link to="/login"  className="bg" style={{ padding: '7px 18px', fontSize: 13.5 }}>Sign in</Link>
            <Link to="/signup" className="bp" style={{ padding: '8px 20px', fontSize: 13.5 }}>Get started →</Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <section style={{
        paddingTop: 144, paddingBottom: 100, position: 'relative', overflow: 'hidden',
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        background: 'linear-gradient(180deg,#FAFBFF 0%,#fff 60%)',
      }}>
        {/* Subtle gradient glow — top-center */}
        <div style={{
          position: 'absolute', top: -120, left: '50%', transform: 'translateX(-50%)',
          width: 900, height: 600, pointerEvents: 'none',
          background: 'radial-gradient(ellipse,rgba(109,40,217,.07) 0%,rgba(14,165,233,.04) 50%,transparent 70%)',
        }} />
        {/* Dot grid texture */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(rgba(109,40,217,.055) 1px,transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%,black 40%,transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 0%,black 40%,transparent 100%)',
        }} />

        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', width: '100%' }}>
          <div className="hg" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>

            {/* Left */}
            <div style={{ animation: 'inA .85s cubic-bezier(.16,1,.3,1) both' }}>
              {/* Pill */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  background: 'rgba(5,150,105,.08)', border: '1px solid rgba(5,150,105,.22)',
                  borderRadius: 100, padding: '5px 13px 5px 8px',
                }}>
                  <div style={{ position: 'relative', display: 'flex', width: 8, height: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#059669' }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#059669', animation: 'pg 2.6s cubic-bezier(0,0,.2,1) infinite' }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#059669', letterSpacing: '.01em' }}>10,000+ teams sending smarter</span>
                </div>
              </div>

              {/* H1 */}
              <h1 className="h1" style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.01, letterSpacing: '-.04em', marginBottom: 22, color: '#0F172A' }}>
                Cold outreach<br />
                <span style={{
                  background: 'linear-gradient(135deg,#6D28D9 0%,#7C3AED 40%,#0EA5E9 100%)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                }}>that actually closes.</span>
              </h1>

              <p style={{ fontSize: 18.5, lineHeight: 1.68, color: '#64748B', maxWidth: 440, marginBottom: 36, letterSpacing: '-.01em' }}>
                Automate multi-touch sequences, land in every inbox, and turn cold contacts into warm conversations — at scale.
              </p>

              {/* CTAs */}
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 44, flexWrap: 'wrap' }}>
                <Link to="/signup" className="bp">Start free — no card required</Link>
                <a href="#demo" className="bg">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M6.5 5.5l4 2.5-4 2.5V5.5z" fill="currentColor" />
                  </svg>
                  See it in action
                </a>
              </div>

              {/* Social proof */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ display: 'flex' }}>
                  {avC.map((c, i) => (
                    <div key={i} style={{
                      width: 32, height: 32, borderRadius: '50%', background: `linear-gradient(145deg,${c},${c}99)`,
                      border: '2px solid #fff', marginLeft: i > 0 ? -10 : 0, zIndex: 5 - i,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700, color: '#fff',
                    }}>{avL[i]}</div>
                  ))}
                </div>
                <div style={{ fontSize: 13.5, color: '#64748B', letterSpacing: '-.02em' }}>
                  <strong style={{ color: '#0F172A' }}>★ 4.9</strong>{' '}from 2,400+ reviews
                </div>
              </div>
            </div>

            {/* Right: floating mockup */}
            <div className="mw" style={{ position: 'relative', display: 'flex', justifyContent: 'center', animation: 'fl 7s ease-in-out infinite' }}>
              <div style={{ transform: 'perspective(1100px) rotateX(3deg) rotateY(-6deg)' }}>
                <HeroMockup />
              </div>

              {/* Float: reply */}
              <div style={{
                position: 'absolute', top: -28, right: -20,
                background: '#fff', border: '1px solid #E2E8F0',
                borderRadius: 13, padding: '11px 15px',
                boxShadow: '0 8px 28px rgba(0,0,0,.1)',
                animation: 'f2 5.5s ease-in-out infinite 1s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#059669', boxShadow: '0 0 8px rgba(5,150,105,.5)' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>Reply from Alex Chen</span>
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>"We'd love to hop on a call..."</div>
              </div>

              {/* Float: deliverability */}
              <div style={{
                position: 'absolute', bottom: 6, left: -38,
                background: 'linear-gradient(135deg,#6D28D9,#0EA5E9)',
                borderRadius: 13, padding: '13px 18px',
                boxShadow: '0 8px 28px rgba(109,40,217,.3)',
                animation: 'fl 8s ease-in-out infinite 2s',
              }}>
                <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.05em', color: '#fff', lineHeight: 1 }}>98.7%</div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.72)', marginTop: 3, letterSpacing: '.06em' }}>INBOX DELIVERY</div>
              </div>

              {/* Float: sent counter */}
              <div style={{
                position: 'absolute', top: '42%', right: -52,
                background: '#fff', border: '1px solid #E2E8F0',
                borderRadius: 11, padding: '9px 13px',
                boxShadow: '0 4px 16px rgba(0,0,0,.08)',
                animation: 'f3 6s ease-in-out infinite 3s',
              }}>
                <div style={{ fontSize: 10, color: '#94A3B8', letterSpacing: '.06em', marginBottom: 2 }}>EMAILS SENT TODAY</div>
                <div key={sent} style={{ fontSize: 16, fontWeight: 700, color: '#7C3AED', letterSpacing: '-.03em', animation: 'cnt .3s ease both' }}>
                  {sent.toLocaleString()}
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── LOGO STRIP ──────────────────────────────────────────────────────── */}
      <section style={{ borderTop: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9', padding: '18px 0', overflow: 'hidden', position: 'relative', background: '#FAFBFF' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 100, zIndex: 1, background: 'linear-gradient(to right,#FAFBFF,transparent)' }} />
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 100, zIndex: 1, background: 'linear-gradient(to left,#FAFBFF,transparent)' }} />
        <div style={{ display: 'flex', animation: 'lgs 28s linear infinite', width: 'max-content' }}>
          {[...logos, ...logos].map((name, i) => (
            <div key={i} style={{ padding: '0 36px', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 600, letterSpacing: '-.03em', color: '#CBD5E1', whiteSpace: 'nowrap' }}>{name}</div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────────────────────────── */}
      <section style={{ padding: '110px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="r" style={{ textAlign: 'center', marginBottom: 68 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 18, background: 'rgba(109,40,217,.07)', border: '1px solid rgba(109,40,217,.18)', borderRadius: 100, padding: '4px 14px' }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#7C3AED', letterSpacing: '.04em' }}>HOW IT WORKS</span>
          </div>
          <h2 style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-.035em', color: '#0F172A', lineHeight: 1.1, marginBottom: 14 }}>
            From zero to pipeline<br />
            <span style={{ background: 'linear-gradient(135deg,#6D28D9,#0EA5E9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>in three steps.</span>
          </h2>
        </div>

        <div className="hwg" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2, position: 'relative' }}>
          <div style={{ position: 'absolute', top: 38, left: '16%', right: '16%', height: 1, background: 'linear-gradient(90deg,rgba(109,40,217,.2),rgba(14,165,233,.2))', zIndex: 0 }} />
          {[
            { n: '01', t: 'Import your contacts',  d: 'Upload a CSV or sync from your CRM. Sincerely cleanses, deduplicates, and scores every contact automatically.' },
            { n: '02', t: 'Build your sequence',   d: 'Drag-and-drop builder or let AI draft your entire campaign — subject lines, body copy, and follow-ups in seconds.' },
            { n: '03', t: 'Watch replies come in', d: 'Campaigns run on autopilot. Your unified inbox surfaces hot leads so you focus on conversations, not clicking send.' },
          ].map((step, i) => (
            <div key={i} className={`r d${i + 1}`} style={{ textAlign: 'center', padding: '0 28px', position: 'relative', zIndex: 1 }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%', margin: '0 auto 24px',
                background: i === 1 ? 'linear-gradient(135deg,#7C3AED,#0EA5E9)' : '#fff',
                border: i === 1 ? 'none' : '1.5px solid #E2E8F0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: i === 1 ? '0 8px 28px rgba(109,40,217,.35)' : '0 2px 8px rgba(0,0,0,.05)',
              }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: i === 1 ? '#fff' : '#94A3B8', letterSpacing: '-.02em' }}>{step.n}</span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', letterSpacing: '-.03em', marginBottom: 10 }}>{step.t}</div>
              <div style={{ fontSize: 14, color: '#64748B', lineHeight: 1.68, letterSpacing: '-.01em' }}>{step.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────────────────── */}
      <section style={{ padding: '0 24px 110px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="r" style={{ textAlign: 'center', marginBottom: 56 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 18, background: 'rgba(109,40,217,.07)', border: '1px solid rgba(109,40,217,.18)', borderRadius: 100, padding: '4px 14px' }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#7C3AED', letterSpacing: '.04em' }}>FEATURES</span>
          </div>
          <h2 style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-.035em', color: '#0F172A', lineHeight: 1.1, marginBottom: 14 }}>
            Everything you need.<br />
            <span style={{ background: 'linear-gradient(135deg,#7C3AED,#0EA5E9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Nothing you don't.</span>
          </h2>
          <p style={{ fontSize: 17, color: '#64748B', maxWidth: 460, margin: '0 auto', lineHeight: 1.65, letterSpacing: '-.01em' }}>
            Every feature is built with one goal: getting your emails read, replied to, and closed.
          </p>
        </div>

        <div className="fg" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
          {features.map((f, i) => (
            <div key={i} className={`r fc d${(i % 5) + 1}`}>
              <div style={{
                width: 42, height: 42, borderRadius: 12, marginBottom: 18,
                background: `${f.col}12`, border: `1px solid ${f.col}25`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, color: f.col,
              }}>{f.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', letterSpacing: '-.03em', marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 14, color: '#64748B', lineHeight: 1.65, letterSpacing: '-.01em' }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── STATS — gradient pop ─────────────────────────────────────────────── */}
      <section style={{ padding: '80px 24px', background: 'linear-gradient(135deg,#6D28D9 0%,#7C3AED 45%,#0EA5E9 100%)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px)', backgroundSize: '26px 26px' }} />
        <div style={{ maxWidth: 1200, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <div className="sg" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 40 }}>
            {stats.map((s, i) => (
              <div key={i} className={`r d${i + 1}`} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-.04em', color: '#fff', lineHeight: 1.1 }}>{s.val}</div>
                <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.68)', marginTop: 8, letterSpacing: '-.01em' }}>{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── QUOTE ───────────────────────────────────────────────────────────── */}
      <section style={{ padding: '100px 24px', maxWidth: 880, margin: '0 auto', textAlign: 'center' }}>
        <div className="r">
          <div style={{ width: 3, height: 48, background: 'linear-gradient(to bottom,#7C3AED,#0EA5E9)', borderRadius: 4, margin: '0 auto 30px' }} />
          <blockquote style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.5, letterSpacing: '-.025em', color: '#1E293B', marginBottom: 28, fontStyle: 'italic' }}>
            "Sincerely is the first tool that treats deliverability and personalisation as a single problem. It's in a completely different league."
          </blockquote>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'linear-gradient(145deg,#7C3AED,#0EA5E9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#fff' }}>D</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', letterSpacing: '-.02em' }}>Daniel Torres</div>
              <div style={{ fontSize: 12.5, color: '#94A3B8' }}>CRO · Momentum Labs</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ────────────────────────────────────────────────────── */}
      <section style={{ padding: '0 24px 110px', background: '#FAFBFF', borderTop: '1px solid #F1F5F9', paddingTop: 80 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div className="r" style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2 style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-.035em', color: '#0F172A', lineHeight: 1.12, marginBottom: 12 }}>
              Loved by sales teams<br />
              <span style={{ background: 'linear-gradient(135deg,#7C3AED,#0EA5E9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>around the world.</span>
            </h2>
            <p style={{ fontSize: 16, color: '#64748B', letterSpacing: '-.01em' }}>Real teams. Real numbers. No cherry-picked demos.</p>
          </div>

          <div className="tg" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 20 }}>
            {testimonials.map((t, i) => (
              <div key={i} className={`r tc d${i + 1}`}>
                <div style={{
                  display: 'inline-flex', flexDirection: 'column', marginBottom: 22,
                  padding: '11px 15px', borderRadius: 12,
                  background: 'rgba(109,40,217,.06)', border: '1px solid rgba(109,40,217,.14)',
                }}>
                  <span style={{
                    fontSize: 28, fontWeight: 800, letterSpacing: '-.04em', lineHeight: 1,
                    background: 'linear-gradient(135deg,#7C3AED,#0EA5E9)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                  }}>{t.m}</span>
                  <span style={{ fontSize: 10.5, color: '#94A3B8', letterSpacing: '.04em', marginTop: 4 }}>{t.ml.toUpperCase()}</span>
                </div>
                <p style={{ fontSize: 15, lineHeight: 1.65, color: '#334155', marginBottom: 24, letterSpacing: '-.01em' }}>{t.q}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(145deg,${t.av},${t.av}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff' }}>{t.name[0]}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', letterSpacing: '-.02em' }}>{t.name}</div>
                    <div style={{ fontSize: 12.5, color: '#94A3B8', letterSpacing: '-.01em' }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: '90px 24px 110px' }}>
        <div style={{ maxWidth: 540, margin: '0 auto' }}>
          <div className="r" style={{ textAlign: 'center', marginBottom: 44 }}>
            <h2 style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-.035em', color: '#0F172A', lineHeight: 1.12 }}>Simple, transparent pricing.</h2>
            <p style={{ fontSize: 16, color: '#64748B', marginTop: 12, letterSpacing: '-.01em' }}>No per-seat shock. Start free, upgrade when you're ready.</p>
          </div>

          <div className="r d1" style={{
            background: '#fff', border: '1px solid #E2E8F0', borderRadius: 22, padding: 40,
            position: 'relative', overflow: 'hidden',
            boxShadow: '0 4px 16px rgba(0,0,0,.06),0 24px 60px rgba(109,40,217,.08)',
          }}>
            {/* Top gradient bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg,#6D28D9,#7C3AED,#0EA5E9)' }} />

            <div style={{ paddingTop: 8 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 22, background: 'rgba(5,150,105,.08)', border: '1px solid rgba(5,150,105,.25)', borderRadius: 100, padding: '4px 12px' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669' }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#059669', letterSpacing: '.04em' }}>MOST POPULAR</span>
              </div>

              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 58, fontWeight: 800, letterSpacing: '-.04em', color: '#0F172A', lineHeight: 1 }}>$59</span>
                <span style={{ fontSize: 16, color: '#94A3B8', letterSpacing: '-.02em' }}>/month</span>
              </div>
              <div style={{ fontSize: 13.5, color: '#94A3B8', marginBottom: 30, letterSpacing: '-.01em' }}>Growth plan · Starter from $39/mo · two months free on annual billing.</div>

              {[
                'Unlimited campaigns & sequences',
                'Up to 25 sending inboxes + automated warm-up',
                '15,000 emails per month',
                'SARA autonomous reply agent',
                'A/B subject & body testing',
                'Unified inbox & analytics',
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, background: 'rgba(109,40,217,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5.5L4 7.5L8 3" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <span style={{ fontSize: 14, color: '#334155', letterSpacing: '-.01em' }}>{item}</span>
                </div>
              ))}

              <Link to="/signup" className="bp" style={{ width: '100%', justifyContent: 'center', marginTop: 26, padding: '14px 28px', fontSize: 15.5 }}>
                Start free 10-day trial →
              </Link>
              <div style={{ textAlign: 'center', marginTop: 13, fontSize: 12.5, color: '#94A3B8', letterSpacing: '-.01em' }}>
                Free plan available · Cancel anytime
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section style={{ padding: '100px 24px', background: 'linear-gradient(135deg,#4C1D95 0%,#6D28D9 40%,#0C4A6E 100%)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,.05) 1px,transparent 1px)', backgroundSize: '28px 28px' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 700, height: 400, borderRadius: '50%', pointerEvents: 'none', background: 'radial-gradient(ellipse,rgba(255,255,255,.08) 0%,transparent 65%)' }} />
        <div className="r" style={{ maxWidth: 620, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <h2 style={{ fontSize: 54, fontWeight: 800, letterSpacing: '-.04em', color: '#fff', lineHeight: 1.07, marginBottom: 18 }}>
            Ready to fill your pipeline?
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,.68)', marginBottom: 36, lineHeight: 1.65, letterSpacing: '-.01em' }}>
            Join 10,000+ sales teams already using Sincerely to scale their outreach without scaling their headcount.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/signup" className="bw" style={{ padding: '14px 32px', fontSize: 16 }}>Get started free</Link>
            <Link to="/login" style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none',
              color: 'rgba(255,255,255,.75)', fontSize: 16, fontWeight: 500, padding: '14px 24px',
              border: '1.5px solid rgba(255,255,255,.2)', borderRadius: 11, transition: 'all .18s',
            }}>Sign in →</Link>
          </div>
          <div style={{ marginTop: 20, fontSize: 13, color: 'rgba(255,255,255,.42)', letterSpacing: '-.01em' }}>
            Free plan to start · 10-day trial on paid plans · Cancel anytime
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer style={{ background: '#0F172A', padding: '52px 24px', color: '#64748B' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div className="ftg" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 40, marginBottom: 44 }}>
            <div>
              <div style={{ marginBottom: 14 }}><Logo s={.95} dark /></div>
              <p style={{ fontSize: 13.5, lineHeight: 1.65, maxWidth: 230, letterSpacing: '-.01em', color: '#475569' }}>
                The modern cold outreach platform built for sales teams who care about results.
              </p>
            </div>
            {[
              { title: 'Product',   links: ['Features', 'Pricing', 'Changelog', 'Roadmap'] },
              { title: 'Resources', links: ['Docs', 'Blog', 'Templates', 'Guides'] },
              { title: 'Company',   links: ['About', 'Customers', 'Privacy', 'Terms'] },
            ].map((col, i) => (
              <div key={i}>
                <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '.06em', color: '#475569', marginBottom: 16 }}>{col.title.toUpperCase()}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {col.links.map(link => <a key={link} href="#" className="fa">{link}</a>)}
                </div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid #1E293B', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <span style={{ fontSize: 13, letterSpacing: '-.01em', color: '#475569' }}>© 2025 Sincerely. All rights reserved.</span>
            <div style={{ display: 'flex', gap: 20 }}>
              {[{ label: 'Privacy Policy', to: '/privacy' }, { label: 'Terms of Service', to: '/terms' }].map(item => (
                <Link key={item.label} to={item.to} style={{ fontSize: 12.5, color: '#334155', textDecoration: 'none', letterSpacing: '-.01em' }}>{item.label}</Link>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Check, Zap, Sparkles, Shield, BarChart3, Mail, Users,
  TrendingUp, MessageSquare, Star, ChevronRight, Play,
} from 'lucide-react';
import { SkySendLogo } from '../components/SkySendLogo';

/* ─── Keyframe styles (injected once) ─────────────────────────────── */
const ANIM_CSS = `
  @keyframes lp2-float    { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-10px)} }
  @keyframes lp2-float2   { 0%,100%{transform:translateY(0)}  50%{transform:translateY(-7px)}  }
  @keyframes lp2-glow     { 0%,100%{box-shadow:0 0 24px rgba(99,102,241,.3)} 50%{box-shadow:0 0 48px rgba(99,102,241,.6)} }
  @keyframes lp2-logos    { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
  @keyframes lp2-toast    { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }
  @keyframes lp2-ping     { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.5);opacity:.6} }
  @keyframes lp2-bar      { from{height:0} to{height:var(--h)} }
  .lp2-rev { opacity:0; transform:translateY(24px); transition:opacity .65s ease,transform .65s ease; }
  .lp2-rev.on { opacity:1; transform:translateY(0); }
  .lp2-cta-btn:hover { opacity:.9; transform:translateY(-1px); }
  .lp2-ghost-btn:hover { background:rgba(255,255,255,.07)!important; }
  .lp2-nav-link:hover { color:white!important; }
  .lp2-footer-link:hover { color:white!important; }
`;

/* ─── Static data ──────────────────────────────────────────────────── */
const LOGOS = ['Stripe','Vercel','Linear','Figma','Notion','Loom','Raycast','Arc',
               'Stripe','Vercel','Linear','Figma','Notion','Loom','Raycast','Arc'];

const STATS = [
  { val: '10M+',  label: 'Emails sent',     sub: 'every month' },
  { val: '98.7%', label: 'Deliverability',  sub: 'inbox placement' },
  { val: '3.2×',  label: 'Reply lift',      sub: 'vs cold tools avg' },
  { val: '500+',  label: 'Teams',           sub: 'enterprise scale' },
];

const BENTO = [
  { tag:'Sequences',    color:'#818CF8', bg:'rgba(99,102,241,.12)',  border:'rgba(99,102,241,.25)', icon:Mail,
    title:'Campaigns that adapt, automatically.',
    body:'Multi-step sequences with AI-optimised send windows, conditional branching based on what prospects do, and unlimited steps. Set it once, let it run.',
    tags:['AI send windows','Conditional branching','Unlimited steps','A/B testing'], wide:true },
  { tag:'Deliverability', color:'#10B981', bg:'rgba(16,185,129,.1)', border:'rgba(16,185,129,.2)', icon:Shield,
    title:'98.7% inbox placement',
    body:'Built-in warmup, domain health scoring, and real-time spam monitoring keep you out of junk.' },
  { tag:'AI Assist',    color:'#A78BFA', bg:'rgba(139,92,246,.1)',   border:'rgba(139,92,246,.2)', icon:Sparkles,
    title:'Draft replies in seconds',
    body:'Automatic intent detection, AI-crafted responses, one click to send. Triage 3× faster.' },
  { tag:'Analytics',   color:'#22D3EE', bg:'rgba(6,182,212,.1)',    border:'rgba(6,182,212,.2)',  icon:BarChart3,
    title:'Full-funnel visibility',
    body:'Track every open, click, reply, and bounce across all campaigns. Export to CSV.' },
  { tag:'Team + A/B',  color:'#FBB849', bg:'rgba(245,158,11,.1)',   border:'rgba(245,158,11,.2)', icon:Users,
    title:'Built for teams, wired to test',
    body:'Multi-user workspaces with roles, shared templates, and simultaneous A/B split tests on subjects and body copy.' },
];

const REVIEWS = [
  { metric:'$40K', mLabel:'saved / year',   stars:5, initials:'DK', author:'David Kim',      role:'CRO, Meridian',
    quote:'We replaced three tools with SkySend. Saved $40K annually while improving every metric across the board.' },
  { metric:'12×',  mLabel:'faster triage',  stars:5, initials:'EP', author:'Emily Park',     role:'Director of Marketing, ScaleUp',
    quote:'AI Assist handles reply triage. What took 3 hours a day now takes 15 minutes — with better accuracy.' },
  { metric:'98.7%',mLabel:'delivered',      stars:5, initials:'MJ', author:'Marcus Johnson', role:'VP Sales, GrowthLabs',
    quote:'Deliverability went from 89% to 98.7% in two weeks. Our meeting rate followed immediately.' },
];

const LIFETIME_FEATURES = [
  'Unlimited email campaigns & sequences','AI send-time optimisation',
  'AI Assist (inbox reply assistant)','Deliverability engine & warmup',
  'Real-time analytics dashboard','A/B testing — subjects & body',
  'Custom domain setup','Team collaboration & roles',
  'All future updates included','Priority support',
];

const BAR_HEIGHTS = [38,52,47,68,61,79,72,88,83,94,89,97,91,98];

/* ─── Scroll-reveal hook ────────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('on'); }),
      { threshold: 0.06, rootMargin: '0px 0px -40px 0px' }
    );
    ref.current?.querySelectorAll('.lp2-rev').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

/* ─── Shared style helpers ──────────────────────────────────────────── */
const S = {
  wrap: { maxWidth: 1200, margin: '0 auto', padding: '0 24px' } as React.CSSProperties,
  gradText: {
    background: 'linear-gradient(135deg,#818CF8 0%,#6366F1 45%,#06B6D4 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
  } as React.CSSProperties,
  pill: (color: string, bg: string, border: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    background: bg, border: `1px solid ${border}`,
    borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700, color,
  } as React.CSSProperties),
  card: {
    background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)',
    borderRadius: 20,
  } as React.CSSProperties,
};

/* ═══════════════════════════════════════════════════════════════════ */
export function LandingPageV2() {
  const page = useReveal();
  const [sentCount, setSentCount] = useState(5276);

  useEffect(() => {
    const t = setInterval(() => setSentCount((p) => p + Math.floor(Math.random() * 3) + 1), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      ref={page}
      style={{ background: '#07070F', color: '#fff', fontFamily: 'Inter,system-ui,-apple-system,sans-serif', overflowX: 'hidden' }}
    >
      <style>{ANIM_CSS}</style>

      {/* ══════════════════ NAV ════════════════════════════════════ */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, height: 64,
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        backdropFilter: 'blur(20px)', background: 'rgba(7,7,15,.85)',
      }}>
        <div style={{ ...S.wrap, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/lp2"><SkySendLogo inverted /></Link>

          <nav style={{ display: 'flex', gap: 32 }}>
            {['Features','Pricing','Reviews'].map((item) => (
              <a key={item} href={`#lp2-${item.toLowerCase()}`}
                className="lp2-nav-link"
                style={{ color: 'rgba(255,255,255,.55)', fontSize: 14, fontWeight: 500, textDecoration: 'none', transition: 'color .2s' }}
              >{item}</a>
            ))}
          </nav>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Link to="/login" style={{ color: 'rgba(255,255,255,.65)', fontSize: 14, fontWeight: 500, textDecoration: 'none' }}>Log in</Link>
            <Link to="/signup" className="lp2-cta-btn" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'linear-gradient(135deg,#6366F1,#06B6D4)',
              color: '#fff', fontSize: 14, fontWeight: 700,
              padding: '9px 20px', borderRadius: 10, textDecoration: 'none',
              boxShadow: '0 0 22px rgba(99,102,241,.3)', transition: 'opacity .2s,transform .2s',
            }}>Get started <ArrowRight size={14} /></Link>
          </div>
        </div>
      </header>

      {/* ══════════════════ HERO ═══════════════════════════════════ */}
      <section style={{ paddingTop: 148, paddingBottom: 80, position: 'relative', overflow: 'hidden' }}>
        {/* Background radial glows */}
        <div style={{ position:'absolute', top:-200, left:'50%', transform:'translateX(-50%)', width:900, height:900, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(99,102,241,.11) 0%,transparent 65%)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:80, right:'8%', width:460, height:460, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(6,182,212,.07) 0%,transparent 70%)', pointerEvents:'none' }} />
        {/* Grid pattern */}
        <div style={{ position:'absolute', inset:0, backgroundImage:'linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px)', backgroundSize:'60px 60px', mask:'radial-gradient(ellipse 80% 55% at 50% 0%,black 0%,transparent 100%)', WebkitMask:'radial-gradient(ellipse 80% 55% at 50% 0%,black 0%,transparent 100%)', pointerEvents:'none' }} />

        <div style={S.wrap}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center' }}>

            {/* ── Left text ── */}
            <div>
              {/* Pill */}
              <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.28)', borderRadius:100, padding:'6px 14px', marginBottom:28 }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:'#6366F1', animation:'lp2-ping 2s ease infinite' }} />
                <span style={{ fontSize:12, fontWeight:700, color:'#818CF8' }}>New</span>
                <span style={{ width:1, height:12, background:'rgba(99,102,241,.4)' }} />
                <span style={{ fontSize:12, color:'rgba(255,255,255,.55)' }}>AI Assist now powered by GPT-4o</span>
                <ChevronRight size={12} style={{ color:'#818CF8' }} />
              </div>

              {/* Headline */}
              <h1 style={{ fontSize:'clamp(42px,5vw,70px)', fontWeight:800, lineHeight:1.04, letterSpacing:'-0.03em', marginBottom:24 }}>
                Cold outreach<br />
                <span style={S.gradText}>engineered</span>{' '}to<br />
                convert.
              </h1>

              <p style={{ fontSize:18, lineHeight:1.72, color:'rgba(255,255,255,.52)', marginBottom:36, maxWidth:470 }}>
                The AI-powered outreach platform that lands every email in the primary inbox and turns cold prospects into booked meetings — at scale.
              </p>

              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:22 }}>
                <Link to="/signup" className="lp2-cta-btn" style={{
                  display:'inline-flex', alignItems:'center', gap:10,
                  background:'linear-gradient(135deg,#6366F1,#06B6D4)',
                  color:'#fff', fontWeight:700, fontSize:16,
                  padding:'14px 28px', borderRadius:12, textDecoration:'none',
                  boxShadow:'0 0 32px rgba(99,102,241,.38),0 4px 20px rgba(0,0,0,.4)',
                  transition:'opacity .2s,transform .2s',
                }}>Start for free <ArrowRight size={17} /></Link>

                <Link to="/login" className="lp2-ghost-btn" style={{
                  display:'inline-flex', alignItems:'center', gap:8,
                  color:'rgba(255,255,255,.65)', fontWeight:600, fontSize:15,
                  padding:'14px 22px', borderRadius:12, textDecoration:'none',
                  border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.03)',
                  transition:'background .2s',
                }}><Play size={14} fill="currentColor" />View demo</Link>
              </div>

              <p style={{ fontSize:13, color:'rgba(255,255,255,.3)' }}>Free 14-day trial · No credit card required · Cancel anytime</p>

              {/* Stars */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:18 }}>
                <div style={{ display:'flex', gap:2 }}>
                  {[...Array(5)].map((_,i) => <Star key={i} size={13} fill="#F59E0B" stroke="none" />)}
                </div>
                <span style={{ fontSize:13, color:'rgba(255,255,255,.45)' }}>
                  <strong style={{ color:'#fff' }}>4.9 / 5</strong> from 500+ reviews
                </span>
              </div>
            </div>

            {/* ── Right mockup ── */}
            <div style={{ position:'relative' }}>
              {/* Toast — reply */}
              <div style={{
                position:'absolute', top:-18, right:-14, zIndex:10, backdropFilter:'blur(14px)',
                background:'rgba(16,185,129,.13)', border:'1px solid rgba(16,185,129,.28)',
                borderRadius:12, padding:'10px 16px', display:'flex', alignItems:'center', gap:10,
                animation:'lp2-float 4.2s ease-in-out infinite, lp2-toast .5s ease .4s both',
              }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background:'#10B981', animation:'lp2-ping 1.6s ease infinite' }} />
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:'#10B981' }}>Reply received</div>
                  <div style={{ fontSize:10, color:'rgba(255,255,255,.45)' }}>Enterprise Demos — James D.</div>
                </div>
              </div>

              {/* Counter toast */}
              <div style={{
                position:'absolute', bottom:-8, left:-24, zIndex:10, backdropFilter:'blur(14px)',
                background:'rgba(99,102,241,.14)', border:'1px solid rgba(99,102,241,.3)',
                borderRadius:12, padding:'12px 18px',
                animation:'lp2-float2 5s ease-in-out infinite, lp2-toast .5s ease .9s both',
              }}>
                <div style={{ fontSize:24, fontWeight:900, color:'#818CF8', lineHeight:1 }}>{sentCount.toLocaleString()}</div>
                <div style={{ fontSize:11, color:'rgba(255,255,255,.45)', marginTop:2 }}>emails sent today</div>
              </div>

              {/* Main card */}
              <div style={{
                borderRadius:20, overflow:'hidden',
                border:'1px solid rgba(255,255,255,.09)',
                boxShadow:'0 40px 80px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.04) inset',
                animation:'lp2-glow 4s ease-in-out infinite',
              }}>
                {/* Chrome */}
                <div style={{ padding:'12px 16px', background:'rgba(255,255,255,.04)', borderBottom:'1px solid rgba(255,255,255,.06)', display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ display:'flex', gap:6 }}>
                    {['#FF5F57','#FEBC2E','#28C840'].map((c,i) => <div key={i} style={{ width:10, height:10, borderRadius:'50%', background:c }} />)}
                  </div>
                  <div style={{ flex:1, margin:'0 12px', padding:'4px 12px', borderRadius:6, background:'rgba(255,255,255,.06)', fontSize:11, color:'rgba(255,255,255,.35)', textAlign:'center' }}>
                    app.skysend.io/campaigns
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, fontWeight:700, color:'#10B981', background:'rgba(16,185,129,.1)', padding:'3px 8px', borderRadius:4 }}>
                    <div style={{ width:5, height:5, borderRadius:'50%', background:'#10B981' }} />Live
                  </div>
                </div>

                {/* KPI row */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:1, background:'rgba(255,255,255,.04)' }}>
                  {[
                    { l:'Sent',      v:'5,276', d:'+12%' },
                    { l:'Open rate', v:'72.4%', d:'+8%'  },
                    { l:'Replies',   v:'28.4%', d:'+19%' },
                    { l:'Booked',    v:'143',   d:'+31%' },
                  ].map((k,i) => (
                    <div key={i} style={{ padding:'14px 16px', background:'#0D0D1A' }}>
                      <div style={{ fontSize:10, color:'rgba(255,255,255,.35)', marginBottom:4 }}>{k.l}</div>
                      <div style={{ fontSize:18, fontWeight:800, lineHeight:1 }}>{k.v}</div>
                      <div style={{ fontSize:10, color:'#10B981', marginTop:3, fontWeight:700 }}>{k.d}</div>
                    </div>
                  ))}
                </div>

                {/* Bar chart */}
                <div style={{ padding:'16px', background:'#0D0D1A' }}>
                  <div style={{ fontSize:10, color:'rgba(255,255,255,.35)', fontWeight:700, letterSpacing:'0.08em', marginBottom:12 }}>REPLY RATE — LAST 14 DAYS</div>
                  <div style={{ display:'flex', alignItems:'flex-end', gap:3, height:56 }}>
                    {BAR_HEIGHTS.map((h,i) => (
                      <div key={i} style={{
                        flex:1, borderRadius:'3px 3px 0 0',
                        background: i >= 10 ? 'linear-gradient(180deg,#6366F1,#818CF8)' : 'rgba(99,102,241,.22)',
                        height:`${h}%`,
                      }} />
                    ))}
                  </div>
                </div>

                {/* Campaign rows */}
                <div style={{ padding:'0 16px 16px', background:'#0D0D1A' }}>
                  {[
                    { name:'Q4 Outreach — Series A', open:'67.2%', reply:'18.4%', hi:false },
                    { name:'Enterprise Demos',        open:'81.4%', reply:'31.8%', hi:true  },
                    { name:'Partnership Discovery',   open:'72.8%', reply:'22.1%', hi:false },
                  ].map((row,i) => (
                    <div key={i} style={{
                      display:'flex', alignItems:'center', gap:10, padding:'7px 10px', borderRadius:7, marginBottom:3,
                      background: row.hi ? 'rgba(99,102,241,.1)' : 'transparent',
                      border: row.hi ? '1px solid rgba(99,102,241,.18)' : '1px solid transparent',
                    }}>
                      <div style={{ width:6, height:6, borderRadius:'50%', background:'#10B981', flexShrink:0, animation:'lp2-ping 2.2s ease infinite' }} />
                      <span style={{ fontSize:11, color:'rgba(255,255,255,.65)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.name}</span>
                      <span style={{ fontSize:11, color:'rgba(255,255,255,.35)', width:38, textAlign:'right', flexShrink:0 }}>{row.open}</span>
                      <span style={{ fontSize:11, color:'#10B981', fontWeight:700, width:38, textAlign:'right', flexShrink:0 }}>{row.reply}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════ LOGO STRIP ═════════════════════════════ */}
      <div style={{ padding:'20px 0', borderTop:'1px solid rgba(255,255,255,.05)', borderBottom:'1px solid rgba(255,255,255,.05)', overflow:'hidden', position:'relative' }}>
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:120, zIndex:2, background:'linear-gradient(90deg,#07070F,transparent)' }} />
        <div style={{ position:'absolute', right:0, top:0, bottom:0, width:120, zIndex:2, background:'linear-gradient(270deg,#07070F,transparent)' }} />
        <p style={{ textAlign:'center', fontSize:11, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'rgba(255,255,255,.25)', marginBottom:14 }}>Trusted by teams at</p>
        <div style={{ display:'flex', gap:56, animation:'lp2-logos 22s linear infinite', width:'max-content' }}>
          {LOGOS.map((n,i) => (
            <span key={i} style={{ fontSize:15, fontWeight:700, color:'rgba(255,255,255,.18)', whiteSpace:'nowrap', letterSpacing:'-0.01em' }}>{n}</span>
          ))}
        </div>
      </div>

      {/* ══════════════════ STATS ══════════════════════════════════ */}
      <section style={{ padding:'80px 24px' }}>
        <div style={{ ...S.wrap, display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:20 }}>
          {STATS.map((s,i) => (
            <div key={i} className="lp2-rev" style={{ ...S.card, padding:'32px', textAlign:'center', transitionDelay:`${i*.08}s` }}>
              <div style={{ fontSize:48, fontWeight:900, letterSpacing:'-0.03em', lineHeight:1.1, marginBottom:8, background:'linear-gradient(135deg,#fff 0%,rgba(255,255,255,.55) 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>{s.val}</div>
              <div style={{ fontSize:14, fontWeight:600, color:'rgba(255,255,255,.8)', marginBottom:4 }}>{s.label}</div>
              <div style={{ fontSize:12, color:'rgba(255,255,255,.32)' }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ══════════════════ BENTO FEATURES ═════════════════════════ */}
      <section id="lp2-features" style={{ padding:'0 24px 80px' }}>
        <div style={S.wrap}>
          {/* Header */}
          <div className="lp2-rev" style={{ textAlign:'center', marginBottom:56 }}>
            <p style={{ fontSize:12, fontWeight:700, color:'#818CF8', letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:14 }}>Platform Features</p>
            <h2 style={{ fontSize:'clamp(30px,4vw,50px)', fontWeight:800, letterSpacing:'-0.025em', lineHeight:1.1, marginBottom:14 }}>
              Everything serious<br />
              <span style={S.gradText}>sales teams need.</span>
            </h2>
            <p style={{ fontSize:17, color:'rgba(255,255,255,.48)', maxWidth:480, margin:'0 auto' }}>
              From the first send to the signed contract — one platform, zero compromises.
            </p>
          </div>

          {/* Grid */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>

            {/* Wide card */}
            <div className="lp2-rev" style={{
              gridColumn:'span 2', padding:'32px', borderRadius:20,
              background:`linear-gradient(135deg,rgba(99,102,241,.11) 0%,rgba(6,182,212,.05) 100%)`,
              border:'1px solid rgba(99,102,241,.22)', position:'relative', overflow:'hidden',
            }}>
              <div style={{ position:'absolute', top:-60, right:-60, width:220, height:220, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(99,102,241,.14) 0%,transparent 70%)' }} />
              <div style={S.pill('#818CF8','rgba(99,102,241,.15)','rgba(99,102,241,.3)')}>
                <Mail size={11} /> Sequences
              </div>
              <h3 style={{ fontSize:24, fontWeight:700, letterSpacing:'-0.02em', margin:'14px 0 10px' }}>Campaigns that adapt, automatically.</h3>
              <p style={{ fontSize:14, color:'rgba(255,255,255,.52)', lineHeight:1.72, maxWidth:430 }}>
                Multi-step sequences with AI-optimised send windows, conditional branching based on what prospects do, and unlimited steps. Set it once, let it run.
              </p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:20 }}>
                {['AI send windows','Conditional branching','Unlimited steps','A/B testing'].map((tag) => (
                  <span key={tag} style={{ fontSize:11, fontWeight:600, color:'rgba(255,255,255,.55)', background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.08)', borderRadius:6, padding:'4px 10px' }}>{tag}</span>
                ))}
              </div>
            </div>

            {/* Deliverability */}
            <div className="lp2-rev" style={{ ...S.card, padding:'28px', transitionDelay:'.08s' }}>
              <div style={{ ...S.pill('#10B981','rgba(16,185,129,.1)','rgba(16,185,129,.22)'), marginBottom:14 }}><Shield size={11} /> Deliverability</div>
              <h3 style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', marginBottom:10 }}>98.7% inbox placement</h3>
              <p style={{ fontSize:13, color:'rgba(255,255,255,.48)', lineHeight:1.65, marginBottom:18 }}>Built-in warmup, domain health scoring, and real-time spam monitoring keep you out of junk.</p>
              <div style={{ padding:'12px', borderRadius:10, background:'rgba(16,185,129,.07)', border:'1px solid rgba(16,185,129,.15)', display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ fontSize:30, fontWeight:900, color:'#10B981', lineHeight:1 }}>98.7%</div>
                <div style={{ fontSize:11, color:'rgba(255,255,255,.38)' }}>avg inbox placement across all accounts</div>
              </div>
            </div>

            {/* AI Assist */}
            <div className="lp2-rev" style={{ ...S.card, padding:'28px', transitionDelay:'.14s' }}>
              <div style={{ ...S.pill('#A78BFA','rgba(139,92,246,.1)','rgba(139,92,246,.22)'), marginBottom:14 }}><Sparkles size={11} /> AI Assist</div>
              <h3 style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', marginBottom:10 }}>Draft replies in seconds</h3>
              <p style={{ fontSize:13, color:'rgba(255,255,255,.48)', lineHeight:1.65 }}>Automatic intent detection, AI-crafted responses, one click to send. Triage 3× faster than manual.</p>
            </div>

            {/* Analytics */}
            <div className="lp2-rev" style={{ ...S.card, padding:'28px', transitionDelay:'.2s' }}>
              <div style={{ ...S.pill('#22D3EE','rgba(6,182,212,.1)','rgba(6,182,212,.22)'), marginBottom:14 }}><BarChart3 size={11} /> Analytics</div>
              <h3 style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', marginBottom:10 }}>Full-funnel visibility</h3>
              <p style={{ fontSize:13, color:'rgba(255,255,255,.48)', lineHeight:1.65 }}>Track every open, click, reply, and bounce across all campaigns. Export to CSV in one click.</p>
            </div>

            {/* Team + A/B */}
            <div className="lp2-rev" style={{ ...S.card, padding:'28px', transitionDelay:'.26s' }}>
              <div style={{ display:'flex', gap:8, marginBottom:14 }}>
                <div style={S.pill('#FBB849','rgba(245,158,11,.1)','rgba(245,158,11,.22)')}><Users size={11} /> Team</div>
                <div style={S.pill('#F87171','rgba(239,68,68,.1)','rgba(239,68,68,.22)')}><Zap size={11} /> A/B Tests</div>
              </div>
              <h3 style={{ fontSize:20, fontWeight:700, letterSpacing:'-0.02em', marginBottom:10 }}>Built for teams, wired to test</h3>
              <p style={{ fontSize:13, color:'rgba(255,255,255,.48)', lineHeight:1.65 }}>Multi-user workspaces with roles, shared templates, and simultaneous A/B split tests on subjects and body copy.</p>
            </div>

          </div>
        </div>
      </section>

      {/* ══════════════════ BIG QUOTE ══════════════════════════════ */}
      <section style={{ padding:'80px 24px', background:'linear-gradient(135deg,rgba(99,102,241,.06) 0%,rgba(6,182,212,.03) 100%)', borderTop:'1px solid rgba(255,255,255,.05)', borderBottom:'1px solid rgba(255,255,255,.05)' }}>
        <div className="lp2-rev" style={{ maxWidth:820, margin:'0 auto', textAlign:'center' }}>
          <div style={{ fontSize:88, lineHeight:.4, color:'#6366F1', opacity:.45, fontFamily:'Georgia,serif', marginBottom:28 }}>"</div>
          <blockquote style={{ fontSize:'clamp(18px,2.5vw,26px)', fontWeight:600, lineHeight:1.55, color:'rgba(255,255,255,.82)', marginBottom:32, letterSpacing:'-0.01em' }}>
            We went from 2% to 12% reply rates in three weeks. The AI-driven send optimisation alone was worth the switch.
          </blockquote>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:16 }}>
            <div style={{ width:48, height:48, borderRadius:'50%', background:'linear-gradient(135deg,#6366F1,#06B6D4)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:700 }}>SC</div>
            <div style={{ textAlign:'left' }}>
              <div style={{ fontSize:14, fontWeight:700 }}>Sarah Chen</div>
              <div style={{ fontSize:13, color:'rgba(255,255,255,.4)' }}>Head of Sales, TechCorp</div>
            </div>
            <div style={{ marginLeft:20, padding:'8px 16px', borderRadius:10, background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.2)' }}>
              <div style={{ fontSize:22, fontWeight:900, color:'#818CF8', lineHeight:1 }}>6×</div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,.38)' }}>reply rate increase</div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════ REVIEWS ════════════════════════════════ */}
      <section id="lp2-reviews" style={{ padding:'80px 24px' }}>
        <div style={S.wrap}>
          <h2 className="lp2-rev" style={{ fontSize:'clamp(26px,3vw,40px)', fontWeight:800, letterSpacing:'-0.025em', textAlign:'center', marginBottom:48 }}>Real teams. Real results.</h2>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:18 }}>
            {REVIEWS.map((t,i) => (
              <div key={i} className="lp2-rev" style={{ ...S.card, padding:'28px', transitionDelay:`${i*.09}s` }}>
                <div style={{ display:'flex', gap:2, marginBottom:16 }}>
                  {[...Array(5)].map((_,j) => <Star key={j} size={13} fill="#F59E0B" stroke="none" />)}
                </div>
                <div style={{ fontSize:38, fontWeight:900, letterSpacing:'-0.02em', lineHeight:1, marginBottom:4, background:'linear-gradient(135deg,#fff 0%,rgba(255,255,255,.5) 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>{t.metric}</div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,.38)', marginBottom:16, fontWeight:500 }}>{t.mLabel}</div>
                <div style={{ width:40, height:1, background:'rgba(255,255,255,.1)', marginBottom:16 }} />
                <p style={{ fontSize:14, color:'rgba(255,255,255,.62)', lineHeight:1.7, marginBottom:20 }}>"{t.quote}"</p>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background:'linear-gradient(135deg,#6366F1,#06B6D4)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, flexShrink:0 }}>{t.initials}</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:700 }}>{t.author}</div>
                    <div style={{ fontSize:11, color:'rgba(255,255,255,.38)' }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════ PRICING ════════════════════════════════ */}
      <section id="lp2-pricing" style={{ padding:'0 24px 80px' }}>
        <div style={{ maxWidth:660, margin:'0 auto' }}>
          <div className="lp2-rev" style={{ textAlign:'center', marginBottom:44 }}>
            <h2 style={{ fontSize:'clamp(30px,4vw,48px)', fontWeight:800, letterSpacing:'-0.025em', marginBottom:14 }}>
              One price.{' '}<span style={S.gradText}>Yours forever.</span>
            </h2>
            <p style={{ fontSize:17, color:'rgba(255,255,255,.48)' }}>No subscriptions. No per-seat fees. Pay once, own it forever.</p>
          </div>

          <div className="lp2-rev" style={{
            padding:'40px', borderRadius:24,
            background:'linear-gradient(135deg,rgba(99,102,241,.1) 0%,rgba(6,182,212,.05) 100%)',
            border:'1px solid rgba(99,102,241,.24)',
            boxShadow:'0 0 60px rgba(99,102,241,.1)',
            position:'relative', overflow:'hidden',
          }}>
            <div style={{ position:'absolute', top:-100, right:-100, width:300, height:300, borderRadius:'50%', background:'radial-gradient(ellipse,rgba(99,102,241,.12) 0%,transparent 70%)' }} />

            <div style={{ display:'inline-flex', alignItems:'center', gap:6, marginBottom:24, background:'rgba(99,102,241,.15)', border:'1px solid rgba(99,102,241,.3)', borderRadius:100, padding:'6px 14px' }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:'#6366F1', animation:'lp2-ping 2s ease infinite' }} />
              <span style={{ fontSize:12, fontWeight:600, color:'#818CF8' }}>One-time payment · Lifetime access</span>
            </div>

            <div style={{ display:'flex', alignItems:'flex-end', gap:8, marginBottom:10 }}>
              <span style={{ fontSize:28, fontWeight:700, color:'rgba(255,255,255,.45)', lineHeight:1.5 }}>£</span>
              <span style={{ fontSize:76, fontWeight:900, letterSpacing:'-0.04em', lineHeight:1 }}>299</span>
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'rgba(255,255,255,.65)' }}>forever</div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,.3)' }}>one-time · no renewal</div>
              </div>
            </div>

            <p style={{ fontSize:15, color:'rgba(255,255,255,.52)', marginBottom:28, lineHeight:1.65 }}>
              Every feature SkySend offers, permanently unlocked. For your entire team. Today, tomorrow, always.
            </p>

            <Link to="/signup" className="lp2-cta-btn" style={{
              display:'flex', alignItems:'center', justifyContent:'center', gap:10,
              background:'linear-gradient(135deg,#6366F1,#06B6D4)',
              color:'#fff', fontWeight:700, fontSize:17,
              padding:'16px 32px', borderRadius:12, textDecoration:'none',
              boxShadow:'0 0 30px rgba(99,102,241,.36)', marginBottom:32,
              transition:'opacity .2s,transform .2s',
            }}>Get lifetime access <ArrowRight size={18} /></Link>

            <div style={{ borderTop:'1px solid rgba(255,255,255,.08)', paddingTop:28 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 24px' }}>
                {LIFETIME_FEATURES.map((f) => (
                  <div key={f} style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:18, height:18, borderRadius:'50%', background:'rgba(99,102,241,.2)', border:'1px solid rgba(99,102,241,.4)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <Check size={10} style={{ color:'#818CF8' }} />
                    </div>
                    <span style={{ fontSize:13, color:'rgba(255,255,255,.62)' }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'center', gap:24, marginTop:28, paddingTop:24, borderTop:'1px solid rgba(255,255,255,.06)', flexWrap:'wrap' }}>
              {[
                { icon:Shield,    text:'30-day money-back guarantee' },
                { icon:Zap,       text:'Instant access after payment' },
                { icon:TrendingUp,text:'All future updates included' },
              ].map(({ icon:Icon, text }) => (
                <div key={text} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'rgba(255,255,255,.38)' }}>
                  <Icon size={13} style={{ color:'#818CF8' }} />{text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════ FINAL CTA ══════════════════════════════ */}
      <section style={{ padding:'100px 24px', position:'relative', overflow:'hidden', background:'linear-gradient(135deg,rgba(99,102,241,.07) 0%,rgba(6,182,212,.04) 100%)', borderTop:'1px solid rgba(255,255,255,.05)' }}>
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse 60% 60% at 50% 50%,rgba(99,102,241,.1) 0%,transparent 70%)' }} />
        <div className="lp2-rev" style={{ maxWidth:680, margin:'0 auto', textAlign:'center', position:'relative' }}>
          <p style={{ fontSize:12, fontWeight:700, color:'#818CF8', letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:18 }}>Ready to grow?</p>
          <h2 style={{ fontSize:'clamp(30px,4vw,54px)', fontWeight:800, letterSpacing:'-0.03em', lineHeight:1.05, marginBottom:18 }}>
            Start booking more<br />meetings today.
          </h2>
          <p style={{ fontSize:17, color:'rgba(255,255,255,.48)', marginBottom:36 }}>
            Join 500+ enterprise sales teams that use SkySend to hit their pipeline goals — consistently.
          </p>
          <Link to="/signup" className="lp2-cta-btn" style={{
            display:'inline-flex', alignItems:'center', gap:10,
            background:'linear-gradient(135deg,#6366F1,#06B6D4)',
            color:'#fff', fontWeight:700, fontSize:18,
            padding:'18px 36px', borderRadius:14, textDecoration:'none',
            boxShadow:'0 0 42px rgba(99,102,241,.42),0 8px 30px rgba(0,0,0,.4)',
            transition:'opacity .2s,transform .2s',
          }}>Start your free trial <ArrowRight size={20} /></Link>
          <p style={{ fontSize:13, color:'rgba(255,255,255,.28)', marginTop:16 }}>Free 14-day trial · No credit card · Cancel anytime</p>
        </div>
      </section>

      {/* ══════════════════ FOOTER ═════════════════════════════════ */}
      <footer style={{ padding:'56px 24px 28px', borderTop:'1px solid rgba(255,255,255,.06)', background:'rgba(0,0,0,.25)' }}>
        <div style={S.wrap}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:44, gap:32, flexWrap:'wrap' }}>
            <div style={{ maxWidth:240 }}>
              <SkySendLogo inverted />
              <p style={{ fontSize:13, color:'rgba(255,255,255,.32)', marginTop:12, lineHeight:1.7 }}>The AI-powered outreach platform for serious B2B sales teams.</p>
            </div>
            <div style={{ display:'flex', gap:56, flexWrap:'wrap' }}>
              {[
                { title:'Product', links:['Features','Pricing','Changelog','Roadmap'] },
                { title:'Company', links:['About','Blog','Careers','Contact'] },
                { title:'Legal',   links:['Privacy','Terms','Security'] },
              ].map((col) => (
                <div key={col.title}>
                  <p style={{ fontSize:11, fontWeight:700, color:'rgba(255,255,255,.35)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>{col.title}</p>
                  <ul style={{ listStyle:'none', padding:0, margin:0, display:'flex', flexDirection:'column', gap:10 }}>
                    {col.links.map((l) => (
                      <li key={l}><a href="#" className="lp2-footer-link" style={{ fontSize:13, color:'rgba(255,255,255,.42)', textDecoration:'none', transition:'color .2s' }}>{l}</a></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop:'1px solid rgba(255,255,255,.06)', paddingTop:20, display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
            <p style={{ fontSize:12, color:'rgba(255,255,255,.18)' }}>© 2024 SkySend. All rights reserved.</p>
            <p style={{ fontSize:12, color:'rgba(255,255,255,.18)' }}>Built for the world's best sales teams.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

import { Link } from 'react-router-dom';

/**
 * Minimal public shell for legal documents. Standalone (no app chrome) so the
 * pages work for logged-out visitors arriving from the signup page or footer.
 */
export function LegalShell({ title, updated, children }: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAFC', color: '#1E1E2A' }}>
      <header style={{ borderBottom: '1px solid #E8E8F0', background: '#fff' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <img src="/logo.svg" alt="Sincerely" style={{ height: 30 }} />
          </Link>
          <nav style={{ display: 'flex', gap: 20, fontSize: 13.5 }}>
            <Link to="/terms" style={{ color: '#5B5BF5', textDecoration: 'none', fontWeight: 500 }}>Terms</Link>
            <Link to="/privacy" style={{ color: '#5B5BF5', textDecoration: 'none', fontWeight: 500 }}>Privacy</Link>
            <Link to="/login" style={{ color: '#64748B', textDecoration: 'none', fontWeight: 500 }}>Sign in</Link>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>{title}</h1>
        <p style={{ fontSize: 13.5, color: '#94A3B8', marginBottom: 36 }}>Last updated: {updated}</p>
        <article className="legal-body">{children}</article>
        <style>{`
          .legal-body h2 { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; margin: 32px 0 10px; }
          .legal-body h3 { font-size: 15.5px; font-weight: 600; margin: 22px 0 8px; }
          .legal-body p, .legal-body li { font-size: 14.5px; line-height: 1.75; color: #3D3D4E; }
          .legal-body p { margin: 0 0 12px; }
          .legal-body ul { margin: 0 0 14px; padding-left: 22px; list-style: disc; }
          .legal-body li { margin-bottom: 6px; }
          .legal-body a { color: #5B5BF5; }
          .legal-body strong { color: #1E1E2A; }
        `}</style>
      </main>

      <footer style={{ borderTop: '1px solid #E8E8F0', padding: '20px 24px', textAlign: 'center', fontSize: 12.5, color: '#94A3B8' }}>
        © {new Date().getFullYear()} Sincerely · <Link to="/terms" style={{ color: '#94A3B8' }}>Terms</Link> · <Link to="/privacy" style={{ color: '#94A3B8' }}>Privacy</Link>
      </footer>
    </div>
  );
}

import type { ReactNode } from 'react';

/**
 * Shared chrome for every auth screen (sign in, sign up, forgot / reset
 * password). It renders the dark "md-auth" split layout — a brand showpiece on
 * the left and the form column on the right — so the whole auth family looks
 * and flows like one product instead of four different pages.
 *
 * Pass `brand` for the top of the left panel and `brandFooter` for the block
 * pinned to its bottom (e.g. a testimonial). `children` is the form column.
 */

/* The md-auth shell is a fixed dark design → always the white wordmark. */
function BrandLogo() {
  return (
    <a
      className="md-auth__logo"
      href="/"
      aria-label="Sincerely"
      style={{ textDecoration: 'none', display: 'inline-flex' }}
    >
      <img
        src="/logo-dark.svg"
        alt="Sincerely"
        style={{ height: 36, width: 'auto', display: 'block' }}
        draggable={false}
      />
    </a>
  );
}

export function AuthShell({
  brand,
  brandFooter,
  children,
}: {
  brand: ReactNode;
  brandFooter?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="md-auth">
      <aside className="md-auth__brand">
        <div className="md-auth__brand-bg" />
        <div className="md-auth__brand-inner">
          <BrandLogo />
          {brand}
        </div>
        {brandFooter}
      </aside>

      <main className="md-auth__form-wrap">
        <div className="md-auth__form">
          <div className="md-auth__mobile-logo">
            <BrandLogo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/** Google "G" mark — shared by the OAuth buttons on sign in / sign up. */
export function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

/** Product metrics shown on the brand panel of sign in / password flows. */
export function BrandMetrics() {
  const metrics = [
    { v: '18.4%', l: 'Avg reply rate' },
    { v: '97%', l: 'Inbox placement' },
    { v: '4.2M', l: 'Sent this week' },
  ];
  return (
    <div className="md-auth__metrics">
      {metrics.map((m) => (
        <div key={m.l} className="md-auth__metric">
          <div className="md-auth__metric-v">{m.v}</div>
          <div className="md-auth__metric-l">{m.l}</div>
        </div>
      ))}
    </div>
  );
}

/** Testimonial pinned to the bottom of the brand panel. */
export function BrandQuote() {
  return (
    <div className="md-auth__quote">
      <p>"We went from 2% to 18% reply rates in two weeks. Sincerely is the first tool that made our outbound feel effortless."</p>
      <div className="md-auth__quote-author">
        <div className="md-auth__quote-av">SR</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Sarah Rodriguez</div>
          <div style={{ fontSize: 11.5, color: 'rgba(246,246,247,0.45)' }}>VP of Sales, TechCorp</div>
        </div>
      </div>
    </div>
  );
}

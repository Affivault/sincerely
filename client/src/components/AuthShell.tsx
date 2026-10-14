import type { ReactNode } from 'react';
import { SAMPLE_PREVIEW_CONTACT } from '@lemlist/shared';

/**
 * Shared chrome for every auth screen (sign in, sign up, forgot / reset
 * password): the product on the left, on the same paper as the app, and the
 * form on the right - so the first screen someone sees looks like the
 * product they are signing in to.
 *
 * Pass `brand` for the top of the left panel and `brandFooter` for the block
 * pinned to its bottom (e.g. a testimonial). `children` is the form column.
 */

/* Split design: white wordmark on the dark brand panel, dark wordmark on the
   light form column (mobile). */
function BrandLogo({ light = false }: { light?: boolean }) {
  return (
    <a
      className="md-auth__logo"
      href="/"
      aria-label="Sincerely"
      style={{ textDecoration: 'none', display: 'inline-flex' }}
    >
      <img
        src={light ? '/logo.svg' : '/logo-dark.svg'}
        alt="Sincerely"
        style={{ height: 32, width: 'auto', display: 'block' }}
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
          <BrandLogo light />
          {brand}
        </div>
        {brandFooter}
      </aside>

      <main className="md-auth__form-wrap">
        <div className="md-auth__form">
          <div className="md-auth__mobile-logo">
            <BrandLogo light />
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

/**
 * What the product looks like on a working morning - a still of the Today
 * list, labelled as an example.
 *
 * This replaced a row of figures ("18.4% avg reply rate", "4.2M sent this
 * week") and a quoted customer that nothing on the page could stand behind.
 * A login screen is read by people who are about to use the product; showing
 * them the product is both more honest and more persuasive.
 */
export function BrandPreview() {
  // The first row is the app's one sample contact (shared, so every preview
  // agrees); the others are described by role rather than given invented names.
  const c = SAMPLE_PREVIEW_CONTACT;
  const rows = [
    { i: `${c.first_name[0]}${c.last_name[0]}`, who: `${c.first_name} ${c.last_name} at ${c.company}`, tag: 'Wants a meeting', tone: 'brand', said: 'Could we do a call Thursday or Friday afternoon?', when: '2h' },
    { i: 'H', who: 'Head of Sales at a fintech', tag: 'Interested', tone: 'ok', said: 'What would pricing look like for a team of 12?', when: '3h' },
    { i: 'F', who: 'Founder at a broker', tag: 'Objection', tone: 'warn', said: 'We are locked in with a provider until March.', when: '4h' },
  ];
  return (
    <figure className="md-auth__preview" aria-label="An example of the Today list">
      <div className="md-auth__preview-card">
        <div className="md-auth__preview-head">
          <span className="md-auth__preview-title">Today</span>
          <span className="md-auth__preview-sub">3 replies need you, most urgent first</span>
        </div>
        {rows.map((r, n) => (
          <div key={r.i} className={`md-auth__preview-row${n === 0 ? ' is-on' : ''}`}>
            <span className={`md-auth__preview-av md-auth__preview-av--${n}`}>{r.i}</span>
            <span className="md-auth__preview-body">
              <span className="md-auth__preview-line">
                <span className="md-auth__preview-who">{r.who}</span>
                <span className={`md-auth__preview-tag md-auth__preview-tag--${r.tone}`}>{r.tag}</span>
                <span className="md-auth__preview-when">{r.when}</span>
              </span>
              <span className="md-auth__preview-said">{r.said}</span>
            </span>
          </div>
        ))}
      </div>
      <figcaption className="md-auth__preview-cap">An example morning: replies sorted by Relay, a draft ready for each.</figcaption>
    </figure>
  );
}

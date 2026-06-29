import { useId } from 'react';

/**
 * Sincerely logo — the gradient "S" brand mark + the "sincerely" wordmark.
 * Inline + em-based so it renders identically in the app shell and on auth
 * pages and scales with the surrounding font-size. The wordmark colour is
 * theme-aware (dark text in light mode, light text in dark mode); pass
 * `inverted` to force white on a coloured/dark hero background.
 */

// The gradient "S" mark, traced as a thick stroked path (blue → purple).
const S_PATH =
  'M27 12.5C24.7 9.3 19.6 8.3 15.6 9.6 11 11.1 9.8 15.6 13.2 18.2 15.6 20 20.2 20.4 23.8 21.8 28.8 23.7 29.4 28.4 26 31.2 22.8 33.8 17.4 33.2 13.8 30';

function SMark({ gid }: { gid: string }) {
  return (
    <>
      <defs>
        <linearGradient id={gid} x1="8" y1="8" x2="32" y2="33" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4F86F7" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <path
        d={S_PATH}
        stroke={`url(#${gid})`}
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
}

export function SincerelyLogo({ className = '', inverted = false }: { className?: string; inverted?: boolean }) {
  const gid = useId();
  const base = inverted ? '#fff' : 'var(--text-primary)';

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.42em',
        lineHeight: 1,
        fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif",
        fontWeight: 700,
        letterSpacing: '-0.035em',
        fontSize: 'inherit',
      }}
    >
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          filter: 'drop-shadow(0 3px 10px rgba(108,92,250,0.35))',
        }}
      >
        <svg style={{ height: '1.5em', width: '1.5em' }} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <SMark gid={gid} />
        </svg>
      </span>
      <span style={{ color: base }}>sincerely</span>
    </span>
  );
}

/**
 * Compact mark — just the gradient "S", for favicon / collapsed contexts.
 * Sized by `className` (defaults to h-7 w-7).
 */
export function SincerelyLogoMark({ className = 'h-7 w-7' }: { className?: string; inverted?: boolean }) {
  const gid = useId();
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <SMark gid={gid} />
    </svg>
  );
}

import type { CSSProperties } from 'react';

/**
 * Sincerely brand logo — the gradient mark + "sincerely" wordmark, shipped as
 * the official SVG lockups in /public.
 *
 * Theme-aware by default: it shows the dark-ink logo on light surfaces and the
 * white logo on dark surfaces. Selection is driven purely by the `.dark` class
 * on <html> (set by ThemeProvider), so it works on auth pages too — even when
 * the provider isn't mounted, the CSS resolves against whatever theme state the
 * page is rendered with. Pass `inverted` to force the white logo on a fixed
 * dark/coloured panel regardless of the active theme.
 *
 * Sized for the app shell header by default; pass a `className` to override.
 */
export function SincerelyLogo({ className = '', inverted = false }: { className?: string; inverted?: boolean }) {
  // Fixed height tuned to the 56px app-shell header; CSS owns `display` so the
  // theme-aware swap below isn't beaten by an inline value.
  const dim: CSSProperties = { height: 24, width: 'auto' };

  // Fixed dark/coloured panel → always the white wordmark.
  if (inverted) {
    return (
      <img
        src="/logo-dark.svg"
        alt="Sincerely"
        className={className}
        style={{ ...dim, display: 'inline-block', verticalAlign: 'middle' }}
        draggable={false}
      />
    );
  }

  // Theme-aware: both lockups are rendered and CSS reveals the right one.
  return (
    <span
      className={className}
      role="img"
      aria-label="Sincerely"
      style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1 }}
    >
      <img src="/logo.svg" alt="" className="sx-logo sx-logo--light" style={dim} draggable={false} />
      <img src="/logo-dark.svg" alt="" className="sx-logo sx-logo--dark" style={dim} draggable={false} />
    </span>
  );
}

/**
 * Compact mark — just the gradient "S" badge, for favicon / collapsed contexts.
 * Sized by `className` (defaults to h-7 w-7).
 */
export function SincerelyLogoMark({ className = 'h-7 w-7' }: { className?: string }) {
  return <img src="/favicon.png" alt="Sincerely" className={className} draggable={false} />;
}

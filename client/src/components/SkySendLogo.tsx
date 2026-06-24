/**
 * MeetDrive logo — clean modern wordmark. The exported names are kept as
 * SkySend* for backwards-compat with existing imports across the app; only
 * the rendered brand is MeetDrive.
 */
export function SkySendLogo({ className = '', inverted = false }: { className?: string; inverted?: boolean }) {
  const base = inverted ? 'white' : 'var(--text-primary)';
  const accent = inverted ? 'white' : 'var(--indigo)';

  return (
    <span
      className={className}
      style={{
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        fontWeight: 600,
        letterSpacing: '-0.03em',
        fontSize: 'inherit',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <span style={{ color: base }}>Meet</span>
      <span style={{ color: accent }}>Drive</span>
    </span>
  );
}

/**
 * Compact logo mark — an "M" in a rounded square for favicon / collapsed contexts.
 */
export function SkySendLogoMark({ className = 'h-7 w-7', inverted = false }: { className?: string; inverted?: boolean }) {
  const bg = inverted ? 'white' : 'var(--indigo)';
  const fg = inverted ? 'var(--indigo)' : 'white';

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect width="32" height="32" rx="8" fill={bg} />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fill={fg}
        fontFamily="Inter, system-ui, -apple-system, sans-serif"
        fontWeight="700"
        fontSize="18"
        letterSpacing="-0.5"
      >
        M
      </text>
    </svg>
  );
}

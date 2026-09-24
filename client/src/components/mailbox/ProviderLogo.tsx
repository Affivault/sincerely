import { cn } from '../../lib/utils';

/*
 * A recognisable mark per provider. Google and Microsoft get their real
 * glyphs - they are most of who connects - and everyone else a lettered
 * tile in the provider's own colour, so the picker scans by shape rather
 * than by reading a list of names.
 */
const TILE: Record<string, { letter: string; bg: string }> = {
  'Yahoo Mail': { letter: 'Y', bg: '#6001D2' },
  'Zoho Mail': { letter: 'Z', bg: '#E42527' },
  SendGrid: { letter: 'SG', bg: '#1A82E2' },
  Mailgun: { letter: 'M', bg: '#F06B66' },
  'Amazon SES': { letter: 'S', bg: '#232F3E' },
  Fastmail: { letter: 'F', bg: '#0067B9' },
  'iCloud Mail': { letter: 'iC', bg: '#3693F3' },
  'ProtonMail Bridge': { letter: 'P', bg: '#6D4AFF' },
  Spacemail: { letter: 'S', bg: '#0B1B3F' },
  'Namecheap Private Email': { letter: 'N', bg: '#DE3723' },
  Titan: { letter: 'T', bg: '#2B59FF' },
};

export function ProviderLogo({ name, className }: { name: string | null | undefined; className?: string }) {
  const size = cn('h-5 w-5', className);
  if (name === 'Gmail' || name === 'Google Workspace') {
    return (
      <svg className={size} viewBox="0 0 24 24" aria-hidden>
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    );
  }
  if (name === 'Outlook / Microsoft 365') {
    return (
      <svg className={size} viewBox="0 0 24 24" aria-hidden>
        <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
        <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
        <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
        <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
      </svg>
    );
  }
  const tile = name ? TILE[name] : undefined;
  if (tile) {
    return (
      <span
        className={cn('inline-flex items-center justify-center rounded-md text-micro font-bold leading-none tracking-tight text-white', size)}
        style={{ background: tile.bg }}
        aria-hidden
      >
        {tile.letter}
      </span>
    );
  }
  // Any other server: an envelope, in the app's own colour.
  return (
    <svg className={cn(size, 'text-[var(--indigo)]')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
    </svg>
  );
}

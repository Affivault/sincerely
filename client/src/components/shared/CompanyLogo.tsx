import { useState } from 'react';
import { cn } from '../../lib/utils';

/** "https://www.acme.co.uk/about" -> "acme.co.uk"; null when there is nothing domain-like. */
export function domainOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

function initials(name: string | null | undefined): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

const SIZES = { xs: 'h-5 w-5 text-micro', sm: 'h-6 w-6 text-micro', md: 'h-8 w-8 text-caption', lg: 'h-11 w-11 text-body' } as const;

/**
 * A company's own icon, from its website, with its initials when it has
 * none. Every prospecting tool people move from shows logos, and a column
 * of identical grey buildings makes a list of accounts hard to scan.
 *
 * The icon comes from DuckDuckGo's favicon service, which answers 404 for a
 * domain with no icon (so the initials show) and does not track who asked.
 * Only the domain is sent.
 */
export function CompanyLogo({ domain, name, logoUrl, size = 'sm', className }: {
  domain?: string | null;
  name?: string | null;
  /** A logo the record already has (an enriched company), used first. */
  logoUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const host = domainOf(domain);
  const src = logoUrl || (host ? `https://icons.duckduckgo.com/ip3/${host}.ico` : null);
  const [failed, setFailed] = useState(false);
  const box = cn('flex flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--border-subtle)] bg-white', SIZES[size], className);
  if (src && !failed) {
    return (
      <span className={box}>
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-[70%] w-[70%] object-contain"
        />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn(box, 'bg-[var(--bg-elevated)] font-semibold text-[var(--text-tertiary)]')}>
      {initials(name)}
    </span>
  );
}

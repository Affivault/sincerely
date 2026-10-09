import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { prefetchHref } from '../../lib/prefetch';
import type { Section, SectionTab } from '../../lib/sections';
import { cn } from '../../lib/utils';
import { useActiveIntoView } from '../../hooks/useActiveIntoView';
import { useMomentsCount } from '../../hooks/useMomentsCount';

/**
 * The pages of the place you are in, as one row of tabs under the header.
 *
 * It is what lets the sidebar be six rows: Templates, Revenue or Booking
 * links are no longer entries to find in a long rail, they are one click
 * along from wherever you already are. Sticky, so switching never needs a
 * scroll back to the top.
 */
export const SECTION_BAR_H = 44;

export function SectionBar({ section, active }: { section: Section; active: SectionTab | null }) {
  const strip = useActiveIntoView<HTMLDivElement>(active?.href);
  const momentsCount = useMomentsCount();

  /*
   * The pages beside this one are the likeliest next click, and they are
   * sitting in plain view. Their code is fetched once the page has settled,
   * so moving along the tabs never waits on a download. Same rules as hover
   * prefetching: once per chunk, capped, and never on Save-Data or 2G.
   */
  useEffect(() => {
    const idle: (cb: () => void) => number =
      (window as any).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1200));
    const cancel: (id: number) => void = (window as any).cancelIdleCallback ?? window.clearTimeout;
    const id = idle(() => {
      for (const tab of section.tabs) if (tab.href !== active?.href) prefetchHref(tab.href);
    });
    return () => cancel(id);
  }, [section, active?.href]);

  return (
    <nav
      aria-label={section.name}
      className="sticky top-[56px] z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/85 backdrop-blur-xl"
      style={{ height: SECTION_BAR_H }}
    >
      <div ref={strip} className="h-full max-w-[1760px] mx-auto flex items-stretch gap-1 px-2 sm:px-4 lg:px-6 overflow-x-auto scrollbar-none">
        <span className="hidden md:flex items-center pr-3 mr-1 text-body font-semibold text-[var(--text-primary)] border-r border-[var(--border-subtle)] my-2.5 flex-shrink-0">
          {section.name}
        </span>
        {section.tabs.map((tab) => {
          const on = active?.href === tab.href;
          return (
            <Link
              key={tab.href}
              to={tab.href}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-1.5 px-2.5 text-strong font-medium whitespace-nowrap transition-colors flex-shrink-0 rounded-md',
                on ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
              )}
            >
              <tab.icon className={cn('h-3.5 w-3.5', on ? 'text-[var(--indigo)]' : 'opacity-70')} strokeWidth={1.8} />
              {tab.label}
              {tab.href === '/moments' && momentsCount > 0 && (
                <span
                  className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-[var(--indigo)] text-white text-micro font-semibold leading-none tabular-nums"
                  aria-label={`${momentsCount} new`}
                >
                  {momentsCount > 99 ? '99+' : momentsCount}
                </span>
              )}
              <span
                aria-hidden
                className={cn(
                  'absolute left-2 right-2 bottom-0 h-[2px] rounded-t-full transition-opacity duration-150',
                  on ? 'bg-[var(--indigo)] opacity-100' : 'opacity-0',
                )}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

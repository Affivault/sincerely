import { useEffect } from 'react';
import { cn } from '../../lib/utils';

/**
 * The frame every public page sits in.
 *
 * It owns the theme, and it has to, for a reason that is not obvious:
 * ThemeProvider lives inside AppLayout, which these pages deliberately sit
 * outside of. So a visitor arriving cold gets whatever `:root` says, while
 * an account that clicks through from its own dark-mode app carries the
 * `dark` class on <html> with it - the same URL rendering two different
 * ways depending on how somebody got there.
 *
 * So the theme is decided here instead, from the visitor's own system
 * preference, and put back on the way out so returning to the app does not
 * leave it stuck on whatever a booking page chose.
 */
export function PublicShell({ children, wide }: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains('dark');

    let mq: MediaQueryList | null = null;
    const apply = (dark: boolean) => root.classList.toggle('dark', dark);

    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
      const onChange = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener('change', onChange);
      return () => {
        mq?.removeEventListener('change', onChange);
        apply(had);
      };
    } catch {
      // No matchMedia: leave whatever is there rather than guessing.
      return () => apply(had);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg-elevated)] px-4 py-8 sm:py-14">
      <div className={cn('mx-auto', wide ? 'max-w-4xl' : 'max-w-md')}>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-7 shadow-sm">
          {children}
        </div>
        <p className="mt-4 text-center text-caption text-[var(--text-tertiary)]">
          Scheduling by Sincerely
        </p>
      </div>
    </div>
  );
}

import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Breadcrumb[];
  /** Right-side actions (buttons, menus) */
  actions?: ReactNode;
  /** Left-side leading element (icon, avatar, badge) */
  leading?: ReactNode;
  /** Add the signature dot grid + soft brand glow behind the title area */
  decorate?: boolean;
  /** Tabs or sub-nav row rendered below the title */
  tabs?: ReactNode;
  /** Extra metadata row (eg "Updated 2h ago · 42 contacts") */
  meta?: ReactNode;
  className?: string;
  /**
   * Width for what is inside the band, when the page below is narrower
   * than the screen (Flow reads best at max-w-4xl). The band itself still
   * runs edge to edge; wrapping the whole header in the narrow container
   * instead left a white strip that stopped partway across the page.
   */
  contentClassName?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  leading,
  tabs,
  meta,
  className,
  contentClassName,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        // Full-bleed: these cancel <main>'s padding at every width (px-4 /
        // sm:px-6 / lg:px-8, py-5 / lg:py-7 in AppLayout). They were a fixed
        // -mx-6 against a px-8 page, which left the band floating 8px in from
        // both edges on desktop and hanging off the side on a phone.
        'relative -mx-4 -mt-5 sm:-mx-6 lg:-mx-8 lg:-mt-7 mb-5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden',
        className
      )}
    >
      {/* `decorate` retained for API compatibility; the glow wash was removed to
          keep headers calm and consistent across the app. */}

      <div className="relative px-4 sm:px-6 lg:px-8 pt-5 pb-4">
        <div className={contentClassName}>
        {/* Breadcrumbs */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 mb-2 text-body text-[var(--text-tertiary)]">
            {breadcrumbs.map((bc, i) => (
              <span key={i} className="flex items-center gap-1">
                {bc.href ? (
                  <Link
                    to={bc.href}
                    className="hover:text-[var(--text-primary)] transition-colors duration-150"
                  >
                    {bc.label}
                  </Link>
                ) : (
                  <span className="text-[var(--text-secondary)]">{bc.label}</span>
                )}
                {i < breadcrumbs.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-[var(--text-muted)]" strokeWidth={1.5} />
                )}
              </span>
            ))}
          </nav>
        )}

        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          {leading && <div className="flex-shrink-0 mt-1">{leading}</div>}

          <div className="flex-1 min-w-[min(100%,16rem)]">
            <h1 className="text-display font-semibold text-[var(--text-primary)] leading-[1.15] tracking-[-0.02em]">
              {title}
            </h1>
            {description && (
              <p className="mt-1 text-strong text-[var(--text-secondary)] leading-snug max-w-2xl">
                {description}
              </p>
            )}
            {meta && (
              <div className="mt-2 flex items-center gap-2 text-body text-[var(--text-tertiary)]">
                {meta}
              </div>
            )}
          </div>

          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>

        </div>
        {/* Tabs row */}
        {tabs && (
          <div className="mt-4 -mb-4 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 overflow-x-auto scrollbar-none border-t border-[var(--border-subtle)]">
            <div className={contentClassName}>{tabs}</div>
          </div>
        )}
      </div>
    </header>
  );
}

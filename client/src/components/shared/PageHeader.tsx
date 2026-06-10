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
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  leading,
  decorate = false,
  tabs,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'relative -mx-6 -mt-5 mb-5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden',
        className
      )}
    >
      {/* Subtle ambient wash for hero headers — kept very faint */}
      {decorate && (
        <div
          className="absolute -top-28 right-0 h-56 w-96 rounded-full blur-3xl opacity-50 pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.10), transparent 70%)' }}
        />
      )}

      <div className="relative px-6 pt-5 pb-4">
        {/* Breadcrumbs */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 mb-2 text-[12px] text-[var(--text-tertiary)]">
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

        <div className="flex items-start gap-4">
          {leading && <div className="flex-shrink-0 mt-1">{leading}</div>}

          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] font-semibold text-[var(--text-primary)] leading-[1.15] tracking-[-0.02em]">
              {title}
            </h1>
            {description && (
              <p className="mt-1 text-[13px] text-[var(--text-secondary)] leading-snug max-w-2xl">
                {description}
              </p>
            )}
            {meta && (
              <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]">
                {meta}
              </div>
            )}
          </div>

          {actions && (
            <div className="flex-shrink-0 flex items-center gap-2">{actions}</div>
          )}
        </div>

        {/* Tabs row */}
        {tabs && (
          <div className="mt-4 -mb-4 -mx-6 px-6 border-t border-[var(--border-subtle)]">
            {tabs}
          </div>
        )}
      </div>
    </header>
  );
}

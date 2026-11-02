import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface MoreMenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** Red, for the final or destructive ones. */
  danger?: boolean;
  disabled?: boolean;
  /** Why it is disabled, or what it does - shown on hover. */
  hint?: string;
}

/**
 * The "..." beside a page's main buttons, for the actions that are needed
 * now and then but should not sit as equals beside the everyday ones -
 * ending a campaign, suppressing or deleting a person. Each item is named in
 * words, so nothing is left as an unlabelled icon.
 */
export function MoreMenu({ items, label = 'More actions', className, trigger }: {
  items: MoreMenuItem[];
  label?: string;
  className?: string;
  /** Replaces the default "..." button's content. */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={ref} className={cn('relative flex-shrink-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        className="icon-btn h-8 w-8"
      >
        {trigger ?? <MoreHorizontal className="h-4 w-4" />}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1 shadow-[var(--shadow-lg)]"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.hint}
                onClick={() => { setOpen(false); item.onSelect(); }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
                  item.danger
                    ? 'text-rose-600 hover:bg-rose-500/10 dark:text-rose-400'
                    : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

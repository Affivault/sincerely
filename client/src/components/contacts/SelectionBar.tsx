import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ChevronUp, Loader2, X, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { escapeWasForOverlay } from '../../lib/keyboard';

/* ═══════════════════════════════════════════════════════════════════════
   What you can do with the people you ticked.

   It used to be a grey box above the table with ten equal buttons that
   wrapped onto two lines - every action shouting at the same volume, and
   the box pushing the rows you had just selected down the page. Now it is
   one floating bar at the bottom of the screen, where the eye goes after
   ticking rows: the count, the two or three things people do most, the
   rest grouped behind short menus, and delete set apart.
   ═══════════════════════════════════════════════════════════════════════ */

export interface BarAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Shown while it runs, in place of the label. */
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
  danger?: boolean;
  /** For tests and tours. */
  testId?: string;
}

export interface BarMenu {
  label: string;
  icon: LucideIcon;
  items: BarAction[];
}

function useDismiss(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open, close, ref]);
}

const BTN = 'inline-flex items-center gap-1.5 h-8 px-2 sm:px-2.5 rounded-lg text-strong font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';
const GHOST = 'text-white/85 hover:text-white hover:bg-white/10';

function ActionButton({ a, primary }: { a: BarAction; primary?: boolean }) {
  const Icon = a.busy ? Loader2 : a.icon;
  return (
    <button
      type="button"
      onClick={a.onSelect}
      disabled={a.disabled || a.busy}
      title={a.hint || a.label}
      aria-label={a.label}
      data-action={a.testId}
      className={cn(
        BTN,
        primary ? 'bg-[var(--indigo)] text-white hover:bg-[var(--indigo-hover)] shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]' : GHOST,
        a.danger && 'text-rose-300 hover:text-rose-200 hover:bg-rose-500/15',
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', a.busy && 'animate-spin')} />
      <span className={cn(primary ? 'hidden sm:inline' : 'hidden lg:inline')}>{a.busy && a.busyLabel ? a.busyLabel : a.label}</span>
    </button>
  );
}

function MenuButton({ m }: { m: BarMenu }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  useDismiss(open, close, ref);
  const items = m.items.filter(Boolean);
  if (items.length === 0) return null;
  const Icon = m.icon;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={m.label}
        className={cn(BTN, GHOST, open && 'bg-white/10 text-white')}
      >
        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="hidden lg:inline">{m.label}</span>
        <ChevronUp className={cn('hidden sm:block h-3 w-3 opacity-60 transition-transform', !open && 'rotate-180')} />
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          className="absolute bottom-full right-0 mb-2 min-w-[220px] max-w-[calc(100vw-24px)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1 shadow-[var(--shadow-xl)] animate-fade-in"
        >
          {items.map((it) => {
            const ItIcon = it.icon;
            return (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                title={it.hint}
                onClick={() => { close(); it.onSelect(); }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed',
                  it.danger ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10' : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
                )}
              >
                <ItIcon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-[var(--text-secondary)]" />
                <span className="min-w-0">
                  <span className="block text-strong font-medium">{it.label}</span>
                  {it.hint && <span className="block text-caption text-[var(--text-tertiary)] leading-snug">{it.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SelectionBar({ count, noun, onClear, primary, actions, menus, danger, selectAll }: {
  count: number;
  noun: string;
  onClear: () => void;
  /** The one thing most people do next. */
  primary?: BarAction;
  /** Shown as buttons (icon-only on narrow screens). */
  actions: BarAction[];
  menus: BarMenu[];
  /** Set apart at the end. */
  danger?: BarAction;
  /** "Select all 1,450" when only the page is ticked. */
  selectAll?: { label: string; onSelect: () => void };
}) {
  // Esc clears the selection - unless a dialog or menu is open, which Esc closes first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (escapeWasForOverlay(e) || document.querySelector('[role="dialog"], [role="menu"]')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      onClear();
    };
    // One Esc closes a dialog; a second clears the selection.
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClear]);

  return (
    <>
      <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-3 pointer-events-none" data-selection-bar>
        <div
          role="toolbar"
          aria-label={`Actions for ${count} selected`}
          className="pointer-events-auto flex max-w-full items-center gap-0.5 sm:gap-1 rounded-2xl border border-white/10 bg-[var(--bg-floating)] p-1.5 pl-2 text-white shadow-[0_12px_40px_-8px_rgba(0,0,0,0.45),0_2px_6px_rgba(0,0,0,0.2)] animate-fade-in"
        >
          <div className="flex items-center gap-2 pl-1 pr-2 flex-shrink-0">
            <span className="inline-flex min-w-[22px] h-[22px] items-center justify-center rounded-md bg-white text-[var(--bg-floating)] px-1.5 text-micro font-bold tabular">
              {count.toLocaleString()}
            </span>
            <span className="text-strong font-medium text-white/90 whitespace-nowrap hidden sm:inline">selected</span>
            {selectAll && (
              <button type="button" onClick={selectAll.onSelect} className="text-strong font-medium text-indigo-300 hover:text-indigo-200 whitespace-nowrap">
                {selectAll.label}
              </button>
            )}
          </div>
          <span className="h-5 w-px bg-white/15 flex-shrink-0" aria-hidden="true" />
          {primary && <ActionButton a={primary} primary />}
          {actions.map((a) => <ActionButton key={a.label} a={a} />)}
          {menus.map((m) => <MenuButton key={m.label} m={m} />)}
          {danger && (
            <>
              <span className="h-5 w-px bg-white/15 flex-shrink-0" aria-hidden="true" />
              <ActionButton a={{ ...danger, danger: true }} />
            </>
          )}
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear selection of ${count} ${noun}${count === 1 ? '' : 's'}`}
            title="Clear selection (Esc)"
            className={cn(BTN, GHOST, 'px-2')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}

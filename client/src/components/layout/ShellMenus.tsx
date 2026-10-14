import { useCallback, useEffect, useId, useRef, useState, type FocusEvent as ReactFocusEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Megaphone, Upload, Handshake, UserPlus, CalendarPlus, AtSign,
  User, Settings, LogOut, Sun, Moon, Keyboard,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { billingApi } from '../../api/billing.api';
import { isUnlimited } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/*
 * The two menus that used to live in the top bar - "Create" and the
 * account menu - as pieces either surface can hold. On a desktop they
 * live in the sidebar, which is now the only chrome; on a phone the top
 * bar comes back and carries them.
 */

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/**
 * Closes on Escape, on scroll and on navigation - not just on a click.
 *
 * Escape hands the cursor back to the trigger first: the panel is about to
 * unmount, and focus on a removed node drops to <body>, which sends a
 * keyboard user back to the top of the page.
 */
function useDismiss(open: boolean, setOpen: (o: boolean) => void, restoreFocus: () => void) {
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname, setOpen]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      restoreFocus();
      close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen, restoreFocus]);
}

/** What the trigger button must spread so the menu can be driven from the keyboard. */
export interface TriggerProps {
  ref: (el: HTMLButtonElement | null) => void;
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
}

/**
 * The state and wiring shared by both menus: a disclosure, not an ARIA
 * menu - the panel is a group of ordinary buttons reached with Tab, so the
 * trigger says whether it is open and what it controls and promises no
 * arrow-key roving it does not have.
 */
function useMenu() {
  const [open, setOpen] = useState(false);
  const triggerEl = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const setTrigger = useCallback((el: HTMLButtonElement | null) => { triggerEl.current = el; }, []);
  const restoreFocus = useCallback(() => { triggerEl.current?.focus({ preventScroll: true }); }, []);
  useDismiss(open, setOpen, restoreFocus);
  const triggerProps: TriggerProps = {
    ref: setTrigger,
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
  };
  /** Tabbing out of the open panel (or the trigger) closes it rather than leaving it hanging. */
  const onBlur = (e: ReactFocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && !e.currentTarget.contains(next)) setOpen(false);
  };
  return { open, setOpen, panelId, triggerProps, restoreFocus, onBlur };
}

type Placement = 'below-right' | 'below-left' | 'above-left' | 'right-start' | 'right-end';

const PLACEMENT: Record<Placement, string> = {
  'below-right': 'right-0 top-full mt-1.5',
  'below-left': 'left-0 top-full mt-1.5',
  'above-left': 'left-0 bottom-full mb-1.5',
  'right-start': 'left-full top-0 ml-2',
  // Beside a trigger at the foot of the screen, growing upward from it.
  'right-end': 'left-full bottom-0 ml-2',
};

function Popover({ open, onClose, placement, width, id, label, children }: {
  open: boolean; onClose: () => void; placement: Placement; width: string; id: string; label: string; children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Opening is a decision to look inside, so the cursor goes with it.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('button:not([disabled]), a[href]')?.focus({ preventScroll: true });
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[60]" aria-hidden onClick={onClose} />
      <div
        ref={panel}
        id={id}
        role="group"
        aria-label={label}
        className={cn('absolute z-[61] rounded-xl bg-[var(--bg-surface)] border border-[var(--border-default)] p-1 shadow-[var(--shadow-xl)] animate-slide-in', PLACEMENT[placement], width)}
      >
        {children}
      </div>
    </>
  );
}

/* The things people make in a day, each landing on its form rather than
   on a list with the button still to find. */
const CREATE_ITEMS = [
  { label: 'New campaign', desc: 'Build an outbound sequence', icon: Megaphone, to: '/campaigns/new', key: 'N' },
  { label: 'New deal', desc: 'Add an opportunity to the pipeline', icon: Handshake, to: '/deals?new=1' },
  { label: 'Add contact', desc: 'Someone you work with', icon: UserPlus, to: '/contacts?new=1' },
  { label: 'Book meeting', desc: 'Put a call on the calendar', icon: CalendarPlus, to: '/calendar?new=1' },
  { label: 'Import contacts', desc: 'Upload a CSV of leads', icon: Upload, to: '/contacts/import' },
  { label: 'Connect mailbox', desc: 'Send from another address', icon: AtSign, to: '/email-accounts?connect=1' },
];

export function CreateMenu({ placement = 'below-right', trigger }: {
  placement?: Placement;
  /** Renders the button. Receives the toggle, whether the menu is open, and the props the button must spread. */
  trigger: (toggle: () => void, open: boolean, triggerProps: TriggerProps) => ReactNode;
}) {
  const { open, setOpen, panelId, triggerProps, onBlur } = useMenu();
  const navigate = useNavigate();
  return (
    <div className="relative" onBlur={onBlur}>
      {trigger(() => setOpen((o) => !o), open, triggerProps)}
      <Popover open={open} onClose={() => setOpen(false)} placement={placement} width="w-64" id={panelId} label="Create">
        {CREATE_ITEMS.map((item) => (
          <button
            key={item.to}
            onClick={() => { setOpen(false); navigate(item.to); }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-[var(--bg-hover)] transition-colors"
          >
            <item.icon className="h-4 w-4 flex-shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.7} />
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-[var(--text-primary)] leading-tight">{item.label}</span>
              <span className="block text-caption text-[var(--text-tertiary)] leading-tight mt-0.5">{item.desc}</span>
            </span>
            {item.key && <kbd className="kbd">{item.key}</kbd>}
          </button>
        ))}
      </Popover>
    </div>
  );
}

/** A plain plus button for the create menu, sized for a toolbar. */
export function CreateButton({ toggle, open, compact, triggerProps }: { toggle: () => void; open: boolean; compact?: boolean; triggerProps?: TriggerProps }) {
  return (
    <button
      {...triggerProps}
      type="button"
      onClick={toggle}
      aria-label="Create"
      aria-expanded={open}
      title="Create"
      className={cn(
        'flex flex-shrink-0 items-center justify-center rounded-md bg-[var(--indigo)] text-white shadow-[var(--glow-indigo)] transition-colors hover:bg-[var(--indigo-hover)]',
        compact ? 'h-7 w-7' : 'h-8 w-8',
      )}
    >
      <Plus className={cn('transition-transform duration-150', compact ? 'h-3.5 w-3.5' : 'h-4 w-4', open && 'rotate-45')} strokeWidth={2.2} />
    </button>
  );
}

export function AccountMenu({ placement = 'above-left', onShortcuts, trigger }: {
  placement?: Placement;
  onShortcuts?: () => void;
  trigger: (toggle: () => void, open: boolean, triggerProps: TriggerProps) => ReactNode;
}) {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { data: usage } = useQuery({ queryKey: ['billing', 'usage'], queryFn: billingApi.usage, staleTime: 60_000 });
  const { open, setOpen, panelId, triggerProps, restoreFocus, onBlur } = useMenu();
  const navigate = useNavigate();
  const go = (to: string) => { setOpen(false); navigate(to); };

  const row = 'w-full flex items-center gap-2.5 px-2.5 h-8 rounded-lg text-body text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors';

  return (
    <div className="relative" onBlur={onBlur}>
      {trigger(() => setOpen((o) => !o), open, triggerProps)}
      <Popover open={open} onClose={() => setOpen(false)} placement={placement} width="w-60" id={panelId} label="Account">
        <div className="px-2.5 pt-2 pb-2.5 mb-1 border-b border-[var(--border-subtle)]">
          <p className="text-body font-semibold text-[var(--text-primary)] truncate capitalize">{user?.email?.split('@')[0]}</p>
          <p className="text-caption text-[var(--text-tertiary)] truncate">{user?.email}</p>
        </div>

        {usage && (
          <div className="px-2.5 pb-2.5 mb-1 border-b border-[var(--border-subtle)] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-caption text-[var(--text-tertiary)]">Plan</span>
              <span className="text-caption font-semibold text-[var(--text-primary)]">{usage.planName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-caption text-[var(--text-tertiary)]">Emails this month</span>
              <span className="text-caption text-[var(--text-secondary)] tabular-nums">
                {usage.emailsSent.toLocaleString()} / {isUnlimited(usage.emailsLimit) ? '∞' : usage.emailsLimit.toLocaleString()}
              </span>
            </div>
            {usage.status === 'past_due' || usage.status === 'canceled' ? (
              <button onClick={() => go('/billing')} className="w-full mt-1 h-7 rounded-md text-caption font-semibold text-white bg-[var(--error)]">
                {usage.status === 'past_due' ? 'Payment failed - fix billing' : 'Subscription canceled - renew'}
              </button>
            ) : usage.status === 'trialing' && usage.trialEndsAt ? (
              <div className="flex items-center justify-between">
                <span className="text-caption text-[var(--text-tertiary)]">Trial ends</span>
                <span className="text-caption text-[var(--text-secondary)]">in {daysUntil(usage.trialEndsAt)}d</span>
              </div>
            ) : usage.currentPeriodEnd ? (
              <div className="flex items-center justify-between">
                <span className="text-caption text-[var(--text-tertiary)]">Next payment</span>
                <span className="text-caption text-[var(--text-secondary)]">in {daysUntil(usage.currentPeriodEnd)}d</span>
              </div>
            ) : usage.plan === 'free' ? (
              <button onClick={() => go('/billing')} className="w-full mt-1 h-7 rounded-md text-caption font-semibold text-white bg-[var(--indigo)]">
                Upgrade plan
              </button>
            ) : null}
          </div>
        )}

        <button onClick={() => go('/settings?tab=profile')} className={row}><User className="h-3.5 w-3.5" />Profile</button>
        <button onClick={() => go('/settings')} className={row}><Settings className="h-3.5 w-3.5" />Settings</button>
        <button onClick={() => { toggleTheme(); }} className={row}>
          {theme === 'light' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
          {theme === 'light' ? 'Dark theme' : 'Light theme'}
        </button>
        {onShortcuts && (
          <button onClick={() => { restoreFocus(); setOpen(false); onShortcuts(); }} className={row}>
            <Keyboard className="h-3.5 w-3.5" />Keyboard shortcuts<kbd className="kbd ml-auto">?</kbd>
          </button>
        )}
        <div className="border-t border-[var(--border-subtle)] mt-1 pt-1">
          <button onClick={() => { setOpen(false); signOut(); }} className={cn(row, 'text-[var(--error)] hover:text-[var(--error)] hover:bg-[var(--error-bg)]')}>
            <LogOut className="h-3.5 w-3.5" />Sign out
          </button>
        </div>
      </Popover>
    </div>
  );
}

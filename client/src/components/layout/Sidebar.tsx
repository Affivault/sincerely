import { useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ShieldCheck, Search, PanelLeftClose, PanelLeftOpen, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { SetupNudge } from '../setup/SetupNudge';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { useMomentsCount } from '../../hooks/useMomentsCount';
import { billingApi } from '../../api/billing.api';
import { isUnlimited, ADMIN_EMAILS } from '@lemlist/shared';
import { SECTIONS, SETTINGS_ICON, locate, isSettingsPath } from '../../lib/sections';
import { useCommandPalette } from '../../context/CommandPaletteContext';
import { SincerelyLogo, SincerelyLogoMark } from '../SincerelyLogo';
import { AccountMenu, CreateButton, CreateMenu } from './ShellMenus';
import { HEADER_H } from './Header';

/* ─── Nav ────────────────────────────────────────────────────────────
   Six places and Settings - see lib/sections.ts for why, and for the one
   definition every surface reads. A place's own pages are tabs in the bar
   under the header, so the rail never grows and never needs opening. */

/* ─── Row styling ───────────────────────────────────────────────────
   Inactive rows are graphite text on the paper rail. The active row is
   pressed into it - a darker ground, full ink - rather than a floating
   white card with a shadow, which is every sidebar kit's active state. */
const rowBase =
  'group relative flex items-center rounded-md transition-colors duration-100 select-none';
const rowInactive =
  'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]';
const rowActive =
  'bg-[var(--bg-active)] text-[var(--text-primary)]';

/* ─── NavRow ────────────────────────────────────────────────────── */
function NavRow({ name, href, icon: Icon, active, collapsed, badge, hint }: {
  name: string; href: string; icon: React.ElementType; active: boolean; collapsed: boolean; badge?: number; hint?: string;
}) {
  return (
    <NavLink
      to={href}
      title={collapsed ? name : hint}
      aria-current={active ? 'page' : undefined}
      className={cn(
        rowBase,
        collapsed ? 'justify-center h-8 w-8 mx-auto' : 'h-[32px] gap-2.5 px-2',
        active ? rowActive : rowInactive,
      )}
    >
      <Icon
        className={cn('h-[16px] w-[16px] flex-shrink-0 transition-colors', active ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]')}
        strokeWidth={1.75}
      />
      {!collapsed && (
        <span className={cn('flex-1 truncate leading-none text-strong', active ? 'font-semibold' : 'font-medium')}>{name}</span>
      )}
      {badge != null && badge > 0 && (
        collapsed ? (
          <span className="absolute -top-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--indigo)] text-white text-micro font-bold px-0.5 leading-none ring-2 ring-[var(--bg-app)]">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : (
          <span className={cn(
            'ml-auto flex h-[17px] min-w-[17px] items-center justify-center rounded-md text-micro font-semibold px-1 leading-none tabular-nums',
            active ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
          )}>
            {badge > 99 ? '99+' : badge}
          </span>
        )
      )}
    </NavLink>
  );
}

/* ─── Usage meter card (Attio-style bottom card) ────────────────── */
function UsageCard({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const { data: usage } = useQuery({
    queryKey: ['billing', 'usage'],
    queryFn: billingApi.usage,
    staleTime: 60_000,
  });

  if (collapsed || !usage || isUnlimited(usage.emailsLimit)) return null;

  const pct = usage.emailsLimit > 0 ? Math.min(100, (usage.emailsSent / usage.emailsLimit) * 100) : 0;
  const barColor = pct >= 90 ? 'var(--error)' : pct >= 75 ? 'var(--warning)' : 'var(--text-secondary)';
  const isFree = usage.plan === 'free';

  return (
    <div className="mx-3 mb-1 px-1.5 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-caption font-medium text-[var(--text-tertiary)]">Emails this month</span>
        <span className="text-caption font-semibold text-[var(--text-secondary)] tabular-nums">
          {usage.emailsSent.toLocaleString()}<span className="text-[var(--text-muted)] font-normal"> / {usage.emailsLimit.toLocaleString()}</span>
        </span>
      </div>
      <div className="mt-2 h-[3px] rounded-full bg-[var(--bg-active)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      {isFree && (
        <button
          onClick={() => navigate('/billing')}
          className="mt-2.5 w-full flex items-center justify-center gap-1 h-[26px] rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-caption font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)]"
        >
          Upgrade <ArrowUpRight className="h-3 w-3" strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

/* ─── Sidebar ───────────────────────────────────────────────────── */
export function Sidebar({ onShortcuts }: { onShortcuts?: () => void }) {
  const { user } = useAuth();
  const { collapsed: collapsedPref, narrow, drawerOpen, setDrawerOpen, toggle } = useSidebar();
  // The drawer on a phone is always the full sidebar.
  const collapsed = collapsedPref && !narrow;
  const { openPalette } = useCommandPalette();
  const location = useLocation();
  const workspaceName = user?.email?.split('@')[0] || 'Workspace';
  const unreadCount = useUnreadCount();
  const momentsCount = useMomentsCount();

  // On a narrow screen the drawer is a way to get somewhere; once there, it goes.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname, setDrawerOpen]);

  const here = locate(location.pathname);
  const inSettings = isSettingsPath(location.pathname);
  const isAdmin = !!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());

  return (
    <>
    {narrow && (
      <div
        aria-hidden
        onClick={() => setDrawerOpen(false)}
        style={{ top: HEADER_H }}
        className={cn(
          'fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px] transition-opacity duration-200',
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
    )}
    <aside
      className={cn(
        'fixed bottom-0 left-0 z-40 flex flex-col bg-[var(--bg-app)] transition-[width,transform,visibility] duration-200 ease-out',
        narrow ? 'w-[264px] border-r border-[var(--border-subtle)] shadow-[var(--shadow-xl)]' : collapsed ? 'w-[60px]' : 'w-[232px]',
        // Invisible as well as off-screen, so a closed drawer's links are out of the Tab order.
        narrow && !drawerOpen && 'invisible -translate-x-full shadow-none',
      )}
      style={{ top: narrow ? HEADER_H : 0 }}
    >
      {/* Brand, search and create - what the top bar used to hold, in the
          one column of chrome that is left. */}
      {!narrow && (
        <div className={cn('flex-shrink-0 pt-3', collapsed ? 'px-2.5' : 'px-3')}>
          <div className={cn('flex items-center h-8', collapsed ? 'justify-center' : 'justify-between pl-1.5')}>
            {collapsed ? (
              <button onClick={toggle} title="Expand sidebar" className="group relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-[var(--bg-hover)]">
                <SincerelyLogoMark className="h-6 w-6 group-hover:opacity-0 transition-opacity" />
                <PanelLeftOpen className="absolute h-4 w-4 text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ) : (
              <>
                <SincerelyLogo />
                <button onClick={toggle} title="Collapse sidebar" className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          <div className={cn('mt-4 flex gap-1.5', collapsed && 'flex-col items-center')}>
            <button
              type="button"
              onClick={openPalette}
              aria-label="Search or jump to"
              title={collapsed ? 'Search  ⌘K' : undefined}
              className={cn(
                'group flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-left shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--border-default)]',
                collapsed ? 'h-8 w-8 justify-center' : 'h-8 flex-1 min-w-0 px-2.5 gap-2',
              )}
            >
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-body text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]">Search</span>
                  <kbd className="kbd">⌘K</kbd>
                </>
              )}
            </button>
            <CreateMenu placement="right-start" trigger={(t, o) => <CreateButton toggle={t} open={o} />} />
          </div>
        </div>
      )}
      {/* Navigation */}
      <nav className={cn(
        'flex-1 py-4 overflow-y-auto overflow-x-hidden',
        collapsed ? 'px-2.5' : 'px-3'
      )}>
        <div className="space-y-0.5">
          {SECTIONS.map((sec) => (
            <NavRow
              key={sec.id}
              name={sec.name}
              href={sec.href}
              icon={sec.icon}
              active={here.section?.id === sec.id}
              collapsed={collapsed}
              badge={sec.id === 'inbox' ? unreadCount : sec.id === 'home' ? momentsCount : undefined}
              hint={sec.tabs.filter((t) => !t.hidden).map((t) => t.label).join(' · ')}
            />
          ))}
        </div>

        {/* Settings sits below a rule: it is where you set things up, not
            where the work happens. */}
        <div className={cn(collapsed ? 'mt-3 pt-3' : 'mt-4 pt-3', 'border-t border-[var(--border-subtle)] space-y-0.5')}>
          <NavRow name="Settings" href="/settings" icon={SETTINGS_ICON} active={inSettings} collapsed={collapsed} hint="Mailboxes, deliverability, data, connections, team and billing" />
          {isAdmin && (
            <NavRow name="Admin" href="/admin" icon={ShieldCheck} active={location.pathname.startsWith('/admin')} collapsed={collapsed} />
          )}
        </div>
      </nav>

      {/* The next setup step, carried onto every page. The checklist lives
          on the dashboard, which is where nobody is when they get stuck.
          Removes itself for good once setup is done. */}
      <SetupNudge collapsed={collapsed} />

      {/* Plan usage — quiet until it matters, loud when the cap nears */}
      <UsageCard collapsed={collapsed} />

      {/* You - and everything about the account, behind one click. */}
      <div className={cn('flex-shrink-0 p-2', collapsed ? 'px-2.5' : 'px-3 pb-3')}>
        <AccountMenu
          placement={collapsed ? 'right-end' : 'above-left'}
          onShortcuts={onShortcuts}
          trigger={(t, open) => (
            <button
              onClick={t}
              aria-expanded={open}
              title={collapsed ? workspaceName : undefined}
              className={cn(
                'w-full flex items-center rounded-md transition-colors hover:bg-[var(--bg-hover)]',
                open && 'bg-[var(--bg-hover)]',
                collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-2.5 px-1.5 h-11',
              )}
            >
              <span className="h-7 w-7 rounded-md flex items-center justify-center flex-shrink-0 bg-[var(--text-primary)] text-body font-semibold text-[var(--bg-surface)]">
                {workspaceName[0].toUpperCase()}
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1 min-w-0 text-left">
                    <span className="block text-body font-semibold text-[var(--text-primary)] truncate leading-tight capitalize">{workspaceName}</span>
                    <span className="block text-caption text-[var(--text-tertiary)] truncate leading-tight mt-0.5">{user?.email}</span>
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
                </>
              )}
            </button>
          )}
        />
      </div>
    </aside>
    </>
  );
}

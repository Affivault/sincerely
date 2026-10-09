import { useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LogOut, ArrowUpRight, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { SetupNudge } from '../setup/SetupNudge';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { useMomentsCount } from '../../hooks/useMomentsCount';
import { billingApi } from '../../api/billing.api';
import { isUnlimited, ADMIN_EMAILS } from '@lemlist/shared';
import { SECTIONS, SETTINGS_ICON, locate, isSettingsPath } from '../../lib/sections';

/* ─── Nav ────────────────────────────────────────────────────────────
   Six places and Settings - see lib/sections.ts for why, and for the one
   definition every surface reads. A place's own pages are tabs in the bar
   under the header, so the rail never grows and never needs opening. */

/* ─── Row styling (the Attio look) ──────────────────────────────────
   Inactive rows are quiet text on the gray rail. The ACTIVE row is a
   raised card: white surface, hairline border, soft shadow — the page
   you are on physically sits on top of the rail. */
const rowBase =
  'group relative flex items-center rounded-lg transition-all duration-100 select-none';
const rowInactive =
  'text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]';
const rowActive =
  'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] shadow-[0_1px_2px_rgba(16,16,20,0.05),0_0_0_0.5px_rgba(16,16,20,0.02)]';

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
        className={cn('h-[16px] w-[16px] flex-shrink-0 transition-colors', active ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]')}
        strokeWidth={1.75}
      />
      {!collapsed && (
        <span className="flex-1 truncate leading-none text-strong font-medium">{name}</span>
      )}
      {badge != null && badge > 0 && (
        collapsed ? (
          <span className="absolute -top-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--indigo)] text-white text-micro font-bold px-0.5 leading-none ring-2 ring-[var(--bg-app)]">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : (
          <span className={cn(
            'ml-auto flex h-[17px] min-w-[17px] items-center justify-center rounded-md text-micro font-semibold px-1 leading-none tabular-nums',
            active ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-[var(--bg-active)] text-[var(--text-secondary)]',
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
  const barColor = pct >= 90 ? '#EF4444' : pct >= 75 ? '#F59E0B' : 'var(--indigo)';
  const isFree = usage.plan === 'free';

  return (
    <div className="mx-2.5 mb-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 shadow-[0_1px_2px_rgba(16,16,20,0.04)]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-caption font-medium text-[var(--text-tertiary)]">Emails this month</span>
        <span className="text-caption font-semibold text-[var(--text-secondary)] tabular-nums">
          {usage.emailsSent.toLocaleString()}<span className="text-[var(--text-muted)] font-normal"> / {usage.emailsLimit.toLocaleString()}</span>
        </span>
      </div>
      <div className="mt-2 h-1 rounded-full bg-[var(--bg-active)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      {isFree && (
        <button
          onClick={() => navigate('/billing')}
          className="mt-2 w-full flex items-center justify-center gap-1 h-[26px] rounded-lg text-caption font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--indigo-grad)' }}
        >
          Upgrade <ArrowUpRight className="h-3 w-3" strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

/* ─── Sidebar ───────────────────────────────────────────────────── */
export function Sidebar() {
  const { user, signOut: logout } = useAuth();
  const { collapsed, narrow, drawerOpen, setDrawerOpen } = useSidebar();
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
        className={cn(
          'fixed inset-0 top-[56px] z-40 bg-black/30 backdrop-blur-[1px] transition-opacity duration-200',
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
    )}
    <aside
      className={cn(
        'fixed top-[56px] bottom-0 left-0 z-40 flex flex-col bg-[var(--bg-app)] border-r border-[var(--border-subtle)] transition-[width,transform,visibility] duration-200 ease-out',
        narrow ? 'w-[264px] shadow-[var(--shadow-xl)]' : collapsed ? 'w-[52px]' : 'w-[240px]',
        // Invisible as well as off-screen, so a closed drawer's links are out of the Tab order.
        narrow && !drawerOpen && 'invisible -translate-x-full shadow-none',
      )}
    >
      {/* Navigation */}
      <nav className={cn(
        'flex-1 py-3 overflow-y-auto overflow-x-hidden',
        collapsed ? 'px-2' : 'px-2.5'
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
              hint={sec.tabs.map((t) => t.label).join(' · ')}
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

      {/* User */}
      <div className={cn(
        'border-t border-[var(--border-subtle)] flex-shrink-0',
        collapsed ? 'p-2' : 'p-2'
      )}>
        <div className={cn(
          'flex items-center rounded-lg hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group',
          collapsed ? 'justify-center h-8 w-8 mx-auto' : 'gap-2.5 px-1.5 h-[42px]'
        )}>
          <div
            className="h-[26px] w-[26px] rounded-lg flex items-center justify-center flex-shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(67,56,202,0.3)]"
            style={{ background: 'var(--indigo-grad)' }}
            title={collapsed ? workspaceName : undefined}
          >
            <span className="text-caption font-bold text-white">{workspaceName[0].toUpperCase()}</span>
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-body font-semibold text-[var(--text-primary)] truncate leading-tight capitalize">{workspaceName}</div>
                <div className="text-micro text-[var(--text-tertiary)] truncate leading-tight mt-px">{user?.email}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); logout(); }}
                className="flex-shrink-0 p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-bg)] opacity-0 group-hover:opacity-100 transition-all duration-150"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
    </>
  );
}

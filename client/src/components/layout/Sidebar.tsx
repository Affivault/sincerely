import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Users, Megaphone, Inbox, BarChart3, Settings,
  FileText, Webhook, LogOut, CalendarClock, Layers,
  ChevronRight, Wrench, ArrowUpRight, Handshake, AtSign, Radar,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { billingApi } from '../../api/billing.api';
import { isUnlimited } from '@lemlist/shared';

/* ─── Nav shape ─────────────────────────────────────────────────── */
type NavLeaf = { kind?: 'leaf'; name: string; href: string; icon: React.ElementType; match?: string[] };
type NavGroup = { kind: 'group'; name: string; href: string; icon: React.ElementType; id: string; children: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;

const isGroup = (item: NavItem): item is NavGroup => (item as NavGroup).kind === 'group';

/* ─── Nav definitions ───────────────────────────────────────────── */
const workspaceNav: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Unibox',    href: '/inbox',     icon: Inbox },
  { name: 'CRM',       href: '/crm',       icon: Handshake, match: ['/crm'] },
];

const campaignsNav: NavItem[] = [
  {
    kind: 'group', id: 'campaigns',
    name: 'Campaigns', href: '/campaigns', icon: Megaphone,
    children: [
      { name: 'All campaigns',  href: '/campaigns',       icon: Layers },
      { name: 'Email accounts', href: '/email-accounts',  icon: AtSign },
      { name: 'Analytics',      href: '/analytics',       icon: BarChart3 },
      { name: 'Templates',      href: '/templates',       icon: FileText },
      { name: 'Schedules',      href: '/schedules',       icon: CalendarClock },
    ],
  },
];

const leadsNav: NavItem[] = [
  { name: 'Prospector', href: '/prospector', icon: Radar },
  { name: 'Lead Lists', href: '/contacts', icon: Users },
];

const toolsNav: NavItem[] = [
  { name: 'Webhooks', href: '/developer', icon: Webhook },
  { name: 'Toolkit',  href: '/toolkit',   icon: Wrench },
];

/* Every route that lives inside the settings workspace (SettingsShell owns
   the detail nav there — the app sidebar shows a single entry for all of it). */
const SETTINGS_ROUTES = ['/settings', '/team', '/billing', '/domains', '/suppression', '/verification'];

const settingsNav: NavItem[] = [
  { name: 'Settings', href: '/settings', icon: Settings, match: SETTINGS_ROUTES },
];

/* Routes that belong inside the Campaigns group */
const CAMPAIGN_ROUTES = ['/campaigns', '/email-accounts', '/analytics', '/templates', '/schedules'];

/* ─── Row styling (the Attio look) ──────────────────────────────────
   Inactive rows are quiet text on the gray rail. The ACTIVE row is a
   raised card: white surface, hairline border, soft shadow — the page
   you are on physically sits on top of the rail. */
const rowBase =
  'group relative flex items-center rounded-[7px] transition-all duration-100 select-none';
const rowInactive =
  'text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]';
const rowActive =
  'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] shadow-[0_1px_2px_rgba(16,16,20,0.05),0_0_0_0.5px_rgba(16,16,20,0.02)]';

function useIsActive(item: NavLeaf): boolean {
  const location = useLocation();
  return item.match
    ? item.match.some((r) => location.pathname === r || location.pathname.startsWith(r + '/'))
    : location.pathname === item.href || location.pathname.startsWith(item.href + '/');
}

/* ─── NavLeafItem ───────────────────────────────────────────────── */
function NavLeafItem({ item, collapsed, badge, nested }: {
  item: NavLeaf; collapsed: boolean; badge?: number; nested?: boolean;
}) {
  const isActive = useIsActive(item);
  const Icon = item.icon;

  return (
    <NavLink
      to={item.href}
      title={collapsed ? item.name : undefined}
      className={cn(
        rowBase,
        collapsed ? 'justify-center h-8 w-8 mx-auto' : nested ? 'h-[28px] gap-2 px-2' : 'h-[30px] gap-2.5 px-2',
        isActive ? rowActive : rowInactive,
      )}
    >
      {!nested && (
        <Icon
          className={cn('h-[15px] w-[15px] flex-shrink-0 transition-colors', isActive ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]')}
          strokeWidth={1.75}
        />
      )}

      {!collapsed && (
        <span className={cn(
          'flex-1 truncate leading-none',
          nested ? 'text-[12.5px] font-medium' : 'text-[13px] font-medium',
        )}>
          {item.name}
        </span>
      )}

      {badge != null && badge > 0 && (
        collapsed ? (
          <span className="absolute -top-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--indigo)] text-white text-[9px] font-bold px-0.5 leading-none ring-2 ring-[var(--bg-app)]">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : (
          <span className={cn(
            'ml-auto flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] text-[10px] font-semibold px-1 leading-none tabular-nums',
            isActive
              ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
              : 'bg-[var(--bg-active)] text-[var(--text-secondary)]',
          )}>
            {badge > 99 ? '99+' : badge}
          </span>
        )
      )}
    </NavLink>
  );
}

/* ─── NavGroupItem ──────────────────────────────────────────────── */
function NavGroupItem({ item, collapsed, expanded, onToggle }: {
  item: NavGroup; collapsed: boolean; expanded: boolean; onToggle: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isParentActive = CAMPAIGN_ROUTES.some((r) =>
    location.pathname === r || location.pathname.startsWith(r + '/')
  );
  const Icon = item.icon;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => (collapsed ? navigate(item.href) : onToggle())}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); collapsed ? navigate(item.href) : onToggle(); } }}
        title={collapsed ? item.name : undefined}
        className={cn(
          rowBase, 'cursor-pointer',
          collapsed ? 'justify-center h-8 w-8 mx-auto' : 'h-[30px] gap-2.5 px-2',
          /* The parent stays quiet — only real pages get the raised card.
             When a child route is active the parent brightens its text. */
          collapsed && isParentActive ? rowActive : rowInactive,
          !collapsed && isParentActive && 'text-[var(--text-primary)]',
        )}
      >
        <Icon
          className={cn('h-[15px] w-[15px] flex-shrink-0 transition-colors', isParentActive ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]')}
          strokeWidth={1.75}
        />

        {!collapsed && (
          <>
            <span className="flex-1 text-[13px] font-medium truncate leading-none">{item.name}</span>
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 flex-shrink-0 text-[var(--text-muted)] transition-transform duration-200',
                'opacity-0 group-hover:opacity-100',
                expanded && 'rotate-90 opacity-100',
              )}
              strokeWidth={2}
            />
          </>
        )}
      </div>

      {/* Children hang off a tree rail — Attio/Linear-style indentation. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          !collapsed && expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-0.5 ml-[15px] pl-[9px] border-l border-[var(--border-default)] space-y-px pb-0.5">
            {item.children.map((child) => (
              <NavLeafItem key={child.href} item={child} collapsed={false} nested />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── NavSection ────────────────────────────────────────────────── */
function NavSection({ title, items, collapsed, badges, expandedGroups, onToggleGroup }: {
  title?: string;
  items: NavItem[];
  collapsed: boolean;
  badges?: Record<string, number>;
  expandedGroups: Set<string>;
  onToggleGroup: (id: string) => void;
}) {
  return (
    <div>
      {title && !collapsed && (
        <div className="px-2 mt-5 mb-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{title}</span>
        </div>
      )}
      {title && collapsed && (
        <div className="my-3 mx-auto w-4 h-px bg-[var(--border-default)]" />
      )}
      <div className="space-y-px">
        {items.map((item) =>
          isGroup(item) ? (
            <NavGroupItem
              key={item.id}
              item={item}
              collapsed={collapsed}
              expanded={expandedGroups.has(item.id)}
              onToggle={() => onToggleGroup(item.id)}
            />
          ) : (
            <NavLeafItem
              key={item.href}
              item={item}
              collapsed={collapsed}
              badge={badges?.[item.href]}
            />
          )
        )}
      </div>
    </div>
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
    <div className="mx-2.5 mb-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 shadow-[0_1px_2px_rgba(16,16,20,0.04)]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--text-tertiary)]">Emails this month</span>
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] tabular-nums">
          {usage.emailsSent.toLocaleString()}<span className="text-[var(--text-muted)] font-normal"> / {usage.emailsLimit.toLocaleString()}</span>
        </span>
      </div>
      <div className="mt-2 h-1 rounded-full bg-[var(--bg-active)] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      {isFree && (
        <button
          onClick={() => navigate('/billing')}
          className="mt-2 w-full flex items-center justify-center gap-1 h-[26px] rounded-[7px] text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
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
  const { collapsed } = useSidebar();
  const location = useLocation();
  const workspaceName = user?.email?.split('@')[0] || 'Workspace';
  const unreadCount = useUnreadCount();

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('sidebar.expandedGroups');
      return new Set(saved ? JSON.parse(saved) : ['campaigns']);
    } catch {
      return new Set(['campaigns']);
    }
  });

  useEffect(() => {
    const inCampaigns = CAMPAIGN_ROUTES.some((r) =>
      location.pathname === r || location.pathname.startsWith(r + '/')
    );
    if (inCampaigns) {
      setExpandedGroups((prev) => {
        if (prev.has('campaigns')) return prev;
        const next = new Set(prev);
        next.add('campaigns');
        return next;
      });
    }
  }, [location.pathname]);

  const handleToggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('sidebar.expandedGroups', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const sectionProps = { collapsed, expandedGroups, onToggleGroup: handleToggleGroup };

  return (
    <aside
      className={cn(
        'fixed top-[56px] bottom-0 left-0 z-40 flex flex-col bg-[var(--bg-app)] border-r border-[var(--border-subtle)] transition-[width] duration-200 ease-out',
        collapsed ? 'w-[52px]' : 'w-[240px]'
      )}
    >
      {/* Navigation */}
      <nav className={cn(
        'flex-1 py-3 overflow-y-auto overflow-x-hidden',
        collapsed ? 'px-2' : 'px-2.5'
      )}>
        <NavSection items={workspaceNav} badges={{ '/inbox': unreadCount }} {...sectionProps} />
        <div className={cn(collapsed ? 'mt-1' : 'mt-4')}>
          <NavSection items={campaignsNav} {...sectionProps} />
        </div>
        <div className="mt-px">
          <NavSection items={leadsNav} {...sectionProps} />
        </div>
        <NavSection title="Tools" items={toolsNav} {...sectionProps} />
        <div className={cn(collapsed ? 'mt-1' : 'mt-4')}>
          <NavSection items={settingsNav} {...sectionProps} />
        </div>
      </nav>

      {/* Plan usage — quiet until it matters, loud when the cap nears */}
      <UsageCard collapsed={collapsed} />

      {/* User */}
      <div className={cn(
        'border-t border-[var(--border-subtle)] flex-shrink-0',
        collapsed ? 'p-2' : 'p-2'
      )}>
        <div className={cn(
          'flex items-center rounded-[9px] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group',
          collapsed ? 'justify-center h-8 w-8 mx-auto' : 'gap-2.5 px-1.5 h-[42px]'
        )}>
          <div
            className="h-[26px] w-[26px] rounded-[8px] flex items-center justify-center flex-shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(67,56,202,0.3)]"
            style={{ background: 'var(--indigo-grad)' }}
            title={collapsed ? workspaceName : undefined}
          >
            <span className="text-[11px] font-bold text-white">{workspaceName[0].toUpperCase()}</span>
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-[var(--text-primary)] truncate leading-tight capitalize">{workspaceName}</div>
                <div className="text-[10.5px] text-[var(--text-tertiary)] truncate leading-tight mt-px">{user?.email}</div>
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
  );
}

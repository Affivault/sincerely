import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Megaphone, Inbox, BarChart3, Settings,
  FileText, Webhook, Send, Globe, LogOut, PanelLeftClose,
  ShieldOff, ShieldCheck, UserPlus, CalendarClock, Layers,
  ChevronRight, Wrench,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { SkySendLogo, SkySendLogoMark } from '../SkySendLogo';
import { useUnreadCount } from '../../hooks/useUnreadCount';

/* ─── Nav shape ─────────────────────────────────────────────────── */
type NavLeaf = { kind?: 'leaf'; name: string; href: string; icon: React.ElementType };
type NavGroup = { kind: 'group'; name: string; href: string; icon: React.ElementType; id: string; children: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;

const isGroup = (item: NavItem): item is NavGroup => (item as NavGroup).kind === 'group';

/* ─── Nav definitions ───────────────────────────────────────────── */
const workspaceNav: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Unibox',    href: '/inbox',     icon: Inbox },
];

const campaignsNav: NavItem[] = [
  {
    kind: 'group', id: 'campaigns',
    name: 'Campaigns', href: '/campaigns', icon: Megaphone,
    children: [
      { name: 'All campaigns', href: '/campaigns',  icon: Layers },
      { name: 'Analytics',     href: '/analytics',  icon: BarChart3 },
      { name: 'Templates',     href: '/templates',  icon: FileText },
      { name: 'Schedules',     href: '/schedules',  icon: CalendarClock },
    ],
  },
];

const leadsNav: NavItem[] = [
  { name: 'Lead Lists', href: '/contacts', icon: Users },
];

const toolsNav: NavItem[] = [
  { name: 'Webhooks', href: '/developer', icon: Webhook },
  { name: 'Toolkit',  href: '/toolkit',   icon: Wrench },
];

const settingsNav: NavItem[] = [
  { name: 'SMTP',        href: '/smtp-accounts', icon: Send },
  { name: 'Domains',     href: '/domains',        icon: Globe },
  { name: 'Suppression', href: '/suppression',    icon: ShieldOff },
  { name: 'Team',        href: '/team',            icon: UserPlus },
  { name: 'Settings',   href: '/settings',        icon: Settings },
];

/* Routes that belong inside the Campaigns group */
const CAMPAIGN_ROUTES = ['/campaigns', '/analytics', '/templates', '/schedules'];

/* ─── NavLeafItem ───────────────────────────────────────────────── */
function NavLeafItem({ item, collapsed, badge, nested }: {
  item: NavLeaf; collapsed: boolean; badge?: number; nested?: boolean;
}) {
  const location = useLocation();
  const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
  const Icon = item.icon;

  return (
    <NavLink
      to={item.href}
      title={collapsed ? item.name : undefined}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-[6px] transition-colors duration-100',
        collapsed ? 'justify-center h-8 w-8 mx-auto' : nested ? 'h-[28px] pl-7 pr-2.5' : 'h-[30px] px-2.5',
        isActive
          ? 'bg-[rgba(99,102,241,0.1)] text-[#6366F1]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
      )}
    >
      {/* Active pill */}
      {isActive && !collapsed && !nested && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-[var(--indigo)]" />
      )}
      {nested && !collapsed && (
        <span className={cn('absolute left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full', isActive ? 'bg-[var(--indigo)]' : 'bg-[var(--border-default)]')} />
      )}

      {!nested && <Icon className="h-[15px] w-[15px] flex-shrink-0" strokeWidth={isActive ? 2 : 1.75} />}

      {!collapsed && (
        <span className={cn('flex-1 truncate', nested ? 'text-[12.5px]' : 'text-[13px] font-medium')}>{item.name}</span>
      )}

      {badge != null && badge > 0 && (
        collapsed ? (
          <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--indigo)] text-white text-[9px] font-bold px-0.5 leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : (
          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--indigo)] text-white text-[9px] font-bold px-1 leading-none">
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

  const handleClick = () => {
    if (collapsed) {
      navigate(item.href);
    } else {
      onToggle();
    }
  };

  return (
    <div>
      {/* Parent row */}
      <div
        onClick={handleClick}
        title={collapsed ? item.name : undefined}
        className={cn(
          'group relative flex items-center gap-2.5 rounded-[6px] transition-colors duration-100 cursor-pointer select-none',
          collapsed ? 'justify-center h-8 w-8 mx-auto' : 'h-[30px] px-2.5',
          isParentActive
            ? 'bg-[rgba(99,102,241,0.1)] text-[#6366F1]'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
        )}
      >
        {isParentActive && !collapsed && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-[var(--indigo)]" />
        )}

        <Icon className="h-[15px] w-[15px] flex-shrink-0" strokeWidth={isParentActive ? 2 : 1.75} />

        {!collapsed && (
          <>
            <span className="flex-1 text-[13px] font-medium truncate">{item.name}</span>
            <ChevronRight
              className={cn('h-3 w-3 flex-shrink-0 transition-transform duration-150 text-[var(--text-tertiary)]', expanded && 'rotate-90')}
            />
          </>
        )}
      </div>

      {/* Children */}
      {!collapsed && expanded && (
        <div className="mt-0.5 space-y-px">
          {item.children.map((child) => (
            <NavLeafItem key={child.href} item={child} collapsed={false} nested />
          ))}
        </div>
      )}
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
    <div className="mb-4">
      {title && !collapsed && (
        <div className="px-2.5 mb-1">
          <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-[0.08em]">{title}</span>
        </div>
      )}
      {title && collapsed && (
        <div className="mb-1.5 mx-auto w-5 h-px bg-[var(--border-subtle)]" />
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

/* ─── Sidebar ───────────────────────────────────────────────────── */
export function Sidebar() {
  const { user, signOut: logout } = useAuth();
  const { collapsed, toggle } = useSidebar();
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

  // Auto-expand campaigns group when on a campaigns-related route
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
      try { localStorage.setItem('sidebar.expandedGroups', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const sectionProps = { collapsed, expandedGroups, onToggleGroup: handleToggleGroup };

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex flex-col bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] transition-[width] duration-200 ease-out',
        collapsed ? 'w-[52px]' : 'w-[220px]'
      )}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center h-[48px] border-b border-[var(--border-subtle)] flex-shrink-0',
        collapsed ? 'justify-center px-2' : 'px-3 gap-2'
      )}>
        {collapsed ? (
          <button onClick={toggle} className="flex items-center justify-center" title="Expand sidebar">
            <SkySendLogoMark className="h-6 w-6 flex-shrink-0" />
          </button>
        ) : (
          <>
            <span className="flex-1 overflow-hidden"><SkySendLogo /></span>
            <button
              onClick={toggle}
              className="flex-shrink-0 p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className={cn('flex-1 py-2.5 overflow-y-auto overflow-x-hidden', collapsed ? 'px-1.5' : 'px-2')}>
        <NavSection items={workspaceNav}   badges={{ '/inbox': unreadCount }} {...sectionProps} />
        <NavSection items={campaignsNav}   {...sectionProps} />
        <NavSection items={leadsNav}       {...sectionProps} />
        <NavSection title="Tools"   items={toolsNav}    {...sectionProps} />
        <NavSection title="Config"  items={settingsNav} {...sectionProps} />
      </nav>

      {/* User section */}
      <div className={cn('border-t border-[var(--border-subtle)] flex-shrink-0', collapsed ? 'p-1.5' : 'p-2')}>
        <div className={cn(
          'flex items-center rounded-[6px] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group',
          collapsed ? 'justify-center h-8 w-8 mx-auto' : 'gap-2 px-2 h-9'
        )}>
          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-[9px] font-bold text-white">{workspaceName[0].toUpperCase()}</span>
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium text-[var(--text-primary)] truncate leading-tight">{workspaceName}</div>
                <div className="text-[10.5px] text-[var(--text-tertiary)] truncate leading-tight">{user?.email}</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); logout(); }}
                className="flex-shrink-0 p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--bg-elevated)] opacity-0 group-hover:opacity-100 transition-all duration-150"
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

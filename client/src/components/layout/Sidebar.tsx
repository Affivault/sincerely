import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Megaphone, Inbox, BarChart3, Settings,
  FileText, Webhook, Send, Globe, LogOut, PanelLeftClose,
  ShieldOff, UserPlus, CalendarClock, Layers,
  ChevronRight, Wrench, PanelLeftOpen,
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
  { name: 'Domains',     href: '/domains',       icon: Globe },
  { name: 'Suppression', href: '/suppression',   icon: ShieldOff },
  { name: 'Team',        href: '/team',          icon: UserPlus },
  { name: 'Settings',    href: '/settings',      icon: Settings },
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
        'group relative flex items-center gap-2.5 rounded-[8px] transition-colors duration-100',
        collapsed ? 'justify-center h-9 w-9 mx-auto' : nested ? 'h-[32px] pl-[34px] pr-2.5' : 'h-[34px] px-2.5',
        isActive
          ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
      )}
    >
      {isActive && !collapsed && !nested && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-r-full bg-[var(--indigo)]" />
      )}
      {nested && !collapsed && (
        <span className={cn(
          'absolute left-[18px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full transition-colors',
          isActive ? 'bg-[var(--indigo)]' : 'bg-[var(--border-strong)]'
        )} />
      )}

      {!nested && (
        <Icon className="h-[16px] w-[16px] flex-shrink-0" strokeWidth={isActive ? 2.1 : 1.85} />
      )}

      {!collapsed && (
        <span className={cn(
          'flex-1 truncate leading-none',
          nested ? 'text-[12.5px]' : 'text-[13px] font-medium'
        )}>
          {item.name}
        </span>
      )}

      {badge != null && badge > 0 && (
        collapsed ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--indigo)] text-white text-[9px] font-bold px-0.5 leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : (
          <span className={cn(
            'ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full text-[9.5px] font-bold px-1.5 leading-none',
            isActive ? 'bg-[var(--indigo)] text-white' : 'bg-[var(--bg-active)] text-[var(--text-secondary)]'
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

  const handleClick = () => {
    if (collapsed) navigate(item.href);
    else onToggle();
  };

  return (
    <div>
      <div
        onClick={handleClick}
        title={collapsed ? item.name : undefined}
        className={cn(
          'group relative flex items-center gap-2.5 rounded-[8px] transition-colors duration-100 cursor-pointer select-none',
          collapsed ? 'justify-center h-9 w-9 mx-auto' : 'h-[34px] px-2.5',
          isParentActive
            ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
        )}
      >
        {isParentActive && !collapsed && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-r-full bg-[var(--indigo)]" />
        )}

        <Icon className="h-[16px] w-[16px] flex-shrink-0" strokeWidth={isParentActive ? 2.1 : 1.85} />

        {!collapsed && (
          <>
            <span className="flex-1 text-[13px] font-medium truncate leading-none">{item.name}</span>
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 text-[var(--text-tertiary)]',
                expanded && 'rotate-90'
              )}
            />
          </>
        )}
      </div>

      {!collapsed && expanded && (
        <div className="mt-0.5 space-y-0.5">
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
    <div className="mb-0">
      {title && !collapsed && (
        <div className="px-2.5 mt-5 mb-1.5">
          <span className="font-data text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-[0.12em]">{title}</span>
        </div>
      )}
      {title && collapsed && (
        <div className="my-3 mx-auto w-4 h-px bg-[var(--border-default)]" />
      )}
      <div className="space-y-0.5">
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
        'fixed inset-y-0 left-0 z-40 flex flex-col bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] transition-[width] duration-200 ease-out',
        collapsed ? 'w-[60px]' : 'w-[244px]'
      )}
    >
      {/* Logo — always the brand, never a toggle */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-1.5 py-2.5 px-2 border-b border-[var(--border-subtle)] flex-shrink-0">
          <SkySendLogoMark className="h-6 w-6 flex-shrink-0" />
          <button
            onClick={toggle}
            title="Expand sidebar"
            className="flex items-center justify-center h-7 w-7 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center h-[56px] px-4 gap-2 border-b border-[var(--border-subtle)] flex-shrink-0">
          <span className="flex-1 overflow-hidden"><SkySendLogo /></span>
          <button
            onClick={toggle}
            title="Collapse sidebar"
            className="flex-shrink-0 p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className={cn(
        'flex-1 py-3 overflow-y-auto overflow-x-hidden',
        collapsed ? 'px-2' : 'px-2.5'
      )}>
        <NavSection items={workspaceNav}  badges={{ '/inbox': unreadCount }} {...sectionProps} />
        <div className="mt-3">
          <NavSection items={campaignsNav} {...sectionProps} />
        </div>
        <div className="mt-1">
          <NavSection items={leadsNav}    {...sectionProps} />
        </div>
        <NavSection title="Tools"  items={toolsNav}    {...sectionProps} />
        <NavSection title="Config" items={settingsNav} {...sectionProps} />
      </nav>

      {/* User */}
      <div className={cn(
        'border-t border-[var(--border-subtle)] flex-shrink-0',
        collapsed ? 'p-2' : 'p-2.5'
      )}>
        <div className={cn(
          'flex items-center rounded-[8px] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group',
          collapsed ? 'justify-center h-9 w-9 mx-auto' : 'gap-2.5 px-2 h-11'
        )}>
          <div className="h-7 w-7 rounded-lg bg-[var(--indigo)] flex items-center justify-center flex-shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
            <span className="text-[11px] font-bold text-white">{workspaceName[0].toUpperCase()}</span>
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-[var(--text-primary)] truncate leading-tight capitalize">{workspaceName}</div>
                <div className="text-[10.5px] text-[var(--text-tertiary)] truncate leading-tight">{user?.email}</div>
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

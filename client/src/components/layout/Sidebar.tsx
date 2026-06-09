import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Megaphone, Inbox, BarChart3, Settings,
  FileText, Webhook, Send, Globe, LogOut, PanelLeftClose,
  ShieldOff, UserPlus, CalendarClock, Layers,
  ChevronRight, Wrench,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { SkySendLogo, SkySendLogoMark } from '../SkySendLogo';
import { useUnreadCount } from '../../hooks/useUnreadCount';

/* ─── Nav shape ─────────────────────────────────────────────────── */
type Color = [from: string, to: string];
type NavLeaf = { kind?: 'leaf'; name: string; href: string; icon: React.ElementType; color: Color };
type NavGroup = { kind: 'group'; name: string; href: string; icon: React.ElementType; id: string; color: Color; children: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;

const isGroup = (item: NavItem): item is NavGroup => (item as NavGroup).kind === 'group';

/* Vivid per-section colour pairings */
const INDIGO: Color = ['#6366F1', '#8B5CF6'];
const VIOLET: Color = ['#8B5CF6', '#D946EF'];
const CYAN: Color = ['#06B6D4', '#3B82F6'];
const EMERALD: Color = ['#10B981', '#06B6D4'];
const AMBER: Color = ['#F59E0B', '#F43F5E'];
const BLUE: Color = ['#3B82F6', '#6366F1'];
const ROSE: Color = ['#F43F5E', '#EC4899'];

/* ─── Nav definitions ───────────────────────────────────────────── */
const workspaceNav: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, color: INDIGO },
  { name: 'Unibox',    href: '/inbox',     icon: Inbox,           color: CYAN },
];

const campaignsNav: NavItem[] = [
  {
    kind: 'group', id: 'campaigns',
    name: 'Campaigns', href: '/campaigns', icon: Megaphone, color: VIOLET,
    children: [
      { name: 'All campaigns', href: '/campaigns',  icon: Layers,        color: VIOLET },
      { name: 'Analytics',     href: '/analytics',  icon: BarChart3,     color: CYAN },
      { name: 'Templates',     href: '/templates',  icon: FileText,      color: AMBER },
      { name: 'Schedules',     href: '/schedules',  icon: CalendarClock, color: BLUE },
    ],
  },
];

const leadsNav: NavItem[] = [
  { name: 'Lead Lists', href: '/contacts', icon: Users, color: EMERALD },
];

const toolsNav: NavItem[] = [
  { name: 'Webhooks', href: '/developer', icon: Webhook, color: BLUE },
  { name: 'Toolkit',  href: '/toolkit',   icon: Wrench,  color: VIOLET },
];

const settingsNav: NavItem[] = [
  { name: 'SMTP',        href: '/smtp-accounts', icon: Send,     color: INDIGO },
  { name: 'Domains',     href: '/domains',       icon: Globe,    color: CYAN },
  { name: 'Suppression', href: '/suppression',   icon: ShieldOff, color: ROSE },
  { name: 'Team',        href: '/team',          icon: UserPlus, color: EMERALD },
  { name: 'Settings',    href: '/settings',      icon: Settings, color: VIOLET },
];

/* Routes that belong inside the Campaigns group */
const CAMPAIGN_ROUTES = ['/campaigns', '/analytics', '/templates', '/schedules'];

/* ─── Coloured icon tile ────────────────────────────────────────── */
function IconTile({ icon: Icon, color, active, size = 26 }: {
  icon: React.ElementType; color: Color; active: boolean; size?: number;
}) {
  const [from, to] = color;
  return (
    <span
      className="flex items-center justify-center rounded-[8px] flex-shrink-0 transition-all duration-150"
      style={
        active
          ? { width: size, height: size, backgroundImage: `linear-gradient(135deg, ${from}, ${to})`, boxShadow: `0 4px 10px -2px ${from}66, inset 0 1px 0 rgba(255,255,255,0.3)` }
          : { width: size, height: size, background: `${from}1A` }
      }
    >
      <Icon
        className="h-[14px] w-[14px]"
        strokeWidth={active ? 2.2 : 2}
        style={{ color: active ? '#fff' : from }}
      />
    </span>
  );
}

/* ─── NavLeafItem ───────────────────────────────────────────────── */
function NavLeafItem({ item, collapsed, badge, nested }: {
  item: NavLeaf; collapsed: boolean; badge?: number; nested?: boolean;
}) {
  const location = useLocation();
  const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
  const [from, to] = item.color;

  return (
    <NavLink
      to={item.href}
      title={collapsed ? item.name : undefined}
      className={cn(
        'group relative flex items-center rounded-[9px] transition-all duration-150',
        collapsed ? 'justify-center h-9 w-9 mx-auto' : nested ? 'h-[34px] gap-2.5 pl-3 pr-2.5' : 'h-[38px] gap-2.5 px-2',
        isActive ? 'font-semibold' : 'hover:bg-[var(--bg-hover)]'
      )}
      style={isActive && !collapsed ? { background: `${from}14` } : undefined}
    >
      {/* Gradient accent bar */}
      {isActive && !collapsed && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[20px] rounded-r-full"
          style={{ backgroundImage: `linear-gradient(to bottom, ${from}, ${to})` }}
        />
      )}

      {nested ? (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors"
          style={{ background: isActive ? from : 'var(--border-strong)' }}
        />
      ) : (
        <IconTile icon={item.icon} color={item.color} active={isActive} />
      )}

      {!collapsed && (
        <span
          className={cn('flex-1 truncate leading-none', nested ? 'text-[12.5px]' : 'text-[13px]')}
          style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        >
          {item.name}
        </span>
      )}

      {badge != null && badge > 0 && (
        collapsed ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full text-white text-[9px] font-bold px-0.5 leading-none shadow-[0_2px_6px_rgba(99,102,241,0.5)]" style={{ backgroundImage: 'linear-gradient(135deg,#06B6D4,#3B82F6)' }}>
            {badge > 99 ? '99+' : badge}
          </span>
        ) : (
          <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-full text-white text-[9.5px] font-bold px-1.5 leading-none shadow-[0_2px_6px_rgba(6,182,212,0.45)]" style={{ backgroundImage: 'linear-gradient(135deg,#06B6D4,#3B82F6)' }}>
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
  const [from, to] = item.color;

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
          'group relative flex items-center rounded-[9px] transition-all duration-150 cursor-pointer select-none',
          collapsed ? 'justify-center h-9 w-9 mx-auto' : 'h-[38px] gap-2.5 px-2',
          isParentActive ? 'font-semibold' : 'hover:bg-[var(--bg-hover)]'
        )}
        style={isParentActive && !collapsed ? { background: `${from}14` } : undefined}
      >
        {isParentActive && !collapsed && (
          <span
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[20px] rounded-r-full"
            style={{ backgroundImage: `linear-gradient(to bottom, ${from}, ${to})` }}
          />
        )}

        <IconTile icon={item.icon} color={item.color} active={isParentActive} />

        {!collapsed && (
          <>
            <span className="flex-1 text-[13px] truncate leading-none" style={{ color: isParentActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {item.name}
            </span>
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
        <div className="mt-1 ml-3 pl-2 border-l border-[var(--border-subtle)] space-y-0.5">
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
        <div className="px-2 mt-5 mb-1.5">
          <span className="text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.12em]">{title}</span>
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
      try { localStorage.setItem('sidebar.expandedGroups', JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const sectionProps = { collapsed, expandedGroups, onToggleGroup: handleToggleGroup };

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-[var(--border-subtle)] transition-[width] duration-200 ease-out',
        collapsed ? 'w-[60px]' : 'w-[244px]'
      )}
      style={{
        backgroundImage:
          'radial-gradient(420px 280px at 0% 0%, rgba(99,102,241,0.07), transparent 70%), linear-gradient(180deg, var(--bg-surface), var(--bg-surface))',
      }}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center h-[56px] border-b border-[var(--border-subtle)] flex-shrink-0',
        collapsed ? 'justify-center px-2' : 'px-4 gap-2'
      )}>
        {collapsed ? (
          <button
            onClick={toggle}
            className="flex items-center justify-center p-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
            title="Expand sidebar"
          >
            <SkySendLogoMark className="h-5 w-5 flex-shrink-0" />
          </button>
        ) : (
          <>
            <span className="flex-1 overflow-hidden"><SkySendLogo /></span>
            <button
              onClick={toggle}
              className="flex-shrink-0 p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

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
          'flex items-center rounded-[10px] transition-colors cursor-pointer group',
          collapsed ? 'justify-center h-10 w-10 mx-auto hover:bg-[var(--bg-hover)]' : 'gap-2.5 px-2 h-12 tint tint-indigo'
        )}>
          <div className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 shadow-[0_3px_8px_-1px_rgba(99,102,241,0.5),inset_0_1px_0_rgba(255,255,255,0.3)]" style={{ backgroundImage: 'linear-gradient(135deg,#6366F1,#8B5CF6)' }}>
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

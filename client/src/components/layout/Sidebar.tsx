import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Users, Megaphone, Inbox, BarChart3, Settings,
  FileText, Webhook, LogOut, CalendarClock, Layers, Blocks,
  ChevronRight, Wrench, ArrowUpRight, Handshake, AtSign, Radar, ShieldCheck, Sparkles,
  CalendarDays, ListTodo, Building2, Linkedin, Contact2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { billingApi } from '../../api/billing.api';
import { isUnlimited, ADMIN_EMAILS } from '@lemlist/shared';

/* ─── Nav shape ─────────────────────────────────────────────────── */
type NavLeaf = {
  kind?: 'leaf'; name: string; href: string; icon: React.ElementType; match?: string[];
  /** Match the path exactly, for a route that is the prefix of a sibling. */
  exact?: boolean;
};
type NavGroup = {
  kind: 'group'; name: string; href: string; icon: React.ElementType; id: string;
  children: NavLeaf[];
  /** Extra routes that belong to this group but aren't a child row. */
  match?: string[];
};
type NavItem = NavLeaf | NavGroup;

const isGroup = (item: NavItem): item is NavGroup => (item as NavGroup).kind === 'group';

/* ─── Nav definitions ───────────────────────────────────────────────
   Organised, not hidden.

   The old sidebar listed every page at one flat level, which made the rail a
   table of contents rather than a map: fourteen equal rows, no sense of what
   belonged with what. The fix is grouping — Templates and Schedules sit under
   Campaigns, Companies and Prospector beside Leads — but grouping earns
   its keep by giving structure, not by taking pages off the screen. So the
   groups start open: everything you had is still visible, just gathered under
   the thing it belongs to. Collapsing is a choice you make, not a default you
   have to undo. */

const primaryNav: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Unibox',    href: '/inbox',     icon: Inbox },
  {
    kind: 'group', id: 'campaigns',
    name: 'Campaigns', href: '/campaigns', icon: Megaphone,
    children: [
      { name: 'All campaigns',  href: '/campaigns',      icon: Layers },
      { name: 'Templates',      href: '/templates',      icon: FileText },
      { name: 'Schedules',      href: '/schedules',      icon: CalendarClock },
      { name: 'Email accounts', href: '/email-accounts', icon: AtSign },
      { name: 'Analytics',      href: '/analytics',      icon: BarChart3 },
    ],
  },
  /* Everything to do with people you are pitching.

     Lead lists, the companies behind them, and the tool that finds more. The
     inbox sits here too: a lead that arrives is still a lead, and putting it
     anywhere else would mean going to two places to do one job. */
  {
    kind: 'group', id: 'leads',
    name: 'Leads', href: '/leads', icon: Users,
    children: [
      { name: 'Lead lists',  href: '/leads',        icon: Users, exact: true },
      { name: 'Leads inbox', href: '/leads/inbox',  icon: Sparkles },
      { name: 'Companies',   href: '/companies',    icon: Building2 },
      { name: 'Prospector',  href: '/prospector',   icon: Radar },
    ],
  },
  /* The CRM, and its own destination rather than a child of Leads.

     Same screen, different half of the business: these are the people you
     have relationships with, and no campaign can reach them. Making it a row
     under Leads would say the opposite - that contacts are a kind of lead -
     which is the confusion this whole split exists to end. */
  { name: 'Contacts', href: '/contacts', icon: Contact2, match: ['/contacts'] },
  /* Deals stays its own destination — a pipeline is somewhere you go, not a
     page you find inside something else. */
  { name: 'Deals', href: '/deals', icon: Handshake, match: ['/deals', '/crm'] },
  {
    kind: 'group', id: 'calendar',
    name: 'Calendar', href: '/calendar', icon: CalendarDays,
    children: [
      { name: 'Calendar',   href: '/calendar', icon: CalendarDays },
      { name: 'Activities', href: '/tasks',    icon: ListTodo },
    ],
  },
];

/* Every route that lives inside the settings workspace (SettingsShell owns
   the detail nav there — the app sidebar shows a single entry for all of it). */
const SETTINGS_ROUTES = ['/settings', '/team', '/billing', '/domains', '/suppression', '/verification'];

/* Utility rows: needed occasionally, never the reason you opened the app. */
const utilityNav: NavItem[] = [
  {
    kind: 'group', id: 'tools',
    name: 'Tools', href: '/integrations', icon: Wrench,
    children: [
      { name: 'LinkedIn',     href: '/linkedin',     icon: Linkedin },
      { name: 'Integrations', href: '/integrations', icon: Blocks },
      { name: 'Webhooks',     href: '/developer',    icon: Webhook },
      { name: 'Toolkit',      href: '/toolkit',      icon: Wrench },
    ],
  },
  { name: 'Settings', href: '/settings', icon: Settings, match: SETTINGS_ROUTES },
];

/* Owner-only console — rendered only for the admin account; the server
   independently 404s everyone else, so this is purely cosmetic gating. */
const adminNav: NavItem[] = [
  { name: 'Admin', href: '/admin', icon: ShieldCheck },
];

const ALL_GROUPS: NavGroup[] = [...primaryNav, ...utilityNav].filter(isGroup);

/* Open on first run. Grouping is meant to organise the rail, not hide it —
   every page you work in stays on screen, indented under the thing it belongs
   to, and collapsing is yours to do rather than mine to assume. Tools stays
   shut because it isn't why anyone opens the app. */
const DEFAULT_EXPANDED = primaryNav.filter(isGroup).map((g) => g.id);

/* Versioned, and it has to be bumped whenever a group id changes.

   A saved list names the groups someone chose to keep open. Rename an id and
   that list no longer mentions it, so a group nobody has an opinion about
   renders shut — which is how a rename silently collapses a section for every
   existing user. v1 fell into it, v2 and v3 each moved this group's id again
   (leads → contacts → leads, as the split was worked out), and each move
   needs its own key or the fix does not reach anybody who has used the app. */
const EXPANDED_KEY = 'sidebar.expandedGroups.v4';

function routeMatches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(route + '/');
}

/** Every route a group owns: its children plus anything declared in `match`. */
function groupRoutes(group: NavGroup): string[] {
  return [...group.children.map((c) => c.href), ...(group.match || [])];
}

function isGroupActive(group: NavGroup, pathname: string): boolean {
  return groupRoutes(group).some((r) => routeMatches(pathname, r));
}

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
  const routes = item.match || [item.href];
  // Prefix matching is right for /contacts owning /contacts/:id, but wrong
  // for a route that is the prefix of a sibling — those opt into `exact`.
  return item.exact
    ? routes.includes(location.pathname)
    : routes.some((r) => routeMatches(location.pathname, r));
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
  const isParentActive = isGroupActive(item, location.pathname);
  const Icon = item.icon;

  /* With the children hidden the parent is the only thing on screen that can
     say where you are, so it takes the raised card. Expanded, it stays quiet
     and lets the active child carry it. */
  const showActiveCard = isParentActive && (collapsed || !expanded);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={collapsed ? undefined : expanded}
        onClick={() => (collapsed ? navigate(item.href) : onToggle())}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); collapsed ? navigate(item.href) : onToggle(); } }}
        title={collapsed ? item.name : undefined}
        className={cn(
          rowBase, 'cursor-pointer',
          collapsed ? 'justify-center h-8 w-8 mx-auto' : 'h-[30px] gap-2.5 px-2',
          showActiveCard ? rowActive : rowInactive,
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
                /* Always faintly there: the whole nav now depends on people
                   realising these rows open. */
                'h-3.5 w-3.5 flex-shrink-0 text-[var(--text-muted)] transition-transform duration-200',
                'opacity-50 group-hover:opacity-100',
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
      const saved = localStorage.getItem(EXPANDED_KEY);
      if (saved) return new Set<string>(JSON.parse(saved));
    } catch { /* fall through to the default */ }
    return new Set<string>(DEFAULT_EXPANDED);
  });

  // Navigating into a group's territory opens it, so the child you landed on
  // is visible and its siblings are one glance away. Runs on route change
  // only, so collapsing a group while sitting inside it stays collapsed.
  useEffect(() => {
    const active = ALL_GROUPS.find((g) => isGroupActive(g, location.pathname));
    if (!active) return;
    setExpandedGroups((prev) => {
      if (prev.has(active.id)) return prev;
      const next = new Set(prev);
      next.add(active.id);
      return next;
    });
  }, [location.pathname]);

  const handleToggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
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
        <NavSection items={primaryNav} badges={{ '/inbox': unreadCount }} {...sectionProps} />

        {/* The utility rows sit below a rule rather than under a heading —
            they're a footnote to the nav, not a sixth department. */}
        <div className={cn(
          collapsed ? 'mt-3 pt-3' : 'mt-4 pt-3',
          'border-t border-[var(--border-subtle)]',
        )}>
          <NavSection items={utilityNav} {...sectionProps} />
          {!!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase()) && (
            <div className="mt-px">
              <NavSection items={adminNav} {...sectionProps} />
            </div>
          )}
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

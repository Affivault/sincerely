import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  Settings, Users, CreditCard, AtSign, Globe, Clock,
  Ban, ShieldCheck, Code2, type LucideIcon,
} from 'lucide-react';

/**
 * Unified settings workspace — every admin surface (general, team, billing,
 * sending infra, data hygiene, developer) shares one shell with a persistent
 * grouped nav, so configuration feels like a single place instead of
 * scattered pages. Routes stay unchanged; pages opt in by wrapping.
 */
const GROUPS: { label: string; items: { to: string; label: string; icon: LucideIcon }[] }[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/settings', label: 'General', icon: Settings },
      { to: '/team', label: 'Team', icon: Users },
      { to: '/billing', label: 'Billing & usage', icon: CreditCard },
    ],
  },
  {
    label: 'Sending',
    items: [
      { to: '/smtp-accounts', label: 'Email accounts', icon: AtSign },
      { to: '/domains', label: 'Domains', icon: Globe },
      { to: '/schedules', label: 'Schedules', icon: Clock },
    ],
  },
  {
    label: 'Data',
    items: [
      { to: '/suppression', label: 'Suppression list', icon: Ban },
      { to: '/verification', label: 'Verification', icon: ShieldCheck },
    ],
  },
  {
    label: 'Developer',
    items: [
      { to: '/developer', label: 'API & webhooks', icon: Code2 },
    ],
  },
];

export function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-8 items-start">
      {/* Grouped settings nav — persistent across every admin page */}
      <aside className="hidden lg:block w-[216px] flex-shrink-0 sticky top-[72px]">
        <h2 className="px-2.5 mb-4 text-[17px] font-semibold text-[var(--text-primary)] tracking-[-0.015em]">Settings</h2>
        <nav className="space-y-5">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <p className="px-2.5 mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{g.label}</p>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) => cn(
                      'relative flex items-center gap-2.5 h-[30px] px-2.5 rounded-[7px] text-[12.5px] font-medium border transition-colors',
                      isActive
                        // Raised-card active state — same language as the app sidebar
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-subtle)] shadow-[0_1px_2px_rgba(27,27,31,0.05)]'
                        : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        <it.icon
                          className={cn('h-[15px] w-[15px] flex-shrink-0', isActive ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')}
                          strokeWidth={1.75}
                        />
                        <span className="truncate">{it.label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

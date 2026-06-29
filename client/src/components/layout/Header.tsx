import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LogOut,
  Search,
  Sun,
  Moon,
  Bell,
  Settings,
  User,
  ChevronDown,
  Command,
  Plus,
  Megaphone,
  Upload,
  FileText,
  CalendarClock,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useCommandPalette } from '../../context/CommandPaletteContext';
import { useSidebar } from '../../context/SidebarContext';
import { SincerelyLogo } from '../SincerelyLogo';
import { billingApi } from '../../api/billing.api';
import { isUnlimited } from '@lemlist/shared';
import { cn } from '../../lib/utils';

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export function Header() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { openPalette } = useCommandPalette();
  const { collapsed, toggle } = useSidebar();
  const { data: usage } = useQuery({ queryKey: ['billing', 'usage'], queryFn: billingApi.usage, staleTime: 60_000 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Close the header dropdowns on scroll, route change or Escape — not just click
  useEffect(() => {
    if (!createOpen && !menuOpen) return;
    const close = () => { setCreateOpen(false); setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [createOpen, menuOpen]);

  useEffect(() => { setCreateOpen(false); setMenuOpen(false); }, [location.pathname]);

  const createItems = [
    { label: 'New campaign', desc: 'Build an outbound sequence', icon: Megaphone, to: '/campaigns/new' },
    { label: 'Import contacts', desc: 'Upload a CSV of leads', icon: Upload, to: '/contacts/import' },
    { label: 'New template', desc: 'Reusable email content', icon: FileText, to: '/templates' },
    { label: 'New schedule', desc: 'Sending window preset', icon: CalendarClock, to: '/schedules' },
  ];

  return (
    <header className="fixed top-0 inset-x-0 z-50 flex h-[56px] items-center border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-xl gap-3 pr-6">
      {/* Logo zone — fixed, never collapses */}
      <div className="flex items-center gap-1 h-full pl-4 pr-3 flex-shrink-0">
        <span className="overflow-hidden"><SincerelyLogo /></span>
        <button
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex-shrink-0 p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Search — opens the command palette */}
      <button
        type="button"
        onClick={openPalette}
        className="group relative flex items-center h-7 w-64 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] transition-colors text-left"
      >
        <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)] ml-2.5 flex-shrink-0" />
        <span className="flex-1 px-2 text-[12.5px] text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors">
          Search or jump to…
        </span>
        <span className="flex items-center gap-0.5 mr-2 px-1 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-tertiary)] font-medium flex-shrink-0">
          <Command className="h-2.5 w-2.5" />
          <span>K</span>
        </span>
      </button>

      {/* Right controls */}
      <div className="flex items-center gap-1 ml-auto">
        {/* Global quick-create */}
        <div className="relative mr-1.5">
          <button
            onClick={() => setCreateOpen(!createOpen)}
            className="flex items-center gap-1 h-7 pl-2 pr-1.5 rounded-md bg-[var(--indigo)] text-white text-[12px] font-semibold hover:bg-[var(--indigo-hover)] transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(67,56,202,0.35)]"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            Create
            <ChevronDown className={cn('h-3 w-3 opacity-80 transition-transform duration-150', createOpen && 'rotate-180')} />
          </button>

          {createOpen && (
            <>
              <div className="fixed inset-0" onClick={() => setCreateOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-default)] p-1 shadow-[var(--shadow-xl)] animate-slide-in z-50">
                {createItems.map((item) => (
                  <button
                    key={item.to + item.label}
                    onClick={() => { setCreateOpen(false); navigate(item.to); }}
                    className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--indigo-subtle)] flex-shrink-0 mt-px">
                      <item.icon className="h-3.5 w-3.5 text-[var(--indigo)]" strokeWidth={2} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium text-[var(--text-primary)] leading-tight">{item.label}</span>
                      <span className="block text-[11px] text-[var(--text-tertiary)] leading-tight mt-0.5">{item.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Notifications */}
        <button className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <Bell className="h-[15px] w-[15px]" strokeWidth={1.9} />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--indigo)] ring-2 ring-[var(--bg-surface)]" />
        </button>

        {/* Theme */}
        <button
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
        >
          {theme === 'light' ? (
            <Moon className="h-[15px] w-[15px]" strokeWidth={1.9} />
          ) : (
            <Sun className="h-[15px] w-[15px]" strokeWidth={1.9} />
          )}
        </button>

        <div className="h-5 w-px bg-[var(--border-subtle)] mx-1.5" />

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-1.5 h-8 pl-1 pr-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
          >
            <div className="h-6 w-6 rounded-full bg-[var(--indigo)] flex items-center justify-center text-[10px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
              {user?.email?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <ChevronDown className={cn(
              'h-3 w-3 text-[var(--text-tertiary)] transition-transform duration-150',
              menuOpen && 'rotate-180'
            )} />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-default)] p-1 shadow-[var(--shadow-xl)] animate-slide-in z-50">
                {/* Account info */}
                <div className="px-2.5 py-2 mb-0.5 border-b border-[var(--border-subtle)]">
                  <p className="text-[12.5px] font-semibold text-[var(--text-primary)] truncate">
                    {user?.email?.split('@')[0]}
                  </p>
                  <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                    {user?.email}
                  </p>
                </div>

                {/* Plan & usage */}
                {usage && (
                  <div className="px-2.5 py-2 mb-0.5 border-b border-[var(--border-subtle)] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--text-tertiary)]">Plan</span>
                      <span className="text-[11.5px] font-semibold text-[var(--text-primary)]">{usage.planName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--text-tertiary)]">Emails this month</span>
                      <span className="text-[11.5px] text-[var(--text-secondary)] tabular-nums">
                        {usage.emailsSent.toLocaleString()} / {isUnlimited(usage.emailsLimit) ? '∞' : usage.emailsLimit.toLocaleString()}
                      </span>
                    </div>
                    {usage.status === 'past_due' || usage.status === 'canceled' ? (
                      <button
                        onClick={() => { setMenuOpen(false); navigate('/billing'); }}
                        className="w-full mt-0.5 h-7 rounded-md text-[11.5px] font-semibold text-white bg-[var(--error)]"
                      >
                        {usage.status === 'past_due' ? 'Payment failed — fix billing' : 'Subscription canceled — renew'}
                      </button>
                    ) : usage.status === 'trialing' && usage.trialEndsAt ? (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-[var(--text-tertiary)]">Trial ends</span>
                        <span className="text-[11.5px] text-[var(--text-secondary)]">in {daysUntil(usage.trialEndsAt)}d</span>
                      </div>
                    ) : usage.currentPeriodEnd ? (
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-[var(--text-tertiary)]">Next payment</span>
                        <span className="text-[11.5px] text-[var(--text-secondary)]">in {daysUntil(usage.currentPeriodEnd)}d</span>
                      </div>
                    ) : usage.plan === 'free' ? (
                      <button
                        onClick={() => { setMenuOpen(false); navigate('/billing'); }}
                        className="w-full mt-0.5 h-7 rounded-md text-[11.5px] font-semibold text-white"
                        style={{ background: 'linear-gradient(100deg,#4F86F7,#8B5CF6)' }}
                      >
                        Upgrade plan
                      </button>
                    ) : null}
                  </div>
                )}

                <button
                  onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </button>

                <button
                  onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <User className="h-3.5 w-3.5" />
                  Profile
                </button>

                <div className="border-t border-[var(--border-subtle)] mt-0.5 pt-0.5">
                  <button
                    onClick={() => { setMenuOpen(false); signOut(); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[12.5px] text-[var(--error)] hover:bg-[var(--error-bg)] transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

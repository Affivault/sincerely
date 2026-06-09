import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';

export function Header() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex h-[52px] items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-xl px-6 gap-4">
      {/* Search */}
      <div className="relative flex items-center h-7 w-64 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] hover:border-[var(--border-strong)] transition-colors focus-within:border-[var(--indigo)] focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]">
        <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)] ml-2.5 flex-shrink-0" />
        <input
          type="text"
          placeholder="Search…"
          className="w-full h-full bg-transparent px-2 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
        />
        <div className="flex items-center gap-0.5 mr-2 px-1 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[10px] text-[var(--text-tertiary)] font-medium flex-shrink-0">
          <Command className="h-2.5 w-2.5" />
          <span>K</span>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-0.5 ml-auto">
        {/* Notifications */}
        <button className="relative flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
          <Bell className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[var(--indigo)]" />
        </button>

        {/* Theme */}
        <button
          onClick={toggleTheme}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
        >
          {theme === 'light' ? (
            <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <Sun className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>

        <div className="h-4 w-px bg-[var(--border-subtle)] mx-1" />

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-1.5 h-7 pl-1 pr-1.5 rounded-md hover:bg-[var(--bg-hover)] transition-colors"
          >
            <div className="h-5 w-5 rounded-full bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] flex items-center justify-center text-[9px] font-bold text-white">
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
              <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1 shadow-[var(--shadow-xl)] animate-slide-in z-50">
                {/* Account info */}
                <div className="px-2.5 py-2 mb-0.5 border-b border-[var(--border-subtle)]">
                  <p className="text-[12.5px] font-semibold text-[var(--text-primary)] truncate">
                    {user?.email?.split('@')[0]}
                  </p>
                  <p className="text-[11px] text-[var(--text-tertiary)] truncate">
                    {user?.email}
                  </p>
                </div>

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

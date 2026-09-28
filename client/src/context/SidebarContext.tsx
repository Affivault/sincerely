import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

interface SidebarContextType {
  /** The desktop rail's choice: icons only. Ignored on a narrow screen. */
  collapsed: boolean;
  toggle: () => void;
  /**
   * True below the width where a fixed 240px rail leaves room to work.
   *
   * The sidebar used to be fixed at every width, so on a phone it took
   * 240 of 390 pixels and every page was squeezed into the strip left over.
   * Below this it becomes a drawer: out of the way until asked for.
   */
  narrow: boolean;
  /** The drawer, on a narrow screen. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  toggle: () => {},
  narrow: false,
  drawerOpen: false,
  setDrawerOpen: () => {},
});

/** Tailwind's `lg`. Keep in step with the `lg:` classes in AppLayout, Header and Sidebar. */
const NARROW_QUERY = '(max-width: 1023.98px)';

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  // Collapse state survives reloads — a rail user stays a rail user.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar.collapsed') === '1'; } catch { return false; }
  });
  const narrow = useNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Widening past the breakpoint leaves no drawer to be open.
  useEffect(() => { if (!narrow) setDrawerOpen(false); }, [narrow]);

  const toggle = useCallback(() => {
    if (narrow) { setDrawerOpen((o) => !o); return; }
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem('sidebar.collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, [narrow]);

  // `[` toggles the sidebar (Attio/Linear convention); Escape closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drawerOpen) { setDrawerOpen(false); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === '[') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, drawerOpen]);

  return (
    <SidebarContext.Provider value={{ collapsed: narrow ? false : collapsed, toggle, narrow, drawerOpen, setDrawerOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}

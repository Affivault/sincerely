/* ═══════════════════════════════════════════════════════════════════════
   Six places.

   The app had grown to about thirty sidebar entries across some sixty
   pages. Replies could be worked in four places, people lived in three,
   mailbox setup sat under Campaigns and analytics was split three ways.
   Nothing was missing - it was that everything was on the surface at once.

   Now there are six places, each a job:

     Home        what needs you, and how it is going
     Inbox       every reply, in one place
     Campaigns   what you send
     People      who you send it to
     Pipeline    everything after someone says yes
     Insights    what is working

   and Settings, which holds everything you set up once: mailboxes,
   deliverability, data hygiene, connections.

   Every URL is unchanged. A place's pages appear as tabs in the bar under
   the header, so the sidebar stays six rows and nothing is more than one
   click from where it was. This file is the single source for the sidebar,
   that bar, the settings menu, the command palette and page titles, so
   they cannot drift apart.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  Home, Inbox, Megaphone, Users, Handshake, BarChart3, Settings as SettingsIcon,
  Waves, LayoutDashboard, MessageSquare, Sparkles, Layers, FileText, CalendarClock,
  Contact2, Building2, Radar, CalendarDays, ListTodo, Link2, Clock, Banknote, Crosshair, Trophy,
  LineChart, Users as TeamIcon, CreditCard, AtSign, Activity, Target, Ban, ShieldCheck,
  Blocks, Linkedin, Code2, Wrench, BookOpen, HeartPulse, Zap, type LucideIcon,
} from 'lucide-react';

export interface SectionTab {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Only this exact path, for a route that prefixes a sibling (/analytics). */
  exact?: boolean;
  /** Further routes this tab owns (detail pages, aliases). */
  match?: string[];
  /** Words the command palette should find it by. */
  keywords?: string;
}

export interface Section {
  id: 'home' | 'inbox' | 'campaigns' | 'people' | 'pipeline' | 'insights';
  name: string;
  /** Where the sidebar row goes. */
  href: string;
  icon: LucideIcon;
  /** Two-stroke shortcut: g then this key. */
  goKey: string;
  tabs: SectionTab[];
}

export const SECTIONS: Section[] = [
  {
    id: 'home', name: 'Home', href: '/dashboard', icon: Home, goKey: 'h',
    tabs: [
      { label: 'Overview', href: '/dashboard', icon: LayoutDashboard, match: ['/start'], keywords: 'dashboard home performance stats numbers get started setup onboarding' },
      { label: 'Moments', href: '/moments', icon: Zap, keywords: 'signals timing who to email today why now intent hiring re-engaged not now website changes' },
      { label: 'Flow', href: '/flow', icon: Waves, keywords: 'today queue next focus work decide todo priorities' },
    ],
  },
  {
    id: 'inbox', name: 'Inbox', href: '/inbox', icon: Inbox, goKey: 'i',
    tabs: [
      { label: 'Unibox', href: '/inbox', icon: Inbox, match: ['/sara'], keywords: 'messages replies email mail other newsletters' },
      { label: 'Reply queue', href: '/replies', icon: MessageSquare, keywords: 'waiting owed overdue assigned sla' },
      { label: 'Leads inbox', href: '/leads/inbox', icon: Sparkles, keywords: 'new leads interested triaged' },
    ],
  },
  {
    id: 'campaigns', name: 'Campaigns', href: '/campaigns', icon: Megaphone, goKey: 'c',
    tabs: [
      { label: 'Campaigns', href: '/campaigns', icon: Layers, keywords: 'sequences outreach' },
      { label: 'Templates', href: '/templates', icon: FileText, match: ['/assets'], keywords: 'emails snippets' },
      { label: 'Schedules', href: '/schedules', icon: CalendarClock, keywords: 'sending times windows' },
    ],
  },
  {
    id: 'people', name: 'People', href: '/contacts', icon: Users, goKey: 'o',
    tabs: [
      { label: 'Contacts', href: '/contacts', icon: Contact2, keywords: 'contacts crm customers relationships' },
      { label: 'Leads', href: '/leads', icon: Users, exact: true, keywords: 'lead lists prospects audience cold' },
      { label: 'Companies', href: '/companies', icon: Building2, keywords: 'accounts organisations organizations firms' },
      { label: 'Prospector', href: '/prospector', icon: Radar, keywords: 'find leads search database discover' },
    ],
  },
  {
    id: 'pipeline', name: 'Pipeline', href: '/deals', icon: Handshake, goKey: 'p',
    tabs: [
      { label: 'Deals', href: '/deals', icon: Handshake, match: ['/crm'], keywords: 'pipeline crm opportunities' },
      { label: 'Calendar', href: '/calendar', icon: CalendarDays, exact: true, keywords: 'meetings schedule diary' },
      { label: 'Activities', href: '/tasks', icon: ListTodo, keywords: 'tasks todo follow-ups calls' },
      { label: 'Booking links', href: '/calendar/links', icon: Link2, keywords: 'booking page calendly scheduling link' },
      { label: 'Availability', href: '/calendar/availability', icon: Clock, keywords: 'hours working times' },
    ],
  },
  {
    id: 'insights', name: 'Insights', href: '/analytics', icon: BarChart3, goKey: 'a',
    tabs: [
      { label: 'Analytics', href: '/analytics', icon: BarChart3, exact: true, keywords: 'stats reports metrics' },
      { label: 'Results', href: '/analytics/results', icon: Trophy, keywords: 'results report roi meetings pipeline share month' },
      { label: 'Revenue', href: '/analytics/revenue', icon: Banknote, keywords: 'money attribution earned' },
      { label: 'What closes', href: '/analytics/segments', icon: Crosshair, keywords: 'segments who buys icp' },
      { label: 'Win / loss', href: '/deals/insights', icon: LineChart, keywords: 'win rate lost reasons velocity' },
    ],
  },
];

/** Settings: everything you set up once. */
export const SETTINGS_GROUPS: { label: string; items: SectionTab[] }[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'General', href: '/settings', icon: SettingsIcon, keywords: 'preferences account profile ai relay' },
      { label: 'Team', href: '/team', icon: TeamIcon, keywords: 'members invite seats' },
      { label: 'Billing & usage', href: '/billing', icon: CreditCard, keywords: 'plan invoices upgrade' },
      { label: 'System status', href: '/system', icon: HeartPulse, keywords: 'status health running jobs outage stuck alerts' },
    ],
  },
  {
    label: 'Sending',
    items: [
      { label: 'Email accounts', href: '/email-accounts', icon: AtSign, match: ['/smtp-accounts', '/domains'], keywords: 'mailbox sender smtp domains dns spf dkim' },
      { label: 'Sender health', href: '/sse', icon: Activity, keywords: 'reputation deliverability warm up health' },
      { label: 'Inbox placement', href: '/placement', icon: Target, keywords: 'inbox spam placement seed test' },
    ],
  },
  {
    label: 'Data',
    items: [
      { label: 'Suppression list', href: '/suppression', icon: Ban, keywords: 'blocklist unsubscribe do not email' },
      { label: 'Verification', href: '/verification', icon: ShieldCheck, keywords: 'validate dcs score bounce' },
    ],
  },
  {
    label: 'Connections',
    items: [
      { label: 'Integrations', href: '/integrations', icon: Blocks, keywords: 'slack discord zapier make hubspot pipedrive apps' },
      { label: 'LinkedIn', href: '/linkedin', icon: Linkedin, keywords: 'connect invite social extension agent' },
      { label: 'API & webhooks', href: '/developer', icon: Code2, keywords: 'api developer events keys' },
      { label: 'Toolkit', href: '/toolkit', icon: Wrench, keywords: 'tools utilities' },
    ],
  },
];

export const SETTINGS_ICON = SettingsIcon;
export const GUIDE_ICON = BookOpen;

export const SETTINGS_TABS: SectionTab[] = SETTINGS_GROUPS.flatMap((g) => g.items);

function routeMatches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(route + '/');
}

/**
 * How strongly a tab claims a path: the length of the longest route it owns
 * that matches, or -1. Longest wins, so /deals/insights belongs to Insights
 * even though Pipeline owns /deals.
 */
function claim(tab: SectionTab, pathname: string): number {
  let best = -1;
  if (tab.exact ? pathname === tab.href : routeMatches(pathname, tab.href)) best = tab.href.length;
  for (const m of tab.match || []) if (routeMatches(pathname, m)) best = Math.max(best, m.length);
  return best;
}

/** The place and tab a path belongs to, or nulls outside them (settings, admin). */
export function locate(pathname: string): { section: Section | null; tab: SectionTab | null; settings: SectionTab | null } {
  let bestSection: Section | null = null;
  let bestTab: SectionTab | null = null;
  let bestScore = -1;
  for (const s of SECTIONS) {
    for (const t of s.tabs) {
      const c = claim(t, pathname);
      if (c > bestScore) { bestScore = c; bestSection = s; bestTab = t; }
    }
  }
  let settings: SectionTab | null = null;
  let settingsScore = -1;
  for (const t of SETTINGS_TABS) {
    const c = claim(t, pathname);
    if (c > settingsScore) { settingsScore = c; settings = t; }
  }
  // A settings page outranks a section only when it claims more of the path.
  if (settings && settingsScore >= bestScore) return { section: null, tab: null, settings };
  return { section: bestScore >= 0 ? bestSection : null, tab: bestScore >= 0 ? bestTab : null, settings: null };
}

/** Whether a path is one of the settings pages (framed by the settings menu). */
export function isSettingsPath(pathname: string): boolean {
  return !!locate(pathname).settings || pathname === '/smtp-accounts/guide';
}

/** The browser tab title for a path. */
export function pageTitle(pathname: string): string | null {
  const { tab, settings } = locate(pathname);
  if (settings) return settings.label;
  if (tab) return tab.label;
  if (pathname.startsWith('/admin')) return 'Admin';
  return null;
}

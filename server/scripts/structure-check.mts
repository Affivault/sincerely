/* ═══════════════════════════════════════════════════════════════════════
   Six places, one design language - kept that way.

   Checks that every page in the app belongs to one of the six places (or
   Settings), that the sidebar, section bar, settings menu and command
   palette all read one definition, and that the design rules the pass
   applied - one page header, one icon chip, sentence case - hold.

   Run: npx tsx scripts/structure-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const client = join(here, '../../client/src');
const read = (p: string) => readFileSync(join(client, p), 'utf8');

const sections = read('lib/sections.ts');
const app = read('App.tsx');
const layout = read('components/layout/AppLayout.tsx');
const sidebar = read('components/layout/Sidebar.tsx');

console.log('\nsix places');
{
  const ids = [...sections.matchAll(/id: '(home|inbox|campaigns|people|pipeline|insights)', name: '([^']+)'/g)].map((m) => m[2]);
  is('exactly six places', ids.length === 6, ids.join(', '));
  is('named Home, Inbox, Campaigns, People, Pipeline, Insights', ids.join(',') === 'Home,Inbox,Campaigns,People,Pipeline,Insights');
  is('the sidebar renders the places, not a hand-kept list', /SECTIONS\.map\(\(sec\) => \(\s*<NavRow/.test(sidebar) && !/primaryNav/.test(sidebar));
  is('the command palette lists pages from the same definition', /SECTIONS\.flatMap/.test(read('components/CommandPalette.tsx')));
  is('the settings menu comes from the same definition', /SETTINGS_GROUPS/.test(read('components/shared/SettingsShell.tsx')));
  is('page titles come from the same definition', /pageTitle\(location\.pathname\)/.test(layout));
  is('g then a place\'s letter goes there', /SECTIONS\.map\(\(s\) => \[s\.goKey, s\.href\]\)/.test(layout));

  // Every in-app route belongs somewhere.
  const owned = [...sections.matchAll(/href: '([^']+)'/g)].map((m) => m[1])
    .concat([...sections.matchAll(/match: \[([^\]]+)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])));
  const shell = app.slice(app.indexOf('<AppLayout'), app.lastIndexOf('</Route>'));
  const paths = [...shell.matchAll(/<Route path="([^"]+)"\s+element=\{<([A-Za-z]+)/g)]
    .filter((m) => m[2] !== 'Navigate')
    .map((m) => m[1])
    .filter((p) => !['/admin'].includes(p));
  const orphan = paths.filter((p) => {
    const concrete = p.replace(/:\w+/g, 'x');
    return !owned.some((o) => concrete === o || concrete.startsWith(o + '/')) && concrete !== '/smtp-accounts/guide';
  });
  is('every page belongs to a place or to Settings', orphan.length === 0, orphan.join(', '));
  is('old addresses still work: the places have their own names too', ['/home', '/people', '/pipeline', '/insights'].every((p) => app.includes(`path="${p}"`)));
}

console.log('\none frame per kind of page');
{
  is('every settings page gets the settings menu from the layout', /inSettings \? <SettingsShell><Outlet \/><\/SettingsShell> : <Outlet \/>/.test(layout));
  const wrapped: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.tsx') && /<SettingsShell>/.test(readFileSync(p, 'utf8'))) wrapped.push(p.replace(client, ''));
    }
  };
  walk(join(client, 'pages'));
  is('and no page wraps it again', wrapped.length === 0, wrapped.join(', '));
  is('headers sit in the settings column instead of under its menu', /InsetHeaderContext\.Provider value=\{true\}/.test(read('components/shared/SettingsShell.tsx')));
  is('full-height screens leave room for the section bar', /calc\(100vh - var\(--chrome-h, 56px\)\)/.test(read('pages/inbox/InboxPage.tsx'))
    && /calc\(100vh - var\(--chrome-h, 56px\)\)/.test(read('pages/campaigns/CampaignCreatePage.tsx')));
}

console.log('\none design language');
{
  is('the page header draws the one icon chip', /export function PageIcon/.test(read('components/shared/PageHeader.tsx')));
  const pages: Array<{ path: string; src: string }> = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.tsx')) pages.push({ path: p.replace(client, ''), src: readFileSync(p, 'utf8') });
    }
  };
  walk(join(client, 'pages'));
  walk(join(client, 'components'));
  const app_ = pages.filter((p) => !/Landing|landing|\/legal\/|\/auth\/|\/public\/|AuthShell|\/admin\/|\/assets\/|\/sara\//.test(p.path));

  const ownChips = app_.filter((p) => /leading=\{\s*<span className="flex h-9 w-9/.test(p.src));
  is('no page draws its own header icon chip', ownChips.length === 0, ownChips.map((p) => p.path).join(', '));

  // Record pages (a campaign, a deal) carry their own record header; lists and tools use PageHeader.
  const oldHeaders = app_.filter((p) => !/DetailPage|InviteAccept/.test(p.path) && /<h1 className="text-title font-semibold[^"]*">/.test(p.src));
  is('no page uses the old small title in place of the page header', oldHeaders.length === 0, oldHeaders.map((p) => p.path).join(', '));

  const titleCase = app_.flatMap((p) => [...p.src.matchAll(/>\s*([A-Z][a-z]+ [A-Z][a-z]+(?: [A-Z][a-z]+)*)\s*</g)]
    .map((m) => `${p.path}: ${m[1]}`))
    .filter((s) => !/Sarah Rodriguez|Google Workspace|Microsoft Teams|Amazon SES|Zoho Mail|Custom SMTP/.test(s));
  is('headings and labels are sentence case', titleCase.length === 0, titleCase.join(' | '));

  is('one chip for every "choose one of these"', /export function Chip/.test(read('components/ui/Chip.tsx'))
    && /<Chip/.test(read('pages/smtp/SmtpGuidePage.tsx')));
  is('a page loads as its own shape, not a lone spinner', /export function PageSkeleton/.test(read('components/ui/Skeleton.tsx'))
    && ['pages/campaigns/CampaignDetailPage.tsx', 'pages/contacts/ContactDetailPage.tsx', 'pages/crm/DealDetailPage.tsx', 'pages/companies/CompanyDetailPage.tsx']
      .every((p) => /<PageSkeleton/.test(read(p))));
  is('the tabs beside this page are fetched before they are clicked', /prefetchHref\(tab\.href\)/.test(read('components/layout/SectionBar.tsx')));
}

console.log('\nnames that agree');
{
  const tabLabel = (href: string) => new RegExp(`label: '([^']+)', href: '${href.replace(/\//g, '\\/')}'`).exec(sections)?.[1];
  const title = (p: string) => /<PageHeader[\s\S]*?\n\s+title="([^"]+)"/.exec(read(p))?.[1];
  const pairs: Array<[string, string]> = [
    ['/replies', 'pages/replies/RepliesPage.tsx'],
    ['/leads/inbox', 'pages/leads/LeadsPage.tsx'],
    ['/deals/insights', 'pages/crm/DealInsightsPage.tsx'],
    ['/developer', 'pages/developer/DeveloperPage.tsx'],
    ['/placement', 'pages/placement/PlacementPage.tsx'],
    ['/calendar/availability', 'pages/crm/AvailabilityPage.tsx'],
    ['/schedules', 'pages/schedules/SchedulesPage.tsx'],
    ['/analytics/segments', 'pages/analytics/SegmentsPage.tsx'],
  ];
  const mismatched = pairs.filter(([href, p]) => tabLabel(href) !== title(p)).map(([href, p]) => `${href}: tab "${tabLabel(href)}", page "${title(p)}"`);
  is('a page is called what its tab is called', mismatched.length === 0, mismatched.join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} structure check(s) failed`);

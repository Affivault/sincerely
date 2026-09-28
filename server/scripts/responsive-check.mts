/* ═══════════════════════════════════════════════════════════════════════
   The app on a phone, and the small things that make it feel put together.

   Walked through with the whole app running against a fake backend, at
   1440, 820 and 390 pixels wide. What that found:

   - Below a laptop the 240px sidebar stayed fixed, so on a phone every page
     was squeezed into the 150px strip beside it.
   - The page header's full-bleed margins (-mx-6) did not match the page's
     padding (px-8): on desktop every header floated 8px in from the edges,
     on a phone it hung off the side.
   - One reply was "Not now" on the dashboard and "Not Interested" in the
     Unibox; a request for a call read "Meeting Booked".
   - A throw inside Cmd+K blanked the entire app.
   - A 30-minute meeting showed half its time line.

   Run: npx tsx scripts/responsive-check.mts
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
const { REPLY_INTENT_LABELS, replyIntentLabel } = await import('@lemlist/shared');

console.log('\nthe sidebar steps aside on a narrow screen');
{
  const ctx = read('context/SidebarContext.tsx');
  const bar = read('components/layout/Sidebar.tsx');
  const layout = read('components/layout/AppLayout.tsx');
  const header = read('components/layout/Header.tsx');
  is('narrow is the lg breakpoint', /max-width: 1023\.98px/.test(ctx));
  is('the sidebar becomes a drawer, hidden until opened', /narrow && !drawerOpen && 'invisible -translate-x-full/.test(bar));
  is('and closes itself after a navigation', /setDrawerOpen\(false\); \}, \[location\.pathname/.test(bar));
  is('the page takes the full width', /narrow \? 'pl-0'/.test(layout));
  is('the header has a menu button', /aria-label=\{drawerOpen \? 'Close menu' : 'Open menu'\}/.test(header));
}

console.log('\nthe page header meets the edges at every width');
{
  const layout = read('components/layout/AppLayout.tsx');
  const ph = read('components/shared/PageHeader.tsx');
  const pad = layout.match(/'(px-4 py-5 sm:px-6 lg:px-8 lg:py-7)/);
  is('the page padding is what the header expects', !!pad);
  is('the header cancels it exactly', /-mx-4 -mt-5 sm:-mx-6 lg:-mx-8 lg:-mt-7/.test(ph));
  is('its actions wrap instead of pushing off the side', /flex flex-wrap items-center gap-2">\{actions\}/.test(ph));
}

console.log('\na reply is called the same thing everywhere');
{
  is('asking for a call is not a booked meeting', REPLY_INTENT_LABELS.meeting.label === 'Wants a meeting');
  is('not now is not "not interested"', REPLY_INTENT_LABELS.not_now.label === 'Not now');
  is('an unknown intent is just a reply', replyIntentLabel(null) === 'Reply' && replyIntentLabel('nonsense') === 'Reply');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && /label: '(Meeting Booked|Not Interested|Not Now|Wants to book)'/.test(readFileSync(p, 'utf8'))) offenders.push(p.replace(client, ''));
    }
  };
  walk(client);
  is('no screen writes its own intent labels', offenders.length === 0, offenders.join(', '));
}

console.log('\na broken overlay closes; the app stays');
{
  const ov = read('components/layout/Overlays.tsx');
  is('the palette, peek and shortcuts each have a boundary', (ov.match(/<OverlayBoundary name=/g) || []).length === 3);
  const pal = read('components/CommandPalette.tsx');
  is('search without hits is no results, not a crash', /Array\.isArray\(r\?\.hits\) \? r\.hits : \[\]/.test(pal));
}

console.log('\nsmall things');
{
  const css = read('index.css');
  is('scrollbar-none exists (it was used, never defined)', /\.scrollbar-none \{/.test(css));
  const grid = read('components/calendar/TimeGrid.tsx');
  is('a half-hour meeting is one line, time first', /const oneLine = mins < 45/.test(grid));
  const camp = read('pages/campaigns/CampaignsListPage.tsx');
  const cols = camp.match(/grid-cols-\[minmax\((\d+)px,1fr\)_((?:\d+px_)*\d+px)\][^']*gap-x-([\d.]+)/);
  const min = cols ? Number(cols[1]) + cols[2].split('_').reduce((a, c) => a + parseInt(c, 10), 0) + 8 * Number(cols[3]) * 4 : Infinity;
  is('the campaigns table fits beside its folders on a laptop', min <= 900, `min ${min}px`);
  const search = read('components/shared/SearchInput.tsx');
  is('the search magnifier is centred by position', /absolute left-2\.5 top-1\/2 -translate-y-1\/2/.test(search));
  const deals = read('pages/crm/DealsPage.tsx');
  const contacts = read('pages/contacts/ContactsListPage.tsx');
  const cal = read('pages/crm/CalendarPage.tsx');
  is('Create lands on the form: deals, contacts, meetings',
    [deals, contacts, cal].every((s) => /searchParams\.get\('new'\) !== '1'/.test(s)));
  const header = read('components/layout/Header.tsx');
  is('and offers them', /'\/deals\?new=1'/.test(header) && /'\/contacts\?new=1'/.test(header) && /'\/calendar\?new=1'/.test(header));
  const layout = read('components/layout/AppLayout.tsx');
  is('g f / g p / g o jump to Flow, Deals, Contacts', /f: '\/flow'/.test(layout) && /p: '\/deals'/.test(layout) && /o: '\/contacts'/.test(layout));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} responsive check(s) failed`);

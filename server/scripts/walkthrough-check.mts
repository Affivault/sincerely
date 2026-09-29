/* ═══════════════════════════════════════════════════════════════════════
   What a full walkthrough of the app turned up, kept fixed.

   Every page and the forms, drawers and flows inside them were driven in a
   browser against a realistic account (client/harness/app), at desktop,
   tablet and phone widths, light and dark. These are the things it found
   that a person would have tripped over.

   Run: npx tsx scripts/walkthrough-check.mts
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
const server = join(here, '../src');
const readC = (p: string) => readFileSync(join(client, p), 'utf8');
const readS = (p: string) => readFileSync(join(server, p), 'utf8');
const shared = await import('@lemlist/shared');

console.log('\ncounts that do not stop at 1,000 contacts');
{
  const a = readS('services/analytics.service.ts');
  is('overview no longer counts from a plain select of every contact', !/select\('dcs_score, is_bounced'\)/.test(a));
  is('it counts exactly', (a.match(/count: 'exact', head: true/g) || []).length >= 3);
  is('deliverability bands are exact counts', /count\('contacts', \(q\) => q\.gte\('dcs_score', 80\)\)/.test(a));
}

console.log('\nthe wording of a live campaign can be fixed');
{
  const svc = readS('services/campaigns.service.ts');
  const ctl = readS('controllers/campaigns.controller.ts');
  is('wording is editable after launch', /LIVE_EDITABLE_STEP_FIELDS = new Set\(\['subject', 'subject_b', 'body_html', 'body_html_b', 'body_text', 'linkedin_note'\]\)/.test(svc));
  is('updating a step goes through that rule', /editableStepPatch\(req\.userId!, req\.params\.id, req\.params\.stepId, req\.body\)/.test(ctl));
  is('adding, removing and reordering stay draft-only', (ctl.match(/assertEditableSteps/g) || []).length === 3);
  is('a structural change is refused by name', /Only the wording of a step can change once a campaign has launched/.test(svc));
  const detail = readC('pages/campaigns/CampaignDetailPage.tsx');
  is('the sequence tab offers it on a launched campaign', /onEditWording=\{\['running', 'paused', 'scheduled'\]\.includes\(campaign\.status\)/.test(detail));
  const list = readC('pages/campaigns/CampaignsListPage.tsx');
  is('Edit on a launched campaign opens its sequence, not an error', /campaign\.status === 'draft' \? `\/campaigns\/\$\{campaign\.id\}\/edit` : `\/campaigns\/\$\{campaign\.id\}\?tab=sequence`/.test(list));
}

console.log('\nCmd+K and typing straight away');
{
  const kb = readC('lib/keyboard.ts');
  const ctx = readC('context/CommandPaletteContext.tsx');
  is('shortcuts stand down the moment the palette is asked for', /return overlayRequested \|\| document\.querySelector/.test(kb));
  is('letters typed before it appears are kept', /typedAhead \+= e\.key/.test(ctx));
  is('and read without being consumed (effects can run twice)', /export function takeTypedAhead\(\): string \{\n  return typedAhead;\n\}/.test(ctx));
}

console.log('\nwords, not keys');
{
  is('money is in the app currency, never a hard-coded pound sign', ['pages/replies/RepliesPage.tsx', 'pages/campaigns/CampaignsListPage.tsx', 'pages/analytics/SegmentsPage.tsx']
    .every((p) => !/`£\$\{/.test(readC(p))));
  is('a count agrees with its noun', shared.plural(1, 'deal') === '1 deal' && shared.plural(3, 'deal') === '3 deals'
    && shared.plural(2, 'sending inbox', 'sending inboxes') === '2 sending inboxes');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      // A word with "(s)" glued on, in text - not a call like .test(s).
      else if (/\.tsx$/.test(f) && /(?<![.\w])[a-z]{3,}\((s|es)\)(?=[\s.,'"`])/.test(readFileSync(p, 'utf8').replace(/\/\/.*$/gm, ''))) offenders.push(p.replace(client, ''));
    }
  };
  walk(join(client, 'pages'));
  is('no "campaign(s)" on any page', offenders.length === 0, offenders.join(', '));
  is('sources read as words', shared.sourceLabel('sara_auto') === 'Relay, from a reply' && shared.sourceLabel('csv_import') === 'CSV import'
    && shared.sourceLabel('hub_spot_sync') === 'Hub spot sync' && shared.sourceLabel('Conference 2026') === 'Conference 2026');
  is('stages read as words', shared.dealStageLabel('qualified') === 'Qualified');
  is('search says a campaign is Running, not running', /subtitle: campaignStatusLabel\(c\.status\)/.test(readS('services/search.service.ts')));
  is('Relay says what it recommends, not "reply"', /RELAY_ACTION_TEXT\[msg\.sara_action\]/.test(readC('pages/inbox/InboxPage.tsx')));
  is('template categories in sentence case', shared.TEMPLATE_CATEGORIES.every((c: any) => !/ [A-Z]/.test(c.label)));
  const rq = readS('services/reply-queue.service.ts');
  is('the reply queue names who wrote', /contact_name: person\?\.name \?\? null/.test(rq));
}

console.log('\nlayout that holds at every width');
{
  const ph = readC('components/shared/PageHeader.tsx');
  is('a header band can span the page while its content lines up with a narrow column', /contentClassName\?: string/.test(ph));
  is('Flow uses it', /contentClassName="mx-auto max-w-4xl"/.test(readC('pages/flow/FlowPage.tsx')));
  is('the campaign builder cancels the page padding at every width', /-mx-4 -my-5 sm:-mx-6 lg:-mx-8 lg:-my-7/.test(readC('pages/campaigns/CampaignCreatePage.tsx')));
  is('settings can be moved between on a phone', /<nav ref=\{strip\} className="lg:hidden/.test(readC('components/shared/SettingsShell.tsx')));
  is('the calendar opens on one day on a phone', /matchMedia\?\.\('\(max-width: 639\.98px\)'\)\.matches \? 'day' : 'week'/.test(readC('pages/crm/CalendarPage.tsx')));
  const ie = readC('components/ui/InlineEdit.tsx');
  is('an inline-editable value is one line tall', /multiline \? 'block w-full' : 'inline-flex max-w-full items-center'/.test(ie));
}

console.log('\nforms that say the right thing');
{
  const avail = readC('pages/crm/AvailabilityPage.tsx');
  is('a saved value outside the presets is shown, not the first option', /function withCurrent\(/.test(avail) && (avail.match(/withCurrent\(/g) || []).length >= 5);
  const cal = readC('pages/crm/CalendarPage.tsx');
  is('Book meeting offers a working hour', /if \(hour < 8\) at\.setHours\(9, 0, 0, 0\)/.test(cal));
  const deals = readC('pages/crm/DealsPage.tsx');
  is('the deal form keeps its buttons in view', /form="deal-form"/.test(deals));
  is('and calls the person a contact', /<ContactPicker\n\s+label="Contact"/.test(deals));
  const ver = readC('pages/verification/VerificationPage.tsx');
  is('each verification band has its own colour', /function bandTone\(range: string\)/.test(ver));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} walkthrough check(s) failed`);

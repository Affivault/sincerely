/* ═══════════════════════════════════════════════════════════════════════
   The everyday-UI round: eleven things that each fixed a daily irritation.
   Each assertion names the behaviour, so a later change that quietly
   removes one fails here with the reason, not in front of a customer.

   Run: npx tsx scripts/ui-polish-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeViewConfig, sameViewConfig } from '@lemlist/shared';

const here = dirname(fileURLToPath(import.meta.url));
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');
const server = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
let passed = 0;
let failed = 0;
function is(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name}${detail ? `\n         ${detail}` : ''}`); }
}

const list = client('pages/contacts/ContactsListPage.tsx');

console.log('\n1. the table never hides a column');
is('a right-edge arrow appears when there are more columns', /data-scroll-more/.test(list) && /scrollWidth - el\.clientWidth - el\.scrollLeft/.test(list));
is('the row-actions column is see-through at rest', /'sticky right-0 z-\[1\] px-2 py-2 border-b border-\[var\(--border-subtle\)\] bg-transparent'/.test(list));

console.log('\n2. the page note is one line');
is('one line, and its link moves into the filter row once hidden', /data-page-intro/.test(list) && /explainerHidden && \(\s*<span className="order-last ml-auto/.test(list));

console.log('\n3. the list rail explains itself');
const rail = client('components/contacts/ListsRail.tsx');
is('"Not in any list" is drawn under All, as part of it', /nested\s+icon=\{FolderMinus\}/.test(rail) && /label="Not in any list"/.test(rail));

console.log('\n4. the email dot explains itself');
const pop = client('components/contacts/EmailStatusPopover.tsx');
is('the dot and badge open the explanation', (list.match(/<EmailStatusPopover/g) || []).length >= 2);
is('with every check, who checked, and Verify again', /Mail server/.test(pop) && /verificationApi\.verifyContact/.test(pop) && /Verify again/.test(pop));

console.log('\n5. the side panel walks the list');
const peek = client('components/peek/PeekDrawer.tsx');
is('next and previous, by button and by J/K', /data-peek-nav/.test(peek) && /e\.key === 'j'/.test(peek) && /e\.key === 'k'/.test(peek));
is('the page tells the panel its order', /setPeekSequence\(\{ type: 'contact'/.test(list));
is('quick actions: campaign, enrich, email', /data-peek-actions/.test(peek) && /contactsApi\.enrich\(id\)/.test(peek));

console.log('\n6. cells edit in place');
const cell = client('components/contacts/EditableCell.tsx');
is('double-click edits; a single click still opens the person', /onDoubleClick/.test(cell) && /dispatchEvent\(new MouseEvent\('click'/.test(cell));
is('a refused save puts the old value back', /patchCache\(qc, contact\.id, previous\)/.test(cell));
is('job title, phone, company and more are editable', ['job_title', 'phone', 'company', 'website', 'linkedin_url', 'location', 'country', 'industry'].every((f) => new RegExp(`field="${f}"`).test(list)));

console.log('\n7. saved views are tabs, and remember email lights');
const views = client('components/contacts/SavedViews.tsx');
is('tabs with live counts', /role="tablist"/.test(views) && /view-count/.test(views));
is('rename, duplicate, update, delete', /Rename/.test(views) && /Duplicate/.test(views) && /Save current filters here/.test(views) && /Delete view/.test(views));
is('lights are part of a view', sanitizeViewConfig({ lights: 'green,amber,bogus' }).lights === 'amber,green');
is('and change whether two views match', !sameViewConfig({ lights: 'green' }, {}));

console.log('\n8. imports run in the background');
const runner = client('lib/importRunner.ts');
const imp = client('pages/contacts/BulkImportPage.tsx');
is('the import page no longer cancels on leaving', !/cancelRef/.test(imp) && /importRunner\.start\(/.test(imp));
is('closing the tab mid-import asks first', /beforeunload/.test(runner));
is('a progress pill on every page', /<ImportProgressPill \/>/.test(client('components/layout/AppLayout.tsx')));

console.log('\n9. the dashboard says how today is going');
is('a today endpoint, scoped to the account', /async today\(userId: string/.test(server('services/analytics.service.ts')) && /eq\('campaigns\.user_id', userId\)/.test(server('services/analytics.service.ts')));
is('shown under the greeting', /<TodayPulse \/>/.test(client('pages/dashboard/DashboardPage.tsx')));

console.log('\n10. the campaign builder');
const flow = client('components/campaigns/FlowBuilder.tsx');
const camp = client('pages/campaigns/CampaignCreatePage.tsx');
is('the sequence at a glance', /data-sequence-ruler/.test(flow));
is('the add-step menu opens where there is room (Email and Wait were cut off)', /setOpenUp\(/.test(flow) && !/showAbove \? 'bottom-full mb-1\.5'/.test(flow));
is('one-click merge tags at the cursor', /data-quick-tags/.test(camp) && /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/.test(camp));
is('write / preview as recipient', /data-editor-view/.test(camp) && /data-editor-preview/.test(camp));

console.log('\n11. the command palette');
const pal = client('components/CommandPalette.tsx');
is('one-step actions for the email lights, verify, import and export', ['leads-no-email', 'leads-unsure', 'leads-bad', 'verify-unverified', 'import-leads', 'export-leads'].every((id) => pal.includes(`id: '${id}'`)));
is('those links land filtered', /searchParams\.get\('lights'\)/.test(list) && /searchParams\.get\('export'\)/.test(list));
is('anyone opened in the side panel shows under Recent', /addRecentItem\(\{ type: 'contact'/.test(peek));

console.log(`\n${passed} passed, ${failed} failed`);
assert.strictEqual(failed, 0, `${failed} UI check(s) failed`);

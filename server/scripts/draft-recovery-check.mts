/* ═══════════════════════════════════════════════════════════════════════
   Not losing twenty minutes of work to a closed tab.

   The campaign builder had a "Save draft" button and nothing else. No
   autosave, no warning on navigation, no local copy - verified by grep:
   zero beforeunload handlers, zero localStorage, zero route blockers, in a
   2,766-line form. Write a five-step sequence, hit back, and it was gone
   with no indication it had ever been at risk.

   The interesting half is not the saving. It is the four situations where
   offering a draft back would be WORSE than saying nothing, because a
   recovery prompt people learn to dismiss unread is no recovery at all.

   Run: npx tsx scripts/draft-recovery-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const { shouldOfferDraft, draftAgeLabel, draftKey, DRAFT_MAX_AGE_MS } = await import('@lemlist/shared');

const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const minsAgo = (n: number) => NOW - n * 60_000;
const daysAgo = (n: number) => NOW - n * 86_400_000;

type Form = { name: string; steps: unknown[] };
const isEmpty = (d: Form) => !d.name?.trim() && d.steps.length === 0;
const work: Form = { name: 'Q4 UK brokers', steps: [{}, {}, {}] };

const draft = (over: Partial<{ data: Form; saved_at: number; record_id: string | null; version: number }> = {}) => ({
  data: work, saved_at: minsAgo(4), record_id: null, version: 1, ...over,
});

const ask = (d: any, opts: any = {}) => shouldOfferDraft(d, {
  now: NOW, recordId: null, version: 1, isEmpty, ...opts,
});

console.log('\nwork that would otherwise be gone is offered back');
{
  const verdict = ask(draft());
  is('a recent draft is offered', verdict.restore === true, JSON.stringify(verdict));
  is('with its age, so declining is informed',
     verdict.restore && verdict.ageMs === 4 * 60_000, JSON.stringify(verdict));
  is('and one written seconds ago is still fresh',
     ask(draft({ saved_at: NOW })).restore === true);
  is('right up to the age limit',
     ask(draft({ saved_at: NOW - DRAFT_MAX_AGE_MS + 1000 })).restore === true);
}

console.log('\nand the cases where offering it would be worse than silence');
{
  /*
   * A draft from three weeks ago is not a rescue, it is a trap: by then
   * nobody recognises what they are being shown, and "restore" becomes a
   * coin flip over their current work.
   */
  const stale = ask(draft({ saved_at: daysAgo(30) }));
  is('a month-old draft is not offered', stale.restore === false, JSON.stringify(stale));
  is('and says why', !stale.restore && stale.reason === 'stale', JSON.stringify(stale));

  // Restoring a blank form over a blank form is noise, and noise is how
  // people learn to dismiss the prompt without reading it.
  const empty = ask(draft({ data: { name: '  ', steps: [] } }));
  is('an empty draft is not offered', empty.restore === false);
  is('and says why', !empty.restore && empty.reason === 'empty');

  // Campaign A's draft must not appear while editing campaign B.
  const other = ask(draft({ record_id: 'campaign-a' }), { recordId: 'campaign-b' });
  is('another record\\u2019s draft is not offered', other.restore === false);
  is('and says why', !other.restore && other.reason === 'other-record');

  // A draft written by an older build can carry fields the form no longer
  // has, or miss ones it now requires.
  const old = ask(draft({ version: 0 }));
  is('a draft from an older form shape is not offered', old.restore === false);
  is('and says why', !old.restore && old.reason === 'old-version');

  is('and nothing at all is simply nothing',
     ask(null).restore === false && (ask(null) as any).reason === 'none');
}

console.log('\nthe saved record beats a local copy, always');
{
  /*
   * The load-bearing rule. A local draft is a safety net under UNSAVED
   * work - it is not a source of truth. Somebody who saved on another
   * device must not have that undone by a stale draft in this browser.
   */
  const serverNewer = ask(draft({ saved_at: minsAgo(30) }), {
    serverUpdatedAt: new Date(minsAgo(5)).toISOString(),
  });
  is('a save that happened after the draft wins',
     serverNewer.restore === false, JSON.stringify(serverNewer));
  is('and says why', !serverNewer.restore && serverNewer.reason === 'server-newer');

  const draftNewer = ask(draft({ saved_at: minsAgo(5) }), {
    serverUpdatedAt: new Date(minsAgo(30)).toISOString(),
  });
  is('but unsaved work newer than the last save is still offered',
     draftNewer.restore === true, JSON.stringify(draftNewer));

  // A save at exactly the same instant is not newer work, it is the same
  // work - so the server version stands.
  const tie = ask(draft({ saved_at: minsAgo(5) }), {
    serverUpdatedAt: new Date(minsAgo(5)).toISOString(),
  });
  is('a tie goes to the saved record', tie.restore === false);

  is('an unparseable server timestamp does not silently discard the draft',
     ask(draft(), { serverUpdatedAt: 'not a date' }).restore === true);
}

console.log('\nnothing here can throw on a malformed entry');
{
  is('a draft with no timestamp is refused, not crashed',
     ask({ data: work, record_id: null, version: 1 } as any).restore === false);
  is('and one with a junk timestamp too',
     ask(draft({ saved_at: 'yesterday' as any })).restore === false);
  // A clock that has gone backwards makes the age negative. That is not
  // stale, and it must not be reported as a negative age either.
  const future = ask(draft({ saved_at: NOW + 60_000 }));
  is('a draft from the future is treated as fresh',
     future.restore === true && future.ageMs === 0, JSON.stringify(future));
}

console.log('\nthe age reads like something a person wrote');
{
  is('under a minute', draftAgeLabel(30_000) === 'just now', draftAgeLabel(30_000));
  is('singular minute', draftAgeLabel(60_000) === '1 minute ago', draftAgeLabel(60_000));
  is('plural minutes', draftAgeLabel(4 * 60_000) === '4 minutes ago');
  is('singular hour', draftAgeLabel(3_600_000) === '1 hour ago');
  is('plural hours', draftAgeLabel(5 * 3_600_000) === '5 hours ago');
  is('days', draftAgeLabel(3 * 86_400_000) === '3 days ago');
}

console.log('\ndrafts cannot collide between records');
{
  is('a new campaign has its own key', draftKey('campaign', null) === 'sincerely:draft:campaign:new');
  is('and an existing one is keyed by id',
     draftKey('campaign', 'abc') === 'sincerely:draft:campaign:abc');
  is('two records never share a key', draftKey('campaign', 'a') !== draftKey('campaign', 'b'));
  is('nor do two forms', draftKey('campaign', 'a') !== draftKey('template', 'a'));
}

console.log('\nthe builder actually uses it');
{
  const page = readFileSync(join(here, '../../client/src/pages/campaigns/CampaignCreatePage.tsx'), 'utf8');
  const hook = readFileSync(join(here, '../../client/src/hooks/useDraftRecovery.ts'), 'utf8');

  is('the campaign form autosaves', /useDraftRecovery\(\{/.test(page),
     'the 2,766-line form still has nothing but a Save draft button');
  is('and warns before the tab closes', /useUnsavedChangesWarning\(isDirty\)/.test(page));

  /*
   * The recovery is offered, never applied on its own. A draft that
   * reappears without being asked for is indistinguishable from the app
   * having lost the newer version.
   */
  is('recovery is offered rather than applied silently',
     /data-draft-offer/.test(page) && /data-draft-restore/.test(page) && /data-draft-dismiss/.test(page));

  /*
   * The single most important line in the integration. A draft left behind
   * after a real save is not a safety net, it is a stale duplicate waiting
   * to be offered back over the saved version.
   */
  is('a real save takes the local copy down with it',
     /draft\.clear\(\);/.test(page), 'a saved campaign would still offer its old draft back');

  // Which modal was open and which step was being edited are not work.
  // Restoring them puts somebody inside a dialog they do not remember.
  is('only the work is kept, not the interface state',
     /campaignForm, steps, selectedContactIds, senderPoolIds, wizardStep,/.test(page)
     && !/showContactModal|showAiModal|editingStep/.test(page.slice(page.indexOf('const draftData'), page.indexOf('const draft = useDraftRecovery'))));

  is('it waits for the existing campaign before saving over it',
     /enabled: !isEdit \|\| !!existingCampaign/.test(page),
     'an empty initial form could be written over a real draft');

  // localStorage throws in private windows, with site data blocked, and at
  // quota. A form that crashes while protecting your work is worse than one
  // that never tried.
  const guards = (hook.match(/catch \{/g) || []).length;
  is('every storage access is guarded', guards >= 5, `only ${guards} guarded accesses`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} draft recovery check(s) failed`);

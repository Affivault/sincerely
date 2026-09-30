/* ═══════════════════════════════════════════════════════════════════════
   Relay's AI has a monthly allowance, and it holds.

   - every Claude call is checked before it goes and counted after
   - an account can choose less than the server allows, never more
   - at the limit Relay falls back to its rules; nothing errors or stops
   - old mail found while syncing history never goes to Claude

   Run: npx tsx scripts/ai-usage-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aiCapState, aiAllowed, effectiveAiCap, aiCapChoices, freshEnoughForAi, monthKey, nextMonthStart,
  formatTokens, estimateCost, AI_FRESH_DAYS,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const client = (p: string) => readFileSync(join(here, '../../client/src', p), 'utf8');

console.log('\nthe allowance');
{
  is('under 80%: ok', aiCapState(700, 1000) === 'ok');
  is('from 80%: near', aiCapState(800, 1000) === 'near');
  is('at the cap: reached', aiCapState(1000, 1000) === 'reached');
  is('no cap: unlimited, always allowed', aiCapState(9e12, 0) === 'unlimited' && aiAllowed(9e12, 0));
  is('reached: not allowed', !aiAllowed(1000, 1000));
  is('an account can choose less', effectiveAiCap(1_000_000, 5_000_000) === 1_000_000);
  is('an account can never choose more', effectiveAiCap(50_000_000, 5_000_000) === 5_000_000);
  is('"no limit" from an account is the server ceiling', effectiveAiCap(0, 5_000_000) === 5_000_000);
  is('no choice: the server ceiling', effectiveAiCap(null, 5_000_000) === 5_000_000);
  is('no server ceiling: the account choice holds', effectiveAiCap(2_000_000, 0) === 2_000_000);
  is('choices stop at the ceiling', Math.max(...aiCapChoices(5_000_000)) === 5_000_000 && aiCapChoices(5_000_000).every((c) => c <= 5_000_000));
  is('months are UTC', monthKey(Date.UTC(2026, 8, 30, 23, 59)) === '2026-09' && monthKey(Date.UTC(2026, 9, 1)) === '2026-10');
  is('December rolls into January', nextMonthStart(Date.UTC(2026, 11, 15)) === '2027-01-01T00:00:00.000Z');
  is('tokens read short', formatTokens(1_250_000) === '1.3M' && formatTokens(5_000_000) === '5M' && formatTokens(850_000) === '850k');
  is('cost is estimated from both directions', estimateCost([{ feature: 'read_reply', calls: 1, input_tokens: 1_000_000, output_tokens: 100_000 }], 5, 25) === 7.5);
}

console.log('\nold mail is never paid for');
{
  const now = Date.UTC(2026, 8, 30);
  is('yesterday: Claude', freshEnoughForAi(new Date(now - 86_400_000).toISOString(), now));
  is(`older than ${AI_FRESH_DAYS} days: rules`, !freshEnoughForAi(new Date(now - (AI_FRESH_DAYS + 1) * 86_400_000).toISOString(), now));
  is('no date: treated as new', freshEnoughForAi(null, now));
  is('Relay checks the date before reading', /freshEnoughForAi\(message\.received_at\)/.test(src('services/sara.service.ts')));
}

console.log('\nevery call is checked and counted');
{
  const ai = src('services/ai.service.ts');
  is('checked before the call', /if \(!\(await aiUsageService\.allow\(opts\.userId\)\)\) return null;/.test(ai));
  is('counted after it', /await aiUsageService\.record\(opts\.userId, opts\.feature, response\.usage/.test(ai));
  const calls = ai.match(/await structured\(\{[^\n]*\}\)/g) || [];
  is('every call names its account and feature', calls.length === 4 && calls.every((c) => /userId: input\.userId, feature: '[a-z_]+'/.test(c)), calls.join('\n'));
  is('readReply is given the account', /readReply\(\{\s*userId: message\.user_id,/.test(src('services/sara.service.ts')));
  is('draftReply is given the account', /draftReply\(\{\s*userId,/.test(src('services/inbox.service.ts')));
  const w = src('services/sequence-writer.service.ts');
  is('the sequence writer is given the account', /writeSequence\(\{\s*userId,/.test(w) && /firstLines\(\{\s*userId, offer, tone,/.test(w));
  const svc = src('services/ai-usage.service.ts');
  is('counts are added in the database, not read-modify-write', /rpc\('record_ai_usage'/.test(svc));
  is('a count that cannot be written falls back to memory', /tableMissing = true/.test(svc) && /memory\.set\(key, row\)/.test(svc));
  is('an allowance above the ceiling is refused', /cap > max/.test(svc));
  is('the routes are mounted', /routes\.use\('\/ai', aiRoutes\)/.test(src('routes/index.ts')));
  is('the status page says when it runs out', /ai-allowance:\$\{ai\.month\}/.test(src('services/system-status.service.ts')));
  is('Settings shows the meter', /<AiUsageCard \/>/.test(client('pages/settings/SettingsPage.tsx')));
  is('the writer says when it fell back', /seq\.engine === 'template'/.test(client('components/campaigns/WriteWithRelay.tsx')));
  const migration = readFileSync(join(here, '../../supabase/migrations/079_ai_usage.sql'), 'utf8');
  is('migration 079 creates the table, the counter and the column',
     /create table if not exists ai_usage/.test(migration) && /create or replace function record_ai_usage/.test(migration)
     && /add column if not exists ai_monthly_token_cap/.test(migration));
  is('no signed-in user can run the counter', /revoke all on function record_ai_usage[^;]*from authenticated;/.test(migration));
  is('the migration is ASCII with no BEGIN/COMMIT', /^[\x00-\x7F]*$/.test(migration) && !/^\s*(begin|commit)\s*;/im.test(migration));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

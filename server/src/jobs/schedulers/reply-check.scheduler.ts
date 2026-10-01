import { supabaseAdmin } from '../../config/supabase.js';
import { replyCheckDue } from '@lemlist/shared';
import { replyCheckService } from '../../services/reply-check.service.js';
import { beat } from '../../utils/heartbeat.js';

/**
 * Once a day per account, prove that a reply stops a sequence
 * (services/reply-check). An automatic check that fails is tried again an
 * hour later, so one slow delivery is never reported as a broken loop.
 * Accounts run one after another: each check sends two emails and waits
 * on IMAP, and doing them all at once looks like a burst to providers.
 * Cross-tenant; never an authenticated route.
 */

const TICK_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let kickoff: ReturnType<typeof setTimeout> | null = null;

async function tick() {
  // Without the table there is no memory of the last run, and every tick
  // would look due. Automatic checks wait for migration 079.
  if (!(await replyCheckService.ready())) return;

  const { data: rows, error } = await supabaseAdmin
    .from('smtp_accounts')
    .select('user_id')
    .eq('is_active', true)
    .eq('is_verified', true)
    .eq('is_seed', false)
    .not('imap_host', 'is', null);
  if (error) throw new Error(`reply check accounts: ${error.message}`);
  const users = [...new Set((rows || []).map((r: any) => r.user_id as string))];

  const { data: optedOut } = await supabaseAdmin
    .from('user_settings').select('user_id').in('user_id', users).eq('reply_check_daily', false);
  const off = new Set((optedOut || []).map((r: any) => r.user_id));

  let ran = 0;
  for (const userId of users) {
    if (off.has(userId) || replyCheckService.isRunning(userId)) continue;
    const last = await replyCheckService.last(userId);
    const retry = !!last?.result && !last.result.ok && !last.result.skipped && last.consecutive_failures === 1
      && !!last.last_run_at && Date.now() - Date.parse(last.last_run_at) >= RETRY_MS;
    if (!retry && !replyCheckDue(last?.last_run_at)) continue;
    const r = await replyCheckService.run(userId);
    ran++;
    if (!r.ok && !r.skipped) console.warn(`[ReplyCheck] ${userId}: failed at ${r.failed_at} - ${r.detail}`);
  }
  if (ran) console.log(`[ReplyCheck] ${ran} account(s) checked`);
}

export function startReplyCheckScheduler() {
  console.log('[ReplyCheck] Scheduler started (hourly)');
  kickoff = setTimeout(() => beat('reply_check', tick), 10 * 60 * 1000);
  timer = setInterval(() => beat('reply_check', tick), TICK_MS);
  return {
    stop: () => {
      if (kickoff) { clearTimeout(kickoff); kickoff = null; }
      if (timer) { clearInterval(timer); timer = null; console.log('[ReplyCheck] Scheduler stopped'); }
    },
  };
}

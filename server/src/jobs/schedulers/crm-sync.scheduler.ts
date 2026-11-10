import { supabaseAdmin } from '../../config/supabase.js';
import { runCrmSync, dueCrmSyncs, CRM_SYNC_EVERY_MS } from '../../services/crm-sync.service.js';
import { beat } from '../../utils/heartbeat.js';

/**
 * Runs two-way HubSpot and Pipedrive syncs that are due (migration 118).
 *
 * Cross-tenant, so a scheduler and never a route. Each due connection is
 * claimed first - its next run moved forward only if nobody else moved it -
 * so two server instances never sync the same connection at once. The run
 * itself sets the real next time when it finishes.
 */

const SWEEP_MS = 2 * 60 * 1000;
const PER_SWEEP = 10;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runCrmSyncSweep(): Promise<number> {
  let ran = 0;
  for (const due of await dueCrmSyncs(PER_SWEEP)) {
    const { data: claimed } = await supabaseAdmin.from('user_integrations')
      .update({ next_sync_at: new Date(Date.now() + CRM_SYNC_EVERY_MS * 2).toISOString() })
      .eq('id', due.id).eq('user_id', due.user_id).eq('is_active', true)
      .lte('next_sync_at', new Date().toISOString())
      .select('id');
    if (!claimed || claimed.length === 0) continue;
    try {
      await runCrmSync(due.user_id, due.id);
      ran++;
    } catch (err: any) {
      // Recorded on the connection (last_sync_error) for its owner to see.
      console.warn(`[CrmSync] ${due.id} failed: ${err?.message || err}`);
    }
  }
  return ran;
}

export function startCrmSyncScheduler() {
  if (timer) return { stop: () => {} };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await runCrmSyncSweep();
      if (n > 0) console.log(`[CrmSync] Synced ${n} CRM connection(s)`);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => beat('crm_sync', tick), SWEEP_MS);
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

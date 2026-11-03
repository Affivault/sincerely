import { supabaseAdmin } from '../../config/supabase.js';
import { sheetSyncService } from '../../services/sheet-sync.service.js';
import { beat } from '../../utils/heartbeat.js';

/**
 * Runs Google Sheets syncs that are due (migration 111).
 *
 * Cross-tenant, so a scheduler and never a route. Each due sync is
 * claimed first - its next run moved forward only if nobody else moved it
 * - so two server instances never import the same sheet at once.
 */

const SWEEP_MS = 15 * 60 * 1000;
const PER_SWEEP = 5;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runSheetSyncSweep(): Promise<number> {
  let ran = 0;
  for (const due of await sheetSyncService.due(PER_SWEEP)) {
    const { data: claimed } = await supabaseAdmin.from('sheet_syncs')
      .update({ next_run_at: new Date(Date.now() + SWEEP_MS * 2).toISOString() })
      .eq('id', due.id).eq('user_id', due.user_id).eq('enabled', true)
      .lte('next_run_at', new Date().toISOString())
      .select('id');
    if (!claimed || claimed.length === 0) continue;
    try {
      await sheetSyncService.run(due.user_id, due.id);
      ran++;
    } catch (err: any) {
      // Recorded on the sync (last_error) for its owner to see.
      console.warn(`[SheetSync] ${due.id} failed: ${err?.message || err}`);
    }
  }
  return ran;
}

export function startSheetSyncScheduler() {
  if (timer) return { stop: () => {} };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await runSheetSyncSweep();
      if (n > 0) console.log(`[SheetSync] Synced ${n} sheet(s)`);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => beat('sheet_sync', tick), SWEEP_MS);
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

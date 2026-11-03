import { driveBackupService } from '../../services/drive-backup.service.js';
import { beat } from '../../utils/heartbeat.js';

/**
 * Writes queued changes into each account's Google Drive backup about
 * once a minute, and runs each account's daily full refresh (migration
 * 112). Cross-tenant, so a scheduler and never a route. Each account is
 * claimed before it is written, so two server instances never write the
 * same spreadsheet at once.
 */

const SWEEP_MS = 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startDriveBackupScheduler() {
  if (timer) return { stop: () => {} };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { flushed, full } = await driveBackupService.sweep();
      if (full > 0) console.log(`[DriveBackup] ${full} full refresh(es), ${flushed} update(s)`);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => beat('drive_backup', tick), SWEEP_MS);
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

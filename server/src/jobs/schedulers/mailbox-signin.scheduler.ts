import { mailboxOAuthService } from '../../services/mailbox-oauth.service.js';
import { beat } from '../../utils/heartbeat.js';

/**
 * The daily sign-in check for Microsoft mailboxes (migration 114): each
 * one's sign-in is renewed about once a day, so a revoked one is found and
 * its owner told before a campaign trips over it. Runs every few hours and
 * only checks mailboxes not renewed in the last 20 hours. Cross-tenant, so
 * a scheduler and never a route.
 */

const SWEEP_MS = 3 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startMailboxSigninScheduler() {
  if (timer) return { stop: () => {} };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { checked, broken } = await mailboxOAuthService.checkAll();
      if (checked) console.log(`[MailboxSignin] checked ${checked} Microsoft mailbox(es), ${broken} need reconnecting`);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => beat('mailbox_signin', tick), SWEEP_MS);
  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

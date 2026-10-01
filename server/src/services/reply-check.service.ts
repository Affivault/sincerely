/* ═══════════════════════════════════════════════════════════════════════
   Proving that a reply stops a sequence, on the account's own mailboxes.

   See shared/reply-check for the stages. The shape of one run:

     1. a placeholder contact, a hidden draft campaign and an enrolment,
        and a "sent" activity carrying the Message-ID the check will use -
        exactly what a real campaign send leaves behind
     2. mailbox A sends the check email to mailbox B (A itself when it is
        the only one)
     3. B answers it, threaded with In-Reply-To and References
     4. inbox sync reads A, as it would for any reply, until the answer has
        been matched and the enrolment stopped - or time runs out
     5. everything the check created is removed, whatever happened

   The result is kept (reply_checks, migration 079) so the status page can
   show when replies were last proven to stop sequences, and the watchdog
   can say so when they were not. A failure caused by slow delivery is
   not reported on its own: an automatic check that fails is tried again
   an hour later, and only a second failure in a row is raised.
   ═══════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import {
  REPLY_CHECK_CAMPAIGN_NAME, REPLY_CHECK_CONTACT_DOMAIN, REPLY_CHECK_WAIT_MS, SYSTEM_MAIL_HEADER,
  explainReplyCheckFailure, replyCheckSubject,
  type ReplyCheckResult, type ReplyCheckStage,
} from '@lemlist/shared';
import { decrypt } from '../utils/encryption.js';
import { sendViaSmtp, formatFromHeader, describeSmtpError } from './email-sender.service.js';
import { inboxSyncService } from './inbox-sync.service.js';
import { readReplyCheckNotes, forgetReplyCheck } from '../utils/reply-check-notes.js';

const POLL_MS = 8_000;
const running = new Set<string>();
let tableMissing = false;

interface Box {
  id: string;
  email_address: string;
  from_name: string | null;
  label: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass_encrypted: string;
  imap_host: string | null;
  autopilot_state: string | null;
}

export interface StoredReplyCheck {
  last_run_at: string | null;
  last_ok_at: string | null;
  consecutive_failures: number;
  result: ReplyCheckResult | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The mailbox that reads the answer, and the one that writes it. */
export function pickReplyCheckPair<T extends { id: string; imap_host: string | null; autopilot_state?: string | null }>(boxes: T[]): { reader: T; writer: T } | null {
  const healthy = (b: T) => b.autopilot_state !== 'resting';
  const readers = boxes.filter((b) => !!b.imap_host);
  const reader = readers.find(healthy) || readers[0];
  if (!reader) return null;
  const writer = boxes.find((b) => b.id !== reader.id && healthy(b)) || boxes.find((b) => b.id !== reader.id) || reader;
  return { reader, writer };
}

function domainOf(address: string): string {
  return (address.split('@')[1] || 'sincerely.local').toLowerCase();
}

async function send(box: Box, to: string, subject: string, text: string, messageId: string, headers: Record<string, string>): Promise<void> {
  await sendViaSmtp({
    smtpHost: box.smtp_host,
    smtpPort: box.smtp_port,
    smtpSecure: box.smtp_secure,
    smtpUser: box.smtp_user,
    smtpPass: decrypt(box.smtp_pass_encrypted),
    from: formatFromHeader(box.from_name || box.label, box.email_address),
    to,
    subject,
    text,
    html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`,
    messageId,
    headers,
    timeoutMs: 20_000,
  });
}

async function save(userId: string, result: ReplyCheckResult): Promise<void> {
  if (tableMissing) return;
  const { data: prev, error: readErr } = await supabaseAdmin
    .from('reply_checks').select('consecutive_failures, last_ok_at').eq('user_id', userId).maybeSingle();
  if (readErr) {
    if (/reply_checks/.test(readErr.message)) tableMissing = true;
    return;
  }
  const failures = result.skipped ? (prev as any)?.consecutive_failures ?? 0
    : result.ok ? 0 : ((prev as any)?.consecutive_failures ?? 0) + 1;
  const { error } = await supabaseAdmin.from('reply_checks').upsert({
    user_id: userId,
    last_run_at: result.ran_at,
    ok: result.ok,
    skipped: result.skipped,
    failed_at: result.failed_at,
    detail: result.detail,
    result,
    consecutive_failures: failures,
    last_ok_at: result.ok ? result.ran_at : (prev as any)?.last_ok_at ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error && /reply_checks/.test(error.message)) tableMissing = true;
}

/** Remove what a check created. Also sweeps any an interrupted run left behind. */
async function cleanUp(userId: string): Promise<void> {
  const { data: camps } = await supabaseAdmin
    .from('campaigns').select('id').eq('user_id', userId).eq('name', REPLY_CHECK_CAMPAIGN_NAME);
  const ids = (camps || []).map((c: any) => c.id);
  if (ids.length) {
    await supabaseAdmin.from('campaign_activities').delete().in('campaign_id', ids);
    await supabaseAdmin.from('campaign_contacts').delete().in('campaign_id', ids);
    await supabaseAdmin.from('campaigns').delete().in('id', ids).eq('user_id', userId);
  }
  await supabaseAdmin.from('contacts').delete().eq('user_id', userId).like('email', `%@${REPLY_CHECK_CONTACT_DOMAIN}`);
}

export const replyCheckService = {
  async last(userId: string): Promise<StoredReplyCheck | null> {
    if (tableMissing) return null;
    const { data, error } = await supabaseAdmin
      .from('reply_checks')
      .select('last_run_at, last_ok_at, consecutive_failures, result')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (/reply_checks/.test(error.message)) tableMissing = true;
      return null;
    }
    return data ? {
      last_run_at: (data as any).last_run_at,
      last_ok_at: (data as any).last_ok_at,
      consecutive_failures: (data as any).consecutive_failures ?? 0,
      result: (data as any).result ?? null,
    } : null;
  },

  persisted(): boolean {
    return !tableMissing;
  },

  /** Whether migration 079 is in: automatic checks need somewhere to remember the last run. */
  async ready(): Promise<boolean> {
    // Asked afresh each time, so running the migration needs no restart.
    const { error } = await supabaseAdmin.from('reply_checks').select('user_id', { head: true, count: 'exact' }).limit(1);
    tableMissing = !!error && /reply_checks/.test(error.message);
    return !error;
  },

  isRunning(userId: string): boolean {
    return running.has(userId);
  },

  /** Run one check for an account. Never throws; one at a time per account. */
  async run(userId: string): Promise<ReplyCheckResult> {
    const ranAt = new Date().toISOString();
    const base: Base = { from_mailbox: null, to_mailbox: null, seconds: null, ran_at: ranAt };
    if (running.has(userId)) {
      return { ...base, ok: false, skipped: true, reached: [], failed_at: null, detail: 'A reply check is already running for this account.' };
    }
    running.add(userId);
    const token = crypto.randomBytes(8).toString('hex');
    let result: ReplyCheckResult | null = null;
    try {
      result = await runOnce(userId, token, base);
      return result;
    } finally {
      await cleanUp(userId).catch((e) => console.warn(`[ReplyCheck] cleanup for ${userId}: ${e?.message || e}`));
      forgetReplyCheck(token);
      running.delete(userId);
      if (result) await save(userId, result).catch(() => {});
    }
  },
};

type Base = Pick<ReplyCheckResult, 'from_mailbox' | 'to_mailbox' | 'seconds' | 'ran_at'>;

async function runOnce(userId: string, token: string, base: Base): Promise<ReplyCheckResult> {
    const reached: ReplyCheckStage[] = [];
    const started = Date.now();
    let result: ReplyCheckResult;
    try {
      await cleanUp(userId).catch(() => {});

      const { data: rows } = await supabaseAdmin
        .from('smtp_accounts')
        .select('id, email_address, from_name, label, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_encrypted, imap_host, autopilot_state, created_at')
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('is_verified', true)
        .eq('is_seed', false)
        .order('created_at', { ascending: true });
      const pair = pickReplyCheckPair((rows || []) as Box[]);
      if (!pair) {
        result = {
          ...base, ok: false, skipped: true, reached, failed_at: null,
          detail: (rows || []).length
            ? 'None of your mailboxes can read its inbox (no IMAP settings), so replies cannot be read at all. Add receiving settings to a mailbox to run this check.'
            : 'Connect a mailbox to run this check.',
        };
        return result;
      }
      const { reader: a, writer: b } = pair;
      base.from_mailbox = a.email_address;
      base.to_mailbox = b.email_address;

      // 1. What a real send leaves behind.
      const messageId = `<rc-${token}@${domainOf(a.email_address)}>`;
      const { data: contact, error: cErr } = await supabaseAdmin.from('contacts').insert({
        user_id: userId, email: `check-${token}@${REPLY_CHECK_CONTACT_DOMAIN}`, first_name: 'Reply check',
      }).select('id').single();
      if (cErr || !contact) throw new Error(`could not create the check's placeholder contact: ${cErr?.message}`);
      const { data: campaign, error: kErr } = await supabaseAdmin.from('campaigns').insert({
        user_id: userId, name: REPLY_CHECK_CAMPAIGN_NAME, status: 'draft',
      }).select('id').single();
      if (kErr || !campaign) throw new Error(`could not create the check's placeholder campaign: ${kErr?.message}`);
      const { data: enrolment, error: eErr } = await supabaseAdmin.from('campaign_contacts').insert({
        campaign_id: campaign.id, contact_id: contact.id, status: 'active', next_send_at: null,
      }).select('id').single();
      if (eErr || !enrolment) throw new Error(`could not create the check's placeholder enrolment: ${eErr?.message}`);
      const { error: aErr } = await supabaseAdmin.from('campaign_activities').insert({
        campaign_id: campaign.id, campaign_contact_id: enrolment.id, contact_id: contact.id,
        activity_type: 'sent', message_id: messageId,
        metadata: { smtp_account_id: a.id, to: b.email_address, reply_check: true },
      });
      if (aErr) throw new Error(`could not record the check's send: ${aErr.message}`);

      // 2. A sends.
      const subject = replyCheckSubject(token);
      try {
        await send(a as Box, b.email_address, subject,
          'This is an automatic check from Sincerely that a reply stops a sequence. It is answered automatically and needs nothing from you.',
          messageId, { [SYSTEM_MAIL_HEADER]: `reply-check ${token}` });
      } catch (err: any) {
        result = { ...base, ok: false, skipped: false, reached, failed_at: 'sent', detail: explainReplyCheckFailure('sent', { from: a.email_address, to: b.email_address, error: describeSmtpError(err) }) };
        return result;
      }
      reached.push('sent');

      // 3. B answers, threaded the way a mail client threads a reply.
      try {
        await send(b as Box, a.email_address, `Re: ${subject}`,
          'Answering the reply check. Sincerely should now stop the check\'s sequence.',
          `<rc-${token}-re@${domainOf(b.email_address)}>`,
          { [SYSTEM_MAIL_HEADER]: `reply-check ${token}`, 'In-Reply-To': messageId, References: messageId });
      } catch (err: any) {
        result = { ...base, ok: false, skipped: false, reached, failed_at: 'replied', detail: explainReplyCheckFailure('replied', { from: a.email_address, to: b.email_address, error: describeSmtpError(err) }) };
        return result;
      }
      reached.push('replied');

      // 4. Read A until the answer is matched and the enrolment stopped.
      let arrived = false, matched = false, stopped = false;
      const deadline = Date.now() + REPLY_CHECK_WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        await inboxSyncService.syncInbox(userId, { accountIds: [a.id] }).catch(() => null);
        const notes = readReplyCheckNotes(token).filter((n) => n.accountId === a.id && n.kind === 'reply');
        if (notes.length) arrived = true;
        if (notes.some((n) => n.matched)) matched = true;
        const { data: cc } = await supabaseAdmin.from('campaign_contacts').select('status').eq('id', enrolment.id).maybeSingle();
        // The database is the last word: another server's sync may have
        // read the answer, in which case this one never saw it arrive.
        if ((cc as any)?.status === 'replied') { stopped = true; arrived = true; matched = true; break; }
        if (arrived && notes.length && !notes.some((n) => n.matched)) break;
      }
      if (arrived) reached.push('arrived');
      if (matched) reached.push('matched');
      if (stopped) reached.push('stopped');

      const seconds = Math.round((Date.now() - started) / 1000);
      if (stopped) {
        result = {
          ...base, seconds, ok: true, skipped: false, reached, failed_at: null,
          detail: `${b.email_address === a.email_address ? `${a.email_address} answered its own check email` : `${b.email_address} answered ${a.email_address}`}, inbox sync found the answer, matched it and stopped the sequence - in ${seconds} seconds.`,
        };
      } else {
        const failedAt: ReplyCheckStage = !arrived ? 'arrived' : !matched ? 'matched' : 'stopped';
        const bounced = readReplyCheckNotes(token).some((n) => n.kind === 'bounced');
        result = {
          ...base, seconds, ok: false, skipped: false, reached, failed_at: failedAt,
          detail: bounced
            ? `The check email bounced instead of arriving. ${b.email_address} may be refusing mail from ${a.email_address}.`
            : explainReplyCheckFailure(failedAt, { from: a.email_address, to: b.email_address }),
        };
      }
      return result;
    } catch (err: any) {
      result = {
        ...base, ok: false, skipped: false, reached, failed_at: reached.length ? null : 'sent',
        detail: `The check could not run: ${err?.message || err}`,
      };
      return result;
    }
}

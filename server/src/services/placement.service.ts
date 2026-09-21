import { randomUUID } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { decrypt } from '../utils/encryption.js';
import { sendViaSmtp, describeSmtpError, formatFromHeader } from './email-sender.service.js';
import { imapHostFor } from './inbox-sync.service.js';
import { resolveHostIp } from '../utils/dns-doh.js';
import {
  classifyFolder, seedProvider, placementSummary, PLACEMENT_WAIT_MS,
  type ProbePlacement, type MailProvider,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Finding out where the mail actually landed.

   Send the same message to mailboxes the account controls at each
   provider, then read those mailboxes over IMAP and see which folder it
   is in. The IMAP half is the expensive part and it already existed -
   this borrows the same host resolution the inbox sync uses, so a seed
   mailbox that syncs is a seed mailbox that can be polled.

   Two decisions worth stating, because both are places where a
   deliverability tool can quietly start lying:

   THE PROBE IS THE REAL MESSAGE. No tracking pixel, no unsubscribe
   footer, no appended code in the subject. Seed testing services put a
   token in the subject line because it is easy, and it changes the thing
   being measured - subject text is one of the strongest filtering
   signals there is. The token here rides in the Message-ID and a custom
   header, which are not what a filter scores.

   A PROBE THAT NEVER LEFT IS NOT A DELIVERY FAILURE. If our own SMTP
   refused it, that says nothing whatsoever about the receiving provider.
   It is recorded as an error and kept out of the arithmetic entirely.
   ═══════════════════════════════════════════════════════════════════════ */

/** Guard against a pathological folder list on a hoarder's mailbox. */
const MAX_FOLDERS_SEARCHED = 40;
const CONNECT_TIMEOUT_MS = 20_000;

type SeedRow = {
  id: string;
  email_address: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean | null;
  imap_user: string | null;
  smtp_host: string;
  smtp_user: string;
  smtp_pass_encrypted: string;
  is_verified: boolean;
  is_active: boolean;
};

const SEED_COLUMNS =
  'id, email_address, imap_host, imap_port, imap_secure, imap_user, smtp_host, smtp_user, smtp_pass_encrypted, is_verified, is_active';

async function seedsFor(userId: string): Promise<SeedRow[]> {
  const { data, error } = await supabaseAdmin
    .from('smtp_accounts')
    .select(SEED_COLUMNS)
    .eq('user_id', userId)
    .eq('is_seed', true)
    .eq('is_active', true)
    .order('email_address');
  if (error) throw new AppError(error.message, 500);
  return (data || []) as SeedRow[];
}

/**
 * A seed with no IMAP server cannot be read, so it cannot be a seed.
 *
 * Caught at the point of starting a test rather than silently producing a
 * row that sits pending forever - "waiting" that can never resolve is the
 * worst state to leave a report in.
 */
function readable(seed: SeedRow): boolean {
  return !!(seed.imap_host || '').trim();
}

export const placementService = {
  /** The seed mailboxes, with whether each one can actually be read. */
  async listSeeds(userId: string) {
    const seeds = await seedsFor(userId);
    return seeds.map((s) => ({
      id: s.id,
      email_address: s.email_address,
      provider: seedProvider(s.email_address, s.imap_host),
      readable: readable(s),
      is_verified: s.is_verified,
    }));
  },

  /**
   * Mark an existing mailbox as a seed, or stop it being one.
   *
   * Done by flag rather than by a separate table so a seed inherits every
   * bit of connection, verification and sync plumbing that already works.
   */
  async setSeed(userId: string, accountId: string, isSeed: boolean) {
    const { data, error } = await supabaseAdmin
      .from('smtp_accounts')
      .update({ is_seed: isSeed })
      .eq('id', accountId)
      .eq('user_id', userId)
      .select('id, email_address, is_seed')
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Mailbox not found', 404);
    return data;
  },

  async list(userId: string, limit = 20) {
    const { data, error } = await supabaseAdmin
      .from('placement_tests')
      .select('id, smtp_account_id, campaign_id, subject, status, started_at, completed_at, error')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Math.min(50, Math.max(1, limit)));
    if (error) throw new AppError(error.message, 500);

    const ids = (data || []).map((t) => t.id);
    if (ids.length === 0) return [];

    const { data: results } = await supabaseAdmin
      .from('placement_results')
      .select('test_id, provider, placement, folder')
      .in('test_id', ids);

    return (data || []).map((test) => {
      const mine = (results || []).filter((r) => r.test_id === test.id);
      return { ...test, summary: placementSummary(mine as any) };
    });
  },

  async get(userId: string, testId: string) {
    const { data: test, error } = await supabaseAdmin
      .from('placement_tests')
      .select('*')
      .eq('id', testId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!test) throw new AppError('Placement test not found', 404);

    const { data: results } = await supabaseAdmin
      .from('placement_results')
      .select('*')
      .eq('test_id', testId)
      .order('provider');

    const rows = (results || []) as any[];
    return { test, results: rows, summary: placementSummary(rows) };
  },

  /**
   * Send one message to every seed and start looking for it.
   *
   * The sending half runs inline because it has to report which probes
   * could not be sent at all, and that is the answer the user needs
   * immediately. The finding half is a poller: mail takes minutes to
   * arrive, and holding an HTTP request open for that is not a design.
   */
  async start(userId: string, input: {
    smtp_account_id: string;
    campaign_id?: string | null;
    step_id?: string | null;
    subject?: string;
    body_html?: string;
  }) {
    const seeds = await seedsFor(userId);
    const usable = seeds.filter(readable);
    if (usable.length === 0) {
      throw new AppError(
        seeds.length === 0
          ? 'Add at least one seed mailbox first - a mailbox you control at Gmail, Outlook or Yahoo.'
          : 'Your seed mailboxes have no incoming (IMAP) server set, so nothing can be read back from them.',
        400,
      );
    }

    const { data: sender, error: senderErr } = await supabaseAdmin
      .from('smtp_accounts')
      .select('*')
      .eq('id', input.smtp_account_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (senderErr) throw new AppError(senderErr.message, 500);
    if (!sender) throw new AppError('Sending mailbox not found', 404);
    if (sender.is_seed) {
      throw new AppError('That mailbox is a seed. Pick the mailbox you actually send campaigns from.', 400);
    }

    const { subject, bodyHtml } = await resolveContent(userId, input);
    if (!subject.trim()) {
      throw new AppError('A placement test needs a subject line - it is one of the strongest filtering signals there is.', 400);
    }

    const token = randomUUID().replace(/-/g, '');

    const { data: test, error: testErr } = await supabaseAdmin
      .from('placement_tests')
      .insert({
        user_id: userId,
        smtp_account_id: sender.id,
        campaign_id: input.campaign_id || null,
        step_id: input.step_id || null,
        subject,
        body_html: bodyHtml,
        token,
        status: 'sending',
      })
      .select('*')
      .single();
    if (testErr) throw new AppError(testErr.message, 500);

    const password = decrypt(sender.smtp_pass_encrypted);
    const from = formatFromHeader(sender.from_name, sender.email_address);
    const rows: any[] = [];

    for (const seed of usable) {
      const provider = seedProvider(seed.email_address, seed.imap_host);
      let placement: ProbePlacement = 'pending';
      let sendError: string | null = null;

      try {
        await sendViaSmtp({
          smtpHost: sender.smtp_host,
          smtpPort: sender.smtp_port,
          smtpSecure: !!sender.smtp_secure,
          smtpUser: sender.smtp_user || sender.email_address,
          smtpPass: password,
          from,
          to: seed.email_address,
          subject,
          html: bodyHtml || undefined,
          text: bodyHtml ? undefined : subject,
          /*
           * The token rides here rather than in the subject. Appending a
           * code to the subject is what makes seed testing easy and what
           * makes it measure the wrong message - subject text is one of
           * the strongest signals a filter scores.
           */
          messageId: `<${token}.${seed.id}@sincerely-placement>`,
          headers: { 'X-Sincerely-Placement': token },
          timeoutMs: 15_000,
        });
      } catch (err: any) {
        placement = 'error';
        sendError = describeSmtpError(err);
      }

      rows.push({
        test_id: test.id,
        seed_account_id: seed.id,
        seed_email: seed.email_address,
        provider,
        placement,
        send_error: sendError,
      });
    }

    const { error: rowsErr } = await supabaseAdmin.from('placement_results').insert(rows);
    if (rowsErr) throw new AppError(rowsErr.message, 500);

    const anySent = rows.some((r) => r.placement === 'pending');
    await supabaseAdmin
      .from('placement_tests')
      .update({
        status: anySent ? 'waiting' : 'failed',
        error: anySent ? null : 'None of the test messages could be sent.',
        completed_at: anySent ? null : new Date().toISOString(),
      })
      .eq('id', test.id);

    return this.get(userId, test.id);
  },

  /**
   * Look for the probes of one test.
   *
   * Opens each pending seed once, walks its folders, and records the first
   * folder the message is found in. Called by the poller; safe to call
   * again at any time.
   */
  async poll(testId: string): Promise<void> {
    const { data: test } = await supabaseAdmin
      .from('placement_tests')
      .select('id, user_id, token, started_at, status')
      .eq('id', testId)
      .maybeSingle();
    if (!test || (test.status !== 'waiting' && test.status !== 'sending')) return;

    await supabaseAdmin
      .from('placement_tests')
      .update({ last_polled_at: new Date().toISOString() })
      .eq('id', testId);

    const { data: pending } = await supabaseAdmin
      .from('placement_results')
      .select('id, seed_account_id, seed_email')
      .eq('test_id', testId)
      .eq('placement', 'pending');

    const expired = Date.now() - new Date(test.started_at).getTime() > PLACEMENT_WAIT_MS;

    for (const row of pending || []) {
      const { data: seed } = await supabaseAdmin
        .from('smtp_accounts')
        .select(SEED_COLUMNS)
        .eq('id', row.seed_account_id)
        .maybeSingle();

      if (!seed || !readable(seed as SeedRow)) {
        /*
         * The seed was deleted or lost its IMAP settings mid-test. That is
         * our side failing, not a filtering decision, so it is an error
         * rather than "missing".
         */
        await markResult(row.id, 'error', null, 'The seed mailbox is no longer readable.');
        continue;
      }

      let found: { folder: string; kind: ReturnType<typeof classifyFolder> } | null = null;
      try {
        found = await findProbe(seed as SeedRow, test.token);
      } catch (err: any) {
        /*
         * A connection failure is not an answer. Left pending so the next
         * sweep tries again, and only the overall timeout turns it into
         * "missing" - which is honest, because after twenty minutes of
         * being unable to look, we genuinely do not know.
         */
        console.warn(`[Placement] Could not read ${row.seed_email}: ${err?.message || err}`);
      }

      if (found) {
        const placement: ProbePlacement = found.kind === 'spam' ? 'spam'
          : found.kind === 'inbox' ? 'inbox'
          // Filed into a folder by a rule is not the inbox and not spam.
          : 'missing';
        await markResult(row.id, placement, found.folder, null);
      } else if (expired) {
        await markResult(row.id, 'missing', null, null);
      }
    }

    const { data: after } = await supabaseAdmin
      .from('placement_results')
      .select('placement')
      .eq('test_id', testId);

    const stillPending = (after || []).some((r) => r.placement === 'pending');
    if (!stillPending) {
      await supabaseAdmin
        .from('placement_tests')
        .update({ status: 'complete', completed_at: new Date().toISOString() })
        .eq('id', testId);
    }
  },

  /** Every test still being looked for, oldest poll first. */
  async due(limit = 10) {
    const { data } = await supabaseAdmin
      .from('placement_tests')
      .select('id')
      .in('status', ['sending', 'waiting'])
      .order('last_polled_at', { ascending: true, nullsFirst: true })
      .limit(limit);
    return (data || []).map((t) => t.id);
  },
};

async function markResult(
  id: string, placement: ProbePlacement, folder: string | null, sendError: string | null,
): Promise<void> {
  await supabaseAdmin
    .from('placement_results')
    .update({
      placement,
      folder,
      send_error: sendError,
      found_at: placement === 'inbox' || placement === 'spam' ? new Date().toISOString() : null,
    })
    .eq('id', id);
}

/**
 * The subject and body to test.
 *
 * Taken from a real campaign step wherever possible, because the whole
 * value of this is testing the message that will actually go out. A
 * hand-typed probe measures a message nobody will ever receive.
 */
async function resolveContent(
  userId: string,
  input: { campaign_id?: string | null; step_id?: string | null; subject?: string; body_html?: string },
): Promise<{ subject: string; bodyHtml: string | null }> {
  if (input.step_id) {
    const { data: step } = await supabaseAdmin
      .from('campaign_steps')
      .select('subject, body_html, campaign_id, campaigns!inner(user_id)')
      .eq('id', input.step_id)
      .maybeSingle();
    // The join is the tenant check: a step id from another account returns
    // nothing rather than somebody else's copy.
    if (step && (step as any).campaigns?.user_id === userId) {
      return { subject: step.subject || '', bodyHtml: step.body_html || null };
    }
  }
  return {
    subject: (input.subject || '').trim(),
    bodyHtml: (input.body_html || '').trim() || null,
  };
}

/**
 * Walk a seed mailbox looking for one message.
 *
 * Searched by Message-ID and by the custom header, because a provider that
 * rewrites one still carries the other. INBOX and the junk folder are
 * checked first - they are the answer in almost every case, and reaching
 * them early means a mailbox with two hundred folders is not walked in
 * full for nothing.
 */
async function findProbe(
  seed: SeedRow, token: string,
): Promise<{ folder: string; kind: ReturnType<typeof classifyFolder> } | null> {
  const host = imapHostFor(seed);
  const ip = await resolveHostIp(host).catch(() => null);

  const client = new ImapFlow({
    host: ip || host,
    port: seed.imap_port || 993,
    secure: seed.imap_secure !== false,
    servername: host,
    auth: {
      user: seed.imap_user || seed.smtp_user || seed.email_address,
      pass: decrypt(seed.smtp_pass_encrypted),
    },
    logger: false,
    emitLogs: false,
  });

  let timeoutId: ReturnType<typeof setTimeout>;
  await Promise.race([
    client.connect(),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('IMAP connection timed out')), CONNECT_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timeoutId!));

  try {
    let boxes: Array<{ path: string; specialUse?: string }> = [];
    try {
      boxes = (await client.list()) as any[];
    } catch {
      // A server that will not list still has an INBOX worth checking.
      boxes = [{ path: 'INBOX' }];
    }

    const ranked = [...boxes].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_FOLDERS_SEARCHED);

    for (const box of ranked) {
      let lock: { release: () => void } | null = null;
      try {
        lock = await client.getMailboxLock(box.path);
        const hits = await client.search({
          or: [
            { header: { 'message-id': token } },
            { header: { 'x-sincerely-placement': token } },
          ],
        } as any);
        if (hits && (hits as number[]).length > 0) {
          return { folder: box.path, kind: classifyFolder(box.path, box.specialUse) };
        }
      } catch {
        // A folder that refuses to open or search is skipped rather than
        // failing the whole probe - one broken folder must not make a
        // delivered message look missing.
      } finally {
        lock?.release();
      }
    }

    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}

/** INBOX first, junk second, everything else after. */
function rank(box: { path: string; specialUse?: string }): number {
  const kind = classifyFolder(box.path, box.specialUse);
  if (kind === 'inbox') return 0;
  if (kind === 'spam') return 1;
  return 2;
}

export type { MailProvider };

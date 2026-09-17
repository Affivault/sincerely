/* ═══════════════════════════════════════════════════════════════════════
   Correcting a mail server address the app itself got wrong.

   The Add Mailbox form used to fill in `imap.<domain>` for any provider it
   had no preset for. For a hosted mailbox that name does not exist - the
   mailboxes live on the provider's hostname - so accounts were saved
   pointing at a host that had never existed, and the only sign of it was a
   sync error days later telling the account holder to check a value they
   had never typed.

   Discovery stops new accounts being created that way. It does nothing for
   the ones already saved, and telling somebody to go and edit three
   mailboxes by hand to undo a mistake the software made is not a fix.

   ── The rule that makes this safe ────────────────────────────────────────

   Only a host that DOES NOT RESOLVE is ever replaced.

   That is the whole safety argument, and it is worth being precise about:
   a name that returns NXDOMAIN cannot be connected to by anybody, from
   anywhere, ever. It is not a host that is down, or firewalled, or slow. It
   is not a name. So there is no working configuration to destroy, and no
   judgement call about whether the stored value might have been right after
   all.

   A host that resolves is left alone even when discovery is certain it has
   a better one. Wrong-looking is not the same as impossible, and quietly
   rewriting settings somebody may have entered deliberately is how software
   loses the right to touch them at all.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { resolveDetailed } from './domain.service.js';
import { discoverMailHosts } from './mail-discovery.service.js';

export interface HostRepair {
  repaired: boolean;
  from: string | null;
  to: string | null;
  /** Said to the account holder. Always explains what was changed and why. */
  note: string;
}

const NOT_REPAIRED = (note: string): HostRepair => ({ repaired: false, from: null, to: null, note });

/**
 * Is this name definitively absent from DNS?
 *
 * Deliberately strict. An unreachable resolver, a SERVFAIL, or a name that
 * exists without an A record all return false - the point is to be certain
 * before touching anything, and "we could not tell" is not certain.
 */
async function definitelyMissing(host: string): Promise<boolean> {
  const [a, cname] = await Promise.all([
    resolveDetailed(host, 'A'),
    resolveDetailed(host, 'CNAME'),
  ]);
  return a.status === 'nxdomain' && cname.status === 'nxdomain';
}

/**
 * Repair one account's IMAP host if, and only if, the stored one does not
 * exist. Returns what happened, in words fit to show somebody.
 */
export async function repairImapHost(account: {
  id: string;
  user_id: string;
  email_address: string;
  imap_host: string | null;
  imap_port: number | null;
}): Promise<HostRepair> {
  const current = (account.imap_host || '').trim();
  if (!current) return NOT_REPAIRED('No IMAP server is set on this mailbox.');

  // An IP address is somebody's deliberate choice and has no DNS name to be
  // missing. Never touched.
  if (/^[0-9.]+$/.test(current) || current.includes(':')) {
    return NOT_REPAIRED('This mailbox points at a fixed address, so it was left alone.');
  }

  if (!await definitelyMissing(current)) {
    return NOT_REPAIRED(
      `"${current}" exists in DNS, so it was left alone. If it is the wrong `
      + 'server, change it by hand - this only replaces names that do not exist.',
    );
  }

  const domain = (account.email_address.split('@')[1] || '').toLowerCase();
  const found = await discoverMailHosts(domain);

  if (!found.imap) {
    return NOT_REPAIRED(
      `"${current}" does not exist, and no mailbox server could be found for `
      + `${domain} either. Copy the IMAP server from your provider's settings page.`,
    );
  }

  if (found.imap.host.toLowerCase() === current.toLowerCase()) {
    // Discovery found the same dead name. It cannot be the answer.
    return NOT_REPAIRED(`"${current}" does not exist and no working alternative was found.`);
  }

  const { error } = await supabaseAdmin
    .from('smtp_accounts')
    .update({
      imap_host: found.imap.host,
      imap_port: account.imap_port || found.imap.port,
      imap_secure: found.imap.secure,
      // The stored failure described the old host, so it is no longer true.
      last_inbox_sync_error: null,
    })
    .eq('id', account.id)
    .eq('user_id', account.user_id);

  if (error) return NOT_REPAIRED(`Could not save the corrected server: ${error.message}`);

  return {
    repaired: true,
    from: current,
    to: found.imap.host,
    note: `"${current}" does not exist in DNS - it was never a real server. `
      + `Changed to ${found.imap.host}, which is where ${domain} keeps its `
      + 'mail. Your password was not touched.',
  };
}

/** Repair every mailbox on an account. Returns one line per mailbox. */
export async function repairAllImapHosts(userId: string): Promise<{
  repaired: number;
  results: Array<{ email_address: string } & HostRepair>;
}> {
  const { data, error } = await supabaseAdmin
    .from('smtp_accounts')
    .select('id, user_id, email_address, imap_host, imap_port')
    .eq('user_id', userId);

  if (error || !data) return { repaired: 0, results: [] };

  const results = [];
  for (const account of data) {
    const outcome = await repairImapHost(account as any);
    results.push({ email_address: account.email_address, ...outcome });
  }

  return { repaired: results.filter((r) => r.repaired).length, results };
}

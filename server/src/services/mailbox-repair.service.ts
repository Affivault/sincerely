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
import { isSenderMismatch } from '@lemlist/shared';

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

/* ═══════════════════════════════════════════════════════════════════════
   A mailbox signing in as one of its neighbours.

   The form used to pin the sign-in username to whatever address was typed
   first, so correcting the From address left the old username behind. The
   result is a row that sends as invest@ while authenticating as
   acquisitions@, which the server refuses:

     553 5.7.1 <invest@...>: Sender address rejected:
               not owned by user acquisitions@...

   The form no longer creates these. That does nothing for the ones already
   saved, and "go and edit the username on each mailbox" is asking somebody
   to clean up after the software.

   ── What can and cannot be repaired ───────────────────────────────────────

   The username can. The password cannot, and being honest about that is the
   whole of this function: the stored password belongs to the OTHER mailbox,
   because that is the account it has been successfully signing into. Fixing
   the username therefore breaks the sign-in, on purpose - the alternative is
   leaving a mailbox that sends as the wrong identity and reads the wrong
   inbox.

   So the row is also marked unverified, which is simply true, and the note
   says in plain words that the mailbox now needs its own password. A repair
   that quietly left `is_verified` set would be claiming something it had
   just stopped being able to demonstrate.
   ═══════════════════════════════════════════════════════════════════════ */
export async function repairSenderIdentity(account: {
  id: string;
  user_id: string;
  email_address: string;
  smtp_user: string | null;
  imap_user: string | null;
}): Promise<HostRepair> {
  const address = (account.email_address || '').trim();
  if (!isSenderMismatch(account.smtp_user, address)) {
    return NOT_REPAIRED('This mailbox signs in as itself.');
  }

  const wrong = (account.smtp_user || '').trim();
  const patch: Record<string, any> = {
    smtp_user: address,
    /*
     * The password almost certainly belongs to the other mailbox - that is
     * why the sign-in was working. Saying "verified" after changing the
     * username would be asserting something we have just made untestable.
     */
    is_verified: false,
  };

  // An IMAP login pointing at the same wrong address is the half that reads
  // somebody else's inbox, so it goes with it.
  if (isSenderMismatch(account.imap_user, address)) patch.imap_user = address;

  const { error } = await supabaseAdmin
    .from('smtp_accounts')
    .update(patch)
    .eq('id', account.id)
    .eq('user_id', account.user_id);

  if (error) return NOT_REPAIRED(`Could not save the corrected username: ${error.message}`);

  return {
    repaired: true,
    from: wrong,
    to: address,
    note: `This mailbox was signing in as ${wrong}, which is why the server `
      + `refused to let it send as ${address} - and why it was reading `
      + `${wrong}'s inbox rather than its own. The username is now ${address}. `
      + `You will need to enter ${address}'s own password, because the saved `
      + `one belongs to ${wrong}.`,
  };
}

/** Repair every mailbox on an account. Returns one line per mailbox. */
export async function repairMailboxes(userId: string): Promise<{
  repaired: number;
  results: Array<{ email_address: string } & HostRepair>;
}> {
  const { data, error } = await supabaseAdmin
    .from('smtp_accounts')
    .select('id, user_id, email_address, imap_host, imap_port, smtp_user, imap_user')
    .eq('user_id', userId);

  if (error || !data) return { repaired: 0, results: [] };

  const results = [];
  for (const account of data) {
    /*
     * Identity first. A mailbox signing in as its neighbour is reading the
     * wrong inbox right now, which is worse than an unreachable host - that
     * one merely fails.
     */
    const identity = await repairSenderIdentity(account as any);
    if (identity.repaired) {
      results.push({ email_address: account.email_address, ...identity });
      continue;
    }

    const host = await repairImapHost(account as any);
    // Report whichever finding is actually useful rather than the last one
    // that ran: "signs in as itself" is noise beside a dead IMAP host.
    results.push({
      email_address: account.email_address,
      ...(host.repaired || !identity.repaired ? host : identity),
    });
  }

  return { repaired: results.filter((r) => r.repaired).length, results };
}

/** Kept for callers that only want the host half. */
export const repairAllImapHosts = repairMailboxes;

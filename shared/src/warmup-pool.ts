/* ═══════════════════════════════════════════════════════════════════════
   Who a warm-up email should be sent to, and whether it is worth sending
   at all.

   ── Why the old answer was close to worthless ────────────────────────────

   Peers were drawn from the sender's OWN account and picked at random. For
   an account with three mailboxes on one domain at one provider, that means
   scott@yieldstones.co.uk mailing invest@yieldstones.co.uk on Spacemail -
   which is internal delivery. It may never leave the provider's network at
   all, and it certainly never reaches Gmail, Outlook or Yahoo.

   Reputation is not a single global number. It is held per sending domain
   BY EACH RECEIVING PROVIDER. If nothing you send ever arrives at Gmail,
   Gmail learns nothing about you, and the warm-up has taught the only
   audiences that matter precisely nothing. The dashboard said "Warming 3 of
   3" throughout.

   ── What the tools that work actually do ─────────────────────────────────

   A pool spanning many customers and many providers. MailReach publishes a
   figure around 80,000 accounts; Lemwarm uses the lemlist user base. The
   property they are buying is DIVERSITY - mail arriving at Gmail from many
   different senders, and at Outlook, and at Yahoo - because that is what
   produces a signal at the providers whose opinion decides where your real
   mail lands.

   ── And the part the marketing pages leave out ───────────────────────────

   Since roughly 2024 Gmail and Outlook increasingly detect these networks:
   repetitive bodies, mechanical timing, the same accounts engaging with
   each other forever. Detected signals are discounted or ignored, and
   domains on nothing but automated warm-up are reported plateauing at
   "medium" reputation. Warm-up pools still help. They help a great deal
   less than they did, and they are not what makes the difference.

   What does, on the evidence, is unglamorous: authenticate the domain, ramp
   volume slowly (5-10 a day in week one, full volume around week four),
   keep bounces low, and earn real replies. A hundred emails with no replies
   is itself a negative signal; twenty with ten replies is a strong positive
   one.

   So this module does two things. It ranks peers so that the most EXTERNAL
   one available is chosen rather than a random one, and it grades the pool
   honestly so the product can stop claiming a warm-up is working when it
   is only talking to itself.
   ═══════════════════════════════════════════════════════════════════════ */

export type PoolQuality = 'none' | 'internal' | 'same-provider' | 'mixed';

export interface WarmupPeer {
  id: string;
  email_address: string;
  /** The sending host, used as a cheap stand-in for "which provider". */
  smtp_host?: string | null;
}

const domainOf = (email: string) => (email.split('@')[1] || '').toLowerCase();

/**
 * The provider a mailbox sends through, roughly.
 *
 * Taken from the SMTP host rather than an MX lookup, because this runs on
 * every warm-up tick and the precision is not needed: all it has to decide
 * is whether two mailboxes are at the same place. smtp.spacemail.com and
 * smtp.gmail.com differ; that is the whole question.
 */
export function providerOf(peer: WarmupPeer): string {
  const host = (peer.smtp_host || '').toLowerCase().replace(/\.$/, '');
  if (!host) return domainOf(peer.email_address);
  const parts = host.split('.').filter(Boolean);
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

/**
 * How useful a warm-up send to this peer would be.
 *
 * 2  a different provider entirely - the only kind that teaches a receiving
 *    provider anything it did not already know
 * 1  a different domain at the same provider - leaves the mailbox, but the
 *    receiving side is the same company that already trusts you
 * 0  the same domain - frequently internal delivery, seen by nobody
 */
export function peerValue(sender: WarmupPeer, peer: WarmupPeer): 0 | 1 | 2 {
  if (domainOf(peer.email_address) === domainOf(sender.email_address)) return 0;
  return providerOf(peer) === providerOf(sender) ? 1 : 2;
}

/**
 * Peers in the order they are worth sending to.
 *
 * `seed` rotates the choice within a value band. Random selection is what
 * produces the repetitive patterns these networks are detected by, and
 * "always the first one" is worse still - a deterministic rotation spreads
 * the sends evenly without being predictable-looking to a filter.
 */
export function rankPeers<T extends WarmupPeer>(sender: WarmupPeer, peers: T[], seed: number): T[] {
  const usable = peers.filter((p) => p.id !== sender.id);
  const banded = new Map<number, T[]>();
  for (const p of usable) {
    const v = peerValue(sender, p);
    if (!banded.has(v)) banded.set(v, []);
    banded.get(v)!.push(p);
  }
  const out: T[] = [];
  for (const value of [2, 1, 0]) {
    const band = banded.get(value) || [];
    if (band.length === 0) continue;
    const start = ((seed % band.length) + band.length) % band.length;
    out.push(...band.slice(start), ...band.slice(0, start));
  }
  return out;
}

/**
 * What this pool can and cannot achieve, so the product can say so.
 *
 * The old summary reported a peer count and nothing else, which let three
 * mailboxes on one domain read as a working warm-up. A count is not a
 * quality.
 */
export function poolQuality(sender: WarmupPeer, peers: WarmupPeer[]): PoolQuality {
  const values = peers.filter((p) => p.id !== sender.id).map((p) => peerValue(sender, p));
  if (values.length === 0) return 'none';
  if (values.some((v) => v === 2)) return 'mixed';
  if (values.some((v) => v === 1)) return 'same-provider';
  return 'internal';
}

export const POOL_QUALITY_NOTE: Record<PoolQuality, string> = {
  none: 'Warm-up has nowhere to send. It needs at least one other connected mailbox.',
  internal:
    'Every mailbox here is on the same domain, so warm-up mail never leaves your provider. '
    + 'Gmail, Outlook and Yahoo decide where your real mail lands, and none of them ever see it. '
    + 'Connect a mailbox on a different provider, or rely on the volume ramp instead.',
  'same-provider':
    'All these mailboxes are at the same provider. The mail leaves each one, but the receiving '
    + 'side is a company that already trusts you, so it teaches Gmail and Outlook little.',
  mixed:
    'Mail is going to more than one provider, which is what builds a reputation worth having. '
    + 'The volume ramp and real replies still matter more than this does.',
};

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

/* ─── The shared network ──────────────────────────────────────────────── */

/**
 * Whether a Message-ID is one of ours.
 *
 * Every warm-up email and every warm-up reply is sent as <wu-TOKEN@domain>.
 * Once mailboxes from different accounts warm each other, that mail lands
 * in somebody else's inbox, and the inbox sync must never put it in their
 * Unibox or treat it as a prospect replying.
 */
export function isWarmupMessageId(messageId: string | null | undefined): boolean {
  return /^<?wu-[0-9a-f]{8,}@/i.test(String(messageId || '').trim());
}

/** The most warm-up mail one mailbox takes from the network in a day. */
export const NETWORK_DAILY_RECEIVE_CAP = 15;

/** A network peer that is bouncing this much is left out until it recovers. */
export const NETWORK_MAX_BOUNCE_RATE = 0.05;

export interface NetworkCandidate extends WarmupPeer {
  user_id: string;
  warmup_network?: boolean | null;
  autopilot_state?: string | null;
  bounce_rate_7d?: number | string | null;
}

/**
 * Whether a mailbox from another account may receive network warm-up mail.
 *
 * It has to have joined, and it has to be in a state where mail arriving
 * from strangers does it no harm and tells the sender something true: not
 * resting after receivers refused it, and not bouncing.
 */
export function networkEligible(peer: NetworkCandidate): boolean {
  if (!peer.warmup_network) return false;
  if ((peer.autopilot_state || 'active') === 'resting') return false;
  const rate = Number(peer.bounce_rate_7d);
  // Stored either as a fraction or as a percentage, depending on its age.
  const fraction = Number.isFinite(rate) ? (rate > 1 ? rate / 100 : rate) : 0;
  return fraction <= NETWORK_MAX_BOUNCE_RATE;
}

/**
 * A rotation seed that moves day to day and mailbox to mailbox.
 *
 * The send count alone restarts at zero every morning, so in a large network
 * every mailbox would mail the same handful of peers each day: exactly the
 * "same accounts engaging with each other forever" pattern providers detect.
 */
export function rotationSeed(senderId: string, sentToday: number, now = new Date()): number {
  const day = Math.floor(now.getTime() / 86_400_000);
  let h = 2166136261;
  for (const ch of `${senderId}:${day}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return (h % 100_000) + sentToday;
}

/* ─── What warm-up mail says ──────────────────────────────────────────── */

const W_SUBJECTS = [
  'Quick question', 'Following up', 'Thoughts on this?', 'The plan for next week',
  'Coffee sometime?', 'Loved your update', 'Checking in', 'An idea', 'Free on Thursday?',
  'Notes from earlier', 'One more thing', 'Great catching up', 'Small favour',
  'That article', 'Next steps', 'Before Friday', 'Re-sending this', 'Weekend plans',
  'Your recommendation', 'Did this come through?', 'Timing', 'Book suggestion',
];
const W_OPENERS = [
  'Hi {first},', 'Hey {first},', 'Hello {first},', 'Morning {first},', '{first},',
];
const W_OPENERS_NO_NAME = ['Hi,', 'Hey,', 'Hello,', 'Hi there,', 'Morning,'];
const W_MIDDLES = [
  'Hope the week is treating you well so far.',
  'Thanks again for the note earlier, it was useful.',
  'Just circling back on what we talked about.',
  'I had a think about your suggestion and I like it.',
  'Quick one while I remember.',
  'I finally got round to reading the piece you mentioned.',
  'It was good to catch up the other day.',
  'Sorry this took me a while to get to.',
  'I spoke to the team and everyone is on board.',
  'I have been meaning to ask you about this for a few days.',
];
const W_ASKS = [
  'Could you send over the details when you have a minute?',
  'Does next Tuesday or Wednesday work better for you?',
  'Let me know what you think, no rush at all.',
  'Happy to jump on a short call if that is easier.',
  'Shall I pencil something in for later this month?',
  'Would you be up for grabbing a coffee soon?',
  'Any chance you could take a look before the weekend?',
  'I will put a draft together and share it shortly.',
  'Keen to hear how it went on your side.',
];
const W_SIGNOFFS = ['Thanks,', 'Cheers,', 'Best,', 'Speak soon,', 'Thanks again,', 'All the best,', 'Talk soon,'];
const W_REPLIES = [
  'Thanks for this, makes sense. I will take a look and come back to you.',
  'Appreciate the note. All good on my end, speak soon.',
  'Got it, thank you. Let us catch up properly next week.',
  'Sounds great, count me in.',
  'Perfect, that works for me. Thanks for following up.',
  'Good shout. Tuesday suits me, I will send an invite.',
  'Thanks, that is really helpful. I will share it with the others.',
  'Yes, happy to. Give me a day or two.',
  'Just seen this, thanks. I will get back to you tomorrow.',
  'Love it. Let us do it.',
];

export interface WarmupMessage { subject: string; body: string }

// Shared inboxes, not people: "Hi Info," reads as exactly what it is.
const ROLE_NAMES = new Set([
  'info', 'hello', 'hi', 'contact', 'sales', 'support', 'admin', 'team', 'office', 'mail',
  'enquiries', 'inquiries', 'noreply', 'no', 'help', 'accounts', 'billing', 'marketing', 'invest',
  'partners', 'press', 'jobs', 'careers', 'hr', 'ops', 'outreach', 'founders',
]);
const firstNameOf = (name: string | null | undefined, email: string): string => {
  const fromName = String(name || '').trim().split(/\s+/)[0];
  if (fromName && /^[A-Za-z][A-Za-z'-]{1,20}$/.test(fromName) && !ROLE_NAMES.has(fromName.toLowerCase())) return fromName;
  const local = (email.split('@')[0] || '').split(/[._-]/)[0].toLowerCase();
  return /^[a-z]{2,20}$/.test(local) && !ROLE_NAMES.has(local) ? local[0].toUpperCase() + local.slice(1) : 'there';
};

/**
 * A warm-up email put together from parts.
 *
 * Six fixed bodies sent across a whole network are the most recognisable
 * thing a warm-up can do. Pieced together, there are thousands of
 * combinations, each addressed to the person and signed by the sender.
 */
export function composeWarmupMessage(
  sender: { from_name?: string | null; label?: string | null; email_address: string },
  recipient: { from_name?: string | null; email_address: string },
  rand: () => number = Math.random,
): WarmupMessage {
  const pickOne = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length) % arr.length];
  const first = firstNameOf(recipient.from_name, recipient.email_address);
  const me = firstNameOf(sender.from_name, sender.email_address);
  const opener = first === 'there' ? pickOne(W_OPENERS_NO_NAME) : pickOne(W_OPENERS).replace('{first}', first);
  const lines = [opener, '', pickOne(W_MIDDLES) + ' ' + pickOne(W_ASKS), '', pickOne(W_SIGNOFFS)];
  if (me !== 'there') lines.push(me);
  return { subject: pickOne(W_SUBJECTS), body: lines.join('\n') };
}

/** A short warm-up reply, signed by whoever is replying. */
export function composeWarmupReply(
  replier: { from_name?: string | null; label?: string | null; email_address: string },
  rand: () => number = Math.random,
): string {
  const me = firstNameOf(replier.from_name, replier.email_address);
  const text = W_REPLIES[Math.floor(rand() * W_REPLIES.length) % W_REPLIES.length];
  return me === 'there' ? text : `${text}\n\n${me}`;
}

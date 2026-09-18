/* ═══════════════════════════════════════════════════════════════════════
   Warming against yourself teaches nobody anything.

   Peers were drawn from the sender's own account and picked at random. For
   three mailboxes on one domain at one provider that means
   scott@yieldstones.co.uk mailing invest@yieldstones.co.uk on Spacemail -
   internal delivery, which may never leave the provider's network and
   certainly never reaches Gmail, Outlook or Yahoo.

   Reputation is held per sending domain BY EACH RECEIVING PROVIDER. If
   nothing ever arrives at Gmail, Gmail learns nothing. The dashboard
   reported "Warming 3 of 3" the whole time.

   The fixtures are that account.

   Run: npx tsx scripts/warmup-pool-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const here = dirname(fileURLToPath(import.meta.url));
const { peerValue, rankPeers, poolQuality, providerOf } = await import('@lemlist/shared');

/** The real account: three mailboxes, one domain, one provider. */
const scott = { id: 'a', email_address: 'scott@yieldstones.co.uk', smtp_host: 'smtp.spacemail.com' };
const invest = { id: 'b', email_address: 'invest@yieldstones.co.uk', smtp_host: 'smtp.spacemail.com' };
const acq = { id: 'c', email_address: 'acquisitions@yieldstones.co.uk', smtp_host: 'smtp.spacemail.com' };

// What a useful pool looks like by comparison.
const gmail = { id: 'd', email_address: 'alex@example.com', smtp_host: 'smtp.gmail.com' };
const otherSpacemail = { id: 'e', email_address: 'sam@northbeam.example', smtp_host: 'smtp.spacemail.com' };

console.log('\nhow much a warm-up send is actually worth');
{
  is('a mailbox on the same domain is worth nothing',
     peerValue(scott, invest) === 0, String(peerValue(scott, invest)));
  is('a different domain at the same provider is worth something',
     peerValue(scott, otherSpacemail) === 1, String(peerValue(scott, otherSpacemail)));
  is('a different provider is worth the most',
     peerValue(scott, gmail) === 2, String(peerValue(scott, gmail)));

  // The provider is read off the sending host, which is enough to tell two
  // mailboxes apart without a DNS lookup on every tick.
  is('the provider is derived from the SMTP host',
     providerOf(scott) === 'spacemail.com', providerOf(scott));
  is('and falls back to the address domain when there is no host',
     providerOf({ id: 'x', email_address: 'a@acme.example' }) === 'acme.example');
}

console.log('\nthe pool this account actually has');
{
  const pool = [scott, invest, acq];
  is('three mailboxes on one domain is an internal pool',
     poolQuality(scott, pool) === 'internal', poolQuality(scott, pool));
  is('which is NOT reported the same as a working one',
     poolQuality(scott, pool) !== 'mixed');

  is('one mailbox and no peers has nowhere to send',
     poolQuality(scott, [scott]) === 'none');
  is('a second provider makes it mixed',
     poolQuality(scott, [scott, invest, gmail]) === 'mixed');
  is('a second domain at the same provider is better, but not mixed',
     poolQuality(scott, [scott, invest, otherSpacemail]) === 'same-provider');
}

console.log('\nthe most external peer is chosen, not a random one');
{
  /*
   * The old code called pick() on the sender's own mailboxes, so with a
   * Gmail peer available it would still pick a same-domain one two times
   * in three.
   */
  const ranked = rankPeers(scott, [invest, acq, otherSpacemail, gmail], 0);
  is('a different provider comes first', ranked[0].id === gmail.id, ranked[0].email_address);
  is('then a different domain', ranked[1].id === otherSpacemail.id, ranked[1].email_address);
  is('and same-domain peers come last',
     [ranked[2].id, ranked[3].id].every((id) => id === invest.id || id === acq.id),
     ranked.map((r) => r.email_address).join(', '));
  is('the sender is never its own peer',
     !rankPeers(scott, [scott, invest], 0).some((p) => p.id === scott.id));
  is('and nothing is dropped', ranked.length === 4, String(ranked.length));
}

console.log('\nthe choice rotates rather than repeating');
{
  /*
   * Repetition is one of the patterns these networks are detected by, and
   * "always the first peer in the list" is the most repetitive thing there
   * is. The seed moves the starting point within each value band.
   */
  const peers = [invest, acq];
  const first = rankPeers(scott, peers, 0)[0].id;
  const second = rankPeers(scott, peers, 1)[0].id;
  is('consecutive sends do not go to the same peer', first !== second, `${first} then ${second}`);
  is('and it comes back round', rankPeers(scott, peers, 2)[0].id === first);
  is('a negative seed does not break the rotation',
     !!rankPeers(scott, peers, -1)[0], 'a negative modulo produced no peer');
}

console.log('\nthe send path uses the ranking, and the panel says what the pool is worth');
{
  const svc = readFileSync(join(here, '../src/services/warmup.service.ts'), 'utf8');
  const panel = readFileSync(join(here, '../../client/src/pages/smtp/WarmupPanel.tsx'), 'utf8');

  is('the recipient comes from the ranking', /const ranked = rankPeers\(sender, all/.test(svc),
     'peers are still being picked at random');
  is('and not from pick()', !/const recipient = pick\(peers\)/.test(svc));
  is('peers carry their SMTP host, or the provider cannot be told',
     /select\('id, user_id, email_address, smtp_host'\)/.test(svc));

  is('the summary grades the pool, not just counts it', /pool_quality: best/.test(svc));
  is('the panel says so when the pool cannot help',
     /data-pool-quality/.test(panel), 'a useless pool still reads as a working warm-up');
  is('and points at the ramp, which is the part with evidence behind it',
     /daily ramp below works regardless/.test(panel));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
assert.equal(fail, 0, `${fail} warm-up pool check(s) failed`);

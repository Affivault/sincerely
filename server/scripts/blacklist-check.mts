/*
 * Blacklist monitoring.
 *
 * The trap this pins down: on several lists "I won't answer you" looks
 * exactly like "listed" (a 127.x address). Spamhaus refuses public
 * resolvers with 127.255.255.x, URIBL and SURBL refuse with 127.0.0.1.
 * Reading those as listings would tell every user their domain is
 * blacklisted.
 */
process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const { readBlocklistAnswer, blocklistQuery, BLOCKLISTS, isSharedMailHost, judgeSendingHealth } = await import('@lemlist/shared');
const { lookupTarget, summarise } = await import('../src/services/blacklist.service.js');

console.log('\nReading an answer');
{
  is('NXDOMAIN is clean', readBlocklistAnswer('spamcop', 'nxdomain', []) === 'clean');
  is('no answer at all is unchecked', readBlocklistAnswer('spamcop', 'unreachable', []) === 'unchecked');
  is('SpamCop 127.0.0.2 is listed', readBlocklistAnswer('spamcop', 'records', ['127.0.0.2']) === 'listed');
  is('Spamhaus refusing a public resolver is NOT listed', readBlocklistAnswer('spamhaus-zen', 'records', ['127.255.255.254']) === 'unchecked');
  is('Spamhaus DBL refusing is NOT listed', readBlocklistAnswer('spamhaus-dbl', 'records', ['127.255.255.252']) === 'unchecked');
  is('ZEN 127.0.0.4 (XBL) is listed', readBlocklistAnswer('spamhaus-zen', 'records', ['127.0.0.4']) === 'listed');
  is('DBL 127.0.1.2 is listed', readBlocklistAnswer('spamhaus-dbl', 'records', ['127.0.1.2']) === 'listed');
  is('DBL bad query is not', readBlocklistAnswer('spamhaus-dbl', 'records', ['127.0.1.255']) === 'unchecked');
  is('URIBL refusing (127.0.0.1) is NOT listed', readBlocklistAnswer('uribl', 'records', ['127.0.0.1']) === 'unchecked');
  is('URIBL black (127.0.0.2) is listed', readBlocklistAnswer('uribl', 'records', ['127.0.0.2']) === 'listed');
  is('SURBL refusing is NOT listed', readBlocklistAnswer('surbl', 'records', ['127.0.0.1']) === 'unchecked');
  is('Mailspike reputation grades are not listings', readBlocklistAnswer('mailspike', 'records', ['127.0.0.17']) === 'clean');
  is('a non-127 answer is unchecked (a hijacking resolver)', readBlocklistAnswer('psbl', 'records', ['93.184.216.34']) === 'unchecked');
}

console.log('\nWhat is looked up');
{
  const zen = BLOCKLISTS.find((l) => l.id === 'spamhaus-zen')!;
  const dbl = BLOCKLISTS.find((l) => l.id === 'spamhaus-dbl')!;
  is('an IP is reversed', blocklistQuery('1.2.3.4', zen) === '4.3.2.1.zen.spamhaus.org');
  is('a domain is as is', blocklistQuery('Acme.com', dbl) === 'acme.com.dbl.spamhaus.org');
  is('a DQS key moves Spamhaus to its zone', blocklistQuery('1.2.3.4', zen, 'KEY') === '4.3.2.1.KEY.zen.dq.spamhaus.net');
  is('IPv6 is skipped, not mangled', blocklistQuery('2001:db8::1', zen) === null);
  is('Gmail and Microsoft servers are not checked', isSharedMailHost('smtp.gmail.com') && isSharedMailHost('smtp.office365.com') && !isSharedMailHost('mail.acme.com'));
}

console.log('\nA lookup and its summary');
{
  const asked: string[] = [];
  const fake = async (name: string) => {
    asked.push(name);
    // Every list reports its own test entry, as a live list does.
    if (/^2\.0\.0\.127\./.test(name) || /^(dbltest\.com|test\.surbl\.org|test\.uribl\.com)\./.test(name)) {
      return { status: 'records', records: [name.includes('dbltest') ? '127.0.1.2' : '127.0.0.2'] } as any;
    }
    if (name.endsWith('.bl.spamcop.net')) return { status: 'records', records: ['127.0.0.2'] } as any;
    if (name.endsWith('.zen.spamhaus.org')) return { status: 'records', records: ['127.255.255.254'] } as any;
    return { status: 'nxdomain', records: [] } as any;
  };
  const ip = await lookupTarget('5.6.7.8', 'ip', fake);
  const dom = await lookupTarget('acme.com', 'domain', fake);
  is('every IP list is asked', asked.filter((n) => n.startsWith('8.7.6.5.')).length === BLOCKLISTS.filter((l) => l.kind === 'ip').length);
  const dead = await lookupTarget('acme.com', 'domain', async () => ({ status: 'nxdomain', records: [] }) as any);
  is('a resolver that says NXDOMAIN to everything is not "clean"', dead.readings.every((r) => r.reading === 'unchecked'), JSON.stringify(dead.readings));
  const s = summarise([dom, ip], '5.6.7.8');
  is('the SpamCop listing is found', s.listed.length === 1 && s.listed[0].list === 'SpamCop' && s.listed[0].target === '5.6.7.8');
  is('Spamhaus refusing is reported as unanswered', s.unchecked.includes('Spamhaus ZEN') && !s.listed.some((h) => h.list === 'Spamhaus ZEN'));
  is('checked when anything answered', s.checked && s.checked_count === 7, String(s.checked_count));

  const good: any = {
    is_active: true, is_verified: true, last_send_error: null, created_at: '2026-01-01T00:00:00Z', daily_send_limit: 30, gap_min: 120, gap_max: 300,
    warmup_on: true, autopilot_state: 'active', autopilot_reason: null, sent_14d: 100, bounced_14d: 0, blocked_14d: 0, complained_14d: 0,
    domain: { domain: 'acme.com', domain_id: 'd', checked: true, spf: true, dkim: true, dmarc: true, last_checked_at: null }, placement: { test_id: 't', at: '', verdict: 'good', inbox_rate: 1, headline: '' },
  };
  is('clean lists leave a healthy mailbox healthy', judgeSendingHealth({ ...good, blacklists: summarise([dom], null) }).status === 'healthy');
  const v = judgeSendingHealth({ ...good, blacklists: s });
  is('a listing puts it at risk', v.status === 'at_risk' && /SpamCop/.test(v.reason), v.reason);
  is('with the removal page as the next step', v.next_step.kind === 'delist' && v.next_step.url === 'https://www.spamcop.net/bl.shtml');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

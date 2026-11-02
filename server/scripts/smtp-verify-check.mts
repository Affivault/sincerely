/*
 * Our own mailbox check, against a fake mail server and a fake SOCKS5 proxy.
 *
 * Pins down what Reacher's SMTP proxy advice asks of a verifier:
 *
 *   - it can go through a SOCKS5 proxy, with or without a login
 *   - it introduces itself and sends from the configured domain
 *   - a domain that accepts every address (catch-all) is never "valid"
 *   - a refusal aimed at us (blocklist, reputation, policy, rate limit)
 *     never marks an address as bad; only "no such mailbox" does
 *   - an old server that only speaks HELO still gets a verdict
 *   - no message is ever sent (no DATA)
 */
process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.VERIFY_HELO_NAME = 'verify.example.net';

import net from 'node:net';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const { classifyRcpt, smtpConversation, smtpRoute } = await import('../src/services/verification.service.js');
const { connectViaSocks5, parseSocks5Url } = await import('../src/utils/socks5.js');

/* A scripted mail server: replies chosen per command, everything said recorded. */
type Script = { greeting?: string; ehlo?: string; helo?: string; mail?: string; rcpt?: (to: string) => string };
function fakeSmtp(script: Script): Promise<{ port: number; said: string[]; close: () => void }> {
  const said: string[] = [];
  const server = net.createServer((sock) => {
    sock.write(script.greeting ?? '220-mx.test ESMTP\r\n220 ready\r\n');
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\r\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        said.push(line);
        const cmd = line.split(/[ :]/)[0].toUpperCase();
        if (cmd === 'EHLO') sock.write(script.ehlo ?? '250-mx.test\r\n250 8BITMIME\r\n');
        else if (cmd === 'HELO') sock.write(script.helo ?? '250 mx.test\r\n');
        else if (cmd === 'MAIL') sock.write(script.mail ?? '250 OK\r\n');
        else if (cmd === 'RCPT') sock.write(script.rcpt ? script.rcpt(line.match(/<(.*)>/)?.[1] || '') : '250 OK\r\n');
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('500 what\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ port: (server.address() as any).port, said, close: () => server.close() })));
}

const talk = async (script: Script, email = 'ada@acme.test') => {
  const srv = await fakeSmtp(script);
  const sock = net.connect(srv.port, '127.0.0.1');
  await new Promise((r) => sock.once('connect', r));
  const v = await smtpConversation(sock, email, { timeoutMs: 3000 });
  srv.close();
  return { v, said: srv.said };
};

const realOnly = (to: string) => (to.startsWith('ada@') ? '250 2.1.5 OK\r\n' : '550 5.1.1 User unknown\r\n');

console.log('\nWhat a reply to RCPT TO means');
{
  is('250 is a yes', classifyRcpt(250, 'OK').ok && classifyRcpt(250, 'OK').checked);
  is('550 5.1.1 is no such mailbox', !classifyRcpt(550, '5.1.1 The email account that you tried to reach does not exist').ok);
  const spam = classifyRcpt(550, '5.7.1 Service unavailable; client host [1.2.3.4] blocked using Spamhaus');
  is('a blocklist refusal is about us, not the address', spam.ok && !spam.checked, JSON.stringify(spam));
  const policy = classifyRcpt(554, '5.7.1 Message rejected due to local policy');
  is('a policy refusal is unchecked', policy.ok && !policy.checked);
  is('a bare 550 still means no mailbox', !classifyRcpt(550, 'Requested action not taken').ok && classifyRcpt(550, '').checked);
  is('greylisting (451) is unchecked', classifyRcpt(451, '4.7.1 Greylisted, try again').checked === false);
  is('mailbox full exists', classifyRcpt(452, '4.2.2 Mailbox full').checked && classifyRcpt(452, 'Mailbox full').ok);
  is('too many recipients is about us', !classifyRcpt(452, '4.5.3 Too many recipients').checked);
}

console.log('\nA conversation with a mail server');
{
  const { v, said } = await talk({ rcpt: realOnly });
  is('a real mailbox on a strict domain is valid and checked', v.ok && v.checked && v.catch_all === false, JSON.stringify(v));
  is('introduces itself with the configured name', said[0] === 'EHLO verify.example.net', said[0]);
  is('sends from the same domain', said[1] === 'MAIL FROM:<verify@verify.example.net>', said[1]);
  is('then tests an address nobody has', said.filter((l) => l.startsWith('RCPT')).length === 2 && /sincerely-check-/.test(said[3] || ''));
  is('never sends a message', !said.some((l) => /^DATA/i.test(l)));
  is('route reports the HELO and sender', smtpRoute().helo === 'verify.example.net' && smtpRoute().via === 'direct');
}
{
  const { v } = await talk({ rcpt: () => '250 OK\r\n' });
  is('a catch-all domain is not confirmed', v.ok && !v.checked && v.catch_all === true, JSON.stringify(v));
}
{
  const { v, said } = await talk({ rcpt: () => '550 5.1.1 <ada@acme.test>: Recipient address rejected: User unknown\r\n' });
  is('no such mailbox is invalid and checked', !v.ok && v.checked, JSON.stringify(v));
  is('and no catch-all test is spent on it', said.filter((l) => l.startsWith('RCPT')).length === 1);
}
{
  const { v } = await talk({ greeting: '554 5.7.1 Your IP is listed on Spamhaus\r\n' });
  is('a refused greeting never marks the address bad', v.ok && !v.checked && v.reachable, JSON.stringify(v));
}
{
  const { v } = await talk({ mail: '550 5.7.1 Sender rejected\r\n' });
  is('a refused sender never marks the address bad', v.ok && !v.checked, JSON.stringify(v));
}
{
  const { v } = await talk({ rcpt: () => '550 5.7.1 Access denied, banned sender IP\r\n' });
  is('a reputation block at RCPT is unchecked', v.ok && !v.checked, JSON.stringify(v));
}
{
  const { v, said } = await talk({ ehlo: '502 Command not implemented\r\n', rcpt: realOnly });
  is('an old server falls back to HELO', said.includes('HELO verify.example.net') && v.ok && v.checked, JSON.stringify(v));
}
{
  const { v } = await talk({ rcpt: () => '450 4.2.0 Greylisted, please try again\r\n' });
  is('greylisting is no verdict', v.ok && !v.checked);
}

console.log('\nThrough a SOCKS5 proxy');
{
  is('a socks5 URL is read', JSON.stringify(parseSocks5Url('socks5://u%40x:p@proxy.test:1085')) === JSON.stringify({ host: 'proxy.test', port: 1085, username: 'u@x', password: 'p' }));
  is('a bare host:port is read', parseSocks5Url('1.2.3.4:1080')?.port === 1080);
  is('an http proxy is refused (SMTP cannot go through one)', parseSocks5Url('http://proxy.test:8080') === null);
  is('unset is null', parseSocks5Url('') === null);

  // A fake proxy: checks the login, then joins the client to the target.
  const seen: { user?: string; pass?: string; host?: string; port?: number } = {};
  const proxy = net.createServer((c) => {
    let stage = 0;
    let buf = Buffer.alloc(0);
    c.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 0 && buf.length >= 3) { c.write(Buffer.from([5, buf.includes(2) ? 2 : 0])); stage = buf.includes(2) ? 1 : 2; buf = Buffer.alloc(0); return; }
      if (stage === 1 && buf.length >= 2) {
        const ul = buf[1]; const user = buf.subarray(2, 2 + ul).toString(); const pl = buf[2 + ul]; const pass = buf.subarray(3 + ul, 3 + ul + pl).toString();
        seen.user = user; seen.pass = pass;
        c.write(Buffer.from([1, user === 'me' && pass === 'secret' ? 0 : 1]));
        if (user !== 'me') return c.end();
        stage = 2; buf = Buffer.alloc(0); return;
      }
      if (stage === 2 && buf.length >= 7) {
        const atyp = buf[3];
        let host = '', at = 4;
        if (atyp === 1) { host = [...buf.subarray(4, 8)].join('.'); at = 8; }
        else if (atyp === 3) { host = buf.subarray(5, 5 + buf[4]).toString(); at = 5 + buf[4]; }
        const port = buf.readUInt16BE(at);
        seen.host = host; seen.port = port;
        stage = 3;
        const up = net.connect(port, '127.0.0.1', () => {
          c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          up.pipe(c); c.pipe(up);
        });
        up.on('error', () => c.end());
      }
    });
    c.on('error', () => {});
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
  const proxyPort = (proxy.address() as any).port;

  const srv = await fakeSmtp({ rcpt: realOnly });
  const sock = await connectViaSocks5({ host: '127.0.0.1', port: proxyPort, username: 'me', password: 'secret' }, '127.0.0.1', srv.port, 3000);
  const v = await smtpConversation(sock, 'ada@acme.test', { timeoutMs: 3000 });
  is('the login is sent', seen.user === 'me' && seen.pass === 'secret');
  is('the proxy is asked for the mail server', seen.host === '127.0.0.1' && seen.port === srv.port);
  is('and the check comes back through it', v.ok && v.checked, JSON.stringify(v));
  srv.close();

  let refused = '';
  try { await connectViaSocks5({ host: '127.0.0.1', port: proxyPort, username: 'wrong', password: 'x' }, '127.0.0.1', 25, 3000); }
  catch (e: any) { refused = e.message; }
  is('a wrong login is an error, not a verdict', /rejected/.test(refused), refused);

  const srv2 = await fakeSmtp({ rcpt: realOnly });
  const sock2 = await connectViaSocks5({ host: '127.0.0.1', port: proxyPort, username: 'me', password: 'secret' }, 'localhost', srv2.port, 3000);
  await smtpConversation(sock2, 'ada@acme.test', { timeoutMs: 3000 });
  is('a hostname target goes to the proxy by name', seen.host === 'localhost');
  srv2.close();
  proxy.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

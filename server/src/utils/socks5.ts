import net from 'net';

/*
 * A minimal SOCKS5 client (RFC 1928, with RFC 1929 username/password), for
 * the one job that needs it: reaching a mail server on port 25 from a host
 * that blocks it.
 *
 * Mailbox checks are a short SMTP conversation, and SMTP cannot go through an
 * HTTP proxy. Render and most cloud hosts block outbound port 25, and the mail
 * servers that matter judge the caller's IP reputation, so the advice from
 * people who run verification at scale (Reacher's proxy guide among them) is
 * a SOCKS5 proxy on IPs kept clean for exactly this. Written out here rather
 * than pulled in as a dependency: it is a few dozen lines and one round trip.
 */

export interface Socks5Proxy {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/** Parse socks5://user:pass@host:port (socks5h:// is accepted too). Null when unset or malformed. */
export function parseSocks5Url(raw: string | undefined | null): Socks5Proxy | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  let url: URL;
  try { url = new URL(text.includes('://') ? text : `socks5://${text}`); } catch { return null; }
  if (!/^socks5h?:$/.test(url.protocol) || !url.hostname) return null;
  const port = Number(url.port || 1080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

const REPLY_ERRORS: Record<number, string> = {
  1: 'general failure',
  2: 'connection not allowed by the proxy',
  3: 'network unreachable',
  4: 'host unreachable',
  5: 'connection refused',
  6: 'TTL expired',
  7: 'command not supported',
  8: 'address type not supported',
};

/**
 * Open a TCP connection to host:port through the proxy. Resolves with the
 * socket once the proxy says it is connected, ready for the target's own
 * protocol (the SMTP greeting is the next thing to arrive).
 */
export function connectViaSocks5(proxy: Socks5Proxy, host: string, port: number, timeoutMs = 10_000): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.host);
    let buf: Buffer = Buffer.alloc(0);
    let stage: 'greeting' | 'auth' | 'connect' = 'greeting';
    const auth = !!(proxy.username || proxy.password);

    const fail = (message: string) => {
      clearTimeout(timer);
      socket.removeAllListeners('data');
      socket.destroy();
      reject(new Error(`SOCKS5 proxy: ${message}`));
    };
    const timer = setTimeout(() => fail('timed out'), timeoutMs);

    socket.once('connect', () => {
      // Offer only what we can do: no auth, or username/password.
      socket.write(Buffer.from(auth ? [0x05, 0x01, 0x02] : [0x05, 0x01, 0x00]));
    });
    socket.on('error', (err) => fail(err.message));

    const sendConnect = () => {
      stage = 'connect';
      const isIp = net.isIP(host);
      let addr: Buffer;
      if (isIp === 4) addr = Buffer.from([0x01, ...host.split('.').map(Number)]);
      else if (isIp === 6) {
        const full = expandIpv6(host);
        addr = Buffer.concat([Buffer.from([0x04]), Buffer.from(full, 'hex')]);
      } else {
        const name = Buffer.from(host);
        if (name.length > 255) return fail('hostname too long');
        addr = Buffer.concat([Buffer.from([0x03, name.length]), name]);
      }
      const portBuf = Buffer.from([(port >> 8) & 0xff, port & 0xff]);
      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00]), addr, portBuf]));
    };

    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greeting') {
        if (buf.length < 2) return;
        const method = buf[1];
        buf = buf.subarray(2);
        if (method === 0x00) return sendConnect();
        if (method === 0x02 && auth) {
          stage = 'auth';
          const user = Buffer.from(proxy.username || '');
          const pass = Buffer.from(proxy.password || '');
          if (user.length > 255 || pass.length > 255) return fail('username or password too long');
          socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
          return;
        }
        return fail('no acceptable login method');
      }
      if (stage === 'auth') {
        if (buf.length < 2) return;
        const ok = buf[1] === 0x00;
        buf = buf.subarray(2);
        if (!ok) return fail('username or password rejected');
        return sendConnect();
      }
      // connect reply: VER REP RSV ATYP BND.ADDR BND.PORT
      if (buf.length < 5) return;
      if (buf[1] !== 0x00) return fail(REPLY_ERRORS[buf[1]] || `error ${buf[1]}`);
      const atyp = buf[3];
      const len = atyp === 0x01 ? 4 : atyp === 0x04 ? 16 : atyp === 0x03 ? 1 + buf[4] : -1;
      if (len < 0) return fail('bad reply');
      const total = 4 + len + 2;
      if (buf.length < total) return;
      clearTimeout(timer);
      socket.removeAllListeners('data');
      socket.removeAllListeners('error');
      // Held until the caller is listening, so the greeting can't slip past.
      socket.pause();
      const rest = buf.subarray(total);
      // Anything the target already sent (its greeting) is handed back.
      if (rest.length) socket.unshift(rest);
      resolve(socket);
    });
  });
}

function expandIpv6(ip: string): string {
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = ip.includes('::') ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((g) => g.padStart(4, '0')).join('');
}

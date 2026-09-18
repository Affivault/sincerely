import net from 'net';
import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { resolveHostIp } from '../utils/dns-doh.js';
import { describeSmtpError, postToRelay } from './email-sender.service.js';
import type { DiagStage, SmtpDiagnostics, ImapDiagnostics, MailboxDiagnostics } from '@lemlist/shared';

/**
 * Staged SMTP connection diagnostics.
 *
 * "Connection timed out" is useless on its own — it's the same message whether
 * the hostname is wrong, the credentials are bad, or (most often on managed
 * hosts like Render/Railway) the platform blocks outbound SMTP ports entirely.
 *
 * Running the connection in stages tells them apart definitively:
 *   1. DNS  — can we resolve the host at all? (over DoH, since host DNS is unreliable)
 *   2. TCP  — can a raw socket reach host:port? A timeout HERE, with DNS fine,
 *             is proof the port is blocked — no SMTP setting can fix it.
 *   3. TLS/greeting — does a mail server actually answer and say hello?
 *   4. Auth — do the credentials work?
 */

/** Raw TCP reachability probe. This is the stage that proves port blocking. */
function probeTcp(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; error?: string; code?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result: { ok: boolean; error?: string; code?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done({ ok: true }));
    socket.once('timeout', () => done({ ok: false, error: 'timed out', code: 'ETIMEDOUT' }));
    socket.once('error', (err: any) => done({ ok: false, error: err.message, code: err.code }));
    socket.connect(port, host);
  });
}

/**
 * Probe the SMTP relay without sending anything.
 *
 * The relay checks the bearer secret BEFORE it validates the payload, so an
 * authenticated POST with an empty body must come back 400 ("missing required
 * fields") — which proves the endpoint is deployed AND the secret matches. A
 * 401 means the two secrets differ; 404/HTML means the URL is wrong.
 */
/**
 * Is the relay's sibling /api/health function deployed?
 *
 * This is what separates "SMTP_RELAY_URL has the wrong path" from "no
 * serverless functions are deployed at all" — the latter is what happens when
 * the Vercel project's Root Directory points at a subfolder, so the repo-root
 * api/ folder is never part of the build.
 */
async function probeRelayHealth(url: string): Promise<boolean | null> {
  const healthUrl = url.replace(/\/api\/send-email\/?$/, '/api/health');
  if (healthUrl === url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
    return res.status === 200;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeRelay(): Promise<{ ok: boolean; detail: string }> {
  const url = env.SMTP_RELAY_URL!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const { response: res, finalUrl, redirected } = await postToRelay(url, '{}', controller.signal);
    // Redirects matter enough to name in every verdict: a *.vercel.app alias
    // 308s to the project's custom domain, which is an origin change, which
    // means a browser-spec fetch would have silently dropped the bearer token.
    const hop = redirected ? ` (SMTP_RELAY_URL redirects to ${finalUrl})` : '';
    if (res.status === 400) {
      return {
        ok: true,
        detail: redirected
          ? `Relay is live and the secret matches, but SMTP_RELAY_URL redirects to ${finalUrl} — set it to that address directly.`
          : `Relay is live and the secret matches (${url})`,
      };
    }
    if (res.status === 401) return { ok: false, detail: `Relay rejected the secret — SMTP_RELAY_SECRET differs between this server and the relay host${hop}` };
    if (res.status === 404) {
      const health = await probeRelayHealth(finalUrl);
      if (health === true) {
        return { ok: false, detail: `/api/health answers on that deployment but ${finalUrl} is a 404 — SMTP_RELAY_URL has the wrong path. It must end in /api/send-email.` };
      }
      if (health === false) {
        return { ok: false, detail: `Neither ${finalUrl} nor /api/health exists on that deployment — no serverless functions are live there. Confirm SMTP_RELAY_URL points at the Vercel project holding this repo, and that its latest production build succeeded, then redeploy.` };
      }
      return { ok: false, detail: `Nothing deployed at ${finalUrl} — check SMTP_RELAY_URL points at /api/send-email${hop}` };
    }
    if (res.status === 405) return { ok: false, detail: `${url} exists but doesn't accept POST — check the URL points at /api/send-email` };
    if (res.status === 500) {
      // The relay returns 500 specifically when its own secret env var is unset.
      const body = await res.text().catch(() => '');
      if (body.includes('SMTP_RELAY_SECRET')) return { ok: false, detail: 'Relay is deployed but has no SMTP_RELAY_SECRET set on its own host' };
      return { ok: false, detail: `Relay returned HTTP 500 (${url})` };
    }
    return { ok: false, detail: `Relay returned an unexpected HTTP ${res.status}` };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return { ok: false, detail: aborted ? `Relay did not respond within 8s (${url})` : `Relay unreachable: ${err?.message || 'network error'}` };
  } finally {
    clearTimeout(timer);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   The same staircase, pointed at the mailbox server.

   Diagnostics covered sending only. That is the leg that tends to work -
   it is proven the moment a campaign goes out - while the failure people
   actually hit is the other one: mail sends fine, replies never arrive.
   Pressing "find out exactly why" then ran a diagnosis of the half that was
   already healthy and reported everything green, which is worse than having
   no button at all, because it looks like an answer.

   Four stages, same as SMTP, because the same four things can be wrong and
   they need telling apart:

     DNS   the name does not exist - which is how this whole thread started
     TCP   the name resolves but nothing accepts a socket on 993
     TLS   something answers but does not greet as an IMAP server
     LOGIN the server is there and the credentials are refused
   ═══════════════════════════════════════════════════════════════════════ */
async function diagnoseImap(input: {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}): Promise<ImapDiagnostics> {
  const { host } = input;
  const port = input.port || 993;
  const stages: DiagStage[] = [];

  // ── Stage 1: does the name exist? ──
  let t0 = Date.now();
  const ip = await resolveHostIp(host).catch(() => null);
  if (!ip) {
    stages.push(
      { id: 'dns', label: 'Find the mailbox server', status: 'fail', detail: `${host} does not resolve`, ms: Date.now() - t0 },
      { id: 'tcp', label: `Reach port ${port}`, status: 'skipped', detail: 'Skipped - no address to reach' },
      { id: 'tls', label: 'IMAP greeting', status: 'skipped', detail: 'Skipped - no address to reach' },
      { id: 'auth', label: 'Sign in', status: 'skipped', detail: 'Skipped - no address to reach' },
    );
    return {
      host, port, stages, portBlocked: false,
      verdict: `"${host}" is not a name that exists in DNS, so nothing can connect to it.`,
      fix: 'Copy the IMAP server from your provider\'s settings page. It is often not imap.<your domain> - a hosted mailbox lives on the provider\'s hostname.',
    };
  }
  stages.push({ id: 'dns', label: 'Find the mailbox server', status: 'ok', detail: `${host} resolves to ${ip}`, ms: Date.now() - t0 });

  // ── Stage 2: raw reachability, which is what proves a port block ──
  t0 = Date.now();
  const tcp = await probeTcp(ip, port, 8000);
  if (!tcp.ok) {
    const blocked = tcp.code === 'ETIMEDOUT';
    stages.push(
      { id: 'tcp', label: `Reach port ${port}`, status: 'fail', detail: tcp.error || 'could not connect', ms: Date.now() - t0 },
      { id: 'tls', label: 'IMAP greeting', status: 'skipped', detail: 'Skipped - port unreachable' },
      { id: 'auth', label: 'Sign in', status: 'skipped', detail: 'Skipped - port unreachable' },
    );
    return {
      host, port, stages, portBlocked: blocked,
      verdict: blocked
        ? `${host} resolves, but nothing answers on port ${port} within 8 seconds.`
        : `${host} resolves, but the connection to port ${port} was refused.`,
      fix: blocked
        ? 'Either this server\'s host blocks outbound IMAP, or the port is wrong. 993 is IMAP over SSL; 143 is plain or STARTTLS.'
        : `Nothing is listening on ${port}. Check the port with your provider - 993 for SSL, 143 otherwise.`,
    };
  }
  stages.push({ id: 'tcp', label: `Reach port ${port}`, status: 'ok', detail: 'Port is open', ms: Date.now() - t0 });

  // ── Stages 3 and 4: greeting, then credentials ──
  let ImapFlow: any;
  try {
    ({ ImapFlow } = await import('imapflow'));
  } catch {
    stages.push(
      { id: 'tls', label: 'IMAP greeting', status: 'skipped', detail: 'Skipped - IMAP module unavailable on this server' },
      { id: 'auth', label: 'Sign in', status: 'skipped', detail: 'Skipped - IMAP module unavailable on this server' },
    );
    return {
      host, port, stages, portBlocked: false,
      verdict: 'The server is reachable, but this API cannot load its IMAP client to go further.',
      fix: 'Install imapflow on the API server.',
    };
  }

  if (!input.pass) {
    stages.push(
      { id: 'tls', label: 'IMAP greeting', status: 'skipped', detail: 'Skipped - no password to test with' },
      { id: 'auth', label: 'Sign in', status: 'skipped', detail: 'Skipped - no password to test with' },
    );
    return {
      host, port, stages, portBlocked: false,
      verdict: `${host}:${port} is reachable. The credentials were not tested.`,
      fix: 'Enter the mailbox password to test the sign-in as well.',
    };
  }

  t0 = Date.now();
  const client = new ImapFlow({
    host: ip, port, secure: input.secure, servername: host,
    auth: { user: input.user || '', pass: input.pass },
    logger: false,
    connectionTimeout: 9000, greetingTimeout: 7000, socketTimeout: 10000,
  });

  try {
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('IMAP connect timed out')), 11000); }),
    ]).finally(() => clearTimeout(timer!));
    await client.logout().catch(() => {});

    stages.push(
      { id: 'tls', label: 'IMAP greeting', status: 'ok', detail: 'The server greeted us', ms: Date.now() - t0 },
      { id: 'auth', label: 'Sign in', status: 'ok', detail: `Signed in as ${input.user}` },
    );
    return {
      host, port, stages, portBlocked: false,
      verdict: 'Receiving works. This mailbox can be read.',
      fix: '',
    };
  } catch (err: any) {
    try { await client.close?.(); } catch { /* ignore */ }
    const raw = String(err?.message || err);

    /*
     * A refused sign-in is a different problem from a refused connection,
     * and conflating them is what sends somebody to re-check a hostname
     * that was right all along.
     */
    const isAuth = /auth|invalid credentials|login failed|AUTHENTICATIONFAILED/i.test(raw);
    if (isAuth) {
      stages.push(
        { id: 'tls', label: 'IMAP greeting', status: 'ok', detail: 'The server greeted us', ms: Date.now() - t0 },
        { id: 'auth', label: 'Sign in', status: 'fail', detail: raw },
      );
      return {
        host, port, stages, portBlocked: false,
        verdict: `${host} is the right server and it is working - it refused the username or password.`,
        fix: `Check the username is the full address (${input.user || 'the mailbox address'}) and re-enter the password. `
          + 'Gmail and Outlook need an app password rather than the normal login; most other providers want the mailbox password itself.',
      };
    }

    const timedOut = /timed out|timeout/i.test(raw);
    stages.push(
      { id: 'tls', label: 'IMAP greeting', status: 'fail', detail: raw, ms: Date.now() - t0 },
      { id: 'auth', label: 'Sign in', status: 'skipped', detail: 'Skipped - no greeting' },
    );
    return {
      host, port, stages, portBlocked: false,
      verdict: timedOut
        ? `${host}:${port} accepted a connection but never greeted us as an IMAP server.`
        : `${host}:${port} answered, but not as an IMAP server this could talk to.`,
      fix: port === 993
        ? 'Port 993 requires SSL. Check SSL is on, or try 143 without it.'
        : 'Port 143 is plain or STARTTLS. If your provider wants SSL, use 993 instead.',
    };
  }
}

export const smtpDiagnosticsService = {
  /** Both legs, because "which one is broken" is the question being asked. */
  async diagnoseMailbox(input: {
    smtp_host: string;
    smtp_port: number;
    smtp_secure?: boolean;
    smtp_user?: string;
    smtp_pass?: string;
    imap_host?: string | null;
    imap_port?: number | null;
    imap_secure?: boolean | null;
    imap_user?: string | null;
  }): Promise<MailboxDiagnostics> {
    const smtp = await this.diagnose(input);

    const imapHost = String(input.imap_host || '').trim();
    if (!imapHost) return { smtp, imap: null };

    const imap = await diagnoseImap({
      host: imapHost,
      port: Number(input.imap_port) || 993,
      secure: input.imap_secure !== false,
      user: input.imap_user || input.smtp_user || undefined,
      pass: input.smtp_pass,
    });
    return { smtp, imap };
  },

  async diagnose(input: {
    smtp_host: string;
    smtp_port: number;
    smtp_secure?: boolean;
    smtp_user?: string;
    smtp_pass?: string;
  }): Promise<SmtpDiagnostics> {
    const host = String(input.smtp_host || '').trim();
    const port = Number(input.smtp_port) || 587;
    const secure = input.smtp_secure ?? port === 465;
    const stages: DiagStage[] = [];
    const relayConfigured = !!(env.SMTP_RELAY_URL && env.SMTP_RELAY_SECRET);

    // ── Stage 0: relay health ──
    // When a relay is configured it IS the send path, so its health matters
    // more than whether this box can reach port 587 directly.
    let relayHealthy: boolean | null = null;
    if (relayConfigured) {
      const t = Date.now();
      const relay = await probeRelay();
      relayHealthy = relay.ok;
      stages.push({
        id: 'relay',
        label: 'SMTP relay',
        status: relay.ok ? 'ok' : 'fail',
        detail: relay.detail,
        ms: Date.now() - t,
      });
    }

    if (!host) {
      return {
        host, port, stages,
        verdict: 'No SMTP host given.',
        portBlocked: false,
        relayConfigured,
        relayHealthy,
        fix: 'Enter the SMTP server address (e.g. smtp.gmail.com) and run the check again.',
      };
    }

    // ── Stage 1: DNS ──
    let t0 = Date.now();
    const ip = await resolveHostIp(host).catch(() => null);
    stages.push({
      id: 'dns',
      label: 'Resolve host',
      status: ip ? 'ok' : 'fail',
      detail: ip ? `${host} → ${ip}` : `Could not resolve ${host}`,
      ms: Date.now() - t0,
    });

    if (!ip) {
      stages.push(
        { id: 'tcp', label: 'Reach port', status: 'skipped', detail: 'Skipped — host could not be resolved' },
        { id: 'tls', label: 'Mail server handshake', status: 'skipped', detail: 'Skipped' },
        { id: 'auth', label: 'Sign in', status: 'skipped', detail: 'Skipped' },
      );
      return {
        host, port, stages,
        verdict: `The hostname "${host}" doesn't exist in DNS.`,
        portBlocked: false,
        relayConfigured,
        relayHealthy,
        fix: 'Check the SMTP server address for typos — most providers use something like smtp.yourprovider.com.',
      };
    }

    // ── Stage 2: raw TCP reachability ──
    // 6s is ample to tell "silently dropped" from "answered", and keeps the
    // whole staged probe (DNS + TCP + handshake) inside the client's 30s HTTP
    // budget even when every stage runs long.
    t0 = Date.now();
    const tcp = await probeTcp(ip, port, 6000);
    const tcpBlocked = !tcp.ok && (tcp.code === 'ETIMEDOUT' || tcp.error === 'timed out');
    stages.push({
      id: 'tcp',
      label: 'Reach port',
      status: tcp.ok ? 'ok' : 'fail',
      detail: tcp.ok
        ? `Port ${port} is open and reachable`
        : tcpBlocked
          ? `No response from port ${port} — the connection was silently dropped`
          : `Port ${port} refused the connection (${tcp.code || tcp.error})`,
      ms: Date.now() - t0,
    });

    if (!tcp.ok) {
      stages.push(
        { id: 'tls', label: 'Mail server handshake', status: 'skipped', detail: 'Skipped — port unreachable' },
        { id: 'auth', label: 'Sign in', status: 'skipped', detail: 'Skipped' },
      );
      // A silent drop (rather than an active refusal) after DNS resolved is the
      // signature of an egress firewall — i.e. the hosting platform, not the
      // mail provider, is the problem.
      if (tcpBlocked) {
        // With a healthy relay this is expected and harmless — the relay, not
        // this box, opens the SMTP connection. Say so plainly rather than
        // reporting a scary "blocked" verdict for a working setup.
        if (relayHealthy) {
          return {
            host, port, stages,
            verdict: `This server can't reach port ${port} directly, but that no longer matters — the relay is live and sends route through it.`,
            portBlocked: true,
            relayConfigured,
            relayHealthy,
            fix: 'Nothing to fix. If a send still fails, it will be the mailbox credentials or the provider, not the network.',
          };
        }
        return {
          host, port, stages,
          verdict: relayConfigured
            ? `Nothing answered on port ${port}, and the relay isn't working either — so there's currently no way out for mail.`
            : `DNS resolved fine, but nothing answered on port ${port} — this server's network is blocking outbound SMTP.`,
          portBlocked: true,
          relayConfigured,
          relayHealthy,
          fix: relayConfigured
            ? 'Fix the relay (see the SMTP relay line above) — it is the only send path while this host blocks the SMTP ports.'
            : 'Set SMTP_RELAY_URL and SMTP_RELAY_SECRET on this server to route sends through the bundled Vercel relay (api/send-email.ts) — Vercel allows outbound SMTP, your current host does not. No mailbox setting can fix this on its own.',
        };
      }
      return {
        host, port, stages,
        verdict: `Port ${port} actively refused the connection.`,
        portBlocked: false,
        relayConfigured,
        relayHealthy,
        fix: `The server is reachable but isn't listening on ${port}. Try 465 (SSL) or 587 (TLS) instead.`,
      };
    }

    // ── Stage 3 + 4: SMTP handshake and authentication ──
    const canAuth = !!(input.smtp_user && input.smtp_pass);
    const transporter = nodemailer.createTransport({
      host: ip,
      port,
      secure,
      tls: { servername: host },
      auth: canAuth ? { user: input.smtp_user!, pass: input.smtp_pass! } : undefined,
      connectionTimeout: 7000,
      greetingTimeout: 7000,
      socketTimeout: 9000,
    });

    t0 = Date.now();
    try {
      // verify() performs connect + greeting + (when auth is supplied) login.
      await transporter.verify();
      stages.push(
        { id: 'tls', label: 'Mail server handshake', status: 'ok', detail: `Mail server answered over ${secure ? 'SSL' : 'STARTTLS/plain'}`, ms: Date.now() - t0 },
        canAuth
          ? { id: 'auth', label: 'Sign in', status: 'ok', detail: 'Credentials accepted' }
          : { id: 'auth', label: 'Sign in', status: 'skipped', detail: 'No password supplied — connection reachable, credentials untested' },
      );
      return {
        host, port, stages,
        verdict: canAuth
          ? 'Everything works — this mailbox can send.'
          : 'The mail server is reachable. Add the password to test sign-in.',
        portBlocked: false,
        relayConfigured,
        relayHealthy,
        fix: canAuth ? 'No action needed.' : 'Enter the mailbox password and run the check again.',
      };
    } catch (err: any) {
      const raw = String(err?.message || '').toLowerCase();
      const isAuthError = raw.includes('auth') || raw.includes('535') || raw.includes('invalid login') || raw.includes('credentials') || raw.includes('username and password');
      // TCP already succeeded here, so the generic "your host may block SMTP"
      // advice would be actively misleading.
      const friendly = describeSmtpError(err, { withRelayHint: false });

      if (isAuthError) {
        stages.push(
          { id: 'tls', label: 'Mail server handshake', status: 'ok', detail: 'Mail server answered', ms: Date.now() - t0 },
          { id: 'auth', label: 'Sign in', status: 'fail', detail: friendly },
        );
        return {
          host, port, stages,
          verdict: 'The server is reachable, but the username/password was rejected.',
          portBlocked: false,
          relayConfigured,
        relayHealthy,
          fix: 'Gmail and Outlook require an app password (not your normal login). Check the username is the full email address.',
        };
      }

      stages.push(
        { id: 'tls', label: 'Mail server handshake', status: 'fail', detail: friendly, ms: Date.now() - t0 },
        { id: 'auth', label: 'Sign in', status: 'skipped', detail: 'Skipped — handshake failed' },
      );
      return {
        host, port, stages,
        verdict: `The port is open but the mail handshake failed — usually an SSL/TLS mismatch on port ${port}.`,
        portBlocked: false,
        relayConfigured,
        relayHealthy,
        fix: port === 465
          ? 'Port 465 requires SSL — make sure SSL (not STARTTLS) is selected.'
          : 'Port 587 requires STARTTLS — make sure SSL is switched off, or use port 465 with SSL.',
      };
    } finally {
      transporter.close();
    }
  },
};

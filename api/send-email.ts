import type { IncomingMessage, ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';
import nodemailer from 'nodemailer';

// Vercel serverless functions receive extended req/res objects
interface VercelReq extends IncomingMessage {
  method?: string;
  body?: any;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelRes extends ServerResponse {
  status(code: number): VercelRes;
  json(data: any): void;
}

/**
 * Vercel Serverless SMTP Relay
 *
 * Accepts email requests from the backend server and sends them
 * via SMTP. This bypasses Render's SMTP port block because Vercel
 * runs on AWS Lambda which allows outbound connections on all ports.
 *
 * POST /api/send-email
 * Authorization: Bearer <SMTP_RELAY_SECRET>
 */
export default async function handler(req: VercelReq, res: VercelRes) {
  // CORS headers for preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify shared secret
  const secret = process.env.SMTP_RELAY_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'SMTP_RELAY_SECRET not configured on Vercel' });
  }

  const rawAuth = req.headers.authorization;
  const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  const expected = `Bearer ${secret}`;
  // Constant-time comparison — this is a public, unauthenticated-by-default
  // endpoint that relays arbitrary SMTP credentials, so a naive `!==` string
  // compare would let an attacker brute-force SMTP_RELAY_SECRET one byte at
  // a time via response-timing differences.
  const authBuf = Buffer.from(authHeader || '');
  const expectedBuf = Buffer.from(expected);
  const authorized =
    authBuf.length === expectedBuf.length && timingSafeEqual(authBuf, expectedBuf);
  if (!authorized) {
    return res.status(401).json({ error: 'Unauthorized - check SMTP_RELAY_SECRET matches' });
  }

  const body = req.body || {};
  const {
    smtp_host,
    smtp_port,
    smtp_secure,
    smtp_user,
    smtp_pass,
    from,
    to,
    subject,
    html,
    text,
    message_id,
    headers,
    reply_to,
    timeout_ms,
  } = body;

  // Validate required fields
  if (!smtp_host || !smtp_port || !smtp_user || !smtp_pass || !from || !to || !subject) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: 'smtp_host, smtp_port, smtp_user, smtp_pass, from, to, subject',
      received: Object.keys(body),
    });
  }

  if (!html && !text) {
    return res.status(400).json({
      error: 'Email must have at least one of: html, text',
    });
  }

  const port = Number(smtp_port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return res.status(400).json({ error: 'smtp_port must be a valid port number' });
  }

  // This function's Vercel maxDuration is 30s (vercel.json). socketTimeout is
  // an *inactivity* timer that resets on every byte exchanged with a slow or
  // greylisting destination server, so per-phase nodemailer timeouts alone
  // can't guarantee we return before Vercel kills the function mid-flight —
  // and a kill after the destination already accepted the message causes the
  // caller (email-sender.service.ts) to treat it as a 5xx and resend via
  // direct SMTP, duplicating the send. Budget a real, enforced hard deadline
  // with headroom under 30s regardless of caller-supplied timeout_ms.
  const HARD_DEADLINE_MS = 24000;
  const budget = Math.min(Math.max(Number(timeout_ms) || 8000, 3000), 15000);

  try {
    const transporter = nodemailer.createTransport({
      host: smtp_host,
      port,
      secure: smtp_secure ?? false,
      auth: { user: smtp_user, pass: smtp_pass },
      connectionTimeout: budget,
      // Without greetingTimeout a wrong port/SSL combo waits the full socket
      // timeout for a banner that never comes — fail fast instead.
      greetingTimeout: budget,
      socketTimeout: budget,
    });

    // sendMail() establishes and validates the connection itself, so a
    // separate verify() call (which was doubling our exposure to the same
    // timeout budget) is redundant. Race it against the hard deadline so a
    // slow-but-still-active destination server can't push us past Vercel's
    // own function timeout.
    const info = await Promise.race([
      transporter.sendMail({
        from,
        to,
        subject,
        html: html || undefined,
        text: text || undefined,
        messageId: message_id || undefined,
        headers: headers || undefined,
        replyTo: reply_to || undefined,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('SMTP send exceeded relay deadline'), { code: 'ERELAYDEADLINE' })), HARD_DEADLINE_MS)
      ),
    ]);

    return res.status(200).json({
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    });
  } catch (err: any) {
    console.error('[SMTP Relay] Error:', err.message);
    return res.status(502).json({
      success: false,
      error: err.message,
      code: err.code || undefined,
    });
  }
}

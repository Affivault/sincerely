/* ═══════════════════════════════════════════════════════════════════════
   Emails about your own account - the Notifications switches, made real.

   See shared/notify for what each switch sends. This is the delivery:
   every event already goes through fireEvent, which hands it here; the
   rules decide whether it deserves an email, the account's switches
   decide whether it is wanted, and it goes from the account's own first
   connected mailbox to the address it signs in with.

   Marked with X-Sincerely-System so that, landing in a mailbox this
   platform syncs, it is never stored as mail or read as a reply.
   Best-effort throughout: a notification that cannot be sent is logged,
   never thrown into whatever raised the event.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import {
  notificationFor, REPLY_EMAILS_PER_HOUR, SYSTEM_MAIL_HEADER,
  type NotifyMail, type NotifySetting,
} from '@lemlist/shared';
import { sendViaSmtp, formatFromHeader } from './email-sender.service.js';
import { senderFor } from './booking-mail.service.js';
import { textToHtml } from '../utils/html.js';

const HOUR = 3_600_000;
/** userId|dedupeKey -> when it was last sent. */
const sentAt = new Map<string, number>();
/** userId -> send times of reply emails in the last hour. */
const replyTimes = new Map<string, number[]>();
const ownerEmails = new Map<string, { email: string | null; at: number }>();

async function ownerEmail(userId: string): Promise<string | null> {
  const hit = ownerEmails.get(userId);
  if (hit && Date.now() - hit.at < HOUR) return hit.email;
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId).catch(() => ({ data: null }) as any);
  const email = (data?.user?.email as string | undefined)?.trim() || null;
  ownerEmails.set(userId, { email, at: Date.now() });
  return email;
}

async function wants(userId: string, setting: NotifySetting): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .select('email_notifications, campaign_alerts, reply_notifications, weekly_digest')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return false;
  // No row yet: the defaults - on for everything except the digest.
  if (!data) return setting !== 'weekly_digest';
  return (data as any)[setting] === true;
}

function absolute(href: string | null): string | null {
  if (!href) return null;
  return `${env.CLIENT_URL.replace(/\/$/, '')}${href.startsWith('/') ? href : `/${href}`}`;
}

/** A line laid out as a label and a figure: "Sent        120". */
const COLUMN = /^[A-Za-z][A-Za-z ]{1,14} {2,}\S/;

function htmlFor(text: string, link: string | null, footer: string): string {
  const body = text.split(/\n{2,}/).map((p) => {
    const lines = p.split('\n');
    if (lines.every((l) => COLUMN.test(l))) {
      const rows = lines.map((l) => {
        const m = /^(.*?) {2,}(.*)$/.exec(l)!;
        return `<tr><td style="padding:2px 16px 2px 0;color:#52525b;">${textToHtml(m[1])}</td><td style="padding:2px 0;font-weight:600;">${textToHtml(m[2])}</td></tr>`;
      }).join('');
      return `<table style="border-collapse:collapse;margin:0 0 14px;font-size:14px;">${rows}</table>`;
    }
    const bullets = lines.filter((l) => l.startsWith('- '));
    if (bullets.length && bullets.length >= lines.length - 1) {
      const head = lines[0].startsWith('- ') ? '' : `<p style="margin:0 0 6px;font-weight:600;">${textToHtml(lines[0])}</p>`;
      return `${head}<ul style="margin:0 0 14px;padding-left:18px;">${bullets.map((b) => `<li>${textToHtml(b.slice(2))}</li>`).join('')}</ul>`;
    }
    return `<p style="margin:0 0 14px;">${textToHtml(p)}</p>`;
  }).join('');
  const button = link
    ? `<p style="margin:18px 0;"><a href="${link}" style="display:inline-block;padding:9px 16px;background:#5b5bf5;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;border-radius:6px;">Open in Sincerely</a></p>`
    : '';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#18181b;max-width:560px;">${body}${button}<p style="margin:24px 0 0;font-size:12px;color:#8a8a8a;">${textToHtml(footer)}</p></div>`;
}

/** Send one email to the account owner. Never throws. */
export async function sendToOwner(userId: string, mail: { subject: string; text: string; href: string | null; footer?: string }): Promise<boolean> {
  try {
    const [to, sender] = await Promise.all([ownerEmail(userId), senderFor(userId)]);
    if (!to || !sender) return false;
    const link = absolute(mail.href);
    const footer = mail.footer || 'You get this because it is switched on in Settings, Notifications.';
    await sendViaSmtp({
      smtpHost: sender.host,
      smtpPort: sender.port,
      smtpSecure: sender.secure,
      smtpUser: sender.user,
      smtpPass: sender.pass,
      // From your own mailbox, named so you can tell it from a prospect.
      from: formatFromHeader('Sincerely', sender.address),
      to,
      subject: mail.subject.slice(0, 180),
      text: `${mail.text}${link ? `\n\n${link}` : ''}\n\n${footer}`,
      html: htmlFor(mail.text, link, footer),
      headers: { [SYSTEM_MAIL_HEADER]: 'notice' },
      timeoutMs: 15_000,
    });
    return true;
  } catch (err: any) {
    console.warn(`[Notify] "${mail.subject}" for ${userId} not sent: ${err?.message || err}`);
    return false;
  }
}

/** Whether a mail may go now, recording it if so. */
function admit(userId: string, mail: NotifyMail, now = Date.now()): boolean {
  const key = `${userId}|${mail.dedupeKey}`;
  const last = sentAt.get(key);
  if (last && now - last < HOUR) return false;
  if (mail.setting === 'reply_notifications') {
    const recent = (replyTimes.get(userId) || []).filter((t) => now - t < HOUR);
    if (recent.length >= REPLY_EMAILS_PER_HOUR) return false;
    recent.push(now);
    replyTimes.set(userId, recent);
  }
  sentAt.set(key, now);
  if (sentAt.size > 5000) for (const [k, t] of sentAt) if (now - t > HOUR) sentAt.delete(k);
  return true;
}

/** Some events carry only ids; an email needs the campaign's name. */
async function withNames(userId: string, data: Record<string, any>): Promise<Record<string, any>> {
  const id = data.campaign?.id || data.campaign_id;
  if (!id || data.campaign?.name || data.campaign_name) return data;
  const { data: c } = await supabaseAdmin.from('campaigns').select('name').eq('id', id).eq('user_id', userId).maybeSingle();
  return c ? { ...data, campaign_name: (c as any).name } : data;
}

/** Called for every event fireEvent sees. */
export async function notifyForEvent(userId: string, event: string, data: Record<string, any>): Promise<void> {
  if (!notificationFor(event, data || {})) return;
  const mail = notificationFor(event, await withNames(userId, data || {}));
  if (!mail) return;
  if (!(await wants(userId, mail.setting))) return;
  if (!admit(userId, mail)) return;
  await sendToOwner(userId, mail);
}

/** For the Settings "send me a test" button. */
export async function sendTestNotification(userId: string): Promise<{ sent: boolean; to: string | null; from: string | null }> {
  const [to, sender] = await Promise.all([ownerEmail(userId), senderFor(userId)]);
  if (!to || !sender) return { sent: false, to, from: sender?.address || null };
  const sent = await sendToOwner(userId, {
    subject: 'Test: notifications from Sincerely',
    text: `This is what a notification looks like. They come from ${sender.address} to ${to}, which is the address you sign in with.`,
    href: '/settings?tab=notifications',
  });
  return { sent, to, from: sender.address };
}

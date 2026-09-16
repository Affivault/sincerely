import { supabaseAdmin } from '../config/supabase.js';
import { decrypt } from '../utils/encryption.js';
import { sendViaSmtp, formatFromHeader } from './email-sender.service.js';
import { buildIcs } from '@lemlist/shared';
import { env } from '../config/env.js';

/* ═══════════════════════════════════════════════════════════════════════
   The emails a booking sends.

   Four moments, and each one is somebody waiting to find out whether a
   thing happened: booked, moved, cancelled, and about to start.

   Three rules run through all of it.

   Nothing here may throw into the request. A booking that succeeded and an
   email that did not is a bad afternoon; a booking REFUSED because an SMTP
   host was slow is a lost meeting. Every send is wrapped, logged and
   swallowed.

   The times are written in the reader's own zone. The invitee booked in
   theirs and the organiser lives in theirs, so the same meeting is written
   twice, differently, on purpose - an email that quotes a time without
   saying whose clock it is on is how people miss meetings.

   And the calendar part travels inside the message. An .ics as a download
   link is a file somebody has to find, open and import. As a text/calendar
   alternative it is an invite Gmail and Outlook put in the diary from the
   preview pane.
   ═══════════════════════════════════════════════════════════════════════ */

/** Where the manage and booking pages live, for links inside an email. */
function appOrigin(): string {
  return (env.CLIENT_URL || 'https://app.usesincerely.com').replace(/\/+$/, '');
}

export interface BookingMailContext {
  userId: string;
  eventId: string;
  manageToken: string;
  start: Date;
  end: Date;
  durationMinutes: number;
  headline: string;
  organiser: string;
  inviteeName: string;
  inviteeEmail: string;
  inviteeTimezone: string;
  organiserTimezone: string;
  locationKind: string;
  confirmationNote?: string | null;
  inviteeMessage?: string | null;
  sequence: number;
  notifyOrganiser: boolean;
}

/** Long form, in a named zone, spelled out so nobody has to decode it. */
function when(at: Date, zone: string): string {
  try {
    const date = at.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zone,
    });
    const time = at.toLocaleTimeString('en-GB', {
      hour: 'numeric', minute: '2-digit', timeZone: zone,
    });
    return `${date} at ${time}`;
  } catch {
    return at.toISOString();
  }
}

/** Escaped for an HTML body. Anything a stranger typed passes through here. */
function esc(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LOCATION_LABEL: Record<string, string> = {
  video: 'Video call', phone: 'Phone call', in_person: 'In person', other: 'Details to follow',
};

/**
 * The mailbox a notification goes out from.
 *
 * The account's own, because a confirmation arriving from a no-reply
 * address the prospect has never seen is the one most likely to be filed as
 * spam - and because replying to it should reach a person. Null when there
 * is no usable mailbox, which the caller reports rather than hides.
 */
async function senderFor(userId: string): Promise<{
  host: string; port: number; secure: boolean; user: string; pass: string;
  from: string; address: string;
} | null> {
  const { data } = await supabaseAdmin
    .from('smtp_accounts')
    .select('smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass_encrypted, email_address, from_name, is_active')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data?.smtp_host || !data?.smtp_pass_encrypted) return null;

  let pass: string;
  try {
    pass = decrypt(data.smtp_pass_encrypted);
  } catch {
    // An undecryptable password is a configuration problem, not a booking
    // problem. Say so in the log and let the booking stand.
    console.error('[BookingMail] Could not decrypt the sending mailbox password');
    return null;
  }

  return {
    host: data.smtp_host,
    port: data.smtp_port ?? 587,
    secure: !!data.smtp_secure,
    user: data.smtp_user || data.email_address,
    pass,
    from: formatFromHeader(data.from_name, data.email_address),
    address: data.email_address,
  };
}

/** The shell every one of these emails sits in. Plain, legible, no images. */
function wrap(inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;padding:24px;">
${inner}
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #eeeeee;font-size:11px;color:#9b9b9b;">Scheduling by Sincerely</p>
</div></body></html>`;
}

function detailBlock(ctx: BookingMailContext, zone: string, struck = false): string {
  const style = struck ? 'text-decoration:line-through;color:#9b9b9b;' : 'color:#18181b;';
  return `<div style="margin:16px 0;padding:14px 16px;background:#fafafa;border:1px solid #eeeeee;border-radius:8px;">
  <p style="margin:0;font-size:15px;font-weight:600;${style}">${esc(when(ctx.start, zone))}</p>
  <p style="margin:4px 0 0;font-size:13px;color:#52525b;">${ctx.durationMinutes} minutes &middot; ${esc(LOCATION_LABEL[ctx.locationKind] || 'Meeting')}</p>
  <p style="margin:2px 0 0;font-size:12px;color:#9b9b9b;">Times shown in ${esc(zone.replace(/_/g, ' '))}</p>
</div>`;
}

function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;padding:9px 16px;background:#6366f1;color:#ffffff;font-size:13px;font-weight:500;text-decoration:none;border-radius:6px;">${esc(label)}</a>`;
}

/** Every send in this module goes through here, and none of them throws. */
async function deliver(userId: string, message: {
  to: string; subject: string; html: string; text: string; replyTo?: string;
  ics?: { method: 'REQUEST' | 'CANCEL'; content: string };
}): Promise<boolean> {
  try {
    const sender = await senderFor(userId);
    if (!sender) {
      console.warn(`[BookingMail] No active mailbox for ${userId}; "${message.subject}" not sent`);
      return false;
    }
    await sendViaSmtp({
      smtpHost: sender.host,
      smtpPort: sender.port,
      smtpSecure: sender.secure,
      smtpUser: sender.user,
      smtpPass: sender.pass,
      from: sender.from,
      to: message.to,
      replyTo: message.replyTo || sender.address,
      subject: message.subject,
      html: message.html,
      text: message.text,
      icsEvent: message.ics,
      // A notification nobody is watching must not hold a socket open for
      // half a minute; the booking has already been made either way.
      timeoutMs: 15000,
    });
    return true;
  } catch (err: any) {
    console.error(`[BookingMail] "${message.subject}" failed: ${err?.message || err}`);
    return false;
  }
}

function icsFor(ctx: BookingMailContext, cancelled: boolean) {
  return {
    method: (cancelled ? 'CANCEL' : 'REQUEST') as 'REQUEST' | 'CANCEL',
    content: buildIcs({
      uid: `${ctx.manageToken}@sincerely`,
      start: ctx.start,
      end: ctx.end,
      title: ctx.headline,
      description: `With ${ctx.organiser}.`,
      location: LOCATION_LABEL[ctx.locationKind] || 'Meeting',
      organiser: ctx.organiser,
      attendeeEmail: ctx.inviteeEmail,
      cancelled,
      sequence: ctx.sequence,
    }),
  };
}

export const bookingMail = {
  /**
   * Booked.
   *
   * Two emails: the invitee gets the invite, the account gets told. Sent in
   * parallel because neither depends on the other and the caller is a
   * request somebody is waiting on.
   */
  async confirmed(ctx: BookingMailContext): Promise<{ invitee: boolean; organiser: boolean }> {
    const manage = `${appOrigin()}/booking/${ctx.manageToken}`;

    const inviteeHtml = wrap(`
<p style="margin:0;font-size:17px;font-weight:600;color:#18181b;">You are booked in</p>
<p style="margin:6px 0 0;font-size:14px;color:#52525b;">${esc(ctx.headline)} with ${esc(ctx.organiser)}.</p>
${detailBlock(ctx, ctx.inviteeTimezone)}
${ctx.confirmationNote ? `<p style="margin:0 0 16px;font-size:13px;color:#52525b;white-space:pre-line;">${esc(ctx.confirmationNote)}</p>` : ''}
${button(manage, 'Change or cancel')}
<p style="margin:14px 0 0;font-size:12px;color:#9b9b9b;">The invitation is attached, so it should already be in your calendar. Keep this email if you need to move it later.</p>`);

    const inviteeText = [
      `You are booked in.`,
      ``,
      `${ctx.headline} with ${ctx.organiser}`,
      `${when(ctx.start, ctx.inviteeTimezone)} (${ctx.inviteeTimezone})`,
      `${ctx.durationMinutes} minutes`,
      ctx.confirmationNote ? `\n${ctx.confirmationNote}` : '',
      ``,
      `Change or cancel: ${manage}`,
    ].filter((l) => l !== '').join('\n');

    const sends: Promise<boolean>[] = [
      deliver(ctx.userId, {
        to: ctx.inviteeEmail,
        subject: `Confirmed: ${ctx.headline} on ${when(ctx.start, ctx.inviteeTimezone)}`,
        html: inviteeHtml,
        text: inviteeText,
        ics: icsFor(ctx, false),
      }),
    ];

    if (ctx.notifyOrganiser) {
      const organiserHtml = wrap(`
<p style="margin:0;font-size:17px;font-weight:600;color:#18181b;">${esc(ctx.inviteeName)} booked a time</p>
<p style="margin:6px 0 0;font-size:14px;color:#52525b;">${esc(ctx.inviteeEmail)}</p>
${detailBlock(ctx, ctx.organiserTimezone)}
${ctx.inviteeMessage ? `<p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#18181b;">What they said</p><p style="margin:0 0 16px;font-size:13px;color:#52525b;white-space:pre-line;">${esc(ctx.inviteeMessage)}</p>` : ''}
<p style="margin:0;font-size:12px;color:#9b9b9b;">They booked in ${esc(ctx.inviteeTimezone.replace(/_/g, ' '))}, so their ${esc(when(ctx.start, ctx.inviteeTimezone).split(' at ')[1] || '')} is your ${esc(when(ctx.start, ctx.organiserTimezone).split(' at ')[1] || '')}.</p>`);

      sends.push(deliver(ctx.userId, {
        to: (await senderFor(ctx.userId))?.address || ctx.inviteeEmail,
        replyTo: ctx.inviteeEmail,
        subject: `${ctx.inviteeName} booked ${ctx.headline} - ${when(ctx.start, ctx.organiserTimezone)}`,
        html: organiserHtml,
        text: `${ctx.inviteeName} (${ctx.inviteeEmail}) booked ${ctx.headline}.\n\n`
            + `${when(ctx.start, ctx.organiserTimezone)} (${ctx.organiserTimezone})\n`
            + `${ctx.durationMinutes} minutes\n`
            + (ctx.inviteeMessage ? `\nWhat they said:\n${ctx.inviteeMessage}\n` : ''),
        ics: icsFor(ctx, false),
      }));
    }

    const [invitee, organiser = false] = await Promise.all(sends);
    return { invitee, organiser: organiser };
  },

  /** Moved. The sequence number is what makes a calendar accept the change. */
  async rescheduled(ctx: BookingMailContext, previous: Date): Promise<boolean> {
    const manage = `${appOrigin()}/booking/${ctx.manageToken}`;
    const html = wrap(`
<p style="margin:0;font-size:17px;font-weight:600;color:#18181b;">Your meeting has moved</p>
<p style="margin:6px 0 0;font-size:14px;color:#52525b;">${esc(ctx.headline)} with ${esc(ctx.organiser)}.</p>
<p style="margin:16px 0 0;font-size:13px;color:#9b9b9b;text-decoration:line-through;">${esc(when(previous, ctx.inviteeTimezone))}</p>
${detailBlock(ctx, ctx.inviteeTimezone)}
${button(manage, 'Change or cancel')}
<p style="margin:14px 0 0;font-size:12px;color:#9b9b9b;">The updated invitation is attached and should replace the old one in your calendar.</p>`);

    await deliver(ctx.userId, {
      to: ctx.inviteeEmail,
      subject: `Moved: ${ctx.headline} is now ${when(ctx.start, ctx.inviteeTimezone)}`,
      html,
      text: `Your meeting has moved.\n\nWas: ${when(previous, ctx.inviteeTimezone)}\n`
          + `Now: ${when(ctx.start, ctx.inviteeTimezone)} (${ctx.inviteeTimezone})\n\n`
          + `Change or cancel: ${manage}`,
      ics: icsFor(ctx, false),
    });

    if (!ctx.notifyOrganiser) return true;
    return deliver(ctx.userId, {
      to: (await senderFor(ctx.userId))?.address || ctx.inviteeEmail,
      replyTo: ctx.inviteeEmail,
      subject: `${ctx.inviteeName} moved ${ctx.headline} to ${when(ctx.start, ctx.organiserTimezone)}`,
      html: wrap(`
<p style="margin:0;font-size:17px;font-weight:600;color:#18181b;">${esc(ctx.inviteeName)} moved your meeting</p>
<p style="margin:16px 0 0;font-size:13px;color:#9b9b9b;text-decoration:line-through;">${esc(when(previous, ctx.organiserTimezone))}</p>
${detailBlock(ctx, ctx.organiserTimezone)}`),
      text: `${ctx.inviteeName} moved ${ctx.headline}.\n\n`
          + `Was: ${when(previous, ctx.organiserTimezone)}\nNow: ${when(ctx.start, ctx.organiserTimezone)}`,
      ics: icsFor(ctx, false),
    });
  },

  /** Cancelled, by whichever side. Both are told; neither has to chase. */
  async cancelled(ctx: BookingMailContext, by: 'invitee' | 'organiser', reason?: string | null): Promise<boolean> {
    const rebook = ctx.manageToken ? `${appOrigin()}/booking/${ctx.manageToken}` : appOrigin();
    const because = reason ? `<p style="margin:0 0 16px;font-size:13px;color:#52525b;">&ldquo;${esc(reason)}&rdquo;</p>` : '';

    // The invitee only needs telling if they were not the one who cancelled.
    if (by === 'organiser') {
      await deliver(ctx.userId, {
        to: ctx.inviteeEmail,
        subject: `Cancelled: ${ctx.headline} on ${when(ctx.start, ctx.inviteeTimezone)}`,
        html: wrap(`
<p style="margin:0;font-size:17px;font-weight:600;color:#18181b;">Your meeting was cancelled</p>
<p style="margin:6px 0 0;font-size:14px;color:#52525b;">${esc(ctx.organiser)} cancelled ${esc(ctx.headline)}.</p>
${detailBlock(ctx, ctx.inviteeTimezone, true)}
${because}
${button(rebook, 'Book another time')}`),
        text: `${ctx.organiser} cancelled ${ctx.headline}.\n\n`
            + `Was: ${when(ctx.start, ctx.inviteeTimezone)}\n`
            + (reason ? `\n"${reason}"\n` : '')
            + `\nBook another time: ${rebook}`,
        ics: icsFor(ctx, true),
      });
    } else {
      // They cancelled it themselves, so this is a receipt, not news.
      await deliver(ctx.userId, {
        to: ctx.inviteeEmail,
        subject: `Cancelled: ${ctx.headline}`,
        html: wrap(`
<p style="margin:0;font-size:17px;font-weight:600;color:#18181b;">That is cancelled</p>
<p style="margin:6px 0 0;font-size:14px;color:#52525b;">Nothing else to do. It has been taken out of ${esc(ctx.organiser)}&rsquo;s diary.</p>
${detailBlock(ctx, ctx.inviteeTimezone, true)}
${button(rebook, 'Book another time')}`),
        text: `That is cancelled.\n\nWas: ${when(ctx.start, ctx.inviteeTimezone)}\n\nBook another time: ${rebook}`,
        ics: icsFor(ctx, true),
      });
    }

    if (!ctx.notifyOrganiser) return true;
    return deliver(ctx.userId, {
      to: (await senderFor(ctx.userId))?.address || ctx.inviteeEmail,
      replyTo: ctx.inviteeEmail,
      subject: by === 'invitee'
        ? `${ctx.inviteeName} cancelled ${ctx.headline}`
        : `Cancelled: ${ctx.headline} with ${ctx.inviteeName}`,
      html: wrap(`
<p style="margin:0;font-size:17px;font-weight:600;color:#18181b;">${by === 'invitee' ? `${esc(ctx.inviteeName)} cancelled` : 'Cancelled'}</p>
${detailBlock(ctx, ctx.organiserTimezone, true)}
${because}`),
      text: `${by === 'invitee' ? `${ctx.inviteeName} cancelled` : 'Cancelled'} ${ctx.headline}.\n\n`
          + `Was: ${when(ctx.start, ctx.organiserTimezone)}\n`
          + (reason ? `\n"${reason}"` : ''),
      ics: icsFor(ctx, true),
    });
  },

  /** The nudge the day before. The single biggest lever on people turning up. */
  async reminder(ctx: BookingMailContext): Promise<boolean> {
    const manage = `${appOrigin()}/booking/${ctx.manageToken}`;
    return deliver(ctx.userId, {
      to: ctx.inviteeEmail,
      subject: `Tomorrow: ${ctx.headline} with ${ctx.organiser}`,
      html: wrap(`
<p style="margin:0;font-size:17px;font-weight:600;color:#18181b;">A reminder</p>
<p style="margin:6px 0 0;font-size:14px;color:#52525b;">${esc(ctx.headline)} with ${esc(ctx.organiser)} is coming up.</p>
${detailBlock(ctx, ctx.inviteeTimezone)}
${ctx.confirmationNote ? `<p style="margin:0 0 16px;font-size:13px;color:#52525b;white-space:pre-line;">${esc(ctx.confirmationNote)}</p>` : ''}
<p style="margin:0 0 16px;font-size:13px;color:#52525b;">If something has come up, moving it takes a second and is better than not turning up.</p>
${button(manage, 'Move or cancel')}`),
      text: `${ctx.headline} with ${ctx.organiser} is coming up.\n\n`
          + `${when(ctx.start, ctx.inviteeTimezone)} (${ctx.inviteeTimezone})\n\n`
          + `Move or cancel: ${manage}`,
    });
  },

  /** Does this account have a mailbox at all? The links page asks, to warn. */
  async canSend(userId: string): Promise<boolean> {
    return (await senderFor(userId)) !== null;
  },
};

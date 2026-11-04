/* ═══════════════════════════════════════════════════════════════════════
   The message for an IT admin: approve Sincerely for the organisation and
   allow sending for its Microsoft 365 mailboxes.

   One source for all three ways it leaves Sincerely: sent as a formatted
   email from the person's own mailbox, opened in their email app, or
   copied. The plain text uses CRLF line breaks, because Outlook and
   several other email apps run single LF breaks together in a mailto body.
   ═══════════════════════════════════════════════════════════════════════ */

export const MS_ADMIN_SUBJECT = 'Please approve Sincerely for our Microsoft 365 mailboxes';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function lines(mailboxes: string[]): string[] {
  const ids = mailboxes.length ? mailboxes : ['name@yourcompany.com'];
  return ids.map((m) => `Set-CASMailbox -Identity ${m} -SmtpClientAuthenticationDisabled $false -ImapEnabled $true`);
}

export function microsoftAdminText(link: string | null, mailboxes: string[], senderName?: string | null): string {
  const approve = link || '(the approval link is in Sincerely: Email accounts > Connecting several Microsoft 365 mailboxes)';
  return [
    'Hi,',
    '',
    'We send email from our Microsoft 365 mailboxes with Sincerely. It signs in with Microsoft, so no passwords are shared. Two things need an admin, and together they take a few minutes.',
    '',
    '1. APPROVE SINCERELY FOR OUR ORGANISATION',
    'One click, signed in as a Global or Application administrator:',
    approve,
    '',
    '2. ALLOW AUTHENTICATED SMTP AND IMAP FOR OUR MAILBOXES',
    'In the Microsoft 365 admin centre: Users > Active users > the user > Mail > Manage email apps > tick "Authenticated SMTP" and "IMAP" > Save.',
    '',
    'Or in Exchange Online PowerShell:',
    ...lines(mailboxes).map((l) => `    ${l}`),
    '',
    'This per-mailbox setting works even if SMTP AUTH is switched off for the organisation as a whole. Changes can take up to an hour to apply.',
    '',
    'Thank you!',
    ...(senderName ? [senderName] : []),
  ].join('\r\n');
}

/** The same message as an email: headings, a button, the commands in a box. */
export function microsoftAdminHtml(link: string | null, mailboxes: string[], senderName?: string | null): string {
  const p = 'margin:0 0 14px;font-size:15px;line-height:1.6;color:#18191D;';
  const h = 'margin:24px 0 8px;font-size:16px;font-weight:600;color:#18191D;';
  const small = 'margin:0 0 14px;font-size:13px;line-height:1.6;color:#5B5C64;';
  const button = link
    ? `<p style="margin:4px 0 10px;"><a href="${esc(link)}" style="display:inline-block;padding:11px 18px;background:#2F3F9C;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Approve Sincerely</a></p>
       <p style="${small}">Or open this link: <a href="${esc(link)}" style="color:#2F3F9C;word-break:break-all;">${esc(link)}</a></p>`
    : `<p style="${p}">The approval link is in Sincerely under Email accounts &gt; Connecting several Microsoft 365 mailboxes.</p>`;
  const code = lines(mailboxes).map(esc).join('<br>');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;color:#18191D;">
<p style="${p}">Hi,</p>
<p style="${p}">We send email from our Microsoft 365 mailboxes with Sincerely. It signs in with Microsoft, so no passwords are shared. Two things need an admin, and together they take a few minutes.</p>
<p style="${h}">1. Approve Sincerely for our organisation</p>
<p style="${p}">One click, signed in as a Global or Application administrator:</p>
${button}
<p style="${h}">2. Allow Authenticated SMTP and IMAP for our mailboxes</p>
<p style="${p}">In the <strong>Microsoft 365 admin centre</strong>: Users &gt; Active users &gt; the user &gt; Mail &gt; Manage email apps &gt; tick <strong>Authenticated SMTP</strong> and <strong>IMAP</strong> &gt; Save.</p>
<p style="${p}">Or in Exchange Online PowerShell:</p>
<div style="margin:0 0 14px;padding:12px 14px;background:#F4F4F1;border:1px solid #E7E6E1;border-radius:8px;font-family:Consolas,Menlo,monospace;font-size:12.5px;line-height:1.7;color:#18191D;word-break:break-all;">${code}</div>
<p style="${small}">This per-mailbox setting works even if SMTP AUTH is switched off for the organisation as a whole. Changes can take up to an hour to apply.</p>
<p style="${p}">Thank you!${senderName ? `<br>${esc(senderName)}` : ''}</p>
</div>`;
}

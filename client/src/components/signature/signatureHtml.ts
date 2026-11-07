/* ═══════════════════════════════════════════════════════════════════════
   Signature HTML: cleaning what is pasted in, and building one from details.

   Everything produced here is email HTML: tables and inline styles, no
   classes, no <style> blocks, no web fonts. That is what Gmail, Outlook and
   phone mail apps all agree on.
   ═══════════════════════════════════════════════════════════════════════ */

const DROP_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'svg', 'math', 'video', 'audio', 'noscript', 'title', 'head'];

/**
 * Remove what no mail client will show and what should never run: scripts,
 * event handlers, javascript: links, classes (meaningless once the HTML
 * leaves the page it was copied from). Inline styles stay; they are how an
 * email signature is styled.
 */
export function sanitizeSignatureHtml(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll(DROP_TAGS.join(',')).forEach((n) => n.remove());
  // Comments include Word's conditional blocks, which are noise here.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));
  doc.body.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'class' || name === 'id' || name === 'contenteditable' || name.startsWith('data-')) {
        el.removeAttribute(attr.name);
      } else if ((name === 'href' || name === 'src') && (value.startsWith('javascript:') || value.startsWith('vbscript:'))) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return doc.body.innerHTML.trim();
}

/** The words of a signature, for "is there anything here". */
export function signatureText(html: string | null | undefined): string {
  return (html || '').replace(/<img\b[^>]*>/gi, ' [image] ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

/** A typed address into one a link can open: https:// for sites, mailto: for emails, tel: for numbers. */
export function normaliseHref(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  if (/^(https?:|mailto:|tel:|\{\{)/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^\+?[\d\s().-]{6,}$/.test(v)) return `tel:${v.replace(/[^\d+]/g, '')}`;
  return `https://${v.replace(/^\/+/, '')}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─── Built from details ─────────────────────────────────────────── */

export type SignatureLayout = 'classic' | 'logo-left' | 'compact' | 'banner';

export const SIGNATURE_LAYOUTS: readonly { value: SignatureLayout; label: string; hint: string }[] = [
  { value: 'classic', label: 'Classic', hint: 'Name, title and contact lines, image underneath.' },
  { value: 'logo-left', label: 'Image left', hint: 'Logo or photo beside your details, with a coloured rule.' },
  { value: 'compact', label: 'Compact', hint: 'Two short lines. Reads well on replies.' },
  { value: 'banner', label: 'Banner', hint: 'Details on top, a wide image or banner below.' },
];

export interface SignatureDetails {
  name: string;
  title: string;
  company: string;
  phone: string;
  mobile: string;
  email: string;
  website: string;
  address: string;
  imageUrl: string;
  imageWidth: number;
  imageRound: boolean;
  linkedin: string;
  twitter: string;
  booking: string;
  bookingLabel: string;
  accent: string;
  font: string;
}

export const EMPTY_DETAILS: SignatureDetails = {
  name: '', title: '', company: '', phone: '', mobile: '', email: '', website: '', address: '',
  imageUrl: '', imageWidth: 80, imageRound: false,
  linkedin: '', twitter: '', booking: '', bookingLabel: 'Book a call with me',
  accent: '#2F3F9C', font: 'Arial, Helvetica, sans-serif',
};

/** Font stacks that every mail client has, so the signature looks the same everywhere. */
export const EMAIL_FONTS: readonly { label: string; value: string }[] = [
  { label: 'Sans serif', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Georgia, \'Times New Roman\', serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Verdana, sans-serif' },
  { label: 'Trebuchet', value: '\'Trebuchet MS\', Helvetica, sans-serif' },
  { label: 'Times', value: '\'Times New Roman\', Times, serif' },
  { label: 'Monospace', value: '\'Courier New\', Courier, monospace' },
];

/** A domain for display: no scheme, no trailing slash. */
function bare(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function link(href: string, label: string, color: string): string {
  return `<a href="${esc(normaliseHref(href))}" style="color:${color};text-decoration:none;">${esc(label)}</a>`;
}

/**
 * A signature from a few details, in one of four layouts. Empty details are
 * left out, so nothing reads "Phone:" with no number after it.
 */
export function buildSignatureHtml(d: SignatureDetails, layout: SignatureLayout): string {
  const font = d.font || EMPTY_DETAILS.font;
  const accent = /^#[0-9a-f]{3,8}$/i.test(d.accent) ? d.accent : EMPTY_DETAILS.accent;
  const ink = '#1f2328';
  const muted = '#5f6368';
  const sep = `<span style="color:#c0c4c9;">&nbsp;|&nbsp;</span>`;

  const roleLine = [d.title.trim(), d.company.trim()].filter(Boolean).map(esc).join(`<span style="color:#c0c4c9;">&nbsp;&middot;&nbsp;</span>`);
  const contactBits = [
    d.phone.trim() && `<span style="color:${muted};">${d.mobile.trim() ? 'T&nbsp;' : ''}</span>${link(d.phone, d.phone.trim(), ink)}`,
    d.mobile.trim() && `<span style="color:${muted};">M&nbsp;</span>${link(d.mobile, d.mobile.trim(), ink)}`,
    d.email.trim() && link(d.email, d.email.trim(), ink),
    d.website.trim() && link(d.website, bare(d.website.trim()), accent),
  ].filter(Boolean) as string[];
  const socialBits = [
    d.linkedin.trim() && link(d.linkedin, 'LinkedIn', accent),
    d.twitter.trim() && link(d.twitter, 'X', accent),
  ].filter(Boolean) as string[];

  const width = Math.max(24, Math.min(600, Math.round(d.imageWidth) || 80));
  const radius = d.imageRound ? `border-radius:${Math.round(width / 2)}px;` : 'border-radius:4px;';
  const img = d.imageUrl.trim()
    ? `<img src="${esc(d.imageUrl.trim())}" width="${width}" alt="${esc(d.company.trim() || d.name.trim() || 'Logo')}" style="display:block;width:${width}px;max-width:100%;height:auto;border:0;${radius}">`
    : '';
  const imgLinked = img && d.website.trim() ? `<a href="${esc(normaliseHref(d.website))}" style="text-decoration:none;">${img}</a>` : img;
  const booking = d.booking.trim()
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;border-collapse:collapse;"><tr><td style="background:${accent};border-radius:4px;padding:6px 12px;"><a href="${esc(normaliseHref(d.booking))}" style="color:#ffffff;text-decoration:none;font-family:${font};font-size:13px;font-weight:bold;">${esc(d.bookingLabel.trim() || 'Book a call with me')}</a></td></tr></table>`
    : '';

  const line = (inner: string, extra = '') => inner ? `<div style="margin:0;${extra}">${inner}</div>` : '';
  const nameLine = d.name.trim() ? `<div style="margin:0;font-size:15px;font-weight:bold;color:${ink};">${esc(d.name.trim())}</div>` : '';
  const role = line(roleLine, `color:${muted};font-size:13px;`);
  const contact = line(contactBits.join(sep), 'font-size:13px;margin-top:6px;');
  const social = line(socialBits.join(sep), 'font-size:13px;margin-top:2px;');
  const address = line(esc(d.address.trim()), `color:${muted};font-size:12px;margin-top:2px;`);
  const wrapOpen = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${font};color:${ink};font-size:13px;line-height:1.45;">`;

  switch (layout) {
    case 'logo-left': {
      const left = imgLinked ? `<td valign="top" style="padding:0 14px 0 0;">${imgLinked}</td><td valign="top" style="border-left:2px solid ${accent};padding:0 0 0 14px;">` : `<td valign="top" style="border-left:2px solid ${accent};padding:0 0 0 12px;">`;
      return `${wrapOpen}<tr>${left}${nameLine}${role}${contact}${social}${address}${booking}</td></tr></table>`;
    }
    case 'compact': {
      const first = [d.name.trim() && `<b style="color:${ink};">${esc(d.name.trim())}</b>`, roleLine && `<span style="color:${muted};">${roleLine}</span>`].filter(Boolean).join(sep);
      const second = [...contactBits, ...socialBits].join(sep);
      return `${wrapOpen}<tr><td style="padding:0;">${line(first)}${line(second, 'margin-top:2px;')}${booking}</td></tr></table>`;
    }
    case 'banner': {
      const banner = imgLinked ? `<tr><td style="padding:10px 0 0 0;">${imgLinked}</td></tr>` : '';
      return `${wrapOpen}<tr><td style="padding:0 0 8px 0;border-bottom:2px solid ${accent};">${nameLine}${role}</td></tr><tr><td style="padding:6px 0 0 0;">${contact}${social}${address}${booking}</td></tr>${banner}</table>`;
    }
    default: {
      const image = imgLinked ? `<tr><td style="padding:10px 0 0 0;">${imgLinked}</td></tr>` : '';
      return `${wrapOpen}<tr><td style="padding:0;">${nameLine}${role}${contact}${social}${address}${booking}</td></tr>${image}</table>`;
    }
  }
}

/* ─── Sample emails for the preview ────────────────────────────── */

export type PreviewKind = 'new' | 'reply';

/** The body the composer would send: the draft, then the signature, as withSignature joins them. */
export function sampleEmailHtml(kind: PreviewKind, signatureHtml: string | null, fromName: string): string {
  const first = (fromName || '').trim().split(/\s+/)[0] || 'Alex';
  const draft = kind === 'new'
    ? `<p style="margin:0 0 12px;">Hi Sam,</p><p style="margin:0 0 12px;">Thanks for your time on the call earlier. As promised, here is the short overview of how we would set this up for your team.</p><p style="margin:0;">Speak soon,<br>${esc(first)}</p>`
    : `<p style="margin:0 0 12px;">Hi Sam,</p><p style="margin:0;">Thursday at 2pm works well for me. I will send the invite over shortly.</p>`;
  const sig = signatureHtml ? `<br><br>${signatureHtml}` : '';
  const quote = kind === 'reply'
    ? `<br><br><div style="border-left:2px solid #ccc;padding-left:10px;margin-left:0;"><p style="margin:0 0 4px;font-size:12px;color:#999;">On Tue at 10:12, Sam Taylor &lt;sam@northwind.example&gt; wrote:</p><p style="margin:0;color:#777;">Would Thursday afternoon work for a follow-up?</p></div>`
    : '';
  return `${draft}${sig}${quote}`;
}

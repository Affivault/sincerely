/* The part of an email a person actually wrote, shared by the server (Relay
   reads only this) and the Unibox (previews and folded quotes). */

/* ───────────────────────────────────────────────────────────────────────
   The part of a reply that is new.

   A reply is what the person typed, followed by everything they are
   replying to. Classifying the whole thing reads your own email back to
   you: your campaign's unsubscribe link, your own "let's talk", a previous
   out-of-office. Everything after the first quote marker is history.
   ─────────────────────────────────────────────────────────────────────── */

const QUOTE_MARKERS: RegExp[] = [
  /^\s*On .{3,200}(wrote|schrieb|a écrit|escribió|ha scritto|schreef)\s*:?\s*$/im,
  /^\s*On .{3,120}\n.{0,120}(wrote|schrieb|a écrit|escribió):\s*$/im,
  /^\s*Le .{3,160} a écrit\s*:?\s*$/im,
  /^\s*Am .{3,160} schrieb .{0,120}$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  /^\s*_{10,}\s*$/m,
  /^\s*From:\s.+\n\s*(Sent|Date):\s.+/im,
  /^\s*De\s*:\s.+\n\s*(Envoyé|Date)\s*:\s.+/im,
  /^\s*Von:\s.+\n\s*(Gesendet|Datum):\s.+/im,
  /^\s*>.*$/m,
];

const SIGNATURE_MARKERS: RegExp[] = [
  /^\s*--\s*$/m,
  /^\s*Sent from my (iPhone|iPad|Android|mobile|Samsung|Galaxy|phone)/im,
  /^\s*Get Outlook for (iOS|Android)/im,
];

export function stripQuoted(input: string): { text: string; quoted: string } {
  const text = (input || '').replace(/\r\n/g, '\n');
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index < cut && m.index > 0) cut = m.index;
    else if (m && m.index === 0 && re.source.startsWith('^\\s*>')) {
      // Top-quoted reply (rare): keep what follows the quote block.
      continue;
    }
  }
  let fresh = text.slice(0, cut);
  const quoted = text.slice(cut);
  for (const re of SIGNATURE_MARKERS) {
    const m = re.exec(fresh);
    if (m && m.index > 0) fresh = fresh.slice(0, m.index);
  }
  return { text: fresh.trim(), quoted: quoted.trim() };
}

/** Plain text from HTML, good enough to classify and preview. */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '\n> quoted\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * The same split for HTML mail: what they wrote, and the quoted history
 * their mail client appended (Gmail, Outlook, Apple Mail and Yahoo each
 * mark it differently). quoted is empty when nothing was found.
 */
export function splitQuotedHtml(html: string): { main: string; quoted: string } {
  if (!html) return { main: '', quoted: '' };
  const markers = [
    /<div[^>]+class=["'][^"']*gmail_quote/i,
    /<blockquote[^>]+type=["']cite["']/i,
    /<div[^>]+id=["']appendonsend["']/i,
    /<div[^>]+id=["']divRplyFwdMsg["']/i,
    /<hr[^>]+id=["']stopSpelling["']/i,
    /<div[^>]+class=["'][^"']*(yahoo_quoted|moz-cite-prefix)/i,
    /-{2,}\s*Original Message\s*-{2,}/i,
    /<blockquote[^>]*>\s*(<div[^>]*>\s*)*On .{3,200}wrote:/i,
  ];
  let cut = -1;
  for (const re of markers) {
    const m = re.exec(html);
    if (m && (cut === -1 || m.index < cut)) cut = m.index;
  }
  if (cut <= 0) return { main: html, quoted: '' };
  const main = html.slice(0, cut);
  // Nothing of their own above the quote (a bare forward): show it all.
  if (!htmlToText(main).trim()) return { main: html, quoted: '' };
  return { main, quoted: html.slice(cut) };
}

/** A one-line preview: their words, without link soup or dividers. */
export function previewText(bodyText: string | null | undefined, bodyHtml?: string | null, max = 160): string {
  let text = bodyText || '';
  const urlShare = (text.match(/https?:\/\/\S+/g) || []).join('').length / Math.max(1, text.length);
  if ((!text.trim() || urlShare > 0.35) && bodyHtml) text = htmlToText(bodyHtml);
  return stripQuoted(text).text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[-_=~*\u2022\u2014]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

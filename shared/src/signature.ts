/* ═══════════════════════════════════════════════════════════════════════
   Email signatures: when one is added, and what will go wrong with it.

   Gmail's model, one signature per inbox: it can go on every email, only on
   new emails, only on replies and forwards, or on nothing (still there to
   insert by hand from the composer). Forwards count as replies, as in Gmail.
   ═══════════════════════════════════════════════════════════════════════ */

export type SignatureUse = 'all' | 'new' | 'replies' | 'none';

export const SIGNATURE_USES: readonly { value: SignatureUse; label: string; hint: string }[] = [
  { value: 'all', label: 'All emails', hint: 'Added to new emails, replies and forwards.' },
  { value: 'new', label: 'New emails only', hint: 'Added when you start a new email. Replies and forwards go without.' },
  { value: 'replies', label: 'Replies & forwards', hint: 'Added when you reply or forward. New emails go without.' },
  { value: 'none', label: 'Don’t add', hint: 'Never added on its own. Insert it from the composer when you want it.' },
];

export function isSignatureUse(v: unknown): v is SignatureUse {
  return v === 'all' || v === 'new' || v === 'replies' || v === 'none';
}

/**
 * The inbox's setting. Before migration 117 there was only `signature_auto`,
 * which meant "add it everywhere", so a row without the new column reads
 * that way.
 */
export function resolveSignatureUse(acct: { signature_use?: unknown; signature_auto?: boolean | null } | null | undefined): SignatureUse {
  if (!acct) return 'none';
  if (isSignatureUse(acct.signature_use)) return acct.signature_use;
  return acct.signature_auto ? 'all' : 'none';
}

/** Whether the signature goes on by itself for this kind of email. */
export function signatureAppliesTo(use: SignatureUse, kind: 'new' | 'reply'): boolean {
  if (use === 'all') return true;
  if (use === 'none') return false;
  return kind === 'new' ? use === 'new' : use === 'replies';
}

/** Short words for where a signature shows up, for summaries. */
export function describeSignatureUse(use: SignatureUse): string {
  switch (use) {
    case 'all': return 'Added to every email';
    case 'new': return 'Added to new emails';
    case 'replies': return 'Added to replies and forwards';
    default: return 'Inserted by hand from the composer';
  }
}

/** Gmail refuses a signature longer than this many characters of HTML. */
export const SIGNATURE_MAX_CHARS = 10_000;

export interface SignatureProblem {
  level: 'warn' | 'info';
  message: string;
}

/**
 * Things that will make a signature look wrong somewhere, read from its HTML.
 * String work only, so the server and tests can use it as well as the editor.
 */
export function signatureProblems(html: string | null | undefined): SignatureProblem[] {
  const out: SignatureProblem[] = [];
  const h = html || '';
  if (!h.trim()) return out;
  if (h.length > SIGNATURE_MAX_CHARS) {
    out.push({ level: 'warn', message: `It is ${h.length.toLocaleString('en-US')} characters of HTML. Gmail cuts signatures off at ${SIGNATURE_MAX_CHARS.toLocaleString('en-US')}, so trim it or use smaller images.` });
  }
  const imgs = h.match(/<img\b[^>]*>/gi) || [];
  if (imgs.some((t) => /src\s*=\s*["']?\s*data:/i.test(t))) {
    out.push({ level: 'warn', message: 'An image is pasted in rather than linked. Gmail and Outlook drop those, so upload it or link it from a web address.' });
  }
  if (imgs.some((t) => /src\s*=\s*["']?\s*http:\/\//i.test(t))) {
    out.push({ level: 'warn', message: 'An image is linked over http://. Gmail shows a broken image for those; use https://.' });
  }
  if (imgs.some((t) => !/\bwidth\s*=|width\s*:/i.test(t))) {
    out.push({ level: 'info', message: 'An image has no set width. Outlook can show it at full size, so give it one (the image button does this).' });
  }
  if (imgs.some((t) => !/\balt\s*=\s*["'][^"']+/i.test(t))) {
    out.push({ level: 'info', message: 'An image has no description. Many clients hide images until asked, and show the description instead.' });
  }
  if (/href\s*=\s*["']\s*(?!https?:|mailto:|tel:|\{\{)[^"'\s]/i.test(h)) {
    out.push({ level: 'warn', message: 'A link does not start with https://, mailto: or tel:, so it may not open.' });
  }
  return out;
}

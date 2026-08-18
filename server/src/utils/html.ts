/* ═══════════════════════════════════════════════════════════════════════
   Turning someone's typing into HTML without changing what it says.

   Every outgoing message this server composes — a reply, a forward, a
   scheduled send, a SARA draft, a warm-up email — took plain text and
   dropped it straight into an HTML template, converting newlines and
   nothing else. Nine places, all the same shape.

   That is a correctness problem before it is a security one. HTML5 treats
   `<` followed by a letter as the start of a tag, so an ordinary sentence
   can lose text on the way out:

     "let me know at <jane@acme.com>"   → the address vanishes
     "I'll send the <details> tomorrow" → renders a collapsible widget
     "use <br> here"                     → renders a line break

   The sender sees what they typed in the composer and the recipient gets
   something else, with nothing anywhere to say so. On a cold-email tool,
   where an address in angle brackets is an entirely normal thing to type,
   that is a message quietly sent wrong.

   The second problem is narrower but worse in kind. A reply quotes the
   message it answers, and that message came from a stranger. Its subject,
   its from address and its plain-text body were interpolated raw, so a
   prospect could put markup in a reply and have it become live markup in
   the mail you send back.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The five characters that mean something to an HTML parser.
 *
 * `&` first, or the escapes below would themselves be escaped.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Plain text as an HTML fragment: escaped, then line breaks preserved.
 *
 * This is the whole conversion. Anything that wants paragraphs builds them
 * from `textToParagraphs` instead, so the escaping only ever happens once.
 */
export function textToHtml(value: unknown): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br/>');
}

/**
 * Plain text as paragraphs — a blank line starts a new one, a single line
 * break stays a break inside the current one.
 *
 * @param style Inline CSS for each paragraph, since email has no stylesheet.
 */
export function textToParagraphs(value: unknown, style = 'margin:0 0 12px;'): string {
  const open = style ? `<p style="${style}">` : '<p>';
  const blocks = escapeHtml(value)
    .split(/(?:\r\n|\r|\n){2,}/)
    .map((block) => block.replace(/\r\n|\r|\n/g, '<br/>'));
  return blocks.map((block) => `${open}${block}</p>`).join('');
}

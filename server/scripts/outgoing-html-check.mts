/* ═══════════════════════════════════════════════════════════════════════
   The message that leaves has to say what was typed.

   Every outgoing message this server composes took plain text and dropped
   it into an HTML template, converting newlines and nothing else. Nine
   places, all the same shape, none of them escaping anything.

   HTML5 treats `<` followed by a letter as the start of a tag, so ordinary
   sentences lost text on the way out — and the sender had no way to know,
   because the composer showed them what they typed. "let me know at
   <jane@acme.com>" arrived with the address missing, which on a cold-email
   tool is not an exotic thing to write.

   These assertions are on the HTML that would genuinely have been put on
   the wire, and they check both directions: nothing a person types may
   change meaning, and nothing a stranger sends may become markup in the
   reply that quotes them.

   Run: npx tsx scripts/outgoing-html-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { escapeHtml, textToHtml, textToParagraphs } from '../src/utils/html.js';

let pass = 0;
let fail = 0;
function is(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
}

/**
 * What a mail client would show, near enough: tags removed, entities
 * resolved. If a fragment of the original text is missing from this, it is
 * missing from the email.
 */
function rendered(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

console.log('\nnothing a person types may go missing');
{
  // The one that matters most here: an address in angle brackets is an
  // entirely ordinary thing to type into a cold-email reply.
  const typed = 'let me know at <jane@acme.com> and I will send it over';
  is('an address in angle brackets survives',
     rendered(textToHtml(typed)) === typed, textToHtml(typed));

  const tagLike = "I'll send the <details> tomorrow";
  is('a word in angle brackets is not turned into an element',
     rendered(textToHtml(tagLike)) === tagLike, textToHtml(tagLike));

  const br = 'use <br> to break the line';
  is('a literal <br> stays literal rather than becoming a line break',
     rendered(textToHtml(br)) === br, textToHtml(br));

  const entity = 'terms &copy; apply, 5 &lt; 10';
  is('text that looks like an entity is not resolved into a symbol',
     rendered(textToHtml(entity)) === entity, textToHtml(entity));

  const quotes = 'she said "yes" — it\'s agreed';
  is('quotes and apostrophes come through unchanged',
     rendered(textToHtml(quotes)) === quotes, textToHtml(quotes));
}

console.log('\nline breaks are still line breaks');
{
  is('a newline becomes a break', textToHtml('one\ntwo') === 'one<br/>two', textToHtml('one\ntwo'));
  is('CRLF is handled too', textToHtml('one\r\ntwo') === 'one<br/>two', textToHtml('one\r\ntwo'));
  is('a blank line starts a new paragraph',
     textToParagraphs('one\n\ntwo').match(/<p /g)?.length === 2,
     textToParagraphs('one\n\ntwo'));
  is('and a single break inside a paragraph stays a break',
     textToParagraphs('one\ntwo').includes('one<br/>two'),
     textToParagraphs('one\ntwo'));
}

console.log('\nnothing a stranger sends may become markup');
{
  // Quoted material in a reply comes from whoever wrote the message being
  // answered, which on this platform is a cold prospect.
  const hostile = '<script>alert(1)</script>';
  is('a script tag in a quoted plain-text body is inert',
     !/<script/i.test(textToHtml(hostile)), textToHtml(hostile));

  const styled = '<img src=x onerror="alert(1)">';
  // The property is that no tag can form at all: an escaped `onerror=` is
  // just those characters on screen. Checking for the substring instead
  // would fail on output that is already perfectly safe.
  is('an event handler cannot form a tag either',
     !textToHtml(styled).includes('<img') && !textToHtml(styled).includes('"'),
     textToHtml(styled));

  const fromHeader = 'Jane" onmouseover="alert(1)';
  is('an attribute break-out in a from address is escaped',
     !escapeHtml(fromHeader).includes('"'), escapeHtml(fromHeader));

  const subject = 'Re: </p><h1>PAY NOW</h1>';
  is('and a subject cannot close the element it sits in',
     !/<\/p>/i.test(escapeHtml(subject)), escapeHtml(subject));
}

console.log('\nthe escaping is done once, not twice');
{
  is('an ampersand is escaped a single time',
     escapeHtml('a & b') === 'a &amp; b', escapeHtml('a & b'));
  is('paragraphs do not double-escape what they contain',
     textToParagraphs('a & b') === '<p style="margin:0 0 12px;">a &amp; b</p>',
     textToParagraphs('a & b'));
}

console.log('\nempty and missing values are not the word "undefined"');
{
  is('undefined renders as nothing', textToHtml(undefined) === '', JSON.stringify(textToHtml(undefined)));
  is('null renders as nothing', textToHtml(null) === '', JSON.stringify(textToHtml(null)));
  is('and escapeHtml agrees', escapeHtml(null) === '', JSON.stringify(escapeHtml(null)));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

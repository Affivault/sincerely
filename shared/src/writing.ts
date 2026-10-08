/* ═══════════════════════════════════════════════════════════════════════
   How Relay writes.

   Every email Relay writes - a sequence, a first line, a reply, a referral
   intro, a test version - is held to one standard: a senior operator
   writing to a peer between calls. Not a marketer, not an assistant.

   Two halves:

     WRITING_STANDARD / sequencePlaybook   what the model is told
     writingProblems / stripDashes         what is checked afterwards

   The check is the part that cannot be talked out of. A draft that comes
   back with a long dash or a stock phrase is sent back once with the list
   of what is wrong; whatever survives that, the dashes are taken out by
   hand. Nothing with a long dash in it ever reaches a prospect.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Phrases that mark an email as mass-produced or machine-written. Each is
 * matched case-insensitively on word boundaries. The label is what the
 * model is told it wrote.
 */
export const SLOP_PHRASES: Array<{ re: RegExp; label: string }> = [
  // Openers nobody believes.
  { re: /\bhope (this|the) (e-?mail|message|note) finds you\b/i, label: '"I hope this email finds you well"' },
  { re: /\bhope (you'?re|you are|you have been|you'?ve been|all is) (doing )?(well|good|great)\b/i, label: '"I hope you are well"' },
  { re: /\b(I|I'm|I am|just) (wanted to |am )?reach(ing)? out\b/i, label: '"reaching out"' },
  { re: /\bI (came|stumbled) (across|upon)\b/i, label: '"I came across"' },
  { re: /\bI'?ll keep (this|it) (short|brief)\b/i, label: '"I\'ll keep this short"' },
  { re: /\bmy name is\b/i, label: '"my name is"' },
  { re: /\bdear (sir|madam|sir\/madam)\b/i, label: '"Dear Sir/Madam"' },
  // Follow-up filler.
  { re: /\bjust (following|checking) (up|in)\b/i, label: '"just following up"' },
  { re: /\bfollowing up on my (last|previous|earlier)\b/i, label: '"following up on my last email"' },
  { re: /\bcircl(e|ing) back\b/i, label: '"circling back"' },
  { re: /\btouch(ing)? base\b/i, label: '"touch base"' },
  { re: /\bbump(ing)? (this|my)\b/i, label: '"bumping this"' },
  { re: /\b(got|gets) (buried|lost) in your inbox\b/i, label: '"buried in your inbox"' },
  { re: /\bslip(ped)? through the cracks\b/i, label: '"slipped through the cracks"' },
  // Buzzwords.
  { re: /\bgame[- ]?changer\b/i, label: '"game-changer"' },
  { re: /\brevolutioni[sz](e|es|ing)\b/i, label: '"revolutionise"' },
  { re: /\bcutting[- ]edge\b/i, label: '"cutting-edge"' },
  { re: /\bstate[- ]of[- ]the[- ]art\b/i, label: '"state-of-the-art"' },
  { re: /\b(best|world)[- ]class\b/i, label: '"best-in-class" / "world-class"' },
  { re: /\bnext[- ]level\b/i, label: '"next-level"' },
  { re: /\bseamless(ly)?\b/i, label: '"seamless"' },
  { re: /\bleverag(e|es|ing)\b/i, label: '"leverage"' },
  { re: /\bunlock(s|ing)?\b/i, label: '"unlock"' },
  { re: /\belevat(e|es|ing)\b/i, label: '"elevate"' },
  { re: /\bsupercharg(e|es|ing)\b/i, label: '"supercharge"' },
  { re: /\bskyrocket(s|ing)?\b/i, label: '"skyrocket"' },
  { re: /\bempower(s|ing)?\b/i, label: '"empower"' },
  { re: /\bdelv(e|es|ing)\b/i, label: '"delve"' },
  { re: /\bharness(ing)? the power\b/i, label: '"harness the power"' },
  { re: /\brobust\b/i, label: '"robust"' },
  { re: /\bsynerg(y|ies)\b/i, label: '"synergy"' },
  { re: /\bholistic\b/i, label: '"holistic"' },
  { re: /\binnovative\b/i, label: '"innovative"' },
  { re: /\btransformative\b/i, label: '"transformative"' },
  { re: /\btailored solutions?\b/i, label: '"tailored solutions"' },
  { re: /\bin today'?s (fast[- ]paced|competitive|digital|ever[- ]changing)\b/i, label: '"in today\'s fast-paced world"' },
  { re: /\bever[- ](changing|evolving)\b/i, label: '"ever-changing"' },
  { re: /\b(navigate|navigating) the (complex|ever)/i, label: '"navigate the complex..."' },
  { re: /\b(competitive|digital|business|current|evolving|changing) landscape\b/i, label: '"the competitive landscape"' },
  { re: /\bmove the needle\b|\bneedle[- ]moving\b/i, label: '"move the needle"' },
  { re: /\blow[- ]hanging fruit\b/i, label: '"low-hanging fruit"' },
  { re: /\bpick your brain\b/i, label: '"pick your brain"' },
  { re: /\bat the end of the day\b/i, label: '"at the end of the day"' },
  // Machine rhythm.
  { re: /\b(it'?s|this is|that'?s) not just (a|an|about)\b/i, label: 'the "it\'s not just X, it\'s Y" construction' },
  { re: /\bnot only\b[^.?!]{0,80}\bbut also\b/i, label: '"not only... but also"' },
  { re: /\bhere'?s the (thing|kicker|truth)\b/i, label: '"here\'s the thing"' },
  { re: /\blet'?s be honest\b/i, label: '"let\'s be honest"' },
  { re: /\bimagine (a world|if you could)\b/i, label: '"imagine a world"' },
  // Needy or soft closes.
  { re: /\bI'?d (love|be thrilled|be excited) to\b|\bI would love to\b/i, label: '"I\'d love to"' },
  { re: /\b(I'?m|we'?re|I am|we are) (so )?(excited|thrilled) to\b/i, label: '"excited to"' },
  { re: /\bdon'?t hesitate to\b/i, label: '"don\'t hesitate to"' },
  { re: /\bfeel free to (reach out|get in touch|contact)\b/i, label: '"feel free to reach out"' },
  { re: /\blet me know if you have any questions\b/i, label: '"let me know if you have any questions"' },
  { re: /\b(I'?m |I am )?looking forward to (hearing from you|connecting|your reply)\b/i, label: '"looking forward to hearing from you"' },
  { re: /\beither way is (fine|ok|okay|totally fine)\b/i, label: '"either way is fine"' },
  { re: /\bno pressure( at all)?\b/i, label: '"no pressure"' },
];

const LONG_DASH = /[‒–—―⸺⸻]|(?<=\S) ?-- ?(?=\S)/;
const EMOJI = /\p{Extended_Pictographic}/u;

/** Words a reader reads: merge tags count as one word, HTML is ignored. */
export function plainWords(text: string): string {
  return (text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, 'X')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wordCount(text: string): number {
  const t = plainWords(text);
  return t ? t.split(' ').length : 0;
}

/**
 * Everything wrong with a piece of copy against the standard, as short
 * instructions the writer can act on. Empty means it passes.
 */
export function writingProblems(text: string, opts: { maxWords?: number; subject?: boolean } = {}): string[] {
  const raw = text || '';
  const words = plainWords(raw);
  const out: string[] = [];
  if (LONG_DASH.test(raw)) out.push('It uses a long dash. Use a full stop, a comma or a plain hyphen instead.');
  if (EMOJI.test(raw)) out.push('It uses an emoji. Remove it.');
  if (/!/.test(words)) out.push('It uses an exclamation mark. Remove it; let the words carry it.');
  for (const p of SLOP_PHRASES) {
    if (p.re.test(words)) out.push(`It says ${p.label}. Cut it and say the plain thing instead.`);
  }
  if (opts.maxWords && wordCount(raw) > opts.maxWords) {
    out.push(`It is ${wordCount(raw)} words. Bring it under ${opts.maxWords}.`);
  }
  if (opts.subject) {
    if (wordCount(raw) > 7) out.push('The subject is too long. Two to five words.');
    if (/[?]{2,}|[A-Z]{4,}/.test(raw)) out.push('The subject shouts. Plain words, no capitals or repeated punctuation.');
  }
  return out;
}

/**
 * The last line of defence: no long dash survives, whatever the model did.
 * "word - word" style asides become commas, number ranges become hyphens,
 * and a dash leading a line becomes a hyphen bullet.
 */
export function stripDashes(text: string): string {
  if (!text) return text;
  return text
    .replace(/(\d)\s*[‒–—―]\s*(\d)/g, '$1-$2')
    .replace(/(^|\n|>)[ \t]*[‒–—―][ \t]*/g, '$1- ')
    .replace(/[ \t]*(?:[‒–—―⸺⸻]|--)[ \t]*(?=[\n<]|$)/g, '.')
    .replace(/[ \t]*(?:[‒–—―⸺⸻]|(?<=\S) ?--(?= ?\S))[ \t]*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.?!:;])/g, '$1')
    .replace(/([.?!])\./g, '$1');
}

/* ── What the model is told ──────────────────────────────────────────── */

/** Distinct labels, for the "never write" list in the prompt. */
const NEVER = [...new Set(SLOP_PHRASES.map((p) => p.label))];

export const WRITING_STANDARD = `HOW YOU WRITE. This is the bar, not a suggestion.

Voice
- You are the sender: a senior operator writing to a peer between calls. Not a marketer, not a vendor, not an assistant.
- Plain words. Contractions. Short sentences; the odd fragment is fine. Cut every sentence that could go without losing anything.
- Use the reader's own vocabulary: the metrics, roles and terms people in their industry actually use, taken from the brief and the leads. Generic language marks you as an outsider.
- Observation before explanation. Say something true about their world before anything about yours. Never answer a question they have not asked.
- One idea per email. No feature lists, no stacked benefits, no paragraph about the company.
- Confident, never needy. No apologising for the email, no flattery, no hedging.

Proof
- Use only facts, numbers, names and results that appear in the brief or the conversation. If there is no proof, write without it. Never invent, never round up.
- Proof is where an insight came from ("working with platforms like yours taught us..."), never a boast.

The ask
- End with one question that can be answered in a line: binary ("is this already handled, or worth a look?"), a pointer to the right person, or a specific short call. Never an open-ended "let me know".

Format
- Plain text. Paragraphs of one or two sentences so it reads on a phone. No bold, no emojis, no exclamation marks, no links unless the brief requires one.
- NEVER use an em dash or en dash (— or –), and never "--". Use a full stop, a comma or a plain hyphen. This rule has no exceptions.
- Subject lines: two to five words, lowercase is fine, specific to the reader, no clickbait, no punctuation tricks.

Never write any of these. Each one marks an email as mass-produced or machine-written:
${NEVER.map((l) => `- ${l}`).join('\n')}

Before you answer, read it as the recipient would: a busy, sceptical person who gets fifty of these a week. If any line sounds like a template, a marketer or an AI, rewrite it.`;

/** What each email in a sequence is for, by position. */
const JOBS = {
  hook: (words: number) => `The reframe (under ${words} words). Open with an observation they will recognise about their world. Then the real problem behind the surface one, in their language. One line on who we are and what we change for companies like theirs. Close with a binary question, e.g. "is {{company|your team}} already sorted on this, or is it worth a look?". No numbers or proof yet.`,
  insight: (words: number) => `Authority through insight (under ${words} words). A pattern learned from working in their space (only what the brief supports). Name the hidden cost: usually time or uncertainty, not money. Say what people in their seat actually want. End with a helpful question, e.g. "would it help to see how other teams set this up?". Never "just following up".`,
  pressure: (words: number) => `Self-assessment (under ${words} words). One thing that quietly gets expensive at their scale, and why it should not still be happening. How others in their position handle it now. A direct question about their current setup.`,
  proof: (words: number) => `The example (under ${words} words). One specific example from the brief, with its numbers and how it worked day to day. If the brief has no example, paint a concrete picture of how the first month works instead and invent nothing. Ask for 15 minutes.`,
  close: (words: number) => `The close (under ${words} words). Say this is the last note. Tie it to a real moment if the brief gives one (a planning cycle, a quarter), never a fake deadline. Ask for a one-word answer: "reply YES and I'll send the specifics for {{company|your team}}, or NO and I'll leave it there." End with confidence ("either way, I'll know where we stand"), never "either way is fine".`,
} as const;

/** Word ceiling per job, enforced by the check as well as the prompt. */
export const JOB_WORDS = { hook: 120, insight: 120, pressure: 120, proof: 130, close: 100 } as const;
export type SequenceJob = keyof typeof JOBS;

/** Which jobs a sequence of n emails gets, in order. */
export function sequenceJobs(n: number): SequenceJob[] {
  const count = Math.max(1, Math.min(6, Math.round(n) || 1));
  const plans: Record<number, SequenceJob[]> = {
    1: ['hook'],
    2: ['hook', 'close'],
    3: ['hook', 'insight', 'close'],
    4: ['hook', 'insight', 'proof', 'close'],
    5: ['hook', 'insight', 'pressure', 'proof', 'close'],
    6: ['hook', 'insight', 'pressure', 'proof', 'insight', 'close'],
  };
  return plans[count];
}

/** The per-email brief for a sequence of n emails. */
export function sequencePlaybook(n: number): string {
  return sequenceJobs(n)
    .map((job, i) => `- Email ${i + 1}: ${JOBS[job](JOB_WORDS[job])}`)
    .join('\n');
}

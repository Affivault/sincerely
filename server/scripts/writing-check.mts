/* ═══════════════════════════════════════════════════════════════════════
   Relay writes like a senior operator, not a template - and never with a
   long dash.

   Run: npx tsx scripts/writing-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writingProblems, stripDashes, wordCount, WRITING_STANDARD, sequencePlaybook, sequenceJobs, JOB_WORDS,
  challengerProblems, referralIntro,
} from '@lemlist/shared';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};
const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '../src', p), 'utf8');
const LONG = /[‒-―]/;
/** The words in a stretch of source: its string literals, without the code or ${...}. */
const copyIn = (code: string) => [...code.matchAll(/`((?:[^`\\]|\\.)*)`|'((?:[^'\\\n]|\\.)*)'/g)]
  .map((m) => (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ' ').replace(/\\n/g, '\n').replace(/\\'/g, "'"))
  .join('\n');

console.log('\nthe check catches what marks an email as machine-written');
{
  is('an em dash', writingProblems('We help brokers — fast.').some((p) => /long dash/.test(p)));
  is('an en dash', writingProblems('We help brokers – fast.').some((p) => /long dash/.test(p)));
  is('a double hyphen', writingProblems('We help brokers -- fast.').some((p) => /long dash/.test(p)));
  is('an emoji', writingProblems('Worth a look? \u{1F680}').some((p) => /emoji/.test(p)));
  is('an exclamation mark', writingProblems('Great to meet you!').some((p) => /exclamation/.test(p)));
  const slop = [
    'I hope this email finds you well.',
    "Hope you're doing well.",
    'I wanted to reach out about your pipeline.',
    'I came across your website.',
    "I'll keep this short.",
    'Just following up on this.',
    'Circling back on my note.',
    'Can we touch base next week?',
    'Our platform is a game-changer.',
    'We leverage AI to unlock growth.',
    'A seamless, cutting-edge, best-in-class solution.',
    "In today's fast-paced world, teams struggle.",
    "It's not just a tool, it's a partner.",
    "I'd love to show you.",
    "Don't hesitate to reach out.",
    'Let me know if you have any questions.',
    'Looking forward to hearing from you.',
    'Either way is fine.',
  ];
  for (const s of slop) is(`flags: ${s}`, writingProblems(s).length > 0);
  const clean = `Hi {{first_name|there}},

Most ISA platforms don't have an acquisition problem. They have a forecasting problem that shows up as one.

We run vetted affiliate partnerships for UK investment platforms, paid on funded accounts.

Is {{company|your team}} already sorted on partner volume this quarter, or is it worth a look?

Alex`;
  is('good copy passes clean', writingProblems(clean, { maxWords: 120 }).length === 0, writingProblems(clean).join(' | '));
  is('plain hyphens and "reach out to Sam" are fine', writingProblems('A low-risk test. You could reach out to Sam on the partner team.').length === 0);
  is('length is held to the job', writingProblems('word '.repeat(130), { maxWords: 120 }).some((p) => /Bring it under 120/.test(p)));
  is('merge tags count as one word', wordCount('Hi {{first_name|there my friend}},') === 2);
  is('a long subject is flagged', writingProblems('a very long subject line that goes on and on', { subject: true }).length > 0);
}

console.log('\nno long dash survives');
{
  is('an aside becomes a comma', stripDashes('We help brokers — fast.') === 'We help brokers, fast.', stripDashes('We help brokers — fast.'));
  is('unspaced too', stripDashes('brokers—fast') === 'brokers, fast');
  is('a range becomes a hyphen', stripDashes('10–20 accounts') === '10-20 accounts');
  is('a dash bullet becomes a hyphen bullet', stripDashes('— first\n— second') === '- first\n- second', JSON.stringify(stripDashes('— first\n— second')));
  is('a trailing dash ends the sentence', stripDashes('Worth a look —\nAlex') === 'Worth a look.\nAlex', JSON.stringify(stripDashes('Worth a look —\nAlex')));
  is('inside HTML', stripDashes('<p>One thing — the cost.</p>') === '<p>One thing, the cost.</p>');
  is('no double punctuation left behind', stripDashes('Fast —, cheap.') === 'Fast, cheap.', stripDashes('Fast —, cheap.'));
  is('plain text is untouched', stripDashes('A low-risk test, 10-20 sends.') === 'A low-risk test, 10-20 sends.');
}

console.log('\nwhat Relay is told');
{
  is('the standard bans long dashes outright', /NEVER use an em dash or en dash/.test(WRITING_STANDARD));
  is('it never invents proof', /Never invent, never round up/.test(WRITING_STANDARD));
  is('it lists the phrases it must not write', /"I hope this email finds you well"/.test(WRITING_STANDARD) && /"circling back"/.test(WRITING_STANDARD));
  is('every sequence length has a plan', [1, 2, 3, 4, 5, 6].every((n) => sequenceJobs(n).length === n));
  is('every sequence opens with the reframe and ends with the close', [2, 3, 4, 5, 6].every((n) => sequenceJobs(n)[0] === 'hook' && sequenceJobs(n)[n - 1] === 'close'));
  is('the close is a yes or no, never "either way is fine"', /reply YES/.test(sequencePlaybook(3)) && /never "either way is fine"/.test(sequencePlaybook(3)));
  is('proof only from the brief', /invent nothing/.test(sequencePlaybook(4)));
  is('every job has a word ceiling', Object.values(JOB_WORDS).every((w) => w >= 90 && w <= 130));
}

console.log('\nevery writer is held to it');
{
  const ai = src('services/ai.service.ts');
  is('the house rules are the standard', /const HOUSE_RULES = WRITING_STANDARD;/.test(ai));
  for (const fn of ['readReply', 'draftReply', 'writeSequence', 'firstLines', 'writeChallenger']) {
    is(`${fn} is checked and sent back once if it falls short`, new RegExp(`label: '${fn}' \\},`).test(ai));
  }
  is('a draft that falls short goes back with the list of what is wrong', /Your previous draft broke the writing standard/.test(ai));
  is('the cleaner of the two drafts is kept', /problemsIn\(copy\(second\)\)\.length <= problems\.length \? second : first/.test(ai));
  is('dashes are stripped from everything Relay writes', (ai.match(/stripDashes\(/g) || []).length >= 7);
  is('a first line still carrying a stock phrase is dropped for the fallback', /writingProblems\(line, \{ maxWords: 30 \}\)\.length \? '' : line/.test(ai));
  is('sequences follow the playbook', /sequencePlaybook\(input\.steps\)/.test(ai));
  is('the person\'s own words are not counted against a test version', /ignore: already\.body/.test(ai));
}

console.log('\ntest versions meet it too');
{
  const original = { subject: 'partners for brokers', body_html: '<p>Hi {{first_name|there}},</p><p>We help brokers grow.</p><p>Worth a call?</p>' };
  is('a test version with a long dash is refused', challengerProblems(original, { subject: null, body_html: '<p>Hi {{first_name|there}},</p><p>Brokers grow — with partners.</p><p>Worth a call?</p>' }, 'opening').some((p) => /writing standard/.test(p)));
  is('a test version with a stock phrase is refused', challengerProblems(original, { subject: null, body_html: '<p>Hi {{first_name|there}},</p><p>I came across your brokerage.</p><p>Worth a call?</p>' }, 'opening').some((p) => /writing standard/.test(p)));
  const theirs = { subject: 'partners', body_html: "<p>Hi {{first_name|there}},</p><p>Hope you're well.</p><p>We help brokers grow.</p><p>Worth a call?</p>" };
  is('what the person already wrote is not held against Relay', challengerProblems(theirs, { subject: 'brokers and partners', body_html: null }, 'subject').length === 0, challengerProblems(theirs, { subject: 'brokers and partners', body_html: null }, 'subject').join(' | '));
}

console.log('\nthe words Relay ships without Claude');
{
  const presets = src('services/template.service.ts');
  const block = presets.slice(presets.indexOf('const PRESET_EMAIL_TEMPLATES'), presets.indexOf('// ─── Service'));
  const bodies = [...block.matchAll(/body_html: `([\s\S]*?)`,/g)].map((m) => m[1]);
  const subjects = [...block.matchAll(/subject: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  is('every preset is there', bodies.length === 8 + 3 + 5 + 3 + 4 && subjects.length === bodies.length, `${bodies.length} bodies, ${subjects.length} subjects`);
  const badBodies = bodies.map((b, i) => [i, writingProblems(b, { maxWords: 130 })] as const).filter(([, p]) => p.length);
  is('every preset email meets the standard', badBodies.length === 0, badBodies.map(([i, p]) => `#${i}: ${p.join('; ')}`).join('\n         '));
  const badSubjects = subjects.filter((s) => writingProblems(s, { subject: true }).length);
  is('every preset subject meets the standard', badSubjects.length === 0, badSubjects.join(' | '));
  is('no long dash anywhere in the presets', !LONG.test(block));

  const writer = src('services/sequence-writer.service.ts');
  const tpl = writer.slice(writer.indexOf('function templateSequence'), writer.indexOf('export const sequenceWriterService'));
  is('the fallback sequence copy is read', /Last note from me on this/.test(copyIn(tpl)) && /who should I speak to\?/.test(copyIn(tpl)));
  is('the fallback sequence meets the standard', writingProblems(copyIn(tpl)).length === 0, writingProblems(copyIn(tpl)).join(' | '));
  is('the fallback first line meets it', !/Came across your team/.test(writer) && /const FIRST_LINE_FALLBACK = 'This is probably something that lands on your desk\.';/.test(writer));
  is('the fallback sequence closes with a yes or no', /Reply YES and I'll send the specifics/.test(tpl));

  const inbox = src('services/inbox.service.ts');
  const canned = inbox.slice(inbox.indexOf('// Word boundaries matter'), inbox.indexOf('const html = `<div', inbox.indexOf('// Word boundaries matter')));
  is('the canned reply copy is read', /Does Tuesday or Thursday afternoon work/.test(copyIn(canned)) && /I'll pass for the moment/.test(copyIn(canned)));
  is('the canned replies meet the standard', writingProblems(copyIn(canned)).length === 0, writingProblems(copyIn(canned)).join(' | '));
  is('"not now" is read as timing, not a decline', canned.indexOf('not now|later') < canned.indexOf('decline|no|'));
  is('"no" only matches the word', /\\b\(decline\|no\|not interested\|pass\|reject\)\\b/.test(canned));

  const intro = referralIntro({ toFirstName: 'Sam', referrerFirstName: 'Jane', referrerCompany: 'Acme', offer: 'We run partner programmes — paid on results.', senderFirstName: 'Alex' });
  is('the referral intro meets the standard', writingProblems(intro.body).length === 0, writingProblems(intro.body).join(' | '));
  is('even the person\'s own offer loses its long dash', !LONG.test(intro.body));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

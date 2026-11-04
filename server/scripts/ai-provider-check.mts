/*
 * AI provider switch.
 *
 * Every AI feature (SARA's reply reading, drafts, sequences, first lines,
 * test versions, Moments) goes through one structured() call. This drives
 * the real service against a stubbed DeepSeek and pins down:
 *
 *   - AI_PROVIDER=auto prefers DeepSeek, falls back to Claude, and "off"
 *     means no key at all
 *   - the request is OpenAI-format JSON mode with the schema in the prompt
 *   - a good answer is parsed; a truncated, non-JSON or off-schema answer is
 *     null so the rules take over
 *   - a rejected key does not retry; a 5xx retries, then gives up quietly
 */
process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.DEEPSEEK_API_KEY = 'ds-test-key';
process.env.ANTHROPIC_API_KEY = '';
process.env.AI_PROVIDER = 'auto';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const { env } = await import('../src/config/env.js');
const ai = await import('../src/services/ai.service.js');

/* ── A stubbed DeepSeek ─────────────────────────────────────────────── */
type Reply = { status: number; body: unknown };
let queue: Reply[] = [];
const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
  const next = queue.shift() ?? { status: 500, body: { error: 'no stub' } };
  return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status });
}) as typeof fetch;
const answer = (content: string, finish = 'stop'): Reply => ({ status: 200, body: { choices: [{ finish_reason: finish, message: { content } }] } });

const reading = { intent: 'interested', confidence: 0.9, summary: 'Wants pricing.', next_step: 'Send pricing.', needs_reply: true };
const input = { subject: 'Re: hello', freshText: 'Sounds good, what does it cost?' };

console.log('\nwhich model');
{
  is('auto picks DeepSeek when its key is set', ai.aiProvider() === 'deepseek' && ai.aiEngineName() === 'DeepSeek');
  env.ANTHROPIC_API_KEY = 'sk-ant-test';
  is('auto still prefers DeepSeek with both keys', ai.aiProvider() === 'deepseek');
  env.AI_PROVIDER = 'anthropic';
  is('AI_PROVIDER=anthropic switches back to Claude', ai.aiProvider() === 'anthropic' && ai.aiEngineName() === 'Claude');
  env.AI_PROVIDER = 'auto';
  env.DEEPSEEK_API_KEY = '';
  is('auto falls back to Claude without a DeepSeek key', ai.aiProvider() === 'anthropic');
  env.ANTHROPIC_API_KEY = '';
  is('no key, no AI, and the rules run', ai.aiProvider() === null && !ai.aiAvailable());
  env.AI_PROVIDER = 'deepseek';
  is('AI_PROVIDER=deepseek without its key is off, not Claude', ai.aiProvider() === null);
  env.DEEPSEEK_API_KEY = 'ds-test-key';
  env.AI_PROVIDER = 'auto';
  env.DEEPSEEK_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
  is('another OpenAI-compatible endpoint is named for what it is', ai.aiEngineName() === 'Gemini');
  env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
}

console.log('\nthe call');
{
  calls.length = 0;
  queue = [answer(JSON.stringify({ ...reading, draft: '' }))];
  const out = await ai.readReply(input);
  const c = calls[0];
  is('it posts to DeepSeek chat completions', !!c && c.url === 'https://api.deepseek.com/chat/completions');
  is('with the key as a bearer token', c?.headers?.Authorization === 'Bearer ds-test-key');
  is('in JSON mode on the configured model', c?.body?.response_format?.type === 'json_object' && c?.body?.model === env.DEEPSEEK_MODEL);
  is('with the schema in the system prompt', c?.body?.messages?.[0]?.role === 'system' && /"intent"/.test(c.body.messages[0].content) && /JSON Schema/.test(c.body.messages[0].content));
  is('output tokens are capped at what deepseek-chat allows', (c?.body?.max_tokens ?? 0) <= 4096);
  is('a good answer comes back parsed', out?.intent === 'interested' && out?.summary === 'Wants pricing.', JSON.stringify(out));
}

console.log('\nwhen it goes wrong');
{
  queue = [answer('{"intent": "interested"', 'length')];
  is('a truncated answer is null', (await ai.readReply(input)) === null);
  queue = [answer('Sure! Here you go.')];
  is('an answer that is not JSON is null', (await ai.readReply(input)) === null);
  queue = [answer(JSON.stringify({ intent: 'maybe' }))];
  is('an answer off the schema is null', (await ai.readReply(input)) === null);
  queue = [answer('```json\n' + JSON.stringify({ ...reading, draft: '' }) + '\n```')];
  is('a fenced answer is still read', (await ai.readReply(input))?.intent === 'interested');
  calls.length = 0;
  queue = [{ status: 401, body: { error: 'bad key' } }];
  is('a rejected key is null', (await ai.readReply(input)) === null);
  is('and is not retried', calls.length === 1, `${calls.length} calls`);
  calls.length = 0;
  queue = [{ status: 503, body: {} }, answer(JSON.stringify({ ...reading, draft: '' }))];
  is('a 5xx is retried', (await ai.readReply(input))?.intent === 'interested' && calls.length === 2, `${calls.length} calls`);
}

console.log('\nevery AI feature reaches DeepSeek');
{
  const tries: [string, () => Promise<unknown>][] = [
    ['readReply', () => ai.readReply(input)],
    ['draftReply', () => ai.draftReply({ instruction: 'say yes', thread: 'Can we talk Tuesday?' })],
    ['writeSequence', () => ai.writeSequence({ offer: 'payroll software', audience: 'CFOs', goal: 'a call', tone: 'friendly', steps: 3, sampleLeads: [], usesFirstLines: false })],
    ['firstLines', () => ai.firstLines({ offer: 'payroll software', tone: 'friendly', leads: [{ id: '1', company: 'Acme' }] })],
    ['writeChallenger', () => ai.writeChallenger({ element: 'subject', emailNumber: 1, subject: 'hello', bodyHtml: '<p>Hi</p>', replies: [], learned: [] } as Parameters<typeof ai.writeChallenger>[0])],
    ['suggestSignalTopics', () => ai.suggestSignalTopics('payroll software')],
    ['judgePageChange', () => ai.judgePageChange({ offer: 'payroll', topics: ['hiring finance'], company: 'Acme', pageKind: 'careers', url: 'https://acme.test/careers', added: 'We are hiring a CFO' })],
    ['writeMomentEmail', () => ai.writeMomentEmail({ moment: 'Hiring a CFO' } as Parameters<typeof ai.writeMomentEmail>[0])],
  ];
  for (const [name, run] of tries) {
    calls.length = 0;
    queue = [{ status: 400, body: { error: 'stub' } }];
    let threw = '';
    try { await run(); } catch (err) { threw = (err as Error)?.message || String(err); }
    const sys = calls[0]?.body?.messages?.[0]?.content || '';
    is(`${name} sends its schema to DeepSeek`, !threw && calls.length >= 1 && /JSON Schema/.test(sys) && /"type"/.test(sys), threw || `${calls.length} calls`);
  }
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

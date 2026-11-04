// Drives the full-app harness (vite.app-harness.config.ts, port 5198): plants
// a signed-in session, answers every API call from fixtures.cjs, and records
// what each page asked for and any errors it threw.
//
// Playwright and Chromium are found through PLAYWRIGHT_MODULE / CHROME_PATH
// when set; the defaults are where the cloud dev container keeps them.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fixtures = require('./fixtures.cjs');
const B = 'http://localhost:5198';
const now = Math.floor(Date.now() / 1000);
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'alex@affivault.com', user_metadata: { full_name: 'Alex Morgan' }, app_metadata: { provider: 'email' }, created_at: '2026-01-01T00:00:00Z' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', exp: now + 36000, email: user.email, role: 'authenticated' })}.sig`;
const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 36000, expires_at: now + 36000, user };

async function open(opts = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
  // signedOut: a visitor with no session (login and sign-up pages).
  await ctx.addInitScript(([s, d, out, last]) => {
    if (!out) localStorage.setItem('sb-127-auth-token', s);
    if (last) localStorage.setItem('sincerely:last-sign-in', last);
    localStorage.setItem('sincerely-theme', d ? 'dark' : 'light');
  }, [JSON.stringify(session), !!opts.dark, !!opts.signedOut, opts.lastSignIn || '']);
  const log = { requests: [], errors: [] };
  await ctx.route('http://127.0.0.1:1/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    // Which sign-in providers are switched on (the login page asks).
    if (u.pathname === '/auth/v1/settings') return route.fulfill({ json: { external: { email: true, google: true, azure: opts.noMicrosoft ? false : true } }, headers: { 'access-control-allow-origin': '*' } });
    if (u.pathname.startsWith('/auth/v1') || u.pathname.startsWith('/rest/v1')) return route.fulfill({ json: u.pathname.endsWith('/user') ? user : session });
    const p = u.pathname.replace('/api/v1', '');
    const body = fixtures.answer(req.method(), p, u.searchParams, req.postData());
    log.requests.push(`${req.method()} ${p}${u.search} -> ${body === undefined ? 'DEFAULT' : 'fx'}`);
    // A fixture can answer with a status: { __status, __body }.
    if (body && body.__status) return route.fulfill({ status: body.__status, json: body.__body, headers: { 'access-control-allow-origin': '*' } });
    return route.fulfill({ status: 200, json: body === undefined ? [] : body, headers: { 'access-control-allow-origin': '*' } });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(`console: ${m.text().slice(0, 300)}`); });
  return { browser, page, log };
}
module.exports = { open, B };

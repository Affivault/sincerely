/**
 * Stand-in for the Sincerely API, shaped exactly like the real one so the
 * extension can be exercised end-to-end without touching live data.
 * Mirrors response shapes from server/src/{routes,services}.
 */
import { createServer } from 'node:http';
import { TEST_API_KEY, TEST_JWT } from './fixtures.mjs';
const VALID_KEY = TEST_API_KEY;
const VALID_JWT = TEST_JWT;

const PORT = 3001;

/** Stands in for a Supabase access token held in the app page's localStorage. */

/** Keys minted through POST /api-keys, so a test can assert exactly one was. */
let mintedKeys = [];

const campaigns = [
  { id: 'c1', name: 'Q3 Brokers Outreach', status: 'running', total_contacts: 120, list_id: 'L1' },
  { id: 'c2', name: 'Warm Reactivation', status: 'draft', total_contacts: 0, list_id: 'L2' },
  { id: 'c3', name: 'Spring Promo (done)', status: 'completed', total_contacts: 400, list_id: 'L1' },
  { id: 'c4', name: 'Paused Partners', status: 'paused', total_contacts: 40, list_id: 'L1' },
];

/**
 * Lead lists. These, not campaigns, are what the extension writes to: a campaign
 * is bound to one list and draws from it, so list membership is the thing that
 * actually gets somebody emailed.
 * Mirrors server/src/routes/list.routes.ts.
 */
const LIST_FIXTURE = [
  { id: 'L1', name: 'Brokers — UK', contact_count: 120, is_default: true, color: '#5b5bf5' },
  { id: 'L2', name: 'Warm leads', contact_count: 8, is_default: false, color: '#10b981' },
  { id: 'L3', name: 'Conference — Q3', contact_count: 0, is_default: false, color: '#f59e0b' },
];

let lists = [];
/** list id -> Set(contact id) */
let listMembers = new Map();

// Flipped on via GET /__arm-cold-start by the test harness.
const coldStart = { armed: false, delayed: 0, delayMs: 25000 };

/** Every request the extension has made, so a test can assert on cost. */
export const calls = [];

let contacts = [];
/** contact id -> [{campaign_id, status, current_step_order}] */
let enrolments = new Map();
let suppressed = new Set();
let tags = [];
let tagApplications = [];

/**
 * Restore the starting fixture. Called on boot and by GET /__reset, so a test
 * run never inherits the previous run's mutations.
 */
function reset() {
  contacts = [
    {
      id: 'k1',
      email: 'jane.doe@acme.com',
      first_name: 'Jane',
      last_name: 'Doe',
      company: 'Acme Ltd',
      job_title: 'Head of Trading',
    },
  ];
  enrolments = new Map([['k1', [{ campaign_id: 'c1', status: 'active', current_step_order: 1 }]]]);
  lists = LIST_FIXTURE.map((list) => ({ ...list }));
  listMembers = new Map([
    ['L1', new Set(['k1'])],
    ['L2', new Set()],
    ['L3', new Set()],
  ]);
  suppressed = new Set();
  tags = [{ id: 't1', name: 'existing-tag', color: '#000' }];
  tagApplications = [];
  prospector.provider = 'pdl';
  prospector.remaining = 25;
  prospector.reveals = new Set();
  coldStart.armed = false;
  coldStart.delayed = 0;
  mintedKeys = [];
  // Request log too, so a test can measure the cost of one flow rather than
  // everything the suite has done so far.
  calls.length = 0;
}

/** Prospector fixture — a provider, a credit balance, and two people. */
const prospector = { provider: 'pdl', remaining: 25, reveals: new Set() };
const PROSPECT_PEOPLE = [
  {
    id: 'p-sam',
    provider: 'pdl',
    first_name: 'Sam',
    last_name: 'Rivera',
    full_name: 'Sam Rivera',
    job_title: 'Head of Growth',
    company: 'Northwind Capital',
    location: 'London',
    linkedin_url: 'https://www.linkedin.com/in/sam-rivera/',
    has_email: true,
  },
  {
    id: 'p-nomail',
    provider: 'pdl',
    first_name: 'No',
    last_name: 'Mailbox',
    full_name: 'No Mailbox',
    job_title: 'Analyst',
    company: 'Northwind Capital',
    location: 'London',
    linkedin_url: 'https://www.linkedin.com/in/no-mailbox/',
    has_email: false,
  },
];
reset();

// contact id -> activity rows, newest first (matches analyticsService ordering)
const timelines = new Map([
  ['k1', [
    { activity_type: 'opened', campaign_name: 'Q3 Brokers Outreach', step_subject: 'Quick question', occurred_at: '2026-07-27T10:00:00.000Z' },
    { activity_type: 'opened', campaign_name: 'Q3 Brokers Outreach', step_subject: 'Quick question', occurred_at: '2026-07-26T10:00:00.000Z' },
    { activity_type: 'sent', campaign_name: 'Q3 Brokers Outreach', step_subject: 'Quick question', occurred_at: '2026-07-25T10:00:00.000Z' },
  ]],
]);

function json(res, status, body) {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/^\/api\/v1/, '');
  const body = await readBody(req);
  calls.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), body });

  if (req.method === 'OPTIONS') return json(res, 204, null);

  // Simulates a free-tier host waking up: the next /campaigns request is
  // answered, but only after a delay longer than the normal 20s timeout.
  // A real cold start is slow, not dead, so a hang would be the wrong shape.
  /*
   * Stall the first read of the lead lists, which is what testConnection asks
   * for — free hosting tiers sleep, and the first request of a session pays for
   * waking them. Keyed to /lists rather than /campaigns: that was the old
   * connection probe, and leaving it there meant the cold-start suite armed a
   * delay nothing ever hit, so it passed by never being tested.
   */
  if (coldStart.armed && url.pathname.endsWith('/lists')) {
    coldStart.armed = false;
    coldStart.delayed += 1;
    await new Promise((resolve) => setTimeout(resolve, coldStart.delayMs));
  }

  if (req.method === 'GET' && url.pathname === '/__arm-cold-start') {
    coldStart.armed = true;
    if (url.searchParams.has('delayMs')) coldStart.delayMs = Number(url.searchParams.get('delayMs'));
    return json(res, 200, { armed: true, delayMs: coldStart.delayMs });
  }
  // Test introspection — above the auth gate, since harness fetches are
  // deliberately unauthenticated.
  if (req.method === 'GET' && url.pathname === '/__reset') {
    reset();
    return json(res, 200, { reset: true });
  }
  if (req.method === 'GET' && url.pathname === '/__minted-keys') {
    return json(res, 200, { keys: mintedKeys });
  }
  if (req.method === 'GET' && url.pathname === '/__set-prospector') {
    prospector.provider = url.searchParams.get('provider') === 'none' ? null : 'pdl';
    return json(res, 200, { provider: prospector.provider });
  }
  if (req.method === 'GET' && url.pathname === '/__tag-applications') {
    return json(res, 200, { applications: tagApplications, tags });
  }
  if (req.method === 'GET' && url.pathname === '/__cold-start-stats') {
    return json(res, 200, { armed: coldStart.armed, delayed: coldStart.delayed });
  }
  /*
   * How many API requests the extension has made. Lets a test assert on cost
   * rather than only on correctness — the per-key limit is 100/minute, so a
   * handler that answers correctly in 145 requests is still broken.
   */
  if (req.method === 'GET' && url.pathname === '/__call-count') {
    return json(res, 200, { total: calls.filter((c) => !c.path.startsWith('/__')).length });
  }

  // A person page served from an origin that IS in host_permissions, so the
  // service worker can inject the scraper into it for real.
  if (req.method === 'GET' && url.pathname === '/fixture') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!doctype html><html><head>
      <title>Sam Rivera — Head of Growth</title>
      <meta property="og:site_name" content="Northwind Capital" />
    </head><body>
      <h1>Sam Rivera 2nd</h1>
      <p>Direct: <a href="mailto:sam.rivera@northwind.example.org">sam.rivera@northwind.example.org</a></p>
      <p>Role inbox: <a href="mailto:no-reply@northwind.example.org">no-reply@northwind.example.org</a></p>
      <p>Second contact: <a href="mailto:dana.k@northwind.example.org">dana.k@northwind.example.org</a></p>
      <img src="icon@2x.png" alt="" />
    </body></html>`);
  }

  // Several [email] attributes, the shape Gmail uses. A /g regex reused with
  // .test() drops alternate ones, so this page proves they all survive.
  if (req.method === 'GET' && url.pathname === '/attr-fixture') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!doctype html><html><head><title>Thread</title></head><body>
      <span email="one.person@northwind.example.org" name="One Person">One</span>
      <span email="two.person@northwind.example.org" name="Two Person">Two</span>
      <span email="three.person@northwind.example.org" name="Three Person">Three</span>
      <span email="four.person@northwind.example.org" name="Four Person">Four</span>
    </body></html>`);
  }

  if (req.method === 'GET' && url.pathname === '/team-fixture') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!doctype html><html><head>
      <title>The team — Northwind</title>
      <meta property="og:site_name" content="Northwind Capital" />
    </head><body>
      <h1>Our team</h1>
      <a href="mailto:ana.silva@northwind.example.org">Ana Silva</a>
      <a href="mailto:ben.oyelaran@northwind.example.org">Ben Oyelaran</a>
      <a href="mailto:cara.dunne@northwind.example.org">Cara Dunne</a>
      <a href="mailto:no-reply@northwind.example.org">Do not reply</a>
    </body></html>`);
  }

  // A small company site for the harvester: a homepage that links onward, a
  // contact page, and a team page whose addresses are obfuscated the way real
  // sites obfuscate them.
  if (req.method === 'GET' && ['/', '/contact', '/team', '/about'].includes(url.pathname)) {
    const cf = (email, key = 0x2a) => {
      let hex = key.toString(16).padStart(2, '0');
      for (const ch of email) hex += (ch.charCodeAt(0) ^ key).toString(16).padStart(2, '0');
      return hex;
    };
    const pages = {
      '/': `<h1>Northwind Capital</h1>
        <a href="/contact">Contact us</a> <a href="/team">Our team</a>
        <a href="/blog/hello">Blog</a> <a href="https://twitter.com/nw">Twitter</a>`,
      '/contact': `<h1>Contact</h1>
        <p>General: <a href="mailto:info@northwind.example.org">info@northwind.example.org</a></p>
        <p>Press: press&#64;northwind&#46;example&#46;org</p>
        <p>Do not reply: no-reply@northwind.example.org</p>`,
      '/team': `<h1>Our team</h1>
        <div>Ana Silva, Managing Partner —
          <a class="__cf_email__" data-cfemail="${''}">x</a></div>
        <div>Ben Oyelaran, Head of Trading — ben.oyelaran (at) northwind (dot) example (dot) org</div>
        <div>Cara Dunne — <a href="mailto:cara.dunne@northwind.example.org">email</a></div>`,
      '/about': `<h1>About</h1><p>Founded 2019.</p>`,
    };
    let body = pages[url.pathname];
    if (url.pathname === '/team') {
      body = body.replace('data-cfemail=""', `data-cfemail="${cf('ana.silva@northwind.example.org')}"`);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<!doctype html><html><head><title>Northwind</title></head><body>${body}</body></html>`);
  }

  const auth = req.headers.authorization || '';

  // Mirrors jwtOnly on POST /api-keys: a real user session mints keys, an API
  // key never can. The extension's tab connect uses the Supabase JWT it reads
  // out of the app page, so this is the path that flow depends on.
  if (req.method === 'POST' && path === '/api-keys') {
    if (auth.startsWith('Bearer sk_live_')) {
      return json(res, 403, { error: 'This endpoint requires a user session; API keys are not accepted here' });
    }
    if (auth !== `Bearer ${VALID_JWT}`) return json(res, 401, { error: 'Unauthorized' });
    if (!body?.name) return json(res, 400, { error: 'name is required' });
    mintedKeys.push({ name: body.name, rate_limit: body.rate_limit });
    return json(res, 201, {
      id: `key-${mintedKeys.length}`,
      name: body.name,
      raw_key: VALID_KEY,
      scopes: ['read', 'write'],
      rate_limit: body.rate_limit ?? 100,
    });
  }
  // Mirrors apiKeyMiddleware: only sk_live_ tokens are treated as API keys.
  if (!auth.startsWith('Bearer sk_live_')) return json(res, 401, { error: 'Invalid or expired API key' });
  if (auth !== `Bearer ${VALID_KEY}`) return json(res, 401, { error: 'Invalid or expired API key' });

  /* ---------------- Lead lists ---------------- */

  // GET /lists — default first, then by name, as the server returns them.
  if (req.method === 'GET' && path === '/lists') {
    const ordered = [...lists].sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return json(res, 200, ordered);
  }

  // GET /lists/contact/:id — every list, flagged with membership.
  const listsForContact = path.match(/^\/lists\/contact\/([^/]+)$/);
  if (req.method === 'GET' && listsForContact) {
    const contactId = listsForContact[1];
    return json(
      res,
      200,
      lists.map((list) => ({
        ...list,
        is_member: (listMembers.get(list.id) || new Set()).has(contactId),
      }))
    );
  }

  const listContacts = path.match(/^\/lists\/([^/]+)\/contacts$/);

  // GET /lists/:id/contacts — the ids already on it. One request, so a bulk add
  // can tell "added" from "was already there"; the upsert below cannot.
  if (req.method === 'GET' && listContacts) {
    const list = lists.find((l) => l.id === listContacts[1]);
    if (!list) return json(res, 404, { error: 'List not found' });
    return json(res, 200, { contact_ids: [...(listMembers.get(list.id) || new Set())] });
  }

  // POST /lists/:id/contacts — upsert, so re-adding is a no-op not an error.
  if (req.method === 'POST' && listContacts) {
    const list = lists.find((l) => l.id === listContacts[1]);
    // testConnection's write-scope probe posts to an all-zeros UUID: it must get
    // past the scope gate and fail on ownership, exactly like the server.
    if (!list) return json(res, 404, { error: 'List not found' });

    const ids = body.contact_ids || [];
    const members = listMembers.get(list.id) || new Set();
    let added = 0;
    for (const id of ids) {
      if (!members.has(id)) added += 1;
      members.add(id);
    }
    listMembers.set(list.id, members);
    list.contact_count = members.size;
    return json(res, 200, { success: ids.length, failed: 0, added });
  }

  // DELETE /lists/:id/contacts
  if (req.method === 'DELETE' && listContacts) {
    const list = lists.find((l) => l.id === listContacts[1]);
    if (!list) return json(res, 404, { error: 'List not found' });
    const members = listMembers.get(list.id) || new Set();
    for (const id of body.contact_ids || []) members.delete(id);
    listMembers.set(list.id, members);
    list.contact_count = members.size;
    return json(res, 204, null);
  }

  // GET /campaigns
  if (req.method === 'GET' && path === '/campaigns') {
    const limit = Number(url.searchParams.get('limit') || 25);
    return json(res, 200, {
      data: campaigns.slice(0, limit),
      total: campaigns.length,
      page: 1,
      limit,
      total_pages: 1,
    });
  }

  // POST /campaigns/:id/enroll
  const enrollMatch = path.match(/^\/campaigns\/([^/]+)\/enroll$/);
  if (req.method === 'POST' && enrollMatch) {
    const campaignId = enrollMatch[1];
    const campaign = campaigns.find((c) => c.id === campaignId);
    // The write-scope probe hits an all-zeros UUID; assertOwnership 404s.
    if (!campaign) return json(res, 404, { error: 'Campaign not found' });
    if (['completed', 'cancelled'].includes(campaign.status)) {
      return json(res, 400, { error: 'This campaign has finished — pick an active or draft campaign.' });
    }
    const ids = body.contact_ids || [];
    if (ids.length === 0) return json(res, 400, { error: 'No contacts selected' });

    const existing = enrolments.get(ids[0]) || [];
    if (existing.some((e) => e.campaign_id === campaignId)) {
      return json(res, 200, { added: 0, skipped: ids.length, total: existing.length });
    }

    // Mirrors campaignContactsService.add: blocked when already in another
    // ACTIVE campaign bound to a DIFFERENT lead list.
    const ACTIVE = ['draft', 'scheduled', 'running', 'paused'];
    const blocked = existing.some((e) => {
      const other = campaigns.find((c) => c.id === e.campaign_id);
      if (!other || !ACTIVE.includes(other.status)) return false;
      return other.list_id !== campaign.list_id;
    });
    if (blocked) {
      return json(res, 400, {
        error: 'All selected contacts are already enrolled in other active campaigns with different lead lists.',
      });
    }
    existing.push({ campaign_id: campaignId, status: 'pending', current_step_order: 0 });
    enrolments.set(ids[0], existing);
    return json(res, 200, { added: ids.length, skipped: 0, total: existing.length });
  }

  // DELETE /campaigns/:id/contacts
  const removeMatch = path.match(/^\/campaigns\/([^/]+)\/contacts$/);
  if (req.method === 'DELETE' && removeMatch) {
    const campaignId = removeMatch[1];
    for (const id of body.contact_ids || []) {
      enrolments.set(id, (enrolments.get(id) || []).filter((e) => e.campaign_id !== campaignId));
    }
    return json(res, 204, null);
  }

  // GET /campaigns/:id — used to compare lead lists when enrolment is refused
  const campaignGet = path.match(/^\/campaigns\/([^/]+)$/);
  if (req.method === 'GET' && campaignGet) {
    const campaign = campaigns.find((c) => c.id === campaignGet[1]);
    if (!campaign) return json(res, 404, { error: 'Campaign not found' });
    return json(res, 200, campaign);
  }

  // GET /analytics/contacts/:id/timeline
  const timelineMatch = path.match(/^\/analytics\/contacts\/([^/]+)\/timeline$/);
  if (req.method === 'GET' && timelineMatch) {
    if (!contacts.some((c) => c.id === timelineMatch[1])) return json(res, 404, { error: 'Contact not found' });
    return json(res, 200, timelines.get(timelineMatch[1]) || []);
  }

  // Prospector
  if (req.method === 'GET' && path === '/prospecting/status') {
    if (!prospector.provider) return json(res, 200, { provider: null, credits: { remaining: 0 } });
    return json(res, 200, { provider: prospector.provider, credits: { remaining: prospector.remaining } });
  }
  if (req.method === 'POST' && path === '/prospecting/search') {
    if (!prospector.provider) {
      return json(res, 503, { error: 'No prospect data provider is configured. Add a PDL_API_KEY or APOLLO_API_KEY to enable the prospector.' });
    }
    const keywords = String(body.filters?.keywords || '').toLowerCase();
    const results = PROSPECT_PEOPLE.filter((p) => !keywords || p.full_name.toLowerCase().includes(keywords)).map(
      (p) => ({ ...p, already_revealed: prospector.reveals.has(p.id) })
    );
    return json(res, 200, { results, page: 1, total: results.length, provider: prospector.provider });
  }
  if (req.method === 'POST' && path === '/prospecting/reveal') {
    if (!prospector.provider) return json(res, 503, { error: 'No prospect data provider is configured.' });
    const person = PROSPECT_PEOPLE.find((p) => p.id === body.provider_person_id);
    if (!person) return json(res, 400, { error: 'provider_person_id is required' });

    if (prospector.reveals.has(person.id)) {
      return json(res, 200, { found: true, email: `${person.first_name}.${person.last_name}@northwind.example.org`.toLowerCase(), contact_id: 'k9', already_revealed: true, credits: { remaining: prospector.remaining } });
    }
    // No email on record → automatic refund, nothing saved.
    if (!person.has_email) {
      return json(res, 200, { found: false, email: null, contact_id: null, credits: { remaining: prospector.remaining } });
    }
    prospector.remaining -= 1;
    prospector.reveals.add(person.id);
    const email = `${person.first_name}.${person.last_name}@northwind.example.org`.toLowerCase();
    contacts.push({ id: 'k9', email, first_name: person.first_name, last_name: person.last_name, company: person.company, job_title: person.job_title });
    return json(res, 200, { found: true, email, contact_id: 'k9', credits: { remaining: prospector.remaining } });
  }
  // Tags
  if (req.method === 'GET' && path === '/tags') return json(res, 200, tags);
  if (req.method === 'POST' && path === '/tags') {
    if (tags.some((t) => t.name.toLowerCase() === String(body.name).toLowerCase())) {
      return json(res, 409, { error: 'Tag with this name already exists' });
    }
    const created = { id: `t${tags.length + 1}`, name: body.name, color: body.color };
    tags.push(created);
    return json(res, 201, created);
  }
  if (req.method === 'POST' && path === '/contacts/bulk-tag') {
    tagApplications.push({ contact_ids: body.contact_ids, tag_ids: body.tag_ids });
    return json(res, 204, null);
  }
  // GET /contacts
  if (req.method === 'GET' && path === '/contacts') {
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const matched = contacts.filter((c) =>
      [c.email, c.first_name, c.last_name, c.company]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(search))
    );
    return json(res, 200, { data: matched, total: matched.length, page: 1, limit: 100, total_pages: 1 });
  }

  // POST /contacts/bulk
  if (req.method === 'POST' && path === '/contacts/bulk') {
    const incoming = body.contacts || [];
    if (incoming.length > 1000) return json(res, 413, { error: 'Batch too large — send at most 1000 contacts per request' });
    let imported = 0;
    for (const row of incoming) {
      const email = String(row.email || '').toLowerCase();
      if (!email || contacts.some((c) => c.email.toLowerCase() === email)) continue;
      contacts.push({ id: `kb${contacts.length + 1}`, email, first_name: row.first_name ?? null, last_name: row.last_name ?? null, company: row.company ?? null });
      imported += 1;
    }
    return json(res, 200, { total: incoming.length, imported, errors: 0, error_details: [] });
  }

  // POST /contacts
  if (req.method === 'POST' && path === '/contacts') {
    if (contacts.some((c) => c.email.toLowerCase() === String(body.email).toLowerCase())) {
      return json(res, 409, { error: 'Contact with this email already exists' });
    }
    const created = { id: `k${contacts.length + 1}`, ...body };
    contacts.push(created);
    return json(res, 201, created);
  }

  // GET /contacts/:id/campaigns — the endpoint added for this extension
  const membershipMatch = path.match(/^\/contacts\/([^/]+)\/campaigns$/);
  if (req.method === 'GET' && membershipMatch) {
    const contactId = membershipMatch[1];
    if (!contacts.some((c) => c.id === contactId)) return json(res, 404, { error: 'Contact not found' });
    const rows = (enrolments.get(contactId) || []).map((e) => {
      const campaign = campaigns.find((c) => c.id === e.campaign_id);
      return {
        campaign_contact_id: `cc-${e.campaign_id}`,
        campaign_id: e.campaign_id,
        campaign_name: campaign?.name ?? null,
        campaign_status: campaign?.status ?? null,
        campaign_list_id: campaign?.list_id ?? null,
        status: e.status,
        current_step_order: e.current_step_order,
        next_send_at: '2026-08-01T09:00:00.000Z',
        completed_at: null,
        error_message: null,
        enrolled_at: '2026-07-20T09:00:00.000Z',
        is_active: ['draft', 'scheduled', 'running', 'paused'].includes(campaign?.status),
      };
    });
    return json(res, 200, rows);
  }

  // Suppression
  if (req.method === 'GET' && path === '/suppression/check') {
    return json(res, 200, { suppressed: suppressed.has((url.searchParams.get('email') || '').toLowerCase()) });
  }
  if (req.method === 'POST' && path === '/suppression') {
    suppressed.add(String(body.email).toLowerCase());
    return json(res, 201, { email: body.email, reason: body.reason });
  }
  /*
   * The whole list in one read. Paginated like the real endpoint, because the
   * extension has to know whether it got everything: a truncated page means it
   * must fall back to per-address checks rather than report somebody as safe to
   * email when they are suppressed.
   */
  if (req.method === 'GET' && path === '/suppression') {
    const limit = Number(url.searchParams.get('limit') || 50);
    const page = Number(url.searchParams.get('page') || 1);
    const all = [...suppressed].map((email) => ({ email, reason: 'manual' }));
    const from = (page - 1) * limit;
    return json(res, 200, {
      data: all.slice(from, from + limit),
      total: all.length,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(all.length / limit)),
    });
  }

  if (req.method === 'POST' && path === '/verification/email') {
    return json(res, 200, { email: body.email, syntax_ok: true, domain_ok: true, smtp_ok: true, score: 90, fail_reason: null });
  }

  return json(res, 404, { error: `No mock route for ${req.method} ${path}` });
});

server.listen(PORT, () => console.log(`mock API on http://localhost:${PORT}`));

export { VALID_KEY };

/* ═══════════════════════════════════════════════════════════════════════
   Two-way HubSpot and Pipedrive sync, end to end (migration 118).

   The real sync engine and event bus run against three stand-ins over
   HTTP: Supabase's REST interface (in memory, with the joins, filters,
   ordering, upserts and updated_at trigger the engine relies on), a fake
   HubSpot and a fake Pipedrive. Each scenario changes one side and checks
   what the other side ends up with.

   Run: npx tsx scripts/crm-sync-check.mts
   ═══════════════════════════════════════════════════════════════════════ */

import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

let failures = 0;
let passes = 0;
function check(name: string, ok: unknown, detail?: unknown) {
  if (ok) {
    passes++;
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? `\n       ${JSON.stringify(detail)}` : ''}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── A stand-in for Supabase ─────────────────────────────────────────── */

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
const UNIQUE: Record<string, string[][]> = {
  contacts: [['user_id', 'email']],
  suppression_list: [['user_id', 'email']],
  crm_links: [['integration_id', 'contact_id'], ['integration_id', 'external_id']],
  crm_list_syncs: [['integration_id', 'external_id']],
};
/** parent table -> embedded name -> how they join. */
const RELATIONS: Record<string, Record<string, { table: string; many: boolean; local: string; foreign: string }>> = {
  contacts: { crm_links: { table: 'crm_links', many: true, local: 'id', foreign: 'contact_id' } },
  campaign_contacts: { campaigns: { table: 'campaigns', many: false, local: 'campaign_id', foreign: 'id' } },
  crm_list_syncs: { contact_lists: { table: 'contact_lists', many: false, local: 'list_id', foreign: 'id' } },
};
const nowStamp = () => new Date().toISOString();

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const unquote = (v: string) => v.replace(/^"|"$/g, '');

function test(cell: any, op: string, v: string): boolean {
  switch (op) {
    case 'eq': return String(cell) === unquote(v);
    case 'neq': return String(cell) !== unquote(v);
    case 'is': return v === 'null' ? cell == null : String(cell) === v;
    case 'in': return v.replace(/^\(|\)$/g, '').split(',').map(unquote).includes(String(cell));
    case 'lt': return cell != null && String(cell) < unquote(v);
    case 'lte': return cell != null && String(cell) <= unquote(v);
    case 'gt': return cell != null && String(cell) > unquote(v);
    case 'gte': return cell != null && String(cell) >= unquote(v);
    case 'cs': {
      const want = v.replace(/^\{|\}$/g, '').split(',').map(unquote);
      return want.every((w) => (cell || []).includes(w));
    }
  }
  throw new Error(`fake db: operator ${op} not supported`);
}
function cond(row: Row, expr: string): boolean {
  // "col.op.value", "col.not.op.value", "json->>key.op.value"
  const a = expr.indexOf('.');
  const col = expr.slice(0, a);
  let rest = expr.slice(a + 1);
  let neg = false;
  if (rest.startsWith('not.')) { neg = true; rest = rest.slice(4); }
  const b = rest.indexOf('.');
  const [jcol, jkey] = col.split('->>');
  const cell = jkey ? row[jcol]?.[jkey] : row[col];
  const r = test(cell, rest.slice(0, b), rest.slice(b + 1));
  return neg ? !r : r;
}
function orGroup(row: Row, inner: string): boolean {
  return splitTop(inner).some((part) => {
    if (part.startsWith('and(')) return splitTop(part.slice(4, -1)).every((p) => cond(row, p));
    return cond(row, part);
  });
}

/** Embeds named in a select: name -> inner? */
function embeds(select: string | null): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const part of splitTop(select || '')) {
    const m = part.trim().match(/^([a-z_]+)(!inner)?\(/);
    if (m) out.set(m[1], !!m[2]);
  }
  return out;
}

function query(table: string, params: URLSearchParams): Row[] {
  const rows = db[table] || [];
  const emb = embeds(params.get('select'));
  const out: Row[] = [];
  for (const base of rows) {
    const row: Row = { ...base };
    let keep = true;
    for (const [name, inner] of emb) {
      const rel = RELATIONS[table]?.[name];
      if (!rel) throw new Error(`fake db: no relation ${table} -> ${name}`);
      let kids = (db[rel.table] || []).filter((k) => String(k[rel.foreign]) === String(base[rel.local]));
      for (const [k, raw] of params) {
        if (k.startsWith(`${name}.`)) kids = kids.filter((kid) => cond(kid, `${k.slice(name.length + 1)}.${raw}`));
      }
      if (inner && kids.length === 0) keep = false;
      row[name] = rel.many ? kids.map((x) => ({ ...x })) : kids[0] ? { ...kids[0] } : null;
    }
    if (!keep) continue;
    for (const [k, raw] of params) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k) || k.includes('.')) continue;
      if (k === 'or') { if (!orGroup(base, raw.replace(/^\(|\)$/g, ''))) keep = false; continue; }
      if (!cond(base, `${k}.${raw}`)) keep = false;
    }
    if (keep) out.push(row);
  }
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((o) => o.split('.'));
    out.sort((x, y) => {
      for (const [col, dir] of keys) {
        const a = String(x[col] ?? '');
        const b = String(y[col] ?? '');
        if (a !== b) return (a < b ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }
  const limit = Number(params.get('limit') || 0);
  return limit ? out.slice(0, limit) : out;
}

function clashOf(table: string, row: Row, except?: Row): { row: Row; keys: string[] } | null {
  for (const keys of UNIQUE[table] || []) {
    const hit = (db[table] || []).find((r) => r !== except && keys.every((k) => r[k] != null && String(r[k]) === String(row[k])));
    if (hit) return { row: hit, keys };
  }
  return null;
}

const supa = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url || '/', 'http://x');
    const method = req.method || 'GET';
    const body = raw ? JSON.parse(raw) : undefined;
    const send = (status: number, payload: any, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(payload === undefined ? '' : JSON.stringify(payload));
    };
    try {
      const m = url.pathname.match(/^\/rest\/v1\/(rpc\/)?([a-z_]+)$/);
      if (!m) return send(404, { message: 'no route' });
      if (m[1]) return send(200, []);
      const table = m[2];
      const rows = (db[table] ||= []);
      const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
      const prefer = String(req.headers.prefer || '');
      const one = (list: Row[], status = 200) => {
        if (!wantsObject) return send(status, list);
        if (list.length !== 1) return send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${list.length} rows` });
        return send(status, list[0]);
      };

      if (method === 'GET' || method === 'HEAD') {
        const list = query(table, url.searchParams);
        if (prefer.includes('count=exact')) return send(200, method === 'HEAD' ? undefined : list, { 'Content-Range': `0-${Math.max(0, list.length - 1)}/${list.length}` });
        return one(list);
      }
      if (method === 'POST') {
        const upsert = prefer.includes('resolution=');
        const onConflict = url.searchParams.get('on_conflict')?.split(',');
        const written: Row[] = [];
        for (const r of Array.isArray(body) ? body : [body]) {
          const item: Row = { id: crypto.randomUUID(), created_at: nowStamp(), updated_at: nowStamp(), ...r };
          let target: Row | undefined;
          if (upsert && onConflict) target = rows.find((x) => onConflict.every((k) => String(x[k]) === String(item[k])));
          if (target) {
            const { id: _id, created_at: _c, ...patch } = item;
            const next = { ...target, ...patch };
            if (clashOf(table, next, target)) return send(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
            Object.assign(target, patch);
            written.push(target);
            continue;
          }
          const clash = clashOf(table, item);
          if (clash) {
            if (!upsert) return send(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
            if (!prefer.includes('ignore-duplicates')) Object.assign(clash.row, item, { id: clash.row.id });
            written.push(clash.row);
            continue;
          }
          rows.push(item);
          written.push(item);
        }
        if (!prefer.includes('return=representation')) return send(201, undefined);
        const sel = url.searchParams.get('select');
        const shaped = sel && embeds(sel).size ? written.map((w) => query(table, new URLSearchParams({ select: sel, id: `eq.${w.id}` }))[0]) : written;
        return one(shaped, 201);
      }
      if (method === 'PATCH') {
        const hit = query(table, url.searchParams).map((r) => rows.find((x) => x.id === r.id)!);
        for (const r of hit) {
          Object.assign(r, body);
          if (table === 'contacts' || table === 'user_integrations') r.updated_at = nowStamp(); // the updated_at trigger
        }
        if (!prefer.includes('return=representation')) return send(204, undefined);
        const sel = url.searchParams.get('select');
        const shaped = sel && embeds(sel).size ? hit.map((w) => query(table, new URLSearchParams({ select: sel, id: `eq.${w.id}` }))[0]) : hit;
        return one(shaped);
      }
      if (method === 'DELETE') {
        const gone = new Set(query(table, url.searchParams).map((r) => r.id));
        db[table] = rows.filter((r) => !gone.has(r.id));
        return send(204, undefined);
      }
      send(405, { message: 'method' });
    } catch (err: any) {
      console.error('fake db error:', err.message);
      send(500, { message: err.message });
    }
  });
});

/* ── A fake HubSpot ──────────────────────────────────────────────────── */

const hs = {
  contacts: new Map<string, { id: string; properties: Record<string, any> }>(),
  notes: [] as { body: string; contact: string }[],
  deals: new Map<string, { id: string; properties: Record<string, any>; contact: string }>(),
  unsubscribed: [] as { email: string; sub: string }[],
  lists: new Map<string, string[]>(),
  calls: [] as string[],
  failNotesOnce: false,
  nextId: 1000,
  batchSizes: [] as number[],
  batchWithoutEmail: false,
  tasks: [] as Row[],
  companies: new Map<string, Row>(),
  companyLinks: [] as [string, string][],
};
const hsTouch = (props: Record<string, any>, at = Date.now()) => { props.lastmodifieddate = new Date(at).toISOString(); };

function hsSearch(items: { id: string; properties: Record<string, any> }[], body: any) {
  const f = body.filterGroups[0].filters[0];
  const since = Number(f.value);
  const list = items
    .filter((c) => Date.parse(c.properties[f.propertyName]) >= since)
    .sort((a, b) => Date.parse(a.properties[f.propertyName]) - Date.parse(b.properties[f.propertyName]));
  const start = Number(body.after || 0);
  const page = list.slice(start, start + body.limit);
  return {
    total: list.length,
    results: page.map((c) => ({ id: c.id, properties: Object.fromEntries((body.properties as string[]).map((p) => [p, c.properties[p] ?? null])) })),
    ...(start + body.limit < list.length ? { paging: { next: { after: String(start + body.limit) } } } : {}),
  };
}

const hubspot = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url || '/', 'http://x');
    const method = req.method || 'GET';
    const body = raw ? JSON.parse(raw) : undefined;
    const p = url.pathname;
    hs.calls.push(`${method} ${p}`);
    let m: RegExpMatchArray | null = null;
    const send = (status: number, payload: any) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (req.headers.authorization !== 'Bearer pat-test') return send(401, { message: 'bad token' });

    if (method === 'POST' && p === '/crm/v3/objects/contacts/batch/upsert') {
      hs.batchSizes.push(body.inputs.length);
      if (body.inputs.some((i: any) => /invalid/.test(i.id))) return send(400, { message: 'Property values were not valid: email' });
      const results = body.inputs.map((input: any) => {
        let c = [...hs.contacts.values()].find((x) => x.properties.email === input.id);
        const isNew = !c;
        if (!c) { c = { id: String(hs.nextId++), properties: {} }; hs.contacts.set(c.id, c); }
        Object.assign(c.properties, input.properties);
        hsTouch(c.properties);
        return { id: c.id, new: isNew, properties: hs.batchWithoutEmail ? {} : { ...c.properties } };
      });
      // HubSpot does not promise the order: answer in reverse to prove matching is by email.
      return send(200, { results: results.reverse() });
    }
    if (method === 'GET' && p === '/crm/v3/objects/contacts') {
      const all = [...hs.contacts.values()].sort((a, b) => Number(a.id) - Number(b.id));
      const after = Number(url.searchParams.get('after') || 0);
      const lim = Number(url.searchParams.get('limit') || 100);
      const props = url.searchParams.getAll('properties');
      return send(200, {
        results: all.slice(after, after + lim).map((c) => ({ id: c.id, properties: Object.fromEntries(props.map((k) => [k, c.properties[k] ?? null])) })),
        ...(after + lim < all.length ? { paging: { next: { after: String(after + lim) } } } : {}),
      });
    }
    if (method === 'POST' && p === '/crm/v3/objects/contacts/batch/update') {
      for (const i of body.inputs) { const c = hs.contacts.get(i.id); if (c) Object.assign(c.properties, i.properties); }
      return send(200, { results: body.inputs });
    }
    if (method === 'GET' && p === '/crm/v3/owners') return send(200, { results: [{ id: '77', firstName: 'Olive', lastName: 'Owner', email: 'olive@acme.test' }, { id: '78', email: 'gone@acme.test', archived: true }] });
    if (method === 'POST' && p === '/crm/v3/objects/tasks') {
      hs.tasks.push({ ...body.properties, contact: body.associations[0].to.id });
      return send(201, { id: String(hs.nextId++) });
    }
    if (method === 'POST' && p === '/crm/v3/objects/companies/search') {
      const want = body.filterGroups[0].filters[0].value;
      const hit = [...hs.companies.values()].find((c) => c.domain === want);
      return send(200, { total: hit ? 1 : 0, results: hit ? [{ id: hit.id, properties: hit }] : [] });
    }
    if (method === 'POST' && p === '/crm/v3/objects/companies') {
      const c = { id: String(hs.nextId++), ...body.properties };
      hs.companies.set(c.id, c);
      return send(201, { id: c.id, properties: c });
    }
    m = p.match(/^\/crm\/v4\/objects\/contacts\/(\d+)\/associations\/default\/companies\/(\d+)$/);
    if (m && method === 'PUT') { hs.companyLinks.push([m[1], m[2]]); return send(200, {}); }
    if (method === 'GET' && p === '/account-info/v3/details') return send(200, { portalId: 4455, uiDomain: 'app-eu1.hubspot.com' });
    m = p.match(/^\/crm\/v3\/lists\/(\d+)$/);
    if (m && method === 'GET') return send(200, { list: { listId: m[1], size: (hs.lists.get(m[1]) || []).length } });
    m = p.match(/^\/crm\/v3\/objects\/contacts\/(\d+)$/);
    if (m && method === 'PATCH') {
      const c = hs.contacts.get(m[1]);
      if (!c) return send(404, { message: 'not found' });
      Object.assign(c.properties, body.properties);
      hsTouch(c.properties);
      return send(200, c);
    }
    if (method === 'POST' && p === '/crm/v3/objects/contacts/search') {
      if (!body.filterGroups) return send(200, { total: hs.contacts.size, results: [] });
      return send(200, hsSearch([...hs.contacts.values()], body));
    }
    if (method === 'POST' && p === '/crm/v3/objects/contacts/batch/read') {
      return send(200, { results: body.inputs.map((i: any) => hs.contacts.get(i.id)).filter(Boolean).map((c: any) => ({ id: c.id, properties: Object.fromEntries(body.properties.map((k: string) => [k, c.properties[k] ?? null])) })) });
    }
    if (method === 'POST' && p === '/crm/v3/objects/notes') {
      if (hs.failNotesOnce) { hs.failNotesOnce = false; return send(502, { message: 'upstream hiccup' }); }
      hs.notes.push({ body: body.properties.hs_note_body, contact: body.associations[0].to.id });
      return send(201, { id: String(hs.nextId++) });
    }
    if (method === 'GET' && p === '/crm/v3/pipelines/deals') {
      return send(200, { results: [
        { id: 'default', label: 'Sales', stages: [{ id: 'appointmentscheduled', label: 'Appointment', displayOrder: 0 }, { id: 'closedwon', label: 'Won', displayOrder: 5 }] },
        { id: 'p2', label: 'Outbound', stages: [{ id: 's2b', label: 'Booked', displayOrder: 1 }, { id: 's2a', label: 'New', displayOrder: 0 }] },
      ] });
    }
    if (method === 'POST' && p === '/crm/v3/objects/deals') {
      const d = { id: String(hs.nextId++), properties: { ...body.properties }, contact: body.associations[0].to.id };
      hsTouch(d.properties);
      d.properties.hs_lastmodifieddate = d.properties.lastmodifieddate;
      hs.deals.set(d.id, d);
      return send(201, { id: d.id, properties: d.properties });
    }
    if (method === 'POST' && p === '/crm/v3/objects/deals/search') return send(200, hsSearch([...hs.deals.values()], body));
    if (method === 'POST' && p === '/crm/v4/associations/deals/contacts/batch/read') {
      return send(200, { results: body.inputs.map((i: any) => ({ from: { id: i.id }, to: [{ toObjectId: Number(hs.deals.get(i.id)?.contact) }] })) });
    }
    if (method === 'GET' && p === '/communication-preferences/v3/definitions') {
      return send(200, { subscriptionDefinitions: [{ id: 11, isActive: true }, { id: 12, isActive: true }, { id: 13, isActive: false }] });
    }
    if (method === 'POST' && p === '/communication-preferences/v3/unsubscribe') {
      hs.unsubscribed.push({ email: body.emailAddress, sub: body.subscriptionId });
      return send(200, { status: 'NOT_SUBSCRIBED' });
    }
    if (method === 'GET' && p === '/crm/v3/properties/contacts') {
      return send(403, { status: 'error', category: 'MISSING_SCOPES', message: 'This app hasn\'t been granted all required scopes', errors: [{ context: { requiredGranularScopes: ['crm.schemas.contacts.read'] } }] });
    }
    if (method === 'POST' && p === '/crm/v3/lists/search') {
      return send(200, { lists: [...hs.lists.keys()].map((id) => ({ listId: id, name: `List ${id}`, objectTypeId: '0-1', additionalProperties: { hs_list_size: String(hs.lists.get(id)!.length) } })).concat([{ listId: '99', name: 'Companies', objectTypeId: '0-2', additionalProperties: {} } as any]), hasMore: false, offset: 0 });
    }
    m = p.match(/^\/crm\/v3\/lists\/(\d+)\/memberships$/);
    if (m && method === 'GET') {
      const ids = hs.lists.get(m[1]) || [];
      const after = Number(url.searchParams.get('after') || 0);
      const size = 1; // one per page, so paging is exercised
      return send(200, { results: ids.slice(after, after + size).map((id) => ({ recordId: id })), ...(after + size < ids.length ? { paging: { next: { after: String(after + size) } } } : {}) });
    }
    send(404, { message: `fake hubspot: no route ${method} ${p}` });
  });
});

/* ── A fake Pipedrive ────────────────────────────────────────────────── */

const pdTime = (t = Date.now()) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');
const pd = {
  persons: new Map<number, Row>(),
  orgs: new Map<number, { id: number; name: string }>(),
  notes: [] as { content: string; person_id: number }[],
  deals: new Map<number, Row>(),
  filters: new Map<number, number[]>(),
  nextId: 500,
  campaigns: true,
  activities: [] as Row[],
};
const pipedrive = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const url = new URL(req.url || '/', 'http://x');
    const method = req.method || 'GET';
    const body = raw ? JSON.parse(raw) : undefined;
    const p = url.pathname;
    const q = url.searchParams;
    const send = (status: number, payload: any) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
    if (q.get('api_token') !== 'a1b2c3d4e5f6a7b8c9d0e1f2') return send(401, { success: false, error: 'unauthorized' });
    const ok = (data: any, extra: any = {}) => send(200, { success: true, data, ...extra });
    const view = (x: Row) => ({ ...x, org_name: x.org_id ? pd.orgs.get(x.org_id)?.name ?? null : null, org_id: x.org_id ? { value: x.org_id, name: pd.orgs.get(x.org_id)?.name } : null });

    if (method === 'GET' && p === '/v1/persons/search') {
      const hit = [...pd.persons.values()].find((x) => x.email.some((e: any) => e.value === q.get('term')));
      return ok({ items: hit ? [{ item: { id: hit.id } }] : [] });
    }
    if (method === 'GET' && p === '/v1/organizations/search') {
      const hit = [...pd.orgs.values()].find((o) => o.name === q.get('term'));
      return ok({ items: hit ? [{ item: { id: hit.id } }] : [] });
    }
    if (method === 'POST' && p === '/v1/organizations') {
      const o = { id: pd.nextId++, name: body.name };
      pd.orgs.set(o.id, o);
      return ok(o);
    }
    if (method === 'POST' && p === '/v1/persons') {
      const x = { id: pd.nextId++, marketing_status: 'subscribed', ...body, update_time: pdTime(), active_flag: true };
      pd.persons.set(x.id, x);
      return ok(view(x));
    }
    let m = p.match(/^\/v1\/persons\/(\d+)$/);
    if (m && method === 'PUT') {
      const x = pd.persons.get(Number(m[1]));
      if (!x) return send(404, { success: false, error: 'not found' });
      const patch = { ...body };
      if ('marketing_status' in patch && !pd.campaigns) delete patch.marketing_status;
      Object.assign(x, patch, { update_time: pdTime() });
      return ok(view(x));
    }
    if (m && method === 'GET') {
      const x = pd.persons.get(Number(m[1]));
      return x ? ok(view(x)) : send(404, { success: false, error: 'not found' });
    }
    if (method === 'POST' && p === '/v1/notes') { pd.notes.push(body); return ok({ id: pd.nextId++ }); }
    if (method === 'POST' && p === '/v1/deals') {
      const d = { id: pd.nextId++, status: 'open', ...body, update_time: pdTime() };
      pd.deals.set(d.id, d);
      return ok(d);
    }
    if (method === 'GET' && p === '/v1/recents') {
      const since = q.get('since_timestamp')!;
      const kind = q.get('items');
      const source = kind === 'person' ? [...pd.persons.values()].map(view) : [...pd.deals.values()];
      const items = source.filter((x) => x.update_time >= since).sort((a, b) => (a.update_time < b.update_time ? -1 : 1));
      return ok(items.map((x) => ({ item: kind, id: x.id, data: x })), { additional_data: { pagination: { start: 0, limit: 500, more_items_in_collection: false }, last_timestamp_on_page: items.length ? items[items.length - 1].update_time : null } });
    }
    if (method === 'GET' && p === '/v1/pipelines') return ok([{ id: 1, name: 'Main' }, { id: 2, name: 'Outbound' }]);
    if (method === 'GET' && p === '/v1/stages') return ok([{ id: 21, name: 'Booked', pipeline_id: 2, order_nr: 2 }, { id: 20, name: 'New', pipeline_id: 2, order_nr: 1 }, { id: 10, name: 'Lead', pipeline_id: 1, order_nr: 1 }]);
    if (method === 'GET' && p === '/v1/filters') return ok([...pd.filters.keys()].map((id) => ({ id, name: `Filter ${id}` })));
    if (method === 'GET' && p === '/v1/personFields') return ok([{ key: 'first_name', name: 'First name', edit_flag: false }, { key: 'email', name: 'Email', edit_flag: false }, { key: 'abc123', name: 'Lead source', edit_flag: true }]);
    if (method === 'GET' && p === '/v1/users') return ok([{ id: 9, name: 'Paula', email: 'paula@acme.test', active_flag: true }, { id: 8, name: 'Old', active_flag: false }]);
    if (method === 'POST' && p === '/v1/activities') { pd.activities.push(body); return ok({ id: pd.nextId++ }); }
    if (method === 'GET' && p === '/v1/users/me') return ok({ id: 1, name: 'Owner', company_domain: 'acme-sales' });
    if (method === 'GET' && p === '/v1/persons/summary') return ok({ total_count: pd.persons.size });
    if (method === 'GET' && p === '/v1/persons' && !q.get('filter_id')) {
      const all = [...pd.persons.values()];
      const start = Number(q.get('start') || 0);
      const lim = Number(q.get('limit') || 500);
      return ok(all.slice(start, start + lim).map(view), { additional_data: { pagination: { start, limit: lim, more_items_in_collection: start + lim < all.length, next_start: start + lim } } });
    }
    if (method === 'GET' && p === '/v1/persons' && q.get('filter_id')) {
      const ids = pd.filters.get(Number(q.get('filter_id'))) || [];
      return ok(ids.map((id) => view(pd.persons.get(id)!)), { additional_data: { pagination: { start: 0, limit: 500, more_items_in_collection: false } } });
    }
    send(404, { success: false, error: `fake pipedrive: no route ${method} ${p}` });
  });
});

for (const s of [supa, hubspot, pipedrive]) await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
const urlOf = (s: http.Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

process.env.SUPABASE_URL = urlOf(supa);
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';
process.env.CLIENT_URL ||= 'https://app.sincerely.io';
process.env.API_BASE_URL ||= 'https://api.sincerely.io';

const { overrideCrmHost } = await import('../src/services/crm-sync/http.js');
overrideCrmHost('api.hubapi.com', urlOf(hubspot));
overrideCrmHost('api.pipedrive.com', urlOf(pipedrive));
const { dispatchEvent } = await import('../src/services/integrations.service.js');
const { runCrmSync, crmSyncService, reconcile } = await import('../src/services/crm-sync.service.js');
const { contactsService } = await import('../src/services/contacts.service.js');
const shared = await import('@lemlist/shared');

// Imports are their own well-tested path; here they only need to land in the fake database.
const imported: Row[][] = [];
(contactsService as any).bulkCreate = async (userId: string, rows: Row[], listId: string) => {
  imported.push(rows);
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const existing = db.contacts.find((c) => c.user_id === userId && c.email === r.email);
    let id: string;
    if (existing) {
      for (const [k, v] of Object.entries(r)) if (existing[k] == null || existing[k] === '') existing[k] = v;
      updated++;
      id = existing.id;
    } else {
      id = crypto.randomUUID();
      db.contacts.push({ id, user_id: userId, custom_fields: {}, is_unsubscribed: false, is_bounced: false, updated_at: nowStamp(), ...r });
      created++;
    }
    (db.list_contacts ||= []).push({ id: crypto.randomUUID(), list_id: listId, contact_id: id });
  }
  return { total: rows.length, imported: rows.length, created, updated, errors: 0, error_details: [] };
};

const { campaignContactsService } = await import('../src/services/campaign-contacts.service.js');
const enrolled: { campaignId: string; ids: string[] }[] = [];
(campaignContactsService as any).add = async (campaignId: string, ids: string[]) => {
  enrolled.push({ campaignId, ids });
  return { added: ids.length, skipped: 0, total: ids.length, reasons: {}, skipped_sample: [] };
};

/* ── Fixtures ────────────────────────────────────────────────────────── */

const U = crypto.randomUUID();
const OTHER = crypto.randomUUID();
const HS = crypto.randomUUID();
const PD = crypto.randomUUID();
const CAMP = crypto.randomUUID();
const LIST = crypto.randomUUID();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const person = (email: string, extra: Row = {}): Row => ({
  id: crypto.randomUUID(), user_id: U, email, first_name: null, last_name: null, company: null, job_title: null, phone: null,
  website: null, linkedin_url: null, city: null, state: null, country: null, industry: null, custom_fields: {},
  is_unsubscribed: false, is_bounced: false, updated_at: ago(60 * 60_000), ...extra,
});

const jane = person('jane@acme.test', { first_name: 'Jane', last_name: 'Doe', company: 'Acme', job_title: 'Head of Ops', city: 'Leeds', custom_fields: { tier: 'gold' } });
const bob = person('bob@acme.test', { first_name: 'Bob', company: 'Acme' });
const cara = person('cara@beta.test', { first_name: 'Cara', company: 'Beta' });
const dan = person('dan@beta.test', { first_name: 'Dan', company: 'Beta' });
const notMine = { ...person('jane@acme.test'), user_id: OTHER };
db.contacts = [jane, bob, cara, dan, notMine];
db.campaigns = [{ id: CAMP, user_id: U, name: 'Q4 outbound' }];
db.campaign_contacts = [
  { id: crypto.randomUUID(), campaign_id: CAMP, contact_id: jane.id, status: 'active', next_send_at: ago(-60_000) },
  { id: crypto.randomUUID(), campaign_id: CAMP, contact_id: bob.id, status: 'active', next_send_at: ago(-60_000) },
  { id: crypto.randomUUID(), campaign_id: CAMP, contact_id: cara.id, status: 'active', next_send_at: ago(-60_000) },
  { id: crypto.randomUUID(), campaign_id: CAMP, contact_id: dan.id, status: 'active', next_send_at: ago(-60_000) },
];
db.contact_lists = [{ id: LIST, user_id: U, name: 'From HubSpot' }];
db.webhook_endpoints = [];
db.suppression_list = [];
db.crm_links = [];
db.crm_sync_log = [];
db.crm_list_syncs = [];
db.integration_activity = [];
db.user_integrations = [
  {
    id: HS, user_id: U, provider: 'hubspot', is_active: true,
    config: { access_token: 'pat-test', create_deals: 'yes' },
    events: ['email.sent', 'email.replied', 'sara.intent_classified', 'email.bounced', 'lead.unsubscribed'],
    sync_settings: { deal_pipeline: 'p2', deal_stage: '' }, sync_cursors: {}, last_sync_at: null, next_sync_at: null, last_sync_error: null,
  },
];

const hsContact = (email: string) => [...hs.contacts.values()].find((c) => c.properties.email === email);
const link = (integration: string, contactId: string) => db.crm_links.find((l) => l.integration_id === integration && l.contact_id === contactId);
const contactRow = (id: string) => db.contacts.find((c) => c.id === id)!;
const enrolment = (contactId: string) => db.campaign_contacts.find((c) => c.contact_id === contactId)!;
/** Let fire-and-forget event dispatch finish. */
const settle = () => sleep(150);
/** CRM edits are "later" than anything before them. */
const tick = () => sleep(15);

/* ── Pure: the conflict rule ─────────────────────────────────────────── */

console.log('\nreconcile (who wins)');
{
  const m = [
    { sincerely: 'first_name', crm: 'firstname', direction: 'both' as const },
    { sincerely: 'company', crm: 'company', direction: 'both' as const },
    { sincerely: 'city', crm: 'city', direction: 'to_crm' as const },
    { sincerely: 'job_title', crm: 'jobtitle', direction: 'from_crm' as const },
  ];
  const snap = { 'first_name|firstname': 'Jo', 'company|company': 'Acme', 'city|city': 'Leeds', 'job_title|jobtitle': 'CTO' };
  const c = { id: 'c', email: 'x', updated_at: '2026-01-01T10:00:00.000Z', first_name: 'Joanna', company: 'Acme', city: 'Leeds', job_title: 'CEO' } as any;
  const p = (vals: Row, at: string) => ({ id: 'p', email: 'x', values: vals, updatedAt: at, optedOut: false, bounced: false });
  let r = reconcile(m, c, p({ firstname: 'Jo', company: 'Acme Ltd', city: 'York', jobtitle: 'CTO' }, '2026-01-01T09:00:00.000Z'), snap);
  check('edited only here: goes to the CRM', r.remote.firstname === 'Joanna' && !('first_name' in r.local), r);
  check('edited only in the CRM: comes here', r.local.company === 'Acme Ltd' && !('company' in r.remote), r);
  check('a to-CRM-only field edited in the CRM is not overwritten and not taken', !('city' in r.remote) && !('city' in r.local), r);
  check('a from-CRM-only field edited here is not sent', !('jobtitle' in r.remote) && !('job_title' in r.local), r);
  check('agreed values move with the changes', r.snapshot['company|company'] === 'Acme Ltd' && r.snapshot['first_name|firstname'] === 'Joanna' && r.snapshot['city|city'] === 'Leeds', r.snapshot);
  r = reconcile(m, c, p({ firstname: 'Josie', company: 'Acme', city: 'Leeds', jobtitle: 'CTO' }, '2026-01-01T11:00:00.000Z'), snap);
  check('both edited: the CRM edit is newer, the CRM wins', r.local.first_name === 'Josie' && !('firstname' in r.remote), r);
  r = reconcile(m, c, p({ firstname: 'Josie', company: 'Acme', city: 'Leeds', jobtitle: 'CTO' }, '2026-01-01T08:00:00.000Z'), snap);
  check('both edited: the Sincerely edit is newer, Sincerely wins', r.remote.firstname === 'Joanna' && !('first_name' in r.local), r);
  r = reconcile(m, { ...c, first_name: null }, p({ firstname: 'Jo' }, '2026-01-01T08:00:00.000Z'), {});
  check('never agreed, blank here: the CRM fills it', r.local.first_name === 'Jo', r);
  r = reconcile(m, { ...c, first_name: 'Ann' }, p({ firstname: null }, '2026-01-01T08:00:00.000Z'), {});
  check('never agreed, blank in the CRM: Sincerely fills it', r.remote.firstname === 'Ann', r);
}

console.log('\nsettings');
{
  const s = shared.sanitizeCrmSyncSettings('hubspot', {
    push_when: 'whenever', pull_updates: 'yes',
    mapping: [
      { sincerely: 'first_name', crm: 'firstname', direction: 'both' },
      { sincerely: 'first_name', crm: 'other', direction: 'both' },
      { sincerely: 'company', crm: 'email', direction: 'both' },
      { sincerely: 'is_unsubscribed', crm: 'x', direction: 'both' },
      { sincerely: 'custom:Tier', crm: 'tier', direction: 'sideways' },
      { sincerely: 'job_title', crm: 'bad key!', direction: 'both' },
    ],
    deal_pipeline: 'p2', on_deal_won: 'explode',
  });
  check('unknown values fall back to defaults', s.push_when === 'replied' && s.pull_updates === true && s.on_deal_won === 'stop', s);
  check('a mapping keeps each field once, never email, never internal columns, never a bad key', JSON.stringify(s.mapping) === JSON.stringify([
    { sincerely: 'first_name', crm: 'firstname', direction: 'both' },
    { sincerely: 'custom:Tier', crm: 'tier', direction: 'both' },
  ]), s.mapping);
}

/* ── HubSpot: Sincerely -> HubSpot, as things happen ─────────────────── */

console.log('\nHubSpot: events');
await dispatchEvent(U, 'email.sent', { contact_id: jane.id, campaign_id: CAMP, subject: 'Quick question', to: jane.email });
check('an email sent to someone HubSpot does not have creates nobody (push when they reply)', hs.contacts.size === 0 && !link(HS, jane.id));

await dispatchEvent(U, 'email.replied', { contact_id: jane.id, campaign_id: CAMP, subject: 'Re: Quick question', excerpt: 'Sounds good, tell me more' });
const hj = hsContact('jane@acme.test');
check('a reply creates them in HubSpot with the mapped fields', hj && hj.properties.firstname === 'Jane' && hj.properties.company === 'Acme' && hj.properties.jobtitle === 'Head of Ops' && hj.properties.city === 'Leeds', hj?.properties);
check('the link remembers the HubSpot record and the agreed values', link(HS, jane.id)?.external_id === hj?.id && link(HS, jane.id)?.snapshot['company|company'] === 'Acme', link(HS, jane.id));
check('the reply is on their HubSpot timeline, with the campaign and what they said', hs.notes.length === 1 && hs.notes[0].contact === hj?.id && /replied - Re: Quick question/.test(hs.notes[0].body) && /Q4 outbound/.test(hs.notes[0].body) && /Sounds good/.test(hs.notes[0].body), hs.notes);
check('the note is HTML-escaped', !/<script/.test(hs.notes[0].body));
check('logged as created, then as activity', db.crm_sync_log.some((l) => l.kind === 'contact' && /Created Jane Doe in HubSpot/.test(l.summary)) && db.crm_sync_log.some((l) => l.kind === 'activity' && l.status === 'ok'));
check('the connection card gets a summary', db.integration_activity.some((a) => a.integration_id === HS && a.success && /jane@acme.test/.test(a.summary)), db.integration_activity);

await dispatchEvent(U, 'email.sent', { contact_id: jane.id, campaign_id: CAMP, subject: 'Follow-up <script>', to: jane.email });
check('once linked, every email sent goes on the timeline (escaped)', hs.notes.length === 2 && /email sent - Follow-up &lt;script&gt;/.test(hs.notes[1].body), hs.notes[1]);

await dispatchEvent(U, 'sara.intent_classified', { contact_id: jane.id, campaign_id: CAMP, intent: 'interested', confidence: 0.92 });
const deal = [...hs.deals.values()][0];
check('an interested reply opens a deal in the chosen pipeline, first stage by display order', hs.deals.size === 1 && deal.properties.pipeline === 'p2' && deal.properties.dealstage === 's2a' && deal.contact === hj?.id, deal);
check('deal named after the person and company', deal?.properties.dealname === 'Jane Doe (Acme) - Sincerely', deal?.properties);
check('the Relay read is on the timeline too', hs.notes.some((n) => /reads as interested \(92% sure\)/.test(n.body)));
await dispatchEvent(U, 'sara.intent_classified', { contact_id: jane.id, campaign_id: CAMP, intent: 'meeting' });
check('a second positive read does not open a second deal while one is open', hs.deals.size === 1);

// A failure, kept with what is needed to send it again, then retried: the note is posted once.
const callsBeforeOpen = hs.calls.length;
await dispatchEvent(U, 'email.opened', { contact_id: jane.id, campaign_id: CAMP });
check('an event the connection does not take (opens are off by default) is not sent', hs.calls.length === callsBeforeOpen, hs.calls.slice(callsBeforeOpen));
hs.failNotesOnce = true;
const notesBefore = hs.notes.length;
await dispatchEvent(U, 'email.bounced', { contact_id: jane.id, campaign_id: CAMP, reason: '550 mailbox full' });
const failed = db.crm_sync_log.find((l) => l.status === 'failed' && l.kind === 'activity');
check('a failed timeline note is logged as failed, with the reason and a retry', failed && failed.retry && /upstream hiccup/.test(failed.error), failed);
check('the connection shows the failure, in plain words', /^Adding to the HubSpot timeline failed \(502\): upstream hiccup$/.test(db.user_integrations[0].last_error || ''), db.user_integrations[0].last_error);
const retried = await crmSyncService.retry(U, HS, failed!.id);
check('retrying it sends it', retried.ok && hs.notes.length === notesBefore + 1 && /email bounced/.test(hs.notes[hs.notes.length - 1].body), { retried, notes: hs.notes.length });
check('the failed row is settled and not retryable', db.crm_sync_log.find((l) => l.id === failed!.id)?.status === 'ok' && !db.crm_sync_log.find((l) => l.id === failed!.id)?.retry);
check('the retry did not open a second deal or re-post other notes', hs.deals.size === 1 && hs.notes.filter((n) => /email bounced/.test(n.body)).length === 1);

/* ── HubSpot: the scheduled run, both ways ───────────────────────────── */

console.log('\nHubSpot: sync runs');
let run = await runCrmSync(U, HS);
check('the first run starts every cursor at now (no history is replayed)', run.error === null && !!db.user_integrations[0].sync_cursors.people && !!db.user_integrations[0].sync_cursors.out && !!db.user_integrations[0].sync_cursors.deals, { run, cursors: db.user_integrations[0].sync_cursors });
check('the run sets the next run 2 minutes out', Math.abs(Date.parse(db.user_integrations[0].next_sync_at) - Date.now() - 2 * 60_000) < 10_000, db.user_integrations[0].next_sync_at);

await tick();
hj!.properties.jobtitle = 'VP Operations';
hsTouch(hj!.properties);
run = await runCrmSync(U, HS);
check('an edit in HubSpot comes into Sincerely', contactRow(jane.id).job_title === 'VP Operations' && run.people_updated === 1, { run, job: contactRow(jane.id).job_title });
check('...logged as from HubSpot', db.crm_sync_log.some((l) => l.direction === 'from_crm' && /Updated Jane Doe from HubSpot: job title/.test(l.summary)));
const patchesBefore = hs.calls.filter((c) => c.startsWith('PATCH')).length;

await tick();
contactRow(jane.id).company = 'Acme Group';
contactRow(jane.id).updated_at = nowStamp();
run = await runCrmSync(U, HS);
check('an edit in Sincerely goes to HubSpot', hj!.properties.company === 'Acme Group' && run.pushed >= 1, { run, company: hj!.properties.company });
await tick();
run = await runCrmSync(U, HS);
check('...and does not bounce back and forth (our own write is read back as no change)', hs.calls.filter((c) => c.startsWith('PATCH')).length === patchesBefore + 1 && run.people_updated === 0 && run.pushed === 0, { run, patches: hs.calls.filter((c) => c.startsWith('PATCH')).length - patchesBefore });

// Both edited: the newer wins.
await tick();
contactRow(jane.id).phone = '+44 111';
contactRow(jane.id).updated_at = nowStamp();
await tick();
hj!.properties.phone = '+44 222';
hsTouch(hj!.properties);
run = await runCrmSync(U, HS);
check('both edited, HubSpot newer: HubSpot wins on both sides', contactRow(jane.id).phone === '+44 222' && hj!.properties.phone === '+44 222', { here: contactRow(jane.id).phone, there: hj!.properties.phone });
await tick();
hj!.properties.phone = '+44 333';
hsTouch(hj!.properties);
await tick();
contactRow(jane.id).phone = '+44 444';
contactRow(jane.id).updated_at = nowStamp();
run = await runCrmSync(U, HS);
check('both edited, Sincerely newer: Sincerely wins on both sides', contactRow(jane.id).phone === '+44 444' && hj!.properties.phone === '+44 444', { here: contactRow(jane.id).phone, there: hj!.properties.phone });

// Custom field mapping, saved through the settings API.
await crmSyncService.updateSettings(U, HS, {
  mapping: [...shared.CRM_DEFAULT_MAPPING.hubspot.filter((m) => m.sincerely !== 'city'), { sincerely: 'city', crm: 'city', direction: 'to_crm' }, { sincerely: 'custom:tier', crm: 'customer_tier', direction: 'both' }],
});
await tick();
hj!.properties.city = 'Manchester';
hj!.properties.customer_tier = 'platinum';
hsTouch(hj!.properties);
run = await runCrmSync(U, HS);
check('a custom field maps both ways (here: into custom fields, others kept)', contactRow(jane.id).custom_fields.tier === 'platinum' && Object.keys(contactRow(jane.id).custom_fields).length === 1, contactRow(jane.id).custom_fields);
check('a Sincerely-to-HubSpot field edited in HubSpot is left alone on both sides', contactRow(jane.id).city === 'Leeds' && hj!.properties.city === 'Manchester', { here: contactRow(jane.id).city, there: hj!.properties.city });

// A bulk edit gives many people the same updated_at: none may be skipped.
await dispatchEvent(U, 'email.replied', { contact_id: bob.id, campaign_id: CAMP, subject: 'Re: hi' });
await dispatchEvent(U, 'email.replied', { contact_id: cara.id, campaign_id: CAMP, subject: 'Re: hi' });
run = await runCrmSync(U, HS);
await tick();
const same = nowStamp();
for (const c of [bob, cara]) { contactRow(c.id).industry = 'Software'; contactRow(c.id).updated_at = same; }
await crmSyncService.updateSettings(U, HS, { mapping: [...(db.user_integrations[0].sync_settings.mapping), { sincerely: 'industry', crm: 'industry', direction: 'both' }] });
run = await runCrmSync(U, HS);
check('two people edited in the same instant both reach HubSpot', hsContact('bob@acme.test')?.properties.industry === 'Software' && hsContact('cara@beta.test')?.properties.industry === 'Software', [hsContact('bob@acme.test')?.properties.industry, hsContact('cara@beta.test')?.properties.industry]);

// A deal won in HubSpot ends the sequence.
await tick();
deal.properties.hs_is_closed_won = 'true';
deal.properties.hs_is_closed = 'true';
deal.properties.hs_lastmodifieddate = nowStamp();
run = await runCrmSync(U, HS);
check('a deal won in HubSpot ends their sequence (shown as ended by hand)', enrolment(jane.id).status === 'paused' && enrolment(jane.id).error_message === 'Paused by hand in HubSpot: deal won' && enrolment(jane.id).next_send_at === null, enrolment(jane.id));
check('...and says so in the log', db.crm_sync_log.some((l) => l.kind === 'deal' && /Deal won in HubSpot for Jane Doe: 1 sequence ended/.test(l.summary)));
check('the stop is the one Sincerely already understands as ended', shared.isManualPause(enrolment(jane.id)));
const dealLogs = db.crm_sync_log.filter((l) => l.kind === 'deal' && l.direction === 'from_crm').length;
await tick();
deal.properties.hs_lastmodifieddate = nowStamp();
run = await runCrmSync(U, HS);
check('the same won deal read again is not acted on twice', db.crm_sync_log.filter((l) => l.kind === 'deal' && l.direction === 'from_crm').length === dealLogs);

// Opted out in HubSpot.
const hb = hsContact('bob@acme.test')!;
await tick();
hb.properties.hs_email_optout = 'true';
hsTouch(hb.properties);
const unsubCallsBefore = hs.unsubscribed.length;
run = await runCrmSync(U, HS);
await settle();
check('an opt-out in HubSpot unsubscribes them here', contactRow(bob.id).is_unsubscribed === true);
check('...stops their sequences', enrolment(bob.id).status === 'unsubscribed');
check('...and suppresses the address', db.suppression_list.some((s) => s.email === 'bob@acme.test' && s.reason === 'unsubscribed' && s.user_id === U));
check('...without sending the unsubscribe straight back to HubSpot', hs.unsubscribed.length === unsubCallsBefore, hs.unsubscribed);

// Hard bounce recorded in HubSpot.
const hc = hsContact('cara@beta.test')!;
await tick();
hc.properties.hs_email_hard_bounce_reason_enum = 'MAILBOX_DOESNT_EXIST';
hsTouch(hc.properties);
run = await runCrmSync(U, HS);
check('a hard bounce in HubSpot marks them bounced and stops their sequences', contactRow(cara.id).is_bounced === true && enrolment(cara.id).status === 'bounced' && db.suppression_list.some((s) => s.email === 'cara@beta.test' && s.reason === 'bounced'));

// Unsubscribed in Sincerely.
await dispatchEvent(U, 'lead.unsubscribed', { contact_id: jane.id, source: 'link' });
check('an unsubscribe here opts them out of every active HubSpot subscription', hs.unsubscribed.filter((u) => u.email === 'jane@acme.test').map((u) => u.sub).join(',') === '11,12', hs.unsubscribed);
check('...and is on their timeline', hs.notes.some((n) => /unsubscribed from emails/.test(n.body)));

// Someone HubSpot changes who is in Sincerely but was never linked: linked by email.
await tick();
const hd = { id: String(hs.nextId++), properties: { email: 'dan@beta.test', firstname: 'Daniel', company: 'Beta' } as Row };
hsTouch(hd.properties);
hs.contacts.set(hd.id, hd);
run = await runCrmSync(U, HS);
check('a HubSpot edit to someone already in Sincerely links them by email and fills what was blank', link(HS, dan.id)?.external_id === hd.id, link(HS, dan.id));
check('...their own values meet the HubSpot ones by the most-recent rule', ['Dan', 'Daniel'].includes(contactRow(dan.id).first_name));
check('another account with the same address is never touched', db.contacts.find((c) => c.id === notMine.id)!.first_name === null);

// Unknown people in HubSpot are not imported by an edit.
await tick();
const stranger = { id: String(hs.nextId++), properties: { email: 'stranger@zeta.test', firstname: 'Zed' } as Row };
hsTouch(stranger.properties);
hs.contacts.set(stranger.id, stranger);
run = await runCrmSync(U, HS);
check('a HubSpot person nobody asked for is not pulled in by an edit', !db.contacts.some((c) => c.email === 'stranger@zeta.test'));

// Lists.
hs.lists.set('7', [stranger.id, hd.id]);
const opts = await crmSyncService.options(U, HS);
check('options: pipelines with stages in order', opts.pipelines.find((p) => p.id === 'p2')?.stages.map((s) => s.id).join(',') === 's2a,s2b', opts.pipelines);
check('options: contact lists only', opts.lists.length === 1 && opts.lists[0].id === '7' && opts.lists[0].size === 2, opts.lists);
check('options: a missing permission is named, with the common fields offered instead', opts.warnings.some((w) => /crm\.schemas\.contacts\.read/.test(w)) && opts.fields.some((f) => f.key === 'firstname'), opts);
const ls = await crmSyncService.addListSync(U, HS, { external_id: '7', external_name: 'List 7', list_id: LIST });
check('pulling a list in imports its people into the Sincerely list (paged)', imported.length === 1 && imported[0].map((r) => r.email).sort().join(',') === 'dan@beta.test,stranger@zeta.test', imported);
check('...with the mapped fields', imported[0].find((r) => r.email === 'stranger@zeta.test')?.first_name === 'Zed');
check('...and links them for two-way sync', !!link(HS, db.contacts.find((c) => c.email === 'stranger@zeta.test')!.id));
check('...and reports what it did', ls.last_status === '1 added, 1 updated' && ls.list_name === 'From HubSpot', ls);
let dup: any = null;
try { await crmSyncService.addListSync(U, HS, { external_id: '7', external_name: 'List 7', list_id: LIST }); } catch (e) { dup = e; }
check('the same list cannot be pulled in twice', dup?.statusCode === 409 || /already/.test(dup?.message), dup?.message);

// Overview, log, ownership.
const ov = await crmSyncService.overview(U, HS);
check('overview counts', ov.linked >= 5 && ov.moved_24h.to_crm > 0 && ov.moved_24h.from_crm > 0 && ov.list_syncs.length === 1 && ov.settings.deal_pipeline === 'p2', ov);
const lg = await crmSyncService.log(U, HS, { status: 'ok', direction: 'from_crm', limit: 3 });
check('log filters and pages', lg.data.length === 3 && lg.has_more && lg.data.every((r) => r.status === 'ok' && r.direction === 'from_crm') && !('retry' in lg.data[0]), lg);
let denied: any = null;
try { await crmSyncService.overview(OTHER, HS); } catch (e) { denied = e; }
check("someone else's connection is not found", denied?.statusCode === 404, denied?.message);

/* ── Pipedrive ───────────────────────────────────────────────────────── */

console.log('\nPipedrive');
db.user_integrations.push({
  id: PD, user_id: U, provider: 'pipedrive', is_active: true,
  config: { api_token: 'a1b2c3d4e5f6a7b8c9d0e1f2' },
  events: ['email.replied', 'sara.intent_classified', 'lead.unsubscribed'],
  sync_settings: { deal_pipeline: '2', deal_stage: '21', on_deal_lost: 'stop' }, sync_cursors: {}, last_sync_at: null, next_sync_at: null, last_sync_error: null,
});
const eve = person('eve@gamma.test', { first_name: 'Eve', last_name: 'Stone', company: 'Gamma', phone: '+1 555' });
db.contacts.push(eve);
db.campaign_contacts.push({ id: crypto.randomUUID(), campaign_id: CAMP, contact_id: eve.id, status: 'active', next_send_at: ago(-60_000) });

await dispatchEvent(U, 'email.replied', { contact_id: eve.id, campaign_id: CAMP, subject: 'Re: intro' });
const pe = [...pd.persons.values()].find((x) => x.email?.[0]?.value === 'eve@gamma.test');
check('a reply creates the Pipedrive person with name, email, phone', pe && pe.name === 'Eve Stone' && pe.first_name === 'Eve' && pe.phone?.[0]?.value === '+1 555', pe);
check('...in their organization, created by name', pe && pd.orgs.get(pe.org_id)?.name === 'Gamma', [...pd.orgs.values()]);
check('...with the reply as a note', pd.notes.some((n) => n.person_id === pe?.id && /replied - Re: intro/.test(n.content)));
await dispatchEvent(U, 'sara.intent_classified', { contact_id: eve.id, campaign_id: CAMP, intent: 'meeting' });
const pdeal = [...pd.deals.values()][0];
check('a meeting reply opens a deal in the chosen stage', pdeal && pdeal.stage_id === 21 && pdeal.person_id === pe?.id && pdeal.title === 'Eve Stone (Gamma) - Sincerely', pdeal);

await runCrmSync(U, PD); // starts the cursors
await sleep(1100); // Pipedrive times are to the second
pe!.first_name = 'Evelyn';
pe!.name = 'Evelyn Stone';
pe!.update_time = pdTime();
pdeal.status = 'lost';
pdeal.update_time = pdTime();
run = await runCrmSync(U, PD);
check('an edit in Pipedrive comes into Sincerely', contactRow(eve.id).first_name === 'Evelyn', { run, first: contactRow(eve.id).first_name });
check('a lost deal ends their sequence when chosen', enrolment(eve.id).status === 'paused' && /in Pipedrive: deal lost/.test(enrolment(eve.id).error_message), enrolment(eve.id));

await sleep(1100);
contactRow(eve.id).company = 'Gamma Labs';
contactRow(eve.id).updated_at = nowStamp();
run = await runCrmSync(U, PD);
check('a company edit in Sincerely moves them to that organization in Pipedrive', pd.orgs.get(pe!.org_id)?.name === 'Gamma Labs', { org: pd.orgs.get(pe!.org_id) });

await dispatchEvent(U, 'lead.unsubscribed', { contact_id: eve.id, source: 'link' });
check('an unsubscribe sets their Pipedrive marketing status', pe!.marketing_status === 'unsubscribed');
pd.campaigns = false;
const frank = person('frank@gamma.test', { first_name: 'Frank' });
db.contacts.push(frank);
await dispatchEvent(U, 'email.replied', { contact_id: frank.id, subject: 'Re: x' });
await dispatchEvent(U, 'lead.unsubscribed', { contact_id: frank.id, source: 'link' });
check('without Campaigns by Pipedrive the unsubscribe is skipped with the reason, not failed', db.crm_sync_log.some((l) => l.integration_id === PD && l.kind === 'optout' && l.status === 'skipped' && /Campaigns by Pipedrive/.test(l.error)));

pd.filters.set(3, [pe!.id]);
const popts = await crmSyncService.options(U, PD);
check('Pipedrive options: filters, pipelines with ordered stages, editable fields', popts.lists[0]?.id === '3' && popts.pipelines.find((p) => p.id === '2')?.stages.map((s) => s.id).join(',') === '20,21' && popts.fields.some((f) => f.key === 'abc123') && popts.fields.some((f) => f.key === 'org_name'), popts);

// A bad token stops the run with a clear reason, recorded on the connection.
db.user_integrations[1].config.api_token = 'ffffffffffffffffffffffff';
run = await runCrmSync(U, PD);
check('a rejected token is reported on the connection', /rejected the API token/.test(db.user_integrations[1].last_sync_error || ''), db.user_integrations[1].last_sync_error);

/* ── The first sync, sending picked people, one contact ─────────────── */

console.log('\nfirst sync');
const U2 = crypto.randomUUID();
const HS2 = crypto.randomUUID();
db.user_integrations.push({
  id: HS2, user_id: U2, provider: 'hubspot', is_active: true,
  config: { access_token: 'pat-test' }, events: ['email.replied'],
  sync_settings: {}, sync_cursors: {}, sync_backfill: {}, last_sync_at: null, next_sync_at: null, last_sync_error: null,
});
const many: Row[] = [];
for (let i = 0; i < 230; i++) many.push({ ...person(`p${String(i).padStart(3, '0')}@first.test`, { first_name: `P${i}` }), user_id: U2 });
const badOne = { ...person('invalid@first.test', { first_name: 'Bad' }), user_id: U2 };
db.contacts.push(...many, badOne);
// Already in HubSpot, in a list: one of them is also in Sincerely.
const w1 = { id: String(hs.nextId++), properties: { email: 'p000@first.test', firstname: 'Pat', company: 'Webco' } as Row };
const w2 = { id: String(hs.nextId++), properties: { email: 'web2@first.test', firstname: 'Wendy', company: 'Webco' } as Row };
const w3 = { id: String(hs.nextId++), properties: { email: 'web3@first.test', firstname: 'Walt', hs_email_optout: 'true' } as Row };
for (const w of [w1, w2, w3]) { hsTouch(w.properties); hs.contacts.set(w.id, w); }
hs.lists.set('21', [w1.id, w2.id, w3.id]);
hs.batchSizes.length = 0;

const started = await crmSyncService.startFirstSync(U2, HS2, { to_crm: { scope: 'all' }, from_crm: { scope: 'list', external_id: '21', external_name: 'Webinar' } });
check('starting it answers at once with what it will do, totals included', started.status === 'running' && started.to_crm?.total === 231 && started.from_crm?.total === 3, started);
let notTwice: any = null;
try { await crmSyncService.startFirstSync(U2, HS2, { to_crm: { scope: 'all' }, from_crm: { scope: 'none' } }); } catch (e) { notTwice = e; }
check('a second start while one runs is refused', notTwice?.statusCode === 409, notTwice?.message);
for (let i = 0; i < 100 && db.user_integrations.find((r) => r.id === HS2).sync_backfill.status === 'running'; i++) await sleep(100);
const bf = db.user_integrations.find((r) => r.id === HS2).sync_backfill;
check('it finishes in the background', bf.status === 'done' && !!bf.finished_at, bf.status);
const webList = db.contact_lists.find((l) => l.user_id === U2 && l.name === 'HubSpot: Webinar');
check('the HubSpot list comes into a new Sincerely list named after it', !!webList && bf.from_crm.list_id === webList.id && bf.from_crm.done === 3 && bf.from_crm.added === 2, { bf: bf.from_crm, lists: db.contact_lists.map((l) => l.name) });
check('...everyone in it linked, including the one already here', [w1, w2, w3].every((w) => db.crm_links.some((l) => l.integration_id === HS2 && l.external_id === w.id)));
check('...an opt-out in HubSpot is applied on the way in', db.contacts.find((c) => c.user_id === U2 && c.email === 'web3@first.test')?.is_unsubscribed === true);
check('...and the list is kept in step from then on', db.crm_list_syncs.some((x) => x.integration_id === HS2 && x.external_id === '21' && x.list_id === webList?.id && x.enabled));
check('Sincerely contacts go to HubSpot in batches of up to 100, not one call each', hs.batchSizes.every((n) => n <= 100) && hs.batchSizes.filter((n) => n >= 90).length >= 2, hs.batchSizes);
check('everyone with an email is checked, the one already linked is not sent again', bf.to_crm.done === 233 && !hs.calls.some(() => false), bf.to_crm);
check('all 229 others are now in HubSpot and linked', many.slice(1).every((c) => hsContact(c.email) && link(HS2, c.id)) && !!link(HS2, many[0].id), many.slice(1).filter((c) => !hsContact(c.email)).length);
check('a bad row fails alone, not its whole batch, and can be retried', bf.to_crm.failed === 1 && db.crm_sync_log.some((l) => l.integration_id === HS2 && l.status === 'failed' && l.contact_id === badOne.id && l.retry?.step === 'send'), bf.to_crm);
check('it says what it did when it finishes', db.crm_sync_log.some((l) => l.integration_id === HS2 && /^First sync finished: 2 added from HubSpot; 232 checked and sent to HubSpot, 1 failed$/.test(l.summary)), db.crm_sync_log.filter((l) => l.integration_id === HS2 && l.kind === 'sync').map((l) => l.summary));
const ov2 = await crmSyncService.overview(U2, HS2);
check('the page sees the progress, never the id list or cursors', ov2.backfill?.status === 'done' && !!ov2.backfill.setup_done_at && !JSON.stringify(ov2.backfill).includes('cursor') && !('ids' in (ov2.backfill.to_crm || {})), ov2.backfill);

console.log('\nsending picked people');
const picked = [0, 1, 2].map((i) => ({ ...person(`pick${i}@first.test`), user_id: U2 }));
db.contacts.push(...picked);
let sent = await crmSyncService.sendPeople(U2, HS2, picked.map((c) => c.id));
check('a few picked people go straight away', !sent.queued && sent.sent === 3 && picked.every((c) => hsContact(c.email) && link(HS2, c.id)), sent);
const lots = Array.from({ length: 30 }, (_, i) => ({ ...person(`lot${i}@first.test`), user_id: U2 }));
db.contacts.push(...lots);
sent = await crmSyncService.sendPeople(U2, HS2, [...lots.map((c) => c.id), notMine.id]);
check('many picked people go in the background', sent.queued && sent.total === 31, sent);
for (let i = 0; i < 100 && db.user_integrations.find((r) => r.id === HS2).sync_backfill.status === 'running'; i++) await sleep(100);
check('...and all arrive', lots.every((c) => hsContact(c.email) && link(HS2, c.id)));
check("...someone else's contact in the pick is never sent", !link(HS2, notMine.id));
check('sending keeps the setup marked as done', !!db.user_integrations.find((r) => r.id === HS2).sync_backfill.setup_done_at);
hs.batchWithoutEmail = true;
const blind = [0, 1].map((i) => ({ ...person(`blind${i}@first.test`), user_id: U2 }));
db.contacts.push(...blind);
await crmSyncService.sendPeople(U2, HS2, blind.map((c) => c.id));
hs.batchWithoutEmail = false;
check('a batch answer that does not say who is who is never matched by position', blind.every((c) => link(HS2, c.id)?.external_id === hsContact(c.email)?.id), blind.map((c) => [link(HS2, c.id)?.external_id, hsContact(c.email)?.id]));
let none: any = null;
try { await crmSyncService.sendPeople(U2, HS2, []); } catch (e) { none = e; }
check('sending nobody is refused', none?.statusCode === 400);

console.log('\none contact');
const st = await crmSyncService.contactStatus(U2, many[5].id);
const hp5 = hsContact(many[5].email)!;
check('the contact page sees them as in HubSpot, with a link to the record', st.length === 1 && st[0].linked && st[0].url === `https://app-eu1.hubspot.com/contacts/4455/record/0-1/${hp5.id}`, st);
check('the account is read once and kept on the connection', db.user_integrations.find((r) => r.id === HS2).config.portal_id === '4455' && db.user_integrations.find((r) => r.id === HS2).config.access_token === 'pat-test');
const loose = { ...person('loose@first.test', { first_name: 'Lou' }), user_id: U2 };
db.contacts.push(loose);
check('someone not in HubSpot shows as not linked', (await crmSyncService.contactStatus(U2, loose.id))[0].linked === false);
let one = await crmSyncService.syncContactNow(U2, HS2, loose.id);
check('Sync now on someone not in HubSpot puts them there', one?.linked === true && hsContact('loose@first.test')?.properties.firstname === 'Lou', one);
contactRow(loose.id).company = 'Lou & Co';
await tick();
hsContact('loose@first.test')!.properties.jobtitle = 'Founder';
hsTouch(hsContact('loose@first.test')!.properties);
one = await crmSyncService.syncContactNow(U2, HS2, loose.id);
check('Sync now sends their Sincerely edits', hsContact('loose@first.test')?.properties.company === 'Lou & Co');
check('...and brings their HubSpot edits back', contactRow(loose.id).job_title === 'Founder', contactRow(loose.id).job_title);
check('...and shows what happened to them', (one?.recent.length || 0) > 0, one?.recent);
let foreign: any = null;
try { await crmSyncService.syncContactNow(OTHER, HS2, loose.id); } catch (e) { foreign = e; }
check("Sync now on someone else's connection is not found", foreign?.statusCode === 404);
db.user_integrations.find((r) => r.id === PD).config.api_token = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const pst = await crmSyncService.contactStatus(U, eve.id);
const pdst = pst.find((x) => x.provider === 'pipedrive');
check('Pipedrive: a link to the person and their deal', pdst?.url === `https://acme-sales.pipedrive.com/person/${pe!.id}` && pdst?.deal?.url === `https://acme-sales.pipedrive.com/deal/${pdeal.id}` && pdst?.deal?.status === 'lost', pdst);

console.log('\nowners, stages, tasks, companies, lists into campaigns');
{
  const U3 = crypto.randomUUID();
  const HS3 = crypto.randomUUID();
  db.user_integrations.push({
    id: HS3, user_id: U3, provider: 'hubspot', is_active: true,
    config: { access_token: 'pat-test' }, events: ['email.replied', 'sara.intent_classified'],
    sync_settings: { owner_id: '77', deal_pipeline: 'p2', deal_stage: 's2a', deal_stage_meeting: 's2b' },
    sync_cursors: {}, sync_backfill: {}, last_sync_at: null, next_sync_at: null, last_sync_error: null,
  });
  const camp3 = crypto.randomUUID();
  db.campaigns.push({ id: camp3, user_id: U3, name: 'Webinar follow-up' });
  const kim = { ...person('kim@northwind.test', { first_name: 'Kim', company: 'Northwind' }), user_id: U3 };
  const lee = { ...person('lee@northwind.test', { first_name: 'Lee', company: 'Northwind', website: 'https://www.northwind.test/about' }), user_id: U3 };
  const gmail = { ...person('sam.solo@gmail.com', { first_name: 'Sam' }), user_id: U3 };
  db.contacts.push(kim, lee, gmail);

  await dispatchEvent(U3, 'email.replied', { contact_id: kim.id, subject: 'Re: hi' });
  const hk = hsContact('kim@northwind.test')!;
  check('a person Sincerely creates gets the chosen owner', hk?.properties.hubspot_owner_id === '77', hk?.properties);
  check('...and their lifecycle stage moves to lead on a reply', hk?.properties.lifecyclestage === 'lead');
  const nw = [...hs.companies.values()].find((c) => c.domain === 'northwind.test');
  check('...and they are attached to their company, created from their work email domain', nw?.name === 'Northwind' && hs.companyLinks.some(([p, c]) => p === hk.id && c === nw.id), { nw, links: hs.companyLinks });
  await dispatchEvent(U3, 'email.replied', { contact_id: lee.id, subject: 'Re: hi' });
  check('a colleague is attached to the same company, not a second one', [...hs.companies.values()].filter((c) => c.domain === 'northwind.test').length === 1 && hs.companyLinks.some(([p]) => p === hsContact('lee@northwind.test')!.id));
  await dispatchEvent(U3, 'email.replied', { contact_id: gmail.id, subject: 'Re: hi' });
  check('a personal email address gets no company', !hs.companyLinks.some(([p]) => p === hsContact('sam.solo@gmail.com')!.id) && ![...hs.companies.values()].some((c) => c.domain === 'gmail.com'));
  const already = { id: String(hs.nextId++), properties: { email: 'pat@northwind.test', hubspot_owner_id: '12' } as Row };
  hsTouch(already.properties); hs.contacts.set(already.id, already);
  const pat = { ...person('pat@northwind.test', { first_name: 'Pat' }), user_id: U3 };
  db.contacts.push(pat);
  await dispatchEvent(U3, 'email.replied', { contact_id: pat.id, subject: 'Re: hi' });
  check('someone already in HubSpot keeps their own owner', already.properties.hubspot_owner_id === '12');

  await dispatchEvent(U3, 'sara.intent_classified', { contact_id: kim.id, intent: 'interested', confidence: 0.9 });
  const kd = [...hs.deals.values()].find((d) => d.contact === hk.id)!;
  check('interest: lifecycle moves to SQL, the deal goes to the interested stage with the owner', hk.properties.lifecyclestage === 'salesqualifiedlead' && kd?.properties.dealstage === 's2a' && kd?.properties.hubspot_owner_id === '77', { life: hk.properties.lifecyclestage, deal: kd?.properties });
  const task = hs.tasks.find((t) => t.contact === hk.id);
  check('...and the owner gets a follow-up task', task?.hs_task_subject === 'Follow up with Kim: interested' && task?.hubspot_owner_id === '77' && task?.hs_task_status === 'NOT_STARTED', task);
  await dispatchEvent(U3, 'sara.intent_classified', { contact_id: lee.id, intent: 'meeting' });
  const ld = [...hs.deals.values()].find((d) => d.contact === hsContact('lee@northwind.test')!.id);
  check('a meeting request goes to its own stage and makes them an opportunity', ld?.properties.dealstage === 's2b' && hsContact('lee@northwind.test')!.properties.lifecyclestage === 'opportunity', ld?.properties);

  const o3 = await crmSyncService.options(U3, HS3);
  check('owners are offered, archived ones left out', o3.owners.length === 1 && o3.owners[0].id === '77' && o3.owners[0].name === 'Olive Owner (olive@acme.test)', o3.owners);

  // A HubSpot list that feeds a campaign.
  const n1 = { id: String(hs.nextId++), properties: { email: 'new1@contoso.test', firstname: 'Nia' } as Row };
  hsTouch(n1.properties); hs.contacts.set(n1.id, n1);
  hs.lists.set('31', [n1.id, hk.id]);
  const list3 = crypto.randomUUID();
  db.contact_lists.push({ id: list3, user_id: U3, name: 'Webinar' });
  const ls3 = await crmSyncService.addListSync(U3, HS3, { external_id: '31', external_name: 'Webinar', list_id: list3 });
  let foreignCamp: any = null;
  try { await crmSyncService.updateListSync(U3, HS3, ls3.id, { campaign_id: CAMP }); } catch (e) { foreignCamp = e; }
  check("a list cannot feed someone else's campaign", foreignCamp?.statusCode === 404);
  const upd = await crmSyncService.updateListSync(U3, HS3, ls3.id, { campaign_id: camp3 });
  check('a list can be set to feed a campaign, and says which', upd.campaign_id === camp3 && upd.campaign_name === 'Webinar follow-up', upd);
  enrolled.length = 0;
  const ran = await crmSyncService.runListNow(U3, HS3, ls3.id);
  const nia = db.contacts.find((c) => c.user_id === U3 && c.email === 'new1@contoso.test');
  check('pulling it in puts its people in the campaign', enrolled.length === 1 && enrolled[0].campaignId === camp3 && enrolled[0].ids.includes(nia?.id) && enrolled[0].ids.includes(kim.id) && ran.enrolled === 2, { enrolled, ran });
  check('...and says so', db.crm_list_syncs.find((x) => x.id === ls3.id)?.last_status === '0 added, 2 updated, 2 put in the campaign', db.crm_list_syncs.find((x) => x.id === ls3.id)?.last_status);
  const off = await crmSyncService.updateListSync(U3, HS3, ls3.id, { campaign_id: null });
  check('...and can stop feeding it', off.campaign_id === null);

  // Pipedrive: owner on the deal, a task as an activity.
  const pdRow = db.user_integrations.find((r) => r.id === PD);
  pdRow.sync_settings = { ...pdRow.sync_settings, owner_id: '9' };
  pdRow.config.api_token = 'a1b2c3d4e5f6a7b8c9d0e1f2';
  const gus = { ...person('gus@delta.test', { first_name: 'Gus' }), user_id: U };
  db.contacts.push(gus);
  await dispatchEvent(U, 'email.replied', { contact_id: gus.id, subject: 'Re: x' });
  const pg = [...pd.persons.values()].find((x) => x.email?.[0]?.value === 'gus@delta.test');
  check('Pipedrive: a person Sincerely creates gets the chosen owner', pg?.owner_id === 9, pg);
  await dispatchEvent(U, 'sara.intent_classified', { contact_id: gus.id, intent: 'interested' });
  const gd = [...pd.deals.values()].find((d) => d.person_id === pg?.id);
  check('Pipedrive: the deal belongs to the owner', gd?.user_id === 9, gd);
  const act = pd.activities.find((a) => a.person_id === pg?.id);
  check('Pipedrive: the follow-up is a task activity for the owner, due today', act?.type === 'task' && act?.user_id === 9 && act?.due_date === new Date().toISOString().slice(0, 10) && /Follow up with Gus/.test(act?.subject), act);
  const po = await crmSyncService.options(U, PD);
  check('Pipedrive: active users are offered as owners', po.owners.length === 1 && po.owners[0].id === '9', po.owners);
}

/* ── Done ────────────────────────────────────────────────────────────── */

for (const s of [supa, hubspot, pipedrive]) s.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

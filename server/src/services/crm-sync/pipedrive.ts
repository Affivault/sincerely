import type { CrmSyncOptions } from '@lemlist/shared';
import { crmRequest, crmErrorMessage, CrmHttpError, type Method } from './http.js';
import type { CrmAdapter, CrmPerson, CrmDeal, CrmActivity, CrmChanges, CrmAccount } from './types.js';
import { nowIso } from './types.js';

/**
 * Pipedrive (API v1, personal API token). Activity goes on the person as a
 * note, the company is the person's organization (found by name, or
 * created), deals go in the pipeline and stage chosen, opt-outs set the
 * person's marketing status, and lists are Pipedrive people filters.
 */

const HOST = 'api.pipedrive.com';
const PAGES_PER_RUN = 4;
/** Org name stands in for the organization link, which is an id in Pipedrive. */
const ORG = 'org_name';

/** Fields that are not the person's own data, or are handled separately. */
const NOT_MAPPABLE = new Set(['id', 'email', 'name', 'org_id', 'owner_id', 'add_time', 'update_time', 'visible_to', 'marketing_status', 'label_ids', 'picture_id']);

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    const primary = v.find((x: any) => x?.primary) ?? v[0];
    return clean(primary?.value ?? primary);
  }
  if (typeof v === 'object') return clean((v as any).value ?? (v as any).name ?? null);
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Pipedrive times are "YYYY-MM-DD HH:MM:SS" in UTC. */
function pdTimeToIso(t: unknown): string | null {
  const s = clean(t);
  if (!s) return null;
  const d = new Date(/T/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function isoToPdTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function pipedriveAdapter(apiToken: string): CrmAdapter {
  const token = encodeURIComponent(apiToken.trim());

  async function call(method: Method, path: string, body?: unknown, what = 'Pipedrive'): Promise<any> {
    const sep = path.includes('?') ? '&' : '?';
    const res = await crmRequest(HOST, method, `${path}${sep}api_token=${token}`, { body });
    if (res.status >= 200 && res.status < 300 && res.json?.success !== false) return res.json;
    if (res.status === 401) throw new CrmHttpError('Pipedrive rejected the API token. Copy it again from Personal preferences > API.', 401);
    if (res.status === 402) throw new CrmHttpError(`${what}: this needs a Pipedrive plan or add-on the account does not have.`, 402);
    if (res.status === 403) throw new CrmHttpError(`${what}: Pipedrive refused (403): ${crmErrorMessage(res)}`, 403);
    throw new CrmHttpError(`${what} failed (${res.status}): ${crmErrorMessage(res)}`, res.status || 502);
  }

  function toPerson(p: any): CrmPerson {
    const values: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(p || {})) {
      if (k === 'email' || k === 'org_id') continue;
      values[k] = clean(v);
    }
    values[ORG] = clean(p?.org_name) ?? clean(p?.org_id?.name);
    return {
      id: String(p.id),
      email: clean(p?.email)?.toLowerCase() ?? clean(p?.primary_email)?.toLowerCase() ?? null,
      values,
      updatedAt: pdTimeToIso(p?.update_time),
      optedOut: String(p?.marketing_status || '').toLowerCase() === 'unsubscribed',
      // Pipedrive does not record bounces on a person.
      bounced: false,
    };
  }

  async function orgIdFor(name: string): Promise<number> {
    const q = new URLSearchParams({ term: name, fields: 'name', exact_match: 'true', limit: '1' });
    const found = await call('GET', `/v1/organizations/search?${q}`, undefined, 'Finding the Pipedrive organization');
    const id = found?.data?.items?.[0]?.item?.id;
    if (id) return Number(id);
    const created = await call('POST', '/v1/organizations', { name }, 'Creating the Pipedrive organization');
    if (!created?.data?.id) throw new CrmHttpError('Pipedrive did not return the organization it created.', 502);
    return Number(created.data.id);
  }

  /** Mapped values as a Pipedrive person body. */
  async function personBody(values: Record<string, string>): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (k === ORG) body.org_id = v ? await orgIdFor(v) : null;
      else if (k === 'phone') body.phone = v ? [{ value: v, primary: true }] : [];
      else body[k] = v === '' ? null : v;
    }
    // Pipedrive shows `name`; keep it in step when the name parts are sent.
    if ('first_name' in values || 'last_name' in values) {
      const full = [values.first_name, values.last_name].filter(Boolean).join(' ').trim();
      if (full) body.name = full;
    }
    return body;
  }

  async function recents(kind: 'person' | 'deal', cursor: string) {
    const out: any[] = [];
    let start = 0;
    let more = false;
    let last = cursor;
    for (let page = 0; page < PAGES_PER_RUN; page++) {
      const q = new URLSearchParams({ since_timestamp: isoToPdTime(cursor), items: kind, start: String(start), limit: '500' });
      const json = await call('GET', `/v1/recents?${q}`, undefined, `Reading changed ${kind === 'person' ? 'people' : 'deals'}`);
      for (const r of json?.data || []) if (r?.item === kind && r.data) out.push(r.data);
      const pg = json?.additional_data?.pagination;
      const lastOnPage = pdTimeToIso(json?.additional_data?.last_timestamp_on_page);
      if (lastOnPage && lastOnPage > last) last = lastOnPage;
      if (!pg?.more_items_in_collection) break;
      start = Number(pg.next_start) || start + 500;
      if (page === PAGES_PER_RUN - 1) more = true;
    }
    // Without a page timestamp, the newest change read.
    for (const d of out) {
      const t = pdTimeToIso(d.update_time);
      if (t && t > last) last = t;
    }
    return { rows: out, cursor: last, more };
  }

  async function stagesByPipeline(): Promise<Map<string, { id: string; label: string; order: number }[]>> {
    const json = await call('GET', '/v1/stages', undefined, 'Reading pipeline stages');
    const map = new Map<string, { id: string; label: string; order: number }[]>();
    for (const s of json?.data || []) {
      const key = String(s.pipeline_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ id: String(s.id), label: String(s.name || s.id), order: Number(s.order_nr) || 0 });
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }

  return {
    provider: 'pipedrive',
    label: 'Pipedrive',

    async upsertPerson(email, values, knownId) {
      let id = knownId || null;
      if (id) {
        try {
          await call('PUT', `/v1/persons/${encodeURIComponent(id)}`, await personBody(values), 'Updating the Pipedrive person');
          return { id, created: false };
        } catch (err) {
          if (!(err instanceof CrmHttpError && (err.status === 404 || err.status === 410))) throw err;
          id = null;
        }
      }
      const q = new URLSearchParams({ term: email, fields: 'email', exact_match: 'true', limit: '1' });
      const found = await call('GET', `/v1/persons/search?${q}`, undefined, 'Finding the Pipedrive person');
      const existing = found?.data?.items?.[0]?.item?.id;
      if (existing) {
        await call('PUT', `/v1/persons/${existing}`, await personBody(values), 'Updating the Pipedrive person');
        return { id: String(existing), created: false };
      }
      const body = await personBody(values);
      const created = await call('POST', '/v1/persons', {
        ...body,
        name: (body.name as string) || email,
        email: [{ value: email, primary: true, label: 'work' }],
      }, 'Creating the Pipedrive person');
      if (!created?.data?.id) throw new CrmHttpError('Pipedrive did not return the person it created.', 502);
      return { id: String(created.data.id), created: true };
    },

    async updatePerson(id, values) {
      if (Object.keys(values).length === 0) return;
      await call('PUT', `/v1/persons/${encodeURIComponent(id)}`, await personBody(values), 'Updating the Pipedrive person');
    },

    async getPeople(ids) {
      const out: CrmPerson[] = [];
      for (const id of ids) {
        try {
          const json = await call('GET', `/v1/persons/${encodeURIComponent(id)}`, undefined, 'Reading the Pipedrive person');
          if (json?.data) out.push(toPerson(json.data));
        } catch (err) {
          if (!(err instanceof CrmHttpError && (err.status === 404 || err.status === 410))) throw err;
        }
      }
      return out;
    },

    async changedPeople(cursor): Promise<CrmChanges<CrmPerson>> {
      if (!cursor) return { items: [], cursor: nowIso(), more: false };
      const { rows, cursor: next, more } = await recents('person', cursor);
      const items = rows.filter((p) => p.active_flag !== false && p.id).map(toPerson);
      return { items, cursor: next, more };
    },

    async changedDeals(cursor): Promise<CrmChanges<CrmDeal>> {
      if (!cursor) return { items: [], cursor: nowIso(), more: false };
      const { rows, cursor: next, more } = await recents('deal', cursor);
      const items: CrmDeal[] = rows
        .filter((d) => d.id && (d.status === 'won' || d.status === 'lost' || d.status === 'open'))
        .map((d) => {
          const pid = typeof d.person_id === 'object' && d.person_id !== null ? d.person_id.value : d.person_id;
          return {
            id: String(d.id),
            status: d.status,
            personIds: pid ? [String(pid)] : [],
            updatedAt: pdTimeToIso(d.update_time),
          };
        });
      return { items, cursor: next, more };
    },

    async logActivity(personId, activity: CrmActivity) {
      const content = [
        `<b>${escapeHtml(activity.title)}</b>`,
        ...activity.lines.map(escapeHtml),
      ].join('<br>');
      await call('POST', '/v1/notes', { content, person_id: Number(personId) }, 'Adding a note in Pipedrive');
    },

    async createDeal(personId, input) {
      const body: Record<string, unknown> = { title: input.title, person_id: Number(personId) };
      if (input.ownerId) body.user_id = Number(input.ownerId);
      if (input.stage) body.stage_id = Number(input.stage);
      else if (input.pipeline) body.pipeline_id = Number(input.pipeline);
      const json = await call('POST', '/v1/deals', body, 'Creating the Pipedrive deal');
      if (!json?.data?.id) throw new CrmHttpError('Pipedrive did not return the deal it created.', 502);
      return { id: String(json.data.id) };
    },

    async optOut(personId) {
      try {
        const json = await call('PUT', `/v1/persons/${encodeURIComponent(personId)}`, { marketing_status: 'unsubscribed' }, 'Unsubscribing in Pipedrive');
        // Accounts without Campaigns by Pipedrive ignore the field.
        return String(json?.data?.marketing_status || '').toLowerCase() === 'unsubscribed' ? 'done' : 'unsupported';
      } catch (err) {
        if (err instanceof CrmHttpError && (err.status === 400 || err.status === 402 || err.status === 403)) return 'unsupported';
        throw err;
      }
    },

    async listMembers(filterId, cursor) {
      const q = new URLSearchParams({ filter_id: filterId, start: cursor || '0', limit: '500' });
      const json = await call('GET', `/v1/persons?${q}`, undefined, 'Reading the Pipedrive filter');
      const people = ((json?.data as any[]) || []).filter((p) => p?.id).map(toPerson);
      const pg = json?.additional_data?.pagination;
      return {
        ids: people.map((p) => p.id),
        people,
        next: pg?.more_items_in_collection ? String(pg.next_start ?? Number(cursor || 0) + 500) : null,
      };
    },

    async upsertPeople(items) {
      // Pipedrive has no batch write for people: one at a time, which also keeps within its rate limits.
      const out: { email: string; id?: string; created?: boolean; error?: string }[] = [];
      for (const it of items) {
        try {
          const r = await this.upsertPerson(it.email, it.values);
          out.push({ email: it.email, id: r.id, created: r.created });
        } catch (err) {
          if (err instanceof CrmHttpError && (err.status === 401 || err.transient)) throw err;
          out.push({ email: it.email, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return out;
    },

    async allPeople(cursor) {
      const q = new URLSearchParams({ start: cursor || '0', limit: '500' });
      const json = await call('GET', `/v1/persons?${q}`, undefined, 'Reading Pipedrive people');
      const pg = json?.additional_data?.pagination;
      return {
        people: ((json?.data as any[]) || []).filter((p) => p?.id).map(toPerson),
        next: pg?.more_items_in_collection ? String(pg.next_start ?? Number(cursor || 0) + 500) : null,
      };
    },

    async countPeople(listId) {
      if (listId) return null; // Pipedrive does not say how many a filter holds
      try {
        const json = await call('GET', '/v1/persons/summary', undefined, 'Counting Pipedrive people');
        const n = Number(json?.data?.total_count);
        return Number.isFinite(n) ? n : null;
      } catch {
        return null;
      }
    },

    async account(): Promise<CrmAccount | null> {
      try {
        const json = await call('GET', '/v1/users/me', undefined, 'Reading the Pipedrive account');
        const d = json?.data?.company_domain;
        return d ? { company_domain: String(d) } : null;
      } catch {
        return null;
      }
    },

    async assignOwner(personIds, ownerId) {
      for (const id of personIds) {
        await call('PUT', `/v1/persons/${encodeURIComponent(id)}`, { owner_id: Number(ownerId) }, 'Assigning the Pipedrive owner');
      }
    },

    async setLifecycle() {
      return 'unsupported'; // Pipedrive has no lifecycle stages on people
    },

    async createTask(personId, input) {
      await call('POST', '/v1/activities', {
        subject: input.subject.slice(0, 250),
        type: 'task',
        due_date: input.dueAt.slice(0, 10),
        person_id: Number(personId),
        note: escapeHtml(input.body),
        ...(input.ownerId ? { user_id: Number(input.ownerId) } : {}),
      }, 'Creating the Pipedrive activity');
    },

    async linkCompany() {
      return 'unsupported'; // the organization comes from the company field mapping
    },

    async options(): Promise<CrmSyncOptions> {
      const out: CrmSyncOptions = { fields: [], pipelines: [], lists: [], owners: [], warnings: [] };
      const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
      await Promise.all([
        (async () => {
          try {
            const json = await call('GET', '/v1/personFields?start=0&limit=500', undefined, 'Reading person fields');
            const fields: { key: string; label: string }[] = [{ key: ORG, label: 'Organization (by name)' }];
            for (const f of json?.data || []) {
              const key = String(f.key);
              if (NOT_MAPPABLE.has(key)) continue;
              const editable = f.edit_flag === true || ['first_name', 'last_name', 'phone', 'job_title'].includes(key);
              if (!editable) continue;
              fields.push({ key, label: String(f.name || key) });
            }
            out.fields = fields;
          } catch (err) {
            out.fields = [
              { key: 'first_name', label: 'First name' },
              { key: 'last_name', label: 'Last name' },
              { key: 'phone', label: 'Phone' },
              { key: ORG, label: 'Organization (by name)' },
            ];
            out.warnings.push(why(err));
          }
        })(),
        (async () => {
          try {
            const [pipes, stages] = await Promise.all([
              call('GET', '/v1/pipelines', undefined, 'Reading pipelines'),
              stagesByPipeline(),
            ]);
            out.pipelines = (pipes?.data || []).map((p: any) => ({
              id: String(p.id),
              label: String(p.name || p.id),
              stages: (stages.get(String(p.id)) || []).map(({ id, label }) => ({ id, label })),
            }));
          } catch (err) {
            out.warnings.push(why(err));
          }
        })(),
        (async () => {
          try {
            const json = await call('GET', '/v1/users', undefined, 'Reading users');
            out.owners = ((json?.data as any[]) || [])
              .filter((u) => u && u.active_flag !== false)
              .map((u) => ({ id: String(u.id), name: u.email && u.name !== u.email ? `${u.name} (${u.email})` : String(u.name || u.email || u.id) }));
          } catch (err) {
            out.warnings.push(why(err));
          }
        })(),
        (async () => {
          try {
            const json = await call('GET', '/v1/filters?type=people', undefined, 'Reading filters');
            out.lists = (json?.data || []).map((f: any) => ({ id: String(f.id), name: String(f.name || f.id), size: null }));
          } catch (err) {
            out.warnings.push(why(err));
          }
        })(),
      ]);
      return out;
    },
  };
}

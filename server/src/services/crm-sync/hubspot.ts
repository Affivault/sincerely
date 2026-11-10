import type { CrmSyncOptions } from '@lemlist/shared';
import { crmRequest, crmErrorMessage, CrmHttpError, type CrmResponse, type Method } from './http.js';
import type { CrmAdapter, CrmPerson, CrmDeal, CrmActivity, CrmChanges } from './types.js';
import { nowIso } from './types.js';

/**
 * HubSpot (CRM v3). Activity goes on the contact's timeline as a note, deals
 * are real deals associated to the contact, opt-outs use the communication
 * preferences API, and lists are HubSpot contact lists.
 */

const HOST = 'api.hubapi.com';
/** HubSpot's own association type ids. */
const NOTE_TO_CONTACT = 202;
const DEAL_TO_CONTACT = 3;
const PAGES_PER_RUN = 5;

/** Read on every pull besides the mapped properties. */
const BASE_PROPS = ['email', 'lastmodifieddate', 'hs_email_optout', 'hs_email_hard_bounce_reason_enum'];

/** Shown in the field picker when the token cannot read contact properties. */
const COMMON_FIELDS: { key: string; label: string }[] = [
  { key: 'firstname', label: 'First name' },
  { key: 'lastname', label: 'Last name' },
  { key: 'company', label: 'Company name' },
  { key: 'jobtitle', label: 'Job title' },
  { key: 'phone', label: 'Phone number' },
  { key: 'mobilephone', label: 'Mobile phone number' },
  { key: 'website', label: 'Website URL' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State/Region' },
  { key: 'country', label: 'Country/Region' },
  { key: 'industry', label: 'Industry' },
  { key: 'hs_linkedin_url', label: 'LinkedIn URL' },
];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** The permission a 403 says is missing, from HubSpot's error body. */
function missingScope(res: CrmResponse): string | undefined {
  const ctx = res.json?.errors?.[0]?.context || res.json?.context || {};
  const scopes = ctx.requiredGranularScopes || ctx.requiredScopes || ctx.requiredScope;
  if (Array.isArray(scopes) && scopes.length) return scopes.join(' or ');
  if (typeof scopes === 'string') return scopes;
  return undefined;
}

export function hubspotAdapter(accessToken: string): CrmAdapter {
  const headers = { Authorization: `Bearer ${accessToken.trim()}` };

  async function call(method: Method, path: string, body?: unknown, what = 'HubSpot'): Promise<any> {
    const res = await crmRequest(HOST, method, path, { headers, body });
    if (res.status >= 200 && res.status < 300) return res.json;
    if (res.status === 401) throw new CrmHttpError('HubSpot rejected the access token. Reconnect HubSpot on the Integrations page.', 401);
    if (res.status === 403) {
      const scope = missingScope(res);
      throw new CrmHttpError(
        scope
          ? `${what}: the HubSpot connection is missing the ${scope} permission.`
          : `${what}: HubSpot refused (403): ${crmErrorMessage(res)}`,
        403,
        scope,
      );
    }
    throw new CrmHttpError(`${what} failed (${res.status}): ${crmErrorMessage(res)}`, res.status);
  }

  function toPerson(r: any): CrmPerson {
    const p = r?.properties || {};
    const values: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(p)) values[k] = clean(v);
    return {
      id: String(r.id),
      email: clean(p.email)?.toLowerCase() ?? null,
      values,
      updatedAt: clean(p.lastmodifieddate) ?? clean(r.updatedAt),
      optedOut: String(p.hs_email_optout).toLowerCase() === 'true',
      bounced: !!clean(p.hs_email_hard_bounce_reason_enum),
    };
  }

  async function search(object: 'contacts' | 'deals', dateProp: string, cursor: string, properties: string[]) {
    const since = Date.parse(cursor);
    const results: any[] = [];
    let after: string | undefined;
    let more = false;
    for (let page = 0; page < PAGES_PER_RUN; page++) {
      const json = await call('POST', `/crm/v3/objects/${object}/search`, {
        filterGroups: [{ filters: [{ propertyName: dateProp, operator: 'GTE', value: String(since) }] }],
        sorts: [{ propertyName: dateProp, direction: 'ASCENDING' }],
        properties,
        limit: 100,
        ...(after ? { after } : {}),
      }, `Reading changed ${object}`);
      results.push(...(json?.results || []));
      after = json?.paging?.next?.after;
      if (!after) break;
      // HubSpot search stops paging at 10,000 results; the cursor moves on instead.
      if (page === PAGES_PER_RUN - 1 || Number(after) >= 9_900) more = true;
      if (more) break;
    }
    return { results, more };
  }

  /** The next cursor: the last change read, nudged on by 1ms when a full page all shared the old one. */
  function nextCursor(cursor: string, last: string | null, more: boolean): string {
    if (!last) return cursor;
    const t = Date.parse(last);
    if (!Number.isFinite(t)) return cursor;
    if (more && t <= Date.parse(cursor)) return new Date(t + 1).toISOString();
    return new Date(t).toISOString();
  }

  async function firstStage(pipeline: string): Promise<{ pipeline: string; stage: string }> {
    const json = await call('GET', '/crm/v3/pipelines/deals', undefined, 'Reading deal pipelines');
    const pipes: any[] = json?.results || [];
    const pick = pipes.find((p) => String(p.id) === pipeline) || pipes.find((p) => p.id === 'default') || pipes[0];
    if (!pick) throw new CrmHttpError('HubSpot has no deal pipeline to put the deal in.', 400);
    const stages = [...(pick.stages || [])].sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    if (!stages[0]) throw new CrmHttpError(`The HubSpot pipeline "${pick.label}" has no stages.`, 400);
    return { pipeline: String(pick.id), stage: String(stages[0].id) };
  }

  return {
    provider: 'hubspot',
    label: 'HubSpot',

    async upsertPerson(email, values, knownId) {
      if (knownId) {
        try {
          await call('PATCH', `/crm/v3/objects/contacts/${encodeURIComponent(knownId)}`, { properties: values }, 'Updating the HubSpot contact');
          return { id: knownId, created: false };
        } catch (err) {
          // Deleted or merged away in HubSpot: find or make them again by email.
          if (!(err instanceof CrmHttpError && err.status === 404)) throw err;
        }
      }
      const json = await call('POST', '/crm/v3/objects/contacts/batch/upsert', {
        inputs: [{ idProperty: 'email', id: email, properties: { ...values, email } }],
      }, 'Saving the HubSpot contact');
      const r = json?.results?.[0];
      if (!r?.id) throw new CrmHttpError('HubSpot did not return the contact it saved.', 502);
      return { id: String(r.id), created: r.new === true };
    },

    async updatePerson(id, values) {
      if (Object.keys(values).length === 0) return;
      await call('PATCH', `/crm/v3/objects/contacts/${encodeURIComponent(id)}`, { properties: values }, 'Updating the HubSpot contact');
    },

    async getPeople(ids, properties) {
      const out: CrmPerson[] = [];
      const props = [...new Set([...BASE_PROPS, ...properties])];
      for (let i = 0; i < ids.length; i += 100) {
        const json = await call('POST', '/crm/v3/objects/contacts/batch/read', {
          properties: props,
          inputs: ids.slice(i, i + 100).map((id) => ({ id })),
        }, 'Reading HubSpot contacts');
        out.push(...(json?.results || []).map(toPerson));
      }
      return out;
    },

    async changedPeople(cursor, properties): Promise<CrmChanges<CrmPerson>> {
      if (!cursor) return { items: [], cursor: nowIso(), more: false };
      const { results, more } = await search('contacts', 'lastmodifieddate', cursor, [...new Set([...BASE_PROPS, ...properties])]);
      const items = results.map(toPerson);
      return { items, cursor: nextCursor(cursor, items.length ? items[items.length - 1].updatedAt : null, more), more };
    },

    async changedDeals(cursor): Promise<CrmChanges<CrmDeal>> {
      if (!cursor) return { items: [], cursor: nowIso(), more: false };
      const { results, more } = await search('deals', 'hs_lastmodifieddate', cursor, ['hs_is_closed_won', 'hs_is_closed', 'dealstage', 'hs_lastmodifieddate']);
      const deals: CrmDeal[] = results.map((r) => {
        const p = r.properties || {};
        const won = String(p.hs_is_closed_won).toLowerCase() === 'true';
        const closed = String(p.hs_is_closed).toLowerCase() === 'true';
        return {
          id: String(r.id),
          status: won ? 'won' : closed ? 'lost' : 'open',
          personIds: [],
          updatedAt: clean(p.hs_lastmodifieddate) ?? clean(r.updatedAt),
        };
      });
      // Only closed deals matter to the sync; read who is on those.
      const closed = deals.filter((d) => d.status !== 'open');
      for (let i = 0; i < closed.length; i += 100) {
        const slice = closed.slice(i, i + 100);
        const json = await call('POST', '/crm/v4/associations/deals/contacts/batch/read', {
          inputs: slice.map((d) => ({ id: d.id })),
        }, 'Reading who is on HubSpot deals');
        for (const row of json?.results || []) {
          const deal = slice.find((d) => d.id === String(row?.from?.id));
          if (deal) deal.personIds = (row.to || []).map((t: any) => String(t.toObjectId));
        }
      }
      const last = deals.length ? deals[deals.length - 1].updatedAt : null;
      return { items: deals, cursor: nextCursor(cursor, last, more), more };
    },

    async logActivity(personId, activity: CrmActivity) {
      const body = [
        `<p><strong>${escapeHtml(activity.title)}</strong></p>`,
        activity.lines.length ? `<p>${activity.lines.map(escapeHtml).join('<br>')}</p>` : '',
      ].join('');
      await call('POST', '/crm/v3/objects/notes', {
        properties: { hs_timestamp: activity.at, hs_note_body: body },
        associations: [{ to: { id: personId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_CONTACT }] }],
      }, 'Adding to the HubSpot timeline');
    },

    async createDeal(personId, input) {
      const where = input.stage && input.pipeline ? { pipeline: input.pipeline, stage: input.stage } : await firstStage(input.pipeline);
      const json = await call('POST', '/crm/v3/objects/deals', {
        properties: { dealname: input.title, pipeline: where.pipeline, dealstage: where.stage },
        associations: [{ to: { id: personId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: DEAL_TO_CONTACT }] }],
      }, 'Creating the HubSpot deal');
      if (!json?.id) throw new CrmHttpError('HubSpot did not return the deal it created.', 502);
      return { id: String(json.id) };
    },

    async optOut(_personId, email) {
      let defs: any[];
      try {
        const json = await call('GET', '/communication-preferences/v3/definitions', undefined, 'Reading HubSpot email subscriptions');
        defs = (json?.subscriptionDefinitions || []).filter((d: any) => d.isActive !== false);
      } catch (err) {
        if (err instanceof CrmHttpError && err.status === 403) return 'unsupported';
        throw err;
      }
      if (defs.length === 0) return 'unsupported';
      for (const d of defs) {
        const res = await crmRequest(HOST, 'POST', '/communication-preferences/v3/unsubscribe', {
          headers,
          body: { emailAddress: email, subscriptionId: String(d.id), legalBasisExplanation: 'Unsubscribed in Sincerely' },
        });
        if (res.status === 403) return 'unsupported';
        // "Already unsubscribed" is a 400 that means the job is done.
        if (res.status >= 300 && !(res.status === 400 && /already/i.test(crmErrorMessage(res)))) {
          throw new CrmHttpError(`Unsubscribing in HubSpot failed (${res.status}): ${crmErrorMessage(res)}`, res.status);
        }
      }
      return 'done';
    },

    async listMembers(listId, cursor) {
      const q = new URLSearchParams({ limit: '250' });
      if (cursor) q.set('after', cursor);
      const json = await call('GET', `/crm/v3/lists/${encodeURIComponent(listId)}/memberships?${q}`, undefined, 'Reading the HubSpot list');
      return {
        ids: (json?.results || []).map((r: any) => String(r.recordId)),
        next: json?.paging?.next?.after ? String(json.paging.next.after) : null,
      };
    },

    async options(): Promise<CrmSyncOptions> {
      const out: CrmSyncOptions = { fields: [], pipelines: [], lists: [], warnings: [] };
      const why = (err: unknown) => (err instanceof Error ? err.message : String(err));
      await Promise.all([
        (async () => {
          try {
            const json = await call('GET', '/crm/v3/properties/contacts', undefined, 'Reading contact properties');
            out.fields = (json?.results || [])
              .filter((p: any) => !p.hidden && !p.calculated && !p.modificationMetadata?.readOnlyValue && p.name !== 'email')
              .map((p: any) => ({ key: String(p.name), label: String(p.label || p.name) }))
              .sort((a: any, b: any) => a.label.localeCompare(b.label));
          } catch (err) {
            out.fields = COMMON_FIELDS;
            out.warnings.push(`${why(err)} The common HubSpot fields are listed instead.`);
          }
        })(),
        (async () => {
          try {
            const json = await call('GET', '/crm/v3/pipelines/deals', undefined, 'Reading deal pipelines');
            out.pipelines = (json?.results || []).map((p: any) => ({
              id: String(p.id),
              label: String(p.label || p.id),
              stages: [...(p.stages || [])]
                .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
                .map((s: any) => ({ id: String(s.id), label: String(s.label || s.id) })),
            }));
          } catch (err) {
            out.warnings.push(why(err));
          }
        })(),
        (async () => {
          try {
            let offset = 0;
            for (let page = 0; page < 5; page++) {
              const json = await call('POST', '/crm/v3/lists/search', { query: '', count: 100, offset }, 'Reading lists');
              for (const l of json?.lists || []) {
                if (l.objectTypeId && l.objectTypeId !== '0-1') continue; // contact lists only
                const size = Number(l.additionalProperties?.hs_list_size);
                out.lists.push({ id: String(l.listId), name: String(l.name || l.listId), size: Number.isFinite(size) ? size : null });
              }
              if (!json?.hasMore) break;
              offset = Number(json.offset) || offset + 100;
            }
          } catch (err) {
            out.warnings.push(why(err));
          }
        })(),
      ]);
      return out;
    },
  };
}

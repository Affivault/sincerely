import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { outreachFor } from './contacts.service.js';

/* ═══════════════════════════════════════════════════════════════════════
   Companies.

   The database owns name matching (normalize_company_name + a unique index
   on the normalised form), so "Acme", "Acme Ltd" and "acme.com" resolve to
   one record no matter which code path creates them — import, API, or a
   user typing into a form.
   ═══════════════════════════════════════════════════════════════════════ */

const COMPANY_KEYS = ['name', 'domain', 'website', 'industry', 'size', 'location', 'linkedin_url', 'notes'] as const;

function pick(body: any, keys: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) if (body?.[k] !== undefined) out[k] = body[k];
  return out;
}

// Quote a value for use inside a PostgREST `.or()`/`.in()` filter string so
// commas, parens, and quotes in an email address can't break the filter syntax.
function quoteForOr(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** Reject a company_id that doesn't belong to this user before it's persisted. */
async function assertCompanyOwned(userId: string, companyId: string): Promise<void> {
  const { data } = await supabaseAdmin.from('companies').select('id').eq('id', companyId).eq('user_id', userId).maybeSingle();
  if (!data) throw new AppError('Company not found', 404);
}

/** Surface the "run migration 038" case as an instruction, not a 500. */
function assertCompaniesTable(error: { message?: string; code?: string } | null): void {
  const msg = error?.message || '';
  if (/companies/i.test(msg) && (/does not exist/i.test(msg) || error?.code === '42P01')) {
    throw new AppError(
      'Companies need database migration 038_companies.sql — run it in Supabase, then reload.',
      503,
    );
  }
}

export const companiesService = {
  async list(userId: string, search?: string) {
    // Deals come back as rows rather than a count so the list can show open
    // value — the one number that makes an accounts table worth reading.
    const build = (withLeads: boolean) => {
      let q = supabaseAdmin
        .from('companies')
        // leads: the same embed, narrowed to lifecycle 'prospect', so the
        // table can say how many people at an account are CRM contacts and
        // how many are still outbound leads.
        .select(withLeads ? '*, contacts(count), leads:contacts(count), deals(value, stage)' : '*, contacts(count), deals(value, stage)')
        .eq('user_id', userId);
      if (withLeads) q = q.eq('leads.lifecycle', 'prospect');
      if (search && search.trim()) {
        const safe = search.replace(/[%_,()\\]/g, '').trim();
        if (safe) q = q.or(`name.ilike.%${safe}%,domain.ilike.%${safe}%,industry.ilike.%${safe}%`);
      }
      return q.order('name', { ascending: true }).limit(500);
    };

    // The split is a nicety: if this PostgREST cannot filter an aggregate
    // embed, the table still loads with the plain head count.
    let { data, error } = await build(true);
    if (error) ({ data, error } = await build(false));
    if (error) { assertCompaniesTable(error); throw new AppError(error.message, 500); }

    return (data || []).map((c: any) => {
      const deals: Array<{ value: number | null; stage: string }> = c.deals || [];
      const open = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
      return {
        ...c,
        contact_count: c.contacts?.[0]?.count ?? 0,
        // Absent (not zero) when the split could not be read.
        ...(c.leads ? {
          lead_count: c.leads?.[0]?.count ?? 0,
          crm_count: Math.max(0, (c.contacts?.[0]?.count ?? 0) - (c.leads?.[0]?.count ?? 0)),
        } : {}),
        deal_count: deals.length,
        open_value: open.reduce((s, d) => s + (Number(d.value) || 0), 0),
        contacts: undefined,
        leads: undefined,
        deals: undefined,
      };
    });
  },

  async get(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) { assertCompaniesTable(error); throw new AppError(error.message, 500); }
    if (!data) throw new AppError('Company not found', 404);
    return data;
  },

  /** The company page: the record, its people, and its deals — one round-trip. */
  async summary(userId: string, id: string) {
    const company = await this.get(userId, id);

    const [{ data: contacts }, { data: deals }] = await Promise.all([
      supabaseAdmin
        .from('contacts')
        .select('id, email, first_name, last_name, job_title, dcs_score, lifecycle, list_contacts(contact_lists(id, name, kind, color, is_trashed))')
        .eq('user_id', userId)
        .eq('company_id', id)
        .order('last_name', { ascending: true })
        .limit(200),
      supabaseAdmin
        .from('deals')
        .select('*')
        .eq('user_id', userId)
        .eq('company_id', id)
        .order('created_at', { ascending: false }),
    ]);

    const open = (deals || []).filter((d: any) => d.stage !== 'won' && d.stage !== 'lost');
    const outreach = await outreachFor(userId, (contacts || []).map((c: any) => c.id));
    const people = (contacts || []).map((c: any) => ({
      ...c,
      lifecycle: c.lifecycle || 'prospect',
      outreach: outreach.get(c.id) ?? null,
      lists: (c.list_contacts || []).map((lc: any) => lc.contact_lists).filter((l: any) => l && !l.is_trashed),
      list_contacts: undefined,
    }));
    const leadCount = people.filter((c: any) => c.lifecycle === 'prospect').length;
    return {
      company: {
        ...company,
        contact_count: people.length,
        lead_count: leadCount,
        crm_count: people.length - leadCount,
        deal_count: (deals || []).length,
        open_value: open.reduce((s: number, d: any) => s + (Number(d.value) || 0), 0),
      },
      contacts: people,
      deals: deals || [],
    };
  },

  /**
   * Everything that has happened with this account, across every person at
   * it. A company's history is the union of its people's — you don't
   * remember which of the three contacts at Acme sent the pricing question,
   * you remember Acme asked.
   */
  async activity(userId: string, id: string) {
    await this.get(userId, id); // ownership, and a 404 before any fan-out

    const { data: people } = await supabaseAdmin
      .from('contacts')
      .select('id, email, first_name, last_name')
      .eq('user_id', userId)
      .eq('company_id', id)
      .limit(200);

    const contacts = people || [];
    const ids = contacts.map((c: any) => c.id);
    const emails = contacts.map((c: any) => c.email).filter(Boolean);

    // No people means no history to gather — and an `.in()` on an empty list
    // is a query that can only return nothing.
    if (ids.length === 0) return { messages: [], notes: [], tasks: [], events: [], contacts: [] };

    const [messages, notes, tasks, events] = await Promise.all([
      emails.length
        ? supabaseAdmin
            .from('inbox_messages')
            .select('id, subject, from_email, to_email, direction, received_at, body_text')
            .eq('user_id', userId)
            .or(
              `from_email.in.(${emails.map(quoteForOr).join(',')}),to_email.in.(${emails
                .map(quoteForOr)
                .join(',')})`
            )
            .order('received_at', { ascending: false })
            .limit(100)
        : Promise.resolve({ data: [], error: null } as any),
      supabaseAdmin
        .from('crm_notes')
        .select('*')
        .eq('user_id', userId)
        .in('contact_id', ids)
        .order('created_at', { ascending: false })
        .limit(100),
      supabaseAdmin
        .from('crm_tasks')
        .select('*')
        .eq('user_id', userId)
        .in('contact_id', ids)
        .order('due_date', { ascending: true })
        .limit(100),
      supabaseAdmin
        .from('crm_events')
        .select('*')
        .eq('user_id', userId)
        .in('contact_id', ids)
        .order('starts_at', { ascending: false })
        .limit(100),
    ]);

    // crm_notes arrives with migration 037; an account that hasn't run it
    // should still see its emails rather than a 500.
    const rows = (r: any) => {
      if (r?.error) {
        console.error('companies.activity query failed:', r.error.message);
        return [];
      }
      return r?.data || [];
    };

    // The message rows only have from_email/to_email — the "who" is whichever
    // side isn't this company's own mailbox.
    const messageRows = rows(messages).map((m: any) => ({
      ...m,
      contact_email: (m.direction === 'outbound' ? m.to_email : m.from_email) || null,
    }));

    return {
      contacts,
      messages: messageRows,
      notes: rows(notes),
      tasks: rows(tasks),
      events: rows(events),
    };
  },

  /**
   * Create, or return the existing company when the name normalises to one
   * already there. Callers get a company either way, which is what makes
   * "link this contact to its company" safe to call blindly.
   */
  async createOrGet(userId: string, input: any) {
    const name = String(input?.name || '').trim();
    if (!name) throw new AppError('Company name is required', 400);

    const payload = { ...pick(input, COMPANY_KEYS), name, user_id: userId };
    const { data, error } = await supabaseAdmin
      .from('companies')
      .insert(payload)
      .select()
      .single();

    if (!error) return data;

    // 23505 = the unique index on (user_id, normalized_name) fired, meaning
    // this company already exists under a different spelling.
    if (error.code === '23505') {
      // Ask the database for the same normalised form it just rejected us on,
      // rather than reimplementing the rule here and risking drift.
      const { data: norm } = await supabaseAdmin.rpc('normalize_company_name', { raw: name });
      const { data: existing } = await supabaseAdmin
        .from('companies')
        .select('*')
        .eq('user_id', userId)
        .eq('normalized_name', norm as unknown as string)
        .maybeSingle();
      if (existing) return existing;
    }
    assertCompaniesTable(error);
    throw new AppError(error.message, 500);
  },

  async update(userId: string, id: string, input: any) {
    const payload = pick(input, COMPANY_KEYS);
    if (payload.name !== undefined && !String(payload.name).trim()) {
      throw new AppError('Company name is required', 400);
    }
    const { data, error } = await supabaseAdmin
      .from('companies')
      .update(payload)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === '23505') throw new AppError('Another company already uses that name', 409);
      assertCompaniesTable(error);
      throw new AppError(error.message, 500);
    }
    if (!data) throw new AppError('Company not found', 404);
    return data;
  },

  /** Deleting a company never deletes its people or deals — the FK nulls out. */
  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('companies').delete().eq('id', id).eq('user_id', userId);
    if (error) { assertCompaniesTable(error); throw new AppError(error.message, 500); }
  },

  /** Attach a contact to a company (creating it by name when needed). */
  async linkContact(userId: string, contactId: string, companyId: string | null) {
    if (companyId) await assertCompanyOwned(userId, companyId);
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .update({ company_id: companyId })
      .eq('id', contactId)
      .eq('user_id', userId)
      .select('id, company_id')
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Contact not found', 404);
    return data;
  },
};

import { supabaseAdmin } from '../config/supabase.js';
import type { SearchHit, SearchResults } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Universal search.

   Every object type is queried in parallel and capped, so the whole thing
   costs about one round-trip regardless of how many kinds of record exist.
   A slow or broken table degrades to "no hits of that kind" rather than
   failing the search — a palette that returns nothing because templates
   404'd would be worse than one missing a group.
   ═══════════════════════════════════════════════════════════════════════ */

const PER_TYPE = 5;

/** Strip characters that would otherwise break out of an ilike/or filter. */
function safe(term: string): string {
  return term.replace(/[%_,()\\]/g, '').trim();
}

/** Never let one bad table sink the whole palette. */
async function attempt<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err: any) {
    console.warn(`[Search] ${label} failed: ${err?.message || err}`);
    return [];
  }
}

function fullName(first?: string | null, last?: string | null, fallback = ''): string {
  return [first, last].filter(Boolean).join(' ') || fallback;
}

function shortDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const searchService = {
  async search(userId: string, rawQuery: string): Promise<SearchResults> {
    const started = Date.now();
    const q = safe(String(rawQuery || ''));
    if (q.length < 2) return { hits: [], took_ms: 0 };
    const like = `%${q}%`;

    const [contacts, companies, deals, campaigns, lists, activities, meetings, templates, messages] = await Promise.all([
      attempt('contacts', async () => {
        const { data, error } = await supabaseAdmin
          .from('contacts')
          .select('id, email, first_name, last_name, company, job_title')
          .eq('user_id', userId)
          .or(`email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},company.ilike.${like}`)
          .limit(PER_TYPE);
        if (error) throw new Error(error.message);
        return (data || []) as any[];
      }),
      attempt('companies', async () => {
        const { data, error } = await supabaseAdmin
          .from('companies')
          .select('id, name, domain, industry, location')
          .eq('user_id', userId)
          .or(`name.ilike.${like},domain.ilike.${like},industry.ilike.${like}`)
          .limit(PER_TYPE);
        if (error) throw new Error(error.message);
        return (data || []) as any[];
      }),
      attempt('deals', async () => {
        const { data, error } = await supabaseAdmin
          .from('deals')
          .select('id, title, company, stage, value, currency, contact_name')
          .eq('user_id', userId)
          .or(`title.ilike.${like},company.ilike.${like},contact_name.ilike.${like}`)
          .limit(PER_TYPE);
        if (error) throw new Error(error.message);
        return (data || []) as any[];
      }),
      attempt('campaigns', async () => {
        const { data, error } = await supabaseAdmin
          .from('campaigns')
          .select('id, name, status')
          .eq('user_id', userId)
          .ilike('name', like)
          .limit(PER_TYPE);
        if (error) throw new Error(error.message);
        return (data || []) as any[];
      }),
      attempt('lists', async () => {
        const { data, error } = await supabaseAdmin
          .from('contact_lists')
          .select('id, name, description')
          .eq('user_id', userId)
          .ilike('name', like)
          .limit(PER_TYPE);
        if (error) throw new Error(error.message);
        return (data || []) as any[];
      }),
      attempt('activities', async () => {
        const { data, error } = await supabaseAdmin
          .from('crm_tasks')
          .select('id, title, due_date, is_done, type, contact_id')
          .eq('user_id', userId)
          .ilike('title', like)
          .order('is_done', { ascending: true })
          .limit(PER_TYPE);
        if (error) throw new Error(error.message);
        return (data || []) as any[];
      }),
      attempt('meetings', async () => {
        const { data, error } = await supabaseAdmin
          .from('crm_events')
          .select('id, title, starts_at, location, contact_id')
          .eq('user_id', userId)
          .ilike('title', like)
          .order('starts_at', { ascending: false })
          .limit(PER_TYPE);
        if (error) throw new Error(error.message);
        return (data || []) as any[];
      }),
      attempt('templates', async () => {
        const { data, error } = await supabaseAdmin
          .from('email_templates')
          .select('id, name, subject')
          .eq('user_id', userId)
          .or(`name.ilike.${like},subject.ilike.${like}`)
          .limit(PER_TYPE);
        if (error) throw new Error(error.message);
        return (data || []) as any[];
      }),
      attempt('messages', async () => {
        const { data, error } = await supabaseAdmin
          .from('inbox_messages')
          .select('id, subject, from_email, received_at, direction')
          .eq('user_id', userId)
          .or(`subject.ilike.${like},from_email.ilike.${like}`)
          .order('received_at', { ascending: false })
          .limit(PER_TYPE);
        if (error) throw new Error(error.message);
        return (data || []) as any[];
      }),
    ]);

    const hits: SearchHit[] = [];

    for (const c of contacts) {
      hits.push({
        id: c.id,
        type: 'contact',
        title: fullName(c.first_name, c.last_name, c.email),
        subtitle: c.email,
        meta: [c.job_title, c.company].filter(Boolean).join(' · ') || null,
        href: `/contacts/${c.id}`,
      });
    }

    for (const co of companies) {
      hits.push({
        id: co.id,
        type: 'company',
        title: co.name,
        subtitle: co.domain || null,
        meta: [co.industry, co.location].filter(Boolean).join(' · ') || null,
        href: `/companies?peek=company:${co.id}`,
      });
    }

    for (const d of deals) {
      const value = Number(d.value) || 0;
      hits.push({
        id: d.id,
        type: 'deal',
        title: d.title,
        subtitle: [d.company, d.contact_name].filter(Boolean).join(' · ') || null,
        meta: value > 0
          ? `${value.toLocaleString('en-US', { style: 'currency', currency: d.currency || 'USD', maximumFractionDigits: 0 })} · ${d.stage}`
          : d.stage,
        href: `/deals?deal=${d.id}`,
      });
    }

    for (const c of campaigns) {
      hits.push({ id: c.id, type: 'campaign', title: c.name, subtitle: c.status, meta: null, href: `/campaigns/${c.id}` });
    }

    for (const l of lists) {
      hits.push({ id: l.id, type: 'list', title: l.name, subtitle: l.description || null, meta: null, href: `/contacts?list=${l.id}` });
    }

    for (const t of activities) {
      hits.push({
        id: t.id,
        type: 'activity',
        title: t.title,
        subtitle: t.is_done ? 'Completed' : (shortDate(t.due_date) ? `Due ${shortDate(t.due_date)}` : 'No date'),
        meta: String(t.type || 'todo').replace('_', ' '),
        href: t.contact_id ? `/contacts/${t.contact_id}` : '/tasks',
      });
    }

    for (const e of meetings) {
      hits.push({
        id: e.id,
        type: 'meeting',
        title: e.title,
        subtitle: shortDate(e.starts_at),
        meta: e.location || null,
        href: e.contact_id ? `/contacts/${e.contact_id}` : '/calendar',
      });
    }

    for (const t of templates) {
      hits.push({ id: t.id, type: 'template', title: t.name, subtitle: t.subject || null, meta: null, href: `/templates` });
    }

    for (const m of messages) {
      hits.push({
        id: m.id,
        type: 'message',
        title: m.subject || '(no subject)',
        subtitle: m.from_email,
        meta: shortDate(m.received_at),
        href: `/inbox?message=${m.id}`,
      });
    }

    return { hits, took_ms: Date.now() - started };
  },
};

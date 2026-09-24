/* ═══════════════════════════════════════════════════════════════════════
   What to know before the call, on one card.

   Ten minutes before a meeting nobody has time to open the contact, the
   company, the deal and the inbox in four tabs. The brief gathers the lot:
   who they are, where the deal stands and how healthy it is, what was said
   by email (objections first, because those are what the call has to
   answer), how the last meetings went, and what is still open.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { crmService } from './crm.service.js';
import { healthForDeals } from './deal-health.service.js';
import type { MeetingBrief } from '@lemlist/shared';

function snippet(text: string | null | undefined, n = 280): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
}

export async function meetingBrief(userId: string, eventId: string): Promise<MeetingBrief> {
  const { data: event, error } = await supabaseAdmin
    .from('crm_events')
    .select('id, title, starts_at, ends_at, contact_id, contact_name, contact_email, deal_id, conferencing_url, location, notes, outcome')
    .eq('id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!event) throw new AppError('Meeting not found', 404);

  // Who: by id first, then by the address on the invite.
  let contact: any = null;
  if (event.contact_id) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('id, email, first_name, last_name, company, company_id, job_title, linkedin_url, phone')
      .eq('id', event.contact_id).eq('user_id', userId).maybeSingle();
    contact = data;
  }
  if (!contact && event.contact_email) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('id, email, first_name, last_name, company, company_id, job_title, linkedin_url, phone')
      .eq('user_id', userId).eq('email', String(event.contact_email).trim().toLowerCase())
      .limit(1).maybeSingle();
    contact = data;
  }
  const email = String(contact?.email || event.contact_email || '').toLowerCase() || null;

  // The deal: the one the meeting is booked against, else their open one.
  let deal: any = null;
  if (event.deal_id) {
    const { data } = await supabaseAdmin.from('deals')
      .select('id, title, stage, value, currency, expected_close_date, notes')
      .eq('id', event.deal_id).eq('user_id', userId).maybeSingle();
    deal = data;
  }
  if (!deal && (contact?.id || email)) {
    let q = supabaseAdmin.from('deals')
      .select('id, title, stage, value, currency, expected_close_date, notes')
      .eq('user_id', userId).in('stage', ['lead', 'qualified', 'proposal']);
    q = contact?.id ? q.eq('contact_id', contact.id) : q.eq('contact_email', email!);
    const { data } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    deal = data;
  }
  const health = deal ? (await healthForDeals(userId, [deal.id]).catch(() => ({} as Record<string, any>)))[deal.id] || null : null;

  // The email: newest first, objections pulled out on their own.
  const mail = email ? await crmService.emailsForAddresses(userId, [email], 30).catch(() => []) : [];
  const ids = mail.map((m: any) => m.id);
  const intents = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data } = await supabaseAdmin.from('inbox_messages').select('id, sara_intent').in('id', ids).eq('user_id', userId);
    for (const r of data || []) intents.set(r.id, r.sara_intent);
  }
  const emails = mail.slice(0, 6).map((m: any) => ({
    direction: (m.direction === 'outbound' || String(m.from_email || '').toLowerCase() !== email ? 'outbound' : 'inbound') as 'inbound' | 'outbound',
    subject: m.subject,
    snippet: snippet(m.body_text),
    at: m.received_at,
    intent: intents.get(m.id) || null,
  }));
  const objections = mail
    .filter((m: any) => intents.get(m.id) === 'objection')
    .slice(0, 3)
    .map((m: any) => ({ snippet: snippet(m.body_text, 400), at: m.received_at }));

  // Earlier meetings with them, and how they went.
  let previous: MeetingBrief['previous_meetings'] = [];
  if (contact?.id || email) {
    let q = supabaseAdmin.from('crm_events').select('id, title, starts_at, outcome')
      .eq('user_id', userId).lt('starts_at', event.starts_at).neq('id', event.id);
    q = contact?.id ? q.or(`contact_id.eq.${contact.id}${email ? `,contact_email.eq."${email.replace(/"/g, '')}"` : ''}`) : q.eq('contact_email', email!);
    const { data } = await q.order('starts_at', { ascending: false }).limit(3);
    previous = (data || []).map((e: any) => ({ title: e.title, at: e.starts_at, outcome: e.outcome }));
  }

  // What is still open with them.
  let tasks: MeetingBrief['open_tasks'] = [];
  if (deal?.id) {
    const { data } = await supabaseAdmin.from('crm_tasks').select('title, due_date')
      .eq('user_id', userId).eq('deal_id', deal.id).eq('is_done', false)
      .order('due_date', { ascending: true }).limit(5);
    tasks = (data || []).map((t: any) => ({ title: t.title, due_date: t.due_date }));
  }

  return {
    event: {
      id: event.id,
      title: event.title,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      conferencing_url: event.conferencing_url,
      location: event.location,
      notes: event.notes,
      outcome: event.outcome,
    },
    person: contact || email ? {
      contact_id: contact?.id || null,
      name: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || event.contact_name || null,
      email,
      job_title: contact?.job_title || null,
      company: contact?.company || null,
      company_id: contact?.company_id || null,
      linkedin_url: contact?.linkedin_url || null,
    } : null,
    deal: deal ? {
      id: deal.id,
      title: deal.title,
      stage: deal.stage,
      value: Number(deal.value) || 0,
      currency: deal.currency || 'USD',
      expected_close_date: deal.expected_close_date,
      health,
    } : null,
    emails,
    objections,
    previous_meetings: previous,
    open_tasks: tasks,
  };
}

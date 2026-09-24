/* ═══════════════════════════════════════════════════════════════════════
   Gathers what the deal-health score reads, for every open deal at once.

   Four questions per deal, answered in bulk rather than per card so the
   board costs a handful of queries however many deals it shows:
     - who is on it (primary contact + participants, with roles)
     - the email back and forth with those people
     - the next meeting booked against it
     - tasks against it that are already overdue
   The scoring itself lives in @lemlist/shared (deal-health.ts), pure.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { scoreDeal, OPEN_STAGES, type DealHealth, type DealSignals } from '@lemlist/shared';
import { chunk } from '../utils/batch.js';

/** How far back the email read goes. Older than this says nothing about now. */
const WINDOW_DAYS = 120;
/** Open deals scored per call. A board with more than this is paged anyway. */
const MAX_DEALS = 500;

/** What can sit in a PostgREST in-list unquoted. `_` and `%` are fine there: it is not a LIKE. */
const ENCODABLE = /^[^\s,()"'\\]+@[^\s,()"'\\]+$/;

interface Mail { from_email: string | null; to_email: string | null; direction: string | null; received_at: string; auto_reply_kind?: string | null }

/** Hours they took to answer each of our emails, oldest first. */
export function responseHours(mail: Mail[], addresses: Set<string>): number[] {
  const sorted = [...mail].sort((a, b) => a.received_at.localeCompare(b.received_at));
  const out: number[] = [];
  let pendingOut: number | null = null;
  for (const m of sorted) {
    const t = new Date(m.received_at).getTime();
    const inbound = m.direction === 'inbound' || addresses.has(String(m.from_email || '').toLowerCase());
    if (!inbound) {
      if (pendingOut === null) pendingOut = t;
    } else if (pendingOut !== null) {
      out.push((t - pendingOut) / 3_600_000);
      pendingOut = null;
    }
  }
  return out;
}

export async function healthForDeals(userId: string, dealIds?: string[]): Promise<Record<string, DealHealth>> {
  let q = supabaseAdmin
    .from('deals')
    .select('id, stage, created_at, stage_changed_at, expected_close_date, contact_id, contact_email, contact:contacts(email)')
    .eq('user_id', userId)
    .in('stage', OPEN_STAGES);
  if (dealIds && dealIds.length > 0) q = q.in('id', dealIds.slice(0, 200));
  const { data: deals, error } = await q.order('updated_at', { ascending: false }).limit(MAX_DEALS);
  if (error) throw new AppError(error.message, 500);
  if (!deals || deals.length === 0) return {};

  const ids = deals.map((d: any) => d.id as string);
  const people = new Map<string, Set<string>>();
  const roles = new Map<string, string[]>();
  for (const d of deals as any[]) {
    const set = new Set<string>();
    for (const e of [d.contact_email, d.contact?.email]) {
      if (e) set.add(String(e).trim().toLowerCase());
    }
    people.set(d.id, set);
    roles.set(d.id, []);
  }

  const participants = await Promise.all(chunk(ids).map(async (slice) => {
    const { data, error: pErr } = await supabaseAdmin
      .from('deal_participants')
      .select('deal_id, role, contact:contacts(email)')
      .eq('user_id', userId)
      .in('deal_id', slice);
    if (pErr) throw new AppError(pErr.message, 500);
    return data || [];
  }));
  for (const p of participants.flat() as any[]) {
    if (p.contact?.email) people.get(p.deal_id)?.add(String(p.contact.email).trim().toLowerCase());
    if (p.role) roles.get(p.deal_id)?.push(String(p.role));
  }

  // Every address on every deal, read in one sweep of the window.
  const addressToDeals = new Map<string, string[]>();
  for (const [dealId, set] of people) {
    for (const a of set) {
      if (!ENCODABLE.test(a)) continue;
      addressToDeals.set(a, [...(addressToDeals.get(a) || []), dealId]);
    }
  }
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const mailByDeal = new Map<string, Mail[]>();
  for (const slice of chunk([...addressToDeals.keys()], 60)) {
    const list = `(${slice.join(',')})`;
    const { data, error: mErr } = await supabaseAdmin
      .from('inbox_messages')
      .select('from_email, to_email, direction, received_at, auto_reply_kind')
      .eq('user_id', userId)
      .gte('received_at', since)
      .or(`from_email.in.${list},to_email.in.${list}`)
      .order('received_at', { ascending: false })
      .limit(2000);
    if (mErr) throw new AppError(mErr.message, 500);
    for (const m of (data || []) as Mail[]) {
      // An out-of-office is not the buyer writing back. Counted, it would
      // flag the deal "waiting on you" over a robot.
      if (m.auto_reply_kind) continue;
      const touched = new Set<string>();
      for (const a of [m.from_email, m.to_email]) {
        for (const dealId of addressToDeals.get(String(a || '').toLowerCase()) || []) touched.add(dealId);
      }
      for (const dealId of touched) mailByDeal.set(dealId, [...(mailByDeal.get(dealId) || []), m]);
    }
  }

  const nowIso = new Date().toISOString();
  const nextMeeting = new Map<string, string>();
  const overdue = new Map<string, number>();
  await Promise.all(chunk(ids).map(async (slice) => {
    const [ev, tk] = await Promise.all([
      supabaseAdmin.from('crm_events').select('deal_id, starts_at')
        .eq('user_id', userId).in('deal_id', slice).gte('starts_at', nowIso)
        .order('starts_at', { ascending: true }),
      supabaseAdmin.from('crm_tasks').select('deal_id')
        .eq('user_id', userId).in('deal_id', slice).eq('is_done', false).lt('due_date', nowIso),
    ]);
    if (ev.error) throw new AppError(ev.error.message, 500);
    if (tk.error) throw new AppError(tk.error.message, 500);
    for (const e of ev.data || []) if (e.deal_id && !nextMeeting.has(e.deal_id)) nextMeeting.set(e.deal_id, e.starts_at);
    for (const t of tk.data || []) if (t.deal_id) overdue.set(t.deal_id, (overdue.get(t.deal_id) || 0) + 1);
  }));

  const out: Record<string, DealHealth> = {};
  for (const d of deals as any[]) {
    const addrs = people.get(d.id) || new Set<string>();
    const mail = mailByDeal.get(d.id) || [];
    let lastIn: string | null = null;
    let lastOut: string | null = null;
    const engaged = new Set<string>();
    for (const m of mail) {
      const from = String(m.from_email || '').toLowerCase();
      const inbound = m.direction === 'inbound' || addrs.has(from);
      if (inbound) {
        engaged.add(from);
        if (!lastIn || m.received_at > lastIn) lastIn = m.received_at;
      } else if (!lastOut || m.received_at > lastOut) {
        lastOut = m.received_at;
      }
    }
    const dealRoles = roles.get(d.id) || [];
    const signals: DealSignals = {
      stage: d.stage,
      created_at: d.created_at,
      stage_changed_at: d.stage_changed_at,
      expected_close_date: d.expected_close_date,
      last_inbound_at: lastIn,
      last_outbound_at: lastOut,
      response_hours: responseHours(mail, addrs),
      engaged_people: engaged.size,
      people: addrs.size,
      has_decision_maker: dealRoles.some((r) => /decision/i.test(r)),
      roles_recorded: dealRoles.length > 0,
      next_meeting_at: nextMeeting.get(d.id) || null,
      overdue_tasks: overdue.get(d.id) || 0,
    };
    out[d.id] = scoreDeal(signals);
  }
  return out;
}

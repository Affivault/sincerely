/* ═══════════════════════════════════════════════════════════════════════
   Flow: one ranked queue of everything that needs a decision today.

   Built from the services that already know each piece - the reply queue
   (who is waiting on an answer), deal health (which deals are going
   quiet), the calendar (what is coming up, what just ended) and tasks
   (what is due) - so the ordering rules stay where they were written and
   Flow only decides which comes first. See shared/flow.types.ts.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  meetingRank, replyRank, dealRank, taskRank, sortFlow, startOfDayInTimezone,
  type FlowItem, type FlowSummary, type FlowKind,
} from '@lemlist/shared';
import { replyQueueService } from './reply-queue.service.js';
import { healthForDeals } from './deal-health.service.js';
import { settingsService } from './settings.service.js';
import { chunk } from '../utils/batch.js';

/** Enough to clear in a sitting; anything below is tomorrow's problem. */
const MAX_ITEMS = 60;
/** Deal actions Flow will surface. The rest are shown on the deal itself. */
const DEAL_ACTIONS = new Set(['reply', 'follow_up', 'book_meeting', 'update_close_date', 'add_stakeholder']);

function snippet(text: string | null | undefined): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 220 ? `${t.slice(0, 217)}...` : t;
}

function fullName(c: any): string | null {
  const n = [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim();
  return n || null;
}

export async function buildFlow(userId: string): Promise<FlowSummary> {
  const now = Date.now();
  let tz = 'UTC';
  try { tz = (await settingsService.get(userId)).timezone || 'UTC'; } catch { /* default */ }
  const dayStart = startOfDayInTimezone(tz);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const items: FlowItem[] = [];

  // Each source is isolated: one failing must not blank the whole queue.
  const [replies, health, events, tasks] = await Promise.all([
    replyQueueService.queue(userId).catch((e) => { console.error('[Flow] replies:', e?.message); return null; }),
    healthForDeals(userId).catch((e) => { console.error('[Flow] deal health:', e?.message); return {} as Awaited<ReturnType<typeof healthForDeals>>; }),
    supabaseAdmin.from('crm_events')
      .select('id, title, starts_at, ends_at, contact_id, contact_name, contact_email, deal_id, conferencing_url, location, outcome, status')
      .eq('user_id', userId)
      // Yesterday's too: a meeting that ended last night still wants its outcome.
      .gte('starts_at', new Date(dayStart.getTime() - 86_400_000).toISOString())
      .lt('starts_at', dayEnd.toISOString())
      .order('starts_at', { ascending: true }),
    supabaseAdmin.from('crm_tasks')
      .select('id, title, due_date, priority, deal_id, contact_name')
      .eq('user_id', userId)
      .eq('is_done', false)
      .lt('due_date', dayEnd.toISOString())
      .order('due_date', { ascending: true })
      .limit(100),
  ]);

  /* ─── Replies ─────────────────────────────────────────────────────── */
  const replyContacts = new Set<string>();
  const replyEmails = new Set<string>();
  if (replies) {
    const top = replies.items.slice(0, 40);
    const ids = top.map((r: any) => r.id as string);
    const drafts = new Map<string, any>();
    for (const slice of chunk(ids)) {
      const { data } = await supabaseAdmin
        .from('inbox_messages')
        .select('id, sara_draft_reply, sara_status, contacts(first_name, last_name, company)')
        .eq('user_id', userId)
        .in('id', slice);
      for (const d of data || []) drafts.set(d.id, d);
    }
    for (const r of top as any[]) {
      const extra = drafts.get(r.id);
      if (r.contact_id) replyContacts.add(r.contact_id);
      if (r.from_email) replyEmails.add(String(r.from_email).toLowerCase());
      const draft = extra?.sara_status === 'pending_review' ? extra?.sara_draft_reply || null : null;
      items.push({
        key: `reply:${r.id}`,
        kind: 'reply',
        rank: replyRank(r.state.urgency, r.sara_intent, r.deal_value),
        why: r.state.urgency === 'overdue' ? 'Waiting too long for an answer'
          : r.sara_intent === 'meeting' ? 'Wants to meet'
            : r.sara_intent === 'interested' ? 'Interested' : 'Waiting on your reply',
        reply: {
          message_id: r.id,
          from_email: r.from_email,
          contact_id: r.contact_id,
          contact_name: fullName(extra?.contacts),
          company: extra?.contacts?.company || null,
          subject: r.subject,
          snippet: snippet(r.body_text),
          intent: r.sara_intent,
          urgency: r.state.urgency,
          waited_ms: r.state.waitedMs,
          draft,
          deal_value: r.deal_value,
        },
      });
    }
  }

  /* ─── Deals going quiet ───────────────────────────────────────────── */
  const dealIds = Object.entries(health)
    .filter(([, h]) => h.grade !== 'healthy' && DEAL_ACTIONS.has(h.next_action))
    .map(([id]) => id);
  if (dealIds.length > 0) {
    const rows: any[] = [];
    for (const slice of chunk(dealIds)) {
      const { data, error } = await supabaseAdmin
        .from('deals')
        .select('id, title, company, value, currency, stage, contact_id, contact_email, contact_name')
        .eq('user_id', userId)
        .in('id', slice);
      if (error) throw new AppError(error.message, 500);
      rows.push(...(data || []));
    }
    for (const d of rows) {
      const h = health[d.id];
      // Already in the queue as a reply: answering it is the deal action.
      if (h.next_action === 'reply' && ((d.contact_id && replyContacts.has(d.contact_id))
        || (d.contact_email && replyEmails.has(String(d.contact_email).toLowerCase())))) continue;
      items.push({
        key: `deal:${d.id}`,
        kind: 'deal',
        rank: dealRank(h),
        why: h.reasons.find((x) => x.impact < 0)?.text || h.summary,
        deal: {
          deal_id: d.id,
          title: d.title,
          company: d.company,
          value: Number(d.value) || 0,
          currency: d.currency || 'USD',
          stage: d.stage,
          contact_email: d.contact_email,
          contact_name: d.contact_name,
          health: h,
        },
      });
    }
  }

  /* ─── Meetings ────────────────────────────────────────────────────── */
  if (events.error) console.error('[Flow] events:', events.error.message);
  for (const e of (events.data || []) as any[]) {
    if (e.status === 'cancelled') continue;
    const end = new Date(e.ends_at || e.starts_at).getTime() + (e.ends_at ? 0 : 30 * 60_000);
    const ended = end < now;
    const needsOutcome = ended && !e.outcome;
    // Finished and written up, or earlier than today and already handled.
    if (ended && !needsOutcome) continue;
    if (!ended && new Date(e.starts_at).getTime() < dayStart.getTime()) continue;
    items.push({
      key: `meeting:${e.id}`,
      kind: 'meeting',
      rank: meetingRank(e.starts_at, now, needsOutcome),
      why: needsOutcome ? 'How did it go?' : 'Coming up',
      meeting: {
        event_id: e.id,
        title: e.title,
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        contact_id: e.contact_id,
        contact_email: e.contact_email,
        contact_name: e.contact_name,
        deal_id: e.deal_id,
        conferencing_url: e.conferencing_url,
        location: e.location,
        needs_outcome: needsOutcome,
      },
    });
  }

  /* ─── Tasks ───────────────────────────────────────────────────────── */
  if (tasks.error) console.error('[Flow] tasks:', tasks.error.message);
  for (const t of (tasks.data || []) as any[]) {
    const overdue = !!t.due_date && new Date(t.due_date).getTime() < dayStart.getTime();
    items.push({
      key: `task:${t.id}`,
      kind: 'task',
      rank: taskRank(overdue, t.priority),
      why: overdue ? 'Overdue' : 'Due today',
      task: {
        task_id: t.id,
        title: t.title,
        due_date: t.due_date,
        priority: t.priority,
        deal_id: t.deal_id,
        contact_name: t.contact_name,
        overdue,
      },
    });
  }

  const sorted = sortFlow(items).slice(0, MAX_ITEMS);
  const counts: Record<FlowKind, number> = { meeting: 0, reply: 0, deal: 0, task: 0 };
  for (const i of items) counts[i.kind]++;
  return { items: sorted, counts, generated_at: new Date(now).toISOString() };
}

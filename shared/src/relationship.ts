/* ═══════════════════════════════════════════════════════════════════════
   One person, one story.

   The contact history already merged emails, notes, calls and meetings.
   What it said about campaigns was a row per event - "Campaign email
   opened", eleven times, with no word of which email or which campaign -
   and it said nothing at all about the business: the deal that opened,
   the move to Qualified, the win. So the part of the story that matters
   most was the part you still had to piece together.

   Two things live here, both pure so the wording can be asserted:

     campaignStory   sequence events as sentences: which step, which
                     campaign, opens and clicks folded into one line each,
                     a bounce with its reason.
     whereWeAre      the answer to "where are we with this person?" in five
                     facts, for the top of the page.
   ═══════════════════════════════════════════════════════════════════════ */

import { dealStageLabel, type DealStage, type DealStageEvent } from './crm.types.js';

export interface CampaignActivityLike {
  id?: string;
  activity_type: string;
  campaign_name?: string | null;
  campaign_id?: string | null;
  step_subject?: string | null;
  step_order?: number | null;
  metadata?: Record<string, any> | null;
  occurred_at: string;
}

export interface CampaignStoryRow {
  id: string;
  type: string;
  /** The latest time it happened. */
  at: string;
  /** The first time, when it happened more than once. */
  first_at: string | null;
  count: number;
  title: string;
  detail: string | null;
}

function stepName(a: CampaignActivityLike): string {
  return typeof a.step_order === 'number' ? `Step ${a.step_order + 1}` : 'A campaign email';
}

function where(a: CampaignActivityLike): string | null {
  const parts = [a.campaign_name && a.campaign_name !== 'Unknown' ? a.campaign_name : null, a.step_subject ? `"${a.step_subject}"` : null]
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function bounceWhy(m: Record<string, any>): string | null {
  const reason = typeof m.reason === 'string' ? m.reason : null;
  const kind = m.bounce_kind;
  const via = m.source === 'notice' ? ' (from a returned-mail notice)' : '';
  if (kind === 'blocked') return `Their server refused the sender${reason ? `: ${reason}` : ''}${via}. The address itself is fine.`;
  if (reason) return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}${via}.`;
  if (typeof m.error === 'string') return m.error.slice(0, 200);
  return via ? `Undeliverable${via}.` : null;
}

/**
 * Sequence events as a story. Sends, bounces and the rest stay one row
 * each; opens and clicks of the same step fold into one row with a count,
 * because "opened it five times" is one fact, not five. Replies are left
 * out - the reply itself is already in the history, with its words.
 */
export function campaignStory(items: CampaignActivityLike[]): CampaignStoryRow[] {
  const rows: CampaignStoryRow[] = [];
  const folded = new Map<string, CampaignStoryRow>();

  for (const a of items) {
    const t = a.activity_type;
    if (t === 'replied') continue;
    const m = a.metadata || {};
    const step = stepName(a);

    if (t === 'opened' || t === 'clicked') {
      const key = `${t}:${a.campaign_id || a.campaign_name || ''}:${a.step_order ?? a.step_subject ?? ''}`;
      const existing = folded.get(key);
      if (existing) {
        existing.count++;
        if (a.occurred_at > existing.at) existing.at = a.occurred_at;
        if (!existing.first_at || a.occurred_at < existing.first_at) existing.first_at = a.occurred_at;
        existing.title = foldTitle(t, step, existing.count);
        continue;
      }
      const row: CampaignStoryRow = {
        id: `act-${a.id || `${t}-${a.occurred_at}`}`,
        type: t,
        at: a.occurred_at,
        first_at: a.occurred_at,
        count: 1,
        title: foldTitle(t, step, 1),
        detail: t === 'clicked' && typeof m.url === 'string' ? `${where(a) ?? ''}${where(a) ? ' · ' : ''}${m.url}` : where(a),
      };
      folded.set(key, row);
      rows.push(row);
      continue;
    }

    const title = t === 'sent' ? `${step} sent`
      : t === 'bounced' ? `${step} bounced`
      : t === 'unsubscribed' ? 'Unsubscribed'
      : t === 'skipped' ? `${step} skipped`
      : t === 'auto_reply' ? 'Automatic reply'
      : t === 'error' ? `${step} could not be sent`
      : `${step} ${t.replace(/_/g, ' ')}`;
    const detail = t === 'bounced' ? [bounceWhy(m), where(a)].filter(Boolean).join(' ')
      : t === 'skipped' && typeof m.reason === 'string' ? `${m.reason}${where(a) ? ` · ${where(a)}` : ''}`
      : t === 'error' && typeof m.error === 'string' ? m.error.slice(0, 200)
      : where(a);
    rows.push({
      id: `act-${a.id || `${t}-${a.occurred_at}`}`,
      type: t,
      at: a.occurred_at,
      first_at: null,
      count: 1,
      title,
      detail: detail || null,
    });
  }

  for (const r of rows) if (r.count === 1) r.first_at = null;
  return rows;
}

function foldTitle(type: 'opened' | 'clicked' | string, step: string, count: number): string {
  const verb = type === 'opened' ? 'opened' : 'clicked a link in';
  const times = count === 1 ? '' : count === 2 ? ' twice' : ` ${count} times`;
  return type === 'opened' ? `${step} ${verb}${times}` : `${capital(verb)} ${step.toLowerCase()}${times}`;
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** A deal's stage move, as a line in the person's history. */
export function stageMoveTitle(e: Pick<DealStageEvent, 'from_stage' | 'to_stage'>, dealTitle: string): string {
  if (!e.from_stage) return `Deal opened: ${dealTitle}`;
  if (e.to_stage === 'won') return `Won: ${dealTitle}`;
  if (e.to_stage === 'lost') return `Lost: ${dealTitle}`;
  if ((e.from_stage === 'won' || e.from_stage === 'lost')) return `Reopened: ${dealTitle}`;
  return `${dealTitle} moved to ${dealStageLabel(e.to_stage)}`;
}

/* ── Where we are ──────────────────────────────────────────────────── */

export interface WhereWeAreInput {
  now?: Date;
  /** Inbox messages both ways. */
  emails: Array<{ direction?: string | null; received_at: string; subject?: string | null }>;
  activity: CampaignActivityLike[];
  deals: Array<{ id: string; title: string; stage: DealStage; value?: number | null; currency?: string | null; stage_changed_at?: string | null; created_at?: string | null }>;
  tasks: Array<{ title: string; due_date?: string | null; is_done?: boolean }>;
  events: Array<{ title: string; starts_at: string; status?: string | null }>;
}

export interface WhereWeAre {
  last_touch: { at: string; by: 'you' | 'them'; what: string } | null;
  last_reply: { at: string; subject: string | null } | null;
  /** The open deal furthest along; the newest closed one when none is open. */
  deal: { id: string; title: string; stage: DealStage; value: number | null; currency: string; days_in_stage: number | null; open: boolean } | null;
  next_step: { at: string | null; what: string; kind: 'meeting' | 'task' } | null;
  started_from: { campaign: string; at: string } | null;
  /** Nobody has heard from them in this many days, when they have gone quiet after replying. */
  quiet_days: number | null;
}

const ORDER: Record<string, number> = { lead: 0, qualified: 1, proposal: 2, won: 3, lost: -1 };

export function whereWeAre(input: WhereWeAreInput): WhereWeAre {
  const now = (input.now ?? new Date()).getTime();
  const DAY = 86_400_000;

  const touches: Array<{ at: string; by: 'you' | 'them'; what: string }> = [];
  for (const m of input.emails) {
    const inbound = m.direction !== 'outbound';
    touches.push({ at: m.received_at, by: inbound ? 'them' : 'you', what: inbound ? 'replied' : 'emailed them' });
  }
  for (const a of input.activity) {
    if (a.activity_type === 'sent') touches.push({ at: a.occurred_at, by: 'you', what: `sent ${stepName(a).toLowerCase()}${a.campaign_name && a.campaign_name !== 'Unknown' ? ` of ${a.campaign_name}` : ''}` });
  }
  touches.sort((a, b) => b.at.localeCompare(a.at));
  const last_touch = touches[0] ?? null;

  const replies = input.emails.filter((m) => m.direction !== 'outbound').sort((a, b) => b.received_at.localeCompare(a.received_at));
  const last_reply = replies[0] ? { at: replies[0].received_at, subject: replies[0].subject ?? null } : null;

  const open = input.deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost')
    .sort((a, b) => (ORDER[b.stage] ?? 0) - (ORDER[a.stage] ?? 0) || (b.created_at || '').localeCompare(a.created_at || ''));
  const closed = input.deals.filter((d) => d.stage === 'won' || d.stage === 'lost')
    .sort((a, b) => (b.stage_changed_at || b.created_at || '').localeCompare(a.stage_changed_at || a.created_at || ''));
  const d = open[0] ?? closed[0] ?? null;
  const since = d ? Date.parse(d.stage_changed_at || d.created_at || '') : NaN;
  const deal = d ? {
    id: d.id, title: d.title, stage: d.stage, value: d.value ?? null, currency: d.currency || 'USD',
    days_in_stage: Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / DAY)) : null,
    open: !!open[0],
  } : null;

  const meeting = input.events
    .filter((e) => Date.parse(e.starts_at) > now && e.status !== 'cancelled')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const task = input.tasks
    .filter((t) => !t.is_done)
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))[0];
  const next_step = meeting && (!task?.due_date || meeting.starts_at <= task.due_date)
    ? { at: meeting.starts_at, what: meeting.title, kind: 'meeting' as const }
    : task ? { at: task.due_date ?? null, what: task.title, kind: 'task' as const }
      : meeting ? { at: meeting.starts_at, what: meeting.title, kind: 'meeting' as const } : null;

  const sends = input.activity.filter((a) => a.activity_type === 'sent').sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const first = sends[0];
  const started_from = first && first.campaign_name && first.campaign_name !== 'Unknown'
    ? { campaign: first.campaign_name, at: first.occurred_at } : null;

  // They answered, and since then nothing has moved either way.
  const quiet_days = last_reply && last_touch && last_touch.by === 'them' && !next_step
    ? Math.floor((now - Date.parse(last_touch.at)) / DAY)
    : null;

  return { last_touch, last_reply, deal, next_step, started_from, quiet_days: quiet_days !== null && quiet_days >= 3 ? quiet_days : null };
}

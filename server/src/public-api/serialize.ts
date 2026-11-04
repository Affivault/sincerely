/*
 * Database rows -> the public objects in @lemlist/shared public-api.ts.
 *
 * Whitelists, every one: a column added to a table later never reaches an
 * API caller until somebody decides it should, here.
 */
import { emailState, htmlToText } from '@lemlist/shared';

/** The columns and joins a contact needs to be serialised. */
export const CONTACT_SELECT = '*, contact_tags(tags(name)), list_contacts(list_id, contact_lists(is_trashed))';

const lifecycleOut = (v: unknown): 'lead' | 'contact' | 'customer' =>
  v === 'contact' || v === 'customer' ? v : 'lead';

export const lifecycleIn = (v: string): 'prospect' | 'contact' | 'customer' =>
  v === 'lead' ? 'prospect' : (v as 'contact' | 'customer');

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

export function contactOut(row: any) {
  const first = str(row.first_name);
  const last = str(row.last_name);
  const tags: string[] = (row.contact_tags || [])
    .map((ct: any) => ct?.tags?.name)
    .filter((n: unknown): n is string => typeof n === 'string')
    .sort((a: string, b: string) => a.localeCompare(b));
  const listIds: string[] = (row.list_contacts || [])
    .filter((lc: any) => lc && lc.list_id && !lc.contact_lists?.is_trashed)
    .map((lc: any) => lc.list_id);
  const custom = row.custom_fields && typeof row.custom_fields === 'object' && !Array.isArray(row.custom_fields) ? row.custom_fields : {};
  return {
    id: row.id,
    object: 'contact' as const,
    email: row.email,
    first_name: first,
    last_name: last,
    full_name: [first, last].filter(Boolean).join(' ') || null,
    job_title: str(row.job_title),
    company: str(row.company),
    phone: str(row.phone),
    linkedin_url: str(row.linkedin_url),
    website: str(row.website),
    location: str(row.location),
    city: str(row.city),
    state: str(row.state),
    country: str(row.country),
    industry: str(row.industry),
    lifecycle: lifecycleOut(row.lifecycle),
    custom_fields: custom,
    tags,
    list_ids: [...new Set(listIds)],
    email_status: emailState(row),
    unsubscribed: !!row.is_unsubscribed,
    bounced: !!row.is_bounced,
    engagement_score: typeof row.engagement_score === 'number' ? row.engagement_score : null,
    source: str(row.source) || 'manual',
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

export function listOut(row: any) {
  return {
    id: row.id,
    object: 'list' as const,
    name: row.name,
    description: str(row.description),
    kind: row.kind === 'contact' ? 'contact' : 'lead',
    contact_count: Number(row.contact_count) || 0,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

export function statsOut(s: any) {
  if (!s || s.stats_unavailable) return null;
  const n = (v: unknown) => Number(v) || 0;
  return {
    enrolled: n(s.contacts_count),
    sent: n(s.sent_count),
    opened: n(s.opened_count),
    clicked: n(s.clicked_count),
    replied: n(s.replied_count),
    bounced: n(s.bounced_count),
    unsubscribed: n(s.unsubscribed_contacts),
  };
}

export function campaignOut(row: any, stats?: any) {
  return {
    id: row.id,
    object: 'campaign' as const,
    name: row.name,
    status: row.status,
    list_id: row.list_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    ...(stats !== undefined ? { stats: statsOut(stats) } : {}),
  };
}

export function enrolmentOut(row: any) {
  return {
    object: 'enrolment' as const,
    campaign_id: row.campaign_id,
    contact_id: row.contact_id,
    email: row.contacts?.email ?? null,
    status: row.status,
    current_step: Number(row.current_step_order) || 0,
    enrolled_at: row.created_at,
    next_send_at: row.next_send_at ?? null,
    completed_at: row.completed_at ?? null,
  };
}

export function activityOut(row: any) {
  return {
    id: row.id,
    object: 'activity' as const,
    type: row.activity_type,
    contact_id: row.contact_id,
    campaign_id: row.campaign_id,
    step_id: row.step_id ?? null,
    occurred_at: row.occurred_at,
    metadata: publicMetadata(row.activity_type, row.metadata),
  };
}

/** Only the parts of an activity's metadata that mean something outside. */
function publicMetadata(type: string, m: any): Record<string, unknown> {
  if (!m || typeof m !== 'object') return {};
  const out: Record<string, unknown> = {};
  if (type === 'clicked' && typeof m.url === 'string') out.url = m.url;
  if (type === 'bounced') {
    if (typeof m.kind === 'string') out.kind = m.kind;
    if (typeof m.reason === 'string') out.reason = m.reason.slice(0, 500);
  }
  if (type === 'sent' && typeof m.subject === 'string') out.subject = m.subject;
  if (type === 'unsubscribed' && typeof m.method === 'string') out.method = m.method;
  return out;
}

export const REPLY_SELECT = 'id, contact_id, campaign_id, from_email, sender_name, subject, body_text, body_html, received_at, sara_intent, sara_confidence';

export function replyOut(row: any) {
  const text = row.body_text ? String(row.body_text) : row.body_html ? htmlToText(String(row.body_html)) : '';
  const conf = typeof row.sara_confidence === 'number' ? Math.round(row.sara_confidence * 100) / 100 : null;
  return {
    id: row.id,
    object: 'reply' as const,
    contact_id: row.contact_id ?? null,
    campaign_id: row.campaign_id ?? null,
    from_email: row.from_email,
    from_name: str(row.sender_name),
    subject: str(row.subject),
    text: text ? text.slice(0, 10_000) : null,
    received_at: row.received_at,
    intent: str(row.sara_intent),
    intent_confidence: conf,
  };
}

export function tagOut(row: any) {
  return { object: 'tag' as const, id: row.id, name: row.name, color: row.color || '#6B7280', created_at: row.created_at };
}

export function suppressionOut(row: any) {
  return { object: 'suppression' as const, email: row.email, reason: row.reason, created_at: row.created_at };
}

export function webhookOut(row: any, secret?: string) {
  return {
    id: row.id,
    object: 'webhook' as const,
    url: row.url,
    description: row.label && row.label !== 'My Webhook' ? row.label : null,
    events: Array.isArray(row.events) ? row.events : [],
    active: !!row.is_active,
    source: row.source && row.source !== 'app' ? row.source : 'api',
    ...(secret ? { secret } : {}),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
  };
}

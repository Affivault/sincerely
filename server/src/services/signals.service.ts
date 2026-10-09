/* ═══════════════════════════════════════════════════════════════════════
   Moments: who to email today, and why (shared/src/signals.ts).

   Two sources, both scoped to one account and both bounded per run:

     own data   six detectors over what the account already holds -
                activities, replies, deals, bounces. Cheap; hourly.
     websites   the home, careers and news pages of companies the account
                already has people at, read weekly. A change is judged by
                Claude against what THIS account sells, and kept only when
                the quote it cites is really on the page.

   A moment is raised once (dedupe_key), fades with age, and leaves the
   list when it is acted on or dismissed. Acting on one is one click:
   draft an email that opens with it, send it, or add the person to a
   campaign with the moment as their first line.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  comeBackDate, signalScore, isoWeek, pageText, addedText, pageFingerprint, findWatchPages, robotsAllows,
  DEFAULT_SIGNAL_TOPICS, SIGNAL_MAX_AGE_DAYS, stripDashes,
  type Signal, type SignalKind, type SignalPerson, type SignalSettings, type SignalTopic, type WatchPageKind,
} from '@lemlist/shared';
import { aiAvailable, judgePageChange, suggestSignalTopics, writeMomentEmail } from './ai.service.js';
import { settingsService } from './settings.service.js';
import { inboxService } from './inbox.service.js';
import { campaignContactsService } from './campaign-contacts.service.js';
import { safeGetText } from '../utils/safe-fetch.js';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Website pages read per account per run, and Claude judgements per run. */
const PAGES_PER_RUN = 20;
const JUDGEMENTS_PER_RUN = 10;
/** A page is read again after this long. */
const PAGE_EVERY_MS = 7 * DAY;
/** A page that keeps failing is left alone. */
const MAX_FAILURES = 5;
/** New companies given pages to watch per run. */
const DISCOVER_PER_RUN = 20;

function missingTable(error: any): boolean {
  return !!error && (error.code === '42P01' || /does not exist|schema cache/i.test(String(error.message || '')));
}

const nameOf = (c: any) => [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || null;
const person = (c: any): SignalPerson => ({ id: c.id, name: nameOf(c), email: c.email, title: c.job_title || null });

interface NewSignal {
  kind: SignalKind;
  contact_id?: string | null;
  company_id?: string | null;
  deal_id?: string | null;
  headline: string;
  detail?: string | null;
  evidence_url?: string | null;
  evidence_quote?: string | null;
  strength: 1 | 2 | 3;
  opener?: string | null;
  dedupe_key: string;
  occurred_at: string;
}

/** Raised once: a second sighting of the same moment is ignored. */
async function raise(userId: string, rows: NewSignal[]): Promise<number> {
  if (!rows.length) return 0;
  const { data, error } = await supabaseAdmin
    .from('signals')
    .upsert(rows.map((r) => ({ ...r, user_id: userId, headline: stripDashes(r.headline).slice(0, 200), detail: r.detail ? stripDashes(r.detail).slice(0, 400) : null })), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
    .select('id');
  if (error) {
    if (!missingTable(error)) console.warn('[Moments] could not save:', error.message);
    return 0;
  }
  return (data || []).length;
}

/** People the account may still email: not unsubscribed, not bounced. */
async function reachable(userId: string, ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabaseAdmin
      .from('contacts')
      .select('id, email, first_name, last_name, job_title, company, company_id, is_unsubscribed, is_bounced')
      .eq('user_id', userId)
      .in('id', ids.slice(i, i + 200));
    for (const c of data || []) out.set((c as any).id, c);
  }
  return out;
}

async function campaignIds(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from('campaigns').select('id').eq('user_id', userId).limit(2000);
  return (data || []).map((c: any) => c.id);
}

/* ── 1. What the account already knows ─────────────────────────────── */

/**
 * Someone who went quiet is reading again. A click is strong; opens are
 * weak (mail apps open on their own), so opens count only when they come
 * on two different days.
 */
async function reEngaged(userId: string, campaigns: string[], now: number): Promise<NewSignal[]> {
  if (!campaigns.length) return [];
  const since = now - 5 * DAY;
  const { data: recent } = await supabaseAdmin
    .from('campaign_activities')
    .select('contact_id, activity_type, occurred_at')
    .in('campaign_id', campaigns.slice(0, 500))
    .in('activity_type', ['clicked', 'opened'])
    .gte('occurred_at', iso(since))
    .limit(3000);
  const byContact = new Map<string, { clicks: number; days: Set<string>; first: number }>();
  for (const a of recent || []) {
    const r = a as any; const at = Date.parse(r.occurred_at);
    const e = byContact.get(r.contact_id) || { clicks: 0, days: new Set<string>(), first: at };
    if (r.activity_type === 'clicked') e.clicks++;
    else e.days.add(r.occurred_at.slice(0, 10));
    e.first = Math.min(e.first, at);
    byContact.set(r.contact_id, e);
  }
  const candidates = [...byContact.entries()].filter(([, e]) => e.clicks > 0 || e.days.size >= 2).map(([id]) => id).slice(0, 300);
  if (!candidates.length) return [];

  // Quiet before: emailed earlier, no opens, clicks or replies in the two weeks before.
  const { data: before } = await supabaseAdmin
    .from('campaign_activities')
    .select('contact_id, activity_type, occurred_at')
    .in('contact_id', candidates)
    .in('activity_type', ['sent', 'opened', 'clicked', 'replied'])
    .gte('occurred_at', iso(now - 120 * DAY))
    .lt('occurred_at', iso(since))
    .limit(5000);
  const lastTouch = new Map<string, number>(); const lastSent = new Map<string, number>();
  for (const a of before || []) {
    const r = a as any; const at = Date.parse(r.occurred_at);
    if (r.activity_type === 'sent') lastSent.set(r.contact_id, Math.max(lastSent.get(r.contact_id) || 0, at));
    else lastTouch.set(r.contact_id, Math.max(lastTouch.get(r.contact_id) || 0, at));
  }
  const { data: replies } = await supabaseAdmin
    .from('inbox_messages').select('contact_id')
    .eq('user_id', userId).in('contact_id', candidates).neq('direction', 'outbound')
    .gte('received_at', iso(now - 30 * DAY));
  const repliedLately = new Set((replies || []).map((r: any) => r.contact_id));
  const people = await reachable(userId, candidates);

  const out: NewSignal[] = [];
  for (const id of candidates) {
    const c = people.get(id); const e = byContact.get(id)!;
    if (!c || c.is_unsubscribed || c.is_bounced || repliedLately.has(id) || !lastSent.has(id)) continue;
    const quietSince = Math.max(lastTouch.get(id) || 0, lastSent.get(id) || 0);
    const quietDays = Math.floor((e.first - quietSince) / DAY);
    if (quietDays < 14) continue;
    const weeks = Math.max(2, Math.round(quietDays / 7));
    out.push({
      kind: 're_engaged',
      contact_id: id,
      company_id: c.company_id || null,
      headline: e.clicks > 0
        ? `${nameOf(c) || c.email} clicked through your email after ${weeks} weeks quiet`
        : `${nameOf(c) || c.email} opened your emails on ${e.days.size} days this week after ${weeks} weeks quiet`,
      detail: 'Coming back to an old email usually means the problem is live again. A short, direct note now lands better than the next scheduled step.',
      strength: e.clicks > 0 ? 3 : 1,
      dedupe_key: `re_engaged:${id}:${isoWeek(now)}`,
      occurred_at: iso(e.first),
    });
  }
  return out;
}

/** A "not now" whose time has come, with nothing said since. */
async function notNowDue(userId: string, now: number): Promise<NewSignal[]> {
  const { data } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, contact_id, body_text, received_at, relay_summary')
    .eq('user_id', userId).eq('sara_intent', 'not_now').neq('direction', 'outbound')
    .not('contact_id', 'is', null)
    .gte('received_at', iso(now - 400 * DAY)).lte('received_at', iso(now - 7 * DAY))
    .order('received_at', { ascending: false })
    .limit(500);
  const due = (data || []).map((m: any) => ({ m, back: comeBackDate(m.body_text || '', m.received_at) }))
    .filter(({ back }) => { const t = Date.parse(back.due); return t <= now && t >= now - 30 * DAY; });
  if (!due.length) return [];
  const ids = [...new Set(due.map(({ m }) => m.contact_id))];
  const { data: later } = await supabaseAdmin
    .from('inbox_messages').select('contact_id, received_at')
    .eq('user_id', userId).in('contact_id', ids)
    .gte('received_at', iso(now - 400 * DAY));
  const people = await reachable(userId, ids);
  const out: NewSignal[] = [];
  const seen = new Set<string>();
  for (const { m, back } of due) {
    if (seen.has(m.contact_id)) continue;
    seen.add(m.contact_id);
    const c = people.get(m.contact_id);
    if (!c || c.is_unsubscribed || c.is_bounced) continue;
    // Anything said since, in either direction, and the moment has passed.
    if ((later || []).some((l: any) => l.contact_id === m.contact_id && Date.parse(l.received_at) > Date.parse(m.received_at))) continue;
    const when = new Date(m.received_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    out.push({
      kind: 'not_now_due',
      contact_id: m.contact_id,
      company_id: c.company_id || null,
      headline: back.phrase
        ? `${nameOf(c) || c.email} said "not now" on ${when} and asked to talk ${back.phrase}`
        : `${nameOf(c) || c.email} said "not now" on ${when}, about three months ago`,
      detail: 'That time is here, and nothing has been said since. Picking it up as promised is the easiest reply you will get all week.',
      evidence_quote: (m.relay_summary || '').slice(0, 200) || null,
      strength: 3,
      dedupe_key: `not_now:${m.id}`,
      occurred_at: iso(Date.parse(back.due)),
    });
  }
  return out;
}

/** A lost deal, three months on: the reason it was lost may be gone. */
async function lostDealsReturn(userId: string, now: number): Promise<NewSignal[]> {
  const { data } = await supabaseAdmin
    .from('deals')
    .select('id, title, contact_id, company_id, outcome_reason, closed_at')
    .eq('user_id', userId).eq('stage', 'lost')
    .gte('closed_at', iso(now - 104 * DAY)).lte('closed_at', iso(now - 90 * DAY))
    .limit(200);
  const ids = (data || []).map((d: any) => d.contact_id).filter(Boolean);
  const people = await reachable(userId, ids);
  return (data || []).flatMap((d: any) => {
    const c = d.contact_id ? people.get(d.contact_id) : null;
    if (c && (c.is_unsubscribed || c.is_bounced)) return [];
    return [{
      kind: 'lost_deal_return' as const,
      contact_id: d.contact_id || null,
      company_id: d.company_id || c?.company_id || null,
      deal_id: d.id,
      headline: `"${d.title}" was lost three months ago`,
      detail: d.outcome_reason
        ? `It was lost on: ${String(d.outcome_reason).slice(0, 160)}. Three months is long enough for that to have changed.`
        : 'Three months is long enough for budgets, people and priorities to have changed.',
      strength: 2 as const,
      dedupe_key: `lost90:${d.id}`,
      occurred_at: iso(Date.parse(d.closed_at) + 90 * DAY),
    }];
  });
}

/** Several people at one company engaging in the same week. */
async function companyBuzz(userId: string, campaigns: string[], now: number): Promise<NewSignal[]> {
  const since = iso(now - 7 * DAY);
  const [{ data: clicks }, { data: replies }] = await Promise.all([
    campaigns.length
      ? supabaseAdmin.from('campaign_activities').select('contact_id').in('campaign_id', campaigns.slice(0, 500)).eq('activity_type', 'clicked').gte('occurred_at', since).limit(3000)
      : Promise.resolve({ data: [] as any[] }),
    supabaseAdmin.from('inbox_messages').select('contact_id').eq('user_id', userId).neq('direction', 'outbound').not('contact_id', 'is', null).gte('received_at', since).limit(2000),
  ]);
  const replied = new Set((replies || []).map((r: any) => r.contact_id));
  const ids = [...new Set([...(clicks || []).map((c: any) => c.contact_id), ...replied])].slice(0, 1000);
  if (ids.length < 2) return [];
  const people = await reachable(userId, ids);
  const byCompany = new Map<string, any[]>();
  for (const c of people.values()) {
    if (!c.company_id) continue;
    byCompany.set(c.company_id, [...(byCompany.get(c.company_id) || []), c]);
  }
  const busy = [...byCompany.entries()].filter(([, cs]) => cs.length >= 2);
  if (!busy.length) return [];
  const { data: companies } = await supabaseAdmin.from('companies').select('id, name').eq('user_id', userId).in('id', busy.map(([id]) => id));
  const names = new Map((companies || []).map((c: any) => [c.id, c.name]));
  return busy.map(([companyId, cs]) => ({
    kind: 'company_buzz' as const,
    company_id: companyId,
    headline: `${cs.length} people at ${names.get(companyId) || cs[0].company || 'one company'} engaged this week`,
    detail: `${cs.slice(0, 3).map((c) => nameOf(c) || c.email).join(', ')}${cs.length > 3 ? ' and others' : ''}. When several people look at once, it is usually being discussed internally.`,
    strength: (cs.some((c) => replied.has(c.id)) ? 3 : 2) as 2 | 3,
    dedupe_key: `buzz:${companyId}:${isoWeek(now)}`,
    occurred_at: iso(now),
  }));
}

/** A yes that never became a meeting. */
async function stalledPositive(userId: string, now: number): Promise<NewSignal[]> {
  const { data } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, contact_id, received_at, relay_summary, body_text')
    .eq('user_id', userId).in('sara_intent', ['interested', 'meeting']).neq('direction', 'outbound')
    .not('contact_id', 'is', null)
    .gte('received_at', iso(now - 30 * DAY)).lte('received_at', iso(now - 5 * DAY))
    .order('received_at', { ascending: false })
    .limit(300);
  if (!data?.length) return [];
  const ids = [...new Set(data.map((m: any) => m.contact_id))];
  const [{ data: later }, { data: deals }, people] = await Promise.all([
    supabaseAdmin.from('inbox_messages').select('id, contact_id, received_at').eq('user_id', userId).in('contact_id', ids).gte('received_at', iso(now - 30 * DAY)),
    supabaseAdmin.from('deals').select('contact_id, stage').eq('user_id', userId).in('contact_id', ids).in('stage', ['proposal', 'won']),
    reachable(userId, ids),
  ]);
  const advanced = new Set((deals || []).map((d: any) => d.contact_id));
  const out: NewSignal[] = []; const seen = new Set<string>();
  for (const m of data as any[]) {
    if (seen.has(m.contact_id)) continue;
    seen.add(m.contact_id);
    const c = people.get(m.contact_id);
    if (!c || c.is_unsubscribed || c.is_bounced || advanced.has(m.contact_id)) continue;
    if ((later || []).some((l: any) => l.contact_id === m.contact_id && l.id !== m.id && Date.parse(l.received_at) > Date.parse(m.received_at))) continue;
    const days = Math.floor((now - Date.parse(m.received_at)) / DAY);
    out.push({
      kind: 'stalled_positive',
      contact_id: m.contact_id,
      company_id: c.company_id || null,
      headline: `${nameOf(c) || c.email} replied positively ${days} days ago, and nothing has happened since`,
      detail: 'A yes cools fast. One line with two times to meet usually restarts it.',
      evidence_quote: (m.relay_summary || String(m.body_text || '').split('\n')[0] || '').slice(0, 200) || null,
      strength: 3,
      dedupe_key: `stalled:${m.id}`,
      occurred_at: m.received_at,
    });
  }
  return out;
}

/** A past replier whose address now bounces: they have probably moved on. */
async function leftCompany(userId: string, campaigns: string[], now: number): Promise<NewSignal[]> {
  if (!campaigns.length) return [];
  const { data: bounces } = await supabaseAdmin
    .from('campaign_activities').select('contact_id, occurred_at')
    .in('campaign_id', campaigns.slice(0, 500)).eq('activity_type', 'bounced')
    .gte('occurred_at', iso(now - 14 * DAY)).limit(1000);
  const ids = [...new Set((bounces || []).map((b: any) => b.contact_id))].slice(0, 500);
  if (!ids.length) return [];
  const { data: replied } = await supabaseAdmin
    .from('inbox_messages').select('contact_id').eq('user_id', userId).in('contact_id', ids).neq('direction', 'outbound').limit(2000);
  const repliers = new Set((replied || []).map((r: any) => r.contact_id));
  if (!repliers.size) return [];
  const people = await reachable(userId, [...repliers]);
  const out: NewSignal[] = [];
  for (const id of repliers) {
    const c = people.get(id);
    if (!c) continue;
    const at = (bounces || []).find((b: any) => b.contact_id === id)?.occurred_at || iso(now);
    out.push({
      kind: 'left_company',
      contact_id: id,
      company_id: c.company_id || null,
      headline: `${nameOf(c) || c.email}, who replied to you before, no longer has an address at ${c.company || 'their company'}`,
      detail: 'They have probably moved on. Whoever took over inherits the problem, and the person who left may want you at their new company.',
      strength: 2,
      dedupe_key: `left:${id}`,
      occurred_at: at,
    });
  }
  return out;
}

/* ── 2. Company websites ───────────────────────────────────────────── */

const squash = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function readTopics(userId: string): Promise<{ web: boolean; topics: SignalTopic[] }> {
  const { data } = await supabaseAdmin.from('user_settings').select('signals_web, signal_topics').eq('user_id', userId).maybeSingle();
  const topics = Array.isArray((data as any)?.signal_topics) ? (data as any).signal_topics : [];
  return {
    web: !!(data as any)?.signals_web,
    topics: topics.filter((t: any) => t && typeof t.label === 'string').map((t: any) => ({ label: String(t.label).slice(0, 80), on: t.on !== false })),
  };
}

/** Companies with a website and someone reachable there. */
async function watchedCompanies(userId: string): Promise<Array<{ id: string; name: string; domain: string }>> {
  const { data: contacts } = await supabaseAdmin
    .from('contacts').select('company_id')
    .eq('user_id', userId).not('company_id', 'is', null)
    .eq('is_unsubscribed', false).eq('is_bounced', false)
    .limit(5000);
  const ids = [...new Set((contacts || []).map((c: any) => c.company_id))].slice(0, 1000);
  const out: Array<{ id: string; name: string; domain: string }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabaseAdmin.from('companies').select('id, name, domain').eq('user_id', userId).in('id', ids.slice(i, i + 200)).not('domain', 'is', null);
    for (const c of data || []) if ((c as any).domain) out.push(c as any);
  }
  return out;
}

async function webWatch(userId: string, now: number): Promise<number> {
  const { web, topics } = await readTopics(userId);
  const on = topics.filter((t) => t.on).map((t) => t.label);
  if (!web || !on.length || !aiAvailable()) return 0;
  const settings: any = await settingsService.get(userId).catch(() => null);
  const offer = String(settings?.relay_offer || '').trim();
  if (!offer) return 0;

  const companies = await watchedCompanies(userId);
  if (!companies.length) return 0;
  const byId = new Map(companies.map((c) => [c.id, c]));

  // New companies get their homepage watched; the homepage finds the rest.
  const { data: known, error } = await supabaseAdmin.from('company_pages').select('company_id').eq('user_id', userId).limit(10_000);
  if (error) { if (!missingTable(error)) console.warn('[Moments] pages:', error.message); return 0; }
  const have = new Set((known || []).map((p: any) => p.company_id));
  const fresh = companies.filter((c) => !have.has(c.id)).slice(0, DISCOVER_PER_RUN);
  if (fresh.length) {
    await supabaseAdmin.from('company_pages').upsert(
      fresh.map((c) => ({ user_id: userId, company_id: c.id, kind: 'home', url: `https://${c.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/` })),
      { onConflict: 'user_id,company_id,url', ignoreDuplicates: true },
    );
  }

  const { data: due } = await supabaseAdmin
    .from('company_pages').select('*')
    .eq('user_id', userId).lt('failures', MAX_FAILURES)
    .or(`fetched_at.is.null,fetched_at.lt."${iso(now - PAGE_EVERY_MS)}"`)
    .order('fetched_at', { ascending: true, nullsFirst: true })
    .limit(PAGES_PER_RUN);

  const robots = new Map<string, string>();
  let judged = 0; const raised: NewSignal[] = [];
  for (const page of (due || []) as any[]) {
    const company = byId.get(page.company_id);
    if (!company) { await supabaseAdmin.from('company_pages').update({ fetched_at: iso(now) }).eq('id', page.id).eq('user_id', userId); continue; }
    let url: URL;
    try { url = new URL(page.url); } catch { await supabaseAdmin.from('company_pages').update({ failures: MAX_FAILURES, last_error: 'bad URL' }).eq('id', page.id).eq('user_id', userId); continue; }

    if (!robots.has(url.origin)) {
      const r = await safeGetText(`${url.origin}/robots.txt`, { timeoutMs: 6000, maxBytes: 200_000 });
      robots.set(url.origin, r.status === 200 && !/html/i.test(r.contentType) ? r.body : '');
    }
    if (!robotsAllows(robots.get(url.origin) || '', url.pathname)) {
      await supabaseAdmin.from('company_pages').update({ fetched_at: iso(now), last_error: 'robots.txt asks us not to read it', failures: MAX_FAILURES }).eq('id', page.id).eq('user_id', userId);
      continue;
    }

    const res = await safeGetText(page.url);
    if (res.status !== 200 || !/html|text\/plain/i.test(res.contentType)) {
      await supabaseAdmin.from('company_pages').update({ fetched_at: iso(now), failures: (page.failures || 0) + 1, last_error: res.status ? `HTTP ${res.status}` : res.body.slice(0, 120) }).eq('id', page.id).eq('user_id', userId);
      continue;
    }
    const text = pageText(res.body);
    const fingerprint = pageFingerprint(text);

    if (page.kind === 'home') {
      const found = findWatchPages(res.body, res.url, company.domain);
      if (found.length) {
        await supabaseAdmin.from('company_pages').upsert(
          found.map((f) => ({ user_id: userId, company_id: company.id, kind: f.kind, url: f.url })),
          { onConflict: 'user_id,company_id,url', ignoreDuplicates: true },
        );
      }
    }

    // First read: a baseline. Except careers - the roles open today are news.
    let added = '';
    if (!page.fingerprint) added = page.kind === 'careers' ? text.slice(0, 4000) : '';
    else if (page.fingerprint !== fingerprint) added = addedText(page.content || '', text);

    await supabaseAdmin.from('company_pages').update({
      fetched_at: iso(now), fingerprint, content: text, failures: 0, last_error: null,
      ...(page.fingerprint && page.fingerprint !== fingerprint ? { changed_at: iso(now) } : {}),
    }).eq('id', page.id).eq('user_id', userId);

    if (added.replace(/\s+/g, '').length < 40 || judged >= JUDGEMENTS_PER_RUN) continue;
    judged++;
    const verdict = await judgePageChange({ offer, topics: on, company: company.name, pageKind: page.kind as WatchPageKind, url: res.url, added });
    if (!verdict?.relevant || !verdict.headline || !verdict.quote) continue;
    // The quote must really be on the page. A judgement that cannot point
    // at its evidence is not shown.
    if (!squash(added).includes(squash(verdict.quote))) continue;
    raised.push({
      kind: 'web_change',
      company_id: company.id,
      headline: `${company.name}: ${verdict.headline}`,
      detail: verdict.why || null,
      evidence_url: res.url,
      evidence_quote: verdict.quote,
      opener: verdict.opener || null,
      strength: page.kind === 'careers' ? 3 : 2,
      dedupe_key: `web:${company.id}:${pageFingerprint(squash(verdict.quote))}`,
      occurred_at: iso(now),
    });
  }
  return raise(userId, raised);
}

/* ── Running it ────────────────────────────────────────────────────── */

const lastScan = new Map<string, number>();
const SCAN_EVERY_MS = 30 * 60 * 1000;

/** Every own-data detector for one account. Each fails alone. */
export async function scanOwnData(userId: string, now = Date.now()): Promise<number> {
  lastScan.set(userId, now);
  const campaigns = await campaignIds(userId);
  const detectors: Array<[string, () => Promise<NewSignal[]>]> = [
    ['re_engaged', () => reEngaged(userId, campaigns, now)],
    ['not_now_due', () => notNowDue(userId, now)],
    ['lost_deal_return', () => lostDealsReturn(userId, now)],
    ['company_buzz', () => companyBuzz(userId, campaigns, now)],
    ['stalled_positive', () => stalledPositive(userId, now)],
    ['left_company', () => leftCompany(userId, campaigns, now)],
  ];
  let raised = 0;
  for (const [name, run] of detectors) {
    try { raised += await raise(userId, await run()); } catch (err) { console.warn(`[Moments] ${name}:`, (err as Error)?.message || err); }
  }
  return raised;
}

/** Hourly, every account with campaigns or website watching. Cross-tenant. */
export async function runSignalSweep(now = Date.now()): Promise<void> {
  const [{ data: owners }, { data: watchers, error }] = await Promise.all([
    supabaseAdmin.from('campaigns').select('user_id').limit(20_000),
    supabaseAdmin.from('user_settings').select('user_id').eq('signals_web', true).limit(5000),
  ]);
  if (missingTable(error) || (error && /signals_web/.test(String(error.message)))) return;
  const users = new Set((owners || []).map((o: any) => o.user_id));
  const web = new Set((watchers || []).map((w: any) => w.user_id));
  for (const id of new Set([...users, ...web])) {
    try {
      if (users.has(id)) await scanOwnData(id, now);
      if (web.has(id)) await webWatch(id, now);
    } catch (err) {
      console.warn(`[Moments] account ${id}:`, (err as Error)?.message || err);
    }
  }
}

/* ── What the page shows ───────────────────────────────────────────── */

const SELECT = 'id, kind, headline, detail, evidence_url, evidence_quote, strength, opener, status, occurred_at, contact_id, company_id, deal_id, contact:contacts(id, email, first_name, last_name, job_title, is_unsubscribed, is_bounced), company:companies(id, name, domain), deal:deals(id, title)';

/** Up to three reachable people at each company, people with a title first. */
async function peopleAt(userId: string, companyIds: string[]): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>();
  if (!companyIds.length) return out;
  const { data } = await supabaseAdmin
    .from('contacts').select('id, email, first_name, last_name, job_title, company_id')
    .eq('user_id', userId).in('company_id', companyIds.slice(0, 200))
    .eq('is_unsubscribed', false).eq('is_bounced', false)
    .order('job_title', { ascending: true, nullsFirst: false })
    .limit(2000);
  for (const c of data || []) {
    const list = out.get((c as any).company_id) || [];
    if (list.length < 3) list.push(c);
    out.set((c as any).company_id, list);
  }
  return out;
}

async function settingsFor(userId: string): Promise<SignalSettings> {
  const { data, error } = await supabaseAdmin.from('user_settings').select('signals_web, signal_topics').eq('user_id', userId).maybeSingle();
  const ready = !error;
  const raw = ready && Array.isArray((data as any)?.signal_topics) ? (data as any).signal_topics : [];
  let watching = 0; let last: string | null = null;
  if (ready) {
    const { data: pages } = await supabaseAdmin.from('company_pages').select('company_id, fetched_at').eq('user_id', userId).not('fetched_at', 'is', null).order('fetched_at', { ascending: false }).limit(5000);
    watching = new Set((pages || []).map((p: any) => p.company_id)).size;
    last = (pages || [])[0]?.fetched_at ?? null;
  }
  return {
    web: ready && !!(data as any)?.signals_web,
    topics: raw.filter((t: any) => t && typeof t.label === 'string').map((t: any) => ({ label: t.label, on: t.on !== false })),
    ai: aiAvailable(),
    watching,
    last_checked: last,
    ready,
  };
}

function toSignal(row: any, people: Map<string, any[]>, now: number): Signal {
  const contactOk = row.contact && !row.contact.is_unsubscribed && !row.contact.is_bounced;
  const others = (row.company_id ? people.get(row.company_id) || [] : []).filter((p: any) => p.id !== row.contact_id);
  return {
    id: row.id,
    kind: row.kind,
    headline: row.headline,
    detail: row.detail,
    evidence_url: row.evidence_url,
    evidence_quote: row.evidence_quote,
    strength: row.strength,
    occurred_at: row.occurred_at,
    status: row.status,
    opener: row.opener,
    // Someone who left is not who you write to; their colleagues are.
    contact: contactOk && row.kind !== 'left_company' ? person(row.contact) : null,
    company: row.company ? { id: row.company.id, name: row.company.name, domain: row.company.domain } : null,
    people: others.map(person),
    deal: row.deal ? { id: row.deal.id, title: row.deal.title } : null,
    score: signalScore(row.strength, row.occurred_at, now),
  };
}

async function loadSignal(userId: string, id: string): Promise<any> {
  const { data, error } = await supabaseAdmin.from('signals').select(SELECT).eq('id', id).eq('user_id', userId).maybeSingle();
  if (missingTable(error)) throw new AppError('Moments need migration 083 first.', 409);
  if (!data) throw new AppError('Moment not found', 404);
  return data;
}

/** The person to write to: the moment's own, or one of the company's people. */
async function recipient(userId: string, row: any, contactId?: string | null): Promise<any> {
  const id = contactId || (row.kind !== 'left_company' ? row.contact_id : null);
  if (!id) throw new AppError('Choose who to write to.', 400);
  const { data: c } = await supabaseAdmin
    .from('contacts').select('id, email, first_name, last_name, job_title, company, company_id, custom_fields, is_unsubscribed, is_bounced')
    .eq('id', id).eq('user_id', userId).maybeSingle();
  if (!c) throw new AppError('Contact not found', 404);
  if ((c as any).is_unsubscribed || (c as any).is_bounced) throw new AppError('That person has unsubscribed or bounced and cannot be emailed.', 409);
  if (id !== row.contact_id && row.company_id && (c as any).company_id !== row.company_id) {
    throw new AppError('That person is not at this company.', 400);
  }
  return c;
}

async function senderFirstName(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('smtp_accounts').select('from_name, label').eq('user_id', userId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  return String((data as any)?.from_name || (data as any)?.label || '').trim().split(/\s+/)[0] || null;
}

/** An email for the moment without Claude: short, honest, no tracking talk. */
export function momentTemplate(kind: SignalKind, ctx: { firstName: string | null; company: string | null; sender: string | null; opener?: string | null; leftName?: string | null; dealTitle?: string | null; phrase?: string | null }): { subject: string; body: string } {
  const hi = `Hi ${ctx.firstName || 'there'},`;
  const at = ctx.company || 'your team';
  const sign = ctx.sender ? `\n\n${ctx.sender}` : '';
  const lines: Record<SignalKind, { subject: string; body: string }> = {
    re_engaged: { subject: 'picking this up', body: `Is this back on the list at ${at}? If it is, I can send the short version of how we would approach it.` },
    not_now_due: { subject: 'as promised', body: `When we last spoke, the timing was not right${ctx.phrase ? `, and you suggested ${ctx.phrase}` : ''}. Picking it up as promised.\n\nIs it worth a look now, or should I come back later?` },
    lost_deal_return: { subject: 'three months on', body: `It has been a few months since we spoke about ${ctx.dealTitle || 'this'}. Has anything changed on your side that makes it worth another look?` },
    company_buzz: { subject: `this at ${at}`, body: `Is this something ${at} is looking at right now? If so, are you the right person to speak to, or is someone else leading it?` },
    stalled_positive: { subject: 'next step', body: `Picking this back up from our last exchange. Shall we find 20 minutes? Tuesday or Thursday afternoon both work for me.` },
    left_company: { subject: `${ctx.leftName ? `${ctx.leftName.split(' ')[0]}'s` : 'a'} conversation`, body: `I had been speaking with ${ctx.leftName || 'a colleague of yours'} at ${at} about this. Are you the right person to pick it up now, or is someone else?` },
    web_change: { subject: `about ${at}`, body: `${ctx.opener || `Something you are working on at ${at} caught my eye.`}\n\nIs this something we could help with? Worth 15 minutes to see?` },
  };
  const t = lines[kind];
  return { subject: stripDashes(t.subject), body: stripDashes(`${hi}\n\n${t.body}${sign}`) };
}

export const signalsService = {
  async list(userId: string): Promise<{ moments: Signal[]; settings: SignalSettings; acted_this_week: number }> {
    const now = Date.now();
    if ((lastScan.get(userId) || 0) < now - SCAN_EVERY_MS) await scanOwnData(userId, now).catch(() => 0);
    const settings = await settingsFor(userId);
    const { data, error } = await supabaseAdmin
      .from('signals').select(SELECT)
      .eq('user_id', userId).eq('status', 'new')
      .gte('occurred_at', iso(now - SIGNAL_MAX_AGE_DAYS * DAY))
      .order('occurred_at', { ascending: false })
      .limit(200);
    if (missingTable(error)) return { moments: [], settings: { ...settings, ready: false }, acted_this_week: 0 };
    if (error) throw new AppError(error.message, 500);
    const companyIds = [...new Set((data || []).map((r: any) => r.company_id).filter(Boolean))];
    const people = await peopleAt(userId, companyIds);
    const moments = (data || []).map((r: any) => toSignal(r, people, now))
      // A moment with nobody to write to and no company to find people at is no use.
      .filter((s) => s.contact || s.people.length || s.company)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
    const { count } = await supabaseAdmin.from('signals').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'acted').gte('acted_at', iso(now - 7 * DAY));
    return { moments, settings, acted_this_week: count || 0 };
  },

  async count(userId: string): Promise<number> {
    const { count, error } = await supabaseAdmin.from('signals').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'new').gte('occurred_at', iso(Date.now() - SIGNAL_MAX_AGE_DAYS * DAY));
    return error ? 0 : count || 0;
  },

  async setStatus(userId: string, id: string, status: 'new' | 'acted' | 'dismissed') {
    await loadSignal(userId, id);
    const { error } = await supabaseAdmin.from('signals')
      .update({ status, acted_at: status === 'new' ? null : new Date().toISOString() })
      .eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    return { id, status };
  },

  async draft(userId: string, id: string, contactId?: string | null) {
    const row = await loadSignal(userId, id);
    const c = await recipient(userId, row, contactId);
    const [settings, sender] = await Promise.all([settingsService.get(userId).catch(() => null), senderFirstName(userId)]);
    const phrase = row.kind === 'not_now_due' ? (/asked to talk (.+)$/.exec(row.headline)?.[1] ?? null) : null;
    const left = row.kind === 'left_company' ? nameOf(row.contact) : null;
    const fallback = momentTemplate(row.kind, {
      firstName: c.first_name, company: row.company?.name || c.company, sender,
      opener: row.opener, leftName: left, dealTitle: row.deal?.title, phrase,
    });
    let history: string | null = null;
    if (['not_now_due', 'stalled_positive', 'lost_deal_return', 're_engaged'].includes(row.kind)) {
      const { data: msgs } = await supabaseAdmin.from('inbox_messages').select('direction, body_text, received_at')
        .eq('user_id', userId).eq('contact_id', c.id).order('received_at', { ascending: false }).limit(4);
      history = (msgs || []).reverse().map((m: any) => `${m.direction === 'outbound' ? 'We wrote' : 'They wrote'} (${String(m.received_at).slice(0, 10)}): ${String(m.body_text || '').slice(0, 800)}`).join('\n\n') || null;
    }
    const ai = aiAvailable()
      ? await writeMomentEmail({
        moment: row.kind === 'left_company'
          ? `${left || 'Our previous contact'} has left ${row.company?.name || 'the company'}; we are writing to a colleague to pick up the conversation.`
          : row.headline,
        evidence: row.evidence_quote, context: row.detail,
        firstName: c.first_name, company: row.company?.name || c.company, title: c.job_title,
        offer: (settings as any)?.relay_offer || '', tone: (settings as any)?.relay_tone || 'friendly',
        senderFirstName: sender, history,
      }).catch(() => null)
      : null;
    return {
      to: { id: c.id, email: c.email, name: nameOf(c) },
      subject: ai?.subject || fallback.subject,
      body: ai?.body || fallback.body,
      engine: ai ? 'ai' as const : 'template' as const,
    };
  },

  async send(userId: string, id: string, input: { contact_id?: string | null; subject: string; body: string; smtp_account_id?: string | null }) {
    const row = await loadSignal(userId, id);
    const c = await recipient(userId, row, input.contact_id);
    if (!input.subject?.trim() || !input.body?.trim()) throw new AppError('The email needs a subject and a message.', 400);
    const sent = await inboxService.compose(userId, {
      to: c.email, subject: input.subject.trim(), body: input.body.trim(), smtp_account_id: input.smtp_account_id || undefined,
    });
    await signalsService.setStatus(userId, id, 'acted');
    return { sent: true, to: c.email, message_id: (sent as any)?.message_id ?? null };
  },

  /** Add to a campaign, with the moment as their {{first_line}} when Relay wrote one. */
  async enrol(userId: string, id: string, input: { contact_id?: string | null; campaign_id: string }) {
    const row = await loadSignal(userId, id);
    const c = await recipient(userId, row, input.contact_id);
    const { data: campaign } = await supabaseAdmin.from('campaigns').select('id, name, status').eq('id', input.campaign_id).eq('user_id', userId).maybeSingle();
    if (!campaign) throw new AppError('Campaign not found', 404);
    if (row.opener) {
      const custom = { ...(c.custom_fields && typeof c.custom_fields === 'object' ? c.custom_fields : {}), first_line: row.opener };
      await supabaseAdmin.from('contacts').update({ custom_fields: custom }).eq('id', c.id).eq('user_id', userId);
    }
    const result = await campaignContactsService.add(campaign.id, [c.id]);
    if (result.added > 0) await signalsService.setStatus(userId, id, 'acted');
    return { ...result, campaign_name: (campaign as any).name, first_line: row.opener || null };
  },

  settings: settingsFor,

  async configure(userId: string, input: { web?: boolean; topics?: SignalTopic[] }) {
    const patch: Record<string, any> = {};
    if (typeof input.web === 'boolean') patch.signals_web = input.web;
    if (Array.isArray(input.topics)) {
      const seen = new Set<string>();
      patch.signal_topics = input.topics
        .map((t) => ({ label: stripDashes(String(t?.label || '').trim()).slice(0, 80), on: t?.on !== false }))
        .filter((t) => t.label.length >= 3 && !seen.has(t.label.toLowerCase()) && seen.add(t.label.toLowerCase()))
        .slice(0, 12);
    }
    if (!Object.keys(patch).length) return settingsFor(userId);
    await settingsService.get(userId);
    const { error } = await supabaseAdmin.from('user_settings').update(patch).eq('user_id', userId);
    if (error) {
      if (missingTable(error) || /signals_web|signal_topics/.test(error.message)) throw new AppError('Moments need migration 083 first.', 409);
      throw new AppError(error.message, 500);
    }
    return settingsFor(userId);
  },

  /** What to watch for, from the account's own offer. Not saved until the person saves it. */
  async suggest(userId: string): Promise<{ topics: string[]; engine: 'ai' | 'default' }> {
    const settings: any = await settingsService.get(userId).catch(() => null);
    const offer = String(settings?.relay_offer || '').trim();
    const ai = offer && aiAvailable() ? await suggestSignalTopics(offer).catch(() => null) : null;
    return ai ? { topics: ai, engine: 'ai' } : { topics: DEFAULT_SIGNAL_TOPICS, engine: 'default' };
  },
};

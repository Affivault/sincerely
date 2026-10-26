import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { resumeAfterTask } from './sequence.service.js';
import { skipChannelTask } from './channel-tasks.service.js';
import { partsInTimezone, localDateString } from '../utils/timezone.js';
import { ingestLinkedinReplies, replyWatchlist, type ReportedConversation } from './linkedin-replies.service.js';
import {
  normalizeLinkedinUrl, isLinkedinProfileUrl, LINKEDIN_TASK_MAX_ATTEMPTS,
  LINKEDIN_WEEKLY_CONNECT_MAX, LINKEDIN_AGENT_OFFLINE_MINUTES, LINKEDIN_UPKEEP_LIMITS,
  LINKEDIN_WITHDRAW_AFTER_DAYS_DEFAULT,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The LinkedIn agent.

   The browser extension runs in the user's own logged-in session and asks
   this service one question: "is there anything to do right now?" It never
   sends a cookie, a password or a session token here, and this service
   never sends one back — all it returns is a profile URL and the words to
   type, which the user could have got from the Activities queue anyway.

   Everything below is about saying "no" often enough. LinkedIn restricts
   accounts that behave like software, so the answer is "nothing right now"
   unless it is a working hour, the daily allowance has room, and enough
   time has passed since the last action.

   Between campaign steps the agent also does the chores that used to be
   the user's (095): it reads the LinkedIn inbox for replies from people in
   a campaign, looks at profiles whose invite is pending to see whether it
   was accepted, withdraws invites nobody answered, and copies the job
   title and company off any profile it visits into blank contact fields.
   Each is handed out through the same question, inside the same hours and
   gaps, and each has its own daily cap.
   ═══════════════════════════════════════════════════════════════════════ */

const SETTINGS_KEYS = [
  'enabled', 'daily_connect_limit', 'daily_message_limit', 'daily_visit_limit',
  'min_gap_seconds', 'max_gap_seconds', 'work_start', 'work_end', 'work_days',
  'timezone', 'paused_until', 'pause_reason',
  // From migration 093.
  'weekly_connect_limit', 'skip_task_after_days',
  // From migration 095.
  'daily_check_limit', 'daily_withdraw_limit', 'daily_inbox_limit', 'daily_enrich_limit',
  'withdraw_after_days',
] as const;

/** Columns 093 adds. A database without them still runs the agent, minus these. */
const COLUMNS_093 = /weekly_connect_limit|skip_task_after_days|pause_kind|connects_this_week|week_start/;

/** Columns 095 adds: the agent's own upkeep. Without them it does the steps and nothing else. */
const COLUMNS_095 = /enabled_explicitly|daily_check_limit|daily_withdraw_limit|daily_inbox_limit|daily_enrich_limit|withdraw_after_days|checks_today|withdrawals_today|inbox_reads_today|enrichments_today|last_inbox_read_at|linkedin_invite_status|linkedin_invited_at|linkedin_connected_at|linkedin_withdrawn_at|linkedin_checked_at|linkedin_headline|linkedin_agent_log|linkedin_wait_since/;

/** The settings 095 brings, refused with a clear message before it is run. */
const UPKEEP_SETTING_KEYS = [
  'daily_check_limit', 'daily_withdraw_limit', 'daily_inbox_limit', 'daily_enrich_limit', 'withdraw_after_days',
] as const;

/**
 * Marks the one task the agent raises for a person: "LinkedIn needs you".
 * Kept in payload, which a task without a channel never otherwise uses, so
 * the agent's own claim (channel IS NOT NULL) can never pick it up.
 */
export const LINKEDIN_ATTENTION_MARKER = 'linkedin_agent_attention';

/** Where the agent reads replies. Never anything but this page. */
const MESSAGING_URL = 'https://www.linkedin.com/messaging/';

/** A profile whose invite has been looked at is not looked at again for this long. */
const RECHECK_HOURS = 24;

/** Conversations opened per inbox read, at most. Each one is a click a person would make. */
const INBOX_THREADS_PER_READ = 5;

/**
 * The agent version the extension says it is. Upkeep actions (checks,
 * withdrawals, inbox reads) are only handed to an extension that knows
 * them; an older one would report them against a task id it does not have.
 */
export const AGENT_UPKEEP_CAPABILITY = 'upkeep';

/**
 * Pauses only a person can lift. A checkpoint or a restriction notice means
 * LinkedIn is looking at this account; resuming on a timer walks straight
 * back into it, and a signed-out browser can't do anything until somebody
 * signs in. Either way the user has to look first.
 */
const MANUAL_PAUSE_KINDS = new Set(['restricted', 'logged_out']);

/** Long enough that nothing resumes by itself before the user has looked. */
const MANUAL_PAUSE_MS = 24 * 60 * 60_000;

/**
 * How long a claim holds a task. The extension waits its random gap BEFORE
 * acting, and that gap can be up to max_gap_seconds (two hours at most), so
 * a fixed five-minute lease expired mid-wait and a second browser could
 * claim the same invite. The lease covers the longest gap plus the action.
 */
function leaseSecondsFor(s: { min_gap_seconds: number; max_gap_seconds: number }): number {
  const longest = Math.max(s.min_gap_seconds || 0, s.max_gap_seconds || 0);
  return Math.max(300, longest + 15 * 60);
}

/** Monday of the ISO week a YYYY-MM-DD date falls in, as YYYY-MM-DD. */
function weekStartOf(localDate: string): string {
  const d = new Date(`${localDate}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Nothing outside these bounds is worth letting a client set. */
const BOUNDS: Record<string, [number, number]> = {
  daily_connect_limit: [0, 40],
  daily_message_limit: [0, 100],
  daily_visit_limit: [0, 200],
  weekly_connect_limit: [0, LINKEDIN_WEEKLY_CONNECT_MAX],
  // 0 turns the skip off; a quarter is as long as anyone means to wait.
  skip_task_after_days: [0, 90],
  min_gap_seconds: [20, 3600],
  max_gap_seconds: [30, 7200],
  daily_check_limit: [0, LINKEDIN_UPKEEP_LIMITS.daily_check_limit.max],
  daily_withdraw_limit: [0, LINKEDIN_UPKEEP_LIMITS.daily_withdraw_limit.max],
  daily_inbox_limit: [0, LINKEDIN_UPKEEP_LIMITS.daily_inbox_limit.max],
  daily_enrich_limit: [0, LINKEDIN_UPKEEP_LIMITS.daily_enrich_limit.max],
  // 0 never withdraws. Under a week is too soon to call an invite unanswered.
  withdraw_after_days: [0, 180],
};

const ACTION_LIMIT: Record<string, { limit: keyof Settings; used: keyof Settings }> = {
  linkedin_connect: { limit: 'daily_connect_limit', used: 'connects_today' },
  linkedin_message: { limit: 'daily_message_limit', used: 'messages_today' },
  linkedin_visit: { limit: 'daily_visit_limit', used: 'visits_today' },
};

/** The agent's own work, each on a cap of its own (095). */
const UPKEEP_LIMIT: Record<string, { limit: keyof Settings; used: keyof Settings }> = {
  linkedin_check: { limit: 'daily_check_limit', used: 'checks_today' },
  linkedin_withdraw: { limit: 'daily_withdraw_limit', used: 'withdrawals_today' },
  linkedin_inbox: { limit: 'daily_inbox_limit', used: 'inbox_reads_today' },
  linkedin_enrich: { limit: 'daily_enrich_limit', used: 'enrichments_today' },
};

interface Settings {
  user_id: string;
  enabled: boolean;
  daily_connect_limit: number;
  daily_message_limit: number;
  daily_visit_limit: number;
  min_gap_seconds: number;
  max_gap_seconds: number;
  work_start: string;
  work_end: string;
  work_days: number[];
  timezone: string;
  counters_date: string;
  connects_today: number;
  messages_today: number;
  visits_today: number;
  paused_until: string | null;
  pause_reason: string | null;
  last_seen_at: string | null;
  /* Migration 093; undefined on a database that predates it. */
  weekly_connect_limit?: number;
  week_start?: string | null;
  connects_this_week?: number;
  skip_task_after_days?: number;
  pause_kind?: string | null;
  /* Migration 095; undefined on a database that predates it. */
  enabled_explicitly?: boolean;
  daily_check_limit?: number;
  daily_withdraw_limit?: number;
  daily_inbox_limit?: number;
  daily_enrich_limit?: number;
  withdraw_after_days?: number;
  checks_today?: number;
  withdrawals_today?: number;
  inbox_reads_today?: number;
  enrichments_today?: number;
  last_inbox_read_at?: string | null;
}

interface Usage {
  linkedin_connect: number;
  linkedin_message: number;
  linkedin_visit: number;
  /** null before migration 093, which is where the weekly counter lives. */
  connects_this_week: number | null;
  /* The agent's own upkeep (095); 0 before it. */
  linkedin_check: number;
  linkedin_withdraw: number;
  linkedin_inbox: number;
  linkedin_enrich: number;
}

/** What a profile visit read off the top card. Every field optional and untrusted. */
export interface ProfileFacts {
  headline?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  /** 1, 2 or 3; LinkedIn's connection degree as the card showed it. */
  degree?: number | null;
}

/** What the extension reports alongside a done or failed task. */
export interface ActionReport {
  profile?: ProfileFacts | null;
  /** What the invite looked like: 'pending', 'accepted', 'not_connected'. */
  state?: string | null;
}

/** True once migration 095 has been run. */
function has095(s: Settings): boolean {
  return s.daily_check_limit !== undefined;
}

function cleanText(raw: unknown, max: number): string | null {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : null;
}

function cleanFacts(raw: any): ProfileFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const degree = Number(raw.degree);
  const facts: ProfileFacts = {
    headline: cleanText(raw.headline, 300),
    title: cleanText(raw.title, 200),
    company: cleanText(raw.company, 200),
    location: cleanText(raw.location, 200),
    degree: degree === 1 || degree === 2 || degree === 3 ? degree : null,
  };
  return Object.values(facts).some((v) => v !== null) ? facts : null;
}

function isMissingFn(error: any, name: string): boolean {
  return !!error && (error.code === 'PGRST202' || new RegExp(name).test(error.message || ''));
}

function clamp(key: string, value: number): number {
  const b = BOUNDS[key];
  if (!b) return value;
  return Math.min(b[1], Math.max(b[0], Math.round(value)));
}

/** "09:30" → 570. Returns null for anything that isn't a wall-clock time. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export const linkedinAgentService = {
  async getSettings(userId: string): Promise<Settings> {
    const { data, error } = await supabaseAdmin
      .from('linkedin_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (/linkedin_settings/i.test(error.message) || error.code === '42P01') {
        throw new AppError(
          'LinkedIn automation needs database migration 040_linkedin_agent.sql — run it in Supabase, then reload.',
          503,
        );
      }
      throw new AppError(error.message, 500);
    }
    if (data) return data as Settings;

    // First look. Create the row with the conservative defaults rather than
    // returning a phantom, so the counters have somewhere to live.
    const { data: created, error: insErr } = await supabaseAdmin
      .from('linkedin_settings')
      .insert({ user_id: userId })
      .select('*')
      .single();
    if (insErr) throw new AppError(insErr.message, 500);
    return created as Settings;
  },

  async updateSettings(userId: string, input: any): Promise<Settings> {
    await this.getSettings(userId); // ensures the row exists

    const patch: Record<string, any> = {};
    for (const key of SETTINGS_KEYS) {
      if (input?.[key] === undefined) continue;
      if (BOUNDS[key]) patch[key] = clamp(key, Number(input[key]));
      else patch[key] = input[key];
    }

    if (patch.work_start !== undefined && toMinutes(patch.work_start) === null) {
      throw new AppError('Start time must look like 09:00', 400);
    }
    if (patch.work_end !== undefined && toMinutes(patch.work_end) === null) {
      throw new AppError('End time must look like 17:00', 400);
    }
    if (patch.timezone !== undefined) {
      // An unknown zone is not an error anywhere downstream - the clock
      // falls back to UTC - so the agent would quietly work the wrong hours.
      const zone = typeof patch.timezone === 'string' ? patch.timezone.trim() : '';
      try {
        if (!zone || zone.length > 64) throw new Error('empty');
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
      } catch {
        throw new AppError(`"${String(patch.timezone).slice(0, 64)}" is not a timezone this system knows.`, 400);
      }
      patch.timezone = zone;
    }
    if (patch.paused_until !== undefined && patch.paused_until !== null) {
      // Only the server pauses; the page may only lift one. A client-chosen
      // date would let a stray request park the agent for a decade.
      throw new AppError('Pausing is done by the agent; only resuming can be set here.', 400);
    }
    // Resuming is the user saying they have looked at LinkedIn, which is
    // exactly what a restriction or sign-out pause was waiting for.
    if (patch.paused_until === null) {
      patch.pause_reason = null;
      patch.pause_kind = null;
    }
    if (patch.enabled !== undefined) {
      patch.enabled = patch.enabled === true;
      // Whatever they chose, it is theirs now: the extension checking in
      // must never switch back on an agent somebody turned off.
      patch.enabled_explicitly = true;
    }
    if (patch.withdraw_after_days !== undefined && patch.withdraw_after_days > 0 && patch.withdraw_after_days < 7) {
      // Inside a week an unanswered invite is just one nobody has seen yet.
      patch.withdraw_after_days = 7;
    }
    if (patch.work_days !== undefined) {
      const days = Array.isArray(patch.work_days) ? patch.work_days : [];
      patch.work_days = [...new Set(days.map(Number).filter((d: number) => d >= 1 && d <= 7))];
    }
    // A max below the min would make the random gap NaN, and a machine-gun
    // agent is exactly what gets an account restricted.
    if (patch.min_gap_seconds !== undefined || patch.max_gap_seconds !== undefined) {
      const current = await this.getSettings(userId);
      const min = patch.min_gap_seconds ?? current.min_gap_seconds;
      const max = patch.max_gap_seconds ?? current.max_gap_seconds;
      if (max < min) patch.max_gap_seconds = min;
    }

    if (Object.keys(patch).length === 0) throw new AppError('Nothing to update', 400);

    const saved = await this.writeSettings(userId, patch);
    if (patch.paused_until === null) {
      // The "LinkedIn needs you" task was waiting for exactly this.
      await this.settleAttention(userId, 'Resumed from the LinkedIn page');
    }
    return saved;
  },

  /**
   * Write a settings patch, dropping what a database without 093 or 095
   * has nowhere to put. A setting that only exists in a migration that has
   * not been run is refused with the migration's name, rather than a 500.
   */
  async writeSettings(userId: string, patch: Record<string, any>): Promise<Settings> {
    let attempt = { ...patch };
    for (let round = 0; round < 3; round++) {
      const { data, error } = await supabaseAdmin
        .from('linkedin_settings')
        .update(attempt)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (!error) return data as Settings;
      const msg = error.message || '';

      if (COLUMNS_095.test(msg)) {
        if (UPKEEP_SETTING_KEYS.some((k) => attempt[k] !== undefined)) {
          throw new AppError('Acceptance checks, inbox reading, withdrawals and enrichment need database migration 095_linkedin_autopilot.sql. Run it in Supabase, then save again.', 503);
        }
        const { enabled_explicitly: _drop, ...rest } = attempt;
        if (Object.keys(rest).length === Object.keys(attempt).length) throw new AppError(msg, 500);
        attempt = rest;
      } else if (COLUMNS_093.test(msg)) {
        // Before 093 the weekly cap and the skip delay have nowhere to live,
        // and saying so beats a 500. A resume only needs pause_kind dropped.
        if (attempt.weekly_connect_limit !== undefined || attempt.skip_task_after_days !== undefined) {
          throw new AppError('The weekly invite cap and task skipping need database migration 093_linkedin_agent_hardening.sql. Run it in Supabase, then save again.', 503);
        }
        const { pause_kind: _drop, ...rest } = attempt;
        if (Object.keys(rest).length === Object.keys(attempt).length) throw new AppError(msg, 500);
        attempt = rest;
      } else {
        throw new AppError(msg, 500);
      }
      if (Object.keys(attempt).length === 0) throw new AppError('Nothing to update', 400);
    }
    throw new AppError('Could not save the LinkedIn settings', 500);
  },

  /**
   * Where today's and this week's allowances stand, in the user's timezone.
   * A stale counters_date means the row hasn't been touched today (their
   * today), so nothing has been used today either; the same for the week.
   */
  usage(s: Settings): Usage {
    const tz = s.timezone || 'UTC';
    const today = localDateString(tz);
    const fresh = s.counters_date === today;
    const weekFresh = !!s.week_start && s.week_start === weekStartOf(today);
    const today095 = (n: number | undefined) => (fresh ? n || 0 : 0);
    return {
      linkedin_connect: fresh ? s.connects_today : 0,
      linkedin_message: fresh ? s.messages_today : 0,
      linkedin_visit: fresh ? s.visits_today : 0,
      connects_this_week: s.weekly_connect_limit === undefined ? null : (weekFresh ? s.connects_this_week || 0 : 0),
      linkedin_check: today095(s.checks_today),
      linkedin_withdraw: today095(s.withdrawals_today),
      linkedin_inbox: today095(s.inbox_reads_today),
      linkedin_enrich: today095(s.enrichments_today),
    };
  },

  /** The channels with no room left today (or, for invites, this week). */
  cappedChannels(s: Settings, used: Usage): string[] {
    return Object.keys(ACTION_LIMIT).filter((channel) => {
      const map = ACTION_LIMIT[channel];
      if ((used as any)[channel] >= (s as any)[map.limit]) return true;
      return channel === 'linkedin_connect'
        && s.weekly_connect_limit !== undefined
        && used.connects_this_week !== null
        && used.connects_this_week >= s.weekly_connect_limit;
    });
  },

  /** Room left today for one kind of upkeep. Always none before 095. */
  upkeepRoom(s: Settings, used: Usage, kind: keyof typeof UPKEEP_LIMIT): boolean {
    if (!has095(s)) return false;
    const map = UPKEEP_LIMIT[kind];
    return (used as any)[kind] < Number((s as any)[map.limit] ?? 0);
  },

  /** Count one action against today's allowance, in the user's own day. */
  async record(userId: string, s: Settings, action: string): Promise<void> {
    const { error } = await supabaseAdmin.rpc('record_linkedin_action', {
      uid: userId,
      action,
      local_date: localDateString(s.timezone || 'UTC'),
    });
    if (error) console.error(`[LinkedIn] Could not count ${action} for ${userId}: ${error.message}`);
  },

  /**
   * One line in the activity log for something the agent did that is not
   * a campaign step. Best-effort: a log line is never worth failing the
   * action it describes.
   */
  async log(userId: string, entry: { kind: string; outcome: string; contact_id?: string | null; contact_name?: string | null; detail?: string | null }) {
    const { error } = await supabaseAdmin.from('linkedin_agent_log').insert({
      user_id: userId,
      kind: entry.kind,
      outcome: entry.outcome,
      contact_id: entry.contact_id || null,
      contact_name: entry.contact_name ? entry.contact_name.slice(0, 200) : null,
      detail: entry.detail ? entry.detail.slice(0, 500) : null,
    });
    if (error && !COLUMNS_095.test(error.message || '') && error.code !== '42P01') {
      console.warn(`[LinkedIn] Could not write the activity log: ${error.message}`);
    }
  },

  /**
   * Everything the extension needs to decide what to do, including the
   * reason when the answer is "nothing". Explaining the wait is what stops
   * a quiet agent looking like a broken one.
   *
   * `caps` is what the asking extension can do. Only one that says it
   * knows upkeep is handed checks, withdrawals and inbox reads.
   */
  async nextAction(userId: string, caps: string[] = []) {
    let s = await this.getSettings(userId);

    /*
     * The first check-in turns the agent on, unless the user has already
     * made a choice either way. Installing the extension and connecting it
     * is the user asking for this to happen; making them find a second
     * switch afterwards is how LinkedIn steps sat undone for a week.
     */
    const seen: Record<string, any> = { last_seen_at: new Date().toISOString() };
    const autoEnable = !s.enabled && s.enabled_explicitly === false;
    if (autoEnable) {
      seen.enabled = true;
      seen.enabled_explicitly = true;
    }
    const { error: seenErr } = await supabaseAdmin
      .from('linkedin_settings')
      .update(seen)
      .eq('user_id', userId);
    if (seenErr && COLUMNS_095.test(seenErr.message || '')) {
      await supabaseAdmin.from('linkedin_settings').update({ last_seen_at: seen.last_seen_at }).eq('user_id', userId);
    } else if (!seenErr && autoEnable) {
      s = { ...s, enabled: true, enabled_explicitly: true };
      await this.log(userId, {
        kind: 'agent', outcome: 'done',
        detail: 'The extension connected, so the agent switched itself on. Turn it off here any time.',
      });
    }

    const gap = {
      min_seconds: s.min_gap_seconds,
      max_seconds: Math.max(s.min_gap_seconds, s.max_gap_seconds),
    };

    if (!s.enabled) return { action: null, reason: 'disabled', gap };

    // A restriction or sign-out pause holds until the user resumes it from
    // the LinkedIn page, whatever paused_until says.
    if (s.pause_kind && MANUAL_PAUSE_KINDS.has(s.pause_kind)) {
      return {
        action: null, reason: 'paused', paused_until: s.paused_until, pause_reason: s.pause_reason,
        pause_kind: s.pause_kind, needs_resume: true, gap,
      };
    }
    if (s.paused_until && new Date(s.paused_until) > new Date()) {
      return { action: null, reason: 'paused', paused_until: s.paused_until, pause_reason: s.pause_reason, gap };
    }

    // Working hours, in the user's timezone rather than the server's.
    const now = partsInTimezone(new Date(), s.timezone || 'UTC');
    // partsInTimezone gives 0 = Sunday; the settings use ISO days, 1 = Monday.
    const isoDay = now.weekday === 0 ? 7 : now.weekday;
    if (!s.work_days.includes(isoDay)) return { action: null, reason: 'outside_work_days', gap };

    const start = toMinutes(s.work_start) ?? 0;
    const end = toMinutes(s.work_end) ?? 24 * 60;
    const minutes = now.hour * 60 + now.minute;
    if (minutes < start || minutes >= end) {
      return { action: null, reason: 'outside_work_hours', gap };
    }

    const used = this.usage(s);
    const capped = this.cappedChannels(s, used);
    const weeklyFull = s.weekly_connect_limit !== undefined
      && used.connects_this_week !== null && used.connects_this_week >= s.weekly_connect_limit;
    const allStepsCapped = capped.length === Object.keys(ACTION_LIMIT).length;
    const lease = leaseSecondsFor(s);
    const upkeep = caps.includes(AGENT_UPKEEP_CAPABILITY) && has095(s);
    const captureProfile = this.upkeepRoom(s, used, 'linkedin_enrich');

    /*
     * Replies first. A reply that arrived on LinkedIn has to be seen before
     * the next follow-up goes to the same person, and the read is cheap: a
     * few times a day, at most, on its own cap.
     */
    if (upkeep) {
      const inbox = await this.claimInboxRead(userId, s, used, { start, end });
      if (inbox) return { action: inbox, used, gap, lease_seconds: lease };
    }

    if (!allStepsCapped) {
      const stepped = await this.claimStep(userId, capped, weeklyFull, lease, used, gap, captureProfile);
      if (stepped) return stepped;
    }

    if (upkeep) {
      const visit = await this.claimUpkeepVisit(userId, s, used, captureProfile);
      if (visit) return { action: visit, used, gap, lease_seconds: lease };
    }

    return { action: null, reason: allStepsCapped ? 'daily_limit_reached' : 'nothing_due', used, gap };
  },

  /** The next campaign step, or null when there is none to hand out. */
  async claimStep(
    userId: string, capped: string[], weeklyFull: boolean, lease: number,
    used: Usage, gap: { min_seconds: number; max_seconds: number }, captureProfile: boolean,
  ): Promise<Record<string, any> | null> {
    // The capped channels go into the claim, so a full invite allowance no
    // longer sits at the head of the queue holding every message and visit
    // behind it until tomorrow.
    let legacyClaim = false;
    let { data, error } = await supabaseAdmin.rpc('claim_linkedin_task', {
      uid: userId,
      lease_seconds: lease,
      skip_channels: capped,
    });
    if (error && ((error as any).code === 'PGRST202' || /skip_channels|claim_linkedin_task/.test(error.message || ''))) {
      // Migration 093 not run: the two-argument claim from 040.
      legacyClaim = true;
      ({ data, error } = await supabaseAdmin.rpc('claim_linkedin_task', { uid: userId, lease_seconds: lease }));
    }
    if (error) throw new AppError(error.message, 500);

    const task = Array.isArray(data) ? data[0] : data;
    if (!task) return null;

    const giveBack = async () => {
      await supabaseAdmin
        .from('crm_tasks')
        .update({ locked_until: null, attempts: Math.max(0, (task.attempts || 1) - 1) })
        .eq('id', task.id);
    };

    if (legacyClaim) {
      // The old claim neither skips capped channels nor checks the contact.
      // Hand a capped one straight back rather than holding it hostage, and
      // close one whose contact has left, so it is not sent after a reply.
      if (capped.includes(task.channel)) {
        await giveBack();
        return { action: null, reason: weeklyFull && task.channel === 'linkedin_connect' ? 'weekly_limit_reached' : 'daily_limit_reached', used, gap };
      }
      const { data: link } = await supabaseAdmin
        .from('crm_tasks').select('campaign_contact_id').eq('id', task.id).maybeSingle();
      if (link?.campaign_contact_id) {
        const { data: cc } = await supabaseAdmin
          .from('campaign_contacts')
          .select('status, campaigns(status)')
          .eq('id', link.campaign_contact_id)
          .maybeSingle();
        const live = cc && cc.status === 'active' && (cc as any).campaigns?.status === 'running';
        if (!live) {
          await giveBack();
          return { action: null, reason: 'nothing_due', used, gap };
        }
      }
    }

    // Tasks raised before URLs were normalised can still lack a scheme.
    // Anything that is not a LinkedIn profile after that is not somewhere
    // the agent should open a tab; the step is skipped and the sequence
    // moves on rather than retrying a URL that will never work.
    const profileUrl = normalizeLinkedinUrl(task.target_url);
    if (!profileUrl || !isLinkedinProfileUrl(profileUrl)) {
      await skipChannelTask(task.id, 'invalid_linkedin_url', 'Skipped: no usable LinkedIn profile URL')
        .catch((e) => console.warn(`[LinkedIn] Could not skip task ${task.id}: ${e?.message}`));
      return { action: null, reason: 'nothing_due', used, gap };
    }

    return {
      action: {
        task_id: task.id,
        kind: 'step',
        channel: task.channel,
        /** The profile to open. Nothing here identifies the user's session. */
        profile_url: profileUrl,
        /** Already personalised — the extension types it, it doesn't compose. */
        message: task.payload || null,
        contact_name: task.contact_name,
        title: task.title,
        /** Read the top card while there, for the contact's blank fields. */
        capture_profile: captureProfile,
      },
      used,
      gap,
      /** How long this claim holds; the extension must act inside it. */
      lease_seconds: lease,
    };
  },

  /**
   * An inbox read, when one is due: there is somebody to look for, today's
   * reads are not used up, and the last one was long enough ago. Reads are
   * spread over the working day rather than spent in its first hour.
   */
  async claimInboxRead(userId: string, s: Settings, used: Usage, hours: { start: number; end: number }) {
    if (!this.upkeepRoom(s, used, 'linkedin_inbox')) return null;
    const limit = Math.max(1, Number(s.daily_inbox_limit) || 1);
    const spacingMinutes = Math.max(30, Math.floor(Math.max(60, hours.end - hours.start) / limit));
    const cutoff = new Date(Date.now() - spacingMinutes * 60_000).toISOString();
    if (s.last_inbox_read_at && s.last_inbox_read_at > cutoff) return null;

    const watch = await replyWatchlist(userId, 100).catch((e) => {
      console.warn(`[LinkedIn] Could not read the reply watchlist: ${e?.message}`);
      return null;
    });
    if (!watch || watch.length === 0) return null;

    // Claimed on the timestamp, so two browsers polling together read once.
    const { data: claimed, error } = await supabaseAdmin
      .from('linkedin_settings')
      .update({ last_inbox_read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .or(`last_inbox_read_at.is.null,last_inbox_read_at.lt.${cutoff}`)
      .select('user_id')
      .maybeSingle();
    if (error || !claimed) return null;

    return {
      task_id: null,
      kind: 'inbox',
      channel: 'linkedin_inbox',
      url: MESSAGING_URL,
      profile_url: MESSAGING_URL,
      title: 'Read LinkedIn replies',
      contact_name: null,
      max_threads: INBOX_THREADS_PER_READ,
      /** Who to look for. Names to match the list by, ids to report back with. */
      watch: watch.map((w) => ({
        contact_id: w.contact_id,
        name: w.contact_name,
        profile_url: normalizeLinkedinUrl(w.linkedin_url),
      })),
    };
  },

  /** A profile to visit for an acceptance check or a withdrawal. */
  async claimUpkeepVisit(userId: string, s: Settings, used: Usage, captureProfile: boolean) {
    const withdrawAfter = s.withdraw_after_days ?? LINKEDIN_WITHDRAW_AFTER_DAYS_DEFAULT;
    const allowCheck = this.upkeepRoom(s, used, 'linkedin_check');
    const allowWithdraw = withdrawAfter > 0 && this.upkeepRoom(s, used, 'linkedin_withdraw');
    if (!allowCheck && !allowWithdraw) return null;

    for (let tries = 0; tries < 3; tries++) {
      const { data, error } = await supabaseAdmin.rpc('claim_linkedin_upkeep', {
        uid: userId,
        recheck_hours: RECHECK_HOURS,
        withdraw_after_days: withdrawAfter,
        allow_check: allowCheck,
        allow_withdraw: allowWithdraw,
      });
      if (error) {
        if (isMissingFn(error, 'claim_linkedin_upkeep')) return null;
        throw new AppError(error.message, 500);
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        { contact_id: string; contact_name: string | null; linkedin_url: string; action: string } | undefined;
      if (!row) return null;

      const profileUrl = normalizeLinkedinUrl(row.linkedin_url);
      if (!profileUrl || !isLinkedinProfileUrl(profileUrl)) {
        // Nothing to visit. Forgetting the invite stops it being claimed again.
        await supabaseAdmin.from('contacts')
          .update({ linkedin_invite_status: null })
          .eq('id', row.contact_id).eq('user_id', userId);
        continue;
      }
      const name = row.contact_name || 'this person';
      const withdraw = row.action === 'withdraw';
      return {
        task_id: null,
        kind: withdraw ? 'withdraw' : 'check',
        channel: withdraw ? 'linkedin_withdraw' : 'linkedin_check',
        contact_id: row.contact_id,
        contact_name: row.contact_name,
        profile_url: profileUrl,
        title: withdraw ? `Withdraw a stale invite — ${name}` : `See whether ${name} accepted`,
        capture_profile: captureProfile,
      };
    }
    return null;
  },

  /** The action happened. Count it, close the task, let the sequence move on. */
  async complete(userId: string, taskId: string, report: ActionReport = {}) {
    const { data: task, error } = await supabaseAdmin
      .from('crm_tasks')
      .update({
        is_done: true,
        completed_at: new Date().toISOString(),
        locked_until: null,
        last_error: null,
      })
      .eq('id', taskId)
      .eq('user_id', userId)
      .eq('is_done', false)
      .select('id, channel, campaign_contact_id, contact_id, contact_name')
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!task) {
      // A retried "done" (network timeout) must not count the action twice.
      const { data: existing } = await supabaseAdmin
        .from('crm_tasks').select('id').eq('id', taskId).eq('user_id', userId).maybeSingle();
      if (!existing) throw new AppError('Task not found', 404);
      return { ok: true };
    }

    const s = await this.getSettings(userId);
    if (task.channel) await this.record(userId, s, task.channel);
    if (task.campaign_contact_id) {
      // Never let a bookkeeping failure look like the action failed — the
      // invite has already been sent by the time we get here.
      resumeAfterTask(taskId).catch((e) =>
        console.warn('[LinkedIn] sequence resume failed:', e?.message));
    }

    // What the visit learned. Best-effort for the same reason as above.
    if (task.contact_id && has095(s)) {
      await this.noteVisit(userId, s, task.contact_id, task.contact_name, {
        channel: task.channel, done: true, ...report,
      }).catch((e) => console.warn('[LinkedIn] Could not note what the visit saw:', e?.message || e));
    }
    return { ok: true };
  },

  /**
   * Record what a profile visit showed about the invite, and fill the
   * contact's blanks from the top card.
   *
   * An invite that went out is pending from now. A message that went out,
   * or a card reading "1st", means connected - LinkedIn only offers
   * Message to a stranger as InMail, which the agent refuses.
   */
  async noteVisit(
    userId: string, s: Settings, contactId: string, contactName: string | null,
    seen: ActionReport & { channel?: string | null; done?: boolean },
  ) {
    const facts = cleanFacts(seen.profile);
    const connected = facts?.degree === 1 || seen.state === 'accepted'
      || (seen.done && seen.channel === 'linkedin_message');

    if (connected) {
      await this.markAccepted(userId, contactId, contactName);
    } else if (seen.done && seen.channel === 'linkedin_connect') {
      // Already pending from an earlier invite keeps its original date, so
      // the withdrawal clock is not reset by a second look.
      const { error } = await supabaseAdmin
        .from('contacts')
        .update({
          linkedin_invite_status: 'pending',
          linkedin_invited_at: new Date().toISOString(),
          linkedin_withdrawn_at: null,
        })
        .eq('id', contactId)
        .eq('user_id', userId)
        .or('linkedin_invite_status.is.null,linkedin_invite_status.eq.withdrawn');
      if (error && !COLUMNS_095.test(error.message || '')) {
        console.warn(`[LinkedIn] Could not record the invite to ${contactId}: ${error.message}`);
      }
    }

    if (facts) await this.enrich(userId, s, contactId, contactName, facts);
  },

  /** They accepted. Said once, and anybody waiting on it is woken. */
  async markAccepted(userId: string, contactId: string, contactName: string | null) {
    const { data: changed, error } = await supabaseAdmin
      .from('contacts')
      .update({
        linkedin_invite_status: 'accepted',
        linkedin_connected_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .eq('user_id', userId)
      .or('linkedin_invite_status.is.null,linkedin_invite_status.neq.accepted')
      .select('id')
      .maybeSingle();
    if (error) {
      if (!COLUMNS_095.test(error.message || '')) console.warn(`[LinkedIn] Could not mark ${contactId} connected: ${error.message}`);
      return;
    }
    if (!changed) return;

    await this.log(userId, {
      kind: 'check', outcome: 'done', contact_id: contactId, contact_name: contactName,
      detail: 'Connected on LinkedIn',
    });

    // A message step waiting for this acceptance goes now rather than at
    // its next look. Only enrolments that are due-able are touched; the
    // step itself re-checks everything when it runs.
    const { data: waiting } = await supabaseAdmin
      .from('campaign_contacts')
      .select('id, campaigns!inner(user_id)')
      .eq('contact_id', contactId)
      .eq('status', 'active')
      .eq('campaigns.user_id', userId)
      .not('linkedin_wait_since', 'is', null)
      .not('next_send_at', 'is', null);
    for (const row of (waiting || []) as Array<{ id: string }>) {
      await supabaseAdmin
        .from('campaign_contacts')
        .update({ next_send_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'active')
        .not('next_send_at', 'is', null);
    }
  },

  /**
   * Fill the contact's empty fields from the top card. Never overwrites a
   * value somebody typed or imported; that rule lives in the database
   * function, so a race between two visits cannot break it either.
   */
  async enrich(userId: string, s: Settings, contactId: string, contactName: string | null, facts: ProfileFacts) {
    if (!this.upkeepRoom(s, this.usage(s), 'linkedin_enrich')) return;
    let { title, company } = facts;
    // The headline is usually "Title at Company"; when the card has no
    // separate position, that is where they are.
    if ((!title || !company) && facts.headline) {
      const m = /^(.{2,120}?)\s+(?:at|@)\s+(.{2,120})$/i.exec(facts.headline);
      if (m) {
        title = title || m[1].trim();
        company = company || m[2].split(/\s+[|·•]\s+/)[0].trim();
      }
    }
    const { data: filled, error } = await supabaseAdmin.rpc('linkedin_fill_contact_blanks', {
      uid: userId,
      cid: contactId,
      p_headline: facts.headline || null,
      p_title: title || null,
      p_company: company || null,
      p_location: facts.location || null,
    });
    if (error) {
      if (!isMissingFn(error, 'linkedin_fill_contact_blanks')) console.warn(`[LinkedIn] Could not enrich ${contactId}: ${error.message}`);
      return;
    }
    const n = Number(filled) || 0;
    if (n > 0) {
      await this.record(userId, s, 'linkedin_enrich');
      await this.log(userId, {
        kind: 'enrich', outcome: 'done', contact_id: contactId, contact_name: contactName,
        detail: `Filled ${n} blank field${n === 1 ? '' : 's'} from their LinkedIn profile`,
      });
    }
  },

  /** Pause the agent, holding for a manual resume when the kind needs one. */
  async pause(userId: string, kind: string | null, reason: string, ms: number) {
    const base = {
      paused_until: new Date(Date.now() + ms).toISOString(),
      pause_reason: reason.slice(0, 200),
    };
    const { error } = await supabaseAdmin
      .from('linkedin_settings')
      .update({ ...base, pause_kind: kind })
      .eq('user_id', userId);
    if (error && COLUMNS_093.test(error.message || '')) {
      // Before 093 there is no manual hold; the long pause is the next best.
      await supabaseAdmin.from('linkedin_settings').update(base).eq('user_id', userId);
    } else if (error) {
      throw new AppError(error.message, 500);
    }
    if (kind && MANUAL_PAUSE_KINDS.has(kind)) await this.raiseAttention(userId, kind, reason);
  },

  /**
   * The one thing the agent puts on the user's to-do list: it is stuck
   * until a person looks. Raised once, however many actions hit the same
   * wall, and closed when the agent is resumed.
   */
  async raiseAttention(userId: string, kind: string, reason: string) {
    const { data: open } = await supabaseAdmin
      .from('crm_tasks')
      .select('id')
      .eq('user_id', userId)
      .eq('payload', LINKEDIN_ATTENTION_MARKER)
      .eq('is_done', false)
      .limit(1);
    if (open && open.length > 0) return;
    const title = kind === 'logged_out'
      ? 'LinkedIn needs you: sign in, then tick this off to resume the agent'
      : 'LinkedIn needs you: clear its security check, then tick this off to resume the agent';
    const { error } = await supabaseAdmin.from('crm_tasks').insert({
      user_id: userId,
      title,
      type: 'todo',
      priority: 'high',
      due_date: new Date().toISOString(),
      notes: reason.slice(0, 500),
      payload: LINKEDIN_ATTENTION_MARKER,
    });
    if (error) console.warn(`[LinkedIn] Could not raise the sign-in task: ${error.message}`);
    await this.log(userId, { kind: 'attention', outcome: 'failed', detail: reason });
  },

  /** Close the "LinkedIn needs you" task, if there is one open. */
  async settleAttention(userId: string, note: string) {
    const { error } = await supabaseAdmin
      .from('crm_tasks')
      .update({ is_done: true, completed_at: new Date().toISOString(), last_error: note.slice(0, 200) })
      .eq('user_id', userId)
      .eq('payload', LINKEDIN_ATTENTION_MARKER)
      .eq('is_done', false);
    if (error) console.warn(`[LinkedIn] Could not close the sign-in task: ${error.message}`);
  },

  /**
   * Ticking the "LinkedIn needs you" task off is the user saying they have
   * looked, so it resumes the agent the way the LinkedIn page's button does.
   */
  async resumeFromAttention(userId: string) {
    await this.writeSettings(userId, { paused_until: null, pause_reason: null, pause_kind: null })
      .catch((e) => console.warn(`[LinkedIn] Could not resume after the sign-in task: ${e?.message || e}`));
  },

  /** Stop for an account-level problem, the same way for steps and upkeep. */
  async pauseForAccount(userId: string, kind: string, why: string) {
    if (kind === 'logged_out') {
      await this.pause(userId, 'logged_out',
        'LinkedIn is signed out in your browser. Sign in, then resume here.', MANUAL_PAUSE_MS);
    } else if (kind === 'weekly_limit') {
      // LinkedIn's own weekly ceiling. Nothing to check, just wait it out.
      await this.pause(userId, null, why || 'LinkedIn weekly invitation limit reached', MANUAL_PAUSE_MS);
    } else {
      await this.pause(userId, 'restricted', why || 'LinkedIn asked for verification', MANUAL_PAUSE_MS);
    }
  },

  /**
   * It didn't happen.
   *
   * Two very different failures arrive here. One is about the account, not
   * the task: LinkedIn showed a checkpoint, a restriction, a weekly-limit
   * notice, or the browser is signed out. The task did nothing wrong, so it
   * keeps its attempt and the whole agent stops. The other is about this
   * task (no Connect button, a send that did not land): it waits a day,
   * then two, then four, and after the last attempt it is skipped and the
   * sequence moves on, rather than leaving the contact parked on a task the
   * claim will never hand out again.
   */
  async fail(userId: string, taskId: string, reason: string, fatal = false, kind?: string | null, report: ActionReport = {}) {
    const why = String(reason || '').slice(0, 500);
    const { data: task, error: readErr } = await supabaseAdmin
      .from('crm_tasks')
      .select('id, attempts, is_done, contact_id, contact_name, channel')
      .eq('id', taskId)
      .eq('user_id', userId)
      .maybeSingle();
    if (readErr) throw new AppError(readErr.message, 500);
    if (!task) throw new AppError('Task not found', 404);
    // Closed in the meantime (done by hand, skipped, contact replied).
    if (task.is_done) return { ok: true, paused: false };

    // Handed back unattempted (paused on the machine, or asleep past the
    // lease): nothing happened, so nothing is charged and nothing recorded.
    if (kind === 'released') {
      const { error } = await supabaseAdmin
        .from('crm_tasks')
        .update({ locked_until: null, attempts: Math.max(0, (task.attempts || 1) - 1) })
        .eq('id', taskId)
        .eq('user_id', userId);
      if (error) throw new AppError(error.message, 500);
      return { ok: true, paused: false, released: true };
    }

    const accountKind = kind === 'logged_out' || kind === 'restricted' || kind === 'weekly_limit'
      ? kind
      : (fatal ? 'restricted' : null);

    if (accountKind) {
      const { error } = await supabaseAdmin
        .from('crm_tasks')
        .update({ locked_until: null, attempts: Math.max(0, (task.attempts || 1) - 1), last_error: why })
        .eq('id', taskId)
        .eq('user_id', userId);
      if (error) throw new AppError(error.message, 500);
      await this.pauseForAccount(userId, accountKind, why);
      return { ok: true, paused: true };
    }

    // The profile loaded even though the step did not happen, and what it
    // showed (a first-degree badge, the headline) is still worth keeping.
    if (task.contact_id && (report.profile || report.state)) {
      const s = await this.getSettings(userId);
      if (has095(s)) {
        await this.noteVisit(userId, s, task.contact_id, task.contact_name, { ...report, channel: task.channel, done: false })
          .catch((e) => console.warn('[LinkedIn] Could not note what the visit saw:', e?.message || e));
      }
    }

    const attempts = task.attempts || 1;
    if (attempts >= LINKEDIN_TASK_MAX_ATTEMPTS) {
      const skipped = await skipChannelTask(taskId, 'agent_failed',
        `Skipped after ${attempts} attempts: ${why || 'the agent could not complete it'}`);
      return { ok: true, paused: false, skipped };
    }

    // 1 day after the first failure, 2 after the second: a profile that
    // failed to load at 10am will fail again at 10:02.
    const backoffDays = 2 ** Math.max(0, attempts - 1);
    const { error } = await supabaseAdmin
      .from('crm_tasks')
      .update({
        locked_until: null,
        last_error: why,
        due_date: new Date(Date.now() + backoffDays * 24 * 60 * 60_000).toISOString(),
      })
      .eq('id', taskId)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    return { ok: true, paused: false, retry_in_days: backoffDays };
  },

  /**
   * The outcome of an upkeep action: an acceptance check, a withdrawal or
   * an inbox read. These have no task row; the contact (or, for the inbox,
   * the watchlist) is what they are about, and both are checked to belong
   * to this account before anything is written.
   */
  async report(userId: string, body: any) {
    const kind = String(body?.kind || '');
    const result = (body?.result && typeof body.result === 'object') ? body.result : {};
    if (!['check', 'withdraw', 'inbox'].includes(kind)) throw new AppError('Unknown report kind', 400);

    const s = await this.getSettings(userId);
    if (!has095(s)) throw new AppError('LinkedIn upkeep needs database migration 095_linkedin_autopilot.sql.', 503);

    let contact: { id: string; first_name: string | null; last_name: string | null; linkedin_invite_status: string | null } | null = null;
    if (kind !== 'inbox') {
      const id = String(body?.contact_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('contact_id is required', 400);
      const { data } = await supabaseAdmin
        .from('contacts')
        .select('id, first_name, last_name, linkedin_invite_status')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!data) throw new AppError('Contact not found', 404);
      contact = data as any;
    }
    const name = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null : null;
    const why = String(result.reason || '').slice(0, 500);

    // The account, not the person: stop everything, as for a step. The look
    // is handed back so it happens soon after the user resumes.
    const accountKind = ['logged_out', 'restricted', 'weekly_limit'].includes(result.kind)
      ? result.kind
      : (result.fatal ? 'restricted' : null);
    if (accountKind) {
      if (contact) {
        await supabaseAdmin.from('contacts').update({ linkedin_checked_at: null })
          .eq('id', contact.id).eq('user_id', userId);
      }
      if (kind === 'inbox') {
        await supabaseAdmin.from('linkedin_settings').update({ last_inbox_read_at: null }).eq('user_id', userId);
      }
      await this.pauseForAccount(userId, accountKind, why);
      return { ok: true, paused: true };
    }

    if (kind === 'inbox') {
      if (result.ok !== true) {
        await this.log(userId, { kind: 'inbox', outcome: 'failed', detail: why || 'Could not read the LinkedIn inbox' });
        return { ok: true };
      }
      await this.record(userId, s, 'linkedin_inbox');
      const { stored, replies } = await ingestLinkedinReplies(
        userId, (Array.isArray(result.conversations) ? result.conversations : []) as ReportedConversation[],
      );
      await this.log(userId, {
        kind: 'inbox', outcome: 'done',
        detail: replies > 0
          ? `${replies} new repl${replies === 1 ? 'y' : 'ies'} on LinkedIn, now in your inbox`
          : stored > 0 ? `${stored} new message${stored === 1 ? '' : 's'} on LinkedIn` : 'No new LinkedIn replies',
      });
      return { ok: true, stored, replies };
    }

    const c = contact!;
    if (result.ok !== true) {
      await this.log(userId, {
        kind, outcome: 'failed', contact_id: c.id, contact_name: name,
        detail: why || (kind === 'withdraw' ? 'Could not withdraw the invite' : 'Could not check the invite'),
      });
      return { ok: true };
    }

    const state = String(result.state || '');
    await this.record(userId, s, kind === 'withdraw' && state === 'withdrawn' && !result.already ? 'linkedin_withdraw' : 'linkedin_check');

    if (state === 'accepted') {
      await this.markAccepted(userId, c.id, name);
    } else if (state === 'withdrawn' || state === 'not_connected') {
      // Withdrawn by the agent, or Connect is back on the card: either way
      // there is no invite out any more.
      await supabaseAdmin.from('contacts')
        .update({ linkedin_invite_status: 'withdrawn', linkedin_withdrawn_at: new Date().toISOString() })
        .eq('id', c.id).eq('user_id', userId)
        .eq('linkedin_invite_status', 'pending');
      await this.log(userId, {
        kind, outcome: kind === 'withdraw' ? 'done' : 'skipped', contact_id: c.id, contact_name: name,
        detail: kind === 'withdraw' && state === 'withdrawn' && !result.already
          ? `Withdrew an invite pending more than ${s.withdraw_after_days ?? LINKEDIN_WITHDRAW_AFTER_DAYS_DEFAULT} days`
          : 'No invite pending any more',
      });
    } else if (kind === 'withdraw' && state === 'pending') {
      await this.log(userId, {
        kind, outcome: 'failed', contact_id: c.id, contact_name: name,
        detail: why || 'The invite still shows as pending; will try again later',
      });
    } else if (state === 'pending') {
      await this.log(userId, { kind, outcome: 'skipped', contact_id: c.id, contact_name: name, detail: 'Still pending' });
    }

    const facts = cleanFacts(result.profile);
    if (facts) {
      if (facts.degree === 1 && state !== 'accepted') await this.markAccepted(userId, c.id, name);
      await this.enrich(userId, s, c.id, name, facts);
    }
    return { ok: true };
  },

  /**
   * What the agent has been doing, newest first: campaign steps it was
   * given (queued, done, skipped and why) and its own upkeep. This is the
   * LinkedIn page's activity log, and the reason LinkedIn steps no longer
   * need to sit in the to-do list while the agent is handling them.
   */
  async activity(userId: string, limit = 60) {
    const n = Math.max(1, Math.min(200, Math.floor(Number(limit) || 60)));
    const { data: tasks, error } = await supabaseAdmin
      .from('crm_tasks')
      .select('id, channel, contact_id, contact_name, is_done, completed_at, created_at, due_date, last_error, attempts')
      .eq('user_id', userId)
      .not('channel', 'is', null)
      .order('created_at', { ascending: false })
      .limit(n);
    if (error) throw new AppError(error.message, 500);

    const { data: logRows, error: logErr } = await supabaseAdmin
      .from('linkedin_agent_log')
      .select('id, kind, contact_id, contact_name, outcome, detail, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(n);
    if (logErr && !COLUMNS_095.test(logErr.message || '') && (logErr as any).code !== '42P01') {
      throw new AppError(logErr.message, 500);
    }

    const items = [
      ...(tasks || []).map((t: any) => {
        const state = !t.is_done ? 'queued' : t.last_error ? 'skipped' : 'done';
        return {
          id: `task:${t.id}`,
          at: (t.is_done ? t.completed_at : null) || t.created_at,
          kind: String(t.channel).replace(/^linkedin_/, ''),
          state,
          contact_id: t.contact_id,
          contact_name: t.contact_name,
          detail: state === 'queued'
            ? (t.last_error ? `Will retry: ${t.last_error}` : t.due_date && new Date(t.due_date) > new Date() ? 'Waiting for its turn' : 'Next in line')
            : t.last_error || null,
        };
      }),
      ...((logErr ? [] : logRows) || []).map((r: any) => ({
        id: `log:${r.id}`,
        at: r.created_at,
        kind: r.kind,
        state: r.outcome,
        contact_id: r.contact_id,
        contact_name: r.contact_name,
        detail: r.detail,
      })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, n);

    return { items };
  },

  /** Queue depth and today's tally, for the settings page. */
  async status(userId: string) {
    const s = await this.getSettings(userId);
    const { count } = await supabaseAdmin
      .from('crm_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_done', false)
      .not('channel', 'is', null);

    const used = this.usage(s);
    const seenMs = s.last_seen_at ? Date.now() - new Date(s.last_seen_at).getTime() : Infinity;

    // Invites in flight and accepted in the last month, for the page.
    let invites: { pending: number; accepted_30d: number } | null = null;
    if (has095(s)) {
      const [pending, accepted] = await Promise.all([
        supabaseAdmin.from('contacts').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('linkedin_invite_status', 'pending'),
        supabaseAdmin.from('contacts').select('id', { count: 'exact', head: true })
          .eq('user_id', userId).eq('linkedin_invite_status', 'accepted')
          .gte('linkedin_connected_at', new Date(Date.now() - 30 * 86_400_000).toISOString()),
      ]);
      if (!pending.error && !accepted.error) {
        invites = { pending: pending.count || 0, accepted_30d: accepted.count || 0 };
      }
    }

    return {
      settings: s,
      queued: count || 0,
      today: {
        connects: used.linkedin_connect,
        messages: used.linkedin_message,
        visits: used.linkedin_visit,
        checks: used.linkedin_check,
        withdrawals: used.linkedin_withdraw,
        inbox_reads: used.linkedin_inbox,
        enrichments: used.linkedin_enrich,
      },
      /** null before migration 093. */
      week: used.connects_this_week === null ? null : { connects: used.connects_this_week },
      /** A restriction or sign-out pause waiting for the user to look. */
      needs_resume: !!s.pause_kind && MANUAL_PAUSE_KINDS.has(s.pause_kind),
      /** The extension checks in every minute; treat 3 as "still there". */
      connected: seenMs < 3 * 60_000,
      /**
       * On, and nothing heard for long enough that Chrome is closed or the
       * extension is off. LinkedIn steps wait until it is back.
       */
      offline: !!s.enabled && seenMs > LINKEDIN_AGENT_OFFLINE_MINUTES * 60_000,
      /** Whether the extension has ever checked in at all. */
      ever_connected: !!s.last_seen_at,
      /** Acceptance checks, inbox reads, withdrawals, enrichment: false before 095. */
      upkeep: has095(s),
      invites,
    };
  },
};

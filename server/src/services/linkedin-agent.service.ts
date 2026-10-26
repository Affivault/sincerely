import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { resumeAfterTask } from './sequence.service.js';
import { skipChannelTask } from './channel-tasks.service.js';
import { partsInTimezone, localDateString } from '../utils/timezone.js';
import {
  normalizeLinkedinUrl, isLinkedinProfileUrl, LINKEDIN_TASK_MAX_ATTEMPTS,
  LINKEDIN_WEEKLY_CONNECT_MAX,
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
   ═══════════════════════════════════════════════════════════════════════ */

const SETTINGS_KEYS = [
  'enabled', 'daily_connect_limit', 'daily_message_limit', 'daily_visit_limit',
  'min_gap_seconds', 'max_gap_seconds', 'work_start', 'work_end', 'work_days',
  'timezone', 'paused_until', 'pause_reason',
  // From migration 093.
  'weekly_connect_limit', 'skip_task_after_days',
] as const;

/** Columns 093 adds. A database without them still runs the agent, minus these. */
const COLUMNS_093 = /weekly_connect_limit|skip_task_after_days|pause_kind|connects_this_week|week_start/;

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
};

const ACTION_LIMIT: Record<string, { limit: keyof Settings; used: keyof Settings }> = {
  linkedin_connect: { limit: 'daily_connect_limit', used: 'connects_today' },
  linkedin_message: { limit: 'daily_message_limit', used: 'messages_today' },
  linkedin_visit: { limit: 'daily_visit_limit', used: 'visits_today' },
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
}

interface Usage {
  linkedin_connect: number;
  linkedin_message: number;
  linkedin_visit: number;
  /** null before migration 093, which is where the weekly counter lives. */
  connects_this_week: number | null;
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

    let { data, error } = await supabaseAdmin
      .from('linkedin_settings')
      .update(patch)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error && COLUMNS_093.test(error.message || '')) {
      // Before 093 the weekly cap and the skip delay have nowhere to live,
      // and saying so beats a 500. A resume only needs pause_kind dropped.
      if (patch.weekly_connect_limit !== undefined || patch.skip_task_after_days !== undefined) {
        throw new AppError('The weekly invite cap and task skipping need database migration 093_linkedin_agent_hardening.sql. Run it in Supabase, then save again.', 503);
      }
      const { pause_kind: _drop, ...rest } = patch;
      if (Object.keys(rest).length === 0) throw new AppError('Nothing to update', 400);
      ({ data, error } = await supabaseAdmin
        .from('linkedin_settings').update(rest).eq('user_id', userId).select('*').single());
    }
    if (error) throw new AppError(error.message, 500);
    return data as Settings;
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
    return {
      linkedin_connect: fresh ? s.connects_today : 0,
      linkedin_message: fresh ? s.messages_today : 0,
      linkedin_visit: fresh ? s.visits_today : 0,
      connects_this_week: s.weekly_connect_limit === undefined ? null : (weekFresh ? s.connects_this_week || 0 : 0),
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

  /**
   * Everything the extension needs to decide what to do, including the
   * reason when the answer is "nothing". Explaining the wait is what stops
   * a quiet agent looking like a broken one.
   */
  async nextAction(userId: string) {
    const s = await this.getSettings(userId);

    await supabaseAdmin
      .from('linkedin_settings')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('user_id', userId);

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

    if (capped.length === Object.keys(ACTION_LIMIT).length) {
      return { action: null, reason: 'daily_limit_reached', used, gap };
    }

    const lease = leaseSecondsFor(s);

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
    if (!task) {
      return { action: null, reason: 'nothing_due', used, gap };
    }

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
        channel: task.channel,
        /** The profile to open. Nothing here identifies the user's session. */
        profile_url: profileUrl,
        /** Already personalised — the extension types it, it doesn't compose. */
        message: task.payload || null,
        contact_name: task.contact_name,
        title: task.title,
      },
      used,
      gap,
      /** How long this claim holds; the extension must act inside it. */
      lease_seconds: lease,
    };
  },

  /** The action happened. Count it, close the task, let the sequence move on. */
  async complete(userId: string, taskId: string) {
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
      .select('id, channel, campaign_contact_id')
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!task) {
      // A retried "done" (network timeout) must not count the action twice.
      const { data: existing } = await supabaseAdmin
        .from('crm_tasks').select('id').eq('id', taskId).eq('user_id', userId).maybeSingle();
      if (!existing) throw new AppError('Task not found', 404);
      return { ok: true };
    }

    if (task.channel) {
      const s = await this.getSettings(userId);
      const { error: rpcErr } = await supabaseAdmin.rpc('record_linkedin_action', {
        uid: userId,
        action: task.channel,
        local_date: localDateString(s.timezone || 'UTC'),
      });
      if (rpcErr) console.error(`[LinkedIn] Could not count ${task.channel} for ${userId}: ${rpcErr.message}`);
    }
    if (task.campaign_contact_id) {
      // Never let a bookkeeping failure look like the action failed — the
      // invite has already been sent by the time we get here.
      resumeAfterTask(taskId).catch((e) =>
        console.warn('[LinkedIn] sequence resume failed:', e?.message));
    }
    return { ok: true };
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
  async fail(userId: string, taskId: string, reason: string, fatal = false, kind?: string | null) {
    const why = String(reason || '').slice(0, 500);
    const { data: task, error: readErr } = await supabaseAdmin
      .from('crm_tasks')
      .select('id, attempts, is_done')
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

      if (accountKind === 'logged_out') {
        await this.pause(userId, 'logged_out',
          'LinkedIn is signed out in your browser. Sign in, then resume here.', MANUAL_PAUSE_MS);
      } else if (accountKind === 'weekly_limit') {
        // LinkedIn's own weekly ceiling. Nothing to check, just wait it out.
        await this.pause(userId, null, why || 'LinkedIn weekly invitation limit reached', MANUAL_PAUSE_MS);
      } else {
        await this.pause(userId, 'restricted', why || 'LinkedIn asked for verification', MANUAL_PAUSE_MS);
      }
      return { ok: true, paused: true };
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
    return {
      settings: s,
      queued: count || 0,
      today: {
        connects: used.linkedin_connect,
        messages: used.linkedin_message,
        visits: used.linkedin_visit,
      },
      /** null before migration 093. */
      week: used.connects_this_week === null ? null : { connects: used.connects_this_week },
      /** A restriction or sign-out pause waiting for the user to look. */
      needs_resume: !!s.pause_kind && MANUAL_PAUSE_KINDS.has(s.pause_kind),
      /** The extension checks in every minute; treat 3 as "still there". */
      connected: !!s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < 3 * 60_000,
    };
  },
};

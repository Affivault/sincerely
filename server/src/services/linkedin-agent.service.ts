import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { resumeAfterTask } from './sequence.service.js';
import { partsInTimezone } from '../utils/timezone.js';

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
] as const;

/** Nothing outside these bounds is worth letting a client set. */
const BOUNDS: Record<string, [number, number]> = {
  daily_connect_limit: [0, 40],
  daily_message_limit: [0, 100],
  daily_visit_limit: [0, 200],
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

    const { data, error } = await supabaseAdmin
      .from('linkedin_settings')
      .update(patch)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) throw new AppError(error.message, 500);
    return data as Settings;
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

    // Today's allowance. A stale counters_date means the row hasn't been
    // touched today, so nothing has been used today either.
    const fresh = s.counters_date === new Date().toISOString().slice(0, 10);
    const used = {
      linkedin_connect: fresh ? s.connects_today : 0,
      linkedin_message: fresh ? s.messages_today : 0,
      linkedin_visit: fresh ? s.visits_today : 0,
    };
    const capped = (channel: string) => {
      const map = ACTION_LIMIT[channel];
      if (!map) return true;
      return (used as any)[channel] >= (s as any)[map.limit];
    };

    if (Object.keys(ACTION_LIMIT).every(capped)) {
      return { action: null, reason: 'daily_limit_reached', used, gap };
    }

    const { data, error } = await supabaseAdmin.rpc('claim_linkedin_task', {
      uid: userId,
      lease_seconds: 300,
    });
    if (error) throw new AppError(error.message, 500);

    const task = Array.isArray(data) ? data[0] : data;
    if (!task) return { action: null, reason: 'nothing_due', used, gap };

    // The claim doesn't know about per-channel caps, so a task for a maxed-out
    // channel can still come back. Give the lease straight back rather than
    // holding a row hostage for five minutes.
    if (capped(task.channel)) {
      await supabaseAdmin
        .from('crm_tasks')
        .update({ locked_until: null, attempts: Math.max(0, (task.attempts || 1) - 1) })
        .eq('id', task.id);
      return { action: null, reason: 'daily_limit_reached', used, gap };
    }

    return {
      action: {
        task_id: task.id,
        channel: task.channel,
        /** The profile to open. Nothing here identifies the user's session. */
        profile_url: task.target_url,
        /** Already personalised — the extension types it, it doesn't compose. */
        message: task.payload || null,
        contact_name: task.contact_name,
        title: task.title,
      },
      used,
      gap,
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
      .select('id, channel, campaign_contact_id')
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!task) throw new AppError('Task not found', 404);

    if (task.channel) {
      await supabaseAdmin.rpc('record_linkedin_action', { uid: userId, action: task.channel });
    }
    if (task.campaign_contact_id) {
      // Never let a bookkeeping failure look like the action failed — the
      // invite has already been sent by the time we get here.
      resumeAfterTask(taskId).catch((e) =>
        console.warn('[LinkedIn] sequence resume failed:', e?.message));
    }
    return { ok: true };
  },

  /**
   * It didn't happen. Release the lease so it can be retried, and record why.
   * `fatal` means stop the whole agent — a LinkedIn checkpoint or a warning
   * page is not something to retry into.
   */
  async fail(userId: string, taskId: string, reason: string, fatal = false) {
    const { error } = await supabaseAdmin
      .from('crm_tasks')
      .update({ locked_until: null, last_error: String(reason || '').slice(0, 500) })
      .eq('id', taskId)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);

    if (fatal) {
      // An hour, not a day: long enough for a challenge to be cleared by hand,
      // short enough that a false positive doesn't cost the afternoon.
      await supabaseAdmin
        .from('linkedin_settings')
        .update({
          paused_until: new Date(Date.now() + 60 * 60_000).toISOString(),
          pause_reason: String(reason || 'LinkedIn asked for verification').slice(0, 200),
        })
        .eq('user_id', userId);
    }
    return { ok: true, paused: fatal };
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

    const fresh = s.counters_date === new Date().toISOString().slice(0, 10);
    return {
      settings: s,
      queued: count || 0,
      today: {
        connects: fresh ? s.connects_today : 0,
        messages: fresh ? s.messages_today : 0,
        visits: fresh ? s.visits_today : 0,
      },
      /** The extension checks in every minute; treat 3 as "still there". */
      connected: !!s.last_seen_at && Date.now() - new Date(s.last_seen_at).getTime() < 3 * 60_000,
    };
  },
};

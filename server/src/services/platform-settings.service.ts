import { supabaseAdmin } from '../config/supabase.js';
import {
  CREDIT_PRICES, PLANS,
  type CreditAction, type PlanId, type PlanOverride, type PlatformSettings, type PublicPlatformInfo, type SignupMode,
} from '@lemlist/shared';

/*
 * Platform settings: what the owners change from the admin backend without
 * a deploy. Plan limits, credit prices, who can sign up, an announcement,
 * and a switch that stops all sending.
 *
 * Plans and prices are applied by writing over the shared PLANS and
 * CREDIT_PRICES in place, so every reader of them (limits, charges, the
 * price list) sees the owners' numbers with no change of its own. The
 * defaults are kept here to put back whatever is cleared.
 *
 * Read from platform_settings (migration 102) every 30 seconds and right
 * after a save. Before the migration, or if the read fails, the platform
 * runs on its defaults, which is what it did before.
 */

const REFRESH_MS = 30_000;
const KEYS = ['plans', 'credit_prices', 'signups', 'announcement', 'kill_switch'] as const;
type Key = typeof KEYS[number];

const DEFAULT_PLANS: Record<PlanId, Required<PlanOverride>> = Object.fromEntries(
  (Object.keys(PLANS) as PlanId[]).map((id) => [id, { maxInboxes: PLANS[id].maxInboxes, emailsPerMonth: PLANS[id].emailsPerMonth, prospectCredits: PLANS[id].prospectCredits }]),
) as Record<PlanId, Required<PlanOverride>>;
const DEFAULT_PRICES: Record<CreditAction, number> = { ...CREDIT_PRICES };

export const EMPTY_SETTINGS: PlatformSettings = {
  plans: {},
  credit_prices: {},
  signups: { mode: 'open', allow: [] },
  announcement: null,
  kill_switch: null,
};

let current: PlatformSettings = structuredClone(EMPTY_SETTINGS);
let updated: Partial<Record<Key, { by: string | null; at: string }>> = {};
let ready = false;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

function apply(s: PlatformSettings) {
  for (const id of Object.keys(PLANS) as PlanId[]) {
    Object.assign(PLANS[id], DEFAULT_PLANS[id], s.plans[id] || {});
  }
  Object.assign(CREDIT_PRICES, DEFAULT_PRICES, s.credit_prices || {});
}

async function load(): Promise<void> {
  const { data, error } = await supabaseAdmin.from('platform_settings').select('key, value, updated_by, updated_at');
  loadedAt = Date.now();
  if (error) {
    // Missing table (102 not run): the defaults stand.
    if (!/platform_settings/.test(error.message || '')) console.warn(`[platform] settings read failed: ${error.message}`);
    ready = false;
    return;
  }
  const next: PlatformSettings = structuredClone(EMPTY_SETTINGS);
  const stamps: typeof updated = {};
  for (const row of data || []) {
    if (!(KEYS as readonly string[]).includes(row.key)) continue;
    (next as any)[row.key] = row.value ?? (EMPTY_SETTINGS as any)[row.key];
    stamps[row.key as Key] = { by: row.updated_by ?? null, at: row.updated_at };
  }
  if (!next.signups || !['open', 'invite', 'closed'].includes(next.signups.mode)) next.signups = { mode: 'open', allow: [] };
  current = next;
  updated = stamps;
  ready = true;
  apply(current);
}

function refresh(): Promise<void> {
  if (!inflight) inflight = load().catch((e) => { console.warn(`[platform] settings read failed: ${e?.message || e}`); }).finally(() => { inflight = null; });
  return inflight;
}

if (process.env.NODE_ENV !== 'test') {
  setInterval(() => { void refresh(); }, REFRESH_MS).unref();
}

export const platformSettings = {
  /** Fresh enough for anything: waits for a first read, refreshes when stale. */
  async get(): Promise<PlatformSettings> {
    if (!loadedAt || Date.now() - loadedAt > REFRESH_MS) await refresh();
    return current;
  },

  /** The last read, without waiting. For hot paths; the timer keeps it fresh. */
  snapshot(): PlatformSettings {
    if (!loadedAt) void refresh();
    return current;
  },

  isReady: () => ready,
  updatedStamps: () => updated,
  defaults: () => ({ plans: DEFAULT_PLANS, credit_prices: DEFAULT_PRICES }),

  /** Write one setting and apply it at once on this server; the others pick it up within 30 seconds. */
  async save(key: Key, value: unknown, by: string): Promise<void> {
    const { error } = value === null
      ? await supabaseAdmin.from('platform_settings').delete().eq('key', key)
      : await supabaseAdmin.from('platform_settings').upsert({ key, value, updated_by: by, updated_at: new Date().toISOString() });
    if (error) throw error;
    await load();
  },

  async sendingKilled(): Promise<boolean> {
    return !!(await this.get()).kill_switch;
  },

  async signupMode(): Promise<SignupMode> {
    return (await this.get()).signups.mode;
  },

  async publicInfo(): Promise<PublicPlatformInfo> {
    const s = await this.get();
    return {
      signups: s.signups.mode,
      announcement: s.announcement,
      credit_prices: { ...CREDIT_PRICES },
      plans: Object.fromEntries((Object.keys(PLANS) as PlanId[]).map((id) => [id, { maxInboxes: PLANS[id].maxInboxes, emailsPerMonth: PLANS[id].emailsPerMonth, prospectCredits: PLANS[id].prospectCredits }])) as PublicPlatformInfo['plans'],
    };
  },

  /** For tests: forget everything and put the defaults back. */
  reset() {
    current = structuredClone(EMPTY_SETTINGS);
    updated = {};
    ready = false;
    loadedAt = 0;
    apply(current);
  },
};

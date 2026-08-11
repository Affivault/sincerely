import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { stripeService } from './stripe.service.js';
import type { SenderIdentity } from '@lemlist/shared';

export interface UserSettings {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  company: string;
  job_title: string;
  timezone: string;
  email_notifications: boolean;
  campaign_alerts: boolean;
  reply_notifications: boolean;
  weekly_digest: boolean;
  default_signature: string;
  theme: string;
  sara_enabled: boolean;
  sara_auto_classify: boolean;
  sara_auto_execute: boolean;
  sara_confidence_threshold: number;
  sara_auto_unsubscribe: boolean;
  sara_auto_bounce: boolean;
  sara_draft_replies: boolean;
  ai_tagging_enabled: boolean;
  auto_verify_contacts: boolean;
  /** SARA auto-creates a CRM deal when a reply is interested/meeting */
  crm_auto_deals: boolean;
  created_at: string;
  updated_at: string;
}

const DEFAULTS: Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  first_name: '',
  last_name: '',
  company: '',
  job_title: '',
  timezone: 'America/New_York',
  email_notifications: true,
  campaign_alerts: true,
  reply_notifications: true,
  weekly_digest: false,
  default_signature: '',
  theme: 'system',
  sara_enabled: true,
  sara_auto_classify: true,
  sara_auto_execute: true,
  sara_confidence_threshold: 85,
  sara_auto_unsubscribe: true,
  sara_auto_bounce: true,
  sara_draft_replies: true,
  ai_tagging_enabled: true,
  auto_verify_contacts: true,
  crm_auto_deals: true,
};

/** Columns a client may write. Everything else (id, user_id, timestamps —
 *  or any unknown key) is dropped so a crafted payload can't touch them. */
const UPDATABLE_KEYS = new Set(Object.keys(DEFAULTS));

/**
 * When code ships before its migration, a write can hit a column that doesn't
 * exist yet ("column X of relation user_settings does not exist"). Strip the
 * offending key and report it so the caller can retry instead of failing the
 * whole settings save.
 */
function stripMissingColumn(errorMessage: string, obj: Record<string, any>): boolean {
  const m = /column "([a-zA-Z0-9_]+)"/.exec(errorMessage || '');
  if (m && m[1] in obj) {
    delete obj[m[1]];
    return true;
  }
  return false;
}

export const settingsService = {
  async get(userId: string): Promise<UserSettings> {
    const { data, error } = await supabaseAdmin
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No row found — create default settings for this user. Retry with
      // fewer keys when a default targets a not-yet-migrated column.
      const row: Record<string, any> = { user_id: userId, ...DEFAULTS };
      for (let attempt = 0; attempt < 4; attempt++) {
        const { data: newRow, error: insertError } = await supabaseAdmin
          .from('user_settings')
          .insert(row)
          .select('*')
          .single();
        if (!insertError) return { ...DEFAULTS, ...(newRow as any) } as UserSettings;
        if (!stripMissingColumn(insertError.message, row)) {
          throw new AppError(insertError.message, 500);
        }
      }
      throw new AppError('Failed to create settings', 500);
    }

    if (error) throw new AppError(error.message, 500);
    // Overlay defaults so not-yet-migrated columns still come back typed.
    return { ...DEFAULTS, ...(data as any) } as UserSettings;
  },

  async update(userId: string, updates: Partial<Omit<UserSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>): Promise<UserSettings> {
    // Ensure the row exists first (upsert-like pattern)
    await settingsService.get(userId);

    // Only known settings columns may be written — a crafted payload can't
    // touch id/user_id/timestamps or anything else.
    const filtered: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates as Record<string, any>)) {
      if (UPDATABLE_KEYS.has(key)) filtered[key] = value;
    }
    if (Object.keys(filtered).length === 0) return settingsService.get(userId);

    // The name and company behind {{sender_*}} may have just changed.
    invalidateSenderIdentity(userId);

    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await supabaseAdmin
        .from('user_settings')
        .update(filtered)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (!error) return { ...DEFAULTS, ...(data as any) } as UserSettings;
      if (!stripMissingColumn(error.message, filtered) || Object.keys(filtered).length === 0) {
        throw new AppError(error.message, 500);
      }
    }
    throw new AppError('Failed to update settings', 500);
  },

  async deleteAccount(userId: string): Promise<void> {
    // Block deletion for an org owner with real teammates — organizations.owner_id
    // is ON DELETE CASCADE, so deleting the owner's auth user would silently
    // dissolve the whole team's membership (and pending invites) with no
    // reassignment or warning. A solo/personal org (no other members) is fine —
    // the cascade cleans it up with nothing left to reassign.
    const { data: membership } = await supabaseAdmin
      .from('team_members')
      .select('id, org_id, role')
      .eq('user_id', userId)
      .maybeSingle();

    if (membership?.role === 'owner') {
      const { count } = await supabaseAdmin
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', membership.org_id)
        .neq('user_id', userId);
      if (count && count > 0) {
        throw new AppError(
          'You own a team with other members. Transfer ownership or remove all teammates before deleting your account.',
          400,
        );
      }
    } else if (membership) {
      // team_members.user_id is ON DELETE SET NULL (not CASCADE), so leaving it
      // to the FK would leave a permanent orphaned row — nulled user_id, stale
      // email/role — visible forever in the remaining team's member list.
      await supabaseAdmin.from('team_members').delete().eq('id', membership.id);
    }

    // Cancel any live Stripe subscription BEFORE wiping billing rows — once the
    // subscriptions row is gone the customer→user mapping is lost, and a still-
    // active Stripe subscription would keep charging someone with no account.
    try {
      await stripeService.cancelAllSubscriptionsForUser(userId);
    } catch (err: any) {
      throw new AppError(
        `Could not cancel your subscription (${err.message}). Your account was NOT deleted — ` +
          'please try again, or cancel via Manage billing first.',
        502,
      );
    }

    // Delete user settings
    await supabaseAdmin.from('user_settings').delete().eq('user_id', userId);

    // webhook_deliveries has no user_id column — must delete by endpoint_id first
    const { data: userEndpoints } = await supabaseAdmin
      .from('webhook_endpoints')
      .select('id')
      .eq('user_id', userId);
    if (userEndpoints && userEndpoints.length > 0) {
      await supabaseAdmin
        .from('webhook_deliveries')
        .delete()
        .in('endpoint_id', userEndpoints.map((e: any) => e.id));
    }

    // Delete user data from all tables (order matters for foreign keys).
    // campaign_smtp_accounts, contact_tags, list_contacts, campaign_activities,
    // campaign_contacts, and campaign_steps are all join/child tables with no
    // user_id column of their own — they cascade automatically via their
    // campaign_id/contact_id/tag_id/list_id FKs when the rows below (campaigns,
    // contacts, tags, contact_lists) are deleted, so they must NOT be queried
    // by user_id here (that query errors on every call).
    const tables = [
      'campaigns',
      'contact_lists',
      'saved_segments',
      'contacts',
      'tags',
      'inbox_messages',
      'smtp_accounts',
      'sending_domains',
      'email_templates',
      'sequence_templates',
      'asset_templates',
      'suppression_list',
      'warmup_emails',
      'webhook_endpoints',
      'api_keys',
      'usage_counters',
      'subscriptions',
      'deals',
      'crm_tasks',
      'crm_events',
      'prospect_credit_ledger',
      'prospect_reveals',
    ];

    const failedTables: string[] = [];
    for (const table of tables) {
      const { error: deleteError } = await supabaseAdmin.from(table).delete().eq('user_id', userId);
      if (deleteError) failedTables.push(`${table} (${deleteError.message})`);
    }

    if (failedTables.length > 0) {
      // Don't destroy the auth identity if any table failed to delete — otherwise
      // the user is told their account is gone while their data silently survives
      // with no owner left to reconcile it back to.
      throw new AppError(
        `Account deletion incomplete — failed to delete: ${failedTables.join(', ')}. ` +
          'Your login was NOT removed; please try again or contact support.',
        500,
      );
    }

    // Delete the auth user via Supabase admin
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new AppError(`Failed to delete auth user: ${error.message}`, 500);
  },

  /**
   * Who the `{{sender_*}}` tags refer to.
   *
   * Read once per send, so it is memoised briefly — settings change rarely
   * and a minute of staleness on a signature name costs nothing, whereas a
   * round trip per recipient on an eight-hundred-contact campaign does.
   * Never throws: a missing settings row must not stop a campaign, it just
   * means those tags fall back to whatever the copy says after the pipe.
   */
  async senderIdentity(userId: string): Promise<SenderIdentity> {
    const cached = senderCache.get(userId);
    if (cached && cached.expires > Date.now()) return cached.value;

    let value: SenderIdentity = {};
    try {
      const { data } = await supabaseAdmin
        .from('user_settings')
        .select('first_name, last_name, company')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) {
        value = {
          name: [data.first_name, data.last_name].filter(Boolean).join(' ').trim() || null,
          company: data.company || null,
        };
      }
    } catch {
      // Fall through with an empty identity.
    }

    senderCache.set(userId, { value, expires: Date.now() + SENDER_CACHE_MS });
    return value;
  },
};

const SENDER_CACHE_MS = 60_000;
const senderCache = new Map<string, { value: SenderIdentity; expires: number }>();

/** Drop a user's memoised sender identity after they edit their profile. */
export function invalidateSenderIdentity(userId: string): void {
  senderCache.delete(userId);
}

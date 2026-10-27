import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { bookingMail } from './booking-mail.service.js';
import {
  ROUND_ROBIN_MAX_HOSTS, ROUND_ROBIN_WINDOW_DAYS, hostIsBookable,
  type BookingLinkHost, type RoundRobinStatus, type HostedRoundRobinLink,
  type RoundRobinStrategy, type RankableHost,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Team round-robin booking (097).

   A team setting, off unless an owner or admin switches it on. While it is
   off a round-robin link takes no bookings at all - it does not fall back
   to its owner, because "everything quietly goes to one person" is the one
   outcome nobody who set up a rota would want.

   Who may host is decided here, every time, from the team as it is now:
   a teammate who has left stops being offered the moment they leave,
   whatever is still stored against the link.
   ═══════════════════════════════════════════════════════════════════════ */

const MIGRATION = '097_round_robin_booking.sql';

/** Postgres or PostgREST saying an object from 097 is not there. */
export function missing097(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return ['PGRST202', 'PGRST205', 'PGRST204', '42P01', '42703'].includes(error.code || '')
    || (/round_robin|booking_link_hosts|assignment/.test(error.message || '')
        && /does not exist|could not find|schema cache/i.test(error.message || ''));
}

function needs097(): AppError {
  return new AppError(`Round-robin booking needs database migration ${MIGRATION} - run it in Supabase, then reload.`, 503);
}

interface OrgContext {
  orgId: string;
  orgName: string;
  role: 'owner' | 'admin' | 'member';
  isOrgOwner: boolean;
  enabled: boolean;
}

/** The team a user belongs to, and whether round robin is on for it. */
async function orgOf(userId: string): Promise<OrgContext | null> {
  const { data, error } = await supabaseAdmin
    .from('team_members')
    .select('org_id, role, organizations (id, name, owner_id, round_robin_enabled)')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (missing097(error)) {
      // Before 097 the switch does not exist, and a missing switch is "off".
      const { data: plain } = await supabaseAdmin
        .from('team_members')
        .select('org_id, role, organizations (id, name, owner_id)')
        .eq('user_id', userId)
        .maybeSingle();
      const o = (plain as any)?.organizations;
      if (!plain || !o) return null;
      return {
        orgId: o.id, orgName: o.name || '', role: (plain as any).role,
        isOrgOwner: o.owner_id === userId, enabled: false,
      };
    }
    throw new AppError(error.message, 500);
  }
  const o = (data as any)?.organizations;
  if (!data || !o) return null;
  return {
    orgId: o.id,
    orgName: o.name || '',
    role: (data as any).role,
    isOrgOwner: o.owner_id === userId,
    enabled: o.round_robin_enabled === true,
  };
}

/** Every teammate with an account, by user id. */
async function teamUserIds(orgId: string): Promise<Map<string, { email: string; role: string }>> {
  const { data, error } = await supabaseAdmin
    .from('team_members')
    .select('user_id, email, role')
    .eq('org_id', orgId)
    .not('user_id', 'is', null);
  if (error) throw new AppError(error.message, 500);
  return new Map((data || []).map((m: any) => [m.user_id as string, { email: m.email, role: m.role }]));
}

/** Display names from settings, for a set of users. Never the login alone. */
async function namesOf(userIds: string[]): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();
  const { data } = await supabaseAdmin
    .from('user_settings')
    .select('user_id, first_name, last_name')
    .in('user_id', userIds);
  return new Map((data || []).map((r: any) => [
    r.user_id as string,
    [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || null,
  ]));
}

/** The link, proven to belong to this user. */
async function ownedLink(userId: string, linkId: string) {
  const { data, error } = await supabaseAdmin
    .from('booking_links')
    .select('id, user_id, archived_at')
    .eq('id', linkId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data || (data as any).archived_at) throw new AppError('No such booking link.', 404);
  return data as { id: string; user_id: string };
}

/** Meetings each host had from a link inside the fairness window. */
async function recentCounts(linkId: string, userIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>(userIds.map((id) => [id, 0]));
  if (userIds.length === 0) return counts;
  const since = new Date(Date.now() - ROUND_ROBIN_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('crm_events')
    .select('user_id')
    .eq('booking_link_id', linkId)
    .in('user_id', userIds)
    .neq('status', 'cancelled')
    .gte('booked_at', since)
    .limit(5000);
  if (error) throw new AppError(error.message, 500);
  for (const row of data || []) {
    const id = (row as any).user_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** What the public side needs to run a round-robin link. */
export interface RoundRobinPlan {
  strategy: RoundRobinStrategy;
  orgName: string;
  /** Hosts who may be offered a meeting right now, with what ranking needs. */
  hosts: RankableHost[];
}

export type RoundRobinBlock = 'team_off' | 'no_hosts';

export const roundRobinService = {
  /** The team switch and the people who could host, for the settings UI. */
  async status(userId: string): Promise<RoundRobinStatus> {
    const org = await orgOf(userId);
    if (!org) return { enabled: false, can_manage: false, members: [] };
    const team = await teamUserIds(org.orgId);
    const names = await namesOf([...team.keys()]);
    return {
      enabled: org.enabled,
      can_manage: org.isOrgOwner || org.role === 'owner' || org.role === 'admin',
      members: [...team.entries()].map(([user_id, m]) => ({
        user_id, email: m.email, role: m.role, name: names.get(user_id) ?? null,
      })),
    };
  },

  /**
   * Switch round robin on or off for the whole team.
   *
   * Off does not touch any link's settings, so switching it back on later
   * picks up exactly where the team left off.
   */
  async setEnabled(userId: string, enabled: boolean): Promise<RoundRobinStatus> {
    const org = await orgOf(userId);
    if (!org) throw new AppError('No team found.', 404);
    if (!(org.isOrgOwner || org.role === 'owner' || org.role === 'admin')) {
      throw new AppError('Only the team owner or an admin can change this.', 403);
    }
    const { error } = await supabaseAdmin
      .from('organizations')
      .update({ round_robin_enabled: !!enabled })
      .eq('id', org.orgId);
    if (error) {
      if (missing097(error)) throw needs097();
      throw new AppError(error.message, 500);
    }
    return this.status(userId);
  },

  /** Whether a user may set a link to round robin at all. */
  async assertCanUse(userId: string): Promise<void> {
    const org = await orgOf(userId);
    if (!org?.enabled) {
      throw new AppError('Round-robin booking is switched off for your team. An owner or admin can switch it on in Team settings.', 403);
    }
  },

  /** A link's hosts, as its owner manages them. */
  async hosts(userId: string, linkId: string): Promise<BookingLinkHost[]> {
    await ownedLink(userId, linkId);
    const { data, error } = await supabaseAdmin
      .from('booking_link_hosts')
      .select('user_id, priority, is_active, host_paused, last_assigned_at')
      .eq('link_id', linkId)
      .order('priority', { ascending: true });
    if (error) {
      if (missing097(error)) return [];
      throw new AppError(error.message, 500);
    }
    const org = await orgOf(userId);
    const team = org ? await teamUserIds(org.orgId) : new Map();
    // A host who has left the team is not shown as if they could still host.
    const rows = (data || []).filter((h: any) => team.has(h.user_id)) as any[];
    const ids = rows.map((h) => h.user_id as string);
    const [names, counts, mail] = await Promise.all([
      namesOf(ids),
      recentCounts(linkId, ids),
      Promise.all(ids.map((id) => bookingMail.canSend(id).catch(() => false))),
    ]);
    return rows.map((h, i) => ({
      user_id: h.user_id,
      priority: h.priority,
      is_active: h.is_active,
      host_paused: h.host_paused,
      last_assigned_at: h.last_assigned_at,
      email: team.get(h.user_id)?.email ?? null,
      name: names.get(h.user_id) ?? null,
      can_email: mail[i],
      recent_bookings: counts.get(h.user_id) ?? 0,
    }));
  },

  /**
   * Replace a link's list of hosts.
   *
   * Everyone named must be on the owner's team now. A host's own pause and
   * their place in the rotation survive the save: the owner editing the
   * list must not quietly unpause somebody who is on holiday, or send the
   * next meeting to whoever just had one.
   */
  async setHosts(userId: string, linkId: string, input: unknown): Promise<BookingLinkHost[]> {
    await ownedLink(userId, linkId);
    await this.assertCanUse(userId);
    if (!Array.isArray(input)) throw new AppError('Send the hosts as a list.', 400);
    if (input.length > ROUND_ROBIN_MAX_HOSTS) {
      throw new AppError(`A round-robin link can have at most ${ROUND_ROBIN_MAX_HOSTS} hosts.`, 400);
    }

    const org = await orgOf(userId);
    const team = org ? await teamUserIds(org.orgId) : new Map();

    const seen = new Set<string>();
    const rows: { link_id: string; user_id: string; priority: number; is_active: boolean }[] = [];
    for (const raw of input as any[]) {
      const id = typeof raw?.user_id === 'string' ? raw.user_id : '';
      if (!id || seen.has(id)) continue;
      if (!team.has(id)) throw new AppError('Every host must be on your team.', 400);
      const priority = Number(raw.priority ?? 1);
      if (!Number.isInteger(priority) || priority < 1 || priority > 100) {
        throw new AppError('A priority is a whole number from 1 to 100.', 400);
      }
      seen.add(id);
      rows.push({ link_id: linkId, user_id: id, priority, is_active: raw.is_active !== false });
    }

    const { data: existing, error: readErr } = await supabaseAdmin
      .from('booking_link_hosts')
      .select('user_id')
      .eq('link_id', linkId);
    if (readErr) {
      if (missing097(readErr)) throw needs097();
      throw new AppError(readErr.message, 500);
    }
    const gone = (existing || []).map((r: any) => r.user_id as string).filter((id) => !seen.has(id));

    if (rows.length > 0) {
      // Upsert names only these columns, so host_paused and last_assigned_at
      // on an existing row are left exactly as they were.
      const { error } = await supabaseAdmin
        .from('booking_link_hosts')
        .upsert(rows, { onConflict: 'link_id,user_id' });
      if (error) throw new AppError(error.message, 500);
    }
    if (gone.length > 0) {
      const { error } = await supabaseAdmin
        .from('booking_link_hosts')
        .delete()
        .eq('link_id', linkId)
        .in('user_id', gone);
      if (error) throw new AppError(error.message, 500);
    }
    return this.hosts(userId, linkId);
  },

  /** The round-robin links this person takes meetings for. */
  async hostedLinks(userId: string): Promise<HostedRoundRobinLink[]> {
    const { data, error } = await supabaseAdmin
      .from('booking_link_hosts')
      .select('link_id, is_active, host_paused, booking_links (id, user_id, headline, slug, assignment, archived_at)')
      .eq('user_id', userId);
    if (error) {
      if (missing097(error)) return [];
      throw new AppError(error.message, 500);
    }
    const rows = (data || []).filter((r: any) =>
      r.booking_links && !r.booking_links.archived_at && r.booking_links.assignment === 'round_robin') as any[];
    if (rows.length === 0) return [];

    // Only links run by somebody still on this person's team.
    const org = await orgOf(userId);
    const team = org ? await teamUserIds(org.orgId) : new Map();
    const live = rows.filter((r) => team.has(r.booking_links.user_id));
    const owners = await namesOf([...new Set(live.map((r) => r.booking_links.user_id as string))]);
    return live.map((r) => ({
      link_id: r.link_id,
      headline: r.booking_links.headline,
      slug: r.booking_links.slug,
      owner_name: owners.get(r.booking_links.user_id) || team.get(r.booking_links.user_id)?.email || 'A teammate',
      host_paused: r.host_paused,
      is_active: r.is_active,
    }));
  },

  /** A host stepping out of (or back into) a link's rotation. */
  async setHostPaused(userId: string, linkId: string, paused: boolean): Promise<HostedRoundRobinLink[]> {
    const { data, error } = await supabaseAdmin
      .from('booking_link_hosts')
      .update({ host_paused: !!paused })
      .eq('link_id', linkId)
      .eq('user_id', userId)
      .select('link_id')
      .maybeSingle();
    if (error) {
      if (missing097(error)) throw needs097();
      throw new AppError(error.message, 500);
    }
    if (!data) throw new AppError('You are not a host on that link.', 404);
    return this.hostedLinks(userId);
  },

  /**
   * What a round-robin link can do right now, for the public page.
   *
   * Returns the hosts who may be offered a meeting, already filtered by
   * both switches and by team membership, or the reason there are none.
   */
  async plan(link: { id: string; user_id: string; round_robin_strategy?: string | null }):
    Promise<RoundRobinPlan | { blocked: RoundRobinBlock }> {
    const org = await orgOf(link.user_id);
    if (!org?.enabled) return { blocked: 'team_off' };

    const { data, error } = await supabaseAdmin
      .from('booking_link_hosts')
      .select('user_id, priority, is_active, host_paused, last_assigned_at')
      .eq('link_id', link.id);
    if (error) {
      if (missing097(error)) return { blocked: 'team_off' };
      throw new AppError(error.message, 500);
    }
    const team = await teamUserIds(org.orgId);
    const usable = (data || []).filter((h: any) => hostIsBookable(h) && team.has(h.user_id)) as any[];
    if (usable.length === 0) return { blocked: 'no_hosts' };

    const counts = await recentCounts(link.id, usable.map((h) => h.user_id));
    return {
      strategy: link.round_robin_strategy === 'priority' ? 'priority' : 'balanced',
      orgName: org.orgName,
      hosts: usable.map((h) => ({
        user_id: h.user_id,
        priority: h.priority,
        recent: counts.get(h.user_id) ?? 0,
        last_assigned_at: h.last_assigned_at,
      })),
    };
  },

  /** Why each of an owner's round-robin links cannot take bookings, if so. */
  async blockedReasons(userId: string, linkIds: string[]): Promise<Map<string, RoundRobinBlock>> {
    const out = new Map<string, RoundRobinBlock>();
    if (linkIds.length === 0) return out;
    const org = await orgOf(userId);
    if (!org?.enabled) {
      for (const id of linkIds) out.set(id, 'team_off');
      return out;
    }
    const { data, error } = await supabaseAdmin
      .from('booking_link_hosts')
      .select('link_id, user_id, is_active, host_paused')
      .in('link_id', linkIds);
    if (error) {
      if (missing097(error)) { for (const id of linkIds) out.set(id, 'team_off'); return out; }
      throw new AppError(error.message, 500);
    }
    const team = await teamUserIds(org.orgId);
    const hasHost = new Set(
      (data || []).filter((h: any) => hostIsBookable(h) && team.has(h.user_id)).map((h: any) => h.link_id as string),
    );
    for (const id of linkIds) if (!hasHost.has(id)) out.set(id, 'no_hosts');
    return out;
  },

  /** Stamp who was just given a meeting, for the next tie-break. Best effort. */
  async markAssigned(linkId: string, userId: string): Promise<void> {
    await supabaseAdmin
      .from('booking_link_hosts')
      .update({ last_assigned_at: new Date().toISOString() })
      .eq('link_id', linkId)
      .eq('user_id', userId)
      .then(() => undefined, () => undefined);
  },

  /**
   * A teammate leaving takes them out of every rotation on that team.
   *
   * Read-time filtering already stops them being offered; this keeps the
   * stored lists honest so an owner does not see a ghost host.
   */
  async forgetMember(orgId: string, userId: string): Promise<void> {
    try {
      const team = await teamUserIds(orgId);
      const owners = [...team.keys()];
      if (owners.length === 0) return;
      const { data: links } = await supabaseAdmin
        .from('booking_links')
        .select('id')
        .in('user_id', owners);
      // Called after they have left, so these are the remaining teammates'
      // links: their place on those goes, their own links stay theirs.
      const ids = (links || []).map((l: any) => l.id as string);
      if (ids.length === 0) return;
      await supabaseAdmin.from('booking_link_hosts').delete().eq('user_id', userId).in('link_id', ids);
    } catch {
      /* best effort: read-time filtering is the real guard */
    }
  },
};

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import type { AdminStats, AdminUserRow, AdminUsersResponse } from '@lemlist/shared';

// How many auth users we'll scan at most (pages × perPage). Fine well past
// the point where this platform needs a real search index.
const MAX_PAGES = 10;
const PER_PAGE = 1000;

/** Fetch every auth user (paged) — cached per request cycle only. */
async function fetchAllUsers() {
  const all: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new AppError(error.message, 500);
    const users = data?.users || [];
    all.push(...users);
    if (users.length < PER_PAGE) break;
  }
  return all;
}

async function fetchSubscriptions(): Promise<Map<string, { plan: string; status: string }>> {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id, plan, status');
  if (error) throw new AppError(error.message, 500);
  return new Map((data || []).map((s: any) => [s.user_id, { plan: s.plan, status: s.status }]));
}

async function countRows(table: string): Promise<number> {
  const { count } = await supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  return count || 0;
}

export const adminService = {
  async listUsers(search?: string): Promise<AdminUsersResponse> {
    const [users, subs] = await Promise.all([fetchAllUsers(), fetchSubscriptions()]);
    const q = (search || '').trim().toLowerCase();

    let rows: AdminUserRow[] = users.map((u) => {
      const sub = subs.get(u.id);
      return {
        id: u.id,
        email: u.email || '(no email)',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        email_confirmed: !!u.email_confirmed_at,
        plan: sub?.plan || 'free',
        status: sub?.status || 'free',
      };
    });

    if (q) rows = rows.filter((r) => r.email.toLowerCase().includes(q));
    rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return { users: rows.slice(0, 200), total: rows.length };
  },

  async stats(): Promise<AdminStats> {
    const [users, subs, mailboxes, domains, contacts, campaigns] = await Promise.all([
      fetchAllUsers(),
      fetchSubscriptions(),
      countRows('smtp_accounts'),
      countRows('sending_domains'),
      countRows('contacts'),
      countRows('campaigns'),
    ]);
    let lifetime = 0, paying = 0;
    for (const sub of subs.values()) {
      if (sub.plan === 'lifetime') lifetime++;
      else if ((sub.status === 'active' || sub.status === 'trialing') && sub.plan !== 'free' && sub.plan !== 'trial') paying++;
    }
    return {
      total_users: users.length,
      lifetime_users: lifetime,
      paying_users: paying,
      free_users: Math.max(0, users.length - lifetime - paying),
      mailboxes,
      domains,
      contacts,
      campaigns,
    };
  },

  /** Grant free-forever lifetime access (all limits removed) to a user by email. */
  async grantLifetime(email: string): Promise<AdminUserRow> {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean || !clean.includes('@')) throw new AppError('Enter a valid email address', 400);

    const users = await fetchAllUsers();
    const user = users.find((u) => (u.email || '').toLowerCase() === clean);
    if (!user) throw new AppError(`No account found for ${clean} — they need to sign up first.`, 404);

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .upsert(
        { user_id: user.id, plan: 'lifetime', status: 'active', updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    if (error) throw new AppError(error.message, 500);

    return {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at || null,
      email_confirmed: !!user.email_confirmed_at,
      plan: 'lifetime',
      status: 'active',
    };
  },

  /** Revoke lifetime access — the account drops back to the Free plan. */
  async revokeLifetime(userId: string): Promise<void> {
    const { data: sub, error: readError } = await supabaseAdmin
      .from('subscriptions')
      .select('plan')
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) throw new AppError(readError.message, 500);
    if (!sub || sub.plan !== 'lifetime') throw new AppError('This user does not have lifetime access.', 400);

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ plan: 'free', status: 'free', updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },
};

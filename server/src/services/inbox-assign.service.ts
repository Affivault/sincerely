import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import type { InboxTeammate } from '@lemlist/shared';
import { addressFilter, assignReady } from './inbox-reminders.service.js';

/* ═══════════════════════════════════════════════════════════════════════
   Handing a conversation to a teammate.

   Every mailbox in this app belongs to one user, and every inbox read is
   scoped to that user. reply-queue.service.ts explains why assignment
   stopped at "claim it yourself": a teammate could not open another
   user's mail, so assigning to them handed over something they could not
   read.

   This is the narrow opening that makes the promise keepable. A
   conversation assigned to you, in the mailbox of somebody in your own
   organisation, can be listed under "Assigned to you" and read. Nothing
   else crosses: you cannot reply from their mailbox, archive their mail or
   see anything they did not assign. And membership is checked every time
   it is used, not only when the assignment was made, so somebody removed
   from the team loses the view at once rather than keeping a window into
   a mailbox they no longer belong to.

   A solo account has no teammates, and the UI for all of this is hidden.
   ═══════════════════════════════════════════════════════════════════════ */

async function orgOf(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('team_members')
    .select('org_id')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as any)?.org_id ?? null;
}

/** Whether two users are members of the same organisation, checked now. */
export async function sameOrg(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const { data } = await supabaseAdmin
    .from('team_members')
    .select('user_id, org_id')
    .in('user_id', [a, b]);
  const rows = (data || []) as Array<{ user_id: string; org_id: string }>;
  const orgA = rows.find((r) => r.user_id === a)?.org_id;
  const orgB = rows.find((r) => r.user_id === b)?.org_id;
  return !!orgA && orgA === orgB;
}

export const inboxAssignService = {
  /**
   * The people a conversation can be handed to, the caller included.
   *
   * Empty for a solo account - one person, nobody to hand anything to -
   * which is how the client knows to show nothing. Read-only: unlike
   * teamService.listMembers this never creates an organisation as a side
   * effect of opening the inbox.
   */
  async teammates(userId: string): Promise<InboxTeammate[]> {
    if (!(await assignReady())) return [];
    const orgId = await orgOf(userId);
    if (!orgId) return [];
    const { data, error } = await supabaseAdmin
      .from('team_members')
      .select('user_id, email, role')
      .eq('org_id', orgId)
      .not('user_id', 'is', null)
      .order('created_at', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    const people = (data || []) as Array<{ user_id: string; email: string; role: InboxTeammate['role'] }>;
    if (people.length < 2) return [];
    return people.map((p) => ({ user_id: p.user_id, email: p.email, role: p.role, is_me: p.user_id === userId }));
  },

  /** Everybody in the caller's organisation, for "Assigned to you" across mailboxes. */
  async orgUserIds(userId: string): Promise<string[]> {
    const orgId = await orgOf(userId);
    if (!orgId) return [userId];
    const { data } = await supabaseAdmin
      .from('team_members')
      .select('user_id')
      .eq('org_id', orgId)
      .not('user_id', 'is', null);
    const ids = new Set<string>([userId, ...((data || []) as Array<{ user_id: string }>).map((r) => r.user_id)]);
    return [...ids];
  },

  /**
   * Assign the conversation a message belongs to, or unassign it (null).
   *
   * Only the mailbox's owner assigns: the update is scoped to their rows,
   * so a message id from somebody else's mailbox matches nothing. The
   * assignee must be in the same organisation - checked here on the server,
   * because the list the client offers is a convenience and not a rule.
   */
  async assignThread(userId: string, messageId: string, assignee: string | null) {
    if (!(await assignReady())) {
      throw new AppError('Assigning needs database migration 071. Run it in the Supabase SQL editor, then try again.', 503);
    }
    if (assignee !== null && (typeof assignee !== 'string' || !/^[0-9a-f-]{36}$/i.test(assignee))) {
      throw new AppError('assignee must be a teammate\'s user id, or null', 400);
    }

    const { data: msg } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, direction, from_email, to_email, contacts(email)')
      .eq('id', messageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!msg) throw new AppError('Message not found', 404);

    if (assignee && assignee !== userId && !(await sameOrg(userId, assignee))) {
      throw new AppError('You can only assign to somebody on your team', 403);
    }

    const email = (msg as any).contacts?.email
      || (msg.direction === 'outbound' ? msg.to_email : msg.from_email)
      || null;
    const now = new Date().toISOString();
    let q = supabaseAdmin
      .from('inbox_messages')
      .update({
        assigned_to: assignee,
        assigned_at: assignee ? now : null,
        assigned_by: assignee ? userId : null,
      })
      .eq('user_id', userId);
    q = email ? q.or(addressFilter(email)) : q.eq('id', messageId);
    const { data, error } = await q.select('id');
    if (error) throw new AppError(error.message, 500);
    return { assigned_to: assignee, messages: (data || []).length };
  },

  /**
   * A message the caller may read without owning it: assigned to them, in
   * the mailbox of somebody still on their team. Returns the owner's id,
   * or null - in which case the caller gets the same 404 as for any other
   * message that is not theirs.
   */
  async assignedOwner(callerId: string, messageId: string): Promise<string | null> {
    if (!(await assignReady())) return null;
    const { data } = await supabaseAdmin
      .from('inbox_messages')
      .select('user_id')
      .eq('id', messageId)
      .eq('assigned_to', callerId)
      .neq('user_id', callerId)
      .maybeSingle();
    const owner = (data as any)?.user_id as string | undefined;
    if (!owner) return null;
    return (await sameOrg(callerId, owner)) ? owner : null;
  },
};

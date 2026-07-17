import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import crypto from 'crypto';

export type TeamRole = 'owner' | 'admin' | 'member';

export const teamService = {
  // ── Organisation helpers ────────────────────────────────────────────────────

  async getOrCreateOrg(userId: string) {
    // Check if user already belongs to an org
    const { data: membership } = await supabaseAdmin
      .from('team_members')
      .select('*, organizations(*)')
      .eq('user_id', userId)
      .maybeSingle();

    if (membership) return membership.organizations;

    // Create a personal org for this user
    const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
    const orgName = user?.user?.email?.split('@')[1]?.split('.')[0] || 'My Workspace';

    const { data: org, error } = await supabaseAdmin
      .from('organizations')
      .insert({ name: orgName, owner_id: userId })
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);

    // Add the owner as a member
    await supabaseAdmin.from('team_members').insert({
      org_id: org.id,
      user_id: userId,
      role: 'owner',
      email: user?.user?.email,
    });

    return org;
  },

  async getOrg(userId: string) {
    const { data: membership } = await supabaseAdmin
      .from('team_members')
      .select('*, organizations(*)')
      .eq('user_id', userId)
      .maybeSingle();
    return membership?.organizations || null;
  },

  async updateOrg(userId: string, name: string) {
    const org = await this.getOrg(userId);
    if (!org) throw new AppError('No organisation found', 404);
    if (org.owner_id !== userId) throw new AppError('Only the owner can rename the organisation', 403);

    const { data, error } = await supabaseAdmin
      .from('organizations')
      .update({ name })
      .eq('id', org.id)
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    return data;
  },

  // ── Members ─────────────────────────────────────────────────────────────────

  async listMembers(userId: string) {
    const org = await this.getOrCreateOrg(userId);
    const { data, error } = await supabaseAdmin
      .from('team_members')
      .select('*')
      .eq('org_id', org.id)
      .order('created_at', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async removeMember(userId: string, memberId: string) {
    const org = await this.getOrg(userId);
    if (!org) throw new AppError('No organisation found', 404);
    if (org.owner_id !== userId) throw new AppError('Only the owner can remove members', 403);

    const { data: member } = await supabaseAdmin
      .from('team_members')
      .select('user_id, role')
      .eq('id', memberId)
      .eq('org_id', org.id)
      .single();
    if (!member) throw new AppError('Member not found', 404);
    if (member.role === 'owner') throw new AppError('Cannot remove the owner', 400);

    await supabaseAdmin.from('team_members').delete().eq('id', memberId);
  },

  async updateMemberRole(userId: string, memberId: string, role: TeamRole) {
    const org = await this.getOrg(userId);
    if (!org) throw new AppError('No organisation found', 404);
    if (org.owner_id !== userId) throw new AppError('Only the owner can change roles', 403);
    if (role === 'owner') throw new AppError('Cannot assign owner role this way', 400);

    const { data, error } = await supabaseAdmin
      .from('team_members')
      .update({ role })
      .eq('id', memberId)
      .eq('org_id', org.id)
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    return data;
  },

  // ── Invites ─────────────────────────────────────────────────────────────────

  async listInvites(userId: string) {
    const org = await this.getOrg(userId);
    if (!org) return [];
    const { data } = await supabaseAdmin
      .from('team_invites')
      .select('*')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false });
    return data || [];
  },

  async invite(userId: string, email: string, role: TeamRole = 'member') {
    const org = await this.getOrCreateOrg(userId);
    if (org.owner_id !== userId) throw new AppError('Only the owner can invite members', 403);
    if (role === 'owner') throw new AppError('Cannot invite someone as owner', 400);

    // Check if already a member
    const { data: existing } = await supabaseAdmin
      .from('team_members')
      .select('id')
      .eq('org_id', org.id)
      .eq('email', email.toLowerCase())
      .maybeSingle();
    if (existing) throw new AppError('This email is already a member of your organisation', 400);

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .from('team_invites')
      .upsert(
        { org_id: org.id, email: email.toLowerCase(), role, token, expires_at: expiresAt, invited_by: userId },
        { onConflict: 'org_id,email' }
      )
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async revokeInvite(userId: string, inviteId: string) {
    const org = await this.getOrg(userId);
    if (!org) throw new AppError('No organisation found', 404);
    if (org.owner_id !== userId) throw new AppError('Only the owner can revoke invites', 403);
    await supabaseAdmin.from('team_invites').delete().eq('id', inviteId).eq('org_id', org.id);
  },

  async acceptInvite(token: string, userId: string, userEmail: string) {
    const { data: invite, error } = await supabaseAdmin
      .from('team_invites')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (error || !invite) throw new AppError('Invalid or expired invite', 400);
    if (new Date(invite.expires_at) < new Date()) throw new AppError('This invite has expired', 400);
    if (invite.email !== userEmail.toLowerCase()) throw new AppError('This invite is for a different email address', 403);

    // Every lookup elsewhere (getOrg, getOrCreateOrg, listMembers, ...) assumes a user
    // belongs to at most one org — joining a second one would permanently break those.
    const { data: existingMembership } = await supabaseAdmin
      .from('team_members')
      .select('org_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (existingMembership && existingMembership.org_id !== invite.org_id) {
      throw new AppError('You already belong to an organisation — leave it before accepting a different invite', 400);
    }

    // Add as member
    await supabaseAdmin.from('team_members').upsert(
      { org_id: invite.org_id, user_id: userId, email: userEmail.toLowerCase(), role: invite.role },
      { onConflict: 'org_id,user_id' }
    );

    // Delete invite
    await supabaseAdmin.from('team_invites').delete().eq('id', invite.id);

    return { org_id: invite.org_id };
  },
};

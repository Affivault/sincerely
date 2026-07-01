import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamApi } from '../../api/team.api';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { PageHeader } from '../../components/shared/PageHeader';
import { Avatar } from '../../components/shared/Avatar';
import { formatDate, cn } from '../../lib/utils';
import {
  Users,
  UserPlus,
  Trash2,
  Mail,
  Crown,
  Shield,
  User,
  Check,
  Copy,
  Pencil,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';

const ROLE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  owner:  { label: 'Owner',  icon: Crown,  color: 'text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/20' },
  admin:  { label: 'Admin',  icon: Shield, color: 'text-[var(--indigo)] bg-[var(--indigo-subtle)] border-[rgba(91,91,245,0.2)]' },
  member: { label: 'Member', icon: User,   color: 'text-slate-600 dark:text-slate-400 bg-slate-500/10 border-slate-500/20' },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] || ROLE_CONFIG.member;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 h-[22px] rounded-full border text-[11px] font-medium', cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

export function TeamPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [editOrgName, setEditOrgName] = useState('');
  const [editingOrgName, setEditingOrgName] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const { data: org, isLoading: orgLoading } = useQuery({
    queryKey: ['team-org'],
    queryFn: teamApi.getOrg,
  });

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['team-members'],
    queryFn: teamApi.listMembers,
    enabled: !!org,
  });

  const { data: invites = [], isLoading: invitesLoading } = useQuery({
    queryKey: ['team-invites'],
    queryFn: teamApi.listInvites,
    enabled: !!org,
  });

  const updateOrgMut = useMutation({
    mutationFn: (name: string) => teamApi.updateOrg(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-org'] });
      toast.success('Organisation name updated');
      setEditingOrgName(false);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to update'),
  });

  const inviteMut = useMutation({
    mutationFn: () => teamApi.invite(inviteEmail, inviteRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-invites'] });
      toast.success(`Invite sent to ${inviteEmail}`);
      setShowInviteModal(false);
      setInviteEmail('');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to invite'),
  });

  const removeMemberMut = useMutation({
    mutationFn: teamApi.removeMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      toast.success('Member removed');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to remove member'),
  });

  const updateRoleMut = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) => teamApi.updateMemberRole(memberId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      toast.success('Role updated');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to update role'),
  });

  const revokeInviteMut = useMutation({
    mutationFn: teamApi.revokeInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-invites'] });
      toast.success('Invite revoked');
    },
    onError: () => toast.error('Failed to revoke invite'),
  });

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/invite?token=${token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedToken(token);
      toast.success('Invite link copied');
      setTimeout(() => setCopiedToken(null), 2000);
    }).catch(() => {
      toast.error('Failed to copy link — please copy it manually');
    });
  };

  const isOwner = org?.owner_id === user?.id;

  if (orgLoading) return <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>;

  return (
    <div className="max-w-3xl">
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <Users className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Team"
        description="Manage your organisation members and invite collaborators."
        meta={
          <>
            <span className="tabular">{members.length} member{members.length === 1 ? '' : 's'}</span>
            {invites.length > 0 && (
              <>
                <span className="sep-dot" />
                <span className="tabular">{invites.length} pending invite{invites.length === 1 ? '' : 's'}</span>
              </>
            )}
          </>
        }
        actions={
          isOwner && (
            <Button size="sm" onClick={() => setShowInviteModal(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Invite member
            </Button>
          )
        }
      />

      {/* Organisation identity */}
      <div className="panel p-4 mb-4 flex items-center gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--indigo)] to-[#7A5BF5] text-white text-[16px] font-semibold flex-shrink-0">
          {(org?.name || 'W').trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-medium text-[var(--text-tertiary)]">Organisation</p>
          {editingOrgName ? (
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={editOrgName}
                onChange={(e) => setEditOrgName(e.target.value)}
                className="h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-[14px] focus:border-[rgba(91,91,245,0.4)] focus:shadow-[0_0_0_3px_rgba(91,91,245,0.12)] outline-none"
                autoFocus
              />
              <button
                onClick={() => updateOrgMut.mutate(editOrgName)}
                disabled={!editOrgName || updateOrgMut.isPending}
                className="flex items-center justify-center h-8 w-8 rounded-lg bg-[var(--indigo)] text-white hover:opacity-90 disabled:opacity-50 transition"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setEditingOrgName(false)} className="icon-btn">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <p className="text-[17px] font-semibold text-[var(--text-primary)] tracking-[-0.01em] truncate">{org?.name || 'My Workspace'}</p>
          )}
        </div>
        {isOwner && !editingOrgName && (
          <button
            onClick={() => { setEditOrgName(org?.name || ''); setEditingOrgName(true); }}
            className="icon-btn flex-shrink-0"
            title="Rename organisation"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Members */}
      <div className="panel overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Members</h2>
          <span className="ml-auto text-[11px] font-medium tabular px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">{members.length}</span>
        </div>
        {membersLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {members.map((member) => {
              const isSelf = member.user_id === user?.id;
              return (
                <div key={member.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors">
                  <Avatar email={member.email} size="lg" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{member.email}</p>
                      {isSelf && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">You</span>}
                    </div>
                    <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">Joined {formatDate(member.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isOwner && member.role !== 'owner' ? (
                      <select
                        value={member.role}
                        onChange={(e) => updateRoleMut.mutate({ memberId: member.id, role: e.target.value })}
                        className="h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] focus:border-[rgba(91,91,245,0.4)] outline-none cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <RoleBadge role={member.role} />
                    )}
                    {isOwner && !isSelf && member.role !== 'owner' && (
                      <button
                        onClick={() => { if (confirm(`Remove ${member.email}?`)) removeMemberMut.mutate(member.id); }}
                        className="icon-btn hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]"
                        title="Remove member"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending Invites */}
      {(invites.length > 0 || isOwner) && (
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Pending invites</h2>
            <span className="ml-auto text-[11px] font-medium tabular px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">{invites.length}</span>
          </div>
          {invitesLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : invites.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-elevated)]">
                <Mail className="h-4 w-4 text-[var(--text-tertiary)]" />
              </span>
              <p className="text-[12.5px] text-[var(--text-secondary)]">No pending invites</p>
              {isOwner && (
                <button onClick={() => setShowInviteModal(true)} className="text-[12px] font-medium text-[var(--indigo)] hover:underline">
                  Invite a teammate
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {invites.map((invite) => (
                <div key={invite.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors">
                  <span className="h-9 w-9 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center flex-shrink-0">
                    <Mail className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{invite.email}</p>
                    <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">Expires {formatDate(invite.expires_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <RoleBadge role={invite.role} />
                    <button
                      onClick={() => copyInviteLink(invite.token)}
                      title="Copy invite link"
                      className="icon-btn"
                    >
                      {copiedToken === invite.token ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </button>
                    {isOwner && (
                      <button
                        onClick={() => revokeInviteMut.mutate(invite.id)}
                        title="Revoke invite"
                        className="icon-btn hover:!text-[var(--error)] hover:!bg-[var(--error-bg)]"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <Modal
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          title="Invite team member"
          description="We’ll generate an invite link you can share. It expires in 7 days."
          size="md"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setShowInviteModal(false)}>Cancel</Button>
              <Button type="submit" form="invite-form" size="md" disabled={!inviteEmail || inviteMut.isPending}>
                {inviteMut.isPending ? 'Sending…' : 'Send invite'}
              </Button>
            </>
          }
        >
          <form id="invite-form" onSubmit={(e) => { e.preventDefault(); inviteMut.mutate(); }} className="space-y-4">
            <Input
              label="Email address"
              type="email"
              autoFocus
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
            />
            <div className="space-y-1">
              <label className="block text-[12px] font-medium text-[var(--text-secondary)]">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] transition-[border-color,box-shadow]"
              >
                <option value="member">Member — can view and run campaigns</option>
                <option value="admin">Admin — full access except billing</option>
              </select>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

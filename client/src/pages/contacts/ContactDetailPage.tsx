import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contactsApi, listsApi } from '../../api/contacts.api';
import { analyticsApi } from '../../api/analytics.api';
import { Spinner } from '../../components/ui/Spinner';
import { Avatar } from '../../components/shared/Avatar';
import { formatDate, formatDateTime, cn } from '../../lib/utils';
import {
  ArrowLeft,
  Trash2,
  Mail,
  Building2,
  Briefcase,
  Phone,
  Linkedin,
  Globe,
  Send,
  MousePointerClick,
  MessageSquare,
  AlertTriangle,
  FolderOpen,
  Plus,
  X,
  ArrowRightLeft,
  Check,
} from 'lucide-react';
import toast from 'react-hot-toast';

const activityIcons: Record<string, React.ElementType> = {
  sent: Send,
  delivered: Mail,
  opened: Mail,
  clicked: MousePointerClick,
  replied: MessageSquare,
  bounced: AlertTriangle,
  error: AlertTriangle,
};

const activityColors: Record<string, string> = {
  sent: 'text-[var(--text-secondary)]',
  delivered: 'text-[var(--success)]',
  opened: 'text-[var(--success)]',
  clicked: 'text-[var(--text-secondary)]',
  replied: 'text-[var(--text-primary)]',
  bounced: 'text-[var(--error)]',
  error: 'text-[var(--error)]',
};

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAddToListDropdown, setShowAddToListDropdown] = useState(false);

  if (!id) {
    return <div className="text-center py-12 text-[var(--text-secondary)]">Invalid contact URL.</div>;
  }
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveFromListId, setMoveFromListId] = useState<string | null>(null);
  const [moveToListId, setMoveToListId] = useState<string | null>(null);

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contacts', id],
    queryFn: () => contactsApi.get(id!),
    enabled: !!id,
  });

  const { data: timeline } = useQuery({
    queryKey: ['contact-timeline', id],
    queryFn: () => analyticsApi.contactTimeline(id!),
    enabled: !!id,
  });

  const { data: contactLists } = useQuery({
    queryKey: ['contact-lists', id],
    queryFn: () => listsApi.getListsForContact(id!),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => contactsApi.delete(id!),
    onSuccess: () => {
      toast.success('Contact deleted');
      navigate('/contacts');
    },
  });

  const addToListMutation = useMutation({
    mutationFn: (listId: string) => listsApi.addContacts(listId, [id!]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact-lists', id] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      toast.success('Added to list');
      setShowAddToListDropdown(false);
    },
    onError: () => toast.error('Failed to add to list'),
  });

  const removeFromListMutation = useMutation({
    mutationFn: (listId: string) => listsApi.removeContacts(listId, [id!]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact-lists', id] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      toast.success('Removed from list');
    },
    onError: () => toast.error('Failed to remove from list'),
  });

  const moveContactMutation = useMutation({
    mutationFn: ({ fromListId, toListId }: { fromListId: string; toListId: string }) =>
      listsApi.moveContact(id!, fromListId, toListId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact-lists', id] });
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      toast.success('Moved to new list');
      setShowMoveModal(false);
      setMoveFromListId(null);
      setMoveToListId(null);
    },
    onError: () => toast.error('Failed to move contact'),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!contact) {
    return <div className="text-center text-[var(--text-secondary)]">Contact not found</div>;
  }

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  const memberLists = (contactLists || []).filter((l: any) => l.is_member);
  const nonMemberLists = (contactLists || []).filter((l: any) => !l.is_member);

  return (
    <div className="space-y-5">
      {/* Back link */}
      <button
        onClick={() => navigate('/contacts')}
        className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group"
      >
        <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
        Contacts
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <Avatar name={fullName || contact.email} email={contact.email} size="xl" />
          <div>
            <h1 className="text-[18px] font-semibold text-[var(--text-primary)]">{fullName || contact.email}</h1>
            {fullName && <p className="text-[12px] text-[var(--text-secondary)]">{contact.email}</p>}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {contact.tags?.map((tag: any) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold"
                  style={{ backgroundColor: tag.color + '20', color: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
              {contact.is_unsubscribed && (
                <span className="inline-flex items-center px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-500/10">Unsubscribed</span>
              )}
              {contact.is_bounced && (
                <span className="inline-flex items-center px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold text-rose-700 dark:text-rose-400 bg-rose-500/10">Bounced</span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => { if (confirm('Delete this contact?')) deleteMutation.mutate(); }}
          className="icon-btn hover:text-rose-500 hover:bg-rose-500/10 flex-shrink-0"
          title="Delete contact"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Contact Info */}
        <div className="space-y-3">
          <div className="card p-4">
            <h2 className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">Contact Info</h2>
            <div className="space-y-2.5">
              <InfoRow icon={Mail} label="Email" value={contact.email} />
              {contact.company && <InfoRow icon={Building2} label="Company" value={contact.company} />}
              {contact.job_title && <InfoRow icon={Briefcase} label="Job Title" value={contact.job_title} />}
              {contact.phone && <InfoRow icon={Phone} label="Phone" value={contact.phone} />}
              {contact.linkedin_url && <InfoRow icon={Linkedin} label="LinkedIn" value={contact.linkedin_url} isLink />}
              {contact.website && <InfoRow icon={Globe} label="Website" value={contact.website} isLink />}
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-tertiary)] space-y-1">
              <p>Source: {contact.source}</p>
              <p>Created: {formatDate(contact.created_at)}</p>
              <p>Updated: {formatDate(contact.updated_at)}</p>
            </div>
          </div>

          {/* Lists Section */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider">Lists</h2>
              <div className="relative">
                <button
                  onClick={() => setShowAddToListDropdown(!showAddToListDropdown)}
                  className="inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] rounded-md transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
                {showAddToListDropdown && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowAddToListDropdown(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-lg overflow-hidden">
                      {nonMemberLists.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-[var(--text-tertiary)] text-center">
                          Already on all lists
                        </p>
                      ) : (
                        nonMemberLists.map((list: any) => (
                          <button
                            key={list.id}
                            onClick={() => addToListMutation.mutate(list.id)}
                            disabled={addToListMutation.isPending}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                          >
                            <FolderOpen className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                            <span className="flex-1 text-left truncate">{list.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            {memberLists.length === 0 ? (
              <p className="text-[12px] text-[var(--text-tertiary)]">Not on any lists yet</p>
            ) : (
              <div className="space-y-1">
                {memberLists.map((list: any) => (
                  <div
                    key={list.id}
                    className="flex items-center gap-2 h-8 px-2.5 rounded-[6px] bg-[var(--bg-elevated)] group"
                  >
                    <FolderOpen className="h-3 w-3 text-[var(--text-tertiary)] flex-shrink-0" />
                    <span className="flex-1 text-[12px] font-medium text-[var(--text-primary)] truncate">
                      {list.name}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!list.is_default && (
                        <button
                          onClick={() => { setMoveFromListId(list.id); setMoveToListId(null); setShowMoveModal(true); }}
                          className="icon-btn h-5 w-5"
                          title="Move to another list"
                        >
                          <ArrowRightLeft className="h-3 w-3" />
                        </button>
                      )}
                      {!list.is_default && (
                        <button
                          onClick={() => removeFromListMutation.mutate(list.id)}
                          className="icon-btn h-5 w-5 hover:text-rose-500 hover:bg-rose-500/10"
                          title="Remove from list"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Activity Timeline */}
        <div className="lg:col-span-2 card p-4">
          <h2 className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">Activity Timeline</h2>
          {!timeline || timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-elevated)] mb-2">
                <Send className="h-4 w-4 text-[var(--text-tertiary)]" />
              </span>
              <p className="text-[12px] text-[var(--text-secondary)]">No activity yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {timeline.map((item: any) => {
                const Icon = activityIcons[item.activity_type] || Send;
                const color = activityColors[item.activity_type] || 'text-[var(--text-secondary)]';
                return (
                  <div key={item.id} className="flex items-start gap-3 py-2 border-b border-[var(--border-subtle)] last:border-0">
                    <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--bg-elevated)] flex-shrink-0 mt-0.5', color)}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[var(--text-primary)]">
                        <span className="font-medium capitalize">{item.activity_type}</span>
                        {item.step_subject && (
                          <span className="text-[var(--text-secondary)]"> — {item.step_subject}</span>
                        )}
                      </p>
                      <p className="text-[11px] text-[var(--text-tertiary)]">
                        {item.campaign_name} · {formatDateTime(item.occurred_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Move Contact Modal */}
      {showMoveModal && moveFromListId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowMoveModal(false)} />
          <div className="relative bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Move to List</h2>
                <p className="text-[13px] text-[var(--text-tertiary)] mt-0.5">
                  Move from "{memberLists.find((l: any) => l.id === moveFromListId)?.name}" to:
                </p>
              </div>
              <button
                onClick={() => setShowMoveModal(false)}
                className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-all duration-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4">
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {(contactLists || [])
                  .filter((l: any) => l.id !== moveFromListId && !l.is_default)
                  .map((list: any) => (
                    <button
                      key={list.id}
                      onClick={() => setMoveToListId(list.id)}
                      className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-200 ${
                        moveToListId === list.id
                          ? 'bg-[var(--bg-elevated)] border border-[var(--border-default)]'
                          : 'hover:bg-[var(--bg-hover)] border border-transparent'
                      }`}
                    >
                      <FolderOpen className="h-4 w-4 text-[var(--text-tertiary)]" />
                      <span className="flex-1 text-left text-sm font-medium text-[var(--text-primary)]">
                        {list.name}
                      </span>
                      {list.is_member && (
                        <span className="text-[10px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded-full">
                          Already on
                        </span>
                      )}
                      {moveToListId === list.id && (
                        <Check className="h-4 w-4 text-[var(--success)]" />
                      )}
                    </button>
                  ))}
              </div>
              <div className="flex justify-end gap-3 mt-4 pt-3 border-t border-[var(--border-subtle)]">
                <button onClick={() => setShowMoveModal(false)} className="btn-secondary rounded-lg">
                  Cancel
                </button>
                <button
                  disabled={!moveToListId || moveContactMutation.isPending}
                  onClick={() => {
                    if (moveFromListId && moveToListId) {
                      moveContactMutation.mutate({ fromListId: moveFromListId, toListId: moveToListId });
                    }
                  }}
                  className="btn-primary rounded-lg disabled:opacity-40"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  {moveContactMutation.isPending ? 'Moving...' : 'Move'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  isLink,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  isLink?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-4 w-4 text-[var(--text-secondary)] mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-[var(--text-secondary)]">{label}</p>
        {isLink ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--text-primary)] hover:underline truncate block"
          >
            {value}
          </a>
        ) : (
          <p className="text-sm text-[var(--text-primary)]">{value}</p>
        )}
      </div>
    </div>
  );
}

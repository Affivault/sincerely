import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contactsApi, listsApi } from '../../api/contacts.api';
import { analyticsApi } from '../../api/analytics.api';
import { crmApi } from '../../api/crm.api';
import { inboxApi } from '../../api/inbox.api';
import { DealModal, EventModal } from '../crm/CrmPage';
import { AddToCampaignModal } from '../../components/shared/AddToCampaignModal';
import { EmailBody } from '../../components/shared/EmailBody';
import { DEAL_STAGES, type Deal, type CrmEvent } from '@lemlist/shared';
import { Spinner } from '../../components/ui/Spinner';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
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
  Copy,
  CalendarPlus,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronDown,
  MailOpen,
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
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveFromListId, setMoveFromListId] = useState<string | null>(null);
  const [moveToListId, setMoveToListId] = useState<string | null>(null);
  const [dealModal, setDealModal] = useState<Partial<Deal> | null | undefined>(undefined);
  const [eventModal, setEventModal] = useState<Partial<CrmEvent> | null | undefined>(undefined);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [detailTab, setDetailTab] = useState<'emails' | 'activity'>('emails');
  const [openEmailId, setOpenEmailId] = useState<string | null>(null);

  const { data: contact, isLoading } = useQuery({
    queryKey: ['contacts', id],
    queryFn: () => contactsApi.get(id!),
    enabled: !!id,
  });

  const { data: contactDeals } = useQuery({
    queryKey: ['crm', 'deals', 'contact', id],
    queryFn: () => crmApi.listDeals({ contact_id: id!, contact_email: contact?.email }),
    enabled: !!id && !!contact,
  });

  // Every email exchanged with this lead (both directions), for the history view.
  const { data: emailsPage } = useQuery({
    queryKey: ['contact-emails', contact?.email],
    queryFn: () => inboxApi.list({ contact_email: contact!.email, limit: 100 }),
    enabled: !!contact?.email,
  });
  const emails = (emailsPage?.data || []) as any[];

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

  if (!id) {
    return <div className="text-center py-12 text-[var(--text-secondary)]">Invalid contact URL.</div>;
  }

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

  // Relationship stats derived from the email history, deals, and activity feed.
  const sortedEmails = [...emails].sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
  const receivedCount = emails.filter((m) => m.direction !== 'outbound').length;
  const sentCount = emails.length - receivedCount;
  const activity = (timeline || []) as any[];
  const opens = activity.filter((a) => a.activity_type === 'opened').length;
  const replies = activity.filter((a) => a.activity_type === 'replied').length + receivedCount;
  const openDeals = (contactDeals || []).filter((d) => d.stage !== 'lost');
  const pipelineValue = openDeals.reduce((s, d) => s + (d.value || 0), 0);
  const lastContactIso = sortedEmails[0]?.received_at || activity[0]?.created_at || null;
  const relTime = (iso: string | null) => {
    if (!iso) return 'Never';
    const diff = Date.now() - new Date(iso).getTime();
    const d = Math.floor(diff / 86400000);
    if (d < 1) { const h = Math.floor(diff / 3600000); return h < 1 ? 'Just now' : `${h}h ago`; }
    if (d < 30) return `${d}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const money = (v: number) => `$${Math.round(v || 0).toLocaleString()}`;
  const eventPrefill = { contact_name: fullName || contact.email, contact_email: contact.email };

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
        <div className="flex items-center gap-3.5 min-w-0">
          <Avatar name={fullName || contact.email} email={contact.email} size="xl" />
          <div className="min-w-0">
            <h1 className="text-[18px] font-semibold text-[var(--text-primary)] truncate">{fullName || contact.email}</h1>
            <p className="text-[12.5px] text-[var(--text-secondary)] truncate">
              {[contact.job_title, contact.company].filter(Boolean).join(' · ') || contact.email}
            </p>
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
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowCampaignModal(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[12.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <Send className="h-3.5 w-3.5" /> Add to campaign
          </button>
          <button
            onClick={() => setEventModal({ ...eventPrefill, type: 'meeting' })}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[12.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <CalendarPlus className="h-3.5 w-3.5" /> Book meeting
          </button>
          <button
            onClick={() => setDealModal({ contact_name: fullName || contact.email, contact_email: contact.email, contact_id: contact.id, company: contact.company || null })}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[var(--indigo)] text-white text-[12.5px] font-semibold hover:bg-[var(--indigo-hover)] transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
          >
            <Plus className="h-3.5 w-3.5" /> New deal
          </button>
          <button
            onClick={() => { if (confirm('Delete this contact?')) deleteMutation.mutate(); }}
            className="icon-btn hover:text-rose-500 hover:bg-rose-500/10 flex-shrink-0"
            title="Delete contact"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Relationship stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Last contact', value: relTime(lastContactIso), sub: `${emails.length} emails` },
          { label: 'Received', value: String(receivedCount), sub: `${sentCount} sent` },
          { label: 'Opens · replies', value: `${opens} · ${replies}`, sub: 'engagement' },
          { label: 'Open pipeline', value: money(pipelineValue), sub: `${openDeals.length} deal${openDeals.length === 1 ? '' : 's'}` },
        ].map((s) => (
          <div key={s.label} className="card px-3.5 py-3">
            <p className="text-[11px] font-medium text-[var(--text-tertiary)]">{s.label}</p>
            <p className="mt-1 text-[17px] font-semibold text-[var(--text-primary)] tabular leading-none truncate">{s.value}</p>
            <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Contact Info */}
        <div className="space-y-3">
          <div className="card p-4">
            <h2 className="text-[11px] font-bold text-[var(--text-tertiary)] mb-3">Contact Info</h2>
            <div className="space-y-2.5">
              <InfoRow icon={Mail} label="Email" value={contact.email} copyable />
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
              <h2 className="text-[11px] font-bold text-[var(--text-tertiary)]">Lists</h2>
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

          {/* Deals — this lead's CRM pipeline */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-bold text-[var(--text-tertiary)]">Deals</h2>
              <button
                onClick={() => setDealModal({ contact_name: fullName || contact.email, contact_email: contact.email, contact_id: contact.id, company: contact.company || null })}
                className="inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] rounded-md transition-colors"
              >
                <Plus className="h-3 w-3" /> New deal
              </button>
            </div>
            {!contactDeals || contactDeals.length === 0 ? (
              <p className="text-[12px] text-[var(--text-tertiary)]">No deals yet for this lead</p>
            ) : (
              <div className="space-y-1">
                {contactDeals.map((d) => {
                  const stage = DEAL_STAGES.find((s) => s.id === d.stage);
                  const dot = d.stage === 'won' ? 'bg-emerald-500' : d.stage === 'lost' ? 'bg-rose-500' : d.stage === 'proposal' ? 'bg-amber-500' : d.stage === 'qualified' ? 'bg-[var(--indigo)]' : 'bg-slate-400';
                  return (
                    <button
                      key={d.id}
                      onClick={() => setDealModal(d)}
                      className="w-full flex items-center gap-2 h-9 px-2.5 rounded-[6px] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] transition-colors text-left"
                    >
                      <span className={cn('h-2 w-2 rounded-full flex-shrink-0', dot)} />
                      <span className="flex-1 min-w-0 truncate text-[12px] font-medium text-[var(--text-primary)]">{d.title}</span>
                      <span className="text-[11px] text-[var(--text-tertiary)] flex-shrink-0">{stage?.label}</span>
                      <span className="text-[12px] font-semibold text-[var(--text-primary)] tabular flex-shrink-0">${Math.round(d.value || 0).toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Conversations + Activity */}
        <div className="lg:col-span-2 card p-0 overflow-hidden">
          <div className="flex items-center gap-1 px-4 h-11 border-b border-[var(--border-subtle)]">
            {([
              { id: 'emails' as const, label: 'Conversations', count: emails.length },
              { id: 'activity' as const, label: 'Activity', count: activity.length },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => setDetailTab(t.id)}
                className={cn('relative flex items-center gap-1.5 h-full px-2.5 text-[13px] font-medium transition-colors', detailTab === t.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]')}
              >
                {t.label}
                {t.count > 0 && (
                  <span className={cn('flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] px-1 text-[10.5px] font-semibold tabular', detailTab === t.id ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]')}>{t.count}</span>
                )}
                <span className={cn('absolute left-2 right-2 bottom-0 h-[2px] rounded-t-full transition-opacity', detailTab === t.id ? 'bg-[var(--indigo)] opacity-100' : 'opacity-0')} />
              </button>
            ))}
          </div>

          {detailTab === 'emails' ? (
            sortedEmails.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-elevated)] mb-2"><MailOpen className="h-4 w-4 text-[var(--text-tertiary)]" /></span>
                <p className="text-[12.5px] font-medium text-[var(--text-primary)]">No emails yet</p>
                <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">Emails to and from this lead will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {sortedEmails.map((m) => {
                  const outbound = m.direction === 'outbound';
                  const open = openEmailId === m.id;
                  return (
                    <div key={m.id}>
                      <button onClick={() => setOpenEmailId(open ? null : m.id)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors">
                        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0', outbound ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400')}>
                          {outbound ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{m.subject || '(no subject)'}</p>
                          <p className="text-[11.5px] text-[var(--text-tertiary)] truncate">
                            <span className="text-[var(--text-secondary)]">{outbound ? 'You' : (fullName || m.from_email)}</span>
                            {' · '}{new Date(m.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                        <ChevronDown className={cn('h-4 w-4 text-[var(--text-muted)] flex-shrink-0 transition-transform', open && 'rotate-180')} />
                      </button>
                      {open && (
                        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-app)]">
                          <EmailBody html={m.body_html} text={m.body_text} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            activity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-elevated)] mb-2"><Send className="h-4 w-4 text-[var(--text-tertiary)]" /></span>
                <p className="text-[12.5px] font-medium text-[var(--text-primary)]">No activity yet</p>
                <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">Sends, opens, clicks and replies show up here.</p>
              </div>
            ) : (
              <div className="p-4 space-y-1">
                {activity.map((item: any) => {
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
                          {item.step_subject && <span className="text-[var(--text-secondary)]"> — {item.step_subject}</span>}
                        </p>
                        <p className="text-[11px] text-[var(--text-tertiary)]">
                          {item.campaign_name} · {formatDateTime(item.occurred_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>

      {/* Move Contact Modal */}
      {showMoveModal && moveFromListId && (
        <Modal
          isOpen={showMoveModal}
          onClose={() => setShowMoveModal(false)}
          title="Move to list"
          description={`Move from "${memberLists.find((l: any) => l.id === moveFromListId)?.name}" to:`}
          size="sm"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setShowMoveModal(false)}>Cancel</Button>
              <Button
                size="md"
                disabled={!moveToListId || moveContactMutation.isPending}
                onClick={() => {
                  if (moveFromListId && moveToListId) {
                    moveContactMutation.mutate({ fromListId: moveFromListId, toListId: moveToListId });
                  }
                }}
              >
                <ArrowRightLeft className="h-4 w-4" />
                {moveContactMutation.isPending ? 'Moving…' : 'Move'}
              </Button>
            </>
          }
        >
          <div className="space-y-1.5 max-h-64 overflow-y-auto -mx-1 px-1">
            {(contactLists || [])
              .filter((l: any) => l.id !== moveFromListId && !l.is_default)
              .map((list: any) => (
                <button
                  key={list.id}
                  onClick={() => setMoveToListId(list.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors border',
                    moveToListId === list.id
                      ? 'bg-[var(--indigo-subtle)] border-[var(--indigo)]/30'
                      : 'hover:bg-[var(--bg-hover)] border-transparent'
                  )}
                >
                  <FolderOpen className={cn('h-4 w-4', moveToListId === list.id ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')} />
                  <span className="flex-1 text-left text-[13px] font-medium text-[var(--text-primary)] truncate">
                    {list.name}
                  </span>
                  {list.is_member && (
                    <span className="text-[10px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded-full">
                      Already on
                    </span>
                  )}
                  {moveToListId === list.id && (
                    <Check className="h-4 w-4 text-[var(--indigo)]" />
                  )}
                </button>
              ))}
          </div>
        </Modal>
      )}

      {dealModal !== undefined && <DealModal deal={dealModal} onClose={() => setDealModal(undefined)} />}
      {eventModal !== undefined && <EventModal event={eventModal} onClose={() => setEventModal(undefined)} />}
      {showCampaignModal && <AddToCampaignModal contactIds={[contact.id]} onClose={() => setShowCampaignModal(false)} />}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  isLink,
  copyable,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  isLink?: boolean;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast.error('Failed to copy to clipboard');
    });
  }

  return (
    <div className="flex items-start gap-3 group/inforow">
      <Icon className="h-4 w-4 text-[var(--text-secondary)] mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--text-secondary)]">{label}</p>
        <div className="flex items-center gap-1.5">
          {isLink ? (
            <a
              href={value.startsWith('http') ? value : `https://${value}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--text-primary)] hover:underline truncate block"
            >
              {value}
            </a>
          ) : (
            <p className="text-sm text-[var(--text-primary)] truncate">{value}</p>
          )}
          {copyable && (
            <button
              onClick={handleCopy}
              title="Copy to clipboard"
              className="shrink-0 opacity-0 group-hover/inforow:opacity-100 transition-opacity p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              {copied ? (
                <Check className="h-3 w-3 text-[var(--success)]" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { saraApi } from '../../api/sara.api';
import {
  Bot,
  CheckCircle2,
  XCircle,
  Clock,
  MessageSquare,
  AlertTriangle,
  Send,
  RefreshCw,
  Edit3,
  TrendingUp,
  Users,
  Inbox,
  Mail,
  Building2,
  ArrowDown,
  ArrowUp,
  Sparkles,
  Command,
} from 'lucide-react';
import { cn, formatDateTime } from '../../lib/utils';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Avatar } from '../../components/shared/Avatar';
import toast from 'react-hot-toast';

function relTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString();
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[4px] border border-[var(--border-default)] bg-[var(--bg-surface)] text-[10px] font-mono font-semibold text-[var(--text-secondary)] shadow-[inset_0_-1px_0_var(--border-subtle)]">
      {children}
    </kbd>
  );
}

const INTENT_CONFIG: Record<string, { label: string; icon: typeof Bot }> = {
  interested: { label: 'Interested', icon: TrendingUp },
  meeting: { label: 'Meeting', icon: Users },
  objection: { label: 'Objection', icon: AlertTriangle },
  not_now: { label: 'Not Now', icon: Clock },
  unsubscribe: { label: 'Unsubscribe', icon: XCircle },
  out_of_office: { label: 'Out of Office', icon: Clock },
  bounce: { label: 'Bounce', icon: AlertTriangle },
  other: { label: 'Other', icon: MessageSquare },
};

const STATUS_TABS = [
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'sent', label: 'Sent' },
  { value: 'dismissed', label: 'Dismissed' },
];

export function SaraQueuePage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [intentFilter, setIntentFilter] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedReply, setEditedReply] = useState('');

  const { data: stats } = useQuery({
    queryKey: ['sara-stats'],
    queryFn: saraApi.getStats,
  });

  const { data: queue, isLoading } = useQuery({
    queryKey: ['sara-queue', statusFilter, intentFilter],
    queryFn: () => saraApi.getQueue({
      status: statusFilter,
      intent: intentFilter,
      limit: 50,
    }),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, reply }: { id: string; reply?: string }) => saraApi.approve(id, reply),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sara-queue'] });
      queryClient.invalidateQueries({ queryKey: ['sara-stats'] });
      toast.success('Reply approved');
      setIsEditing(false);
      setEditedReply('');
      // Auto-advance to next message
      const nextIdx = messages.findIndex((m: any) => m.id === selectedId) + 1;
      setSelectedId(messages[nextIdx]?.id || null);
    },
    onError: () => toast.error('Failed to approve'),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => saraApi.dismiss(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sara-queue'] });
      queryClient.invalidateQueries({ queryKey: ['sara-stats'] });
      toast.success('Reply dismissed');
      const nextIdx = messages.findIndex((m: any) => m.id === selectedId) + 1;
      setSelectedId(messages[nextIdx]?.id || null);
    },
    onError: () => toast.error('Failed to dismiss'),
  });

  const messages = queue?.messages || [];
  const selectedMsg = useMemo(() => messages.find((m: any) => m.id === selectedId), [messages, selectedId]);

  // Auto-select first message on load / filter change
  useEffect(() => {
    if (messages.length > 0 && !selectedMsg) {
      setSelectedId(messages[0].id);
      setIsEditing(false);
      setEditedReply('');
    } else if (messages.length === 0) {
      setSelectedId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, statusFilter, intentFilter]);

  // Keyboard shortcuts: J/K to navigate, A=approve, E=edit, D=dismiss, Esc=cancel edit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (inField && e.key !== 'Escape') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const idx = messages.findIndex((m: any) => m.id === selectedId);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = messages[Math.min(messages.length - 1, idx + 1)];
        if (next) { setSelectedId(next.id); setIsEditing(false); }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = messages[Math.max(0, idx - 1)];
        if (prev) { setSelectedId(prev.id); setIsEditing(false); }
      } else if (e.key === 'a' && selectedMsg && statusFilter === 'pending_review') {
        e.preventDefault();
        approveMutation.mutate({ id: selectedMsg.id, reply: isEditing ? editedReply : undefined });
      } else if (e.key === 'e' && selectedMsg?.sara_draft_reply && statusFilter === 'pending_review') {
        e.preventDefault();
        setEditedReply(selectedMsg.sara_draft_reply);
        setIsEditing(true);
      } else if (e.key === 'd' && selectedMsg && statusFilter === 'pending_review') {
        e.preventDefault();
        dismissMutation.mutate(selectedMsg.id);
      } else if (e.key === 'Escape') {
        if (isEditing) { setIsEditing(false); setEditedReply(''); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, selectedId, isEditing, editedReply, statusFilter]);

  return (
    <div className="space-y-5">
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo)]">
            <Bot className="h-4 w-4 text-white" />
          </span>
        }
        title="SARA"
        description="Smart Autonomous Reply Agent — AI-powered email responses"
        meta={stats?.pending_review ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>{stats.pending_review} pending review</span>
          </>
        ) : undefined}
        actions={
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['sara-queue'] });
              queryClient.invalidateQueries({ queryKey: ['sara-stats'] });
            }}
            className="icon-btn"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Pending Review" value={stats?.pending_review ?? 0} icon={Inbox} accent="amber" />
        <StatCard label="Approved Today" value={stats?.approved_today ?? 0} icon={CheckCircle2} accent="emerald" />
        <StatCard label="Sent Today" value={stats?.sent_today ?? 0} icon={Send} accent="indigo" />
        <StatCard label="Dismissed Today" value={stats?.dismissed_today ?? 0} icon={XCircle} accent="slate" />
      </div>

      {/* Intent Distribution */}
      {stats?.top_intents && stats.top_intents.length > 0 && (
        <div className="card p-4">
          <h3 className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-3">Intent Distribution</h3>
          <div className="flex gap-1.5 flex-wrap">
            {stats.top_intents.map((item: any) => {
              const config = INTENT_CONFIG[item.intent] || INTENT_CONFIG.other;
              const IntentIcon = config.icon;
              const isActive = intentFilter === item.intent;
              return (
                <button
                  key={item.intent}
                  onClick={() => setIntentFilter(isActive ? undefined : item.intent)}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium border transition-all',
                    isActive
                      ? 'bg-[rgba(99,102,241,0.1)] border-[rgba(99,102,241,0.3)] text-[var(--indigo)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]'
                  )}
                >
                  <IntentIcon className="h-3 w-3" />
                  {config.label}
                  <span className={cn('tabular', isActive ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')}>{item.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Status Tabs — segmented control */}
      <div className="flex items-center gap-3">
        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 h-7 rounded-md text-[12px] font-medium transition-all',
                statusFilter === tab.value
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              {tab.label}
              {tab.value === 'pending_review' && stats?.pending_review ? (
                <span className="inline-flex items-center justify-center h-[16px] min-w-[16px] px-1 rounded-[4px] bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold">
                  {stats.pending_review}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {intentFilter && (
          <button
            onClick={() => setIntentFilter(undefined)}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {INTENT_CONFIG[intentFilter]?.label || intentFilter}
            <XCircle className="h-3 w-3 ml-0.5" />
          </button>
        )}
      </div>

      {/* Queue — two-pane triage */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--indigo)] border-t-transparent" />
        </div>
      ) : messages.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-20 px-8 flex flex-col items-center justify-center text-center">
          <div className="relative mb-5">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" strokeWidth={1.5} />
            </span>
            <Sparkles className="h-4 w-4 text-amber-400 absolute -top-1 -right-1" />
          </div>
          <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-1.5">
            {statusFilter === 'pending_review' ? 'Inbox zero — nice.' : 'Nothing here yet'}
          </h3>
          <p className="text-[12.5px] text-[var(--text-secondary)] max-w-sm">
            {statusFilter === 'pending_review'
              ? 'SARA hasn\'t flagged any replies for review. New ones will appear here as they come in.'
              : `No ${STATUS_TABS.find(t => t.value === statusFilter)?.label.toLowerCase()} messages found.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[340px,1fr] gap-3 h-[calc(100vh-340px)] min-h-[480px]">
          {/* ── LEFT PANE: message list ───────────────────────────── */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              <span>{messages.length} {STATUS_TABS.find(t => t.value === statusFilter)?.label.toLowerCase()}</span>
              <span className="flex items-center gap-1 text-[10px] normal-case font-medium tracking-normal">
                <Kbd>J</Kbd><Kbd>K</Kbd> navigate
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {messages.map((msg: any) => {
                const intentConfig = INTENT_CONFIG[msg.sara_intent] || INTENT_CONFIG.other;
                const IntentIcon = intentConfig.icon;
                const isSelected = selectedId === msg.id;
                const name = msg.contacts?.first_name
                  ? `${msg.contacts.first_name} ${msg.contacts.last_name || ''}`.trim()
                  : msg.from_email;
                const conf = Math.round((msg.sara_confidence || 0) * 100);
                return (
                  <button
                    key={msg.id}
                    onClick={() => { setSelectedId(msg.id); setIsEditing(false); }}
                    className={cn(
                      'w-full text-left relative px-3 py-2.5 border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors',
                      isSelected && 'bg-[#5B5BF5]/5'
                    )}
                  >
                    {isSelected && (
                      <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full bg-[var(--indigo)]" />
                    )}
                    <div className="flex items-start gap-2.5">
                      <Avatar name={name} email={msg.from_email} size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12.5px] font-semibold text-[var(--text-primary)] truncate flex-1">
                            {name}
                          </span>
                          <span className="text-[10.5px] tabular text-[var(--text-tertiary)] flex-shrink-0">
                            {relTime(msg.received_at || msg.created_at)}
                          </span>
                        </div>
                        <p className="text-[11.5px] text-[var(--text-secondary)] truncate mt-0.5">
                          {msg.subject || '(no subject)'}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className={cn(
                            'inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] text-[10px] font-semibold',
                            'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                          )}>
                            <IntentIcon className="h-2.5 w-2.5" />
                            {intentConfig.label}
                          </span>
                          {conf > 0 && (
                            <span className={cn(
                              'text-[10px] tabular font-semibold',
                              conf >= 80 ? 'text-emerald-600 dark:text-emerald-400' : conf >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-tertiary)]'
                            )}>
                              {conf}%
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── RIGHT PANE: thread + composer ─────────────────────── */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden flex flex-col">
            {!selectedMsg ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--bg-elevated)] mb-3">
                  <MessageSquare className="h-5 w-5 text-[var(--text-tertiary)]" />
                </span>
                <p className="text-[13px] text-[var(--text-secondary)]">Select a message to review</p>
              </div>
            ) : (() => {
              const msg = selectedMsg;
              const intentConfig = INTENT_CONFIG[msg.sara_intent] || INTENT_CONFIG.other;
              const IntentIcon = intentConfig.icon;
              const name = msg.contacts?.first_name
                ? `${msg.contacts.first_name} ${msg.contacts.last_name || ''}`.trim()
                : msg.from_email;
              const conf = Math.round((msg.sara_confidence || 0) * 100);
              return (
                <>
                  {/* Thread header */}
                  <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-start gap-3">
                    <Avatar name={name} email={msg.from_email} size="lg" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">{name}</h3>
                        <span className="text-[11.5px] text-[var(--text-tertiary)]">&lt;{msg.from_email}&gt;</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {msg.contacts?.company && (
                          <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--text-secondary)]">
                            <Building2 className="h-3 w-3" />{msg.contacts.company}
                          </span>
                        )}
                        {msg.campaigns?.name && (
                          <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--text-secondary)]">
                            <Send className="h-3 w-3" />{msg.campaigns.name}
                          </span>
                        )}
                        <span className="text-[11.5px] text-[var(--text-tertiary)]">{formatDateTime(msg.received_at || msg.created_at)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className={cn(
                        'inline-flex items-center gap-1 px-1.5 h-[20px] rounded-[5px] text-[10.5px] font-semibold',
                        'bg-[#5B5BF5]/8 text-[var(--indigo)]'
                      )}>
                        <IntentIcon className="h-2.5 w-2.5" />
                        {intentConfig.label}
                      </span>
                      {conf > 0 && (
                        <span className="text-[10px] tabular font-semibold text-[var(--text-tertiary)]">
                          {conf}% confidence
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Thread body */}
                  <div className="flex-1 overflow-y-auto">
                    <div className="px-5 py-4 space-y-4">
                      {/* Original message */}
                      <div>
                        <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
                          Reply received
                        </h4>
                        <div className="text-[13px] text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                          {msg.body_text || msg.body_html?.replace(/<[^>]*>/g, '') || '(empty message)'}
                        </div>
                      </div>

                      {/* SARA draft */}
                      {msg.sara_draft_reply && (
                        <div className="rounded-xl border border-[#5B5BF5]/20 bg-[var(--indigo-subtle)] p-3.5">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--indigo)]">
                                <Bot className="h-3 w-3 text-white" />
                              </span>
                              <h4 className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--indigo)]">
                                SARA's draft reply
                              </h4>
                            </div>
                            {msg.sara_action && (
                              <span className="text-[10.5px] text-[var(--text-tertiary)]">
                                Action: <span className="text-[var(--text-secondary)] font-medium">{msg.sara_action}</span>
                              </span>
                            )}
                          </div>
                          {isEditing ? (
                            <textarea
                              value={editedReply}
                              onChange={(e) => setEditedReply(e.target.value)}
                              rows={8}
                              autoFocus
                              className="w-full rounded-lg border border-[#5B5BF5]/30 bg-[var(--bg-surface)] px-3 py-2.5 text-[13px] text-[var(--text-primary)] focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#5B5BF5]/15 outline-none resize-y"
                            />
                          ) : (
                            <div className="text-[13px] text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                              {msg.sara_draft_reply}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action bar */}
                  {statusFilter === 'pending_review' && (
                    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5 flex items-center gap-2">
                      <button
                        onClick={() => approveMutation.mutate({ id: msg.id, reply: isEditing ? editedReply : undefined })}
                        disabled={approveMutation.isPending}
                        className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 disabled:opacity-40 transition-all shadow-[0_1px_2px_rgba(16,185,129,0.4)]"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {isEditing ? 'Send edited' : 'Approve & send'}
                        <Kbd>A</Kbd>
                      </button>
                      {msg.sara_draft_reply && !isEditing && (
                        <button
                          onClick={() => { setEditedReply(msg.sara_draft_reply); setIsEditing(true); }}
                          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Edit
                          <Kbd>E</Kbd>
                        </button>
                      )}
                      {isEditing && (
                        <button
                          onClick={() => { setIsEditing(false); setEditedReply(''); }}
                          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all"
                        >
                          Cancel
                          <Kbd>Esc</Kbd>
                        </button>
                      )}
                      <button
                        onClick={() => dismissMutation.mutate(msg.id)}
                        disabled={dismissMutation.isPending}
                        className="ml-auto inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-all"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Dismiss
                        <Kbd>D</Kbd>
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

    </div>
  );
}

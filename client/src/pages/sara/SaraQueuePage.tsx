import { useState } from 'react';
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
  ChevronDown,
  ChevronUp,
  Edit3,
  TrendingUp,
  Users,
  Inbox,
  Mail,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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
      setEditingId(null);
      setEditedReply('');
    },
    onError: () => toast.error('Failed to approve'),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => saraApi.dismiss(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sara-queue'] });
      queryClient.invalidateQueries({ queryKey: ['sara-stats'] });
      toast.success('Reply dismissed');
    },
    onError: () => toast.error('Failed to dismiss'),
  });

  const messages = queue?.messages || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">SARA</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            Smart Autonomous Reply Agent - AI-powered email responses
          </p>
        </div>
        <button
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['sara-queue'] });
            queryClient.invalidateQueries({ queryKey: ['sara-stats'] });
          }}
          className="btn-secondary"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2 text-[var(--text-secondary)] mb-2">
            <Inbox className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Pending</span>
          </div>
          <p className="text-2xl font-semibold text-[var(--text-primary)]">{stats?.pending_review ?? 0}</p>
        </div>
        <div className="p-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2 text-[var(--text-secondary)] mb-2">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Approved Today</span>
          </div>
          <p className="text-2xl font-semibold text-[var(--text-primary)]">{stats?.approved_today ?? 0}</p>
        </div>
        <div className="p-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2 text-[var(--text-secondary)] mb-2">
            <Send className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Sent Today</span>
          </div>
          <p className="text-2xl font-semibold text-[var(--text-primary)]">{stats?.sent_today ?? 0}</p>
        </div>
        <div className="p-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2 text-[var(--text-secondary)] mb-2">
            <XCircle className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">Dismissed Today</span>
          </div>
          <p className="text-2xl font-semibold text-[var(--text-primary)]">{stats?.dismissed_today ?? 0}</p>
        </div>
      </div>

      {/* Intent Distribution */}
      {stats?.top_intents && stats.top_intents.length > 0 && (
        <div className="p-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)]">
          <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Intent Distribution</h3>
          <div className="flex gap-2 flex-wrap">
            {stats.top_intents.map((item: any) => {
              const config = INTENT_CONFIG[item.intent] || INTENT_CONFIG.other;
              const IntentIcon = config.icon;
              return (
                <button
                  key={item.intent}
                  onClick={() => setIntentFilter(intentFilter === item.intent ? undefined : item.intent)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                    intentFilter === item.intent
                      ? 'bg-[var(--bg-elevated)] border-[var(--border-strong)] text-[var(--text-primary)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]'
                  )}
                >
                  <IntentIcon className="h-3.5 w-3.5" />
                  {config.label}
                  <span className="font-medium">{item.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Status Tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)]">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              statusFilter === tab.value
                ? 'border-[var(--text-primary)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            {tab.label}
            {tab.value === 'pending_review' && stats?.pending_review ? (
              <span className="ml-2 rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-xs">
                {stats.pending_review}
              </span>
            ) : null}
          </button>
        ))}
        {intentFilter && (
          <button
            onClick={() => setIntentFilter(undefined)}
            className="ml-auto flex items-center gap-1 rounded-md bg-[var(--bg-elevated)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            {INTENT_CONFIG[intentFilter]?.label || intentFilter}
            <XCircle className="h-3 w-3 ml-1" />
          </button>
        )}
      </div>

      {/* Queue Messages */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--text-primary)] border-t-transparent" />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-[var(--border-subtle)] rounded-lg">
          <Mail className="h-10 w-10 text-[var(--text-tertiary)] mb-4" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">No messages in queue</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {statusFilter === 'pending_review'
              ? 'All caught up! No replies need your attention right now.'
              : `No ${STATUS_TABS.find(t => t.value === statusFilter)?.label.toLowerCase()} messages found.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((msg: any) => {
            const intentConfig = INTENT_CONFIG[msg.sara_intent] || INTENT_CONFIG.other;
            const IntentIcon = intentConfig.icon;
            const isExpanded = expandedId === msg.id;
            const isEditing = editingId === msg.id;

            return (
              <div
                key={msg.id}
                className="border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)] overflow-hidden"
              >
                {/* Message Header */}
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : msg.id)}
                >
                  {/* Intent Badge */}
                  <div className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
                    <IntentIcon className="h-3.5 w-3.5" />
                    {intentConfig.label}
                  </div>

                  {/* Confidence */}
                  <div className="text-xs text-[var(--text-tertiary)]">
                    {((msg.sara_confidence || 0) * 100).toFixed(0)}% confidence
                  </div>

                  {/* From */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {msg.contacts?.first_name
                          ? `${msg.contacts.first_name} ${msg.contacts.last_name || ''}`
                          : msg.from_email}
                      </span>
                      {msg.contacts?.company && (
                        <span className="text-xs text-[var(--text-tertiary)]">@ {msg.contacts.company}</span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">
                      {msg.subject || '(no subject)'}
                    </p>
                  </div>

                  {/* Campaign */}
                  {msg.campaigns?.name && (
                    <span className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-elevated)] rounded px-2 py-1">
                      {msg.campaigns.name}
                    </span>
                  )}

                  {/* Expand */}
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-[var(--text-tertiary)]" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" />
                  )}
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-[var(--border-subtle)] p-4 space-y-4">
                    {/* Original Message */}
                    <div>
                      <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)] mb-2">
                        Original Reply
                      </h4>
                      <div className="rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3 text-sm text-[var(--text-secondary)] whitespace-pre-wrap max-h-40 overflow-y-auto">
                        {msg.body_text || msg.body_html || '(empty message)'}
                      </div>
                    </div>

                    {/* SARA Draft Reply */}
                    {msg.sara_draft_reply && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Bot className="h-4 w-4 text-[var(--text-secondary)]" />
                          <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                            SARA&apos;s Suggested Reply
                          </h4>
                        </div>
                        {isEditing ? (
                          <textarea
                            value={editedReply}
                            onChange={(e) => setEditedReply(e.target.value)}
                            rows={6}
                            className="input-field resize-none"
                          />
                        ) : (
                          <div className="rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3 text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
                            {msg.sara_draft_reply}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Bar */}
                    {statusFilter === 'pending_review' && (
                      <div className="flex items-center gap-2 pt-2">
                        <button
                          onClick={() => {
                            if (isEditing) {
                              approveMutation.mutate({ id: msg.id, reply: editedReply });
                            } else {
                              approveMutation.mutate({ id: msg.id });
                            }
                          }}
                          disabled={approveMutation.isPending}
                          className="btn-primary"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {isEditing ? 'Send Edited' : 'Approve & Send'}
                        </button>
                        {msg.sara_draft_reply && !isEditing && (
                          <button
                            onClick={() => {
                              setEditingId(msg.id);
                              setEditedReply(msg.sara_draft_reply || '');
                            }}
                            className="btn-secondary"
                          >
                            <Edit3 className="h-4 w-4" />
                            Edit Reply
                          </button>
                        )}
                        {isEditing && (
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditedReply('');
                            }}
                            className="btn-secondary"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          onClick={() => dismissMutation.mutate(msg.id)}
                          disabled={dismissMutation.isPending}
                          className="btn-ghost text-[var(--error)] hover:bg-[var(--error-bg)] ml-auto"
                        >
                          <XCircle className="h-4 w-4" />
                          Dismiss
                        </button>
                      </div>
                    )}

                    {/* Recommended Action */}
                    {msg.sara_action && (
                      <div className="text-xs text-[var(--text-tertiary)] pt-1">
                        Recommended action: <span className="text-[var(--text-secondary)] font-medium">{msg.sara_action}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

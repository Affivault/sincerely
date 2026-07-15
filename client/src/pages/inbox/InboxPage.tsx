import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inboxApi } from '../../api/inbox.api';
import { smtpApi } from '../../api/smtp.api';
import { templateApi } from '../../api/template.api';
import { crmApi } from '../../api/crm.api';
import { Spinner } from '../../components/ui/Spinner';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/shared/EmptyState';
import { Avatar } from '../../components/shared/Avatar';
import { EmailBody } from '../../components/shared/EmailBody';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { RichTextEditor, useRichTextEditorRef } from '../../components/ui/RichTextEditor';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import {
  Search,
  Star,
  Archive,
  ArchiveRestore,
  Reply,
  Forward,
  Send,
  X,
  Inbox,
  SendHorizontal,
  MailOpen,
  Sparkles,
  RefreshCw,
  Pencil,
  MailPlus,
  ArrowLeft,
  Check,
  CheckCheck,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  AtSign,
  Tag,
  Wand2,
  Loader2,
  Clock,
  Maximize2,
  Minimize2,
  Calendar,
  MessageSquare,
  XCircle,
  Sun,
  CloudSun,
  Briefcase,
  CalendarClock,
  ChevronLeft,
  ChevronUp,
  Copy,
  PanelRight,
  PanelRightClose,
  Building2,
  ArrowUpRight,
  ArrowDownLeft,
  BadgeCheck,
  Megaphone,
  PenLine,
} from 'lucide-react';

/* ─── Types ────────────────────────────────────────── */
type Folder = 'inbox' | 'starred' | 'sent' | 'archived' | 'scheduled';

interface ConversationThread {
  contactEmail: string;
  contactName: string | null;
  latestMessage: Message;
  messageCount: number;
  hasUnread: boolean;
  isStarred: boolean;
}

interface SmtpAccount {
  id: string;
  email_address: string;
  label?: string;
  is_active: boolean;
  is_verified: boolean;
  signature_html?: string | null;
  signature_auto?: boolean;
}

interface Message {
  id: string;
  from_email: string;
  to_email: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  is_read: boolean;
  is_starred?: boolean;
  is_archived?: boolean;
  direction?: string;
  received_at: string;
  contact_name: string | null;
  contact_email?: string | null;
  contact_id?: string | null;
  campaign_name: string | null;
  campaign_id: string | null;
  smtp_account_id?: string | null;
  smtp_email?: string | null;
  smtp_label?: string | null;
  sara_intent: string | null;
  sara_confidence: number | null;
  sara_draft_reply: string | null;
  sara_action: string | null;
  sara_status: string;
}

/* ─── Helpers ──────────────────────────────────────── */
function timeAgo(date: string): string {
  const now = new Date();
  const d = new Date(date);
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function senderInitial(msg: Message): string {
  const name = msg.contact_name || msg.from_email || '';
  return (name[0] || '?').toUpperCase();
}

function senderName(msg: Message): string {
  return msg.contact_name || msg.from_email?.split('@')[0] || 'Unknown';
}

/** Strip HTML tags and decode common entities for plain-text snippet */
function stripHtml(str: string): string {
  return str
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Real emails are full of ASCII divider runs ("-----", "====", "____") —
    // junk in a one-line preview, so collapse them away.
    .replace(/[-_=~*•—]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function msgSnippet(msg: Message): string {
  const raw = msg.body_text || msg.body_html || '';
  const text = stripHtml(raw);
  // Empty string (not a placeholder) so rows can simply omit the line.
  return text.slice(0, 120).trim();
}

/** "Today" / "Yesterday" / "Monday" / "Mon, Jun 12" — for timeline day separators. */
function dayLabel(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** Strip Re:/Fwd: prefixes for subject-change detection within a thread. */
function baseSubject(s: string | null | undefined): string {
  return (s || '').replace(/^((re|fwd?|fw)\s*:\s*)+/i, '').trim().toLowerCase();
}

/** Guess a company name from a work-email domain; null for free providers. */
function companyFromEmail(email?: string | null): string | null {
  const domain = email?.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  const free = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'live.com', 'msn.com', 'gmx.com', 'mail.com'];
  if (free.includes(domain)) return null;
  const name = domain.split('.')[0];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : null;
}

/* ─── Email signatures ─────────────────────────────── */
/** True when a signature HTML string carries any real content. */
function hasSignature(html?: string | null): boolean {
  return !!html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0;
}

/** Append the inbox signature to a draft body when the toggle is on. */
function withSignature(
  html: string,
  text: string,
  sigHtml: string | null | undefined,
  on: boolean,
): { body: string; body_html: string } {
  if (on && hasSignature(sigHtml)) {
    return {
      body_html: `${html}<br><br>${sigHtml}`,
      body: `${text}\n\n${stripHtml(sigHtml!)}`,
    };
  }
  return { body: text, body_html: html };
}

/** Signature on/off state for a composer, following the selected sender inbox. */
function useSignatureState(accounts: SmtpAccount[], senderId: string) {
  const acct = accounts.find(a => a.id === senderId);
  const sigHtml = acct?.signature_html || null;
  const available = hasSignature(sigHtml);
  const auto = !!acct?.signature_auto;
  const [on, setOn] = useState(false);
  // Whenever the sender changes (or accounts finish loading), follow that
  // inbox's "always add" default — so the signature swaps with the sender.
  useEffect(() => {
    setOn(available && auto);
  }, [senderId, available, auto]);
  return { sigHtml, available, on: on && available, toggle: () => setOn(o => !o), setOn };
}

/** The signature rendered inline in the composer — reads as part of the email
    body (a hairline separator, same body text), exactly how it sends. A quiet
    remove control appears on hover. */
function SignaturePreview({ html, onRemove }: { html: string; onRemove: () => void }) {
  return (
    <div className="group relative px-4 pb-4">
      <div
        className="prose prose-sm max-w-none text-[14px] leading-relaxed text-[var(--text-primary)] border-t border-[var(--border-subtle)] pt-3 mt-1 [&_p]:my-1 [&_a]:text-[var(--indigo)] [&_a]:no-underline [&_img]:max-h-16 [&_img]:inline"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <button
        type="button"
        onClick={onRemove}
        title="Remove signature"
        className="absolute top-2 right-3 flex items-center gap-1 h-6 px-2 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[10.5px] font-medium text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] shadow-sm transition-opacity"
      >
        <X className="h-3 w-3" /> Signature
      </button>
    </div>
  );
}

/** The add/remove signature toggle button shown in a composer's action bar. */
function SignatureButton({ available, on, onToggle }: { available: boolean; on: boolean; onToggle: () => void }) {
  if (!available) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={on ? 'Remove signature' : 'Add signature'}
      className={cn(
        'flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium transition-colors',
        on
          ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
          : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
      )}
    >
      <PenLine className="h-3.5 w-3.5" />
      Signature
    </button>
  );
}

/** "34m" / "5h" / "2d" — for avg-reply-gap stats. */
function humanizeMs(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

const INTENT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  interested: { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', label: 'Interested' },
  meeting: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', label: 'Meeting Booked' },
  objection: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', label: 'Objection' },
  not_now: { bg: 'bg-slate-500/10', text: 'text-slate-500', label: 'Not Interested' },
  unsubscribe: { bg: 'bg-red-500/10', text: 'text-red-500', label: 'Unsubscribe' },
  out_of_office: { bg: 'bg-purple-500/10', text: 'text-purple-500', label: 'Out of Office' },
  bounce: { bg: 'bg-red-500/10', text: 'text-red-500', label: 'Bounce' },
  other: { bg: 'bg-slate-500/10', text: 'text-slate-500', label: 'Other' },
};

/** Solid hex per intent — used for sidebar dots where Tailwind classes don't fit. */
const INTENT_HEX: Record<string, string> = {
  interested: '#10B981',
  meeting: '#3B82F6',
  objection: '#F59E0B',
  not_now: '#64748B',
  unsubscribe: '#EF4444',
  out_of_office: '#8B5CF6',
  bounce: '#EF4444',
  other: '#64748B',
};

const TAG_OPTIONS = [
  { value: 'all', label: 'All Tags' },
  { value: 'interested', label: 'Interested' },
  { value: 'meeting', label: 'Meeting Booked' },
  { value: 'not_now', label: 'Not Interested' },
  { value: 'objection', label: 'Objection' },
  { value: 'out_of_office', label: 'Out of Office' },
  { value: 'unsubscribe', label: 'Unsubscribe' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'other', label: 'Other' },
];

/* Dot colors for the intent rows in the mail-nav rail */
const INTENT_DOTS: Record<string, string> = {
  interested: '#10B981',
  meeting: '#3B82F6',
  not_now: '#64748B',
  objection: '#F59E0B',
  out_of_office: '#8B5CF6',
  unsubscribe: '#EF4444',
  bounce: '#F43F5E',
  other: '#94A3B8',
};

/* EmailBody (sandboxed iframe renderer) now lives in components/shared/EmailBody. */

/* ─── Sender Dropdown ─────────────────────────────── */
function SenderSelect({ accounts, value, onChange }: {
  accounts: SmtpAccount[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (accounts.length === 0) {
    return (
      <div className="text-xs text-[var(--error)]">No SMTP accounts configured</div>
    );
  }
  if (accounts.length === 1) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-[var(--text-primary)]">
        <AtSign className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <span>{accounts[0].label || accounts[0].email_address}</span>
        <span className="text-xs text-[var(--text-tertiary)]">&lt;{accounts[0].email_address}&gt;</span>
      </div>
    );
  }
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none bg-transparent text-sm text-[var(--text-primary)] outline-none pr-6 cursor-pointer w-full"
      >
        {accounts.map(a => (
          <option key={a.id} value={a.id}>
            {a.label ? `${a.label} (${a.email_address})` : a.email_address}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
    </div>
  );
}

/* ─── Compose Modal ───────────────────────────────── */
function ComposeModal({ onClose, onSend, onSchedule, sending, smtpAccounts, templates }: {
  onClose: () => void;
  onSend: (data: { to: string; subject: string; body: string; body_html?: string; smtp_account_id?: string }) => void;
  onSchedule: (data: { to: string; subject: string; body: string; body_html?: string; smtp_account_id?: string; scheduled_at: string }) => void;
  sending?: boolean;
  smtpAccounts: SmtpAccount[];
  templates?: { id: string; name: string; subject: string; body_html: string }[];
}) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [senderId, setSenderId] = useState(smtpAccounts[0]?.id || '');
  const [expanded, setExpanded] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const editor = useRichTextEditorRef();
  const sig = useSignatureState(smtpAccounts, senderId);

  // smtpAccounts is fetched async and can still be empty when this modal
  // first mounts; resync once accounts arrive so the selected sender always
  // matches what's actually shown in <SenderSelect>.
  useEffect(() => {
    if (!senderId && smtpAccounts[0]) {
      setSenderId(smtpAccounts[0].id);
    }
  }, [smtpAccounts, senderId]);

  const canSend = to && subject && !editor.isEmpty && !sending && smtpAccounts.length > 0;

  const handleSchedule = (scheduledAt: string) => {
    if (to && subject && !editor.isEmpty) {
      const b = withSignature(editor.html, editor.text, sig.sigHtml, sig.on);
      onSchedule({ to, subject, body: b.body, body_html: b.body_html, smtp_account_id: senderId || undefined, scheduled_at: scheduledAt });
      setShowSchedule(false);
    }
  };

  const senderAcct = smtpAccounts.find(a => a.id === senderId) || smtpAccounts[0];

  return (
    <div className={`fixed inset-0 z-50 flex ${expanded ? 'items-center justify-center' : 'items-end justify-end'} p-4`}>
      <div className="fixed inset-0 bg-black/25 backdrop-blur-[1px]" onClick={onClose} />
      <div
        className={`relative bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-default)] flex flex-col transition-all duration-200 overflow-hidden ${
          expanded ? 'w-[820px] max-h-[85vh]' : 'w-[640px] max-h-[85vh]'
        }`}
        style={{ boxShadow: 'var(--shadow-xl)' }}
      >
        {/* Header — matches the reply composer's icon + title language */}
        <div className="flex items-center gap-2.5 px-4 h-[52px] border-b border-[var(--border-subtle)] flex-shrink-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--indigo-subtle)] flex-shrink-0">
            <MailPlus className="h-3.5 w-3.5 text-[var(--indigo)]" />
          </span>
          <p className="flex-1 text-[13px] font-semibold text-[var(--text-primary)]">New message</p>
          <button
            onClick={() => setExpanded(!expanded)}
            className="icon-btn h-7 w-7 flex-shrink-0"
            title={expanded ? 'Minimize' : 'Expand'}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button onClick={onClose} title="Close" className="icon-btn h-7 w-7 flex-shrink-0"><X className="h-3.5 w-3.5" /></button>
        </div>

        {/* To — recipient, with the sending-inbox routing on the right (two identities) */}
        <div className="flex items-center gap-2.5 px-4 h-11 border-b border-[var(--border-subtle)] flex-shrink-0">
          <span className="text-[11px] font-medium text-[var(--text-tertiary)] flex-shrink-0">To</span>
          <input value={to} onChange={e => setTo(e.target.value)} className="flex-1 min-w-0 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]" placeholder="recipient@example.com" autoFocus />
          <span className="text-[11px] text-[var(--text-tertiary)] flex-shrink-0 hidden sm:inline">via</span>
          <div className="min-w-0 max-w-[190px] flex-shrink-0">
            <SenderSelect accounts={smtpAccounts} value={senderId} onChange={setSenderId} />
          </div>
          {senderAcct && (senderAcct.is_verified ? (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400 flex-shrink-0" title="This inbox is verified for sending.">
              <BadgeCheck className="h-3.5 w-3.5" /><span className="hidden md:inline">Verified</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-600 dark:text-amber-400 flex-shrink-0" title="This inbox isn't verified for sending — deliverability may suffer.">
              Unverified
            </span>
          ))}
        </div>

        {/* Subject */}
        <div className="flex items-center gap-2.5 px-4 h-11 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex-shrink-0">
          <span className="text-[11px] font-medium text-[var(--text-tertiary)] flex-shrink-0">Subject</span>
          <input value={subject} onChange={e => setSubject(e.target.value)} className="flex-1 min-w-0 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]" placeholder="Add a subject" />
        </div>

        {/* Writing surface — seamless bare editor, like the reply composer */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <RichTextEditor
            bare
            placeholder="Write your message…"
            onChange={editor.handleChange}
            onTemplateSelect={(t) => { if (t.subject) setSubject(t.subject); }}
            templates={templates}
            minHeight={expanded ? '320px' : '200px'}
          />
          {sig.on && (
            <SignaturePreview html={sig.sigHtml!} onRemove={() => sig.setOn(false)} />
          )}
        </div>

        {/* Action bar — Discard left, Schedule + Send right */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 flex-shrink-0">
          <div className="flex items-center gap-1 min-w-0">
            <button onClick={onClose} className="h-9 px-3 rounded-lg text-[13px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">Discard</button>
            <SignatureButton available={sig.available} on={sig.on} onToggle={sig.toggle} />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setShowSchedule(!showSchedule)}
                disabled={!canSend}
                className={`flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium transition-all disabled:opacity-40 ${
                  showSchedule
                    ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)] border border-[rgba(91,91,245,0.25)]'
                    : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
                title="Schedule send"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                <span>Schedule</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${showSchedule ? 'rotate-180' : ''}`} />
              </button>
              {showSchedule && <ScheduleSendPicker onSchedule={handleSchedule} onClose={() => setShowSchedule(false)} />}
            </div>
            <button
              onClick={() => {
                if (canSend) {
                  const b = withSignature(editor.html, editor.text, sig.sigHtml, sig.on);
                  onSend({ to, subject, body: b.body, body_html: b.body_html, smtp_account_id: senderId || undefined });
                }
              }}
              disabled={!canSend}
              className="flex items-center gap-2 h-9 px-4 rounded-lg bg-[var(--indigo)] text-white text-[13px] font-semibold hover:bg-[var(--indigo-hover)] transition-colors disabled:opacity-40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(67,56,202,0.35)]"
            >
              <Send className="h-3.5 w-3.5" />
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── AI Reply Assist Bar ─────────────────────────── */
function AiAssistBar({ messageId, onInsert }: { messageId: string; onInsert: (html: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const aiMut = useMutation({
    mutationFn: ({ id, prompt }: { id: string; prompt: string }) => inboxApi.aiReplyAssist(id, prompt),
    onSuccess: (data) => {
      onInsert(data.html);
      setPrompt('');
      setIsOpen(false);
      toast.success('AI reply generated');
    },
    onError: () => toast.error('Failed to generate AI reply'),
  });

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--indigo)] hover:bg-[#6366F1]/5 transition-colors"
      >
        <Wand2 className="h-3.5 w-3.5" />
        AI Assist
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--indigo-subtle)]">
      <Wand2 className="h-4 w-4 text-[var(--indigo)] flex-shrink-0" />
      <input
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && prompt.trim() && !aiMut.isPending) {
            aiMut.mutate({ id: messageId, prompt: prompt.trim() });
          }
          if (e.key === 'Escape') setIsOpen(false);
        }}
        placeholder="Describe your reply... e.g. 'Accept the meeting' or 'Politely decline'"
        className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        autoFocus
      />
      <button
        onClick={() => {
          if (prompt.trim() && !aiMut.isPending) {
            aiMut.mutate({ id: messageId, prompt: prompt.trim() });
          }
        }}
        disabled={!prompt.trim() || aiMut.isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--indigo)] text-white text-xs font-medium hover:bg-[var(--indigo-hover)] transition-colors disabled:opacity-40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
      >
        {aiMut.isPending ? (
          <><Loader2 className="h-3 w-3 animate-spin" /> Generating...</>
        ) : (
          <><Sparkles className="h-3 w-3" /> Generate</>
        )}
      </button>
      <button
        onClick={() => setIsOpen(false)}
        className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ─── Custom Calendar Grid ────────────────────────── */
function CustomCalendar({ selected, onSelect }: { selected: Date | null; onSelect: (d: Date) => void }) {
  const [viewDate, setViewDate] = useState(() => selected || new Date());
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const days = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const cells: { day: number; current: boolean; date: Date }[] = [];

    // Previous month trailing days
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrev - i;
      cells.push({ day: d, current: false, date: new Date(year, month - 1, d) });
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, current: true, date: new Date(year, month, d) });
    }
    // Next month leading days
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        cells.push({ day: d, current: false, date: new Date(year, month + 1, d) });
      }
    }
    return cells;
  }, [year, month]);

  const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const isPast = (d: Date) => d < today;

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">{monthLabel}</span>
        <button
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className="text-center text-[10px] font-semibold text-[var(--text-muted)] py-1">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {days.map((cell, i) => {
          const isSelected = selected && isSameDay(cell.date, selected);
          const isToday = isSameDay(cell.date, today);
          const disabled = isPast(cell.date) || !cell.current;
          return (
            <button
              key={i}
              disabled={disabled}
              onClick={() => onSelect(cell.date)}
              className={`relative w-full aspect-square flex items-center justify-center text-[12px] rounded-lg transition-all ${
                isSelected
                  ? 'bg-[var(--indigo)] text-[var(--bg-app)] font-semibold shadow-sm'
                  : isToday
                    ? 'font-semibold text-[var(--indigo)] hover:bg-[#6366F1]/10'
                    : !cell.current
                      ? 'text-[var(--text-muted)]'
                      : disabled
                        ? 'text-[var(--text-muted)] cursor-not-allowed'
                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {cell.day}
              {isToday && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--indigo)]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Custom Time Picker ─────────────────────────── */
function CustomTimePicker({ value, onChange }: { value: { hour: number; minute: number }; onChange: (v: { hour: number; minute: number }) => void }) {
  const isPM = value.hour >= 12;
  const display12 = value.hour === 0 ? 12 : value.hour > 12 ? value.hour - 12 : value.hour;

  const hours12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const minutes = [0, 15, 30, 45];

  const setHour12 = (h12: number) => {
    let h24 = h12;
    if (isPM) h24 = h12 === 12 ? 12 : h12 + 12;
    else h24 = h12 === 12 ? 0 : h12;
    onChange({ hour: h24, minute: value.minute });
  };

  const togglePeriod = () => {
    onChange({ hour: (value.hour + 12) % 24, minute: value.minute });
  };

  return (
    <div>
      {/* Period toggle + selected time display */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            {display12}:{String(value.minute).padStart(2, '0')} {isPM ? 'PM' : 'AM'}
          </span>
        </div>
        <div className="flex rounded-lg border border-[var(--border-subtle)] overflow-hidden">
          <button
            onClick={() => { if (isPM) togglePeriod(); }}
            className={`px-2.5 py-1 text-[11px] font-semibold transition-all ${
              !isPM ? 'bg-[var(--indigo)] text-[var(--bg-app)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'
            }`}
          >AM</button>
          <button
            onClick={() => { if (!isPM) togglePeriod(); }}
            className={`px-2.5 py-1 text-[11px] font-semibold transition-all border-l border-[var(--border-subtle)] ${
              isPM ? 'bg-[var(--indigo)] text-[var(--bg-app)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'
            }`}
          >PM</button>
        </div>
      </div>

      {/* Hour grid */}
      <div className="mb-2">
        <span className="text-[10px] font-semibold text-[var(--text-muted)] mb-1.5 block">Hour</span>
        <div className="grid grid-cols-6 gap-1">
          {hours12.map(h => (
            <button
              key={h}
              onClick={() => setHour12(h)}
              className={`py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                display12 === h
                  ? 'bg-[var(--indigo)] text-[var(--bg-app)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              {h}
            </button>
          ))}
        </div>
      </div>

      {/* Minute grid */}
      <div>
        <span className="text-[10px] font-semibold text-[var(--text-muted)] mb-1.5 block">Minute</span>
        <div className="grid grid-cols-4 gap-1">
          {minutes.map(m => (
            <button
              key={m}
              onClick={() => onChange({ ...value, minute: m })}
              className={`py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                value.minute === m
                  ? 'bg-[var(--indigo)] text-[var(--bg-app)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              :{String(m).padStart(2, '0')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Schedule Send Picker ────────────────────────── */
function ScheduleSendPicker({ onSchedule, onClose }: { onSchedule: (date: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'presets' | 'calendar' | 'time'>('presets');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState({ hour: 9, minute: 0 });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const presets = useMemo(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextMonday = new Date(now);
    nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));

    const fmt = (d: Date, h: number, m: number) => {
      const dt = new Date(d);
      dt.setHours(h, m, 0, 0);
      return dt;
    };

    const items: { label: string; sublabel: string; date: Date; icon: React.ElementType }[] = [];

    const tomMorn = fmt(tomorrow, 8, 0);
    items.push({
      label: 'Tomorrow morning',
      sublabel: tomMorn.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · 8:00 AM',
      date: tomMorn,
      icon: Sun,
    });

    const tomAfter = fmt(tomorrow, 13, 0);
    items.push({
      label: 'Tomorrow afternoon',
      sublabel: tomAfter.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · 1:00 PM',
      date: tomAfter,
      icon: CloudSun,
    });

    if (now.getDay() !== 1) {
      const monMorn = fmt(nextMonday, 8, 0);
      items.push({
        label: 'Monday morning',
        sublabel: monMorn.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · 8:00 AM',
        date: monMorn,
        icon: Briefcase,
      });
    }

    return items;
  }, []);

  const handleConfirmSchedule = () => {
    if (!selectedDate) return;
    const dt = new Date(selectedDate);
    dt.setHours(selectedTime.hour, selectedTime.minute, 0, 0);
    if (dt <= new Date()) {
      toast.error('Scheduled time must be in the future');
      return;
    }
    onSchedule(dt.toISOString());
  };

  const selectedDateLabel = selectedDate
    ? selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : '';

  const isPM = selectedTime.hour >= 12;
  const display12 = selectedTime.hour === 0 ? 12 : selectedTime.hour > 12 ? selectedTime.hour - 12 : selectedTime.hour;
  const selectedTimeLabel = `${display12}:${String(selectedTime.minute).padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;

  return (
    <div ref={ref} className="absolute bottom-full left-0 mb-2 w-80 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl z-50 overflow-hidden" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          {view !== 'presets' && (
            <button
              onClick={() => setView(view === 'time' ? 'calendar' : 'presets')}
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
          {view === 'presets' && (
            <div className="w-7 h-7 rounded-lg bg-[#6366F1]/10 flex items-center justify-center">
              <CalendarClock className="h-3.5 w-3.5 text-[var(--indigo)]" />
            </div>
          )}
          <div className="flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {view === 'presets' ? 'Schedule Send' : view === 'calendar' ? 'Pick a Date' : 'Pick a Time'}
            </p>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              {view === 'presets' ? 'Choose when to deliver' : view === 'calendar' ? 'Select your send date' : selectedDateLabel}
            </p>
          </div>
        </div>
      </div>

      {/* Presets View */}
      {view === 'presets' && (
        <>
          <div className="p-2">
            {presets.map((p, i) => {
              const Icon = p.icon;
              return (
                <button
                  key={i}
                  onClick={() => onSchedule(p.date.toISOString())}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] transition-colors flex items-center gap-3 group"
                >
                  <div className="w-8 h-8 rounded-lg bg-[var(--bg-elevated)] group-hover:bg-[#6366F1]/10 flex items-center justify-center transition-colors border border-[var(--border-subtle)] group-hover:border-[#6366F1]/20">
                    <Icon className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[var(--indigo)] transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] font-medium text-[var(--text-primary)] block">{p.label}</span>
                    <span className="text-[11px] text-[var(--text-tertiary)]">{p.sublabel}</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-tertiary)] transition-colors" />
                </button>
              );
            })}
          </div>
          <div className="mx-3 border-t border-[var(--border-subtle)]" />
          <div className="p-2">
            <button
              onClick={() => setView('calendar')}
              className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)] transition-colors flex items-center gap-3 group"
            >
              <div className="w-8 h-8 rounded-lg bg-[var(--bg-elevated)] group-hover:bg-[#6366F1]/10 flex items-center justify-center transition-colors border border-[var(--border-subtle)] group-hover:border-[#6366F1]/20">
                <Calendar className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[var(--indigo)] transition-colors" />
              </div>
              <div className="flex-1">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">Custom date & time</span>
                <span className="text-[11px] text-[var(--text-tertiary)] block">Pick a specific date and time</span>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-tertiary)] transition-colors" />
            </button>
          </div>
        </>
      )}

      {/* Calendar View */}
      {view === 'calendar' && (
        <div className="p-3">
          <CustomCalendar
            selected={selectedDate}
            onSelect={(d) => {
              setSelectedDate(d);
              setView('time');
            }}
          />
        </div>
      )}

      {/* Time View */}
      {view === 'time' && (
        <div className="p-3">
          <CustomTimePicker value={selectedTime} onChange={setSelectedTime} />
          <button
            onClick={handleConfirmSchedule}
            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--indigo)] text-white text-[13px] font-semibold hover:bg-[var(--indigo-hover)] transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(67,56,202,0.35)]"
          >
            <CalendarClock className="h-3.5 w-3.5" />
            Schedule for {selectedDateLabel} · {selectedTimeLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Folder Selector Dropdown ────────────────────── */
function FolderSelector({ folders, active, onChange }: {
  folders: { id: Folder; label: string; icon: React.ElementType; count?: number }[];
  active: Folder;
  onChange: (id: Folder) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const current = folders.find(f => f.id === active) || folders[0];
  const CurrentIcon = current.icon;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-[var(--text-primary)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        <CurrentIcon className="h-3.5 w-3.5" />
        {current.label}
        {current.count ? (
          <span className="text-[9px] bg-[var(--indigo)] text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-bold">{current.count}</span>
        ) : null}
        <ChevronDown className={`h-3 w-3 text-[var(--text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-lg overflow-hidden z-50">
          {folders.map(f => {
            const FolderIcon = f.icon;
            const isActive = active === f.id;
            return (
              <button
                key={f.id}
                onClick={() => { onChange(f.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2.5 text-xs font-medium transition-colors flex items-center gap-2.5 ${
                  isActive ? 'bg-[rgba(99,102,241,0.08)] text-[var(--indigo)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <FolderIcon className={`h-3.5 w-3.5 ${isActive ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]'}`} />
                <span className="flex-1">{f.label}</span>
                {f.count ? (
                  <span className="text-[9px] bg-[var(--indigo)] text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-bold">{f.count}</span>
                ) : null}
                {isActive && (
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--indigo)]" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Tag Filter Dropdown ─────────────────────────── */
function TagFilterDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = TAG_OPTIONS.find(t => t.value === value) || TAG_OPTIONS[0];
  const intentColor = value !== 'all' ? INTENT_COLORS[value] : null;

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
          value !== 'all'
            ? `${intentColor?.bg || 'bg-[var(--bg-elevated)]'} ${intentColor?.text || 'text-[var(--text-primary)]'}`
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
        }`}
      >
        <Tag className="h-3 w-3" />
        {selected.label}
        <ChevronDown className="h-2.5 w-2.5" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-44 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-lg overflow-hidden z-50">
          {TAG_OPTIONS.map(opt => {
            const ic = opt.value !== 'all' ? INTENT_COLORS[opt.value] : null;
            return (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors flex items-center gap-2 ${
                  value === opt.value ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {ic && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'currentColor' }} />}
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Thread Timeline — conversation viewer ───────── */

/** Day separator pill that sits on the timeline rail. */
function DaySeparator({ label, gap }: { label: string; gap?: string }) {
  return (
    <div className="relative z-10 flex items-center gap-2 py-2.5">
      <span className="flex h-[22px] items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-[10.5px] font-semibold text-[var(--text-tertiary)] shadow-sm">
        {label}
      </span>
      {gap && <span className="text-[10.5px] font-medium text-[var(--text-muted)]">{gap}</span>}
    </div>
  );
}

/** One message on the timeline: direction-coded node + expandable card. */
function TimelineMessage({ msg, threadSubject, isCurrent, expanded, onToggle }: {
  msg: Message;
  threadSubject: string | null;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isOutbound = msg.direction === 'outbound';
  const intent = !isOutbound && msg.sara_intent && msg.sara_intent !== 'scheduled'
    ? (INTENT_COLORS[msg.sara_intent] || INTENT_COLORS.other)
    : null;
  const subjectChanged = !!baseSubject(msg.subject) && !!baseSubject(threadSubject) && baseSubject(msg.subject) !== baseSubject(threadSubject);
  const d = new Date(msg.received_at);
  const stamp = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const viaInbox = msg.smtp_label || msg.smtp_email?.split('@')[0] || null;

  return (
    <div id={`msg-${msg.id}`} className="relative flex gap-3 pb-3 animate-fade-in">
      {/* Rail node — avatar for the contact, indigo send-node for you */}
      <div className="relative z-10 w-9 flex-shrink-0 flex justify-center pt-2">
        {isOutbound ? (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--indigo)] text-white ring-4 ring-[var(--bg-app)] shadow-[0_2px_8px_-2px_rgba(91,91,245,0.55)]">
            <SendHorizontal className="h-3.5 w-3.5" />
          </span>
        ) : (
          <span className="inline-flex rounded-full ring-4 ring-[var(--bg-app)]">
            <Avatar name={msg.contact_name || senderName(msg)} email={msg.from_email} size="lg" />
          </span>
        )}
      </div>

      {/* Card */}
      <div className={cn(
        'flex-1 min-w-0 panel overflow-hidden transition-shadow',
        isOutbound && 'border-[rgba(91,91,245,0.28)]',
        isCurrent && 'ring-2 ring-[rgba(91,91,245,0.22)]'
      )}>
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'w-full text-left px-4 py-2.5 transition-colors',
            expanded
              ? cn('border-b', isOutbound
                  ? 'bg-[var(--indigo-subtle)] border-[rgba(91,91,245,0.15)] hover:bg-[rgba(91,91,245,0.12)]'
                  : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]/60')
              : 'hover:bg-[var(--bg-hover)]/60'
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--text-primary)] flex-shrink-0">
              {isOutbound ? 'You' : senderName(msg)}
            </span>
            <span className="text-[11px] text-[var(--text-tertiary)] truncate">
              {isOutbound ? `to ${msg.to_email || 'contact'}` : (viaInbox ? `to ${viaInbox}` : msg.from_email)}
            </span>
            <span className="flex-1" />
            {!expanded && intent && (
              <span className={cn('hidden sm:inline-flex items-center text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0', intent.bg, intent.text)}>
                {intent.label}
              </span>
            )}
            <span className="text-[10.5px] text-[var(--text-tertiary)] tabular flex-shrink-0" title={formatFullDate(msg.received_at)}>{stamp}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 text-[var(--text-muted)] transition-transform flex-shrink-0', expanded && 'rotate-180')} />
          </div>

          {!expanded ? (
            <p className="mt-1 text-[12px] text-[var(--text-tertiary)] truncate">{msgSnippet(msg)}</p>
          ) : (
            (intent || subjectChanged || msg.campaign_name || (isOutbound && viaInbox)) && (
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {intent && (
                  <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md', intent.bg, intent.text)}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                    {intent.label}
                  </span>
                )}
                {isOutbound && viaInbox && (
                  <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-blue-500/8 text-blue-500" title={msg.smtp_email || undefined}>
                    via {viaInbox}
                  </span>
                )}
                {msg.campaign_name && (
                  <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">{msg.campaign_name}</span>
                )}
                {subjectChanged && (
                  <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 truncate max-w-[260px]" title={msg.subject || undefined}>
                    Subject: {msg.subject}
                  </span>
                )}
              </div>
            )
          )}
        </button>

        {expanded && (
          <ErrorBoundary fallback={
            <div className="p-5 text-sm text-[var(--text-secondary)]">
              <p>{msg.body_text ? stripHtml(msg.body_text) : '(Unable to render email content)'}</p>
            </div>
          }>
            <EmailBody html={msg.body_html} text={msg.body_text} />
          </ErrorBoundary>
        )}
      </div>
    </div>
  );
}

function ThreadTimeline({ thread, threadSubject, selectedId }: {
  thread: Message[];
  threadSubject: string | null;
  selectedId: string | null;
}) {
  // Expand the latest message and the selected one by default, collapse older ones
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    if (thread.length > 0) ids.add(thread[thread.length - 1].id);
    if (selectedId) ids.add(selectedId);
    return ids;
  });
  const [showEarlier, setShowEarlier] = useState(false);

  useEffect(() => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (thread.length > 0) next.add(thread[thread.length - 1].id);
      if (selectedId) next.add(selectedId);
      return next;
    });
  }, [thread.length, selectedId]);

  // Long threads fold everything but the last few behind a rail pill
  const RECENT = 4;
  const earlierCount = thread.length > RECENT ? thread.length - RECENT : 0;

  // If the selected message is inside the folded section, reveal it
  useEffect(() => {
    if (!selectedId || showEarlier || earlierCount === 0) return;
    if (thread.slice(0, earlierCount).some(m => m.id === selectedId)) setShowEarlier(true);
  }, [selectedId, earlierCount, showEarlier, thread]);

  const visible = showEarlier || earlierCount === 0 ? thread : thread.slice(earlierCount);

  const toggle = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const rows: React.ReactNode[] = [];
  let prev: Date | null = null;

  if (earlierCount > 0) {
    rows.push(
      <div key="earlier" className="relative z-10 flex py-1.5">
        <button
          onClick={() => setShowEarlier(v => !v)}
          className="flex items-center gap-1.5 h-7 pl-2 pr-3 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-colors shadow-sm"
        >
          {showEarlier ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {showEarlier ? 'Hide earlier messages' : `Show ${earlierCount} earlier message${earlierCount === 1 ? '' : 's'}`}
        </button>
      </div>
    );
  }

  for (const msg of visible) {
    const d = new Date(msg.received_at);
    if (!prev || d.toDateString() !== prev.toDateString()) {
      const gapDays = prev ? Math.round((startOfDay(d) - startOfDay(prev)) / 86400000) : 0;
      rows.push(
        <DaySeparator
          key={`day-${msg.id}`}
          label={dayLabel(msg.received_at)}
          gap={gapDays >= 2 ? `${gapDays} days later` : undefined}
        />
      );
    }
    rows.push(
      <TimelineMessage
        key={msg.id}
        msg={msg}
        threadSubject={threadSubject}
        isCurrent={msg.id === selectedId}
        expanded={expandedIds.has(msg.id)}
        onToggle={() => toggle(msg.id)}
      />
    );
    prev = d;
  }

  return (
    <div className="relative">
      {/* Timeline rail */}
      <span aria-hidden className="absolute left-[17px] top-4 bottom-4 w-px bg-[var(--border-default)] opacity-70" />
      {rows}
    </div>
  );
}

/* ─── Contact context panel (right rail) ──────────── */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[5px]">
      <span className="text-[11px] text-[var(--text-tertiary)] flex-shrink-0">{label}</span>
      <span className="text-[11.5px] font-medium text-[var(--text-primary)] text-right min-w-0 truncate">{children}</span>
    </div>
  );
}

function ContactContextPanel({ msg, stats, onCopyEmail }: {
  msg: Message;
  stats: { total: number; inbound: number; outbound: number; first: string | null; last: string | null; avgReply: number | null };
  onCopyEmail: () => void;
}) {
  const email = msg.direction === 'outbound' ? (msg.contact_email || msg.to_email) : (msg.contact_email || msg.from_email);
  const name = msg.contact_name || (email ? email.split('@')[0] : 'Contact');
  const company = companyFromEmail(email);
  const intent = msg.sara_intent && msg.sara_intent !== 'scheduled' ? (INTENT_COLORS[msg.sara_intent] || INTENT_COLORS.other) : null;
  // Only link to the lead record when the message is matched to a real contact.
  const contactHref = msg.contact_id ? `/contacts/${msg.contact_id}` : null;
  const sendingInbox = msg.smtp_label || msg.smtp_email;

  return (
    <aside className="hidden xl:flex w-[280px] flex-shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] flex-col overflow-y-auto">
      {/* ── Prospect card — the person, linked to their lead record ── */}
      <div className="px-3.5 pt-4 pb-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1">Prospect</p>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-3.5">
          <div className="flex items-start gap-3">
            <Avatar name={name} email={email} size="md" />
            <div className="min-w-0 flex-1">
              {contactHref ? (
                <Link
                  to={contactHref}
                  className="group inline-flex items-center gap-1 text-[13.5px] font-semibold text-[var(--text-primary)] hover:text-[var(--indigo)] transition-colors leading-tight"
                >
                  <span className="truncate">{name}</span>
                  <ArrowUpRight className="h-3 w-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ) : (
                <p className="text-[13.5px] font-semibold text-[var(--text-primary)] leading-tight truncate">{name}</p>
              )}
              {email && <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)] truncate">{email}</p>}
              {company && (
                <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                  <Building2 className="h-3 w-3 text-[var(--text-tertiary)]" />
                  {company}
                </span>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <button
              onClick={onCopyEmail}
              className="flex items-center justify-center gap-1.5 h-7 flex-1 rounded-lg border border-[var(--border-default)] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Copy className="h-3 w-3" /> Copy email
            </button>
            {contactHref && (
              <Link
                to={contactHref}
                className="flex items-center justify-center gap-1.5 h-7 flex-1 rounded-lg border border-[var(--border-default)] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              >
                Open lead <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Campaign card — which sequence this thread belongs to ── */}
      {(msg.campaign_name || sendingInbox) && (
        <div className="px-3.5 pb-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1">Campaign</p>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-3.5">
            {msg.campaign_name ? (
              <div className="flex items-start gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--indigo-subtle)] flex-shrink-0">
                  <Megaphone className="h-3.5 w-3.5 text-[var(--indigo)]" />
                </span>
                <div className="min-w-0 flex-1">
                  {msg.campaign_id ? (
                    <Link
                      to={`/campaigns/${msg.campaign_id}`}
                      className="group inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--text-primary)] hover:text-[var(--indigo)] transition-colors leading-snug"
                    >
                      <span className="truncate">{msg.campaign_name}</span>
                      <ArrowUpRight className="h-3 w-3 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  ) : (
                    <p className="text-[12.5px] font-semibold text-[var(--text-primary)] leading-snug truncate">{msg.campaign_name}</p>
                  )}
                  <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">Outreach sequence</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex-shrink-0">
                  <AtSign className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold text-[var(--text-primary)] leading-snug">Direct message</p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">Not part of a campaign</p>
                </div>
              </div>
            )}
            {sendingInbox && (
              <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">Sending from</span>
                <span className="ml-auto text-[11px] font-medium text-[var(--text-primary)] truncate">{sendingInbox}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Engagement ── */}
      <div className="px-3.5 pb-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 px-1">Engagement</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="panel-inset px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
              <ArrowDownLeft className="h-3 w-3 text-emerald-500" />
              <span className="text-[10.5px] font-medium">Received</span>
            </div>
            <p className="mt-0.5 text-[15px] font-semibold tabular text-[var(--text-primary)] leading-none">{stats.inbound}</p>
          </div>
          <div className="panel-inset px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
              <ArrowUpRight className="h-3 w-3 text-[var(--indigo)]" />
              <span className="text-[10.5px] font-medium">Sent</span>
            </div>
            <p className="mt-0.5 text-[15px] font-semibold tabular text-[var(--text-primary)] leading-none">{stats.outbound}</p>
          </div>
          <div className="panel-inset px-2.5 py-1.5 col-span-2">
            <div className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
              <Clock className="h-3 w-3" />
              <span className="text-[10.5px] font-medium">Avg reply gap</span>
            </div>
            <p className="mt-0.5 text-[15px] font-semibold tabular text-[var(--text-primary)] leading-none">
              {stats.avgReply != null ? humanizeMs(stats.avgReply) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Details ── */}
      <div className="px-3.5 pb-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 px-1">Details</p>
        <div className="px-1">
          <DetailRow label="Intent">
            {intent ? (
              <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md', intent.bg, intent.text)}>{intent.label}</span>
            ) : <span className="text-[var(--text-tertiary)] font-normal">Untagged</span>}
          </DetailRow>
          {stats.first && (
            <DetailRow label="First contact">{new Date(stats.first).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</DetailRow>
          )}
          {stats.last && (
            <DetailRow label="Last activity">{timeAgo(stats.last)} ago</DetailRow>
          )}
          <DetailRow label="Messages"><span className="tabular">{stats.total}</span></DetailRow>
        </div>
      </div>
    </aside>
  );
}

/* ─── Scheduled Emails Panel ─────────────────────── */
function ScheduledEmailsPanel({ onCancel }: { onCancel: (id: string) => void }) {
  const { data: scheduled, isLoading } = useQuery({
    queryKey: ['inbox', 'scheduled'],
    queryFn: inboxApi.listScheduled,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-10"><Spinner size="md" /></div>;
  }

  const emails = scheduled || [];

  if (emails.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center mb-4 border border-[var(--border-subtle)]">
            <Clock className="h-7 w-7 text-[var(--text-tertiary)]" />
          </div>
          <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1.5">No scheduled emails</h3>
          <p className="text-sm text-[var(--text-secondary)] max-w-xs">Schedule emails from compose or reply to see them here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-5 w-5 text-[var(--indigo)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Scheduled Emails</h2>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#6366F1]/10 text-[var(--indigo)]">{emails.length}</span>
        </div>
        {emails.map((email: any) => {
          const scheduledDate = new Date(email.scheduled_at);
          const isPast = scheduledDate < new Date();
          return (
            <div
              key={email.id}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden"
              style={{ boxShadow: 'var(--shadow-card)' }}
            >
              <div className="flex items-start gap-3 p-4">
                <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-[#6366F1]/10 border border-[#6366F1]/20">
                  <Clock className="h-4 w-4 text-[var(--indigo)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">To: {email.to_email}</span>
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                      isPast ? 'bg-amber-500/10 text-amber-500' : 'bg-[#6366F1]/10 text-[var(--indigo)]'
                    }`}>
                      {isPast ? 'Sending soon...' : 'Scheduled'}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] mt-0.5 truncate">{email.subject || '(no subject)'}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                      <Calendar className="h-3 w-3" />
                      {scheduledDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                      <Clock className="h-3 w-3" />
                      {scheduledDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                    {email.smtp_email && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-blue-500/8 text-blue-500">
                        via {email.smtp_label || email.smtp_email.split('@')[0]}
                      </span>
                    )}
                  </div>
                  {email.body_text && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-2 line-clamp-2">{stripHtml(email.body_text || email.body_html || '').slice(0, 200)}</p>
                  )}
                </div>
                <button
                  onClick={() => onCancel(email.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0"
                  title="Cancel scheduled email"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Conversation grouping (shared by list + sidebar counts) ───
   Emails are matched case-insensitively everywhere a message needs to be
   tied to its thread (grouping, mark-as-read, archive/unarchive) — raw
   header casing varies across providers, and comparing raw case in one
   place while lowercasing in another silently splits a single conversation
   into two or breaks optimistic UI updates for it. */
function threadEmailOf(msg: Message): string {
  const raw = msg.direction === 'outbound'
    ? (msg.contact_email || msg.to_email)
    : (msg.contact_email || msg.from_email);
  return (raw || '').toLowerCase();
}

function groupConversations(messages: Message[]): ConversationThread[] {
  if (messages.length === 0) return [];
  const threadMap = new Map<string, Message[]>();

  for (const msg of messages) {
    if (msg.sara_status === 'scheduled') continue;
    const contactEmail = threadEmailOf(msg);
    if (!contactEmail) {
      threadMap.set(msg.id, [msg]);
      continue;
    }
    const existing = threadMap.get(contactEmail);
    if (existing) existing.push(msg);
    else threadMap.set(contactEmail, [msg]);
  }

  return Array.from(threadMap.entries()).map(([key, msgs]) => {
    msgs.sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
    const latest = msgs[0];
    return {
      contactEmail: key,
      contactName: latest.contact_name,
      latestMessage: latest,
      messageCount: msgs.length,
      hasUnread: msgs.some(m => !m.is_read),
      isStarred: msgs.some(m => m.is_starred),
    };
  }).sort((a, b) => new Date(b.latestMessage.received_at).getTime() - new Date(a.latestMessage.received_at).getTime());
}

/* ─── Sidebar navigation config ───────────────────── */
type NavItem = { id: string; label: string; icon?: React.ElementType; folder?: Folder; tag?: string; quick?: string; dot?: string; countKey?: string };

const FOLDER_NAV: NavItem[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox, folder: 'inbox', countKey: 'unread' },
  { id: 'starred', label: 'Starred', icon: Star, folder: 'starred' },
  { id: 'sent', label: 'Sent', icon: SendHorizontal, folder: 'sent' },
  { id: 'scheduled', label: 'Scheduled', icon: Clock, folder: 'scheduled' },
  { id: 'archived', label: 'Archived', icon: Archive, folder: 'archived' },
];

const SMART_NAV: NavItem[] = [
  { id: 'hot', label: 'Hot leads', icon: Sparkles, quick: 'hot', countKey: 'hot' },
  { id: 'needs_reply', label: 'Needs reply', icon: Reply, quick: 'needs_reply', countKey: 'needs_reply' },
  { id: 'meeting', label: 'Meetings booked', icon: Calendar, tag: 'meeting', countKey: 'meeting' },
];

const TAG_NAV: NavItem[] = [
  { id: 'interested', label: 'Interested', tag: 'interested', dot: INTENT_HEX.interested },
  { id: 'objection', label: 'Objection', tag: 'objection', dot: INTENT_HEX.objection },
  { id: 'out_of_office', label: 'Out of office', tag: 'out_of_office', dot: INTENT_HEX.out_of_office },
  { id: 'not_now', label: 'Not interested', tag: 'not_now', dot: INTENT_HEX.not_now },
  { id: 'unsubscribe', label: 'Unsubscribe', tag: 'unsubscribe', dot: INTENT_HEX.unsubscribe },
  { id: 'bounce', label: 'Bounce', tag: 'bounce', dot: INTENT_HEX.bounce },
];

/* ─── Sidebar row ─────────────────────────────────── */
function NavRow({ item, active, collapsed, count, onClick }: {
  item: NavItem; active: boolean; collapsed: boolean; count?: number; onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex items-center w-full rounded-[7px] border transition-colors',
        collapsed ? 'h-8 justify-center' : 'h-[29px] gap-2.5 px-2',
        active
          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-subtle)] shadow-[0_1px_2px_rgba(27,27,31,0.05)]'
          : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      )}
    >
      {item.dot
        ? <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: item.dot }} />
        : Icon && <Icon className={cn('h-[14px] w-[14px] flex-shrink-0', active ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')} strokeWidth={1.8} />}
      {!collapsed && (
        <>
          <span className="flex-1 text-left text-[12.5px] font-medium truncate">{item.label}</span>
          {count != null && count > 0 && (
            <span className={cn('text-[10.5px] font-semibold tabular', active ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')}>
              {count > 999 ? '999+' : count}
            </span>
          )}
        </>
      )}
      {collapsed && count != null && count > 0 && (
        <span className="absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--indigo)]" />
      )}
    </button>
  );
}

/* ─── SARA co-pilot card (surfaces AI triage inline) ── */
function SaraCopilot({ msg, onUseDraft }: { msg: Message; onUseDraft: () => void }) {
  const intent = msg.sara_intent;
  const info = intent ? (INTENT_COLORS[intent] || INTENT_COLORS.other) : null;
  const conf = msg.sara_confidence != null
    ? Math.round(msg.sara_confidence <= 1 ? msg.sara_confidence * 100 : msg.sara_confidence)
    : null;
  const hasDraft = !!msg.sara_draft_reply;
  if (!intent && !hasDraft && !msg.sara_action) return null;

  return (
    <div className="mb-5 rounded-2xl border border-[rgba(91,91,245,0.22)] bg-[var(--indigo-subtle)] overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--indigo)] text-white flex-shrink-0 shadow-[0_2px_8px_-2px_rgba(91,91,245,0.6)]">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12.5px] font-semibold text-[var(--text-primary)]">SARA analysis</span>
            {info && (
              <span className={cn('text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full', info.bg, info.text)}>{info.label}</span>
            )}
            {conf != null && (
              <span className="flex items-center gap-1.5 text-[10.5px] font-medium text-[var(--text-tertiary)]">
                <span className="relative h-1 w-14 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--indigo)]" style={{ width: `${conf}%` }} />
                </span>
                {conf}% confident
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-[var(--text-secondary)] leading-snug">
            {msg.sara_action || (hasDraft ? 'SARA drafted a reply for this conversation.' : 'SARA reviewed this reply and tagged its intent.')}
          </p>
        </div>
      </div>
      {hasDraft && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-t border-[rgba(91,91,245,0.18)] bg-[var(--bg-surface)]">
          <button
            onClick={onUseDraft}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[var(--indigo)] text-white text-[12px] font-semibold hover:bg-[var(--indigo-hover)] transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
          >
            <Wand2 className="h-3.5 w-3.5" /> Use SARA's draft
          </button>
          <span className="text-[11px] text-[var(--text-tertiary)] hidden sm:inline">Loads into the composer — review before sending.</span>
        </div>
      )}
    </div>
  );
}

/* ─── Main InboxPage ──────────────────────────────── */
export function InboxPage() {
  const qc = useQueryClient();
  const [folder, setFolder] = useState<Folder>('inbox');
  const [tagFilter, setTagFilter] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showContext, setShowContext] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [replyMode, setReplyMode] = useState<'reply' | 'forward' | null>(null);
  const [forwardTo, setForwardTo] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [replySenderId, setReplySenderId] = useState('');
  const [showReplySchedule, setShowReplySchedule] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const replyComposerRef = useRef<HTMLDivElement>(null);
  const replyEditor = useRichTextEditorRef();

  /* ── SMTP accounts for sender selection ── */
  const { data: smtpAccountsRaw } = useQuery({
    queryKey: ['smtp-accounts'],
    queryFn: smtpApi.list,
  });
  const smtpAccounts: SmtpAccount[] = (smtpAccountsRaw || []).filter((a: any) => a.is_active);

  // Signature state for the reply/forward composer — follows the chosen sender.
  const replySig = useSignatureState(smtpAccounts, replySenderId);

  /* ── Email templates for insertion ── */
  const { data: emailTemplates } = useQuery({
    queryKey: ['templates', 'emails'],
    queryFn: () => templateApi.listEmails(),
  });
  const templates = (emailTemplates || []).map((t: any) => ({
    id: t.id,
    name: t.name,
    subject: t.subject,
    body_html: t.body_html,
  }));

  /* ── Queries ── */
  const { data: messagesData, isLoading, isFetching } = useQuery({
    queryKey: ['inbox', folder, tagFilter, search],
    queryFn: () => inboxApi.list({
      limit: 50,
      folder: folder === 'scheduled' ? 'inbox' : folder,
      sara_intent: tagFilter !== 'all' ? tagFilter : undefined,
      search: search || undefined,
    }),
    enabled: folder !== 'scheduled',
  });

  const messages: Message[] = Array.isArray(messagesData?.data) ? messagesData.data : [];

  /* ── Sidebar badge counts — computed server-side over the whole mailbox
        (exact head-counts, uncapped) so smart-view / tag badges stay accurate
        at any scale. Invalidated by the shared ['inbox'] key on every mutation. ── */
  const { data: countsData } = useQuery({
    queryKey: ['inbox', 'counts'],
    queryFn: inboxApi.counts,
    refetchInterval: 60000,
  });
  const viewCounts = useMemo(() => {
    const intents = (countsData?.intents || {}) as Record<string, number>;
    const c: Record<string, number> = { ...intents };
    c.unread = countsData?.unread || 0;
    c.hot = (intents.interested || 0) + (intents.meeting || 0);
    c.needs_reply = (intents.interested || 0) + (intents.objection || 0) + (intents.meeting || 0);
    return c;
  }, [countsData]);

  const { data: selectedMsg } = useQuery({
    queryKey: ['inbox', 'detail', selectedId],
    queryFn: () => inboxApi.get(selectedId!),
    enabled: !!selectedId,
  });

  /* ── Thread / conversation history ── */
  const { data: threadMessages } = useQuery({
    queryKey: ['inbox', 'thread', selectedId],
    queryFn: () => inboxApi.getThread(selectedId!),
    enabled: !!selectedId,
  });
  const thread: Message[] = Array.isArray(threadMessages) ? threadMessages : [];

  /* ── Invalidation ── */
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['inbox'] });
  }, [qc]);

  const [syncErrors, setSyncErrors] = useState<string[]>([]);

  const syncMut = useMutation({
    mutationFn: inboxApi.syncInbox,
    onSuccess: (data) => {
      invalidate();
      setSyncErrors(data.errors || []);
      if (data.errors && data.errors.length > 0 && data.newMessages === 0) {
        toast.error(`Mail server connection failed — see banner for details`);
      } else if (data.errors && data.errors.length > 0) {
        toast.success(`${data.newMessages} new — some accounts had errors`);
      } else if (data.newMessages > 0) {
        toast.success(`${data.newMessages} new email${data.newMessages > 1 ? 's' : ''} synced`);
      } else if (data.synced === 0) {
        toast('No SMTP accounts configured — add one in Settings', { icon: 'ℹ️' });
      } else {
        toast.success('Unibox up to date');
      }
    },
    onError: () => {
      invalidate();
      setSyncErrors(['Sync request failed — check your internet connection.']);
      toast.error('Sync request failed — showing cached emails');
    },
  });

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await syncMut.mutateAsync();
    } catch { /* handled by mutation */ }
    await qc.invalidateQueries({ queryKey: ['inbox'] });
    setIsRefreshing(false);
  }, [syncMut, qc]);

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when typing in a form element or editable content
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'c' && !showCompose && !replyMode) {
        setShowCompose(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showCompose, replyMode]);

  /* ── Mutations ── */
  const markReadMut = useMutation({
    mutationFn: inboxApi.markRead,
    onSuccess: invalidate,
  });

  const markUnreadMut = useMutation({
    mutationFn: inboxApi.markUnread,
    onSuccess: invalidate,
  });

  const markAllReadMut = useMutation({
    mutationFn: inboxApi.markAllRead,
    onSuccess: () => {
      invalidate();
      toast.success('All marked as read');
    },
  });

  const toggleStarMut = useMutation({
    mutationFn: inboxApi.toggleStar,
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['inbox'] });
      const prevList = qc.getQueryData(['inbox', folder, tagFilter, search]);
      qc.setQueryData(['inbox', folder, tagFilter, search], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((m: Message) =>
            m.id === id ? { ...m, is_starred: !m.is_starred } : m
          ),
        };
      });
      const prevDetail = qc.getQueryData(['inbox', 'detail', id]);
      if (prevDetail) {
        qc.setQueryData(['inbox', 'detail', id], (old: any) =>
          old ? { ...old, is_starred: !old.is_starred } : old
        );
      }
      return { prevList, prevDetail };
    },
    onError: (_err, id, context) => {
      if (context?.prevList) qc.setQueryData(['inbox', folder, tagFilter, search], context.prevList);
      if (context?.prevDetail) qc.setQueryData(['inbox', 'detail', id], context.prevDetail);
      toast.error('Failed to toggle star');
    },
    onSettled: () => invalidate(),
  });

  const setTagMut = useMutation({
    mutationFn: ({ id, tag }: { id: string; tag: string }) => inboxApi.setTag(id, tag),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['inbox', 'detail'] });
      qc.invalidateQueries({ queryKey: ['inbox', 'thread'] });
      toast.success('Tag updated');
    },
    onError: () => toast.error('Failed to update tag'),
  });

  // Tagging a conversation "Meeting Booked" drops a meeting onto the CRM
  // calendar for tomorrow morning, linked to the contact — one less thing to
  // remember. Fired only when the intent is newly set to meeting.
  const bookMeetingMut = useMutation({
    mutationFn: (input: { title: string; contact_name: string | null; contact_email: string | null }) => {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      start.setHours(10, 0, 0, 0);
      return crmApi.createEvent({ ...input, type: 'meeting', starts_at: start.toISOString() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success('Meeting added to your CRM calendar');
    },
  });

  const archiveMut = useMutation({
    mutationFn: ({ id }: { id: string; contactEmail: string | null }) => inboxApi.archiveThread(id),
    onMutate: async ({ contactEmail }: { id: string; contactEmail: string | null }) => {
      await qc.cancelQueries({ queryKey: ['inbox', folder, tagFilter, search] });
      const prevData = qc.getQueryData(['inbox', folder, tagFilter, search]);
      if (contactEmail) {
        qc.setQueryData(['inbox', folder, tagFilter, search], (old: any) => {
          if (!old?.data) return old;
          return {
            ...old,
            data: old.data.filter((m: Message) => threadEmailOf(m) !== contactEmail),
          };
        });
      }
      return { prevData };
    },
    onError: (_err: any, _id: any, context: any) => {
      if (context?.prevData) qc.setQueryData(['inbox', folder, tagFilter, search], context.prevData);
      toast.error('Failed to archive');
    },
    onSuccess: () => {
      invalidate();
      toast.success('Archived');
    },
  });

  const unarchiveMut = useMutation({
    mutationFn: ({ id }: { id: string; contactEmail: string | null }) => inboxApi.unarchiveThread(id),
    onMutate: async ({ contactEmail }: { id: string; contactEmail: string | null }) => {
      await qc.cancelQueries({ queryKey: ['inbox', folder, tagFilter, search] });
      const prevData = qc.getQueryData(['inbox', folder, tagFilter, search]);
      if (contactEmail) {
        qc.setQueryData(['inbox', folder, tagFilter, search], (old: any) => {
          if (!old?.data) return old;
          return {
            ...old,
            data: old.data.filter((m: Message) => threadEmailOf(m) !== contactEmail),
          };
        });
      }
      return { prevData };
    },
    onError: (_err: any, _id: any, context: any) => {
      if (context?.prevData) qc.setQueryData(['inbox', folder, tagFilter, search], context.prevData);
      toast.error('Failed to unarchive');
    },
    onSuccess: () => {
      invalidate();
      toast.success('Moved to Inbox');
    },
  });

  const replyMut = useMutation({
    mutationFn: ({ id, body, smtp_account_id, body_html }: { id: string; body: string; smtp_account_id?: string; body_html?: string }) => inboxApi.reply(id, body, smtp_account_id, body_html),
    onSuccess: () => { invalidate(); setReplyMode(null); setReplySenderId(''); toast.success('Reply sent'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to send reply'),
  });

  const forwardMut = useMutation({
    mutationFn: ({ id, to, note, smtp_account_id, body_html }: { id: string; to: string; note?: string; smtp_account_id?: string; body_html?: string }) => inboxApi.forward(id, to, note, smtp_account_id, body_html),
    onSuccess: () => { invalidate(); setReplyMode(null); setForwardTo(''); setReplySenderId(''); toast.success('Forwarded'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to forward'),
  });

  const composeMut = useMutation({
    mutationFn: inboxApi.compose,
    onSuccess: () => { invalidate(); setShowCompose(false); toast.success('Message sent'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to send — check your SMTP accounts'),
  });

  const scheduleComposeMut = useMutation({
    mutationFn: inboxApi.scheduleSend,
    onSuccess: (data) => {
      invalidate();
      setShowCompose(false);
      const dt = new Date(data.scheduled_at);
      toast.success(`Email scheduled for ${dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to schedule email'),
  });

  const scheduleReplyMut = useMutation({
    mutationFn: ({ id, body, scheduled_at, smtp_account_id, body_html }: { id: string; body: string; scheduled_at: string; smtp_account_id?: string; body_html?: string }) =>
      inboxApi.scheduleReply(id, body, scheduled_at, smtp_account_id, body_html),
    onSuccess: (data) => {
      invalidate();
      setReplyMode(null);
      setReplySenderId('');
      const dt = new Date(data.scheduled_at);
      toast.success(`Reply scheduled for ${dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to schedule reply'),
  });

  const cancelScheduledMut = useMutation({
    mutationFn: inboxApi.cancelScheduled,
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['inbox', 'scheduled'] });
      toast.success('Scheduled email cancelled');
    },
    onError: () => toast.error('Failed to cancel scheduled email'),
  });

  /* ── Handlers ── */
  const selectMessage = useCallback((msg: Message) => {
    setSelectedId(msg.id);
    setReplyMode(null);
    setReplySenderId(msg.smtp_account_id || smtpAccounts[0]?.id || '');

    // Optimistically mark the whole conversation read in every cached inbox
    // list, using the same key groupConversations threads by — the unread dot
    // clears instantly instead of after two network round-trips.
    const key = threadEmailOf(msg);
    qc.setQueriesData({ queryKey: ['inbox'] }, (old: any) => {
      if (!old || !Array.isArray(old.data)) return old; // lists only — skip counts/detail/thread caches
      return {
        ...old,
        data: old.data.map((m: Message) =>
          m.id === msg.id || (key && threadEmailOf(m) === key) ? { ...m, is_read: true } : m,
        ),
      };
    });

    // Persist server-side, then re-sync lists + badge counts. On failure the
    // optimistic "read" flip above is wrong — re-invalidate so the cache is
    // pulled back in line with the server instead of staying stuck showing
    // read messages that were never actually marked read.
    inboxApi.markThreadRead(msg.id).then(() => invalidate()).catch((err: unknown) => {
      console.error('[Inbox] markThreadRead failed:', err);
      invalidate();
    });
  }, [smtpAccounts, invalidate, qc]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setSelectedId(null);
  }, [searchInput]);

  // Reset forward to field when switching modes; scroll composer into view when opening
  useEffect(() => {
    if (!replyMode) {
      setForwardTo('');
    } else {
      setTimeout(() => replyComposerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
    }
  }, [replyMode]);

  const currentMsg: Message | null = (selectedMsg as Message) || messages.find(m => m.id === selectedId) || null;

  /* ── Group messages into conversation threads for the sidebar ── */
  const conversations: ConversationThread[] = useMemo(() => groupConversations(messages), [messages]);

  // Quick filter presets: combine hard intents into actionable buckets
  const QUICK_FILTERS: { id: string; label: string; match?: string[] }[] = [
    { id: 'all', label: 'All' },
    { id: 'hot', label: 'Hot', match: ['interested', 'meeting'] },
    { id: 'needs_reply', label: 'Needs reply', match: ['interested', 'objection', 'meeting'] },
    { id: 'not_now', label: 'Cold', match: ['not_now', 'unsubscribe'] },
  ];
  const [quickFilter, setQuickFilter] = useState('all');

  // Apply quick filter on top of conversations (client-side)
  const filteredConversations = useMemo(() => {
    if (quickFilter === 'all') return conversations;
    const preset = QUICK_FILTERS.find(f => f.id === quickFilter);
    if (!preset?.match) return conversations;
    return conversations.filter(c => preset.match!.includes(c.latestMessage.sara_intent || ''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, quickFilter]);

  // Final visible list: quick/tag filter + optional unread-only triage toggle
  const visibleConversations = useMemo(
    () => unreadOnly ? filteredConversations.filter(c => c.hasUnread) : filteredConversations,
    [filteredConversations, unreadOnly],
  );

  // Defined here (after conversations) so it can read conversations to pick the next entry
  const handleArchiveToggle = useCallback((msg: Message) => {
    const conv = conversations.find(c => c.latestMessage.id === msg.id);
    const contactEmail = conv?.contactEmail ?? null;
    // Select the next conversation immediately so the panel doesn't go blank.
    // Pick from visibleConversations (the currently filtered/searched view),
    // not the raw list, so we never jump to a conversation outside the
    // active filter (e.g. "Unread only" or a quick filter).
    if (conv) {
      const idx = visibleConversations.findIndex(c => c.latestMessage.id === msg.id);
      const next = idx === -1 ? null : (visibleConversations[idx + 1] ?? visibleConversations[idx - 1] ?? null);
      setSelectedId(next?.latestMessage.id ?? null);
    } else {
      setSelectedId(null);
    }
    if (folder === 'archived' || msg.is_archived) {
      unarchiveMut.mutate({ id: msg.id, contactEmail });
    } else {
      archiveMut.mutate({ id: msg.id, contactEmail });
    }
  }, [folder, archiveMut, unarchiveMut, conversations, visibleConversations]);

  const isInArchived = folder === 'archived';
  const archiveLabel = isInArchived ? 'Move to Inbox' : 'Archive';
  const ArchiveIcon = isInArchived ? ArchiveRestore : Archive;

  const foldersList: { id: Folder; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'inbox', label: 'Inbox', icon: Inbox, count: viewCounts.unread || undefined },
    { id: 'starred', label: 'Starred', icon: Star },
    { id: 'sent', label: 'Sent', icon: SendHorizontal },
    { id: 'scheduled', label: 'Scheduled', icon: Clock },
    { id: 'archived', label: 'Archived', icon: Archive },
  ];

  // Handler to insert AI-generated content into the reply editor
  const handleAiInsert = useCallback((html: string) => {
    // Dispatch a custom event that the RichTextEditor can listen to
    // For now we use a simpler approach - set content via editor ref
    const event = new CustomEvent('ai-reply-insert', { detail: { html } });
    window.dispatchEvent(event);
  }, []);

  // j/k keyboard navigation between conversations (Gmail-style)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'j' && e.key !== 'k') return;
      if (showCompose || replyMode) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      e.preventDefault();
      const idx = conversations.findIndex(c => c.latestMessage.id === selectedId);
      const nextIdx = e.key === 'j'
        ? Math.min(idx + 1, conversations.length - 1)
        : Math.max(idx - 1, 0);
      const next = conversations[nextIdx];
      if (next && next.latestMessage.id !== selectedId) {
        setSelectedId(next.latestMessage.id);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [conversations, selectedId, showCompose, replyMode]);

  // r → reply, e → archive/unarchive current message (Gmail-style shortcuts)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!currentMsg || showCompose || replyMode) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'r') {
        setReplyMode('reply');
        setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || '');
      } else if (e.key === 'e') {
        handleArchiveToggle(currentMsg);
      } else if (e.key === 'Escape') {
        // Close the focus panel and return to the conversation table
        setSelectedId(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [currentMsg, showCompose, replyMode, smtpAccounts, handleArchiveToggle]);

  /* ── Sidebar view selection + active detection ── */
  const selectView = useCallback((v: { folder?: Folder; tag?: string; quick?: string }) => {
    setFolder(v.folder ?? 'inbox');
    setTagFilter(v.tag ?? 'all');
    setQuickFilter(v.quick ?? 'all');
    setUnreadOnly(false);
    setSelectedId(null);
  }, []);

  const isViewActive = useCallback(
    (v: { folder?: Folder; tag?: string; quick?: string }) =>
      folder === (v.folder ?? 'inbox') && tagFilter === (v.tag ?? 'all') && quickFilter === (v.quick ?? 'all'),
    [folder, tagFilter, quickFilter],
  );

  const activeViewLabel = useMemo(() => {
    const all = [...FOLDER_NAV, ...SMART_NAV, ...TAG_NAV];
    const match = all.find(i => isViewActive({ folder: i.folder, tag: i.tag, quick: i.quick }));
    return match?.label || 'Inbox';
  }, [isViewActive]);

  // Load SARA's pre-written draft into the reply composer (reuses the AI insert path)
  const applySaraDraft = useCallback(() => {
    if (!currentMsg?.sara_draft_reply) return;
    setShowCompose(false);
    setReplyMode('reply');
    setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || '');
    setTimeout(() => handleAiInsert(currentMsg.sara_draft_reply || ''), 160);
  }, [currentMsg, smtpAccounts, handleAiInsert]);

  /* ── Thread-level context for the timeline header + contact panel ── */
  const fullThread: Message[] = useMemo(
    () => (thread.length > 0 ? thread : currentMsg ? [currentMsg] : []),
    [thread, currentMsg],
  );
  const threadSubject = fullThread[0]?.subject ?? currentMsg?.subject ?? null;
  const threadStats = useMemo(() => {
    const msgs = fullThread;
    const inbound = msgs.filter(m => m.direction !== 'outbound').length;
    // Avg gap between direction changes ≈ how fast this conversation turns around
    let total = 0, n = 0;
    for (let i = 1; i < msgs.length; i++) {
      if ((msgs[i].direction === 'outbound') !== (msgs[i - 1].direction === 'outbound')) {
        const delta = new Date(msgs[i].received_at).getTime() - new Date(msgs[i - 1].received_at).getTime();
        if (delta > 0) { total += delta; n++; }
      }
    }
    return {
      total: msgs.length,
      inbound,
      outbound: msgs.length - inbound,
      first: msgs[0]?.received_at ?? null,
      last: msgs[msgs.length - 1]?.received_at ?? null,
      avgReply: n ? total / n : null,
    };
  }, [fullThread]);

  const threadContactEmail = currentMsg
    ? (currentMsg.direction === 'outbound' ? (currentMsg.contact_email || currentMsg.to_email) : (currentMsg.contact_email || currentMsg.from_email))
    : null;
  const threadContactName = currentMsg
    ? (currentMsg.contact_name || (threadContactEmail ? threadContactEmail.split('@')[0] : 'Contact'))
    : null;

  const copyContactEmail = useCallback(() => {
    if (!threadContactEmail) return;
    navigator.clipboard.writeText(threadContactEmail)
      .then(() => toast.success('Email copied'))
      .catch(() => toast.error('Failed to copy email'));
  }, [threadContactEmail]);

  /* ── View model: one tab strip drives folder + smart-view state ── */
  type ViewId = 'inbox' | 'unread' | 'needs' | 'hot' | 'starred' | 'sent' | 'scheduled' | 'archived';
  const activeView: ViewId =
    folder === 'inbox'
      ? (unreadOnly ? 'unread' : quickFilter === 'needs_reply' ? 'needs' : quickFilter === 'hot' ? 'hot' : 'inbox')
      : folder;
  const setView = (v: ViewId) => {
    setSelectedId(null);
    setTagFilter('all');
    if (v === 'inbox' || v === 'unread' || v === 'needs' || v === 'hot') {
      setFolder('inbox');
      setUnreadOnly(v === 'unread');
      setQuickFilter(v === 'needs' ? 'needs_reply' : v === 'hot' ? 'hot' : 'all');
    } else {
      setFolder(v);
      setUnreadOnly(false);
      setQuickFilter('all');
    }
  };

  return (
    <div className="overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>
      <div className="h-full flex flex-col bg-[var(--bg-app)]">

        {currentMsg && folder !== 'scheduled' ? (
          <>
            {/* ── Focus toolbar: back + position + actions ── */}
            <div className="flex items-center gap-2 px-3 h-[50px] border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex-shrink-0">
              <button
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-1.5 h-8 px-2.5 rounded-[8px] text-[12.5px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> {foldersList.find(f => f.id === folder)?.label || 'Inbox'}
              </button>
              <span className="h-4 w-px bg-[var(--border-subtle)]" />
              <span className="text-[12px] text-[var(--text-tertiary)] tabular">
                {Math.max(1, visibleConversations.findIndex(c => c.latestMessage.id === selectedId) + 1)} of {visibleConversations.length}
              </span>
              <span className="hidden lg:flex items-center gap-1.5 ml-2 text-[11px] text-[var(--text-muted)]">
                <kbd className="kbd">J</kbd><kbd className="kbd">K</kbd> move
                <kbd className="kbd ml-1">Esc</kbd> close
              </span>
              <div className="flex-1" />
              <button
                onClick={() => { setShowCompose(false); setReplyMode('reply'); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }}
                className="flex items-center gap-1.5 h-8 px-3 rounded-[8px] bg-[var(--indigo-subtle)] text-[var(--indigo)] text-[12.5px] font-semibold hover:bg-[rgba(91,91,245,0.14)] transition-colors"
              >
                <Reply className="h-3.5 w-3.5" /> Reply
              </button>
              <button onClick={() => { setShowCompose(false); setReplyMode('forward'); setForwardTo(''); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }} title="Forward" className="icon-btn h-8 w-8">
                <Forward className="h-4 w-4" />
              </button>
              <button onClick={() => toggleStarMut.mutate(currentMsg.id)} title={currentMsg.is_starred ? 'Unstar' : 'Star'} className="icon-btn h-8 w-8">
                <Star className={`h-4 w-4 ${currentMsg.is_starred ? 'text-amber-400 fill-amber-400' : ''}`} />
              </button>
              <button onClick={() => handleArchiveToggle(currentMsg)} title={archiveLabel} className="icon-btn h-8 w-8">
                <ArchiveIcon className="h-4 w-4" />
              </button>
              <button
                onClick={() => currentMsg.is_read ? markUnreadMut.mutate(currentMsg.id) : markReadMut.mutate(currentMsg.id)}
                title={currentMsg.is_read ? 'Mark unread' : 'Mark read'}
                className="icon-btn h-8 w-8"
              >
                {currentMsg.is_read ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <span className="h-4 w-px bg-[var(--border-subtle)] hidden xl:block" />
              <button
                onClick={() => setShowContext(v => !v)}
                title={showContext ? 'Hide contact details' : 'Show contact details'}
                className={cn('icon-btn h-8 w-8 hidden xl:inline-flex', showContext && 'bg-[var(--indigo-subtle)] text-[var(--indigo)]')}
              >
                {showContext ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
              </button>
            </div>

            {/* ── Reading room: hero header + thread canvas + composer + context rail ── */}
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex-1 overflow-y-auto bg-[var(--bg-app)]">
                  <div className="max-w-[860px] mx-auto px-8 pt-8 pb-6">
                    {/* Conversation hero — who, what, and the intent tag */}
                    <div className="flex items-start gap-4">
                      <span className="hidden sm:inline-flex rounded-full ring-4 ring-[var(--bg-surface)] shadow-[var(--shadow-sm)] flex-shrink-0">
                        <Avatar name={threadContactName || undefined} email={threadContactEmail || undefined} size="lg" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-baseline gap-2 min-w-0">
                              <h2 className="text-[15px] font-semibold text-[var(--text-primary)] truncate">{threadContactName || 'Unknown sender'}</h2>
                              {threadContactEmail && <span className="text-[12px] text-[var(--text-tertiary)] truncate hidden md:inline">{threadContactEmail}</span>}
                            </div>
                            <h1 className="mt-1 text-[22px] font-semibold text-[var(--text-primary)] leading-snug tracking-[-0.02em]">
                              {threadSubject || '(no subject)'}
                            </h1>
                            <div className="mt-1.5 flex items-center gap-2 text-[12px] text-[var(--text-tertiary)] flex-wrap">
                              <span className="tabular">{threadStats.total} message{threadStats.total === 1 ? '' : 's'}</span>
                              {threadStats.first && threadStats.total > 1 && (
                                <>
                                  <span className="sep-dot" />
                                  <span>Started {new Date(threadStats.first).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                </>
                              )}
                              {currentMsg.campaign_name && (
                                <>
                                  <span className="sep-dot" />
                                  <span className="truncate max-w-[220px]">{currentMsg.campaign_name}</span>
                                </>
                              )}
                            </div>
                          </div>
                      {/* Clickable tag dropdown */}
                      <div className="relative flex-shrink-0 mt-0.5">
                        <button
                          onClick={() => setShowTagDropdown(!showTagDropdown)}
                          className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                            currentMsg.sara_intent
                              ? `${(INTENT_COLORS[currentMsg.sara_intent] || INTENT_COLORS.other).bg} ${(INTENT_COLORS[currentMsg.sara_intent] || INTENT_COLORS.other).text}`
                              : 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]'
                          }`}
                        >
                          <Tag className="h-3 w-3" />
                          {currentMsg.sara_intent
                            ? (INTENT_COLORS[currentMsg.sara_intent] || INTENT_COLORS.other).label
                            : 'Add Tag'}
                          <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                        </button>
                        {showTagDropdown && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowTagDropdown(false)} />
                            <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-lg overflow-hidden">
                              {currentMsg.sara_intent && (
                                <button
                                  onClick={() => { setTagMut.mutate({ id: currentMsg.id, tag: '' }); setShowTagDropdown(false); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border-subtle)]"
                                >
                                  <X className="h-3 w-3" />
                                  Remove Tag
                                </button>
                              )}
                              {TAG_OPTIONS.filter(t => t.value !== 'all').map(opt => {
                                const info = INTENT_COLORS[opt.value] || INTENT_COLORS.other;
                                const isActive = currentMsg.sara_intent === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    onClick={() => {
                                      setTagMut.mutate({ id: currentMsg.id, tag: opt.value });
                                      if (opt.value === 'meeting' && currentMsg.sara_intent !== 'meeting') {
                                        bookMeetingMut.mutate({
                                          title: `Meeting — ${threadContactName || currentMsg.contact_name || currentMsg.from_email}`,
                                          contact_name: threadContactName || currentMsg.contact_name || null,
                                          contact_email: threadContactEmail || currentMsg.from_email || null,
                                        });
                                      }
                                      setShowTagDropdown(false);
                                    }}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                                      isActive ? 'bg-[var(--bg-elevated)]' : 'hover:bg-[var(--bg-hover)]'
                                    } ${info.text}`}
                                  >
                                    <span className={`w-2 h-2 rounded-full ${info.bg} ring-1 ring-current`} />
                                    {opt.label}
                                    {isActive && <Check className="h-3 w-3 ml-auto" />}
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                        </div>
                      </div>
                    </div>

                    <div className="my-6 h-px bg-[var(--border-subtle)]" />

                    {/* SARA co-pilot — surfaces AI triage + one-tap draft */}
                    <SaraCopilot msg={currentMsg} onUseDraft={applySaraDraft} />

                    {/* Conversation timeline — day-grouped, direction-coded */}
                    <ThreadTimeline
                      thread={fullThread}
                      threadSubject={threadSubject}
                      selectedId={selectedId}
                    />
                  </div>
                </div>

                {/* ── Composer dock — sits inside the thread's message column so it flows with the emails above ── */}
                <div className="flex-shrink-0 bg-[var(--bg-app)] pt-1 pb-5">
                  <div className="max-w-[860px] mx-auto px-8">
                  <div className="pl-12">
                  {replyMode ? (
                    <div
                      ref={replyComposerRef}
                      className="w-full flex flex-col max-h-[64vh] rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] overflow-hidden"
                    >
                      {/* Routing line — recipient identity, with close. No labels, no boxes. */}
                      <div className="flex items-center gap-2.5 px-4 h-[50px] border-b border-[var(--border-subtle)] flex-shrink-0">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--indigo-subtle)] flex-shrink-0">
                          {replyMode === 'reply' ? <Reply className="h-3.5 w-3.5 text-[var(--indigo)]" /> : <Forward className="h-3.5 w-3.5 text-[var(--indigo)]" />}
                        </span>
                        <span className="text-[11px] font-medium text-[var(--text-tertiary)] flex-shrink-0">To</span>
                        {replyMode === 'reply' ? (
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Avatar name={threadContactName || undefined} email={currentMsg.from_email} size="sm" />
                            <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{threadContactName || currentMsg.from_email}</span>
                            {threadContactName && <span className="text-[12px] text-[var(--text-tertiary)] truncate hidden sm:inline">{currentMsg.from_email}</span>}
                          </div>
                        ) : (
                          <input
                            value={forwardTo}
                            onChange={e => setForwardTo(e.target.value)}
                            className="flex-1 min-w-0 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                            placeholder="recipient@example.com"
                            autoFocus
                          />
                        )}
                        <button onClick={() => setReplyMode(null)} title="Close composer" className="icon-btn h-7 w-7 flex-shrink-0"><X className="h-3.5 w-3.5" /></button>
                      </div>

                      {/* Meta strip — subject on the left, sending-inbox routing on the right */}
                      <div className="flex items-center gap-2 px-4 h-9 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex-shrink-0">
                        <span className="text-[12px] text-[var(--text-tertiary)] truncate min-w-0">
                          {(replyMode === 'reply' ? 'Re: ' : 'Fwd: ') + ((threadSubject || '').replace(/^((re|fwd?|fw)\s*:\s*)+/i, '') || '(no subject)')}
                        </span>
                        <span className="flex-1" />
                        <span className="text-[11px] text-[var(--text-tertiary)] flex-shrink-0 hidden sm:inline">via</span>
                        <div className="min-w-0 max-w-[190px] flex-shrink-0">
                          <SenderSelect accounts={smtpAccounts} value={replySenderId} onChange={setReplySenderId} />
                        </div>
                        {(() => {
                          const acct = smtpAccounts.find(a => a.id === replySenderId) || smtpAccounts[0];
                          if (!acct) return null;
                          return acct.is_verified ? (
                            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400 flex-shrink-0" title="This inbox is verified for sending.">
                              <BadgeCheck className="h-3.5 w-3.5" /><span className="hidden md:inline">Verified</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-600 dark:text-amber-400 flex-shrink-0" title="This inbox isn't verified for sending — deliverability may suffer.">
                              Unverified
                            </span>
                          );
                        })()}
                      </div>

                      {/* Writing surface — a seamless canvas; the editor melts into the card */}
                      <div className="flex-1 min-h-0 overflow-y-auto">
                        <RichTextEditor
                          key={replyMode}
                          bare
                          placeholder={replyMode === 'reply' ? 'Write your reply…' : 'Add a note (optional)…'}
                          onChange={replyEditor.handleChange}
                          templates={templates}
                          minHeight="180px"
                          autoFocus={replyMode === 'reply'}
                        />
                        {replyMode === 'forward' && (
                          <div className="mx-4 mb-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 overflow-hidden">
                            <div className="px-3.5 py-2.5">
                              <p className="text-[10px] font-semibold text-[var(--text-muted)] mb-1.5">Forwarded message</p>
                              <div className="text-[11px] text-[var(--text-tertiary)] space-y-0.5">
                                <p><span className="font-medium text-[var(--text-secondary)]">From:</span> {currentMsg.from_email}</p>
                                <p><span className="font-medium text-[var(--text-secondary)]">Date:</span> {formatFullDate(currentMsg.received_at)}</p>
                                <p><span className="font-medium text-[var(--text-secondary)]">Subject:</span> {currentMsg.subject || '(no subject)'}</p>
                                <p><span className="font-medium text-[var(--text-secondary)]">To:</span> {currentMsg.to_email}</p>
                              </div>
                            </div>
                            <div className="max-h-[140px] overflow-y-auto border-t border-[var(--border-subtle)]">
                              <EmailBody html={currentMsg.body_html} text={currentMsg.body_text} />
                            </div>
                          </div>
                        )}
                        {replySig.on && (
                          <SignaturePreview html={replySig.sigHtml!} onRemove={() => replySig.setOn(false)} />
                        )}
                      </div>

                      {/* AI Assist Bar */}
                      {replyMode === 'reply' && (
                        <AiAssistBar
                          messageId={currentMsg.id}
                          onInsert={handleAiInsert}
                        />
                      )}

                      {/* Action bar — Discard left, Schedule + Send anchored right */}
                      <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 flex-shrink-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <button onClick={() => setReplyMode(null)} className="h-9 px-3 rounded-lg text-[13px] font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">Discard</button>
                          <SignatureButton available={replySig.available} on={replySig.on} onToggle={replySig.toggle} />
                        </div>
                        <div className="flex items-center gap-2">
                          {replyMode === 'reply' && (
                            <div className="relative">
                              <button
                                onClick={() => setShowReplySchedule(!showReplySchedule)}
                                disabled={replyEditor.isEmpty || replyMut.isPending}
                                className={`flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium transition-all disabled:opacity-40 ${
                                  showReplySchedule
                                    ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)] border border-[rgba(91,91,245,0.25)]'
                                    : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                                }`}
                                title="Schedule send"
                              >
                                <CalendarClock className="h-3.5 w-3.5" />
                                <span>Schedule</span>
                                <ChevronDown className={`h-3 w-3 transition-transform ${showReplySchedule ? 'rotate-180' : ''}`} />
                              </button>
                              {showReplySchedule && (
                                <ScheduleSendPicker
                                  onSchedule={(scheduledAt) => {
                                    const sid = replySenderId || undefined;
                                    const b = withSignature(replyEditor.html, replyEditor.text, replySig.sigHtml, replySig.on);
                                    scheduleReplyMut.mutate({ id: currentMsg.id, body: b.body, body_html: b.body_html, smtp_account_id: sid, scheduled_at: scheduledAt });
                                    setShowReplySchedule(false);
                                  }}
                                  onClose={() => setShowReplySchedule(false)}
                                />
                              )}
                            </div>
                          )}
                          <button
                            onClick={() => {
                              const sid = replySenderId || undefined;
                              if (replyMode === 'reply' && !replyEditor.isEmpty) {
                                const b = withSignature(replyEditor.html, replyEditor.text, replySig.sigHtml, replySig.on);
                                replyMut.mutate({ id: currentMsg.id, body: b.body, body_html: b.body_html, smtp_account_id: sid });
                              } else if (replyMode === 'forward' && forwardTo.trim()) {
                                const b = withSignature(replyEditor.html || '', replyEditor.text || '', replySig.sigHtml, replySig.on);
                                forwardMut.mutate({ id: currentMsg.id, to: forwardTo, note: b.body || undefined, body_html: b.body_html || undefined, smtp_account_id: sid });
                              }
                            }}
                            disabled={
                              (replyMode === 'reply' ? replyEditor.isEmpty || replyMut.isPending : !forwardTo.trim() || forwardMut.isPending)
                            }
                            className="flex items-center gap-2 h-9 px-4 rounded-lg bg-[var(--indigo)] text-white text-[13px] font-semibold hover:bg-[var(--indigo-hover)] transition-colors disabled:opacity-40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(67,56,202,0.35)]"
                          >
                            <Send className="h-3.5 w-3.5" />
                            {replyMut.isPending || forwardMut.isPending ? 'Sending…' : replyMode === 'reply' ? 'Send reply' : 'Forward'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Idle state: a one-click reply bar keeps the composer a thought away */
                    <div className="w-full flex items-center gap-2.5 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] px-3 py-2.5">
                      <Avatar name={threadContactName || undefined} email={threadContactEmail || undefined} size="md" />
                      <button
                        onClick={() => { setShowCompose(false); setReplyMode('reply'); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }}
                        className="flex-1 h-10 px-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 text-left text-[13px] text-[var(--text-tertiary)] hover:border-[rgba(91,91,245,0.45)] hover:bg-[var(--bg-surface)] transition-colors"
                      >
                        Reply to {threadContactName || 'this conversation'}…
                      </button>
                      <button
                        onClick={() => { setShowCompose(false); setReplyMode('forward'); setForwardTo(''); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }}
                        title="Forward"
                        className="icon-btn h-9 w-9 flex-shrink-0"
                      >
                        <Forward className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  </div>
                  </div>
                </div>
              </div>

              {/* Contact context rail */}
              {showContext && (
                <ContactContextPanel msg={currentMsg} stats={threadStats} onCopyEmail={copyContactEmail} />
              )}
            </div>
          </>
        ) : (
          <>
        {/* ── Command bar: view tabs + intent filter + search + actions ── */}
        <div className="flex items-center gap-1 px-4 h-[50px] border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex-shrink-0 overflow-x-auto scrollbar-none">
          {([
            { id: 'inbox' as const, label: 'Inbox', count: viewCounts.unread },
            { id: 'needs' as const, label: 'Needs reply', count: viewCounts.needs_reply },
            { id: 'hot' as const, label: 'Hot leads', count: viewCounts.hot },
            { id: 'unread' as const, label: 'Unread', count: undefined },
            { id: 'scheduled' as const, label: 'Scheduled', count: undefined },
            { id: 'starred' as const, label: 'Starred', count: undefined },
            { id: 'sent' as const, label: 'Sent', count: undefined },
            { id: 'archived' as const, label: 'Archived', count: undefined },
          ]).map(tabItem => {
            const isActive = activeView === tabItem.id;
            return (
              <button
                key={tabItem.id}
                onClick={() => setView(tabItem.id)}
                className={cn(
                  'relative flex items-center gap-1.5 h-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors flex-shrink-0',
                  isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                )}
              >
                {tabItem.label}
                {tabItem.count != null && tabItem.count > 0 && (
                  <span className={cn(
                    'flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] px-1 text-[10.5px] font-semibold tabular',
                    isActive ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
                  )}>{tabItem.count}</span>
                )}
                <span className={cn('absolute left-2 right-2 bottom-0 h-[2px] rounded-t-full transition-opacity', isActive ? 'bg-[var(--indigo)] opacity-100' : 'opacity-0')} />
              </button>
            );
          })}

          <div className="flex-1 min-w-[16px]" />

          <select
            value={tagFilter}
            onChange={e => { setTagFilter(e.target.value); setQuickFilter('all'); setSelectedId(null); }}
            className={cn(
              'h-8 px-2 rounded-lg border text-[12px] font-medium outline-none cursor-pointer transition-colors flex-shrink-0',
              tagFilter !== 'all'
                ? 'border-[rgba(91,91,245,0.4)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
            )}
          >
            {TAG_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.value === 'all' ? 'All intents' : t.label}</option>)}
          </select>

          <form onSubmit={handleSearch} className="flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search…"
                className="w-[180px] focus:w-[240px] pl-8 pr-7 h-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#5B5BF5]/15 transition-all"
              />
              {search && (
                <button type="button" onClick={() => { setSearch(''); setSearchInput(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--bg-hover)]">
                  <X className="h-3 w-3 text-[var(--text-tertiary)]" />
                </button>
              )}
            </div>
          </form>

          <button onClick={handleRefresh} disabled={isRefreshing || isFetching} title="Sync inboxes" className="icon-btn flex-shrink-0 disabled:opacity-40">
            <RefreshCw className={cn('h-3.5 w-3.5', (isRefreshing || isFetching) && 'animate-spin')} />
          </button>
          <button onClick={() => markAllReadMut.mutate()} disabled={markAllReadMut.isPending} title="Mark all read" className="icon-btn flex-shrink-0">
            <CheckCheck className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setReplyMode(null); setShowCompose(true); }}
            className="ml-1 flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[var(--indigo)] text-white text-[12px] font-semibold hover:bg-[var(--indigo-hover)] transition-colors flex-shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(91,91,245,0.35)]"
          >
            <Pencil className="h-3.5 w-3.5" /> Compose
          </button>
        </div>

        {/* Connection error banner — only when sync hit errors */}
        {syncErrors.length > 0 && (
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-start gap-2 flex-shrink-0">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mb-0.5">Mail server issue — showing cached emails</p>
              <p className="text-[10px] text-amber-700 dark:text-amber-400/80 truncate" title={syncErrors.join(' · ')}>
                {syncErrors[0]}{syncErrors.length > 1 ? ` (+${syncErrors.length - 1} more)` : ''}
              </p>
            </div>
            <button onClick={() => setSyncErrors([])} className="p-0.5 hover:bg-amber-500/10 rounded flex-shrink-0" title="Dismiss">
              <X className="h-3 w-3 text-amber-600 dark:text-amber-400" />
            </button>
          </div>
        )}

        {/* ── Full-width conversation table ── */}
        {folder === 'scheduled' ? (
          <div className="flex-1 min-h-0 flex bg-[var(--bg-surface)]">
            <ScheduledEmailsPanel onCancel={(id) => cancelScheduledMut.mutate(id)} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[var(--bg-surface)]">
            {/* Sticky column header — the grid identity */}
            <div className="sticky top-0 z-[2] flex items-center gap-3 px-4 h-[30px] bg-[var(--bg-muted)] border-b border-[var(--border-subtle)] text-[11px] font-medium text-[var(--text-tertiary)]">
              <span className="w-[220px] flex-shrink-0">Sender</span>
              <span className="flex-1 min-w-0">Conversation</span>
              <span className="w-[110px] flex-shrink-0 hidden md:block">Intent</span>
              <span className="w-[140px] flex-shrink-0 hidden lg:block">Campaign</span>
              <span className="w-[150px] flex-shrink-0 hidden xl:block">Inbox</span>
              <span className="w-[54px] flex-shrink-0 text-right">Time</span>
            </div>

            {isLoading ? (
              <div>
                {Array.from({ length: 14 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 h-[40px] border-b border-[var(--border-subtle)]">
                    <div className="flex items-center gap-2.5 w-[220px] flex-shrink-0">
                      <Skeleton className="h-6 w-6 rounded-full flex-shrink-0" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                    <Skeleton className="h-3 flex-1" />
                    <Skeleton className="h-4 w-[90px] rounded-md hidden md:block" />
                    <Skeleton className="h-3 w-[54px]" />
                  </div>
                ))}
              </div>
            ) : visibleConversations.length === 0 ? (
              <EmptyState
                icon={MailOpen}
                title={unreadOnly ? 'No unread conversations' : quickFilter !== 'all' ? `No ${QUICK_FILTERS.find(f => f.id === quickFilter)?.label.toLowerCase()} messages` : 'No conversations'}
                description={search ? 'Try a different search term.' : unreadOnly ? "You're all caught up." : tagFilter !== 'all' ? `No messages tagged as "${TAG_OPTIONS.find(t => t.value === tagFilter)?.label}".` : quickFilter !== 'all' ? 'Try a different view.' : `Your ${folder} is empty — replies will land here.`}
              />
            ) : (
              visibleConversations.map(conv => {
                const msg = conv.latestMessage;
                const isSelected = msg.id === selectedId;
                const isOutbound = msg.direction === 'outbound';
                const intent = msg.sara_intent && msg.sara_intent !== 'scheduled' ? (INTENT_COLORS[msg.sara_intent] || INTENT_COLORS.other) : null;
                const displayName = isOutbound ? `To: ${msg.to_email?.split('@')[0]}` : (conv.contactName || senderName(msg));
                const avatarSeed = isOutbound ? (msg.to_email || '') : (conv.contactName || msg.from_email || '');
                const snippet = msgSnippet(msg);
                return (
                  <button
                    key={conv.contactEmail}
                    onClick={() => selectMessage(msg)}
                    className={cn(
                      'group w-full min-w-0 overflow-hidden text-left flex items-center gap-3 px-4 h-[40px] border-b border-[var(--border-subtle)] transition-colors',
                      isSelected ? 'bg-[var(--indigo-subtle)]' : 'hover:bg-[var(--bg-hover)]'
                    )}
                  >
                    {/* Sender */}
                    <span className="flex items-center gap-2.5 w-[220px] flex-shrink-0 min-w-0">
                      <span className="relative flex-shrink-0">
                        {isOutbound ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--text-tertiary)] border border-[var(--border-subtle)]">
                            <SendHorizontal className="h-2.5 w-2.5" />
                          </span>
                        ) : (
                          <Avatar name={avatarSeed} email={msg.from_email} size="sm" />
                        )}
                        {conv.hasUnread && !isOutbound && (
                          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--indigo)] ring-2 ring-[var(--bg-surface)]" />
                        )}
                      </span>
                      <span className={cn('text-[13px] truncate', conv.hasUnread ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]')}>
                        {displayName}
                      </span>
                      {conv.messageCount > 1 && (
                        <span className="text-[9.5px] font-semibold px-1 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-tertiary)] flex-shrink-0 tabular">{conv.messageCount}</span>
                      )}
                      {conv.isStarred && <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
                    </span>

                    {/* Conversation: subject + snippet on one scannable line */}
                    <span className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                      <span className={cn('min-w-0 flex-shrink truncate text-[12.5px]', conv.hasUnread ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]')}>
                        {msg.subject || '(no subject)'}
                      </span>
                      {snippet && (
                        <span className="flex-1 min-w-0 truncate text-[12px] text-[var(--text-tertiary)] hidden sm:inline">— {snippet}</span>
                      )}
                    </span>

                    {/* Intent */}
                    <span className="w-[110px] flex-shrink-0 hidden md:block">
                      {intent && (
                        <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md', intent.bg, intent.text)}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                          {intent.label}
                        </span>
                      )}
                    </span>

                    {/* Campaign */}
                    <span className="w-[140px] flex-shrink-0 hidden lg:block text-[11.5px] text-[var(--text-tertiary)] truncate">
                      {msg.campaign_name || ''}
                    </span>

                    {/* Receiving inbox */}
                    <span className="w-[150px] flex-shrink-0 hidden xl:block text-[11.5px] text-[var(--text-tertiary)] truncate">
                      {msg.smtp_label || msg.smtp_email || ''}
                    </span>

                    {/* Time */}
                    <span className="w-[54px] flex-shrink-0 text-right text-[11px] text-[var(--text-tertiary)] tabular">
                      {timeAgo(msg.received_at)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
          </>
        )}
      </div>

      {showCompose && (
        <ComposeModal
          onClose={() => setShowCompose(false)}
          onSend={data => composeMut.mutate(data)}
          onSchedule={data => scheduleComposeMut.mutate(data)}
          sending={composeMut.isPending || scheduleComposeMut.isPending}
          smtpAccounts={smtpAccounts}
          templates={templates}
        />
      )}
    </div>
  );
}

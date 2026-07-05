import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inboxApi } from '../../api/inbox.api';
import { smtpApi } from '../../api/smtp.api';
import { templateApi } from '../../api/template.api';
import { Spinner } from '../../components/ui/Spinner';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/shared/EmptyState';
import { Avatar } from '../../components/shared/Avatar';
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
  Trash2,
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

/* ─── Email HTML Renderer (sandboxed iframe) ──────── */
function EmailBody({ html, text }: { html: string | null; text: string | null }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const srcDoc = useMemo(() => {
    let bodyContent: string;
    if (html) {
      bodyContent = html;
    } else {
      const escaped = (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      bodyContent = `<div style="white-space:pre-wrap;">${escaped}</div>`;
    }

    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
body {
  margin: 0;
  padding: 20px 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14.5px;
  line-height: 1.7;
  color: #1F2328;
  word-wrap: break-word;
  overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
  max-width: 680px;
}
img { max-width: 100%; height: auto; display: block; border-radius: 6px; }
a { color: #4F46E5; text-decoration: none; }
a:hover { text-decoration: underline; }
blockquote { margin: 10px 0; padding-left: 14px; border-left: 3px solid #E4E4EA; color: #6B7280; }
pre { white-space: pre-wrap; font-size: 13px; background: #F6F7F9; padding: 12px 14px; border-radius: 8px; }
table { border-collapse: collapse; max-width: 100%; }
hr { border: none; border-top: 1px solid #ECECEF; margin: 18px 0; }
p { margin: 0 0 13px; }
h1, h2, h3, h4 { margin: 0 0 10px; line-height: 1.35; }
</style></head><body>${bodyContent}</body></html>`;
  }, [html, text]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const resize = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          const h = doc.body.scrollHeight;
          if (h > 0) setHeight(h + 32);
        }
      } catch { /* cross-origin safety */ }
    };

    iframe.addEventListener('load', resize);
    const timer = setTimeout(resize, 500);

    return () => {
      iframe.removeEventListener('load', resize);
      clearTimeout(timer);
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      className="w-full border-0"
      style={{ height: `${height}px`, minHeight: '80px' }}
      title="Email content"
    />
  );
}

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

  const canSend = to && subject && !editor.isEmpty && !sending && smtpAccounts.length > 0;

  const handleSchedule = (scheduledAt: string) => {
    if (to && subject && !editor.isEmpty) {
      onSchedule({ to, subject, body: editor.text, body_html: editor.html, smtp_account_id: senderId || undefined, scheduled_at: scheduledAt });
      setShowSchedule(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 flex ${expanded ? 'items-center justify-center' : 'items-end justify-end'} p-4`}>
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div
        className={`relative bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] shadow-2xl flex flex-col transition-all duration-200 ${
          expanded ? 'w-[800px] max-h-[80vh]' : 'w-[620px] max-h-[85vh]'
        }`}
        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] rounded-t-xl">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">New Message</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              title={expanded ? 'Minimize' : 'Expand'}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="border-b border-[var(--border-subtle)]">
          <div className="flex items-center px-4 py-2 border-b border-[var(--border-subtle)]">
            <span className="text-xs font-medium text-[var(--text-tertiary)] w-12">From</span>
            <SenderSelect accounts={smtpAccounts} value={senderId} onChange={setSenderId} />
          </div>
          <div className="flex items-center px-4 py-2 border-b border-[var(--border-subtle)]">
            <span className="text-xs font-medium text-[var(--text-tertiary)] w-12">To</span>
            <input value={to} onChange={e => setTo(e.target.value)} className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none" placeholder="recipient@example.com" />
          </div>
          <div className="flex items-center px-4 py-2">
            <span className="text-xs font-medium text-[var(--text-tertiary)] w-12">Subject</span>
            <input value={subject} onChange={e => setSubject(e.target.value)} className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none" placeholder="Subject" />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <RichTextEditor
            placeholder="Write your message..."
            onChange={editor.handleChange}
            onTemplateSelect={(t) => { if (t.subject) setSubject(t.subject); }}
            templates={templates}
            minHeight={expanded ? '300px' : '200px'}
            autoFocus
          />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (canSend) {
                  onSend({ to, subject, body: editor.text, body_html: editor.html, smtp_account_id: senderId || undefined });
                }
              }}
              disabled={!canSend}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[var(--indigo)] text-white text-sm font-semibold hover:bg-[var(--indigo-hover)] transition-colors disabled:opacity-40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(67,56,202,0.35)]"
            >
              <Send className="h-3.5 w-3.5" />
              {sending ? 'Sending...' : 'Send'}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowSchedule(!showSchedule)}
                disabled={!canSend}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-40 ${
                  showSchedule
                    ? 'bg-[#6366F1]/10 text-[var(--indigo)] border border-[#6366F1]/20'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]'
                }`}
                title="Schedule send"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                <span className="text-[13px]">Schedule</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${showSchedule ? 'rotate-180' : ''}`} />
              </button>
              {showSchedule && <ScheduleSendPicker onSchedule={handleSchedule} onClose={() => setShowSchedule(false)} />}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
            <Trash2 className="h-4 w-4" />
          </button>
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

  return (
    <aside className="hidden xl:flex w-[260px] flex-shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] flex-col overflow-y-auto">
      {/* Identity */}
      <div className="flex flex-col items-center text-center px-4 pt-5 pb-4 border-b border-[var(--border-subtle)]">
        <Avatar name={name} email={email} size="lg" />
        <p className="mt-3 text-[14.5px] font-semibold text-[var(--text-primary)] leading-tight">{name}</p>
        {email && <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)] truncate max-w-full">{email}</p>}
        {company && (
          <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
            <Building2 className="h-3 w-3 text-[var(--text-tertiary)]" />
            {company}
          </span>
        )}
        <button
          onClick={onCopyEmail}
          className="mt-3 flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--border-default)] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Copy className="h-3 w-3" /> Copy email
        </button>
      </div>

      {/* Engagement */}
      <div className="px-4 py-4 border-b border-[var(--border-subtle)]">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2.5">Engagement</p>
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

      {/* Details */}
      <div className="px-4 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Details</p>
        <DetailRow label="Intent">
          {intent ? (
            <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md', intent.bg, intent.text)}>{intent.label}</span>
          ) : <span className="text-[var(--text-tertiary)] font-normal">Untagged</span>}
        </DetailRow>
        {msg.campaign_name && <DetailRow label="Campaign">{msg.campaign_name}</DetailRow>}
        {(msg.smtp_label || msg.smtp_email) && (
          <DetailRow label="Inbox">{msg.smtp_label || msg.smtp_email}</DetailRow>
        )}
        {stats.first && (
          <DetailRow label="First contact">{new Date(stats.first).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</DetailRow>
        )}
        {stats.last && (
          <DetailRow label="Last activity">{timeAgo(stats.last)} ago</DetailRow>
        )}
        <DetailRow label="Messages"><span className="tabular">{stats.total}</span></DetailRow>
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

/* ─── Conversation grouping (shared by list + sidebar counts) ─── */
function groupConversations(messages: Message[]): ConversationThread[] {
  if (messages.length === 0) return [];
  const threadMap = new Map<string, Message[]>();

  for (const msg of messages) {
    if (msg.sara_status === 'scheduled') continue;
    const contactEmail = msg.direction === 'outbound'
      ? (msg.contact_email || msg.to_email)
      : (msg.contact_email || msg.from_email);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
            data: old.data.filter((m: Message) => {
              const msgEmail = m.direction === 'outbound'
                ? (m.contact_email || m.to_email)
                : (m.contact_email || m.from_email);
              return msgEmail !== contactEmail;
            }),
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
            data: old.data.filter((m: Message) => {
              const msgEmail = m.direction === 'outbound'
                ? (m.contact_email || m.to_email)
                : (m.contact_email || m.from_email);
              return msgEmail !== contactEmail;
            }),
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
    // Mark the whole thread as read (not just this message)
    inboxApi.markThreadRead(msg.id).then(() => invalidate()).catch((err: unknown) => console.error('[Inbox] markThreadRead failed:', err));
  }, [smtpAccounts, invalidate]);

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

  // Defined here (after conversations) so it can read conversations to pick the next entry
  const handleArchiveToggle = useCallback((msg: Message) => {
    const conv = conversations.find(c => c.latestMessage.id === msg.id);
    const contactEmail = conv?.contactEmail ?? null;
    // Select the next conversation immediately so the panel doesn't go blank
    if (conv) {
      const idx = conversations.indexOf(conv);
      const next = conversations[idx + 1] ?? conversations[idx - 1] ?? null;
      setSelectedId(next?.latestMessage.id ?? null);
    } else {
      setSelectedId(null);
    }
    if (folder === 'archived' || msg.is_archived) {
      unarchiveMut.mutate({ id: msg.id, contactEmail });
    } else {
      archiveMut.mutate({ id: msg.id, contactEmail });
    }
  }, [folder, archiveMut, unarchiveMut, conversations]);

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
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [currentMsg, showCompose, replyMode, smtpAccounts, handleArchiveToggle]);

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

  return (
    <div className="-mx-8 -my-6" style={{ height: 'calc(100vh - 56px)' }}>
      <div className="h-full flex bg-[var(--bg-app)]">

        {/* ── Mail nav rail — folders, smart views and intents, always visible ── */}
        <nav className={cn(
          'flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-app)] flex-shrink-0 transition-[width] duration-200',
          sidebarCollapsed ? 'w-[52px]' : 'w-[196px]'
        )}>
          <div className={cn('pt-3 pb-2', sidebarCollapsed ? 'px-2' : 'px-2.5')}>
            <button
              onClick={() => { setReplyMode(null); setShowCompose(true); }}
              title="Compose (c)"
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-[8px] bg-[var(--indigo)] text-white text-[12.5px] font-semibold hover:bg-[var(--indigo-hover)] transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(91,91,245,0.35)]',
                sidebarCollapsed ? 'h-8 w-8 mx-auto' : 'h-8 w-full'
              )}
            >
              <Pencil className="h-3.5 w-3.5" />
              {!sidebarCollapsed && 'Compose'}
            </button>
          </div>

          <div className={cn('flex-1 overflow-y-auto pb-2 space-y-px', sidebarCollapsed ? 'px-2' : 'px-2.5')}>
            {foldersList.map(f => (
              <NavRow
                key={f.id}
                item={{ id: f.id, label: f.label, icon: f.icon }}
                active={folder === f.id}
                collapsed={sidebarCollapsed}
                count={f.count}
                onClick={() => { setFolder(f.id); setSelectedId(null); setTagFilter('all'); setQuickFilter('all'); setUnreadOnly(false); }}
              />
            ))}

            {!sidebarCollapsed && (
              <div className="px-2 pt-4 pb-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Views</span>
              </div>
            )}
            {sidebarCollapsed && <div className="my-2 mx-auto w-4 h-px bg-[var(--border-default)]" />}
            <NavRow
              item={{ id: 'unread', label: 'Unread', icon: MailOpen }}
              active={unreadOnly}
              collapsed={sidebarCollapsed}
              count={folder === 'inbox' ? viewCounts.unread : undefined}
              onClick={() => setUnreadOnly(v => !v)}
            />
            <NavRow
              item={{ id: 'hot', label: 'Hot leads', icon: Sparkles }}
              active={quickFilter === 'hot'}
              collapsed={sidebarCollapsed}
              count={viewCounts.hot}
              onClick={() => { setQuickFilter(quickFilter === 'hot' ? 'all' : 'hot'); setTagFilter('all'); setUnreadOnly(false); setSelectedId(null); }}
            />
            <NavRow
              item={{ id: 'needs', label: 'Needs reply', icon: Reply }}
              active={quickFilter === 'needs_reply'}
              collapsed={sidebarCollapsed}
              count={viewCounts.needs_reply}
              onClick={() => { setQuickFilter(quickFilter === 'needs_reply' ? 'all' : 'needs_reply'); setTagFilter('all'); setUnreadOnly(false); setSelectedId(null); }}
            />

            {!sidebarCollapsed && (
              <div className="px-2 pt-4 pb-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Intents</span>
              </div>
            )}
            {sidebarCollapsed && <div className="my-2 mx-auto w-4 h-px bg-[var(--border-default)]" />}
            {TAG_OPTIONS.filter(t => t.value !== 'all').map(t => (
              <NavRow
                key={t.value}
                item={{ id: t.value, label: t.label, dot: INTENT_DOTS[t.value] || '#94A3B8' }}
                active={tagFilter === t.value}
                collapsed={sidebarCollapsed}
                count={viewCounts[t.value]}
                onClick={() => {
                  const next = tagFilter === t.value ? 'all' : t.value;
                  setTagFilter(next); setQuickFilter('all'); setUnreadOnly(false); setSelectedId(null);
                }}
              />
            ))}
          </div>

          <div className={cn('border-t border-[var(--border-subtle)] py-1.5', sidebarCollapsed ? 'px-2' : 'px-2.5')}>
            <button
              onClick={() => setSidebarCollapsed(v => !v)}
              title={sidebarCollapsed ? 'Expand' : 'Collapse'}
              className={cn('icon-btn', sidebarCollapsed ? 'mx-auto' : '')}
            >
              {sidebarCollapsed ? <PanelRight className="h-3.5 w-3.5 rotate-180" /> : <PanelRightClose className="h-3.5 w-3.5 rotate-180" />}
            </button>
          </div>
        </nav>

        {/* ── Conversation list ── */}
        <div className="flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] flex-shrink-0" style={{ width: '360px', minWidth: '320px' }}>
          {/* Header: current view + actions */}
          <div className="flex items-center gap-2 px-3.5 h-[52px] border-b border-[var(--border-subtle)]">
            <h2 className="text-[14px] font-semibold text-[var(--text-primary)] tracking-[-0.01em] truncate">
              {tagFilter !== 'all'
                ? TAG_OPTIONS.find(t => t.value === tagFilter)?.label
                : quickFilter !== 'all'
                  ? QUICK_FILTERS.find(f => f.id === quickFilter)?.label
                  : unreadOnly ? 'Unread' : foldersList.find(f => f.id === folder)?.label}
            </h2>
            <span className="text-[11px] font-medium tabular text-[var(--text-tertiary)]">{folder === 'scheduled' ? '' : visibleConversations.length}</span>
            {isFetching && <Loader2 className="h-3.5 w-3.5 text-[var(--text-tertiary)] animate-spin" />}
            <div className="flex-1" />
            <button onClick={handleRefresh} disabled={isRefreshing || isFetching} title="Sync inboxes" className="icon-btn flex-shrink-0 disabled:opacity-40">
              <RefreshCw className={cn('h-3.5 w-3.5', (isRefreshing || isFetching) && 'animate-spin')} />
            </button>
            <button onClick={() => markAllReadMut.mutate()} disabled={markAllReadMut.isPending} title="Mark all read" className="icon-btn flex-shrink-0">
              <CheckCheck className="h-4 w-4" />
            </button>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
            <form onSubmit={handleSearch}>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                <input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder="Search conversations…"
                  className="w-full pl-8 pr-8 h-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#5B5BF5]/15 transition-all"
                />
                {search && (
                  <button type="button" onClick={() => { setSearch(''); setSearchInput(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--bg-hover)]">
                    <X className="h-3 w-3 text-[var(--text-tertiary)]" />
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Connection error banner — only when sync hit errors */}
          {syncErrors.length > 0 && (
            <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-start gap-2">
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

          {/* Conversation rows */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-3 px-4 py-3 border-b border-[var(--border-subtle)]">
                    <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-1.5 py-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-2.5 w-8" />
                      </div>
                      <Skeleton className="h-2.5 w-2/3" />
                      <Skeleton className="h-2.5 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : folder === 'scheduled' ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-[var(--indigo-subtle)] flex items-center justify-center mb-3 border border-[rgba(99,102,241,0.18)]">
                  <Clock className="h-5 w-5 text-[var(--indigo)]" />
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Scheduled emails</p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">Manage upcoming sends in the panel on the right.</p>
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
                return (
                  <button
                    key={conv.contactEmail}
                    onClick={() => selectMessage(msg)}
                    className={cn(
                      'group w-full text-left relative px-3.5 py-2.5 border-b border-[var(--border-subtle)] transition-colors',
                      isSelected ? 'bg-[var(--indigo-subtle)]' : 'hover:bg-[var(--bg-hover)]'
                    )}
                  >
                    {isSelected && <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full bg-[var(--indigo)]" />}
                    <div className="flex items-start gap-3">
                      <div className="relative flex-shrink-0 mt-0.5">
                        {isOutbound ? (
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--text-tertiary)] border border-[var(--border-subtle)]">
                            <SendHorizontal className="h-3.5 w-3.5" />
                          </span>
                        ) : (
                          <Avatar name={avatarSeed} email={msg.from_email} size="lg" />
                        )}
                        {conv.hasUnread && !isOutbound && (
                          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--indigo)] ring-2 ring-[var(--bg-surface)]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={cn('text-[13px] truncate', conv.hasUnread ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]')}>
                              {displayName}
                            </span>
                            {conv.messageCount > 1 && (
                              <span className="text-[9.5px] font-semibold px-1 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-tertiary)] flex-shrink-0 tabular">{conv.messageCount}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {conv.isStarred && <Star className="h-3 w-3 text-amber-400 fill-amber-400" />}
                            <span className="text-[10.5px] text-[var(--text-tertiary)] tabular">{timeAgo(msg.received_at)}</span>
                          </div>
                        </div>
                        <p className={cn('text-[12.5px] truncate mt-0.5', conv.hasUnread ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]')}>
                          {msg.subject || '(no subject)'}
                        </p>
                        {msgSnippet(msg) && (
                          <p className="text-[11.5px] text-[var(--text-tertiary)] truncate mt-0.5">{msgSnippet(msg)}</p>
                        )}
                        {(intent || msg.campaign_name || (msg.smtp_email && !isOutbound)) && (
                          <div className="flex items-center gap-1.5 mt-2 overflow-hidden">
                            {intent && (
                              <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0', intent.bg, intent.text)}>
                                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
                                {intent.label}
                              </span>
                            )}
                            {msg.campaign_name && (
                              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[var(--text-tertiary)] truncate max-w-[110px]">{msg.campaign_name}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Center: Email Detail / Scheduled Panel ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-surface)]">
          {folder === 'scheduled' ? (
            <ScheduledEmailsPanel onCancel={(id) => cancelScheduledMut.mutate(id)} />
          ) : currentMsg ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--border-subtle)]">
                <button onClick={() => setSelectedId(null)} className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors lg:hidden">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="flex-1" />
                <button onClick={() => { setShowCompose(false); setReplyMode('reply'); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }} title="Reply" className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                  <Reply className="h-4 w-4" />
                </button>
                <button onClick={() => { setShowCompose(false); setReplyMode('forward'); setForwardTo(''); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }} title="Forward" className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                  <Forward className="h-4 w-4" />
                </button>
                <button
                  onClick={() => toggleStarMut.mutate(currentMsg.id)}
                  title={currentMsg.is_starred ? 'Unstar' : 'Star'}
                  className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Star className={`h-4 w-4 ${currentMsg.is_starred ? 'text-amber-400 fill-amber-400' : ''}`} />
                </button>
                <button
                  onClick={() => handleArchiveToggle(currentMsg)}
                  title={archiveLabel}
                  className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <ArchiveIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => currentMsg.is_read ? markUnreadMut.mutate(currentMsg.id) : markReadMut.mutate(currentMsg.id)}
                  title={currentMsg.is_read ? 'Mark unread' : 'Mark read'}
                  className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {currentMsg.is_read ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <div className="h-4 w-px bg-[var(--border-subtle)] mx-1 hidden xl:block" />
                <button
                  onClick={() => setShowContext(v => !v)}
                  title={showContext ? 'Hide contact details' : 'Show contact details'}
                  className={cn(
                    'p-2 rounded-lg transition-colors hidden xl:block',
                    showContext
                      ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                      : 'hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {showContext ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
                </button>
              </div>

              {/* Conversation workspace: thread canvas + composer dock + contact rail */}
              <div className="flex-1 flex min-h-0">
                <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex-1 overflow-y-auto bg-[var(--bg-app)]">
                  <div className="max-w-3xl mx-auto px-6 py-5">
                  {/* Thread header — subject first, contact meta below */}
                  <div className="mb-5">
                    <div className="flex items-start justify-between gap-3">
                      <h1 className="text-[16.5px] font-semibold text-[var(--text-primary)] leading-snug tracking-[-0.015em] min-w-0">
                        {threadSubject || '(no subject)'}
                      </h1>
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
                                    onClick={() => { setTagMut.mutate({ id: currentMsg.id, tag: opt.value }); setShowTagDropdown(false); }}
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
                    <div className="mt-1.5 flex items-center gap-2 text-[12px] text-[var(--text-tertiary)] flex-wrap">
                      <span className="font-medium text-[var(--text-secondary)]">{threadContactName}</span>
                      {threadContactEmail && (
                        <>
                          <span className="sep-dot" />
                          <span className="truncate max-w-[220px]">{threadContactEmail}</span>
                        </>
                      )}
                      <span className="sep-dot" />
                      <span className="tabular">{threadStats.total} message{threadStats.total === 1 ? '' : 's'}</span>
                      {threadStats.first && threadStats.total > 1 && (
                        <>
                          <span className="sep-dot" />
                          <span>Started {new Date(threadStats.first).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        </>
                      )}
                    </div>
                  </div>

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

                {/* ── Composer dock — replying happens beside the thread, never below it ── */}
                <div className="flex-shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[0_-10px_28px_-18px_rgba(15,15,25,0.25)]">
                  {replyMode ? (
                    <div ref={replyComposerRef} className="max-w-3xl mx-auto w-full flex flex-col max-h-[60vh]">
                      {/* Dock header: context + sender + close, one calm row */}
                      <div className="flex items-center gap-2.5 px-4 h-11 border-b border-[var(--border-subtle)] flex-shrink-0">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--indigo-subtle)] flex-shrink-0">
                          {replyMode === 'reply' ? <Reply className="h-3.5 w-3.5 text-[var(--indigo)]" /> : <Forward className="h-3.5 w-3.5 text-[var(--indigo)]" />}
                        </span>
                        <span className="text-[13px] font-semibold text-[var(--text-primary)] flex-shrink-0">{replyMode === 'reply' ? 'Reply' : 'Forward'}</span>
                        {replyMode === 'reply' && (
                          <span className="text-[12px] text-[var(--text-tertiary)] truncate">to {currentMsg.from_email}</span>
                        )}
                        <span className="flex-1" />
                        <span className="text-[11px] text-[var(--text-tertiary)] hidden sm:block flex-shrink-0">From</span>
                        <div className="max-w-[260px] min-w-0">
                          <SenderSelect accounts={smtpAccounts} value={replySenderId} onChange={setReplySenderId} />
                        </div>
                        <div className="h-4 w-px bg-[var(--border-subtle)] flex-shrink-0" />
                        <button onClick={() => setReplyMode(null)} title="Close composer" className="icon-btn flex-shrink-0"><X className="h-3.5 w-3.5" /></button>
                      </div>
                      {replyMode === 'forward' && (
                        <div className="flex items-center px-4 py-2 border-b border-[var(--border-subtle)] flex-shrink-0">
                          <span className="text-xs font-medium text-[var(--text-tertiary)] w-10">To</span>
                          <input value={forwardTo} onChange={e => setForwardTo(e.target.value)} className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none" placeholder="recipient@example.com" autoFocus />
                        </div>
                      )}
                      {/* Editor + forward preview scroll inside the dock */}
                      <div className="flex-1 min-h-0 overflow-y-auto">
                        <RichTextEditor
                          key={replyMode}
                          placeholder={replyMode === 'reply' ? 'Write your reply…' : 'Add a note (optional)…'}
                          onChange={replyEditor.handleChange}
                          templates={templates}
                          minHeight="170px"
                          autoFocus={replyMode === 'reply'}
                        />
                        {replyMode === 'forward' && (
                          <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40">
                            <div className="px-4 py-2.5">
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
                      </div>
                      {/* AI Assist Bar */}
                      {replyMode === 'reply' && (
                        <AiAssistBar
                          messageId={currentMsg.id}
                          onInsert={handleAiInsert}
                        />
                      )}
                      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)]">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const sid = replySenderId || undefined;
                              if (replyMode === 'reply' && !replyEditor.isEmpty) replyMut.mutate({ id: currentMsg.id, body: replyEditor.text, body_html: replyEditor.html, smtp_account_id: sid });
                              else if (replyMode === 'forward' && forwardTo.trim()) forwardMut.mutate({ id: currentMsg.id, to: forwardTo, note: replyEditor.text || undefined, body_html: replyEditor.html || undefined, smtp_account_id: sid });
                            }}
                            disabled={
                              (replyMode === 'reply' ? replyEditor.isEmpty || replyMut.isPending : !forwardTo.trim() || forwardMut.isPending)
                            }
                            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[var(--indigo)] text-white text-sm font-semibold hover:bg-[var(--indigo-hover)] transition-colors disabled:opacity-40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(67,56,202,0.35)]"
                          >
                            <Send className="h-3.5 w-3.5" />
                            {replyMut.isPending || forwardMut.isPending ? 'Sending...' : replyMode === 'reply' ? 'Send Reply' : 'Forward'}
                          </button>
                          {replyMode === 'reply' && (
                            <div className="relative">
                              <button
                                onClick={() => setShowReplySchedule(!showReplySchedule)}
                                disabled={replyEditor.isEmpty || replyMut.isPending}
                                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-40 ${
                                  showReplySchedule
                                    ? 'bg-[#6366F1]/10 text-[var(--indigo)] border border-[#6366F1]/20'
                                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]'
                                }`}
                                title="Schedule send"
                              >
                                <CalendarClock className="h-3.5 w-3.5" />
                                <span className="text-[13px]">Schedule</span>
                                <ChevronDown className={`h-3 w-3 transition-transform ${showReplySchedule ? 'rotate-180' : ''}`} />
                              </button>
                              {showReplySchedule && (
                                <ScheduleSendPicker
                                  onSchedule={(scheduledAt) => {
                                    const sid = replySenderId || undefined;
                                    scheduleReplyMut.mutate({ id: currentMsg.id, body: replyEditor.text, body_html: replyEditor.html, smtp_account_id: sid, scheduled_at: scheduledAt });
                                    setShowReplySchedule(false);
                                  }}
                                  onClose={() => setShowReplySchedule(false)}
                                />
                              )}
                            </div>
                          )}
                        </div>
                        <button onClick={() => setReplyMode(null)} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Discard</button>
                      </div>
                    </div>
                  ) : (
                    /* Idle state: a one-click reply bar keeps the composer a thought away */
                    <div className="max-w-3xl mx-auto w-full px-4 py-3 flex items-center gap-2.5">
                      <Avatar name={threadContactName || undefined} email={threadContactEmail || undefined} size="md" />
                      <button
                        onClick={() => { setShowCompose(false); setReplyMode('reply'); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }}
                        className="flex-1 h-10 px-4 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] text-left text-[13px] text-[var(--text-tertiary)] hover:border-[rgba(91,91,245,0.45)] hover:bg-[var(--bg-surface)] transition-colors"
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

                {/* Contact context rail */}
                {showContext && (
                  <ContactContextPanel msg={currentMsg} stats={threadStats} onCopyEmail={copyContactEmail} />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-[var(--bg-app)]">
              <div className="text-center">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-[var(--bg-surface)] flex items-center justify-center mb-4 border border-[var(--border-subtle)] shadow-sm">
                  <MailPlus className="h-7 w-7 text-[var(--text-tertiary)]" />
                </div>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1.5">Select a conversation</h3>
                <p className="text-sm text-[var(--text-secondary)] max-w-xs mx-auto">Pick a conversation from the list to read the full thread and reply.</p>
                <div className="mt-6 flex items-center justify-center gap-4 text-[11px] text-[var(--text-tertiary)]">
                  {[['J / K', 'navigate'], ['R', 'reply'], ['E', 'archive'], ['C', 'compose']].map(([key, label]) => (
                    <span key={label} className="flex items-center gap-1.5">
                      <kbd className="px-1.5 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] font-semibold text-[10px] text-[var(--text-secondary)] shadow-sm">{key}</kbd>
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
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

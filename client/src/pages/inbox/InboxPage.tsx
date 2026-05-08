import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inboxApi } from '../../api/inbox.api';
import { smtpApi } from '../../api/smtp.api';
import { templateApi } from '../../api/template.api';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { RichTextEditor, useRichTextEditorRef } from '../../components/ui/RichTextEditor';
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
  return text.slice(0, 120).trim() || '(no content)';
}

const INTENT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  interested: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', label: 'Interested' },
  meeting: { bg: 'bg-blue-500/10', text: 'text-blue-600', label: 'Meeting Booked' },
  objection: { bg: 'bg-amber-500/10', text: 'text-amber-600', label: 'Objection' },
  not_now: { bg: 'bg-slate-500/10', text: 'text-slate-500', label: 'Not Interested' },
  unsubscribe: { bg: 'bg-red-500/10', text: 'text-red-500', label: 'Unsubscribe' },
  out_of_office: { bg: 'bg-purple-500/10', text: 'text-purple-500', label: 'Out of Office' },
  bounce: { bg: 'bg-red-500/10', text: 'text-red-500', label: 'Bounce' },
  other: { bg: 'bg-slate-500/10', text: 'text-slate-500', label: 'Other' },
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
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  line-height: 1.65;
  color: #1a1a1a;
  word-wrap: break-word;
  overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
}
img { max-width: 100%; height: auto; display: block; }
a { color: #1a73e8; text-decoration: none; }
a:hover { text-decoration: underline; }
blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #dadce0; color: #5f6368; }
pre { white-space: pre-wrap; font-size: 13px; background: #f8f9fa; padding: 12px; border-radius: 8px; }
table { border-collapse: collapse; max-width: 100%; }
hr { border: none; border-top: 1px solid #e0e0e0; margin: 16px 0; }
p { margin: 0 0 12px; }
h1, h2, h3, h4 { margin: 0 0 8px; }
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
    <div className={`fixed inset-0 z-50 flex ${expanded ? 'items-center justify-center' : 'items-end justify-end'} p-6`}>
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
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-40 shadow-[0_2px_8px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_12px_rgba(99,102,241,0.45)]"
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
                    ? 'bg-[#6366F1]/10 text-[#6366F1] border border-[#6366F1]/20'
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
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-tertiary)] hover:text-[#6366F1] hover:bg-[#6366F1]/5 transition-colors"
      >
        <Wand2 className="h-3.5 w-3.5" />
        AI Assist
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--border-subtle)] bg-gradient-to-r from-[rgba(99,102,241,0.05)] to-[rgba(139,92,246,0.05)]">
      <Wand2 className="h-4 w-4 text-[#6366F1] flex-shrink-0" />
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
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40 shadow-[0_1px_4px_rgba(99,102,241,0.3)]"
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
          <div key={d} className="text-center text-[10px] font-semibold text-[var(--text-muted)] uppercase py-1">{d}</div>
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
                  ? 'bg-[#6366F1] text-[var(--bg-app)] font-semibold shadow-sm'
                  : isToday
                    ? 'font-semibold text-[#6366F1] hover:bg-[#6366F1]/10'
                    : !cell.current
                      ? 'text-[var(--text-muted)]'
                      : disabled
                        ? 'text-[var(--text-muted)] cursor-not-allowed'
                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {cell.day}
              {isToday && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#6366F1]" />
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
              !isPM ? 'bg-[#6366F1] text-[var(--bg-app)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'
            }`}
          >AM</button>
          <button
            onClick={() => { if (!isPM) togglePeriod(); }}
            className={`px-2.5 py-1 text-[11px] font-semibold transition-all border-l border-[var(--border-subtle)] ${
              isPM ? 'bg-[#6366F1] text-[var(--bg-app)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'
            }`}
          >PM</button>
        </div>
      </div>

      {/* Hour grid */}
      <div className="mb-2">
        <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Hour</span>
        <div className="grid grid-cols-6 gap-1">
          {hours12.map(h => (
            <button
              key={h}
              onClick={() => setHour12(h)}
              className={`py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                display12 === h
                  ? 'bg-[#6366F1] text-[var(--bg-app)] shadow-sm'
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
        <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5 block">Minute</span>
        <div className="grid grid-cols-4 gap-1">
          {minutes.map(m => (
            <button
              key={m}
              onClick={() => onChange({ ...value, minute: m })}
              className={`py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                value.minute === m
                  ? 'bg-[#6366F1] text-[var(--bg-app)] shadow-sm'
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
    if (dt <= new Date()) return;
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
              <CalendarClock className="h-3.5 w-3.5 text-[#6366F1]" />
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
                    <Icon className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[#6366F1] transition-colors" />
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
                <Calendar className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[#6366F1] transition-colors" />
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
            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-[13px] font-semibold hover:opacity-90 transition-all shadow-[0_2px_8px_rgba(99,102,241,0.3)] hover:shadow-[0_4px_12px_rgba(99,102,241,0.4)]"
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
          <span className="text-[9px] bg-[#6366F1] text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-bold">{current.count}</span>
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
                  isActive ? 'bg-[rgba(99,102,241,0.08)] text-[#6366F1]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <FolderIcon className={`h-3.5 w-3.5 ${isActive ? 'text-[#6366F1]' : 'text-[var(--text-tertiary)]'}`} />
                <span className="flex-1">{f.label}</span>
                {f.count ? (
                  <span className="text-[9px] bg-[#6366F1] text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-bold">{f.count}</span>
                ) : null}
                {isActive && (
                  <div className="w-1.5 h-1.5 rounded-full bg-[#6366F1]" />
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

/* ─── Collapsible Thread Messages ─────────────────── */
function CollapsibleThread({ thread, selectedId }: { thread: Message[]; selectedId: string | null }) {
  // Expand latest message and the selected one by default, collapse older ones
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    if (thread.length > 0) ids.add(thread[thread.length - 1].id); // latest
    if (selectedId) ids.add(selectedId);
    return ids;
  });

  // Update expanded set when thread or selection changes
  useEffect(() => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (thread.length > 0) next.add(thread[thread.length - 1].id);
      if (selectedId) next.add(selectedId);
      return next;
    });
  }, [thread.length, selectedId]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {thread.map((msg) => {
        const isOutbound = msg.direction === 'outbound';
        const isCurrent = msg.id === selectedId;
        const isExpanded = expandedIds.has(msg.id);

        return (
          <div
            key={msg.id}
            id={`msg-${msg.id}`}
            className={`rounded-xl border overflow-hidden transition-all ${
              isCurrent
                ? isOutbound
                  ? 'border-[#6366F1]/30 bg-[var(--bg-surface)]'
                  : 'border-[#6366F1]/30 bg-[var(--bg-elevated)]'
                : isOutbound
                  ? 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
            }`}
            style={{ boxShadow: isCurrent ? '0 0 0 1px #6366F1' : 'var(--shadow-card)' }}
          >
            {/* Clickable header — toggles collapse */}
            <button
              type="button"
              onClick={() => toggleExpand(msg.id)}
              className={`w-full text-left flex items-start gap-3 p-4 transition-colors hover:bg-[var(--bg-hover)]/50 ${
                isExpanded ? 'border-b border-[var(--border-subtle)]' : ''
              } ${!isOutbound && isExpanded ? 'bg-[var(--bg-elevated)]' : ''}`}
            >
              <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                </div>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${
                  isOutbound ? 'bg-[#6366F1]/10 border-[#6366F1]/20' : 'bg-[var(--bg-surface)] border-[var(--border-default)]'
                }`}>
                  {isOutbound ? (
                    <SendHorizontal className="h-3 w-3 text-[#6366F1]" />
                  ) : (
                    <span className="text-[11px] font-semibold text-[var(--text-primary)]">{senderInitial(msg)}</span>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {isOutbound ? 'You' : senderName(msg)}
                  </span>
                  {isOutbound && (
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[#6366F1]/10 text-[#6366F1]">Sent</span>
                  )}
                  {!isOutbound && (
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--text-tertiary)]/10 text-[var(--text-tertiary)]">Received</span>
                  )}
                  {msg.campaign_name && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">{msg.campaign_name}</span>
                  )}
                </div>
                {/* Collapsed: show snippet; Expanded: show recipient */}
                {isExpanded ? (
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-xs text-[var(--text-tertiary)]">to {msg.to_email}</span>
                    {msg.subject && (
                      <>
                        <span className="text-xs text-[var(--text-tertiary)]">&middot;</span>
                        <span className="text-xs text-[var(--text-secondary)] truncate max-w-[200px]">{msg.subject}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">{msgSnippet(msg)}</p>
                )}
              </div>
              <span className="text-[11px] text-[var(--text-tertiary)] flex-shrink-0 whitespace-nowrap">
                {isExpanded ? formatFullDate(msg.received_at) : timeAgo(msg.received_at)}
              </span>
            </button>

            {/* Collapsible email body */}
            {isExpanded && (
              <div className="p-0 animate-fade-in">
                <ErrorBoundary fallback={
                  <div className="p-6 text-sm text-[var(--text-secondary)]">
                    <p>{msg.body_text ? stripHtml(msg.body_text) : '(Unable to render email content)'}</p>
                  </div>
                }>
                  <EmailBody html={msg.body_html} text={msg.body_text} />
                </ErrorBoundary>
              </div>
            )}
          </div>
        );
      })}
    </div>
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
    return <div className="flex items-center justify-center py-16"><Spinner size="md" /></div>;
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
          <Clock className="h-5 w-5 text-[#6366F1]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Scheduled Emails</h2>
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#6366F1]/10 text-[#6366F1]">{emails.length}</span>
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
                  <Clock className="h-4 w-4 text-[#6366F1]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">To: {email.to_email}</span>
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                      isPast ? 'bg-amber-500/10 text-amber-500' : 'bg-[#6366F1]/10 text-[#6366F1]'
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

/* ─── Main InboxPage ──────────────────────────────── */
export function InboxPage() {
  const qc = useQueryClient();
  const [folder, setFolder] = useState<Folder>('inbox');
  const [tagFilter, setTagFilter] = useState('all');
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

  const syncMut = useMutation({
    mutationFn: inboxApi.syncInbox,
    onSuccess: (data) => {
      invalidate();
      if (data.errors && data.errors.length > 0 && data.newMessages === 0) {
        // IMAP sync had issues but we still refreshed from the database
        toast.error('Could not connect to mail server — showing cached emails');
      } else if (data.errors && data.errors.length > 0) {
        // Partial success — some accounts synced, some had errors
        toast.success(`${data.newMessages} new email${data.newMessages > 1 ? 's' : ''} synced (some accounts had errors)`);
      } else if (data.newMessages > 0) {
        toast.success(`${data.newMessages} new email${data.newMessages > 1 ? 's' : ''} synced`);
      } else if (data.synced === 0) {
        toast('No SMTP accounts configured — add one in Settings', { icon: 'ℹ️' });
      } else {
        toast.success('Inbox up to date');
      }
    },
    onError: () => {
      invalidate();
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

  /* ── Select next message after removal ── */
  const selectNextMessage = useCallback((removedId: string) => {
    const idx = messages.findIndex(m => m.id === removedId);
    if (idx >= 0 && messages.length > 1) {
      const next = messages[idx + 1] || messages[idx - 1];
      setSelectedId(next?.id || null);
    } else {
      setSelectedId(null);
    }
  }, [messages]);

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
    mutationFn: inboxApi.archiveThread,
    onSuccess: (_data, id) => {
      selectNextMessage(id);
      invalidate();
      toast.success('Archived');
    },
    onError: () => toast.error('Failed to archive'),
  });

  const unarchiveMut = useMutation({
    mutationFn: inboxApi.unarchiveThread,
    onSuccess: (_data, id) => {
      selectNextMessage(id);
      invalidate();
      toast.success('Moved to Inbox');
    },
    onError: () => toast.error('Failed to unarchive'),
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
    inboxApi.markThreadRead(msg.id).then(() => invalidate()).catch(() => {});
  }, [smtpAccounts, invalidate]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setSelectedId(null);
  }, [searchInput]);

  const handleArchiveToggle = useCallback((msg: Message) => {
    if (folder === 'archived' || msg.is_archived) {
      unarchiveMut.mutate(msg.id);
    } else {
      archiveMut.mutate(msg.id);
    }
  }, [folder, archiveMut, unarchiveMut]);

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
  const conversations: ConversationThread[] = useMemo(() => {
    if (messages.length === 0) return [];

    const threadMap = new Map<string, Message[]>();

    for (const msg of messages) {
      // Skip scheduled messages from regular views
      if (msg.sara_status === 'scheduled') continue;

      // Group by contact email — matches the getThread logic on the server
      const contactEmail = msg.direction === 'outbound'
        ? (msg.contact_email || msg.to_email)
        : (msg.contact_email || msg.from_email);

      if (!contactEmail) {
        // Ungroupable messages get their own thread
        threadMap.set(msg.id, [msg]);
        continue;
      }

      const existing = threadMap.get(contactEmail);
      if (existing) {
        existing.push(msg);
      } else {
        threadMap.set(contactEmail, [msg]);
      }
    }

    return Array.from(threadMap.entries()).map(([key, msgs]) => {
      // Sort desc — latest first
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
  }, [messages]);

  const unreadCount = conversations.filter(c => c.hasUnread).length;

  const isInArchived = folder === 'archived';
  const archiveLabel = isInArchived ? 'Move to Inbox' : 'Archive';
  const ArchiveIcon = isInArchived ? ArchiveRestore : Archive;

  const foldersList: { id: Folder; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'inbox', label: 'Inbox', icon: Inbox, count: unreadCount || undefined },
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

  return (
    <div className="-mx-8 -my-6" style={{ height: 'calc(100vh - 56px)' }}>
      <div className="h-full flex bg-[var(--bg-app)]">

        {/* ── Left: Message List ── */}
        <div className="flex flex-col border-r border-[var(--border-subtle)]" style={{ width: '380px', minWidth: '340px' }}>
          {/* Header: Compose + Search + Actions */}
          <div className="px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="flex items-center gap-2">
              <button onClick={() => setShowCompose(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-xs font-semibold hover:opacity-90 transition-all flex-shrink-0 shadow-[0_1px_6px_rgba(99,102,241,0.3)]">
                <Pencil className="h-3.5 w-3.5" />
                Compose
              </button>
              <form onSubmit={handleSearch} className="flex-1 min-w-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                  <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search..." className="w-full pl-8 pr-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[#6366F1] transition-colors" />
                  {search && (
                    <button type="button" onClick={() => { setSearch(''); setSearchInput(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--bg-hover)]">
                      <X className="h-3 w-3 text-[var(--text-tertiary)]" />
                    </button>
                  )}
                </div>
              </form>
              <button
                onClick={() => markAllReadMut.mutate()}
                disabled={markAllReadMut.isPending}
                title="Mark all read"
                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 flex-shrink-0"
              >
                <CheckCheck className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing || isFetching}
                title="Refresh"
                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 flex-shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${(isRefreshing || isFetching) ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Folder selector + Tag filter — compact row */}
          <div className="flex items-center px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] gap-2">
            <FolderSelector
              folders={foldersList}
              active={folder}
              onChange={(id) => { setFolder(id); setSelectedId(null); setTagFilter('all'); }}
            />
            <div className="flex-1" />
            <TagFilterDropdown value={tagFilter} onChange={v => { setTagFilter(v); setSelectedId(null); }} />
          </div>

          {/* Message List — grouped as conversation threads */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-16"><Spinner size="md" /></div>
            ) : folder === 'scheduled' ? (
              /* Scheduled folder: empty sidebar, detail panel shows scheduled list */
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-[#6366F1]/10 flex items-center justify-center mb-3 border border-[#6366F1]/20">
                  <Clock className="h-5 w-5 text-[#6366F1]" />
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Scheduled Emails</p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">View and manage your scheduled emails in the panel</p>
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <div className="w-12 h-12 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center mb-3 border border-[var(--border-subtle)]">
                  <MailOpen className="h-5 w-5 text-[var(--text-tertiary)]" />
                </div>
                <p className="text-sm font-medium text-[var(--text-secondary)]">No conversations</p>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  {search ? 'Try a different search term' : tagFilter !== 'all' ? `No messages tagged as "${TAG_OPTIONS.find(t => t.value === tagFilter)?.label}"` : `Your ${folder} is empty`}
                </p>
              </div>
            ) : (
              conversations.map(conv => {
                const msg = conv.latestMessage;
                const isSelected = msg.id === selectedId;
                const isOutbound = msg.direction === 'outbound';
                const hasTags = (msg.smtp_email && !isOutbound) || (msg.sara_intent && msg.sara_intent !== 'scheduled') || msg.campaign_name;
                return (
                  <button
                    key={conv.contactEmail}
                    onClick={() => selectMessage(msg)}
                    className={`w-full text-left px-3 py-2.5 border-b border-[var(--border-subtle)] transition-all duration-100 ${
                      isSelected ? 'bg-[rgba(99,102,241,0.06)] border-l-2 border-l-[#6366F1]' : 'bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="relative flex-shrink-0 mt-0.5">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                          isOutbound
                            ? 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
                            : conv.hasUnread
                              ? 'bg-[#6366F1]/10 text-[#6366F1]'
                              : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                        }`}>
                          {isOutbound ? <SendHorizontal className="h-3 w-3" /> : senderInitial(msg)}
                        </div>
                        {conv.hasUnread && !isOutbound && (
                          <div className="absolute -top-px -right-px w-2 h-2 rounded-full bg-[#6366F1]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`text-[13px] truncate ${conv.hasUnread ? 'font-semibold text-[var(--text-primary)]' : 'font-normal text-[var(--text-secondary)]'}`}>
                              {isOutbound ? `To: ${msg.to_email?.split('@')[0]}` : (conv.contactName || senderName(msg))}
                            </span>
                            {conv.messageCount > 1 && (
                              <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-tertiary)] flex-shrink-0">{conv.messageCount}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {conv.isStarred && <Star className="h-3 w-3 text-amber-400 fill-amber-400" />}
                            <span className="text-[10px] text-[var(--text-tertiary)]">{timeAgo(msg.received_at)}</span>
                          </div>
                        </div>
                        <p className={`text-[12px] truncate ${conv.hasUnread ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                          {msg.subject || '(no subject)'}
                        </p>
                        <p className="text-[11px] text-[var(--text-tertiary)] truncate mt-px">{msgSnippet(msg)}</p>
                        {hasTags && (
                          <div className="flex items-center gap-1 mt-1.5 overflow-hidden">
                            {msg.smtp_email && !isOutbound && (
                              <span className="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-blue-500/8 text-blue-500 truncate max-w-[90px]" title={`Delivered to ${msg.smtp_email}`}>
                                {msg.smtp_label || msg.smtp_email.split('@')[0]}
                              </span>
                            )}
                            {msg.sara_intent && msg.sara_intent !== 'scheduled' && (
                              <span className={`inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-md truncate max-w-[90px] ${(INTENT_COLORS[msg.sara_intent] || INTENT_COLORS.other).bg} ${(INTENT_COLORS[msg.sara_intent] || INTENT_COLORS.other).text}`}>
                                {(INTENT_COLORS[msg.sara_intent] || INTENT_COLORS.other).label}
                              </span>
                            )}
                            {msg.campaign_name && (
                              <span className="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--bg-elevated)] text-[var(--text-tertiary)] truncate max-w-[90px]">{msg.campaign_name}</span>
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
                <button onClick={() => { setReplyMode('reply'); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }} title="Reply" className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                  <Reply className="h-4 w-4" />
                </button>
                <button onClick={() => { setReplyMode('forward'); setForwardTo(''); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }} title="Forward" className="p-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
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
              </div>

              {/* Email content */}
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-6 py-6">
                  {/* Conversation header */}
                  <div className="flex items-start gap-3 mb-4">
                    <div className="flex-1">
                      <h1 className="text-xl font-semibold text-[var(--text-primary)] leading-tight">
                        {currentMsg.contact_name || currentMsg.from_email?.split('@')[0] || 'Conversation'}
                      </h1>
                      <p className="text-xs text-[var(--text-tertiary)] mt-1">
                        {thread.length > 1 ? `${thread.length} messages` : '1 message'}
                        {currentMsg.contact_email && ` · ${currentMsg.contact_email}`}
                      </p>
                    </div>
                    {/* Clickable tag dropdown */}
                    <div className="relative flex-shrink-0">
                      <button
                        onClick={() => setShowTagDropdown(!showTagDropdown)}
                        className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                          currentMsg.sara_intent
                            ? `${(INTENT_COLORS[currentMsg.sara_intent] || INTENT_COLORS.other).bg} ${(INTENT_COLORS[currentMsg.sara_intent] || INTENT_COLORS.other).text}`
                            : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]'
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

                  {/* Conversation thread — collapsible messages */}
                  <CollapsibleThread
                    thread={thread.length > 0 ? thread : [currentMsg]}
                    selectedId={selectedId}
                  />

                  {/* Reply / Forward composer */}
                  {replyMode && (
                    <div ref={replyComposerRef} className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
                      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                        <div className="flex items-center gap-2">
                          {replyMode === 'reply' ? <Reply className="h-4 w-4 text-[var(--text-tertiary)]" /> : <Forward className="h-4 w-4 text-[var(--text-tertiary)]" />}
                          <span className="text-sm font-medium text-[var(--text-primary)]">{replyMode === 'reply' ? 'Reply' : 'Forward'}</span>
                          {replyMode === 'reply' && <span className="text-xs text-[var(--text-tertiary)]">to {currentMsg.from_email}</span>}
                        </div>
                        <button onClick={() => setReplyMode(null)} className="p-1 rounded hover:bg-[var(--bg-hover)]"><X className="h-4 w-4 text-[var(--text-tertiary)]" /></button>
                      </div>
                      {/* Sender selection */}
                      <div className="flex items-center px-4 py-2 border-b border-[var(--border-subtle)]">
                        <span className="text-xs font-medium text-[var(--text-tertiary)] w-12">From</span>
                        <SenderSelect accounts={smtpAccounts} value={replySenderId} onChange={setReplySenderId} />
                      </div>
                      {replyMode === 'forward' && (
                        <div className="flex items-center px-4 py-2 border-b border-[var(--border-subtle)]">
                          <span className="text-xs font-medium text-[var(--text-tertiary)] w-12">To</span>
                          <input value={forwardTo} onChange={e => setForwardTo(e.target.value)} className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none" placeholder="recipient@example.com" />
                        </div>
                      )}
                      <RichTextEditor
                        placeholder={replyMode === 'reply' ? 'Write your reply...' : 'Add a note (optional)...'}
                        onChange={replyEditor.handleChange}
                        templates={templates}
                        minHeight="140px"
                        autoFocus
                      />
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
                            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-sm font-semibold hover:opacity-90 transition-all disabled:opacity-40 shadow-[0_2px_8px_rgba(99,102,241,0.35)] hover:shadow-[0_4px_12px_rgba(99,102,241,0.45)]"
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
                                    ? 'bg-[#6366F1]/10 text-[#6366F1] border border-[#6366F1]/20'
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
                  )}

                  {/* Quick action buttons */}
                  {!replyMode && (
                    <div className="mt-4 flex items-center gap-2">
                      <button onClick={() => { setReplyMode('reply'); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-colors">
                        <Reply className="h-4 w-4" />Reply
                      </button>
                      <button onClick={() => { setReplyMode('forward'); setForwardTo(''); setReplySenderId(currentMsg.smtp_account_id || smtpAccounts[0]?.id || ''); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-colors">
                        <Forward className="h-4 w-4" />Forward
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center mb-4 border border-[var(--border-subtle)]">
                  <MailPlus className="h-7 w-7 text-[var(--text-tertiary)]" />
                </div>
                <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1.5">Select a message</h3>
                <p className="text-sm text-[var(--text-secondary)] max-w-xs">Choose a conversation from the left to read and reply.</p>
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

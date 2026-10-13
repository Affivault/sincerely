import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Clock, ExternalLink, Send, Sparkles, X } from 'lucide-react';
import { replyIntentLabel, type FlowItem } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Replies, one at a time, on a phone.

   Each card is one person: what they said, and Relay's answer ready to
   edit. Swipe right (or tap Send) to send it; swipe left (or tap Not now)
   to bring it back tomorrow morning. Nothing is sent without a draft
   that has words in it, and every send goes through the same path as
   the Today list.
   ═══════════════════════════════════════════════════════════════════════ */

const SWIPE = 90;

export function ReplyDeck({ items, onSend, onSnooze, onOpen, onClose }: {
  items: FlowItem[];
  onSend: (item: FlowItem, text: string) => void;
  onSnooze: (item: FlowItem) => void;
  onOpen: (item: FlowItem) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const item = items[index];
  const text = item ? (drafts[item.key] ?? item.reply?.draft ?? '') : '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const next = () => { setDx(0); setIndex((i) => i + 1); };
  const send = () => { if (item && text.trim()) { onSend(item, text); next(); } };
  const later = () => { if (item) { onSnooze(item); next(); } };

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('textarea,button,a')) return;
    start.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const mx = e.clientX - start.current.x;
    if (Math.abs(e.clientY - start.current.y) > Math.abs(mx)) return;
    setDx(mx);
  };
  const onPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    if (dx > SWIPE && text.trim()) send();
    else if (dx < -SWIPE) later();
    else setDx(0);
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[var(--bg-app)]" role="dialog" aria-label="Replies, one at a time" data-reply-deck>
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
        <button onClick={onClose} className="icon-btn" aria-label="Close"><ArrowLeft className="h-4 w-4" /></button>
        <span className="flex-1 text-strong font-semibold text-[var(--text-primary)]">Replies</span>
        <span className="text-caption tabular text-[var(--text-tertiary)]">{Math.min(index + 1, items.length)} of {items.length}</span>
      </div>

      {!item ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-strong font-semibold text-[var(--text-primary)]">That's every reply.</p>
          <button onClick={onClose} className="btn-primary">Back to today</button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden p-3">
          <div
            className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)] touch-pan-y"
            style={{ transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: start.current ? 'none' : 'transform 160ms ease-out' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            data-reply-card
          >
            {dx > 30 && <span className="absolute left-4 top-4 z-10 rounded-md border-2 border-emerald-500 px-2 py-0.5 text-caption font-bold text-emerald-600">SEND</span>}
            {dx < -30 && <span className="absolute right-4 top-4 z-10 rounded-md border-2 border-amber-500 px-2 py-0.5 text-caption font-bold text-amber-600">TOMORROW</span>}
            <div className="border-b border-[var(--border-subtle)] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-strong font-semibold text-[var(--text-primary)]">
                  {item.reply?.contact_name || item.reply?.from_email}
                </span>
                {item.reply?.intent && (
                  <span className="rounded-full bg-[var(--indigo-subtle)] px-1.5 py-0.5 text-micro font-semibold text-[var(--indigo)]">{replyIntentLabel(item.reply.intent)}</span>
                )}
              </div>
              {item.reply?.company && <p className="text-caption text-[var(--text-tertiary)]">{item.reply.company}</p>}
            </div>
            <div className="max-h-[38%] overflow-y-auto px-4 py-3 text-body text-[var(--text-secondary)]">
              {item.reply?.snippet || item.reply?.subject}
            </div>
            <div className="flex flex-1 flex-col border-t border-[var(--border-subtle)] px-4 py-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-caption font-medium text-[var(--text-tertiary)]">
                <Sparkles className="h-3 w-3" /> Your answer
              </p>
              <textarea
                value={text}
                onChange={(e) => setDrafts((d) => ({ ...d, [item.key]: e.target.value }))}
                placeholder="Write a reply, or open the conversation"
                className="min-h-[120px] w-full flex-1 resize-none rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-body text-[var(--text-primary)] outline-none focus:border-[var(--indigo)]"
              />
              <button onClick={() => onOpen(item)} className="mt-2 inline-flex items-center gap-1 self-start text-caption font-medium text-[var(--indigo)]">
                Open the conversation <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 pb-[env(safe-area-inset-bottom)]">
            <button onClick={later} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] text-body font-medium text-[var(--text-secondary)]">
              <Clock className="h-4 w-4" /> Not now
            </button>
            <button onClick={next} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] text-body font-medium text-[var(--text-secondary)]">
              <X className="h-4 w-4" /> Skip
            </button>
            <button onClick={send} disabled={!text.trim()} className={cn('inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--indigo)] text-body font-semibold text-white', !text.trim() && 'opacity-50')}>
              <Send className="h-4 w-4" /> Send
            </button>
          </div>
          <p className="mt-2 text-center text-micro text-[var(--text-tertiary)]">Swipe right to send, left for tomorrow.</p>
        </div>
      )}
    </div>,
    document.body,
  );
}

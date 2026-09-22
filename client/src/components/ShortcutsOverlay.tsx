import { useEffect, useRef } from 'react';
import { X, Keyboard } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Navigate',
    items: [
      { keys: ['G', 'D'], label: 'Dashboard' },
      { keys: ['G', 'C'], label: 'Campaigns' },
      { keys: ['G', 'I'], label: 'Unibox' },
      { keys: ['G', 'A'], label: 'Analytics' },
      { keys: ['G', 'L'], label: 'Lead lists' },
      { keys: ['G', 'T'], label: 'Templates' },
      { keys: ['G', 'S'], label: 'Settings' },
    ],
  },
  {
    title: 'Actions',
    items: [
      { keys: ['N'], label: 'New campaign' },
      { keys: ['⌘', 'K'], label: 'Command palette' },
      { keys: ['?'], label: 'Keyboard shortcuts' },
    ],
  },
  {
    // Leads and Contacts share one grid, so these work on both.
    title: 'Lists and tables',
    items: [
      { keys: ['J'], label: 'Next row' },
      { keys: ['K'], label: 'Previous row' },
      { keys: ['X'], label: 'Select the focused row' },
      { keys: ['⇧', 'A'], label: 'Select all on this page' },
      { keys: ['↵'], label: 'Open the full record' },
      { keys: ['/'], label: 'Jump to search' },
      { keys: ['Esc'], label: 'Clear focus and selection' },
    ],
  },
  {
    title: 'Inbox',
    items: [
      { keys: ['J'], label: 'Next conversation' },
      { keys: ['K'], label: 'Previous conversation' },
      { keys: ['R'], label: 'Reply' },
      { keys: ['E'], label: 'Archive / unarchive' },
      { keys: ['C'], label: 'Compose' },
    ],
  },
  {
    title: 'SARA queue',
    items: [
      { keys: ['J'], label: 'Next message' },
      { keys: ['K'], label: 'Previous message' },
      { keys: ['A'], label: 'Approve reply' },
      { keys: ['E'], label: 'Edit draft' },
      { keys: ['D'], label: 'Dismiss' },
    ],
  },
  {
    // Keys mirror TRIAGE_DECISIONS in shared/src, which is what the
    // ReplyTriage bar itself binds — kept here by hand since that list
    // isn't imported by this overlay.
    title: 'Reply triage',
    items: [
      { keys: ['I'], label: 'Interested — create a lead' },
      { keys: ['L'], label: 'Not now — schedule a follow-up' },
      { keys: ['N'], label: 'Not interested — suppress' },
    ],
  },
];

export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  /*
   * A sheet to read, not to fill in - so the cursor goes to the panel
   * rather than being pushed at the close button, and Escape or Tab both
   * still work from there.
   */
  useFocusTrap(panelRef, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[3px] animate-fade-in" onClick={onClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        className="relative w-full max-w-[480px] glass rounded-[16px] shadow-[var(--shadow-xl)] overflow-hidden"
        style={{ animation: 'cmdkIn 200ms var(--ease-out) both' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 h-[52px] border-b border-[var(--border-subtle)]">
          <Keyboard className="h-4 w-4 text-[var(--text-tertiary)]" strokeWidth={2} />
          <h2 className="flex-1 text-strong font-semibold text-[var(--text-primary)] tracking-[-0.01em]">
            Keyboard shortcuts
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className="eyebrow !text-[var(--text-tertiary)] mb-2.5">{group.title}</p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between h-8 px-2 -mx-2 rounded-md hover:bg-[var(--bg-hover)]/60 transition-colors">
                    <span className="text-strong text-[var(--text-secondary)]">{item.label}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && item.keys[0] === 'G' && (
                            <span className="text-micro text-[var(--text-muted)] font-data">then</span>
                          )}
                          <kbd className="kbd !h-[20px] !min-w-[20px] !text-micro">{k}</kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 h-9 flex items-center border-t border-[var(--border-subtle)] bg-[var(--bg-muted)]/40">
          <span className="text-caption text-[var(--text-tertiary)]">
            Shortcuts are disabled while typing in a field.
          </span>
        </div>
      </div>
    </div>
  );
}

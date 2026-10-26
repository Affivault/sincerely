import { useCallback, useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  attachmentProblem, formatBytes, OUTGOING_ATTACHMENT_LIMIT_BYTES,
  type OutgoingAttachment,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Files attached to a reply or a new message.

   The limit is checked as files are picked, with the same rule the server
   enforces (shared/inbox-reminders), so a file that is too big is refused
   at the moment it is chosen - not after the whole email has been written
   and Send has spun for half a minute.
   ═══════════════════════════════════════════════════════════════════════ */

interface Picked {
  id: string;
  file: File;
}

/** Read a File as base64, without the data: prefix the reader adds. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const url = String(reader.result || '');
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function useOutgoingAttachments() {
  const [picked, setPicked] = useState<Picked[]>([]);

  const add = useCallback((list: FileList | File[] | null) => {
    const incoming = Array.from(list || []);
    if (incoming.length === 0) return;
    const next = [...picked, ...incoming.map((file) => ({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file }))];
    const problem = attachmentProblem(next.map((p) => ({ filename: p.file.name, size: p.file.size })));
    // All or nothing: half of a multi-file pick silently missing is worse
    // than being told the whole pick was too big.
    if (problem) {
      toast.error(problem);
      return;
    }
    setPicked(next);
  }, [picked]);

  const remove = useCallback((id: string) => setPicked((prev) => prev.filter((p) => p.id !== id)), []);
  const clear = useCallback(() => setPicked([]), []);

  /** What the API takes. Read only when sending, so picking stays instant. */
  const toPayload = useCallback(async (): Promise<OutgoingAttachment[]> => {
    return Promise.all(picked.map(async (p) => ({
      filename: p.file.name,
      content_type: p.file.type || 'application/octet-stream',
      content_base64: await toBase64(p.file),
    })));
  }, [picked]);

  const totalBytes = picked.reduce((n, p) => n + p.file.size, 0);
  return { picked, add, remove, clear, toPayload, totalBytes, count: picked.length };
}

export type OutgoingAttachmentsState = ReturnType<typeof useOutgoingAttachments>;

/** The paperclip: opens the file picker. */
export function AttachButton({ state, disabled }: { state: OutgoingAttachmentsState; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Attach files"
        title={`Attach files (up to ${formatBytes(OUTGOING_ATTACHMENT_LIMIT_BYTES)} in total)`}
        onClick={() => input.current?.click()}
        disabled={disabled}
        className="icon-btn h-9 w-9 flex-shrink-0 disabled:opacity-40"
      >
        <Paperclip className="h-4 w-4" />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          state.add(e.currentTarget.files);
          // Cleared so picking the same file again after removing it still fires.
          e.currentTarget.value = '';
        }}
      />
    </>
  );
}

/** What is attached so far, each removable, with the running total. */
export function AttachmentChips({ state }: { state: OutgoingAttachmentsState }) {
  if (state.count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
      {state.picked.map((p) => (
        <span
          key={p.id}
          className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 pl-2 pr-1 text-caption text-[var(--text-primary)]"
        >
          <Paperclip className="h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
          <span className="truncate" title={p.file.name}>{p.file.name}</span>
          <span className="flex-shrink-0 tabular text-[var(--text-tertiary)]">{formatBytes(p.file.size)}</span>
          <button
            type="button"
            aria-label={`Remove ${p.file.name}`}
            onClick={() => state.remove(p.id)}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-[var(--bg-hover)]"
          >
            <X className="h-3 w-3 text-[var(--text-tertiary)]" />
          </button>
        </span>
      ))}
      <span className="text-micro tabular text-[var(--text-tertiary)]">
        {formatBytes(state.totalBytes)} of {formatBytes(OUTGOING_ATTACHMENT_LIMIT_BYTES)}
      </span>
    </div>
  );
}

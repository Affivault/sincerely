import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { cn } from '../../lib/utils';
import { AlertTriangle, Trash2 } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════════
   Ask before doing something irreversible.

   Thirty places used window.confirm. It blocks the whole tab, ignores the
   app's typography and colours, cannot say more than one line, and gives
   a destructive action the same grey OK as a harmless one — so the moment
   that most deserves a pause looks like every other moment.

   The call site stays a one-liner:

       confirm({ title: 'Delete this list?', tone: 'danger' }, () => remove())

   A callback rather than a promise, deliberately. The promise form reads
   better — `if (await confirm(…))` — but a single missed `await` anywhere
   in a thirty-site conversion turns `if (confirm(…))` into a test of a
   promise object, which is always truthy: the dialog appears and the
   deletion happens regardless of the answer. A shape that cannot be
   misused silently is worth more than a shape that reads well.
   ═══════════════════════════════════════════════════════════════════════ */

export interface ConfirmOptions {
  title: string;
  /** The consequence, in a sentence. Skip it when the title says everything. */
  body?: string;
  /** Defaults to "Continue", or "Delete" when the tone is danger. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` colours the action red and leads with a warning mark. */
  tone?: 'default' | 'danger';
}

/** Run this if, and only if, the user agrees. */
type OnConfirm = () => void;

const ConfirmContext = createContext<((options: ConfirmOptions, onConfirm: OnConfirm) => void) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const pending = useRef<OnConfirm | null>(null);

  const confirm = useCallback((next: ConfirmOptions, onConfirm: OnConfirm) => {
    // A second ask while one is open replaces the first. Silently dropping the
    // earlier callback is right: its dialog is gone, so nobody agreed to it.
    pending.current = onConfirm;
    setOptions(next);
  }, []);

  const settle = useCallback((ok: boolean) => {
    const run = pending.current;
    pending.current = null;
    setOptions(null);
    if (ok) run?.();
  }, []);

  const danger = options?.tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <Modal
          isOpen
          // Escape and the backdrop mean "no", which is the safe answer.
          onClose={() => settle(false)}
          title={options.title}
          size="sm"
          footer={
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => settle(false)}>
                {options.cancelLabel || 'Cancel'}
              </Button>
              <Button
                variant={danger ? 'danger' : 'primary'}
                onClick={() => settle(true)}
                autoFocus
              >
                {danger && <Trash2 className="h-3.5 w-3.5" />}
                {options.confirmLabel || (danger ? 'Delete' : 'Continue')}
              </Button>
            </div>
          }
        >
          <div className={cn('flex gap-3', !options.body && 'items-center')}>
            {danger && (
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--error-bg)]">
                <AlertTriangle className="h-4 w-4 text-[var(--error)]" />
              </span>
            )}
            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
              {options.body || 'This cannot be undone.'}
            </p>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * @returns `confirm(options, onConfirm)` — runs onConfirm only if they agree.
 *
 * Falls back to window.confirm when no provider is mounted, so a component
 * rendered outside the app shell still asks rather than going straight ahead.
 */
export function useConfirm(): (options: ConfirmOptions, onConfirm: OnConfirm) => void {
  const ctx = useContext(ConfirmContext);
  return useCallback(
    (options: ConfirmOptions, onConfirm: OnConfirm) => {
      if (ctx) { ctx(options, onConfirm); return; }
      const text = [options.title, options.body].filter(Boolean).join('\n\n');
      if (window.confirm(text)) onConfirm();
    },
    [ctx],
  );
}

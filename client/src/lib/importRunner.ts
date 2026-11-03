/* ═══════════════════════════════════════════════════════════════════════
   The import that is running, wherever you are in the app.

   An import used to live inside the import page: leave the page and it
   stopped mid-file. Now the batches run here, outside any page, and the
   page - and a small progress pill shown on every other page - read the
   same state. Leaving the import page no longer stops anything; closing
   the browser tab still would, so the tab asks first while one runs.

   One import at a time, which is what the page offers anyway.
   ═══════════════════════════════════════════════════════════════════════ */

export interface ImportRunProgress {
  total: number;
  processed: number;
  imported: number;
  errors: number;
  errorDetails: { email: string; reason: string }[];
  currentBatch: number;
  totalBatches: number;
}

export interface ImportRunResult {
  total: number; attempted: number; imported: number; errors: number;
  created: number; updated: number; suppressed: number;
  createdIds: string[];
  errorDetails: { email: string; reason: string }[];
  durationMs: number;
  cancelled: boolean;
  /** The recorded import (Import history), when history is available. */
  importId?: string | null;
}

export interface ImportRun {
  id: number;
  /** The file's name, or "Pasted ...". */
  label: string;
  /** Where to look at the people afterwards. */
  filedAs: 'prospect' | 'contact';
  listId: string | null;
  createdListName: string | null;
  status: 'running' | 'done';
  progress: ImportRunProgress;
  result: ImportRunResult | null;
  heldCount: number;
  /** The person has seen the result (on the page or by closing the pill). */
  acknowledged: boolean;
}

let run: ImportRun | null = null;
let cancelFlag = false;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const importRunner = {
  get(): ImportRun | null { return run; },
  subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; },

  isRunning(): boolean { return run?.status === 'running'; },

  start(init: { label: string; filedAs: 'prospect' | 'contact'; listId: string | null; createdListName: string | null; total: number; totalBatches: number }): number {
    cancelFlag = false;
    run = {
      id: ++seq,
      label: init.label,
      filedAs: init.filedAs,
      listId: init.listId,
      createdListName: init.createdListName,
      status: 'running',
      progress: { total: init.total, processed: 0, imported: 0, errors: 0, errorDetails: [], currentBatch: 0, totalBatches: init.totalBatches },
      result: null,
      heldCount: 0,
      acknowledged: false,
    };
    emit();
    return run.id;
  },

  progress(id: number, p: ImportRunProgress): void {
    if (!run || run.id !== id) return;
    run = { ...run, progress: p };
    emit();
  },

  held(id: number, n: number): void {
    if (!run || run.id !== id) return;
    run = { ...run, heldCount: n };
    emit();
  },

  finish(id: number, result: ImportRunResult): void {
    if (!run || run.id !== id) return;
    run = { ...run, status: 'done', result };
    emit();
  },

  cancel(): void { cancelFlag = true; emit(); },
  cancelRequested(): boolean { return cancelFlag; },

  /** Seen: the pill goes away. The page keeps showing it until a new import. */
  acknowledge(): void {
    if (!run || run.status !== 'done') return;
    run = { ...run, acknowledged: true };
    emit();
  },

  /** Start over: forget the finished import. */
  clear(): void {
    if (run?.status === 'running') return;
    run = null;
    emit();
  },
};

// Closing the tab mid-import would stop it: ask first.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (importRunner.isRunning()) { e.preventDefault(); e.returnValue = ''; }
  });
}

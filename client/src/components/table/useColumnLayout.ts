import { useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   Column layout — widths, order, and the gestures that change them.

   Lifted out of the contacts table so a second table can behave the same
   way rather than approximate it. Everything here is presentation: the
   drag moves a COLUMN, never a value. Cells render through their own
   column's render(), so a company's industry can never end up under
   "Location" no matter how the header is dragged.
   ═══════════════════════════════════════════════════════════════════════ */

export const MIN_COL_W = 88;
export const MAX_COL_W = 640;
/** The frozen row-number gutter. */
export const GUTTER_W = 44;

export interface ColumnLayout {
  widths: Record<string, number>;
  order: string[];
  /** Live during a resize gesture, so it can't turn into a reorder. */
  resizingCol: string | null;
  dragCol: string | null;
  dropCol: { id: string; side: 'left' | 'right' } | null;
  widthOf: (id: string) => number;
  startResize: (id: string, e: React.PointerEvent) => void;
  resetWidth: (id: string) => void;
  setOrder: (next: string[]) => void;
  moveColumnTo: (dragId: string, targetId: string, side: 'left' | 'right') => void;
  setDragCol: (id: string | null) => void;
  setDropCol: (v: { id: string; side: 'left' | 'right' } | null) => void;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export function useColumnLayout({
  storagePrefix, defaultOrder, defaultWidth = 160, widthOverrides = {},
}: {
  /** Namespaces the persisted width/order, e.g. "companies". */
  storagePrefix: string;
  defaultOrder: string[];
  defaultWidth?: number;
  /** Per-column starting widths for the ones that shouldn't be uniform. */
  widthOverrides?: Record<string, number>;
}): ColumnLayout {
  const widthKey = `${storagePrefix}.colWidths`;
  const orderKey = `${storagePrefix}.colOrder`;

  const [widths, setWidths] = useState<Record<string, number>>(() => read(widthKey, {}));
  const [order, setOrderState] = useState<string[]>(() => {
    const saved = read<string[] | null>(orderKey, null);
    if (!Array.isArray(saved) || saved.length === 0) return defaultOrder;
    // Reconcile against the current column set: drop ids that no longer
    // exist, and append ones added since the preference was saved — otherwise
    // a new column would be invisible to everyone who ever reordered.
    const known = new Set(defaultOrder);
    const kept = saved.filter((id) => known.has(id));
    return [...kept, ...defaultOrder.filter((id) => !kept.includes(id))];
  });

  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<{ id: string; side: 'left' | 'right' } | null>(null);

  const widthOf = (id: string) => widths[id] ?? widthOverrides[id] ?? defaultWidth;

  const startResize = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(id);
    setResizingCol(id);
    // Track the gesture's own result rather than reading state back, so the
    // value written to storage is the one the user let go on.
    let latest: Record<string, number> = { ...widths };

    const onMove = (ev: PointerEvent) => {
      const w = Math.min(MAX_COL_W, Math.max(MIN_COL_W, Math.round(startW + (ev.clientX - startX))));
      latest = { ...latest, [id]: w };
      setWidths(latest);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setResizingCol(null);
      write(widthKey, latest);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const resetWidth = (id: string) => {
    const next = { ...widths };
    delete next[id];
    setWidths(next);
    write(widthKey, next);
  };

  const setOrder = (next: string[]) => {
    setOrderState(next);
    write(orderKey, next);
  };

  const moveColumnTo = (dragId: string, targetId: string, side: 'left' | 'right') => {
    if (dragId === targetId) return;
    const next = order.filter((c) => c !== dragId);
    const idx = next.indexOf(targetId);
    if (idx === -1) return;
    next.splice(side === 'left' ? idx : idx + 1, 0, dragId);
    setOrder(next);
  };

  return {
    widths, order, resizingCol, dragCol, dropCol,
    widthOf, startResize, resetWidth, setOrder, moveColumnTo, setDragCol, setDropCol,
  };
}

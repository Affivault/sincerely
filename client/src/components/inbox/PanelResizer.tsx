import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/*
 * Panels you can drag wider or narrower, the width remembered per browser.
 *
 * A width is a preference about your own screen, so it lives in
 * localStorage (guarded: a private window or blocked storage just means the
 * default every time).
 */

function read(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}
function write(key: string, value: number) {
  try { localStorage.setItem(key, String(Math.round(value))); } catch { /* storage off */ }
}

export function usePanelWidth(key: string, fallback: number, min: number, max: number) {
  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, n)), [min, max]);
  const [width, setWidthState] = useState(() => clamp(read(key) ?? fallback));
  const setWidth = useCallback((n: number) => setWidthState(clamp(n)), [clamp]);
  // Saved when it settles, not on every pixel of a drag.
  useEffect(() => {
    const t = setTimeout(() => write(key, width), 250);
    return () => clearTimeout(t);
  }, [key, width]);
  const reset = useCallback(() => setWidthState(clamp(fallback)), [clamp, fallback]);
  return { width, setWidth, reset, min, max };
}

export function usePersistentFlag(key: string, fallback = false) {
  const [on, setOn] = useState(() => {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; }
  });
  useEffect(() => { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage off */ } }, [key, on]);
  return [on, setOn] as const;
}

/**
 * The grab line between two panels. Drag it, double-click it to reset, or
 * focus it and use the arrow keys. `side` says which panel it sizes: the one
 * to its left ('left'), or the one to its right ('right').
 */
export function PanelResizer({ width, setWidth, reset, min, max, side, label }: {
  width: number;
  setWidth: (n: number) => void;
  reset: () => void;
  min: number;
  max: number;
  side: 'left' | 'right';
  label: string;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    setWidth(start.current.w + (side === 'left' ? dx : -dx));
  };
  const end = () => { start.current = null; setDragging(false); };

  // No text selection and a resize cursor everywhere while dragging, so the
  // pointer leaving the 8px line does not flicker back to an arrow.
  useEffect(() => {
    if (!dragging) return;
    const prev = [document.body.style.cursor, document.body.style.userSelect];
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => { document.body.style.cursor = prev[0]; document.body.style.userSelect = prev[1]; };
  }, [dragging]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === grow) { e.preventDefault(); setWidth(width + step); }
    else if (e.key === shrink) { e.preventDefault(); setWidth(width - step); }
    else if (e.key === 'Home') { e.preventDefault(); setWidth(min); }
    else if (e.key === 'End') { e.preventDefault(); setWidth(max); }
    else if (e.key === 'Enter') { e.preventDefault(); reset(); }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
      className="group relative z-10 w-px flex-shrink-0 cursor-col-resize bg-[var(--border-subtle)] outline-none"
    >
      {/* A wider invisible grab area, and a line that lights up on hover. */}
      <span aria-hidden className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] rounded-full transition-colors',
          dragging ? 'bg-[var(--indigo)]' : 'bg-transparent group-hover:bg-[var(--indigo)]/50 group-focus-visible:bg-[var(--indigo)]',
        )}
      />
    </div>
  );
}

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ColumnLayout } from './useColumnLayout';

/* Shared table chrome: the sort affordance, the resize divider, and the
   draggable header cell that ties them together. Extracted so two tables
   can be the same table rather than two things that resemble each other. */

/** The drag divider on a column's right edge. */
export function ResizeHandle({ onPointerDown, onDoubleClick }: {
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    <span
      // The header itself is draggable (column reordering); marking the
      // divider undraggable keeps a resize from turning into a reorder.
      draggable={false}
      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize · double-click to reset"
      className="group/rz absolute right-0 top-0 z-[4] flex h-full w-[9px] translate-x-[4px] cursor-col-resize touch-none items-center justify-center"
    >
      <span className="h-full w-[2px] rounded bg-transparent transition-colors group-hover/rz:bg-[var(--indigo)] group-active/rz:bg-[var(--indigo)]" />
    </span>
  );
}

/**
 * Says which way a column is sorted, on the cell a screen reader reads it
 * from.
 *
 * aria-sort belongs on the <th>, not on the button inside it, and the <th>
 * is drawn by whichever table owns the row - three of them, one with its
 * own drag logic. The sort button is the one piece that always knows the
 * state, so it reports it to the header it sits in.
 */
export function useAriaSort(button: RefObject<HTMLElement>, active: boolean, dir: 'asc' | 'desc') {
  useLayoutEffect(() => {
    const th = button.current?.closest('th');
    if (!th) return;
    th.setAttribute('aria-sort', active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
    return () => th.removeAttribute('aria-sort');
  }, [button, active, dir]);
}

export function SortableHeader<K extends string>({ label, colKey, sortBy, sortDir, onSort }: {
  label: string; colKey: K; sortBy: K; sortDir: 'asc' | 'desc'; onSort: (k: K) => void;
}) {
  const active = sortBy === colKey;
  const ref = useRef<HTMLButtonElement>(null);
  useAriaSort(ref, active, sortDir);
  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => { e.stopPropagation(); onSort(colKey); }}
      // 24px to hit; the negative margin hands the extra height back to the
      // header's own padding so the row is no taller than before.
      className={cn(
        'flex min-h-6 -my-1 items-center gap-1 group/sort min-w-0 transition-colors',
        active ? 'text-[var(--indigo-text)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
      )}
    >
      <span className="text-caption font-medium truncate">{label}</span>
      {active
        ? (sortDir === 'asc'
            ? <ChevronUp className="h-3 w-3 flex-shrink-0" />
            : <ChevronDown className="h-3 w-3 flex-shrink-0" />)
        : <ChevronsUpDown className="h-3 w-3 flex-shrink-0 opacity-0 group-hover/sort:opacity-60" />}
    </button>
  );
}

/**
 * A reorderable, resizable header cell. `children` is whatever labels the
 * column — usually an icon plus a SortableHeader.
 */
export function DraggableHeader({ id, layout, children }: {
  id: string; layout: ColumnLayout; children: React.ReactNode;
}) {
  const { resizingCol, dragCol, dropCol, setDragCol, setDropCol, moveColumnTo, startResize, resetWidth } = layout;

  return (
    <th
      draggable={resizingCol !== id}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        setDragCol(id);
      }}
      onDragOver={(e) => {
        if (!dragCol || dragCol === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = e.currentTarget.getBoundingClientRect();
        const side: 'left' | 'right' = e.clientX < r.left + r.width / 2 ? 'left' : 'right';
        setDropCol(dropCol?.id === id && dropCol.side === side ? dropCol : { id, side });
      }}
      onDragLeave={() => { if (dropCol?.id === id) setDropCol(null); }}
      onDrop={(e) => {
        e.preventDefault();
        const dragged = e.dataTransfer.getData('text/plain') || dragCol;
        if (dragged && dropCol?.id === id) moveColumnTo(dragged, id, dropCol.side);
        setDragCol(null);
        setDropCol(null);
      }}
      onDragEnd={() => { setDragCol(null); setDropCol(null); }}
      title="Drag to reorder · drag the edge to resize"
      className={cn(
        'relative select-none bg-[var(--bg-muted)] border-b border-r border-[var(--border-subtle)] px-3 py-[7px] whitespace-nowrap',
        resizingCol === id ? 'cursor-col-resize' : 'cursor-grab active:cursor-grabbing',
        dragCol === id && 'opacity-40',
      )}
    >
      <span className="flex items-center gap-1.5 min-w-0">{children}</span>

      {/* Where it will land */}
      {dropCol?.id === id && dragCol && dragCol !== id && (
        <span
          className={cn(
            'pointer-events-none absolute top-0 z-[5] h-full w-[2px] bg-[var(--indigo)]',
            dropCol.side === 'left' ? 'left-0' : 'right-0',
          )}
        />
      )}

      <ResizeHandle
        onPointerDown={(e) => startResize(id, e)}
        onDoubleClick={() => resetWidth(id)}
      />
    </th>
  );
}

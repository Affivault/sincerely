import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  footer?: ReactNode;
}

export function Modal({ isOpen, onClose, title, description, children, size = 'md', footer }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizes = {
    sm:  'max-w-sm',
    md:  'max-w-md',
    lg:  'max-w-xl',
    xl:  'max-w-3xl',
    '2xl': 'max-w-5xl',
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[3px] animate-fade-in"
        onClick={onClose}
      />

      {/* Panel — frosted glass over the dimmed workspace */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative w-full max-h-[90vh] flex flex-col rounded-[14px] glass shadow-[var(--shadow-xl)]',
          sizes[size]
        )}
        style={{ animation: 'cmdkIn 200ms var(--ease-out) both' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-[var(--border-subtle)] flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-[var(--text-primary)] tracking-tight leading-tight">
              {title}
            </h2>
            {description && (
              <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 leading-snug">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-3 flex-shrink-0 rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors duration-150 -mr-0.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 overflow-y-auto flex-1">
          {children}
        </div>

        {/* Footer — only if provided */}
        {footer && (
          <div className="px-4 py-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2 flex-shrink-0 bg-[var(--bg-elevated)]/60">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

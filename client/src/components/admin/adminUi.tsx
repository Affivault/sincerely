import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';

/* The building blocks of the account panel: cards, tiles, fields and one
   way to run an admin action (toast, then refresh everything admin). */

/** A field sized by its caller; `inputCls` is the same at full width. */
export const inputBase = 'h-9 min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--bg-app)] px-3 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)] transition-[border-color,box-shadow] disabled:opacity-60';
export const inputCls = `${inputBase} w-full`;

export const errMsg = (e: any, fallback: string) => e?.response?.data?.error || fallback;

export function Card({ title, icon: Icon, children, className, aside, tone }: {
  title: string; icon?: any; children: ReactNode; className?: string; aside?: ReactNode; tone?: 'danger';
}) {
  return (
    <section className={cn('rounded-xl border bg-[var(--bg-surface)]', tone === 'danger' ? 'border-red-500/30' : 'border-[var(--border-subtle)]', className)}>
      <header className="flex items-center gap-2 px-4 h-11 border-b border-[var(--border-subtle)]">
        {Icon && <Icon className={cn('h-3.5 w-3.5', tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-[var(--indigo-text)]')} />}
        <h3 className={cn('text-strong font-semibold', tone === 'danger' ? 'text-red-700 dark:text-red-400' : 'text-[var(--text-primary)]')}>{title}</h3>
        <span className="flex-1" />
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
      <p className="text-caption font-medium text-[var(--text-tertiary)]">{label}</p>
      <p className={cn('mt-1 text-heading font-semibold tabular leading-tight', tone || 'text-[var(--text-primary)]')}>{value}</p>
      {sub && <div className="text-micro text-[var(--text-tertiary)] mt-0.5">{sub}</div>}
    </div>
  );
}

/** One control: what it does on the left, the button on the right. */
export function Row({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0 border-b border-[var(--border-subtle)] last:border-0 flex-wrap sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-[var(--text-primary)]">{title}</p>
        {sub && <p className="text-caption text-[var(--text-tertiary)] mt-0.5">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0 flex-wrap">{children}</div>}
    </div>
  );
}

export function Banner({ tone, icon: Icon, children, action }: { tone: 'danger' | 'warn' | 'info'; icon: any; children: ReactNode; action?: ReactNode }) {
  const cls = tone === 'danger' ? 'border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400'
    : tone === 'warn' ? 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400'
      : 'border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 text-[var(--indigo-text)]';
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border px-4 py-2.5 flex-wrap', cls)}>
      <Icon className="h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0 text-body text-[var(--text-primary)]">{children}</div>
      {action}
    </div>
  );
}

/**
 * An admin action on an account: shows `success` (or what the result says),
 * shows the server's reason on failure, and refreshes every admin screen.
 */
export function useAdminAction<A, R>(fn: (arg: A) => Promise<R>, success: string | ((r: R, arg: A) => string), failure: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r, arg) => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      toast.success(typeof success === 'function' ? success(r, arg) : success);
    },
    onError: (e) => toast.error(errMsg(e, failure)),
  });
}

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, XCircle, ArrowRight } from 'lucide-react';
import { systemApi } from '../../api/system.api';
import { cn } from '../../lib/utils';

/**
 * One line on Home when something has quietly stopped - a job, a mailbox,
 * a campaign. Nothing at all when everything is running: this is the line
 * that has to be noticed on the one day it appears.
 */
export function SystemNote() {
  const { data } = useQuery({
    queryKey: ['system-status'],
    queryFn: systemApi.status,
    staleTime: 60_000,
    meta: { silentError: true },
  });
  if (!data || data.level === 'ok') return null;
  const down = data.level === 'down';
  const Icon = down ? XCircle : AlertTriangle;
  return (
    <Link
      to="/system"
      className={cn(
        'group flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors',
        down ? 'border-rose-500/25 bg-rose-500/10 hover:bg-rose-500/15' : 'border-amber-500/25 bg-amber-500/8 hover:bg-amber-500/12',
      )}
      data-system-note={data.level}
    >
      <Icon className={cn('h-4 w-4 flex-shrink-0', down ? 'text-rose-500' : 'text-amber-500')} />
      <span className="min-w-0 flex-1 truncate text-body text-[var(--text-primary)]">{data.headline}</span>
      <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

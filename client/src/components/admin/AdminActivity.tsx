import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, History } from 'lucide-react';
import { formatDateTime } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Spinner } from '../ui/Spinner';
import { describeAudit } from './adminFormat';

/* Every change made from the admin backend, newest first. */
export function AdminActivity() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => adminApi.audit(300) });

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-[var(--border-subtle)]">
        <History className="h-4 w-4 text-[var(--indigo-text)]" />
        <p className="text-strong font-semibold text-[var(--text-primary)]">Activity</p>
        <span className="text-caption text-[var(--text-tertiary)]">Every change made to an account from here</span>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="md" /></div>
      ) : isError || !data ? (
        <p className="p-4 text-body text-[var(--text-tertiary)]">{(error as any)?.response?.data?.error || 'The activity log could not be loaded.'}</p>
      ) : !data.controls_ready ? (
        <p className="p-4 text-body text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> Run database migration 101 to start the activity log.
        </p>
      ) : data.entries.length === 0 ? (
        <p className="p-4 text-body text-[var(--text-tertiary)]">Nothing yet. Plan changes, credit adjustments, suspensions and notes show up here.</p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {data.entries.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-body text-[var(--text-primary)]">{describeAudit(e)}</p>
                <p className="text-caption text-[var(--text-tertiary)] truncate">
                  {e.target_user_id
                    ? <Link to={`/admin/accounts/${e.target_user_id}`} className="hover:underline text-[var(--text-secondary)]">{e.target_email || e.target_user_id}</Link>
                    : 'Platform'}
                  {' · by '}{e.actor_email}
                </p>
              </div>
              <span className="shrink-0 text-caption text-[var(--text-tertiary)] tabular">{formatDateTime(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

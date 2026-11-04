import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@lemlist/shared';
import { Activity, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { keepPrevious } from '../../lib/listQuery';
import { developerApi } from '../../api/developer.api';
import { Segmented } from '../../components/ui/Segmented';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { Refreshing } from '../../components/ui/Refreshing';
import { EmptyState } from '../../components/shared/EmptyState';
import { InlineError } from '../../components/ui/AsyncPanel';

/** Which tool made the request, from its User-Agent: the first thing anyone asks of a log. */
function caller(ua: string | null): string {
  const s = (ua || '').toLowerCase();
  if (s.includes('zapier')) return 'Zapier';
  if (s.includes('integromat') || s.includes('make')) return 'Make';
  if (s.includes('n8n')) return 'n8n';
  if (s.includes('curl')) return 'curl';
  if (s.includes('python')) return 'Python';
  if (s.includes('node') || s.includes('undici') || s.includes('axios')) return 'Node.js';
  if (s.includes('postman')) return 'Postman';
  if (s.includes('mozilla')) return 'Browser';
  return ua ? 'Other' : '';
}

export function RequestLog() {
  const [filter, setFilter] = useState<'all' | 'errors'>('all');
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['api-request-log', filter],
    queryFn: () => developerApi.requestLog({ errorsOnly: filter === 'errors' }),
    refetchInterval: 15_000,
    ...keepPrevious,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-[var(--text-secondary)]">
          Every call made with your API keys in the last 14 days, newest first. Quote a request id if you ask us about one.
        </p>
        <div className="flex items-center gap-2">
          <Segmented size="sm" label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'errors', label: 'Errors' }]} />
          <button type="button" aria-label="Refresh" onClick={() => refetch()} className="icon-btn">
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {data && !data.setup_needed && (
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div className="rounded-lg border border-[var(--border-subtle)] p-3">
            <p className="text-caption text-[var(--text-tertiary)]">Requests, last 24 hours</p>
            <p className="text-title font-semibold text-[var(--text-primary)] tabular-nums">{data.last_day.requests.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] p-3">
            <p className="text-caption text-[var(--text-tertiary)]">Errors, last 24 hours</p>
            <p className={cn('text-title font-semibold tabular-nums', data.last_day.errors ? 'text-rose-700 dark:text-rose-300' : 'text-[var(--text-primary)]')}>{data.last_day.errors.toLocaleString()}</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Spinner /></div>
      ) : isError ? (
        <InlineError error={error} onRetry={() => refetch()} />
      ) : data?.setup_needed ? (
        <EmptyState icon={Activity} title="The request log is still being switched on" description="It starts recording as soon as the latest database update has been run." />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState icon={Activity} title={filter === 'errors' ? 'No errors' : 'No requests yet'} description={filter === 'errors' ? 'Nothing has failed recently.' : 'Calls to the API show up here within a few seconds.'} />
      ) : (
        <Refreshing active={isFetching && !isLoading}>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] divide-y divide-[var(--border-subtle)] overflow-hidden">
            {data.rows.map((r) => (
              <div key={r.id} className="px-3 py-2 grid gap-x-3 gap-y-0.5 grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[52px_minmax(0,1fr)_auto_auto] items-center text-body">
                <Badge size="sm" variant={r.status < 300 ? 'success' : r.status < 500 ? 'warning' : 'danger'} className="font-mono justify-center">{r.status}</Badge>
                <div className="min-w-0">
                  <p className="truncate font-mono text-[var(--text-primary)]"><span className="text-[var(--text-tertiary)]">{r.method}</span> {r.path}</p>
                  <p className="truncate text-caption text-[var(--text-tertiary)]">
                    {[r.error_code, r.key_name ? `key "${r.key_name}"` : null, caller(r.user_agent), r.request_id].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="hidden sm:inline text-caption text-[var(--text-tertiary)] tabular-nums text-right">{r.duration_ms} ms</span>
                <span className="text-caption text-[var(--text-tertiary)] text-right whitespace-nowrap">{formatDateTime(r.created_at)}</span>
              </div>
            ))}
          </div>
        </Refreshing>
      )}
    </div>
  );
}

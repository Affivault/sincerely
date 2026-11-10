import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, ExternalLink, Loader2, MinusCircle, RefreshCw, Send, XCircle } from 'lucide-react';
import type { CrmContactStatus } from '@lemlist/shared';
import { integrationsApi } from '../../api/integrations.api';
import { cn, formatRelativeTime } from '../../lib/utils';

const NAME = { hubspot: 'HubSpot', pipedrive: 'Pipedrive' } as const;
const DEAL_LABEL: Record<string, string> = { open: 'Open', won: 'Won', lost: 'Lost' };

/**
 * Where this person stands in each connected CRM: in it or not, a link to
 * the record and their deal, what last moved, and a button to sync them now.
 * Renders nothing when no CRM is connected.
 */
export function CrmContactPanel({ contactId, hasEmail }: { contactId: string; hasEmail: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['crm-contact', contactId],
    queryFn: () => integrationsApi.sync.contactStatus(contactId),
    staleTime: 30_000,
    retry: false,
  });

  const sync = useMutation({
    mutationFn: (s: CrmContactStatus) => integrationsApi.sync.syncContact(s.integration_id, contactId),
    onSuccess: (fresh, s) => {
      queryClient.setQueryData(['crm-contact', contactId], (old: CrmContactStatus[] | undefined) =>
        (old || []).map((x) => (x.integration_id === s.integration_id && fresh ? fresh : x)));
      // Their fields may have changed from the CRM.
      queryClient.invalidateQueries({ queryKey: ['contacts', contactId] });
      toast.success(s.linked ? `Synced with ${NAME[s.provider]}` : `Added to ${NAME[s.provider]}`);
    },
    onError: (err: any, s) => toast.error(err?.response?.data?.error || `Could not sync with ${NAME[s.provider]}`),
  });

  if (!data || data.length === 0) return null;

  return (
    <div className="record-section">
      <h2 className="text-caption font-bold text-[var(--text-tertiary)] mb-2.5">CRM</h2>
      <div className="space-y-3">
        {data.map((s) => {
          const crm = NAME[s.provider];
          const busy = sync.isPending && sync.variables?.integration_id === s.integration_id;
          return (
            <div key={s.integration_id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-body font-medium text-[var(--text-primary)]">
                  <span className={cn('h-1.5 w-1.5 rounded-full', s.linked ? 'bg-[var(--success)]' : 'bg-[var(--text-tertiary)]')} />
                  {s.linked ? `In ${crm}` : `Not in ${crm}`}
                </span>
                {s.url && (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-caption font-medium text-[var(--indigo-text)] hover:underline">
                    Open in {crm} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {s.linked && s.synced_at && (
                <p className="text-caption text-[var(--text-tertiary)]">Synced {formatRelativeTime(s.synced_at)}</p>
              )}
              {s.deal && (
                <p className="text-caption text-[var(--text-secondary)]">
                  Deal: <span className="font-medium">{DEAL_LABEL[s.deal.status || ''] || s.deal.status || 'Open'}</span>
                  {s.deal.url && (
                    <> · <a href={s.deal.url} target="_blank" rel="noopener noreferrer" className="text-[var(--indigo-text)] hover:underline">open deal</a></>
                  )}
                </p>
              )}
              {s.recent.length > 0 && (
                <ul className="space-y-0.5">
                  {s.recent.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-caption text-[var(--text-secondary)]">
                      {r.status === 'ok' ? <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0 text-[var(--success)]" />
                        : r.status === 'failed' ? <XCircle className="h-3 w-3 mt-0.5 shrink-0 text-[var(--error)]" />
                          : <MinusCircle className="h-3 w-3 mt-0.5 shrink-0 text-[var(--text-tertiary)]" />}
                      <span className="min-w-0 break-words">{r.summary} <span className="text-[var(--text-tertiary)]">· {formatRelativeTime(r.created_at)}</span></span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-3 pt-0.5">
                <button
                  type="button"
                  onClick={() => sync.mutate(s)}
                  disabled={busy || !hasEmail}
                  title={hasEmail ? undefined : `An email address is needed to match them in ${crm}`}
                  className="inline-flex items-center gap-1.5 text-caption font-semibold text-[var(--indigo-text)] hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : s.linked ? <RefreshCw className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                  {busy ? 'Syncing…' : s.linked ? 'Sync now' : `Send to ${crm}`}
                </button>
                <Link to={`/integrations/${s.integration_id}/sync`} className="text-caption text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                  Sync settings
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

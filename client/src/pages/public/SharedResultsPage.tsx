import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2, Printer } from 'lucide-react';
import { publicResultsApi } from '../../api/results.api';
import { ResultsView } from '../../components/results/ResultsView';
import { PublicShell } from './PublicShell';

/**
 * The page a shared results link opens: the report and nothing else.
 * No sidebar, no login, no links into an account the viewer cannot open.
 */
export function SharedResultsPage() {
  const { token = '' } = useParams();
  const q = useQuery({
    queryKey: ['shared-results', token],
    queryFn: () => publicResultsApi.open(token),
    retry: false,
    staleTime: 5 * 60_000,
  });

  if (q.isLoading) {
    return (
      <PublicShell footer="Results by Sincerely">
        <div className="flex items-center justify-center py-20 text-[var(--text-tertiary)]"><Loader2 className="h-5 w-5 animate-spin" /></div>
      </PublicShell>
    );
  }
  if (q.isError || !q.data) {
    return (
      <PublicShell footer="Results by Sincerely">
        <div className="py-16 text-center" data-state="error">
          <AlertCircle className="mx-auto h-8 w-8 text-[var(--text-tertiary)]" />
          <h1 className="mt-3 text-title font-semibold text-[var(--text-primary)]">This link is not available</h1>
          <p className="mx-auto mt-1 max-w-sm text-strong text-[var(--text-secondary)]">It may have been switched off. Ask whoever sent it for a new one.</p>
        </div>
      </PublicShell>
    );
  }
  const d = q.data;
  return (
    <PublicShell wide bare footer="Results by Sincerely">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-[var(--text-primary)]" data-shared-title>{d.title}</h1>
          {d.prepared_by && <p className="mt-0.5 text-body text-[var(--text-tertiary)]">From {d.prepared_by}</p>}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] print:hidden"
        >
          <Printer className="h-3.5 w-3.5" /> Print or save as PDF
        </button>
      </div>
      <ResultsView report={d.report} linkCampaigns={false} />
    </PublicShell>
  );
}

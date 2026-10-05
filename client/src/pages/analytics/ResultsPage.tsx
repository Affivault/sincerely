import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Copy, Eye, Link2, Share2, Trophy, X } from 'lucide-react';
import { RESULTS_PERIODS, RESULTS_PERIOD_LABELS, type ResultsPeriodKey, type ResultsShare } from '@lemlist/shared';
import { resultsApi, sharedResultsUrl } from '../../api/results.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Toggle } from '../../components/ui/Toggle';
import { ResultsView } from '../../components/results/ResultsView';
import { formatRelativeTime } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Results - what the outreach produced, for a period, said plainly and
   ready to hand to whoever asks. The detail behind it lives on Revenue.
   ═══════════════════════════════════════════════════════════════════════ */

function isPeriod(v: string | null): v is ResultsPeriodKey {
  return !!v && (RESULTS_PERIODS as readonly string[]).includes(v);
}

export function ResultsPage() {
  const [params, setParams] = useSearchParams();
  const period: ResultsPeriodKey = isPeriod(params.get('period')) ? (params.get('period') as ResultsPeriodKey) : 'this_month';
  const [sharing, setSharing] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['results', period],
    queryFn: () => resultsApi.report(period),
    staleTime: 60_000,
  });

  return (
    <>
      <PageHeader
        icon={Trophy}
        title="Results"
        description="What your outreach produced - meetings, pipeline and revenue - and how it compares."
        actions={
          <Button variant="secondary" onClick={() => setSharing(true)} disabled={!data}>
            <Share2 className="h-4 w-4" /> Share
          </Button>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Period">
          {RESULTS_PERIODS.map((p) => (
            <Chip key={p} size="md" active={p === period} onClick={() => setParams((prev) => { const next = new URLSearchParams(prev); next.set('period', p); return next; }, { replace: true })}>
              {RESULTS_PERIOD_LABELS[p]}
            </Chip>
          ))}
        </div>

        {isLoading ? (
          <PageSkeleton variant="panels" bleed={false} />
        ) : isError || !data ? (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3.5 text-body text-rose-700 dark:text-rose-400">
            <span className="flex-1">The results could not be worked out just now.</span>
            <Button size="sm" variant="secondary" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : (
          <ResultsView report={data} />
        )}

        <ShareList />
      </div>

      {sharing && data && (
        <ShareDialog period={period} periodLabel={`${data.period.label}${data.period.partial ? ' so far' : ''}`} onClose={() => setSharing(false)} />
      )}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => toast.error('Copy did not work - select the link instead'));
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  );
}

function ShareDialog({ period, periodLabel, onClose }: { period: ResultsPeriodKey; periodLabel: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(`Results - ${periodLabel.replace(/ so far$/, '')}`);
  const [showCampaigns, setShowCampaigns] = useState(true);
  const create = useMutation({
    mutationFn: () => resultsApi.share({ period, title, show_campaigns: showCampaigns }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['results', 'shares'] }),
    onError: (err: any) => toast.error(err?.response?.data?.error || 'The link could not be made.'),
  });
  const url = create.data ? sharedResultsUrl(create.data.token) : null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Share these results"
      description={`A read-only page for ${periodLabel}. No login needed, and nothing else in your account is visible.`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{url ? 'Done' : 'Cancel'}</Button>
          {!url && <Button onClick={() => create.mutate()} disabled={create.isPending || !title.trim()}><Link2 className="h-4 w-4" /> Make link</Button>}
        </div>
      }
    >
      {url ? (
        <div className="space-y-3" data-share-made>
          <div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-caption text-[var(--text-secondary)]">{url}</span>
            <CopyButton text={url} />
          </div>
          <p className="text-caption text-[var(--text-tertiary)]">
            {period.startsWith('this') ? 'It fills in as the period goes on, then stays as it ended. ' : 'It stays fixed to this period. '}
            You can switch it off any time from the Results page.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          <label className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border-subtle)] px-3 py-2.5">
            <span>
              <span className="block text-body font-medium text-[var(--text-primary)]">Show campaign names</span>
              <span className="block text-caption text-[var(--text-tertiary)]">Off shows only the totals - useful when names are internal.</span>
            </span>
            <Toggle checked={showCampaigns} onChange={setShowCampaigns} aria-label="Show campaign names" />
          </label>
          <p className="text-caption text-[var(--text-tertiary)]">The page never shows who was emailed, their replies, or anything from your inbox.</p>
        </div>
      )}
    </Modal>
  );
}

function ShareList() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['results', 'shares'], queryFn: resultsApi.shares, staleTime: 30_000 });
  const revoke = useMutation({
    mutationFn: resultsApi.revoke,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['results', 'shares'] }); toast.success('Link switched off'); },
  });
  if (!data || data.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-results-shares>
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <p className="text-strong font-semibold text-[var(--text-primary)]">Shared links</p>
      </div>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {data.map((s: ResultsShare) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
            <div className="min-w-[12rem] flex-1">
              <p className="truncate text-body font-medium text-[var(--text-primary)]">{s.title}</p>
              <p className="text-caption text-[var(--text-tertiary)]">
                {s.period_label}{!s.show_campaigns && ' · totals only'} · made {formatRelativeTime(s.created_at)}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-caption text-[var(--text-tertiary)]" title={s.last_viewed_at ? `Last opened ${formatRelativeTime(s.last_viewed_at)}` : 'Not opened yet'}>
              <Eye className="h-3.5 w-3.5" /> {s.views}
            </span>
            <CopyButton text={sharedResultsUrl(s.token)} />
            <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending} aria-label={`Switch off ${s.title}`}>
              <X className="h-3.5 w-3.5" /> Switch off
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Standing searches: a search that keeps working after you close the tab.

   Save the filters once, pick a campaign and a daily cap, and every day
   (or weekday, or week) new matches are revealed, verified and enrolled -
   with the same suppression and open-deal checks as enrolling by hand.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2, Pause, Play, Radar, RefreshCw, Trash2, Zap } from 'lucide-react';
import type { ProspectRule, ProspectRuleCadence, ProspectRuleRunResult, ProspectSearchFilters } from '@lemlist/shared';
import { prospectRulesApi } from '../../api/prospecting.api';
import { campaignsApi } from '../../api/campaigns.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { formatRelativeTime, formatTimeUntil } from '../../lib/utils';

function summary(f: ProspectSearchFilters): string {
  const bits = [
    ...(f.titles || []), ...(f.seniorities || []), ...(f.industries || []),
    ...(f.locations || []), ...(f.companySizes || []).map((s) => `${s} people`), ...(f.companies || []),
  ];
  if (f.keywords) bits.push(`"${f.keywords}"`);
  return bits.slice(0, 6).join(' · ') || 'Any';
}

function stopped(r: ProspectRuleRunResult): string {
  switch (r.stopped) {
    case 'cap': return 'daily cap reached';
    case 'exhausted': return 'no more new matches';
    case 'no_credits': return 'out of prospect credits';
    case 'no_provider': return 'no data provider configured';
    default: return r.error ? `error: ${r.error}` : 'error';
  }
}

/** "Keep this search running" - the dialog behind the button on the Prospector. */
export function SaveStandingSearch({ filters, open, onClose }: { filters: ProspectSearchFilters; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [cap, setCap] = useState(10);
  const [cadence, setCadence] = useState<ProspectRuleCadence>('weekdays');
  const { data: campaigns } = useQuery({
    queryKey: ['campaigns', 'for-rules'],
    queryFn: () => campaignsApi.list({ limit: 100 }),
    enabled: open,
  });
  const live = (campaigns?.data || []).filter((c: any) => ['draft', 'scheduled', 'running', 'paused'].includes(c.status));

  const save = useMutation({
    mutationFn: () => prospectRulesApi.create({
      name: name.trim() || summary(filters).slice(0, 60),
      filters, campaign_id: campaignId || null, daily_cap: cap, cadence,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospect-rules'] });
      toast.success('Standing search saved - it runs within the hour');
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not save the search'),
  });

  const input = 'mt-1 w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-body text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none';
  return (
    <Modal isOpen={open} onClose={onClose} title="Keep this search running">
      <div className="space-y-3">
        <p className="text-body text-[var(--text-secondary)]">
          New people matching <span className="font-medium text-[var(--text-primary)]">{summary(filters)}</span> are revealed,
          verified, and added to a campaign automatically. Each reveal uses one prospect credit.
        </p>
        <label className="block text-caption font-medium text-[var(--text-secondary)]">Name
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={summary(filters).slice(0, 60)} />
        </label>
        <label className="block text-caption font-medium text-[var(--text-secondary)]">Add them to
          <select className={input} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <option value="">Just save the contacts</option>
            {live.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-caption font-medium text-[var(--text-secondary)]">At most per run
            <input type="number" min={1} max={200} className={input} value={cap} onChange={(e) => setCap(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
          </label>
          <label className="block text-caption font-medium text-[var(--text-secondary)]">How often
            <select className={input} value={cadence} onChange={(e) => setCadence(e.target.value as ProspectRuleCadence)}>
              <option value="daily">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
        </div>
        <p className="text-caption text-[var(--text-tertiary)]">
          Addresses that fail verification are kept out, and everyone goes through the usual checks: suppression list, open deals, bounces.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Start
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function StandingSearches() {
  const qc = useQueryClient();
  const { data: rules, isError, error } = useQuery({ queryKey: ['prospect-rules'], queryFn: prospectRulesApi.list, retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['prospect-rules'] });
  const toggle = useMutation({
    mutationFn: (r: ProspectRule) => prospectRulesApi.update(r.id, { is_active: !r.is_active }),
    onSuccess: refresh,
  });
  const run = useMutation({
    mutationFn: (id: string) => prospectRulesApi.run(id),
    onSuccess: (r) => { refresh(); qc.invalidateQueries({ queryKey: ['prospecting', 'status'] }); toast.success(`Revealed ${r.revealed}, added ${r.enrolled} (${stopped(r)})`); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Run failed'),
  });
  const remove = useMutation({ mutationFn: (id: string) => prospectRulesApi.remove(id), onSuccess: refresh });

  if (isError) {
    const msg = (error as any)?.response?.data?.error;
    return msg ? <p className="text-caption text-[var(--text-tertiary)]">{msg}</p> : null;
  }
  if (!rules || rules.length === 0) return null;

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-strong font-semibold text-[var(--text-primary)]">
        <Radar className="h-4 w-4 text-[var(--indigo)]" /> Standing searches
      </h3>
      <ul className="divide-y divide-[var(--border-subtle)]">
        {rules.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-[var(--text-primary)]">
                {r.name}
                {!r.is_active && <span className="ml-2 text-caption font-normal text-[var(--text-tertiary)]">paused</span>}
              </p>
              <p className="truncate text-caption text-[var(--text-tertiary)]">
                {summary(r.filters)} · up to {r.daily_cap} {r.cadence === 'weekly' ? 'a week' : r.cadence === 'weekdays' ? 'each weekday' : 'a day'}
                {r.campaign ? <> · into <Link to={`/campaigns/${r.campaign.id}`} className="hover:underline">{r.campaign.name}</Link></> : ' · contacts only'}
              </p>
              <p className="text-caption text-[var(--text-tertiary)]">
                {r.total_enrolled.toLocaleString()} added so far
                {r.last_result && r.last_run_at && <> · last run {formatRelativeTime(r.last_run_at)}: {r.last_result.enrolled} added, {stopped(r.last_result)}</>}
                {r.is_active && <> · next {formatTimeUntil(r.next_run_at)}</>}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button className="icon-btn h-8 w-8" title="Run now" disabled={run.isPending} onClick={() => run.mutate(r.id)}>
                {run.isPending && run.variables === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              <button className="icon-btn h-8 w-8" title={r.is_active ? 'Pause' : 'Resume'} onClick={() => toggle.mutate(r)}>
                {r.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button className="icon-btn h-8 w-8 hover:text-rose-500" title="Delete" onClick={() => remove.mutate(r.id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

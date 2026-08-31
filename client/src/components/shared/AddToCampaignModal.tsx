import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { campaignsApi } from '../../api/campaigns.api';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { SearchInput } from './SearchInput';
import { cn } from '../../lib/utils';
import { Megaphone, Plus, Check, Users, PlayCircle, PauseCircle, PencilLine, CalendarClock } from 'lucide-react';
import { EnrolResultDialog } from '../campaigns/EnrolResultDialog';
import type { EnrolResult } from '@lemlist/shared';

const STATUS_META: Record<string, { label: string; icon: typeof PlayCircle; cls: string }> = {
  running: { label: 'Running', icon: PlayCircle, cls: 'text-emerald-600 dark:text-emerald-400' },
  draft: { label: 'Draft', icon: PencilLine, cls: 'text-[var(--text-tertiary)]' },
  scheduled: { label: 'Scheduled', icon: CalendarClock, cls: 'text-sky-600 dark:text-sky-400' },
  paused: { label: 'Paused', icon: PauseCircle, cls: 'text-amber-600 dark:text-amber-400' },
};

/**
 * The funnel-closer: pick a campaign, and the selected leads are added to its
 * bound list AND enrolled in one call. Usable from the contacts list,
 * the contact page, and the prospector.
 */
export function AddToCampaignModal({
  contactIds, onClose, onDone,
}: {
  contactIds: string[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState<{ result: EnrolResult; name: string } | null>(null);

  const { data: campaignsPage, isLoading } = useQuery({
    queryKey: ['campaigns', 'for-enroll'],
    queryFn: () => campaignsApi.list({ limit: 500 }),
  });

  // Finished campaigns can't take new leads.
  const activeCampaigns = (campaignsPage?.data || []).filter(
    (c: any) => !['completed', 'cancelled'].includes(c.status),
  );
  const campaigns = search.trim()
    ? activeCampaigns.filter((c: any) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : activeCampaigns;

  /*
   * The old version of this guessed. It said "skipped (already in other
   * active campaigns)" for every skip regardless of cause, because the
   * server only ever sent a bare number — which meant it was confidently
   * wrong whenever the real reason was a suppression, a missing address or
   * a list the contacts were not on.
   */
  const enroll = useMutation({
    mutationFn: (campaignId: string) => campaignsApi.enrollContacts(campaignId, contactIds),
    onSuccess: (result, campaignId) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['lists'] });
      const name = activeCampaigns.find((c: any) => c.id === campaignId)?.name || 'campaign';
      onDone?.();
      if (result.skipped > 0) {
        // Held open on the result rather than closed behind a toast: a
        // number nobody can inspect is a number nobody believes.
        setOutcome({ result, name });
        return;
      }
      toast.success(
        `${result.added.toLocaleString()} lead${result.added === 1 ? '' : 's'} added to “${name}”`,
      );
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to add to campaign'),
  });

  if (outcome) {
    return (
      <EnrolResultDialog
        result={outcome.result}
        campaignName={outcome.name}
        onClose={() => { setOutcome(null); onClose(); }}
      />
    );
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Add ${contactIds.length} lead${contactIds.length === 1 ? '' : 's'} to a campaign`}
      description="They join the campaign's list and are enrolled immediately."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!selectedId || enroll.isPending}
            onClick={() => selectedId && enroll.mutate(selectedId)}
          >
            {enroll.isPending ? 'Adding…' : <><Megaphone className="h-3.5 w-3.5" /> Add to campaign</>}
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner size="md" /></div>
      ) : activeCampaigns.length === 0 ? (
        <div className="py-8 text-center">
          <Megaphone className="h-7 w-7 text-[var(--text-muted)] mx-auto mb-2" />
          <p className="text-[13px] font-medium text-[var(--text-primary)]">No active campaigns yet</p>
          <p className="text-[12px] text-[var(--text-tertiary)] mt-1 mb-4">Create one and these leads will be waiting.</p>
          <Button onClick={() => { onClose(); navigate('/campaigns/new'); }}>
            <Plus className="h-3.5 w-3.5" /> New campaign
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {activeCampaigns.length > 8 && (
            <SearchInput value={search} onChange={setSearch} placeholder="Search campaigns…" />
          )}
          {campaigns.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--text-tertiary)]">No campaigns match “{search}”.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto -mx-1 px-1">
              {campaigns.map((c: any) => {
                const meta = STATUS_META[c.status] || STATUS_META.draft;
                const Icon = meta.icon;
                const active = selectedId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      active
                        ? 'border-[var(--indigo)]/40 bg-[var(--indigo-subtle)]/50'
                        : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]',
                    )}
                  >
                    <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0', active ? 'bg-[var(--indigo-subtle)]' : 'bg-[var(--bg-elevated)]')}>
                      <Megaphone className={cn('h-3.5 w-3.5', active ? 'text-[var(--indigo)]' : 'text-[var(--text-tertiary)]')} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-[var(--text-primary)] truncate">{c.name}</span>
                      <span className="flex items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
                        <span className={cn('inline-flex items-center gap-1 font-medium', meta.cls)}><Icon className="h-3 w-3" />{meta.label}</span>
                        <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{c.total_contacts ?? 0} enrolled</span>
                      </span>
                    </span>
                    {active && <Check className="h-4 w-4 text-[var(--indigo)] flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
          <button
            onClick={() => { onClose(); navigate('/campaigns/new'); }}
            className="w-full flex items-center gap-3 rounded-xl border border-dashed border-[var(--border-default)] px-3 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-elevated)] flex-shrink-0"><Plus className="h-3.5 w-3.5 text-[var(--text-tertiary)]" /></span>
            <span className="text-[13px] font-medium text-[var(--text-secondary)]">Create a new campaign instead…</span>
          </button>
        </div>
      )}
    </Modal>
  );
}

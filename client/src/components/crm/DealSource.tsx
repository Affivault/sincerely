import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Pencil, X, Check, Loader2 } from 'lucide-react';
import { ATTRIBUTION_LABEL, type Attribution } from '@lemlist/shared';
import { crmApi } from '../../api/crm.api';
import { campaignsApi } from '../../api/campaigns.api';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   Where this deal came from.

   A deal that cannot say what produced it is the reason attribution reports
   go unread: the total on the campaign page is unarguable-with, because the
   deals behind it are anonymous. Here the credit is on the record itself,
   named, with its strength shown and a way to correct it.

   Correcting is important rather than decorative. The automatic rules are
   evidence-based and will sometimes be wrong - a deal that really came from
   a conference, or from the sequence before the one they last replied to -
   and a number nobody can fix is a number nobody trusts.
   ═══════════════════════════════════════════════════════════════════════ */

/** Weak evidence looks weak. Strong evidence does not shout either. */
const TONE: Record<Attribution, string> = {
  thread: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/12',
  reply: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/12',
  manual: 'text-[var(--text-secondary)] bg-[var(--bg-elevated)]',
  enrolment: 'text-amber-700 dark:text-amber-400 bg-amber-500/10',
};

const HINT: Record<Attribution, string> = {
  thread: 'This deal was created from a thread belonging to that campaign.',
  reply: 'They replied to that campaign before this deal existed.',
  manual: 'Somebody set this by hand.',
  enrolment: 'They were in that campaign but never replied to it — this may not be the real source.',
};

export function DealSource({ deal }: { deal: any }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<string>(deal.source_campaign_id || '');

  // Only fetched once somebody opens the editor: most people reading a deal
  // never touch this, and the list is not free.
  const { data: campaigns, isLoading: loadingCampaigns } = useQuery({
    queryKey: ['campaigns', 'for-attribution'],
    queryFn: () => campaignsApi.list({ limit: 500 }),
    enabled: editing,
  });

  const save = useMutation({
    mutationFn: (campaignId: string | null) =>
      crmApi.updateDeal(deal.id, {
        source_campaign_id: campaignId,
        // The step belonged to the old credit. Keeping it would point at a
        // step of a campaign this deal is no longer attributed to.
        source_step_id: null,
      } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      qc.invalidateQueries({ queryKey: ['analytics', 'revenue'] });
      setEditing(false);
      toast.success('Source updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not update the source'),
  });

  const attribution = (deal.attribution || null) as Attribution | null;
  const campaignName = deal.source_campaign?.name || deal.source_campaign_name || null;

  return (
    <div className="panel p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-bold text-[var(--text-tertiary)]">Came from</h2>
        {!editing && (
          <button
            onClick={() => { setChoice(deal.source_campaign_id || ''); setEditing(true); }}
            className="icon-btn h-6 w-6"
            title={attribution ? 'Correct this' : 'Credit a campaign'}
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          {loadingCampaigns ? (
            <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-tertiary)]">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading campaigns…
            </p>
          ) : (
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="w-full h-8 px-2 text-[12.5px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--indigo)]"
            >
              <option value="">No campaign — this did not come from outreach</option>
              {(campaigns?.data || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <p className="text-[10.5px] leading-snug text-[var(--text-tertiary)]">
            Setting this by hand records it as “{ATTRIBUTION_LABEL.manual}”, rather than claiming
            a reply that did not happen.
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => save.mutate(choice || null)}
              disabled={save.isPending}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-[var(--indigo)] text-white text-[11.5px] font-semibold disabled:opacity-50"
            >
              {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="h-7 px-2.5 rounded-md text-[11.5px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : attribution && deal.source_campaign_id ? (
        <div className="space-y-1.5">
          <Link
            to={`/analytics/revenue/${deal.source_campaign_id}`}
            className="flex items-center gap-2 rounded-[6px] bg-[var(--bg-elevated)] px-2.5 h-8 transition-colors hover:bg-[var(--bg-hover)]"
          >
            <Megaphone className="h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)]" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-primary)]">
              {campaignName || 'A campaign'}
            </span>
          </Link>
          <span
            title={HINT[attribution]}
            className={cn(
              'inline-flex items-center px-1.5 h-[19px] rounded-md text-[10.5px] font-semibold',
              TONE[attribution],
            )}
          >
            {ATTRIBUTION_LABEL[attribution]}
          </span>
          {attribution === 'enrolment' && (
            <p className="text-[10.5px] leading-snug text-[var(--text-tertiary)]">
              They never replied to it, so this credit is a guess. Correct it if you know better.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[12px] text-[var(--text-tertiary)]">Not from a campaign.</p>
          <p className="text-[10.5px] leading-snug text-[var(--text-muted)]">
            Deals are credited automatically when they come out of a reply. Set it by hand if this
            one did and the link was missed.
          </p>
        </div>
      )}

      {attribution && deal.source_campaign_id && !editing && (
        <button
          onClick={() => save.mutate(null)}
          disabled={save.isPending}
          className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-medium text-[var(--text-tertiary)] hover:text-rose-500 disabled:opacity-50"
        >
          <X className="h-2.5 w-2.5" /> Clear this credit
        </button>
      )}
    </div>
  );
}

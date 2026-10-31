import { Link } from 'react-router-dom';
import { LIFECYCLE_LABEL, LEAD_OUTREACH_HINT, LEAD_OUTREACH_LABEL } from '@lemlist/shared';
import type { Lifecycle, LeadOutreach, OutreachSummary } from '@lemlist/shared';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Who somebody is, said the same way everywhere they appear.

   Leads and Contacts are two pages, but a person also turns up on a
   company, in the peek and on their own profile. Each of those has to say
   the same three things the tables say: lead or contact (or customer),
   where they stand in outreach, and which lists hold them.
   ═══════════════════════════════════════════════════════════════════════ */

const STAGE_TONE: Record<Lifecycle, string> = {
  prospect: 'text-teal-700 dark:text-teal-300 bg-teal-500/12',
  contact: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/12',
  customer: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/12',
};

export const OUTREACH_TONE: Record<LeadOutreach, string> = {
  none: 'text-[var(--text-tertiary)] bg-[var(--bg-elevated)]',
  queued: 'text-slate-600 dark:text-slate-300 bg-slate-500/12',
  in_sequence: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/12',
  finished: 'text-amber-700 dark:text-amber-400 bg-amber-500/10',
  replied: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/12',
};

const pill = 'inline-flex flex-shrink-0 items-center px-1.5 h-[20px] rounded-md text-micro font-semibold whitespace-nowrap';

export function StagePill({ lifecycle, className }: { lifecycle?: Lifecycle | null; className?: string }) {
  const stage = (lifecycle || 'prospect') as Lifecycle;
  return (
    <span
      className={cn(pill, STAGE_TONE[stage], className)}
      title={stage === 'prospect' ? 'A lead: lives on the Leads page, can be sent cold campaigns' : 'In your CRM: lives on the Contacts page'}
    >
      {LIFECYCLE_LABEL[stage]}
    </span>
  );
}

/** Outreach state, with the campaign it was read from when there is one. */
export function OutreachPill({ outreach, withCampaign = false }: { outreach?: OutreachSummary | null; withCampaign?: boolean }) {
  if (!outreach) return null;
  const detail = outreach.campaign_name
    ? `${outreach.campaign_name}${outreach.step != null ? ` · step ${outreach.step + 1}` : ''}${outreach.campaigns > 1 ? ` · +${outreach.campaigns - 1} more` : ''}`
    : null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={LEAD_OUTREACH_HINT[outreach.state]}>
      <span className={cn(pill, OUTREACH_TONE[outreach.state])}>{LEAD_OUTREACH_LABEL[outreach.state]}</span>
      {withCampaign && detail && outreach.campaign_id && (
        <Link
          to={`/campaigns/${outreach.campaign_id}`}
          onClick={(e) => e.stopPropagation()}
          className="truncate text-caption text-[var(--text-tertiary)] hover:text-[var(--indigo-text)] hover:underline"
        >
          {detail}
        </Link>
      )}
    </span>
  );
}

export interface ListRef { id: string; name: string; kind?: 'lead' | 'contact' | null; color?: string | null }

/** The lists somebody is in, each linking to that list on its own page. */
export function ListChips({ lists, max = 3 }: { lists?: ListRef[] | null; max?: number }) {
  if (!lists || lists.length === 0) return null;
  const shown = lists.slice(0, max);
  const rest = lists.length - shown.length;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((l) => (
        <Link
          key={l.id}
          to={`/${l.kind === 'contact' ? 'contacts' : 'leads'}?list=${l.id}`}
          onClick={(e) => e.stopPropagation()}
          title={`${l.kind === 'contact' ? 'Contact' : 'Lead'} list`}
          className="inline-flex max-w-[160px] items-center gap-1 h-[20px] px-1.5 rounded-md border border-[var(--border-subtle)] text-micro font-medium text-[var(--text-secondary)] hover:border-[var(--indigo)]/40 hover:text-[var(--indigo-text)] transition-colors"
        >
          <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: l.color || 'var(--text-tertiary)' }} />
          <span className="truncate">{l.name}</span>
        </Link>
      ))}
      {rest > 0 && <span className="text-micro text-[var(--text-tertiary)]">+{rest}</span>}
    </span>
  );
}

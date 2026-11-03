import { StagePill, OutreachPill, ListChips } from '../contacts/PersonBadges';
import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contactsApi } from '../../api/contacts.api';
import { companiesApi } from '../../api/companies.api';
import { crmApi } from '../../api/crm.api';
import { inboxApi } from '../../api/inbox.api';
import { analyticsApi } from '../../api/analytics.api';
import { Avatar } from '../shared/Avatar';
import { Spinner } from '../ui/Spinner';
import { InlineEdit, InlineSelect } from '../ui/InlineEdit';
import { COMPANY_SIZE_OPTIONS } from '../../lib/constants';
import { ContactHistory } from '../crm/ContactHistory';
import { CompanyLogo } from '../shared/CompanyLogo';
import { cn } from '../../lib/utils';
import { usePeek, getPeekSequence, subscribePeekSequence } from './usePeek';
import { EmailStatusPopover } from '../contacts/EmailStatusPopover';
import { AddToCampaignModal } from '../shared/AddToCampaignModal';
import { isTypingTarget } from '../../lib/keyboard';
import { addRecentItem } from '../../lib/recentItems';
import { openModals } from '../ui/Modal';
import {
  X, ExternalLink, Mail, Building2, Briefcase, Phone, Linkedin, Globe,
  Handshake, ArrowRight, Users, MapPin, Factory, Copy, Check, ChevronUp, ChevronDown, Megaphone, Sparkles, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { type DealStage, formatLongDate, formatMoney, emailState, STATE_LIGHT, CREDIT_PRICES } from '@lemlist/shared';
import { usePipelines } from '../../hooks/usePipelines';
import { OutcomeDialog } from '../crm/OutcomeDialog';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { StandingStrip } from './StandingStrip';

/* ═══════════════════════════════════════════════════════════════════════
   The peek drawer.

   Clicking a person used to cost you the page you were on — your filters,
   your scroll position, your selection. This opens the record over the top
   instead, so checking something is a glance rather than a round trip.
   Mounted once at the app shell so every page gets it for free.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A quick-copy button that reports its own success — no toast needed for
 * something this low-stakes, and it doesn't yank focus out of the drawer.
 */
function CopyRowButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be denied by the browser; nothing useful to
          // recover to, so just leave the icon showing "not copied".
        }
      }}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      className="inline-flex min-h-6 min-w-6 flex-shrink-0 items-center justify-center p-1 rounded text-[var(--text-tertiary)] opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 hover:text-[var(--indigo-text)] transition-opacity"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function Row({ icon: Icon, value, href, copyLabel }: { icon: typeof Mail; value?: string | null; href?: string; copyLabel?: string }) {
  if (!value) return null;
  const body = (
    <span className="flex items-center gap-2 min-w-0">
      <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
      <span className="text-body text-[var(--text-secondary)] truncate">{value}</span>
    </span>
  );
  return (
    <div className="flex items-center gap-2 min-w-0 group/row">
      <span className="flex-1 min-w-0">
        {href
          ? <a href={href} target="_blank" rel="noreferrer" className="block hover:text-[var(--indigo-text)]">{body}</a>
          : body}
      </span>
      {copyLabel ? <CopyRowButton value={value} label={copyLabel} /> : null}
    </div>
  );
}

/**
 * The same row, but the value is the input. Empty fields still render — you
 * can't fill in a phone number that the UI hides because it's blank.
 */
function EditRow({
  icon: Icon, label, value, onSave, type = 'text', href, copyable,
}: {
  icon: typeof Mail;
  label: string;
  value?: string | null;
  onSave: (next: string) => Promise<unknown>;
  type?: 'text' | 'email' | 'url' | 'tel';
  href?: string;
  copyable?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0 group/row">
      <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
      <span className="flex-1 min-w-0">
        <InlineEdit value={value} onSave={onSave} placeholder={label} type={type} ariaLabel={label} />
      </span>
      {copyable && value ? <CopyRowButton value={value} label={label} /> : null}
      {href && value ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          title={`Open ${label}`}
          aria-label={`Open ${label}`}
          className="inline-flex min-h-6 min-w-6 flex-shrink-0 items-center justify-center p-1 rounded text-[var(--text-tertiary)] opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 hover:text-[var(--indigo-text)] transition-opacity"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

const BADGE_TONE: Record<string, string> = {
  green: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10',
  amber: 'text-amber-700 dark:text-amber-400 bg-amber-500/10',
  red: 'text-rose-700 dark:text-rose-400 bg-rose-500/10',
  none: 'text-[var(--text-tertiary)] bg-[var(--bg-elevated)]',
};
const BADGE_DOT: Record<string, string> = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', none: 'bg-slate-400' };
const STATE_SHORT: Record<string, string> = {
  valid: 'Valid', risky: 'Risky', unverified: 'Unverified', invalid: 'Invalid', not_found: 'Not found', bounced: 'Bounced', no_email: 'No email',
};

/** The address's state as a small badge; clicking it explains (EmailStatusPopover). */
function MiniEmailBadge({ c }: { c: any }) {
  const state = emailState(c);
  const light = STATE_LIGHT[state];
  return (
    <span className={cn('inline-flex items-center gap-1.5 h-5 px-1.5 rounded-md text-micro font-semibold flex-shrink-0 hover:brightness-95', BADGE_TONE[light])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', BADGE_DOT[light])} />
      {STATE_SHORT[state]}
    </span>
  );
}

function ContactPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const { openPeek } = usePeek();
  const qc = useQueryClient();
  const [campaignOpen, setCampaignOpen] = useState(false);
  const enrich = useMutation({
    mutationFn: () => contactsApi.enrich(id),
    onSuccess: (r: any) => {
      const n = (r?.filled?.length || 0) + (r?.company_filled?.length || 0);
      toast.success(n ? `Enriched: ${n} field${n === 1 ? '' : 's'} filled in` : 'Enriched - nothing new to add');
      for (const k of ['contacts', 'contact-timeline', 'verification-breakdown', 'companies']) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not enrich'),
  });
  const { data: contact, isLoading } = useQuery({
    queryKey: ['contacts', id],
    queryFn: () => contactsApi.get(id),
  });

  // One saver for every field: patch, refresh, and let InlineEdit roll the
  // value back itself if the request is rejected.
  const save = async (patch: Record<string, string | null>) => {
    try {
      await contactsApi.update(id, patch as any);
      qc.invalidateQueries({ queryKey: ['contacts'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not save that change');
      throw e;
    }
  };
  const field = (key: string) => (next: string) => save({ [key]: next || null });

  // Keyed by id, and apart from the profile page: that reads 100 at a time
  // and pages, this reads one page of 50, and under one key each would
  // overwrite the other's cache entry.
  const { data: emailsPage } = useQuery({
    queryKey: ['contact-emails', id, contact?.email, 'drawer'],
    queryFn: () => inboxApi.list({ contact_id: id, contact_email: contact!.email, limit: 50 }),
    enabled: !!id && !!contact?.email,
  });

  // Anyone opened here shows under "Recent" in the command palette (⌘K).
  useEffect(() => {
    if (!contact) return;
    const label = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email;
    addRecentItem({ type: 'contact', id: contact.id, label, sublabel: [contact.job_title, contact.company].filter(Boolean).join(' · ') || contact.email });
  }, [contact?.id, contact?.first_name, contact?.last_name]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: timeline } = useQuery({
    queryKey: ['contact-timeline', id],
    queryFn: () => analyticsApi.contactTimeline(id),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Spinner size="md" /></div>;
  }
  if (!contact) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-strong font-medium text-[var(--text-primary)]">That contact no longer exists</p>
        <button onClick={onClose} className="mt-2 text-body text-[var(--indigo-text)] hover:underline">Close</button>
      </div>
    );
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  const emails = ((emailsPage?.data || []) as any[])
    .slice()
    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());

  return (
    <>
      {/* Identity */}
      {/* pr-12 clears the absolutely-positioned close button, which otherwise
          sits on top of the right end of the "Full page" link and swallows
          the click that was meant to open the record. */}
      <div className="flex items-start gap-3 px-4 py-4 border-b border-[var(--border-subtle)]">
        <Avatar name={name || contact.email} email={contact.email} size="lg" />
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={name}
            placeholder="Unnamed contact"
            ariaLabel="name"
            textClassName="text-heading font-semibold text-[var(--text-primary)]"
            inputClassName="text-heading font-semibold"
            onSave={(next) => {
              // Everything before the first space is the first name; the rest
              // is the surname, so "van der Berg" survives intact.
              const trimmed = next.trim();
              const cut = trimmed.indexOf(' ');
              return save(cut === -1
                ? { first_name: trimmed || null, last_name: null }
                : { first_name: trimmed.slice(0, cut), last_name: trimmed.slice(cut + 1).trim() || null });
            }}
          />
          <p className="text-body text-[var(--text-tertiary)] truncate">
            {[contact.job_title, contact.company].filter(Boolean).join(' · ') || contact.email}
          </p>
          {/* Lead or contact, where they stand in outreach, and their lists:
              the same three things the Leads and Contacts tables show. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StagePill lifecycle={(contact as any).lifecycle} />
            {((contact as any).lifecycle || 'prospect') === 'prospect' || (contact as any).outreach?.state !== 'none'
              ? <OutreachPill outreach={(contact as any).outreach} />
              : null}
            <ListChips lists={(contact as any).lists} max={2} />
          </div>
        </div>
        <Link
          to={`/contacts/${contact.id}`}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--border-subtle)] text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--indigo-text)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
        >
          <ExternalLink className="h-3 w-3" /> Full page
        </Link>
      </div>

      {/* The things people do from here, without opening the full page. */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5 border-b border-[var(--border-subtle)]" data-peek-actions>
        {((contact as any).lifecycle || 'prospect') === 'prospect' && (
          <button type="button" onClick={() => setCampaignOpen(true)} className="btn-primary">
            <Megaphone className="h-3.5 w-3.5" />
            Add to campaign
          </button>
        )}
        <button
          type="button"
          onClick={() => enrich.mutate()}
          disabled={enrich.isPending}
          className="btn-secondary"
          title={`LinkedIn profile, role, company details and an email check - ${CREDIT_PRICES.enrich} credits, refunded if nothing is found`}
        >
          {enrich.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {enrich.isPending ? 'Enriching...' : 'Enrich'}
        </button>
        <a href={`mailto:${contact.email}`} className="btn-secondary">
          <Mail className="h-3.5 w-3.5" />
          Email
        </a>
      </div>
      {campaignOpen && (
        <AddToCampaignModal contactIds={[contact.id]} onClose={() => setCampaignOpen(false)} />
      )}

      {/* Details */}
      <div className="px-4 py-3 space-y-1.5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-1 min-w-0"><Row icon={Mail} value={contact.email} href={`mailto:${contact.email}`} copyLabel="email" /></span>
          <EmailStatusPopover c={contact as any}><MiniEmailBadge c={contact} /></EmailStatusPopover>
        </div>
        {contact.company_id ? (
          <button
            onClick={() => openPeek('company', contact.company_id!)}
            className="flex items-center gap-2 min-w-0 w-full text-left hover:text-[var(--indigo-text)]"
          >
            <CompanyLogo domain={contact.website} name={contact.company} size="xs" className="!h-3.5 !w-3.5" />
            <span className="text-body text-[var(--text-secondary)] truncate hover:text-[var(--indigo-text)]">{contact.company}</span>
            <ArrowRight className="h-3 w-3 text-[var(--text-tertiary)] flex-shrink-0" />
          </button>
        ) : (
          <EditRow icon={Building2} label="Company" value={contact.company} onSave={field('company')} />
        )}
        <EditRow icon={Briefcase} label="Job title" value={contact.job_title} onSave={field('job_title')} />
        <EditRow icon={Phone} label="Phone" value={contact.phone} onSave={field('phone')} type="tel" copyable />
        <EditRow
          icon={Linkedin}
          label="LinkedIn"
          value={contact.linkedin_url}
          onSave={field('linkedin_url')}
          type="url"
          href={contact.linkedin_url || undefined}
        />
        <EditRow
          icon={Globe}
          label="Website"
          value={contact.website}
          onSave={field('website')}
          type="url"
          href={contact.website || undefined}
        />
      </div>

      <StandingStrip contactId={contact.id} email={contact.email} name={name} />

      {/* The whole relationship, same component the profile page uses */}
      <div className="p-3">
        <ContactHistory
          contactId={contact.id}
          contactName={name}
          contactEmail={contact.email}
          emails={emails}
          campaignActivity={(timeline || []) as any[]}
          hasMoreEmails={(emailsPage?.total ?? 0) > emails.length}
          activityCapped={(timeline || []).length >= 100}
        />
      </div>
    </>
  );
}

function DealPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: deals, isLoading } = useQuery({ queryKey: ['crm', 'deals'], queryFn: () => crmApi.listDeals() });
  const deal = (deals || []).find((d) => d.id === id);
  // Won/lost need a reason, same as the board's drag and the table's
  // dropdown — see DealsPage's moveStage for why this funnel exists.
  const [outcomeStage, setOutcomeStage] = useState<Extract<DealStage, 'won' | 'lost'> | null>(null);

  const pipes = usePipelines();
  const setStage = useMutation({
    // A named stage id: its phase rides along so a closed deal reopens.
    mutationFn: (stageId: string) => {
      const st = pipes.stageById.get(stageId);
      return crmApi.updateDeal(id, { stage: (st?.phase || stageId) as DealStage, stage_id: stageId });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm'] }); toast.success('Stage updated'); },
    onError: () => toast.error('Could not update the stage'),
  });

  const outcomeMutation = useMutation({
    mutationFn: ({ stage, reason }: { stage: DealStage; reason: string | null }) =>
      crmApi.updateDeal(id, { stage, outcome_reason: reason } as any),
    onSuccess: (_data, { stage }) => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success(stage === 'won' ? 'Marked won' : 'Marked lost');
    },
    onError: () => toast.error('Could not update the stage'),
  });

  const changeStage = (stage: string) => {
    if (!deal || stage === deal.stage) return;
    if (stage === 'won' || stage === 'lost') { setOutcomeStage(stage); return; }
    if (deal.stage !== 'won' && deal.stage !== 'lost' && pipes.stageOf(deal)?.id === stage) return;
    setStage.mutate(stage);
  };

  const save = async (patch: Record<string, unknown>) => {
    try {
      await crmApi.updateDeal(id, patch as any);
      qc.invalidateQueries({ queryKey: ['crm'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not save that change');
      throw e;
    }
  };

  if (isLoading) return <div className="flex items-center justify-center py-20"><Spinner size="md" /></div>;
  if (!deal) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-strong font-medium text-[var(--text-primary)]">That deal no longer exists</p>
        <button onClick={onClose} className="mt-2 text-body text-[var(--indigo-text)] hover:underline">Close</button>
      </div>
    );
  }

  const leadName = deal.contact
    ? [deal.contact.first_name, deal.contact.last_name].filter(Boolean).join(' ') || deal.contact.email
    : deal.contact_name;

  return (
    <>
      {/* pr-12 clears the absolutely-positioned close button, which otherwise
          sits on top of the right end of the "Full page" link and swallows
          the click that was meant to open the record. */}
      <div className="flex items-start gap-3 px-4 py-4 border-b border-[var(--border-subtle)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] flex-shrink-0">
          <Handshake className="h-5 w-5 text-[var(--indigo-text)]" />
        </span>
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={deal.title}
            placeholder="Untitled deal"
            ariaLabel="deal title"
            textClassName="text-heading font-semibold text-[var(--text-primary)]"
            inputClassName="text-heading font-semibold"
            onSave={(next) => save({ title: next })}
          />
          <p className="text-body text-[var(--text-tertiary)] truncate">
            {[deal.company, leadName].filter(Boolean).join(' · ') || 'No company yet'}
          </p>
        </div>
        <Link
          to={`/deals/${deal.id}`}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--border-subtle)] text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--indigo-text)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
        >
          <ExternalLink className="h-3 w-3" /> Pipeline
        </Link>
      </div>

      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <InlineEdit
          value={deal.value ?? ''}
          type="number"
          placeholder="Add a value"
          ariaLabel="deal value"
          textClassName="text-display font-semibold tabular text-[var(--text-primary)] tracking-[-0.02em] leading-none"
          inputClassName="text-display font-semibold tabular"
          format={(v) => formatMoney(Number(v), deal.currency)}
          onSave={(next) => {
            // People type "12,500" and "$12.5k" — take the digits, refuse the rest.
            const n = Number(next.replace(/[^0-9.-]/g, ''));
            if (!Number.isFinite(n)) { toast.error('That value isn’t a number'); return Promise.reject(new Error('nan')); }
            return save({ value: n });
          }}
        />
        {deal.expected_close_date && (
          <p className="text-caption text-[var(--text-tertiary)] mt-1">
            Expected {formatLongDate(deal.expected_close_date)}
          </p>
        )}
      </div>

      {/* Stage is the one edit worth having inline — it's the whole point of a pipeline */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <p className="text-caption font-semibold text-[var(--text-tertiary)] mb-2">Stage</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            ...(pipes.pipelineOf(deal)?.stages || []).map((st) => ({ id: st.id, label: st.name })),
            { id: 'won', label: 'Won' },
            { id: 'lost', label: 'Lost' },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => changeStage(s.id)}
              disabled={setStage.isPending || outcomeMutation.isPending}
              className={cn(
                'h-7 px-2.5 rounded-lg border text-body font-medium transition-colors disabled:opacity-60',
                s.id === (deal.stage === 'won' || deal.stage === 'lost' ? deal.stage : pipes.stageOf(deal)?.id)
                  ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo-text)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {deal.outcome_reason && (deal.stage === 'won' || deal.stage === 'lost') && (
          <p className={cn(
            'mt-2 text-body',
            deal.stage === 'won' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}>
            {deal.stage === 'won' ? 'Won because: ' : 'Lost because: '}{deal.outcome_reason}
          </p>
        )}
      </div>

      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <p className="text-caption font-semibold text-[var(--text-tertiary)] mb-1">Notes</p>
        <InlineEdit
          value={deal.notes}
          multiline
          placeholder="Add a note — ⌘↵ to save"
          ariaLabel="deal notes"
          onSave={(next) => save({ notes: next || null })}
        />
      </div>

      {/* The lead behind the deal — one hop, still without leaving the page */}
      {deal.contact_id && (
        <div className="px-4 py-3">
          <PeekLink contactId={deal.contact_id} label={leadName || 'View the lead'} />
        </div>
      )}

      {outcomeStage && (
        <OutcomeDialog
          deal={deal}
          stage={outcomeStage}
          onCancel={() => setOutcomeStage(null)}
          onConfirm={(reason) => {
            const stage = outcomeStage;
            setOutcomeStage(null);
            outcomeMutation.mutate({ stage, reason });
          }}
        />
      )}
    </>
  );
}

/** Swap the drawer to another record without closing it. */
function PeekLink({ contactId, label }: { contactId: string; label: string }) {
  const { openPeek } = usePeek();
  return (
    <button
      onClick={() => openPeek('contact', contactId)}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-left hover:border-[var(--indigo)]/40 hover:bg-[var(--bg-hover)] transition-colors"
    >
      <span className="flex-1 min-w-0 text-body font-medium text-[var(--text-primary)] truncate">{label}</span>
      <ArrowRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
    </button>
  );
}


function CompanyPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const pipes = usePipelines();
  const { openPeek } = usePeek();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['company-summary', id],
    queryFn: () => companiesApi.summary(id),
  });

  const save = async (patch: Record<string, string | null>) => {
    try {
      await companiesApi.update(id, patch as any);
      qc.invalidateQueries({ queryKey: ['company-summary', id] });
      qc.invalidateQueries({ queryKey: ['companies'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Could not save that change');
      throw e;
    }
  };
  const field = (key: string) => (next: string) => save({ [key]: next || null });

  if (isLoading) return <div className="flex items-center justify-center py-20"><Spinner size="md" /></div>;
  if (!data) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-strong font-medium text-[var(--text-primary)]">That company no longer exists</p>
        <button onClick={onClose} className="mt-2 text-body text-[var(--indigo-text)] hover:underline">Close</button>
      </div>
    );
  }

  const { company, contacts, deals } = data;
  const openDeals = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost');

  return (
    <>
      {/* pr-12 clears the absolutely-positioned close button, which otherwise
          sits on top of the right end of the "Full page" link and swallows
          the click that was meant to open the record. */}
      <div className="flex items-start gap-3 px-4 py-4 border-b border-[var(--border-subtle)]">
        <CompanyLogo domain={company.domain || company.website} name={company.name} size="lg" className="!h-10 !w-10 !rounded-xl" />
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={company.name}
            placeholder="Unnamed company"
            ariaLabel="company name"
            textClassName="text-heading font-semibold text-[var(--text-primary)]"
            inputClassName="text-heading font-semibold"
            onSave={(next) => save({ name: next })}
          />
          <p className="text-body text-[var(--text-tertiary)] truncate">
            {[company.industry, company.location].filter(Boolean).join(' · ') || company.domain || 'No details yet'}
          </p>
        </div>
        <Link
          to={`/companies/${company.id}`}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--border-subtle)] text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--indigo-text)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
        >
          <ExternalLink className="h-3 w-3" /> Full page
        </Link>
      </div>

      {/* What this account is worth right now */}
      <div className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] border-b border-[var(--border-subtle)]">
        <div className="px-3 py-3">
          <p className="text-title font-semibold tabular text-[var(--text-primary)] leading-none">{contacts.length}</p>
          <p className="text-micro text-[var(--text-tertiary)] mt-1">People</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-title font-semibold tabular text-[var(--text-primary)] leading-none">{openDeals.length}</p>
          <p className="text-micro text-[var(--text-tertiary)] mt-1">Open deals</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-title font-semibold tabular text-[var(--text-primary)] leading-none">
            {formatMoney(company.open_value, undefined, { compact: true })}
          </p>
          <p className="text-micro text-[var(--text-tertiary)] mt-1">Open value</p>
        </div>
      </div>

      <div className="px-4 py-3 space-y-1.5 border-b border-[var(--border-subtle)]">
        <EditRow
          icon={Globe}
          label="Domain"
          value={company.domain}
          onSave={field('domain')}
          href={company.website || (company.domain ? `https://${company.domain}` : undefined)}
        />
        <EditRow icon={Factory} label="Industry" value={company.industry} onSave={field('industry')} />
        <EditRow icon={MapPin} label="Location" value={company.location} onSave={field('location')} />
        <div className="flex items-center gap-2 min-w-0">
          <Users className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
          <InlineSelect
            ariaLabel="Headcount"
            value={(company.size || '') as string}
            options={COMPANY_SIZE_OPTIONS}
            onSave={(next) => save({ size: next || null })}
          />
        </div>
        <EditRow
          icon={Linkedin}
          label="LinkedIn"
          value={company.linkedin_url}
          onSave={field('linkedin_url')}
          type="url"
          href={company.linkedin_url || undefined}
        />
      </div>

      {/* Who works here — the question that was unanswerable before */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <p className="flex items-center gap-1.5 text-caption font-semibold text-[var(--text-tertiary)] mb-2">
          <Users className="h-3 w-3" /> People
        </p>
        {contacts.length === 0 ? (
          <p className="text-body text-[var(--text-tertiary)]">Nobody linked to this company yet.</p>
        ) : (
          <div className="space-y-1">
            {contacts.map((c) => {
              const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
              return (
                <button
                  key={c.id}
                  onClick={() => openPeek('contact', c.id)}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Avatar name={name} email={c.email} size="sm" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-body font-medium text-[var(--text-primary)] truncate">{name}</span>
                    <span className="block text-caption text-[var(--text-tertiary)] truncate">{c.job_title || c.email}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* What's open here */}
      <div className="px-4 py-3">
        <p className="flex items-center gap-1.5 text-caption font-semibold text-[var(--text-tertiary)] mb-2">
          <Handshake className="h-3 w-3" /> Deals
        </p>
        {deals.length === 0 ? (
          <p className="text-body text-[var(--text-tertiary)]">No deals attached to this company yet.</p>
        ) : (
          <div className="space-y-1">
            {deals.map((d) => (
              <button
                key={d.id}
                onClick={() => openPeek('deal', d.id)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-[var(--bg-hover)] transition-colors"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-body font-medium text-[var(--text-primary)] truncate">{d.title}</span>
                  <span className="block text-caption text-[var(--text-tertiary)]">{pipes.stageLabel(d)}</span>
                </span>
                <span className="text-body font-semibold tabular text-[var(--text-primary)] flex-shrink-0">
                  {formatMoney(d.value, d.currency)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function PeekDrawer() {
  const { target, closePeek, openPeek } = usePeek();
  const sequence = useSyncExternalStore(subscribePeekSequence, getPeekSequence, getPeekSequence);
  const seqIds = sequence && target && sequence.type === target.type ? sequence.ids : null;
  const seqIndex = seqIds && target ? seqIds.indexOf(target.id) : -1;
  const step = useCallback((delta: number) => {
    if (!seqIds || seqIndex < 0 || !target) return;
    const next = seqIds[seqIndex + delta];
    if (next) openPeek(target.type, next);
  }, [seqIds, seqIndex, target, openPeek]);
  const stepRef = useRef(step);
  stepRef.current = step;
  const identity = useRef({});
  const panelRef = useRef<HTMLElement>(null);

  /*
   * The drawer joins the same overlay stack Modal uses, so a dialog
   * opened from inside it - ContactHistory's activity and delete dialogs -
   * takes the keyboard while it is up rather than fighting this one for it.
   */
  const isTopmost = useCallback(
    () => openModals[openModals.length - 1] === identity.current,
    [],
  );
  useFocusTrap(panelRef, !!target, { topmost: isTopmost });
  // usePeek() derives `target` and `closePeek` from useSearchParams(), so
  // both get a new identity whenever the URL's search params change for
  // *any* reason — not just a peek opening or closing. Keeping either in
  // this effect's deps would tear it down and rebuild it on that unrelated
  // change, popping this drawer off `openModals` and pushing it back on
  // top — silently jumping it back above a Modal or confirm dialog opened
  // from inside it (e.g. ContactHistory's activity/meeting/delete dialogs),
  // so Escape closes the drawer instead of that dialog and discards its
  // unsaved state. Same failure Modal.tsx documents and avoids the same way:
  // route the callback through a ref and depend only on whether a peek is
  // open, keyed by the record it targets.
  const closePeekRef = useRef(closePeek);
  closePeekRef.current = closePeek;
  const targetKey = target ? `${target.type}:${target.id}` : null;

  useEffect(() => {
    if (!targetKey) return;
    // Join the same overlay stack Modal uses, so Escape closes only the
    // topmost layer: a Modal or confirm dialog opened from inside this
    // drawer (e.g. ContactHistory's activity/meeting/delete dialogs) takes
    // the keypress first, instead of the drawer discarding unsaved work.
    const self = identity.current;
    openModals.push(self);
    const onKey = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== self) return;
      if (e.key === 'Escape') { closePeekRef.current(); return; }
      // J/K or the arrow keys walk the list this was opened from.
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); stepRef.current(1); }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); stepRef.current(-1); }
    };
    document.addEventListener('keydown', onKey);
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = openModals.lastIndexOf(self);
      if (at !== -1) openModals.splice(at, 1);
      if (openModals.length === 0) document.body.style.overflow = original;
    };
  }, [targetKey]);

  if (!target) return null;

  return createPortal(
    <div className="fixed inset-0 z-[55]">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-fade-in" onClick={closePeek} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${target.type} details`}
        tabIndex={-1}
        className="absolute right-0 top-0 h-full w-full max-w-[520px] bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] shadow-[var(--shadow-xl)] overflow-y-auto"
        style={{ animation: 'slideInRight 220ms var(--ease-out) both' }}
      >
        {/* Where you are in the list, and the way along it. */}
        <div className="sticky top-0 z-10 flex items-center gap-1.5 h-11 px-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur" data-peek-nav>
          {seqIds && seqIndex >= 0 ? (
            <>
              <button type="button" onClick={() => step(-1)} disabled={seqIndex <= 0} className="icon-btn h-7 w-7" aria-label="Previous" title="Previous (K or up arrow)">
                <ChevronUp className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => step(1)} disabled={seqIndex >= seqIds.length - 1} className="icon-btn h-7 w-7" aria-label="Next" title="Next (J or down arrow)">
                <ChevronDown className="h-4 w-4" />
              </button>
              <span className="ml-1 text-caption text-[var(--text-tertiary)] tabular truncate">
                <span className="font-semibold text-[var(--text-secondary)]">{seqIndex + 1}</span> of {seqIds.length}{sequence?.label ? ` in ${sequence.label}` : ''}
              </span>
            </>
          ) : (
            <span className="text-caption font-medium text-[var(--text-tertiary)] capitalize">{target.type}</span>
          )}
          <button
            onClick={closePeek}
            className="ml-auto icon-btn h-7 w-7"
            title="Close (esc)"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {target.type === 'contact' ? <ContactPeek key={target.id} id={target.id} onClose={closePeek} />
          : target.type === 'deal' ? <DealPeek key={target.id} id={target.id} onClose={closePeek} />
          : <CompanyPeek key={target.id} id={target.id} onClose={closePeek} />}
      </aside>
    </div>,
    document.body,
  );
}

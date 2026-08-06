import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contactsApi } from '../../api/contacts.api';
import { crmApi } from '../../api/crm.api';
import { inboxApi } from '../../api/inbox.api';
import { analyticsApi } from '../../api/analytics.api';
import { Avatar } from '../shared/Avatar';
import { Spinner } from '../ui/Spinner';
import { ContactHistory } from '../crm/ContactHistory';
import { cn } from '../../lib/utils';
import { usePeek } from './usePeek';
import {
  X, ExternalLink, Mail, Building2, Briefcase, Phone, Linkedin, Globe,
  Handshake, ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { DEAL_STAGES, type DealStage } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The peek drawer.

   Clicking a person used to cost you the page you were on — your filters,
   your scroll position, your selection. This opens the record over the top
   instead, so checking something is a glance rather than a round trip.
   Mounted once at the app shell so every page gets it for free.
   ═══════════════════════════════════════════════════════════════════════ */

function Row({ icon: Icon, value, href }: { icon: typeof Mail; value?: string | null; href?: string }) {
  if (!value) return null;
  const body = (
    <span className="flex items-center gap-2 min-w-0">
      <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
      <span className="text-[12.5px] text-[var(--text-secondary)] truncate">{value}</span>
    </span>
  );
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className="block hover:text-[var(--indigo)]">{body}</a>
    : <div>{body}</div>;
}

function ContactPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: contact, isLoading } = useQuery({
    queryKey: ['contacts', id],
    queryFn: () => contactsApi.get(id),
  });

  const { data: emailsPage } = useQuery({
    queryKey: ['contact-emails', contact?.email],
    queryFn: () => inboxApi.list({ contact_email: contact!.email, limit: 50 }),
    enabled: !!contact?.email,
  });

  const { data: timeline } = useQuery({
    queryKey: ['contact-timeline', id],
    queryFn: () => analyticsApi.contactTimeline(id),
    enabled: !!id,
  });

  if (isLoading || !contact) {
    return <div className="flex items-center justify-center py-20"><Spinner size="md" /></div>;
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
  const emails = ((emailsPage?.data || []) as any[])
    .slice()
    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());

  return (
    <>
      {/* Identity */}
      <div className="flex items-start gap-3 px-4 py-4 border-b border-[var(--border-subtle)]">
        <Avatar name={name || contact.email} email={contact.email} size="lg" />
        <div className="flex-1 min-w-0">
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)] truncate">{name || 'Unnamed contact'}</h2>
          <p className="text-[12.5px] text-[var(--text-tertiary)] truncate">
            {[contact.job_title, contact.company].filter(Boolean).join(' · ') || contact.email}
          </p>
        </div>
        <Link
          to={`/contacts/${contact.id}`}
          onClick={onClose}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--border-subtle)] text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
        >
          <ExternalLink className="h-3 w-3" /> Full page
        </Link>
      </div>

      {/* Details */}
      <div className="px-4 py-3 space-y-1.5 border-b border-[var(--border-subtle)]">
        <Row icon={Mail} value={contact.email} href={`mailto:${contact.email}`} />
        <Row icon={Building2} value={contact.company} />
        <Row icon={Briefcase} value={contact.job_title} />
        <Row icon={Phone} value={contact.phone} />
        <Row icon={Linkedin} value={contact.linkedin_url} href={contact.linkedin_url || undefined} />
        <Row icon={Globe} value={contact.website} href={contact.website || undefined} />
      </div>

      {/* The whole relationship, same component the profile page uses */}
      <div className="p-3">
        <ContactHistory
          contactId={contact.id}
          contactName={name}
          contactEmail={contact.email}
          emails={emails}
          campaignActivity={(timeline || []) as any[]}
        />
      </div>
    </>
  );
}

function DealPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: deals, isLoading } = useQuery({ queryKey: ['crm', 'deals'], queryFn: () => crmApi.listDeals() });
  const deal = (deals || []).find((d) => d.id === id);

  const setStage = useMutation({
    mutationFn: (stage: DealStage) => crmApi.updateDeal(id, { stage }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm'] }); toast.success('Stage updated'); },
    onError: () => toast.error('Could not update the stage'),
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><Spinner size="md" /></div>;
  if (!deal) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-[13px] font-medium text-[var(--text-primary)]">That deal no longer exists</p>
        <button onClick={onClose} className="mt-2 text-[12px] text-[var(--indigo)] hover:underline">Close</button>
      </div>
    );
  }

  const leadName = deal.contact
    ? [deal.contact.first_name, deal.contact.last_name].filter(Boolean).join(' ') || deal.contact.email
    : deal.contact_name;

  return (
    <>
      <div className="flex items-start gap-3 px-4 py-4 border-b border-[var(--border-subtle)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] flex-shrink-0">
          <Handshake className="h-5 w-5 text-[var(--indigo)]" />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)] truncate">{deal.title}</h2>
          <p className="text-[12.5px] text-[var(--text-tertiary)] truncate">
            {[deal.company, leadName].filter(Boolean).join(' · ') || 'No company yet'}
          </p>
        </div>
        <Link
          to="/deals"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--border-subtle)] text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
        >
          <ExternalLink className="h-3 w-3" /> Pipeline
        </Link>
      </div>

      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <p className="text-[22px] font-semibold tabular text-[var(--text-primary)] tracking-[-0.02em] leading-none">
          {(deal.value || 0).toLocaleString('en-US', { style: 'currency', currency: deal.currency || 'USD', maximumFractionDigits: 0 })}
        </p>
        {deal.expected_close_date && (
          <p className="text-[11.5px] text-[var(--text-tertiary)] mt-1">
            Expected {new Date(deal.expected_close_date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        )}
      </div>

      {/* Stage is the one edit worth having inline — it's the whole point of a pipeline */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <p className="text-[11px] font-semibold text-[var(--text-tertiary)] mb-2">Stage</p>
        <div className="flex flex-wrap gap-1.5">
          {DEAL_STAGES.map((s) => (
            <button
              key={s.id}
              onClick={() => s.id !== deal.stage && setStage.mutate(s.id)}
              disabled={setStage.isPending}
              className={cn(
                'h-7 px-2.5 rounded-lg border text-[12px] font-medium transition-colors disabled:opacity-60',
                s.id === deal.stage
                  ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)]',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {deal.notes && (
        <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
          <p className="text-[11px] font-semibold text-[var(--text-tertiary)] mb-1">Notes</p>
          <p className="text-[12.5px] text-[var(--text-secondary)] whitespace-pre-wrap">{deal.notes}</p>
        </div>
      )}

      {/* The lead behind the deal — one hop, still without leaving the page */}
      {deal.contact_id && (
        <div className="px-4 py-3">
          <PeekLink contactId={deal.contact_id} label={leadName || 'View the lead'} />
        </div>
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
      <span className="flex-1 min-w-0 text-[12.5px] font-medium text-[var(--text-primary)] truncate">{label}</span>
      <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)] flex-shrink-0" />
    </button>
  );
}

export function PeekDrawer() {
  const { target, closePeek } = usePeek();

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePeek(); };
    document.addEventListener('keydown', onKey);
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = original;
    };
  }, [target, closePeek]);

  if (!target) return null;

  return createPortal(
    <div className="fixed inset-0 z-[55]">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-fade-in" onClick={closePeek} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={target.type === 'contact' ? 'Contact details' : 'Deal details'}
        className="absolute right-0 top-0 h-full w-full max-w-[520px] bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] shadow-[var(--shadow-xl)] overflow-y-auto"
        style={{ animation: 'slideInRight 220ms var(--ease-out) both' }}
      >
        <button
          onClick={closePeek}
          className="absolute right-3 top-3 z-10 icon-btn h-7 w-7 bg-[var(--bg-surface)]"
          title="Close (esc)"
        >
          <X className="h-4 w-4" />
        </button>

        {target.type === 'contact'
          ? <ContactPeek id={target.id} onClose={closePeek} />
          : <DealPeek id={target.id} onClose={closePeek} />}
      </aside>
    </div>,
    document.body,
  );
}

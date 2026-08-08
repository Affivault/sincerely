import { useEffect } from 'react';
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
import { cn } from '../../lib/utils';
import { usePeek } from './usePeek';
import {
  X, ExternalLink, Mail, Building2, Briefcase, Phone, Linkedin, Globe,
  Handshake, ArrowRight, Users, MapPin, Factory,
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

/**
 * The same row, but the value is the input. Empty fields still render — you
 * can't fill in a phone number that the UI hides because it's blank.
 */
function EditRow({
  icon: Icon, label, value, onSave, type = 'text', href,
}: {
  icon: typeof Mail;
  label: string;
  value?: string | null;
  onSave: (next: string) => Promise<unknown>;
  type?: 'text' | 'email' | 'url' | 'tel';
  href?: string;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0 group/row">
      <Icon className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
      <span className="flex-1 min-w-0">
        <InlineEdit value={value} onSave={onSave} placeholder={label} type={type} ariaLabel={label} />
      </span>
      {href && value ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          title={`Open ${label}`}
          className="flex-shrink-0 p-1 rounded text-[var(--text-muted)] opacity-0 group-hover/row:opacity-100 hover:text-[var(--indigo)] transition-opacity"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

function ContactPeek({ id, onClose }: { id: string; onClose: () => void }) {
  const { openPeek } = usePeek();
  const qc = useQueryClient();
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
      toast.error(e?.response?.data?.error?.message || 'Could not save that change');
      throw e;
    }
  };
  const field = (key: string) => (next: string) => save({ [key]: next || null });

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
      {/* pr-12 clears the absolutely-positioned close button, which otherwise
          sits on top of the right end of the "Full page" link and swallows
          the click that was meant to open the record. */}
      <div className="flex items-start gap-3 pl-4 pr-12 py-4 border-b border-[var(--border-subtle)]">
        <Avatar name={name || contact.email} email={contact.email} size="lg" />
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={name}
            placeholder="Unnamed contact"
            ariaLabel="name"
            textClassName="text-[16px] font-semibold text-[var(--text-primary)]"
            inputClassName="text-[16px] font-semibold"
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
          <p className="text-[12.5px] text-[var(--text-tertiary)] truncate">
            {[contact.job_title, contact.company].filter(Boolean).join(' · ') || contact.email}
          </p>
        </div>
        <Link
          to={`/contacts/${contact.id}`}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--border-subtle)] text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
        >
          <ExternalLink className="h-3 w-3" /> Full page
        </Link>
      </div>

      {/* Details */}
      <div className="px-4 py-3 space-y-1.5 border-b border-[var(--border-subtle)]">
        <Row icon={Mail} value={contact.email} href={`mailto:${contact.email}`} />
        {contact.company_id ? (
          <button
            onClick={() => openPeek('company', contact.company_id!)}
            className="flex items-center gap-2 min-w-0 w-full text-left hover:text-[var(--indigo)]"
          >
            <Building2 className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
            <span className="text-[12.5px] text-[var(--text-secondary)] truncate hover:text-[var(--indigo)]">{contact.company}</span>
            <ArrowRight className="h-3 w-3 text-[var(--text-muted)] flex-shrink-0" />
          </button>
        ) : (
          <EditRow icon={Building2} label="Company" value={contact.company} onSave={field('company')} />
        )}
        <EditRow icon={Briefcase} label="Job title" value={contact.job_title} onSave={field('job_title')} />
        <EditRow icon={Phone} label="Phone" value={contact.phone} onSave={field('phone')} type="tel" />
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

  const save = async (patch: Record<string, unknown>) => {
    try {
      await crmApi.updateDeal(id, patch as any);
      qc.invalidateQueries({ queryKey: ['crm'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Could not save that change');
      throw e;
    }
  };

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
      {/* pr-12 clears the absolutely-positioned close button, which otherwise
          sits on top of the right end of the "Full page" link and swallows
          the click that was meant to open the record. */}
      <div className="flex items-start gap-3 pl-4 pr-12 py-4 border-b border-[var(--border-subtle)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] flex-shrink-0">
          <Handshake className="h-5 w-5 text-[var(--indigo)]" />
        </span>
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={deal.title}
            placeholder="Untitled deal"
            ariaLabel="deal title"
            textClassName="text-[16px] font-semibold text-[var(--text-primary)]"
            inputClassName="text-[16px] font-semibold"
            onSave={(next) => save({ title: next })}
          />
          <p className="text-[12.5px] text-[var(--text-tertiary)] truncate">
            {[deal.company, leadName].filter(Boolean).join(' · ') || 'No company yet'}
          </p>
        </div>
        <Link
          to="/deals"
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--border-subtle)] text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
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
          textClassName="text-[22px] font-semibold tabular text-[var(--text-primary)] tracking-[-0.02em] leading-none"
          inputClassName="text-[22px] font-semibold tabular"
          format={(v) => Number(v).toLocaleString('en-US', {
            style: 'currency', currency: deal.currency || 'USD', maximumFractionDigits: 0,
          })}
          onSave={(next) => {
            // People type "12,500" and "$12.5k" — take the digits, refuse the rest.
            const n = Number(next.replace(/[^0-9.-]/g, ''));
            if (!Number.isFinite(n)) { toast.error('That value isn’t a number'); return Promise.reject(new Error('nan')); }
            return save({ value: n });
          }}
        />
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

      <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
        <p className="text-[11px] font-semibold text-[var(--text-tertiary)] mb-1">Notes</p>
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


function CompanyPeek({ id, onClose }: { id: string; onClose: () => void }) {
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
      toast.error(e?.response?.data?.error?.message || 'Could not save that change');
      throw e;
    }
  };
  const field = (key: string) => (next: string) => save({ [key]: next || null });

  if (isLoading) return <div className="flex items-center justify-center py-20"><Spinner size="md" /></div>;
  if (!data) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-[13px] font-medium text-[var(--text-primary)]">That company no longer exists</p>
        <button onClick={onClose} className="mt-2 text-[12px] text-[var(--indigo)] hover:underline">Close</button>
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
      <div className="flex items-start gap-3 pl-4 pr-12 py-4 border-b border-[var(--border-subtle)]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0">
          <Building2 className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={company.name}
            placeholder="Unnamed company"
            ariaLabel="company name"
            textClassName="text-[16px] font-semibold text-[var(--text-primary)]"
            inputClassName="text-[16px] font-semibold"
            onSave={(next) => save({ name: next })}
          />
          <p className="text-[12.5px] text-[var(--text-tertiary)] truncate">
            {[company.industry, company.location].filter(Boolean).join(' · ') || company.domain || 'No details yet'}
          </p>
        </div>
        <Link
          to={`/companies/${company.id}`}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-[var(--border-subtle)] text-[11.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors flex-shrink-0"
        >
          <ExternalLink className="h-3 w-3" /> Full page
        </Link>
      </div>

      {/* What this account is worth right now */}
      <div className="grid grid-cols-3 divide-x divide-[var(--border-subtle)] border-b border-[var(--border-subtle)]">
        <div className="px-3 py-3">
          <p className="text-[17px] font-semibold tabular text-[var(--text-primary)] leading-none">{contacts.length}</p>
          <p className="text-[10.5px] text-[var(--text-tertiary)] mt-1">People</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-[17px] font-semibold tabular text-[var(--text-primary)] leading-none">{openDeals.length}</p>
          <p className="text-[10.5px] text-[var(--text-tertiary)] mt-1">Open deals</p>
        </div>
        <div className="px-3 py-3">
          <p className="text-[17px] font-semibold tabular text-[var(--text-primary)] leading-none">
            {(company.open_value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: 'compact' })}
          </p>
          <p className="text-[10.5px] text-[var(--text-tertiary)] mt-1">Open value</p>
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
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] mb-2">
          <Users className="h-3 w-3" /> People
        </p>
        {contacts.length === 0 ? (
          <p className="text-[12px] text-[var(--text-tertiary)]">Nobody linked to this company yet.</p>
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
                    <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">{name}</span>
                    <span className="block text-[11px] text-[var(--text-tertiary)] truncate">{c.job_title || c.email}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--text-muted)] flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* What's open here */}
      <div className="px-4 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-tertiary)] mb-2">
          <Handshake className="h-3 w-3" /> Deals
        </p>
        {deals.length === 0 ? (
          <p className="text-[12px] text-[var(--text-tertiary)]">No deals attached to this company yet.</p>
        ) : (
          <div className="space-y-1">
            {deals.map((d) => (
              <button
                key={d.id}
                onClick={() => openPeek('deal', d.id)}
                className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-[var(--bg-hover)] transition-colors"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate">{d.title}</span>
                  <span className="block text-[11px] text-[var(--text-tertiary)] capitalize">{d.stage}</span>
                </span>
                <span className="text-[12px] font-semibold tabular text-[var(--text-primary)] flex-shrink-0">
                  {(d.value || 0).toLocaleString('en-US', { style: 'currency', currency: d.currency || 'USD', maximumFractionDigits: 0 })}
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
        aria-label={`${target.type} details`}
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

        {target.type === 'contact' ? <ContactPeek key={target.id} id={target.id} onClose={closePeek} />
          : target.type === 'deal' ? <DealPeek key={target.id} id={target.id} onClose={closePeek} />
          : <CompanyPeek key={target.id} id={target.id} onClose={closePeek} />}
      </aside>
    </div>,
    document.body,
  );
}

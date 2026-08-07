import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { companiesApi } from '../../api/companies.api';
import { crmApi } from '../../api/crm.api';
import { Spinner } from '../../components/ui/Spinner';
import { InlineEdit, InlineSelect } from '../../components/ui/InlineEdit';
import { Avatar } from '../../components/shared/Avatar';
import { QuickCompose } from '../../components/shared/QuickCompose';
import { usePeek } from '../../components/peek/usePeek';
import { COMPANY_SIZE_OPTIONS } from '../../lib/constants';
import { cn, formatDate } from '../../lib/utils';
import { DEAL_STAGES, type CompanyActivity } from '@lemlist/shared';
import {
  ArrowLeft, Building2, Users, Handshake, Globe, MapPin, Factory, Linkedin,
  Mail, StickyNote, CalendarDays, ListTodo, ArrowUpRight, ArrowDownLeft,
  Trash2, Plus, ExternalLink,
} from 'lucide-react';
import toast from 'react-hot-toast';

/* ═══════════════════════════════════════════════════════════════════════
   The company, in full.

   A person's page answers "what has happened with them?". This answers it
   for the account — because you don't remember which of the three people
   at Acme asked about pricing, you remember that Acme asked. Every email,
   note, call and meeting belonging to anyone at the company pools into
   one stream here, and every row leads back to the person it came from.
   ═══════════════════════════════════════════════════════════════════════ */

type StreamItem = {
  id: string;
  at: string;
  kind: 'email-in' | 'email-out' | 'note' | 'meeting' | 'task';
  title: string;
  detail?: string | null;
  who?: string | null;
  contactId?: string | null;
};

const KIND_META: Record<StreamItem['kind'], { icon: typeof Mail; tone: string; label: string }> = {
  'email-in':  { icon: ArrowDownLeft, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', label: 'Received' },
  'email-out': { icon: ArrowUpRight,  tone: 'bg-[var(--indigo-subtle)] text-[var(--indigo)]',          label: 'Sent' },
  note:        { icon: StickyNote,    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',      label: 'Note' },
  meeting:     { icon: CalendarDays,  tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',   label: 'Meeting' },
  task:        { icon: ListTodo,      tone: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]',    label: 'Activity' },
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card px-3.5 py-3">
      <p className="text-[11px] font-medium text-[var(--text-tertiary)]">{label}</p>
      <p className="mt-1 text-[17px] font-semibold text-[var(--text-primary)] tabular leading-none truncate">{value}</p>
      {sub && <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, onSave, href, type }: {
  icon: React.ElementType;
  label: string;
  value?: string | null;
  onSave: (next: string) => Promise<unknown>;
  href?: string;
  type?: 'text' | 'url';
}) {
  return (
    <div className="flex items-start gap-3 group/row">
      <Icon className="h-4 w-4 text-[var(--text-secondary)] mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[var(--text-secondary)]">{label}</p>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="min-w-0 flex-1">
            <InlineEdit
              value={value}
              placeholder={`Add ${label.toLowerCase()}`}
              ariaLabel={label.toLowerCase()}
              type={type}
              textClassName="text-sm text-[var(--text-primary)]"
              inputClassName="text-sm"
              onSave={onSave}
            />
          </span>
          {href && value && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              title={`Open ${label}`}
              className="shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { openPeek } = usePeek();
  const [tab, setTab] = useState<'history' | 'people' | 'deals'>('history');
  const [writingTo, setWritingTo] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['company-summary', id],
    queryFn: () => companiesApi.summary(id!),
    enabled: !!id,
  });

  const { data: activity } = useQuery<CompanyActivity>({
    queryKey: ['company-activity', id],
    queryFn: () => companiesApi.activity(id!),
    enabled: !!id,
  });

  const save = async (patch: Record<string, string | null>) => {
    try {
      await companiesApi.update(id!, patch as any);
      qc.invalidateQueries({ queryKey: ['company-summary', id] });
      qc.invalidateQueries({ queryKey: ['companies'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Could not save that change');
      throw e;
    }
  };
  const field = (key: string) => (next: string) => save({ [key]: next || null });

  const remove = useMutation({
    mutationFn: () => companiesApi.remove(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Company deleted — its people and deals were kept');
      navigate('/companies');
    },
    onError: () => toast.error('Could not delete that company'),
  });

  /* One stream, ordered by when it happened, whoever it was with. */
  const stream = useMemo<StreamItem[]>(() => {
    if (!activity) return [];
    const nameOf = (contactId?: string | null) => {
      const c = activity.contacts.find((x) => x.id === contactId);
      if (!c) return null;
      return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
    };
    const byEmail = (email?: string | null) => {
      const c = activity.contacts.find((x) => x.email === email);
      return c ? { name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email, id: c.id } : null;
    };

    const items: StreamItem[] = [];

    for (const m of activity.messages) {
      const who = byEmail(m.contact_email);
      items.push({
        id: `m-${m.id}`,
        at: m.received_at,
        kind: m.direction === 'outbound' ? 'email-out' : 'email-in',
        title: m.subject || '(no subject)',
        detail: (m.body_text || '').slice(0, 140) || null,
        who: who?.name || m.contact_name || m.contact_email,
        contactId: who?.id || null,
      });
    }
    for (const n of activity.notes) {
      items.push({
        id: `n-${n.id}`,
        at: n.created_at,
        kind: 'note',
        title: n.body,
        who: nameOf(n.contact_id),
        contactId: n.contact_id,
      });
    }
    for (const e of activity.events) {
      items.push({
        id: `e-${e.id}`,
        at: e.starts_at,
        kind: 'meeting',
        title: e.title,
        detail: e.location || null,
        who: nameOf(e.contact_id) || e.contact_name,
        contactId: e.contact_id,
      });
    }
    for (const t of activity.tasks) {
      if (!t.is_done) continue; // open work belongs in Activities, not history
      items.push({
        id: `t-${t.id}`,
        at: t.completed_at || t.due_date || t.created_at,
        kind: 'task',
        title: t.title,
        who: nameOf(t.contact_id) || t.contact_name,
        contactId: t.contact_id,
      });
    }

    return items
      .filter((i) => i.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [activity]);

  if (!id) return <div className="text-center py-12 text-[var(--text-secondary)]">Invalid company URL.</div>;
  if (isLoading) return <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>;
  if (!data) return <div className="text-center text-[var(--text-secondary)]">Company not found</div>;

  const { company, contacts, deals } = data;
  const open = deals.filter((d: any) => d.stage !== 'won' && d.stage !== 'lost');
  const won = deals.filter((d: any) => d.stage === 'won');
  const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const website = company.website || (company.domain ? `https://${company.domain}` : undefined);

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/companies')}
        className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group"
      >
        <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
        Companies
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--indigo-subtle)] border border-[rgba(99,102,241,0.18)] flex-shrink-0">
            <Building2 className="h-5 w-5 text-[var(--indigo)]" />
          </span>
          <div className="min-w-0">
            <InlineEdit
              value={company.name}
              placeholder="Unnamed company"
              ariaLabel="company name"
              textClassName="text-[18px] font-semibold text-[var(--text-primary)]"
              inputClassName="text-[18px] font-semibold"
              onSave={(next) => save({ name: next })}
            />
            <p className="text-[12.5px] text-[var(--text-secondary)] truncate">
              {[company.industry, company.location].filter(Boolean).join(' · ') || company.domain || 'No details yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {website && (
            <a href={website} target="_blank" rel="noreferrer" className="btn-secondary">
              <Globe className="h-3.5 w-3.5" /> Website
            </a>
          )}
          <button
            onClick={() => {
              if (confirm(`Delete ${company.name}? Its people and deals are kept — only the account record goes.`)) remove.mutate();
            }}
            className="icon-btn h-8 w-8 hover:text-[var(--error)]"
            title="Delete company"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="People" value={String(contacts.length)} sub={contacts.length === 1 ? 'contact' : 'contacts'} />
        <Stat label="Open pipeline" value={money(open.reduce((s: number, d: any) => s + (Number(d.value) || 0), 0))} sub={`${open.length} open`} />
        <Stat label="Won" value={money(won.reduce((s: number, d: any) => s + (Number(d.value) || 0), 0))} sub={`${won.length} closed`} />
        <Stat label="Activity" value={String(stream.length)} sub="emails, notes & meetings" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left rail */}
        <div className="space-y-3">
          <div className="card p-4">
            <h2 className="text-[11px] font-bold text-[var(--text-tertiary)] mb-3">Company info</h2>
            <div className="space-y-2.5">
              <InfoRow icon={Globe} label="Domain" value={company.domain} onSave={field('domain')} href={website} />
              <InfoRow icon={Globe} label="Website" value={company.website} onSave={field('website')} type="url" href={company.website || undefined} />
              <InfoRow icon={Factory} label="Industry" value={company.industry} onSave={field('industry')} />
              <InfoRow icon={MapPin} label="Location" value={company.location} onSave={field('location')} />
              <InfoRow icon={Linkedin} label="LinkedIn" value={company.linkedin_url} onSave={field('linkedin_url')} type="url" href={company.linkedin_url || undefined} />
              <div className="flex items-start gap-3">
                <Users className="h-4 w-4 text-[var(--text-secondary)] mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-[var(--text-secondary)]">Headcount</p>
                  <InlineSelect
                    value={(company.size || '') as string}
                    options={COMPANY_SIZE_OPTIONS}
                    onSave={(next) => save({ size: next || null })}
                  />
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Added {formatDate(company.created_at)} · updated {formatDate(company.updated_at)}
              </p>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="text-[11px] font-bold text-[var(--text-tertiary)] mb-2">Notes</h2>
            <InlineEdit
              value={company.notes}
              multiline
              placeholder="Anything worth remembering about this account — ⌘↵ to save"
              ariaLabel="company notes"
              onSave={(next) => save({ notes: next || null })}
            />
          </div>
        </div>

        {/* Right: history / people / deals */}
        <div className="lg:col-span-2 card p-0 overflow-hidden">
          <div className="flex items-center gap-1 px-4 h-11 border-b border-[var(--border-subtle)]">
            {([
              { id: 'history' as const, label: 'History', count: stream.length },
              { id: 'people' as const, label: 'People', count: contacts.length },
              { id: 'deals' as const, label: 'Deals', count: deals.length },
            ]).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'relative flex items-center gap-1.5 h-full px-2.5 text-[13px] font-medium transition-colors',
                  tab === t.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
                )}
              >
                {t.label}
                {t.count > 0 && (
                  <span className={cn(
                    'flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] px-1 text-[10.5px] font-semibold tabular',
                    tab === t.id ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]',
                  )}>{t.count}</span>
                )}
                <span className={cn('absolute left-2 right-2 bottom-0 h-[2px] rounded-t-full transition-opacity', tab === t.id ? 'bg-[var(--indigo)] opacity-100' : 'opacity-0')} />
              </button>
            ))}
          </div>

          {tab === 'history' ? (
            stream.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-elevated)] mb-2">
                  <Building2 className="h-4 w-4 text-[var(--text-tertiary)]" />
                </span>
                <p className="text-[12.5px] font-medium text-[var(--text-primary)]">Nothing has happened yet</p>
                <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5 max-w-sm">
                  Emails, notes, calls and meetings with anyone at {company.name} collect here as a single history.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {stream.map((item) => {
                  const meta = KIND_META[item.kind];
                  const Icon = meta.icon;
                  return (
                    <div key={item.id} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors">
                      <span className={cn('flex h-6 w-6 items-center justify-center rounded-md flex-shrink-0 mt-0.5', meta.tone)}>
                        <Icon className="h-3 w-3" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn(
                          'text-[12.5px] text-[var(--text-primary)]',
                          item.kind === 'note' ? 'whitespace-pre-wrap' : 'truncate font-medium',
                        )}>
                          {item.title}
                        </p>
                        {item.detail && (
                          <p className="text-[11.5px] text-[var(--text-tertiary)] truncate mt-0.5">{item.detail}</p>
                        )}
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                          {meta.label}
                          {item.who && (
                            <>
                              {' · '}
                              {item.contactId ? (
                                <button
                                  onClick={() => openPeek('contact', item.contactId!)}
                                  className="text-[var(--text-tertiary)] hover:text-[var(--indigo)] hover:underline"
                                >
                                  {item.who}
                                </button>
                              ) : item.who}
                            </>
                          )}
                          {' · '}{formatDate(item.at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : tab === 'people' ? (
            contacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-elevated)] mb-2">
                  <Users className="h-4 w-4 text-[var(--text-tertiary)]" />
                </span>
                <p className="text-[12.5px] font-medium text-[var(--text-primary)]">Nobody linked yet</p>
                <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5 max-w-sm">
                  Set a contact's company to this account and they'll appear here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {contacts.map((c: any) => {
                  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
                  return (
                    <div key={c.id} className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={name} email={c.email} size="sm" />
                        <button onClick={() => openPeek('contact', c.id)} className="min-w-0 flex-1 text-left group/p">
                          <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate group-hover/p:text-[var(--indigo)] transition-colors">
                            {name}
                          </span>
                          <span className="block text-[11.5px] text-[var(--text-tertiary)] truncate">
                            {[c.job_title, c.email].filter(Boolean).join(' · ')}
                          </span>
                        </button>
                        <button
                          onClick={() => setWritingTo(writingTo === c.id ? null : c.id)}
                          className="flex-shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[var(--border-subtle)] text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:border-[var(--indigo)]/40 transition-colors"
                        >
                          <Mail className="h-3 w-3" /> Email
                        </button>
                        <Link
                          to={`/contacts/${c.id}`}
                          className="flex-shrink-0 icon-btn h-6 w-6"
                          title="Open full profile"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                      {writingTo === c.id && (
                        <div className="mt-2">
                          <QuickCompose to={c.email} toName={name} onSent={() => setWritingTo(null)} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            deals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-elevated)] mb-2">
                  <Handshake className="h-4 w-4 text-[var(--text-tertiary)]" />
                </span>
                <p className="text-[12.5px] font-medium text-[var(--text-primary)]">No deals against this account</p>
                <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5 max-w-sm">
                  Deals created from a conversation with anyone here will show up in this list.
                </p>
                <Link to="/deals" className="btn-secondary mt-3"><Plus className="h-3.5 w-3.5" /> Open pipeline</Link>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {deals.map((d: any) => (
                  <button
                    key={d.id}
                    onClick={() => openPeek('deal', d.id)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-[var(--bg-hover)] transition-colors group/d"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--indigo-subtle)] flex-shrink-0">
                      <Handshake className="h-3 w-3 text-[var(--indigo)]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-medium text-[var(--text-primary)] truncate group-hover/d:text-[var(--indigo)] transition-colors">
                        {d.title}
                      </span>
                      <span className="block text-[11.5px] text-[var(--text-tertiary)]">
                        {DEAL_STAGES.find((s) => s.id === d.stage)?.label || d.stage}
                      </span>
                    </span>
                    <span className="text-[12.5px] font-semibold tabular text-[var(--text-primary)] flex-shrink-0">
                      {money(Number(d.value) || 0)}
                    </span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

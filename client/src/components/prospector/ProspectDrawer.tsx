import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight, Briefcase, Building2, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink,
  GraduationCap, Linkedin, Lock, Unlock, Users, X,
} from 'lucide-react';
import type { EnrichedCompany, ProspectPerson } from '@lemlist/shared';
import { prospectingApi } from '../../api/prospecting.api';
import { Avatar } from '../shared/Avatar';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../lib/utils';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { keepPrevious } from '../../lib/listQuery';
import { Refreshing } from '../ui/Refreshing';

/* ═══════════════════════════════════════════════════════════════════════
   The person and company panel in the Prospector.

   Clicking a name used to do nothing; you had to reveal someone, spending
   a credit, before you could see more than the table row. Everything on
   the Person tab and the company overview is free: it is the lead the
   search already paid for, the account's own company records, and a free
   headcount.

   The Prospects tab lists everyone at the company. That is an ordinary
   Prospector search (no Sincerely credits, the provider's usual small
   per-result cost), so it only runs when the tab is opened.
   ═══════════════════════════════════════════════════════════════════════ */

type Tab = 'person' | 'company' | 'prospects';

export function ProspectDrawer({
  person: initial,
  revealingId,
  onReveal,
  onClose,
}: {
  person: ProspectPerson;
  revealingId: string | null;
  /** The page's reveal, so credits, lists and toasts behave exactly as in the table. */
  onReveal: (p: ProspectPerson) => Promise<{ found: boolean; contact_id: string | null } | void>;
  onClose: () => void;
}) {
  const [person, setPerson] = useState(initial);
  const [tab, setTab] = useState<Tab>('person');
  const [unlocked, setUnlocked] = useState<Record<string, string | null>>({});
  const panelRef = useRef<HTMLElement>(null);
  useFocusTrap(panelRef, true);
  useEffect(() => { setPerson(initial); setTab('person'); }, [initial]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { data: details, isLoading } = useQuery({
    queryKey: ['prospecting', 'details', person.id],
    queryFn: () => prospectingApi.details(person.id, { company: person.company, domain: person.company_domain }),
    staleTime: 10 * 60 * 1000,
    meta: { silentError: true },
  });

  const companyKey = details?.company?.domain || person.company_domain || person.company || '';
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [companyKey]);
  const { data: colleagues, isFetching: loadingColleagues, isPlaceholderData: turningPage, isError: colleaguesError } = useQuery({
    queryKey: ['prospecting', 'company-people', companyKey, page],
    ...keepPrevious,
    queryFn: () => prospectingApi.search({ companies: [companyKey] }, page),
    enabled: tab === 'prospects' && !!companyKey,
    staleTime: 10 * 60 * 1000,
    meta: { silentError: true },
  });

  const reveal = async (p: ProspectPerson) => {
    const res = await onReveal(p);
    if (res && res.found) setUnlocked((u) => ({ ...u, [p.id]: res.contact_id }));
  };
  const isUnlocked = (p: ProspectPerson) => p.already_revealed || p.id in unlocked;
  const contactIdOf = (p: ProspectPerson) => unlocked[p.id] ?? p.contact_id ?? null;

  const enriched = details?.person;
  const company: EnrichedCompany | null = details?.company || null;
  const companyName = company?.name || person.company;
  const website = company?.website || (person.company_domain ? `https://${person.company_domain}` : null);
  const location = enriched?.location || person.location;

  return createPortal(
    <div className="fixed inset-0 z-[55]">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${person.full_name}, prospect details`}
        tabIndex={-1}
        className="absolute right-0 top-0 h-full w-full max-w-[560px] bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] shadow-[var(--shadow-xl)] overflow-y-auto"
        style={{ animation: 'slideInRight 220ms var(--ease-out) both' }}
      >
        <button onClick={onClose} className="absolute right-3 top-3 z-10 icon-btn h-7 w-7 bg-[var(--bg-surface)]" title="Close (esc)" aria-label="Close">
          <X className="h-4 w-4" />
        </button>

        {/* Who, and the one action that costs anything */}
        <div className="px-5 pt-5 pb-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-start gap-3 pr-8">
            {enriched?.photo_url
              ? <img src={enriched.photo_url} alt="" className="h-12 w-12 rounded-full object-cover flex-shrink-0" referrerPolicy="no-referrer" />
              : <Avatar name={person.full_name} size="xl" />}
            <div className="min-w-0 flex-1">
              <h2 className="text-title font-semibold text-[var(--text-primary)] leading-tight">{person.full_name}</h2>
              <p className="text-body text-[var(--text-secondary)]">{[person.job_title, companyName].filter(Boolean).join(' at ') || '—'}</p>
              {enriched?.headline && enriched.headline !== person.job_title && (
                <p className="mt-0.5 text-caption text-[var(--text-tertiary)] line-clamp-2">{enriched.headline}</p>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <RevealButton person={person} unlocked={isUnlocked(person)} contactId={contactIdOf(person)} revealing={revealingId === person.id} disabled={revealingId !== null} onReveal={() => reveal(person)} />
          </div>
          <nav className="mt-4 -mb-4 flex gap-1" role="tablist">
            {([
              ['person', 'Person'],
              ['company', 'Company'],
              ['prospects', details?.company_people != null ? `Prospects · ${details.company_people.toLocaleString()}` : 'Prospects'],
            ] as [Tab, string][]).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={cn('h-9 px-3 text-body font-medium border-b-2 -mb-px transition-colors',
                  tab === id ? 'border-[var(--indigo)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]')}>
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="px-5 py-4">
          {isLoading && tab !== 'prospects' && <div className="py-8 flex justify-center"><Spinner /></div>}

          {!isLoading && tab === 'person' && (
            <div className="space-y-4">
              <Rows rows={[
                ['Email', isUnlocked(person) ? 'Unlocked: in your leads' : <span className="inline-flex items-center gap-1.5 font-mono text-[var(--text-tertiary)]"><Lock className="h-3 w-3" />●●●●●@{person.company_domain || '●●●●●.com'}</span>],
                ['LinkedIn', person.linkedin_url || enriched?.linkedin_url ? <Ext href={(person.linkedin_url || enriched?.linkedin_url)!}>{shortLinkedin(person.linkedin_url || enriched?.linkedin_url)}</Ext> : null],
                ['Location', location],
                ['Industry', person.industry || company?.industry],
                ['Connections', enriched?.connections != null ? enriched.connections.toLocaleString() : null],
              ]} />
              <Section title="Employment">
                <Rows rows={[
                  ['Company', companyName ? <button className="text-[var(--indigo-text)] hover:underline" onClick={() => setTab('company')}>{companyName}</button> : null],
                  ['Position', person.job_title],
                  ['Website', website ? <Ext href={website}>{website.replace(/^https?:\/\/(www\.)?/, '')}</Ext> : null],
                  ['Company size', company?.size || person.company_size ? `${fmtSize(company?.size || person.company_size)} employees` : null],
                ]} />
              </Section>
              {enriched?.summary && <Section title="About"><Clamp text={enriched.summary} /></Section>}
              {enriched && enriched.experience.length > 0 && (
                <Section title="Career">
                  <ol className="space-y-2">
                    {enriched.experience.map((j, i) => (
                      <li key={i} className="flex gap-2.5 text-caption leading-snug">
                        <Briefcase className="h-3.5 w-3.5 mt-px flex-shrink-0 text-[var(--text-tertiary)]" />
                        <span className="min-w-0">
                          <span className="text-[var(--text-primary)] font-medium">{j.title || 'Role'}</span>
                          {j.company && <span className="text-[var(--text-secondary)]"> · {j.company}</span>}
                          {(j.start || j.end) && <span className="block text-micro text-[var(--text-tertiary)]">{j.start || '?'} – {j.end || 'now'}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                </Section>
              )}
              {enriched && enriched.education.length > 0 && (
                <Section title="Education">
                  <ul className="space-y-1.5">
                    {enriched.education.map((e, i) => (
                      <li key={i} className="flex gap-2.5 text-caption">
                        <GraduationCap className="h-3.5 w-3.5 mt-px flex-shrink-0 text-[var(--text-tertiary)]" />
                        <span><span className="text-[var(--text-primary)]">{e.school}</span>{(e.degree || e.field) && <span className="text-[var(--text-secondary)]"> · {[e.degree, e.field].filter(Boolean).join(', ')}</span>}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {enriched && enriched.skills.length > 0 && <Section title="Skills"><Chips items={enriched.skills} /></Section>}
              {!enriched && (
                <p className="text-caption text-[var(--text-tertiary)]">
                  Run the search again to load more about them. Once revealed, Enrich on their contact page pulls their full profile.
                </p>
              )}
            </div>
          )}

          {!isLoading && tab === 'company' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {company?.logo_url
                  ? <img src={company.logo_url} alt="" className="h-11 w-11 rounded-md object-contain bg-white flex-shrink-0" referrerPolicy="no-referrer" />
                  : <span className="h-11 w-11 rounded-md bg-[var(--bg-elevated)] flex items-center justify-center flex-shrink-0"><Building2 className="h-5 w-5 text-[var(--text-tertiary)]" /></span>}
                <div className="min-w-0">
                  <p className="text-strong font-semibold text-[var(--text-primary)] truncate">{companyName || 'Unknown company'}</p>
                  {(company?.location) && <p className="text-caption text-[var(--text-secondary)] truncate">{company.location}</p>}
                </div>
              </div>
              <Rows rows={[
                ['Industry', company?.industry || person.industry],
                ['Size', company?.size || person.company_size ? `${fmtSize(company?.size || person.company_size)} employees` : null],
                ['Founded', company?.founded ? String(company.founded) : null],
                ['Website', website ? <Ext href={website}>{website.replace(/^https?:\/\/(www\.)?/, '')}</Ext> : null],
                ['LinkedIn', company?.linkedin_url ? <Ext href={company.linkedin_url}>{shortLinkedin(company.linkedin_url)}</Ext> : null],
                ['Type', company?.type],
                ['Prospects', details?.company_people != null
                  ? <button className="text-[var(--indigo-text)] hover:underline" onClick={() => setTab('prospects')}>{details.company_people.toLocaleString()} people</button>
                  : null],
              ]} />
              {company?.description && <Section title="Company details"><Clamp text={company.description} /></Section>}
              {company && company.specialties.length > 0 && <Section title="Specialties"><Chips items={company.specialties} /></Section>}
              <InCrm people={details?.in_crm || []} />
            </div>
          )}

          {tab === 'prospects' && (
            <div className="space-y-3">
              <p className="text-caption text-[var(--text-tertiary)]">
                Everyone the database holds at {companyName || 'this company'}. Listing them uses no Sincerely credits; revealing an email uses one.
              </p>
              {!companyKey ? (
                <p className="text-body text-[var(--text-tertiary)]">Their company isn't known, so there's no one to list.</p>
              ) : loadingColleagues && !colleagues ? (
                <div className="py-8 flex justify-center"><Spinner /></div>
              ) : colleaguesError ? (
                <p className="text-body text-[var(--text-tertiary)]">Couldn't load the people at this company. Try again in a moment.</p>
              ) : (
                <Refreshing active={turningPage}>
                  <ul className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-lg">
                    {(colleagues?.results || []).map((c) => (
                      <li key={c.id} className="flex items-center gap-2.5 px-3 py-2">
                        <Avatar name={c.full_name} size="md" />
                        <button className="min-w-0 flex-1 text-left" onClick={() => { setPerson(c); setTab('person'); panelRef.current?.scrollTo({ top: 0 }); }}>
                          <span className={cn('block truncate text-body font-medium', c.id === person.id ? 'text-[var(--indigo-text)]' : 'text-[var(--text-primary)] hover:text-[var(--indigo-text)]')}>{c.full_name}</span>
                          <span className="block truncate text-caption text-[var(--text-tertiary)]">{c.job_title || '—'}</span>
                        </button>
                        {c.linkedin_url && (
                          <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" className="icon-btn h-7 w-7" title="Open LinkedIn" aria-label={`${c.full_name} on LinkedIn`}>
                            <Linkedin className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <RevealButton person={c} compact unlocked={isUnlocked(c)} contactId={contactIdOf(c)} revealing={revealingId === c.id} disabled={revealingId !== null} onReveal={() => reveal(c)} />
                      </li>
                    ))}
                    {colleagues && colleagues.results.length === 0 && (
                      <li className="px-3 py-6 text-center text-body text-[var(--text-tertiary)]">No one else found at this company.</li>
                    )}
                  </ul>
                  {colleagues && colleagues.total > 25 && (
                    <div className="flex items-center justify-between text-caption text-[var(--text-tertiary)]">
                      <span>Page {page} of {Math.ceil(Math.min(colleagues.total, 1000) / 25)}</span>
                      <span className="flex gap-1">
                        <button aria-label="Previous page" disabled={page <= 1 || loadingColleagues} onClick={() => setPage((p) => p - 1)} className="icon-btn h-7 w-7 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                        <button aria-label="Next page" disabled={page * 25 >= Math.min(colleagues.total, 1000) || loadingColleagues} onClick={() => setPage((p) => p + 1)} className="icon-btn h-7 w-7 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                      </span>
                    </div>
                  )}
                </Refreshing>
              )}
              <InCrm people={details?.in_crm || []} />
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function RevealButton({ person, unlocked, contactId, revealing, disabled, onReveal, compact }: {
  person: ProspectPerson; unlocked: boolean; contactId: string | null; revealing: boolean; disabled: boolean; onReveal: () => void; compact?: boolean;
}) {
  if (unlocked) {
    return contactId ? (
      <Link to={`/contacts/${contactId}`} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-caption font-medium text-emerald-700 dark:text-emerald-400 hover:bg-[var(--bg-hover)]">
        <CheckCircle2 className="h-3 w-3" /> {compact ? 'Open' : 'Unlocked · open contact'} <ArrowUpRight className="h-3 w-3" />
      </Link>
    ) : (
      <span className="inline-flex items-center gap-1 text-caption font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> Unlocked</span>
    );
  }
  return (
    <Button size="sm" variant={compact ? 'secondary' : 'primary'} onClick={onReveal} disabled={disabled} aria-label={`Reveal ${person.full_name}'s email`}>
      {revealing ? <><Spinner size="sm" /> Revealing…</> : <><Unlock className="h-3 w-3" /> {compact ? 'Reveal' : 'Reveal email · 1 credit'}</>}
    </Button>
  );
}

function InCrm({ people }: { people: { id: string; name: string; job_title: string | null; email: string }[] }) {
  if (!people.length) return null;
  return (
    <Section title={`Already in your CRM · ${people.length}`}>
      <ul className="space-y-1">
        {people.map((p) => (
          <li key={p.id}>
            <Link to={`/contacts/${p.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]">
              <Users className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate text-body text-[var(--text-primary)]">{p.name}</span>
              <span className="truncate text-caption text-[var(--text-tertiary)] max-w-[45%]">{p.job_title || p.email}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-body">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[var(--text-tertiary)]">{label}</dt>
          <dd className="text-[var(--text-primary)] min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-caption font-semibold text-[var(--text-tertiary)]">
        {title}
        <span className="flex-1 h-px bg-[var(--border-subtle)]" />
      </h3>
      {children}
    </section>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href.startsWith('http') ? href : `https://${href}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--indigo-text)] hover:underline break-all">
      {children}<ExternalLink className="h-3 w-3 flex-shrink-0 opacity-60" />
    </a>
  );
}

function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 300;
  return (
    <div>
      <p className={cn('text-body text-[var(--text-secondary)] whitespace-pre-line leading-relaxed', !open && long && 'line-clamp-5')}>{text}</p>
      {long && <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-caption font-medium text-[var(--indigo-text)] hover:underline">{open ? 'Show less' : 'Show more'}</button>}
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.slice(0, 30).map((s) => (
        <span key={s} className="inline-flex items-center px-1.5 h-[20px] rounded-md text-micro font-medium bg-[var(--bg-elevated)] text-[var(--text-secondary)]">{s}</span>
      ))}
    </div>
  );
}

const shortLinkedin = (url?: string | null) => (url || '').replace(/^https?:\/\/(www\.)?linkedin\.com\//, '').replace(/\/$/, '');
const fmtSize = (s?: string | null) => (s && /^\d+$/.test(s) ? Number(s).toLocaleString() : s || '');

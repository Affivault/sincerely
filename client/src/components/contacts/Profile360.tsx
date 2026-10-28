import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase, Building2, Calendar, ExternalLink, Globe, GraduationCap, Linkedin, Loader2, MapPin,
  ShieldCheck, Sparkles, Users,
} from 'lucide-react';
import {
  COMPANY_DIRECTORY_ATTRIBUTION, ENRICH_CREDIT_COST, creditsLabel, formatDate,
  type ContactEnrichment, type EnrichedCompany, type EnrichedPerson, type EnrichmentSuggestion,
} from '@lemlist/shared';
import { Avatar } from '../shared/Avatar';
import { TONE, type Tone } from '../ui/tone';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   The 360 profile on a contact's page.

   Everything Enrich found about the person, their company and their email,
   in one panel. Enrich only runs when somebody presses the button: it
   spends credits, so it never happens on its own.

   Where the fresh profile disagrees with what is on file (a new job title,
   say), it is offered with a "Use this" rather than written over what
   somebody typed.
   ═══════════════════════════════════════════════════════════════════════ */

const FIELD_LABEL: Record<EnrichmentSuggestion['field'], string> = {
  first_name: 'First name', last_name: 'Last name', job_title: 'Job title', company: 'Company',
  location: 'Location', linkedin_url: 'LinkedIn', website: 'Website',
};

/** Differences between the stored profile and the contact as it is now. */
export function suggestionsFor(contact: any, person: EnrichedPerson | null): EnrichmentSuggestion[] {
  if (!person) return [];
  const out: EnrichmentSuggestion[] = [];
  for (const field of ['job_title', 'company', 'location', 'first_name', 'last_name'] as const) {
    const suggested = (person[field] || '').trim();
    const current = String(contact?.[field] || '').trim();
    if (suggested && current && suggested.toLowerCase() !== current.toLowerCase()) out.push({ field, current, suggested });
  }
  return out;
}

function emailTone(score: number): Tone {
  return score >= 80 ? 'positive' : score >= 50 ? 'attention' : 'negative';
}

const VERIFIED_BY_WORD: Record<string, string> = {
  icypeas: 'Mailbox checked by Icypeas',
  mail_server: 'Checked with their mail server',
  dns: 'Only the address and domain could be checked',
};

export function Profile360({
  contact,
  enriching,
  verifying,
  onEnrich,
  onVerify,
  onApply,
}: {
  contact: any;
  enriching: boolean;
  verifying: boolean;
  onEnrich: () => void;
  onVerify: () => void;
  onApply: (field: EnrichmentSuggestion['field'], value: string) => void;
}) {
  const enrichment = (contact?.enrichment || null) as ContactEnrichment | null;
  const person = enrichment?.person || null;
  const company = enrichment?.company || null;
  const suggestions = suggestionsFor(contact, person);
  const verified = contact?.dcs_verified_at != null;
  const score = Number(contact?.dcs_score ?? 0);

  const enrichButton = (
    <button
      type="button"
      onClick={onEnrich}
      disabled={enriching}
      title={`Looks up their LinkedIn profile, their company and checks their email. Costs ${creditsLabel(ENRICH_CREDIT_COST)}, refunded if nothing is found.`}
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-[var(--indigo)] text-white text-caption font-semibold hover:bg-[var(--indigo-hover)] transition-colors disabled:opacity-60"
    >
      {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {enriching ? 'Enriching…' : `${enrichment ? 'Enrich again' : 'Enrich'} · ${creditsLabel(ENRICH_CREDIT_COST)}`}
    </button>
  );

  return (
    <section className="record-section" aria-label="360 profile">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-caption font-bold text-[var(--text-tertiary)]">360 profile</h2>
          {enrichment?.enriched_at && (
            <p className="text-micro text-[var(--text-tertiary)]">Enriched {formatDate(enrichment.enriched_at)}</p>
          )}
        </div>
        {enrichButton}
      </div>

      {/* The email, first: whether they can be written to at all. */}
      <div className="flex items-start gap-2.5 rounded-md bg-[var(--bg-elevated)] px-2.5 py-2 mb-3">
        <ShieldCheck className={cn('h-4 w-4 mt-px flex-shrink-0', verified ? TONE[emailTone(score)].icon : 'text-[var(--text-tertiary)]')} />
        <div className="min-w-0 flex-1 text-caption leading-snug">
          {verified ? (
            <>
              <p className="text-[var(--text-primary)] font-medium">
                {contact.is_bounced ? 'Bounced before' : score >= 80 ? 'Email is deliverable' : score >= 50 ? 'Email is risky' : 'Email is undeliverable'}
                <span className="ml-1.5 tabular text-[var(--text-tertiary)] font-normal">{score}/100</span>
              </p>
              <p className="text-[var(--text-tertiary)]">
                {[contact.dcs_fail_reason, VERIFIED_BY_WORD[contact.email_verified_by as string], `checked ${formatDate(contact.dcs_verified_at)}`].filter(Boolean).join(' · ')}
              </p>
            </>
          ) : (
            <p className="text-[var(--text-secondary)]">Email not checked yet.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          className="flex-shrink-0 inline-flex min-h-6 items-center gap-1 text-caption font-medium text-[var(--indigo-text)] hover:underline disabled:opacity-50"
        >
          {verifying && <Loader2 className="h-3 w-3 animate-spin" />}
          {verified ? 'Check again' : 'Verify'}
        </button>
      </div>

      {!enrichment ? (
        <div className="rounded-md border border-dashed border-[var(--border-default)] px-3 py-4 text-center">
          <p className="text-body text-[var(--text-primary)] font-medium">No profile yet</p>
          <p className="mt-1 text-caption text-[var(--text-tertiary)] max-w-md mx-auto">
            Enrich pulls in their LinkedIn profile, their career and education, and everything about the company they work for, then fills the blanks on this contact.
          </p>
        </div>
      ) : (
        <>
          {suggestions.length > 0 && (
            <div className="mb-3 rounded-md border border-[var(--indigo)]/20 bg-[var(--indigo-subtle)] px-2.5 py-2 space-y-1.5">
              <p className="text-caption font-medium text-[var(--text-primary)]">Their profile says something different</p>
              {suggestions.map((s) => (
                <div key={s.field} className="flex items-center gap-2 text-caption">
                  <span className="min-w-0 flex-1 text-[var(--text-secondary)]">
                    {FIELD_LABEL[s.field]}: <span className="line-through opacity-70">{s.current}</span>{' '}
                    <span className="text-[var(--text-primary)] font-medium">{s.suggested}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onApply(s.field, s.suggested)}
                    className="flex-shrink-0 inline-flex min-h-6 items-center font-medium text-[var(--indigo-text)] hover:underline"
                  >
                    Use this
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PersonColumn person={person} />
            <CompanyColumn company={company} companyId={contact.company_id} />
          </div>

          {enrichment.notes?.length > 0 && (
            <ul className="mt-3 space-y-0.5">
              {enrichment.notes.map((n, i) => (
                <li key={i} className="text-micro text-[var(--text-tertiary)]">{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Fact({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-caption text-[var(--text-secondary)] min-w-0">
      <Icon className="h-3.5 w-3.5 mt-px flex-shrink-0 text-[var(--text-tertiary)]" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href.startsWith('http') ? href : `https://${href}`} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[var(--text-primary)] hover:text-[var(--indigo-text)] hover:underline">
      {children}<ExternalLink className="h-3 w-3 opacity-60" />
    </a>
  );
}

/** Long text, a few lines at a time. */
function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280;
  return (
    <div>
      <p className={cn('text-caption text-[var(--text-secondary)] whitespace-pre-line leading-relaxed', !open && long && 'line-clamp-4')}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-0.5 text-micro font-medium text-[var(--indigo-text)] hover:underline">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 12);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <span key={s} className="inline-flex items-center px-1.5 h-[20px] rounded-md text-micro font-medium bg-[var(--bg-elevated)] text-[var(--text-secondary)]">{s}</span>
      ))}
      {items.length > 12 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="text-micro font-medium text-[var(--indigo-text)] hover:underline px-1">
          {all ? 'Fewer' : `+${items.length - 12} more`}
        </button>
      )}
    </div>
  );
}

const span = (start: string | null, end: string | null) =>
  start || end ? `${start || '?'} – ${end || 'now'}` : null;

function SubHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-micro font-semibold uppercase tracking-wide text-[var(--text-tertiary)] mt-3 mb-1.5">{children}</p>;
}

function PersonColumn({ person }: { person: EnrichedPerson | null }) {
  if (!person) {
    return (
      <div>
        <p className="text-caption font-semibold text-[var(--text-primary)] mb-1">The person</p>
        <p className="text-caption text-[var(--text-tertiary)]">Nothing found about them yet. The note below says why.</p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2.5 mb-2">
        {person.photo_url
          ? <img src={person.photo_url} alt="" className="h-10 w-10 rounded-full object-cover flex-shrink-0" referrerPolicy="no-referrer" />
          : <Avatar name={person.full_name || ''} size="md" />}
        <div className="min-w-0">
          <p className="text-strong text-[var(--text-primary)] truncate">{person.full_name}</p>
          {person.headline && <p className="text-caption text-[var(--text-secondary)] line-clamp-2">{person.headline}</p>}
        </div>
      </div>
      <div className="space-y-1">
        {(person.job_title || person.company) && <Fact icon={Briefcase}>{[person.job_title, person.company].filter(Boolean).join(' at ')}</Fact>}
        {person.location && <Fact icon={MapPin}>{person.location}</Fact>}
        {person.connections != null && <Fact icon={Users}>{person.connections.toLocaleString()} connections</Fact>}
        {person.linkedin_url && <Fact icon={Linkedin}><ExtLink href={person.linkedin_url}>LinkedIn profile</ExtLink></Fact>}
      </div>
      {person.summary && (<><SubHeading>About</SubHeading><Clamp text={person.summary} /></>)}
      {person.experience.length > 0 && (
        <>
          <SubHeading>Career</SubHeading>
          <ol className="space-y-1.5">
            {person.experience.map((j, i) => (
              <li key={i} className="text-caption leading-snug">
                <p className="text-[var(--text-primary)] font-medium">{j.title || 'Role'}{j.company && <span className="font-normal text-[var(--text-secondary)]"> · {j.company}</span>}</p>
                {(span(j.start, j.end) || j.location) && (
                  <p className="text-micro text-[var(--text-tertiary)]">{[span(j.start, j.end), j.location].filter(Boolean).join(' · ')}</p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      {person.education.length > 0 && (
        <>
          <SubHeading>Education</SubHeading>
          <ul className="space-y-1">
            {person.education.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-caption leading-snug">
                <GraduationCap className="h-3.5 w-3.5 mt-px flex-shrink-0 text-[var(--text-tertiary)]" />
                <span className="min-w-0">
                  <span className="text-[var(--text-primary)]">{e.school}</span>
                  {(e.degree || e.field) && <span className="text-[var(--text-secondary)]"> · {[e.degree, e.field].filter(Boolean).join(', ')}</span>}
                  {span(e.start, e.end) && <span className="block text-micro text-[var(--text-tertiary)]">{span(e.start, e.end)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {person.skills.length > 0 && (<><SubHeading>Skills</SubHeading><Chips items={person.skills} /></>)}
      {person.languages.length > 0 && (<><SubHeading>Languages</SubHeading><Chips items={person.languages} /></>)}
    </div>
  );
}

function CompanyColumn({ company, companyId }: { company: EnrichedCompany | null; companyId: string | null }) {
  if (!company) {
    return (
      <div>
        <p className="text-caption font-semibold text-[var(--text-primary)] mb-1">Their company</p>
        <p className="text-caption text-[var(--text-tertiary)]">Nothing found about their company yet.</p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2.5 mb-2">
        {company.logo_url
          ? <img src={company.logo_url} alt="" className="h-10 w-10 rounded-md object-contain bg-white flex-shrink-0" referrerPolicy="no-referrer" />
          : <span className="h-10 w-10 rounded-md bg-[var(--bg-elevated)] flex items-center justify-center flex-shrink-0"><Building2 className="h-4 w-4 text-[var(--text-tertiary)]" /></span>}
        <div className="min-w-0">
          {companyId
            ? <Link to={`/companies/${companyId}`} className="block text-strong text-[var(--text-primary)] hover:text-[var(--indigo-text)] truncate">{company.name || 'Company'}</Link>
            : <p className="text-strong text-[var(--text-primary)] truncate">{company.name || 'Company'}</p>}
          {company.industry && <p className="text-caption text-[var(--text-secondary)] truncate">{company.industry}</p>}
        </div>
      </div>
      <div className="space-y-1">
        {company.size && <Fact icon={Users}>{/^\d+$/.test(company.size) ? `${Number(company.size).toLocaleString()} employees` : `${company.size} employees`}</Fact>}
        {company.founded && <Fact icon={Calendar}>Founded {company.founded}</Fact>}
        {company.location && <Fact icon={MapPin}>{company.location}</Fact>}
        {company.website && <Fact icon={Globe}><ExtLink href={company.website}>{company.domain || company.website}</ExtLink></Fact>}
        {company.linkedin_url && <Fact icon={Linkedin}><ExtLink href={company.linkedin_url}>LinkedIn page</ExtLink>{company.followers != null && <span className="text-[var(--text-tertiary)]"> · {company.followers.toLocaleString()} followers</span>}</Fact>}
        {company.type && <Fact icon={Building2}>{company.type}</Fact>}
      </div>
      {company.description && (<><SubHeading>About</SubHeading><Clamp text={company.description} /></>)}
      {company.specialties.length > 0 && (<><SubHeading>Specialties</SubHeading><Chips items={company.specialties} /></>)}
      {/* The directory is CC BY 4.0: it has to be credited where it is shown. */}
      {company.sources?.includes('directory') && (
        <p className="mt-3 text-micro text-[var(--text-tertiary)]">
          Company data in part from{' '}
          <a href={COMPANY_DIRECTORY_ATTRIBUTION.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{COMPANY_DIRECTORY_ATTRIBUTION.source}</a>, licensed{' '}
          <a href={COMPANY_DIRECTORY_ATTRIBUTION.licenseUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{COMPANY_DIRECTORY_ATTRIBUTION.license}</a>.
        </p>
      )}
    </div>
  );
}

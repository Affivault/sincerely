import { useId } from 'react';
import {
  Briefcase, MapPin, Building2, UserRound, History, Users, Sparkles, GraduationCap, Languages, Wrench, Tag, Globe2, Landmark,
  type LucideIcon,
} from 'lucide-react';
import {
  PROSPECT_COMPANY_TYPES, PROSPECT_INDUSTRIES, PROSPECT_JOB_TITLES, PROSPECT_LANGUAGES, PROSPECT_SKILLS, INDUSTRY_ALIASES,
  rankSuggestions, countAdvancedFilters,
} from '@lemlist/shared';
import type { ProspectAdvancedValue, ProspectGrowthFilter, ProspectRangeFilter, ProspectTextFilter } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { TagFilter } from './TagFilter';

export type Advanced = Record<string, ProspectAdvancedValue>;

/** Everything the panel edits. The basic lists are what the extension and standing searches also send. */
export interface FilterState {
  titles: string[];
  locations: string[];
  industries: string[];
  companies: string[];
  seniorities: string[];
  companySizes: string[];
  keywords: string;
  advanced: Advanced;
}

export const EMPTY_FILTERS: FilterState = {
  titles: [], locations: [], industries: [], companies: [], seniorities: [], companySizes: [], keywords: '', advanced: {},
};

export const SENIORITIES = [
  { value: 'owner', label: 'Owner' },
  { value: 'c_suite', label: 'C-Suite' },
  { value: 'vp', label: 'VP' },
  { value: 'director', label: 'Director' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'entry', label: 'Entry' },
];
export const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'];

const SPANS: { value: ProspectGrowthFilter['timespan']; label: string }[] = [
  { value: '6months', label: '6 mo' },
  { value: '12months', label: '12 mo' },
  { value: '24months', label: '24 mo' },
];

const titleSuggest = (q: string) => rankSuggestions(PROSPECT_JOB_TITLES, q, 40);
const industrySuggest = (q: string) => rankSuggestions(PROSPECT_INDUSTRIES, q, 500, INDUSTRY_ALIASES);
const skillSuggest = (q: string) => rankSuggestions(PROSPECT_SKILLS, q, 40);
const languageSuggest = (q: string) => rankSuggestions(PROSPECT_LANGUAGES, q, 40);

const inputClass = 'block w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)] tabular placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)] transition-[border-color,box-shadow]';
const toggleClass = (on: boolean) => cn(
  'h-6 px-2 rounded-md text-caption font-medium border transition-colors',
  on ? 'bg-[var(--indigo-subtle)] border-[var(--indigo)]/30 text-[var(--indigo-text)]' : 'border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:border-[var(--border-default)] hover:text-[var(--text-secondary)]',
);

function Section({ icon: Icon, title, count, children }: { icon: LucideIcon; title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-3 pt-4 first:pt-0">
      <h3 className="flex items-center gap-1.5 text-caption font-semibold text-[var(--text-primary)]">
        <Icon className="h-3.5 w-3.5 text-[var(--indigo-text)]" /> {title}
        {count > 0 && <span className="text-micro font-medium text-[var(--indigo-text)] tabular">· {count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Toggles({ label, icon: Icon, options, value, onChange }: {
  label: string; icon: LucideIcon; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <span className="flex items-center gap-1.5 text-caption font-medium text-[var(--text-secondary)] mb-1">
        <Icon className="h-3 w-3 text-[var(--text-tertiary)]" /> {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button key={o.value} type="button" aria-pressed={on} className={cn(toggleClass(on), 'tabular')}
              onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Range({ label, unit, value, onChange, minHint = 'Min', maxHint = 'Max' }: {
  label: string; unit?: string; value: ProspectRangeFilter | undefined; onChange: (v: ProspectRangeFilter) => void; minHint?: string; maxHint?: string;
}) {
  const id = useId();
  const read = (s: string) => (s.trim() === '' ? null : Number(s));
  return (
    <div>
      <label htmlFor={`${id}-min`} className="text-caption font-medium text-[var(--text-secondary)] mb-1 block">
        {label}{unit ? <span className="text-[var(--text-tertiary)]"> ({unit})</span> : null}
      </label>
      <div className="flex items-center gap-1.5">
        <input id={`${id}-min`} type="number" inputMode="numeric" min={0} placeholder={minHint === 'Min' ? minHint : `Min, e.g. ${minHint}`} aria-label={`${label} minimum`}
          value={value?.min ?? ''} onChange={(e) => onChange({ ...value, min: read(e.target.value) })} className={inputClass} />
        <span className="text-caption text-[var(--text-tertiary)]">to</span>
        <input type="number" inputMode="numeric" min={0} placeholder={maxHint === 'Max' || !maxHint ? 'Max' : `Max, e.g. ${maxHint}`} aria-label={`${label} maximum`}
          value={value?.max ?? ''} onChange={(e) => onChange({ ...value, max: read(e.target.value) })} className={inputClass} />
      </div>
    </div>
  );
}

function Growth({ label, value, onChange }: { label: string; value: ProspectGrowthFilter | undefined; onChange: (v: ProspectGrowthFilter) => void }) {
  const id = useId();
  const current: ProspectGrowthFilter = value || { timespan: '12months' };
  const read = (s: string) => (s.trim() === '' ? null : Number(s));
  return (
    <div>
      <label htmlFor={`${id}-min`} className="text-caption font-medium text-[var(--text-secondary)] mb-1 block">
        {label} <span className="text-[var(--text-tertiary)]">(%)</span>
      </label>
      <div className="flex items-center gap-1.5">
        <input id={`${id}-min`} type="number" placeholder="Min, e.g. 20" aria-label={`${label} minimum %`}
          value={current.min ?? ''} onChange={(e) => onChange({ ...current, min: read(e.target.value) })} className={inputClass} />
        <input type="number" placeholder="Max" aria-label={`${label} maximum %`}
          value={current.max ?? ''} onChange={(e) => onChange({ ...current, max: read(e.target.value) })} className={inputClass} />
        <select value={current.timespan} aria-label={`${label} period`}
          onChange={(e) => onChange({ ...current, timespan: e.target.value as ProspectGrowthFilter['timespan'] })}
          className={cn(inputClass, 'w-auto flex-shrink-0 pr-1')}>
          {SPANS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
    </div>
  );
}

const hasText = (v: ProspectAdvancedValue | undefined) => countAdvancedFilters(v ? { x: v } : undefined) > 0;

/**
 * Every people-search filter in one view: no hidden step. Each box takes as
 * many values as Icypeas does (200), suggests real values as you type, and
 * can leave values out. `full` is false for providers without the extra
 * filters, which then get the core set only.
 */
export function FilterPanel({ value, onChange, full, onSubmit }: {
  value: FilterState;
  onChange: (next: FilterState) => void;
  full: boolean;
  /** Enter in the plain keywords box. */
  onSubmit: () => void;
}) {
  const a11yId = useId();
  const adv = value.advanced;
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const setAdv = (key: string, v: ProspectAdvancedValue) => set({ advanced: { ...adv, [key]: v } });
  const text = (key: string) => (adv[key] as ProspectTextFilter | undefined) || {};
  const excl = (key: string) => (full ? text(key).exclude || [] : undefined);

  // A basic list (sent as titles, locations...) with its excludes kept with the advanced filters.
  const basic = (field: 'titles' | 'locations' | 'industries' | 'companies', key: string) => ({
    include: value[field],
    exclude: excl(key),
    onChange: (include: string[], exclude: string[]) =>
      onChange({ ...value, [field]: include, advanced: { ...adv, [key]: { ...text(key), include: undefined, exclude } } }),
  });
  // A filter that only exists in the advanced set.
  const extra = (key: string) => ({
    include: text(key).include || [],
    exclude: text(key).exclude || [],
    onChange: (include: string[], exclude: string[]) => setAdv(key, { include, exclude }),
  });

  const count = (...keys: string[]) => keys.filter((k) => hasText(adv[k])).length;
  const roleCount = (value.titles.length ? 1 : 0) + (value.seniorities.length ? 1 : 0) + count('skills', 'totalYearsOfExperience', 'timeInCurrentCompany') + (value.titles.length ? 0 : count('currentJobTitle'));
  const placeCount = (value.locations.length ? 1 : 0) + count('currentCompany.location', 'profileLocation', 'workLocation') + (value.locations.length ? 0 : count('location'));
  const companyCount = (value.companies.length ? 1 : 0) + (value.industries.length ? 1 : 0) + (value.companySizes.length ? 1 : 0)
    + count('currentCompany.type', 'currentCompany.keyword', 'currentCompany.headcount', 'currentCompany.revenue', 'currentCompany.headcountGrowth');
  const personCount = count('keyword', 'languages', 'school', 'firstname', 'lastname') + (value.keywords.trim() ? 1 : 0);
  const pastCount = count('pastJobTitle', 'pastCompanyName', 'pastCompanyWebsite', 'pastCompany.industry', 'pastCompany.type', 'pastCompany.location', 'pastCompany.keyword', 'pastCompany.headcount', 'pastCompany.revenue', 'pastCompany.headcountGrowth');

  const companyTypes = PROSPECT_COMPANY_TYPES.map((t) => ({ value: t, label: t }));

  return (
    <div className="divide-y divide-[var(--border-subtle)] [&>section]:pb-4 [&>section:last-child]:pb-0">
      <Section icon={Briefcase} title="Role" count={roleCount}>
        <TagFilter label="Job title" {...basic('titles', 'currentJobTitle')} suggest={titleSuggest}
          examples={['Head of Growth', 'Founder', 'VP Sales', 'CMO', 'RevOps Lead', 'Managing Partner']} />
        <Toggles label="Seniority" icon={Users} options={SENIORITIES} value={value.seniorities} onChange={(seniorities) => set({ seniorities })} />
        {full && (
          <>
            <TagFilter label="Skills" icon={Wrench} {...extra('skills')} suggest={skillSuggest} offset={1}
              examples={['Salesforce', 'Cold Email', 'Python', 'Shopify', 'Demand Generation']} />
            <Range label="Years of experience" value={adv.totalYearsOfExperience as ProspectRangeFilter} minHint="3" maxHint="15"
              onChange={(v) => setAdv('totalYearsOfExperience', v)} />
            <Range label="Years in current company" value={adv.timeInCurrentCompany as ProspectRangeFilter} minHint="0" maxHint="2"
              onChange={(v) => setAdv('timeInCurrentCompany', v)} />
          </>
        )}
      </Section>

      <Section icon={MapPin} title="Location" count={placeCount}>
        <TagFilter label="Based in" {...basic('locations', 'location')} remote="locations" preferPick listSeparator={false} offset={2}
          examples={['Manchester', 'Texas', 'DACH', 'Greater London', 'Lisbon', 'the Nordics']} />
        {full && (
          <>
            <TagFilter label="Company HQ" icon={Landmark} {...extra('currentCompany.location')} remote="locations" preferPick listSeparator={false} offset={3}
              examples={['San Francisco', 'Berlin', 'United Kingdom', 'Ontario']} />
            <TagFilter label="Profile location" icon={Globe2} {...extra('profileLocation')} remote="locations" preferPick listSeparator={false} offset={4}
              examples={['Dublin', 'Bavaria', 'Australia']} prefix="As on their profile:" />
            <TagFilter label="Job location" icon={Briefcase} {...extra('workLocation')} remote="locations" preferPick listSeparator={false} offset={5}
              examples={['Remote', 'Amsterdam', 'New York']} prefix="Where the job is:" />
          </>
        )}
      </Section>

      <Section icon={Building2} title="Company" count={companyCount}>
        <TagFilter label="Company or domain" {...basic('companies', 'currentCompanyName')} offset={1}
          examples={['stripe.com', 'Notion', 'Shopify', 'monzo.com', 'HubSpot']} />
        <TagFilter label="Industry" icon={Sparkles} {...basic('industries', 'currentCompany.industry')} suggest={industrySuggest} preferPick listSeparator={false} offset={2}
          examples={['Software Development', 'SaaS', 'Marketing Services', 'Fintech', 'Staffing and Recruiting']} />
        <Toggles label="Headcount" icon={Users} options={COMPANY_SIZES.map((s) => ({ value: s, label: s }))} value={value.companySizes}
          onChange={(companySizes) => set({ companySizes })} />
        {full && (
          <>
            <Range label="Or an exact headcount" unit="people" value={adv['currentCompany.headcount'] as ProspectRangeFilter} minHint="25" maxHint="400"
              onChange={(v) => setAdv('currentCompany.headcount', v)} />
            <Toggles label="Company type" icon={Tag} options={companyTypes} value={text('currentCompany.type').include || []}
              onChange={(include) => setAdv('currentCompany.type', { ...text('currentCompany.type'), include })} />
            <TagFilter label="Company keywords" icon={Tag} {...extra('currentCompany.keyword')} offset={3}
              examples={['B2B', 'e-commerce', 'marketplace', 'AI', 'Shopify Plus']} prefix="What they do:" />
            <Range label="Revenue" unit="USD" value={adv['currentCompany.revenue'] as ProspectRangeFilter}
              onChange={(v) => setAdv('currentCompany.revenue', v)} />
            <Growth label="Headcount growth" value={adv['currentCompany.headcountGrowth'] as ProspectGrowthFilter}
              onChange={(v) => setAdv('currentCompany.headcountGrowth', v)} />
          </>
        )}
      </Section>

      <Section icon={UserRound} title="Person" count={personCount}>
        {full ? (
          <TagFilter label="Profile keywords" icon={Tag} {...extra('keyword')} offset={4}
            examples={['outbound', 'PLG', 'bootstrapped', 'ex-Google', 'hiring']} prefix="Anywhere on their profile:" />
        ) : (
          <div>
            <label htmlFor={`${a11yId}-kw`} className="text-caption font-medium text-[var(--text-secondary)] mb-1 block">Keywords</label>
            <input id={`${a11yId}-kw`} value={value.keywords} onChange={(e) => set({ keywords: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
              placeholder="outbound, PLG, agency…" className={inputClass} />
          </div>
        )}
        {full && (
          <>
            <TagFilter label="Languages" icon={Languages} {...extra('languages')} suggest={languageSuggest} preferPick offset={1}
              examples={['French', 'Spanish', 'German', 'Arabic']} prefix="Speaks" />
            <TagFilter label="School or university" icon={GraduationCap} {...extra('school')} offset={2}
              examples={['Stanford', 'HEC Paris', 'LSE', 'INSEAD', 'Y Combinator']} />
            <div className="grid grid-cols-2 gap-2">
              <TagFilter label="First name" {...extra('firstname')} examples={['Sarah', 'James']} prefix="" offset={3} />
              <TagFilter label="Last name" {...extra('lastname')} examples={['Smith', 'Okafor']} prefix="" offset={4} />
            </div>
          </>
        )}
      </Section>

      {full && (
        <Section icon={History} title="Career history" count={pastCount}>
          <TagFilter label="Past job title" {...extra('pastJobTitle')} suggest={titleSuggest} offset={5}
            examples={['Founder', 'SDR', 'Consultant at McKinsey', 'Product Manager']} prefix="Used to be" />
          <TagFilter label="Past company" {...extra('pastCompanyName')} offset={1}
            examples={['Salesforce', 'HubSpot', 'Google', 'Deloitte']} prefix="Alumni of" />
          <TagFilter label="Past company website" {...extra('pastCompanyWebsite')} offset={2} examples={['hubspot.com', 'stripe.com']} />
          <TagFilter label="Past industry" icon={Sparkles} {...extra('pastCompany.industry')} suggest={industrySuggest} preferPick listSeparator={false} offset={3}
            examples={['Management Consulting', 'Banking', 'Software Development']} />
          <Toggles label="Past company type" icon={Tag} options={companyTypes} value={text('pastCompany.type').include || []}
            onChange={(include) => setAdv('pastCompany.type', { ...text('pastCompany.type'), include })} />
          <TagFilter label="Past company location" icon={MapPin} {...extra('pastCompany.location')} remote="locations" preferPick listSeparator={false} offset={4}
            examples={['Paris', 'Silicon Valley', 'Singapore']} />
          <TagFilter label="Past company keywords" icon={Tag} {...extra('pastCompany.keyword')} offset={5} examples={['unicorn', 'agency', 'SaaS']} />
          <Range label="Past company headcount" unit="people" value={adv['pastCompany.headcount'] as ProspectRangeFilter} minHint="1000"
            onChange={(v) => setAdv('pastCompany.headcount', v)} />
          <Range label="Past company revenue" unit="USD" value={adv['pastCompany.revenue'] as ProspectRangeFilter}
            onChange={(v) => setAdv('pastCompany.revenue', v)} />
          <Growth label="Past company headcount growth" value={adv['pastCompany.headcountGrowth'] as ProspectGrowthFilter}
            onChange={(v) => setAdv('pastCompany.headcountGrowth', v)} />
        </Section>
      )}
    </div>
  );
}

/** How many filters hold a value, for the panel header. */
export function countFilters(f: FilterState): number {
  return [f.titles, f.locations, f.industries, f.companies, f.seniorities, f.companySizes].filter((l) => l.length).length
    + (f.keywords.trim() ? 1 : 0) + countAdvancedFilters(f.advanced);
}

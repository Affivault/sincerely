import { useId } from 'react';
import {
  Briefcase, MapPin, Building2, History, Users, Sparkles, GraduationCap, Languages, Wrench, Tag, Landmark, Hourglass,
  ChevronDown, CircleDollarSign, TrendingUp, Search, Contact, Globe2, Layers,
  type LucideIcon,
} from 'lucide-react';
import {
  PROSPECT_COMPANY_TYPES, PROSPECT_INDUSTRIES, PROSPECT_LANGUAGES, INDUSTRY_ALIASES, PROSPECT_TITLE_PACKS, PROSPECT_SKILL_PACKS,
  EXPERIENCE_PRESETS, TENURE_PRESETS, REVENUE_PRESETS, GROWTH_PRESETS,
  rankSuggestions, suggestTitles, suggestSkills, countAdvancedFilters, prospectValueLabel,
} from '@lemlist/shared';
import type { ProspectAdvancedValue, ProspectGrowthFilter, ProspectRangeFilter, ProspectTextFilter, RangePreset } from '@lemlist/shared';
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

/** The rows open when the page loads: the three filters nearly every search starts from. */
export const DEFAULT_OPEN_ROWS = ['title', 'location', 'industry'];

const SPANS: { value: ProspectGrowthFilter['timespan']; label: string }[] = [
  { value: '6months', label: '6 mo' },
  { value: '12months', label: '12 mo' },
  { value: '24months', label: '24 mo' },
];

const industrySuggest = (q: string) => rankSuggestions(PROSPECT_INDUSTRIES, q, 500, INDUSTRY_ALIASES);
const languageSuggest = (q: string) => rankSuggestions(PROSPECT_LANGUAGES, q, 40);

const inputClass = 'block w-full h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)] tabular placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--indigo)] focus:outline-none focus:shadow-[var(--ring-focus)] transition-[border-color,box-shadow]';
const chipClass = (on: boolean) => cn(
  'inline-flex items-center h-7 px-2.5 rounded-md text-caption font-medium border transition-colors tabular',
  on ? 'bg-[var(--indigo-subtle)] border-[var(--indigo)]/30 text-[var(--indigo-text)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]',
);

const hasValue = (v: ProspectAdvancedValue | undefined) => countAdvancedFilters(v ? { x: v } : undefined) > 0;
const fmtNum = (n: number) => (Math.abs(n) >= 1e9 ? `${n / 1e9}B` : Math.abs(n) >= 1e6 ? `${n / 1e6}M` : Math.abs(n) >= 1e3 ? `${n / 1e3}k` : String(n));
const rangeText = (v: ProspectRangeFilter | undefined, unit = '', presets?: RangePreset[]) => {
  if (!v || (v.min == null && v.max == null)) return '';
  const preset = presets?.find((p) => p.min === (v.min ?? null) && p.max === (v.max ?? null));
  if (preset) return preset.label;
  if (v.min != null && v.max != null) return `${fmtNum(v.min)}-${fmtNum(v.max)}${unit}`;
  return v.min != null ? `${fmtNum(v.min)}+${unit}` : `up to ${fmtNum(v.max as number)}${unit}`;
};

/* ─── Building blocks ─────────────────────────────────────────────────── */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="px-4 pt-4 pb-1.5 text-micro font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{children}</h3>;
}

/**
 * One filter: a row that names it and, when closed, shows what it holds.
 * Every filter has its own row, so nothing hides behind a catch-all step.
 */
function FilterRow({ id, icon: Icon, title, summary, count, open, onToggle, children }: {
  id: string; icon: LucideIcon; title: string; summary: string; count: number; open: boolean; onToggle: (id: string) => void; children: React.ReactNode;
}) {
  const bodyId = useId();
  const active = count > 0;
  return (
    <div className={cn('border-t border-[var(--border-subtle)] first:border-t-0', open && 'bg-[var(--bg-app)]/40')}>
      <button type="button" onClick={() => onToggle(id)} aria-expanded={open} aria-controls={bodyId}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-[var(--bg-elevated)]/60 transition-colors">
        <Icon className={cn('h-4 w-4 flex-shrink-0', active ? 'text-[var(--indigo-text)]' : 'text-[var(--text-tertiary)]')} />
        <span className="flex-1 min-w-0">
          <span className="block text-body font-medium text-[var(--text-primary)]">{title}</span>
          {!open && summary && <span className="block text-caption text-[var(--indigo-text)] truncate">{summary}</span>}
        </span>
        {active && (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[var(--indigo-subtle)] text-micro font-semibold text-[var(--indigo-text)] tabular">{count}</span>
        )}
        <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-[var(--text-tertiary)] transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div id={bodyId} className="px-4 pb-4 pt-0.5 space-y-3">{children}</div>}
    </div>
  );
}

function SubLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="block mb-1 text-caption font-medium text-[var(--text-secondary)]">{children}</label>;
}

function Toggles({ options, value, onChange, label }: {
  options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} className={chipClass(on)}
            onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** One-click ranges, with Custom for anything else. */
function PresetRange({ label, presets, value, onChange, unit }: {
  label: string; presets: RangePreset[]; value: ProspectRangeFilter | undefined; onChange: (v: ProspectRangeFilter) => void; unit?: string;
}) {
  const id = useId();
  const min = value?.min ?? null, max = value?.max ?? null;
  const set = min !== null || max !== null;
  const preset = presets.find((p) => p.min === min && p.max === max);
  const custom = set && !preset;
  const read = (s: string) => (s.trim() === '' ? null : Number(s));
  return (
    <div className="space-y-2">
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const on = preset === p;
          return (
            <button key={p.label} type="button" aria-pressed={on} className={chipClass(on)}
              onClick={() => onChange(on ? { min: null, max: null } : { min: p.min, max: p.max })}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <span className={cn('text-caption flex-shrink-0', custom ? 'text-[var(--indigo-text)] font-medium' : 'text-[var(--text-tertiary)]')}>Custom</span>
        <input id={`${id}-min`} type="number" inputMode="numeric" placeholder="Min" aria-label={`${label} minimum`}
          value={min ?? ''} onChange={(e) => onChange({ min: read(e.target.value), max })} className={inputClass} />
        <span className="text-caption text-[var(--text-tertiary)]">to</span>
        <input type="number" inputMode="numeric" placeholder="Max" aria-label={`${label} maximum`}
          value={max ?? ''} onChange={(e) => onChange({ min, max: read(e.target.value) })} className={inputClass} />
        {unit && <span className="text-caption text-[var(--text-tertiary)] flex-shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

function GrowthPicker({ label, value, onChange }: { label: string; value: ProspectGrowthFilter | undefined; onChange: (v: ProspectGrowthFilter) => void }) {
  const current: ProspectGrowthFilter = value || { timespan: '12months' };
  return (
    <div className="space-y-2">
      <PresetRange label={label} presets={GROWTH_PRESETS} unit="%" value={current}
        onChange={(r) => onChange({ ...current, min: r.min, max: r.max })} />
      <div className="flex items-center gap-1.5">
        <span className="text-caption text-[var(--text-tertiary)]">Over the last</span>
        <div role="group" aria-label={`${label} period`} className="inline-flex rounded-md border border-[var(--border-subtle)] p-px">
          {SPANS.map((s) => (
            <button key={s.value} type="button" aria-pressed={current.timespan === s.value}
              onClick={() => onChange({ ...current, timespan: s.value })}
              className={cn('h-6 px-2 rounded text-caption font-medium transition-colors',
                current.timespan === s.value ? 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]')}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── The panel ───────────────────────────────────────────────────────── */

/**
 * Every people-search filter, one row each, grouped the way a buyer is
 * described: who they are, where, the company they work for, and where
 * they worked before. Rows open in place, and the header can open them all.
 * `full` is false for providers without the extra filters, which then get
 * the core rows only.
 */
export function FilterPanel({ value, onChange, full, onSubmit, openRows, onToggleRow }: {
  value: FilterState;
  onChange: (next: FilterState) => void;
  full: boolean;
  /** Enter in the plain keywords box. */
  onSubmit: () => void;
  openRows: Set<string>;
  onToggleRow: (id: string) => void;
}) {
  const a11yId = useId();
  const adv = value.advanced;
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const setAdv = (key: string, v: ProspectAdvancedValue) => set({ advanced: { ...adv, [key]: v } });
  const text = (key: string) => (adv[key] as ProspectTextFilter | undefined) || {};
  const range = (key: string) => adv[key] as ProspectRangeFilter | undefined;
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

  // What a closed row shows: its values, then what it leaves out.
  const listSummary = (include: string[], exclude: string[] = []) => {
    const parts = [...include.map(prospectValueLabel), ...exclude.map((v) => `not ${prospectValueLabel(v)}`)];
    return parts.length > 3 ? `${parts.slice(0, 3).join(', ')} +${parts.length - 3}` : parts.join(', ');
  };
  const textSummary = (...keys: string[]) => listSummary(keys.flatMap((k) => text(k).include || []), keys.flatMap((k) => text(k).exclude || []));
  const n = (...keys: string[]) => keys.reduce((sum, k) => {
    const t = text(k);
    return sum + (t.include?.length || 0) + (t.exclude?.length || 0) + (!t.include && !t.exclude && hasValue(adv[k]) ? 1 : 0);
  }, 0);
  const ranged = (...keys: string[]) => keys.filter((k) => hasValue(adv[k])).length;

  const companyTypes = PROSPECT_COMPANY_TYPES.map((t) => ({ value: t, label: t }));
  const row = (id: string, icon: LucideIcon, title: string, summary: string, count: number, body: React.ReactNode) => (
    <FilterRow key={id} id={id} icon={icon} title={title} summary={summary} count={count} open={openRows.has(id)} onToggle={onToggleRow}>{body}</FilterRow>
  );

  return (
    <div>
      <SectionHeading>Who</SectionHeading>
      <div>
        {row('title', Briefcase, 'Job title', listSummary(value.titles, excl('currentJobTitle')), value.titles.length + (excl('currentJobTitle')?.length || 0), (
          <TagFilter name="Job title" {...basic('titles', 'currentJobTitle')} suggest={suggestTitles} quickPicks={PROSPECT_TITLE_PACKS}
            examples={['Head of Growth', 'Founder', 'VP Sales', 'CMO', 'RevOps Lead', 'Managing Partner']} />
        ))}
        {row('seniority', Layers, 'Seniority', value.seniorities.map((s) => SENIORITIES.find((o) => o.value === s)?.label || s).join(', '), value.seniorities.length, (
          <Toggles label="Seniority" options={SENIORITIES} value={value.seniorities} onChange={(seniorities) => set({ seniorities })} />
        ))}
        {full && row('skills', Wrench, 'Skills', textSummary('skills'), n('skills'), (
          <TagFilter name="Skills" {...extra('skills')} suggest={suggestSkills} quickPicks={PROSPECT_SKILL_PACKS} offset={1}
            examples={['Salesforce', 'Cold Email', 'Shopify', 'Python', 'Demand Generation', 'Fundraising']} />
        ))}
        {full && row('experience', Hourglass, 'Experience',
          [rangeText(range('totalYearsOfExperience'), ' yrs', EXPERIENCE_PRESETS), rangeText(range('timeInCurrentCompany'), ' yrs', TENURE_PRESETS) && `${rangeText(range('timeInCurrentCompany'), ' yrs', TENURE_PRESETS)} in role`].filter(Boolean).join(' · '),
          ranged('totalYearsOfExperience', 'timeInCurrentCompany'), (
          <>
            <div>
              <SubLabel>Years of experience in total</SubLabel>
              <PresetRange label="Years of experience" presets={EXPERIENCE_PRESETS} unit="yrs" value={range('totalYearsOfExperience')} onChange={(v) => setAdv('totalYearsOfExperience', v)} />
            </div>
            <div>
              <SubLabel>Time at their current company</SubLabel>
              <PresetRange label="Years at current company" presets={TENURE_PRESETS} unit="yrs" value={range('timeInCurrentCompany')} onChange={(v) => setAdv('timeInCurrentCompany', v)} />
            </div>
          </>
        ))}
        {row('keywords', Search, 'Profile keywords', full ? textSummary('keyword') : value.keywords, full ? n('keyword') : value.keywords.trim() ? 1 : 0, full ? (
          <TagFilter name="Profile keywords" {...extra('keyword')} offset={4}
            examples={['outbound', 'PLG', 'bootstrapped', 'ex-Google', 'hiring']} prefix="Anywhere on their profile:" />
        ) : (
          <input id={`${a11yId}-kw`} aria-label="Keywords" value={value.keywords} onChange={(e) => set({ keywords: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }} placeholder="outbound, PLG, agency…" className={inputClass} />
        ))}
        {full && row('languages', Languages, 'Languages', textSummary('languages'), n('languages'), (
          <TagFilter name="Languages" {...extra('languages')} suggest={languageSuggest} preferPick offset={1}
            quickPicks={[{ label: 'English', values: ['English'] }, { label: 'French', values: ['French'] }, { label: 'German', values: ['German'] }, { label: 'Spanish', values: ['Spanish'] }]}
            examples={['French', 'Spanish', 'German', 'Arabic']} prefix="Speaks" />
        ))}
        {full && row('school', GraduationCap, 'Education', textSummary('school'), n('school'), (
          <TagFilter name="School or university" {...extra('school')} offset={2}
            examples={['Stanford', 'HEC Paris', 'LSE', 'INSEAD', 'Harvard Business School']} prefix="Studied at" />
        ))}
        {full && row('name', Contact, 'Name', textSummary('firstname', 'lastname'), n('firstname', 'lastname'), (
          <>
            <TagFilter label="First name" {...extra('firstname')} examples={['Sarah', 'James', 'Priya']} prefix="" offset={3} />
            <TagFilter label="Last name" {...extra('lastname')} examples={['Smith', 'Okafor', 'Garcia']} prefix="" offset={4} />
          </>
        ))}
      </div>

      <SectionHeading>Where</SectionHeading>
      <div>
        {row('location', MapPin, 'Location', listSummary(value.locations, excl('location')), value.locations.length + (excl('location')?.length || 0), (
          <TagFilter name="Location" {...basic('locations', 'location')} remote="locations" preferPick listSeparator={false} offset={2}
            quickPicks={[
              { label: 'United States', values: ['US'] }, { label: 'United Kingdom', values: ['GB'] }, { label: 'DACH', values: ['group:dach'] },
              { label: 'Nordics', values: ['group:nordics'] }, { label: 'Europe', values: ['group:europe'] }, { label: 'APAC', values: ['group:apac'] },
            ]}
            examples={['Manchester', 'Texas', 'DACH', 'Greater London', 'Lisbon', 'the Nordics']} />
        ))}
        {full && row('otherLocation', Globe2, 'Profile and job location', textSummary('profileLocation', 'workLocation'), n('profileLocation', 'workLocation'), (
          <>
            <TagFilter label="Location written on their profile" {...extra('profileLocation')} remote="locations" preferPick listSeparator={false} offset={4}
              examples={['Dublin', 'Bavaria', 'Australia']} />
            <TagFilter label="Where their job is based" {...extra('workLocation')} remote="locations" preferPick listSeparator={false} offset={5}
              examples={['Remote', 'Amsterdam', 'New York']} />
          </>
        ))}
      </div>

      <SectionHeading>Company</SectionHeading>
      <div>
        {row('company', Building2, 'Company', listSummary(value.companies, excl('currentCompanyName')), value.companies.length + (excl('currentCompanyName')?.length || 0), (
          <TagFilter name="Company name or domain" {...basic('companies', 'currentCompanyName')} offset={1}
            examples={['stripe.com', 'Notion', 'Shopify', 'monzo.com', 'HubSpot']} prefix="Name or domain, e.g." />
        ))}
        {row('industry', Sparkles, 'Industry', listSummary(value.industries, excl('currentCompany.industry')), value.industries.length + (excl('currentCompany.industry')?.length || 0), (
          <TagFilter name="Industry" {...basic('industries', 'currentCompany.industry')} suggest={industrySuggest} preferPick listSeparator={false} offset={2}
            quickPicks={[
              { label: 'Software', values: ['Software Development'] }, { label: 'Marketing', values: ['Marketing Services', 'Advertising Services'] },
              { label: 'Financial services', values: ['Financial Services'] }, { label: 'Recruiting', values: ['Staffing and Recruiting'] },
              { label: 'Retail', values: ['Retail', 'Online and Mail Order Retail'] }, { label: 'Consulting', values: ['Business Consulting and Services'] },
            ]}
            examples={['Software Development', 'SaaS', 'Marketing Services', 'Fintech', 'Staffing and Recruiting']} />
        ))}
        {row('headcount', Users, 'Headcount',
          [value.companySizes.join(', '), full ? rangeText(range('currentCompany.headcount'), ' people') : ''].filter(Boolean).join(' · '),
          value.companySizes.length + (full ? ranged('currentCompany.headcount') : 0), (
          <>
            <Toggles label="Headcount" options={COMPANY_SIZES.map((s) => ({ value: s, label: s }))} value={value.companySizes} onChange={(companySizes) => set({ companySizes })} />
            {full && (
              <div className="flex items-center gap-1.5">
                <span className="text-caption text-[var(--text-tertiary)] flex-shrink-0">Exactly</span>
                <input type="number" inputMode="numeric" placeholder="Min" aria-label="Headcount minimum" className={inputClass}
                  value={range('currentCompany.headcount')?.min ?? ''} onChange={(e) => setAdv('currentCompany.headcount', { ...range('currentCompany.headcount'), min: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
                <span className="text-caption text-[var(--text-tertiary)]">to</span>
                <input type="number" inputMode="numeric" placeholder="Max" aria-label="Headcount maximum" className={inputClass}
                  value={range('currentCompany.headcount')?.max ?? ''} onChange={(e) => setAdv('currentCompany.headcount', { ...range('currentCompany.headcount'), max: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
                <span className="text-caption text-[var(--text-tertiary)] flex-shrink-0">people</span>
              </div>
            )}
          </>
        ))}
        {full && row('revenue', CircleDollarSign, 'Revenue', rangeText(range('currentCompany.revenue'), '', REVENUE_PRESETS), ranged('currentCompany.revenue'), (
          <PresetRange label="Revenue" presets={REVENUE_PRESETS} unit="USD" value={range('currentCompany.revenue')} onChange={(v) => setAdv('currentCompany.revenue', v)} />
        ))}
        {full && row('growth', TrendingUp, 'Headcount growth', rangeText(range('currentCompany.headcountGrowth'), '%', GROWTH_PRESETS), ranged('currentCompany.headcountGrowth'), (
          <GrowthPicker label="Headcount growth" value={adv['currentCompany.headcountGrowth'] as ProspectGrowthFilter} onChange={(v) => setAdv('currentCompany.headcountGrowth', v)} />
        ))}
        {full && row('companyType', Tag, 'Company type', (text('currentCompany.type').include || []).join(', '), n('currentCompany.type'), (
          <Toggles label="Company type" options={companyTypes} value={text('currentCompany.type').include || []}
            onChange={(include) => setAdv('currentCompany.type', { ...text('currentCompany.type'), include })} />
        ))}
        {full && row('hq', Landmark, 'Company HQ', textSummary('currentCompany.location'), n('currentCompany.location'), (
          <TagFilter name="Company HQ" {...extra('currentCompany.location')} remote="locations" preferPick listSeparator={false} offset={3}
            examples={['San Francisco', 'Berlin', 'United Kingdom', 'Ontario']} />
        ))}
        {full && row('companyKeywords', Search, 'What the company does', textSummary('currentCompany.keyword'), n('currentCompany.keyword'), (
          <TagFilter name="Company keywords" {...extra('currentCompany.keyword')} offset={3}
            examples={['B2B', 'e-commerce', 'marketplace', 'AI', 'Shopify Plus']} prefix="Keywords, e.g." />
        ))}
      </div>

      {full && (
        <>
          <SectionHeading>Career history</SectionHeading>
          <div>
            {row('pastTitle', Briefcase, 'Past job title', textSummary('pastJobTitle'), n('pastJobTitle'), (
              <TagFilter name="Past job title" {...extra('pastJobTitle')} suggest={suggestTitles} offset={5}
                examples={['Founder', 'SDR', 'Consultant', 'Product Manager']} prefix="Used to be" />
            ))}
            {row('pastCompany', History, 'Past companies', textSummary('pastCompanyName', 'pastCompanyWebsite'), n('pastCompanyName', 'pastCompanyWebsite'), (
              <>
                <TagFilter label="Company name" {...extra('pastCompanyName')} offset={1} examples={['Salesforce', 'HubSpot', 'Google', 'Deloitte']} prefix="Alumni of" />
                <TagFilter label="Company website" {...extra('pastCompanyWebsite')} offset={2} examples={['hubspot.com', 'stripe.com']} />
              </>
            ))}
            {row('pastIndustry', Sparkles, 'Past industry', textSummary('pastCompany.industry'), n('pastCompany.industry'), (
              <TagFilter name="Past industry" {...extra('pastCompany.industry')} suggest={industrySuggest} preferPick listSeparator={false} offset={3}
                examples={['Business Consulting and Services', 'Banking', 'Software Development']} />
            ))}
            {row('pastDetails', Building2, 'Past company details',
              [textSummary('pastCompany.type', 'pastCompany.location', 'pastCompany.keyword'), rangeText(range('pastCompany.headcount'), ' people'), rangeText(range('pastCompany.revenue'), '', REVENUE_PRESETS), rangeText(range('pastCompany.headcountGrowth'), '%', GROWTH_PRESETS)].filter(Boolean).join(' · '),
              n('pastCompany.type', 'pastCompany.location', 'pastCompany.keyword') + ranged('pastCompany.headcount', 'pastCompany.revenue', 'pastCompany.headcountGrowth'), (
              <>
                <div>
                  <SubLabel>Type</SubLabel>
                  <Toggles label="Past company type" options={companyTypes} value={text('pastCompany.type').include || []}
                    onChange={(include) => setAdv('pastCompany.type', { ...text('pastCompany.type'), include })} />
                </div>
                <TagFilter label="Where it was based" {...extra('pastCompany.location')} remote="locations" preferPick listSeparator={false} offset={4}
                  examples={['Paris', 'San Francisco', 'Singapore']} />
                <TagFilter label="What it did" {...extra('pastCompany.keyword')} offset={5} examples={['unicorn', 'agency', 'SaaS']} prefix="Keywords, e.g." />
                <div>
                  <SubLabel>Size</SubLabel>
                  <div className="flex items-center gap-1.5">
                    <input type="number" inputMode="numeric" placeholder="Min" aria-label="Past company headcount minimum" className={inputClass}
                      value={range('pastCompany.headcount')?.min ?? ''} onChange={(e) => setAdv('pastCompany.headcount', { ...range('pastCompany.headcount'), min: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
                    <span className="text-caption text-[var(--text-tertiary)]">to</span>
                    <input type="number" inputMode="numeric" placeholder="Max" aria-label="Past company headcount maximum" className={inputClass}
                      value={range('pastCompany.headcount')?.max ?? ''} onChange={(e) => setAdv('pastCompany.headcount', { ...range('pastCompany.headcount'), max: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
                    <span className="text-caption text-[var(--text-tertiary)] flex-shrink-0">people</span>
                  </div>
                </div>
                <div>
                  <SubLabel>Revenue</SubLabel>
                  <PresetRange label="Past company revenue" presets={REVENUE_PRESETS} unit="USD" value={range('pastCompany.revenue')} onChange={(v) => setAdv('pastCompany.revenue', v)} />
                </div>
                <div>
                  <SubLabel>Headcount growth</SubLabel>
                  <GrowthPicker label="Past company headcount growth" value={adv['pastCompany.headcountGrowth'] as ProspectGrowthFilter} onChange={(v) => setAdv('pastCompany.headcountGrowth', v)} />
                </div>
              </>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Every row id the panel can show, for "Open all". */
export const ALL_ROWS = [
  'title', 'seniority', 'skills', 'experience', 'keywords', 'languages', 'school', 'name',
  'location', 'otherLocation',
  'company', 'industry', 'headcount', 'revenue', 'growth', 'companyType', 'hq', 'companyKeywords',
  'pastTitle', 'pastCompany', 'pastIndustry', 'pastDetails',
];

/** How many filters hold a value, for the panel header. */
export function countFilters(f: FilterState): number {
  return [f.titles, f.locations, f.industries, f.companies, f.seniorities, f.companySizes].filter((l) => l.length).length
    + (f.keywords.trim() ? 1 : 0) + countAdvancedFilters(f.advanced);
}

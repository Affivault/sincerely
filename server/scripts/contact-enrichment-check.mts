/*
 * Enrich and the deep email check.
 *
 * Icypeas does not publish the response shapes of its profile scraper,
 * company scraper or email verification, so the readers accept several
 * spellings. This pins down that each plausible shape reads the same way,
 * and that a verdict maps onto the score the lead list colours by:
 *
 *   - a profile in Icypeas's lead shape, or nested under profile/
 *     currentPosition, becomes the same EnrichedPerson
 *   - a not-found answer is null, never an empty profile
 *   - a company profile reads headcount, HQ, founded and specialties
 *   - the directory fills gaps in Icypeas's company, never overrides it
 *   - LinkedIn URLs are found anywhere in an answer
 *   - ultra_sure/very_sure is Valid, probable is Valid, undeliverable is
 *     Undeliverable, not_found is Risky and never counted as checked
 */
process.env.SUPABASE_URL ||= 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'stub';
process.env.SUPABASE_ANON_KEY ||= 'stub';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.TRACKING_SECRET ||= 'audit-secret-at-least-16';

let pass = 0, fail = 0;
const is = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n         ${detail}` : ''}`); }
};

const { personFromProfile, companyFromProfile, mergeCompany, mergePerson, findLinkedinUrl, unwrapIcypeas } =
  await import('../src/services/contact-enrichment.service.js');
const { icypeasCertaintyFrom, resultFromCertainty } = await import('../src/services/verification.service.js');

console.log('\nA profile, in Icypeas\'s lead shape');
{
  const p = personFromProfile({
    success: true,
    data: {
      firstname: 'Ada', lastname: 'Lovelace', headline: 'Head of Growth at Acme',
      lastJobTitle: 'Head of Growth', lastCompanyName: 'Acme', address: 'London, United Kingdom',
      profileUrl: 'linkedin.com/in/ada-lovelace', summary: 'Builds things.',
      skills: ['SEO', { name: 'Paid social' }, 'SEO'],
      experiences: [
        { title: 'Head of Growth', companyName: 'Acme', startDate: { year: 2021, month: 3 }, companyUrl: 'https://www.linkedin.com/company/acme-inc/' },
        { title: 'Marketer', companyName: 'Initech', startDate: '2018', endDate: '2021' },
      ],
      educations: [{ schoolName: 'UCL', degreeName: 'BSc', fieldOfStudy: 'Maths' }],
    },
  });
  is('read at all', !!p);
  is('names', p?.first_name === 'Ada' && p?.last_name === 'Lovelace' && p?.full_name === 'Ada Lovelace', JSON.stringify(p));
  is('role and company', p?.job_title === 'Head of Growth' && p?.company === 'Acme');
  is('location', p?.location === 'London, United Kingdom');
  is('linkedin gets a scheme', p?.linkedin_url?.startsWith('https://') === true, String(p?.linkedin_url));
  is('skills de-duplicated, objects read', JSON.stringify(p?.skills) === JSON.stringify(['SEO', 'Paid social']), JSON.stringify(p?.skills));
  is('career with dates', p?.experience.length === 2 && p?.experience[0].start === '2021-03' && p?.experience[1].end === '2021');
  is('education', p?.education[0]?.school === 'UCL' && p?.education[0]?.field === 'Maths');
  is('employer page found in the current job', p?.company_linkedin_url === 'https://www.linkedin.com/company/acme-inc', String(p?.company_linkedin_url));
}

console.log('\nA profile, nested');
{
  const p = personFromProfile({
    profile: { name: 'John Doe', headline: 'CEO at Company', location: 'Paris, France', connections: 500, languages: 'English, French', url: 'https://www.linkedin.com/in/johndoe' },
    currentPosition: { title: 'Chief Executive Officer', company: 'Company Name' },
    education: [{ degree: "Master's Degree", school: 'University Name', field: 'Computer Science' }],
    experience: [{ title: 'Previous Role', company: 'Previous Company', description: 'Role description' }],
  });
  is('full name split', p?.first_name === 'John' && p?.last_name === 'Doe');
  is('current position wins', p?.job_title === 'Chief Executive Officer' && p?.company === 'Company Name');
  is('languages from a string', JSON.stringify(p?.languages) === JSON.stringify(['English', 'French']));
  is('connections', p?.connections === 500);
  is('education school', p?.education[0]?.school === 'University Name');
}

console.log('\nNot found');
{
  is('empty data is null', personFromProfile({ success: true, data: {} }) === null);
  is('a status only is null', personFromProfile({ success: true, status: 'NOT_FOUND' }) === null);
  is('company too', companyFromProfile({ success: true, item: null }) === null);
}

console.log('\nA company profile');
{
  const c = companyFromProfile({
    success: true,
    result: {
      name: 'Acme', website: 'https://www.acme.co.uk/about', industry: 'Software Development',
      staffCount: 180, foundedOn: { year: 2012 }, followerCount: '12,400',
      headquarter: { city: 'London', geographicArea: 'England', country: 'GB' },
      description: 'We make anvils.', specialities: ['Anvils', 'Rockets'], url: 'https://www.linkedin.com/company/acme',
    },
  });
  is('name and domain', c?.name === 'Acme' && c?.domain === 'acme.co.uk', JSON.stringify(c));
  is('headcount as size', c?.size === '180');
  is('founded and followers', c?.founded === 2012 && c?.followers === 12400);
  is('HQ joined', c?.location === 'London, England, GB');
  is('specialties', c?.specialties.length === 2);
  is('linkedin page', c?.linkedin_url === 'https://www.linkedin.com/company/acme');
}

console.log('\nA company from the company database');
{
  const c = companyFromProfile({
    success: true, total: 1,
    leads: [{ name: 'eToro', lid: 'etoro', url: 'https://www.linkedin.com/company/etoro/', description: 'Social investing.',
      address: 'Tel Aviv, Israel', numberOfEmployees: 2712, industry: 'Financial Services', website: 'http://www.etoro.com',
      specialties: ['Trading'], employeeGrowth: [], _id: 'x' }],
  });
  is('read from leads[0]', c?.name === 'eToro' && c?.domain === 'etoro.com', JSON.stringify(c));
  is('address as location', c?.location === 'Tel Aviv, Israel');
  is('employees and linkedin', c?.size === '2712' && c?.linkedin_url === 'https://www.linkedin.com/company/etoro');
  is('description and specialties', c?.description === 'Social investing.' && c?.specialties[0] === 'Trading');
}

console.log('\nA person from the people database');
{
  const p = personFromProfile({ leads: [{ _id: 'a', _source: { firstname: 'Farhan', lastname: 'Badami', lastJobTitle: 'Affiliate Manager', lastCompanyName: 'eToro', profileUrl: 'https://www.linkedin.com/in/farhan' } }] });
  is('_source unwrapped', p?.first_name === 'Farhan' && p?.job_title === 'Affiliate Manager' && p?.linkedin_url === 'https://www.linkedin.com/in/farhan', JSON.stringify(p));
}

console.log('\nThe full profile fills the database record');
{
  const lead: any = { first_name: 'A', job_title: 'Lead title', experience: [], skills: ['x'], education: [] };
  const full: any = { first_name: 'A', job_title: null, experience: [{ title: 't' }], skills: [], education: [] };
  const m: any = mergePerson(full, lead);
  is('full wins, lead fills blanks', m.job_title === 'Lead title' && m.experience.length === 1 && m.skills[0] === 'x');
}

console.log('\nThe directory fills gaps only');
{
  const icy: any = { name: 'Acme', industry: 'Software', size: null, founded: null, specialties: [], sources: ['icypeas'] };
  const dir: any = { name: 'Acme Ltd', industry: 'Computer software', size: '51-200', founded: 2011, specialties: [], sources: ['directory'] };
  const m: any = mergeCompany(icy, dir);
  is('Icypeas keeps its name and industry', m.name === 'Acme' && m.industry === 'Software');
  is('directory fills size and founded', m.size === '51-200' && m.founded === 2011);
  is('both credited', m.sources.includes('directory') && m.sources.includes('icypeas'));
  is('directory alone stands', mergeCompany(null, dir) === dir);
}

console.log('\nLinkedIn URLs anywhere');
{
  is('nested', findLinkedinUrl({ a: [{ b: 'see uk.linkedin.com/in/ada-l?x=1' }] }, 'in') === 'https://uk.linkedin.com/in/ada-l');
  is('kinds kept apart', findLinkedinUrl({ u: 'https://linkedin.com/in/ada' }, 'company') === null);
  is('unwrap a list', unwrapIcypeas({ items: [{ name: 'x' }] })?.name === 'x');
}

console.log('\nVerification verdicts');
{
  const base: any = { email: 'a@acme.com', syntax_ok: true, domain_ok: true, smtp_ok: true, smtp_checked: false, score: 60, fail_reason: 'Could not reach the mail server' };
  is('certainty found deep', icypeasCertaintyFrom({ status: 'DEBITED', results: { emails: [{ email: 'a@acme.com', certainty: 'ULTRA_SURE' }] } }) === 'ultra_sure');
  is('certainty missing is null', icypeasCertaintyFrom({ status: 'NONE' }) === null);
  const sure = resultFromCertainty(base, 'very_sure', 'DEBITED');
  is('very_sure is Valid and checked', sure.score === 100 && sure.smtp_checked && sure.fail_reason === null && sure.verified_by === 'icypeas');
  is('probable is still Valid', resultFromCertainty(base, 'probable', 'DEBITED').score >= 80);
  const bad = resultFromCertainty(base, 'undeliverable', 'DEBITED');
  is('undeliverable is bad and checked', bad.score < 50 && bad.smtp_checked && bad.smtp_ok === false);
  const unknown = resultFromCertainty(base, 'not_found', 'NOT_FOUND');
  is('not_found is Risky and unchecked', unknown.score >= 50 && unknown.score < 80 && !unknown.smtp_checked);
  is('found with no certainty reads as probable', resultFromCertainty(base, null, 'FOUND').score === 85);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

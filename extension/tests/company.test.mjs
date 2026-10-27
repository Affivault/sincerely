/**
 * Which company a page is about, checked without a browser.
 *
 * The sidebar's "People at" panel searches on whatever this returns, and a
 * search is billed to the account even though it is free to the user. So the
 * cases that matter most are the ones where the right answer is "none": the
 * app itself, a search engine, a personal Gmail address.
 */
import { companyTarget, registrableDomain, nameFromDomain } from '../lib/company.js';

let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
};

check('a subdomain reduces to the company domain', registrableDomain('careers.acme.com') === 'acme.com');
check('www is dropped', registrableDomain('www.acme.io') === 'acme.io');
check('a two-part suffix keeps three labels', registrableDomain('shop.acme.co.uk') === 'acme.co.uk');
check('an IP address is not a company', registrableDomain('192.168.0.4') === null);
check('a bare host is not a company', registrableDomain('intranet') === null);
check('a domain reads as a name', nameFromDomain('acme-labs.co.uk') === 'Acme Labs');

const site = companyTarget({ tabUrl: 'https://blog.acme.com/team', person: { company: 'Acme' } });
check(
  "a company's own site is the company, by its site name and domain",
  site?.kind === 'site' && site.domain === 'acme.com' && site.name === 'Acme',
  JSON.stringify(site)
);

const tagline = companyTarget({
  tabUrl: 'https://acme.com/',
  person: { company: 'Acme | The all-in-one platform for modern revenue teams everywhere' },
});
check('a tagline for a site name falls back to the domain', tagline?.name === 'Acme', JSON.stringify(tagline));

check('the app itself is never a company', companyTarget({ tabUrl: 'https://usesincerely.com/leads', appUrl: 'https://usesincerely.com' }) === null);
check('a search engine is not a company', companyTarget({ tabUrl: 'https://www.google.com/search?q=acme' }) === null);
check('localhost is not a company', companyTarget({ tabUrl: 'http://localhost:5173/' }) === null);
check('a chrome page is not a company', companyTarget({ tabUrl: 'chrome://extensions' }) === null);

const page = companyTarget({
  tabUrl: 'https://www.linkedin.com/company/acme/',
  person: { company_page: { name: 'Acme', domain: 'acme.com', linkedin_url: 'https://www.linkedin.com/company/acme/' } },
});
check('a LinkedIn company page is that company', page?.kind === 'linkedin-company' && page.domain === 'acme.com', JSON.stringify(page));

const profile = companyTarget({
  tabUrl: 'https://www.linkedin.com/in/jane/',
  person: { company: 'Acme Ltd', company_domain: 'www.acme.co.uk' },
});
check(
  'a profile offers the rest of their employer',
  profile?.kind === 'colleagues' && profile.name === 'Acme Ltd' && profile.domain === 'acme.co.uk',
  JSON.stringify(profile)
);

check(
  'LinkedIn with no company on the page offers nothing',
  companyTarget({ tabUrl: 'https://www.linkedin.com/feed/', person: { company: null } }) === null
);

const work = companyTarget({ tabUrl: 'https://mail.google.com/mail/u/0/#inbox/1', person: { email: 'sam@northwind.io' } });
check('an email from a work address offers that company', work?.domain === 'northwind.io' && work.name === 'Northwind', JSON.stringify(work));
check(
  'an email from a personal address offers nothing',
  companyTarget({ tabUrl: 'https://mail.google.com/mail/u/0/', person: { email: 'sam@gmail.com' } }) === null
);

console.log(failed ? '\ncompany target: FAILURES' : '\ncompany target: all checks passed');
process.exit(failed ? 1 : 0);

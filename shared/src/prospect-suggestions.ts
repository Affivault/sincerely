// What the Prospector suggests as people type, so a filter holds values the
// data provider actually matches. Industries and company types are Icypeas's
// own fixed lists (api-doc.icypeas.com, find-people); titles, skills and
// languages are free text there, so these are the common spellings.
// Places live on the server (server/src/data/places.ts): too big to ship here.

import type { ProspectAdvancedValue, ProspectTextFilter } from './prospecting.types.js';
import { PROSPECT_FILTER_FIELDS } from './prospecting.types.js';

export interface ProspectSuggestion {
  /** What goes into the filter. */
  value: string;
  /** What the person sees, when it differs from the value. */
  label?: string;
  /** A short tag beside it: "Country", "Town", "Group"... */
  kind?: string;
  /** Why it matched when the text typed is not in the label, e.g. "for SaaS". */
  hint?: string;
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/** Icypeas's industry list, the only values its industry filters match. */
export const PROSPECT_INDUSTRIES = lines(`
Abrasives and Nonmetallic Minerals Manufacturing
Accessible Architecture and Design
Accessible Hardware Manufacturing
Accommodation and Food Services
Accounting
Administration of Justice
Administrative and Support Services
Advertising Services
Agricultural Chemical Manufacturing
Agriculture
Agriculture, Construction, Mining Machinery Manufacturing
Air, Water, and Waste Program Management
Airlines and Aviation
Alternative Dispute Resolution
Alternative Fuel Vehicle Manufacturing
Alternative Medicine
Ambulance Services
Amusement Parks and Arcades
Animal Feed Manufacturing
Animation
Animation and Post-production
Apparel & Fashion
Apparel Manufacturing
Appliances, Electrical, and Electronics Manufacturing
Architectural and Structural Metal Manufacturing
Architecture and Planning
Armed Forces
Artificial Rubber and Synthetic Fiber Manufacturing
Artists and Writers
Arts & Crafts
Audio and Video Equipment Manufacturing
Automation Machinery Manufacturing
Automotive
Aviation & Aerospace
Aviation and Aerospace Component Manufacturing
Baked Goods Manufacturing
Banking
Bars, Taverns, and Nightclubs
Bed-and-Breakfasts, Hostels, Homestays
Beverage Manufacturing
Biomass Electric Power Generation
Biotechnology
Biotechnology Research
Blockchain Services
Blogs
Boilers, Tanks, and Shipping Container Manufacturing
Book and Periodical Publishing
Book Publishing
Breweries
Broadcast Media Production and Distribution
Building Construction
Building Equipment Contractors
Building Finishing Contractors
Building Materials
Building Structure and Exterior Contractors
Business Consulting and Services
Business Content
Business Intelligence Platforms
Business Supplies & Equipment
Cable and Satellite Programming
Capital Markets
Caterers
Chemical Manufacturing
Chemical Raw Materials Manufacturing
Child Day Care Services
Chiropractors
Circuses and Magic Shows
Civic and Social Organizations
Civil Engineering
Claims Adjusting, Actuarial Services
Clay and Refractory Products Manufacturing
Climate Data and Analytics
Climate Technology Product Manufacturing
Coal Mining
Collection Agencies
Commercial and Industrial Equipment Rental
Commercial and Industrial Machinery Maintenance
Commercial and Service Industry Machinery Manufacturing
Commercial Real Estate
Communications Equipment Manufacturing
Community Development and Urban Planning
Community Services
Computer and Network Security
Computer Games
Computer Hardware
Computer Hardware Manufacturing
Computer Networking
Computer Networking Products
Computers and Electronics Manufacturing
Conservation Programs
Construction
Construction Hardware Manufacturing
Consumer Electronics
Consumer Goods
Consumer Goods Rental
Consumer Services
Correctional Institutions
Cosmetics
Cosmetology and Barber Schools
Courts of Law
Credit Intermediation
Cutlery and Handtool Manufacturing
Dairy
Dairy Product Manufacturing
Dance Companies
Data Infrastructure and Analytics
Data Security Software Products
Defense & Space
Defense and Space Manufacturing
Dentists
Design
Design Services
Desktop Computing Software Products
Digital Accessibility Services
Distilleries
E-learning
E-Learning Providers
Economic Programs
Education
Education Administration Programs
Education Management
Electric Lighting Equipment Manufacturing
Electric Power Generation
Electric Power Transmission, Control, and Distribution
Electrical Equipment Manufacturing
Electronic and Precision Equipment Maintenance
Embedded Software Products
Emergency and Relief Services
Engineering Services
Engines and Power Transmission Equipment Manufacturing
Entertainment
Entertainment Providers
Environmental Quality Programs
Environmental Services
Equipment Rental Services
Events Services
Executive Offices
Executive Search Services
Fabricated Metal Products
Facilities Services
Family Planning Centers
Farming
Farming, Ranching, Forestry
Fashion Accessories Manufacturing
Financial Services
Fine Art
Fine Arts Schools
Fire Protection
Fisheries
Flight Training
Food & Beverages
Food and Beverage Manufacturing
Food and Beverage Retail
Food and Beverage Services
Food Production
Footwear and Leather Goods Repair
Footwear Manufacturing
Forestry and Logging
Fossil Fuel Electric Power Generation
Freight and Package Transportation
Fruit and Vegetable Preserves Manufacturing
Fuel Cell Manufacturing
Fundraising
Funds and Trusts
Furniture
Furniture and Home Furnishings Manufacturing
Gambling Facilities and Casinos
Geothermal Electric Power Generation
Glass Product Manufacturing
Glass, Ceramics and Concrete Manufacturing
Golf Courses and Country Clubs
Government Administration
Government Relations
Government Relations Services
Graphic Design
Ground Passenger Transportation
Health and Human Services
Health, Wellness & Fitness
Higher Education
Highway, Street, and Bridge Construction
Historical Sites
Holding Companies
Home Health Care Services
Horticulture
Hospitality
Hospitals
Hospitals and Health Care
Hotels and Motels
Household and Institutional Furniture Manufacturing
Household Appliance Manufacturing
Household Services
Housing and Community Development
Housing Programs
Human Resources
Human Resources Services
HVAC and Refrigeration Equipment Manufacturing
Hydroelectric Power Generation
Import & Export
Individual and Family Services
Industrial Automation
Industrial Machinery Manufacturing
Industry Associations
Information Services
Information Technology & Services
Insurance
Insurance Agencies and Brokerages
Insurance and Employee Benefit Funds
Insurance Carriers
Interior Design
International Affairs
International Trade and Development
Internet Marketplace Platforms
Internet News
Internet Publishing
Interurban and Rural Bus Services
Investment Advice
Investment Banking
Investment Management
IT Services and IT Consulting
IT System Custom Software Development
IT System Data Services
IT System Design Services
IT System Installation and Disposal
IT System Operations and Maintenance
IT System Testing and Evaluation
IT System Training and Support
Janitorial Services
Landscaping Services
Language Schools
Laundry and Drycleaning Services
Law Enforcement
Law Practice
Leasing Non-residential Real Estate
Leasing Residential Real Estate
Leather Product Manufacturing
Legal Services
Legislative Offices
Leisure, Travel & Tourism
Libraries
Lime and Gypsum Products Manufacturing
Loan Brokers
Luxury Goods & Jewelry
Machinery Manufacturing
Magnetic and Optical Media Manufacturing
Manufacturing
Maritime
Maritime Transportation
Market Research
Marketing Services
Mattress and Blinds Manufacturing
Measuring and Control Instrument Manufacturing
Meat Products Manufacturing
Mechanical Or Industrial Engineering
Media and Telecommunications
Media Production
Medical and Diagnostic Laboratories
Medical Device
Medical Equipment Manufacturing
Medical Practices
Mental Health Care
Metal Ore Mining
Metal Treatments
Metal Valve, Ball, and Roller Manufacturing
Metalworking Machinery Manufacturing
Military and International Affairs
Mining
Mobile Computing Software Products
Mobile Food Services
Mobile Gaming Apps
Motor Vehicle Manufacturing
Motor Vehicle Parts Manufacturing
Movies and Sound Recording
Movies, Videos, and Sound
Museums
Museums, Historical Sites, and Zoos
Music
Musicians
Nanotechnology Research
Natural Gas Distribution
Natural Gas Extraction
Newspaper Publishing
Non-profit Organization Management
Non-profit Organizations
Nonmetallic Mineral Mining
Nonresidential Building Construction
Nuclear Electric Power Generation
Nursing Homes and Residential Care Facilities
Office Administration
Office Furniture and Fixtures Manufacturing
Oil and Coal Product Manufacturing
Oil and Gas
Oil Extraction
Oil, Gas, and Mining
Online and Mail Order Retail
Online Audio and Video Media
Online Media
Operations Consulting
Optometrists
Outpatient Care Centers
Outsourcing and Offshoring Consulting
Outsourcing/Offshoring
Packaging & Containers
Packaging and Containers Manufacturing
Paint, Coating, and Adhesive Manufacturing
Paper & Forest Products
Paper and Forest Product Manufacturing
Pension Funds
Performing Arts
Performing Arts and Spectator Sports
Periodical Publishing
Personal and Laundry Services
Personal Care Product Manufacturing
Personal Care Services
Pet Services
Pharmaceutical Manufacturing
Philanthropic Fundraising Services
Philanthropy
Photography
Physical, Occupational and Speech Therapists
Physicians
Pipeline Transportation
Plastics and Rubber Product Manufacturing
Plastics Manufacturing
Political Organizations
Postal Services
Primary and Secondary Education
Primary Metal Manufacturing
Printing Services
Professional Organizations
Professional Services
Professional Training and Coaching
Program Development
Public Assistance Programs
Public Health
Public Policy
Public Policy Offices
Public Relations and Communications Services
Public Safety
Racetracks
Radio and Television Broadcasting
Rail Transportation
Railroad Equipment Manufacturing
Ranching
Ranching and Fisheries
Real Estate
Real Estate Agents and Brokers
Real Estate and Equipment Rental Services
Recreational Facilities
Regenerative Design
Religious Institutions
Renewable Energy Equipment Manufacturing
Renewable Energy Power Generation
Renewable Energy Semiconductor Manufacturing
Renewables & Environment
Repair and Maintenance
Research
Research Services
Residential Building Construction
Restaurants
Retail
Retail Apparel and Fashion
Retail Appliances, Electrical, and Electronic Equipment
Retail Art Dealers
Retail Art Supplies
Retail Books and Printed News
Retail Building Materials and Garden Equipment
Retail Florists
Retail Furniture and Home Furnishings
Retail Gasoline
Retail Groceries
Retail Health and Personal Care Products
Retail Luxury Goods and Jewelry
Retail Motor Vehicles
Retail Musical Instruments
Retail Office Equipment
Retail Office Supplies and Gifts
Retail Pharmacies
Retail Recyclable Materials & Used Merchandise
Reupholstery and Furniture Repair
Robot Manufacturing
Robotics Engineering
Rubber Products Manufacturing
Satellite Telecommunications
Savings Institutions
School and Employee Bus Services
Seafood Product Manufacturing
Secretarial Schools
Securities and Commodity Exchanges
Security and Investigations
Security Guards and Patrol Services
Security Systems Services
Semiconductor Manufacturing
Semiconductors
Services for Renewable Energy
Services for the Elderly and Disabled
Sheet Music Publishing
Shipbuilding
Shuttles and Special Needs Transportation Services
Sightseeing Transportation
Skiing Facilities
Smart Meter Manufacturing
Soap and Cleaning Product Manufacturing
Social Networking Platforms
Software Development
Solar Electric Power Generation
Sound Recording
Space Research and Technology
Specialty Trade Contractors
Spectator Sports
Sporting Goods
Sporting Goods Manufacturing
Sports and Recreation Instruction
Sports Teams and Clubs
Spring and Wire Product Manufacturing
Staffing and Recruiting
Steam and Air-Conditioning Supply
Strategic Management Services
Subdivision of Land
Sugar and Confectionery Product Manufacturing
Surveying and Mapping Services
Taxi and Limousine Services
Technical and Vocational Training
Technology, Information and Internet
Technology, Information and Media
Telecommunications
Telecommunications Carriers
Telephone Call Centers
Temporary Help Services
Textile Manufacturing
Theater Companies
Think Tanks
Tobacco
Tobacco Manufacturing
Translation and Localization
Transportation Equipment Manufacturing
Transportation Programs
Transportation, Logistics, Supply Chain and Storage
Transportation/Trucking/Railroad
Travel Arrangements
Truck Transportation
Trusts and Estates
Turned Products and Fastener Manufacturing
Urban Transit Services
Utilities
Utilities Administration
Utility System Construction
Vehicle Repair and Maintenance
Venture Capital and Private Equity Principals
Veterinary
Veterinary Services
Vocational Rehabilitation Services
Warehousing
Warehousing and Storage
Waste Collection
Waste Treatment and Disposal
Water Supply and Irrigation Systems
Water, Waste, Steam, and Air Conditioning Services
Wellness and Fitness Services
Wholesale
Wholesale Alcoholic Beverages
Wholesale Apparel and Sewing Supplies
Wholesale Appliances, Electrical, and Electronics
Wholesale Building Materials
Wholesale Chemical and Allied Products
Wholesale Computer Equipment
Wholesale Drugs and Sundries
Wholesale Food and Beverage
Wholesale Footwear
Wholesale Furniture and Home Furnishings
Wholesale Hardware, Plumbing, Heating Equipment
Wholesale Import and Export
Wholesale Luxury Goods and Jewelry
Wholesale Machinery
Wholesale Metals and Minerals
Wholesale Motor Vehicles and Parts
Wholesale Paper Products
Wholesale Petroleum and Petroleum Products
Wholesale Photography Equipment and Supplies
Wholesale Raw Farm Products
Wholesale Recyclable Materials
Wind Electric Power Generation
Wine & Spirits
Wineries
Wireless Services
Women's Handbag Manufacturing
Wood Product Manufacturing
Writing and Editing
Zoos and Botanical Gardens
`);

/** The words people type for an industry, mapped to the names Icypeas files it under. */
export const INDUSTRY_ALIASES: Record<string, string[]> = {
  saas: ['Software Development', 'Technology, Information and Internet', 'IT Services and IT Consulting'],
  software: ['Software Development', 'IT System Custom Software Development'],
  tech: ['Technology, Information and Internet', 'Software Development', 'Information Technology & Services'],
  ai: ['Software Development', 'Technology, Information and Internet', 'Research Services'],
  fintech: ['Financial Services', 'Software Development', 'Banking'],
  finance: ['Financial Services', 'Banking', 'Investment Management', 'Capital Markets'],
  ecommerce: ['Online and Mail Order Retail', 'Retail', 'Internet Marketplace Platforms'],
  'e-commerce': ['Online and Mail Order Retail', 'Retail', 'Internet Marketplace Platforms'],
  dtc: ['Online and Mail Order Retail', 'Retail', 'Consumer Goods'],
  agency: ['Marketing Services', 'Advertising Services', 'Business Consulting and Services'],
  marketing: ['Marketing Services', 'Advertising Services', 'Public Relations and Communications Services'],
  crypto: ['Blockchain Services', 'Financial Services'],
  web3: ['Blockchain Services'],
  healthcare: ['Hospitals and Health Care', 'Medical Practices', 'Health and Human Services'],
  healthtech: ['Hospitals and Health Care', 'Software Development'],
  medtech: ['Medical Equipment Manufacturing', 'Medical Device'],
  pharma: ['Pharmaceutical Manufacturing', 'Biotechnology Research'],
  biotech: ['Biotechnology Research', 'Biotechnology'],
  edtech: ['E-Learning Providers', 'Education', 'Software Development'],
  proptech: ['Real Estate', 'Software Development'],
  property: ['Real Estate', 'Real Estate Agents and Brokers', 'Commercial Real Estate'],
  insurtech: ['Insurance', 'Software Development'],
  legal: ['Legal Services', 'Law Practice'],
  law: ['Law Practice', 'Legal Services'],
  recruitment: ['Staffing and Recruiting', 'Executive Search Services', 'Human Resources Services'],
  recruiting: ['Staffing and Recruiting', 'Executive Search Services'],
  hr: ['Human Resources Services', 'Human Resources', 'Staffing and Recruiting'],
  consulting: ['Business Consulting and Services', 'IT Services and IT Consulting', 'Strategic Management Services'],
  logistics: ['Transportation, Logistics, Supply Chain and Storage', 'Freight and Package Transportation', 'Warehousing'],
  cybersecurity: ['Computer and Network Security', 'Data Security Software Products'],
  security: ['Computer and Network Security', 'Security and Investigations'],
  gaming: ['Computer Games', 'Mobile Gaming Apps', 'Entertainment Providers'],
  media: ['Online Media', 'Media Production', 'Broadcast Media Production and Distribution'],
  energy: ['Renewable Energy Power Generation', 'Oil and Gas', 'Utilities'],
  cleantech: ['Renewable Energy Power Generation', 'Climate Technology Product Manufacturing', 'Renewables & Environment'],
  hospitality: ['Hospitality', 'Hotels and Motels', 'Restaurants'],
  travel: ['Travel Arrangements', 'Leisure, Travel & Tourism'],
  automotive: ['Motor Vehicle Manufacturing', 'Automotive', 'Retail Motor Vehicles'],
  vc: ['Venture Capital and Private Equity Principals'],
  pe: ['Venture Capital and Private Equity Principals'],
  nonprofit: ['Non-profit Organizations', 'Non-profit Organization Management'],
  charity: ['Non-profit Organizations', 'Philanthropic Fundraising Services'],
  construction: ['Construction', 'Building Construction', 'Civil Engineering'],
  telecoms: ['Telecommunications', 'Telecommunications Carriers', 'Wireless Services'],
  fashion: ['Retail Apparel and Fashion', 'Apparel & Fashion', 'Apparel Manufacturing'],
  beauty: ['Personal Care Product Manufacturing', 'Cosmetics'],
  food: ['Food and Beverage Manufacturing', 'Food and Beverage Services', 'Restaurants'],
  fitness: ['Wellness and Fitness Services', 'Health, Wellness & Fitness'],
  accounting: ['Accounting', 'Financial Services'],
  manufacturing: ['Manufacturing', 'Industrial Machinery Manufacturing'],
};

export const PROSPECT_COMPANY_TYPES = [
  'Privately Held', 'Public Company', 'Self-Employed', 'Sole Proprietorship', 'Partnership',
  'Nonprofit', 'Educational Institution', 'Government Agency',
];

/** Common titles, most-searched first. */
export const PROSPECT_JOB_TITLES = lines(`
Founder
Co-Founder
CEO
Owner
Managing Director
President
General Manager
Partner
Chief Operating Officer
COO
Chief Marketing Officer
CMO
Chief Revenue Officer
CRO
Chief Technology Officer
CTO
Chief Financial Officer
CFO
Chief Product Officer
Chief People Officer
Chief Customer Officer
Chief Growth Officer
Chief Commercial Officer
Chief Digital Officer
Chief Information Officer
Chief Data Officer
Chief Strategy Officer
VP Sales
VP Marketing
VP Growth
VP Engineering
VP Product
VP Operations
VP Business Development
VP Customer Success
VP Partnerships
VP Finance
VP People
Head of Sales
Head of Marketing
Head of Growth
Head of Demand Generation
Head of Partnerships
Head of Business Development
Head of Customer Success
Head of Product
Head of Engineering
Head of Operations
Head of Revenue Operations
Head of People
Head of Talent Acquisition
Head of Brand
Head of Content
Head of Digital
Head of E-commerce
Head of Performance Marketing
Head of Finance
Head of Procurement
Head of Design
Head of Data
Head of IT
Head of Security
Sales Director
Marketing Director
Commercial Director
Operations Director
Finance Director
Creative Director
Art Director
HR Director
IT Director
Director of Sales
Director of Marketing
Director of Growth
Director of Partnerships
Director of Business Development
Director of Operations
Director of Engineering
Director of Product
Director of Customer Success
Director of Demand Generation
Sales Manager
Marketing Manager
Growth Manager
Account Manager
Key Account Manager
Partnerships Manager
Business Development Manager
Product Manager
Project Manager
Program Manager
Operations Manager
Office Manager
Community Manager
Content Manager
Social Media Manager
E-commerce Manager
Brand Manager
Product Marketing Manager
Demand Generation Manager
Performance Marketing Manager
SEO Manager
Email Marketing Manager
Customer Success Manager
Recruitment Manager
Talent Acquisition Manager
HR Manager
Finance Manager
Procurement Manager
Purchasing Manager
Engineering Manager
Revenue Operations Manager
Sales Operations Manager
Account Executive
Enterprise Account Executive
Sales Development Representative
SDR
Business Development Representative
BDR
Sales Representative
Sales Executive
Inside Sales
Field Sales
Solutions Engineer
Sales Engineer
Customer Success
Account Director
Client Services Director
Growth Marketer
Marketing Executive
Digital Marketing
Copywriter
Content Strategist
Designer
Product Designer
UX Designer
Software Engineer
Senior Software Engineer
Full Stack Developer
Frontend Developer
Backend Developer
Data Scientist
Data Analyst
Data Engineer
Machine Learning Engineer
DevOps Engineer
Engineer
Consultant
Senior Consultant
Advisor
Analyst
Business Analyst
Financial Analyst
Accountant
Controller
Recruiter
Talent Partner
HR Business Partner
Executive Assistant
Investor
Principal
Associate
Board Member
Chairman
Real Estate Agent
Broker
Lawyer
Solicitor
Attorney
Doctor
Teacher
Professor
Researcher
Freelancer
`);

export const PROSPECT_SKILLS = lines(`
Sales
B2B Sales
SaaS
Lead Generation
Outbound
Cold Calling
Cold Email
Account Management
Business Development
Negotiation
Salesforce
HubSpot
Pipedrive
CRM
Marketing Strategy
Digital Marketing
Growth Marketing
Demand Generation
Content Marketing
Email Marketing
Marketing Automation
SEO
SEM
Google Ads
Facebook Ads
LinkedIn Ads
Social Media Marketing
Copywriting
Branding
Product Marketing
E-commerce
Shopify
Partnerships
Customer Success
Project Management
Product Management
Agile
Scrum
Leadership
Strategy
Operations
Revenue Operations
Recruiting
Talent Acquisition
Finance
Accounting
Financial Modeling
Fundraising
Data Analysis
SQL
Python
JavaScript
TypeScript
React
Node.js
Java
AWS
Kubernetes
Machine Learning
Artificial Intelligence
UX Design
Figma
Public Speaking
Event Management
Public Relations
`);

export const PROSPECT_LANGUAGES = lines(`
English
French
German
Spanish
Italian
Portuguese
Dutch
Swedish
Danish
Norwegian
Finnish
Polish
Czech
Romanian
Greek
Turkish
Russian
Ukrainian
Arabic
Hebrew
Hindi
Urdu
Bengali
Chinese
Mandarin
Cantonese
Japanese
Korean
Vietnamese
Thai
Indonesian
Malay
Tagalog
`);

/*
 * Markets as one pick. A group's value is "group:<key>" and widens to its
 * countries' two-letter codes when the search is sent (expandProspectLocations).
 */
export interface LocationGroup { key: string; label: string; codes: string[]; aliases?: string[] }

const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

export const LOCATION_GROUPS: LocationGroup[] = [
  { key: 'dach', label: 'DACH', codes: ['DE', 'AT', 'CH'] },
  { key: 'nordics', label: 'Nordics', codes: ['SE', 'NO', 'DK', 'FI', 'IS'], aliases: ['scandinavia'] },
  { key: 'benelux', label: 'Benelux', codes: ['BE', 'NL', 'LU'] },
  { key: 'ukie', label: 'UK & Ireland', codes: ['GB', 'IE'], aliases: ['british isles'] },
  { key: 'eu', label: 'European Union', codes: EU, aliases: ['eu'] },
  { key: 'europe', label: 'Europe', codes: [...EU, 'GB', 'CH', 'NO', 'IS', 'RS', 'UA', 'AL', 'BA', 'ME', 'MK', 'MD', 'LI', 'MC', 'AD'], aliases: ['emea'] },
  { key: 'na', label: 'North America', codes: ['US', 'CA'], aliases: ['usa and canada'] },
  { key: 'latam', label: 'Latin America', codes: ['MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'UY', 'EC', 'CR', 'PA', 'DO', 'GT', 'BO', 'PY', 'SV', 'HN', 'NI', 'VE'], aliases: ['latam', 'south america'] },
  { key: 'anz', label: 'Australia & New Zealand', codes: ['AU', 'NZ'], aliases: ['anz', 'oceania'] },
  { key: 'apac', label: 'Asia-Pacific', codes: ['AU', 'NZ', 'SG', 'HK', 'JP', 'KR', 'IN', 'ID', 'MY', 'PH', 'TH', 'VN', 'TW', 'CN'], aliases: ['apac', 'asia'] },
  { key: 'sea', label: 'Southeast Asia', codes: ['SG', 'MY', 'ID', 'PH', 'TH', 'VN'] },
  { key: 'gcc', label: 'Gulf (GCC)', codes: ['AE', 'SA', 'QA', 'KW', 'BH', 'OM'], aliases: ['gulf', 'middle east'] },
  { key: 'mena', label: 'Middle East & North Africa', codes: ['AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'IL', 'JO', 'LB', 'EG', 'MA', 'TN', 'DZ', 'TR'], aliases: ['mena'] },
  { key: 'cee', label: 'Central & Eastern Europe', codes: ['PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'EE', 'LV', 'LT', 'RS', 'UA'], aliases: ['cee', 'eastern europe'] },
  { key: 'southeu', label: 'Southern Europe', codes: ['ES', 'PT', 'IT', 'GR', 'MT', 'CY'] },
  { key: 'africa', label: 'Sub-Saharan Africa', codes: ['ZA', 'NG', 'KE', 'GH', 'RW', 'UG', 'TZ', 'ET', 'SN', 'CI'], aliases: ['africa'] },
];

/** What people type for a country, and the two-letter code Icypeas matches best. */
export const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'GB', 'u.k.': 'GB', 'great britain': 'GB', britain: 'GB', gb: 'GB', 'united kingdom': 'GB',
  us: 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US', 'united states': 'US', 'united states of america': 'US',
  uae: 'AE', emirates: 'AE', 'united arab emirates': 'AE', ksa: 'SA', holland: 'NL', 'the netherlands': 'NL', netherlands: 'NL',
  deutschland: 'DE', germany: 'DE', france: 'FR', espana: 'ES', spain: 'ES', italia: 'IT', italy: 'IT', ireland: 'IE',
  canada: 'CA', australia: 'AU', 'new zealand': 'NZ', india: 'IN', singapore: 'SG', 'south africa': 'ZA', brazil: 'BR', mexico: 'MX',
  switzerland: 'CH', schweiz: 'CH', austria: 'AT', belgium: 'BE', sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', poland: 'PL', portugal: 'PT',
};

const MAX_VALUES = 200;

/** A location value as Icypeas reads it: groups widen to codes, "UK" becomes "GB". */
export function expandProspectLocations(values: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of values || []) {
    const v = String(raw).trim();
    if (!v) continue;
    if (v.startsWith('group:')) {
      const group = LOCATION_GROUPS.find((g) => g.key === v.slice(6));
      if (group) out.push(...group.codes);
      continue;
    }
    out.push(COUNTRY_ALIASES[v.toLowerCase()] || v);
  }
  return [...new Set(out)].slice(0, MAX_VALUES);
}

/** The label a filter chip shows for a stored value: "group:dach" reads "DACH", "GB" reads "United Kingdom". */
export function prospectValueLabel(value: string): string {
  if (value.startsWith('group:')) return LOCATION_GROUPS.find((g) => g.key === value.slice(6))?.label || value;
  if (/^[A-Z]{2}$/.test(value)) {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(value) || value; } catch { return value; }
  }
  return value;
}

/** Lower case, accents off, for matching what people type. */
export const foldText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Ranks a fixed list against what was typed: a match at the start beats one
 * at a word start, and every typed word has to start some word of the entry.
 * With nothing typed it returns the head of the list, so a dropdown can show
 * everything there is to pick from.
 */
export function rankSuggestions(list: string[], typed: string, limit = 50, aliases?: Record<string, string[]>): ProspectSuggestion[] {
  const q = foldText(typed);
  if (!q) return list.slice(0, limit).map((value) => ({ value }));
  const words = q.split(/[\s,/&-]+/).filter(Boolean);
  const scored: { value: string; score: number; hint?: string }[] = [];
  const seen = new Set<string>();
  for (const [i, value] of list.entries()) {
    const f = foldText(value);
    const parts = f.split(/[\s,/&()-]+/);
    if (!words.every((w) => parts.some((p) => p.startsWith(w)))) continue;
    const score = (f === q ? 1000 : f.startsWith(q) ? 500 : 100) - i / list.length;
    scored.push({ value, score });
    seen.add(value);
  }
  for (const v of aliases?.[q] || []) {
    if (!seen.has(v)) scored.push({ value: v, score: 400, hint: `for ${typed.trim()}` });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ value, hint }) => ({ value, ...(hint ? { hint } : {}) }));
}

/** Location groups that match what was typed, for the top of the location dropdown. */
export function matchLocationGroups(typed: string): ProspectSuggestion[] {
  const q = foldText(typed);
  return LOCATION_GROUPS
    .filter((g) => !q || foldText(g.label).split(/[\s&()-]+/).some((p) => p.startsWith(q)) || foldText(g.label).startsWith(q) || (g.aliases || []).some((a) => a.startsWith(q)))
    .map((g) => ({ value: `group:${g.key}`, label: g.label, kind: `${g.codes.length} countries` }));
}

const FIELD_KINDS = new Map(PROSPECT_FILTER_FIELDS.map((f) => [f.key, f.kind]));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const textList = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim().slice(0, 200)).filter(Boolean))].slice(0, MAX_VALUES) : []);

/**
 * The advanced filters from a request body, keeping only known fields and
 * well-formed values. Used where a search is stored (standing searches), so a
 * saved search runs with every filter it was built with.
 */
export function sanitizeAdvancedFilters(raw: unknown): Record<string, ProspectAdvancedValue> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, ProspectAdvancedValue> = {};
  for (const [key, value] of Object.entries(raw as Record<string, any>)) {
    const kind = FIELD_KINDS.get(key);
    if (!kind || !value || typeof value !== 'object') continue;
    if (kind === 'text') {
      const include = textList(value.include), exclude = textList(value.exclude);
      if (include.length || exclude.length) out[key] = { ...(include.length ? { include } : {}), ...(exclude.length ? { exclude } : {}) } as ProspectTextFilter;
    } else {
      const min = num(value.min), max = num(value.max);
      if (min === null && max === null) continue;
      out[key] = kind === 'growth'
        ? { timespan: ['6months', '12months', '24months'].includes(value.timespan) ? value.timespan : '12months', min, max }
        : { min, max };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

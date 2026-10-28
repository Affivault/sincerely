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
  /** The heading it sits under in a grouped dropdown, e.g. "Sales". */
  group?: string;
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

/*
 * Titles and skills by function, so a dropdown can show them grouped and an
 * empty box can offer a whole function at once. Within a group, most
 * searched first. Both are free text on Icypeas: these are the spellings
 * profiles actually use.
 */
const groups = (src: Record<string, string>) => Object.fromEntries(Object.entries(src).map(([k, v]) => [k, v.split('|').map((s) => s.trim()).filter(Boolean)]));

export const PROSPECT_TITLE_GROUPS: Record<string, string[]> = groups({
  'Founders & executives': 'Founder|Co-Founder|CEO|Chief Executive Officer|Owner|Managing Director|President|General Manager|Partner|Managing Partner|Chairman|Board Member|Entrepreneur|Chief Operating Officer|COO|Chief Strategy Officer|Chief of Staff',
  Sales: 'Chief Revenue Officer|CRO|Chief Sales Officer|VP Sales|Vice President of Sales|Head of Sales|Sales Director|Director of Sales|Regional Sales Director|Sales Manager|Area Sales Manager|Regional Sales Manager|Account Executive|Senior Account Executive|Enterprise Account Executive|Mid-Market Account Executive|Account Manager|Key Account Manager|Account Director|Sales Development Representative|SDR|Business Development Representative|BDR|Sales Representative|Sales Executive|Inside Sales Representative|Field Sales Representative|Sales Consultant|Solutions Engineer|Sales Engineer|Pre-Sales Consultant|Head of Sales Development|SDR Manager|Channel Sales Manager',
  'Business development & partnerships': 'Head of Business Development|Director of Business Development|Business Development Manager|Business Development Director|VP Business Development|Head of Partnerships|Director of Partnerships|Partnerships Manager|Partner Manager|Alliances Manager|Head of Alliances|Channel Partner Manager|Affiliate Manager|Head of Affiliates',
  Marketing: 'Chief Marketing Officer|CMO|VP Marketing|Head of Marketing|Marketing Director|Director of Marketing|Marketing Manager|Senior Marketing Manager|Product Marketing Manager|Head of Product Marketing|Brand Manager|Head of Brand|Content Manager|Head of Content|Content Strategist|Copywriter|Social Media Manager|Community Manager|Email Marketing Manager|CRM Manager|SEO Manager|Head of SEO|PPC Manager|Paid Media Manager|Performance Marketing Manager|Head of Performance Marketing|Digital Marketing Manager|Head of Digital|Marketing Executive|Marketing Coordinator|Events Manager|PR Manager|Communications Director|Head of Communications',
  Growth: 'Head of Growth|VP Growth|Director of Growth|Growth Manager|Growth Marketer|Growth Lead|Chief Growth Officer|Demand Generation Manager|Head of Demand Generation|Director of Demand Generation|Lifecycle Marketing Manager|Acquisition Manager|User Acquisition Manager',
  'Revenue operations': 'Head of Revenue Operations|VP Revenue Operations|Revenue Operations Manager|RevOps Manager|Sales Operations Manager|Head of Sales Operations|Marketing Operations Manager|Sales Enablement Manager|Head of Sales Enablement|CRM Administrator|Salesforce Administrator|HubSpot Administrator',
  'Customer success & support': 'Chief Customer Officer|VP Customer Success|Head of Customer Success|Director of Customer Success|Customer Success Manager|Senior Customer Success Manager|Head of Customer Experience|Customer Experience Manager|Head of Support|Customer Support Manager|Head of Account Management|Implementation Manager|Onboarding Manager',
  'Ecommerce & retail': 'Head of E-commerce|E-commerce Director|E-commerce Manager|Head of Digital Commerce|Marketplace Manager|Amazon Manager|Head of Retail|Retail Manager|Merchandising Manager|Category Manager|Buyer|Head of Buying',
  Product: 'Chief Product Officer|CPO|VP Product|Head of Product|Director of Product|Group Product Manager|Senior Product Manager|Product Manager|Product Owner|Technical Product Manager|Head of Product Design',
  Engineering: 'Chief Technology Officer|CTO|VP Engineering|Head of Engineering|Director of Engineering|Engineering Manager|Tech Lead|Principal Engineer|Staff Engineer|Senior Software Engineer|Software Engineer|Full Stack Developer|Frontend Developer|Backend Developer|Mobile Developer|DevOps Engineer|Site Reliability Engineer|Cloud Architect|Solutions Architect|QA Engineer|Head of Infrastructure',
  'IT & security': 'Chief Information Officer|CIO|Chief Information Security Officer|CISO|IT Director|Head of IT|IT Manager|Systems Administrator|Network Engineer|Security Engineer|Head of Security|Security Analyst',
  'Data & AI': 'Chief Data Officer|Head of Data|Director of Data|Data Scientist|Senior Data Scientist|Data Analyst|Data Engineer|Analytics Manager|Head of Analytics|Business Intelligence Manager|Machine Learning Engineer|AI Engineer|Head of AI',
  Design: 'Head of Design|Design Director|Creative Director|Art Director|Product Designer|UX Designer|UI Designer|UX Researcher|Graphic Designer|Brand Designer',
  Finance: 'Chief Financial Officer|CFO|VP Finance|Finance Director|Head of Finance|Financial Controller|Controller|Finance Manager|FP&A Manager|Head of FP&A|Accountant|Chartered Accountant|Tax Manager|Treasurer|Financial Analyst|Investor Relations Manager',
  'HR & talent': 'Chief People Officer|CHRO|VP People|Head of People|HR Director|HR Manager|HR Business Partner|People Partner|Head of Talent Acquisition|Talent Acquisition Manager|Recruitment Manager|Recruiter|Technical Recruiter|Talent Partner|Head of Learning and Development|Compensation and Benefits Manager',
  Operations: 'VP Operations|Head of Operations|Director of Operations|Operations Director|Operations Manager|Business Operations Manager|Office Manager|Executive Assistant|Project Manager|Program Manager|PMO Lead|Head of Procurement|Procurement Manager|Purchasing Manager|Supply Chain Manager|Head of Logistics|Logistics Manager|Facilities Manager',
  'Legal & compliance': 'General Counsel|Chief Legal Officer|Head of Legal|Legal Counsel|Lawyer|Solicitor|Attorney|Paralegal|Compliance Manager|Head of Compliance|Data Protection Officer|Risk Manager',
  'Agencies & consulting': 'Agency Owner|Agency Founder|Account Director|Client Services Director|Head of Client Services|Strategy Director|Planning Director|Consultant|Senior Consultant|Management Consultant|Principal Consultant|Associate Partner|Advisor|Freelance Consultant|Freelancer',
  'Investors & finance firms': 'Investor|Venture Partner|General Partner|Principal|Associate|Analyst|Angel Investor|Portfolio Manager|Investment Manager|Fund Manager|Wealth Manager|Financial Advisor|Mortgage Advisor|Broker',
  'Other professions': 'Real Estate Agent|Estate Agent|Property Manager|Doctor|Dentist|Pharmacist|Nurse|Teacher|Head Teacher|Professor|Lecturer|Researcher|Architect|Civil Engineer|Mechanical Engineer|Photographer|Journalist|Editor',
});

/** Common titles, by function, most-searched first within each. */
export const PROSPECT_JOB_TITLES = [...new Set(Object.values(PROSPECT_TITLE_GROUPS).flat())];
const TITLE_GROUP_OF = new Map(Object.entries(PROSPECT_TITLE_GROUPS).flatMap(([g, list]) => list.map((t) => [t, g] as const)));

/** A whole buyer type in one pick: the titles that describe it. */
export const PROSPECT_TITLE_PACKS: { label: string; values: string[] }[] = [
  { label: 'Founders & CEOs', values: ['Founder', 'Co-Founder', 'CEO', 'Owner', 'Managing Director'] },
  { label: 'Sales leaders', values: ['Chief Revenue Officer', 'VP Sales', 'Head of Sales', 'Sales Director', 'Director of Sales'] },
  { label: 'Marketing leaders', values: ['Chief Marketing Officer', 'CMO', 'VP Marketing', 'Head of Marketing', 'Marketing Director'] },
  { label: 'Growth', values: ['Head of Growth', 'VP Growth', 'Growth Manager', 'Head of Demand Generation'] },
  { label: 'RevOps', values: ['Head of Revenue Operations', 'Revenue Operations Manager', 'Sales Operations Manager'] },
  { label: 'Partnerships', values: ['Head of Partnerships', 'Partnerships Manager', 'Head of Business Development'] },
  { label: 'Ecommerce', values: ['Head of E-commerce', 'E-commerce Director', 'E-commerce Manager'] },
  { label: 'Tech leaders', values: ['CTO', 'VP Engineering', 'Head of Engineering', 'Director of Engineering'] },
  { label: 'Finance leaders', values: ['CFO', 'Finance Director', 'Head of Finance', 'VP Finance'] },
  { label: 'HR & talent', values: ['Chief People Officer', 'Head of People', 'HR Director', 'Head of Talent Acquisition'] },
  { label: 'Ops leaders', values: ['COO', 'VP Operations', 'Head of Operations', 'Operations Director'] },
  { label: 'Agency owners', values: ['Agency Owner', 'Agency Founder', 'Managing Director', 'Founder'] },
];

/** Short forms people type, mapped to the titles that spell them out. */
export const TITLE_ALIASES: Record<string, string[]> = {
  ceo: ['Chief Executive Officer', 'Managing Director'], cmo: ['Chief Marketing Officer', 'VP Marketing'], cro: ['Chief Revenue Officer', 'VP Sales'],
  cto: ['Chief Technology Officer', 'VP Engineering'], cfo: ['Chief Financial Officer', 'Finance Director'], coo: ['Chief Operating Officer', 'VP Operations'],
  cpo: ['Chief Product Officer', 'Chief People Officer'], md: ['Managing Director'], vp: ['VP Sales', 'VP Marketing', 'VP Growth'],
  hr: ['HR Director', 'HR Manager', 'Head of People'], revops: ['Head of Revenue Operations', 'Revenue Operations Manager'],
  ae: ['Account Executive', 'Senior Account Executive'], am: ['Account Manager', 'Key Account Manager'], csm: ['Customer Success Manager'],
  pm: ['Product Manager', 'Project Manager'], seo: ['SEO Manager', 'Head of SEO'], ecom: ['Head of E-commerce', 'E-commerce Manager'],
  boss: ['Founder', 'CEO', 'Owner'], 'decision maker': ['Founder', 'CEO', 'Managing Director', 'Owner'],
};

export const PROSPECT_SKILL_GROUPS: Record<string, string[]> = groups({
  'Sales': 'Sales|B2B Sales|SaaS Sales|Enterprise Sales|Solution Selling|Consultative Selling|Account Management|Key Account Management|Business Development|Lead Generation|Prospecting|Outbound Sales|Cold Calling|Cold Email|Social Selling|Negotiation|Closing|Pipeline Management|Sales Forecasting|Sales Management|Channel Sales|Inside Sales|Customer Relationship Management (CRM)|MEDDIC|Challenger Sale|SPIN Selling',
  'Sales & marketing tools': 'Salesforce|HubSpot|Pipedrive|Zoho CRM|Microsoft Dynamics|Outreach|Salesloft|Apollo|Lemlist|Gong|LinkedIn Sales Navigator|ZoomInfo|Marketo|Pardot|Mailchimp|Klaviyo|Intercom|Zendesk|Google Analytics|Google Ads|Meta Ads|Semrush|Ahrefs|Hotjar|Segment|Zapier|Make|Notion|Airtable|Monday.com|Asana|Jira',
  'Marketing': 'Marketing Strategy|Digital Marketing|Growth Marketing|Demand Generation|Account-Based Marketing (ABM)|Content Marketing|Email Marketing|Marketing Automation|Lifecycle Marketing|Search Engine Optimization (SEO)|Search Engine Marketing (SEM)|Pay Per Click (PPC)|Paid Social|Social Media Marketing|Influencer Marketing|Affiliate Marketing|Performance Marketing|Conversion Rate Optimization|Copywriting|Brand Strategy|Branding|Product Marketing|Go-to-Market Strategy|Positioning|Public Relations|Event Marketing|Community Building|Marketing Analytics',
  'Ecommerce': 'E-commerce|Shopify|Shopify Plus|WooCommerce|Magento|BigCommerce|Amazon Seller Central|Marketplace Management|Direct-to-Consumer (DTC)|Merchandising|Retail|Omnichannel|Subscription Commerce|Fulfillment',
  'Product & design': 'Product Management|Product Strategy|Product Development|Roadmapping|User Research|UX Design|UI Design|Product Design|Figma|Design Thinking|A/B Testing|Agile|Scrum|Kanban|Lean Startup',
  'Engineering': 'Software Development|JavaScript|TypeScript|React|Node.js|Python|Java|C#|Go|Ruby on Rails|PHP|Swift|Kotlin|SQL|PostgreSQL|MongoDB|GraphQL|REST APIs|Microservices|DevOps|CI/CD|Docker|Kubernetes|Terraform|Linux|Git',
  'Cloud & IT': 'Amazon Web Services (AWS)|Microsoft Azure|Google Cloud Platform (GCP)|Cloud Computing|IT Strategy|IT Infrastructure|Network Security|Cybersecurity|Information Security|ITIL|SAP|Oracle|ServiceNow|Microsoft 365',
  'Data & AI': 'Data Analysis|Data Science|Machine Learning|Artificial Intelligence (AI)|Generative AI|Large Language Models (LLM)|Deep Learning|Natural Language Processing|Business Intelligence|Tableau|Power BI|Looker|Excel|Statistics|Data Engineering|Snowflake|dbt|Big Data',
  'Finance': 'Financial Analysis|Financial Modeling|Financial Planning|FP&A|Budgeting|Forecasting|Accounting|Bookkeeping|Audit|Tax|Corporate Finance|Mergers & Acquisitions (M&A)|Due Diligence|Valuation|Fundraising|Venture Capital|Private Equity|Investment Banking|Risk Management|Xero|QuickBooks|NetSuite',
  'Leadership & strategy': 'Leadership|Team Leadership|People Management|Strategic Planning|Business Strategy|Change Management|P&L Management|Stakeholder Management|Executive Leadership|Board Relations|Turnaround|Scaling Startups|Entrepreneurship|Startups',
  'Operations': 'Operations Management|Project Management|Program Management|Process Improvement|Lean Six Sigma|Supply Chain Management|Logistics|Procurement|Vendor Management|Inventory Management|Business Operations|Revenue Operations|Sales Operations|Customer Success|Customer Experience|Customer Support',
  'HR & talent': 'Recruiting|Technical Recruiting|Talent Acquisition|Employer Branding|Human Resources|HR Strategy|Employee Engagement|Learning & Development|Performance Management|Compensation & Benefits|Workday|Greenhouse|Payroll',
  'Legal & compliance': 'Contract Negotiation|Corporate Law|Commercial Law|Employment Law|Intellectual Property|GDPR|Compliance|Regulatory Affairs|Data Privacy',
  'Communication': 'Public Speaking|Presentation Skills|Storytelling|Writing|Editing|Video Production|Podcasting|Photography',
});

export const PROSPECT_SKILLS = [...new Set(Object.values(PROSPECT_SKILL_GROUPS).flat())];
const SKILL_GROUP_OF = new Map(Object.entries(PROSPECT_SKILL_GROUPS).flatMap(([g, list]) => list.map((t) => [t, g] as const)));

/** A few one-click skill picks per function, for an empty skills box. */
export const PROSPECT_SKILL_PACKS: { label: string; values: string[] }[] = [
  { label: 'Outbound sellers', values: ['Outbound Sales', 'Cold Calling', 'Cold Email', 'Lead Generation', 'Prospecting'] },
  { label: 'Salesforce users', values: ['Salesforce'] },
  { label: 'HubSpot users', values: ['HubSpot'] },
  { label: 'Paid ads', values: ['Google Ads', 'Meta Ads', 'Pay Per Click (PPC)', 'Paid Social'] },
  { label: 'SEO & content', values: ['Search Engine Optimization (SEO)', 'Content Marketing', 'Copywriting'] },
  { label: 'Shopify', values: ['Shopify', 'Shopify Plus', 'E-commerce'] },
  { label: 'AI', values: ['Artificial Intelligence (AI)', 'Generative AI', 'Machine Learning'] },
  { label: 'Fundraising', values: ['Fundraising', 'Venture Capital'] },
  { label: 'Hiring', values: ['Recruiting', 'Talent Acquisition'] },
];

export const SKILL_ALIASES: Record<string, string[]> = {
  seo: ['Search Engine Optimization (SEO)'], sem: ['Search Engine Marketing (SEM)'], ppc: ['Pay Per Click (PPC)', 'Google Ads'], abm: ['Account-Based Marketing (ABM)'],
  ai: ['Artificial Intelligence (AI)', 'Generative AI', 'Machine Learning'], ml: ['Machine Learning'], llm: ['Large Language Models (LLM)'], crm: ['Customer Relationship Management (CRM)', 'Salesforce', 'HubSpot'],
  aws: ['Amazon Web Services (AWS)'], gcp: ['Google Cloud Platform (GCP)'], js: ['JavaScript'], ts: ['TypeScript'], 'm&a': ['Mergers & Acquisitions (M&A)'],
  dtc: ['Direct-to-Consumer (DTC)'], d2c: ['Direct-to-Consumer (DTC)'], facebook: ['Meta Ads'], ads: ['Google Ads', 'Meta Ads', 'Paid Social'], outbound: ['Outbound Sales', 'Cold Email', 'Cold Calling'],
};

/** Titles as suggestions, each tagged with its function. */
export function suggestTitles(typed: string, limit = 60): ProspectSuggestion[] {
  return rankSuggestions(PROSPECT_JOB_TITLES, typed, limit, TITLE_ALIASES).map((s) => ({ ...s, group: TITLE_GROUP_OF.get(s.value) }));
}
/** Skills as suggestions, each tagged with its area. */
export function suggestSkills(typed: string, limit = 80): ProspectSuggestion[] {
  return rankSuggestions(PROSPECT_SKILLS, typed, typed.trim() ? limit : PROSPECT_SKILLS.length, SKILL_ALIASES).map((s) => ({ ...s, group: SKILL_GROUP_OF.get(s.value) }));
}

/*
 * One-click ranges for the numeric filters, so nobody has to think in raw
 * numbers. "Custom" stays available beside them.
 */
export interface RangePreset { label: string; min: number | null; max: number | null }
export const EXPERIENCE_PRESETS: RangePreset[] = [
  { label: 'Under 2 yrs', min: null, max: 2 }, { label: '3-5 yrs', min: 3, max: 5 }, { label: '6-10 yrs', min: 6, max: 10 },
  { label: '10-20 yrs', min: 10, max: 20 }, { label: '20+ yrs', min: 20, max: null },
];
export const TENURE_PRESETS: RangePreset[] = [
  { label: 'New (under 1 yr)', min: null, max: 1 }, { label: '1-2 yrs', min: 1, max: 2 }, { label: '2-5 yrs', min: 2, max: 5 }, { label: '5+ yrs', min: 5, max: null },
];
export const REVENUE_PRESETS: RangePreset[] = [
  { label: 'Under $1M', min: null, max: 1_000_000 }, { label: '$1-10M', min: 1_000_000, max: 10_000_000 }, { label: '$10-50M', min: 10_000_000, max: 50_000_000 },
  { label: '$50-250M', min: 50_000_000, max: 250_000_000 }, { label: '$250M-1B', min: 250_000_000, max: 1_000_000_000 }, { label: '$1B+', min: 1_000_000_000, max: null },
];
export const GROWTH_PRESETS: RangePreset[] = [
  { label: 'Shrinking', min: null, max: -1 }, { label: 'Steady', min: 0, max: 10 }, { label: 'Growing 10%+', min: 10, max: null },
  { label: 'Fast 25%+', min: 25, max: null }, { label: 'Hypergrowth 50%+', min: 50, max: null },
];

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

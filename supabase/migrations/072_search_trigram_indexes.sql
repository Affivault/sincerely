-- ============================================================================
-- 072  Make search use an index instead of reading every row
-- ============================================================================
--
-- WHAT WAS WRONG
--
-- Every search in this application is a leading-wildcard match:
--
--     email ILIKE '%acme%'
--
-- A leading wildcard cannot use a B-tree index, so each one of these is a
-- sequential scan of the whole table. There was no trigram index anywhere
-- in the schema, so every search in the product was a full scan.
--
-- The worst of it is the command palette. One keystroke fans out across
-- nine tables in parallel:
--
--     contacts          email, first_name, last_name, company
--     companies         name, domain, industry
--     deals             title, company, contact_name
--     campaigns         name
--     contact_lists     name
--     crm_tasks         title
--     crm_events        title
--     email_templates   name, subject
--     inbox_messages    subject, from_email
--
-- The Suppression list has its own search box against suppression_list.email
-- and is covered here too.
--
-- That is nine sequential scans per keystroke. It is fast on a new account
-- and it gets slower every day the product is used, which is the shape of
-- problem that is invisible in development and only ever reported as "the
-- app feels slow".
--
-- WHAT THIS DOES
--
-- pg_trgm lets a GIN index serve ILIKE '%term%' by indexing every three
-- character sequence in the value. btree_gin lets user_id sit in the SAME
-- index, which matters here more than it usually would: these tables are
-- multi-tenant, and a trigram index on the column alone would find every
-- matching row belonging to every account and then throw away all but one
-- account's. The composite restricts the scan to the account first.
--
-- NOTES BEFORE YOU RUN IT
--
--   * This is SAFE TO RE-RUN. Every statement is IF NOT EXISTS.
--
--   * CREATE INDEX CONCURRENTLY is deliberately NOT used. It cannot run
--     inside a transaction and the Supabase SQL editor wraps a pasted
--     script in one, so it would fail. A plain CREATE INDEX takes a lock
--     that blocks writes to that table while it builds. These are short
--     text columns, so each build is quick, but if this runs against a
--     large live mailbox expect a brief pause on writes.
--
--   * Message BODIES are not indexed here. That is migration 073, kept
--     separate because it is a much larger index with a real cost, and it
--     should be a decision rather than something that arrives attached to
--     this one.
--
--   * A search term shorter than three characters still cannot use these
--     indexes, because there is no complete trigram to look up. The
--     command palette's minimum has been raised to three characters in
--     the same change for exactly that reason.
--
-- ============================================================================

-- Works whether these extensions already live in public or in extensions.
set search_path = public, extensions;

create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gin with schema extensions;


-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------
create index if not exists idx_contacts_user_email_trgm
  on contacts using gin (user_id, email gin_trgm_ops);

create index if not exists idx_contacts_user_first_name_trgm
  on contacts using gin (user_id, first_name gin_trgm_ops);

create index if not exists idx_contacts_user_last_name_trgm
  on contacts using gin (user_id, last_name gin_trgm_ops);

create index if not exists idx_contacts_user_company_trgm
  on contacts using gin (user_id, company gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create index if not exists idx_companies_user_name_trgm
  on companies using gin (user_id, name gin_trgm_ops);

create index if not exists idx_companies_user_domain_trgm
  on companies using gin (user_id, domain gin_trgm_ops);

create index if not exists idx_companies_user_industry_trgm
  on companies using gin (user_id, industry gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------------
create index if not exists idx_deals_user_title_trgm
  on deals using gin (user_id, title gin_trgm_ops);

create index if not exists idx_deals_user_company_trgm
  on deals using gin (user_id, company gin_trgm_ops);

create index if not exists idx_deals_user_contact_name_trgm
  on deals using gin (user_id, contact_name gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------
create index if not exists idx_campaigns_user_name_trgm
  on campaigns using gin (user_id, name gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- contact_lists
-- ---------------------------------------------------------------------------
create index if not exists idx_contact_lists_user_name_trgm
  on contact_lists using gin (user_id, name gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- crm_tasks
-- ---------------------------------------------------------------------------
create index if not exists idx_crm_tasks_user_title_trgm
  on crm_tasks using gin (user_id, title gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- crm_events
-- ---------------------------------------------------------------------------
create index if not exists idx_crm_events_user_title_trgm
  on crm_events using gin (user_id, title gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- email_templates
-- ---------------------------------------------------------------------------
create index if not exists idx_email_templates_user_name_trgm
  on email_templates using gin (user_id, name gin_trgm_ops);

create index if not exists idx_email_templates_user_subject_trgm
  on email_templates using gin (user_id, subject gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- inbox_messages  (headers only; bodies are migration 073)
-- ---------------------------------------------------------------------------
create index if not exists idx_inbox_messages_user_subject_trgm
  on inbox_messages using gin (user_id, subject gin_trgm_ops);

create index if not exists idx_inbox_messages_user_from_email_trgm
  on inbox_messages using gin (user_id, from_email gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- suppression_list
--
-- Not part of the palette, but the Suppression screen's own search box runs
-- the same leading-wildcard match, and this is the table people paste
-- thousands of addresses into.
-- ---------------------------------------------------------------------------
create index if not exists idx_suppression_list_user_email_trgm
  on suppression_list using gin (user_id, email gin_trgm_ops);


-- ---------------------------------------------------------------------------
-- Planner statistics
--
-- A brand new index is used straight away, but the planner decides WHETHER
-- to use it from statistics, and on a table that has just grown a lot those
-- can be stale enough that it keeps choosing the sequential scan it already
-- knows about. This is cheap and removes the question.
-- ---------------------------------------------------------------------------
analyze contacts;
analyze companies;
analyze deals;
analyze campaigns;
analyze contact_lists;
analyze crm_tasks;
analyze crm_events;
analyze email_templates;
analyze inbox_messages;
analyze suppression_list;

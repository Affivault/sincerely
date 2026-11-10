/**
 * Two-way CRM sync (HubSpot, Pipedrive): the settings a person chooses, the
 * field mapping, and what the status page shows. Shared so the client form
 * and the server validate the same way.
 */

export type CrmSyncProvider = 'hubspot' | 'pipedrive';
export const CRM_SYNC_PROVIDERS: CrmSyncProvider[] = ['hubspot', 'pipedrive'];
export const isCrmSyncProvider = (p: string): p is CrmSyncProvider => (CRM_SYNC_PROVIDERS as string[]).includes(p);

/** Which way one mapped field travels. */
export type CrmFieldDirection = 'both' | 'to_crm' | 'from_crm';

export interface CrmFieldMap {
  /** A Sincerely contact field (see CRM_SINCERELY_FIELDS), or custom:<name> for a custom field. */
  sincerely: string;
  /** The CRM property (HubSpot internal name, Pipedrive field key). */
  crm: string;
  direction: CrmFieldDirection;
}

/** The contact fields that can be mapped. Email is the key that matches people, so it is never mapped. */
export const CRM_SINCERELY_FIELDS: { key: string; label: string }[] = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
  { key: 'company', label: 'Company' },
  { key: 'job_title', label: 'Job title' },
  { key: 'phone', label: 'Phone' },
  { key: 'website', label: 'Website' },
  { key: 'linkedin_url', label: 'LinkedIn URL' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State / region' },
  { key: 'country', label: 'Country' },
  { key: 'industry', label: 'Industry' },
];

export const CRM_DEFAULT_MAPPING: Record<CrmSyncProvider, CrmFieldMap[]> = {
  hubspot: [
    { sincerely: 'first_name', crm: 'firstname', direction: 'both' },
    { sincerely: 'last_name', crm: 'lastname', direction: 'both' },
    { sincerely: 'company', crm: 'company', direction: 'both' },
    { sincerely: 'job_title', crm: 'jobtitle', direction: 'both' },
    { sincerely: 'phone', crm: 'phone', direction: 'both' },
    { sincerely: 'website', crm: 'website', direction: 'both' },
    { sincerely: 'city', crm: 'city', direction: 'both' },
    { sincerely: 'state', crm: 'state', direction: 'both' },
    { sincerely: 'country', crm: 'country', direction: 'both' },
  ],
  pipedrive: [
    { sincerely: 'first_name', crm: 'first_name', direction: 'both' },
    { sincerely: 'last_name', crm: 'last_name', direction: 'both' },
    { sincerely: 'company', crm: 'org_name', direction: 'both' },
    { sincerely: 'phone', crm: 'phone', direction: 'both' },
  ],
};

/** Which Sincerely contacts are sent to the CRM. */
export type CrmPushWhen = 'replied' | 'sent' | 'off';
/** What a won or lost deal in the CRM does to the person's sequences. */
export type CrmDealAction = 'stop' | 'nothing';

export interface CrmSyncSettings {
  /** People are created in the CRM when they reply (default) or when the first email goes out. */
  push_when: CrmPushWhen;
  /** Edits in the CRM come back into Sincerely. */
  pull_updates: boolean;
  /** Unsubscribes and bounces travel both ways. */
  sync_optouts: boolean;
  mapping: CrmFieldMap[];
  /** Where a deal for an interested reply goes. Empty = the CRM's default pipeline and first stage. */
  deal_pipeline: string;
  deal_stage: string;
  on_deal_won: CrmDealAction;
  on_deal_lost: CrmDealAction;
}

export function defaultCrmSyncSettings(provider: CrmSyncProvider): CrmSyncSettings {
  return {
    push_when: 'replied',
    pull_updates: true,
    sync_optouts: true,
    mapping: CRM_DEFAULT_MAPPING[provider].map((m) => ({ ...m })),
    deal_pipeline: '',
    deal_stage: '',
    on_deal_won: 'stop',
    on_deal_lost: 'stop',
  };
}

const SINCERELY_KEYS = new Set(CRM_SINCERELY_FIELDS.map((f) => f.key));
const CUSTOM_KEY = /^custom:[A-Za-z0-9 _.-]{1,60}$/;
const CRM_KEY = /^[A-Za-z0-9_.-]{1,100}$/;

/** A mapping target on the Sincerely side is a known field or a custom field. */
export function isSincerelyMapKey(key: string): boolean {
  return SINCERELY_KEYS.has(key) || CUSTOM_KEY.test(key);
}

/**
 * Settings as stored, from whatever was sent: unknown keys are dropped,
 * missing ones take the default, and a mapping keeps only well-formed rows
 * with each Sincerely field and each CRM field used once.
 */
export function sanitizeCrmSyncSettings(provider: CrmSyncProvider, raw: unknown): CrmSyncSettings {
  const d = defaultCrmSyncSettings(provider);
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
  const str = (v: unknown, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const action = (v: unknown, dflt: CrmDealAction): CrmDealAction => (v === 'stop' || v === 'nothing' ? v : dflt);

  let mapping = d.mapping;
  if (Array.isArray(r.mapping)) {
    const seenS = new Set<string>();
    const seenC = new Set<string>();
    mapping = [];
    for (const row of r.mapping.slice(0, 50)) {
      if (!row || typeof row !== 'object') continue;
      const m = row as Record<string, unknown>;
      const s = str(m.sincerely, 70);
      const c = str(m.crm);
      const dir = m.direction === 'to_crm' || m.direction === 'from_crm' ? m.direction : 'both';
      if (!isSincerelyMapKey(s) || !CRM_KEY.test(c) || c.toLowerCase() === 'email') continue;
      if (seenS.has(s) || seenC.has(c)) continue;
      seenS.add(s);
      seenC.add(c);
      mapping.push({ sincerely: s, crm: c, direction: dir });
    }
  }

  return {
    push_when: r.push_when === 'sent' || r.push_when === 'off' || r.push_when === 'replied' ? r.push_when : d.push_when,
    pull_updates: bool(r.pull_updates, d.pull_updates),
    sync_optouts: bool(r.sync_optouts, d.sync_optouts),
    mapping,
    deal_pipeline: str(r.deal_pipeline),
    deal_stage: str(r.deal_stage),
    on_deal_won: action(r.on_deal_won, d.on_deal_won),
    on_deal_lost: action(r.on_deal_lost, d.on_deal_lost),
  };
}

// ── What the status page shows ────────────────────────────────────

export type CrmSyncDirection = 'to_crm' | 'from_crm';
export type CrmSyncKind = 'contact' | 'activity' | 'deal' | 'optout' | 'list' | 'sync';
export type CrmSyncStatus = 'ok' | 'failed' | 'skipped';

export interface CrmSyncLogEntry {
  id: string;
  direction: CrmSyncDirection;
  kind: CrmSyncKind;
  contact_id: string | null;
  email: string | null;
  status: CrmSyncStatus;
  summary: string;
  error: string | null;
  /** A failure Sincerely can send again. */
  retryable: boolean;
  attempts: number;
  created_at: string;
}

export interface CrmListSync {
  id: string;
  external_id: string;
  external_name: string;
  list_id: string | null;
  list_name: string | null;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface CrmSyncOverview {
  integration_id: string;
  provider: CrmSyncProvider;
  settings: CrmSyncSettings;
  last_sync_at: string | null;
  next_sync_at: string | null;
  last_sync_error: string | null;
  linked: number;
  /** In the last 24 hours. */
  moved_24h: { to_crm: number; from_crm: number };
  failed_24h: number;
  /** Failures that can still be retried. */
  retryable: number;
  list_syncs: CrmListSync[];
  /** The first sync, or a "send these people" run. Null before migration 119. */
  backfill: CrmBackfill | null;
  /** Set when the database has not had migration 118 yet. */
  unavailable?: boolean;
}

/** Live choices from the CRM for the settings form. */
export interface CrmSyncOptions {
  fields: { key: string; label: string }[];
  pipelines: { id: string; label: string; stages: { id: string; label: string }[] }[];
  lists: { id: string; name: string; size: number | null }[];
  /** What could not be read, and why (often a missing permission). */
  warnings: string[];
}

export const CRM_SYNC_KIND_LABEL: Record<CrmSyncKind, string> = {
  contact: 'Contact',
  activity: 'Activity',
  deal: 'Deal',
  optout: 'Unsubscribe / bounce',
  list: 'List',
  sync: 'Sync',
};

// ── The first sync (and "Send to HubSpot" for picked people) ─────

export type CrmToScope = 'all' | 'list' | 'ids' | 'none';
export type CrmFromScope = 'all' | 'list' | 'none';

export interface CrmBackfillSide {
  scope: string;
  total: number | null;
  done: number;
  failed?: number;
  added?: number;
}

export interface CrmBackfill {
  status: 'idle' | 'running' | 'done' | 'failed';
  /** When the setup on the sync page was finished; until then the page shows it. */
  setup_done_at: string | null;
  to_crm: (CrmBackfillSide & { list_id?: string | null }) | null;
  from_crm: (CrmBackfillSide & { external_id?: string | null; external_name?: string | null; list_id?: string | null }) | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface CrmBackfillInput {
  to_crm: { scope: Exclude<CrmToScope, 'ids'>; list_id?: string };
  from_crm: {
    scope: CrmFromScope;
    /** The CRM list (HubSpot) or filter (Pipedrive), for scope 'list'. */
    external_id?: string;
    external_name?: string;
    /** The Sincerely list they go into; empty = a new list named after the CRM one. */
    list_id?: string;
  };
}

/** One person, as the contact page shows them in a connected CRM. */
export interface CrmContactStatus {
  integration_id: string;
  provider: CrmSyncProvider;
  linked: boolean;
  external_id: string | null;
  /** Opens the record in the CRM, when the account address is known. */
  url: string | null;
  synced_at: string | null;
  deal: { id: string; status: string | null; url: string | null } | null;
  recent: { summary: string; status: 'ok' | 'failed' | 'skipped'; created_at: string }[];
}

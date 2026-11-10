import type { CrmSyncOptions, CrmSyncProvider } from '@lemlist/shared';

/** One person as the CRM has them, with the mapped properties read. */
export interface CrmPerson {
  id: string;
  email: string | null;
  /** CRM property -> value (null when empty). Only the properties asked for. */
  values: Record<string, string | null>;
  /** When the CRM record last changed (ISO), as the CRM reports it. */
  updatedAt: string | null;
  /** The CRM says this person has opted out of email. */
  optedOut: boolean;
  /** The CRM says this address bounces hard. */
  bounced: boolean;
}

export type CrmDealStatus = 'open' | 'won' | 'lost';

export interface CrmDeal {
  id: string;
  status: CrmDealStatus;
  personIds: string[];
  updatedAt: string | null;
}

export type CrmActivityKind = 'sent' | 'opened' | 'clicked' | 'replied' | 'intent' | 'bounced' | 'unsubscribed';

export interface CrmActivity {
  kind: CrmActivityKind;
  /** One line: "Email sent: Quick question". */
  title: string;
  /** Plain-text detail lines. */
  lines: string[];
  at: string;
}

/** A page of changed records and the cursor for the next read. */
export interface CrmChanges<T> {
  items: T[];
  /** Where the next run starts reading. */
  cursor: string;
  /** More changed records are waiting beyond this page. */
  more: boolean;
}

export interface CrmAdapter {
  provider: CrmSyncProvider;
  label: string;
  /** Create the person, or update the one with this email / id. Values are CRM property -> value. */
  upsertPerson(email: string, values: Record<string, string>, knownId?: string | null): Promise<{ id: string; created: boolean }>;
  /** Write changed properties onto an existing person. */
  updatePerson(id: string, values: Record<string, string>): Promise<void>;
  /** Read people by id (for the ones a list holds). */
  getPeople(ids: string[], properties: string[]): Promise<CrmPerson[]>;
  /** People changed since the cursor, oldest first. An empty cursor means "from now". */
  changedPeople(cursor: string, properties: string[]): Promise<CrmChanges<CrmPerson>>;
  /** Deals changed since the cursor, with the people on them. */
  changedDeals(cursor: string): Promise<CrmChanges<CrmDeal>>;
  logActivity(personId: string, activity: CrmActivity): Promise<void>;
  createDeal(personId: string, input: { title: string; pipeline: string; stage: string; ownerId?: string }): Promise<{ id: string }>;
  /** Give people an owner in the CRM (only ever done when Sincerely created them). */
  assignOwner(personIds: string[], ownerId: string): Promise<void>;
  /** Move a person forward to a lifecycle stage. 'unsupported' when the CRM has none, or refuses (it never moves backwards). */
  setLifecycle(personId: string, stage: 'lead' | 'salesqualifiedlead' | 'opportunity'): Promise<'done' | 'unsupported'>;
  /** A to-do for the owner, tied to the person. */
  createTask(personId: string, input: { subject: string; body: string; dueAt: string; ownerId?: string }): Promise<void>;
  /** Attach the person to their company, found by domain or created. 'unsupported' where the CRM does this another way. */
  linkCompany(personId: string, company: { domain: string; name: string }): Promise<'done' | 'unsupported'>;
  /** Opt the person out of email in the CRM. 'unsupported' when the account cannot (a plan or a permission). */
  optOut(personId: string, email: string): Promise<'done' | 'unsupported'>;
  /** Ids of the people in a list (HubSpot) or filter (Pipedrive), a page at a time. */
  listMembers(listId: string, cursor: string | null): Promise<{ ids: string[]; people?: CrmPerson[]; next: string | null }>;
  /** Choices for the settings form. Never throws: what cannot be read is a warning. */
  options(): Promise<CrmSyncOptions>;
  /** Create or update many people at once, matched by email. One result per input, in order. */
  upsertPeople(items: { email: string; values: Record<string, string> }[]): Promise<{ email: string; id?: string; created?: boolean; error?: string }[]>;
  /** Everyone in the CRM, a page at a time. */
  allPeople(cursor: string | null, properties: string[]): Promise<{ people: CrmPerson[]; next: string | null }>;
  /** How many people the CRM holds, or are in a list; null when it will not say. */
  countPeople(listId?: string): Promise<number | null>;
  /** Where records live in the CRM's own app, for links. Null when it cannot be read. */
  account(): Promise<CrmAccount | null>;
}

export interface CrmAccount {
  /** HubSpot portal (hub) id. */
  portal_id?: string;
  /** HubSpot app host, e.g. app.hubspot.com or app-eu1.hubspot.com. */
  ui_domain?: string;
  /** Pipedrive company subdomain. */
  company_domain?: string;
}

export function recordUrl(provider: 'hubspot' | 'pipedrive', account: CrmAccount | null, kind: 'person' | 'deal', id: string): string | null {
  if (!account || !id) return null;
  const safe = encodeURIComponent(id);
  if (provider === 'hubspot') {
    if (!account.portal_id || !/^\d+$/.test(account.portal_id)) return null;
    const host = account.ui_domain && /^app(-[a-z0-9]+)?\.hubspot\.com$/.test(account.ui_domain) ? account.ui_domain : 'app.hubspot.com';
    return `https://${host}/contacts/${account.portal_id}/record/${kind === 'person' ? '0-1' : '0-3'}/${safe}`;
  }
  if (!account.company_domain || !/^[a-z0-9-]+$/i.test(account.company_domain)) return null;
  return `https://${account.company_domain}.pipedrive.com/${kind === 'person' ? 'person' : 'deal'}/${safe}`;
}

/** Cursor helpers: a cursor is an ISO time, or '' for "start from now". */
export const nowIso = () => new Date().toISOString();

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
  createDeal(personId: string, input: { title: string; pipeline: string; stage: string }): Promise<{ id: string }>;
  /** Opt the person out of email in the CRM. 'unsupported' when the account cannot (a plan or a permission). */
  optOut(personId: string, email: string): Promise<'done' | 'unsupported'>;
  /** Ids of the people in a list (HubSpot) or filter (Pipedrive), a page at a time. */
  listMembers(listId: string, cursor: string | null): Promise<{ ids: string[]; people?: CrmPerson[]; next: string | null }>;
  /** Choices for the settings form. Never throws: what cannot be read is a warning. */
  options(): Promise<CrmSyncOptions>;
}

/** Cursor helpers: a cursor is an ISO time, or '' for "start from now". */
export const nowIso = () => new Date().toISOString();

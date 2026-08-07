export type DealStage = 'lead' | 'qualified' | 'proposal' | 'won' | 'lost';
export type TaskPriority = 'low' | 'normal' | 'high';
export type EventType = 'call' | 'meeting';

/** Live contact data embedded on a deal when it's linked to a lead. */
export interface DealContact {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  /** Set once the contact is linked to a company record. */
  company_id: string | null;
  job_title: string | null;
  phone: string | null;
  linkedin_url: string | null;
}

export interface Deal {
  id: string;
  user_id: string;
  title: string;
  company: string | null;
  /** Set once the deal is linked to a company record (migration 038). */
  company_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_id: string | null;
  value: number;
  currency: string;
  stage: DealStage;
  expected_close_date: string | null;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  /** Embedded lead (server-joined via contact_id) — null when not linked */
  contact?: DealContact | null;
}

export interface CreateDealInput {
  title: string;
  company?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_id?: string | null;
  value?: number;
  currency?: string;
  stage?: DealStage;
  expected_close_date?: string | null;
  notes?: string | null;
}
export interface UpdateDealInput extends Partial<CreateDealInput> {
  position?: number;
}

/** What kind of activity a task represents — drives its icon and grouping. */
export type TaskType = 'todo' | 'call' | 'meeting' | 'email' | 'follow_up' | 'deadline';

export const TASK_TYPES: { id: TaskType; label: string }[] = [
  { id: 'todo', label: 'To-do' },
  { id: 'call', label: 'Call' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'email', label: 'Email' },
  { id: 'follow_up', label: 'Follow-up' },
  { id: 'deadline', label: 'Deadline' },
];

export interface CrmTask {
  id: string;
  user_id: string;
  title: string;
  due_date: string | null;
  is_done: boolean;
  /** When it was ticked off — powers "completed today" and history. */
  completed_at: string | null;
  priority: TaskPriority;
  type: TaskType;
  all_day: boolean;
  deal_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded when the API is asked for linked records. */
  contact?: { id: string; email: string; first_name: string | null; last_name: string | null; company: string | null } | null;
  deal?: { id: string; title: string; stage: DealStage } | null;
}

export interface CreateTaskInput {
  title: string;
  due_date?: string | null;
  priority?: TaskPriority;
  type?: TaskType;
  all_day?: boolean;
  deal_id?: string | null;
  contact_id?: string | null;
  contact_name?: string | null;
  notes?: string | null;
}
export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  is_done?: boolean;
}

export interface CrmEvent {
  id: string;
  user_id: string;
  title: string;
  type: EventType;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  location: string | null;
  notes: string | null;
  /** How it went, filled in afterwards. */
  outcome: string | null;
  deal_id: string | null;
  created_at: string;
  updated_at: string;
  contact?: { id: string; email: string; first_name: string | null; last_name: string | null; company: string | null } | null;
  deal?: { id: string; title: string; stage: DealStage } | null;
}

export interface CreateEventInput {
  title: string;
  type?: EventType;
  starts_at: string;
  ends_at?: string | null;
  all_day?: boolean;
  contact_id?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  location?: string | null;
  notes?: string | null;
  outcome?: string | null;
  deal_id?: string | null;
}
export interface UpdateEventInput extends Partial<CreateEventInput> {}

export const DEAL_STAGES: { id: DealStage; label: string }[] = [
  { id: 'lead', label: 'Lead' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];


/* ── Notes ──────────────────────────────────────────────────────────────
   A note hangs off a contact, a deal, or both. Pinned notes float to the top
   of a profile — the standing context you want read before anything else. */

export interface CrmNote {
  id: string;
  user_id: string;
  contact_id: string | null;
  deal_id: string | null;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  deal?: { id: string; title: string; stage: DealStage } | null;
}

export interface CreateNoteInput {
  body: string;
  contact_id?: string | null;
  deal_id?: string | null;
  pinned?: boolean;
}
export interface UpdateNoteInput extends Partial<CreateNoteInput> {}

/** Everything CRM knows about one contact, for its profile page. */
export interface ContactCrmSummary {
  deals: Deal[];
  tasks: CrmTask[];
  events: CrmEvent[];
  notes: CrmNote[];
}

/* ── Companies ──────────────────────────────────────────────────────────
   The missing primitive. "Company" used to be free text on a contact, so
   the app could never answer "who else works here, and what's open there?" */

export interface Company {
  id: string;
  user_id: string;
  name: string;
  /** Matching key maintained by the database — read-only to clients. */
  normalized_name: string | null;
  domain: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  linkedin_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Rollups, present on list/detail responses. */
  contact_count?: number;
  deal_count?: number;
  open_value?: number;
}

export interface CreateCompanyInput {
  name: string;
  domain?: string | null;
  website?: string | null;
  industry?: string | null;
  size?: string | null;
  location?: string | null;
  linkedin_url?: string | null;
  notes?: string | null;
}
export interface UpdateCompanyInput extends Partial<CreateCompanyInput> {}

/** Everything on a company's page, in one request. */
export interface CompanySummary {
  company: Company;
  contacts: Array<{
    id: string; email: string; first_name: string | null; last_name: string | null;
    job_title: string | null; dcs_score: number | null;
  }>;
  deals: Deal[];
}

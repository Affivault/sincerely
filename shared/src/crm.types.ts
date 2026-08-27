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
  /**
   * This deal's own odds, 0-100. Null means "use the stage's default", which
   * is what almost every deal should be — a number nobody chose is false
   * precision, and false precision in a forecast is worse than a round one.
   */
  probability: number | null;
  /** Why it was won or lost. Null while it is still open. */
  outcome_reason: string | null;
  /** When it reached won or lost. Null while open. */
  closed_at: string | null;
  /**
   * The three-way read every pipeline has, made countable.
   *
   * Constrained rather than free text on purpose: the whole value of a
   * label is being able to ask "how much of the forecast is cold", and
   * seven spellings of "warm" cannot answer that.
   */
  label: DealLabel | null;
  /** Where the deal came from - a campaign, a referral, inbound, LinkedIn. */
  source: string | null;
  /**
   * When the stage last changed — not when the row last changed.
   *
   * `updated_at` moves when somebody fixes a typo, so it cannot answer "has
   * this deal moved?". That question is the whole of rot detection.
   */
  stage_changed_at: string | null;
  created_at: string;
  updated_at: string;
  /** Embedded lead (server-joined via contact_id) — null when not linked */
  contact?: DealContact | null;
}

export type DealLabel = 'hot' | 'warm' | 'cold';

export const DEAL_LABELS: { id: DealLabel; label: string }[] = [
  { id: 'hot', label: 'Hot' },
  { id: 'warm', label: 'Warm' },
  { id: 'cold', label: 'Cold' },
];

/**
 * Somebody on a deal who is not the primary contact.
 *
 * Real deals are not sold to one person: a champion wants it, a decision
 * maker signs it, somebody in security or procurement can stop it, and an
 * end user has to live with it. A pipeline that names only one of them
 * cannot answer the two questions that decide whether a deal closes - is
 * there a decision maker on this at all, and who is blocking it.
 */
export interface DealParticipant {
  id: string;
  deal_id: string;
  contact_id: string;
  /** Free text, with a known set offered in the UI so answers stay countable. */
  role: string | null;
  note: string | null;
  created_at: string;
  contact?: DealContact | null;
}

/**
 * The roles offered in the picker.
 *
 * Chosen to map onto who can actually stop a deal rather than onto job
 * titles, which vary by company and tell you nothing about the deal.
 */
export const PARTICIPANT_ROLES = [
  'Decision maker',
  'Champion',
  'Influencer',
  'Blocker',
  'Technical evaluator',
  'Procurement',
  'End user',
] as const;

/**
 * One recorded move of a deal from one stage to another.
 *
 * Written by a database trigger, never by the app, so every path that can
 * change a stage is covered - including bulk updates and anything run
 * straight against the database.
 */
export interface DealStageEvent {
  id: string;
  deal_id: string;
  /** Null on the opening row: the deal did not come from anywhere. */
  from_stage: DealStage | null;
  to_stage: DealStage;
  /** The won/lost reason as it stood at the moment of the move. */
  reason: string | null;
  changed_at: string;
}

export interface CreateDealInput {
  title: string;
  company?: string | null;
  /** Link to a company record; the free-text `company` stays for display. */
  company_id?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_id?: string | null;
  value?: number;
  currency?: string;
  stage?: DealStage;
  expected_close_date?: string | null;
  notes?: string | null;
  probability?: number | null;
  outcome_reason?: string | null;
  label?: DealLabel | null;
  source?: string | null;
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

  /* Set when a campaign step raised this task rather than a person.
     A LinkedIn touch is work the sequence can't do itself, so it parks the
     contact here and resumes when the task is ticked off. */
  /** 'linkedin_connect' | 'linkedin_message' | 'linkedin_visit'. */
  channel?: string | null;
  /** The exact words to send, already personalised. */
  payload?: string | null;
  /** Where to go and do it — usually the contact's LinkedIn profile. */
  target_url?: string | null;
  campaign_contact_id?: string | null;
  campaign_step_id?: string | null;

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
  /**
   * Deals this person leads and deals they are merely on.
   *
   * `participant_role` is set on the second kind. Leaving them out
   * understated a person's exposure: a technical evaluator who can sink
   * four deals looked, on their own page, like somebody with nothing
   * riding on anything.
   */
  deals: (Deal & { participant_role?: string | null })[];
  tasks: CrmTask[];
  events: CrmEvent[];
  notes: CrmNote[];
}

/** Everything the deal page renders, fetched in one request. */
export interface DealDetail {
  deal: Deal;
  participants: DealParticipant[];
  tasks: CrmTask[];
  events: CrmEvent[];
  notes: CrmNote[];
  history: DealStageEvent[];
  /** Inbox messages to or from anybody on the deal, newest first. */
  emails: DealEmail[];
}

/** An inbox message as the deal page needs it - enough to list and expand. */
export interface DealEmail {
  id: string;
  subject: string | null;
  from_email: string | null;
  to_email: string | null;
  direction: 'inbound' | 'outbound' | string;
  received_at: string;
  body_text: string | null;
  is_read: boolean | null;
  contact_id: string | null;
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

/** One inbox message as projected for a company's activity feed — a subset of InboxMessage plus the sender's resolved name. */
export interface CompanyActivityMessage {
  id: string;
  subject: string | null;
  from_email: string;
  to_email: string;
  contact_email: string | null;
  contact_name: string | null;
  direction: 'inbound' | 'outbound';
  received_at: string;
  body_text: string | null;
}

/** Everything on a company's page, in one request. */
/** The account's whole history, pooled from every person at it. */
export interface CompanyActivity {
  contacts: Array<{ id: string; email: string; first_name: string | null; last_name: string | null }>;
  messages: CompanyActivityMessage[];
  notes: CrmNote[];
  tasks: CrmTask[];
  events: CrmEvent[];
}

export interface CompanySummary {
  company: Company;
  contacts: Array<{
    id: string; email: string; first_name: string | null; last_name: string | null;
    job_title: string | null; dcs_score: number | null;
  }>;
  deals: Deal[];
}

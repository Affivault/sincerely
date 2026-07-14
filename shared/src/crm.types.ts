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
  job_title: string | null;
  phone: string | null;
  linkedin_url: string | null;
}

export interface Deal {
  id: string;
  user_id: string;
  title: string;
  company: string | null;
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

export interface CrmTask {
  id: string;
  user_id: string;
  title: string;
  due_date: string | null;
  is_done: boolean;
  priority: TaskPriority;
  deal_id: string | null;
  contact_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  title: string;
  due_date?: string | null;
  priority?: TaskPriority;
  deal_id?: string | null;
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
  contact_name: string | null;
  contact_email: string | null;
  location: string | null;
  notes: string | null;
  deal_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEventInput {
  title: string;
  type?: EventType;
  starts_at: string;
  ends_at?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  location?: string | null;
  notes?: string | null;
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

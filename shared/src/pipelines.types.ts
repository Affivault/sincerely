/* ═══════════════════════════════════════════════════════════════════════
   Pipelines you name yourself (migration 105).

   A pipeline is an ordered list of open stages. Each stage has a phase -
   lead, qualified or proposal - which is what deals.stage holds while the
   deal is open, so every report and rule written against the three phases
   keeps working however the stages are named. Won and lost are not stages
   of a pipeline; they are how a deal ends, and deals.stage says so.
   ═══════════════════════════════════════════════════════════════════════ */

export type PipelinePhase = 'lead' | 'qualified' | 'proposal';

export const PIPELINE_PHASES: readonly PipelinePhase[] = ['lead', 'qualified', 'proposal'];

/** How each phase is described where a stage is edited. */
export const PHASE_LABEL: Record<PipelinePhase, string> = {
  lead: 'Early',
  qualified: 'Qualified',
  proposal: 'Late',
};

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  phase: PipelinePhase;
  /** This stage's odds. Null means the phase default. */
  probability: number | null;
  /** Days without movement before a deal here counts as stalled. Null means the phase default. */
  rot_days: number | null;
  /** A palette colour by name (migration 106). Null means the stage's place in the order picks one. */
  color?: StageColor | null;
  /** What is true of a deal in this stage (migration 106). */
  description?: string | null;
  /** The things to get done in this stage, in order (migration 106). */
  checklist?: string[];
}

/* ─── Stage colours (migration 106) ───────────────────────────────────
   Stored by name, not hex, so the app decides the exact shade in light and
   dark mode and the database only ever holds one of these words. */

export const STAGE_COLORS = ['slate', 'blue', 'indigo', 'violet', 'pink', 'rose', 'orange', 'amber', 'emerald', 'teal', 'cyan'] as const;
export type StageColor = typeof STAGE_COLORS[number];

/** The order stages are coloured in when nobody picked one. Same as migration 106's backfill. */
export const AUTO_STAGE_COLORS: readonly StageColor[] = ['slate', 'blue', 'indigo', 'violet', 'amber', 'orange', 'emerald', 'teal', 'pink', 'cyan'];

export function stageColor(stage: { color?: StageColor | null }, index: number): StageColor {
  if (stage.color && (STAGE_COLORS as readonly string[]).includes(stage.color)) return stage.color;
  return AUTO_STAGE_COLORS[((index % AUTO_STAGE_COLORS.length) + AUTO_STAGE_COLORS.length) % AUTO_STAGE_COLORS.length];
}

export const STAGE_CHECKLIST_MAX = 10;
export const STAGE_CHECK_MAX_LENGTH = 120;
export const STAGE_DESCRIPTION_MAX_LENGTH = 280;

/** How far through a stage's checklist a deal is. Items are matched by their text. */
export function checklistProgress(
  stage: Pick<PipelineStage, 'id' | 'checklist'> | null | undefined,
  checks: Record<string, string[]> | null | undefined,
): { done: number; total: number } {
  const items = stage?.checklist || [];
  if (!stage || items.length === 0) return { done: 0, total: 0 };
  const ticked = new Set((checks && checks[stage.id]) || []);
  return { done: items.filter((i) => ticked.has(i)).length, total: items.length };
}

export interface Pipeline {
  id: string;
  name: string;
  position: number;
  is_default: boolean;
  created_at: string | null;
  stages: PipelineStage[];
}

export interface PipelinesResponse {
  /**
   * False until migration 105 has been run. The one pipeline returned is
   * then built from the three fixed phases and cannot be edited.
   */
  ready: boolean;
  /** False until migration 106 has been run: no colours, notes or checklists saved. */
  styled?: boolean;
  pipelines: Pipeline[];
}

/** The stage list a new pipeline starts with. */
export type StageTemplate = Pick<PipelineStage, 'name' | 'phase' | 'probability' | 'rot_days'> &
  Partial<Pick<PipelineStage, 'color' | 'description' | 'checklist'>>;

export const DEFAULT_PIPELINE_STAGES: StageTemplate[] = [
  { name: 'Lead', phase: 'lead', probability: 10, rot_days: 21, color: 'slate', description: 'Someone worth talking to, not yet qualified.', checklist: ['Confirm they match the ideal customer', 'Find the decision maker'] },
  { name: 'Qualified', phase: 'qualified', probability: 30, rot_days: 14, color: 'blue', description: 'A real need, a budget and someone who can say yes.', checklist: ['Confirm budget', 'Confirm timeline', 'Agree the problem to solve'] },
  { name: 'Meeting booked', phase: 'qualified', probability: 45, rot_days: 14, color: 'indigo', description: 'A call or demo is in the calendar.', checklist: ['Send the agenda', 'Invite everyone who decides'] },
  { name: 'Proposal', phase: 'proposal', probability: 60, rot_days: 10, color: 'amber', description: 'Pricing and terms are with them.', checklist: ['Send the proposal', 'Walk them through it live'] },
  { name: 'Negotiation', phase: 'proposal', probability: 80, rot_days: 10, color: 'emerald', description: 'Agreeing the final terms.', checklist: ['Agree price', 'Send the contract', 'Book the kickoff'] },
];

/** Starting points offered when a new pipeline is made. */
export const PIPELINE_TEMPLATES: Array<{ id: string; name: string; blurb: string; stages: StageTemplate[] }> = [
  { id: 'sales', name: 'New business', blurb: 'Lead to signed contract', stages: DEFAULT_PIPELINE_STAGES },
  {
    id: 'partners', name: 'Partnerships', blurb: 'Intro to a live partnership',
    stages: [
      { name: 'Intro', phase: 'lead', probability: 10, rot_days: 30, color: 'slate', description: 'A first conversation is lined up.' },
      { name: 'Exploring fit', phase: 'qualified', probability: 30, rot_days: 21, color: 'violet', description: 'Working out what both sides get.', checklist: ['Map the audience overlap', 'Agree what success looks like'] },
      { name: 'Terms', phase: 'proposal', probability: 60, rot_days: 14, color: 'amber', description: 'Commission, scope and length on the table.', checklist: ['Send the terms', 'Legal review'] },
      { name: 'Launching', phase: 'proposal', probability: 85, rot_days: 14, color: 'emerald', description: 'Signed, getting the first activity live.', checklist: ['Share assets', 'Set a launch date'] },
    ],
  },
  {
    id: 'renewals', name: 'Renewals and upsell', blurb: 'Existing customers growing',
    stages: [
      { name: 'Up for renewal', phase: 'lead', probability: 40, rot_days: 30, color: 'blue', description: 'Renewal date in the next 90 days.' },
      { name: 'Check-in held', phase: 'qualified', probability: 60, rot_days: 14, color: 'teal', description: 'Usage and goals reviewed with them.', checklist: ['Review usage', 'Ask about new teams'] },
      { name: 'Quote sent', phase: 'proposal', probability: 75, rot_days: 10, color: 'amber', checklist: ['Send the renewal quote'] },
      { name: 'Verbal yes', phase: 'proposal', probability: 90, rot_days: 7, color: 'emerald', checklist: ['Send the order form'] },
    ],
  },
  {
    id: 'fundraising', name: 'Fundraising', blurb: 'First meeting to term sheet',
    stages: [
      { name: 'Target', phase: 'lead', probability: 5, rot_days: 30, color: 'slate', checklist: ['Find a warm intro'] },
      { name: 'First meeting', phase: 'qualified', probability: 20, rot_days: 14, color: 'blue', checklist: ['Send the deck', 'Follow up within 24 hours'] },
      { name: 'Partner meeting', phase: 'qualified', probability: 40, rot_days: 14, color: 'violet', checklist: ['Open the data room'] },
      { name: 'Due diligence', phase: 'proposal', probability: 60, rot_days: 14, color: 'orange', checklist: ['Answer the diligence list', 'Line up customer references'] },
      { name: 'Term sheet', phase: 'proposal', probability: 85, rot_days: 7, color: 'emerald', checklist: ['Review with counsel'] },
    ],
  },
  { id: 'blank', name: 'Start from scratch', blurb: 'Three stages to rename', stages: [
    { name: 'Early', phase: 'lead', probability: null, rot_days: null },
    { name: 'Middle', phase: 'qualified', probability: null, rot_days: null },
    { name: 'Late', phase: 'proposal', probability: null, rot_days: null },
  ] },
];

/* ─── Stage settings the forecast maths reads ─────────────────────────
   probabilityOf and rotOf are pure and called from dozens of places. Rather
   than thread the pipeline through every one of them, the app registers the
   stages once they load and the maths looks a deal's stage up here. With
   nothing registered (the server, tests, before load) the phase defaults
   apply, exactly as before. */

const stageSettings = new Map<string, Pick<PipelineStage, 'probability' | 'rot_days'>>();

export function registerStageSettings(stages: Array<Pick<PipelineStage, 'id' | 'probability' | 'rot_days'>>): void {
  stageSettings.clear();
  for (const s of stages) stageSettings.set(s.id, { probability: s.probability, rot_days: s.rot_days });
}

export function stageSettingsFor(stageId: string | null | undefined): Pick<PipelineStage, 'probability' | 'rot_days'> | null {
  if (!stageId) return null;
  return stageSettings.get(stageId) || null;
}

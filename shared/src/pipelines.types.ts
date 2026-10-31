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
  pipelines: Pipeline[];
}

/** The stage list a new pipeline starts with. */
export const DEFAULT_PIPELINE_STAGES: Array<Pick<PipelineStage, 'name' | 'phase' | 'probability' | 'rot_days'>> = [
  { name: 'Lead', phase: 'lead', probability: 10, rot_days: 21 },
  { name: 'Qualified', phase: 'qualified', probability: 30, rot_days: 14 },
  { name: 'Meeting booked', phase: 'qualified', probability: 45, rot_days: 14 },
  { name: 'Proposal', phase: 'proposal', probability: 60, rot_days: 10 },
  { name: 'Negotiation', phase: 'proposal', probability: 80, rot_days: 10 },
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

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  DEFAULT_PIPELINE_STAGES,
  PIPELINE_PHASES,
  STAGE_CHECKLIST_MAX,
  STAGE_CHECK_MAX_LENGTH,
  STAGE_COLORS,
  STAGE_DESCRIPTION_MAX_LENGTH,
  type StageColor,
  type Pipeline,
  type PipelineStage,
  type PipelinesResponse,
  type PipelinePhase,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Pipelines and the stages inside them (migration 105).

   A user can run several pipelines (new business, partners, renewals) and
   name the stages of each. Every stage carries a phase - lead, qualified or
   proposal - so the forecast maths, rot rules and automations that read
   deals.stage keep working whatever the stages are called. A trigger in the
   database keeps deals.stage and deals.stage_id in step.

   Until migration 105 is run, the tables do not exist. Then this answers
   with one built-in pipeline made from the three fixed phases and says it is
   not ready, so the board still works and editing is offered only once the
   SQL has been applied.
   ═══════════════════════════════════════════════════════════════════════ */

const BASE_STAGE_COLS = 'id, pipeline_id, name, position, phase, probability, rot_days';
const STYLE_STAGE_COLS = `${BASE_STAGE_COLS}, color, description, checklist`;

/*
 * Colours, notes and checklists arrive with migration 106. Until it runs the
 * columns are missing, so reads fall back to the base columns and writes
 * leave them out. Checked once per process and remembered; a failed read
 * clears the memory so running the SQL takes effect without a restart.
 */
let styled: boolean | null = null;

function isMissingColumn(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return code === '42703' || code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(msg);
}

async function stageCols(): Promise<string> {
  if (styled === null) {
    const { error } = await supabaseAdmin.from('pipeline_stages').select('color, description, checklist').limit(1);
    styled = !error ? true : isMissingColumn(error) ? false : null;
  }
  return styled ? STYLE_STAGE_COLS : BASE_STAGE_COLS;
}

let STAGE_COLS = BASE_STAGE_COLS;
async function refreshStageCols() { STAGE_COLS = await stageCols(); }
const PIPELINE_COLS = 'id, name, position, is_default, created_at';

/** The table is not there yet: Postgres says 42P01, PostgREST says PGRST205. */
function isMissingTable(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return code === '42P01' || code === 'PGRST205' || /does not exist|could not find the table/i.test(msg);
}

/** The pipeline shown before migration 105 exists: one stage per open phase. */
function builtInPipeline(): Pipeline {
  const stages: PipelineStage[] = (['lead', 'qualified', 'proposal'] as PipelinePhase[]).map((phase, i) => ({
    id: phase,
    pipeline_id: 'default',
    name: phase === 'lead' ? 'Lead' : phase === 'qualified' ? 'Qualified' : 'Proposal',
    position: i,
    phase,
    probability: null,
    rot_days: null,
  }));
  return { id: 'default', name: 'Sales pipeline', position: 0, is_default: true, created_at: null, stages };
}

function cleanName(raw: unknown, what: string): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
  if (!name) throw new AppError(`${what} needs a name`, 400);
  return name;
}

function cleanPercent(raw: unknown): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError('Probability must be between 0 and 100', 400);
  return Math.round(n);
}

function cleanRotDays(raw: unknown): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 365) throw new AppError('Days before a deal goes stale must be between 1 and 365', 400);
  return n;
}

function cleanColor(raw: unknown): StageColor | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && (STAGE_COLORS as readonly string[]).includes(raw)) return raw as StageColor;
  throw new AppError('Pick a stage colour from the palette', 400);
}

function cleanDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new AppError('A stage note must be text', 400);
  const t = raw.trim();
  if (t.length > STAGE_DESCRIPTION_MAX_LENGTH) throw new AppError(`A stage note can be up to ${STAGE_DESCRIPTION_MAX_LENGTH} characters`, 400);
  return t || null;
}

function cleanChecklist(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) throw new AppError('A stage checklist must be a list', 400);
  const items = [...new Set(raw.filter((i): i is string => typeof i === 'string').map((i) => i.trim()).filter(Boolean))];
  if (items.length > STAGE_CHECKLIST_MAX) throw new AppError(`A stage can have up to ${STAGE_CHECKLIST_MAX} checklist items`, 400);
  if (items.some((i) => i.length > STAGE_CHECK_MAX_LENGTH)) throw new AppError(`Checklist items can be up to ${STAGE_CHECK_MAX_LENGTH} characters`, 400);
  return items;
}

/** The columns a stage row writes, leaving out the 106 ones until they exist. */
function stageFields(s: Partial<PipelineStage>, position: number) {
  const base = {
    name: cleanName(s.name, 'A stage'),
    position,
    phase: cleanPhase(s.phase),
    probability: cleanPercent(s.probability),
    rot_days: cleanRotDays(s.rot_days),
  };
  if (!styled) return base;
  return { ...base, color: cleanColor(s.color), description: cleanDescription(s.description), checklist: cleanChecklist(s.checklist) };
}

function cleanPhase(raw: unknown): PipelinePhase {
  if (typeof raw === 'string' && (PIPELINE_PHASES as readonly string[]).includes(raw)) return raw as PipelinePhase;
  throw new AppError('Each stage must count as lead, qualified or proposal', 400);
}

async function ownedPipeline(userId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from('pipelines')
    .select(PIPELINE_COLS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError('Pipeline not found', 404);
  return data as Omit<Pipeline, 'stages'>;
}

async function insertStages(userId: string, pipelineId: string, stages: Array<Partial<PipelineStage>>) {
  if (stages.length === 0) return;
  await refreshStageCols();
  const rows = stages.map((s, i) => ({ user_id: userId, pipeline_id: pipelineId, ...stageFields(s, i) }));
  const { error } = await supabaseAdmin.from('pipeline_stages').insert(rows);
  if (error) throw new AppError(error.message, 500);
}

export const pipelinesService = {
  /**
   * Every pipeline this user has, each with its stages in order. Makes the
   * default pipeline on first use, so a brand new account opens on a real
   * board rather than an empty settings screen.
   */
  async list(userId: string): Promise<PipelinesResponse> {
    const read = async () => {
      const { data, error } = await supabaseAdmin
        .from('pipelines')
        .select(PIPELINE_COLS)
        .eq('user_id', userId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true });
      return { data: (data || []) as Array<Omit<Pipeline, 'stages'>>, error };
    };

    let { data: pipelines, error } = await read();
    if (isMissingTable(error)) return { ready: false, pipelines: [builtInPipeline()] };
    if (error) throw new AppError(error.message, 500);

    if (pipelines.length === 0) {
      const { error: rpcError } = await supabaseAdmin.rpc('ensure_default_pipeline', { p_user: userId });
      if (rpcError) {
        if (isMissingTable(rpcError) || /function/i.test(String(rpcError.message || ''))) {
          return { ready: false, pipelines: [builtInPipeline()] };
        }
        throw new AppError(rpcError.message, 500);
      }
      ({ data: pipelines, error } = await read());
      if (error) throw new AppError(error.message, 500);
    }

    const ids = pipelines.map((p) => p.id);
    await refreshStageCols();
    let { data: stages, error: stageError } = await supabaseAdmin
      .from('pipeline_stages')
      .select(STAGE_COLS as '*')
      .eq('user_id', userId)
      .in('pipeline_id', ids)
      .order('position', { ascending: true });
    if (stageError && isMissingColumn(stageError)) {
      // The columns went away, or the remembered answer was stale.
      styled = false;
      STAGE_COLS = BASE_STAGE_COLS;
      ({ data: stages, error: stageError } = await supabaseAdmin
        .from('pipeline_stages').select(BASE_STAGE_COLS as '*').eq('user_id', userId).in('pipeline_id', ids)
        .order('position', { ascending: true }));
    }
    if (stageError) throw new AppError(stageError.message, 500);
    // Not styled yet: ask again next time, so running 106 shows up without a restart.
    const isStyled = styled === true;
    if (!isStyled) styled = null;

    const byPipeline = new Map<string, PipelineStage[]>();
    for (const s of (stages || []) as PipelineStage[]) {
      const list = byPipeline.get(s.pipeline_id) || [];
      list.push(s);
      byPipeline.set(s.pipeline_id, list);
    }
    return {
      ready: true,
      styled: isStyled,
      pipelines: pipelines.map((p) => ({ ...p, stages: byPipeline.get(p.id) || [] })),
    };
  },

  /** A new pipeline, with the stages given or the standard five. */
  async create(userId: string, body: any): Promise<Pipeline> {
    const name = cleanName(body?.name, 'A pipeline');
    const { data: last } = await supabaseAdmin
      .from('pipelines')
      .select('position')
      .eq('user_id', userId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await supabaseAdmin
      .from('pipelines')
      .insert({ user_id: userId, name, position: ((last as any)?.position ?? -1) + 1 })
      .select(PIPELINE_COLS)
      .single();
    if (isMissingTable(error)) throw new AppError('Pipelines need the latest database update (migration 105) before they can be added', 409);
    if (error) throw new AppError(error.message, 500);

    const stages = Array.isArray(body?.stages) && body.stages.length > 0 ? body.stages : DEFAULT_PIPELINE_STAGES;
    if (stages.length > 20) throw new AppError('A pipeline can have up to 20 stages', 400);
    try {
      await insertStages(userId, data.id, stages);
    } catch (e) {
      await supabaseAdmin.from('pipelines').delete().eq('id', data.id).eq('user_id', userId);
      throw e;
    }
    const all = await pipelinesService.list(userId);
    return all.pipelines.find((p) => p.id === data.id)!;
  },

  /**
   * Rename a pipeline, make it the default, or replace its stages.
   *
   * `stages` is the whole ordered list as the editor shows it: rows with an
   * id are kept and updated, rows without one are added, and stages that
   * are missing are removed. Deals in a removed stage move to the stage
   * named in `moves` (or the nearest kept stage) before it goes, so nothing
   * falls off the board.
   */
  async update(userId: string, id: string, body: any): Promise<Pipeline> {
    const pipeline = await ownedPipeline(userId, id);

    const patch: Record<string, any> = {};
    if (body?.name !== undefined) patch.name = cleanName(body.name, 'A pipeline');
    if (Object.keys(patch).length > 0) {
      const { error } = await supabaseAdmin.from('pipelines').update(patch).eq('id', id).eq('user_id', userId);
      if (error) throw new AppError(error.message, 500);
    }

    if (body?.is_default === true && !pipeline.is_default) {
      // Clear first: the unique index allows one default per user.
      await supabaseAdmin.from('pipelines').update({ is_default: false }).eq('user_id', userId).eq('is_default', true);
      const { error } = await supabaseAdmin.from('pipelines').update({ is_default: true }).eq('id', id).eq('user_id', userId);
      if (error) throw new AppError(error.message, 500);
    }

    if (Array.isArray(body?.stages)) {
      await refreshStageCols();
      const wanted = body.stages as Array<Partial<PipelineStage>>;
      if (wanted.length === 0) throw new AppError('A pipeline needs at least one stage', 400);
      if (wanted.length > 20) throw new AppError('A pipeline can have up to 20 stages', 400);

      const { data: current, error } = await supabaseAdmin
        .from('pipeline_stages')
        .select(STAGE_COLS as '*')
        .eq('pipeline_id', id)
        .eq('user_id', userId);
      if (error) throw new AppError(error.message, 500);
      const existing = new Map(((current || []) as PipelineStage[]).map((s) => [s.id, s]));

      // Validate everything before writing anything.
      const rows = wanted.map((s, i) => ({
        id: s.id && existing.has(s.id) ? s.id : null,
        ...stageFields(s, i),
      }));

      // Updates first, then inserts, so a new stage can be a move target.
      for (const r of rows.filter((r) => r.id)) {
        const { id: stageId, ...fields } = r;
        const { error: upErr } = await supabaseAdmin
          .from('pipeline_stages').update(fields).eq('id', stageId!).eq('user_id', userId);
        if (upErr) throw new AppError(upErr.message, 500);
      }
      const fresh = rows.filter((r) => !r.id).map(({ id: _id, ...fields }) => ({ ...fields, user_id: userId, pipeline_id: id }));
      let inserted: PipelineStage[] = [];
      if (fresh.length > 0) {
        const { data: ins, error: insErr } = await supabaseAdmin.from('pipeline_stages').insert(fresh).select(STAGE_COLS as '*');
        if (insErr) throw new AppError(insErr.message, 500);
        inserted = (ins || []) as PipelineStage[];
      }

      const kept = [
        ...rows.filter((r) => r.id).map((r) => ({ id: r.id!, position: r.position })),
        ...inserted.map((s) => ({ id: s.id, position: s.position })),
      ].sort((a, b) => a.position - b.position);
      const keptIds = new Set(kept.map((k) => k.id));
      const removed = [...existing.values()].filter((s) => !keptIds.has(s.id));
      const moves: Record<string, string> = body?.moves && typeof body.moves === 'object' ? body.moves : {};

      for (const gone of removed) {
        // The chosen stage, else the kept stage nearest to where it sat.
        let target = moves[gone.id] && keptIds.has(moves[gone.id]) ? moves[gone.id] : null;
        if (!target) {
          const before = kept.filter((k) => k.position <= gone.position);
          target = (before[before.length - 1] || kept[0]).id;
        }
        const { error: mvErr } = await supabaseAdmin
          .from('deals').update({ stage_id: target }).eq('user_id', userId).eq('stage_id', gone.id);
        if (mvErr) throw new AppError(mvErr.message, 500);
        const { error: delErr } = await supabaseAdmin
          .from('pipeline_stages').delete().eq('id', gone.id).eq('user_id', userId);
        if (delErr) throw new AppError(delErr.message, 500);
      }
    }

    const all = await pipelinesService.list(userId);
    const updated = all.pipelines.find((p) => p.id === id);
    if (!updated) throw new AppError('Pipeline not found', 404);
    return updated;
  },

  /**
   * Remove a pipeline. Its deals move to another pipeline (the default, or
   * `moveTo`), landing in the stage that matches their phase. The last
   * pipeline cannot be removed.
   */
  async remove(userId: string, id: string, moveTo?: string | null) {
    const pipeline = await ownedPipeline(userId, id);
    const { data: others } = await supabaseAdmin
      .from('pipelines')
      .select('id, is_default, position')
      .eq('user_id', userId)
      .neq('id', id)
      .order('position', { ascending: true });
    if (!others || others.length === 0) throw new AppError('You need at least one pipeline', 400);

    const target = (moveTo && others.find((o: any) => o.id === moveTo))
      || others.find((o: any) => o.is_default)
      || others[0];

    // stage_id null plus a new pipeline: the database picks the matching stage.
    const { error: mvErr } = await supabaseAdmin
      .from('deals')
      .update({ pipeline_id: (target as any).id, stage_id: null })
      .eq('user_id', userId)
      .eq('pipeline_id', id);
    if (mvErr) throw new AppError(mvErr.message, 500);

    // One default per user: clear this one before promoting the target.
    if (pipeline.is_default) {
      await supabaseAdmin.from('pipelines').update({ is_default: false }).eq('id', id).eq('user_id', userId);
      await supabaseAdmin.from('pipelines').update({ is_default: true }).eq('id', (target as any).id).eq('user_id', userId);
    }
    const { error } = await supabaseAdmin.from('pipelines').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  /** Throws unless this stage belongs to this user. Returns it. */
  async ownedStage(userId: string, stageId: string) {
    await refreshStageCols();
    const { data, error } = await supabaseAdmin
      .from('pipeline_stages')
      .select(STAGE_COLS as '*')
      .eq('id', stageId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error && !isMissingTable(error)) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Stage not found', 404);
    return data as PipelineStage;
  },
};

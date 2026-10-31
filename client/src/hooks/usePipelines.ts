import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crmApi } from '../api/crm.api';
import {
  dealStageLabel,
  registerStageSettings,
  type Deal,
  type Pipeline,
  type PipelineStage,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   The user's pipelines, everywhere a deal is shown.

   One query, shared by the board, the deal page, the contact and company
   pages and the peek, so a stage renamed in the editor reads the same way
   on every screen. Loading it also registers each stage's own odds and
   stale limit with the forecast maths in shared, so weighted totals and
   "gone quiet" badges follow the stage, not just its phase.
   ═══════════════════════════════════════════════════════════════════════ */

export const PIPELINES_KEY = ['crm', 'pipelines'] as const;

export interface PipelinesApi {
  /** False until migration 105 has run: one built-in pipeline, not editable. */
  ready: boolean;
  loading: boolean;
  pipelines: Pipeline[];
  defaultPipeline: Pipeline | null;
  stageById: Map<string, PipelineStage>;
  /** The pipeline a deal is in. Deals with none belong to the default. */
  pipelineOf: (deal: Pick<Deal, 'pipeline_id'>) => Pipeline | null;
  /** The open stage a deal sits in (or last sat in, for a closed deal). */
  stageOf: (deal: Pick<Deal, 'stage' | 'stage_id' | 'pipeline_id'>) => PipelineStage | null;
  /** "Meeting booked", "Won", "Lost" - what to print for a deal's stage. */
  stageLabel: (deal: Pick<Deal, 'stage' | 'stage_id' | 'pipeline_id'>) => string;
}

export function usePipelines(): PipelinesApi {
  const q = useQuery({
    queryKey: PIPELINES_KEY,
    queryFn: () => crmApi.listPipelines(),
    staleTime: 60_000,
  });

  const pipelines = useMemo(() => q.data?.pipelines ?? [], [q.data]);
  const ready = q.data?.ready ?? false;

  // During render, not in an effect: the page's children read the forecast
  // maths in this same render, and an effect would run after they had
  // already drawn totals with the phase defaults.
  useMemo(() => {
    if (!q.data) return;
    registerStageSettings(q.data.ready ? q.data.pipelines.flatMap((p) => p.stages) : []);
  }, [q.data]);

  return useMemo<PipelinesApi>(() => {
    const stageById = new Map<string, PipelineStage>();
    for (const p of pipelines) for (const s of p.stages) stageById.set(s.id, s);
    const defaultPipeline = pipelines.find((p) => p.is_default) || pipelines[0] || null;

    const pipelineOf: PipelinesApi['pipelineOf'] = (deal) =>
      (deal.pipeline_id && pipelines.find((p) => p.id === deal.pipeline_id)) || defaultPipeline;

    const stageOf: PipelinesApi['stageOf'] = (deal) => {
      if (deal.stage_id && stageById.has(deal.stage_id)) return stageById.get(deal.stage_id)!;
      const p = pipelineOf(deal);
      if (!p || p.stages.length === 0) return null;
      if (deal.stage === 'won' || deal.stage === 'lost') return p.stages[p.stages.length - 1];
      return p.stages.find((s) => s.phase === deal.stage) || p.stages[0];
    };

    const stageLabel: PipelinesApi['stageLabel'] = (deal) => {
      if (deal.stage === 'won' || deal.stage === 'lost') return dealStageLabel(deal.stage);
      return stageOf(deal)?.name || dealStageLabel(deal.stage);
    };

    return { ready, loading: q.isLoading, pipelines, defaultPipeline, stageById, pipelineOf, stageOf, stageLabel };
  }, [pipelines, ready, q.isLoading]);
}

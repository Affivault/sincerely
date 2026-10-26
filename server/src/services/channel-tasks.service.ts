import { supabaseAdmin } from '../config/supabase.js';
import { resumeAfterTask } from './sequence.service.js';

/* ═══════════════════════════════════════════════════════════════════════
   The ends of a LinkedIn task's life that are not "somebody did it".

   A sequence parks a contact on a task and only the task can wake it, so
   every way a task can stop being worked has to say what happens to the
   contact. There are two answers:

   - Skip: the step is abandoned but the person is still in the campaign.
     Log a 'skipped' activity, so the campaign's history says why the touch
     never happened, and move the contact on to its next step.
   - Close: the person has left the campaign (replied, removed, campaign
     deleted). Nothing to move on; the task just must not be done anymore.
   ═══════════════════════════════════════════════════════════════════════ */

const CHUNK = 200;

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/**
 * Close every open channel task for these campaign contacts, without
 * resuming anyone. Marked done rather than deleted so the Activities history
 * still shows the touch was queued, with last_error saying why it stopped.
 * Never throws: the caller is stopping a contact, and that has to succeed
 * whether or not its tasks could be tidied.
 */
export async function closeOpenChannelTasks(campaignContactIds: string[], reason: string): Promise<number> {
  const ids = [...new Set(campaignContactIds.filter(Boolean))];
  let closed = 0;
  for (const slice of chunks(ids)) {
    const { data, error } = await supabaseAdmin
      .from('crm_tasks')
      .update({
        is_done: true,
        completed_at: new Date().toISOString(),
        locked_until: null,
        last_error: reason.slice(0, 500),
      })
      .in('campaign_contact_id', slice)
      .eq('is_done', false)
      .select('id');
    if (error) {
      console.warn(`[ChannelTasks] Could not close tasks (${reason}): ${error.message}`);
      continue;
    }
    closed += data?.length || 0;
  }
  return closed;
}

/**
 * The same, for a whole campaign. Read before the campaign is deleted:
 * crm_tasks has no foreign key to campaign_contacts, so once the contacts
 * cascade away there is nothing left to find the tasks by.
 */
export async function closeChannelTasksForCampaign(campaignId: string, reason: string): Promise<number> {
  const ids: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('campaign_contacts')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) {
      console.warn(`[ChannelTasks] Could not list contacts of campaign ${campaignId}: ${error.message}`);
      break;
    }
    ids.push(...(data || []).map((r: any) => r.id));
    if (!data || data.length < PAGE) break;
  }
  return ids.length ? closeOpenChannelTasks(ids, reason) : 0;
}

/** Ids of a campaign's enrolments for these contacts, for closing before removal. */
export async function campaignContactIdsFor(campaignId: string, contactIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const slice of chunks([...new Set(contactIds)])) {
    const { data, error } = await supabaseAdmin
      .from('campaign_contacts')
      .select('id')
      .eq('campaign_id', campaignId)
      .in('contact_id', slice);
    if (error) {
      console.warn(`[ChannelTasks] Could not read enrolments of campaign ${campaignId}: ${error.message}`);
      continue;
    }
    out.push(...(data || []).map((r: any) => r.id));
  }
  return out;
}

interface TaskRef {
  id: string;
  channel?: string | null;
  contact_id?: string | null;
  campaign_contact_id?: string | null;
  campaign_step_id?: string | null;
}

/**
 * Log the skip against the campaign and move the contact on.
 *
 * Only when the contact is still parked on this very task: a contact that
 * has already been moved on (or replied) is somebody else's to handle, and
 * logging a skip for it would put a step in its history that never applied.
 * resumeAfterTask finds the contact by waiting_for_task_id, so this works
 * after the task row itself has been deleted.
 */
export async function skipAndResume(task: TaskRef, reason: string, detail?: string | null): Promise<void> {
  if (!task.campaign_contact_id) return;
  const { data: cc, error } = await supabaseAdmin
    .from('campaign_contacts')
    .select('id, campaign_id, contact_id, current_step_order, waiting_for_task_id')
    .eq('id', task.campaign_contact_id)
    .maybeSingle();
  if (error) {
    console.warn(`[ChannelTasks] Could not read contact for task ${task.id}: ${error.message}`);
    return;
  }
  if (!cc || cc.waiting_for_task_id !== task.id) return;

  const { error: actErr } = await supabaseAdmin.from('campaign_activities').insert({
    campaign_id: cc.campaign_id,
    campaign_contact_id: cc.id,
    contact_id: cc.contact_id,
    step_id: task.campaign_step_id || null,
    activity_type: 'skipped',
    metadata: {
      step_order: cc.current_step_order,
      step_type: task.channel || null,
      reason,
      ...(detail ? { detail: detail.slice(0, 300) } : {}),
    },
  });
  // The history line is worth having but not worth keeping somebody parked for.
  if (actErr) console.warn(`[ChannelTasks] Could not log the skip for task ${task.id}: ${actErr.message}`);

  await resumeAfterTask(task.id);
}

/**
 * Close one task as skipped and move its contact on. Guarded on the task
 * still being open, so the agent reporting "done" at the same moment wins
 * and the contact is not advanced twice.
 */
export async function skipChannelTask(taskId: string, reason: string, note: string): Promise<boolean> {
  const { data: task, error } = await supabaseAdmin
    .from('crm_tasks')
    .update({
      is_done: true,
      completed_at: new Date().toISOString(),
      locked_until: null,
      last_error: note.slice(0, 500),
    })
    .eq('id', taskId)
    .eq('is_done', false)
    .select('id, channel, contact_id, campaign_contact_id, campaign_step_id')
    .maybeSingle();
  if (error) throw new Error(`skip task ${taskId}: ${error.message}`);
  if (!task) return false;
  await skipAndResume(task as TaskRef, reason, note);
  return true;
}

const SWEEP_NOTE: Record<string, string> = {
  contact_gone: 'Closed: the contact is no longer in this campaign',
  agent_failed: 'Skipped: the agent could not complete it after 3 attempts',
  overdue: 'Skipped: not done in time, so the sequence moved on',
};

/**
 * Tasks the sequence should stop waiting for, found by migration 093's
 * linkedin_tasks_to_skip. Run from the sequence worker's reaper slot.
 *
 * Before 093 the function does not exist and this does nothing, which is
 * exactly the old behaviour; the setting it reads lives in 093 too.
 */
export async function sweepChannelTasks(): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('linkedin_tasks_to_skip', { max_rows: 200 });
  if (error) {
    if ((error as any).code === 'PGRST202' || /linkedin_tasks_to_skip|skip_task_after_days/.test(error.message || '')) return 0;
    throw new Error(`linkedin tasks to skip: ${error.message}`);
  }

  let handled = 0;
  for (const row of (data || []) as Array<{ id: string; reason: string }>) {
    try {
      if (row.reason === 'contact_gone') {
        const { data: closed } = await supabaseAdmin
          .from('crm_tasks')
          .update({
            is_done: true,
            completed_at: new Date().toISOString(),
            locked_until: null,
            last_error: SWEEP_NOTE.contact_gone,
          })
          .eq('id', row.id)
          .eq('is_done', false)
          .select('id')
          .maybeSingle();
        if (closed) handled++;
        continue;
      }
      if (await skipChannelTask(row.id, row.reason, SWEEP_NOTE[row.reason] || 'Skipped')) handled++;
    } catch (err: any) {
      // One task's failure must not stop the sweep for the rest.
      console.error(`[ChannelTasks] Could not close task ${row.id}:`, err?.message || err);
    }
  }

  // Contacts parked on a task that is gone or already done. Before task
  // deletion released its contact, every deleted LinkedIn task left one of
  // these behind, and nothing else ever looks for them.
  const { data: orphans, error: orphanErr } = await supabaseAdmin
    .rpc('linkedin_contacts_orphaned', { max_rows: 200 });
  if (orphanErr) {
    if ((orphanErr as any).code === 'PGRST202' || /linkedin_contacts_orphaned/.test(orphanErr.message || '')) return handled;
    throw new Error(`orphaned linkedin contacts: ${orphanErr.message}`);
  }
  for (const row of (orphans || []) as Array<{ campaign_contact_id: string; task_id: string; task_exists: boolean }>) {
    try {
      if (row.task_exists) await resumeAfterTask(row.task_id);
      else await skipAndResume({ id: row.task_id, campaign_contact_id: row.campaign_contact_id }, 'task_deleted');
      handled++;
    } catch (err: any) {
      console.error(`[ChannelTasks] Could not resume contact ${row.campaign_contact_id}:`, err?.message || err);
    }
  }
  return handled;
}

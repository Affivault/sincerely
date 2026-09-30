import os from 'node:os';
import { supabaseAdmin } from '../config/supabase.js';
import type { JobBeat, JobId } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Each background job's heartbeat.

   Wrapped around a job's tick at the place it is scheduled, so a job does
   not have to remember to report on itself. Written to job_heartbeats
   (migration 078) so the status page sees it from any server, and kept in
   memory too, so a database without the table - or one that cannot be
   reached, which is exactly when a status page matters - still answers
   for this server.

   Best-effort by design: a heartbeat that cannot be written must never
   stop the job it describes.
   ═══════════════════════════════════════════════════════════════════════ */

const memory = new Map<JobId, JobBeat>();
const instance = `${os.hostname()}:${process.pid}`;
let tableMissing = false;
const inFlight = new Set<JobId>();

function blank(job: JobId): JobBeat {
  return { job, last_started_at: null, last_finished_at: null, last_ok_at: null, last_error: null, last_error_at: null, duration_ms: null };
}

async function persist(b: JobBeat): Promise<void> {
  if (tableMissing) return;
  const { error } = await supabaseAdmin
    .from('job_heartbeats')
    .upsert({ ...b, instance, updated_at: new Date().toISOString() }, { onConflict: 'job' });
  if (error && /job_heartbeats/.test(error.message)) tableMissing = true;
}

/**
 * Run one tick of a job and record that it ran. Errors are recorded and
 * then rethrown into nothing - the scheduler's own handling still logs.
 */
export async function beat(job: JobId, run: () => Promise<unknown> | unknown): Promise<void> {
  /*
   * One run at a time, decided here. Every job also guards itself against
   * overlap, returning at once when the last run is still going - which,
   * wrapped naively, would record a quick "success" every tick and make a
   * job stuck for an hour look perfectly healthy. Skipping the beat leaves
   * last_finished_at where the stuck run left it, so it reads as stalled.
   */
  if (inFlight.has(job)) return;
  inFlight.add(job);
  const b = { ...(memory.get(job) || blank(job)) };
  const started = Date.now();
  b.last_started_at = new Date(started).toISOString();
  memory.set(job, { ...b });
  persist(b).catch(() => {});
  try {
    await run();
    b.last_ok_at = new Date().toISOString();
  } catch (err: any) {
    b.last_error = String(err?.message || err).slice(0, 500);
    b.last_error_at = new Date().toISOString();
    console.error(`[Heartbeat] ${job} failed: ${b.last_error}`);
  } finally {
    b.last_finished_at = new Date().toISOString();
    b.duration_ms = Date.now() - started;
    memory.set(job, b);
    inFlight.delete(job);
    await persist(b).catch(() => {});
  }
}

/** This server's own view, for when the table is missing or unreachable. */
export function memoryBeats(): Map<JobId, JobBeat> {
  return memory;
}

export function heartbeatsPersisted(): boolean {
  return !tableMissing;
}

/**
 * Every job's latest beat: the stored ones, with this server's own merged
 * over them when newer (a multi-server deploy has one row per job - the
 * last writer wins, which is the freshest).
 */
export async function readBeats(): Promise<{ beats: Map<JobId, JobBeat>; persisted: boolean }> {
  const beats = new Map<JobId, JobBeat>();
  let persisted = false;
  if (!tableMissing) {
    const { data, error } = await supabaseAdmin
      .from('job_heartbeats')
      .select('job, last_started_at, last_finished_at, last_ok_at, last_error, last_error_at, duration_ms');
    if (!error) {
      persisted = true;
      for (const r of data || []) beats.set((r as any).job, r as JobBeat);
    } else if (/job_heartbeats/.test(error.message)) {
      tableMissing = true;
    }
  }
  for (const [job, b] of memory) {
    const stored = beats.get(job);
    const newer = !stored || (b.last_finished_at || b.last_started_at || '') > (stored.last_finished_at || stored.last_started_at || '');
    if (newer) beats.set(job, b);
  }
  return { beats, persisted };
}

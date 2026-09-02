import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { resumeAfterTask } from './sequence.service.js';
import { hasEconomics, totalContractValue } from '@lemlist/shared';
import { contactIdsOnDeal, promoteToContact, promoteToCustomer } from './lifecycle.service.js';

const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'won', 'lost'];
const TASK_PRIORITIES = ['low', 'normal', 'high'];
const EVENT_TYPES = ['call', 'meeting'];

/** Embed the linked contact so the client can show live lead data on deals. */
/*
 * The campaign is embedded, not just its id.
 *
 * Without the name the deal page can only say "a campaign", which is not an
 * answer to "where did this come from" - and making every deal row fetch its
 * own campaign to find out would be one request per card on the board.
 */
const DEAL_SELECT = '*, contact:contacts(id, email, first_name, last_name, company, company_id, job_title, phone, linkedin_url), source_campaign:campaigns!deals_source_campaign_id_fkey(id, name, status)';

/** Keep only known columns from a request body so callers can't write arbitrary fields. */
function pick(body: any, keys: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

// `source_campaign_id`/`source_step_id`/`attribution`/`attributed_at` are
// deliberately absent: they are set only by resolveAttribution() below, never
// taken straight off a request body. Letting a client set them directly would
// both bypass the evidence-based resolution this feature relies on and, since
// `source_campaign_id` on its own skips resolution entirely, produce rows that
// violate the deals_attribution_complete CHECK constraint.
const DEAL_KEYS = ['title', 'company', 'company_id', 'contact_name', 'contact_email', 'contact_id', 'value', 'currency', 'stage', 'expected_close_date', 'notes', 'position', 'probability', 'outcome_reason', 'label', 'source',
  'recurring_amount', 'recurring_period', 'one_off_amount', 'term_months'] as const;

const DEAL_LABELS = ['hot', 'warm', 'cold'];

/** The people on a deal, with enough of each contact to render them. */
const PARTICIPANT_SELECT =
  'id, deal_id, contact_id, role, note, created_at, ' +
  'contact:contacts(id, email, first_name, last_name, company, company_id, job_title, phone, linkedin_url)';
const TASK_KEYS = ['title', 'due_date', 'priority', 'type', 'all_day', 'deal_id', 'contact_id', 'contact_name', 'notes', 'is_done', 'channel', 'payload', 'target_url'] as const;
const EVENT_KEYS = ['title', 'type', 'starts_at', 'ends_at', 'all_day', 'contact_id', 'contact_name', 'contact_email', 'location', 'notes', 'outcome', 'deal_id'] as const;
const NOTE_KEYS = ['body', 'contact_id', 'deal_id', 'pinned'] as const;

const TASK_TYPES = ['todo', 'call', 'meeting', 'email', 'follow_up', 'deadline'];

/** Linked records the activity views render inline, so one request is enough. */
const LINKED = 'contact:contacts(id, email, first_name, last_name, company), deal:deals(id, title, stage)';
const TASK_SELECT = `*, ${LINKED}`;
const EVENT_SELECT = `*, ${LINKED}`;

/** Coerce/validate deal input in place so bad payloads 400 instead of 500ing at the DB. */
function sanitizeDealInput(input: Record<string, any>) {
  if (input.stage && !DEAL_STAGES.includes(input.stage)) throw new AppError('Invalid stage', 400);
  if (input.value !== undefined && input.value !== null) {
    const n = Number(input.value);
    if (!Number.isFinite(n) || n < 0) throw new AppError('Deal value must be a non-negative number', 400);
    input.value = n;
  }
  if (input.position !== undefined && input.position !== null) {
    const p = Number(input.position);
    if (!Number.isInteger(p) || p < 0) throw new AppError('Invalid position', 400);
    input.position = p;
  }
  if (input.expected_close_date === '') input.expected_close_date = null;
  if (typeof input.contact_email === 'string') {
    input.contact_email = input.contact_email.trim().toLowerCase() || null;
  }

  /*
   * Odds are a percentage or nothing. A stored 140 would quietly inflate
   * every forecast it appeared in, and an empty string from a cleared form
   * field means "no opinion", not zero — zero is a real answer that means
   * the deal is dead.
   */
  if (input.probability === '' || input.probability === null) {
    input.probability = null;
  } else if (input.probability !== undefined) {
    const p = Number(input.probability);
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      throw new AppError('Probability must be between 0 and 100', 400);
    }
    input.probability = Math.round(p);
  }

  if (typeof input.outcome_reason === 'string') {
    input.outcome_reason = input.outcome_reason.trim().slice(0, 200) || null;
  }

  // The label is only worth having because it can be counted, so an unknown
  // value is rejected here rather than left for the database to reject with
  // a constraint error nobody can read.
  if (input.label === '' || input.label === null) {
    input.label = null;
  } else if (input.label !== undefined && !DEAL_LABELS.includes(input.label)) {
    throw new AppError(`Label must be one of ${DEAL_LABELS.join(', ')}`, 400);
  }

  if (typeof input.source === 'string') {
    input.source = input.source.trim().slice(0, 80) || null;
  }

  sanitizeEconomics(input);
}

const RECURRING_PERIODS = ['month', 'quarter', 'year'];
const ECONOMICS_KEYS = ['recurring_amount', 'recurring_period', 'one_off_amount', 'term_months'] as const;

/**
 * Coerce and validate the commercial shape of a B2B deal.
 *
 * Rejected here rather than at the database, so a bad payload comes back as
 * a sentence somebody can act on instead of a constraint name. An empty
 * string is a cleared field and means "no answer" — not zero, which for a
 * term or a fee is a real and different claim.
 */
function sanitizeEconomics(input: Record<string, any>) {
  const money = (key: string) => {
    const raw = input[key];
    if (raw === '' || raw === null) { input[key] = null; return; }
    if (raw === undefined) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new AppError(`${key.replace(/_/g, ' ')} must be a non-negative number`, 400);
    input[key] = n;
  };
  money('recurring_amount');
  money('one_off_amount');

  if (input.term_months === '' || input.term_months === null) {
    input.term_months = null;
  } else if (input.term_months !== undefined) {
    const t = Number(input.term_months);
    if (!Number.isInteger(t) || t <= 0) throw new AppError('Term must be a whole number of months', 400);
    input.term_months = t;
  }

  if (input.recurring_period === '' || input.recurring_period === null) {
    input.recurring_period = null;
  } else if (input.recurring_period !== undefined && !RECURRING_PERIODS.includes(input.recurring_period)) {
    throw new AppError(`Billing period must be one of ${RECURRING_PERIODS.join(', ')}`, 400);
  }
}

/**
 * Recompute `value` from the shape, when there is one.
 *
 * The arithmetic is imported rather than repeated. Two copies of a money
 * calculation is two copies that will one day disagree, and the failure
 * would be silent: the deal page would say a three-year retainer is worth
 * 180k while the board column above it said 60k, with both reading the
 * database correctly. The client shows this figure live as somebody types,
 * so it has to be the same function on both sides.
 *
 * Runs against the row as it will be after the write, not just the fields
 * in this request: a patch that only clears the term still changes the
 * total, and would otherwise leave `value` describing a term that is gone.
 */
function applyDerivedValue(merged: Record<string, any>, input: Record<string, any>) {
  const touched = ECONOMICS_KEYS.some((k) => k in input);
  if (!touched) return;
  // Clearing the shape entirely hands `value` back to whoever is editing
  // it, rather than freezing the last computed total in place forever.
  if (!hasEconomics(merged)) return;
  input.value = totalContractValue(merged);
}

/**
 * Keep the timestamps that describe a deal's movement truthful.
 *
 * Neither can be left to the caller. `stage_changed_at` is the whole basis of
 * rot detection, so a client that forgot to send it would make a stalled deal
 * look fresh; `closed_at` decides what counts as won this month. Both are
 * derived from the transition itself, which is the only place that knows one
 * happened.
 *
 * Reopening a closed deal clears `closed_at` rather than leaving the old one
 * behind, or the deal would keep counting toward a month it is no longer in.
 *
 * @param input The already-picked update body, mutated in place.
 * @param previousStage The stage before this write, when there was one.
 */
function trackStageChange(input: Record<string, any>, previousStage?: string | null) {
  if (input.stage === undefined) return;
  if (previousStage !== undefined && previousStage === input.stage) return;

  const now = new Date().toISOString();
  input.stage_changed_at = now;

  const closing = input.stage === 'won' || input.stage === 'lost';
  input.closed_at = closing ? now : null;
  // A deal that reopens has no outcome any more, and leaving the old reason
  // on it would have it counted in "why we lose" while it is still live.
  if (!closing) input.outcome_reason = null;
}

/** Reject a contact_id/deal_id that doesn't belong to this user before it's persisted. */
async function assertOwned(userId: string, table: string, id: string, label: string) {
  const { data } = await supabaseAdmin.from(table).select('id').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!data) throw new AppError(`${label} not found`, 404);
}

/**
 * Keep deals in sync with the contacts base: when a deal carries an email but
 * no linked lead, attach the matching contact (and backfill name/company).
 */
async function autoLinkContact(userId: string, input: Record<string, any>) {
  if (input.contact_id || !input.contact_email) return;
  const pattern = String(input.contact_email).replace(/([%_\\])/g, '\\$1');
  const { data } = await supabaseAdmin
    .from('contacts')
    .select('id, first_name, last_name, company')
    .eq('user_id', userId)
    .ilike('email', pattern)
    .maybeSingle();
  if (data) {
    input.contact_id = data.id;
    if (!input.contact_name) {
      input.contact_name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;
    }
    if (!input.company && data.company) input.company = data.company;
  }
}

/**
 * Which outreach produced this deal, decided from what actually happened.
 *
 * Server-side rather than per-caller, because a deal can be created from the
 * unibox, the contact profile, the board or the API, and attribution done in
 * one of those four is attribution missing from three. The caller may name a
 * campaign - the unibox knows the thread's - and that is the strongest
 * evidence there is; otherwise the contact's most recent reply is used.
 *
 * Deliberately never returns 'enrolment'. Having been emailed and not
 * answered is not evidence that a sequence produced a deal, and quietly
 * crediting it would inflate every figure built on top - which is how an
 * attribution report stops being believed. Weak links stay a manual act.
 *
 * Never throws. A deal that saves without attribution is a small gap in a
 * report; a deal that fails to save because a reporting lookup broke is lost
 * work in front of somebody who was mid-sentence.
 */
async function resolveAttribution(
  userId: string,
  contactId: string | null | undefined,
  namedCampaignId?: string | null,
): Promise<{ source_campaign_id: string; source_step_id: string | null; attribution: string; attributed_at: string } | null> {
  if (!contactId) return null;
  try {
    if (namedCampaignId) {
      // The step is best-effort: the campaign is the claim, the step is
      // detail, and a missing step must not downgrade a thread to a guess.
      const { data: act } = await supabaseAdmin
        .from('campaign_activities')
        .select('step_id')
        .eq('contact_id', contactId)
        .eq('campaign_id', namedCampaignId)
        .in('activity_type', ['replied', 'sent'])
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        source_campaign_id: namedCampaignId,
        source_step_id: (act as any)?.step_id ?? null,
        attribution: 'thread',
        attributed_at: new Date().toISOString(),
      };
    }

    const { data: reply } = await supabaseAdmin
      .from('campaign_activities')
      .select('campaign_id, step_id, campaigns!inner(user_id)')
      .eq('contact_id', contactId)
      .eq('activity_type', 'replied')
      .eq('campaigns.user_id', userId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!reply) return null;
    return {
      source_campaign_id: (reply as any).campaign_id,
      source_step_id: (reply as any).step_id ?? null,
      attribution: 'reply',
      attributed_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export const crmService = {
  /* ── Deals ── */
  async listDeals(userId: string, filters?: { contactId?: string; contactEmail?: string }) {
    let query = supabaseAdmin.from('deals').select(DEAL_SELECT).eq('user_id', userId);
    // Scope to a specific lead (used by the contact page) — match either the
    // linked contact_id or the captured contact_email. Values are quoted so
    // reserved characters (commas, parens, quotes) in either can't break out
    // of the filter expression and inject extra OR conditions.
    const quote = (v: string) => `"${v.replace(/"/g, '')}"`;
    if (filters?.contactId && filters?.contactEmail) {
      query = query.or(`contact_id.eq.${quote(filters.contactId)},contact_email.eq.${quote(filters.contactEmail)}`);
    } else if (filters?.contactId) {
      query = query.eq('contact_id', filters.contactId);
    } else if (filters?.contactEmail) {
      query = query.eq('contact_email', filters.contactEmail);
    }
    const { data, error } = await query
      .order('position', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async createDeal(userId: string, body: any) {
    if (!body.title || !String(body.title).trim()) throw new AppError('Deal title is required', 400);
    const input = pick(body, DEAL_KEYS as any);
    sanitizeDealInput(input);
    // A new deal is entering its first stage right now, whether or not the
    // caller named one — without this its clock never starts and it can never
    // be reported as stalled.
    input.stage = input.stage || 'lead';
    trackStageChange(input, null);
    // Nothing exists yet, so the row-as-it-will-be is just the input.
    applyDerivedValue(input, input);
    if (input.contact_id) await assertOwned(userId, 'contacts', input.contact_id, 'Contact');
    if (input.company_id) await assertOwned(userId, 'companies', input.company_id, 'Company');
    await autoLinkContact(userId, input);

    // Credit the outreach that produced this, if any did. `source_campaign_id`
    // on the body is the unibox saying "this came out of that thread" — a
    // hint for resolveAttribution, not a value trusted straight off the
    // request (it and the other attribution fields aren't in DEAL_KEYS, so
    // `input` never has one already set here).
    const credit = await resolveAttribution(userId, input.contact_id, body.source_campaign_id);
    if (credit) Object.assign(input, credit);

    const { data, error } = await supabaseAdmin
      .from('deals')
      .insert({ ...input, user_id: userId })
      .select(DEAL_SELECT)
      .single();
    if (error) throw new AppError(error.message, 500);
    // Somebody on a deal is not a stranger, whatever the pipeline says.
    if ((data as any)?.contact_id) {
      promoteToContact(userId, [(data as any).contact_id], 'deal').catch(() => {});
    }
    return data;
  },

  async updateDeal(userId: string, id: string, body: any) {
    const input = pick(body, DEAL_KEYS as any);
    sanitizeDealInput(input);

    /*
     * Correcting the credit by hand.
     *
     * The automatic rules are evidence-based and will sometimes be wrong -
     * a deal that really came from the conference, or from the sequence
     * before the one they last replied to. Somebody has to be able to say so,
     * and when they do it is recorded as 'manual' rather than dressed up as
     * a reply that never happened. An attribution report is only worth
     * reading if it never overstates its own evidence.
     *
     * Setting the campaign to null clears the whole credit, because a
     * strength pointing at nothing is not an attribution and the database
     * refuses it anyway.
     */
    if ('source_campaign_id' in input) {
      if (!input.source_campaign_id) {
        input.source_campaign_id = null;
        input.source_step_id = null;
        input.attribution = null;
        input.attributed_at = null;
      } else {
        await assertOwned(userId, 'campaigns', input.source_campaign_id, 'Campaign');
        if (input.source_step_id) {
          // Steps carry no user_id - they are owned through their campaign -
          // so the check is that the step belongs to the campaign being
          // credited. assertOwned would look for a column that is not there
          // and reject every legitimate step.
          const { data: step } = await supabaseAdmin
            .from('campaign_steps')
            .select('id')
            .eq('id', input.source_step_id)
            .eq('campaign_id', input.source_campaign_id)
            .maybeSingle();
          if (!step) throw new AppError('That step is not part of that campaign', 400);
        }
        // A person choosing this IS the evidence, and it is the only strength
        // they may assign - claiming 'thread' or 'reply' by hand would put a
        // stronger label on it than what actually happened.
        input.attribution = 'manual';
        input.attributed_at = new Date().toISOString();
      }
    }

    /*
     * Read the stage before writing, so a "change" that changes nothing is
     * not treated as movement. Dropping a card back where it came from, or
     * re-saving a form without touching the stage, would otherwise reset the
     * clock and make a stalled deal look freshly worked.
     */
    const economicsTouched = ECONOMICS_KEYS.some((k) => k in input);

    if (input.stage !== undefined || economicsTouched) {
      const { data: before } = await supabaseAdmin
        .from('deals')
        .select('stage, recurring_amount, recurring_period, one_off_amount, term_months')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (input.stage !== undefined) trackStageChange(input, before?.stage ?? undefined);
      // Merge over what is already stored: a patch that only clears the term
      // still changes the total, and would otherwise leave `value` describing
      // a term that no longer exists.
      if (economicsTouched) applyDerivedValue({ ...(before || {}), ...input }, input);
    }

    if (input.contact_id) await assertOwned(userId, 'contacts', input.contact_id, 'Contact');
    if (input.company_id) await assertOwned(userId, 'companies', input.company_id, 'Company');
    if (input.contact_email !== undefined && input.contact_id === undefined) {
      await autoLinkContact(userId, input);
    }
    const { data, error } = await supabaseAdmin
      .from('deals')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select(DEAL_SELECT)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Deal not found', 404);

    /*
     * Winning makes customers of everybody on the deal, not just whoever
     * was typed into the contact field — the champion, the decision maker
     * and the person in procurement all bought it. Customers are kept out
     * of cold outreach by default, which is the whole point of noticing.
     */
    if (input.stage === 'won') {
      contactIdsOnDeal(userId, id)
        .then((ids) => promoteToCustomer(userId, ids))
        .catch(() => {});
    } else if ((data as any)?.contact_id) {
      promoteToContact(userId, [(data as any).contact_id], 'deal').catch(() => {});
    }
    return data;
  },

  async deleteDeal(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('deals').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  /* ── Deal participants ── */

  /** Everyone on this deal besides the primary contact, in the order added. */
  async listParticipants(userId: string, dealId: string) {
    const { data, error } = await supabaseAdmin
      .from('deal_participants')
      .select(PARTICIPANT_SELECT)
      .eq('deal_id', dealId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async addParticipant(userId: string, dealId: string, body: any) {
    const contactId = body?.contact_id;
    if (!contactId) throw new AppError('A contact is required', 400);
    await assertOwned(userId, 'deals', dealId, 'Deal');
    await assertOwned(userId, 'contacts', contactId, 'Contact');

    /*
     * The primary contact is already on the deal. Adding them again would
     * show the same person twice on the page and double-count them in every
     * "who is on this" answer, so it is refused with an explanation rather
     * than silently deduplicated somewhere in the UI.
     */
    const { data: deal } = await supabaseAdmin
      .from('deals').select('contact_id').eq('id', dealId).eq('user_id', userId).maybeSingle();
    if (deal?.contact_id === contactId) {
      throw new AppError('That contact is already the primary contact on this deal', 409);
    }

    const role = typeof body.role === 'string' ? body.role.trim().slice(0, 40) || null : null;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) || null : null;

    const { data, error } = await supabaseAdmin
      .from('deal_participants')
      .insert({ user_id: userId, deal_id: dealId, contact_id: contactId, role, note })
      .select(PARTICIPANT_SELECT)
      .single();
    // 23505 is a unique violation: they are already on the deal. That is a
    // duplicate click, not a failure worth a 500.
    if (error?.code === '23505') throw new AppError('That contact is already on this deal', 409);
    if (error) throw new AppError(error.message, 500);
    promoteToContact(userId, [contactId], 'deal').catch(() => {});
    return data;
  },

  async updateParticipant(userId: string, dealId: string, participantId: string, body: any) {
    const patch: Record<string, any> = {};
    if (body.role !== undefined) {
      patch.role = typeof body.role === 'string' ? body.role.trim().slice(0, 40) || null : null;
    }
    if (body.note !== undefined) {
      patch.note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) || null : null;
    }
    if (Object.keys(patch).length === 0) throw new AppError('Nothing to update', 400);

    const { data, error } = await supabaseAdmin
      .from('deal_participants')
      .update(patch)
      .eq('id', participantId)
      .eq('deal_id', dealId)
      .eq('user_id', userId)
      .select(PARTICIPANT_SELECT)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Participant not found', 404);
    return data;
  },

  async removeParticipant(userId: string, dealId: string, participantId: string) {
    const { error } = await supabaseAdmin
      .from('deal_participants')
      .delete()
      .eq('id', participantId)
      .eq('deal_id', dealId)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  /** Every deal this contact is a participant on - not the ones they lead. */
  async dealsForParticipant(userId: string, contactId: string) {
    const { data, error } = await supabaseAdmin
      .from('deal_participants')
      .select(`role, deal:deals(${DEAL_SELECT})`)
      .eq('contact_id', contactId)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
    return (data || [])
      .filter((row: any) => row.deal)
      .map((row: any) => ({ ...row.deal, participant_role: row.role }));
  },

  /**
   * Every stage this deal has been through, oldest first.
   *
   * Scoped by user_id as well as deal_id: the rows carry their own owner, so
   * a guessed deal id from another account returns nothing rather than
   * somebody else's pipeline history.
   */
  async dealStageHistory(userId: string, dealId: string) {
    const { data, error } = await supabaseAdmin
      .from('deal_stage_events')
      .select('id, deal_id, from_stage, to_stage, reason, changed_at')
      .eq('deal_id', dealId)
      .eq('user_id', userId)
      .order('changed_at', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  /* ── Tasks ── */
  async listTasks(userId: string, filters?: { contactId?: string; dealId?: string }) {
    let q = supabaseAdmin
      .from('crm_tasks')
      .select(TASK_SELECT)
      .eq('user_id', userId);
    if (filters?.contactId) q = q.eq('contact_id', filters.contactId);
    if (filters?.dealId) q = q.eq('deal_id', filters.dealId);
    const { data, error } = await q
      .order('is_done', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async createTask(userId: string, body: any) {
    if (!body.title || !String(body.title).trim()) throw new AppError('Task title is required', 400);
    const input = pick(body, TASK_KEYS as any);
    if (input.priority && !TASK_PRIORITIES.includes(input.priority)) throw new AppError('Invalid priority', 400);
    if (input.type && !TASK_TYPES.includes(input.type)) throw new AppError('Invalid task type', 400);
    if (input.deal_id) await assertOwned(userId, 'deals', input.deal_id, 'Deal');
    if (input.contact_id) await assertOwned(userId, 'contacts', input.contact_id, 'Contact');
    // Created already ticked (logging something you just did) still needs a
    // completion time, or it drops out of "completed today".
    if (input.is_done && !input.completed_at) input.completed_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('crm_tasks')
      .insert({ ...input, user_id: userId })
      .select(TASK_SELECT)
      .single();
    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async updateTask(userId: string, id: string, body: any) {
    const input = pick(body, TASK_KEYS as any);
    if (input.priority && !TASK_PRIORITIES.includes(input.priority)) throw new AppError('Invalid priority', 400);
    if (input.type && !TASK_TYPES.includes(input.type)) throw new AppError('Invalid task type', 400);
    if (input.deal_id) await assertOwned(userId, 'deals', input.deal_id, 'Deal');
    if (input.contact_id) await assertOwned(userId, 'contacts', input.contact_id, 'Contact');
    // Ticking sets the completion time; un-ticking clears it, so a re-opened
    // task can't linger in yesterday's "done" pile.
    if (input.is_done === true) input.completed_at = new Date().toISOString();
    if (input.is_done === false) input.completed_at = null;
    const { data, error } = await supabaseAdmin
      .from('crm_tasks')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select(TASK_SELECT)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Task not found', 404);

    // A LinkedIn touch raised by a sequence parks its contact until someone
    // does it. Ticking it off is what tells the sequence to carry on — and it
    // must never be able to fail the request that ticked it.
    if (input.is_done === true && (data as any).campaign_contact_id) {
      resumeAfterTask(id).catch((e) => console.warn('[CRM] sequence resume failed:', e?.message));
    }

    return data;
  },

  async deleteTask(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('crm_tasks').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  /* ── Events (calendar) ── */
  async listEvents(userId: string, from?: string, to?: string, filters?: { contactId?: string; dealId?: string }) {
    let query = supabaseAdmin.from('crm_events').select(EVENT_SELECT).eq('user_id', userId);
    if (from) query = query.gte('starts_at', from);
    if (to) query = query.lte('starts_at', to);
    if (filters?.contactId) query = query.eq('contact_id', filters.contactId);
    if (filters?.dealId) query = query.eq('deal_id', filters.dealId);
    const { data, error } = await query.order('starts_at', { ascending: true });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async createEvent(userId: string, body: any) {
    if (!body.title || !String(body.title).trim()) throw new AppError('Event title is required', 400);
    if (!body.starts_at) throw new AppError('Event start time is required', 400);
    const input = pick(body, EVENT_KEYS as any);
    if (input.type && !EVENT_TYPES.includes(input.type)) throw new AppError('Invalid event type', 400);
    if (input.deal_id) await assertOwned(userId, 'deals', input.deal_id, 'Deal');
    if (input.contact_id) await assertOwned(userId, 'contacts', input.contact_id, 'Contact');
    if (input.company_id) await assertOwned(userId, 'companies', input.company_id, 'Company');
    await autoLinkContact(userId, input);
    const { data, error } = await supabaseAdmin
      .from('crm_events')
      .insert({ ...input, user_id: userId })
      .select(EVENT_SELECT)
      .single();
    if (error) throw new AppError(error.message, 500);
    // Booking time with somebody is engagement by any reasonable reading.
    if (input.contact_id) promoteToContact(userId, [input.contact_id], 'meeting').catch(() => {});
    return data;
  },

  async updateEvent(userId: string, id: string, body: any) {
    const input = pick(body, EVENT_KEYS as any);
    if (input.type && !EVENT_TYPES.includes(input.type)) throw new AppError('Invalid event type', 400);
    if (input.deal_id) await assertOwned(userId, 'deals', input.deal_id, 'Deal');
    if (input.contact_id) await assertOwned(userId, 'contacts', input.contact_id, 'Contact');
    const { data, error } = await supabaseAdmin
      .from('crm_events')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select(EVENT_SELECT)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Event not found', 404);
    return data;
  },

  async deleteEvent(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('crm_events').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  /* ── Notes ── */
  async listNotes(userId: string, filters?: { contactId?: string; dealId?: string }) {
    let q = supabaseAdmin
      .from('crm_notes')
      .select('*, deal:deals(id, title, stage)')
      .eq('user_id', userId);
    if (filters?.contactId) q = q.eq('contact_id', filters.contactId);
    if (filters?.dealId) q = q.eq('deal_id', filters.dealId);
    // Pinned first, then newest — the standing context before the running log.
    const { data, error } = await q
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async createNote(userId: string, body: any) {
    if (!body.body || !String(body.body).trim()) throw new AppError('Note body is required', 400);
    const input = pick(body, NOTE_KEYS as any);
    if (!input.contact_id && !input.deal_id) throw new AppError('A note must be attached to a contact or a deal', 400);
    if (input.contact_id) await assertOwned(userId, 'contacts', input.contact_id, 'Contact');
    if (input.deal_id) await assertOwned(userId, 'deals', input.deal_id, 'Deal');
    const { data, error } = await supabaseAdmin
      .from('crm_notes')
      .insert({ ...input, body: String(input.body).trim(), user_id: userId })
      .select('*, deal:deals(id, title, stage)')
      .single();
    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async updateNote(userId: string, id: string, body: any) {
    const input = pick(body, NOTE_KEYS as any);
    if (input.body !== undefined && !String(input.body).trim()) throw new AppError('Note body is required', 400);
    if (input.contact_id) await assertOwned(userId, 'contacts', input.contact_id, 'Contact');
    if (input.deal_id) await assertOwned(userId, 'deals', input.deal_id, 'Deal');
    const { data, error } = await supabaseAdmin
      .from('crm_notes')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select('*, deal:deals(id, title, stage)')
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Note not found', 404);
    return data;
  },

  async deleteNote(userId: string, id: string) {
    const { error } = await supabaseAdmin.from('crm_notes').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  /**
   * Everything CRM holds about one contact, in a single round-trip — the
   * profile page needs all four lists at once and four sequential requests
   * made it feel slow.
   */
  /**
   * Everything the deal page renders, in one request.
   *
   * Seven round trips from the browser to paint one page is how a detail
   * view ends up feeling slow and popping into place a section at a time.
   * They are independent, so they go together.
   */
  async dealDetail(userId: string, dealId: string) {
    const { data: deal, error } = await supabaseAdmin
      .from('deals')
      .select(DEAL_SELECT)
      .eq('id', dealId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!deal) throw new AppError('Deal not found', 404);

    const [participants, tasks, events, notes, history] = await Promise.all([
      this.listParticipants(userId, dealId),
      this.listTasks(userId, { dealId }),
      this.listEvents(userId, undefined, undefined, { dealId }),
      this.listNotes(userId, { dealId }),
      this.dealStageHistory(userId, dealId),
    ]);

    /*
     * The conversation on a deal is with everybody on it, not just whoever
     * happens to be the primary contact. A thread with the champion and a
     * separate one with procurement are the same negotiation, and showing
     * only one of them is how a deal page ends up looking quiet while the
     * inbox is busy.
     */
    const addresses = [
      (deal as any).contact?.email,
      (deal as any).contact_email,
      ...participants.map((p: any) => p.contact?.email),
    ]
      .filter((e): e is string => typeof e === 'string' && !!e.trim())
      .map((e) => e.trim().toLowerCase());
    const unique = [...new Set(addresses)];

    const emails = unique.length ? await this.emailsForAddresses(userId, unique) : [];

    return { deal, participants, tasks, events, notes, history, emails };
  },

  /**
   * Inbox messages to or from any of these addresses, newest first.
   *
   * Addresses go into a PostgREST `in.(...)` list, where a comma, bracket or
   * quote is structure rather than data: one in an address would close the
   * list early and widen the query to messages that are nobody's business on
   * this deal.
   *
   * So anything that cannot be encoded is dropped, not stripped. Stripping
   * looks safer and is worse - it rewrites the address into a different one
   * that may well be a real mailbox, and then quietly shows you somebody
   * else's correspondence under this deal's name. An address we cannot ask
   * about honestly is one we do not ask about.
   */
  async emailsForAddresses(userId: string, addresses: string[], limit = 100) {
    // Deliberately conservative: an address that fails this is worth missing.
    const encodable = /^[^\s,()"'\\%_]+@[^\s,()"'\\%_]+$/;
    const safe = addresses
      .map((a) => a.trim().toLowerCase())
      .filter((a) => encodable.test(a))
      // A deal with more people than this on it has bigger problems, but the
      // cap keeps one runaway record from building an enormous filter.
      .slice(0, 25);
    if (safe.length === 0) return [];

    const list = `(${safe.join(',')})`;
    const { data, error } = await supabaseAdmin
      .from('inbox_messages')
      .select('id, subject, from_email, to_email, direction, received_at, body_text, is_read, contact_id')
      .eq('user_id', userId)
      .or(`from_email.in.${list},to_email.in.${list}`)
      .order('received_at', { ascending: false })
      .limit(limit);
    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  /**
   * Everything the won/loss analysis reads, in one request.
   *
   * The stage history is the expensive half and the reason this exists as
   * its own endpoint: answering "where do deals die" needs every closing
   * transition for every closed deal, which is not something the board
   * should be paying for on each load.
   *
   * `days` bounds the window by when deals closed. Open deals are always
   * included regardless, because "what is still live" has no closed date to
   * filter on and is half of every ratio on the page.
   */
  async insights(userId: string, days = 180) {
    const window = Number.isFinite(days) && days > 0 ? Math.min(Math.round(days), 3650) : 180;
    const since = new Date(Date.now() - window * 86_400_000).toISOString();

    const { data: deals, error } = await supabaseAdmin
      .from('deals')
      .select('id, title, stage, value, currency, probability, source, label, outcome_reason, closed_at, created_at, stage_changed_at, recurring_amount, recurring_period, one_off_amount, term_months')
      .eq('user_id', userId)
      .or(`closed_at.is.null,closed_at.gte.${since}`);
    if (error) throw new AppError(error.message, 500);

    const rows = deals || [];
    if (rows.length === 0) return { deals: [], history: {}, windowDays: window };

    /*
     * Fetched by deal id rather than by user and date, because a deal that
     * closed inside the window may have started well outside it, and its
     * early transitions are exactly what the stage-duration figures need.
     */
    const ids = rows.map((d: any) => d.id);
    const history: Record<string, any[]> = {};
    // Chunked: a few thousand uuids in one `in` list makes a URL long enough
    // to be refused before it reaches the database.
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data: events, error: histError } = await supabaseAdmin
        .from('deal_stage_events')
        .select('deal_id, from_stage, to_stage, reason, changed_at')
        .eq('user_id', userId)
        .in('deal_id', ids.slice(i, i + CHUNK))
        .order('changed_at', { ascending: true });
      if (histError) throw new AppError(histError.message, 500);
      for (const event of events || []) {
        (history[event.deal_id] ||= []).push(event);
      }
    }

    return { deals: rows, history, windowDays: window };
  },

  async contactSummary(userId: string, contactId: string) {
    await assertOwned(userId, 'contacts', contactId, 'Contact');
    const [own, joined, tasks, events, notes] = await Promise.all([
      this.listDeals(userId, { contactId }),
      this.dealsForParticipant(userId, contactId),
      this.listTasks(userId, { contactId }),
      this.listEvents(userId, undefined, undefined, { contactId }),
      this.listNotes(userId, { contactId }),
    ]);

    /*
     * A person's deals are the ones they lead and the ones they are merely
     * on. Leaving the second kind out understates their exposure: the
     * technical evaluator who can sink four deals looked, on their own page,
     * like somebody with nothing riding on anything.
     *
     * Merged by id because a contact can be primary on one deal and a
     * participant on another, and could in principle be both on the same one
     * if the data predates the guard against it.
     */
    const byId = new Map<string, any>();
    for (const deal of own) byId.set(deal.id, deal);
    for (const deal of joined) {
      const existing = byId.get(deal.id);
      if (existing) existing.participant_role = existing.participant_role ?? deal.participant_role;
      else byId.set(deal.id, deal);
    }

    return { deals: [...byId.values()], tasks, events, notes };
  },
};

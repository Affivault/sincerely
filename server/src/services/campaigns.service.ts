import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { getPagination, formatPaginatedResponse } from '../utils/pagination.js';
import { fireEvent } from './webhook.service.js';
import { processDueSteps } from './sequence.service.js';
import { settingsService } from './settings.service.js';
import { extractTags, TAG_LABELS, TAG_SOURCE_FIELD, SENDER_TAGS, LINK_TAGS } from '../utils/merge-tags.js';
import type { PersonalizationAudit, PersonalizationTag } from '@lemlist/shared';

interface ListParams {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export const campaignsService = {
  /**
   * Verify the campaign belongs to this user before delegating to a sub-resource
   * service (steps/contacts/sender pool) that only filters by campaign_id.
   * Without this, any authenticated user could read/mutate another tenant's
   * campaign data by guessing/enumerating a campaign UUID.
   */
  async assertOwnership(userId: string, campaignId: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Campaign not found', 404);
  },

  /**
   * Like assertOwnership, but also blocks mutating a campaign's step sequence
   * once it's left draft. Contacts mid-sequence track their position via
   * campaign_contacts.current_step_order, a plain array index into the steps
   * list — adding/removing/reordering steps on a running campaign shifts that
   * index out from under in-flight contacts and sends them the wrong step.
   */
  async assertEditableSteps(userId: string, campaignId: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('id, status')
      .eq('id', campaignId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Campaign not found', 404);
    if (data.status !== 'draft') {
      throw new AppError('Can only edit steps while the campaign is in draft status', 400);
    }
  },

  /**
   * Verify a smtp_account_id belongs to this user before it can be attached to
   * a campaign. Without this, a user could point their campaign's smtp_account_id
   * at another tenant's account and send real email through their mailbox.
   */
  async assertSmtpAccountOwnership(userId: string, smtpAccountId: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from('smtp_accounts')
      .select('id')
      .eq('id', smtpAccountId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('SMTP account not found', 404);
  },

  async list(userId: string, params: ListParams) {
    // Higher cap than the default 100: campaign counts per workspace stay
    // small (unlike contacts), and the campaigns list page and the
    // "add to campaign" picker both request up to 500 expecting one page.
    const { page, limit, from, to } = getPagination(params, 500);

    let query = supabaseAdmin
      .from('campaigns')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    if (params.status) {
      query = query.eq('status', params.status);
    }

    if (params.search) {
      query = query.ilike('name', `%${params.search}%`);
    }

    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data: campaigns, count, error } = await query;
    if (error) throw new AppError(error.message, 500);

    // Batch-fetch stats for the whole page in one round-trip instead of the
    // old per-campaign getStats() fan-out (13 count queries x page size —
    // up to 325 queries for a full page). Isolate failure so a stats outage
    // doesn't break the list itself.
    let statsById = new Map<string, any>();
    if (campaigns && campaigns.length > 0) {
      try {
        const { data: statsRows, error: statsError } = await supabaseAdmin.rpc('get_campaigns_stats', {
          p_campaign_ids: campaigns.map((c: any) => c.id),
        });
        if (statsError) throw statsError;
        statsById = new Map((statsRows || []).map((row: any) => [row.campaign_id, row]));
      } catch {
        // fall through with an empty map; campaigns still render without stats
      }
    }

    const calcRate = (v: number, t: number) => (t === 0 ? 0 : Math.round((v / t) * 100 * 10) / 10);
    const withStats = (campaigns || []).map((campaign: any) => {
      const stats = statsById.get(campaign.id);
      if (!stats) return campaign;
      const { campaign_id, sent_count, opened_count, clicked_count, replied_count, bounced_count, ...rest } = stats;
      return {
        ...campaign,
        ...rest,
        sent_count,
        opened_count,
        clicked_count,
        replied_count,
        bounced_count,
        open_rate: calcRate(opened_count, sent_count),
        click_rate: calcRate(clicked_count, sent_count),
        reply_rate: calcRate(replied_count, sent_count),
        bounce_rate: calcRate(bounced_count, sent_count),
      };
    });

    return formatPaginatedResponse(withStats, count || 0, page, limit);
  },

  async get(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Campaign not found', 404);

    const { data: steps } = await supabaseAdmin
      .from('campaign_steps')
      .select('*')
      .eq('campaign_id', id)
      .order('step_order');

    const stats = await this.getStats(id);

    return { ...data, ...stats, steps: steps || [] };
  },

  async create(userId: string, input: any) {
    if (input.smtp_account_id) {
      await this.assertSmtpAccountOwnership(userId, input.smtp_account_id);
    }

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .insert({ ...input, user_id: userId, status: 'draft' })
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    fireEvent(userId, 'campaign.created', { campaign: data }).catch((err: any) => console.error('[Campaign] Webhook error:', err?.message ?? String(err)));
    return data;
  },

  async update(userId: string, id: string, input: any) {
    const existing = await this.get(userId, id);
    if (existing.status !== 'draft') {
      throw new AppError('Can only edit campaigns in draft status', 400);
    }

    if (input.smtp_account_id) {
      await this.assertSmtpAccountOwnership(userId, input.smtp_account_id);
    }

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    fireEvent(userId, 'campaign.updated', { campaign: data }).catch((err: any) => console.error('[Campaign] Webhook error:', err?.message ?? String(err)));
    return data;
  },

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('campaigns')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
    fireEvent(userId, 'campaign.deleted', { campaign_id: id }).catch((err: any) => console.error('[Campaign] Webhook error:', err?.message ?? String(err)));
  },

  /**
   * What this campaign's copy asks for, and how much of it the audience can
   * actually answer.
   *
   * A merge tag with no value behind it used to be invisible until a prospect
   * replied to point it out. This counts, before a single email goes out, how
   * many of the contacts about to receive the sequence are missing each field
   * it references — so "142 of 800 have no company" is something you find out
   * while you can still fix it.
   *
   * Tags carrying a fallback are reported but never counted as gaps: they
   * degrade to readable copy by design, which is the whole point of writing
   * one.
   */
  async personalizationAudit(userId: string, id: string): Promise<PersonalizationAudit> {
    await this.assertOwnership(userId, id);

    const { data: steps } = await supabaseAdmin
      .from('campaign_steps')
      .select('subject, subject_b, body_html, body_html_b, body_text, linkedin_note')
      .eq('campaign_id', id);

    // Every distinct tag across every step, in both A and B variants.
    const used = new Map<string, boolean>();
    for (const step of steps || []) {
      const copy = [step.subject, step.subject_b, step.body_html, step.body_html_b, step.body_text, step.linkedin_note];
      for (const text of copy) {
        for (const { name, hasFallback } of extractTags(text || '')) {
          used.set(name, (used.get(name) ?? true) && hasFallback);
        }
      }
    }
    if (used.size === 0) {
      const { count } = await supabaseAdmin
        .from('campaign_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', id);
      return { total_contacts: count || 0, tags: [] };
    }

    // Sender tags are answered by the account, not the audience — one check
    // for the whole campaign rather than a count across contacts.
    const sender = await settingsService.senderIdentity(userId);
    const senderValue: Record<string, string> = {
      sender_name: sender.name || '',
      sender_first_name: (sender.name || '').split(/\s+/)[0] || '',
      sender_company: sender.company || '',
      sender_email: 'set per mailbox',
    };

    // The contact columns this campaign's copy actually reads. Only these are
    // fetched — several tags can share one column (city and country both come
    // from `location`), so the set is usually smaller than the tag list.
    const neededFields = [...new Set(
      [...used.keys()].map((name) => TAG_SOURCE_FIELD[name]).filter(Boolean),
    )];

    // One walk through the audience tallying blanks per column, rather than a
    // count query per tag. Paged because PostgREST caps a response at 1000
    // rows and a silent truncation here would under-report the gaps — the one
    // thing this audit exists to get right.
    const blanks: Record<string, number> = Object.fromEntries(neededFields.map((f) => [f, 0]));
    let totalContacts = 0;
    if (neededFields.length > 0) {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data: rows, error } = await supabaseAdmin
          .from('campaign_contacts')
          .select(`contacts!inner(${neededFields.join(', ')})`)
          .eq('campaign_id', id)
          .range(from, from + PAGE - 1);
        if (error) throw new AppError(error.message, 500);
        const page = rows || [];
        for (const row of page) {
          totalContacts++;
          const contact = (row as any).contacts || {};
          for (const field of neededFields) {
            const v = contact[field];
            if (v === null || v === undefined || String(v).trim() === '') blanks[field]++;
          }
        }
        if (page.length < PAGE) break;
      }
    } else {
      const { count } = await supabaseAdmin
        .from('campaign_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', id);
      totalContacts = count || 0;
    }

    const tags: PersonalizationTag[] = [];
    for (const [name, hasFallback] of used) {
      const label = TAG_LABELS[name] || name.replace(/_/g, ' ');

      if (LINK_TAGS.includes(name)) {
        tags.push({ name, label, scope: 'link', has_fallback: hasFallback, missing: 0, total: totalContacts });
        continue;
      }

      if (SENDER_TAGS.includes(name)) {
        tags.push({
          name, label, scope: 'sender', has_fallback: hasFallback,
          missing: senderValue[name] ? 0 : 1, total: 1,
        });
        continue;
      }

      const field = TAG_SOURCE_FIELD[name];
      if (!field) {
        // A tag nothing can fill — usually a leftover placeholder from a
        // template. Without a fallback it renders as a hole in the sentence.
        tags.push({ name, label, scope: 'unknown', has_fallback: hasFallback, missing: hasFallback ? 0 : totalContacts, total: totalContacts });
        continue;
      }

      tags.push({ name, label, scope: 'contact', has_fallback: hasFallback, missing: blanks[field] || 0, total: totalContacts });
    }

    // Worst gaps first — that's the order someone wants to read them in.
    tags.sort((a, b) => (b.missing / Math.max(b.total, 1)) - (a.missing / Math.max(a.total, 1)));
    return { total_contacts: totalContacts, tags };
  },

  async launch(userId: string, id: string) {
    const campaign = await this.get(userId, id);
    if (!['draft', 'scheduled', 'running', 'paused'].includes(campaign.status)) {
      throw new AppError('Campaign cannot be launched from its current status (' + campaign.status + ')', 400);
    }

    // Validate steps exist
    const { count: stepsExist } = await supabaseAdmin
      .from('campaign_steps')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id);

    if (!stepsExist || stepsExist === 0) {
      throw new AppError('Campaign must have at least one step', 400);
    }

    // Count contacts
    const { count } = await supabaseAdmin
      .from('campaign_contacts')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id);

    if (!count || count === 0) {
      throw new AppError('Campaign must have at least one contact', 400);
    }

    // Validate SMTP account
    if (campaign.smtp_account_id) {
      const { data: smtp } = await supabaseAdmin
        .from('smtp_accounts')
        .select('id, label, is_active')
        .eq('id', campaign.smtp_account_id)
        .eq('user_id', userId)
        .single();
      if (!smtp || !smtp.is_active) {
        throw new AppError('Campaign SMTP account is inactive or missing. Check your email account settings.', 400);
      }
    } else {
      // Check if user has ANY active SMTP account
      const { data: anySMTP } = await supabaseAdmin
        .from('smtp_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .limit(1);
      if (!anySMTP || anySMTP.length === 0) {
        throw new AppError('No active email account found. Add and connect an email account first.', 400);
      }
    }

    // Honor a future scheduled start: the first send waits until scheduled_at
    // instead of firing the moment Launch is clicked. This is what stops a
    // campaign from blasting immediately unless the user chose "Send now".
    const scheduledAt = campaign.scheduled_at ? new Date(campaign.scheduled_at) : null;
    const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now() + 30_000;
    const firstSendAt = isScheduled ? scheduledAt!.toISOString() : new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update({
        status: isScheduled ? 'scheduled' : 'running',
        started_at: isScheduled ? null : new Date().toISOString(),
        total_contacts: count,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);

    // Activate ALL contacts that aren't completed/bounced/unsubscribed, with
    // next_send_at set to the scheduled start (or now). This handles both
    // fresh launches (pending → active) and re-launches (stale next_send_at).
    console.log(`[Campaign] Activating contacts for campaign ${id} (start: ${firstSendAt})`);

    const { data: activatedPending, error: pendErr } = await supabaseAdmin
      .from('campaign_contacts')
      .update({ status: 'active', next_send_at: firstSendAt })
      .eq('campaign_id', id)
      .eq('status', 'pending')
      .select('id');
    if (pendErr) console.error('[Campaign] Error activating pending contacts:', pendErr.message);

    // Also reset any stuck 'active' contacts (from failed previous launches) —
    // scoped to contacts with no next_send_at at all. launch() is reachable on
    // an already-running/paused campaign (e.g. via the API), and without this
    // scope it would force-reset every contact's next_send_at to "now",
    // including ones correctly waiting out a legitimate multi-day delay step,
    // firing their next step immediately and blowing up the send cadence.
    // Contacts parked in a webhook_wait step also have next_send_at null while
    // waiting (by design — see processWebhookWaitStep), so they're excluded
    // here too: resetting next_send_at would re-run that same webhook_wait
    // step and restart its timeout window from scratch on every relaunch.
    //
    // A contact parked on a LinkedIn task is the same situation: it has no
    // next_send_at while a human or the agent works the task. Waking it would
    // re-run the step and raise a SECOND invite for the same person, leaving
    // the first task orphaned in the queue.
    const { data: resetActive, error: actErr } = await supabaseAdmin
      .from('campaign_contacts')
      .update({ next_send_at: firstSendAt, error_message: null })
      .eq('campaign_id', id)
      .eq('status', 'active')
      .is('next_send_at', null)
      .is('waiting_for_webhook', null)
      .is('waiting_for_task_id', null)
      .select('id');
    if (actErr) console.error('[Campaign] Error resetting active contacts:', actErr.message);

    const totalActivated = (activatedPending?.length || 0) + (resetActive?.length || 0);
    console.log(`[Campaign] Activated ${activatedPending?.length || 0} pending + reset ${resetActive?.length || 0} active = ${totalActivated} total contacts`);

    fireEvent(userId, 'campaign.launched', { campaign: data }).catch((err: any) => console.error('[Campaign] Webhook error:', err?.message ?? String(err)));

    // Only kick immediate processing for "send now". Scheduled campaigns are
    // picked up by the sequence worker once next_send_at arrives.
    if (!isScheduled) {
      console.log(`[Campaign] Launched campaign ${id} — triggering immediate processing`);
      try {
        const processed = await processDueSteps();
        console.log(`[Campaign] Immediate processing: ${processed} contact(s) processed`);
      } catch (err: any) {
        console.error('[Campaign] Immediate processing error:', err.message);
      }
    } else {
      console.log(`[Campaign] Scheduled campaign ${id} to start at ${firstSendAt}`);
    }

    return data;
  },

  async pause(userId: string, id: string) {
    const campaign = await this.get(userId, id);
    if (campaign.status !== 'running') {
      throw new AppError('Campaign must be running to pause', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update({ status: 'paused' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    fireEvent(userId, 'campaign.paused', { campaign: data }).catch((err: any) => console.error('[Campaign] Webhook error:', err?.message ?? String(err)));
    return data;
  },

  async resume(userId: string, id: string) {
    const campaign = await this.get(userId, id);
    if (campaign.status !== 'paused') {
      throw new AppError('Campaign must be paused to resume', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update({ status: 'running' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    fireEvent(userId, 'campaign.resumed', { campaign: data }).catch((err: any) => console.error('[Campaign] Webhook error:', err?.message ?? String(err)));
    return data;
  },

  async retryErrors(userId: string, id: string) {
    const campaign = await this.get(userId, id); // ownership check
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('campaign_contacts')
      .update({ status: 'active', next_send_at: now, error_message: null })
      .eq('campaign_id', id)
      .eq('status', 'error')
      .select('id');
    if (error) throw new AppError(error.message, 500);

    // checkAndAutoCompleteCampaign() treats 'error' as a terminal contact status,
    // so a campaign whose last outstanding contacts all errored out has already
    // flipped to 'completed' — and a campaign can also be 'cancelled' while it
    // still has 'error' contacts sitting on it. processDueSteps()/processNextStep()
    // only ever pick up contacts whose campaign is still 'running' — without
    // resuming it here, the contacts just reactivated above would sit as 'active'
    // forever and never actually get retried.
    if ((data?.length || 0) > 0 && (campaign.status === 'completed' || campaign.status === 'cancelled')) {
      const { error: resumeErr } = await supabaseAdmin
        .from('campaigns')
        .update({ status: 'running', completed_at: null })
        .eq('id', id)
        .in('status', ['completed', 'cancelled']);
      if (resumeErr) console.error(`[Campaign] Failed to resume ${id} after retrying errors:`, resumeErr.message);
    }

    return { retried: data?.length || 0 };
  },

  async cancel(userId: string, id: string) {
    const campaign = await this.get(userId, id);
    if (campaign.status !== 'running' && campaign.status !== 'paused') {
      throw new AppError('Campaign must be running or paused to cancel', 400);
    }

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    fireEvent(userId, 'campaign.cancelled', { campaign: data }).catch((err: any) => console.error('[Campaign] Webhook error:', err?.message ?? String(err)));
    return data;
  },

  async clone(userId: string, id: string) {
    const original = await this.get(userId, id);

    const { data: cloned, error } = await supabaseAdmin
      .from('campaigns')
      .insert({
        user_id: userId,
        name: `${original.name} (Copy)`,
        from_name: original.from_name,
        smtp_account_id: original.smtp_account_id,
        status: 'draft',
        settings: original.settings,
        timezone: original.timezone,
        send_days: original.send_days,
        send_window_start: original.send_window_start,
        send_window_end: original.send_window_end,
        daily_limit: original.daily_limit,
        delay_between_emails: original.delay_between_emails,
        delay_between_emails_min: original.delay_between_emails_min,
        delay_between_emails_max: original.delay_between_emails_max,
        track_opens: original.track_opens,
        track_clicks: original.track_clicks,
        include_unsubscribe: original.include_unsubscribe,
        stop_on_reply: original.stop_on_reply,
        dcs_threshold: original.dcs_threshold,
      })
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);

    if (original.steps?.length) {
      const stepRows = original.steps.map((s: any) => ({
        campaign_id: cloned.id,
        step_type: s.step_type,
        step_order: s.step_order,
        subject: s.subject,
        subject_b: s.subject_b,
        body_html: s.body_html,
        body_html_b: s.body_html_b,
        body_text: s.body_text,
        delay_days: s.delay_days,
        delay_hours: s.delay_hours,
        delay_minutes: s.delay_minutes,
        skip_if_replied: s.skip_if_replied,
        condition_field: s.condition_field,
        condition_operator: s.condition_operator,
        condition_value: s.condition_value,
        true_branch_step: s.true_branch_step,
        false_branch_step: s.false_branch_step,
        webhook_event: s.webhook_event,
        webhook_timeout_hours: s.webhook_timeout_hours,
        linkedin_note: s.linkedin_note,
      }));
      const { error: stepsError } = await supabaseAdmin.from('campaign_steps').insert(stepRows);
      if (stepsError) throw new AppError(`Failed to clone campaign steps: ${stepsError.message}`, 500);
    }

    fireEvent(userId, 'campaign.created', { campaign: cloned }).catch(() => {});
    return cloned;
  },

  async getStats(campaignId: string) {
    const base = { count: 'exact' as const, head: true };
    const act = (type: string) =>
      supabaseAdmin.from('campaign_activities').select('*', base).eq('campaign_id', campaignId).eq('activity_type', type);
    const cc = (status: string) =>
      supabaseAdmin.from('campaign_contacts').select('*', base).eq('campaign_id', campaignId).eq('status', status);

    const [
      { count: stepsCount },
      { count: contactsCount },
      { count: sentCount },
      { count: openedCount },
      { count: clickedCount },
      { count: repliedCount },
      { count: bouncedCount },
      { count: activeContacts },
      { count: completedContacts },
      { count: bouncedContacts },
      { count: unsubscribedContacts },
      { count: suppressedContacts },
      { count: errorContacts },
    ] = await Promise.all([
      supabaseAdmin.from('campaign_steps').select('*', base).eq('campaign_id', campaignId),
      supabaseAdmin.from('campaign_contacts').select('*', base).eq('campaign_id', campaignId),
      act('sent'),
      act('opened'),
      act('clicked'),
      act('replied'),
      act('bounced'),
      cc('active'),
      cc('completed'),
      cc('bounced'),
      cc('unsubscribed'),
      cc('suppressed'),
      cc('error'),
    ]);

    const sent = sentCount || 0;
    const opened = openedCount || 0;
    const clicked = clickedCount || 0;
    const replied = repliedCount || 0;
    const bounced = bouncedCount || 0;
    const calcRate = (v: number, t: number) => t === 0 ? 0 : Math.round((v / t) * 100 * 10) / 10;

    return {
      steps_count: stepsCount || 0,
      contacts_count: contactsCount || 0,
      sent_count: sent,
      opened_count: opened,
      clicked_count: clicked,
      replied_count: replied,
      bounced_count: bounced,
      active_contacts: activeContacts || 0,
      completed_contacts: completedContacts || 0,
      bounced_contacts: bouncedContacts || 0,
      unsubscribed_contacts: unsubscribedContacts || 0,
      suppressed_contacts: suppressedContacts || 0,
      error_contacts: errorContacts || 0,
      open_rate: calcRate(opened, sent),
      click_rate: calcRate(clicked, sent),
      reply_rate: calcRate(replied, sent),
      bounce_rate: calcRate(bounced, sent),
    };
  },
};

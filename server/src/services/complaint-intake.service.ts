/* ═══════════════════════════════════════════════════════════════════════
   Spam complaints, acted on.

   See shared/complaint-report for how a feedback-loop report is read. This
   is the half that acts on one, the way a bounce is acted on:

     - the person goes on the suppression list as "complained", is marked
       unsubscribed, and every sequence still emailing them stops
     - the complaint is recorded against the send it answers, and so
       against the mailbox that sent it - the autopilot slows a mailbox on
       its first complaint and rests it on a second (shared/autopilot)
     - you are told: Slack/webhooks get email.complained, and so does your
       inbox when "Email notifications" is on

   Idempotent: one person's complaint about one enrolment is recorded once,
   however many times the report is read. Never throws into the sync.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import type { ComplaintReport, ComplaintSummary } from '@lemlist/shared';
import { suppressionService } from './suppression.service.js';
import { fireEvent } from './webhook.service.js';
import { checkAndAutoCompleteCampaign } from './sequence.service.js';

export interface ComplaintTarget {
  email: string;
  contact_id: string;
  campaign_id: string | null;
  campaign_contact_id: string | null;
  step_id: string | null;
  smtp_account_id: string | null;
}

/** Who a report is about, from the strongest evidence it carries. */
async function resolve(userId: string, r: ComplaintReport): Promise<ComplaintTarget | null> {
  // 1. The original's own X-Sincerely-* headers.
  if (r.contactId) {
    const { data: contact } = await supabaseAdmin
      .from('contacts').select('id, email').eq('id', r.contactId).eq('user_id', userId).maybeSingle();
    if (contact) {
      let cc: any = null;
      if (r.campaignId) {
        ({ data: cc } = await supabaseAdmin
          .from('campaign_contacts').select('id, campaign_id, campaigns!inner(user_id)')
          .eq('campaign_id', r.campaignId).eq('contact_id', contact.id).eq('campaigns.user_id', userId).maybeSingle());
      }
      return {
        email: String(contact.email).toLowerCase(), contact_id: contact.id,
        campaign_id: cc?.campaign_id ?? null, campaign_contact_id: cc?.id ?? null, step_id: r.stepId, smtp_account_id: null,
      };
    }
  }
  // 2. The send it answers, by Message-ID.
  if (r.originalMessageId) {
    const { data: sent } = await supabaseAdmin
      .from('campaign_activities')
      .select('campaign_id, campaign_contact_id, contact_id, step_id, metadata, campaigns!inner(user_id), contacts(email)')
      .eq('activity_type', 'sent')
      .eq('message_id', r.originalMessageId)
      .eq('campaigns.user_id', userId)
      .maybeSingle();
    if (sent && (sent as any).contacts?.email) {
      return {
        email: String((sent as any).contacts.email).toLowerCase(), contact_id: (sent as any).contact_id,
        campaign_id: (sent as any).campaign_id, campaign_contact_id: (sent as any).campaign_contact_id,
        step_id: (sent as any).step_id, smtp_account_id: (sent as any).metadata?.smtp_account_id ?? null,
      };
    }
  }
  // 3. The recipient, when the provider left it in.
  if (r.recipient) {
    const { data: contact } = await supabaseAdmin
      .from('contacts').select('id, email').eq('user_id', userId).eq('email', r.recipient).maybeSingle();
    if (contact) {
      return { email: r.recipient, contact_id: contact.id, campaign_id: null, campaign_contact_id: null, step_id: null, smtp_account_id: null };
    }
  }
  return null;
}

/** The latest send to this person, for the mailbox and campaign a report did not name. */
async function lastSendTo(userId: string, t: ComplaintTarget): Promise<ComplaintTarget> {
  if (t.campaign_contact_id && t.smtp_account_id) return t;
  let q = supabaseAdmin
    .from('campaign_activities')
    .select('campaign_id, campaign_contact_id, step_id, metadata, campaigns!inner(user_id)')
    .eq('activity_type', 'sent')
    .eq('contact_id', t.contact_id)
    .eq('campaigns.user_id', userId)
    .order('occurred_at', { ascending: false })
    .limit(1);
  if (t.campaign_contact_id) q = q.eq('campaign_contact_id', t.campaign_contact_id);
  const { data } = await q.maybeSingle();
  if (!data) return t;
  return {
    ...t,
    campaign_id: t.campaign_id ?? (data as any).campaign_id,
    campaign_contact_id: t.campaign_contact_id ?? (data as any).campaign_contact_id,
    step_id: t.step_id ?? (data as any).step_id,
    smtp_account_id: t.smtp_account_id ?? (data as any).metadata?.smtp_account_id ?? null,
  };
}

export interface ComplaintIntake {
  recorded: boolean;
  email: string | null;
  /** Enrolments stopped. */
  stopped: number;
}

export async function intakeComplaint(userId: string, report: ComplaintReport, inboxMessageId: string | null): Promise<ComplaintIntake> {
  try {
    const found = await resolve(userId, report);
    if (!found) {
      console.warn(`[Complaint] A ${report.provider} report could not be matched to anybody (message ${report.originalMessageId || 'unknown'})`);
      return { recorded: false, email: null, stopped: 0 };
    }
    const t = await lastSendTo(userId, found);

    // Once per enrolment (or per person, when no campaign is known).
    let seen = supabaseAdmin
      .from('campaign_activities')
      .select('id', { count: 'exact', head: true })
      .eq('activity_type', 'complained')
      .eq('contact_id', t.contact_id);
    if (t.campaign_contact_id) seen = seen.eq('campaign_contact_id', t.campaign_contact_id);
    const { count } = await seen;
    const first = (count || 0) === 0;

    if (first && t.campaign_id) {
      const { error } = await supabaseAdmin.from('campaign_activities').insert({
        campaign_id: t.campaign_id,
        campaign_contact_id: t.campaign_contact_id,
        contact_id: t.contact_id,
        step_id: t.step_id,
        activity_type: 'complained',
        metadata: {
          to: t.email,
          smtp_account_id: t.smtp_account_id,
          provider: report.provider,
          feedback_type: report.feedbackType,
          inbox_message_id: inboxMessageId,
        },
      });
      if (error) console.error(`[Complaint] Could not record complaint for ${t.email}: ${error.message}`);
    }

    // Whatever else happens, they are never emailed again.
    await suppressionService.add(userId, t.email, 'complained', `Marked as spam (reported by ${report.provider})`)
      .catch((e: any) => console.error(`[Complaint] Could not suppress ${t.email}: ${e?.message || e}`));
    await supabaseAdmin.from('contacts').update({ is_unsubscribed: true }).eq('id', t.contact_id).eq('user_id', userId);
    const { data: stopped } = await supabaseAdmin
      .from('campaign_contacts')
      .update({ status: 'unsubscribed', next_send_at: null, completed_at: new Date().toISOString() })
      .eq('contact_id', t.contact_id)
      .in('status', ['pending', 'active', 'paused'])
      .select('campaign_id');
    for (const id of new Set((stopped || []).map((r: any) => r.campaign_id))) {
      checkAndAutoCompleteCampaign(id).catch(() => {});
    }

    if (first) {
      let campaignName: string | null = null;
      if (t.campaign_id) {
        const { data: c } = await supabaseAdmin.from('campaigns').select('name').eq('id', t.campaign_id).maybeSingle();
        campaignName = (c as any)?.name ?? null;
      }
      fireEvent(userId, 'email.complained', {
        email: t.email,
        contact_id: t.contact_id,
        campaign_id: t.campaign_id,
        campaign_name: campaignName,
        smtp_account_id: t.smtp_account_id,
        provider: report.provider,
      }).catch(() => {});
    }
    return { recorded: first, email: t.email, stopped: (stopped || []).length };
  } catch (err: any) {
    console.error(`[Complaint] Could not handle a ${report.provider} report: ${err?.message || err}`);
    return { recorded: false, email: null, stopped: 0 };
  }
}

/** The Autopilot page's complaints card: the last 30 days. */
export async function complaintsFor(userId: string): Promise<ComplaintSummary> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: rows }, { count: sent }, { data: boxes }] = await Promise.all([
    supabaseAdmin
      .from('campaign_activities')
      .select('id, occurred_at, metadata, campaign_id, campaigns!inner(user_id, name)')
      .eq('campaigns.user_id', userId)
      .eq('activity_type', 'complained')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('campaign_activities')
      .select('id, campaigns!inner(user_id)', { count: 'exact', head: true })
      .eq('campaigns.user_id', userId)
      .eq('activity_type', 'sent')
      .gte('occurred_at', since),
    supabaseAdmin.from('smtp_accounts').select('id, email_address').eq('user_id', userId),
  ]);
  const box = new Map((boxes || []).map((b: any) => [b.id, b.email_address]));
  const items = (rows || []).map((r: any) => ({
    id: r.id,
    at: r.occurred_at,
    email: r.metadata?.to ?? null,
    provider: r.metadata?.provider ?? null,
    campaign_id: r.campaign_id,
    campaign_name: r.campaigns?.name ?? null,
    mailbox: r.metadata?.smtp_account_id ? box.get(r.metadata.smtp_account_id) ?? null : null,
  }));
  return { items, total: items.length, sent: sent || 0 };
}

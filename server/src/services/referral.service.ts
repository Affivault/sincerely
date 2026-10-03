/* ═══════════════════════════════════════════════════════════════════════
   Acting on a referral: "talk to Sam".

   See shared/referral for how the person is found. From the reply:

     draft   the intro email - Claude when configured, a plain template
             otherwise - opening with who suggested getting in touch
     send    add the person as a contact at the referrer's company (or use
             the one that exists), send the intro from the mailbox the
             reply came in on, and - when asked - carry on with the rest of
             the referrer's campaign from its second step, so the follow-
             ups arrive on the campaign's own schedule

   The intro is recorded as the campaign's first send, with its own
   Message-ID, so when Sam answers it, it is matched and the sequence
   stops like any other reply. The referrer's own sequence already
   stopped when they replied.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { referralIntro } from '@lemlist/shared';
import { aiAvailable, draftReply } from './ai.service.js';
import { settingsService } from './settings.service.js';
import { inboxService } from './inbox.service.js';
import { contactsService } from './contacts.service.js';
import { suppressionService } from './suppression.service.js';
import { advanceToNextStep } from './sequence.service.js';
import { stripQuoted, htmlToText } from '../utils/mail-kind.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function loadReply(userId: string, messageId: string) {
  const { data, error } = await supabaseAdmin
    .from('inbox_messages')
    .select('id, user_id, smtp_account_id, from_email, sender_name, subject, body_text, body_html, campaign_id, contact_id, contacts(first_name, last_name, company, company_id, website)')
    .eq('id', messageId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError('Message not found', 404);
  return data as any;
}

function referrerOf(msg: any): { first: string | null; full: string | null; company: string | null } {
  const c = msg.contacts || {};
  const first = c.first_name || (msg.sender_name ? String(msg.sender_name).split(/\s+/)[0] : null);
  const full = [c.first_name, c.last_name].filter(Boolean).join(' ') || msg.sender_name || null;
  return { first, full, company: c.company || null };
}

async function senderFirstName(userId: string, accountId: string | null): Promise<string | null> {
  if (!accountId) return null;
  const { data } = await supabaseAdmin.from('smtp_accounts').select('from_name, label').eq('id', accountId).eq('user_id', userId).maybeSingle();
  return String((data as any)?.from_name || (data as any)?.label || '').trim().split(/\s+/)[0] || null;
}

export const referralService = {
  async draft(userId: string, messageId: string, to: { email: string; first_name?: string | null }) {
    const msg = await loadReply(userId, messageId);
    const ref = referrerOf(msg);
    const [settings, sender] = await Promise.all([
      settingsService.get(userId).catch(() => null),
      senderFirstName(userId, msg.smtp_account_id),
    ]);
    const fallback = referralIntro({
      toFirstName: to.first_name || null,
      referrerFirstName: ref.first,
      referrerCompany: ref.company,
      offer: (settings as any)?.relay_offer || null,
      senderFirstName: sender,
    });

    if (aiAvailable()) {
      const said = stripQuoted(msg.body_text || htmlToText(msg.body_html || '')).text.slice(0, 2000);
      const body = await draftReply({
        instruction: `Write a NEW first email (not a reply) to ${to.first_name || 'the person'} <${to.email}>, whom ${ref.full || 'the sender'}${ref.company ? ` at ${ref.company}` : ''} suggested we contact in the message below. Open with "${ref.first || 'Your colleague'} suggested I get in touch". Say in one sentence what we do for companies like theirs, then ask one easy question. Under 90 words. Do not quote or summarise the message itself.`,
        thread: `They wrote: ${said}`,
        contact: { first_name: to.first_name || null, company: ref.company },
        offer: (settings as any)?.relay_offer || '',
        tone: (settings as any)?.relay_tone || 'friendly',
        senderFirstName: sender,
      }).catch(() => null);
      if (body) return { subject: fallback.subject, body, engine: 'ai' as const };
    }
    return { ...fallback, engine: 'template' as const };
  },

  async send(userId: string, messageId: string, input: {
    email: string; first_name?: string | null; last_name?: string | null;
    subject: string; body: string; smtp_account_id?: string | null; follow_up?: boolean;
  }) {
    const email = String(input.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new AppError('That email address does not look right.', 400);
    if (!input.subject?.trim() || !input.body?.trim()) throw new AppError('The email needs a subject and a message.', 400);
    if (await suppressionService.isSuppressed(userId, email)) {
      throw new AppError(`${email} is on your suppression list, so it cannot be emailed.`, 409);
    }
    const msg = await loadReply(userId, messageId);
    const ref = referrerOf(msg);

    // The person, at the referrer's company.
    let { data: contact } = await supabaseAdmin
      .from('contacts').select('id, first_name, custom_fields, is_unsubscribed, is_bounced').eq('user_id', userId).eq('email', email).maybeSingle();
    if (contact && ((contact as any).is_unsubscribed || (contact as any).is_bounced)) {
      throw new AppError('That address has unsubscribed or bounced and cannot be emailed.', 409);
    }
    if (!contact) {
      const rc = msg.contacts || {};
      contact = await contactsService.create(userId, {
        email,
        first_name: input.first_name?.trim() || null,
        last_name: input.last_name?.trim() || null,
        company: rc.company || null,
        company_id: rc.company_id || null,
        website: rc.website || null,
        custom_fields: { referred_by: ref.full, referred_by_contact_id: msg.contact_id || null },
      }) as any;
    }
    if (!contact) throw new AppError('The contact could not be created.', 500);

    // Will the campaign carry on with them? Decided before sending, so a
    // refusal does not leave an intro sent and nothing behind it.
    let steps: any[] = [];
    let campaign: any = null;
    if (input.follow_up && msg.campaign_id) {
      const [{ data: c }, { data: s }, { data: existing }] = await Promise.all([
        supabaseAdmin.from('campaigns').select('id, name, status').eq('id', msg.campaign_id).eq('user_id', userId).maybeSingle(),
        supabaseAdmin.from('campaign_steps').select('*').eq('campaign_id', msg.campaign_id).order('step_order', { ascending: true }),
        supabaseAdmin.from('campaign_contacts').select('id').eq('campaign_id', msg.campaign_id).eq('contact_id', (contact as any).id).maybeSingle(),
      ]);
      if (existing) throw new AppError(`${email} is already in "${(c as any)?.name || 'this campaign'}".`, 409);
      campaign = c;
      steps = s || [];
    }

    const sent = await inboxService.compose(userId, {
      to: email,
      subject: input.subject.trim(),
      body: input.body.trim(),
      smtp_account_id: input.smtp_account_id || msg.smtp_account_id || undefined,
    });

    let enrolled = false;
    const firstEmail = steps.find((s) => s.step_type === 'email');
    if (campaign && firstEmail) {
      const { data: cc, error } = await supabaseAdmin.from('campaign_contacts').insert({
        campaign_id: campaign.id,
        contact_id: (contact as any).id,
        status: 'active',
        current_step_order: firstEmail.step_order,
        next_send_at: null,
      }).select('id').single();
      if (!error && cc) {
        // The intro stands in for the first email: recorded as it, so a
        // reply to it is matched, and the follow-ups run from step two.
        await supabaseAdmin.from('campaign_activities').insert({
          campaign_id: campaign.id,
          campaign_contact_id: cc.id,
          contact_id: (contact as any).id,
          step_id: firstEmail.id,
          activity_type: 'sent',
          message_id: sent.message_id,
          metadata: { to: email, smtp_account_id: input.smtp_account_id || msg.smtp_account_id || null, referral_from: msg.contact_id || null, subject: input.subject.trim() },
        });
        await advanceToNextStep(cc.id, firstEmail.step_order, steps);
        enrolled = true;
      } else if (error) {
        console.error(`[Referral] Intro sent to ${email} but enrolment failed: ${error.message}`);
      }
    }

    return {
      sent: true,
      contact_id: (contact as any).id,
      enrolled,
      campaign_name: enrolled ? campaign?.name ?? null : null,
      campaign_running: enrolled ? campaign?.status === 'running' : null,
    };
  },
};

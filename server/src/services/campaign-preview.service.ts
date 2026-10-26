import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  baseSubject, blankTagsFor, extractTags, stepHasVariantB, assignVariant,
  TAG_LABELS, SENDER_TAGS, LINK_TAGS,
  type CampaignPreview, type PreviewEmail, type ThreadMode, type SenderIdentity,
} from '@lemlist/shared';
import { interpolateMergeTags } from './sequence.service.js';
import { finishRecipientCopy } from './email-sender.service.js';
import { settingsService } from './settings.service.js';
import { defaultBookingLinkUrl } from './booking.service.js';
import { billingService } from './billing.service.js';
import { trackingBaseUrl } from './tracking-domain.service.js';
import { chunk, PAGE_ROWS } from '../utils/batch.js';

/* ═══════════════════════════════════════════════════════════════════════
   Every email of a campaign, as one real person will get it.

   The editor's preview shows one step against whoever is next in the list.
   What somebody actually needs before launch is narrower and harder: pick
   Ada, read the whole sequence as Ada - her name in it or a gap where it
   is missing, the follow-ups arriving as "Re:" in her thread, from the
   mailbox she will hear from - and know how many others have a gap too.

   Rendered through the send path's own pieces, in the send path's order:
   interpolateMergeTags (the sequence engine's pass, booking link included),
   the same subject-threading rules, then finishRecipientCopy - the very
   function a send uses for the unsubscribe link, sender tags and spintax,
   seeded the way a send seeds it. What is left out is what belongs to one
   send and is not the email: the tracking pixel, click wrapping and the
   per-send token on booking links.

   Spintax is seeded by the enrolment (`${stepId}:${campaignContactId}`),
   which a contact not yet in the campaign does not have. They are seeded by
   their contact id instead, so the wording shown is one they could get but
   not necessarily the one they will - and the page says so.
   ═══════════════════════════════════════════════════════════════════════ */

/** A step as the builder holds it, before it is saved. */
export interface PreviewStepInput {
  id?: string | null;
  step_type: string;
  step_order: number;
  subject?: string | null;
  subject_b?: string | null;
  body_html?: string | null;
  body_html_b?: string | null;
  thread_mode?: ThreadMode | null;
}

export interface PreviewInput {
  contactId: string;
  campaignId?: string | null;
  /** Unsaved steps from the builder; otherwise the campaign's saved ones. */
  steps?: PreviewStepInput[] | null;
  senderPoolIds?: string[] | null;
  smtpAccountId?: string | null;
  /** The builder's audience; otherwise the campaign's enrolments. */
  audienceContactIds?: string[] | null;
  includeUnsubscribe?: boolean | null;
}

/** The audience count walks this many people at most. */
const AUDIENCE_CAP = 20_000;
const MAX_STEPS = 50;
const CONTACT_FIELDS = 'id, first_name, last_name, email, company, job_title, phone, linkedin_url, website, location, custom_fields';

function cleanSteps(raw: unknown): PreviewStepInput[] {
  if (!Array.isArray(raw)) throw new AppError('steps must be a list', 400);
  const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 100_000) : null);
  return raw.slice(0, MAX_STEPS).map((s: any, i) => ({
    id: typeof s?.id === 'string' ? s.id : null,
    step_type: String(s?.step_type || ''),
    step_order: Number.isFinite(Number(s?.step_order)) ? Number(s.step_order) : i,
    subject: text(s?.subject),
    subject_b: text(s?.subject_b),
    body_html: text(s?.body_html),
    body_html_b: text(s?.body_html_b),
    thread_mode: s?.thread_mode === 'reply' || s?.thread_mode === 'new' ? s.thread_mode : null,
  }));
}

/** The mailbox this person will hear from, and how many it rotates between. */
async function senderFor(
  userId: string,
  pinnedId: string | null,
  poolIds: string[],
  preferredId: string | null,
): Promise<{ account: any | null; rotation: number; pinned: boolean }> {
  if (pinnedId) {
    const { data } = await supabaseAdmin.from('smtp_accounts').select('*')
      .eq('id', pinnedId).eq('user_id', userId).maybeSingle();
    if (data) return { account: data, rotation: 1, pinned: true };
  }
  // The same filter the send's selection starts from: sendable mailboxes,
  // narrowed to the campaign's pool when it has one.
  let q = supabaseAdmin.from('smtp_accounts').select('*')
    .eq('user_id', userId).eq('is_active', true).eq('is_verified', true).eq('is_seed', false);
  if (poolIds.length > 0) q = q.in('id', poolIds);
  const { data } = await q;
  const accounts = (data || []) as any[];
  const order = (id: string) => { const i = poolIds.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  accounts.sort((a, b) => order(a.id) - order(b.id));
  const account = accounts.find((a) => a.id === preferredId) || accounts[0] || null;
  return { account, rotation: accounts.length, pinned: false };
}

/** Who in the audience gets a gap, by tag, for the tags the copy uses without a fallback. */
async function audienceGaps(
  userId: string,
  copy: string,
  campaignId: string | null,
  audienceIds: string[] | null,
): Promise<CampaignPreview['audience']> {
  const tags = extractTags(copy)
    .filter((t) => !t.hasFallback && !SENDER_TAGS.includes(t.name) && !LINK_TAGS.includes(t.name) && t.name !== 'booking_link')
    .map((t) => t.name);
  const missing = new Map<string, number>(tags.map((t) => [t, 0]));
  let total = 0;
  let withGaps = 0;
  let capped = false;

  const tally = (contact: any) => {
    total++;
    if (tags.length === 0) return;
    const blanks = blankTagsFor(copy, contact);
    if (blanks.length > 0) withGaps++;
    for (const b of blanks) missing.set(b, (missing.get(b) || 0) + 1);
  };

  if (audienceIds) {
    const ids = [...new Set(audienceIds.filter((x) => typeof x === 'string'))];
    capped = ids.length > AUDIENCE_CAP;
    for (const slice of chunk(ids.slice(0, AUDIENCE_CAP))) {
      const { data, error } = await supabaseAdmin.from('contacts').select(CONTACT_FIELDS)
        .eq('user_id', userId).in('id', slice);
      if (error) throw new AppError(error.message, 500);
      for (const c of data || []) tally(c);
    }
  } else if (campaignId) {
    for (let from = 0; from < AUDIENCE_CAP; from += PAGE_ROWS) {
      const { data, error } = await supabaseAdmin.from('campaign_contacts')
        .select(`contacts!inner(${CONTACT_FIELDS})`)
        .eq('campaign_id', campaignId)
        .order('id')
        .range(from, from + PAGE_ROWS - 1);
      if (error) throw new AppError(error.message, 500);
      const page = data || [];
      for (const row of page) tally((row as any).contacts || {});
      if (page.length < PAGE_ROWS) break;
      if (from + PAGE_ROWS >= AUDIENCE_CAP) capped = true;
    }
  }

  return {
    total,
    with_gaps: withGaps,
    capped,
    tags: tags
      .map((name) => ({ name, label: TAG_LABELS[name] || name.replace(/_/g, ' '), missing: missing.get(name) || 0 }))
      .sort((a, b) => b.missing - a.missing),
  };
}

export async function previewAsContact(userId: string, input: PreviewInput): Promise<CampaignPreview> {
  if (!input.contactId) throw new AppError('contact_id is required', 400);

  const { data: contact, error: contactErr } = await supabaseAdmin
    .from('contacts').select('*').eq('id', input.contactId).eq('user_id', userId).maybeSingle();
  if (contactErr) throw new AppError(contactErr.message, 500);
  if (!contact) throw new AppError('Contact not found', 404);

  let campaign: any = null;
  if (input.campaignId) {
    const { data, error } = await supabaseAdmin
      .from('campaigns').select('*').eq('id', input.campaignId).eq('user_id', userId).maybeSingle();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Campaign not found', 404);
    campaign = data;
  }

  let steps: PreviewStepInput[];
  if (input.steps) {
    steps = cleanSteps(input.steps);
  } else if (campaign) {
    const { data, error } = await supabaseAdmin
      .from('campaign_steps').select('*').eq('campaign_id', campaign.id).order('step_order');
    if (error) throw new AppError(error.message, 500);
    steps = (data || []) as PreviewStepInput[];
  } else {
    throw new AppError('Either a campaign or its steps are needed', 400);
  }
  const emailSteps = steps.filter((s) => s.step_type === 'email').sort((a, b) => a.step_order - b.step_order);

  // Already in the campaign? Then the real seed, and what has already gone.
  let enrolment: any = null;
  let sends: any[] = [];
  if (campaign) {
    const { data } = await supabaseAdmin.from('campaign_contacts').select('id')
      .eq('campaign_id', campaign.id).eq('contact_id', contact.id).maybeSingle();
    enrolment = data || null;
    if (enrolment) {
      const { data: sent } = await supabaseAdmin.from('campaign_activities')
        .select('step_id, occurred_at, metadata')
        .eq('campaign_contact_id', enrolment.id).eq('activity_type', 'sent')
        .order('occurred_at', { ascending: true }).limit(50);
      sends = sent || [];
    }
  }

  const poolIds = input.senderPoolIds
    ? input.senderPoolIds.filter((x) => typeof x === 'string')
    : campaign
      ? ((await supabaseAdmin.from('campaign_smtp_accounts').select('smtp_account_id')
          .eq('campaign_id', campaign.id).order('priority')).data || []).map((r: any) => r.smtp_account_id)
      : [];
  // A follow-up comes from the mailbox the conversation started from.
  const pinnedId: string | null = sends.length ? sends[sends.length - 1]?.metadata?.smtp_account_id || null : null;
  const [mailbox, identity, bookingLink, abAllowed, trackingBase] = await Promise.all([
    senderFor(userId, pinnedId, poolIds, input.smtpAccountId ?? campaign?.smtp_account_id ?? null),
    settingsService.senderIdentity(userId),
    defaultBookingLinkUrl(userId).catch(() => null),
    billingService.hasFeature(userId, 'abTesting').catch(() => true),
    trackingBaseUrl(userId),
  ]);
  const sender: SenderIdentity = { ...identity, email: mailbox.account?.email_address || null };
  const includeUnsubscribe = input.includeUnsubscribe ?? campaign?.include_unsubscribe === true;
  // A link with the account's real host, to a token that resolves to nobody.
  const unsubscribeUrl = `${trackingBase}/api/track/unsubscribe/preview`;
  const seedId: string = enrolment?.id || contact.id;

  const emails: PreviewEmail[] = [];
  let lastSubject = '';
  emailSteps.forEach((step, i) => {
    const stepKey = step.id || `draft-${step.step_order}`;
    const isAbTest = abAllowed && stepHasVariantB(step);
    const useB = isAbTest && !!step.id && assignVariant(contact.id, step.id) === 'b';
    const rawSubject = step.subject_b && useB ? step.subject_b : step.subject || '';
    const rawBody = step.body_html_b && useB ? step.body_html_b : step.body_html || '';

    const subject = interpolateMergeTags(rawSubject, contact, bookingLink);
    const body = interpolateMergeTags(rawBody, contact, bookingLink);

    // The send's threading rules, in the send's order (email-sender step 2).
    let sendSubject = subject;
    let thread: ThreadMode = 'new';
    let problem: string | null = null;
    if (step.thread_mode === 'reply' && lastSubject) {
      sendSubject = `Re: ${baseSubject(lastSubject)}`;
      thread = 'reply';
    } else if (step.thread_mode === 'new') {
      if (!subject.trim()) problem = 'Set to go out as a new email but has no subject line - the send will refuse it.';
    } else if (!subject.trim()) {
      if (!lastSubject) problem = 'No subject line, and no earlier email to reply to - the send will refuse it.';
      else { sendSubject = `Re: ${baseSubject(lastSubject)}`; thread = 'reply'; }
    } else if (lastSubject && baseSubject(subject).toLowerCase() === baseSubject(lastSubject).toLowerCase()) {
      thread = 'reply';
    }

    const finished = finishRecipientCopy({
      subject: sendSubject,
      html: body,
      sender,
      spinSeed: (part) => `${stepKey}:${seedId}:${part}`,
      unsubscribeUrl,
      includeUnsubscribe,
    });

    const sent = step.id ? sends.find((s) => s.step_id === step.id) : null;
    const finalSubject = (sent?.metadata?.subject as string | undefined) || finished.subject;
    emails.push({
      step_id: step.id || null,
      step_order: step.step_order,
      position: i + 1,
      subject: finalSubject,
      html: finished.html,
      thread,
      // An unsaved step has no id yet, and the arm is decided by it, so
      // which one this person lands in is not knowable until it is saved.
      variant: isAbTest && step.id ? (useB ? 'b' : 'a') : null,
      blanks: blankTagsFor(`${rawSubject}\n${rawBody}`, contact),
      sent_at: sent?.occurred_at || null,
      problem,
    });
    if (finalSubject) lastSubject = finalSubject;
  });

  const copy = emailSteps.map((s) => [s.subject, s.subject_b, s.body_html, s.body_html_b].filter(Boolean).join('\n')).join('\n');
  const audienceIds = Array.isArray(input.audienceContactIds) ? input.audienceContactIds : null;

  return {
    contact: {
      id: contact.id,
      email: contact.email,
      name: [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || contact.email,
      company: contact.company || null,
    },
    enrolled: !!enrolment,
    sender: mailbox.account
      ? {
          // The From name a send uses (email-sender: from_name, else label).
          from_name: mailbox.account.from_name || mailbox.account.label || mailbox.account.email_address,
          email: mailbox.account.email_address,
          rotation: mailbox.rotation,
          pinned: mailbox.pinned,
        }
      : null,
    emails,
    audience: await audienceGaps(userId, copy, campaign?.id ?? null, audienceIds),
    has_booking_link: !!bookingLink,
  };
}

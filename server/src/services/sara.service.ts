import { supabaseAdmin } from '../config/supabase.js';
import { SaraIntent, SaraAction, SaraStatus } from '@lemlist/shared';
import type { SaraClassificationResult, SaraQueueStats } from '@lemlist/shared';
import { fireEvent } from './webhook.service.js';
import { suppressionService } from './suppression.service.js';
import { billingService } from './billing.service.js';

/**
 * SARA - Sincerely Autonomous Reply Agent
 * Classifies reply intent and drafts context-aware responses.
 */

// Intent classification patterns (keyword/phrase-based)
const INTENT_PATTERNS: {
  intent: SaraIntent;
  patterns: RegExp[];
  weight: number;
}[] = [
  {
    intent: SaraIntent.OutOfOffice,
    patterns: [
      /out of (the )?office/i,
      /on (vacation|leave|holiday|pto)/i,
      /auto.?reply/i,
      /automatic reply/i,
      /will (be )?return/i,
      /currently (away|unavailable|traveling)/i,
      /limited access to email/i,
      /away from/i,
    ],
    weight: 0.95,
  },
  {
    intent: SaraIntent.Unsubscribe,
    patterns: [
      /\bunsubscribe\b/i,
      /\bremove me\b/i,
      /\bstop (emailing|contacting|sending)\b/i,
      /\btake me off\b/i,
      /\bdon'?t (contact|email|message) me\b/i,
      /\bopt.?out\b/i,
      /\bnot interested\b.*\b(stop|remove|don't)\b/i,
      /\bdo not (contact|email)\b/i,
      /\bleave me alone\b/i,
      /\bspam\b/i,
    ],
    weight: 0.9,
  },
  {
    intent: SaraIntent.Bounce,
    patterns: [
      /\bmail(box)? (is )?full\b/i,
      /\bundeliverable\b/i,
      /\bno such user\b/i,
      /\baddress (rejected|not found)\b/i,
      /\bpermanent failure\b/i,
      /\bmailer.?daemon\b/i,
      /\b550\b.*\breject/i,
      /\buser unknown\b/i,
    ],
    weight: 0.95,
  },
  {
    intent: SaraIntent.Meeting,
    patterns: [
      /\b(schedule|book|set up) a (call|meeting|demo|chat)\b/i,
      /\blet'?s (talk|meet|chat|connect|hop on)\b/i,
      /\bwhat time(s)? (work|are you|do you)\b/i,
      /\bsend (me )?(your |a )?(calendar|availability|calendly)\b/i,
      /\bfree (this|next) (week|monday|tuesday|wednesday|thursday|friday)\b/i,
      /\bwould love to (chat|talk|discuss|meet|connect)\b/i,
      /\bavailable (for|to)\b/i,
    ],
    weight: 0.85,
  },
  {
    intent: SaraIntent.Interested,
    patterns: [
      /\binterested\b/i,
      /\btell me more\b/i,
      /\bsound(s)? (good|great|interesting)\b/i,
      /\bI'?d (like|love) to (learn|know|hear|see)\b/i,
      /\bsend (me )?(more )?info/i,
      /\bwhat (are|is) (your|the) pricing\b/i,
      /\bhow (does|do) (it|you|this) work\b/i,
      /\bcan you (show|send|share)\b/i,
      /\byes,? please\b/i,
      /\blooks? (good|great|promising|interesting)\b/i,
    ],
    weight: 0.8,
  },
  {
    intent: SaraIntent.Objection,
    patterns: [
      /\bnot (a good|the right) (time|fit)\b/i,
      /\balready (have|use|using)\b/i,
      /\bwe'?re (good|set|covered|all set)\b/i,
      /\bnot (looking|searching|in the market)\b/i,
      /\bno (budget|bandwidth|capacity)\b/i,
      /\btoo (expensive|busy)\b/i,
      /\bmaybe (later|next)\b/i,
      /\bnot (right )?now\b/i,
      /\bwe (don't|do not) need\b/i,
    ],
    weight: 0.75,
  },
  {
    intent: SaraIntent.NotNow,
    patterns: [
      /\b(reach out|follow up|check back) (in|next|later)\b/i,
      /\b(try|contact) (me )?(again )?(in|next)\b/i,
      /\bnot (the right|a good) time\b/i,
      /\bbusy (right now|at the moment|this quarter)\b/i,
      /\bping me (in|next|later)\b/i,
      /\bQ[1-4]\b.*\b(better|good)\b/i,
    ],
    weight: 0.7,
  },
];

// Draft reply templates by intent
const REPLY_TEMPLATES: Record<SaraIntent, string | null> = {
  [SaraIntent.Interested]: `Thanks for your interest! I'd love to share more details about how we can help {{company}}.

Would you be open to a quick 15-minute call this week? I can walk you through everything and answer any questions.

Let me know what works best for you.`,

  [SaraIntent.Meeting]: `Great to hear you'd like to connect!

Here's my calendar link to find a time that works: [CALENDAR_LINK]

Looking forward to speaking with you, {{first_name}}.`,

  [SaraIntent.Objection]: `I completely understand, {{first_name}}. No pressure at all.

If anything changes in the future, feel free to reach out. I'm always happy to help.

Wishing you all the best!`,

  [SaraIntent.NotNow]: `No problem at all, {{first_name}}! I totally understand the timing isn't right.

I'll make a note to follow up with you later. In the meantime, feel free to reach out if anything changes.

Have a great one!`,

  [SaraIntent.Unsubscribe]: null, // No reply needed - auto-unsubscribe
  [SaraIntent.OutOfOffice]: null, // No reply needed - wait
  [SaraIntent.Bounce]: null, // No reply possible
  [SaraIntent.Other]: null, // Needs human review
};

// Map intents to recommended actions
const INTENT_ACTIONS: Record<SaraIntent, SaraAction> = {
  [SaraIntent.Interested]: SaraAction.Reply,
  [SaraIntent.Meeting]: SaraAction.Reply,
  [SaraIntent.Objection]: SaraAction.Reply,
  [SaraIntent.NotNow]: SaraAction.Reply,
  [SaraIntent.Unsubscribe]: SaraAction.Unsubscribe,
  [SaraIntent.OutOfOffice]: SaraAction.Archive,
  [SaraIntent.Bounce]: SaraAction.StopSequence,
  [SaraIntent.Other]: SaraAction.Escalate,
};

/**
 * Classify the intent of a reply message.
 */
export function classifyReply(
  subject: string,
  bodyText: string,
  contactData?: { first_name?: string; company?: string }
): SaraClassificationResult {
  const fullText = `${subject || ''} ${bodyText || ''}`;
  let bestMatch: { intent: SaraIntent; confidence: number; matchCount: number } | null = null;

  for (const rule of INTENT_PATTERNS) {
    let matchCount = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(fullText)) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      // Confidence = base weight * (matched patterns / total patterns), capped at 0.99
      const confidence = Math.min(
        rule.weight * (0.5 + 0.5 * (matchCount / rule.patterns.length)),
        0.99
      );

      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { intent: rule.intent, confidence, matchCount };
      }
    }
  }

  // Default to "other" if no patterns matched
  const intent = bestMatch?.intent ?? SaraIntent.Other;
  const confidence = bestMatch?.confidence ?? 0.3;
  const action = INTENT_ACTIONS[intent];

  // Generate draft reply with merge tag interpolation
  let draftReply = REPLY_TEMPLATES[intent];
  if (draftReply && contactData) {
    draftReply = draftReply
      .replace(/\{\{first_name\}\}/g, contactData.first_name || 'there')
      .replace(/\{\{company\}\}/g, contactData.company || 'your team');
  }

  const reasoning = bestMatch
    ? `Matched ${bestMatch.matchCount} pattern(s) for "${intent}" with ${(confidence * 100).toFixed(0)}% confidence`
    : 'No strong patterns detected - flagged for human review';

  return { intent, confidence, action, draft_reply: draftReply ?? null, reasoning };
}

/**
 * Process a new reply through SARA classification pipeline.
 */
export async function processReply(messageId: string): Promise<SaraClassificationResult> {
  // Fetch the message with context
  const { data: message, error: msgError } = await supabaseAdmin
    .from('inbox_messages')
    .select('*, contacts(first_name, last_name, company, email)')
    .eq('id', messageId)
    .single();

  if (msgError) throw new Error(`Failed to fetch message: ${msgError.message}`);
  if (!message) throw new Error('Message not found');

  // SARA is a paid feature — skip classification/auto-actions when not included.
  if (message.user_id && !(await billingService.hasFeature(message.user_id, 'sara'))) {
    return {
      intent: SaraIntent.Other,
      confidence: 0,
      action: 'none',
      draft_reply: null,
      reasoning: 'SARA is not included in the current plan.',
    };
  }

  const contactData = message.contacts
    ? { first_name: message.contacts.first_name, company: message.contacts.company }
    : undefined;

  // Classify
  const result = classifyReply(
    message.subject || '',
    message.body_text || message.body_html || '',
    contactData
  );

  // Store classification
  await supabaseAdmin
    .from('inbox_messages')
    .update({
      sara_intent: result.intent,
      sara_confidence: result.confidence,
      sara_action: result.action,
      sara_draft_reply: result.draft_reply,
      sara_status: SaraStatus.PendingReview,
    })
    .eq('id', messageId);

  // Fire webhook for classification
  if (message.user_id) {
    fireEvent(message.user_id, 'sara.intent_classified', {
      message_id: messageId,
      intent: result.intent,
      confidence: result.confidence,
      action: result.action,
      contact_id: message.contact_id,
    }).catch(() => {});
  }

  // Auto-execute for high-confidence unsubscribe/bounce
  if (
    (result.intent === SaraIntent.Unsubscribe || result.intent === SaraIntent.Bounce) &&
    result.confidence >= 0.9 &&
    message.contact_id
  ) {
    if (result.intent === SaraIntent.Unsubscribe) {
      await supabaseAdmin
        .from('contacts')
        .update({ is_unsubscribed: true })
        .eq('id', message.contact_id);
      // Add to global suppression list so future campaigns skip this contact
      const contactEmail = message.contacts?.email;
      if (message.user_id && contactEmail) {
        suppressionService.add(message.user_id, contactEmail, 'unsubscribed').catch(() => {});
        fireEvent(message.user_id, 'lead.unsubscribed', { contact_id: message.contact_id, source: 'sara_auto' }).catch(() => {});
      }
    }
    if (result.intent === SaraIntent.Bounce) {
      await supabaseAdmin
        .from('contacts')
        .update({ is_bounced: true })
        .eq('id', message.contact_id);
      const contactEmail = message.contacts?.email;
      if (message.user_id && contactEmail) {
        suppressionService.add(message.user_id, contactEmail, 'bounced').catch(() => {});
        fireEvent(message.user_id, 'email.bounced', { contact_id: message.contact_id, source: 'sara_auto' }).catch(() => {});
      }
    }
    // Stop campaign sequence
    if (message.campaign_contact_id) {
      await supabaseAdmin
        .from('campaign_contacts')
        .update({
          status: result.intent === SaraIntent.Unsubscribe ? 'unsubscribed' : 'bounced',
          completed_at: new Date().toISOString(),
        })
        .eq('id', message.campaign_contact_id);
    }
    // Mark as approved so it no longer appears in the pending review queue
    await supabaseAdmin
      .from('inbox_messages')
      .update({
        sara_status: SaraStatus.Approved,
        sara_reviewed_at: new Date().toISOString(),
      })
      .eq('id', messageId);
  }

  return result;
}

/**
 * Approve a SARA draft reply for sending.
 */
export async function approveReply(
  messageId: string,
  userId: string,
  editedReply?: string
): Promise<void> {
  const update: Record<string, any> = {
    sara_status: SaraStatus.Approved,
    sara_reviewed_at: new Date().toISOString(),
    sara_reviewed_by: userId,
  };
  if (editedReply) {
    update.sara_draft_reply = editedReply;
  }

  await supabaseAdmin
    .from('inbox_messages')
    .update(update)
    .eq('id', messageId);

  fireEvent(userId, 'sara.reply_approved', { message_id: messageId, edited: !!editedReply }).catch(() => {});
}

/**
 * Dismiss a SARA suggestion.
 */
export async function dismissReply(messageId: string, userId: string): Promise<void> {
  await supabaseAdmin
    .from('inbox_messages')
    .update({
      sara_status: SaraStatus.Dismissed,
      sara_reviewed_at: new Date().toISOString(),
      sara_reviewed_by: userId,
    })
    .eq('id', messageId);
}

/**
 * Get SARA queue - messages pending review.
 */
export async function getQueue(
  userId: string,
  filters?: { intent?: string; status?: string; limit?: number; offset?: number }
): Promise<{ messages: any[]; total: number }> {
  let query = supabaseAdmin
    .from('inbox_messages')
    .select('*, contacts(first_name, last_name, email, company), campaigns(name)', { count: 'exact' })
    .eq('user_id', userId)
    .not('sara_intent', 'is', null);

  if (filters?.status) {
    query = query.eq('sara_status', filters.status);
  } else {
    query = query.eq('sara_status', SaraStatus.PendingReview);
  }

  if (filters?.intent) {
    query = query.eq('sara_intent', filters.intent);
  }

  query = query
    .order('sara_confidence', { ascending: false })
    .range(
      filters?.offset || 0,
      (filters?.offset || 0) + (filters?.limit || 20) - 1
    );

  const { data, count } = await query;

  return {
    messages: data || [],
    total: count || 0,
  };
}

/**
 * Get SARA queue statistics.
 */
export async function getQueueStats(userId: string): Promise<SaraQueueStats> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count: pendingReview } = await supabaseAdmin
    .from('inbox_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('sara_status', SaraStatus.PendingReview);

  const { count: approvedToday } = await supabaseAdmin
    .from('inbox_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('sara_status', SaraStatus.Approved)
    .gte('sara_reviewed_at', today.toISOString());

  const { count: dismissedToday } = await supabaseAdmin
    .from('inbox_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('sara_status', SaraStatus.Dismissed)
    .gte('sara_reviewed_at', today.toISOString());

  const { count: sentToday } = await supabaseAdmin
    .from('inbox_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('sara_status', SaraStatus.Sent)
    .gte('sara_reviewed_at', today.toISOString());

  // Top intents
  const { data: intentData } = await supabaseAdmin
    .from('inbox_messages')
    .select('sara_intent')
    .eq('user_id', userId)
    .not('sara_intent', 'is', null);

  const intentCounts: Record<string, number> = {};
  intentData?.forEach((m: any) => {
    intentCounts[m.sara_intent] = (intentCounts[m.sara_intent] || 0) + 1;
  });

  const topIntents = Object.entries(intentCounts)
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    pending_review: pendingReview || 0,
    approved_today: approvedToday || 0,
    dismissed_today: dismissedToday || 0,
    sent_today: sentToday || 0,
    top_intents: topIntents,
  };
}


export interface GenerateEmailInput {
  goal: string;
  tone: string;
  product?: string;
  audience?: string;
  extra?: string;
}

export interface GeneratedEmail {
  subject: string;
  body_html: string;
  body_text: string;
}

export function generateCampaignEmail(input: GenerateEmailInput): GeneratedEmail {
  const { goal, tone, product = 'our solution', audience = 'your team', extra = '' } = input;
  const toneAdj = tone === 'formal' ? 'formal, professional' : tone === 'casual' ? 'casual, friendly' : 'professional yet approachable';

  const goalLower = goal.toLowerCase();

  let subject: string;
  let bodyText: string;

  if (/introduc|intro|outreach|first/i.test(goalLower)) {
    subject = `Quick introduction — ${product}`;
    bodyText = `Hi {{first_name}},

I wanted to reach out briefly to introduce myself and share something that might be relevant for {{company}}.

${product ? `We built ${product} specifically to help ${audience} ${extra || 'save time and get better results'}.` : ''}

I'd love to learn more about your current approach and see if there's a fit. Would you be open to a quick 15-minute call this week?

Looking forward to connecting.

Best regards,
{{sender_name}}`;
  } else if (/follow.?up|check.?in|reconnect/i.test(goalLower)) {
    subject = `Following up — ${product}`;
    bodyText = `Hi {{first_name}},

I wanted to follow up on my previous message in case it got buried.

${extra || `I truly believe ${product} could be valuable for ${audience} at {{company}}.`}

I know your time is valuable, so I'll keep this brief. Would a quick 15-minute call work this week?

Best regards,
{{sender_name}}`;
  } else if (/demo|trial|free|show|see/i.test(goalLower)) {
    subject = `See ${product} in action — free demo for {{company}}`;
    bodyText = `Hi {{first_name}},

I'd love to show you what ${product} can do for {{company}}.

${extra || `In 20 minutes, I can walk you through exactly how ${audience} like yours are using it.`}

Want to pick a time that works for you?

Best regards,
{{sender_name}}`;
  } else if (/problem|pain|challenge|struggle/i.test(goalLower)) {
    subject = `Is this a challenge for {{company}}?`;
    bodyText = `Hi {{first_name}},

A lot of teams I talk to are dealing with ${extra || goal}.

We built ${product} to solve exactly that — and the results have been pretty remarkable.

Would it make sense to share what we're seeing?

Best regards,
{{sender_name}}`;
  } else {
    subject = `${goal} — ${product}`;
    bodyText = `Hi {{first_name}},

${extra || `I'm reaching out because I think ${product} could be a great fit for {{company}}.`}

${goal}

Would you have 15 minutes to connect this week?

Best regards,
{{sender_name}}`;
  }

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.7;color:#1a1a1a;max-width:560px;"><p style="margin:0 0 12px;">${bodyText.replace(/\n\n/g, '</p><p style="margin:0 0 12px;">').replace(/\n/g, '<br/>')}</p></div>`;

  return {
    subject,
    body_html: html,
    body_text: bodyText,
  };
}

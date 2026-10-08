import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { writable } from '../utils/writable-fields.js';
import type {
  EmailTemplate,
  SequenceTemplate,
  CreateEmailTemplateInput,
  UpdateEmailTemplateInput,
  CreateSequenceTemplateInput,
  UpdateSequenceTemplateInput,
  SequenceTemplateStep,
} from '@lemlist/shared';

// ─── Preset Email Templates ─────────────────────────────────────────
//
// Written to the same standard Relay writes to (shared/src/writing.ts):
// one idea per email, the reader's world before ours, one question that
// can be answered in a line, no long dashes and no stock phrases. The
// template check holds every preset to it.

const PRESET_EMAIL_TEMPLATES: Omit<EmailTemplate, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  {
    name: 'The Observation Opener',
    subject: '{{pain_point|this}} at {{company|your company}}',
    body_html: `<p>Hi {{first_name|there}},</p>

<p>Most teams in {{industry|your industry}} don't have a {{pain_point|this}} problem. They have a time problem that shows up as one.</p>

<p>It usually surfaces at the worst point in the quarter, when there's no room left to fix it properly.</p>

<p>We help companies like {{company|your company}} {{value_proposition|grow faster}} without adding headcount to do it.</p>

<p>Is this already sorted at {{company|your company}}, or worth a look?</p>

<p>{{sender_name}}</p>`,
    category: 'cold_outreach',
    tags: ['cold', 'opener', 'personalized'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Value-First',
    subject: 'idea for {{company|your company}}',
    body_html: `<p>Hi {{first_name|there}},</p>

<p>{{pain_point|This}} comes up in almost every {{industry|your industry}} team we speak to, and it rarely gets fixed until it costs a quarter.</p>

<p>We helped a team in a similar spot {{result_achieved|see real results}}. The change was smaller than they expected.</p>

<p>I can send a short breakdown of how it would apply at {{company|your company}}. Want it?</p>

<p>{{sender_name}}</p>`,
    category: 'cold_outreach',
    tags: ['cold', 'value', 'solution'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Second Touch',
    subject: 'Re: {{pain_point|this}} at {{company|your company}}',
    body_html: `<p>Hi {{first_name|there}},</p>

<p>One thing I left out. The cost of {{pain_point|this}} is rarely the money. It's the hours your team spends working around it, every week.</p>

<p>That's the part we take off their plate, so they can {{key_benefit|move faster}}.</p>

<p>Would it help to see how other {{industry|your industry}} teams have set this up?</p>

<p>{{sender_name}}</p>`,
    category: 'follow_up',
    tags: ['follow-up', 'second-touch', 'insight'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Proof',
    subject: 'how {{reference_company|a similar team}} handled it',
    body_html: `<p>Hi {{first_name|there}},</p>

<p>One example, so this is easier to picture.</p>

<p>{{reference_company|A team much like yours}} had the same issue with {{pain_point|this}}. Within {{timeframe|a quarter}}, they {{result_achieved|saw real results}}, without changing how the rest of the team works.</p>

<p>Different setup to yours, I'm sure. Same problem underneath.</p>

<p>Worth 15 minutes to see how it would translate for {{company|your company}}?</p>

<p>{{sender_name}}</p>`,
    category: 'cold_outreach',
    tags: ['social-proof', 'case-study', 'results'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Last Note',
    subject: 'yes or no, {{first_name|there}}',
    body_html: `<p>Hi {{first_name|there}},</p>

<p>Last note from me on this.</p>

<p>Reply YES and I'll send the specifics for {{company|your company}}. Reply NO and I'll close it off on my side.</p>

<p>Either way, I'll know where we stand.</p>

<p>{{sender_name}}</p>`,
    category: 'follow_up',
    tags: ['break-up', 'last-chance', 'closing'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Meeting Request',
    subject: '15 minutes, {{first_name|there}}?',
    body_html: `<p>Hi {{first_name|there}},</p>

<p>Easier to show than explain: how {{company|your company}} could {{key_benefit|move faster}} on {{pain_point|this}}.</p>

<p>Two times that work for me:</p>
<ul>
  <li>{{time_slot_1|Tuesday afternoon}}</li>
  <li>{{time_slot_2|Thursday morning}}</li>
</ul>

<p>Does either suit, or is someone else closer to this?</p>

<p>{{sender_name}}</p>`,
    category: 'meeting_request',
    tags: ['meeting', 'call', 'calendar'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Re-Engagement',
    subject: 'since we last spoke',
    body_html: `<p>Hi {{first_name|there}},</p>

<p>When we last spoke, the timing wasn't right for {{company|your company}}.</p>

<p>Since then we've {{new_feature_or_update|changed how this works}}, which matters given your focus on {{focus_area|the year ahead}}.</p>

<p>Has anything moved on your side, or is it still a no for now?</p>

<p>{{sender_name}}</p>`,
    category: 're_engagement',
    tags: ['re-engage', 'reconnect', 'update'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Warm Introduction',
    subject: '{{mutual_connection|a mutual contact}} suggested I get in touch',
    body_html: `<p>Hi {{first_name|there}},</p>

<p>{{mutual_connection|A mutual contact}} said you're the person to speak to about {{topic|this}} at {{company|your company}}.</p>

<p>We help {{industry|your industry}} teams {{value_proposition|grow faster}}, and they thought it was worth putting us in touch.</p>

<p>Worth 15 minutes next week, or is someone else closer to it?</p>

<p>{{sender_name}}</p>`,
    category: 'introduction',
    tags: ['referral', 'warm', 'introduction'],
    is_preset: true,
    usage_count: 0,
  },
];

// ─── Preset Sequence Templates ──────────────────────────────────────

const PRESET_SEQUENCE_TEMPLATES: Omit<SequenceTemplate, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  {
    name: 'Classic 3-Step Outreach',
    description: 'An observation and a yes-or-no question, a follow-up that names the hidden cost, and a clear last note. A good first campaign.',
    category: 'cold_outreach',
    tags: ['cold', 'proven', 'beginner-friendly'],
    is_preset: true,
    usage_count: 0,
    steps: [
      {
        step_order: 1,
        subject: '{{pain_point|this}} at {{company|your company}}',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>Most {{industry|your industry}} teams don't have a {{pain_point|this}} problem. They have a time problem that shows up as one.</p>

<p>We help companies like {{company|your company}} {{value_proposition|grow faster}} without adding headcount to do it.</p>

<p>Is this already sorted at {{company|your company}}, or worth a look?</p>

<p>{{sender_name}}</p>`,
        delay_days: 0,
        delay_hours: 0,
      },
      {
        step_order: 2,
        subject: 'Re: {{pain_point|this}} at {{company|your company}}',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>The cost of {{pain_point|this}} is rarely the money. It's the hours spent working around it, every week, by people who should be doing something else.</p>

<p>A team similar to {{company|your company}} {{result_achieved|saw real results}} once that time came back.</p>

<p>If someone else owns this at {{company|your company}}, who should I speak to?</p>

<p>{{sender_name}}</p>`,
        delay_days: 3,
        delay_hours: 0,
      },
      {
        step_order: 3,
        subject: 'Re: {{pain_point|this}} at {{company|your company}}',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>Last note from me on this.</p>

<p>Reply YES and I'll send the specifics for {{company|your company}}, or NO and I'll leave it there.</p>

<p>Either way, I'll know where we stand.</p>

<p>{{sender_name}}</p>`,
        delay_days: 5,
        delay_hours: 0,
      },
    ],
  },
  {
    name: '5-Step Cold Campaign',
    description: 'Five emails, each with one job: the reframe, an insight, a question about their setup, one example, and a yes-or-no close.',
    category: 'cold_outreach',
    tags: ['cold', 'comprehensive', 'high-volume'],
    is_preset: true,
    usage_count: 0,
    steps: [
      {
        step_order: 1,
        subject: 'idea for {{company|your company}}',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>Something stood out looking at how {{industry|your industry}} teams handle {{pain_point|this}}.</p>

<p>The problem is rarely effort. It's that nobody can see it coming until the quarter is nearly gone.</p>

<p>We help teams like {{company|your company}} {{value_proposition|grow faster}}. Some use us to fill a gap, others to replace a process outright.</p>

<p>Is this already handled at {{company|your company}}, or worth exploring?</p>

<p>{{sender_name}}</p>`,
        delay_days: 0,
        delay_hours: 0,
      },
      {
        step_order: 2,
        subject: 'Re: idea for {{company|your company}}',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>Working with {{industry|your industry}} teams taught us something early. What people wanted wasn't more of anything. It was knowing what would land, and when.</p>

<p>That's what we built around: so teams can {{key_benefit|move faster}} without guessing.</p>

<p>Would it help to see how other teams in your position set this up?</p>

<p>{{sender_name}}</p>`,
        delay_days: 3,
        delay_hours: 0,
      },
      {
        step_order: 3,
        subject: 'Re: idea for {{company|your company}}',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>One pattern we see as teams grow: {{common_challenge|a slow pipeline}} quietly becomes one of the most expensive things they run. Not because of the obvious cost. Because of the hours around it.</p>

<p>At a certain size, that shouldn't still be happening.</p>

<p>How is {{company|your company}} handling it today?</p>

<p>{{sender_name}}</p>`,
        delay_days: 3,
        delay_hours: 0,
      },
      {
        step_order: 4,
        subject: 'Re: idea for {{company|your company}}',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>One example, so this is easier to picture.</p>

<p>{{reference_company|A team much like yours}} was stuck on {{pain_point|this}}. Within {{timeframe|a quarter}}, they {{result_achieved|saw real results}}, alongside their existing team rather than instead of it.</p>

<p>Different setups. Same problem underneath.</p>

<p>Worth 15 minutes to see how this would translate for {{company|your company}}?</p>

<p>{{sender_name}}</p>`,
        delay_days: 4,
        delay_hours: 0,
      },
      {
        step_order: 5,
        subject: 'Re: idea for {{company|your company}}',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>Final note before I close this off.</p>

<p>By {{focus_area|the end of the quarter}}, most teams know whether {{pain_point|this}} cost them or not. The difference is usually whether they acted early or reacted late.</p>

<p>Reply YES if you want the specifics for {{company|your company}}. Reply NO if you're handling it another way.</p>

<p>Either way, I'll know where we stand.</p>

<p>{{sender_name}}</p>`,
        delay_days: 5,
        delay_hours: 0,
      },
    ],
  },
  {
    name: 'Meeting Booker',
    description: 'Three short emails built to get one call on the calendar: a clear reason, two real times, and a yes-or-no last note.',
    category: 'meeting_request',
    tags: ['meeting', 'direct', 'conversion'],
    is_preset: true,
    usage_count: 0,
    steps: [
      {
        step_order: 1,
        subject: '15 minutes, {{first_name|there}}?',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>Easier to show than explain: how {{company|your company}} could {{key_benefit|move faster}} on {{pain_point|this}}.</p>

<p>Worth 15 minutes this week, or is someone else closer to it?</p>

<p>{{sender_name}}</p>`,
        delay_days: 0,
        delay_hours: 0,
      },
      {
        step_order: 2,
        subject: 'Re: 15 minutes, {{first_name|there}}?',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>To make it easy, two times that work for me:</p>
<ul>
  <li>{{time_slot_1|Tuesday afternoon}}</li>
  <li>{{time_slot_2|Thursday morning}}</li>
</ul>

<p>Does either suit? If not, send me one that does.</p>

<p>{{sender_name}}</p>`,
        delay_days: 2,
        delay_hours: 0,
      },
      {
        step_order: 3,
        subject: 'Re: 15 minutes, {{first_name|there}}?',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>Last one from me.</p>

<p>If now isn't the time, reply LATER and I'll come back next quarter. If it is, reply YES and I'll send a link.</p>

<p>{{sender_name}}</p>`,
        delay_days: 4,
        delay_hours: 0,
      },
    ],
  },
  {
    name: 'Nurture Sequence',
    description: 'Four useful notes for warm leads who are not ready yet: something worth reading, a trend, a quick win, and a straight question.',
    category: 'nurture',
    tags: ['nurture', 'warm', 'long-term'],
    is_preset: true,
    usage_count: 0,
    steps: [
      {
        step_order: 1,
        subject: 'worth reading on {{topic|this}}',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>This {{resource_type|guide}} on {{topic|this}} made one point that applies to {{company|your company}}: {{insight|the fundamentals still win}}.</p>

<p>Useful as you plan {{focus_area|the year ahead}}. Nothing to reply to.</p>

<p>{{sender_name}}</p>`,
        delay_days: 0,
        delay_hours: 0,
      },
      {
        step_order: 2,
        subject: 'what {{industry|your industry}} teams are changing',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>A shift we're seeing in how {{industry|your industry}} teams approach {{topic|this}}: {{trend_insight|the shift is accelerating}}.</p>

<p>Is it showing up at {{company|your company}} yet, or not on the radar?</p>

<p>{{sender_name}}</p>`,
        delay_days: 7,
        delay_hours: 0,
      },
      {
        step_order: 3,
        subject: 'a quick win for {{company|your company}}',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>Something we keep seeing with teams like yours: {{quick_win_insight|small changes compound quickly}}.</p>

<p>It takes an afternoon to try. Want the two-line version of how?</p>

<p>{{sender_name}}</p>`,
        delay_days: 7,
        delay_hours: 0,
      },
      {
        step_order: 4,
        subject: 'still on your list?',
        body_html: `<p>Hi {{first_name|there}},</p>

<p>Straight question: is {{topic|this}} something {{company|your company}} wants to look at this quarter, or later in the year?</p>

<p>Either answer helps me send the right thing.</p>

<p>{{sender_name}}</p>`,
        delay_days: 14,
        delay_hours: 0,
      },
    ],
  },
];

// ─── Service ────────────────────────────────────────────────────────

/**
 * `is_preset` and `usage_count` are the platform's to set — a template that
 * could mark itself a built-in preset would appear in every account's starter
 * library, and a self-incremented usage count would sort itself to the top.
 */
const EMAIL_TEMPLATE_FIELDS = ['name', 'subject', 'body_html', 'body_text', 'category', 'tags'] as const;
const SEQUENCE_TEMPLATE_FIELDS = ['name', 'description', 'category', 'steps', 'tags'] as const;

export const templateService = {
  // Email Templates
  async listEmailTemplates(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('email_templates')
      .select('*')
      .or(`user_id.eq.${userId},is_preset.eq.true`)
      .order('is_preset', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async getEmailTemplate(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('email_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Template not found', 404);
    // Not found, rather than forbidden: a 403 confirms the id exists in
    // somebody else's account.
    if (!data.is_preset && data.user_id !== userId) throw new AppError('Template not found', 404);
    return data;
  },

  async createEmailTemplate(userId: string, input: CreateEmailTemplateInput) {
    const { data, error } = await supabaseAdmin
      .from('email_templates')
      .insert({
        user_id: userId,
        name: input.name,
        subject: input.subject,
        body_html: input.body_html,
        // Allowed on update and read by everything that uses a template, but
        // dropped on create, so a new template's plain-text part was empty.
        body_text: (input as any).body_text ?? null,
        category: input.category || 'custom',
        tags: input.tags || [],
      })
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async updateEmailTemplate(userId: string, id: string, input: UpdateEmailTemplateInput) {
    const { data, error } = await supabaseAdmin
      .from('email_templates')
      .update({ ...writable(input, EMAIL_TEMPLATE_FIELDS), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Template not found', 404);
    return data;
  },

  async deleteEmailTemplate(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('email_templates')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
  },

  async duplicateEmailTemplate(userId: string, id: string) {
    const original = await this.getEmailTemplate(userId, id);
    return this.createEmailTemplate(userId, {
      name: `${original.name} (Copy)`,
      subject: original.subject,
      body_html: original.body_html,
      category: original.category,
      tags: original.tags,
    });
  },

  /**
   * Bump a template's usage counter.
   *
   * Takes the owner because it writes. It did not, and nothing called it, so
   * it was harmless - but an unscoped update sitting in a service is a leak
   * waiting for its first caller, and the next person to wire it up has no
   * reason to suspect it. Two cross-tenant holes were found by hand in this
   * codebase in a fortnight; this is the shape both of them had.
   */
  async incrementEmailUsage(userId: string, id: string) {
    try {
      const { data } = await supabaseAdmin
        .from('email_templates')
        .select('usage_count')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (data) {
        await supabaseAdmin
          .from('email_templates')
          .update({ usage_count: (data.usage_count || 0) + 1 })
          .eq('id', id)
          .eq('user_id', userId);
      }
    } catch { /* non-critical */ }
  },

  // Sequence Templates
  async listSequenceTemplates(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('sequence_templates')
      .select('*')
      .or(`user_id.eq.${userId},is_preset.eq.true`)
      .order('is_preset', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw new AppError(error.message, 500);
    return data || [];
  },

  async getSequenceTemplate(userId: string, id: string) {
    const { data, error } = await supabaseAdmin
      .from('sequence_templates')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Sequence not found', 404);
    if (!data.is_preset && data.user_id !== userId) throw new AppError('Sequence not found', 404);
    return data;
  },

  async createSequenceTemplate(userId: string, input: CreateSequenceTemplateInput) {
    const { data, error } = await supabaseAdmin
      .from('sequence_templates')
      .insert({
        user_id: userId,
        name: input.name,
        description: input.description,
        category: input.category || 'custom',
        steps: input.steps,
        tags: input.tags || [],
      })
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    return data;
  },

  async updateSequenceTemplate(userId: string, id: string, input: UpdateSequenceTemplateInput) {
    const { data, error } = await supabaseAdmin
      .from('sequence_templates')
      .update({ ...writable(input, SEQUENCE_TEMPLATE_FIELDS), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Sequence not found', 404);
    return data;
  },

  async deleteSequenceTemplate(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('sequence_templates')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new AppError(error.message, 500);
  },

  async duplicateSequenceTemplate(userId: string, id: string) {
    const original = await this.getSequenceTemplate(userId, id);
    return this.createSequenceTemplate(userId, {
      name: `${original.name} (Copy)`,
      description: original.description,
      category: original.category,
      steps: original.steps,
      tags: original.tags,
    });
  },

  // Presets
  getPresetEmailTemplates() {
    return PRESET_EMAIL_TEMPLATES;
  },

  getPresetSequenceTemplates() {
    return PRESET_SEQUENCE_TEMPLATES;
  },
};

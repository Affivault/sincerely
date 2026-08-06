import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
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

const PRESET_EMAIL_TEMPLATES: Omit<EmailTemplate, 'id' | 'user_id' | 'created_at' | 'updated_at'>[] = [
  {
    name: 'The Warm Opener',
    subject: 'Quick question about {{company}}',
    body_html: `<p>Hi {{first_name}},</p>

<p>I came across {{company}} and was genuinely impressed by what you're building. The way you're approaching {{industry}} is refreshing.</p>

<p>I'm reaching out because we help companies like yours {{value_proposition}}. I think there might be a natural fit here.</p>

<p>Would you be open to a quick 15-minute chat this week to explore if we can help?</p>

<p>Either way, keep up the great work.</p>

<p>Best,<br>{{sender_name}}</p>`,
    category: 'cold_outreach',
    tags: ['cold', 'opener', 'personalized'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Value-First',
    subject: 'Idea to help {{company}} with {{pain_point}}',
    body_html: `<p>Hi {{first_name}},</p>

<p>I noticed {{company}} might be dealing with {{pain_point}} — it's something we see a lot in {{industry}}.</p>

<p>We recently helped a similar company {{result_achieved}}, and I thought the same approach could work for you.</p>

<p>I put together a quick breakdown of how it'd apply to your situation. Worth a look?</p>

<p>Happy to walk through it if you're interested.</p>

<p>Cheers,<br>{{sender_name}}</p>`,
    category: 'cold_outreach',
    tags: ['cold', 'value', 'solution'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Gentle Follow-Up',
    subject: 'Re: Quick question about {{company}}',
    body_html: `<p>Hi {{first_name}},</p>

<p>Just floating this back to the top of your inbox — I know things get buried.</p>

<p>I'd love to show you how we've helped teams like yours {{key_benefit}}. It typically takes about 15 minutes and there's zero commitment.</p>

<p>Would any time this week work for a quick call?</p>

<p>Best,<br>{{sender_name}}</p>`,
    category: 'follow_up',
    tags: ['follow-up', 'gentle', 'second-touch'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Social Proof',
    subject: 'How {{reference_company}} solved {{pain_point}}',
    body_html: `<p>Hi {{first_name}},</p>

<p>I wanted to share a quick story that might resonate.</p>

<p>{{reference_company}} was facing the exact same challenge — {{pain_point}}. Within {{timeframe}}, they were able to {{result_achieved}}.</p>

<p>Here's the interesting part: the fix was simpler than they expected.</p>

<p>I think we could replicate something similar for {{company}}. Open to hearing how?</p>

<p>{{sender_name}}</p>`,
    category: 'cold_outreach',
    tags: ['social-proof', 'case-study', 'results'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Break-Up Email',
    subject: 'Closing the loop',
    body_html: `<p>Hi {{first_name}},</p>

<p>I've reached out a couple of times and haven't heard back — totally understand, you're busy.</p>

<p>I'll take the hint and won't follow up again. But if {{pain_point}} ever becomes a priority, I'm just a reply away.</p>

<p>Wishing you and the {{company}} team all the best.</p>

<p>{{sender_name}}</p>`,
    category: 'follow_up',
    tags: ['break-up', 'last-chance', 'closing'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Meeting Request',
    subject: '{{first_name}}, quick sync?',
    body_html: `<p>Hi {{first_name}},</p>

<p>I have an idea that could help {{company}} {{key_benefit}} — but I'd rather show than tell.</p>

<p>Are you free for a quick 15-minute call this week? I promise to keep it focused and valuable.</p>

<p>Here are a couple of times that work on my end:</p>
<ul>
  <li>{{time_slot_1}}</li>
  <li>{{time_slot_2}}</li>
</ul>

<p>If those don't work, feel free to suggest a time that does.</p>

<p>Looking forward to it,<br>{{sender_name}}</p>`,
    category: 'meeting_request',
    tags: ['meeting', 'call', 'calendar'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Re-Engagement',
    subject: 'It\'s been a while, {{first_name}}',
    body_html: `<p>Hi {{first_name}},</p>

<p>It's been a while since we last connected, and a lot has changed on our end.</p>

<p>We've recently {{new_feature_or_update}} which I think would be really relevant for {{company}} given your focus on {{focus_area}}.</p>

<p>Would love to catch up and see if there's a fit now. Are you open to reconnecting?</p>

<p>Best,<br>{{sender_name}}</p>`,
    category: 're_engagement',
    tags: ['re-engage', 'reconnect', 'update'],
    is_preset: true,
    usage_count: 0,
  },
  {
    name: 'The Warm Introduction',
    subject: '{{mutual_connection}} suggested I reach out',
    body_html: `<p>Hi {{first_name}},</p>

<p>{{mutual_connection}} mentioned you'd be the right person to talk to about {{topic}}.</p>

<p>We've been helping companies in {{industry}} with {{value_proposition}}, and they thought there might be some synergy worth exploring.</p>

<p>Would you be open to a quick chat? I'd love to learn more about what you're working on at {{company}}.</p>

<p>Thanks,<br>{{sender_name}}</p>`,
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
    description: 'The proven cold outreach formula: personalized intro, value follow-up, and a respectful break-up. Perfect for first-time campaigns.',
    category: 'cold_outreach',
    tags: ['cold', 'proven', 'beginner-friendly'],
    is_preset: true,
    usage_count: 0,
    steps: [
      {
        step_order: 1,
        subject: 'Quick question about {{company}}',
        body_html: `<p>Hi {{first_name}},</p>

<p>I came across {{company}} and was impressed by what you're building in {{industry}}.</p>

<p>We help companies like yours {{value_proposition}}, and I think there's a great fit here.</p>

<p>Would you be open to a quick 15-minute chat this week?</p>

<p>Best,<br>{{sender_name}}</p>`,
        delay_days: 0,
        delay_hours: 0,
      },
      {
        step_order: 2,
        subject: 'Re: Quick question about {{company}}',
        body_html: `<p>Hi {{first_name}},</p>

<p>Just following up on my previous note. I know your inbox is probably packed.</p>

<p>Here's why I think this is worth 15 minutes: we recently helped a company similar to {{company}} achieve {{result_achieved}}.</p>

<p>Happy to share the details if you're curious.</p>

<p>{{sender_name}}</p>`,
        delay_days: 3,
        delay_hours: 0,
      },
      {
        step_order: 3,
        subject: 'Closing the loop, {{first_name}}',
        body_html: `<p>Hi {{first_name}},</p>

<p>I'll keep this short — I've reached out a couple of times and don't want to be a pest.</p>

<p>If the timing isn't right, no worries at all. But if {{pain_point}} ever becomes a priority, I'm just a reply away.</p>

<p>All the best to you and the team at {{company}}.</p>

<p>{{sender_name}}</p>`,
        delay_days: 5,
        delay_hours: 0,
      },
    ],
  },
  {
    name: '5-Step Cold Campaign',
    description: 'Comprehensive cold outreach with multiple angles: opener, value, social proof, question, and break-up. Higher reply rates through persistence.',
    category: 'cold_outreach',
    tags: ['cold', 'comprehensive', 'high-volume'],
    is_preset: true,
    usage_count: 0,
    steps: [
      {
        step_order: 1,
        subject: 'Idea for {{company}}',
        body_html: `<p>Hi {{first_name}},</p>

<p>I've been following {{company}}'s growth and had an idea I think could help you {{key_benefit}}.</p>

<p>We specialize in {{value_proposition}} and have helped similar companies in {{industry}} see real results.</p>

<p>Worth a quick conversation?</p>

<p>{{sender_name}}</p>`,
        delay_days: 0,
        delay_hours: 0,
      },
      {
        step_order: 2,
        subject: 'Re: Idea for {{company}}',
        body_html: `<p>Hi {{first_name}},</p>

<p>Wanted to share something specific — {{reference_company}} was in a similar position to {{company}} not long ago.</p>

<p>They were struggling with {{pain_point}}, and within {{timeframe}} of working together, they {{result_achieved}}.</p>

<p>I'd love to show you how we could do the same for your team.</p>

<p>{{sender_name}}</p>`,
        delay_days: 2,
        delay_hours: 0,
      },
      {
        step_order: 3,
        subject: 'Quick thought, {{first_name}}',
        body_html: `<p>Hi {{first_name}},</p>

<p>One thing I keep hearing from {{industry}} leaders is that {{common_challenge}} is eating into their growth.</p>

<p>Is that something you're experiencing at {{company}} too, or have you found a way around it?</p>

<p>Genuinely curious to hear your perspective.</p>

<p>{{sender_name}}</p>`,
        delay_days: 3,
        delay_hours: 0,
      },
      {
        step_order: 4,
        subject: '{{first_name}}, one more thing',
        body_html: `<p>Hi {{first_name}},</p>

<p>I realize I might be catching you at a busy time, so I'll keep this brief.</p>

<p>If there's someone else on your team who handles {{topic}}, I'd be happy to connect with them instead. Just point me in the right direction.</p>

<p>Either way, I appreciate your time.</p>

<p>{{sender_name}}</p>`,
        delay_days: 4,
        delay_hours: 0,
      },
      {
        step_order: 5,
        subject: 'Last note from me',
        body_html: `<p>Hi {{first_name}},</p>

<p>This will be my last email — I don't want to overstay my welcome in your inbox.</p>

<p>If there's ever a time when {{value_proposition}} becomes a priority for {{company}}, my door is always open.</p>

<p>Wishing you and the team continued success.</p>

<p>{{sender_name}}</p>`,
        delay_days: 7,
        delay_hours: 0,
      },
    ],
  },
  {
    name: 'Meeting Booker',
    description: 'Focused 3-step sequence designed to get a meeting on the calendar. Direct, respectful, and conversion-optimized.',
    category: 'meeting_request',
    tags: ['meeting', 'direct', 'conversion'],
    is_preset: true,
    usage_count: 0,
    steps: [
      {
        step_order: 1,
        subject: '{{first_name}}, 15 minutes?',
        body_html: `<p>Hi {{first_name}},</p>

<p>I have something I think could genuinely help {{company}} — but I'd rather show than tell.</p>

<p>Would you be open to a quick 15-minute call? I promise to keep it focused.</p>

<p>I'm flexible this week — just let me know what works best for you.</p>

<p>{{sender_name}}</p>`,
        delay_days: 0,
        delay_hours: 0,
      },
      {
        step_order: 2,
        subject: 'Re: {{first_name}}, 15 minutes?',
        body_html: `<p>Hi {{first_name}},</p>

<p>Following up — I know scheduling can be tricky.</p>

<p>Here are a couple of specific times that work on my end:</p>
<ul>
  <li>{{time_slot_1}}</li>
  <li>{{time_slot_2}}</li>
</ul>

<p>If those don't work, feel free to grab any time that suits you. What matters is finding 15 minutes that work for both of us.</p>

<p>{{sender_name}}</p>`,
        delay_days: 2,
        delay_hours: 0,
      },
      {
        step_order: 3,
        subject: 'Last shot — {{company}} + {{sender_company}}',
        body_html: `<p>Hi {{first_name}},</p>

<p>I'll be brief: I genuinely believe there's a compelling opportunity for {{company}} here.</p>

<p>If now isn't the right time, just say the word and I'll follow up in a few months instead.</p>

<p>If it is the right time — let's find 15 minutes. I think you'll be glad we connected.</p>

<p>{{sender_name}}</p>`,
        delay_days: 4,
        delay_hours: 0,
      },
    ],
  },
  {
    name: 'Nurture Sequence',
    description: 'Gentle 4-step nurture for warm leads who aren\'t ready to buy yet. Keeps you top-of-mind with value-driven touchpoints.',
    category: 'nurture',
    tags: ['nurture', 'warm', 'long-term'],
    is_preset: true,
    usage_count: 0,
    steps: [
      {
        step_order: 1,
        subject: 'Thought you\'d find this useful, {{first_name}}',
        body_html: `<p>Hi {{first_name}},</p>

<p>I came across this {{resource_type}} on {{topic}} and immediately thought of you and the work you're doing at {{company}}.</p>

<p>Here's the key takeaway: {{insight}}</p>

<p>Thought it might be helpful as you think about {{focus_area}}. No strings attached — just sharing something valuable.</p>

<p>{{sender_name}}</p>`,
        delay_days: 0,
        delay_hours: 0,
      },
      {
        step_order: 2,
        subject: '{{industry}} trend worth watching',
        body_html: `<p>Hi {{first_name}},</p>

<p>Quick heads up — we're seeing a major shift in how {{industry}} companies are approaching {{topic}}.</p>

<p>The companies getting ahead are {{trend_insight}}. Figured this would be on your radar at {{company}}.</p>

<p>Happy to chat about what we're seeing if it's useful.</p>

<p>{{sender_name}}</p>`,
        delay_days: 7,
        delay_hours: 0,
      },
      {
        step_order: 3,
        subject: 'Quick win for {{company}}',
        body_html: `<p>Hi {{first_name}},</p>

<p>One thing we've noticed working with teams like yours: {{quick_win_insight}}.</p>

<p>It's a small change that tends to have an outsized impact. Thought it might be worth trying at {{company}}.</p>

<p>Let me know if you'd like to dig deeper into this.</p>

<p>{{sender_name}}</p>`,
        delay_days: 7,
        delay_hours: 0,
      },
      {
        step_order: 4,
        subject: 'Checking in, {{first_name}}',
        body_html: `<p>Hi {{first_name}},</p>

<p>It's been a few weeks since I last reached out. Hope things are going well at {{company}}.</p>

<p>I wanted to check in and see if any of the things I shared were helpful, or if there's anything specific I can help with.</p>

<p>No pressure — just here if you need anything.</p>

<p>{{sender_name}}</p>`,
        delay_days: 14,
        delay_hours: 0,
      },
    ],
  },
];

// ─── Service ────────────────────────────────────────────────────────

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
    if (!data.is_preset && data.user_id !== userId) throw new AppError('Unauthorized', 403);
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
      .update({ ...input, updated_at: new Date().toISOString() })
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

  async incrementEmailUsage(id: string) {
    try {
      const { data } = await supabaseAdmin
        .from('email_templates')
        .select('usage_count')
        .eq('id', id)
        .single();
      if (data) {
        await supabaseAdmin
          .from('email_templates')
          .update({ usage_count: (data.usage_count || 0) + 1 })
          .eq('id', id);
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
    if (!data.is_preset && data.user_id !== userId) throw new AppError('Unauthorized', 403);
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
      .update({ ...input, updated_at: new Date().toISOString() })
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

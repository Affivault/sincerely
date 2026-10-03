/* ═══════════════════════════════════════════════════════════════════════
   The launch review's look at what is being sent.

   shared/content-check reads the emails; this turns its findings into one
   row of the launch review, and applies the suggested rewrites when the
   row's "Apply" button is pressed. A warning at most: the copy is the
   sender's decision, so it is asked about once and never refused.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { checkEmailContent, applyContentFixes, type ReadinessCheck, type ContentIssue } from '@lemlist/shared';

async function emailSteps(userId: string, campaignId: string) {
  const { data: campaign } = await supabaseAdmin.from('campaigns').select('id').eq('id', campaignId).eq('user_id', userId).maybeSingle();
  if (!campaign) return null;
  const { data: steps } = await supabaseAdmin
    .from('campaign_steps')
    .select('id, step_order, step_type, subject, body_html, body_text')
    .eq('campaign_id', campaignId)
    .order('step_order', { ascending: true });
  return steps || [];
}

function domainsOf(accounts: Array<{ email_address?: string | null; is_active?: boolean }>): string[] {
  return [...new Set(accounts.filter((a) => a.is_active !== false).map((a) => String(a.email_address || '').split('@')[1]).filter(Boolean))];
}

export async function contentIssues(userId: string, campaignId: string, accounts?: any[], tracking?: any): Promise<ContentIssue[] | null> {
  const steps = await emailSteps(userId, campaignId);
  if (!steps) return null;
  let boxes = accounts;
  if (!boxes) {
    const { data } = await supabaseAdmin.from('smtp_accounts').select('email_address, is_active').eq('user_id', userId);
    boxes = data || [];
  }
  return checkEmailContent(steps as any, {
    sendingDomains: domainsOf(boxes),
    trackingDomain: tracking?.verified ? tracking.domain : null,
  });
}

export async function contentCheck(userId: string, campaignId: string, accounts: any[], tracking: any): Promise<ReadinessCheck | null> {
  const issues = await contentIssues(userId, campaignId, accounts, tracking);
  if (!issues) return null;
  const href = `/campaigns/${campaignId}/edit`;
  if (issues.length === 0) {
    return {
      id: 'content', group: 'content', label: 'Email content', status: 'pass',
      headline: 'Nothing in the emails looks like spam to a filter.',
      detail: null, fix: null, facts: [],
    };
  }
  const fixable = issues.filter((i) => i.replace).length;
  return {
    id: 'content', group: 'content', label: 'Email content', status: 'warn',
    headline: `${issues.length} thing${issues.length === 1 ? '' : 's'} in the emails ${issues.length === 1 ? 'reads' : 'read'} like spam to filters.`,
    detail: fixable
      ? `${fixable} can be rewritten in plain words in one click; the rest are worth a look in the editor.`
      : 'Worth a look in the editor before it goes to everyone.',
    fix: fixable
      ? { label: `Apply ${fixable} rewrite${fixable === 1 ? '' : 's'}`, href, inline: 'apply_content_fixes', target: campaignId }
      : { label: 'Edit emails', href },
    facts: [],
    items: issues.map((i) => `${i.email ? `Email ${i.email}: ` : ''}${i.message}`),
  };
}

/** Apply every suggested rewrite to the campaign's emails. */
export async function applyContentRewrites(userId: string, campaignId: string): Promise<{ changed: number; steps: number }> {
  const steps = await emailSteps(userId, campaignId);
  if (!steps) throw new AppError('Campaign not found', 404);
  const issues = await contentIssues(userId, campaignId);
  const fixes = (issues || []).filter((i) => i.replace).map((i) => ({ email: i.email, ...i.replace! }));
  if (!fixes.length) return { changed: 0, steps: 0 };

  const emails = (steps as any[]).filter((s) => (s.step_type || 'email') === 'email');
  let touched = 0;
  for (const [idx, step] of emails.entries()) {
    const mine = fixes.filter((f) => f.email === idx + 1);
    if (!mine.length) continue;
    const next = applyContentFixes(step, mine);
    if (next.subject === step.subject && next.body_html === step.body_html && next.body_text === step.body_text) continue;
    const { error } = await supabaseAdmin
      .from('campaign_steps')
      .update({ subject: next.subject, body_html: next.body_html, body_text: next.body_text, updated_at: new Date().toISOString() })
      .eq('id', step.id)
      .eq('campaign_id', campaignId);
    if (error) throw new AppError(error.message, 500);
    touched++;
  }
  return { changed: fixes.length, steps: touched };
}

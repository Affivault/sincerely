/* ═══════════════════════════════════════════════════════════════════════
   Relay writes the sequence.

   "Build a sequence" is the step people stall on: a blank editor, three
   emails to write, and no idea what a good first line for a partnerships
   inbox at an investment platform looks like. So Relay drafts it from
   what you sell and who is on the list, and - when Claude is available -
   writes one opening line per lead, stored on the lead as {{first_line}}.

   Everything comes back as an editable draft in the builder. Nothing is
   sent, and nothing is saved to a campaign until you save it.

   Without Claude there is still a sequence: a plain, sensible three-step
   structure built from your own description of what you sell.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { escapeHtml } from '../utils/html.js';
import { settingsService } from './settings.service.js';
import { listsService } from './lists.service.js';
import { aiAvailable, firstLines, writeSequence } from './ai.service.js';

export interface WriteSequenceInput {
  list_id?: string | null;
  contact_ids?: string[];
  offer?: string;
  audience?: string;
  goal?: string;
  tone?: 'friendly' | 'direct' | 'formal';
  steps?: number;
  personalize?: boolean;
}

export interface WrittenStep {
  delay_days: number;
  subject: string;
  body_html: string;
  body_text: string;
}

/** Shown where no first line could honestly be written for a lead. */
const FIRST_LINE_FALLBACK = 'Came across your team and had a quick idea worth sharing.';

function toHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Merge tags survive escaping; {{first_line}} always carries a fallback. */
function finishBody(text: string): string {
  return text.replace(/\{\{\s*first_line\s*\}\}/g, `{{first_line|${FIRST_LINE_FALLBACK}}}`);
}

function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/s.exec(text.trim());
  return (m ? m[1] : text.trim()).replace(/\s+/g, ' ');
}

/** A sequence without Claude: short, honest, built from the user's own words. */
function templateSequence(offer: string, steps: number, usesFirstLines: boolean, sender: string | null): { name: string; steps: Array<{ delay_days: number; subject: string; body: string }>; rationale: string } {
  const pitch = firstSentence(offer);
  const rest = offer.trim().slice(pitch.length).trim();
  const sign = sender ? `\n\n${sender}` : '';
  const opener = usesFirstLines ? '{{first_line}}\n\n' : '';
  const all = [
    {
      delay_days: 0,
      subject: 'quick question',
      body: `Hi {{first_name|there}},\n\n${opener}${pitch}\n\nWould it be worth a short call to see whether it fits {{company|your team}}?${sign}`,
    },
    {
      delay_days: 3,
      subject: '',
      body: `Hi {{first_name|there}},\n\n${rest ? firstSentence(rest) : 'One thing I should have said: it takes about ten minutes to see whether this is a fit.'}\n\nIf someone else looks after this at {{company|your team}}, I would be grateful for a pointer.${sign}`,
    },
    {
      delay_days: 4,
      subject: '',
      body: `Hi {{first_name|there}},\n\nI will leave it here so I am not cluttering your inbox. If it is ever useful, just reply to this and I will pick it up.${sign}`,
    },
    {
      delay_days: 5,
      subject: '',
      body: `Hi {{first_name|there}},\n\nLast note from me. Thanks for reading - happy to help whenever the timing is better.${sign}`,
    },
  ];
  return {
    name: `Outreach - ${pitch.slice(0, 40)}`,
    steps: all.slice(0, Math.max(1, Math.min(4, steps))),
    rationale: 'A plain three-part structure from your description: the offer, a useful follow-up that asks for the right person, and a polite close.',
  };
}

export const sequenceWriterService = {
  async write(userId: string, input: WriteSequenceInput) {
    const settings: any = await settingsService.get(userId);
    const offer = String(input.offer ?? settings.relay_offer ?? '').trim();
    if (offer.length < 20) {
      throw new AppError('Tell Relay what you sell in a sentence or two - who it is for and what it does for them.', 400);
    }
    // First time it is given, it becomes the saved description.
    if (input.offer && !String(settings.relay_offer || '').trim()) {
      await settingsService.update(userId, { relay_offer: offer } as any).catch(() => {});
    }
    const tone = input.tone || settings.relay_tone || 'friendly';
    const stepCount = Math.max(1, Math.min(5, Number(input.steps) || 3));

    // Who it is going to.
    let ids: string[] = Array.isArray(input.contact_ids) ? input.contact_ids.filter((x) => typeof x === 'string').slice(0, 2000) : [];
    if (input.list_id) ids = [...new Set([...ids, ...(await listsService.getContactsInList(userId, input.list_id))])];
    const leads: any[] = [];
    for (let i = 0; i < ids.length && leads.length < 500; i += 200) {
      const { data } = await supabaseAdmin
        .from('contacts')
        .select('id, first_name, last_name, company, job_title, website, email, is_role_address, custom_fields')
        .eq('user_id', userId)
        .in('id', ids.slice(i, i + 200));
      leads.push(...(data || []));
    }

    const { data: account } = await supabaseAdmin
      .from('smtp_accounts').select('from_name, label').eq('user_id', userId).eq('is_active', true)
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    const sender = String((account as any)?.from_name || '').trim().split(/\s+/)[0] || null;

    const ai = aiAvailable();
    const personalize = !!input.personalize && ai && leads.length > 0;
    const written = ai
      ? await writeSequence({
        offer,
        audience: String(input.audience || '').slice(0, 500),
        goal: String(input.goal || '').slice(0, 300),
        tone,
        steps: stepCount,
        sampleLeads: leads.slice(0, 15).map((l) => ({ company: l.company, title: l.job_title, email: l.email, role_inbox: !!l.is_role_address })),
        senderFirstName: sender,
        usesFirstLines: personalize,
      })
      : null;
    const seq = written ?? templateSequence(offer, stepCount, false, sender);

    // One opening line per lead, stored where {{first_line}} finds it.
    let personalized = 0;
    if (personalize && written) {
      const batch = leads.slice(0, 200);
      for (let i = 0; i < batch.length; i += 25) {
        const slice = batch.slice(i, i + 25);
        const lines = await firstLines({
          offer, tone,
          leads: slice.map((l) => ({ id: l.id, first_name: l.first_name, company: l.company, title: l.job_title, website: l.website, email: l.email })),
        });
        if (!lines) break;
        for (const l of slice) {
          const line = lines[l.id];
          if (!line) continue;
          const custom = { ...(l.custom_fields && typeof l.custom_fields === 'object' ? l.custom_fields : {}), first_line: line };
          const { error } = await supabaseAdmin.from('contacts').update({ custom_fields: custom }).eq('id', l.id).eq('user_id', userId);
          if (!error) personalized++;
        }
      }
    }

    // The sender does not thread by Message-ID, so a blank follow-up subject
    // would go out blank. "Re: <first subject>" is what keeps it reading as
    // the same conversation in the recipient's inbox.
    const opening = (seq.steps[0]?.subject || 'quick question').trim();
    const steps: WrittenStep[] = seq.steps.map((s, i) => {
      const body = finishBody(s.body);
      const subject = i === 0 ? opening : (s.subject?.trim() || `Re: ${opening}`);
      return { delay_days: s.delay_days, subject, body_text: body, body_html: toHtml(body) };
    });

    return {
      name: seq.name,
      rationale: seq.rationale,
      engine: written ? 'ai' as const : 'template' as const,
      steps,
      leads: leads.length,
      personalized,
      personalize_requested: !!input.personalize,
    };
  },
};

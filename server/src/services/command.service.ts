/* ═══════════════════════════════════════════════════════════════════════
   What the command bar can do beyond finding things.

   Parsed on the client (shared/command-intent.ts), carried out here, where
   ownership is checked the same way as everywhere else: every lookup is
   scoped to the caller.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { campaignContactsService } from './campaign-contacts.service.js';
import { contactsService } from './contacts.service.js';

const LIVE = ['draft', 'scheduled', 'running', 'paused'];

/** "add jane@acme.com to Q4 outbound": find the campaign by name, the person by address. */
export async function enrollByName(userId: string, email: string, campaignName: string) {
  const address = String(email || '').trim().toLowerCase();
  const name = String(campaignName || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new AppError('That is not an email address.', 400);
  if (!name) throw new AppError('Which campaign?', 400);

  const { data: campaigns, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, name, status')
    .eq('user_id', userId)
    .in('status', LIVE)
    .ilike('name', `%${name.replace(/[%_]/g, '')}%`)
    .limit(10);
  if (error) throw new AppError(error.message, 500);
  const exact = (campaigns || []).filter((c: any) => c.name.trim().toLowerCase() === name.toLowerCase());
  const pick = exact.length === 1 ? exact[0] : (campaigns || []).length === 1 ? campaigns![0] : null;
  if (!pick) {
    if (!campaigns || campaigns.length === 0) throw new AppError(`No live campaign called "${name}".`, 404);
    throw new AppError(`More than one campaign matches "${name}": ${campaigns.map((c: any) => c.name).join(', ')}. Type more of the name.`, 409);
  }

  let { data: contact } = await supabaseAdmin
    .from('contacts').select('id').eq('user_id', userId).eq('email', address).maybeSingle();
  let created = false;
  if (!contact) {
    contact = await contactsService.create(userId, { email: address });
    created = true;
  }
  const result = await campaignContactsService.add(pick.id, [contact!.id]);
  return { campaign: { id: pick.id, name: pick.name }, contact_id: contact!.id, created_contact: created, result };
}

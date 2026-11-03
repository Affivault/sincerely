/* ═══════════════════════════════════════════════════════════════════════
   The company behind {{company_size}}, {{company_industry}} and friends.

   Those tags read the contact's company record, which is not loaded with
   the contact. It is fetched here, and only when the copy actually uses
   one of them, so a sequence that never mentions the company costs no
   extra query per email. Never throws: a missing record renders the tag
   blank (or its fallback), the same as any other empty field.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { usesCompanyTags } from '@lemlist/shared';

export async function withCompanyRecord<T extends Record<string, any>>(
  userId: string | null | undefined,
  contact: T | null | undefined,
  ...texts: Array<string | null | undefined>
): Promise<T | null | undefined> {
  if (!contact || !userId || contact.company_rec || !contact.company_id) return contact;
  if (!usesCompanyTags(...texts)) return contact;
  try {
    let { data, error } = await supabaseAdmin
      .from('companies')
      .select('size, industry, location, phone, linkedin_url, website')
      .eq('id', contact.company_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error && /phone/.test(error.message || '')) {
      // companies.phone arrives with migration 109.
      ({ data, error } = await supabaseAdmin
        .from('companies')
        .select('size, industry, location, linkedin_url, website')
        .eq('id', contact.company_id)
        .eq('user_id', userId)
        .maybeSingle() as any);
    }
    if (error || !data) return contact;
    return { ...contact, company_rec: data };
  } catch {
    return contact;
  }
}

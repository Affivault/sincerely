import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';

const PAGE_SIZE = 1000;

// Supabase caps a single select at ~1000 rows (see lists.service.ts's
// getContactsInList / segments.service.ts's fetchAllContactIds), so any
// query here that can grow past that — campaigns assigned to folders,
// campaign_activities rows for a folder's analytics — must page through
// the full result or silently under-report.
async function fetchAllRows<T = any>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new AppError(error.message, 500);
    const chunk: T[] = data || [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
  }
  return rows;
}

export const campaignFoldersService = {
  async list(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('campaign_folders')
      .select('*')
      .eq('user_id', userId)
      .order('position', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw new AppError(error.message, 500);

    const folders = data || [];
    if (folders.length === 0) return [];

    const campaigns = await fetchAllRows<{ id: string; folder_id: string | null }>((from, to) =>
      supabaseAdmin
        .from('campaigns')
        .select('id, folder_id')
        .eq('user_id', userId)
        .not('folder_id', 'is', null)
        .range(from, to)
    );

    const counts: Record<string, number> = {};
    for (const c of campaigns) {
      if (c.folder_id) counts[c.folder_id] = (counts[c.folder_id] || 0) + 1;
    }

    return folders.map((f: any) => ({ ...f, campaign_count: counts[f.id] || 0 }));
  },

  async create(userId: string, input: { name: string; color?: string; icon?: string; parent_id?: string | null }) {
    const { data, error } = await supabaseAdmin
      .from('campaign_folders')
      .insert({ user_id: userId, ...input })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new AppError('Folder name already exists', 409);
      throw new AppError(error.message, 500);
    }
    return { ...data, campaign_count: 0 };
  },

  async update(userId: string, id: string, input: { name?: string; color?: string; icon?: string; position?: number; parent_id?: string | null }) {
    if (input.parent_id) {
      if (input.parent_id === id) {
        throw new AppError('A folder cannot be moved into itself', 400);
      }
      // Walk the new parent's ancestor chain — if it leads back to `id`, this move creates a cycle.
      const { data: allFolders } = await supabaseAdmin
        .from('campaign_folders')
        .select('id, parent_id')
        .eq('user_id', userId);
      const byId = new Map((allFolders || []).map((f: any) => [f.id, f.parent_id]));
      let cursor: string | null | undefined = input.parent_id;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id) throw new AppError('Cannot move a folder into one of its own descendants', 400);
        if (seen.has(cursor)) break;
        seen.add(cursor);
        cursor = byId.get(cursor);
      }
    }
    const { data, error } = await supabaseAdmin
      .from('campaign_folders')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError('Folder not found', 404);
    return data;
  },

  async delete(userId: string, id: string) {
    const { error } = await supabaseAdmin
      .from('campaign_folders')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  async moveCampaign(userId: string, campaignId: string, folderId: string | null) {
    if (folderId) {
      const { data: folder } = await supabaseAdmin
        .from('campaign_folders').select('id').eq('id', folderId).eq('user_id', userId).single();
      if (!folder) throw new AppError('Folder not found', 404);
    }
    const { error } = await supabaseAdmin
      .from('campaigns')
      .update({ folder_id: folderId })
      .eq('id', campaignId)
      .eq('user_id', userId);
    if (error) throw new AppError(error.message, 500);
  },

  async folderAnalytics(userId: string, folderId: string) {
    const { data: folder } = await supabaseAdmin
      .from('campaign_folders').select('*').eq('id', folderId).eq('user_id', userId).single();
    if (!folder) throw new AppError('Folder not found', 404);

    const { data: campaigns } = await supabaseAdmin
      .from('campaigns')
      .select('id, name, status, total_contacts')
      .eq('user_id', userId)
      .eq('folder_id', folderId);

    const campaignIds = (campaigns || []).map((c: any) => c.id);
    if (campaignIds.length === 0) {
      return { folder, campaigns: [], totals: { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 } };
    }

    const activities = await fetchAllRows<{ activity_type: string; campaign_id: string }>((from, to) =>
      supabaseAdmin
        .from('campaign_activities')
        .select('activity_type, campaign_id')
        .in('campaign_id', campaignIds)
        .range(from, to)
    );

    const byCampaign: Record<string, any> = {};
    const totals = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
    for (const id of campaignIds) byCampaign[id] = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };

    for (const a of activities) {
      const c = byCampaign[a.campaign_id];
      if (!c) continue;
      if (a.activity_type in c) {
        c[a.activity_type]++;
        (totals as any)[a.activity_type]++;
      }
    }

    const campaignBreakdown = (campaigns || []).map((c: any) => ({
      ...c,
      ...byCampaign[c.id],
      open_rate:  byCampaign[c.id].sent ? Math.round((byCampaign[c.id].opened  / byCampaign[c.id].sent) * 1000) / 10 : 0,
      click_rate: byCampaign[c.id].sent ? Math.round((byCampaign[c.id].clicked / byCampaign[c.id].sent) * 1000) / 10 : 0,
      reply_rate: byCampaign[c.id].sent ? Math.round((byCampaign[c.id].replied / byCampaign[c.id].sent) * 1000) / 10 : 0,
    }));

    return { folder, campaigns: campaignBreakdown, totals };
  },
};

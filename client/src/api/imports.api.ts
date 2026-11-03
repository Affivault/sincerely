import { apiClient } from './client';

/** One import - a file, a paste or a Google Sheet sync run (migration 111). */
export interface ImportRunRow {
  id: string;
  source: string | null;
  origin: 'file' | 'paste' | 'sheet' | 'api';
  list_id: string | null;
  list_name: string | null;
  sheet_sync_id: string | null;
  kind: 'lead' | 'contact';
  status: 'running' | 'done' | 'cancelled' | 'failed' | 'undone';
  total: number;
  created: number;
  updated: number;
  held: number;
  errors: number;
  still_here: number;
  undone_count: number;
  started_at: string;
  finished_at: string | null;
  undone_at: string | null;
}

export interface SheetSync {
  id: string;
  name: string;
  sheet_url: string;
  list_id: string | null;
  list_name: string | null;
  kind: 'lead' | 'contact';
  mapping: Record<string, string>;
  mode: 'fill' | 'overwrite' | 'skip';
  keep_held: boolean;
  enabled: boolean;
  every_hours: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_import_id: string | null;
  created_at: string;
}

export interface SheetPreview {
  headers: string[];
  sample: Record<string, string>[];
  total: number;
  mapping: Record<string, string>;
  email_column: string | null;
}

export interface SheetRunResult { import_id: string | null; total: number; created: number; updated: number; held: number; errors: number }

export const importsApi = {
  list: async (params: { page?: number; limit?: number; sheet_sync_id?: string } = {}) =>
    (await apiClient.get<{ data: ImportRunRow[]; total: number; unavailable?: boolean }>('/imports', { params })).data,

  /** Open a run before the first batch. id is null before migration 111. */
  start: async (input: { source?: string; origin?: 'file' | 'paste'; list_id?: string | null; kind?: 'lead' | 'contact'; total?: number }) => {
    try {
      return (await apiClient.post<{ id: string | null }>('/imports', input)).data.id;
    } catch {
      // History is a nicety: never stop an import over it.
      return null;
    }
  },

  finish: async (id: string, input: { held?: number; cancelled?: boolean }) => {
    try { await apiClient.post(`/imports/${id}/finish`, input); } catch { /* history only */ }
  },

  undo: async (id: string) =>
    (await apiClient.post<{ deleted: number; kept_in_campaigns: number }>(`/imports/${id}/undo`, {}, { timeout: 120_000 })).data,

  sheets: async () =>
    (await apiClient.get<{ data: SheetSync[]; unavailable?: boolean }>('/imports/sheets')).data,

  sheetPreview: async (sheetUrl: string) =>
    (await apiClient.post<SheetPreview>('/imports/sheets/preview', { sheet_url: sheetUrl }, { timeout: 60_000 })).data,

  sheetCreate: async (input: { name: string; sheet_url: string; list_id?: string | null; kind: 'lead' | 'contact'; mapping: Record<string, string>; mode?: 'fill' | 'overwrite' | 'skip'; every_hours: number; keep_held?: boolean }) =>
    (await apiClient.post<{ sync: SheetSync; first: SheetRunResult | null; first_error: string | null }>('/imports/sheets', input, { timeout: 300_000 })).data,

  sheetUpdate: async (id: string, input: Partial<Pick<SheetSync, 'name' | 'enabled' | 'every_hours' | 'mapping' | 'mode' | 'keep_held'>>) =>
    (await apiClient.patch<SheetSync>(`/imports/sheets/${id}`, input)).data,

  sheetRun: async (id: string) =>
    (await apiClient.post<SheetRunResult>(`/imports/sheets/${id}/run`, {}, { timeout: 300_000 })).data,

  sheetDelete: async (id: string) => { await apiClient.delete(`/imports/sheets/${id}`); },
};

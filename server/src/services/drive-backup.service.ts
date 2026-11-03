/* ═══════════════════════════════════════════════════════════════════════
   Google Drive backup (migration 112).

   Every lead, contact, company, list and person held without an email,
   kept in a spreadsheet in the customer's own Google Drive, about a minute
   behind Sincerely, with a change log of everything that happened.

   How it stays right:

   - Database triggers queue every change (backup_outbox) for accounts that
     have backup on. Nothing in the app has to remember to call this.
   - About once a minute the queue is written: changed records update their
     own row (backup_rows says which), new ones are appended, deleted ones
     are marked Deleted and kept, and a line per change goes in the log.
     Google limits how often an app may write, so changes go in batches.
   - Before a row is overwritten its id is read back from the sheet. If
     someone sorted or edited the tab and the row now holds somebody else,
     nothing is written; the whole spreadsheet is rebuilt instead. A backup
     must never put one person's details on another person's row.
   - Once a day (and after reconnecting, or a very large change) the whole
     spreadsheet is rewritten from Sincerely, which repairs anything edited
     by hand.

   Scope: drive.file. Sincerely can create and write the spreadsheet it
   made and nothing else in the customer's Drive. Values are written RAW,
   so text that looks like a formula stays text.
   ═══════════════════════════════════════════════════════════════════════ */

import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { env } from '../config/env.js';
import { fetchAllPages, selectInChunks } from '../utils/batch.js';
import {
  googleConfigured, googleRedirectUri, newOAuthNonce, signState, verifyState,
} from './calendar-sync.service.js';
import {
  BACKUP_TABS, BACKUP_CELL_BUDGET, LOG_MAX_ROWS, TAB_COLUMNS, PEOPLE_COLUMNS, COMPANY_COLUMNS, HELD_COLUMNS,
  personRow, companyRow, heldRow, listRow, logRow, collapseLog, columnLetter, a1, backupTime,
  type BackupTab, type Cell, type OutboxEvent, type DriveBackupStatus,
} from '@lemlist/shared';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

/** The narrowest scope that can create and write one spreadsheet. */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const BATCH_EVENTS = 5000;
/** Past this many queued changes, rewrite everything instead of row by row. */
const FULL_INSTEAD_OVER = 20_000;
const FULL_EVERY_MS = 24 * 60 * 60 * 1000;
const WRITE_ROWS = 2000;
const LOCK_MS = 15 * 60 * 1000;

const MISSING = /backup_connections|backup_outbox|backup_rows|backup_tombstones|backup_pending_users|schema cache|PGRST20[25]|42P01/i;
const missing = (e: any) => !!e && MISSING.test(`${e.message || ''} ${e.code || ''}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PEOPLE_SELECT = '*, contact_tags(tags(name)), list_contacts(contact_lists(name)), company_rec:companies(website, linkedin_url, size, industry, location, phone)';
const PEOPLE_SELECT_NO_PHONE = '*, contact_tags(tags(name)), list_contacts(contact_lists(name)), company_rec:companies(website, linkedin_url, size, industry, location)';

class GoogleError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/* ── Google HTTP ─────────────────────────────────────────────────────── */

async function tokenPost(body: URLSearchParams): Promise<any> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) throw new GoogleError(`${json?.error || 'error'}: ${json?.error_description || `Google said ${res.status}`}`, res.status);
  return json;
}

/** One Sheets call, retried on rate limits and Google's own hiccups. */
async function api(token: string, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return res.status === 204 ? null : res.json().catch(() => null);
    const json: any = await res.json().catch(() => null);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    throw new GoogleError(json?.error?.message || `Google Sheets said ${res.status}`, res.status);
  }
}

/* ── The connection ──────────────────────────────────────────────────── */

interface Meta {
  sheetIds?: Partial<Record<BackupTab, number>>;
  formatted?: boolean;
  rows?: { people: number; companies: number; held: number; lists: number; log: number };
  warning?: string | null;
}

async function getConnection(userId: string): Promise<any | null> {
  const { data, error } = await supabaseAdmin.from('backup_connections').select('*').eq('user_id', userId).maybeSingle();
  if (error) {
    if (missing(error)) return null;
    throw new AppError(error.message, 500);
  }
  return data;
}

async function patchConnection(userId: string, patch: Record<string, any>) {
  await supabaseAdmin.from('backup_connections').update(patch).eq('user_id', userId);
}

async function markBroken(userId: string, reason: string) {
  await patchConnection(userId, { broken_at: new Date().toISOString(), broken_reason: reason.slice(0, 200), busy_until: null });
  // Nothing more is queued while it is broken; reconnecting rebuilds it all.
  await supabaseAdmin.from('backup_outbox').delete().eq('user_id', userId);
}

async function accessToken(conn: any): Promise<string | null> {
  try {
    if (conn.expires_at && new Date(conn.expires_at) > new Date() && conn.access_token) return decrypt(conn.access_token);
    if (!conn.refresh_token) { await markBroken(conn.user_id, 'Reconnect Google Drive - no refresh token was stored.'); return null; }
    const t = await tokenPost(new URLSearchParams({
      refresh_token: decrypt(conn.refresh_token),
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }));
    await patchConnection(conn.user_id, {
      access_token: encrypt(t.access_token),
      expires_at: new Date(Date.now() + ((t.expires_in || 3600) - 60) * 1000).toISOString(),
    });
    return t.access_token;
  } catch (err: any) {
    const message = String(err?.message || err);
    if (/invalid_grant|unauthorized|invalid_client/i.test(message)) {
      await markBroken(conn.user_id, 'Google access was removed. Reconnect Google Drive to carry on backing up.');
    } else {
      console.warn(`[DriveBackup] token refresh failed for ${conn.user_id}: ${message}`);
    }
    return null;
  }
}

/** Claim the account for one run, so two servers never write the same sheet. */
async function claim(userId: string): Promise<boolean> {
  const now = new Date();
  const { data } = await supabaseAdmin.from('backup_connections')
    .update({ busy_until: new Date(now.getTime() + LOCK_MS).toISOString() })
    .eq('user_id', userId).eq('enabled', true).is('broken_at', null)
    .or(`busy_until.is.null,busy_until.lt.${now.toISOString()}`)
    .select('user_id');
  return !!data && data.length > 0;
}

/* ── The spreadsheet ─────────────────────────────────────────────────── */

const colsOf = (tab: BackupTab) => (tab === 'About' ? 2 : TAB_COLUMNS[tab].length);

async function createSpreadsheet(token: string, accountEmail: string | null): Promise<{ id: string; url: string; sheetIds: Partial<Record<BackupTab, number>> }> {
  const res = await api(token, 'POST', SHEETS, {
    properties: { title: 'Sincerely backup' },
    sheets: BACKUP_TABS.map((t, i) => ({
      properties: {
        title: t, index: i,
        gridProperties: { rowCount: t === 'About' ? 20 : 200, columnCount: colsOf(t), frozenRowCount: t === 'About' ? 0 : 1 },
      },
    })),
  });
  const sheetIds: Partial<Record<BackupTab, number>> = {};
  for (const s of res?.sheets || []) sheetIds[s.properties.title as BackupTab] = s.properties.sheetId;
  console.log(`[DriveBackup] created spreadsheet for ${accountEmail || 'an account'}`);
  return { id: res.spreadsheetId, url: res.spreadsheetUrl, sheetIds };
}

async function formatOnce(token: string, spreadsheetId: string, sheetIds: Partial<Record<BackupTab, number>>) {
  const requests: any[] = [];
  for (const tab of BACKUP_TABS) {
    const sheetId = sheetIds[tab];
    if (sheetId == null) continue;
    if (tab !== 'About') {
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.94, blue: 0.98 } } },
          fields: 'userEnteredFormat(textFormat,backgroundColor)',
        },
      });
    }
    // A warning, not a lock: the customer owns this file and can do as they
    // like, but should know an edit here is overwritten.
    requests.push({
      addProtectedRange: {
        protectedRange: {
          range: { sheetId },
          description: 'Kept up to date by Sincerely. Edits here are overwritten; make a copy to work on the data.',
          warningOnly: true,
        },
      },
    });
  }
  const people = sheetIds.People;
  if (people != null) {
    requests.push({ setBasicFilter: { filter: { range: { sheetId: people, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: PEOPLE_COLUMNS.length } } } });
  }
  const about = sheetIds.About;
  if (about != null) {
    requests.push({ updateDimensionProperties: { range: { sheetId: about, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 180 }, fields: 'pixelSize' } });
    requests.push({ updateDimensionProperties: { range: { sheetId: about, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 640 }, fields: 'pixelSize' } });
  }
  await api(token, 'POST', `${SHEETS}/${spreadsheetId}:batchUpdate`, { requests });
}

/** The Change log is only ever appended to, so its header goes in once, when the tab is made. */
async function writeLogHeader(token: string, sid: string) {
  await api(token, 'POST', `${SHEETS}/${sid}/values:batchUpdate`, {
    valueInputOption: 'RAW', data: [{ range: a1('Change log', 'A1:E1'), values: [[...TAB_COLUMNS['Change log']]] }],
  });
}

/** The spreadsheet, made (again) if it does not exist or was deleted. */
async function ensureSpreadsheet(conn: any, token: string): Promise<{ id: string; meta: Meta; recreated: boolean }> {
  const meta: Meta = conn.meta || {};
  if (conn.spreadsheet_id) {
    try {
      const res = await api(token, 'GET', `${SHEETS}/${conn.spreadsheet_id}?fields=sheets.properties(sheetId,title)`);
      const sheetIds: Partial<Record<BackupTab, number>> = {};
      for (const s of res?.sheets || []) sheetIds[s.properties.title as BackupTab] = s.properties.sheetId;
      // A tab deleted by hand comes back.
      const lost = BACKUP_TABS.filter((t) => sheetIds[t] == null);
      if (lost.length) {
        const add = await api(token, 'POST', `${SHEETS}/${conn.spreadsheet_id}:batchUpdate`, {
          requests: lost.map((t) => ({ addSheet: { properties: { title: t, gridProperties: { rowCount: 200, columnCount: colsOf(t), frozenRowCount: t === 'About' ? 0 : 1 } } } })),
        });
        for (const r of add?.replies || []) if (r.addSheet) sheetIds[r.addSheet.properties.title as BackupTab] = r.addSheet.properties.sheetId;
        if (lost.includes('Change log')) await writeLogHeader(token, conn.spreadsheet_id);
        await patchConnection(conn.user_id, { needs_full: true });
      }
      return { id: conn.spreadsheet_id, meta: { ...meta, sheetIds }, recreated: lost.length > 0 };
    } catch (err: any) {
      if (!(err instanceof GoogleError) || (err.status !== 404 && err.status !== 403)) throw err;
      // Deleted from Drive (or access to it was removed): start a new one.
    }
  }
  const made = await createSpreadsheet(token, conn.account_email);
  await writeLogHeader(token, made.id);
  await formatOnce(token, made.id, made.sheetIds).catch((e) => console.warn('[DriveBackup] format:', e?.message));
  const next: Meta = { sheetIds: made.sheetIds, formatted: true, rows: { people: 0, companies: 0, held: 0, lists: 0, log: 0 } };
  await patchConnection(conn.user_id, { spreadsheet_id: made.id, spreadsheet_url: made.url, meta: next, needs_full: true });
  await supabaseAdmin.from('backup_rows').delete().eq('user_id', conn.user_id);
  return { id: made.id, meta: next, recreated: true };
}

/* ── Reading Sincerely ───────────────────────────────────────────────── */

function shapePerson(r: any) {
  const { contact_tags, list_contacts, enrichment: _e, engagement_factors: _f, ...rest } = r;
  return {
    ...rest,
    tag_names: (contact_tags || []).map((ct: any) => ct?.tags?.name).filter(Boolean),
    list_names: (list_contacts || []).map((lc: any) => lc?.contact_lists?.name).filter(Boolean),
  };
}

async function peopleByIds(userId: string, ids: string[]): Promise<any[]> {
  if (ids.length === 0) return [];
  const run = (sel: string) => selectInChunks(ids, (slice) => supabaseAdmin.from('contacts').select(sel).eq('user_id', userId).in('id', slice), 200);
  let rows: any[];
  try { rows = await run(PEOPLE_SELECT); } catch (e: any) {
    if (!/phone/.test(e?.message || '')) throw e;
    rows = await run(PEOPLE_SELECT_NO_PHONE);
  }
  return rows.map(shapePerson);
}

async function allPeople(userId: string): Promise<any[]> {
  const run = (sel: string) => fetchAllPages((from, to) => supabaseAdmin.from('contacts').select(sel).eq('user_id', userId)
    .order('created_at', { ascending: true }).order('id').range(from, to));
  let rows: any[];
  try { rows = await run(PEOPLE_SELECT); } catch (e: any) {
    if (!/phone/.test(e?.message || '')) throw e;
    rows = await run(PEOPLE_SELECT_NO_PHONE);
  }
  return rows.map(shapePerson);
}

async function allRows(table: string, userId: string, select = '*'): Promise<any[]> {
  try {
    return await fetchAllPages((from, to) => supabaseAdmin.from(table).select(select).eq('user_id', userId)
      .order('created_at', { ascending: true }).order('id').range(from, to));
  } catch (e: any) {
    if (/does not exist|schema cache|42P01/.test(e?.message || '')) return [];
    throw e;
  }
}

async function listNames(userId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin.from('contact_lists').select('id, name').eq('user_id', userId);
  return new Map((data || []).map((l: any) => [l.id, l.name]));
}

async function listsForTab(userId: string): Promise<Cell[][]> {
  const { data, error } = await supabaseAdmin.from('contact_lists')
    .select('id, name, kind, description, created_at, list_contacts(count)').eq('user_id', userId).order('created_at').limit(5000);
  if (error) throw new AppError(error.message, 500);
  return (data || []).map((l: any) => listRow({ ...l, contact_count: l.list_contacts?.[0]?.count ?? 0 }));
}

async function tombstones(userId: string, entity: string): Promise<any[]> {
  const { data } = await supabaseAdmin.from('backup_tombstones').select('entity_id, data, deleted_at')
    .eq('user_id', userId).eq('entity', entity).order('deleted_at', { ascending: false }).limit(50_000);
  return data || [];
}

/* ── Writing ─────────────────────────────────────────────────────────── */

async function writeValues(token: string, sid: string, data: Array<{ range: string; values: Cell[][] }>) {
  if (data.length === 0) return;
  await api(token, 'POST', `${SHEETS}/${sid}/values:batchUpdate`, { valueInputOption: 'RAW', data });
}

/** Append rows; returns the sheet row number the first one landed on. */
async function appendRows(token: string, sid: string, tab: BackupTab, rows: Cell[][]): Promise<number | null> {
  if (rows.length === 0) return null;
  const res = await api(token, 'POST',
    `${SHEETS}/${sid}/values/${encodeURIComponent(a1(tab, 'A1'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: rows });
  const m = String(res?.updates?.updatedRange || '').match(/![A-Z]+(\d+)/);
  return m ? Number(m[1]) : null;
}

async function aboutValues(conn: any, meta: Meta, fullAt: string | null): Promise<Cell[][]> {
  const r = meta.rows || { people: 0, companies: 0, held: 0, lists: 0, log: 0 };
  return [
    ['Sincerely backup', ''],
    ['', ''],
    ['What this is', 'Every lead, contact, company and list in your Sincerely account, kept up to date by Sincerely about a minute after anything changes. The Change log tab says what happened and when.'],
    ['Account', String(conn.account_email || '')],
    ['Last updated', `${backupTime(new Date().toISOString())} UTC`],
    ['Last full refresh', fullAt ? `${backupTime(fullAt)} UTC` : 'Not yet'],
    ['People', r.people],
    ['Companies', r.companies],
    ['Without an email', r.held],
    ['Lists', r.lists],
    ['', ''],
    ['Editing', 'This is a copy, not the original: edits here are not sent back to Sincerely, and the next refresh overwrites them. To work on the data, use File > Make a copy.'],
    ['Deleted records', 'People and companies deleted in Sincerely stay here, marked Deleted, with the time.'],
    ['Restoring', 'Download the People tab as a CSV (File > Download) and import it in Sincerely. Email, names, company and the other main columns are matched automatically.'],
    ['Stopping', 'Turn backup off in Sincerely under Settings > Backup. This spreadsheet stays in your Drive.'],
  ];
}

/**
 * The whole spreadsheet, rewritten from Sincerely. Queued changes up to
 * the moment it started go into the change log first, so none is lost.
 */
async function fullBackup(conn: any, token: string): Promise<void> {
  const userId = conn.user_id;
  const { id: sid, meta } = await ensureSpreadsheet(conn, token);
  const sheetIds = meta.sheetIds || {};

  const { data: last } = await supabaseAdmin.from('backup_outbox').select('id').eq('user_id', userId).order('id', { ascending: false }).limit(1);
  const upto = last?.[0]?.id ?? 0;
  const { count: queued } = await supabaseAdmin.from('backup_outbox').select('id', { count: 'exact', head: true }).eq('user_id', userId).lte('id', upto);

  const [people, companies, held, lists, deadPeople, deadCompanies, deadHeld, names] = await Promise.all([
    allPeople(userId),
    allRows('companies', userId),
    allRows('held_people', userId),
    listsForTab(userId),
    tombstones(userId, 'person'),
    tombstones(userId, 'company'),
    tombstones(userId, 'held'),
    listNames(userId),
  ]);

  const tabs: Array<{ tab: BackupTab; ids: string[]; rows: Cell[][] }> = [
    {
      tab: 'People',
      ids: [...people.map((p) => p.id), ...deadPeople.map((d) => d.entity_id)],
      rows: [...people.map((p) => personRow(p)), ...deadPeople.map((d) => personRow(d.data, { deletedAt: d.deleted_at }))],
    },
    {
      tab: 'Companies',
      ids: [...companies.map((c) => c.id), ...deadCompanies.map((d) => d.entity_id)],
      rows: [...companies.map((c) => companyRow(c)), ...deadCompanies.map((d) => companyRow(d.data, { deletedAt: d.deleted_at }))],
    },
    {
      tab: 'No email',
      ids: [...held.map((h) => h.id), ...deadHeld.map((d) => d.entity_id)],
      rows: [
        ...held.map((h) => heldRow(h, { listName: h.list_id ? names.get(h.list_id) : null })),
        ...deadHeld.map((d) => heldRow(d.data, { deletedAt: d.deleted_at, listName: d.data?.list_id ? names.get(d.data.list_id) : null })),
      ],
    },
  ];

  // Inside Google's 10 million cells: past it, the oldest deleted records go first.
  let warning: string | null = null;
  const cells = () => tabs.reduce((n, t) => n + (t.rows.length + 1) * TAB_COLUMNS[t.tab as Exclude<BackupTab, 'About'>].length, 0) + lists.length * 6;
  if (cells() > BACKUP_CELL_BUDGET) {
    for (const t of tabs) {
      const live = t.tab === 'People' ? people.length : t.tab === 'Companies' ? companies.length : held.length;
      while (cells() > BACKUP_CELL_BUDGET && t.rows.length > live) { t.rows.pop(); t.ids.pop(); }
    }
    const p = tabs[0];
    while (cells() > BACKUP_CELL_BUDGET && p.rows.length > 0) { p.rows.pop(); p.ids.pop(); }
    warning = `Your account is bigger than one Google spreadsheet can hold (10 million cells), so the newest ${(people.length - p.rows.length).toLocaleString('en-GB')} people are not in it.`;
  }

  // The change log first: what happened before this rewrite.
  let logged = 0;
  if (upto > 0) {
    if ((queued || 0) > FULL_INSTEAD_OVER) {
      logged = 1;
      await appendRows(token, sid, 'Change log', [[backupTime(new Date().toISOString()), 'Large change', `${(queued || 0).toLocaleString('en-GB')} changes at once`, '', 'For example a big import or bulk edit. The whole backup was refreshed.']]);
    } else {
      logged = await writeLogFor(userId, token, sid, upto);
    }
  }

  for (const t of tabs) {
    const sheetId = sheetIds[t.tab];
    const width = TAB_COLUMNS[t.tab as Exclude<BackupTab, 'About'>].length;
    const lastCol = columnLetter(width);
    if (sheetId != null) {
      await api(token, 'POST', `${SHEETS}/${sid}:batchUpdate`, {
        requests: [{ updateSheetProperties: { properties: { sheetId, gridProperties: { rowCount: Math.max(200, t.rows.length + 201), columnCount: width, frozenRowCount: 1 } }, fields: 'gridProperties(rowCount,columnCount,frozenRowCount)' } }],
      });
    }
    await api(token, 'POST', `${SHEETS}/${sid}/values:batchClear`, { ranges: [a1(t.tab, `A1:${lastCol}`)] });
    await writeValues(token, sid, [{ range: a1(t.tab, `A1:${lastCol}1`), values: [[...TAB_COLUMNS[t.tab as Exclude<BackupTab, 'About'>]]] }]);
    for (let i = 0; i < t.rows.length; i += WRITE_ROWS) {
      const slice = t.rows.slice(i, i + WRITE_ROWS);
      await writeValues(token, sid, [{ range: a1(t.tab, `A${i + 2}:${lastCol}${i + 1 + slice.length}`), values: slice }]);
      await sleep(1100); // inside Google's 60 writes a minute
    }
  }

  // Lists: small, so always written whole.
  await api(token, 'POST', `${SHEETS}/${sid}/values:batchClear`, { ranges: [a1('Lists', 'A1:F')] });
  await writeValues(token, sid, [{ range: a1('Lists', `A1:F${lists.length + 1}`), values: [[...TAB_COLUMNS.Lists], ...lists] }]);

  // Which row is whose, from scratch.
  await supabaseAdmin.from('backup_rows').delete().eq('user_id', userId);
  for (const t of tabs) {
    const map = t.ids.map((entity_id, i) => ({ user_id: userId, tab: t.tab, entity_id, row_no: i + 2 }));
    for (let i = 0; i < map.length; i += 1000) {
      const { error } = await supabaseAdmin.from('backup_rows').upsert(map.slice(i, i + 1000), { onConflict: 'user_id,tab,entity_id' });
      if (error) throw new AppError(error.message, 500);
    }
  }

  const logRows = (meta.rows?.log || 0) + logged;
  const rows = { people: tabs[0].rows.length, companies: tabs[1].rows.length, held: tabs[2].rows.length, lists: lists.length, log: logRows };
  const now = new Date().toISOString();
  const nextMeta: Meta = { ...meta, rows, warning };
  if (!meta.formatted) {
    await formatOnce(token, sid, sheetIds).catch((e) => console.warn('[DriveBackup] format:', e?.message));
    nextMeta.formatted = true;
  }
  await writeValues(token, sid, [{ range: a1('About', 'A1:B15'), values: await aboutValues(conn, nextMeta, now) }]);
  if (upto > 0) await supabaseAdmin.from('backup_outbox').delete().eq('user_id', userId).lte('id', upto);
  await patchConnection(userId, { meta: nextMeta, needs_full: false, last_full_at: now, last_flush_at: now, last_error: warning });
}

/** Change-log lines for queued events up to `upto` (used before a full rewrite). */
async function writeLogFor(userId: string, token: string, sid: string, upto: number): Promise<number> {
  let written = 0;
  for (let after = 0; ;) {
    const { data: events } = await supabaseAdmin.from('backup_outbox').select('*').eq('user_id', userId)
      .gt('id', after).lte('id', upto).order('id').limit(BATCH_EVENTS);
    if (!events || events.length === 0) break;
    const lines = await logLines(userId, events as OutboxEvent[]);
    if (lines.length) await appendRows(token, sid, 'Change log', lines);
    written += lines.length;
    after = events[events.length - 1].id;
    if (events.length < BATCH_EVENTS) break;
  }
  return written;
}

async function logLines(userId: string, events: OutboxEvent[]): Promise<Cell[][]> {
  const want = (entity: string) => [...new Set(events.filter((e) => e.entity === entity && e.action !== 'deleted').map((e) => e.entity_id))];
  const [people, companies, held, lists] = await Promise.all([
    selectInChunks(want('person'), (s) => supabaseAdmin.from('contacts').select('id, email, first_name, last_name, lifecycle, is_bounced, dcs_verified_at, dcs_score, dcs_syntax_ok, dcs_domain_ok').eq('user_id', userId).in('id', s)),
    selectInChunks(want('company'), (s) => supabaseAdmin.from('companies').select('id, name').eq('user_id', userId).in('id', s)),
    selectInChunks(want('held'), (s) => supabaseAdmin.from('held_people').select('id, first_name, last_name').eq('user_id', userId).in('id', s)),
    selectInChunks(want('list'), (s) => supabaseAdmin.from('contact_lists').select('id, name').eq('user_id', userId).in('id', s)),
  ]);
  const byId = new Map<string, any>();
  for (const r of [...people, ...companies, ...held, ...lists] as any[]) byId.set(r.id, r);
  // A person deleted later in the same batch is still named in earlier lines.
  for (const e of events) if (e.action === 'deleted' && e.snapshot && !byId.has(e.entity_id)) byId.set(e.entity_id, e.snapshot);
  // Deleting someone also removes them from their lists and tags; one
  // "Deleted" line says it, not one line per list as well.
  const deletedIds = new Set(events.filter((e) => e.action === 'deleted').map((e) => e.entity_id));
  const rows = events
    .filter((e) => !((e.action === 'list_removed' || e.action === 'untagged') && deletedIds.has(e.entity_id)))
    .map((e) => logRow(e, byId.get(e.entity_id) || e.snapshot || null)).filter((r): r is Cell[] => !!r);
  return collapseLog(rows);
}

/**
 * About a minute's changes into the spreadsheet. Returns false when the
 * spreadsheet needs rebuilding instead (a row was moved, or too much
 * changed at once).
 */
async function flushChanges(conn: any, token: string): Promise<boolean> {
  const userId = conn.user_id;
  const { count } = await supabaseAdmin.from('backup_outbox').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (!count) return true;
  if (count > FULL_INSTEAD_OVER) return false;

  const { id: sid, meta, recreated } = await ensureSpreadsheet(conn, token);
  if (recreated) return false;
  const { data: rawEvents, error } = await supabaseAdmin.from('backup_outbox').select('*').eq('user_id', userId).order('id').limit(BATCH_EVENTS);
  if (error) throw new AppError(error.message, 500);
  const events = (rawEvents || []) as OutboxEvent[];
  if (events.length === 0) return true;
  const upto = events[events.length - 1].id;

  const ids = (entity: string) => [...new Set(events.filter((e) => e.entity === entity).map((e) => e.entity_id))];
  const personIds = new Set(ids('person'));
  const companyIds = ids('company');
  const heldIds = ids('held');
  const listsChanged = events.some((e) => e.entity === 'list' || e.action === 'list_added' || e.action === 'list_removed');

  // A company edit shows on its people's rows too.
  const editedCompanies = [...new Set(events.filter((e) => e.entity === 'company' && e.action === 'updated').map((e) => e.entity_id))];
  if (editedCompanies.length) {
    const linked = await selectInChunks(editedCompanies, (s) => supabaseAdmin.from('contacts').select('id').eq('user_id', userId).in('company_id', s));
    for (const r of (linked as any[]).slice(0, 2000)) personIds.add(r.id);
  }
  // A list rename shows in its members' Lists cell.
  const renamedLists = events.filter((e) => e.entity === 'list' && e.action === 'updated' && /name/.test(e.detail || '')).map((e) => e.entity_id);
  if (renamedLists.length) {
    const members = await selectInChunks(renamedLists, (s) => supabaseAdmin.from('list_contacts').select('contact_id').in('list_id', s));
    for (const r of (members as any[]).slice(0, 2000)) personIds.add(r.contact_id);
  }

  const [people, companies, held, names] = await Promise.all([
    peopleByIds(userId, [...personIds]),
    selectInChunks(companyIds, (s) => supabaseAdmin.from('companies').select('*').eq('user_id', userId).in('id', s)),
    selectInChunks(heldIds, (s) => supabaseAdmin.from('held_people').select('*').eq('user_id', userId).in('id', s)),
    listNames(userId),
  ]);

  // Deleted records keep their row, marked Deleted, and a tombstone for rewrites.
  const deleted = new Map<string, OutboxEvent>();
  for (const e of events) if (e.action === 'deleted' && e.snapshot) deleted.set(`${e.entity}:${e.entity_id}`, e);
  // A deleted person's lists and tags went with them (cascade); the
  // removal events in this batch still name them, so the tombstone keeps them.
  const gone = (id: string, action: string) => events.filter((x) => x.entity_id === id && x.action === action && x.detail).map((x) => x.detail as string);
  const stones = [...deleted.values()].filter((e) => e.entity !== 'list').map((e) => ({
    user_id: userId, entity: e.entity, entity_id: e.entity_id, deleted_at: e.created_at,
    data: e.entity === 'person'
      ? { ...e.snapshot, list_names: gone(e.entity_id, 'list_removed'), tag_names: gone(e.entity_id, 'untagged') }
      : e.snapshot,
  }));
  const stoneData = new Map(stones.map((x) => [`${x.entity}:${x.entity_id}`, x.data]));
  for (let i = 0; i < stones.length; i += 500) {
    await supabaseAdmin.from('backup_tombstones').upsert(stones.slice(i, i + 500), { onConflict: 'user_id,entity,entity_id' });
  }

  type Want = { tab: BackupTab; id: string; row: Cell[] | null; deletedAt?: string; full?: Cell[] };
  const wants: Want[] = [];
  const live = new Set<string>();
  for (const p of people) { live.add(`person:${p.id}`); wants.push({ tab: 'People', id: p.id, row: personRow(p) }); }
  for (const c of companies as any[]) { live.add(`company:${c.id}`); wants.push({ tab: 'Companies', id: c.id, row: companyRow(c) }); }
  for (const h of held as any[]) { live.add(`held:${h.id}`); wants.push({ tab: 'No email', id: h.id, row: heldRow(h, { listName: h.list_id ? names.get(h.list_id) : null }) }); }
  for (const e of deleted.values()) {
    if (live.has(`${e.entity}:${e.entity_id}`)) continue;
    const tab: BackupTab | null = e.entity === 'person' ? 'People' : e.entity === 'company' ? 'Companies' : e.entity === 'held' ? 'No email' : null;
    if (!tab) continue;
    const full = tab === 'People' ? personRow(stoneData.get(`person:${e.entity_id}`) || e.snapshot!, { deletedAt: e.created_at })
      : tab === 'Companies' ? companyRow(e.snapshot!, { deletedAt: e.created_at })
        : heldRow(e.snapshot!, { deletedAt: e.created_at, listName: e.snapshot?.list_id ? names.get(e.snapshot.list_id) : null });
    wants.push({ tab, id: e.entity_id, row: null, deletedAt: e.created_at, full });
  }

  // Where each one already is.
  const rowMap = new Map<string, number>();
  for (const tab of ['People', 'Companies', 'No email'] as BackupTab[]) {
    const tabIds = wants.filter((w) => w.tab === tab).map((w) => w.id);
    const found = await selectInChunks(tabIds, (s) => supabaseAdmin.from('backup_rows').select('entity_id, row_no').eq('user_id', userId).eq('tab', tab).in('entity_id', s));
    for (const r of found as any[]) rowMap.set(`${tab}:${r.entity_id}`, r.row_no);
  }

  // Read back the id in each row about to be overwritten.
  const existing = wants.filter((w) => rowMap.has(`${w.tab}:${w.id}`));
  for (let i = 0; i < existing.length; i += 150) {
    const slice = existing.slice(i, i + 150);
    const qs = slice.map((w) => `ranges=${encodeURIComponent(a1(w.tab, `A${rowMap.get(`${w.tab}:${w.id}`)}`))}`).join('&');
    const res = await api(token, 'GET', `${SHEETS}/${sid}/values:batchGet?${qs}&majorDimension=ROWS`);
    const got: any[] = res?.valueRanges || [];
    for (let j = 0; j < slice.length; j++) {
      const v = got[j]?.values?.[0]?.[0];
      if (String(v || '') !== slice[j].id) return false; // moved: rebuild instead
    }
  }

  const updates: Array<{ range: string; values: Cell[][] }> = [];
  const appends: Partial<Record<BackupTab, Want[]>> = {};
  const DELETED_COL: Partial<Record<BackupTab, string>> = {
    People: columnLetter(PEOPLE_COLUMNS.indexOf('Deleted') + 1),
    Companies: columnLetter(COMPANY_COLUMNS.indexOf('Deleted') + 1),
    'No email': columnLetter(HELD_COLUMNS.indexOf('Deleted') + 1),
  };
  for (const w of wants) {
    const n = rowMap.get(`${w.tab}:${w.id}`);
    const width = TAB_COLUMNS[w.tab as Exclude<BackupTab, 'About'>].length;
    if (n && w.row) {
      updates.push({ range: a1(w.tab, `A${n}:${columnLetter(width)}${n}`), values: [w.row] });
    } else if (n && w.deletedAt) {
      // Everything else on the row stays as it was: lists, tags, all of it.
      updates.push({ range: a1(w.tab, `B${n}`), values: [[w.tab === 'No email' ? 'Removed' : 'Deleted']] });
      updates.push({ range: a1(w.tab, `${DELETED_COL[w.tab]}${n}`), values: [[backupTime(w.deletedAt)]] });
    } else {
      (appends[w.tab] ||= []).push(w);
    }
  }
  for (let i = 0; i < updates.length; i += 500) await writeValues(token, sid, updates.slice(i, i + 500));

  const rows = { people: 0, companies: 0, held: 0, lists: 0, log: 0, ...(meta.rows || {}) };
  const cellsNow = rows.people * PEOPLE_COLUMNS.length + rows.companies * COMPANY_COLUMNS.length + rows.held * HELD_COLUMNS.length;
  let warning = meta.warning || null;
  let room = BACKUP_CELL_BUDGET - cellsNow;
  for (const tab of ['People', 'Companies', 'No email'] as BackupTab[]) {
    let list = appends[tab] || [];
    const width = TAB_COLUMNS[tab as Exclude<BackupTab, 'About'>].length;
    const fits = Math.max(0, Math.floor(room / width));
    if (list.length > fits) {
      warning = 'Your backup spreadsheet is full (Google allows 10 million cells), so new records are not being added to it.';
      list = list.slice(0, fits);
    }
    if (list.length === 0) continue;
    room -= list.length * width;
    const first = await appendRows(token, sid, tab, list.map((w) => w.row || w.full!));
    if (first == null) return false;
    const map = list.map((w, i) => ({ user_id: userId, tab, entity_id: w.id, row_no: first + i }));
    for (let i = 0; i < map.length; i += 1000) await supabaseAdmin.from('backup_rows').upsert(map.slice(i, i + 1000), { onConflict: 'user_id,tab,entity_id' });
    if (tab === 'People') rows.people += list.length;
    if (tab === 'Companies') rows.companies += list.length;
    if (tab === 'No email') rows.held += list.length;
  }

  if (listsChanged) {
    const lists = await listsForTab(userId);
    await api(token, 'POST', `${SHEETS}/${sid}/values:batchClear`, { ranges: [a1('Lists', 'A2:F')] });
    if (lists.length) await writeValues(token, sid, [{ range: a1('Lists', `A2:F${lists.length + 1}`), values: lists }]);
    rows.lists = lists.length;
  }

  const lines = await logLines(userId, events);
  if (lines.length) {
    await appendRows(token, sid, 'Change log', lines);
    rows.log += lines.length;
    // Keep the log inside its budget: the oldest lines go first.
    const sheetId = meta.sheetIds?.['Change log'];
    if (rows.log > LOG_MAX_ROWS && sheetId != null) {
      const drop = rows.log - LOG_MAX_ROWS;
      await api(token, 'POST', `${SHEETS}/${sid}:batchUpdate`, {
        requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 1 + drop } } }],
      });
      rows.log = LOG_MAX_ROWS;
    }
  }

  const nextMeta: Meta = { ...meta, rows, warning };
  await writeValues(token, sid, [{ range: a1('About', 'A1:B15'), values: await aboutValues(conn, nextMeta, conn.last_full_at) }]);
  await supabaseAdmin.from('backup_outbox').delete().eq('user_id', userId).lte('id', upto);
  await patchConnection(userId, { meta: nextMeta, last_flush_at: new Date().toISOString(), last_error: warning });
  return true;
}

/** One account's turn: a flush, or a full rewrite when one is due. */
async function runFor(userId: string, opts: { forceFull?: boolean } = {}): Promise<'full' | 'flush' | 'skipped'> {
  if (!googleConfigured()) return 'skipped';
  if (!(await claim(userId))) return 'skipped';
  try {
    const conn = await getConnection(userId);
    if (!conn || !conn.enabled || conn.broken_at) return 'skipped';
    const token = await accessToken(conn);
    if (!token) return 'skipped';
    const due = opts.forceFull || conn.needs_full || !conn.spreadsheet_id || !conn.last_full_at
      || Date.now() - new Date(conn.last_full_at).getTime() > FULL_EVERY_MS;
    if (!due && (await flushChanges(conn, token))) return 'flush';
    await fullBackup(await getConnection(userId), token);
    return 'full';
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 300);
    console.warn(`[DriveBackup] ${userId}: ${message}`);
    if (err instanceof GoogleError && (err.status === 401)) {
      await patchConnection(userId, { expires_at: null });
    }
    await patchConnection(userId, { last_error: `The last backup did not finish: ${message}` });
    return 'skipped';
  } finally {
    await patchConnection(userId, { busy_until: null });
  }
}

/* ── For the routes ──────────────────────────────────────────────────── */

export const driveBackupService = {
  async status(userId: string): Promise<DriveBackupStatus> {
    const empty: DriveBackupStatus = {
      configured: googleConfigured(), connected: false, account_email: null, enabled: false, spreadsheet_url: null,
      broken_reason: null, last_error: null, last_flush_at: null, last_full_at: null, pending: 0, needs_full: false,
      rows: { people: 0, companies: 0, held: 0, lists: 0 },
    };
    const { data, error } = await supabaseAdmin.from('backup_connections')
      .select('account_email, enabled, spreadsheet_url, broken_reason, last_error, last_flush_at, last_full_at, needs_full, meta')
      .eq('user_id', userId).maybeSingle();
    if (error) {
      if (missing(error)) return { ...empty, unavailable: true };
      throw new AppError(error.message, 500);
    }
    if (!data) return empty;
    const { count } = await supabaseAdmin.from('backup_outbox').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    const r = (data.meta as Meta)?.rows;
    return {
      ...empty,
      connected: true,
      account_email: data.account_email,
      enabled: data.enabled,
      spreadsheet_url: data.spreadsheet_url,
      broken_reason: data.broken_reason,
      last_error: data.last_error,
      last_flush_at: data.last_flush_at,
      last_full_at: data.last_full_at,
      needs_full: data.needs_full,
      pending: count || 0,
      rows: { people: r?.people || 0, companies: r?.companies || 0, held: r?.held || 0, lists: r?.lists || 0 },
    };
  },

  authorizeUrl(userId: string): { url: string; nonce: string } {
    if (!googleConfigured()) throw new AppError('Google sign-in is not set up on this deployment yet.', 503);
    const nonce = newOAuthNonce();
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: googleRedirectUri(),
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state: signState(userId, nonce, 'backup'),
    });
    return { url: `${GOOGLE_AUTH}?${params.toString()}`, nonce };
  },

  /** From the shared Google callback, for a state signed for 'backup'. */
  async completeConnection(code: string, state: string, browserNonce: string | undefined): Promise<{ email: string }> {
    if (!browserNonce) throw new AppError('Start connecting Google Drive again from this browser.', 400);
    const { userId, purpose } = verifyState(state, browserNonce);
    if (purpose !== 'backup') throw new AppError('Start connecting Google Drive again.', 400);
    const token = await tokenPost(new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
    }));
    if (!String(token.scope || '').includes('drive.file')) {
      throw new AppError('Google did not give access to Drive. Connect again and leave the Drive box ticked.', 400);
    }
    const who = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) })
      .then((r) => r.json()).catch(() => null);
    const email: string | null = who?.email || null;
    const existing = await getConnection(userId);
    const patch: Record<string, any> = {
      user_id: userId,
      account_email: email,
      access_token: encrypt(token.access_token),
      expires_at: new Date(Date.now() + ((token.expires_in || 3600) - 60) * 1000).toISOString(),
      enabled: true,
      needs_full: true,
      broken_at: null,
      broken_reason: null,
      last_error: null,
      busy_until: null,
    };
    if (token.refresh_token) patch.refresh_token = encrypt(token.refresh_token);
    // Another Google account means another Drive: a new spreadsheet there.
    if (existing && existing.account_email && email && existing.account_email !== email) {
      patch.spreadsheet_id = null; patch.spreadsheet_url = null; patch.meta = {};
    }
    const { error } = await supabaseAdmin.from('backup_connections').upsert(patch, { onConflict: 'user_id' });
    if (error) {
      if (missing(error)) throw new AppError('Google Drive backup needs the latest database update (migration 112).', 503);
      throw new AppError(error.message, 500);
    }
    // The first backup starts now, not at the next sweep.
    setTimeout(() => { runFor(userId, { forceFull: true }).catch(() => {}); }, 100);
    return { email: email || 'your Google account' };
  },

  async setEnabled(userId: string, enabled: boolean) {
    const conn = await getConnection(userId);
    if (!conn) throw new AppError('Connect Google Drive first.', 400);
    // Turned back on: anything that changed while it was off is caught up by a full refresh.
    await patchConnection(userId, enabled ? { enabled: true, needs_full: true } : { enabled: false });
    if (!enabled) await supabaseAdmin.from('backup_outbox').delete().eq('user_id', userId);
    else setTimeout(() => { runFor(userId, { forceFull: true }).catch(() => {}); }, 100);
    return this.status(userId);
  },

  /** "Back up now": a full refresh, in the background. */
  async backupNow(userId: string) {
    const conn = await getConnection(userId);
    if (!conn || !conn.enabled) throw new AppError('Turn backup on first.', 400);
    if (conn.broken_at) throw new AppError('Reconnect Google Drive first.', 400);
    if (conn.busy_until && new Date(conn.busy_until) > new Date()) return { started: false, busy: true };
    await patchConnection(userId, { needs_full: true });
    setTimeout(() => { runFor(userId, { forceFull: true }).catch(() => {}); }, 100);
    return { started: true };
  },

  /** Stop and forget the connection. The spreadsheet stays in their Drive. */
  async disconnect(userId: string) {
    const conn = await getConnection(userId);
    if (!conn) return { disconnected: true };
    const t = conn.refresh_token || conn.access_token;
    if (t) {
      try {
        await fetch(`${GOOGLE_REVOKE}?token=${encodeURIComponent(decrypt(t))}`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
      } catch { /* revoking is a courtesy; forgetting the token is what matters */ }
    }
    await supabaseAdmin.from('backup_outbox').delete().eq('user_id', userId);
    await supabaseAdmin.from('backup_rows').delete().eq('user_id', userId);
    await supabaseAdmin.from('backup_tombstones').delete().eq('user_id', userId);
    await supabaseAdmin.from('backup_connections').delete().eq('user_id', userId);
    return { disconnected: true };
  },

  /** For the scheduler. Cross-tenant. */
  async sweep(): Promise<{ flushed: number; full: number }> {
    if (!googleConfigured()) return { flushed: 0, full: 0 };
    let flushed = 0;
    let full = 0;
    const { data: pending, error } = await supabaseAdmin.rpc('backup_pending_users', { p_limit: 20 });
    if (error) { if (!missing(error)) console.warn('[DriveBackup] pending:', error.message); return { flushed, full }; }
    const users = new Set<string>(((pending as any[]) || []).map((p) => p.user_id));
    // And at most one daily refresh per sweep, so they spread out.
    const { data: due } = await supabaseAdmin.from('backup_connections').select('user_id')
      .eq('enabled', true).is('broken_at', null)
      .or(`needs_full.eq.true,last_full_at.is.null,last_full_at.lt.${new Date(Date.now() - FULL_EVERY_MS).toISOString()}`)
      .limit(1);
    for (const d of due || []) users.add(d.user_id);
    for (const userId of users) {
      const r = await runFor(userId);
      if (r === 'flush') flushed++;
      if (r === 'full') full++;
    }
    return { flushed, full };
  },
};

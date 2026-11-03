/* ═══════════════════════════════════════════════════════════════════════
   File backups: OneDrive, Dropbox and S3-compatible storage (migration 113).

   The same records as the Google Drive spreadsheet, as CSV files:

     Sincerely backup/latest/        rewritten a few minutes after anything
                                     changes: people, companies, no-email,
                                     lists, change-log, README
     Sincerely backup/daily/YYYY-MM-DD/   a copy each day, kept for 30 days
                                     (or 7, 90, 365), oldest removed first

   What changed comes from the same database queue as Google Drive (112):
   each destination keeps its own place in it, and the change log is kept
   once per account (backup_log) and written into every destination.

   Access asked for is the least that works: OneDrive and Dropbox give an
   app folder only, and S3 gets keys for one bucket that the customer made
   and can revoke. An S3 endpoint is typed in by the customer, so it is
   checked like a webhook address (public, https) and the request is pinned
   to the address that was checked.

   CSV cells that start with = + - @ are written with a leading apostrophe,
   so a value can never run as a formula when the file is opened in Excel.
   ═══════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import https from 'node:https';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../middleware/error.middleware.js';
import { encrypt, decrypt } from '../utils/encryption.js';
import { env } from '../config/env.js';
import { fetchAllPages, selectInChunks } from '../utils/batch.js';
import { assertSafeWebhookUrl, pinnedLookup } from './webhook.service.js';
import { newOAuthNonce, signState, verifyState } from './calendar-sync.service.js';
import {
  allPeople, allRows, listNames, listsForTab, tombstones, logLines, pruneQueue,
} from './drive-backup.service.js';
import {
  TAB_COLUMNS, personRow, companyRow, heldRow, toCsv, s3ConfigProblems, KEEP_DAYS_CHOICES,
  type FileBackupProvider, type FileBackupStatus, type FileBackupsStatus, type OutboxEvent, type S3BackupConfig,
} from '@lemlist/shared';

const ROOT = 'Sincerely backup';
const LOG_KEEP = 100_000;
const LOCK_MS = 30 * 60 * 1000;
const MISSING = /backup_destinations|backup_snapshots|backup_log|backup_state|backup_prune|backup_head|schema cache|PGRST20[25]|42P01/i;
const missing = (e: any) => !!e && MISSING.test(`${e.message || ''} ${e.code || ''}`);

export const BACKUP_OAUTH_COOKIE_PATH = '/api/oauth/backup';

class StoreError extends Error {
  constructor(message: string, public status = 0, public permanent = false) { super(message); }
}

/* ── Which providers this deployment can offer ───────────────────────── */

export function providerConfigured(p: FileBackupProvider): boolean {
  if (p === 'onedrive') return !!(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
  if (p === 'dropbox') return !!(env.DROPBOX_APP_KEY && env.DROPBOX_APP_SECRET);
  return true; // S3: each account brings its own keys
}

export function backupRedirectUri(p: 'onedrive' | 'dropbox'): string {
  return `${env.API_BASE_URL.replace(/\/+$/, '')}/api/oauth/backup/${p}/callback`;
}

/* ── OAuth (OneDrive, Dropbox) ───────────────────────────────────────── */

const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_SCOPES = 'offline_access Files.ReadWrite.AppFolder User.Read';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const DBX_AUTH = 'https://www.dropbox.com/oauth2/authorize';
const DBX_TOKEN = 'https://api.dropboxapi.com/oauth2/token';
const DBX_API = 'https://api.dropboxapi.com/2';
const DBX_CONTENT = 'https://content.dropboxapi.com/2';

async function formPost(url: string, body: URLSearchParams): Promise<any> {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = `${json?.error || 'error'}: ${json?.error_description || `answered ${res.status}`}`;
    throw new StoreError(msg, res.status, /invalid_grant|unauthorized_client|invalid_client/i.test(msg));
  }
  return json;
}

function authorizeUrl(userId: string, p: 'onedrive' | 'dropbox'): { url: string; nonce: string } {
  if (!providerConfigured(p)) throw new AppError(`${p === 'onedrive' ? 'OneDrive' : 'Dropbox'} backups are not set up on this deployment yet.`, 503);
  const nonce = newOAuthNonce();
  const state = signState(userId, nonce, p === 'onedrive' ? 'backup_onedrive' : 'backup_dropbox');
  if (p === 'onedrive') {
    const q = new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID, response_type: 'code', redirect_uri: backupRedirectUri(p),
      response_mode: 'query', scope: MS_SCOPES, state, prompt: 'select_account',
    });
    return { url: `${MS_AUTH}?${q}`, nonce };
  }
  const q = new URLSearchParams({
    client_id: env.DROPBOX_APP_KEY, response_type: 'code', redirect_uri: backupRedirectUri(p),
    token_access_type: 'offline', state,
  });
  return { url: `${DBX_AUTH}?${q}`, nonce };
}

async function exchangeCode(p: 'onedrive' | 'dropbox', code: string): Promise<{ access: string; refresh: string | null; expiresIn: number; label: string | null }> {
  if (p === 'onedrive') {
    const t = await formPost(MS_TOKEN, new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET, code,
      redirect_uri: backupRedirectUri(p), grant_type: 'authorization_code', scope: MS_SCOPES,
    }));
    const me: any = await fetch(`${GRAPH}/me?$select=mail,userPrincipalName,displayName`, {
      headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json()).catch(() => null);
    return { access: t.access_token, refresh: t.refresh_token || null, expiresIn: t.expires_in || 3600, label: me?.mail || me?.userPrincipalName || null };
  }
  const t = await formPost(DBX_TOKEN, new URLSearchParams({
    code, grant_type: 'authorization_code', client_id: env.DROPBOX_APP_KEY, client_secret: env.DROPBOX_APP_SECRET,
    redirect_uri: backupRedirectUri(p),
  }));
  const me: any = await fetch(`${DBX_API}/users/get_current_account`, {
    method: 'POST', headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'application/json' }, body: 'null',
    signal: AbortSignal.timeout(15_000),
  }).then((r) => r.json()).catch(() => null);
  return { access: t.access_token, refresh: t.refresh_token || null, expiresIn: t.expires_in || 14_400, label: me?.email || null };
}

async function freshToken(dest: any): Promise<string> {
  if (dest.expires_at && new Date(dest.expires_at) > new Date() && dest.access_token) return decrypt(dest.access_token);
  if (!dest.refresh_token) throw new StoreError('Reconnect - no refresh token was stored.', 401, true);
  const refresh = decrypt(dest.refresh_token);
  const t = dest.provider === 'onedrive'
    ? await formPost(MS_TOKEN, new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET,
      refresh_token: refresh, grant_type: 'refresh_token', scope: MS_SCOPES,
    }))
    : await formPost(DBX_TOKEN, new URLSearchParams({
      refresh_token: refresh, grant_type: 'refresh_token', client_id: env.DROPBOX_APP_KEY, client_secret: env.DROPBOX_APP_SECRET,
    }));
  const patch: Record<string, any> = {
    access_token: encrypt(t.access_token),
    expires_at: new Date(Date.now() + ((t.expires_in || 3600) - 60) * 1000).toISOString(),
  };
  // Microsoft rotates refresh tokens; keep the newest.
  if (t.refresh_token) patch.refresh_token = encrypt(t.refresh_token);
  await supabaseAdmin.from('backup_destinations').update(patch).eq('id', dest.id);
  Object.assign(dest, patch);
  return t.access_token;
}

/* ── Stores ──────────────────────────────────────────────────────────── */

interface Store {
  put(path: string, body: Buffer): Promise<void>;
  removeFolder(path: string): Promise<void>;
  /** Where it is, in words, for the Backup page. */
  where: string;
}

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

function oneDriveStore(token: string): Store {
  const CHUNK = 320 * 1024 * 16; // 5 MiB, a multiple of 320 KiB as Graph requires
  const call = async (method: string, url: string, init: { body?: any; headers?: Record<string, string>; auth?: boolean } = {}) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method, body: init.body,
        headers: { ...(init.auth === false ? {} : { Authorization: `Bearer ${token}` }), ...(init.headers || {}) },
        signal: AbortSignal.timeout(120_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2 ** attempt * 2) * 1000));
        continue;
      }
      return res;
    }
  };
  return {
    where: `OneDrive > Apps > (Sincerely) > ${ROOT}`,
    async put(path, body) {
      const item = `${GRAPH}/me/drive/special/approot:/${encPath(`${ROOT}/${path}`)}:`;
      if (body.length <= 4 * 1024 * 1024) {
        const res = await call('PUT', `${item}/content`, { body, headers: { 'Content-Type': 'application/octet-stream' } });
        if (!res.ok) throw new StoreError(`OneDrive: ${(await res.json().catch(() => null))?.error?.message || res.status}`, res.status, res.status === 401 || res.status === 403);
        return;
      }
      const s = await call('POST', `${item}/createUploadSession`, {
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }), headers: { 'Content-Type': 'application/json' },
      });
      const session: any = await s.json().catch(() => null);
      if (!s.ok || !session?.uploadUrl) throw new StoreError(`OneDrive: ${session?.error?.message || s.status}`, s.status, s.status === 401 || s.status === 403);
      for (let start = 0; start < body.length; start += CHUNK) {
        const end = Math.min(body.length, start + CHUNK);
        const res = await call('PUT', session.uploadUrl, {
          auth: false, body: body.subarray(start, end),
          headers: { 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${body.length}` },
        });
        if (!res.ok && res.status !== 202) throw new StoreError(`OneDrive upload: ${res.status}`, res.status);
      }
    },
    async removeFolder(path) {
      const res = await call('DELETE', `${GRAPH}/me/drive/special/approot:/${encPath(`${ROOT}/${path}`)}`);
      if (!res.ok && res.status !== 404) throw new StoreError(`OneDrive delete: ${res.status}`, res.status);
    },
  };
}

function dropboxStore(token: string): Store {
  const CHUNK = 100 * 1024 * 1024;
  // Dropbox-API-Arg is a header: anything outside ASCII must be escaped.
  const arg = (o: unknown) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const call = async (url: string, headers: Record<string, string>, body: any) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers }, body, signal: AbortSignal.timeout(180_000) });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2 ** attempt * 2) * 1000));
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new StoreError(`Dropbox: ${text.slice(0, 200) || res.status}`, res.status, res.status === 401);
      }
      return res;
    }
  };
  return {
    where: `Dropbox > Apps > (Sincerely) > ${ROOT}`,
    async put(path, body) {
      const full = `/${ROOT}/${path}`;
      const commit = { path: full, mode: 'overwrite', mute: true };
      if (body.length <= 140 * 1024 * 1024) {
        await call(`${DBX_CONTENT}/files/upload`, { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': arg(commit) }, body);
        return;
      }
      const started: any = await (await call(`${DBX_CONTENT}/files/upload_session/start`, { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': arg({ close: false }) }, body.subarray(0, CHUNK))).json();
      let offset = CHUNK;
      while (body.length - offset > CHUNK) {
        await call(`${DBX_CONTENT}/files/upload_session/append_v2`, { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': arg({ cursor: { session_id: started.session_id, offset }, close: false }) }, body.subarray(offset, offset + CHUNK));
        offset += CHUNK;
      }
      await call(`${DBX_CONTENT}/files/upload_session/finish`, { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': arg({ cursor: { session_id: started.session_id, offset }, commit }) }, body.subarray(offset));
    },
    async removeFolder(path) {
      try {
        await call(`${DBX_API}/files/delete_v2`, { 'Content-Type': 'application/json' }, JSON.stringify({ path: `/${ROOT}/${path}` }));
      } catch (err: any) {
        if (!(err instanceof StoreError && err.status === 409)) throw err; // 409 path_lookup: already gone
      }
    },
  };
}

/* S3, signed by hand (AWS Signature Version 4): one PUT, LIST and DELETE
   do not justify the AWS SDK, and this keeps the pinned-address request. */

const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k: Buffer | string, s: string) => crypto.createHmac('sha256', k).update(s).digest();
const s3Enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface S3Conf extends S3BackupConfig { secret: string }

/**
 * The Authorization header for one S3 request (AWS Signature Version 4).
 * `query` is already canonical (sorted, encoded); `headers` are lower-case
 * and all signed. Exported so the check can test it against AWS's own
 * worked example.
 */
export function sigV4(r: {
  method: string; path: string; query: string; headers: Record<string, string>; payloadHash: string;
  region: string; accessKeyId: string; secret: string; amzDate: string; service?: string;
}): string {
  const service = r.service || 's3';
  const day = r.amzDate.slice(0, 8);
  const names = Object.keys(r.headers).map((h) => h.toLowerCase()).sort();
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers)) lower[k.toLowerCase()] = String(v).trim();
  const signedHeaders = names.join(';');
  // Method, path, query, headers (each "name:value\n"), a blank line, signed header names, payload hash.
  const canonicalHeaders = names.map((h) => `${h}:${lower[h]}\n`).join('');
  const canonical = [r.method, r.path, r.query, canonicalHeaders, signedHeaders, r.payloadHash].join('\n');
  const scope = `${day}/${r.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', r.amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${r.secret}`, day), r.region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${r.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function s3Endpoint(c: S3BackupConfig): string {
  return (c.endpoint || `https://s3.${c.region}.amazonaws.com`).replace(/\/+$/, '');
}

async function s3Request(c: S3Conf, method: 'PUT' | 'GET' | 'DELETE', key: string, query: Record<string, string> = {}, body: Buffer = Buffer.alloc(0)): Promise<{ status: number; text: string }> {
  const base = new URL(s3Endpoint(c));
  if (base.protocol !== 'https:') throw new StoreError('S3: the endpoint must use https', 400, true);
  const addresses = await assertSafeWebhookUrl(base.toString())
    .catch(() => { throw new StoreError('S3: the endpoint is not a public address Sincerely can reach', 400, true); });
  const path = `/${s3Enc(c.bucket)}${key ? `/${key.split('/').map(s3Enc).join('/')}` : ''}`;
  const qs = Object.keys(query).sort().map((k) => `${s3Enc(k)}=${s3Enc(query[k])}`).join('&');
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const payloadHash = sha256(body);
  const headers: Record<string, string> = { host: base.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const authorization = sigV4({
    method, path, query: qs, headers, payloadHash, region: c.region, accessKeyId: c.access_key_id, secret: c.secret, amzDate,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: base.hostname, port: base.port || 443, path: qs ? `${path}?${qs}` : path, method,
      headers: { ...headers, Authorization: authorization, 'Content-Length': String(body.length) },
      lookup: pinnedLookup(addresses), timeout: 180_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('S3 did not answer in time')));
    req.on('error', reject);
    req.end(body);
  });
}

function s3Fail(r: { status: number; text: string }, what: string): never {
  const code = r.text.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const msg = r.text.match(/<Message>([^<]+)<\/Message>/)?.[1];
  throw new StoreError(`S3 ${what}: ${[code, msg].filter(Boolean).join(' - ') || r.status}`, r.status,
    r.status === 403 || code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || code === 'NoSuchBucket');
}

function s3Store(c: S3Conf): Store {
  const prefix = (c.prefix || '').replace(/^\/+|\/+$/g, '');
  const keyOf = (p: string) => [prefix, ROOT, p].filter(Boolean).join('/');
  return {
    where: `s3://${c.bucket}/${keyOf('')}`,
    async put(path, body) {
      const r = await s3Request(c, 'PUT', keyOf(path), {}, body);
      if (r.status < 200 || r.status >= 300) s3Fail(r, 'upload');
    },
    async removeFolder(path) {
      const list = await s3Request(c, 'GET', '', { 'list-type': '2', prefix: `${keyOf(path).replace(/\/?$/, '/')}` });
      if (list.status !== 200) s3Fail(list, 'list');
      const keys = [...list.text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      for (const k of keys) {
        const r = await s3Request(c, 'DELETE', k);
        if (r.status !== 204 && r.status !== 200 && r.status !== 404) s3Fail(r, 'delete');
      }
    },
  };
}

function s3Conf(dest: any): S3Conf {
  const cfg = dest.config || {};
  return {
    endpoint: cfg.endpoint || '', region: cfg.region || 'us-east-1', bucket: cfg.bucket || '', prefix: cfg.prefix || '',
    access_key_id: cfg.access_key_id || '', secret: cfg.secret ? decrypt(cfg.secret) : '',
  };
}

async function storeFor(dest: any): Promise<Store> {
  if (dest.provider === 's3') return s3Store(s3Conf(dest));
  const token = await freshToken(dest);
  return dest.provider === 'onedrive' ? oneDriveStore(token) : dropboxStore(token);
}

/* ── The change log, once per account ────────────────────────────────── */

/**
 * Turn queued changes into change-log lines (backup_log), and keep a copy
 * of anything deleted (backup_tombstones). Runs before any file backup is
 * written, so every destination's change-log.csv is the same log.
 */
async function processLog(userId: string): Promise<void> {
  const { data: state } = await supabaseAdmin.from('backup_state').select('log_cursor').eq('user_id', userId).maybeSingle();
  let cursor = Number(state?.log_cursor) || 0;
  for (let pass = 0; pass < 10; pass++) {
    const { data: events } = await supabaseAdmin.from('backup_outbox').select('*').eq('user_id', userId).gt('id', cursor).order('id').limit(5000);
    if (!events || events.length === 0) break;
    const list = events as OutboxEvent[];

    const gone = (id: string, action: string) => list.filter((x) => x.entity_id === id && x.action === action && x.detail).map((x) => x.detail as string);
    const stones = list.filter((e) => e.action === 'deleted' && e.snapshot && e.entity !== 'list').map((e) => ({
      user_id: userId, entity: e.entity, entity_id: e.entity_id, deleted_at: e.created_at,
      data: e.entity === 'person' ? { ...e.snapshot, list_names: gone(e.entity_id, 'list_removed'), tag_names: gone(e.entity_id, 'untagged') } : e.snapshot,
    }));
    for (let i = 0; i < stones.length; i += 500) {
      await supabaseAdmin.from('backup_tombstones').upsert(stones.slice(i, i + 500), { onConflict: 'user_id,entity,entity_id' });
    }

    const lines = list.length > 20_000 ? [] : await logLines(userId, list);
    const rows = lines.map((l) => ({
      user_id: userId,
      at: l[0] ? `${String(l[0]).replace(' ', 'T')}:00Z` : new Date().toISOString(),
      what: String(l[1] || ''), who: String(l[2] || ''), email: String(l[3] || ''), details: String(l[4] || ''),
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await supabaseAdmin.from('backup_log').insert(rows.slice(i, i + 1000));
      if (error) throw new AppError(error.message, 500);
    }
    cursor = list[list.length - 1].id;
    await supabaseAdmin.from('backup_state').upsert({ user_id: userId, log_cursor: cursor, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (list.length < 5000) break;
  }
  // Keep the newest lines only.
  const { data: edge } = await supabaseAdmin.from('backup_log').select('id').eq('user_id', userId).order('id', { ascending: false }).range(LOG_KEEP, LOG_KEEP);
  if (edge?.[0]?.id) await supabaseAdmin.from('backup_log').delete().eq('user_id', userId).lte('id', edge[0].id);
}

/* ── Building the files ──────────────────────────────────────────────── */

const BOM = '\uFEFF'; // so Excel opens the CSV as UTF-8

async function buildFiles(userId: string, accountLabel: string | null): Promise<{ files: Array<{ name: string; body: Buffer }>; counts: FileBackupStatus['counts'] }> {
  const [people, companies, held, lists, deadPeople, deadCompanies, deadHeld, names, log] = await Promise.all([
    allPeople(userId), allRows('companies', userId), allRows('held_people', userId), listsForTab(userId),
    tombstones(userId, 'person'), tombstones(userId, 'company'), tombstones(userId, 'held'), listNames(userId),
    fetchAllPages((from, to) => supabaseAdmin.from('backup_log').select('at, what, who, email, details').eq('user_id', userId).order('id').range(from, to)),
  ]);
  const csv = (header: readonly string[], rows: any[][]) => Buffer.from(BOM + toCsv(header, rows), 'utf8');
  const peopleRows = [...people.map((p) => personRow(p)), ...deadPeople.map((d) => personRow(d.data, { deletedAt: d.deleted_at }))];
  const companyRows = [...companies.map((c) => companyRow(c)), ...deadCompanies.map((d) => companyRow(d.data, { deletedAt: d.deleted_at }))];
  const heldRows = [
    ...held.map((h) => heldRow(h, { listName: h.list_id ? names.get(h.list_id) : null })),
    ...deadHeld.map((d) => heldRow(d.data, { deletedAt: d.deleted_at, listName: d.data?.list_id ? names.get(d.data.list_id) : null })),
  ];
  const logRows = (log as any[]).map((l) => [String(l.at).slice(0, 16).replace('T', ' '), l.what, l.who, l.email, l.details]);
  const now = new Date().toISOString();
  const counts = { people: people.length, companies: companies.length, held: held.length, lists: lists.length, log: logRows.length };
  const readme = [
    'SINCERELY BACKUP',
    '',
    `Written ${now.slice(0, 16).replace('T', ' ')} UTC${accountLabel ? ` for ${accountLabel}` : ''}.`,
    '',
    'people.csv      Every lead and contact: lists, tags, email status, company details, custom fields.',
    '                Deleted people are kept, with Record = Deleted and the time.',
    'companies.csv   Every company record.',
    'no-email.csv    People imported without a usable email address.',
    'lists.csv       Each list, its kind and how many people are in it.',
    'change-log.csv  Every change, oldest first: added, moved between lists, became a contact,',
    '                enriched, email checked, edited, deleted.',
    '',
    'The "latest" folder is rewritten a few minutes after anything changes in Sincerely.',
    'The "daily" folder has a copy for each day, removed after the number of days chosen.',
    '',
    'To restore: import people.csv in Sincerely (Leads > Import). Email, names, company and',
    'the other main columns are matched automatically.',
    '',
    'Cells that start with = + - or @ have a leading apostrophe, so nothing runs as a formula.',
    '',
    `People ${counts.people}   Companies ${counts.companies}   No email ${counts.held}   Lists ${counts.lists}`,
  ].join('\r\n');
  return {
    counts,
    files: [
      { name: 'people.csv', body: csv(TAB_COLUMNS.People, peopleRows) },
      { name: 'companies.csv', body: csv(TAB_COLUMNS.Companies, companyRows) },
      { name: 'no-email.csv', body: csv(TAB_COLUMNS['No email'], heldRows) },
      { name: 'lists.csv', body: csv(TAB_COLUMNS.Lists, lists) },
      { name: 'change-log.csv', body: csv(TAB_COLUMNS['Change log'], logRows) },
      { name: 'README.txt', body: Buffer.from(readme, 'utf8') },
    ],
  };
}

/* ── Running one destination ─────────────────────────────────────────── */

/** How long to wait after a change before rewriting: bigger accounts, less often. */
function debounceMs(people: number): number {
  if (people > 100_000) return 60 * 60_000;
  if (people > 20_000) return 15 * 60_000;
  return 3 * 60_000;
}

const today = () => new Date().toISOString().slice(0, 10);

async function claimDest(id: string): Promise<boolean> {
  const now = new Date();
  const { data } = await supabaseAdmin.from('backup_destinations')
    .update({ busy_until: new Date(now.getTime() + LOCK_MS).toISOString() })
    .eq('id', id).eq('enabled', true).is('broken_at', null)
    .or(`busy_until.is.null,busy_until.lt.${now.toISOString()}`)
    .select('id');
  return !!data && data.length > 0;
}

async function head(userId: string): Promise<number> {
  const { data } = await supabaseAdmin.from('backup_outbox').select('id').eq('user_id', userId).order('id', { ascending: false }).limit(1);
  return Number(data?.[0]?.id) || 0;
}

async function runDestination(dest: any, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!providerConfigured(dest.provider)) return false;
  const { count: pending } = await supabaseAdmin.from('backup_outbox').select('id', { count: 'exact', head: true })
    .eq('user_id', dest.user_id).gt('id', Number(dest.cursor) || 0);
  const snapshotDue = dest.last_snapshot_day !== today();
  const settled = !dest.last_write_at || Date.now() - new Date(dest.last_write_at).getTime() > debounceMs(Number(dest.last_counts?.people) || 0);
  if (!opts.force && !dest.needs_write && !snapshotDue && !((pending || 0) > 0 && settled)) return false;
  if (!(await claimDest(dest.id))) return false;
  try {
    const upto = await head(dest.user_id);
    await processLog(dest.user_id);
    const store = await storeFor(dest);
    const { files, counts } = await buildFiles(dest.user_id, dest.account_label);
    for (const f of files) await store.put(`latest/${f.name}`, f.body);
    const bytes = files.reduce((n, f) => n + f.body.length, 0);
    const patch: Record<string, any> = {
      cursor: Math.max(Number(dest.cursor) || 0, upto), needs_write: false, last_write_at: new Date().toISOString(),
      last_bytes: bytes, last_counts: counts, last_error: null, busy_until: null,
    };
    if (snapshotDue) {
      const day = today();
      for (const f of files) await store.put(`daily/${day}/${f.name}`, f.body);
      await supabaseAdmin.from('backup_snapshots').upsert({
        destination_id: dest.id, user_id: dest.user_id, day, folder: `daily/${day}`, files: files.length, bytes, people: counts.people,
        created_at: new Date().toISOString(), removed_at: null,
      }, { onConflict: 'destination_id,day' });
      patch.last_snapshot_day = day;
      // Older than the chosen number of days: removed, oldest first.
      const cutoff = new Date(Date.now() - (Number(dest.keep_days) || 30) * 86_400_000).toISOString().slice(0, 10);
      const { data: old } = await supabaseAdmin.from('backup_snapshots').select('id, folder')
        .eq('destination_id', dest.id).is('removed_at', null).lt('day', cutoff).order('day').limit(20);
      for (const o of old || []) {
        try {
          await store.removeFolder(o.folder);
          await supabaseAdmin.from('backup_snapshots').update({ removed_at: new Date().toISOString() }).eq('id', o.id);
        } catch (err: any) {
          console.warn(`[FileBackup] could not remove ${o.folder}: ${err?.message}`);
        }
      }
    }
    await supabaseAdmin.from('backup_destinations').update(patch).eq('id', dest.id);
    await pruneQueue(dest.user_id);
    return true;
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 300);
    console.warn(`[FileBackup] ${dest.provider} ${dest.user_id}: ${message}`);
    const patch: Record<string, any> = { busy_until: null, last_error: `The last backup did not finish: ${message}` };
    if (err instanceof StoreError && err.permanent) {
      patch.broken_at = new Date().toISOString();
      patch.broken_reason = dest.provider === 's3'
        ? `The bucket refused Sincerely's keys (${message}). Check them and save again.`
        : 'Access was removed. Reconnect to carry on backing up.';
    }
    await supabaseAdmin.from('backup_destinations').update(patch).eq('id', dest.id);
    if (patch.broken_at) await pruneQueue(dest.user_id);
    return false;
  }
}

/* ── For the routes ──────────────────────────────────────────────────── */

const PROVIDERS: FileBackupProvider[] = ['onedrive', 'dropbox', 's3'];
const isProvider = (p: string): p is FileBackupProvider => (PROVIDERS as string[]).includes(p);

async function destOf(userId: string, provider: FileBackupProvider): Promise<any | null> {
  const { data, error } = await supabaseAdmin.from('backup_destinations').select('*').eq('user_id', userId).eq('provider', provider).maybeSingle();
  if (error) {
    if (missing(error)) throw new AppError('Backups to OneDrive, Dropbox and S3 need the latest database update (migration 113).', 503);
    throw new AppError(error.message, 500);
  }
  return data;
}

/** A new reader starts from now; the log reader too, if this is the first. */
async function startReading(userId: string): Promise<number> {
  const at = await head(userId);
  const { data: state } = await supabaseAdmin.from('backup_state').select('user_id').eq('user_id', userId).maybeSingle();
  if (!state) await supabaseAdmin.from('backup_state').upsert({ user_id: userId, log_cursor: at }, { onConflict: 'user_id' });
  return at;
}

function kick(dest: { id: string }) {
  setTimeout(async () => {
    const { data } = await supabaseAdmin.from('backup_destinations').select('*').eq('id', dest.id).maybeSingle();
    if (data) await runDestination(data, { force: true }).catch(() => {});
  }, 100);
}

function whereOf(dest: any): string | null {
  if (!dest) return null;
  if (dest.provider === 's3') {
    const c = dest.config || {};
    return `s3://${c.bucket}/${[String(c.prefix || '').replace(/^\/+|\/+$/g, ''), ROOT].filter(Boolean).join('/')}`;
  }
  return `${dest.provider === 'onedrive' ? 'OneDrive' : 'Dropbox'} > Apps > Sincerely > ${ROOT}`;
}

export const fileBackupService = {
  async status(userId: string): Promise<FileBackupsStatus> {
    const { data, error } = await supabaseAdmin.from('backup_destinations').select('*').eq('user_id', userId);
    if (error) {
      if (missing(error)) return { unavailable: true, destinations: PROVIDERS.map((p) => blank(p)) };
      throw new AppError(error.message, 500);
    }
    const ids = (data || []).map((d: any) => d.id);
    const snaps = ids.length
      ? await selectInChunks(ids, (s) => supabaseAdmin.from('backup_snapshots').select('destination_id, day, folder, files, bytes, people, created_at')
        .in('destination_id', s).is('removed_at', null).order('day', { ascending: false }).limit(400))
      : [];
    const out: FileBackupStatus[] = [];
    for (const p of PROVIDERS) {
      const d = (data || []).find((x: any) => x.provider === p);
      if (!d) { out.push(blank(p)); continue; }
      const { count } = await supabaseAdmin.from('backup_outbox').select('id', { count: 'exact', head: true }).eq('user_id', userId).gt('id', Number(d.cursor) || 0);
      const c = d.last_counts || {};
      out.push({
        provider: p, configured: providerConfigured(p), connected: true, account_label: d.account_label,
        enabled: d.enabled, keep_days: d.keep_days, broken_reason: d.broken_reason, last_error: d.last_error,
        last_write_at: d.last_write_at, last_bytes: d.last_bytes, pending: count || 0,
        writing: !!(d.busy_until && new Date(d.busy_until) > new Date()),
        counts: { people: c.people || 0, companies: c.companies || 0, held: c.held || 0, lists: c.lists || 0, log: c.log || 0 },
        location: whereOf(d),
        s3: p === 's3' ? { endpoint: d.config?.endpoint || '', region: d.config?.region || '', bucket: d.config?.bucket || '', prefix: d.config?.prefix || '', access_key_id: d.config?.access_key_id || '' } : null,
        snapshots: (snaps as any[]).filter((s) => s.destination_id === d.id).slice(0, 60).map(({ destination_id: _d, ...s }) => s),
      });
    }
    return { destinations: out };
  },

  authorizeUrl(userId: string, provider: string) {
    if (provider !== 'onedrive' && provider !== 'dropbox') throw new AppError('Unknown provider', 400);
    return authorizeUrl(userId, provider);
  },

  async completeConnection(provider: 'onedrive' | 'dropbox', code: string, state: string, browserNonce: string | undefined) {
    if (!browserNonce) throw new AppError('Start connecting again from this browser.', 400);
    const { userId, purpose } = verifyState(state, browserNonce);
    if (purpose !== (provider === 'onedrive' ? 'backup_onedrive' : 'backup_dropbox')) throw new AppError('Start connecting again.', 400);
    const t = await exchangeCode(provider, code).catch((e: any) => { throw new AppError(String(e?.message || 'Could not connect'), 400); });
    const existing = await destOf(userId, provider);
    const row: Record<string, any> = {
      user_id: userId, provider, account_label: t.label,
      access_token: encrypt(t.access), expires_at: new Date(Date.now() + (t.expiresIn - 60) * 1000).toISOString(),
      enabled: true, needs_write: true, broken_at: null, broken_reason: null, last_error: null, busy_until: null,
    };
    if (t.refresh) row.refresh_token = encrypt(t.refresh);
    if (!existing) row.cursor = await startReading(userId);
    const { data, error } = await supabaseAdmin.from('backup_destinations').upsert(row, { onConflict: 'user_id,provider' }).select('id').single();
    if (error) throw new AppError(error.message, 500);
    kick(data);
    return { label: t.label || (provider === 'onedrive' ? 'OneDrive' : 'Dropbox') };
  },

  /** S3: keys are checked by writing and deleting a small file before saving. */
  async saveS3(userId: string, input: any) {
    const existing = await destOf(userId, 's3');
    const cfg = {
      endpoint: String(input?.endpoint || '').trim().replace(/\/+$/, ''),
      region: String(input?.region || '').trim(),
      bucket: String(input?.bucket || '').trim(),
      prefix: String(input?.prefix || '').trim().replace(/^\/+|\/+$/g, '').slice(0, 200),
      access_key_id: String(input?.access_key_id || '').trim(),
    };
    const secretIn = String(input?.secret_access_key || '').trim();
    const problems = s3ConfigProblems({ ...cfg, secret_access_key: secretIn }, { needSecret: !existing?.config?.secret });
    if (problems.length) throw new AppError(problems[0], 400);
    const secret = secretIn || (existing?.config?.secret ? decrypt(existing.config.secret) : '');
    const conf: S3Conf = { ...cfg, secret };
    if (conf.endpoint) await assertSafeWebhookUrl(conf.endpoint).catch(() => { throw new AppError('That endpoint is not a public address Sincerely can reach.', 400); });
    try {
      const store = s3Store(conf);
      await store.put('.sincerely-check', Buffer.from(`Written by Sincerely to check access, ${new Date().toISOString()}\n`));
    } catch (err: any) {
      throw new AppError(`Sincerely could not write to that bucket: ${String(err?.message || err).replace(/^S3 upload: /, '')}`, 400);
    }
    const row: Record<string, any> = {
      user_id: userId, provider: 's3', account_label: `${cfg.bucket}${cfg.endpoint ? ` on ${new URL(cfg.endpoint).hostname}` : ` (${cfg.region})`}`,
      config: { ...cfg, secret: encrypt(secret) }, enabled: true, needs_write: true,
      broken_at: null, broken_reason: null, last_error: null, busy_until: null,
    };
    if (!existing) row.cursor = await startReading(userId);
    const { data, error } = await supabaseAdmin.from('backup_destinations').upsert(row, { onConflict: 'user_id,provider' }).select('id').single();
    if (error) throw new AppError(error.message, 500);
    kick(data);
    return this.status(userId);
  },

  async update(userId: string, provider: string, input: any) {
    if (!isProvider(provider)) throw new AppError('Unknown provider', 400);
    const d = await destOf(userId, provider);
    if (!d) throw new AppError('Connect it first.', 400);
    const patch: Record<string, any> = {};
    if (typeof input?.enabled === 'boolean') {
      patch.enabled = input.enabled;
      // Back on: caught up from now, with a full write straight away.
      if (input.enabled) { patch.needs_write = true; patch.cursor = await startReading(userId); }
    }
    if (input?.keep_days != null) {
      const k = Number(input.keep_days);
      if (!(KEEP_DAYS_CHOICES as readonly number[]).includes(k)) throw new AppError('Keep copies for 7, 30, 90 or 365 days.', 400);
      patch.keep_days = k;
    }
    await supabaseAdmin.from('backup_destinations').update(patch).eq('id', d.id);
    if (patch.enabled === false) await pruneQueue(userId);
    if (patch.enabled === true) kick(d);
    return this.status(userId);
  },

  async backupNow(userId: string, provider: string) {
    if (!isProvider(provider)) throw new AppError('Unknown provider', 400);
    const d = await destOf(userId, provider);
    if (!d || !d.enabled) throw new AppError('Turn this backup on first.', 400);
    if (d.broken_at) throw new AppError('Reconnect it first.', 400);
    if (d.busy_until && new Date(d.busy_until) > new Date()) return { started: false, busy: true };
    await supabaseAdmin.from('backup_destinations').update({ needs_write: true }).eq('id', d.id);
    kick(d);
    return { started: true };
  },

  /** Stop and forget it. The files already written stay where they are. */
  async disconnect(userId: string, provider: string) {
    if (!isProvider(provider)) throw new AppError('Unknown provider', 400);
    const d = await destOf(userId, provider);
    if (!d) return { disconnected: true };
    if (d.provider === 'dropbox' && d.access_token) {
      fetch(`${DBX_API}/auth/token/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${decrypt(d.access_token)}` }, signal: AbortSignal.timeout(10_000) }).catch(() => {});
    }
    await supabaseAdmin.from('backup_destinations').delete().eq('id', d.id);
    await pruneQueue(userId);
    return { disconnected: true };
  },

  /** For the scheduler. Cross-tenant. */
  async sweep(): Promise<number> {
    const { data, error } = await supabaseAdmin.from('backup_destinations').select('*').eq('enabled', true).is('broken_at', null).limit(500);
    if (error) { if (!missing(error)) console.warn('[FileBackup] sweep:', error.message); return 0; }
    let written = 0;
    for (const d of data || []) {
      if (await runDestination(d)) written++;
      if (written >= 10) break; // the rest next minute
    }
    return written;
  },
};

function blank(p: FileBackupProvider): FileBackupStatus {
  return {
    provider: p, configured: providerConfigured(p), connected: false, account_label: null, enabled: false, keep_days: 30,
    broken_reason: null, last_error: null, last_write_at: null, last_bytes: null, pending: 0, writing: false,
    counts: { people: 0, companies: 0, held: 0, lists: 0, log: 0 }, location: null, s3: null, snapshots: [],
  };
}


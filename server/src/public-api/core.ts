/* ═══════════════════════════════════════════════════════════════════════
   The public API's plumbing: everything every /v1 request goes through.

     request id -> API key -> suspended? -> rate limit -> scope ->
     idempotency -> handler -> one error format -> request log

   The endpoints themselves are in handlers.ts. Which endpoints exist, and
   what they promise, is in @lemlist/shared public-api.ts; mountPublicApi()
   refuses to start if a handler and that definition disagree.
   ═══════════════════════════════════════════════════════════════════════ */

import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import {
  API_ENDPOINTS, API_ERROR_CODES, PUBLIC_API_VERSION, type ApiEndpoint,
} from '@lemlist/shared';
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { isOwnerEmail } from '../config/admin.js';
import { validateKey } from '../services/apikey.service.js';
import { accountControls } from '../services/account-controls.service.js';
import { isRateLimited } from '../middleware/apikey.middleware.js';
import { AppError } from '../middleware/error.middleware.js';

/* ── Errors ──────────────────────────────────────────────────────────── */

const CODE = new Map(API_ERROR_CODES.map((e) => [e.code, e]));

export class PublicApiError extends Error {
  readonly code: string;
  readonly param?: string;
  readonly extra?: Record<string, unknown>;
  constructor(code: string, message: string, param?: string, extra?: Record<string, unknown>) {
    super(message);
    if (!CODE.has(code)) throw new Error(`Unknown public API error code: ${code}`);
    this.code = code;
    this.param = param;
    this.extra = extra;
  }
  get status(): number { return CODE.get(this.code)!.status; }
  get type(): string { return CODE.get(this.code)!.type; }
}

export const invalid = (param: string, message: string) => new PublicApiError('parameter_invalid', message, param);
export const missing = (param: string, message = `${param} is required.`) => new PublicApiError('parameter_missing', message, param);
export const notFound = (what: string, param?: string) => new PublicApiError('resource_not_found', `No such ${what}.`, param);

export function docUrl(code: string): string {
  return `${env.CLIENT_URL.replace(/\/+$/, '')}/developer?tab=reference#error-${code}`;
}

/**
 * Turn anything thrown into the public error. The services throw AppError
 * with sentences written for the app; their status is kept and the
 * sentence is used where it is safe to show (4xx). A 5xx never shows its
 * message: it is logged with the request id instead.
 */
export function toPublicError(err: unknown, requestId: string): PublicApiError {
  if (err instanceof PublicApiError) return err;
  const anyErr = err as { type?: string; status?: number; statusCode?: number; message?: string; code?: string };
  // express.json() on a body that is not JSON.
  if (anyErr?.type === 'entity.parse.failed') return new PublicApiError('body_invalid', 'The body is not valid JSON.');
  if (anyErr?.type === 'entity.too.large') return new PublicApiError('body_invalid', 'The body is too large (10 MB at most).');
  if (err instanceof AppError) {
    const s = err.statusCode;
    if (s === 404) return new PublicApiError('resource_not_found', err.message);
    if (s === 409) return new PublicApiError('campaign_state', err.message);
    if (s === 403) return new PublicApiError('plan_limit', err.message);
    if (s === 429) return new PublicApiError('rate_limited', err.message);
    if (s >= 400 && s < 500) return new PublicApiError('parameter_invalid', err.message);
  }
  // A Postgres "that is not a uuid" is the caller's mistake, not ours.
  if (anyErr?.code === '22P02') return new PublicApiError('parameter_invalid', 'One of the ids is not a valid id.');
  console.error(`[PublicAPI] ${requestId} internal error:`, err);
  return new PublicApiError('internal_error', `Something went wrong on our side. Quote ${requestId} if you contact support.`);
}

function sendError(res: Response, err: PublicApiError, requestId: string): void {
  if (res.headersSent) return;
  res.status(err.status).json({
    error: {
      type: err.type,
      code: err.code,
      message: err.message,
      ...(err.param ? { param: err.param } : {}),
      ...(err.extra || {}),
      doc_url: docUrl(err.code),
    },
    request_id: requestId,
  });
}

/* ── The request ─────────────────────────────────────────────────────── */

export interface ApiReq extends Request {
  requestId: string;
  userId: string;
  userEmail: string | null;
  apiKeyId: string;
  apiKeyScopes: string[];
  apiKeyRateLimit: number;
  endpointId?: string;
  errorCode?: string;
}

export type Handler = (req: ApiReq) => Promise<{ status?: number; body: unknown }>;

function newRequestId(): string {
  return `req_${crypto.randomBytes(10).toString('hex')}`;
}

function requestIdOf(req: Request, res: Response): string {
  const r = req as Partial<ApiReq>;
  if (!r.requestId) {
    r.requestId = newRequestId();
    res.setHeader('X-Request-Id', r.requestId);
  }
  return r.requestId;
}

async function authenticate(req: Request, res: Response): Promise<void> {
  const r = req as ApiReq;
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) {
    throw new PublicApiError('missing_api_key', 'Send your API key as "Authorization: Bearer sk_live_...". Create one in Settings > Developer.');
  }
  const raw = match[1];
  if (!raw.startsWith('sk_live_')) {
    throw new PublicApiError('invalid_api_key', 'That is not a Sincerely API key. Keys start with sk_live_.');
  }
  const key = await validateKey(raw);
  if (!key) throw new PublicApiError('invalid_api_key', 'This API key is wrong, revoked or expired.');

  const verdict = isRateLimited(key.keyId, key.rateLimit);
  res.setHeader('X-RateLimit-Limit', String(key.rateLimit));
  res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
  res.setHeader('X-RateLimit-Reset', String(verdict.resetSeconds));
  if (verdict.limited) {
    res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
    throw new PublicApiError('rate_limited', `This key allows ${key.rateLimit} requests a minute. Try again in ${verdict.retryAfterSeconds} seconds.`);
  }

  if (!isOwnerEmail(key.userEmail) && await accountControls.isSuspended(key.userId)) {
    throw new PublicApiError('account_suspended', 'This Sincerely account is suspended.');
  }

  r.userId = key.userId;
  r.userEmail = key.userEmail;
  r.apiKeyId = key.keyId;
  r.apiKeyScopes = Array.isArray(key.scopes) ? key.scopes : [];
  r.apiKeyRateLimit = key.rateLimit;
}

function checkScope(req: ApiReq, ep: ApiEndpoint): void {
  if (ep.scope === 'none') return;
  if (!req.apiKeyScopes.includes(ep.scope)) {
    throw new PublicApiError('insufficient_scope', `This key does not have the "${ep.scope}" scope this needs. Create a key with it in Settings > Developer.`, undefined, { required_scope: ep.scope });
  }
}

/* ── Idempotency ─────────────────────────────────────────────────────── */

const IDEMPOTENCY_TTL_MS = 24 * 3600_000;
/** A row still unanswered after this is from a request that died: it may be taken over. */
const IN_FLIGHT_STALE_MS = 2 * 60_000;
let idempotencyMissingUntil = 0;

function missingTable(error: { code?: string; message?: string } | null | undefined, table: string): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || new RegExp(table).test(error.message || '');
}

function hashRequest(req: Request): string {
  return crypto.createHash('sha256')
    .update(`${req.method} ${req.originalUrl.split('?')[0]}\n${JSON.stringify(req.body ?? null)}`)
    .digest('hex');
}

type Claim =
  | { kind: 'none' }
  | { kind: 'claimed'; key: string }
  | { kind: 'replay'; status: number; body: unknown };

async function claimIdempotencyKey(req: ApiReq): Promise<Claim> {
  if (req.method === 'GET') return { kind: 'none' };
  const raw = req.headers['idempotency-key'];
  if (raw === undefined) return { kind: 'none' };
  const key = String(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!key) return { kind: 'none' };
  if (key.length > 255) throw invalid('Idempotency-Key', 'The Idempotency-Key header is longer than 255 characters.');
  if (Date.now() < idempotencyMissingUntil) return { kind: 'none' };

  const hash = hashRequest(req);
  const row = {
    user_id: req.userId, idem_key: key, method: req.method,
    path: req.originalUrl.split('?')[0].slice(0, 500), request_hash: hash,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabaseAdmin.from('api_idempotency_keys').insert(row);
    if (!error) return { kind: 'claimed', key };
    if (missingTable(error, 'api_idempotency_keys')) {
      console.warn('[PublicAPI] api_idempotency_keys is missing - run migration 115. Idempotency-Key is ignored until then.');
      idempotencyMissingUntil = Date.now() + 10 * 60_000;
      return { kind: 'none' };
    }
    if (error.code !== '23505') throw error;

    const { data: existing, error: readErr } = await supabaseAdmin
      .from('api_idempotency_keys')
      .select('request_hash, status, response, created_at')
      .eq('user_id', req.userId).eq('idem_key', key)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!existing) continue; // removed between the two calls: claim it again

    const age = Date.now() - Date.parse(existing.created_at);
    if (age > IDEMPOTENCY_TTL_MS) {
      await supabaseAdmin.from('api_idempotency_keys').delete().eq('user_id', req.userId).eq('idem_key', key);
      continue;
    }
    if (existing.request_hash !== hash) {
      throw new PublicApiError('idempotency_key_reused', 'This Idempotency-Key was already used for a different request. Use a new key for each request.', 'Idempotency-Key');
    }
    if (existing.status != null) {
      return { kind: 'replay', status: existing.status, body: existing.response };
    }
    if (age < IN_FLIGHT_STALE_MS) {
      throw new PublicApiError('idempotency_key_in_flight', 'A request with this Idempotency-Key is still being handled. Try again in a few seconds.', 'Idempotency-Key');
    }
    // The first attempt never finished: take it over, once.
    const { data: taken } = await supabaseAdmin
      .from('api_idempotency_keys')
      .update({ created_at: new Date().toISOString() })
      .eq('user_id', req.userId).eq('idem_key', key).is('status', null).eq('created_at', existing.created_at)
      .select('idem_key');
    if (taken && taken.length) return { kind: 'claimed', key };
    throw new PublicApiError('idempotency_key_in_flight', 'A request with this Idempotency-Key is still being handled. Try again in a few seconds.', 'Idempotency-Key');
  }
  throw new PublicApiError('idempotency_key_in_flight', 'A request with this Idempotency-Key is still being handled. Try again in a few seconds.', 'Idempotency-Key');
}

async function settleIdempotencyKey(req: ApiReq, key: string, status: number, body: unknown): Promise<void> {
  try {
    if (status >= 500) {
      // A failure on our side is not an answer: let the retry do it properly.
      await supabaseAdmin.from('api_idempotency_keys').delete().eq('user_id', req.userId).eq('idem_key', key);
      return;
    }
    await supabaseAdmin.from('api_idempotency_keys')
      .update({ status, response: body ?? null })
      .eq('user_id', req.userId).eq('idem_key', key);
  } catch (e: any) {
    console.error('[PublicAPI] could not store an idempotent answer:', e?.message || e);
  }
}

/* ── Request log ─────────────────────────────────────────────────────── */

let logMissingUntil = 0;
let lastSweep = 0;

function logRequest(req: Partial<ApiReq>, res: Response, startedAt: number): void {
  if (!req.userId || Date.now() < logMissingUntil) return;
  const row = {
    user_id: req.userId,
    api_key_id: req.apiKeyId || null,
    request_id: req.requestId || '',
    method: (req.method || '').slice(0, 10),
    path: (req.originalUrl || '').split('?')[0].slice(0, 500),
    status: res.statusCode,
    duration_ms: Math.max(0, Math.round(Date.now() - startedAt)),
    error_code: req.errorCode || null,
    user_agent: String(req.headers?.['user-agent'] || '').slice(0, 200) || null,
  };
  void Promise.resolve(supabaseAdmin.from('api_request_log').insert(row)).then(({ error }) => {
    if (missingTable(error, 'api_request_log')) {
      console.warn('[PublicAPI] api_request_log is missing - run migration 115. Requests are not logged until then.');
      logMissingUntil = Date.now() + 10 * 60_000;
    } else if (error) {
      console.warn('[PublicAPI] request log write failed:', error.message);
    }
  }).catch(() => {});

  // Once an hour per process: drop old log rows and spent idempotency keys.
  if (Date.now() - lastSweep > 3600_000) {
    lastSweep = Date.now();
    const logCutoff = new Date(Date.now() - 14 * 86400_000).toISOString();
    const idemCutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS).toISOString();
    void Promise.all([
      supabaseAdmin.from('api_request_log').delete().lt('created_at', logCutoff),
      supabaseAdmin.from('api_idempotency_keys').delete().lt('created_at', idemCutoff),
    ]).catch(() => {});
  }
}

/* ── Mounting ────────────────────────────────────────────────────────── */

/** '/v1/contacts/{id}' -> '/contacts/:id' (relative to the /v1 mount). */
export function expressPath(path: string): string {
  return path.replace(/^\/v1/, '').replace(/\{(\w+)\}/g, ':$1') || '/';
}

/**
 * Builds the /v1 router from the shared definition. Every endpoint there
 * must have a handler and every handler must have an endpoint: a mismatch
 * throws at startup, so the docs and the server cannot drift apart.
 */
export function buildPublicApiRouter(handlers: Record<string, Handler>): Router {
  const ids = new Set(API_ENDPOINTS.map((e) => e.id));
  const missingHandlers = API_ENDPOINTS.filter((e) => !handlers[e.id]).map((e) => e.id);
  const extraHandlers = Object.keys(handlers).filter((id) => !ids.has(id));
  if (missingHandlers.length || extraHandlers.length) {
    throw new Error(`Public API out of step with its definition. No handler: ${missingHandlers.join(', ') || '-'}. Not defined: ${extraHandlers.join(', ') || '-'}.`);
  }

  const router = express.Router();

  router.use((req, res, next) => {
    const startedAt = Date.now();
    requestIdOf(req, res);
    res.setHeader('Sincerely-Api-Version', PUBLIC_API_VERSION);
    res.setHeader('Cache-Control', 'no-store');
    res.on('finish', () => logRequest(req as Partial<ApiReq>, res, startedAt));
    next();
  });

  // Literal paths before parameterised ones, so /contacts/bulk is never read as /contacts/:id.
  const ordered = [...API_ENDPOINTS].sort((a, b) => {
    const pa = (a.path.match(/\{/g) || []).length;
    const pb = (b.path.match(/\{/g) || []).length;
    return pa - pb;
  });

  for (const ep of ordered) {
    const method = ep.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';
    router[method](expressPath(ep.path), async (req: Request, res: Response, next: NextFunction) => {
      const r = req as ApiReq;
      r.endpointId = ep.id;
      let claim: Claim = { kind: 'none' };
      try {
        await authenticate(req, res);
        checkScope(r, ep);
        if (ep.method !== 'GET') {
          if (req.body !== undefined && (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body))) {
            throw new PublicApiError('body_invalid', 'The body must be a JSON object.');
          }
          if (req.body === undefined) req.body = {};
        }
        claim = await claimIdempotencyKey(r);
        if (claim.kind === 'replay') {
          res.setHeader('Idempotent-Replayed', 'true');
          res.status(claim.status).json(claim.body);
          return;
        }
        const out = await handlers[ep.id](r);
        const status = out.status ?? ep.status ?? 200;
        if (claim.kind === 'claimed') await settleIdempotencyKey(r, claim.key, status, out.body);
        res.status(status).json(out.body);
      } catch (err) {
        const pub = toPublicError(err, r.requestId);
        r.errorCode = pub.code;
        if (claim.kind === 'claimed') {
          const body = { error: { type: pub.type, code: pub.code, message: pub.message, ...(pub.param ? { param: pub.param } : {}), ...(pub.extra || {}), doc_url: docUrl(pub.code) }, request_id: r.requestId };
          await settleIdempotencyKey(r, claim.key, pub.status, body);
        }
        sendError(res, pub, r.requestId);
        void next;
      }
    });
  }

  // Anything else under /v1.
  router.use((req, res) => {
    const id = requestIdOf(req, res);
    const known = API_ENDPOINTS.filter((e) => new RegExp(`^${expressPath(e.path).replace(/:\w+/g, '[^/]+')}/?$`).test(req.path));
    const message = known.length
      ? `${req.method} is not allowed here. This path takes ${[...new Set(known.map((e) => e.method))].join(', ')}.`
      : `There is no ${req.method} ${req.originalUrl.split('?')[0]}. See the API reference for what there is.`;
    (req as Partial<ApiReq>).errorCode = 'route_not_found';
    sendError(res, new PublicApiError('route_not_found', message), id);
  });

  return router;
}

/** For errors raised before the router runs (a body that is not JSON). */
export function publicApiErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const id = requestIdOf(req, res);
  const pub = toPublicError(err, id);
  (req as Partial<ApiReq>).errorCode = pub.code;
  sendError(res, pub, id);
}

/* ── Reading input ───────────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** A path id: a 404, not a database error, for anything that is not an id. */
export function pathId(req: ApiReq, name: string, what: string): string {
  const v = req.params[name];
  if (!isUuid(v)) throw notFound(what, name);
  return v.toLowerCase();
}

export function queryString(req: ApiReq, name: string, opts: { max?: number; enum?: readonly string[] } = {}): string | undefined {
  const raw = req.query[name];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw) || typeof raw !== 'string') throw invalid(name, `${name} must be given once.`);
  const v = raw.trim();
  if (!v) return undefined;
  if (opts.max && v.length > opts.max) throw invalid(name, `${name} is too long (at most ${opts.max} characters).`);
  if (opts.enum && !opts.enum.includes(v)) throw invalid(name, `${name} must be one of: ${opts.enum.join(', ')}.`);
  return v;
}

export function queryUuid(req: ApiReq, name: string): string | undefined {
  const v = queryString(req, name);
  if (v === undefined) return undefined;
  if (!isUuid(v)) throw invalid(name, `${name} is not a valid id.`);
  return v.toLowerCase();
}

export function queryTime(req: ApiReq, name: string): string | undefined {
  const v = queryString(req, name);
  if (v === undefined) return undefined;
  const t = Date.parse(v);
  if (!Number.isFinite(t) || !/^\d{4}-\d{2}-\d{2}/.test(v)) throw invalid(name, `${name} must be an ISO 8601 time, like 2026-11-03T09:41:00Z.`);
  return new Date(t).toISOString();
}

/** Only these keys may be in the body: a typo is an error, not silently ignored. */
export function onlyKeys(body: Record<string, unknown>, allowed: readonly string[], prefix = ''): void {
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) throw invalid(`${prefix}${k}`, `Unknown field "${prefix}${k}".`);
  }
}

export function bodyString(body: Record<string, unknown>, name: string, opts: { max?: number; required?: boolean; enum?: readonly string[]; prefix?: string } = {}): string | null | undefined {
  const p = `${opts.prefix || ''}${name}`;
  const v = body[name];
  if (v === undefined || v === '') {
    if (opts.required) throw missing(p);
    return undefined;
  }
  if (v === null) {
    if (opts.required) throw missing(p);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw invalid(p, `${p} must be a string.`);
  const s = String(v).trim();
  if (!s) {
    if (opts.required) throw missing(p);
    return undefined;
  }
  if (opts.max && s.length > opts.max) throw invalid(p, `${p} is too long (at most ${opts.max} characters).`);
  if (opts.enum && !opts.enum.includes(s)) throw invalid(p, `${p} must be one of: ${opts.enum.join(', ')}.`);
  return s;
}

export function bodyBool(body: Record<string, unknown>, name: string): boolean | undefined {
  const v = body[name];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw invalid(name, `${name} must be true or false.`);
}

/** A list of strings. Also accepts one comma-separated string, which is what no-code tools tend to send. */
export function bodyStringArray(body: Record<string, unknown>, name: string, opts: { max?: number; itemMax?: number; prefix?: string } = {}): string[] | undefined {
  const p = `${opts.prefix || ''}${name}`;
  const v = body[name];
  if (v === undefined || v === null || v === '') return undefined;
  const arr = typeof v === 'string' ? v.split(',') : v;
  if (!Array.isArray(arr)) throw invalid(p, `${p} must be a list of strings.`);
  const out: string[] = [];
  for (const item of arr) {
    if (item === null || item === undefined || item === '') continue;
    if (typeof item !== 'string' && typeof item !== 'number') throw invalid(p, `${p} must be a list of strings.`);
    const s = String(item).trim();
    if (!s) continue;
    if (opts.itemMax && s.length > opts.itemMax) throw invalid(p, `An item in ${p} is too long (at most ${opts.itemMax} characters).`);
    out.push(s);
  }
  const unique = [...new Set(out)];
  if (opts.max && unique.length > opts.max) throw invalid(p, `${p} can hold at most ${opts.max.toLocaleString('en-GB')} items.`);
  return unique;
}

export function bodyUuidArray(body: Record<string, unknown>, name: string, max: number): string[] | undefined {
  const arr = bodyStringArray(body, name, { max });
  if (!arr) return undefined;
  const bad = arr.find((x) => !isUuid(x));
  if (bad) throw invalid(name, `"${bad}" in ${name} is not a valid id.`);
  return arr.map((x) => x.toLowerCase());
}

/* ── Pagination ──────────────────────────────────────────────────────── */

export interface PageArgs { limit: number; after?: { v: string; id: string } }

export function pageArgs(req: ApiReq, sort: string): PageArgs {
  const rawLimit = queryString(req, 'limit');
  let limit = 25;
  if (rawLimit !== undefined) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw invalid('limit', 'limit must be a whole number from 1 to 100.');
    limit = n;
  }
  const cursor = queryString(req, 'cursor', { max: 600 });
  if (!cursor) return { limit };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || parsed.s !== sort || typeof parsed.v !== 'string' || !isUuid(parsed.id)) throw new Error('shape');
    return { limit, after: { v: parsed.v, id: parsed.id } };
  } catch {
    throw new PublicApiError('cursor_invalid', 'That cursor is not one this endpoint gave out. Pass next_cursor from the previous page, with the same filters.', 'cursor');
  }
}

export function makeCursor(sort: string, v: string, id: string): string {
  return Buffer.from(JSON.stringify({ s: sort, v, id })).toString('base64url');
}

/** PostgREST filter value, quoted so a time's ':' '+' and '.' are read literally. */
function q(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Keyset paging, newest first: order by `sort` then id, both descending,
 * and start after the cursor. Stable however many rows are added while a
 * caller pages, which offsets are not.
 */
export function keyset<T extends { order: any; or: any; limit: any }>(query: T, sort: string, page: PageArgs, table?: string): T {
  let qy: any = query;
  if (page.after) {
    const col = sort;
    const filter = `${col}.lt.${q(page.after.v)},and(${col}.eq.${q(page.after.v)},id.lt.${page.after.id})`;
    qy = table ? qy.or(filter, { foreignTable: table }) : qy.or(filter);
  }
  return qy.order(sort, { ascending: false }).order('id', { ascending: false }).limit(page.limit + 1);
}

export function pageOf<R extends Record<string, any>, O>(rows: R[], sort: string, page: PageArgs, map: (r: R) => O) {
  const has_more = rows.length > page.limit;
  const kept = has_more ? rows.slice(0, page.limit) : rows;
  const last = kept[kept.length - 1];
  return {
    object: 'list' as const,
    data: kept.map(map),
    has_more,
    next_cursor: has_more && last ? makeCursor(sort, String(last[sort]), String(last.id)) : null,
  };
}

/** The same paging over rows already in memory (small collections, like lists). */
export function pageInMemory<R extends Record<string, any>, O>(rows: R[], sort: string, page: PageArgs, map: (r: R) => O) {
  const sorted = [...rows].sort((a, b) => {
    const c = String(b[sort]).localeCompare(String(a[sort]));
    return c !== 0 ? c : String(b.id).localeCompare(String(a.id));
  });
  const start = page.after
    ? sorted.filter((r) => {
      const c = String(r[sort]).localeCompare(page.after!.v);
      return c < 0 || (c === 0 && String(r.id) < page.after!.id);
    })
    : sorted;
  return pageOf(start.slice(0, page.limit + 1), sort, page, map);
}

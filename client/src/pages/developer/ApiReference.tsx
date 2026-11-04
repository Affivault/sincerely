import { useEffect, useMemo, useState, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  API_ENDPOINTS, API_ERROR_CODES, API_GROUPS, API_OBJECTS, PUBLIC_API_VERSION, PUBLIC_EVENTS, SIGNATURE_HEADER,
  codeSamples, publicEventExample, type ApiEndpoint, type ApiField,
} from '@lemlist/shared';
import { BookOpen, Copy, ExternalLink, Key, Play, ShieldCheck, TriangleAlert, Webhook } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { developerApi } from '../../api/developer.api';
import { Segmented } from '../../components/ui/Segmented';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';

/* ═══════════════════════════════════════════════════════════════════════
   The API reference, inside the app.

   Everything on it - endpoints, fields, examples, errors, events, code
   samples - comes from the same definition the server mounts its routes
   from (@lemlist/shared public-api.ts), so it cannot describe an endpoint
   that does not exist. The console sends real requests with a key the
   person pastes in; the key is held in memory only and never stored.
   ═══════════════════════════════════════════════════════════════════════ */

type Section = 'start' | 'errors' | 'webhooks' | 'objects' | string;

const METHOD_VARIANT = { GET: 'info', POST: 'success', PATCH: 'warning', DELETE: 'danger' } as const;

function copy(text: string, what = 'Copied') {
  navigator.clipboard.writeText(text).then(() => toast.success(what)).catch(() => toast.error('Could not copy to the clipboard'));
}

function Code({ children, label, className }: { children: string; label?: string; className?: string }) {
  return (
    <div className={cn('relative group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]', className)}>
      <pre className="overflow-x-auto p-3 pr-10 text-caption leading-relaxed font-mono text-[var(--text-primary)] whitespace-pre">{children}</pre>
      <button
        type="button"
        aria-label={label ? `Copy ${label}` : 'Copy'}
        onClick={() => copy(children)}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] opacity-80 group-hover:opacity-100"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function MethodBadge({ method }: { method: ApiEndpoint['method'] }) {
  return <Badge variant={METHOD_VARIANT[method]} size="sm" className="font-mono w-12 justify-center">{method}</Badge>;
}

function FieldTable({ fields, title }: { fields: ApiField[]; title: string }) {
  if (!fields.length) return null;
  return (
    <div>
      <h3 className="text-strong font-medium text-[var(--text-primary)] mb-2">{title}</h3>
      <div className="rounded-lg border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
        {fields.map((f) => (
          <div key={f.name} className="px-3 py-2.5 grid gap-1 sm:grid-cols-[minmax(0,180px)_1fr] sm:gap-4">
            <div className="min-w-0">
              <code className="text-body font-mono text-[var(--text-primary)] break-all">{f.name}</code>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                <span className="text-caption text-[var(--text-tertiary)] font-mono">{f.type}{f.nullable ? ' | null' : ''}</span>
                {f.required && <span className="text-caption font-medium text-amber-800 dark:text-amber-300">required</span>}
              </div>
            </div>
            <div className="text-body text-[var(--text-secondary)]">
              {f.description}
              {f.enum && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {f.enum.map((v) => <code key={v} className="text-caption font-mono px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)]">{v}</code>)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Samples({ ep, base }: { ep: ApiEndpoint; base: string }) {
  const [lang, setLang] = useState<'curl' | 'javascript' | 'python'>('curl');
  const samples = useMemo(() => codeSamples(ep, base), [ep, base]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-strong font-medium text-[var(--text-primary)]">Example request</h3>
        <Segmented size="sm" label="Language" value={lang} onChange={setLang}
          options={[{ value: 'curl', label: 'curl' }, { value: 'javascript', label: 'JavaScript' }, { value: 'python', label: 'Python' }]} />
      </div>
      <Code label="example request">{samples[lang]}</Code>
    </div>
  );
}

interface TryResult { status: number; ms: number; requestId: string | null; remaining: string | null; body: string }

function TryIt({ ep, base, apiKey, setApiKey }: { ep: ApiEndpoint; base: string; apiKey: string; setApiKey: (k: string) => void }) {
  const id = useId();
  const pathParams = (ep.params || []).filter((p) => p.in === 'path');
  const queryParams = (ep.params || []).filter((p) => p.in === 'query');
  const [values, setValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState(ep.bodyExample ? JSON.stringify(ep.bodyExample, null, 2) : '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TryResult | null>(null);

  useEffect(() => {
    setValues({});
    setBody(ep.bodyExample ? JSON.stringify(ep.bodyExample, null, 2) : '');
    setResult(null);
  }, [ep.id, ep.bodyExample]);

  const writes = ep.method !== 'GET';
  const missingPath = pathParams.find((p) => !values[p.name]?.trim());
  const keyLooksRight = /^sk_live_\S+$/.test(apiKey.trim());

  async function send() {
    let path = ep.path;
    for (const p of pathParams) path = path.replace(`{${p.name}}`, encodeURIComponent(values[p.name].trim()));
    const qs = new URLSearchParams();
    for (const p of queryParams) if (values[p.name]?.trim()) qs.set(p.name, values[p.name].trim());
    let payload: string | undefined;
    if (writes && body.trim()) {
      try { payload = JSON.stringify(JSON.parse(body)); } catch { toast.error('The body is not valid JSON'); return; }
    }
    setBusy(true);
    const started = performance.now();
    try {
      const res = await fetch(`${base.replace(/\/v1$/, '')}${path}${qs.toString() ? `?${qs}` : ''}`, {
        method: ep.method,
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...(ep.method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
        },
        body: payload,
      });
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ }
      setResult({ status: res.status, ms: Math.round(performance.now() - started), requestId: res.headers.get('X-Request-Id'), remaining: res.headers.get('X-RateLimit-Remaining'), body: pretty });
    } catch (e: any) {
      setResult({ status: 0, ms: Math.round(performance.now() - started), requestId: null, remaining: null, body: `Could not reach the API: ${e?.message || e}` });
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-2.5 h-8 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--text-primary)]';

  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Play className="h-4 w-4 text-[var(--indigo-text)]" />
        <h3 className="text-strong font-medium text-[var(--text-primary)]">Try it</h3>
      </div>
      <div>
        <label htmlFor={`${id}-key`} className="text-caption text-[var(--text-tertiary)] mb-1 block">API key (kept on this page only, never saved)</label>
        <input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk_live_..." className={cn(input, 'font-mono')} />
      </div>
      {[...pathParams, ...queryParams].length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {[...pathParams, ...queryParams].map((p) => (
            <div key={p.name}>
              <label htmlFor={`${id}-${p.name}`} className="text-caption text-[var(--text-tertiary)] mb-1 block font-mono">
                {p.name}{p.in === 'path' ? ' *' : ''}
              </label>
              {p.enum ? (
                <select id={`${id}-${p.name}`} value={values[p.name] || ''} onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} className={input}>
                  <option value="">{p.in === 'path' ? 'Choose' : 'Any'}</option>
                  {p.enum.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input id={`${id}-${p.name}`} value={values[p.name] || ''} onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                  placeholder={p.in === 'path' ? (p.name === 'email' ? 'name@example.com' : 'id') : ''} className={cn(input, 'font-mono')} />
              )}
            </div>
          ))}
        </div>
      )}
      {writes && ep.body && (
        <div>
          <label htmlFor={`${id}-body`} className="text-caption text-[var(--text-tertiary)] mb-1 block">Body (JSON)</label>
          <textarea id={`${id}-body`} value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(14, Math.max(4, body.split('\n').length))}
            spellCheck={false} className="w-full rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] p-2.5 text-caption font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-primary)]" />
        </div>
      )}
      {writes && (
        <p className="flex items-start gap-1.5 text-caption text-[var(--text-tertiary)]">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-px" />
          This acts on your real account, exactly as a script would.
        </p>
      )}
      <button
        type="button"
        onClick={send}
        disabled={busy || !keyLooksRight || !!missingPath}
        title={!keyLooksRight ? 'Paste an API key first' : missingPath ? `Fill in ${missingPath.name}` : undefined}
        className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-[var(--indigo)] text-white text-body font-semibold hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <Spinner size="sm" /> : <Play className="h-3.5 w-3.5" />}
        Send {ep.method}
      </button>
      {result && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-[var(--text-tertiary)]">
            <Badge variant={result.status >= 200 && result.status < 300 ? 'success' : result.status === 0 ? 'default' : 'danger'} size="sm" className="font-mono">
              {result.status || 'No answer'}
            </Badge>
            <span>{result.ms} ms</span>
            {result.requestId && <span className="font-mono">{result.requestId}</span>}
            {result.remaining && <span>{result.remaining} requests left this minute</span>}
          </div>
          <Code label="response">{result.body}</Code>
        </div>
      )}
    </div>
  );
}

function EndpointView({ ep, base, apiKey, setApiKey }: { ep: ApiEndpoint; base: string; apiKey: string; setApiKey: (k: string) => void }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-title font-semibold text-[var(--text-primary)]">{ep.summary}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={ep.method} />
          <code className="text-body font-mono text-[var(--text-primary)] break-all">{ep.path}</code>
          <Badge size="sm" variant={ep.scope === 'write' ? 'warning' : 'default'}>{ep.scope} scope</Badge>
        </div>
        <p className="text-body text-[var(--text-secondary)] max-w-3xl">{ep.description}</p>
      </div>
      <div className="grid gap-5 2xl:grid-cols-2 2xl:items-start">
        <div className="space-y-5 min-w-0">
          <FieldTable title="Path" fields={(ep.params || []).filter((p) => p.in === 'path')} />
          <FieldTable title="Query" fields={(ep.params || []).filter((p) => p.in === 'query')} />
          <FieldTable title="Body" fields={ep.body || []} />
          {ep.errors && ep.errors.length > 0 && (
            <div>
              <h3 className="text-strong font-medium text-[var(--text-primary)] mb-2">Errors particular to this endpoint</h3>
              <ul className="space-y-1">
                {ep.errors.map((c) => {
                  const e = API_ERROR_CODES.find((x) => x.code === c);
                  return <li key={c} className="text-body text-[var(--text-secondary)]"><code className="font-mono text-[var(--text-primary)]">{c}</code> ({e?.status}): {e?.meaning}</li>;
                })}
              </ul>
            </div>
          )}
        </div>
        <div className="space-y-5 min-w-0">
          <Samples ep={ep} base={base} />
          <div className="space-y-2">
            <h3 className="text-strong font-medium text-[var(--text-primary)]">Example response <span className="text-[var(--text-tertiary)] font-normal">{ep.status || 200}</span></h3>
            <Code label="example response">{JSON.stringify(ep.responseExample, null, 2)}</Code>
          </div>
          <TryIt ep={ep} base={base} apiKey={apiKey} setApiKey={setApiKey} />
        </div>
      </div>
    </div>
  );
}

const VERIFY_NODE = `import crypto from "node:crypto";

// Read the raw body as a string: re-serialising parsed JSON changes it.
export function verifySincerely(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false; // too old: a replay
  const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1 || "", "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`;

const VERIFY_PYTHON = `import hmac, hashlib, time

def verify_sincerely(raw_body: bytes, header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts.get("t", "0"))
    if abs(time.time() - t) > 300:  # too old: a replay
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))`;

function StartView({ base, onCreateKey }: { base: string; onCreateKey: () => void }) {
  const me = API_ENDPOINTS.find((e) => e.id === 'me.get')!;
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-2">
        <h2 className="text-title font-semibold text-[var(--text-primary)]">Sincerely API</h2>
        <p className="text-body text-[var(--text-secondary)]">
          Add and update contacts, put people into campaigns, read replies and what Relay made of them, and get told the moment something happens.
          The same rules as the app apply: nobody unsubscribed or suppressed is ever emailed, and every change sends the same webhooks and updates the same integrations.
        </p>
      </div>
      <ol className="space-y-5">
        <li className="space-y-2">
          <h3 className="text-strong font-medium text-[var(--text-primary)]">1. Create a key</h3>
          <p className="text-body text-[var(--text-secondary)]">Read keys can only look; write keys can change things. A key is shown once, so keep it somewhere safe.</p>
          <button type="button" onClick={onCreateKey} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-body font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]">
            <Key className="h-3.5 w-3.5" /> Go to API keys
          </button>
        </li>
        <li className="space-y-2">
          <h3 className="text-strong font-medium text-[var(--text-primary)]">2. Check it works</h3>
          <Code label="first request">{codeSamples(me, base).curl}</Code>
        </li>
        <li className="space-y-2">
          <h3 className="text-strong font-medium text-[var(--text-primary)]">3. Or skip the code</h3>
          <p className="text-body text-[var(--text-secondary)]">Zapier, Make and n8n connect with the same key. Import the OpenAPI file into Postman or Insomnia to have every endpoint ready to call.</p>
        </li>
      </ol>
      <div className="space-y-3">
        <h3 className="text-strong font-medium text-[var(--text-primary)]">How it behaves, everywhere</h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          {[
            ['Base URL', base],
            ['Version', `${PUBLIC_API_VERSION}, sent back in the Sincerely-Api-Version header. Changes that could break you get a new version.`],
            ['Paging', 'Lists come newest first as { data, has_more, next_cursor }. Pass next_cursor back as cursor. limit is 1 to 100.'],
            ['Safe retries', 'Send an Idempotency-Key header on a write. The same key within 24 hours returns the first answer rather than acting twice.'],
            ['Rate limit', 'Per key, per minute. X-RateLimit-Remaining says how many are left; a 429 says how long to wait in Retry-After.'],
            ['Blank vs clear', 'null clears a field. An empty string is treated as not sent, so an unmapped field in Zapier or Make never wipes your data.'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-[var(--border-subtle)] p-3">
              <dt className="text-body font-medium text-[var(--text-primary)]">{k}</dt>
              <dd className="text-body text-[var(--text-secondary)] mt-0.5 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function ErrorsView() {
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView({ block: 'center' });
  }, []);
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="space-y-2">
        <h2 className="text-title font-semibold text-[var(--text-primary)]">Errors</h2>
        <p className="text-body text-[var(--text-secondary)]">Every error has the same shape, with an HTTP status to match. Branch on <code className="font-mono">code</code>; show <code className="font-mono">message</code> to people. Quote <code className="font-mono">request_id</code> if you ask us for help.</p>
      </div>
      <Code label="error example">{JSON.stringify({ error: { type: 'invalid_request_error', code: 'parameter_invalid', message: '"not-an-email" is not a valid email address.', param: 'email', doc_url: '...' }, request_id: 'req_3f9a1c0b7e2d4a5c6b81' }, null, 2)}</Code>
      <div className="rounded-lg border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
        {API_ERROR_CODES.map((e) => (
          <div key={e.code} id={`error-${e.code}`} className="px-3 py-2.5 grid gap-1 sm:grid-cols-[minmax(0,220px)_1fr] sm:gap-4 scroll-mt-24 target:bg-[var(--bg-elevated)]">
            <div><code className="text-body font-mono text-[var(--text-primary)]">{e.code}</code><div className="text-caption text-[var(--text-tertiary)]">{e.status} · {e.type}</div></div>
            <p className="text-body text-[var(--text-secondary)]">{e.meaning}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WebhooksView() {
  const [open, setOpen] = useState<string | null>('reply.interested');
  const [lang, setLang] = useState<'node' | 'python'>('node');
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-2">
        <h2 className="text-title font-semibold text-[var(--text-primary)]">Webhooks</h2>
        <p className="text-body text-[var(--text-secondary)]">
          Create one with <code className="font-mono">POST /v1/webhooks</code> and Sincerely sends each event you chose to your https address as it happens,
          with the whole contact and campaign in it, so there is nothing to look up. Failed deliveries are retried twice. An address that answers <code className="font-mono">410 Gone</code> is switched off,
          which is how Zapier and Make unsubscribe.
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-strong font-medium text-[var(--text-primary)] flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> Verifying a delivery</h3>
          <Segmented size="sm" label="Language" value={lang} onChange={setLang} options={[{ value: 'node', label: 'Node.js' }, { value: 'python', label: 'Python' }]} />
        </div>
        <p className="text-body text-[var(--text-secondary)]">
          Each delivery carries <code className="font-mono">{SIGNATURE_HEADER}: t=...,v1=...</code>: an HMAC-SHA256 of the timestamp, a dot and the raw body,
          keyed with the webhook's secret. Check it, and refuse anything more than five minutes old.
        </p>
        <Code label="verification code">{lang === 'node' ? VERIFY_NODE : VERIFY_PYTHON}</Code>
      </div>
      <div className="space-y-2">
        <h3 className="text-strong font-medium text-[var(--text-primary)]">Events</h3>
        <div className="rounded-lg border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
          {PUBLIC_EVENTS.map((e) => (
            <div key={e.type}>
              <button type="button" onClick={() => setOpen(open === e.type ? null : e.type)} aria-expanded={open === e.type}
                className="w-full text-left px-3 py-2.5 grid gap-1 sm:grid-cols-[minmax(0,180px)_1fr] sm:gap-4 hover:bg-[var(--bg-elevated)]">
                <code className="text-body font-mono text-[var(--text-primary)]">{e.type}</code>
                <span className="text-body text-[var(--text-secondary)]">{e.description}</span>
              </button>
              {open === e.type && <div className="px-3 pb-3"><Code label={`${e.type} example`}>{JSON.stringify(publicEventExample(e.type), null, 2)}</Code></div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ObjectsView() {
  return (
    <div className="space-y-8 max-w-3xl">
      <h2 className="text-title font-semibold text-[var(--text-primary)]">Objects</h2>
      {API_OBJECTS.map((o) => (
        <section key={o.name} className="space-y-3">
          <div>
            <h3 className="text-strong font-semibold text-[var(--text-primary)] font-mono">{o.name}</h3>
            <p className="text-body text-[var(--text-secondary)]">{o.description}</p>
          </div>
          <FieldTable title="Fields" fields={o.fields} />
        </section>
      ))}
    </div>
  );
}

export function ApiReference({ onCreateKey }: { onCreateKey: () => void }) {
  const { data: info, isLoading } = useQuery({ queryKey: ['public-api-info'], queryFn: developerApi.info, staleTime: 3600_000 });
  const [section, setSection] = useState<Section>(() => (window.location.hash.startsWith('#error-') ? 'errors' : 'start'));
  const [apiKey, setApiKey] = useState('');
  const base = info?.base_url || '';
  const ep = API_ENDPOINTS.find((e) => e.id === section);

  const navItem = (id: Section, label: React.ReactNode, key?: string) => (
    <button key={key || id} type="button" onClick={() => setSection(id)} aria-current={section === id ? 'page' : undefined}
      className={cn('w-full text-left flex items-center gap-2 px-2 h-7 rounded-md text-body transition-colors',
        section === id ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
      {label}
    </button>
  );

  if (isLoading || !info) {
    return <div className="flex items-center justify-center py-12"><Spinner /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-caption text-[var(--text-tertiary)]">Base URL</span>
          <code className="text-body font-mono text-[var(--text-primary)] truncate">{base}</code>
          <button type="button" aria-label="Copy the base URL" onClick={() => copy(base, 'Base URL copied')} className="icon-btn"><Copy className="h-3.5 w-3.5" /></button>
        </div>
        <span className="text-caption text-[var(--text-tertiary)]">Version {info.version}</span>
        <a href={info.openapi_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-body font-medium text-[var(--indigo-text)] hover:underline">
          OpenAPI file <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="lg:hidden">
        <label htmlFor="api-ref-section" className="sr-only">Section</label>
        <select id="api-ref-section" value={section} onChange={(e) => setSection(e.target.value)}
          className="w-full rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-2.5 h-9 text-body text-[var(--text-primary)]">
          <option value="start">Getting started</option>
          <option value="objects">Objects</option>
          <option value="errors">Errors</option>
          <option value="webhooks">Webhooks and signatures</option>
          {API_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {API_ENDPOINTS.filter((e) => e.group === g).map((e) => <option key={e.id} value={e.id}>{e.method} {e.summary}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="API reference" className="hidden lg:block space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto pr-1">
          <div className="space-y-0.5">
            {navItem('start', <><BookOpen className="h-3.5 w-3.5" /> Getting started</>)}
            {navItem('objects', <><span className="w-3.5 text-center font-mono text-caption">{'{}'}</span> Objects</>)}
            {navItem('errors', <><TriangleAlert className="h-3.5 w-3.5" /> Errors</>)}
            {navItem('webhooks', <><Webhook className="h-3.5 w-3.5" /> Webhooks</>)}
          </div>
          {API_GROUPS.map((g) => (
            <div key={g}>
              <p className="px-2 mb-1 text-caption font-medium text-[var(--text-tertiary)]">{g}</p>
              <div className="space-y-0.5">
                {API_ENDPOINTS.filter((e) => e.group === g).map((e) =>
                  navItem(e.id, <><span className={cn('w-10 shrink-0 font-mono text-micro font-semibold', {
                    GET: 'text-sky-600 dark:text-sky-400', POST: 'text-emerald-600 dark:text-emerald-400',
                    PATCH: 'text-amber-600 dark:text-amber-400', DELETE: 'text-rose-600 dark:text-rose-400',
                  }[e.method])}>{e.method}</span><span className="truncate">{e.summary}</span></>))}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-w-0">
          {section === 'start' && <StartView base={base} onCreateKey={onCreateKey} />}
          {section === 'objects' && <ObjectsView />}
          {section === 'errors' && <ErrorsView />}
          {section === 'webhooks' && <WebhooksView />}
          {ep && <EndpointView ep={ep} base={base} apiKey={apiKey} setApiKey={setApiKey} />}
        </div>
      </div>
    </div>
  );
}


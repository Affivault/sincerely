/* ═══════════════════════════════════════════════════════════════════════
   Connect many mailboxes at once.

   Agencies and anyone running a sending fleet add inboxes by the dozen, and
   the one-at-a-time wizard is the wrong tool for that. This takes a CSV -
   pasted or uploaded - fills in each row's servers the same way the wizard
   does (a known provider from the address, else the domain's mail records),
   then connects them through the same test-before-save path, two at a time,
   with a live status per row. Nothing that fails its test is saved, and the
   reason is on its row; fix the file and run it again - rows already
   connected are recognised and skipped.
   ═══════════════════════════════════════════════════════════════════════ */

import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileUp, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { SMTP_PRESETS, detectPresetFromEmail } from '@lemlist/shared';
import type { SmtpAccount } from '@lemlist/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { smtpApi } from '../../api/smtp.api';
import { cn } from '../../lib/utils';

const TEMPLATE = 'email,password,from_name,smtp_host,smtp_port,imap_host,imap_port,daily_limit\n'
  + 'jane@yourcompany.com,app-password-here,Jane Doe,,,,,50\n';

const HINT_TO_PRESET: Record<string, string> = {
  'Google Workspace': 'Google Workspace', 'Microsoft 365': 'Outlook / Microsoft 365', 'Zoho Mail': 'Zoho Mail',
  Fastmail: 'Fastmail', Spacemail: 'Spacemail', 'Namecheap Private Email': 'Namecheap Private Email', Titan: 'Titan', 'Yahoo Mail': 'Yahoo Mail',
};

type RowState = 'ready' | 'skipped' | 'working' | 'connected' | 'failed' | 'invalid';
interface Row {
  line: number;
  email: string;
  password: string;
  from_name: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  imap_host: string;
  imap_port: number;
  daily_limit: number;
  state: RowState;
  note: string;
}

const pick = (r: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) {
    const hit = Object.keys(r).find((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_') === k);
    if (hit && String(r[hit] ?? '').trim()) return String(r[hit]).trim();
  }
  return '';
};

function parse(text: string, existing: Set<string>): Row[] {
  const out = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  return out.data.slice(0, 200).map((r, i) => {
    const email = pick(r, 'email', 'email_address', 'address').toLowerCase();
    const password = pick(r, 'password', 'app_password', 'smtp_password', 'pass');
    const smtpPort = Number(pick(r, 'smtp_port')) || 0;
    const row: Row = {
      line: i + 2,
      email,
      password,
      from_name: pick(r, 'from_name', 'name', 'sender_name'),
      smtp_host: pick(r, 'smtp_host', 'smtp_server'),
      smtp_port: smtpPort,
      smtp_secure: smtpPort ? smtpPort === 465 : true,
      imap_host: pick(r, 'imap_host', 'imap_server'),
      imap_port: Number(pick(r, 'imap_port')) || 0,
      // Never above the level the connect form calls safe for a new mailbox.
      daily_limit: Math.min(Math.max(1, Number(pick(r, 'daily_limit', 'limit')) || 50), 200),
      state: 'ready',
      note: '',
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ...row, state: 'invalid', note: 'Not an email address' };
    if (!password) return { ...row, state: 'invalid', note: 'No password' };
    if (existing.has(email)) return { ...row, state: 'skipped', note: 'Already connected' };
    return row;
  });
}

/** Fill in missing servers: a known provider first, else what the domain's MX records say. */
async function fillServers(row: Row, cache: Map<string, any>): Promise<Row> {
  if (row.smtp_host) {
    return { ...row, smtp_port: row.smtp_port || 465, imap_port: row.imap_port || (row.imap_host ? 993 : 0) };
  }
  let preset = detectPresetFromEmail(row.email);
  let hosts: any = null;
  if (!preset) {
    const domain = row.email.split('@')[1];
    if (!cache.has(domain)) cache.set(domain, await smtpApi.checkDomain(domain).catch(() => null));
    const found = cache.get(domain);
    const name = found?.provider_hint ? HINT_TO_PRESET[found.provider_hint] : undefined;
    preset = (name && SMTP_PRESETS.find((p) => p.name === name)) || null;
    hosts = found?.hosts || null;
  }
  if (preset) {
    return {
      ...row,
      smtp_host: preset.smtp_host, smtp_port: preset.smtp_port, smtp_secure: preset.smtp_secure,
      imap_host: row.imap_host || preset.imap_host || '', imap_port: row.imap_port || preset.imap_port || 993,
    };
  }
  if (hosts?.smtp?.host) {
    return {
      ...row,
      smtp_host: hosts.smtp.host, smtp_port: hosts.smtp.port ?? 465, smtp_secure: hosts.smtp.secure ?? true,
      imap_host: row.imap_host || hosts.imap?.host || '', imap_port: row.imap_port || hosts.imap?.port || 993,
    };
  }
  return { ...row, state: 'failed', note: 'Could not find this domain\'s mail servers - add smtp_host and imap_host columns' };
}

export function BulkConnect({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: SmtpAccount[] }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [running, setRunning] = useState(false);
  const known = useMemo(() => new Set(existing.map((a) => a.email_address.toLowerCase())), [existing]);

  const update = (line: number, patch: Partial<Row>) =>
    setRows((prev) => prev?.map((r) => (r.line === line ? { ...r, ...patch } : r)) ?? prev);

  const preview = () => setRows(parse(text, known));

  const run = async () => {
    if (!rows) return;
    setRunning(true);
    const cache = new Map<string, any>();
    const queue = rows.filter((r) => r.state === 'ready' || r.state === 'failed');
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        update(r.line, { state: 'working', note: 'Testing…' });
        const filled = await fillServers(r, cache);
        if (filled.state === 'failed') { update(r.line, { state: 'failed', note: filled.note }); continue; }
        try {
          await smtpApi.create({
            label: filled.email,
            email_address: filled.email,
            from_name: filled.from_name || null,
            smtp_host: filled.smtp_host,
            smtp_port: filled.smtp_port,
            smtp_secure: filled.smtp_secure,
            smtp_user: filled.email,
            smtp_pass: filled.password,
            imap_host: filled.imap_host || undefined,
            imap_port: filled.imap_port || undefined,
            imap_secure: true,
            daily_send_limit: filled.daily_limit,
          }, { verify: true });
          update(r.line, { state: 'connected', note: filled.imap_host ? 'Sending and receiving work' : 'Sending works (no incoming server)' });
        } catch (err: any) {
          const v = err.response?.data?.verification;
          const reason = v
            ? (v.smtp && !v.smtp.ok ? v.smtp.message : v.imap?.message) || v.message
            : err.response?.data?.error || err.message;
          update(r.line, { state: 'failed', note: reason || 'Did not connect' });
          // A plan limit stops every remaining row the same way; stop asking.
          if (err.response?.status === 403) { queue.length = 0; }
        }
      }
    };
    await Promise.all([worker(), worker()]);
    setRunning(false);
    qc.invalidateQueries({ queryKey: ['smtp-accounts'] });
    qc.invalidateQueries({ queryKey: ['inbox-sync-progress'] });
  };

  const counts = useMemo(() => {
    const c: Record<RowState, number> = { ready: 0, skipped: 0, working: 0, connected: 0, failed: 0, invalid: 0 };
    for (const r of rows || []) c[r.state]++;
    return c;
  }, [rows]);

  const close = () => { if (!running) { setRows(null); setText(''); onClose(); } };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title="Connect mailboxes in bulk"
      description="One row per mailbox. Servers are found for you; each mailbox is tested before it is saved."
      size="2xl"
      footer={
        rows ? (
          <>
            <Button variant="secondary" className="mr-auto" onClick={() => setRows(null)} disabled={running}>Edit the list</Button>
            <Button variant="secondary" onClick={close} disabled={running}>{counts.connected > 0 && !running ? 'Done' : 'Cancel'}</Button>
            <Button onClick={run} disabled={running || counts.ready + counts.failed === 0}>
              {running ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…</> : counts.failed > 0 && counts.ready === 0 ? `Retry ${counts.failed} failed` : `Connect ${counts.ready} mailbox${counts.ready === 1 ? '' : 'es'}`}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button onClick={preview} disabled={!text.trim()}>Check the list</Button>
          </>
        )
      }
    >
      {!rows ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-default)] px-3 text-caption font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              <FileUp className="h-3.5 w-3.5" /> Upload CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) f.text().then(setText);
                e.target.value = '';
              }}
            />
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
              download="sincerely-mailboxes.csv"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-caption font-medium text-[var(--indigo)] hover:underline"
            >
              <Download className="h-3.5 w-3.5" /> Template
            </a>
            <span className="text-caption text-[var(--text-tertiary)]">or paste below. Up to 200 at a time.</span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder={TEMPLATE}
            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 font-data text-caption text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none"
          />
          <p className="text-caption leading-snug text-[var(--text-tertiary)]">
            Required: <span className="font-medium text-[var(--text-secondary)]">email</span> and <span className="font-medium text-[var(--text-secondary)]">password</span> (an app password for Google, Microsoft and Zoho).
            Optional: from_name, daily_limit (defaults to 50), and smtp_host / smtp_port / imap_host / imap_port for servers we cannot find ourselves.
            Passwords go straight to the server and are stored encrypted.
          </p>
        </div>
      ) : (
        <div>
          <div className="mb-2 flex flex-wrap gap-3 text-caption text-[var(--text-secondary)]">
            <span><span className="font-semibold text-[var(--text-primary)]">{rows.length}</span> rows</span>
            {counts.connected > 0 && <span className="text-emerald-600 dark:text-emerald-400">{counts.connected} connected</span>}
            {counts.failed > 0 && <span className="text-rose-600 dark:text-rose-400">{counts.failed} failed</span>}
            {counts.skipped > 0 && <span>{counts.skipped} already connected</span>}
            {counts.invalid > 0 && <span className="text-amber-600 dark:text-amber-400">{counts.invalid} need fixing in the file</span>}
          </div>
          <div className="max-h-[420px] overflow-y-auto rounded-xl border border-[var(--border-subtle)]">
            <ul className="divide-y divide-[var(--border-subtle)]">
              {rows.map((r) => (
                <li key={r.line} className="flex items-start gap-3 px-3 py-2">
                  <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {r.state === 'working' && <Loader2 className="h-4 w-4 animate-spin text-[var(--indigo)]" />}
                    {r.state === 'connected' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    {(r.state === 'failed' || r.state === 'invalid') && <XCircle className={cn('h-4 w-4', r.state === 'failed' ? 'text-rose-500' : 'text-amber-500')} />}
                    {r.state === 'skipped' && <MinusCircle className="h-4 w-4 text-[var(--text-muted)]" />}
                    {r.state === 'ready' && <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-[var(--text-primary)]">{r.email || <span className="text-[var(--text-tertiary)]">Row {r.line}</span>}</span>
                    {r.note && (
                      <span className={cn('block text-caption leading-snug', r.state === 'failed' ? 'text-rose-600 dark:text-rose-400' : r.state === 'invalid' ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--text-tertiary)]')}>
                        {r.note}
                      </span>
                    )}
                  </span>
                  <span className="flex-shrink-0 text-micro text-[var(--text-muted)]">line {r.line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

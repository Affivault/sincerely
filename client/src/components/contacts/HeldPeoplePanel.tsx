import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Download, Linkedin, Loader2, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { HeldPerson } from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { useConfirm } from '../ui/ConfirmDialog';
import { downloadCsv, csvDate } from '../../lib/csv';
import { LightDot } from './EmailLights';
import { keepPrevious } from '../../lib/listQuery';
import { Refreshing } from '../ui/Refreshing';

/* ═══════════════════════════════════════════════════════════════════════
   The "No email" light: people imported without a usable address, held
   in their list. Never emailed. Typing an address in turns one into an
   ordinary lead (or contact) in the same list; re-importing the fixed file
   does the same for everyone it now has an address for.
   ═══════════════════════════════════════════════════════════════════════ */

const PAGE = 50;

export function HeldPeoplePanel({ listId, lifecycle, search, noun, kind }: {
  listId?: string;
  lifecycle: string;
  search?: string;
  noun: 'lead' | 'contact';
  kind: 'lead' | 'contact';
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ['held-people', listId, lifecycle, search, page],
    queryFn: () => contactsApi.heldList({ list_id: listId, lifecycle, search, page, limit: PAGE }),
    // Paging keeps the page on screen until the next one arrives.
    ...keepPrevious,
  });
  const rows = data?.data || [];
  const total = data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const refresh = () => {
    for (const k of ['held-people', 'verification-breakdown', 'contacts', 'lists']) qc.invalidateQueries({ queryKey: [k] });
  };

  const save = async (p: HeldPerson) => {
    const email = (drafts[p.id] || '').trim();
    if (!email) return;
    setSaving(p.id);
    try {
      await contactsApi.heldAddEmail(p.id, email);
      toast.success(`${[p.first_name, p.last_name].filter(Boolean).join(' ') || 'They'} moved into your ${noun}s`);
      setDrafts((d) => { const n = { ...d }; delete n[p.id]; return n; });
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not add that email');
    } finally {
      setSaving(null);
    }
  };

  const remove = (ids: string[], what: string) => confirm({
    title: `Delete ${what}?`,
    body: 'They are removed from Sincerely. Re-importing the file brings them back.',
    tone: 'danger',
  }, async () => {
    try {
      const r = await contactsApi.heldDelete(ids);
      toast.success(`Deleted ${r.deleted.toLocaleString()}`);
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Could not delete');
    }
  });

  // Everyone held here, as a file to research and re-import.
  const downloadAll = async () => {
    try {
      const all: HeldPerson[] = [];
      for (let p = 1; p <= 100; p++) {
        const r = await contactsApi.heldList({ list_id: listId, lifecycle, search, page: p, limit: 200 });
        all.push(...r.data);
        if (all.length >= r.total || r.data.length === 0) break;
      }
      const extra = [...new Set(all.flatMap((p) => Object.keys(p.data || {}).filter((k) => typeof p.data[k] !== 'object')))];
      downloadCsv(`${noun}s-without-email-${csvDate()}.csv`,
        ['Email', 'First name', 'Last name', 'Job title', 'Company name', 'LinkedIn', ...extra, 'Imported from'],
        all.map((p) => ['', p.first_name, p.last_name, p.job_title, p.company, p.linkedin_url, ...extra.map((k) => p.data?.[k] ?? ''), p.import_source]));
    } catch {
      toast.error('Download failed');
    }
  };

  if (data?.unavailable) {
    return (
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-body text-[var(--text-secondary)]">
        Keeping people without an email needs the latest database update (migration 110).
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden" data-held-panel>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
        <LightDot light="none" />
        <div className="flex-1 min-w-0">
          <p className="text-body font-semibold text-[var(--text-primary)]">
            {total.toLocaleString()} without an email
          </p>
          <p className="text-caption text-[var(--text-tertiary)]">Never emailed. Add an address and they move into your {noun}s - or download them, find the emails, and re-import the file.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={downloadAll} disabled={total === 0} className="btn-secondary h-8">
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
          <button type="button" onClick={() => navigate(`/contacts/import?as=${kind}`)} className="btn-secondary h-8">
            <Upload className="h-3.5 w-3.5" />
            Re-import
          </button>
          {rows.length > 0 && (
            <button type="button" onClick={() => remove(rows.map((r) => r.id), `these ${rows.length.toLocaleString()}`)} className="icon-btn" aria-label="Delete everyone shown" title="Delete everyone shown">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <Refreshing active={isPlaceholderData}>
      {isLoading ? (
        <div className="p-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /></div>
      ) : rows.length === 0 ? (
        <p className="p-6 text-center text-body text-[var(--text-tertiary)]">Nobody without an email here.</p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {rows.map((p) => {
            const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed';
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0 flex-1 basis-56">
                  <LightDot light="none" />
                  <div className="min-w-0">
                    <p className="text-body font-medium text-[var(--text-primary)] truncate flex items-center gap-1.5">
                      {name}
                      {p.linkedin_url && (
                        <a href={p.linkedin_url} target="_blank" rel="noreferrer" aria-label={`${name} on LinkedIn`} className="text-[#0A66C2] hover:opacity-80">
                          <Linkedin className="h-3 w-3" />
                        </a>
                      )}
                    </p>
                    <p className="text-caption text-[var(--text-tertiary)] truncate">
                      {[p.job_title, p.company].filter(Boolean).join(' · ') || '—'}
                      {p.reason === 'invalid_email' && p.raw_email ? ` · had "${p.raw_email}"` : ''}
                    </p>
                  </div>
                </div>
                <form
                  className="flex items-center gap-1.5 flex-1 basis-64 min-w-0"
                  onSubmit={(e) => { e.preventDefault(); save(p); }}
                >
                  <input
                    type="email"
                    aria-label={`Email for ${name}`}
                    placeholder="Add their email"
                    value={drafts[p.id] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    className="flex-1 min-w-0 h-8 px-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15"
                  />
                  <button type="submit" disabled={!drafts[p.id]?.trim() || saving === p.id} className="btn-primary h-8 px-2.5" aria-label={`Save email for ${name}`}>
                    {saving === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" onClick={() => remove([p.id], name)} className="icon-btn" aria-label={`Delete ${name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      </Refreshing>

      {pages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border-subtle)] text-caption text-[var(--text-tertiary)]">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-1.5">
            <button type="button" className="btn-secondary h-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button type="button" className="btn-secondary h-7" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

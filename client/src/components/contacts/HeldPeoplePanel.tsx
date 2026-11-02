import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AtSign, Check, Download, Linkedin, Loader2, MailX, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { HeldPerson } from '@lemlist/shared';
import { contactsApi } from '../../api/contacts.api';
import { useConfirm } from '../ui/ConfirmDialog';
import { downloadCsv, csvDate } from '../../lib/csv';
import { Avatar } from '../shared/Avatar';
import { cn } from '../../lib/utils';
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
      <div className="card p-4 text-body text-[var(--text-secondary)]">
        Keeping people without an email needs the latest database update (migration 110).
      </div>
    );
  }

  return (
    <section className="card overflow-hidden" data-held-panel aria-label="Missing an email">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 border-b border-[var(--border-subtle)]">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0">
          <MailX className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-[220px]">
          <h2 className="flex items-center gap-2 text-strong font-semibold text-[var(--text-primary)]">
            Missing an email
            <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-[var(--bg-elevated)] text-micro font-semibold tabular text-[var(--text-secondary)]">{total.toLocaleString()}</span>
          </h2>
          <p className="text-caption text-[var(--text-tertiary)]">Never emailed. Add an address and they join your {noun}s straight away.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={downloadAll} disabled={total === 0} className="btn-ghost" title="Download everyone here as a CSV to find their emails">
            <Download className="h-3.5 w-3.5" />
            Download<span className="hidden sm:inline"> to research</span>
          </button>
          <button type="button" onClick={() => navigate(`/contacts/import?as=${kind}`)} className="btn-secondary" title="Re-import the file with emails added - they move in automatically">
            <Upload className="h-3.5 w-3.5" />
            Re-import<span className="hidden sm:inline"> with emails</span>
          </button>
        </div>
      </header>

      <Refreshing active={isPlaceholderData}>
      {isLoading ? (
        <div className="p-8 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /></div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Check className="h-5 w-5" />
          </span>
          <p className="text-body font-medium text-[var(--text-primary)]">Everyone here has an email</p>
          <p className="text-caption text-[var(--text-tertiary)] mt-0.5">People imported without one will wait here until they have.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {rows.map((p) => {
            const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed';
            const draft = drafts[p.id] || '';
            return (
              <li key={p.id} className="group grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-center gap-x-6 gap-y-2 px-4 py-3 hover:bg-[var(--bg-hover)]/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={name} size="sm" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-body font-semibold text-[var(--text-primary)] truncate">
                      <span className="truncate">{name}</span>
                      {p.linkedin_url && (
                        <a href={p.linkedin_url} target="_blank" rel="noreferrer" aria-label={`${name} on LinkedIn`} className="text-[#0A66C2] hover:opacity-75 flex-shrink-0">
                          <Linkedin className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </p>
                    <p className="text-caption text-[var(--text-tertiary)] truncate">
                      {[p.job_title, p.company].filter(Boolean).join(' at ') || 'No title or company'}
                    </p>
                  </div>
                  {p.reason === 'invalid_email' && p.raw_email && (
                    <span className="ml-auto hidden lg:inline-flex items-center h-5 px-1.5 rounded-md bg-rose-500/10 text-micro font-medium text-rose-700 dark:text-rose-400 flex-shrink-0" title="What the file had in the email column">
                      was "{p.raw_email.slice(0, 24)}"
                    </span>
                  )}
                </div>
                <form className="flex items-center gap-1.5 min-w-0" onSubmit={(e) => { e.preventDefault(); save(p); }}>
                  <div className="relative flex-1 min-w-0">
                    <AtSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
                    <input
                      type="email"
                      aria-label={`Email for ${name}`}
                      placeholder="name@company.com"
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      className="w-full h-8 pl-8 pr-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none transition-colors focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!draft.trim() || saving === p.id}
                    className={cn('flex-shrink-0 min-w-[52px]', draft.trim() ? 'btn-primary' : 'btn-secondary')}
                    aria-label={`Save email for ${name}`}
                  >
                    {saving === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove([p.id], name)}
                    className="icon-btn flex-shrink-0 opacity-60 hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Delete ${name}`}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
      </Refreshing>

      {(pages > 1 || rows.length > 1) && (
        <footer className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 text-caption text-[var(--text-tertiary)]">
          <button type="button" onClick={() => remove(rows.map((r) => r.id), `these ${rows.length.toLocaleString()} people`)} className="inline-flex items-center gap-1.5 hover:text-rose-600">
            <Trash2 className="h-3 w-3" />
            Delete the {rows.length.toLocaleString()} shown
          </button>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <span className="tabular">Page {page} of {pages}</span>
              <button type="button" className="btn-secondary h-7" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>Previous</button>
              <button type="button" className="btn-secondary h-7" disabled={page >= pages} onClick={() => setPage((x) => x + 1)}>Next</button>
            </div>
          )}
        </footer>
      )}
    </section>
  );
}

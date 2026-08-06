import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { companiesApi } from '../../api/companies.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { EmptyState } from '../../components/shared/EmptyState';
import { SearchInput } from '../../components/shared/SearchInput';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useDebounce } from '../../hooks/useDebounce';
import { usePeek } from '../../components/peek/usePeek';
import { cn } from '../../lib/utils';
import { Building2, Plus, Users, Handshake, Globe, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Company } from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Companies.

   Account-shaped view of the same data: who works where, what's open there,
   how much it's worth. Impossible before, because "company" was free text
   on a contact rather than a record anything could point at.
   ═══════════════════════════════════════════════════════════════════════ */

function NewCompanyModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', domain: '', industry: '', location: '' });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => companiesApi.create({
      name: form.name.trim(),
      domain: form.domain.trim() || null,
      industry: form.industry.trim() || null,
      location: form.location.trim() || null,
    }),
    onSuccess: (company) => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      // createOrGet is deliberately forgiving — say which happened.
      toast.success(`Saved ${company.name}`);
      onClose();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Could not save that'),
  });

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="New company"
      description="If this company already exists under a different spelling, you'll get that one back rather than a duplicate."
      size="md"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="company-form" disabled={!form.name.trim() || save.isPending}>
            {save.isPending ? 'Saving…' : 'Create'}
          </Button>
        </div>
      }
    >
      <form id="company-form" onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) save.mutate(); }} className="space-y-3">
        <Input label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Acme" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Domain" value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="acme.com" />
          <Input label="Industry" value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="Fintech" />
        </div>
        <Input label="Location" value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="London, UK" />
      </form>
    </Modal>
  );
}

export function CompaniesPage() {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 250);
  const [showNew, setShowNew] = useState(false);
  const { openPeek } = usePeek();

  const { data: companies = [], isLoading, error } = useQuery({
    queryKey: ['companies', debounced],
    queryFn: () => companiesApi.list(debounced || undefined),
  });

  // The migration is opt-in, so a 503 here means "not set up yet", not broken.
  const needsMigration = (error as any)?.response?.status === 503;

  return (
    <div>
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(99,102,241,0.18)]">
            <Building2 className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Companies"
        description={
          companies.length > 0
            ? `${companies.length} account${companies.length === 1 ? '' : 's'} — who works where, and what's open there`
            : 'Accounts, their people, and the deals attached to them'
        }
        actions={
          <div className="flex items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search companies…" className="hidden sm:block w-56" />
            <button onClick={() => setShowNew(true)} className="btn-primary">
              <Plus className="h-3.5 w-3.5" /> New company
            </button>
          </div>
        }
      />

      {needsMigration ? (
        <div className="panel px-5 py-8 text-center">
          <Building2 className="h-6 w-6 mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-[14px] font-semibold text-[var(--text-primary)]">Companies aren't set up yet</p>
          <p className="text-[12.5px] text-[var(--text-tertiary)] mt-1 max-w-md mx-auto">
            Run migration <span className="font-mono text-[11.5px]">038_companies.sql</span> in Supabase, then
            preview the backfill before letting it group your existing contacts.
          </p>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : companies.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={Building2}
            title={debounced ? `No companies match “${debounced}”` : 'No companies yet'}
            description={
              debounced
                ? 'Try a different name, domain or industry.'
                : "Companies group your contacts by where they work. Create one, or run the backfill to build them from the company names already on your contacts."
            }
            actionLabel="New company"
            onAction={() => setShowNew(true)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {companies.map((c: Company) => (
            <button
              key={c.id}
              onClick={() => openPeek('company', c.id)}
              className="panel p-4 text-left hover:border-[var(--indigo)]/40 hover:bg-[var(--bg-hover)] transition-colors"
            >
              <div className="flex items-start gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0">
                  <Building2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-[var(--text-primary)] truncate">{c.name}</p>
                  <p className="text-[11.5px] text-[var(--text-tertiary)] truncate">
                    {[c.industry, c.location].filter(Boolean).join(' · ') || c.domain || 'No details yet'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-3 text-[11.5px] text-[var(--text-secondary)]">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3 text-[var(--text-tertiary)]" />
                  {c.contact_count ?? 0} {c.contact_count === 1 ? 'person' : 'people'}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Handshake className="h-3 w-3 text-[var(--text-tertiary)]" />
                  {c.deal_count ?? 0} {c.deal_count === 1 ? 'deal' : 'deals'}
                </span>
                {c.domain && (
                  <span className="inline-flex items-center gap-1 truncate ml-auto text-[var(--text-tertiary)]">
                    <Globe className="h-3 w-3" />{c.domain}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {showNew && <NewCompanyModal onClose={() => setShowNew(false)} />}
    </div>
  );
}

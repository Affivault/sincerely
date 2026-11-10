import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  ListPlus,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
  MinusCircle,
} from 'lucide-react';
import {
  CRM_SINCERELY_FIELDS,
  CRM_SYNC_KIND_LABEL,
  formatDateTime,
  type CrmFieldDirection,
  type CrmFieldMap,
  type CrmSyncLogEntry,
  type CrmSyncProvider,
  type CrmSyncSettings,
} from '@lemlist/shared';
import { integrationsApi } from '../../api/integrations.api';
import { listsApi } from '../../api/contacts.api';
import { PageHeader } from '../../components/shared/PageHeader';
import { Notice } from '../../components/ui/Notice';
import { Toggle } from '../../components/ui/Toggle';
import { Segmented } from '../../components/ui/Segmented';
import { Button } from '../../components/ui/Button';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Two-way HubSpot / Pipedrive sync: what travels, the field mapping, the
   deal pipeline, lists kept in step, and a log of everything that moved
   or failed, with retry.
   ═══════════════════════════════════════════════════════════════════════ */

const NAME: Record<CrmSyncProvider, string> = { hubspot: 'HubSpot', pipedrive: 'Pipedrive' };
const LIST_WORD: Record<CrmSyncProvider, string> = { hubspot: 'list', pipedrive: 'filter' };

const errorOf = (err: any, fallback: string) => err?.response?.data?.error || err?.message || fallback;

const CARD = 'rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 space-y-3';
const SELECT =
  'h-8 rounded-md border border-[var(--border-control)] bg-[var(--bg-app)] px-2 text-body text-[var(--text-primary)] hover:border-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none min-w-0';

const DIRECTION_LABEL: Record<CrmFieldDirection, string> = {
  both: 'Both ways',
  to_crm: 'Sincerely to CRM',
  from_crm: 'CRM to Sincerely',
};

function sameSettings(a: CrmSyncSettings | null, b: CrmSyncSettings | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function CrmSyncPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const overviewQuery = useQuery({
    queryKey: ['crm-sync', id],
    queryFn: () => integrationsApi.sync.overview(id),
    refetchInterval: 60_000,
  });
  const overview = overviewQuery.data;
  const provider = overview?.provider ?? 'hubspot';
  const crm = NAME[provider];

  const optionsQuery = useQuery({
    queryKey: ['crm-sync-options', id],
    queryFn: () => integrationsApi.sync.options(id),
    enabled: !!overview && !overview.unavailable,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const options = optionsQuery.data;

  const listsQuery = useQuery({ queryKey: ['lists', 'all'], queryFn: () => listsApi.list() });

  // Settings edited on the page, saved together.
  const [draft, setDraft] = useState<CrmSyncSettings | null>(null);
  useEffect(() => {
    if (overview && !draft) setDraft(overview.settings);
  }, [overview, draft]);
  const dirty = !!draft && !!overview && !sameSettings(draft, overview.settings);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['crm-sync', id] });
    queryClient.invalidateQueries({ queryKey: ['crm-sync-log', id] });
  };

  const save = useMutation({
    mutationFn: () => integrationsApi.sync.saveSettings(id, draft!),
    onSuccess: (settings) => {
      queryClient.setQueryData(['crm-sync', id], (old: any) => (old ? { ...old, settings } : old));
      setDraft(settings);
      toast.success('Sync settings saved');
    },
    onError: (err) => toast.error(errorOf(err, 'Could not save the settings')),
  });

  const runNow = useMutation({
    mutationFn: () => integrationsApi.sync.run(id),
    onSuccess: (r) => {
      refresh();
      if (r.error) toast.error(`Synced with problems: ${r.error}`);
      else toast.success(`Synced: ${r.people_updated} updated here, ${r.pushed} sent to ${crm}${r.deals ? `, ${r.deals} deal${r.deals === 1 ? '' : 's'} acted on` : ''}`);
    },
    onError: (err) => toast.error(errorOf(err, 'The sync did not run')),
  });

  const retryAll = useMutation({
    mutationFn: () => integrationsApi.sync.retryAll(id),
    onSuccess: (r) => {
      refresh();
      toast.success(r.retried ? `${r.fixed} of ${r.retried} went through` : 'Nothing to retry');
    },
    onError: (err) => toast.error(errorOf(err, 'Could not retry')),
  });

  if (overviewQuery.isLoading) {
    return <p className="text-body text-[var(--text-tertiary)]">Loading the sync…</p>;
  }
  if (overviewQuery.isError || !overview) {
    return (
      <div className="space-y-4">
        <Link to="/integrations" className="text-body text-[var(--indigo-text)] hover:underline">Back to Integrations</Link>
        <Notice tone="negative" title="This sync could not be opened">
          {errorOf(overviewQuery.error, 'It may have been disconnected.')}
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        icon={ArrowLeftRight}
        title={`${crm} two-way sync`}
        breadcrumbs={[{ label: 'Integrations', href: '/integrations' }, { label: `${crm} sync` }]}
        description={`People, edits, activity, deals, unsubscribes and ${LIST_WORD[provider]}s between Sincerely and ${crm}. Runs every 15 minutes.`}
        meta={
          <>
            <span>{overview.last_sync_at ? `Last sync ${formatDateTime(overview.last_sync_at)}` : 'Not synced yet'}</span>
            {overview.next_sync_at && (
              <>
                <span className="text-[var(--text-tertiary)]">·</span>
                <span>Next {formatDateTime(overview.next_sync_at)}</span>
              </>
            )}
          </>
        }
        actions={
          <Button onClick={() => runNow.mutate()} disabled={runNow.isPending || !!overview.unavailable}>
            {runNow.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {runNow.isPending ? 'Syncing…' : 'Sync now'}
          </Button>
        }
      />

      {overview.unavailable && (
        <Notice tone="attention" title="One database update to go">
          Two-way sync needs migration 118 run in Supabase. Until then, replies and interested leads are still sent to {crm} as before.
        </Notice>
      )}

      {overview.last_sync_error && !overview.unavailable && (
        <Notice tone="negative" title="Part of the last sync did not run">
          {overview.last_sync_error}
        </Notice>
      )}

      {/* At a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={`People linked to ${crm}`} value={overview.linked.toLocaleString()} />
        <Stat label={`Sent to ${crm} (24h)`} value={overview.moved_24h.to_crm.toLocaleString()} icon={<ArrowUpRight className="h-3.5 w-3.5" />} />
        <Stat label={`From ${crm} (24h)`} value={overview.moved_24h.from_crm.toLocaleString()} icon={<ArrowDownLeft className="h-3.5 w-3.5" />} />
        <Stat
          label="Failed (24h)"
          value={overview.failed_24h.toLocaleString()}
          tone={overview.failed_24h ? 'bad' : undefined}
          action={
            overview.retryable > 0 ? (
              <button
                onClick={() => retryAll.mutate()}
                disabled={retryAll.isPending}
                className="inline-flex items-center gap-1 text-caption font-medium text-[var(--indigo-text)] hover:underline disabled:opacity-50"
              >
                {retryAll.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Retry {overview.retryable}
              </button>
            ) : null
          }
        />
      </div>

      {optionsQuery.data?.warnings?.length ? (
        <Notice tone="attention" title={`Some of ${crm} could not be read`}>
          <ul className="list-disc pl-4 space-y-0.5">
            {optionsQuery.data.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </Notice>
      ) : null}
      {optionsQuery.isError && (
        <Notice tone="attention">{errorOf(optionsQuery.error, `${crm} could not be read for the choices below.`)}</Notice>
      )}

      {draft && (
        <>
          {/* What travels */}
          <section className={CARD}>
            <h2 className="text-strong font-semibold text-[var(--text-primary)]">What syncs</h2>
            <div className="space-y-1.5">
              <p className="text-body text-[var(--text-secondary)]">Put people in {crm}</p>
              <Segmented
                label={`When people are put in ${crm}`}
                value={draft.push_when}
                onChange={(v) => setDraft({ ...draft, push_when: v })}
                options={[
                  { value: 'replied', label: 'When they reply' },
                  { value: 'sent', label: 'When the first email goes out' },
                  { value: 'off', label: `Only people already in ${crm}` },
                ]}
              />
              <p className="text-caption text-[var(--text-tertiary)]">
                Everyone {crm} has (matched by email) gets their emails, replies and Relay's read on the {crm} timeline either way.
                Choose which events go on it under Manage on the Integrations page.
              </p>
            </div>
            <ToggleRow
              label={`Edits in ${crm} come back into Sincerely`}
              hint="When both sides changed the same field, the most recent edit wins."
              checked={draft.pull_updates}
              onChange={(v) => setDraft({ ...draft, pull_updates: v })}
            />
            <ToggleRow
              label="Unsubscribes and bounces both ways"
              hint={`Unsubscribing here opts them out in ${crm}; an opt-out${provider === 'hubspot' ? ' or hard bounce' : ''} in ${crm} unsubscribes them here and stops their sequences.`}
              checked={draft.sync_optouts}
              onChange={(v) => setDraft({ ...draft, sync_optouts: v })}
            />
          </section>

          {/* Deals */}
          <section className={CARD}>
            <h2 className="text-strong font-semibold text-[var(--text-primary)]">Deals</h2>
            <p className="text-body text-[var(--text-secondary)]">
              An interested or meeting reply opens a deal for them (switch it off under Manage on the Integrations page).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="block text-body font-medium text-[var(--text-secondary)]">Pipeline</span>
                <select
                  className={cn(SELECT, 'w-full')}
                  value={draft.deal_pipeline}
                  onChange={(e) => setDraft({ ...draft, deal_pipeline: e.target.value, deal_stage: '' })}
                >
                  <option value="">{crm}'s default pipeline</option>
                  {(options?.pipelines || []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  {draft.deal_pipeline && !options?.pipelines.some((p) => p.id === draft.deal_pipeline) && (
                    <option value={draft.deal_pipeline}>Pipeline {draft.deal_pipeline}</option>
                  )}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-body font-medium text-[var(--text-secondary)]">Stage</span>
                <select
                  className={cn(SELECT, 'w-full')}
                  value={draft.deal_stage}
                  disabled={!draft.deal_pipeline}
                  onChange={(e) => setDraft({ ...draft, deal_stage: e.target.value })}
                >
                  <option value="">The pipeline's first stage</option>
                  {(options?.pipelines.find((p) => p.id === draft.deal_pipeline)?.stages || []).map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-body font-medium text-[var(--text-secondary)]">When a deal is won in {crm}</span>
                <select className={cn(SELECT, 'w-full')} value={draft.on_deal_won} onChange={(e) => setDraft({ ...draft, on_deal_won: e.target.value as any })}>
                  <option value="stop">End their sequences</option>
                  <option value="nothing">Leave their sequences running</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-body font-medium text-[var(--text-secondary)]">When a deal is lost in {crm}</span>
                <select className={cn(SELECT, 'w-full')} value={draft.on_deal_lost} onChange={(e) => setDraft({ ...draft, on_deal_lost: e.target.value as any })}>
                  <option value="stop">End their sequences</option>
                  <option value="nothing">Leave their sequences running</option>
                </select>
              </label>
            </div>
          </section>

          {/* Field mapping */}
          <FieldMapping
            crm={crm}
            mapping={draft.mapping}
            crmFields={options?.fields || []}
            onChange={(mapping) => setDraft({ ...draft, mapping })}
          />

          {dirty && (
          <div className="sticky bottom-3 z-10 flex justify-end gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 shadow-[var(--shadow-md)]">
                <span className="text-body text-[var(--text-secondary)]">Unsaved changes</span>
                <Button variant="ghost" size="sm" onClick={() => setDraft(overview.settings)}>Discard</Button>
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !!overview.unavailable}>
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
          </div>
          )}
        </>
      )}

      <ListSyncs
        integrationId={id}
        provider={provider}
        listSyncs={overview.list_syncs}
        crmLists={options?.lists || []}
        sincerelyLists={(listsQuery.data || []).map((l: any) => ({ id: l.id as string, name: l.name as string }))}
        disabled={!!overview.unavailable}
        onChanged={refresh}
        confirm={confirm}
      />

      <SyncLog integrationId={id} crm={crm} />
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

function Stat({ label, value, icon, tone, action }: { label: string; value: string; icon?: React.ReactNode; tone?: 'bad'; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-4 py-3">
      <div className="flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className={cn('text-xl font-semibold tabular-nums', tone === 'bad' ? 'text-[var(--error)]' : 'text-[var(--text-primary)]')}>{value}</span>
        {action}
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-body font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-caption text-[var(--text-tertiary)]">{hint}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

function FieldMapping({
  crm,
  mapping,
  crmFields,
  onChange,
}: {
  crm: string;
  mapping: CrmFieldMap[];
  crmFields: { key: string; label: string }[];
  onChange: (m: CrmFieldMap[]) => void;
}) {
  const update = (i: number, patch: Partial<CrmFieldMap>) => onChange(mapping.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const usedS = new Set(mapping.map((m) => m.sincerely));
  const usedC = new Set(mapping.map((m) => m.crm));
  const nextFree = CRM_SINCERELY_FIELDS.find((f) => !usedS.has(f.key));
  const crmLabel = (key: string) => crmFields.find((f) => f.key === key)?.label || key;

  return (
    <section className={CARD}>
      <div>
        <h2 className="text-strong font-semibold text-[var(--text-primary)]">Field mapping</h2>
        <p className="text-body text-[var(--text-secondary)]">
          Email is how people are matched, so it is not mapped. A field set to one way only is never overwritten from the other side.
        </p>
      </div>
      <div className="space-y-2">
        {mapping.map((m, i) => {
          const custom = m.sincerely.startsWith('custom:');
          return (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] items-center gap-2 rounded-lg border border-[var(--border-subtle)] p-2 sm:border-0 sm:p-0">
              <div className="flex gap-1.5 min-w-0">
                <select
                  aria-label="Sincerely field"
                  className={cn(SELECT, 'flex-1')}
                  value={custom ? 'custom:' : m.sincerely}
                  onChange={(e) => update(i, { sincerely: e.target.value === 'custom:' ? 'custom:field' : e.target.value })}
                >
                  {CRM_SINCERELY_FIELDS.map((f) => (
                    <option key={f.key} value={f.key} disabled={usedS.has(f.key) && f.key !== m.sincerely}>{f.label}</option>
                  ))}
                  <option value="custom:">Custom field…</option>
                </select>
                {custom && (
                  <input
                    aria-label="Custom field name"
                    className={cn(SELECT, 'flex-1 cursor-text')}
                    value={m.sincerely.slice(7)}
                    maxLength={60}
                    onChange={(e) => update(i, { sincerely: `custom:${e.target.value.replace(/[^A-Za-z0-9 _.-]/g, '')}` })}
                    placeholder="Custom field name"
                  />
                )}
              </div>
              <select
                aria-label="Direction"
                className={SELECT}
                value={m.direction}
                onChange={(e) => update(i, { direction: e.target.value as CrmFieldDirection })}
              >
                {(Object.keys(DIRECTION_LABEL) as CrmFieldDirection[]).map((d) => (
                  <option key={d} value={d}>{DIRECTION_LABEL[d].replace('CRM', crm)}</option>
                ))}
              </select>
              <select aria-label={`${crm} field`} className={SELECT} value={m.crm} onChange={(e) => update(i, { crm: e.target.value })}>
                {!crmFields.some((f) => f.key === m.crm) && <option value={m.crm}>{crmLabel(m.crm)}</option>}
                {crmFields.map((f) => (
                  <option key={f.key} value={f.key} disabled={usedC.has(f.key) && f.key !== m.crm}>{f.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onChange(mapping.filter((_, j) => j !== i))}
                className="justify-self-end p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--bg-hover)]"
                aria-label="Remove this field"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {mapping.length === 0 && <p className="text-body text-[var(--text-tertiary)]">No fields are mapped: only the email address and activity travel.</p>}
      </div>
      <button
        type="button"
        onClick={() => {
          const free = crmFields.find((f) => !usedC.has(f.key));
          onChange([...mapping, { sincerely: nextFree?.key || 'custom:field', crm: free?.key || '', direction: 'both' }]);
        }}
        className="inline-flex items-center gap-1.5 text-body font-medium text-[var(--indigo-text)] hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> Add a field
      </button>
    </section>
  );
}

function ListSyncs({
  integrationId,
  provider,
  listSyncs,
  crmLists,
  sincerelyLists,
  disabled,
  onChanged,
  confirm,
}: {
  integrationId: string;
  provider: CrmSyncProvider;
  listSyncs: { id: string; external_id: string; external_name: string; list_id: string | null; list_name: string | null; enabled: boolean; last_run_at: string | null; last_status: string | null; last_error: string | null }[];
  crmLists: { id: string; name: string; size: number | null }[];
  sincerelyLists: { id: string; name: string }[];
  disabled: boolean;
  onChanged: () => void;
  confirm: ReturnType<typeof useConfirm>;
}) {
  const crm = NAME[provider];
  const word = LIST_WORD[provider];
  const [external, setExternal] = useState('');
  const [target, setTarget] = useState('__new');
  const taken = new Set(listSyncs.map((l) => l.external_id));
  const available = crmLists.filter((l) => !taken.has(l.id));

  const add = useMutation({
    mutationFn: () => {
      const picked = crmLists.find((l) => l.id === external);
      return integrationsApi.sync.addList(integrationId, {
        external_id: external,
        external_name: picked?.name || external,
        ...(target === '__new' ? {} : { list_id: target }),
      });
    },
    onSuccess: (ls) => {
      setExternal('');
      onChanged();
      if (ls.last_error) toast.error(`Added, but the first pull failed: ${ls.last_error}`);
      else toast.success(`${ls.external_name}: ${ls.last_status || 'pulled in'}`);
    },
    onError: (err) => toast.error(errorOf(err, `Could not add the ${word}`)),
  });
  const runList = useMutation({
    mutationFn: (lsId: string) => integrationsApi.sync.runList(integrationId, lsId),
    onSuccess: (r) => { onChanged(); toast.success(`${r.added} added, ${r.updated} updated`); },
    onError: (err) => { onChanged(); toast.error(errorOf(err, 'The pull failed')); },
  });
  const toggle = useMutation({
    mutationFn: ({ lsId, enabled }: { lsId: string; enabled: boolean }) => integrationsApi.sync.updateList(integrationId, lsId, { enabled }),
    onSuccess: onChanged,
    onError: (err) => toast.error(errorOf(err, 'Could not change it')),
  });
  const remove = useMutation({
    mutationFn: (lsId: string) => integrationsApi.sync.removeList(integrationId, lsId),
    onSuccess: () => { onChanged(); toast.success('Stopped. The people already pulled in stay in the list.'); },
    onError: (err) => toast.error(errorOf(err, 'Could not remove it')),
  });

  return (
    <section className={CARD}>
      <div>
        <h2 className="text-strong font-semibold text-[var(--text-primary)]">{crm} {word}s in Sincerely</h2>
        <p className="text-body text-[var(--text-secondary)]">
          Pull a {crm} {word} into a Sincerely list. It is checked every 6 hours: new people are added, nobody is removed.
        </p>
      </div>

      {listSyncs.length > 0 && (
        <ul className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)]">
          {listSyncs.map((ls) => (
            <li key={ls.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-[var(--text-primary)] truncate">
                  {ls.external_name} <span className="text-[var(--text-tertiary)]">into</span>{' '}
                  {ls.list_id ? <Link to={`/leads?list=${ls.list_id}`} className="text-[var(--indigo-text)] hover:underline">{ls.list_name || 'a list'}</Link> : <span className="text-[var(--error)]">a deleted list</span>}
                </p>
                <p className={cn('text-caption', ls.last_error ? 'text-[var(--error)]' : 'text-[var(--text-tertiary)]')}>
                  {ls.last_error || (ls.last_run_at ? `${ls.last_status} · ${formatDateTime(ls.last_run_at)}` : 'Not pulled yet')}
                </p>
              </div>
              <Toggle size="sm" checked={ls.enabled} onChange={(v) => toggle.mutate({ lsId: ls.id, enabled: v })} aria-label={`Keep ${ls.external_name} in step`} />
              <button
                onClick={() => runList.mutate(ls.id)}
                disabled={runList.isPending}
                className="inline-flex items-center gap-1 text-caption font-medium text-[var(--indigo-text)] hover:underline disabled:opacity-50"
              >
                {runList.isPending && runList.variables === ls.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Pull now
              </button>
              <button
                onClick={() =>
                  confirm(
                    { title: `Stop pulling ${ls.external_name}?`, body: 'The people already pulled in stay in the Sincerely list.', confirmLabel: 'Stop' },
                    () => remove.mutate(ls.id),
                  )
                }
                className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--bg-hover)]"
                aria-label={`Stop pulling ${ls.external_name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <select aria-label={`${crm} ${word}`} className={cn(SELECT, 'sm:flex-1')} value={external} onChange={(e) => setExternal(e.target.value)} disabled={disabled}>
          <option value="">Choose a {crm} {word}…</option>
          {available.map((l) => (
            <option key={l.id} value={l.id}>{l.name}{l.size !== null ? ` (${l.size.toLocaleString()})` : ''}</option>
          ))}
        </select>
        <select aria-label="Sincerely list" className={cn(SELECT, 'sm:flex-1')} value={target} onChange={(e) => setTarget(e.target.value)} disabled={disabled}>
          <option value="__new">Into a new list named after it</option>
          {sincerelyLists.map((l) => <option key={l.id} value={l.id}>Into {l.name}</option>)}
        </select>
        <Button onClick={() => add.mutate()} disabled={!external || add.isPending || disabled}>
          {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
          {add.isPending ? 'Pulling in…' : 'Pull in'}
        </Button>
      </div>
      {crmLists.length === 0 && (
        <p className="text-caption text-[var(--text-tertiary)]">
          No {crm} {word}s to choose from{provider === 'hubspot' ? ' (the connection needs the crm.lists.read permission to see them)' : ''}.
        </p>
      )}
    </section>
  );
}

const STATUS_ICON = {
  ok: <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />,
  failed: <XCircle className="h-3.5 w-3.5 text-[var(--error)]" />,
  skipped: <MinusCircle className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />,
};

function SyncLog({ integrationId, crm }: { integrationId: string; crm: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'' | 'failed'>('');
  const [direction, setDirection] = useState<'' | 'to_crm' | 'from_crm'>('');

  const logQuery = useInfiniteQuery({
    queryKey: ['crm-sync-log', integrationId, status, direction],
    queryFn: ({ pageParam }) =>
      integrationsApi.sync.log(integrationId, { status: status || undefined, direction: direction || undefined, before: pageParam || undefined, limit: 50 }),
    initialPageParam: '' as string,
    getNextPageParam: (last) => (last.has_more && last.data.length ? last.data[last.data.length - 1].created_at : undefined),
    refetchInterval: 60_000,
  });
  const rows: CrmSyncLogEntry[] = useMemo(() => (logQuery.data?.pages || []).flatMap((p) => p.data), [logQuery.data]);

  const retry = useMutation({
    mutationFn: (logId: string) => integrationsApi.sync.retry(integrationId, logId),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['crm-sync-log', integrationId] });
      queryClient.invalidateQueries({ queryKey: ['crm-sync', integrationId] });
      if (r.ok) toast.success('It went through');
      else toast.error(r.error || 'It failed again');
    },
    onError: (err) => toast.error(errorOf(err, 'Could not retry')),
  });

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-strong font-semibold text-[var(--text-primary)]">What moved</h2>
        <div className="flex flex-wrap gap-2">
          <Segmented size="sm" label="Status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, { value: 'failed', label: 'Failed' }]} />
          <Segmented
            size="sm"
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={[{ value: '', label: 'Both ways' }, { value: 'to_crm', label: `To ${crm}` }, { value: 'from_crm', label: `From ${crm}` }]}
          />
        </div>
      </div>

      {logQuery.isLoading ? (
        <p className="text-body text-[var(--text-tertiary)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-body text-[var(--text-tertiary)]">
          {status === 'failed' ? 'Nothing has failed.' : `Nothing has moved yet. Replies, Relay reads and the 15-minute sync will show here.`}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-2.5 py-2">
              <span className="mt-0.5 shrink-0">{STATUS_ICON[r.status]}</span>
              <span className="mt-0.5 shrink-0 text-[var(--text-tertiary)]" title={r.direction === 'to_crm' ? `To ${crm}` : `From ${crm}`}>
                {r.direction === 'to_crm' ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body text-[var(--text-primary)] break-words">
                  {r.contact_id ? <Link to={`/contacts/${r.contact_id}`} className="hover:underline">{r.summary}</Link> : r.summary}
                </p>
                {r.error && <p className={cn('text-caption break-words', r.status === 'failed' ? 'text-[var(--error)]' : 'text-[var(--text-tertiary)]')}>{r.error}</p>}
                <p className="text-caption text-[var(--text-tertiary)]">
                  {CRM_SYNC_KIND_LABEL[r.kind] || r.kind} · {formatDateTime(r.created_at)}{r.attempts > 1 ? ` · tried ${r.attempts} times` : ''}
                </p>
              </div>
              {r.retryable && (
                <button
                  onClick={() => retry.mutate(r.id)}
                  disabled={retry.isPending}
                  className="shrink-0 inline-flex items-center gap-1 text-caption font-medium text-[var(--indigo-text)] hover:underline disabled:opacity-50"
                >
                  {retry.isPending && retry.variables === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  Retry
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {logQuery.hasNextPage && (
        <button
          onClick={() => logQuery.fetchNextPage()}
          disabled={logQuery.isFetchingNextPage}
          className="text-body font-medium text-[var(--indigo-text)] hover:underline disabled:opacity-50"
        >
          {logQuery.isFetchingNextPage ? 'Loading…' : 'Show older'}
        </button>
      )}
    </section>
  );
}

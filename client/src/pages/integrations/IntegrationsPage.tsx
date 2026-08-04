import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrationsApi } from '../../api/integrations.api';
import {
  INTEGRATION_CATALOG,
  type IntegrationProviderMeta,
  type UserIntegration,
  type IntegrationResourcesResult,
} from '@lemlist/shared';
import {
  Blocks,
  Slack,
  MessagesSquare,
  Send,
  Zap,
  Workflow,
  Orbit,
  Kanban,
  UsersRound,
  Network,
  NotebookText,
  Table2,
  X,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Loader2,
  Unplug,
  FlaskConical,
  Clock,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { cn, formatDateTime } from '../../lib/utils';
import { PageHeader } from '../../components/shared/PageHeader';
import toast from 'react-hot-toast';

/* ─── Brand tiles ─────────────────────────────────────────────────
   Lucide carries a real Slack mark; the rest get a brand-colored tile
   with an evocative glyph (Zap for Zapier, Orbit for HubSpot, …). */
const BRAND: Record<string, { color: string; icon: React.ElementType }> = {
  slack:     { color: '#4A154B', icon: Slack },
  discord:   { color: '#5865F2', icon: MessagesSquare },
  telegram:  { color: '#229ED9', icon: Send },
  teams:     { color: '#6264A7', icon: UsersRound },
  zapier:    { color: '#FF4F00', icon: Zap },
  make:      { color: '#6D00CC', icon: Workflow },
  n8n:       { color: '#EA4B71', icon: Network },
  hubspot:   { color: '#FF7A59', icon: Orbit },
  pipedrive: { color: '#08A742', icon: Kanban },
  notion:    { color: '#191919', icon: NotebookText },
  airtable:  { color: '#F82B60', icon: Table2 },
};

const KIND_LABELS: Record<string, string> = {
  notification: 'Notifications',
  automation: 'Automation',
  crm: 'CRM sync',
};

const EVENT_LABELS: Record<string, string> = {
  'email.sent': 'Email sent',
  'email.opened': 'Email opened',
  'email.clicked': 'Link clicked',
  'email.replied': 'Reply received',
  'email.bounced': 'Email bounced',
  'campaign.launched': 'Campaign launched',
  'campaign.paused': 'Campaign paused',
  'campaign.completed': 'Campaign completed',
  'lead.unsubscribed': 'Lead unsubscribed',
  'sara.intent_classified': 'SARA classified a reply',
  'contact.created': 'Contact created',
};

/* Curated event selections — one click instead of ticking boxes. */
const EVENT_PRESETS: { label: string; events: string[] }[] = [
  { label: '🏆 Just the wins', events: ['email.replied', 'sara.intent_classified', 'campaign.completed'] },
  { label: '📣 Campaign pulse', events: ['campaign.launched', 'campaign.paused', 'campaign.completed', 'email.bounced'] },
  { label: '🔍 Everything', events: Object.keys(EVENT_LABELS) },
];

function BrandTile({ providerId, size = 'md' }: { providerId: string; size?: 'md' | 'lg' }) {
  const brand = BRAND[providerId] || { color: 'var(--indigo)', icon: Blocks };
  const Icon = brand.icon;
  return (
    <span
      className={cn(
        'flex items-center justify-center rounded-xl shrink-0',
        size === 'lg' ? 'h-11 w-11' : 'h-9 w-9'
      )}
      style={{ backgroundColor: brand.color }}
    >
      <Icon className={cn('text-white', size === 'lg' ? 'h-5 w-5' : 'h-4 w-4')} strokeWidth={2} />
    </span>
  );
}

/** "Connected to #wins · Acme" line for OAuth-connected providers. */
function connectionMeta(row: UserIntegration): string | null {
  const parts = [row.config.channel, row.config.workspace].filter((v) => v && !v.includes('…'));
  return parts.length ? `Connected to ${parts.join(' · ')}` : null;
}

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [openProviderId, setOpenProviderId] = useState<string | null>(null);

  const { data: integrations, isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationsApi.list,
  });

  const { data: oauthAvailable } = useQuery({
    queryKey: ['integrations-oauth-availability'],
    queryFn: integrationsApi.oauthAvailability,
    staleTime: 5 * 60 * 1000,
  });

  /* Returning from a provider consent screen: surface the outcome, refresh,
     and for setup-pending providers (Notion needs a database) open the modal. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('oauth');
    if (!provider) return;
    const status = params.get('status');
    const message = params.get('message');
    if (status === 'ok') {
      toast.success(`${provider.charAt(0).toUpperCase()}${provider.slice(1)} connected!`);
    } else if (status === 'setup') {
      toast(message || 'One more step to finish connecting', { icon: '👉' });
      setOpenProviderId(provider);
    } else if (status === 'cancelled') {
      toast(message ? `Connection cancelled: ${message}` : 'Connection cancelled', { icon: '✋' });
    } else {
      toast.error(message || 'Connection failed');
    }
    queryClient.invalidateQueries({ queryKey: ['integrations'] });
    const url = new URL(window.location.href);
    ['oauth', 'status', 'message'].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(window.history.state, '', url.toString());
  }, [queryClient]);

  const byProvider = new Map<string, UserIntegration>();
  for (const row of integrations || []) byProvider.set(row.provider, row);
  const connectedCount = (integrations || []).length;

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      integrationsApi.update(id, { is_active }),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      toast.success(row.is_active ? 'Integration resumed' : 'Integration paused');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to update integration'),
  });

  const oauthStartMutation = useMutation({
    mutationFn: (provider: string) => integrationsApi.oauthUrl(provider),
    onSuccess: (url) => { window.location.href = url; },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not start the connection'),
  });

  const openMeta = openProviderId ? INTEGRATION_CATALOG.find((p) => p.id === openProviderId) : null;

  const sections: { kind: string; providers: IntegrationProviderMeta[] }[] = [
    { kind: 'notification', providers: INTEGRATION_CATALOG.filter((p) => p.kind === 'notification') },
    { kind: 'automation', providers: INTEGRATION_CATALOG.filter((p) => p.kind === 'automation') },
    { kind: 'crm', providers: INTEGRATION_CATALOG.filter((p) => p.kind === 'crm') },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo)]">
            <Blocks className="h-4 w-4 text-white" />
          </span>
        }
        title="Integrations"
        description="Connect Sincerely to the tools your team already lives in"
        meta={
          <>
            <span>{INTEGRATION_CATALOG.length} available</span>
            <span className="text-[var(--text-tertiary)]">·</span>
            <span>{connectedCount} connected</span>
          </>
        }
      />

      {sections.map(({ kind, providers }) => (
        <section key={kind} className="space-y-2.5">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            {KIND_LABELS[kind]}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {providers.map((meta) => {
              const connected = byProvider.get(meta.id);
              const oneClick = !!(meta.oauth && oauthAvailable?.[meta.id]);
              const cMeta = connected ? connectionMeta(connected) : null;
              return (
                <div
                  key={meta.id}
                  className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 flex flex-col gap-3 hover:border-[var(--border-default)] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <BrandTile providerId={meta.id} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)]">{meta.name}</h3>
                        {oneClick && !connected && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(99,102,241,0.1)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--indigo)]">
                            <Sparkles className="h-2.5 w-2.5" />
                            1-click
                          </span>
                        )}
                        {connected && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium',
                              connected.is_active
                                ? 'bg-[rgba(34,197,94,0.1)] text-[#16a34a]'
                                : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
                            )}
                          >
                            <span
                              className={cn(
                                'h-1.5 w-1.5 rounded-full',
                                connected.is_active ? 'bg-[#16a34a]' : 'bg-[var(--text-tertiary)]'
                              )}
                            />
                            {connected.is_active ? 'Connected' : 'Paused'}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)] line-clamp-2">
                        {cMeta || meta.description}
                      </p>
                    </div>
                  </div>

                  {connected?.last_error && (
                    <p className="text-[11.5px] text-[#dc2626] bg-[rgba(220,38,38,0.06)] rounded-md px-2.5 py-1.5 line-clamp-2">
                      {connected.last_error.startsWith('Choose') ? connected.last_error : `Last delivery failed: ${connected.last_error}`}
                    </p>
                  )}

                  <div className="mt-auto flex items-center gap-2">
                    {!connected && oneClick ? (
                      <>
                        <button
                          onClick={() => oauthStartMutation.mutate(meta.id)}
                          disabled={oauthStartMutation.isPending}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[var(--indigo)] text-white hover:opacity-90 shadow-[0_1px_3px_rgba(99,102,241,0.4)] transition-all disabled:opacity-50"
                        >
                          {oauthStartMutation.isPending && oauthStartMutation.variables === meta.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Sparkles className="h-3.5 w-3.5" />}
                          Connect {meta.name}
                        </button>
                        <button
                          onClick={() => setOpenProviderId(meta.id)}
                          className="text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 py-1.5"
                        >
                          Manual setup
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setOpenProviderId(meta.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all',
                          connected
                            ? 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-[var(--border-default)]'
                            : 'bg-[var(--indigo)] text-white hover:opacity-90 shadow-[0_1px_3px_rgba(99,102,241,0.4)]'
                        )}
                      >
                        {connected ? 'Manage' : 'Connect'}
                      </button>
                    )}
                    {connected && (
                      <button
                        onClick={() =>
                          toggleActiveMutation.mutate({ id: connected.id, is_active: !connected.is_active })
                        }
                        className="text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2 py-1.5"
                      >
                        {connected.is_active ? 'Pause' : 'Resume'}
                      </button>
                    )}
                    {connected?.last_success_at && !connected.last_error && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
                        <CheckCircle2 className="h-3 w-3 text-[#16a34a]" />
                        {formatDateTime(connected.last_success_at)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {isLoading && (
        <p className="text-[12px] text-[var(--text-tertiary)]">Loading your connections…</p>
      )}

      {openMeta && (
        <ProviderModal
          meta={openMeta}
          existing={byProvider.get(openMeta.id) || null}
          oauthEnabled={!!(openMeta.oauth && oauthAvailable?.[openMeta.id])}
          onOAuthStart={() => oauthStartMutation.mutate(openMeta.id)}
          onClose={() => setOpenProviderId(null)}
        />
      )}
    </div>
  );
}

/* ─── Connect / manage modal ─────────────────────────────────────── */

function ProviderModal({
  meta,
  existing,
  oauthEnabled,
  onOAuthStart,
  onClose,
}: {
  meta: IntegrationProviderMeta;
  existing: UserIntegration | null;
  oauthEnabled: boolean;
  onOAuthStart: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<Record<string, string>>(() => {
    // Toggles start from the stored value (default on).
    const initial: Record<string, string> = {};
    for (const f of meta.fields) {
      if (f.toggle) initial[f.key] = existing?.config[f.key] === 'no' ? 'no' : 'yes';
    }
    return initial;
  });
  const [events, setEvents] = useState<string[]>(existing?.events?.length ? existing.events : meta.defaultEvents);
  const [resources, setResources] = useState<IntegrationResourcesResult | null>(null);

  const hasPickers = meta.fields.some((f) => f.picker);
  const isOAuthConnected = existing?.config.auth_kind === 'oauth';

  const connectMutation = useMutation({
    mutationFn: () => integrationsApi.connect(meta.id, { config, events }),
    onSuccess: ({ test }) => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      toast.success(test.detail || `${meta.name} connected`);
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || `Could not connect ${meta.name}`),
  });

  const testMutation = useMutation({
    mutationFn: () => integrationsApi.test(existing!.id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      queryClient.invalidateQueries({ queryKey: ['integration-activity', existing?.id] });
      result.success ? toast.success(result.detail) : toast.error(result.detail);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Test failed'),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => integrationsApi.disconnect(existing!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      toast.success(`${meta.name} disconnected`);
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to disconnect'),
  });

  const resourcesMutation = useMutation({
    mutationFn: () => integrationsApi.resources(meta.id, config),
    onSuccess: (result) => setResources((prev) => ({ ...prev, ...result })),
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not load the list'),
  });

  /* Setup-pending OAuth connections (Notion) load their picker on open. */
  useEffect(() => {
    if (existing && hasPickers && (isOAuthConnected || existing.config.token)) {
      resourcesMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: activity } = useQuery({
    queryKey: ['integration-activity', existing?.id],
    queryFn: () => integrationsApi.activity(existing!.id, 20),
    enabled: !!existing,
  });

  // A fresh connection must fill every required field; a reconnect may leave
  // secrets blank to keep the stored ones (the server merges).
  const canSubmit = existing
    ? true
    : meta.fields.every((f) => f.optional || f.toggle || (config[f.key] || '').trim().length > 0);

  function toggleEvent(event: string) {
    setEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
  }

  function pickerOptions(field: { picker?: string }): { id: string; name: string }[] | null {
    if (!resources) return null;
    if (field.picker === 'notion_database') return resources.notion_databases || null;
    if (field.picker === 'airtable_base') return resources.airtable_bases || null;
    if (field.picker === 'airtable_table') return resources.airtable_tables || null;
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="w-full max-w-xl my-8 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-[var(--border-subtle)]">
          <BrandTile providerId={meta.id} size="lg" />
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              {existing ? `Manage ${meta.name}` : `Connect ${meta.name}`}
            </h2>
            <p className="text-[12px] text-[var(--text-secondary)]">
              {existing && connectionMeta(existing) ? connectionMeta(existing) : KIND_LABELS[meta.kind]}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* One-click connect (not yet connected via OAuth) */}
          {oauthEnabled && !isOAuthConnected && (
            <div className="rounded-lg border border-[var(--indigo)] bg-[rgba(99,102,241,0.05)] p-3.5 space-y-2">
              <p className="text-[12px] text-[var(--text-primary)] font-medium">
                Skip the copy-paste — connect in one click
              </p>
              <button
                onClick={onOAuthStart}
                className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg bg-[var(--indigo)] text-white text-[12px] font-semibold hover:opacity-90 transition-all shadow-[0_1px_3px_rgba(99,102,241,0.4)]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Connect with {meta.name}
              </button>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                You'll approve access on {meta.name}'s own page and come straight back. Or set up manually below.
              </p>
            </div>
          )}

          {/* Setup guide (hidden for OAuth-connected rows — no credentials to fetch) */}
          {!isOAuthConnected && (
            <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3.5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">How to get your credentials</h3>
                <a
                  href={meta.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--indigo)] hover:underline"
                >
                  {meta.name} docs <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <ol className="space-y-1.5">
                {meta.setupSteps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
                    <span className="flex min-w-[18px] h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[10px] font-semibold text-[var(--text-tertiary)] mt-0.5">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Credential + option fields */}
          <div className="space-y-3">
            {meta.fields.map((field) => {
              // OAuth-connected: hide secret credential inputs (managed by OAuth),
              // keep pickers and toggles editable.
              if (isOAuthConnected && field.secret && !field.toggle && !field.picker) return null;

              if (field.toggle) {
                const on = config[field.key] !== 'no';
                return (
                  <label key={field.key} className="flex items-center gap-2.5 cursor-pointer select-none">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      onClick={() => setConfig((prev) => ({ ...prev, [field.key]: on ? 'no' : 'yes' }))}
                      className={cn(
                        'relative h-5 w-9 rounded-full transition-colors',
                        on ? 'bg-[var(--indigo)]' : 'bg-[var(--border-default)]'
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                          on ? 'left-[18px]' : 'left-0.5'
                        )}
                      />
                    </button>
                    <span className="text-[12.5px] text-[var(--text-primary)]">{field.label}</span>
                  </label>
                );
              }

              const options = field.picker ? pickerOptions(field) : null;
              return (
                <div key={field.key}>
                  <label className="text-xs text-[var(--text-tertiary)] mb-1 block">{field.label}</label>
                  {options && options.length > 0 ? (
                    <select
                      value={config[field.key] || existing?.config[field.key] || ''}
                      onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-primary)]"
                    >
                      <option value="">— pick one —</option>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={config[field.key] || ''}
                        onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={
                          existing && field.secret && existing.config[field.key]
                            ? `${existing.config[field.key]} (leave blank to keep)`
                            : field.placeholder
                        }
                        className="flex-1 rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] placeholder:font-sans focus:outline-none focus:border-[var(--text-primary)]"
                      />
                      {field.picker && (
                        <button
                          onClick={() => resourcesMutation.mutate()}
                          disabled={resourcesMutation.isPending}
                          title="Load choices from your account"
                          className="inline-flex items-center gap-1.5 px-3 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[12px] font-medium text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all disabled:opacity-50 shrink-0"
                        >
                          {resourcesMutation.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RefreshCw className="h-3.5 w-3.5" />}
                          Load
                        </button>
                      )}
                    </div>
                  )}
                  {field.help && <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{field.help}</p>}
                </div>
              );
            })}
            {hasPickers && resources && (
              <button
                onClick={() => resourcesMutation.mutate()}
                disabled={resourcesMutation.isPending}
                className="inline-flex items-center gap-1 text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <RefreshCw className={cn('h-3 w-3', resourcesMutation.isPending && 'animate-spin')} />
                Refresh lists
              </button>
            )}
          </div>

          {/* Event picker with presets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-[var(--text-tertiary)]">
                {meta.kind === 'crm' ? 'Sync when' : 'Send on these events'}
              </label>
              {meta.kind !== 'crm' && (
                <div className="flex gap-1.5">
                  {EVENT_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => setEvents(preset.events.filter((e) => meta.supportedEvents.includes(e)))}
                      className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-all"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {meta.supportedEvents.map((event) => (
                <button
                  key={event}
                  onClick={() => toggleEvent(event)}
                  className={cn(
                    'rounded border px-2.5 py-1 text-xs transition-all',
                    events.includes(event)
                      ? 'bg-[rgba(99,102,241,0.1)] border-[var(--indigo)] text-[var(--indigo)]'
                      : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {EVENT_LABELS[event] || event}
                </button>
              ))}
            </div>
          </div>

          {/* Recent activity (connected only) */}
          {existing && (
            <div>
              <h3 className="text-xs text-[var(--text-tertiary)] mb-2">Recent activity</h3>
              {activity && activity.length > 0 ? (
                <ul className="space-y-1 max-h-44 overflow-y-auto rounded-lg border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {activity.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 px-3 py-2 text-[12px]">
                      {a.success ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#16a34a] mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-[#dc2626] mt-0.5 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[var(--text-primary)] truncate">{a.summary}</p>
                        {!a.success && a.detail && (
                          <p className="text-[11px] text-[var(--text-tertiary)] truncate">{a.detail}</p>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-tertiary)] shrink-0">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(a.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-[var(--text-tertiary)]">
                  Nothing yet — activity appears here as events are delivered.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 p-5 pt-0">
          <button
            onClick={() => connectMutation.mutate()}
            disabled={!canSubmit || events.length === 0 || connectMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg bg-[var(--indigo)] text-white text-[12px] font-semibold hover:opacity-90 transition-all disabled:opacity-50 shadow-[0_1px_3px_rgba(99,102,241,0.4)]"
          >
            {connectMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {existing ? 'Save & test' : 'Connect & test'}
          </button>
          {existing && (
            <>
              <button
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-[12px] font-medium hover:border-[var(--border-default)] transition-all disabled:opacity-50"
              >
                {testMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FlaskConical className="h-3.5 w-3.5" />
                )}
                Send test
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Disconnect ${meta.name}? Its credentials will be deleted.`)) {
                    disconnectMutation.mutate();
                  }
                }}
                disabled={disconnectMutation.isPending}
                className="ml-auto inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium text-[#dc2626] hover:bg-[rgba(220,38,38,0.06)] transition-all disabled:opacity-50"
              >
                <Unplug className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrationsApi } from '../../api/integrations.api';
import {
  INTEGRATION_CATALOG,
  type IntegrationProviderMeta,
  type UserIntegration,
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
  X,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Loader2,
  Unplug,
  FlaskConical,
  Clock,
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
  zapier:    { color: '#FF4F00', icon: Zap },
  make:      { color: '#6D00CC', icon: Workflow },
  hubspot:   { color: '#FF7A59', icon: Orbit },
  pipedrive: { color: '#08A742', icon: Kanban },
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

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [openProviderId, setOpenProviderId] = useState<string | null>(null);

  const { data: integrations, isLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: integrationsApi.list,
  });

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
                        {meta.description}
                      </p>
                    </div>
                  </div>

                  {connected?.last_error && (
                    <p className="text-[11.5px] text-[var(--red,#dc2626)] bg-[rgba(220,38,38,0.06)] rounded-md px-2.5 py-1.5 line-clamp-2">
                      Last delivery failed: {connected.last_error}
                    </p>
                  )}

                  <div className="mt-auto flex items-center gap-2">
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
  onClose,
}: {
  meta: IntegrationProviderMeta;
  existing: UserIntegration | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<string[]>(existing?.events?.length ? existing.events : meta.defaultEvents);

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

  const { data: activity } = useQuery({
    queryKey: ['integration-activity', existing?.id],
    queryFn: () => integrationsApi.activity(existing!.id, 20),
    enabled: !!existing,
  });

  // A fresh connection must fill every field; a reconnect may leave secrets
  // blank to keep the stored ones (the server merges).
  const canSubmit = existing
    ? true
    : meta.fields.every((f) => (config[f.key] || '').trim().length > 0);

  function toggleEvent(event: string) {
    setEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
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
            <p className="text-[12px] text-[var(--text-secondary)]">{KIND_LABELS[meta.kind]}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Setup guide */}
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

          {/* Credential fields */}
          <div className="space-y-3">
            {meta.fields.map((field) => (
              <div key={field.key}>
                <label className="text-xs text-[var(--text-tertiary)] mb-1 block">{field.label}</label>
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
                  className="w-full rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] placeholder:font-sans focus:outline-none focus:border-[var(--text-primary)]"
                />
                {field.help && <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{field.help}</p>}
              </div>
            ))}
          </div>

          {/* Event picker */}
          <div>
            <label className="text-xs text-[var(--text-tertiary)] mb-2 block">
              {meta.kind === 'crm' ? 'Sync when' : 'Send on these events'}
            </label>
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

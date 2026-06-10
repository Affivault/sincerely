import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { webhookApi } from '../../api/webhook.api';
import { apikeyApi } from '../../api/apikey.api';
import { WebhookEventType } from '@lemlist/shared';
import {
  Code2,
  Webhook,
  Key,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Copy,
  Eye,
  EyeOff,
  Shield,
  Clock,
  Zap,
  X,
} from 'lucide-react';
import { cn, formatDateTime } from '../../lib/utils';
import { PageHeader } from '../../components/shared/PageHeader';
import toast from 'react-hot-toast';

const ALL_EVENTS = Object.values(WebhookEventType) as WebhookEventType[];
const EVENT_CATEGORIES: Record<string, WebhookEventType[]> = {
  'Contacts': ALL_EVENTS.filter(e => e.startsWith('contact.') || e.startsWith('lead.')),
  'Campaigns': ALL_EVENTS.filter(e => e.startsWith('campaign.') || e.startsWith('sequence.')),
  'Email': ALL_EVENTS.filter(e => e.startsWith('email.')),
  'SARA': ALL_EVENTS.filter(e => e.startsWith('sara.')),
  'System': ALL_EVENTS.filter(e => e.startsWith('account.')),
};

type Tab = 'webhooks' | 'api-keys';

export function DeveloperPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('webhooks');

  const [showCreateWebhook, setShowCreateWebhook] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLabel, setWebhookLabel] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventType[]>([]);
  const [showDeliveries, setShowDeliveries] = useState<string | null>(null);

  const [showCreateKey, setShowCreateKey] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const { data: endpoints, isLoading: loadingEndpoints } = useQuery({
    queryKey: ['webhook-endpoints'],
    queryFn: webhookApi.listEndpoints,
    enabled: tab === 'webhooks',
  });

  const { data: deliveries } = useQuery({
    queryKey: ['webhook-deliveries', showDeliveries],
    queryFn: () => webhookApi.getDeliveries(showDeliveries || undefined, 20),
    enabled: !!showDeliveries,
  });

  const { data: apiKeys, isLoading: loadingKeys } = useQuery({
    queryKey: ['api-keys'],
    queryFn: apikeyApi.list,
    enabled: tab === 'api-keys',
  });

  const createEndpointMutation = useMutation({
    mutationFn: () => webhookApi.createEndpoint({ url: webhookUrl, label: webhookLabel || undefined, events: webhookEvents }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] });
      toast.success('Webhook created');
      setShowCreateWebhook(false);
      setWebhookUrl('');
      setWebhookLabel('');
      setWebhookEvents([]);
    },
    onError: () => toast.error('Failed to create webhook'),
  });

  const deleteEndpointMutation = useMutation({
    mutationFn: webhookApi.deleteEndpoint,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] });
      toast.success('Webhook deleted');
    },
  });

  const testEndpointMutation = useMutation({
    mutationFn: webhookApi.testEndpoint,
    onSuccess: (result) => {
      if (result.success) toast.success(`Test passed (${result.status_code})`);
      else toast.error(`Test failed (${result.status_code || 'no response'})`);
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: () => apikeyApi.create({ name: keyName }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setNewRawKey(data.raw_key);
      setKeyName('');
      toast.success('API key created');
    },
    onError: () => toast.error('Failed to create key'),
  });

  const revokeKeyMutation = useMutation({
    mutationFn: apikeyApi.revoke,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('Key revoked');
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: apikeyApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('Key deleted');
    },
  });

  function toggleEvent(event: WebhookEventType) {
    setWebhookEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo)]">
            <Code2 className="h-4 w-4 text-white" />
          </span>
        }
        title="Developer"
        description="Webhooks, API keys, and integrations"
        meta={
          <>
            <span>{(endpoints || []).length} webhooks</span>
            <span className="text-[var(--text-tertiary)]">·</span>
            <span>{(apiKeys || []).length} keys</span>
          </>
        }
      />

      {/* Tabs — segmented control */}
      <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
        <button
          onClick={() => setTab('webhooks')}
          className={cn('flex items-center gap-1.5 px-3.5 h-7 rounded-md text-[12px] font-medium transition-all',
            tab === 'webhooks' ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
        >
          <Webhook className="h-3.5 w-3.5" />
          Webhooks
        </button>
        <button
          onClick={() => setTab('api-keys')}
          className={cn('flex items-center gap-1.5 px-3.5 h-7 rounded-md text-[12px] font-medium transition-all',
            tab === 'api-keys' ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
        >
          <Key className="h-3.5 w-3.5" />
          API Keys
        </button>
      </div>

      {/* Webhooks Tab */}
      {tab === 'webhooks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-[var(--text-secondary)]">Receive real-time notifications when events happen in SkySend.</p>
            <button
              onClick={() => setShowCreateWebhook(true)}
              className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg bg-[var(--indigo)] text-white text-[12px] font-semibold hover:opacity-90 transition-all shadow-[0_1px_3px_rgba(99,102,241,0.4)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Webhook
            </button>
          </div>

          {showCreateWebhook && (
            <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">New Webhook Endpoint</h3>
                <button onClick={() => setShowCreateWebhook(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Endpoint URL</label>
                  <input type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-server.com/webhook" className="w-full rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--text-primary)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Label</label>
                  <input type="text" value={webhookLabel} onChange={(e) => setWebhookLabel(e.target.value)} placeholder="My CRM Integration" className="w-full rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--text-primary)]" />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--text-tertiary)] mb-2 block">Subscribe to events</label>
                <div className="space-y-3">
                  {Object.entries(EVENT_CATEGORIES).map(([category, events]) => (
                    <div key={category}>
                      <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">{category}</p>
                      <div className="flex flex-wrap gap-2">
                        {events.map((event) => (
                          <button
                            key={event}
                            onClick={() => toggleEvent(event)}
                            className={cn(
                              'rounded border px-2.5 py-1 text-xs transition-all',
                              webhookEvents.includes(event) ? 'bg-[rgba(99,102,241,0.1)] border-[var(--indigo)] text-[var(--indigo)]' : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            )}
                          >
                            {event}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={() => createEndpointMutation.mutate()}
                disabled={!webhookUrl || webhookEvents.length === 0 || createEndpointMutation.isPending}
                className="flex items-center gap-2 rounded-md bg-[var(--indigo)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-[#4F46E5] transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create Webhook
              </button>
            </div>
          )}

          {loadingEndpoints ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-subtle)] border-t-[#6366F1]" />
            </div>
          ) : !endpoints || endpoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border border-[var(--border-subtle)] rounded-lg">
              <div className="w-12 h-12 rounded-md bg-[var(--bg-elevated)] flex items-center justify-center mb-3">
                <Webhook className="h-6 w-6 text-[var(--text-tertiary)]" />
              </div>
              <h3 className="font-medium text-[var(--text-primary)] mb-1">No webhooks configured</h3>
              <p className="text-sm text-[var(--text-secondary)]">Add a webhook to receive real-time event notifications.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {endpoints.map((ep) => (
                <div key={ep.id} className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn('h-2.5 w-2.5 rounded-full', ep.is_active ? 'bg-[var(--indigo)]' : 'bg-[var(--text-tertiary)]')} />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-[var(--text-primary)]">{ep.label}</h4>
                      <p className="text-xs text-[var(--text-tertiary)] truncate font-mono">{ep.url}</p>
                    </div>
                    <span className="text-xs text-[var(--text-tertiary)]">{ep.events.length} events</span>
                    <button onClick={() => testEndpointMutation.mutate(ep.id)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                      <Zap className="h-3 w-3" /> Test
                    </button>
                    <button onClick={() => setShowDeliveries(showDeliveries === ep.id ? null : ep.id)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                      <Clock className="h-3 w-3" /> Logs
                    </button>
                    <button onClick={() => deleteEndpointMutation.mutate(ep.id)} className="icon-btn hover:text-rose-500 hover:bg-rose-500/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {showDeliveries === ep.id && deliveries && (
                    <div className="mt-3 border-t border-[var(--border-subtle)] pt-3 space-y-2 max-h-60 overflow-y-auto">
                      {deliveries.length === 0 ? (
                        <p className="text-xs text-[var(--text-tertiary)] text-center py-2">No deliveries yet</p>
                      ) : deliveries.map((d) => (
                        <div key={d.id} className="flex items-center gap-3 text-xs">
                          {d.success ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--indigo)] shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                          <span className="text-[var(--text-secondary)] font-mono">{d.event_type}</span>
                          <span className="text-[var(--text-tertiary)]">{d.status_code || 'ERR'}</span>
                          <span className="text-[var(--text-tertiary)] ml-auto">{formatDateTime(d.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* API Keys Tab */}
      {tab === 'api-keys' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-secondary)]">Manage API keys for headless access to SkySend.</p>
            <button
              onClick={() => setShowCreateKey(true)}
              className="flex items-center gap-2 rounded-md bg-[var(--indigo)] px-4 py-2 text-sm font-medium text-white hover:bg-[#4F46E5] transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create Key
            </button>
          </div>

          {newRawKey && (
            <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[var(--indigo)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">API key created. Copy it now - it will not be shown again.</span>
              </div>
              <div className="flex items-center gap-2">
                <code className={cn('flex-1 rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm font-mono', showKey ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
                  {showKey ? newRawKey : newRawKey.substring(0, 16) + '••••••••••••••••'}
                </code>
                <button onClick={() => setShowKey(!showKey)} className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(newRawKey); toast.success('Copied!'); }}
                  className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <button onClick={() => { setNewRawKey(null); setShowKey(false); }} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                Dismiss
              </button>
            </div>
          )}

          {showCreateKey && !newRawKey && (
            <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">New API Key</h3>
                <button onClick={() => setShowCreateKey(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="h-4 w-4" /></button>
              </div>
              <div>
                <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Key Name</label>
                <input type="text" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Production CRM" className="w-full rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--text-primary)]" />
              </div>
              <button
                onClick={() => createKeyMutation.mutate()}
                disabled={!keyName || createKeyMutation.isPending}
                className="flex items-center gap-2 rounded-md bg-[var(--indigo)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-[#4F46E5] transition-colors"
              >
                <Key className="h-4 w-4" />
                Generate Key
              </button>
            </div>
          )}

          {loadingKeys ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-subtle)] border-t-[#6366F1]" />
            </div>
          ) : !apiKeys || apiKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border border-[var(--border-subtle)] rounded-lg">
              <div className="w-12 h-12 rounded-md bg-[var(--bg-elevated)] flex items-center justify-center mb-3">
                <Key className="h-6 w-6 text-[var(--text-tertiary)]" />
              </div>
              <h3 className="font-medium text-[var(--text-primary)] mb-1">No API keys</h3>
              <p className="text-sm text-[var(--text-secondary)]">Create an API key to access SkySend programmatically.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((key) => (
                <div key={key.id} className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4 flex items-center gap-4">
                  <div className={cn('flex h-9 w-9 items-center justify-center rounded', key.is_active ? 'bg-[var(--bg-elevated)]' : 'bg-[var(--bg-elevated)]')}>
                    <Key className={cn('h-4 w-4', key.is_active ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-[var(--text-primary)]">{key.name}</h4>
                    <p className="text-xs text-[var(--text-tertiary)] font-mono">{key.key_prefix}••••••••</p>
                  </div>
                  <div className="text-right">
                    <span className={cn('text-xs rounded-full px-2 py-0.5', key.is_active ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]')}>
                      {key.is_active ? 'Active' : 'Revoked'}
                    </span>
                    {key.last_used_at && (
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Last used {formatDateTime(key.last_used_at)}</p>
                    )}
                  </div>
                  {key.is_active && (
                    <button
                      onClick={() => revokeKeyMutation.mutate(key.id)}
                      className="p-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs flex items-center gap-1"
                    >
                      <Shield className="h-3 w-3" /> Revoke
                    </button>
                  )}
                  <button
                    onClick={() => deleteKeyMutation.mutate(key.id)}
                    className="p-1.5 rounded hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

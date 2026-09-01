import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { webhookApi } from '../../api/webhook.api';
import { apikeyApi } from '../../api/apikey.api';
import { WebhookEventType, type WebhookDelivery } from '@lemlist/shared';
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
  RefreshCw,
  Chrome,
  Info,
} from 'lucide-react';
import { cn, formatDateTime } from '../../lib/utils';
import { API_URL, ABSOLUTE_API_URL } from '../../lib/constants';
import { PageHeader } from '../../components/shared/PageHeader';
import { useConfirm } from '../../components/ui/ConfirmDialog';
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

/**
 * Which tab to open on.
 *
 * Read from the URL so the page can be linked to directly — the Chrome
 * extension sends people here for their API key, and landing them on Webhooks
 * to hunt for the right tab is a step that shouldn't exist.
 */
function tabFromUrl(): Tab {
  const requested = new URLSearchParams(window.location.search).get('tab');
  return requested === 'api-keys' ? 'api-keys' : 'webhooks';
}

export function DeveloperPage() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>(tabFromUrl);

  const [showCreateWebhook, setShowCreateWebhook] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLabel, setWebhookLabel] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventType[]>([]);
  const [showDeliveries, setShowDeliveries] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{ label: string; secret: string } | null>(null);

  const [showCreateKey, setShowCreateKey] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keyRateLimit, setKeyRateLimit] = useState(100);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  /** Which key the freshly shown secret belongs to, so the panel can say so. */
  const [newKeyName, setNewKeyName] = useState<string>('');
  const [showConnectHelp, setShowConnectHelp] = useState(false);

  /* Keep the URL in step with the tab, so a reload — or a link copied out of the
     address bar — comes back to the tab the user was actually on. replaceState
     rather than push: switching tabs isn't a navigation worth a Back press. */
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === tab) return;
    url.searchParams.set('tab', tab);
    window.history.replaceState(window.history.state, '', url.toString());
  }, [tab]);

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

  // Recent deliveries across every endpoint, so each row can show an at-a-glance
  // health badge without the user having to open "Logs" on each one individually.
  const { data: recentDeliveries } = useQuery({
    queryKey: ['webhook-deliveries', 'recent'],
    queryFn: () => webhookApi.getDeliveries(undefined, 100),
    enabled: tab === 'webhooks' && !!endpoints && endpoints.length > 0,
  });
  const latestDeliveryByEndpoint = new Map<string, WebhookDelivery>();
  for (const d of recentDeliveries || []) {
    if (!latestDeliveryByEndpoint.has(d.endpoint_id)) latestDeliveryByEndpoint.set(d.endpoint_id, d);
  }

  const { data: apiKeys, isLoading: loadingKeys } = useQuery({
    queryKey: ['api-keys'],
    queryFn: apikeyApi.list,
    enabled: tab === 'api-keys',
  });

  const createEndpointMutation = useMutation({
    mutationFn: () => webhookApi.createEndpoint({ url: webhookUrl, label: webhookLabel || undefined, events: webhookEvents }),
    onSuccess: (endpoint) => {
      queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] });
      toast.success('Webhook created');
      setShowCreateWebhook(false);
      setWebhookUrl('');
      setWebhookLabel('');
      setWebhookEvents([]);
      if (endpoint.secret) setRevealedSecret({ label: endpoint.label, secret: endpoint.secret });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to create webhook'),
  });

  const regenerateSecretMutation = useMutation({
    mutationFn: webhookApi.regenerateSecret,
    onSuccess: (endpoint) => {
      queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] });
      if (endpoint.secret) setRevealedSecret({ label: endpoint.label, secret: endpoint.secret });
      toast.success('Secret regenerated');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to regenerate secret'),
  });

  const deleteEndpointMutation = useMutation({
    mutationFn: webhookApi.deleteEndpoint,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] });
      toast.success('Webhook deleted');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to delete webhook'),
  });

  const testEndpointMutation = useMutation({
    mutationFn: webhookApi.testEndpoint,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['webhook-deliveries'] });
      if (result.success) toast.success(`Test passed (${result.status_code})`);
      else toast.error(`Test failed (${result.status_code || 'no response'})`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to test webhook'),
  });

  /* The extension announces itself on load; until it does, the connect button
     stays hidden rather than offering something that can't work. */
  const [extensionPresent, setExtensionPresent] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [connectingExtension, setConnectingExtension] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'SINCERELY_EXTENSION_HERE') setExtensionPresent(true);
      if (event.data.type === 'SINCERELY_EXTENSION_CONNECTED') {
        setConnectingExtension(false);
        if (!event.data.ok) {
          toast.error(event.data.error || 'Could not connect the extension');
          return;
        }
        /* The extension verifies the key before answering, so say what it found
           rather than a bare "connected" that might not be usable yet — and only
           call it connected when it can actually do the job. */
        if (event.data.needsPermission) {
          toast.success(
            `Key sent. Chrome still needs permission for ${event.data.needsPermission} — open the extension's settings and press "Save & test connection".`,
            { duration: 9000 }
          );
        } else if (event.data.canWrite === false) {
          toast.error('Connected, but that key is read-only, so adding people will fail.');
        } else if (typeof event.data.listCount === 'number') {
          setExtensionConnected(true);
          toast.success(`Extension connected — ${event.data.listCount} list(s) visible.`);
        } else {
          setExtensionConnected(true);
          toast.success('Extension connected');
        }
      }
    };
    window.addEventListener('message', onMessage);
    // The content script may have announced before this page mounted.
    window.postMessage({ type: 'SINCERELY_EXTENSION_PING' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /** Mint a key and hand it straight to the extension. */
  const connectExtension = async () => {
    setConnectingExtension(true);
    try {
      const { raw_key } = await apikeyApi.create({
        name: `Chrome extension (${new Date().toLocaleDateString()})`,
        rate_limit: 100,
      });
      window.postMessage(
        // Absolute: the extension cannot resolve a relative path, and silently
        // fell back to its built-in host when handed one.
        { type: 'SINCERELY_EXTENSION_CONNECT', apiKey: raw_key, apiBaseUrl: ABSOLUTE_API_URL },
        window.location.origin
      );
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (err: any) {
      setConnectingExtension(false);
      toast.error(err.response?.data?.error || 'Could not create a key for the extension');
    }
  };

  /*
   * Keys are stored hashed, so a secret shown once is gone. Rotating issues a
   * new secret for the same key instead of forcing a delete-and-recreate — the
   * way back for anyone who closed the dialog before copying.
   */
  const rotateKeyMutation = useMutation({
    mutationFn: (id: string) => apikeyApi.rotate(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setNewRawKey(data.raw_key);
      setNewKeyName(data.key.name);
      setShowKey(false);
      toast.success('New key issued. The old one has stopped working.');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to issue a new key'),
  });

  const createKeyMutation = useMutation({
    mutationFn: () => apikeyApi.create({ name: keyName, rate_limit: keyRateLimit }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setNewRawKey(data.raw_key);
      setNewKeyName(data.key.name);
      setKeyName('');
      setKeyRateLimit(100);
      toast.success('API key created');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to create key'),
  });

  const revokeKeyMutation = useMutation({
    mutationFn: apikeyApi.revoke,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('Key revoked');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to revoke key'),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: apikeyApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('Key deleted');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to delete key'),
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
            <p className="text-[12px] text-[var(--text-secondary)]">Receive real-time notifications when events happen in Sincerely.</p>
            <button
              onClick={() => setShowCreateWebhook(true)}
              className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg bg-[var(--indigo)] text-white text-[12px] font-semibold hover:opacity-90 transition-all shadow-[0_1px_3px_rgba(99,102,241,0.4)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Webhook
            </button>
          </div>

          {revealedSecret && (
            <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">Signing secret for "{revealedSecret.label}"</h3>
                <button onClick={() => setRevealedSecret(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="h-4 w-4" /></button>
              </div>
              <p className="text-xs text-[var(--text-tertiary)]">
                Copy this now — it won't be shown again. Use it to verify the <code>X-Sincerely-Signature</code> header on incoming deliveries.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-[var(--bg-surface)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] break-all">{revealedSecret.secret}</code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(revealedSecret.secret)
                      .then(() => toast.success('Copied!'))
                      .catch(() => toast.error('Failed to copy to clipboard'));
                  }}
                  className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

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
              {endpoints.map((ep) => {
                const lastDelivery = latestDeliveryByEndpoint.get(ep.id);
                return (
                <div key={ep.id} className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn('h-2.5 w-2.5 rounded-full', ep.is_active ? 'bg-[var(--indigo)]' : 'bg-[var(--text-tertiary)]')} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-[var(--text-primary)]">{ep.label}</h4>
                        {lastDelivery && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[4px] text-[10.5px] font-medium',
                              lastDelivery.success ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
                            )}
                            title={`Last delivery ${formatDateTime(lastDelivery.created_at)} · ${lastDelivery.status_code ?? 'no response'}`}
                          >
                            {lastDelivery.success ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                            {lastDelivery.success ? 'Delivering' : 'Failing'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] truncate font-mono">{ep.url}</p>
                    </div>
                    <span className="text-xs text-[var(--text-tertiary)]">{ep.events.length} events</span>
                    <button
                      onClick={() => testEndpointMutation.mutate(ep.id)}
                      disabled={testEndpointMutation.isPending && testEndpointMutation.variables === ep.id}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                    >
                      {testEndpointMutation.isPending && testEndpointMutation.variables === ep.id ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <Zap className="h-3 w-3" />
                      )}
                      Test
                    </button>
                    <button
                      onClick={() => confirm(
                        {
                          title: `Regenerate the signing secret for "${ep.label}"?`,
                          body: 'Any receiver still checking the old signature starts failing verification until you update it there too.',
                          confirmLabel: 'Regenerate',
                        },
                        () => regenerateSecretMutation.mutate(ep.id),
                      )}
                      disabled={regenerateSecretMutation.isPending}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" /> Secret
                    </button>
                    <button onClick={() => setShowDeliveries(showDeliveries === ep.id ? null : ep.id)} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                      <Clock className="h-3 w-3" /> Logs
                    </button>
                    <button
                      onClick={() => confirm(
                        { title: `Delete the endpoint "${ep.label}"?`, body: 'Sincerely stops posting events to it. Its delivery log goes too.', tone: 'danger' },
                        () => deleteEndpointMutation.mutate(ep.id),
                      )}
                      className="icon-btn hover:text-rose-500 hover:bg-rose-500/10"
                    >
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
              );})}
            </div>
          )}
        </div>
      )}

      {/* API Keys Tab */}
      {tab === 'api-keys' && (
        <div className="space-y-4">
          {/* Shown only when the extension is actually installed, so it can't
              become a button that does nothing. Connecting mints the key here
              and hands it over directly — nothing to copy, and no chance of
              pasting the masked display by mistake. */}
          {extensionPresent && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium text-[var(--text-primary)]">Chrome extension</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                  {extensionConnected
                    ? 'Connected. It can add and remove people from your campaigns.'
                    : 'Connect it in one click — we\u2019ll create the key and hand it over. Nothing to copy.'}
                </p>
              </div>
              <button
                onClick={connectExtension}
                disabled={connectingExtension}
                className="flex-shrink-0 flex items-center gap-2 rounded-md bg-[var(--indigo)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-[#4F46E5] transition-colors"
              >
                <Key className="h-4 w-4" />
                {connectingExtension ? 'Connecting…' : extensionConnected ? 'Reconnect' : 'Connect extension'}
              </button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-secondary)]">Manage API keys for headless access to Sincerely.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowConnectHelp((open) => !open)}
                className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Chrome className="h-4 w-4" />
                Connect the Chrome extension
              </button>
            <button
              onClick={() => setShowCreateKey(true)}
              className="flex items-center gap-2 rounded-md bg-[var(--indigo)] px-4 py-2 text-sm font-medium text-white hover:bg-[#4F46E5] transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create Key
            </button>
            </div>
          </div>

          {/* Written out in full because the alternative is a support thread.
              The one-click route is first; the manual one exists because a key
              can always be pasted, whatever the browser is doing. */}
          {showConnectHelp && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--indigo)]" />
                  <div>
                    <h3 className="text-sm font-medium text-[var(--text-primary)]">
                      Connecting the Chrome extension
                    </h3>
                    <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                      An API key is a password the extension uses to prove it's you. You create it
                      here — it isn't something you get from anywhere else.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowConnectHelp(false)}
                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  The easy way — nothing to copy
                </p>
                <ol className="mt-2 space-y-1.5 text-sm text-[var(--text-secondary)] list-decimal list-inside">
                  <li>Make sure you're signed in to Sincerely in this tab.</li>
                  <li>Click the Sincerely icon in your Chrome toolbar.</li>
                  <li>
                    Press <span className="font-medium text-[var(--text-primary)]">Connect using this tab</span>.
                  </li>
                </ol>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  The extension creates its own key from your session and sets itself up. If the
                  extension is installed, the <span className="font-medium text-[var(--text-primary)]">Connect
                  extension</span> button above does the same thing from this side.
                </p>
              </div>

              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Or paste a key by hand</p>
                <ol className="mt-2 space-y-1.5 text-sm text-[var(--text-secondary)] list-decimal list-inside">
                  <li>
                    Press <span className="font-medium text-[var(--text-primary)]">Create Key</span> above and
                    give it a name like "Chrome extension".
                  </li>
                  <li>
                    Use the <span className="font-medium text-[var(--text-primary)]">copy button</span> beside the
                    key. Selecting the text copies the dots that hide it, which won't work.
                  </li>
                  <li>Right-click the extension icon in Chrome and choose Options.</li>
                  <li>
                    Open <span className="font-medium text-[var(--text-primary)]">Or paste a key by hand</span>,
                    set the API URL to{' '}
                    <code className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 font-mono text-xs">{API_URL}</code>
                    , paste the key, and press{' '}
                    <span className="font-medium text-[var(--text-primary)]">Save &amp; test connection</span>.
                  </li>
                </ol>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  A key is 72 characters starting <code className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 font-mono text-xs">sk_live_</code>,
                  and needs both read and write scopes (the default). If you closed the dialog before
                  copying, press <span className="font-medium text-[var(--text-primary)]">New secret</span> on the
                  key below rather than creating another.
                </p>
              </div>
            </div>
          )}

          {newRawKey && (
            <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-default)] p-4 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[var(--indigo)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {newKeyName ? `"${newKeyName}" is ready.` : 'API key ready.'} Copy it now — it is
                  stored hashed and cannot be shown again.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className={cn('flex-1 rounded bg-[var(--bg-elevated)] px-3 py-2 text-sm font-mono', showKey ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
                  {showKey ? newRawKey : newRawKey.substring(0, 16) + '••••••••••••••••'}
                </code>
                <button onClick={() => setShowKey(!showKey)} className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(newRawKey)
                      .then(() => toast.success('Copied!'))
                      .catch(() => toast.error('Failed to copy to clipboard'));
                  }}
                  className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => { setNewRawKey(null); setShowKey(false); setNewKeyName(''); }} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                  Dismiss
                </button>
                <span className="text-xs text-[var(--text-tertiary)]">
                  Lost it later? Use <span className="font-medium text-[var(--text-secondary)]">New secret</span> on
                  the key below — no need to create another.
                </span>
              </div>
            </div>
          )}

          {showCreateKey && !newRawKey && (
            <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">New API Key</h3>
                <button onClick={() => setShowCreateKey(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Key Name</label>
                  <input type="text" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="e.g. Production CRM" className="w-full rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--text-primary)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Rate limit (requests/min)</label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={keyRateLimit}
                    onChange={(e) => setKeyRateLimit(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-md bg-[var(--bg-surface)] border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--text-primary)]"
                  />
                </div>
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
              <p className="text-sm text-[var(--text-secondary)]">Create an API key to access Sincerely programmatically.</p>
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
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-[10px] text-[var(--text-tertiary)]">{key.rate_limit}/min</span>
                      <span className={cn('text-xs rounded-full px-2 py-0.5', key.is_active ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]' : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]')}>
                        {key.is_active ? 'Active' : 'Revoked'}
                      </span>
                    </div>
                    {key.last_used_at && (
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Last used {formatDateTime(key.last_used_at)}</p>
                    )}
                  </div>
                  <button
                    onClick={() => confirm(
                      {
                        title: `Issue a new secret for "${key.name}"?`,
                        body: 'The current one stops working immediately. Use this when the key was never copied, or may have leaked.',
                        confirmLabel: 'Issue new secret',
                      },
                      () => rotateKeyMutation.mutate(key.id),
                    )}
                    disabled={rotateKeyMutation.isPending}
                    className="p-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs flex items-center gap-1 disabled:opacity-50"
                    title="The stored key is hashed and cannot be shown again — this issues a fresh one"
                  >
                    <RefreshCw className="h-3 w-3" /> New secret
                  </button>
                  {key.is_active && (
                    <button
                      onClick={() => confirm(
                        { title: `Revoke "${key.name}"?`, body: 'Anything still authenticating with this key stops working immediately.', tone: 'danger', confirmLabel: 'Revoke' },
                        () => revokeKeyMutation.mutate(key.id),
                      )}
                      className="p-1.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs flex items-center gap-1"
                    >
                      <Shield className="h-3 w-3" /> Revoke
                    </button>
                  )}
                  <button
                    onClick={() => confirm(
                      { title: `Delete "${key.name}"?`, body: 'The key record and its usage history are removed for good.', tone: 'danger' },
                      () => deleteKeyMutation.mutate(key.id),
                    )}
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

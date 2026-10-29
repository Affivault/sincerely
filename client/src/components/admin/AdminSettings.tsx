import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellRing, Coins, DoorOpen, Layers, Megaphone } from 'lucide-react';
import { CREDIT_ACTION_LABELS, formatDateTime, type AdminAlertKind, type AdminSettingsResponse, type CreditAction, type PlanId, type PlatformSettings, type SignupMode } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { AdminHeader } from './AdminShell';
import { Banner, Card, errMsg, inputBase, inputCls, useAdminAction } from './adminUi';

/*
 * What applies to everyone, changed without a deploy: plan limits, credit
 * prices, who can sign up, and an announcement on every page. Each takes
 * effect within half a minute everywhere, and each change is in Activity.
 */
export function AdminSettings() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['admin', 'settings'], queryFn: adminApi.settings });

  if (isLoading) return <><AdminHeader title="Settings" /><div className="flex justify-center py-16"><Spinner size="lg" /></div></>;
  if (isError || !data) return <><AdminHeader title="Settings" /><p className="text-body text-[var(--text-tertiary)]">{errMsg(error, 'Settings could not be loaded.')}</p></>;

  return (
    <>
      <AdminHeader title="Settings" sub="Applies to every account, within half a minute, with no deploy. Blank means the default." />
      <div className="space-y-4">
        {!data.ready && <Banner tone="warn" icon={AlertTriangle}>Run database migration 102 to save settings. Until then the platform runs on its defaults.</Banner>}
        <AlertsCard />
        <SignupsCard data={data} />
        <AnnouncementCard data={data} />
        <PlansCard data={data} />
        <PricesCard data={data} />
      </div>
    </>
  );
}

/** Puts a fresh settings answer straight into the cache, and refreshes what the app shows. */
function useSaved() {
  const qc = useQueryClient();
  return (r: AdminSettingsResponse) => {
    qc.setQueryData(['admin', 'settings'], r);
    qc.invalidateQueries({ queryKey: ['platform'] });
  };
}

function Stamp({ data, k }: { data: AdminSettingsResponse; k: keyof PlatformSettings }) {
  const u = data.updated[k];
  return u ? <span className="text-micro text-[var(--text-tertiary)]">Changed {formatDateTime(u.at)}{u.by ? ` by ${u.by}` : ''}</span> : null;
}

const MODES: Array<{ id: SignupMode; label: string; sub: string }> = [
  { id: 'open', label: 'Open', sub: 'Anyone can sign up.' },
  { id: 'invite', label: 'Invite-only', sub: 'Only the addresses and @domains below.' },
  { id: 'closed', label: 'Closed', sub: 'Nobody new. Existing accounts are untouched.' },
];

function SignupsCard({ data }: { data: AdminSettingsResponse }) {
  const confirm = useConfirm();
  const saved = useSaved();
  const s = data.settings.signups;
  const [mode, setMode] = useState<SignupMode>(s.mode);
  const [allow, setAllow] = useState(s.allow.join('\n'));
  useEffect(() => { setMode(s.mode); setAllow(s.allow.join('\n')); }, [s.mode, s.allow]);
  const list = useMemo(() => allow.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean), [allow]);
  const changed = mode !== s.mode || list.join('\n') !== s.allow.join('\n');
  const mut = useAdminAction(() => adminApi.saveSignups({ mode, allow: list }), 'Sign-ups saved.', 'Sign-ups could not be saved.');
  const save = () => {
    const run = () => mut.mutate(undefined, { onSuccess: saved });
    if (mode === 'closed' && s.mode !== 'closed') confirm({ title: 'Close sign-ups?', body: 'Nobody new can make an account, by email or Google, until you open them again.', confirmLabel: 'Close sign-ups', tone: 'danger' }, run);
    else run();
  };

  return (
    <Card title="Sign-ups" icon={DoorOpen} aside={<Stamp data={data} k="signups" />}>
      <div role="radiogroup" aria-label="Who can sign up" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              'text-left rounded-lg border px-3 py-2.5 transition-colors',
              mode === m.id ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]' : 'border-[var(--border-default)] hover:border-[var(--border-strong)]',
            )}
          >
            <p className="text-body font-medium text-[var(--text-primary)]">{m.label}</p>
            <p className="text-caption text-[var(--text-tertiary)]">{m.sub}</p>
          </button>
        ))}
      </div>
      {mode === 'invite' && (
        <label className="block mt-3 text-caption text-[var(--text-tertiary)]">
          Who may sign up: one per line, an address or a whole @domain
          <textarea value={allow} onChange={(e) => setAllow(e.target.value)} rows={4} placeholder={'jane@acme.com\n@acme.com'} className={cn(inputCls, 'mt-1 h-auto py-2 font-mono resize-y')} />
        </label>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={!changed || mut.isPending || !data.ready} onClick={save}>{mut.isPending ? 'Saving…' : 'Save sign-ups'}</Button>
        {mode !== 'open' && <span className="text-caption text-[var(--text-tertiary)]">Needs database migration 103 to be enforced.</span>}
      </div>
    </Card>
  );
}

function AnnouncementCard({ data }: { data: AdminSettingsResponse }) {
  const saved = useSaved();
  const a = data.settings.announcement;
  const [text, setText] = useState(a?.text || '');
  const [tone, setTone] = useState<'info' | 'warn'>(a?.tone || 'info');
  const [url, setUrl] = useState(a?.link_url || '');
  const [label, setLabel] = useState(a?.link_label || '');
  useEffect(() => { setText(a?.text || ''); setTone(a?.tone || 'info'); setUrl(a?.link_url || ''); setLabel(a?.link_label || ''); }, [a?.id]);
  const changed = text.trim() !== (a?.text || '') || tone !== (a?.tone || 'info') || url.trim() !== (a?.link_url || '') || (url.trim() ? label.trim() !== (a?.link_label || '') : false);
  const postMut = useAdminAction(() => adminApi.saveAnnouncement({ text, tone, link_url: url.trim() || undefined, link_label: label.trim() || undefined }), 'Announcement posted.', 'The announcement could not be posted.');
  const downMut = useAdminAction(() => adminApi.saveAnnouncement(null), 'Announcement taken down.', 'The announcement could not be taken down.');

  return (
    <Card title="Announcement" icon={Megaphone} aside={<Stamp data={data} k="announcement" />}>
      <p className="text-caption text-[var(--text-tertiary)] mb-2">A banner at the top of every page for everyone signed in. They can close it; a new one shows again.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={280} rows={2} placeholder="e.g. Scheduled maintenance on Sunday 2 to 3am UTC. Sending pauses for that hour." aria-label="Announcement" className={cn(inputCls, 'h-auto py-2 resize-y')} />
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <select value={tone} onChange={(e) => setTone(e.target.value as 'info' | 'warn')} aria-label="Tone" className={cn(inputBase, 'w-32 px-2')}>
          <option value="info">Information</option>
          <option value="warn">Warning</option>
        </select>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link (optional): https://… or /settings" aria-label="Link" className={cn(inputBase, 'flex-1 min-w-[180px]')} />
        {url.trim() && <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Link text" aria-label="Link text" className={cn(inputBase, 'w-36')} />}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={!text.trim() || !changed || postMut.isPending || !data.ready} onClick={() => postMut.mutate(undefined, { onSuccess: saved })}>{a ? 'Update' : 'Post'}</Button>
        {a && <Button size="sm" variant="ghost" disabled={downMut.isPending} onClick={() => downMut.mutate(undefined, { onSuccess: saved })}>Take down</Button>}
        <span className="text-caption text-[var(--text-tertiary)] ml-auto tabular">{text.length}/280</span>
      </div>
    </Card>
  );
}

const PLAN_ORDER: PlanId[] = ['free', 'trial', 'starter', 'growth', 'scale', 'lifetime'];
const FIELDS = [
  { k: 'maxInboxes', label: 'Inboxes' },
  { k: 'emailsPerMonth', label: 'Emails a month' },
  { k: 'prospectCredits', label: 'Credits a month' },
] as const;
type Field = typeof FIELDS[number]['k'];

function PlansCard({ data }: { data: AdminSettingsResponse }) {
  const confirm = useConfirm();
  const saved = useSaved();
  const fromSettings = () => Object.fromEntries(PLAN_ORDER.map((id) => [id, Object.fromEntries(FIELDS.map((f) => [f.k, data.settings.plans[id]?.[f.k] ?? '']).map(([k, v]) => [k, String(v)]))])) as Record<PlanId, Record<Field, string>>;
  const [form, setForm] = useState(fromSettings);
  const key = JSON.stringify(data.settings.plans);
  useEffect(() => { setForm(fromSettings()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = JSON.stringify(form) !== JSON.stringify(fromSettings());
  const plans = Object.fromEntries(PLAN_ORDER.map((id) => [id, Object.fromEntries(FIELDS.filter((f) => form[id][f.k].trim() !== '').map((f) => [f.k, Number(form[id][f.k])]))]).filter(([, o]) => Object.keys(o as object).length)) as PlatformSettings['plans'];
  const mut = useAdminAction(() => adminApi.savePlans(plans), 'Plan limits saved.', 'The plan limits could not be saved.');
  const show = (n: number) => (n < 0 ? 'unlimited' : n.toLocaleString());

  return (
    <Card title="Plan limits" icon={Layers} aside={<Stamp data={data} k="plans" />}>
      <p className="text-caption text-[var(--text-tertiary)] mb-3">For everyone on the plan. -1 is unlimited (not for credits). An account’s own limits, set on its Account tab, win over these.</p>
      <div className="relative overflow-x-auto -mx-4">
        <table className="w-full min-w-[560px] text-left text-body">
          <thead>
            <tr className="text-caption text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
              <th className="py-2 px-4 font-medium">Plan</th>
              {FIELDS.map((f) => <th key={f.k} className="py-2 px-2 font-medium">{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {PLAN_ORDER.map((id) => (
              <tr key={id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="py-2 px-4 font-medium text-[var(--text-primary)]">{data.defaults.plans[id].name}</td>
                {FIELDS.map((f) => (
                  <td key={f.k} className="py-1.5 px-2">
                    <input
                      type="number" inputMode="numeric" min={f.k === 'prospectCredits' ? 0 : -1}
                      value={form[id][f.k]}
                      onChange={(e) => setForm((p) => ({ ...p, [id]: { ...p[id], [f.k]: e.target.value } }))}
                      placeholder={show(data.defaults.plans[id][f.k] ?? 0)}
                      aria-label={`${data.defaults.plans[id].name} ${f.label.toLowerCase()}`}
                      className={cn(inputBase, 'w-32', form[id][f.k] !== '' && 'border-[var(--indigo)]')}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={!changed || mut.isPending || !data.ready} onClick={() => confirm({ title: 'Change plan limits for everyone?', body: 'Every account on these plans gets the new limits within half a minute.', confirmLabel: 'Save limits' }, () => mut.mutate(undefined, { onSuccess: saved }))}>Save plan limits</Button>
        {changed && <Button size="sm" variant="ghost" onClick={() => setForm(fromSettings())}>Undo changes</Button>}
      </div>
    </Card>
  );
}

const ACTIONS: CreditAction[] = ['search', 'reveal', 'verify', 'enrich'];

function PricesCard({ data }: { data: AdminSettingsResponse }) {
  const confirm = useConfirm();
  const saved = useSaved();
  const fromSettings = () => Object.fromEntries(ACTIONS.map((a) => [a, data.settings.credit_prices[a] == null ? '' : String(data.settings.credit_prices[a])])) as Record<CreditAction, string>;
  const [form, setForm] = useState(fromSettings);
  const key = JSON.stringify(data.settings.credit_prices);
  useEffect(() => { setForm(fromSettings()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = JSON.stringify(form) !== JSON.stringify(fromSettings());
  const prices = Object.fromEntries(ACTIONS.filter((a) => form[a].trim() !== '').map((a) => [a, Number(form[a])])) as PlatformSettings['credit_prices'];
  const mut = useAdminAction(() => adminApi.savePrices(prices), 'Credit prices saved.', 'The prices could not be saved.');

  return (
    <Card title="Credit prices" icon={Coins} aside={<Stamp data={data} k="credit_prices" />}>
      <p className="text-caption text-[var(--text-tertiary)] mb-3">What each paid action costs a customer, in credits, to a tenth. Every screen that quotes a price shows the new one.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ACTIONS.map((a) => (
          <label key={a} className="flex items-center gap-3 text-body">
            <span className="flex-1 text-[var(--text-primary)]">{CREDIT_ACTION_LABELS[a] || a}</span>
            <input
              type="number" step={0.1} min={0} inputMode="decimal" value={form[a]}
              onChange={(e) => setForm((p) => ({ ...p, [a]: e.target.value }))}
              placeholder={String(data.defaults.credit_prices[a])}
              aria-label={`${CREDIT_ACTION_LABELS[a] || a} price`}
              className={cn(inputBase, 'w-24', form[a] !== '' && 'border-[var(--indigo)]')}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={!changed || mut.isPending || !data.ready} onClick={() => confirm({ title: 'Change credit prices?', body: 'New prices apply to the next search, reveal, check or enrichment on every account.', confirmLabel: 'Save prices' }, () => mut.mutate(undefined, { onSuccess: saved }))}>Save prices</Button>
        {changed && <Button size="sm" variant="ghost" onClick={() => setForm(fromSettings())}>Undo changes</Button>}
      </div>
    </Card>
  );
}

const ALERTS: Array<{ k: AdminAlertKind; label: string; sub: string }> = [
  { k: 'icypeas_low', label: 'Icypeas balance is low', sub: 'At most once a day, until it is topped up.' },
  { k: 'payment_failed', label: 'A payment failed', sub: 'When an account goes past due.' },
  { k: 'risky_sending', label: 'An account’s sending goes wrong', sub: 'Bounces or spam reports over the lines on the Sending page.' },
  { k: 'new_paying', label: 'A new paying customer', sub: 'When an account starts paying.' },
];

/* Email the owners when something needs them. Sent from each owner's own connected mailbox to themselves. */
function AlertsCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin', 'alerts'], queryFn: adminApi.alerts });
  const mut = useAdminAction((enabled: Partial<Record<AdminAlertKind, boolean>>) => adminApi.saveAlerts(enabled), 'Alerts saved.', 'The alerts could not be saved.');
  if (!data) return null;
  return (
    <Card title="Email alerts" icon={BellRing}>
      <p className="text-caption text-[var(--text-tertiary)] mb-2">Checked every half hour, and emailed to each admin from their own connected mailbox, so connect one to get them.</p>
      <div className="divide-y divide-[var(--border-subtle)]">
        {ALERTS.map((a) => (
          <label key={a.k} className="flex items-center gap-3 py-2.5 cursor-pointer">
            <span className="flex-1 min-w-0">
              <span className="block text-body font-medium text-[var(--text-primary)]">{a.label}</span>
              <span className="block text-caption text-[var(--text-tertiary)]">{a.sub}{data.last_sent[a.k] ? ` Last sent ${formatDateTime(data.last_sent[a.k]!)}.` : ''}</span>
            </span>
            <input
              type="checkbox"
              checked={!!data.enabled[a.k]}
              disabled={!data.ready || mut.isPending}
              onChange={(e) => mut.mutate({ [a.k]: e.target.checked }, { onSuccess: (r) => qc.setQueryData(['admin', 'alerts'], r) })}
              className="h-4 w-4 accent-[var(--indigo)]"
            />
          </label>
        ))}
      </div>
    </Card>
  );
}

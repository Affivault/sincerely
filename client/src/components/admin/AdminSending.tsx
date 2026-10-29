import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, Globe, Inbox, OctagonX, PauseCircle, PlayCircle, ShieldAlert } from 'lucide-react';
import { formatDateTime, type AdminMailboxRow } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Button } from '../ui/Button';
import { Spinner } from '../ui/Spinner';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { AdminHeader } from './AdminShell';
import { Card, Tile, errMsg, inputCls, useAdminAction } from './adminUi';

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

/*
 * Sending across every account: who is bouncing or drawing spam reports,
 * every mailbox and domain, a pause for one mailbox, a hold for one
 * account, and the switch that stops all sending on the platform.
 */
export function AdminSending() {
  const confirm = useConfirm();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['admin', 'sending'], queryFn: adminApi.sending });
  const [reason, setReason] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [q, setQ] = useState('');

  const killMut = useAdminAction((on: boolean) => adminApi.killSwitch(on, reason), (_r, on) => (on ? 'All sending is stopped.' : 'Sending is back on.'), 'The switch could not be changed.');
  const boxMut = useAdminAction(({ id, active }: { id: string; active: boolean }) => adminApi.setMailboxActive(id, active), (_r, a) => (a.active ? 'Mailbox back on.' : 'Mailbox paused.'), 'The mailbox could not be changed.');
  const holdMut = useAdminAction(({ id, hold }: { id: string; hold: boolean }) => adminApi.sendingHold(id, hold), (_r, a) => (a.hold ? 'Their sending is on hold.' : 'Hold lifted.'), 'The hold could not be changed.');

  const boxes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.mailboxes || []).filter((m) => (!onlyFlagged || m.flagged) && (!needle || m.email.toLowerCase().includes(needle) || (m.owner_email || '').toLowerCase().includes(needle)));
  }, [data, onlyFlagged, q]);

  if (isLoading) return <><AdminHeader title="Sending" /><div className="flex justify-center py-16"><Spinner size="lg" /></div></>;
  if (isError || !data) return <><AdminHeader title="Sending" /><p className="text-body text-[var(--text-tertiary)]">{errMsg(error, 'Sending could not be loaded.')}</p></>;

  const t = data.totals;
  const kill = data.kill_switch;
  const flaggedCount = data.mailboxes.filter((m) => m.flagged).length;

  return (
    <>
      <AdminHeader title="Sending" sub={`Every mailbox on Sincerely, the last ${data.days} days. Flagged at ${pct(data.thresholds.bounce, 0)} bounced or ${pct(data.thresholds.complaint, 1)} spam reports, from ${data.thresholds.min_sent} sends.`} />

      <div className="space-y-4">
        {/* The platform switch */}
        <section className={cn('rounded-xl border p-4', kill ? 'border-red-500/40 bg-red-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]')}>
          <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', kill ? 'bg-red-600 text-white' : 'bg-[var(--bg-muted)] text-[var(--text-secondary)]')}>
              <OctagonX className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-strong font-semibold text-[var(--text-primary)]">{kill ? 'All sending is stopped' : 'Stop all sending'}</p>
              <p className="text-caption text-[var(--text-tertiary)] mt-0.5">
                {kill
                  ? <>Since {formatDateTime(kill.at)} by {kill.by}: “{kill.reason}”. Campaigns wait and pick up where they were when it is turned back on.</>
                  : 'For an emergency: nothing goes out from any account until you turn it back on. Campaigns wait rather than fail.'}
              </p>
            </div>
            {kill ? (
              <Button variant="secondary" disabled={killMut.isPending} onClick={() => confirm({ title: 'Turn sending back on?', body: 'Every account starts sending again on its next run.', confirmLabel: 'Turn sending on' }, () => killMut.mutate(false))}>
                <PlayCircle className="h-4 w-4" /> Turn sending on
              </Button>
            ) : (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Why, for the record" aria-label="Why sending is stopped" className={cn(inputCls, 'sm:w-56')} />
                <Button variant="danger" disabled={killMut.isPending || !reason.trim()} onClick={() => confirm({ title: 'Stop all sending on Sincerely?', body: 'Nothing goes out from any account until you turn it back on.', confirmLabel: 'Stop all sending', tone: 'danger' }, () => killMut.mutate(true))}>
                  Stop
                </Button>
              </div>
            )}
          </div>
        </section>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Sent" value={t.sent.toLocaleString()} sub={`last ${data.days} days`} />
          <Tile label="Bounced" value={pct(t.bounce_rate)} tone={t.bounce_rate >= data.thresholds.bounce ? 'text-red-600 dark:text-red-400' : undefined} sub={`${t.bounced.toLocaleString()} emails`} />
          <Tile label="Spam reports" value={pct(t.complaint_rate, 2)} tone={t.complaint_rate >= data.thresholds.complaint ? 'text-red-600 dark:text-red-400' : undefined} sub={`${t.complained.toLocaleString()} reports`} />
          <Tile label="Mailboxes" value={t.mailboxes.toLocaleString()} sub={`${t.paused_mailboxes} paused, ${flaggedCount} flagged`} />
        </div>

        <Card title="Accounts to look at" icon={ShieldAlert} tone={data.risky.length ? 'danger' : undefined} aside={<span className="text-caption text-[var(--text-tertiary)]">{data.risky.length || 'None'}</span>}>
          {data.risky.length === 0 ? (
            <p className="text-body text-[var(--text-tertiary)] flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> No account is over the lines.</p>
          ) : (
            <ul className="-my-1 divide-y divide-[var(--border-subtle)]">
              {data.risky.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2 flex-wrap sm:flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <Link to={`/admin/accounts?a=${r.id}&tab=account`} className="text-body font-medium text-[var(--text-primary)] hover:underline truncate block">{r.email}</Link>
                    <p className="text-caption text-red-600 dark:text-red-400">{r.reasons.join(', ')} <span className="text-[var(--text-tertiary)]">of {r.sent.toLocaleString()} sent</span></p>
                  </div>
                  {r.held
                    ? <Button size="sm" variant="secondary" disabled={holdMut.isPending} onClick={() => holdMut.mutate({ id: r.id, hold: false })}><PlayCircle className="h-3.5 w-3.5" /> Lift hold</Button>
                    : <Button size="sm" variant="secondary" disabled={holdMut.isPending} onClick={() => confirm({ title: 'Hold all their sending?', body: `Nothing ${r.email} sends goes out until you lift it.`, confirmLabel: 'Hold sending' }, () => holdMut.mutate({ id: r.id, hold: true }))}><PauseCircle className="h-3.5 w-3.5" /> Hold sending</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Mailboxes" icon={Inbox} aside={
          <label className="flex items-center gap-1.5 text-caption text-[var(--text-secondary)]">
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Flagged only
          </label>
        }>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a mailbox or account" aria-label="Find a mailbox" className={cn(inputCls, 'mb-3 sm:max-w-xs')} />
          {boxes.length === 0 ? (
            <p className="text-body text-[var(--text-tertiary)]">{data.mailboxes.length ? 'Nothing matches.' : 'No mailboxes connected yet.'}</p>
          ) : (
            <div className="relative overflow-x-auto -mx-4 -mb-4">
              <table className="w-full min-w-[720px] text-left text-body">
                <thead>
                  <tr className="text-caption text-[var(--text-tertiary)] border-y border-[var(--border-subtle)]">
                    <th className="py-2 px-4 font-medium">Mailbox</th>
                    <th className="py-2 px-2 font-medium">Account</th>
                    <th className="py-2 px-2 font-medium text-right">Sent</th>
                    <th className="py-2 px-2 font-medium text-right">Bounced</th>
                    <th className="py-2 px-2 font-medium text-right">Spam</th>
                    <th className="py-2 px-2 font-medium">State</th>
                    <th className="py-2 px-4 font-medium text-right"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {boxes.slice(0, 500).map((m) => <MailboxRow key={m.id} m={m} busy={boxMut.isPending} thresholds={data.thresholds} onToggle={(active) => boxMut.mutate({ id: m.id, active })} />)}
                </tbody>
              </table>
              {boxes.length > 500 && <p className="px-4 py-2 text-caption text-[var(--text-tertiary)]">Showing the first 500 of {boxes.length.toLocaleString()}. Search to narrow it.</p>}
            </div>
          )}
        </Card>

        <Card title="Domains" icon={Globe} aside={<span className="text-caption text-[var(--text-tertiary)]">Missing SPF or DKIM first</span>}>
          {data.domains.length === 0 ? (
            <p className="text-body text-[var(--text-tertiary)]">No sending domains yet.</p>
          ) : (
            <div className="relative overflow-x-auto -mx-4 -my-4">
              <table className="w-full min-w-[560px] text-left text-body">
                <thead>
                  <tr className="text-caption text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                    <th className="py-2 px-4 font-medium">Domain</th>
                    <th className="py-2 px-2 font-medium">Account</th>
                    <th className="py-2 px-2 font-medium">SPF</th>
                    <th className="py-2 px-2 font-medium">DKIM</th>
                    <th className="py-2 px-2 font-medium">DMARC</th>
                    <th className="py-2 px-4 font-medium">Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.domains.slice(0, 300).map((d) => (
                    <tr key={d.id} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="py-2 px-4 font-medium text-[var(--text-primary)]">{d.domain}</td>
                      <td className="py-2 px-2 max-w-[220px] truncate"><Link to={`/admin/accounts?a=${d.user_id}`} className="text-[var(--text-secondary)] hover:underline">{d.owner_email || d.user_id.slice(0, 8)}</Link></td>
                      <td className="py-2 px-2"><Check ok={d.spf_ok} /></td>
                      <td className="py-2 px-2"><Check ok={d.dkim_ok} /></td>
                      <td className="py-2 px-2"><Check ok={d.dmarc_ok} /></td>
                      <td className="py-2 px-4 text-caption text-[var(--text-tertiary)] whitespace-nowrap">{d.last_checked_at ? formatDateTime(d.last_checked_at) : 'Never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function MailboxRow({ m, busy, thresholds, onToggle }: { m: AdminMailboxRow; busy: boolean; thresholds: { bounce: number; complaint: number }; onToggle: (active: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <tr className={cn('border-b border-[var(--border-subtle)] last:border-0', m.flagged && 'bg-red-500/[0.04]')}>
      <td className="py-2 px-4 max-w-[240px]">
        <span className="flex items-center gap-1.5 min-w-0">
          {m.flagged && <AlertOctagon className="h-3.5 w-3.5 shrink-0 text-red-600" aria-label="Flagged" />}
          <span className="truncate text-[var(--text-primary)]">{m.email}</span>
        </span>
      </td>
      <td className="py-2 px-2 max-w-[200px] truncate"><Link to={`/admin/accounts?a=${m.user_id}`} className="text-[var(--text-secondary)] hover:underline">{m.owner_email || m.user_id.slice(0, 8)}</Link></td>
      <td className="py-2 px-2 text-right tabular">{m.sent.toLocaleString()}</td>
      <td className={cn('py-2 px-2 text-right tabular', m.sent && m.bounce_rate >= thresholds.bounce ? 'text-red-600 dark:text-red-400 font-medium' : 'text-[var(--text-secondary)]')}>{m.sent ? pct(m.bounce_rate) : '—'}</td>
      <td className={cn('py-2 px-2 text-right tabular', m.sent && m.complaint_rate >= thresholds.complaint ? 'text-red-600 dark:text-red-400 font-medium' : 'text-[var(--text-secondary)]')}>{m.sent ? pct(m.complaint_rate, 2) : '—'}</td>
      <td className="py-2 px-2 text-caption text-[var(--text-tertiary)] whitespace-nowrap">
        {!m.is_active ? 'Paused' : !m.is_verified ? 'Not verified' : m.autopilot_state && m.autopilot_state !== 'active' ? m.autopilot_state.charAt(0).toUpperCase() + m.autopilot_state.slice(1) : 'Sending'}
      </td>
      <td className="py-2 px-4 text-right">
        {m.is_active
          ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm({ title: `Pause ${m.email}?`, body: 'It stops sending at once. Its owner can turn it back on in their settings; hold their sending if it needs to stay off.', confirmLabel: 'Pause mailbox' }, () => onToggle(false))}>Pause</Button>
          : <Button size="sm" variant="ghost" disabled={busy} onClick={() => onToggle(true)}>Turn on</Button>}
      </td>
    </tr>
  );
}

function Check({ ok }: { ok: boolean | null }) {
  if (ok === null || ok === undefined) return <span className="text-caption text-[var(--text-tertiary)]">—</span>;
  return ok
    ? <span className="text-caption font-medium text-emerald-700 dark:text-emerald-400">OK</span>
    : <span className="text-caption font-medium text-red-600 dark:text-red-400">Missing</span>;
}


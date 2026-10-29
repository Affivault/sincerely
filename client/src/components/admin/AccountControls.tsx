import { useState } from 'react';
import {
  Ban, BadgeCheck, KeyRound, Link2, LogOut, Mail, MailX, PauseCircle, PlayCircle, Trash2, UserCog,
} from 'lucide-react';
import { formatDateTime, type AdminAccountDetail } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { Card, Row, inputBase, inputCls, useAdminAction } from './adminUi';
import { relTime } from './adminFormat';

/*
 * The account itself: sign-in, email, sessions, sending, suspension and
 * deletion. Everything here is in the activity log.
 */
export function AccountControls({ id, data, onDeleted }: { id: string; data: AdminAccountDetail; onDeleted: () => void }) {
  const confirm = useConfirm();
  const { account: a, controls } = data;
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [link, setLink] = useState<{ kind: string; url: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');

  const linkMut = useAdminAction((kind: 'magiclink' | 'recovery') => adminApi.signInLink(id, kind), 'Link ready. It works once.', 'The link could not be made.');
  const resetMut = useAdminAction(() => adminApi.resetEmail(id), `Password reset email sent to ${a.email}.`, 'The email could not be sent.');
  const emailMut = useAdminAction(() => adminApi.changeEmail(id, email), () => `Email changed to ${email.trim()}.`, 'The email could not be changed.');
  const verifyMut = useAdminAction(() => adminApi.verifyEmail(id), 'Email marked as confirmed.', 'The email could not be confirmed.');
  const signOutMut = useAdminAction(() => adminApi.signOut(id), 'Signed out on every device.', 'They could not be signed out.');
  const pauseMut = useAdminAction(() => adminApi.pauseCampaigns(id), (r) => (r.paused ? `${r.paused} campaign${r.paused === 1 ? '' : 's'} paused.` : 'Nothing was running.'), 'The campaigns could not be paused.');
  const holdMut = useAdminAction((hold: boolean) => adminApi.sendingHold(id, hold), (_r, hold) => (hold ? 'Sending is on hold. Nothing of theirs goes out.' : 'Sending is back on.'), 'The hold could not be changed.');
  const suspendMut = useAdminAction(() => adminApi.suspend(id, reason), 'Account suspended. They are signed out and nothing of theirs runs.', 'The account could not be suspended.');
  const unsuspendMut = useAdminAction(() => adminApi.unsuspend(id), 'Suspension lifted. They can sign in again.', 'The suspension could not be lifted.');
  const deleteMut = useAdminAction(() => adminApi.deleteAccount(id, typed), 'Account deleted.', 'The account could not be deleted.');

  const makeLink = (kind: 'magiclink' | 'recovery') =>
    linkMut.mutate(kind, { onSuccess: (r) => setLink({ kind, url: r.link }) });
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked: it is selectable */ } };

  return (
    <div className="space-y-4">
      <Card title="Sign-in and email" icon={KeyRound}>
        <Row title="One-time sign-in link" sub="Signs them straight in. Pass it on yourself; it works once and expires within the hour.">
          <Button size="sm" variant="secondary" disabled={linkMut.isPending} onClick={() => makeLink('magiclink')}><Link2 className="h-3.5 w-3.5" /> Make link</Button>
        </Row>
        <Row title="Reset their password" sub="Email Supabase’s reset message to them, or make the reset link to pass on.">
          <Button size="sm" variant="secondary" disabled={resetMut.isPending} onClick={() => resetMut.mutate(undefined)}><Mail className="h-3.5 w-3.5" /> Email it</Button>
          <Button size="sm" variant="ghost" disabled={linkMut.isPending} onClick={() => makeLink('recovery')}>Make link</Button>
        </Row>
        {link && (
          <div className="my-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 p-2.5">
            <p className="text-caption text-[var(--text-tertiary)] mb-1">{link.kind === 'recovery' ? 'Password reset link' : 'Sign-in link'} for {a.email}</p>
            <div className="flex items-center gap-2">
              <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className={cn(inputCls, 'font-mono text-caption')} aria-label="Link" />
              <Button size="sm" variant="secondary" onClick={() => copy(link.url)}>Copy</Button>
            </div>
          </div>
        )}
        <Row title="Change email" sub="Takes effect at once and is marked confirmed. Their Stripe receipts move to it too.">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="new@example.com" aria-label="New email" className={cn(inputBase, 'w-52')} />
          <Button size="sm" variant="secondary" disabled={emailMut.isPending || !email.includes('@')} onClick={() => confirm({ title: 'Change their email?', body: `${a.email} becomes ${email.trim()}. They sign in with the new one from now on.`, confirmLabel: 'Change email' }, () => emailMut.mutate(undefined, { onSuccess: () => setEmail('') }))}>Change</Button>
        </Row>
        <Row title="Email confirmation" sub={a.email_confirmed ? 'Confirmed.' : 'Not confirmed yet. Confirm it if they cannot find the email.'}>
          {!a.email_confirmed && <Button size="sm" variant="secondary" disabled={verifyMut.isPending} onClick={() => verifyMut.mutate(undefined)}><BadgeCheck className="h-3.5 w-3.5" /> Mark confirmed</Button>}
        </Row>
      </Card>

      <Card title="Sessions" icon={LogOut}>
        <Row
          title="Sign out everywhere"
          sub={<>Ends every session on every device, and refuses tokens already issued. Last sign-in {relTime(a.last_sign_in_at).toLowerCase()}.{controls.sessions_revoked_at && ` Last signed out from here ${formatDateTime(controls.sessions_revoked_at)}.`}</>}
        >
          <Button size="sm" variant="secondary" disabled={signOutMut.isPending} onClick={() => confirm({ title: 'Sign them out everywhere?', body: `${a.email} has to sign in again on every device.`, confirmLabel: 'Sign out' }, () => signOutMut.mutate(undefined))}><LogOut className="h-3.5 w-3.5" /> Sign out</Button>
        </Row>
      </Card>

      <Card title="Sending" icon={MailX}>
        <Row title="Pause all campaigns" sub={data.live_campaigns ? `${data.live_campaigns} running or scheduled. They can start them again themselves.` : 'Nothing is running or scheduled.'}>
          <Button size="sm" variant="secondary" disabled={pauseMut.isPending || !data.live_campaigns} onClick={() => confirm({ title: `Pause ${data.live_campaigns} campaign${data.live_campaigns === 1 ? '' : 's'}?`, body: 'They show as paused by Sincerely, and they can start them again.', confirmLabel: 'Pause campaigns' }, () => pauseMut.mutate(undefined))}><PauseCircle className="h-3.5 w-3.5" /> Pause</Button>
        </Row>
        <Row
          title={controls.sending_paused_at ? 'Sending is on hold' : 'Hold all sending'}
          sub={controls.sending_paused_at
            ? `Since ${formatDateTime(controls.sending_paused_at)}. Nothing of theirs goes out, and they cannot lift it.`
            : 'Stops every email they send, campaign or one-off, until you lift it. Their campaigns wait rather than fail.'}
        >
          {controls.sending_paused_at
            ? <Button size="sm" variant="secondary" disabled={holdMut.isPending} onClick={() => holdMut.mutate(false)}><PlayCircle className="h-3.5 w-3.5" /> Lift hold</Button>
            : <Button size="sm" variant="secondary" disabled={holdMut.isPending || !data.controls_ready} onClick={() => confirm({ title: 'Hold all their sending?', body: `Nothing ${a.email} sends goes out until you lift the hold.`, confirmLabel: 'Hold sending' }, () => holdMut.mutate(true))}><PauseCircle className="h-3.5 w-3.5" /> Hold</Button>}
        </Row>
      </Card>

      <Card title="Suspend, or delete" icon={UserCog} tone="danger">
        {a.suspended ? (
          <Row title="Suspended" sub={`${controls.suspended_at ? `Since ${formatDateTime(controls.suspended_at)}` : ''}${controls.suspended_reason ? `: ${controls.suspended_reason}` : ''}. They cannot sign in, and nothing of theirs runs.`}>
            <Button size="sm" variant="secondary" disabled={unsuspendMut.isPending} onClick={() => unsuspendMut.mutate(undefined)}>Lift suspension</Button>
          </Row>
        ) : (
          <Row title="Suspend" sub="Signs them out and stops them signing in. Campaigns stop and nothing paid runs. Their data is kept.">
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Reason (only you see it)" aria-label="Reason for suspending" className={cn(inputBase, 'w-52')} disabled={!data.controls_ready} />
            <Button size="sm" variant="danger" disabled={suspendMut.isPending || !data.controls_ready} onClick={() => confirm({ title: 'Suspend this account?', body: `${a.email} is signed out and cannot sign in until you lift it.`, confirmLabel: 'Suspend', tone: 'danger' }, () => suspendMut.mutate(undefined, { onSuccess: () => setReason('') }))}><Ban className="h-3.5 w-3.5" /> Suspend</Button>
          </Row>
        )}
        <Row title="Delete account" sub="Cancels any Stripe subscription, then deletes the account and everything in it. This cannot be undone.">
          <Button size="sm" variant="danger" onClick={() => { setTyped(''); setDeleting(true); }}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
        </Row>
      </Card>

      <Modal
        isOpen={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this account for good?"
        description={`Everything in ${a.email} goes: contacts, campaigns, mailboxes, history. Type their email to confirm.`}
        size="sm"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(false)}>Keep it</Button>
            <Button
              variant="danger"
              disabled={deleteMut.isPending || typed.trim().toLowerCase() !== a.email.toLowerCase()}
              onClick={() => deleteMut.mutate(undefined, { onSuccess: () => { setDeleting(false); onDeleted(); } })}
            >
              {deleteMut.isPending ? 'Deleting…' : 'Delete for good'}
            </Button>
          </div>
        )}
      >
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={a.email} aria-label="Type their email" className={inputCls} autoFocus />
      </Modal>
    </div>
  );
}

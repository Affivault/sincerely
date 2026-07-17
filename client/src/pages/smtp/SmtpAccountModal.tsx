import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { smtpApi } from '../../api/smtp.api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { RichTextEditor } from '../../components/ui/RichTextEditor';
import { cn } from '../../lib/utils';
import {
  CheckCircle2, XCircle, HelpCircle, Globe, Server, Loader2, Plug, Inbox,
  ChevronDown, Send, ShieldCheck, Signature, Gauge, Sparkles, Mail, MinusCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SmtpAccount, CreateSmtpAccountInput, SmtpPreset, VerifyLegResult } from '@lemlist/shared';
import { SMTP_PRESETS, detectPresetFromEmail } from '@lemlist/shared';

type Form = CreateSmtpAccountInput & { from_name?: string | null; imap_user?: string };

const emptyForm: Form = {
  label: '',
  from_name: '',
  email_address: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_pass: '',
  imap_host: undefined,
  imap_port: undefined,
  imap_secure: undefined,
  daily_send_limit: 200,
  signature_html: '',
  signature_auto: false,
};

export function presetToForm(preset: SmtpPreset): Form {
  return {
    label: preset.name,
    from_name: '',
    email_address: '',
    smtp_host: preset.smtp_host,
    smtp_port: preset.smtp_port,
    smtp_secure: preset.smtp_secure,
    smtp_user: '',
    smtp_pass: '',
    imap_host: preset.imap_host || undefined,
    imap_port: preset.imap_port || undefined,
    imap_secure: preset.imap_secure ?? undefined,
    daily_send_limit: preset.recommended_daily_limit || 200,
    signature_html: '',
    signature_auto: false,
  };
}

type VerifyState = {
  status: 'idle' | 'checking' | 'done';
  smtp?: VerifyLegResult;
  imap?: VerifyLegResult;
  message?: string;
};

/** Encryption is derived from port + a secure flag. SSL=implicit TLS (465),
 *  STARTTLS/None = upgrade-or-plain (587/25). Kept simple: SSL vs STARTTLS. */
function EncryptionRadios({ secure, onChange }: { secure: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-4 text-[12.5px]">
      <span className="text-[var(--text-tertiary)]">Encryption</span>
      {[{ v: true, l: 'SSL' }, { v: false, l: 'TLS / STARTTLS' }].map((opt) => (
        <label key={opt.l} className="flex items-center gap-1.5 cursor-pointer text-[var(--text-secondary)]">
          <input type="radio" checked={secure === opt.v} onChange={() => onChange(opt.v)} className="accent-[var(--indigo)]" />
          {opt.l}
        </label>
      ))}
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, children, tint = 'default' }: {
  icon: typeof Server; title: string; subtitle?: string; children: React.ReactNode;
  tint?: 'default' | 'indigo' | 'emerald';
}) {
  const iconCls = tint === 'indigo' ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)]'
    : tint === 'emerald' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]';
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-start gap-2.5 mb-3">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0', iconCls)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-[var(--text-primary)] leading-tight">{title}</h4>
          {subtitle && <p className="text-[11.5px] text-[var(--text-tertiary)] leading-tight mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function LegRow({ label, leg }: { label: string; leg?: VerifyLegResult }) {
  if (!leg) return null;
  const icon = leg.status === 'ok' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    : leg.status === 'skipped' ? <MinusCircle className="h-4 w-4 text-[var(--text-muted)]" />
    : <XCircle className="h-4 w-4 text-rose-500" />;
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <span className="flex-shrink-0 mt-px">{icon}</span>
      <span className="text-[var(--text-secondary)]"><span className="font-medium text-[var(--text-primary)]">{label}:</span> {leg.message}</span>
    </div>
  );
}

/**
 * Connect / edit a sending mailbox. Sectioned like a dedicated setup surface:
 * sender identity → SMTP → IMAP → advanced (limits + signature), with a
 * two-part "Check connection" that proves both send (SMTP) and receive (IMAP)
 * before saving.
 */
export function SmtpAccountModal({
  open, onClose, editAccount, initialPreset,
}: {
  open: boolean;
  onClose: () => void;
  editAccount?: SmtpAccount | null;
  initialPreset?: SmtpPreset | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>({ ...emptyForm });
  const [activePreset, setActivePreset] = useState<SmtpPreset | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [replyToOn, setReplyToOn] = useState(false);

  const editId = editAccount?.id || null;

  // Re-seed the form whenever the modal opens for a different target.
  useEffect(() => {
    if (!open) return;
    setVerify({ status: 'idle' });
    setShowAdvanced(false);
    setReplyToOn(!!editAccount?.reply_to);
    if (editAccount) {
      setActivePreset(null);
      setAutoDetected(false);
      setForm({
        label: editAccount.label,
        from_name: editAccount.from_name || '',
        reply_to: editAccount.reply_to || '',
        email_address: editAccount.email_address,
        smtp_host: editAccount.smtp_host,
        smtp_port: editAccount.smtp_port,
        smtp_secure: editAccount.smtp_secure,
        smtp_user: editAccount.smtp_user,
        smtp_pass: '',
        imap_host: editAccount.imap_host || undefined,
        imap_port: editAccount.imap_port || undefined,
        imap_secure: editAccount.imap_secure ?? undefined,
        daily_send_limit: editAccount.daily_send_limit,
        signature_html: editAccount.signature_html || '',
        signature_auto: editAccount.signature_auto || false,
      });
    } else if (initialPreset) {
      setActivePreset(initialPreset);
      setAutoDetected(false);
      setForm(presetToForm(initialPreset));
    } else {
      setActivePreset(null);
      setAutoDetected(false);
      setForm({ ...emptyForm });
    }
  }, [open, editAccount, initialPreset]);

  const updateField = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setVerify({ status: 'idle' });
  };

  const applyPreset = (presetName: string) => {
    const preset = SMTP_PRESETS.find((p) => p.name === presetName);
    setVerify({ status: 'idle' });
    if (preset) {
      setActivePreset(preset);
      setForm((prev) => ({
        ...prev,
        smtp_host: preset.smtp_host,
        smtp_port: preset.smtp_port,
        smtp_secure: preset.smtp_secure,
        imap_host: preset.imap_host || undefined,
        imap_port: preset.imap_port || undefined,
        imap_secure: preset.imap_secure ?? undefined,
        daily_send_limit: preset.recommended_daily_limit || prev.daily_send_limit,
      }));
    } else {
      setActivePreset(null);
    }
  };

  /** Auto-detect provider from the email domain as the user types. */
  const handleEmailChange = useCallback((email: string) => {
    setVerify({ status: 'idle' });
    setForm((prev) => ({ ...prev, email_address: email, smtp_user: prev.smtp_user || email }));
    if (!editId && (!activePreset || autoDetected)) {
      const detected = detectPresetFromEmail(email);
      if (detected) {
        setActivePreset(detected);
        setAutoDetected(true);
        setForm((prev) => ({
          ...prev,
          email_address: email,
          smtp_user: email,
          label: prev.label || detected.name,
          smtp_host: detected.smtp_host,
          smtp_port: detected.smtp_port,
          smtp_secure: detected.smtp_secure,
          imap_host: detected.imap_host || undefined,
          imap_port: detected.imap_port || undefined,
          imap_secure: detected.imap_secure ?? undefined,
          daily_send_limit: detected.recommended_daily_limit || prev.daily_send_limit,
        }));
      } else if (autoDetected) {
        setActivePreset(null);
        setAutoDetected(false);
      }
    }
  }, [activePreset, autoDetected, editId]);

  const saveMutation = useMutation({
    mutationFn: (input: Form) => (editId ? smtpApi.update(editId, input) : smtpApi.create(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
      toast.success(editId ? 'Account updated' : 'Account connected');
      onClose();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || err.message || 'Failed to save');
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => smtpApi.verify({
      email_address: form.email_address,
      from_name: form.from_name,
      smtp_host: form.smtp_host,
      smtp_port: Number(form.smtp_port),
      smtp_secure: !!form.smtp_secure,
      smtp_user: form.smtp_user || form.email_address,
      smtp_pass: form.smtp_pass,
      imap_host: form.imap_host || undefined,
      imap_port: form.imap_port ? Number(form.imap_port) : undefined,
      imap_secure: form.imap_secure,
      imap_user: form.imap_user || form.smtp_user || form.email_address,
    }),
    onMutate: () => setVerify({ status: 'checking' }),
    onSuccess: (res) => setVerify({ status: 'done', smtp: res.smtp, imap: res.imap, message: res.message }),
    onError: (err: any) => setVerify({
      status: 'done',
      smtp: { ok: false, status: 'fail', message: err.response?.data?.error || err.message || 'Connection failed' },
      message: err.response?.data?.error || 'Connection failed',
    }),
  });

  const canVerify = !!form.email_address && !!form.smtp_host && !!form.smtp_user && !!form.smtp_pass;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sig = (form.signature_html || '').replace(/<[^>]*>/g, '').trim();
    saveMutation.mutate({
      ...form,
      from_name: (form.from_name || '').trim() || null,
      reply_to: (form.reply_to || '').trim() || null,
      smtp_user: form.smtp_user || form.email_address,
      signature_html: sig ? form.signature_html : null,
      signature_auto: sig ? !!form.signature_auto : false,
    });
  };

  const isQuickMode = !!activePreset && !editId;
  const passwordLabel = activePreset?.password_hint || 'Password';
  const passwordPlaceholder = activePreset?.password_hint || (editId ? 'Leave blank to keep current' : 'Enter password or app key');
  const verifyOk = verify.status === 'done' && verify.smtp?.ok && verify.imap?.status !== 'fail';

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={editId ? 'Email account settings' : isQuickMode ? `Connect ${activePreset!.name}` : 'Connect an email account'}
      description={isQuickMode ? `${activePreset!.name} is pre-filled — just add your email and password.` : 'Set up sending (SMTP) and receiving (IMAP), then test before you save.'}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        {isQuickMode && activePreset!.password_hint && (
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-[11.5px] text-[var(--text-tertiary)]">
            <HelpCircle className="h-3.5 w-3.5 shrink-0" /> Password tip: {activePreset!.password_hint}
          </div>
        )}
        {autoDetected && activePreset && !editId && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-[12px] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Auto-detected <span className="font-medium">{activePreset.name}</span> — server settings pre-filled.
          </div>
        )}

        {/* Sender identity */}
        <Section icon={Mail} title="Sender" subtitle="How your emails appear to recipients." tint="indigo">
          <div className="grid grid-cols-2 gap-3">
            <Input label="From name" value={form.from_name || ''} onChange={(e) => updateField('from_name', e.target.value)} placeholder="e.g. Thomas Vance" hint="Shown in the From field" />
            <Input label="Label (internal)" value={form.label} onChange={(e) => updateField('label', e.target.value)} placeholder="e.g. Outreach, Yieldtrak" required />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Input label="From email" type="email" value={form.email_address} onChange={(e) => handleEmailChange(e.target.value)} placeholder={activePreset?.username_hint || 'you@company.com'} required />
            <Input label={passwordLabel} type="password" value={form.smtp_pass} onChange={(e) => updateField('smtp_pass', e.target.value)} placeholder={passwordPlaceholder} required={!editId} autoComplete="new-password" />
          </div>
          {/* Reply-to */}
          <button
            type="button"
            onClick={() => { setReplyToOn((v) => { if (v) updateField('reply_to', ''); return !v; }); }}
            className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--indigo)] hover:underline"
          >
            <span className={cn('relative inline-flex h-[16px] w-7 items-center rounded-full transition-colors', replyToOn ? 'bg-[var(--indigo)]' : 'bg-[var(--border-default)]')}>
              <span className={cn('inline-block h-3 w-3 rounded-full bg-white shadow transition-transform', replyToOn ? 'translate-x-[13px]' : 'translate-x-[2px]')} />
            </span>
            Set a different reply-to address
          </button>
          {replyToOn && (
            <Input className="mt-2" type="email" value={form.reply_to || ''} onChange={(e) => updateField('reply_to', e.target.value)} placeholder="replies@company.com" hint="Replies are directed here instead of your From address" />
          )}
          {!isQuickMode && !editId && (
            <div className="mt-3">
              <Select
                label="Provider preset"
                options={[{ value: '', label: 'Custom configuration' }, ...SMTP_PRESETS.map((p) => ({ value: p.name, label: p.name }))]}
                value={activePreset?.name || ''}
                onChange={(e) => applyPreset(e.target.value)}
              />
            </div>
          )}
        </Section>

        {/* SMTP */}
        <Section icon={Send} title="SMTP — sending" subtitle="The server Sincerely sends your campaigns through.">
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <Input label="Host" value={form.smtp_host} onChange={(e) => updateField('smtp_host', e.target.value)} placeholder="smtp.example.com" required />
            <Input label="Port" type="number" value={String(form.smtp_port)} onChange={(e) => updateField('smtp_port', parseInt(e.target.value) || 0)} required />
          </div>
          <div className="mt-3">
            <Input label="Username" value={form.smtp_user} onChange={(e) => updateField('smtp_user', e.target.value)} placeholder={activePreset?.username_hint || 'Usually your email address'} />
          </div>
          <div className="mt-3">
            <EncryptionRadios secure={!!form.smtp_secure} onChange={(v) => updateField('smtp_secure', v)} />
          </div>
        </Section>

        {/* IMAP */}
        <Section icon={Inbox} title="IMAP — receiving replies" subtitle="Lets replies sync into your unibox. Recommended, but optional.">
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <Input label="Host" value={form.imap_host || ''} onChange={(e) => updateField('imap_host', e.target.value || undefined)} placeholder="imap.example.com" />
            <Input label="Port" type="number" value={String(form.imap_port || '')} onChange={(e) => updateField('imap_port', parseInt(e.target.value) || undefined)} placeholder="993" />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3 items-end">
            <Input label="Username (if different)" value={form.imap_user || ''} onChange={(e) => updateField('imap_user', e.target.value)} placeholder="Defaults to SMTP username" />
            <div className="pb-1.5">
              <EncryptionRadios secure={form.imap_secure !== false} onChange={(v) => updateField('imap_secure', v)} />
            </div>
          </div>
        </Section>

        {/* Advanced (collapsible) */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="w-full flex items-center gap-2.5 px-4 h-12 hover:bg-[var(--bg-hover)] transition-colors text-left">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0"><Gauge className="h-3.5 w-3.5" /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-semibold text-[var(--text-primary)]">Optional settings</span>
              <span className="block text-[11.5px] text-[var(--text-tertiary)]">Daily sending limit and signature</span>
            </span>
            <ChevronDown className={cn('h-4 w-4 text-[var(--text-tertiary)] transition-transform', showAdvanced && 'rotate-180')} />
          </button>
          {showAdvanced && (
            <div className="border-t border-[var(--border-subtle)] p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Input label="Daily sending limit" type="number" value={String(form.daily_send_limit || 200)} onChange={(e) => updateField('daily_send_limit', parseInt(e.target.value) || 0)} hint="Cap on real campaign sends per day" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-primary)]"><Signature className="h-3.5 w-3.5 text-[var(--text-tertiary)]" /> Email signature</span>
                  <button type="button" role="switch" aria-checked={!!form.signature_auto} onClick={() => updateField('signature_auto', !form.signature_auto)} className="flex items-center gap-2 text-[11.5px] font-medium text-[var(--text-secondary)]">
                    Always add to new emails
                    <span className={cn('relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors', form.signature_auto ? 'bg-[var(--indigo)]' : 'bg-[var(--border-default)]')}>
                      <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform', form.signature_auto ? 'translate-x-[15px]' : 'translate-x-[2px]')} />
                    </span>
                  </button>
                </div>
                <RichTextEditor
                  key={`sig-${editId || 'new'}`}
                  initialContent={form.signature_html || ''}
                  onChange={(html, text) => updateField('signature_html', text.trim() ? html : '')}
                  minHeight="100px"
                  placeholder="e.g. Thomas Vance — Growth, Yieldtrak · thomas@yieldtrak.com"
                />
              </div>
            </div>
          )}
        </div>

        {/* Connection check result */}
        {verify.status !== 'idle' && (
          <div className={cn(
            'rounded-xl border px-3.5 py-3 space-y-1.5',
            verify.status === 'checking' && 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
            verify.status === 'done' && verifyOk && 'border-emerald-500/30 bg-emerald-500/8',
            verify.status === 'done' && !verifyOk && 'border-rose-500/30 bg-rose-500/8',
          )}>
            {verify.status === 'checking' ? (
              <div className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Testing SMTP{form.imap_host ? ' and IMAP' : ''}…
              </div>
            ) : (
              <>
                <LegRow label="SMTP (sending)" leg={verify.smtp} />
                <LegRow label="IMAP (receiving)" leg={verify.imap} />
              </>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-3.5 border-t border-[var(--border-subtle)] sticky bottom-0 bg-[var(--bg-surface)]">
          <button
            type="button"
            onClick={() => verifyMutation.mutate()}
            disabled={!canVerify || verifyMutation.isPending}
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md text-[12.5px] font-medium border transition-colors disabled:opacity-50',
              verifyOk ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/8'
                : 'border-[var(--border-default)] text-[var(--text-primary)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]'
            )}
            title={canVerify ? 'Test sending and receiving with these credentials' : 'Fill in email, host, username and password first'}
          >
            {verifyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : verifyOk ? <ShieldCheck className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}
            {verifyMutation.isPending ? 'Checking…' : verifyOk ? 'Connection verified' : 'Check connection'}
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : editId ? 'Save changes' : 'Connect account'}
            </Button>
          </div>
        </div>

        <p className="text-[11.5px] text-[var(--text-tertiary)] flex items-center gap-1">
          <Globe className="h-3 w-3" /> Sending from your own domain?{' '}
          <Link to="/domains" className="underline underline-offset-2 hover:text-[var(--text-secondary)]">Set up SPF, DKIM &amp; DMARC</Link> for better deliverability.
          <Sparkles className="h-3 w-3 ml-1 text-[var(--indigo)]" /> Then warm the mailbox up before sending real volume.
        </p>
      </form>
    </Modal>
  );
}

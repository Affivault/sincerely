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
import { CheckCircle2, XCircle, HelpCircle, Globe, Server, Loader2, Plug } from 'lucide-react';
import toast from 'react-hot-toast';
import type { SmtpAccount, CreateSmtpAccountInput, SmtpPreset } from '@lemlist/shared';
import { SMTP_PRESETS, detectPresetFromEmail } from '@lemlist/shared';

type Form = CreateSmtpAccountInput & { from_name?: string | null };

const emptyForm: Form = {
  label: '',
  from_name: '',
  email_address: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: '',
  smtp_pass: '',
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

type VerifyState = { status: 'idle' | 'checking' | 'ok' | 'fail'; message: string };

/**
 * Add / edit / quick-connect modal for a sending mailbox. Self-contained: owns
 * its form state, provider auto-detection, an inline "Check connection" that
 * proves credentials before saving, and the save mutation.
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
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle', message: '' });

  const editId = editAccount?.id || null;

  // Re-seed the form whenever the modal opens for a different target.
  useEffect(() => {
    if (!open) return;
    setVerify({ status: 'idle', message: '' });
    if (editAccount) {
      setActivePreset(null);
      setAutoDetected(false);
      setForm({
        label: editAccount.label,
        from_name: editAccount.from_name || '',
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
    setVerify({ status: 'idle', message: '' });
  };

  const applyPreset = (presetName: string) => {
    const preset = SMTP_PRESETS.find((p) => p.name === presetName);
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
    setVerify({ status: 'idle', message: '' });
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
    }),
    onMutate: () => setVerify({ status: 'checking', message: '' }),
    onSuccess: (res) => setVerify({ status: res.success ? 'ok' : 'fail', message: res.message }),
    onError: (err: any) => setVerify({ status: 'fail', message: err.response?.data?.error || err.message || 'Connection failed' }),
  });

  const canVerify = !!form.email_address && !!form.smtp_host && !!form.smtp_user && !!form.smtp_pass;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sig = (form.signature_html || '').replace(/<[^>]*>/g, '').trim();
    saveMutation.mutate({
      ...form,
      from_name: (form.from_name || '').trim() || null,
      smtp_user: form.smtp_user || form.email_address,
      signature_html: sig ? form.signature_html : null,
      signature_auto: sig ? !!form.signature_auto : false,
    });
  };

  const isQuickMode = !!activePreset && !editId;
  const passwordLabel = activePreset?.password_hint || 'Password';
  const passwordPlaceholder = activePreset?.password_hint || (editId ? 'Leave blank to keep current' : 'Enter password or app key');

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={editId ? 'Edit email account' : isQuickMode ? `Connect ${activePreset!.name}` : 'Connect an email account'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {isQuickMode && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3.5 text-[12.5px] text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">{activePreset!.name}</span> settings are pre-filled — just add your email and password.
            {activePreset!.password_hint && (
              <span className="mt-1 flex items-center gap-1 text-[11.5px] text-[var(--text-tertiary)]">
                <HelpCircle className="h-3 w-3 shrink-0" /> Password: {activePreset!.password_hint}
              </span>
            )}
          </div>
        )}

        {autoDetected && activePreset && !editId && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-secondary)]">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            Auto-detected <span className="font-medium text-[var(--text-primary)]">{activePreset.name}</span> — settings pre-filled
          </div>
        )}

        {/* Identity: how recipients see this sender */}
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="From name"
            value={form.from_name || ''}
            onChange={(e) => updateField('from_name', e.target.value)}
            placeholder="e.g. Thomas Vance"
            hint="Shown to recipients in the From field"
          />
          <Input
            label="Label / tag"
            value={form.label}
            onChange={(e) => updateField('label', e.target.value)}
            placeholder="e.g. Outreach, Yieldtrak"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Email address"
            type="email"
            value={form.email_address}
            onChange={(e) => handleEmailChange(e.target.value)}
            placeholder={activePreset?.username_hint || 'you@company.com'}
            required
          />
          <Input
            label={passwordLabel}
            type="password"
            value={form.smtp_pass}
            onChange={(e) => updateField('smtp_pass', e.target.value)}
            placeholder={passwordPlaceholder}
            required={!editId}
          />
        </div>

        {!isQuickMode && (
          <Select
            label="Provider preset"
            options={[
              { value: '', label: 'Custom configuration' },
              ...SMTP_PRESETS.map((p) => ({ value: p.name, label: p.name })),
            ]}
            value={activePreset?.name || ''}
            onChange={(e) => applyPreset(e.target.value)}
          />
        )}

        {/* SMTP */}
        <div className="border-t border-[var(--border-subtle)] pt-4">
          <h4 className="text-[13px] font-medium text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5 text-[var(--text-tertiary)]" /> SMTP — sending
          </h4>
          <div className="grid grid-cols-3 gap-4">
            <Input label="Host" value={form.smtp_host} onChange={(e) => updateField('smtp_host', e.target.value)} placeholder="smtp.example.com" required />
            <Input label="Port" type="number" value={String(form.smtp_port)} onChange={(e) => updateField('smtp_port', parseInt(e.target.value))} required />
            <Input label="Username" value={form.smtp_user} onChange={(e) => updateField('smtp_user', e.target.value)} placeholder={activePreset?.username_hint || 'Email or username'} />
          </div>
          <div className="mt-3 flex items-center gap-4 text-[12.5px]">
            <span className="text-[var(--text-tertiary)]">Encryption</span>
            {[{ v: true, l: 'SSL' }, { v: false, l: 'STARTTLS / None' }].map((opt) => (
              <label key={opt.l} className="flex items-center gap-1.5 cursor-pointer text-[var(--text-secondary)]">
                <input type="radio" checked={form.smtp_secure === opt.v} onChange={() => updateField('smtp_secure', opt.v)} className="accent-[var(--indigo)]" />
                {opt.l}
              </label>
            ))}
          </div>
        </div>

        {/* IMAP */}
        <div className="border-t border-[var(--border-subtle)] pt-4">
          <h4 className="text-[13px] font-medium text-[var(--text-primary)] mb-3">IMAP — receiving replies (optional)</h4>
          <div className="grid grid-cols-3 gap-4">
            <Input label="IMAP host" value={form.imap_host || ''} onChange={(e) => updateField('imap_host', e.target.value)} placeholder="imap.example.com" />
            <Input label="IMAP port" type="number" value={String(form.imap_port || '')} onChange={(e) => updateField('imap_port', parseInt(e.target.value) || undefined)} placeholder="993" />
            <Input label="Daily send limit" type="number" value={String(form.daily_send_limit || 200)} onChange={(e) => updateField('daily_send_limit', parseInt(e.target.value))} />
          </div>
        </div>

        {/* Signature */}
        <div className="border-t border-[var(--border-subtle)] pt-4">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-[13px] font-medium text-[var(--text-primary)]">Email signature</h4>
            <button
              type="button"
              role="switch"
              aria-checked={!!form.signature_auto}
              onClick={() => updateField('signature_auto', !form.signature_auto)}
              className="flex items-center gap-2 text-[11.5px] font-medium text-[var(--text-secondary)]"
            >
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

        {/* Inline connection check result */}
        {verify.status !== 'idle' && (
          <div className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px]',
            verify.status === 'ok' && 'border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-400',
            verify.status === 'fail' && 'border-rose-500/30 bg-rose-500/8 text-rose-700 dark:text-rose-400',
            verify.status === 'checking' && 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
          )}>
            {verify.status === 'checking' && <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-px" />}
            {verify.status === 'ok' && <CheckCircle2 className="h-4 w-4 shrink-0 mt-px" />}
            {verify.status === 'fail' && <XCircle className="h-4 w-4 shrink-0 mt-px" />}
            <span>{verify.status === 'checking' ? 'Checking connection…' : verify.message}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={() => verifyMutation.mutate()}
            disabled={!canVerify || verifyMutation.isPending}
            className="icon-btn h-9 px-3 text-[12.5px] whitespace-nowrap disabled:opacity-50"
            title={canVerify ? 'Send a self-test to confirm the mailbox works' : 'Fill in email, host, username and password first'}
          >
            <Plug className="h-3.5 w-3.5" /> Check connection
          </button>
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : editId ? 'Save changes' : 'Connect account'}
            </Button>
          </div>
        </div>

        <p className="text-[11.5px] text-[var(--text-tertiary)] flex items-center gap-1">
          <Globe className="h-3 w-3" /> Sending from your own domain? {' '}
          <Link to="/domains" className="underline underline-offset-2 hover:text-[var(--text-secondary)]">Set up SPF, DKIM &amp; DMARC</Link> for better deliverability.
        </p>
      </form>
    </Modal>
  );
}

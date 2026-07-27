import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
  Send, ShieldCheck, Signature, Gauge, Sparkles, Mail, MinusCircle,
  Stethoscope, AlertTriangle, Circle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SmtpAccount, CreateSmtpAccountInput, SmtpPreset, VerifyLegResult, SmtpDiagnostics } from '@lemlist/shared';
import { SMTP_PRESETS, detectPresetFromEmail } from '@lemlist/shared';

/** Map the MX check's provider hint onto our connection presets. */
const HINT_TO_PRESET: Record<string, string> = {
  'Google Workspace': 'Gmail',
  'Microsoft 365': 'Outlook / Microsoft 365',
  'Zoho Mail': 'Zoho Mail',
  'Fastmail': 'Fastmail',
};

const FORM_ID = 'smtp-account-form';

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

type TabId = 'account' | 'server' | 'options';

const TABS: Array<{ id: TabId; label: string; icon: typeof Server }> = [
  { id: 'account', label: 'Account', icon: Mail },
  { id: 'server', label: 'Server', icon: Server },
  { id: 'options', label: 'Options', icon: Gauge },
];

type VerifyState = {
  status: 'idle' | 'checking' | 'done';
  smtp?: VerifyLegResult;
  imap?: VerifyLegResult;
  message?: string;
};

/** A required field that isn't filled in yet, and where to find it. */
type MissingField = { key: string; label: string; tab: TabId };

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

function Section({ icon: Icon, title, subtitle, children }: {
  icon: typeof Server; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-start gap-2 mb-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <h4 className="text-[12.5px] font-semibold text-[var(--text-primary)] leading-tight">{title}</h4>
          {subtitle && <p className="text-[11.5px] text-[var(--text-tertiary)] leading-tight mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function LegRow({ label, leg }: { label: string; leg?: VerifyLegResult }) {
  if (!leg) return null;
  const icon = leg.status === 'ok' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    : leg.status === 'skipped' ? <MinusCircle className="h-3.5 w-3.5 text-[var(--text-muted)]" />
    : <XCircle className="h-3.5 w-3.5 text-rose-500" />;
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <span className="flex-shrink-0 mt-px">{icon}</span>
      <span className="text-[var(--text-secondary)]"><span className="font-medium text-[var(--text-primary)]">{label}:</span> {leg.message}</span>
    </div>
  );
}

/**
 * Connect / edit a sending mailbox.
 *
 * Laid out as three short tabs (Account → Server → Options) rather than one
 * long scroll, with a persistent connection panel and a fixed action bar, so
 * "Check connection" is always in view and always does something visible.
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
  const [replyToOn, setReplyToOn] = useState(false);
  const [tab, setTab] = useState<TabId>('account');
  /** Fields flagged after a check/save attempt, so the gap is visible in place. */
  const [flagged, setFlagged] = useState<string[]>([]);
  /* Staged probe (DNS → port → handshake → sign-in) run on demand after a
     failed check, so the user learns which layer is actually broken. */
  const [diagnostics, setDiagnostics] = useState<SmtpDiagnostics | null>(null);

  const editId = editAccount?.id || null;

  // Re-seed the form whenever the modal opens for a different target.
  useEffect(() => {
    if (!open) return;
    setVerify({ status: 'idle' });
    setDiagnostics(null);
    setFlagged([]);
    setTab('account');
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
        imap_user: editAccount.imap_user || undefined,
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
    setFlagged((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : prev));
    setVerify({ status: 'idle' });
    setDiagnostics(null);
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

  /* ── MX auto-detection ─────────────────────────────────────────────
     For custom domains (steven@yourcompany.com) the static domain map knows
     nothing — so we look up the domain's real mail (MX) records server-side
     and assign settings from what the domain actually uses. */
  const [mxState, setMxState] = useState<{ status: 'idle' | 'checking' | 'done'; note: string }>({ status: 'idle', note: '' });
  const mxTimer = useRef<ReturnType<typeof setTimeout>>();
  const mxCheckedDomain = useRef('');
  useEffect(() => () => clearTimeout(mxTimer.current), []);

  const applyDetectedPreset = useCallback((preset: SmtpPreset, note: string) => {
    setActivePreset(preset);
    setAutoDetected(true);
    setForm((prev) => ({
      ...prev,
      smtp_user: prev.smtp_user || prev.email_address,
      label: prev.label || preset.name,
      smtp_host: preset.smtp_host,
      smtp_port: preset.smtp_port,
      smtp_secure: preset.smtp_secure,
      imap_host: preset.imap_host || undefined,
      imap_port: preset.imap_port || undefined,
      imap_secure: preset.imap_secure ?? undefined,
      daily_send_limit: preset.recommended_daily_limit || prev.daily_send_limit,
    }));
    setMxState({ status: 'done', note });
  }, []);

  const scheduleMxDetect = useCallback((email: string) => {
    clearTimeout(mxTimer.current);
    const domain = (email.split('@')[1] || '').toLowerCase().trim();
    if (!domain || !domain.includes('.') || domain === mxCheckedDomain.current) return;
    mxTimer.current = setTimeout(async () => {
      mxCheckedDomain.current = domain;
      setMxState({ status: 'checking', note: '' });
      try {
        const result = await smtpApi.checkDomain(domain);
        // The user may have typed a different domain while the lookup ran —
        // never apply a stale result to the wrong address.
        if (mxCheckedDomain.current !== domain) return;
        const presetName = result.provider_hint ? HINT_TO_PRESET[result.provider_hint] : undefined;
        const preset = presetName ? SMTP_PRESETS.find((p) => p.name === presetName) : undefined;
        if (preset) {
          applyDetectedPreset(preset, `Detected ${result.provider_hint} from ${domain}'s mail records — settings assigned.`);
        } else if (result.mx?.found) {
          // Unknown provider but real mail service: pre-fill sensible guesses,
          // only into fields the user hasn't already set.
          setForm((prev) => ({
            ...prev,
            smtp_host: prev.smtp_host || `smtp.${domain}`,
            smtp_port: prev.smtp_host ? prev.smtp_port : 465,
            smtp_secure: prev.smtp_host ? prev.smtp_secure : true,
            imap_host: prev.imap_host || `imap.${domain}`,
            imap_port: prev.imap_port || 993,
            imap_secure: prev.imap_secure ?? true,
          }));
          setMxState({ status: 'done', note: `${domain} runs its own mail — pre-filled smtp.${domain} / imap.${domain} as a starting point. Check your provider's docs if the connection test fails.` });
        } else {
          setMxState({ status: 'done', note: `${domain} has no mail (MX) records — double-check the address.` });
        }
      } catch {
        setMxState({ status: 'idle', note: '' });
      }
    }, 650);
  }, [applyDetectedPreset]);

  /** Auto-detect provider from the email domain as the user types. */
  const handleEmailChange = useCallback((email: string) => {
    setVerify({ status: 'idle' });
    setFlagged((prev) => prev.filter((f) => f !== 'email_address'));
    setForm((prev) => ({ ...prev, email_address: email, smtp_user: prev.smtp_user || email }));
    if (!editId && (!activePreset || autoDetected)) {
      const detected = detectPresetFromEmail(email);
      if (detected) {
        setActivePreset(detected);
        setAutoDetected(true);
        setMxState({ status: 'idle', note: '' });
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
      } else {
        if (autoDetected) {
          setActivePreset(null);
          setAutoDetected(false);
        }
        // Custom domain — ask the server what its MX records say.
        scheduleMxDetect(email);
      }
    }
  }, [activePreset, autoDetected, editId, scheduleMxDetect]);

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
      // A saved mailbox is tested with its stored password — the edit form
      // deliberately leaves the field blank, so never require a retype.
      account_id: editId || undefined,
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
    onMutate: () => { setVerify({ status: 'checking' }); setDiagnostics(null); },
    onSuccess: (res) => setVerify({ status: 'done', smtp: res.smtp, imap: res.imap, message: res.message }),
    onError: (err: any) => setVerify({
      status: 'done',
      smtp: { ok: false, status: 'fail', message: err.response?.data?.error || err.message || 'Connection failed' },
      message: err.response?.data?.error || 'Connection failed',
    }),
  });

  const diagnoseMutation = useMutation({
    mutationFn: () => smtpApi.diagnose({
      account_id: editId || undefined,
      smtp_host: form.smtp_host,
      smtp_port: Number(form.smtp_port),
      smtp_secure: !!form.smtp_secure,
      smtp_user: form.smtp_user || form.email_address,
      smtp_pass: form.smtp_pass,
    }),
    onSuccess: (res) => setDiagnostics(res),
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not run diagnostics'),
  });

  /** What's still needed to run a connection test. On a saved account the
   *  password lives server-side, so it isn't part of this list. */
  const missingForCheck = useMemo<MissingField[]>(() => {
    const out: MissingField[] = [];
    if (!form.email_address) out.push({ key: 'email_address', label: 'From email', tab: 'account' });
    if (!form.smtp_pass && !editId) out.push({ key: 'smtp_pass', label: 'Password', tab: 'account' });
    if (!form.smtp_host) out.push({ key: 'smtp_host', label: 'SMTP host', tab: 'server' });
    if (!form.smtp_port) out.push({ key: 'smtp_port', label: 'SMTP port', tab: 'server' });
    return out;
  }, [form.email_address, form.smtp_pass, form.smtp_host, form.smtp_port, editId]);

  const missingForSave = useMemo<MissingField[]>(() => {
    const out = [...missingForCheck];
    if (!form.label) out.push({ key: 'label', label: 'Label', tab: 'account' });
    return out;
  }, [missingForCheck, form.label]);

  /** Send the user straight to the first gap instead of failing silently. */
  const jumpTo = (fields: MissingField[]) => {
    setFlagged(fields.map((f) => f.key));
    setTab(fields[0].tab);
    toast.error(
      fields.length === 1
        ? `Add your ${fields[0].label.toLowerCase()} first`
        : `Still needed: ${fields.map((f) => f.label.toLowerCase()).join(', ')}`
    );
  };

  const handleCheck = () => {
    if (verifyMutation.isPending) return;
    if (missingForCheck.length) { jumpTo(missingForCheck); return; }
    setFlagged([]);
    verifyMutation.mutate();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missingForSave.length) { jumpTo(missingForSave); return; }
    setFlagged([]);
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

  const err = (key: string, msg = 'Required') => (flagged.includes(key) ? msg : undefined);
  const tabHasGap = (id: TabId) => missingForSave.some((m) => m.tab === id && flagged.includes(m.key));

  const isQuickMode = !!activePreset && !editId;
  const passwordLabel = activePreset?.password_hint || 'Password';
  const passwordPlaceholder = activePreset?.password_hint || (editId ? 'Leave blank to keep the saved password' : 'Enter password or app key');
  const verifyOk = verify.status === 'done' && verify.smtp?.ok && verify.imap?.status !== 'fail';
  const verifyFailed = verify.status === 'done' && !verifyOk;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={editId ? 'Email account settings' : isQuickMode ? `Connect ${activePreset!.name}` : 'Connect an email account'}
      description={isQuickMode ? `${activePreset!.name} is pre-filled — just add your email and password.` : 'Set up sending (SMTP) and receiving (IMAP), then test before you save.'}
      size="xl"
      footer={
        <>
          <button
            type="button"
            onClick={handleCheck}
            disabled={verifyMutation.isPending}
            className={cn(
              'mr-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-medium border transition-colors disabled:opacity-60',
              verifyOk ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/8 hover:bg-emerald-500/12'
                : verifyFailed ? 'border-rose-500/40 text-rose-700 dark:text-rose-400 bg-rose-500/8 hover:bg-rose-500/12'
                : 'border-[var(--border-default)] text-[var(--text-primary)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)]'
            )}
            title="Test sending (SMTP) and receiving (IMAP) with these settings"
          >
            {verifyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : verifyOk ? <ShieldCheck className="h-3.5 w-3.5" />
              : <Plug className="h-3.5 w-3.5" />}
            {verifyMutation.isPending ? 'Checking…' : verifyOk ? 'Connection verified' : verifyFailed ? 'Test again' : 'Check connection'}
          </button>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={FORM_ID} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : editId ? 'Save changes' : 'Connect account'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-3.5">
        {/* Tabs — three short panels instead of one long scroll */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 inline-flex items-center justify-center gap-1.5 h-8 rounded-md text-[12.5px] font-medium transition-colors',
                tab === t.id
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {tabHasGap(t.id) && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
            </button>
          ))}
        </div>

        {/* ── Account ── */}
        {tab === 'account' && (
          <div className="space-y-3.5">
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

            <Section icon={Mail} title="Sender" subtitle="How your emails appear to recipients.">
              <div className="grid grid-cols-2 gap-3">
                <Input label="From name" value={form.from_name || ''} onChange={(e) => updateField('from_name', e.target.value)} placeholder="e.g. Thomas Vance" hint="Shown in the From field" />
                <Input label="Label (internal)" value={form.label} onChange={(e) => updateField('label', e.target.value)} placeholder="e.g. Outreach, Yieldtrak" error={err('label')} />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Input label="From email" type="email" value={form.email_address} onChange={(e) => handleEmailChange(e.target.value)} placeholder={activePreset?.username_hint || 'you@company.com'} error={err('email_address')} />
                <Input
                  label={passwordLabel}
                  type="password"
                  value={form.smtp_pass}
                  onChange={(e) => updateField('smtp_pass', e.target.value)}
                  placeholder={passwordPlaceholder}
                  autoComplete="new-password"
                  error={err('smtp_pass')}
                  hint={editId ? 'Saved password is used for tests and sends unless you type a new one' : undefined}
                />
              </div>

              {/* MX-based auto-assignment for custom domains */}
              {mxState.status === 'checking' && (
                <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[var(--text-tertiary)]">
                  <Loader2 className="h-3 w-3 animate-spin" /> Looking up your domain's mail service to assign settings…
                </p>
              )}
              {mxState.status === 'done' && mxState.note && (
                <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
                  <Sparkles className="h-3 w-3 text-[var(--indigo)] mt-px shrink-0" /> {mxState.note}
                </p>
              )}

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

              {!editId && (
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
          </div>
        )}

        {/* ── Server ── */}
        {tab === 'server' && (
          <div className="space-y-4">
            <Section icon={Send} title="SMTP — sending" subtitle="The server Sincerely sends your campaigns through.">
              <div className="grid grid-cols-[2fr_1fr] gap-3">
                <Input label="Host" value={form.smtp_host} onChange={(e) => updateField('smtp_host', e.target.value)} placeholder="smtp.example.com" error={err('smtp_host')} />
                <Input label="Port" type="number" value={String(form.smtp_port)} onChange={(e) => updateField('smtp_port', parseInt(e.target.value) || 0)} error={err('smtp_port')} />
              </div>
              <div className="mt-3">
                <Input label="Username" value={form.smtp_user} onChange={(e) => updateField('smtp_user', e.target.value)} placeholder={activePreset?.username_hint || 'Usually your email address'} hint="Leave blank to use your from email" />
              </div>
              <div className="mt-3">
                <EncryptionRadios secure={!!form.smtp_secure} onChange={(v) => updateField('smtp_secure', v)} />
              </div>
            </Section>

            <div className="h-px bg-[var(--border-subtle)]" />

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
          </div>
        )}

        {/* ── Options ── */}
        {tab === 'options' && (
          <div className="space-y-4">
            <Section icon={Gauge} title="Sending limit" subtitle="Cap on real campaign sends per day from this mailbox.">
              <div className="grid grid-cols-2 gap-3">
                <Input type="number" value={String(form.daily_send_limit || 200)} onChange={(e) => updateField('daily_send_limit', parseInt(e.target.value) || 0)} hint="Warm-up ramps up to this over time" />
              </div>
            </Section>

            <div className="h-px bg-[var(--border-subtle)]" />

            <Section icon={Signature} title="Email signature" subtitle="Appended in the composer for this inbox.">
              <div className="flex items-center justify-end mb-1.5">
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
            </Section>
          </div>
        )}

        {/* ── Connection panel — always present, so the check is never a no-op ── */}
        <div className={cn(
          'rounded-xl border px-3.5 py-3',
          verify.status === 'idle' && 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60',
          verify.status === 'checking' && 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
          verifyOk && 'border-emerald-500/30 bg-emerald-500/8',
          verifyFailed && 'border-rose-500/30 bg-rose-500/8',
        )}>
          {verify.status === 'idle' && (
            missingForCheck.length ? (
              <div className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-px" />
                <span>
                  Still needed before testing:{' '}
                  {missingForCheck.map((m, i) => (
                    <span key={m.key}>
                      {i > 0 && ', '}
                      <button type="button" onClick={() => { setTab(m.tab); setFlagged([m.key]); }} className="font-medium text-[var(--indigo)] hover:underline">
                        {m.label.toLowerCase()}
                      </button>
                    </span>
                  ))}
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                <Circle className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0 mt-px" />
                <span>
                  Not tested yet — hit <span className="font-medium text-[var(--text-primary)]">Check connection</span> to send a probe email to yourself
                  {form.imap_host ? ' and log into IMAP' : ''}.
                </span>
              </div>
            )
          )}

          {verify.status === 'checking' && (
            <div className="flex items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Testing SMTP{form.imap_host ? ' and IMAP' : ''}…
            </div>
          )}

          {verify.status === 'done' && (
            <div className="space-y-1.5">
              <LegRow label="SMTP (sending)" leg={verify.smtp} />
              <LegRow label="IMAP (receiving)" leg={verify.imap} />
              {verifyFailed && !diagnostics && (
                <button
                  type="button"
                  onClick={() => diagnoseMutation.mutate()}
                  disabled={diagnoseMutation.isPending}
                  className="mt-1 inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--indigo)] hover:underline disabled:opacity-60"
                >
                  {diagnoseMutation.isPending
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Pinpointing the failure…</>
                    : <><Stethoscope className="h-3 w-3" /> Find out exactly why</>}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Staged diagnosis — turns "timed out" into a specific, fixable cause */}
        {diagnostics && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-3.5">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Stethoscope className="h-3.5 w-3.5 text-[var(--indigo)]" />
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">
                Diagnosis — {diagnostics.host}:{diagnostics.port}
              </p>
              <span className="flex-1" />
              <button type="button" onClick={() => setDiagnostics(null)} className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                Hide
              </button>
            </div>

            <ol className="space-y-1">
              {diagnostics.stages.map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-[11.5px]">
                  <span className="mt-px flex-shrink-0">
                    {s.status === 'ok' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                    {s.status === 'fail' && <XCircle className="h-3.5 w-3.5 text-rose-500" />}
                    {s.status === 'skipped' && <MinusCircle className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
                  </span>
                  <span className="min-w-0">
                    <span className={cn('font-medium', s.status === 'fail' ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--text-primary)]')}>{s.label}</span>
                    <span className="text-[var(--text-secondary)]"> — {s.detail}</span>
                    {s.ms != null && <span className="text-[var(--text-muted)]"> ({s.ms}ms)</span>}
                  </span>
                </li>
              ))}
            </ol>

            {(() => {
              // A blocked direct port is only a problem when no relay is
              // covering it — with a healthy relay this is a normal, working
              // setup and should read that way.
              const blocking = diagnostics.portBlocked && !diagnostics.relayHealthy;
              return (
                <div className={cn(
                  'mt-3 rounded-lg px-3 py-2.5 border',
                  blocking ? 'border-amber-500/30 bg-amber-500/8'
                    : diagnostics.relayHealthy ? 'border-emerald-500/30 bg-emerald-500/8'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]',
                )}>
                  <p className="text-[12px] font-medium text-[var(--text-primary)]">{diagnostics.verdict}</p>
                  <p className="text-[11.5px] text-[var(--text-secondary)] mt-1 leading-relaxed">{diagnostics.fix}</p>
                  {blocking && (
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-1.5">
                      This is a server-side setting, not something to change on this mailbox.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        <p className="text-[11.5px] text-[var(--text-tertiary)] flex items-center gap-1">
          <Globe className="h-3 w-3" /> Sending from your own domain?{' '}
          <Link to="/domains" className="underline underline-offset-2 hover:text-[var(--text-secondary)]">Set up SPF, DKIM &amp; DMARC</Link> for better deliverability.
        </p>
      </form>
    </Modal>
  );
}

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
  Stethoscope, AlertTriangle, Circle, Eye, EyeOff, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SmtpAccount, CreateSmtpAccountInput, SmtpPreset, VerifyLegResult, MailboxDiagnostics, DiagStage, SetupSectionId, SetupField, SetupSummary } from '@lemlist/shared';
import {
  SMTP_PRESETS, detectPresetFromEmail, PLACEHOLDER, isSenderMismatch,
  missingFields, mailboxLabel, serverSummary, sendingSummary, limitAdvice, sectionsToOpen,
} from '@lemlist/shared';

/** Map the MX check's provider hint onto our connection presets. */
const HINT_TO_PRESET: Record<string, string> = {
  'Google Workspace': 'Gmail',
  'Microsoft 365': 'Outlook / Microsoft 365',
  'Zoho Mail': 'Zoho Mail',
  'Fastmail': 'Fastmail',
  'Spacemail': 'Spacemail',
  'Namecheap Private Email': 'Namecheap Private Email',
  'Titan': 'Titan',
  'Yahoo Mail': 'Yahoo Mail',
  'ProtonMail': 'ProtonMail Bridge',
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
    <div className="flex items-center gap-4 text-body">
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

/**
 * One section of the form, open or shut.
 *
 * The summary line is the whole reason collapsing is allowed: a closed
 * section still says what is in it, and says so in words rather than with a
 * coloured dot. `shouldOpen` in shared guarantees nothing broken is ever
 * behind a closed header, and the tone here makes the same fact visible.
 */
function Disclosure({
  icon: Icon, title, summary, open, onToggle, gap, children,
}: {
  icon: typeof Server;
  title: string;
  summary: SetupSummary | null;
  open: boolean;
  onToggle: () => void;
  gap: boolean;
  children: React.ReactNode;
}) {
  const tone = summary?.tone ?? 'ok';
  return (
    <section className={cn(
      'rounded-xl border transition-colors',
      gap ? 'border-amber-500/40 bg-amber-500/[0.04]'
        : open ? 'border-[var(--border-default)] bg-[var(--bg-surface)]'
        : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50',
    )}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left"
        data-section-toggle
      >
        <span className={cn(
          'mt-px flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md',
          tone === 'ok'
            ? 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
            : 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
        )}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold leading-tight text-[var(--text-primary)]">{title}</span>
          {/*
            * Shown only while shut. With the section open the fields
            * themselves are the summary, and repeating it turns a helpful
            * line into furniture.
            */}
          {!open && summary && (
            <span className={cn(
              'mt-0.5 block text-caption leading-snug',
              tone === 'ok' ? 'text-[var(--text-tertiary)]' : 'text-amber-700 dark:text-amber-400',
            )} data-section-summary>
              {summary.text}
            </span>
          )}
        </span>
        <ChevronDown className={cn(
          'mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--text-tertiary)] transition-transform',
          open && 'rotate-180',
        )} />
      </button>
      {open && <div className="border-t border-[var(--border-subtle)] px-3.5 py-3">{children}</div>}
    </section>
  );
}

/** A labelled group inside an open section. */
function Group({ icon: Icon, title, subtitle, children }: {
  icon: typeof Server; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-1.5">
        <Icon className="h-3 w-3 translate-y-px text-[var(--text-tertiary)]" />
        <h4 className="text-caption font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{title}</h4>
        {subtitle && <span className="text-caption text-[var(--text-tertiary)]">{subtitle}</span>}
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
    <div className="flex items-start gap-2 text-body">
      <span className="flex-shrink-0 mt-px">{icon}</span>
      <span className="text-[var(--text-secondary)]"><span className="font-medium text-[var(--text-primary)]">{label}:</span> {leg.message}</span>
    </div>
  );
}

/**
 * One leg of a staged diagnosis.
 *
 * Titled, because the whole point of running both is being able to tell
 * which one is broken - an unlabelled list of green ticks next to a mailbox
 * that plainly does not work is how the old panel managed to be actively
 * misleading.
 */
function DiagLeg({ title, diag, relayHealthy }: {
  title: string;
  diag: { host: string; port: number; stages: DiagStage[]; verdict: string; fix: string; portBlocked: boolean };
  relayHealthy: boolean | null;
}) {
  const failed = diag.stages.some((s) => s.status === 'fail');
  // A blocked outbound port is only a problem when no relay covers it — with
  // a healthy relay this is a normal, working setup and should read that way.
  const blocking = diag.portBlocked && !relayHealthy;

  return (
    <div>
      <p className="text-caption font-semibold text-[var(--text-primary)] mb-1.5 flex items-center gap-1.5">
        {failed
          ? <XCircle className="h-3.5 w-3.5 text-rose-500" />
          : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
        {title}
        <span className="font-normal text-[var(--text-tertiary)]">— {diag.host}:{diag.port}</span>
      </p>

      <ol className="space-y-1">
        {diag.stages.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-caption">
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

      <div className={cn(
        'mt-2 rounded-lg px-3 py-2.5 border',
        blocking ? 'border-amber-500/30 bg-amber-500/8'
          : failed ? 'border-rose-500/30 bg-rose-500/8'
          : 'border-emerald-500/30 bg-emerald-500/8',
      )}>
        <p className="text-body font-medium text-[var(--text-primary)]">{diag.verdict}</p>
        {diag.fix && <p className="text-caption text-[var(--text-secondary)] mt-1 leading-relaxed">{diag.fix}</p>}
        {blocking && (
          <p className="text-caption text-[var(--text-tertiary)] mt-1.5">
            This is a server-side setting, not something to change on this mailbox.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Connect / edit a sending mailbox.
 *
 * One scroll of three collapsible sections rather than three tabs. The tabs
 * split the two things you need in order to connect - the password and the
 * host - across two panels, so a check could fail for a reason sitting on a
 * panel you were not looking at, signalled by a small amber dot.
 *
 * What starts open is decided from the values by `sectionsToOpen`, under one
 * rule: nothing missing or broken is ever behind a closed header. A detected
 * Gmail account therefore opens as one short panel - address and password -
 * and a custom domain whose MX lookup found nothing opens with the server
 * fields already in front of you.
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
  const [openSections, setOpenSections] = useState<SetupSectionId[]>(['mailbox']);
  const [showPass, setShowPass] = useState(false);
  /*
   * Has the sign-in username been typed deliberately?
   *
   * It mirrors the From address until somebody edits it, and the reason to
   * track that rather than just copying is that `prev.smtp_user || email`
   * looks like it does the same thing and does not: once the field holds
   * anything at all, a later correction to the From address never reaches
   * it. Type acquisitions@, change your mind, type invest@, save - and the
   * mailbox signs in as acquisitions@ for good.
   *
   * The server then rejects the send with "553 Sender address rejected: not
   * owned by user acquisitions@...", which names a mailbox the account
   * holder never typed into this form. Worse, the IMAP leg SUCCEEDS,
   * because those credentials are perfectly valid - so the row quietly
   * reads somebody else's inbox and reports that receiving works.
   */
  const [userEdited, setUserEdited] = useState(false);
  /** Fields flagged after a check/save attempt, so the gap is visible in place. */
  const [flagged, setFlagged] = useState<string[]>([]);
  /* Staged probe (DNS → port → handshake → sign-in) run on demand after a
     failed check, so the user learns which layer is actually broken. */
  const [diagnostics, setDiagnostics] = useState<MailboxDiagnostics | null>(null);

  const editId = editAccount?.id || null;

  /** Open a section. Never closes one — nothing may vanish under the cursor. */
  const reveal = useCallback((id: SetupSectionId) => {
    setOpenSections((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const toggleSection = (id: SetupSectionId) =>
    setOpenSections((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));

  // Re-seed the form whenever the modal opens for a different target.
  useEffect(() => {
    if (!open) return;
    setVerify({ status: 'idle' });
    setDiagnostics(null);
    setFlagged([]);
    setReplyToOn(!!editAccount?.reply_to);
    /*
     * A saved username that differs from the address is treated as
     * deliberate, so re-opening a mailbox never silently rewrites it. It may
     * well be the bug above rather than a choice - the warning below says so
     * - but this form is not entitled to decide that on somebody's behalf.
     */
    setUserEdited(!!editAccount && editAccount.smtp_user !== editAccount.email_address);
    if (editAccount) {
      setActivePreset(null);
      setAutoDetected(false);
      const seeded: Form = {
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
      };
      setForm(seeded);
      /*
       * A saved mailbox is judged on what it actually holds. One with no
       * IMAP server opens straight onto the empty field, because that is
       * the reason its replies never arrive and it is the only thing worth
       * opening this dialog for.
       */
      setOpenSections(sectionsToOpen({ ...seeded, saved: true }));
    } else if (initialPreset) {
      setActivePreset(initialPreset);
      setAutoDetected(false);
      const seeded = presetToForm(initialPreset);
      setForm(seeded);
      setOpenSections(sectionsToOpen({ ...seeded, saved: false }));
    } else {
      setActivePreset(null);
      setAutoDetected(false);
      setForm({ ...emptyForm });
      /*
       * A blank form is not "missing" its servers - it has not been told
       * which mailbox it is yet, and detection fills them in a second later.
       * Opening every section on an empty form would show three panels of
       * fields that are about to fill themselves in.
       */
      setOpenSections(['mailbox']);
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
      smtp_user: userEdited ? prev.smtp_user : (prev.email_address || prev.smtp_user),
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
          /*
           * No preset for this provider, so ask where the mail servers
           * actually are.
           *
           * This used to fill in `smtp.<domain>` / `imap.<domain>`, which for
           * a hosted mailbox is a name that does not exist - the mailboxes
           * live on the provider's hostname, and the MX record says which
           * provider that is. The invented host was accepted, saved, and
           * came back later as "The IMAP host could not be found", blaming
           * the user for a value the app had made up.
           *
           * Only hosts the server resolved are filled in now. Nothing found
           * means an empty field and a sentence saying so, which is worse to
           * look at and better to act on.
           */
          const hosts = result.hosts;
          setForm((prev) => ({
            ...prev,
            smtp_host: prev.smtp_host || hosts?.smtp?.host || '',
            smtp_port: prev.smtp_host ? prev.smtp_port : (hosts?.smtp?.port ?? 465),
            smtp_secure: prev.smtp_host ? prev.smtp_secure : (hosts?.smtp?.secure ?? true),
            imap_host: prev.imap_host || hosts?.imap?.host || undefined,
            imap_port: prev.imap_port || hosts?.imap?.port || 993,
            imap_secure: prev.imap_secure ?? hosts?.imap?.secure ?? true,
          }));
          setMxState({
            status: 'done',
            note: hosts?.note
              // An older server that does not send `hosts` yet. Say nothing
              // about servers rather than inventing them again.
              || `${domain} runs its own mail. Enter the IMAP and SMTP servers from your provider.`,
          });
          /*
           * Nothing was found for this domain, so the fields it would have
           * filled are the user's to fill. Open them rather than leaving a
           * sentence that points at a shut panel.
           */
          if (!hosts?.smtp?.host || !hosts?.imap?.host) reveal('servers');
        } else {
          setMxState({ status: 'done', note: `${domain} has no mail (MX) records — double-check the address.` });
          reveal('servers');
        }
      } catch {
        setMxState({ status: 'idle', note: '' });
      }
    }, 650);
  }, [applyDetectedPreset, reveal]);

  /** Auto-detect provider from the email domain as the user types. */
  const handleEmailChange = useCallback((email: string) => {
    setVerify({ status: 'idle' });
    setFlagged((prev) => prev.filter((f) => f !== 'email_address'));
    setForm((prev) => ({
      ...prev,
      email_address: email,
      // Mirrors until edited. `prev.smtp_user || email` was the bug: it
      // pins the username to whatever was typed first.
      smtp_user: userEdited ? prev.smtp_user : email,
    }));
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
      // Without these the receiving leg cannot be probed at all, which is
      // the leg that is usually broken when somebody presses this button.
      imap_host: form.imap_host || undefined,
      imap_port: form.imap_port ? Number(form.imap_port) : undefined,
      imap_secure: form.imap_secure,
      imap_user: form.imap_user || form.smtp_user || form.email_address,
    }),
    onSuccess: (res) => setDiagnostics(res),
    onError: (err: any) => toast.error(err.response?.data?.error || 'Could not run diagnostics'),
  });

  /*
   * What is still needed, in one list.
   *
   * There were two - `missingForCheck` and `missingForSave`, the second
   * being the first plus a label - which is the same shape as the
   * imapHostFor bug: two definitions that agree right up until one of them
   * is edited. The label is no longer required at all; a mailbox nobody
   * named is called by its address.
   */
  const missing = useMemo<SetupField[]>(() => missingFields({
    email_address: form.email_address,
    smtp_pass: form.smtp_pass,
    smtp_host: form.smtp_host,
    smtp_port: form.smtp_port,
    saved: !!editId,
  }), [form.email_address, form.smtp_pass, form.smtp_host, form.smtp_port, editId]);

  const servers = useMemo(() => serverSummary({
    smtp_host: form.smtp_host, smtp_port: form.smtp_port,
    imap_host: form.imap_host, imap_port: form.imap_port,
  }), [form.smtp_host, form.smtp_port, form.imap_host, form.imap_port]);

  const sending = useMemo(() => sendingSummary({
    daily_send_limit: form.daily_send_limit,
    signature_html: form.signature_html,
    signature_auto: form.signature_auto,
  }), [form.daily_send_limit, form.signature_html, form.signature_auto]);

  const limit = limitAdvice(Number(form.daily_send_limit) || 0);

  /** Send the user straight to the first gap instead of failing silently. */
  const jumpTo = (fields: SetupField[]) => {
    setFlagged(fields.map((f) => f.key));
    // Every section holding a gap is opened, not just the first — a flagged
    // field behind a shut header is exactly what the tabs got wrong.
    for (const f of fields) reveal(f.section);
    toast.error(
      fields.length === 1
        ? `Add your ${fields[0].label} first`
        : `Still needed: ${fields.map((f) => f.label).join(', ')}`
    );
  };

  const handleCheck = () => {
    if (verifyMutation.isPending) return;
    if (missing.length) { jumpTo(missing); return; }
    setFlagged([]);
    verifyMutation.mutate();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missing.length) { jumpTo(missing); return; }
    setFlagged([]);
    const sig = (form.signature_html || '').replace(/<[^>]*>/g, '').trim();
    saveMutation.mutate({
      ...form,
      label: mailboxLabel(form.label, form.email_address),
      from_name: (form.from_name || '').trim() || null,
      reply_to: (form.reply_to || '').trim() || null,
      smtp_user: form.smtp_user || form.email_address,
      signature_html: sig ? form.signature_html : null,
      signature_auto: sig ? !!form.signature_auto : false,
    });
  };

  const err = (key: string, msg = 'Required') => (flagged.includes(key) ? msg : undefined);
  const sectionHasGap = (id: SetupSectionId) =>
    missing.some((m) => m.section === id && flagged.includes(m.key));
  const isOpen = (id: SetupSectionId) => openSections.includes(id);

  const isQuickMode = !!activePreset && !editId;
  const passwordLabel = activePreset?.password_hint || 'Password';
  const passwordPlaceholder = activePreset?.password_hint || (editId ? 'Leave blank to keep the saved password' : 'Enter password or app key');
  /*
   * Signing in as one mailbox and sending as another.
   *
   * Nearly every provider refuses this outright - "553 Sender address
   * rejected: not owned by user ..." - and the ones that allow it need the
   * sender explicitly authorised. It is worth saying before a send fails,
   * because the error names a mailbox the account holder never typed here
   * and reads like a server problem.
   *
   * The receiving half is the quieter danger: those credentials are valid,
   * so IMAP connects happily and this mailbox reads the OTHER account's
   * inbox, reporting success the whole time.
   */
  const senderMismatch = isSenderMismatch(form.smtp_user, form.email_address);

  const verifyOk = verify.status === 'done' && verify.smtp?.ok && verify.imap?.status !== 'fail';
  const verifyFailed = verify.status === 'done' && !verifyOk;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={editId ? 'Email account settings' : isQuickMode ? `Connect ${activePreset!.name}` : 'Connect an email account'}
      description={isQuickMode ? `${activePreset!.name} is pre-filled — just add your email and password.` : 'Add the address and its password. Everything else is filled in from your domain where we can.'}
      size="xl"
      footer={
        <>
          <button
            type="button"
            onClick={handleCheck}
            disabled={verifyMutation.isPending}
            className={cn(
              'mr-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-body font-medium border transition-colors disabled:opacity-60',
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
      {/*
        * autoComplete="off" on the form, and again per field.
        *
        * Chrome ignores the form-level hint on its own, and every manager
        * has its own opt-out attribute, so all three are needed. Without
        * them this form is the classic shape a password manager fills - an
        * email field, a "Username" field and a password field on the same
        * domain - and it filled the username with a DIFFERENT mailbox on
        * that domain. The account holder typed one address and never saw
        * the other one land on a tab they had no reason to revisit.
        */}
      <form
        id={FORM_ID}
        onSubmit={handleSubmit}
        className="space-y-2.5"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
      >
        {isQuickMode && activePreset!.password_hint && (
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-caption text-[var(--text-tertiary)]">
            <HelpCircle className="h-3.5 w-3.5 shrink-0" /> Password tip: {activePreset!.password_hint}
          </div>
        )}
        {autoDetected && activePreset && !editId && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/20 text-body text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Auto-detected <span className="font-medium">{activePreset.name}</span> — server settings pre-filled.
          </div>
        )}

        {/* ── 1. The mailbox ── */}
        <Disclosure
          icon={Mail}
          title="The mailbox"
          summary={{
            text: form.email_address
              ? `${form.email_address}${form.from_name ? ` — from "${form.from_name}"` : ''}`
              : 'No address yet.',
            tone: form.email_address ? 'ok' : 'empty',
          }}
          open={isOpen('mailbox')}
          onToggle={() => toggleSection('mailbox')}
          gap={sectionHasGap('mailbox')}
        >
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email address" type="email" value={form.email_address} onChange={(e) => handleEmailChange(e.target.value)} placeholder={activePreset?.username_hint || 'you@company.com'} error={err('email_address')} autoComplete="off" data-1p-ignore data-lpignore="true" name="sincerely-from-email" />
            <div className="relative">
              <Input
                label={passwordLabel}
                type={showPass ? 'text' : 'password'}
                value={form.smtp_pass}
                onChange={(e) => updateField('smtp_pass', e.target.value)}
                placeholder={passwordPlaceholder}
                autoComplete="new-password"
                error={err('smtp_pass')}
                hint={editId ? 'Saved password is used for tests and sends unless you type a new one' : undefined}
                className="pr-8"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                tabIndex={-1}
                aria-label={showPass ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-[27px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {showPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* MX-based auto-assignment for custom domains */}
          {mxState.status === 'checking' && (
            <p className="mt-2 flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
              <Loader2 className="h-3 w-3 animate-spin" /> Looking up your domain's mail service to assign settings…
            </p>
          )}
          {mxState.status === 'done' && mxState.note && (
            <p className="mt-2 flex items-start gap-1.5 text-caption text-[var(--text-secondary)]">
              <Sparkles className="h-3 w-3 text-[var(--indigo)] mt-px shrink-0" /> {mxState.note}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 mt-3">
            <Input label="From name" value={form.from_name || ''} onChange={(e) => updateField('from_name', e.target.value)} placeholder={`e.g. ${PLACEHOLDER.senderName}`} hint="What recipients see in the From field" />
            {/*
              * Optional, and says so. It used to be required, which meant a
              * custom domain - where no preset fills it in - could not be
              * saved until somebody invented a name for a mailbox that
              * already had a perfectly good one.
              */}
            <Input label="Internal name" value={form.label} onChange={(e) => updateField('label', e.target.value)} placeholder={form.email_address || `e.g. ${PLACEHOLDER.senderCompany} outreach`} hint="Only you see this. Defaults to the address." />
          </div>

          <button
            type="button"
            onClick={() => { setReplyToOn((v) => { if (v) updateField('reply_to', ''); return !v; }); }}
            className="mt-2.5 inline-flex items-center gap-1.5 text-caption font-medium text-[var(--indigo)] hover:underline"
          >
            <span className={cn('relative inline-flex h-[16px] w-7 items-center rounded-full transition-colors', replyToOn ? 'bg-[var(--indigo)]' : 'bg-[var(--border-default)]')}>
              <span className={cn('inline-block h-3 w-3 rounded-full bg-white shadow transition-transform', replyToOn ? 'translate-x-[13px]' : 'translate-x-[2px]')} />
            </span>
            Set a different reply-to address
          </button>
          {replyToOn && (
            <Input className="mt-2" type="email" value={form.reply_to || ''} onChange={(e) => updateField('reply_to', e.target.value)} placeholder="replies@company.com" hint="Replies are directed here instead of your From address" />
          )}
        </Disclosure>

        {/* ── 2. Servers ── */}
        <Disclosure
          icon={Server}
          title="Servers"
          summary={servers}
          open={isOpen('servers')}
          onToggle={() => toggleSection('servers')}
          gap={sectionHasGap('servers')}
        >
          {!editId && (
            <div className="mb-3">
              {/*
                * The preset select lives here, with the fields it writes. It
                * used to sit under the sender fields, which it does not
                * touch, on a different tab from the ones it does.
                */}
              <Select
                label="Provider"
                options={[{ value: '', label: 'Custom / enter servers manually' }, ...SMTP_PRESETS.map((p) => ({ value: p.name, label: p.name }))]}
                value={activePreset?.name || ''}
                onChange={(e) => applyPreset(e.target.value)}
              />
            </div>
          )}

          <Group icon={Send} title="Outgoing" subtitle="— SMTP, used to send your campaigns">
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <Input label="Host" value={form.smtp_host} onChange={(e) => updateField('smtp_host', e.target.value)} placeholder="smtp.example.com" error={err('smtp_host')} />
              <Input label="Port" type="number" value={String(form.smtp_port)} onChange={(e) => updateField('smtp_port', parseInt(e.target.value) || 0)} error={err('smtp_port')} />
            </div>
            {/*
              * The sign-in is shown, not typed.
              *
              * A bare text field called "Username" sitting beside a
              * password field, on a tab nobody revisits, is the ideal
              * shape for a password manager to fill - and it filled it
              * with a DIFFERENT mailbox on the same domain. The account
              * holder typed one address into "From email" and never saw
              * the other one get written here.
              *
              * For nearly every provider this value is the address, so
              * showing it removes a field that can only go wrong. The
              * override stays for the handful that use something else -
              * SendGrid signs in as "apikey", Mailgun as a postmaster
              * handle - but it has to be asked for.
              */}
            <div className="mt-3">
              {userEdited ? (
                <Input
                  label="Sign-in username"
                  value={form.smtp_user}
                  onChange={(e) => updateField('smtp_user', e.target.value)}
                  placeholder={activePreset?.username_hint || 'Usually your email address'}
                  hint="Only change this if your provider signs in with something other than the address"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  name="sincerely-smtp-login"
                />
              ) : (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
                  <p className="text-caption text-[var(--text-tertiary)]">Signs in as</p>
                  <p className="text-body font-medium text-[var(--text-primary)]" data-signs-in-as>
                    {form.email_address || 'your email address'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setUserEdited(true)}
                    className="mt-1 text-caption font-semibold text-[var(--indigo)] hover:underline"
                    data-override-login
                  >
                    Use a different username
                  </button>
                </div>
              )}
            </div>
            <div className="mt-3">
              <EncryptionRadios secure={!!form.smtp_secure} onChange={(v) => updateField('smtp_secure', v)} />
            </div>
          </Group>

          <div className="my-3.5 h-px bg-[var(--border-subtle)]" />

          <Group icon={Inbox} title="Incoming" subtitle="— IMAP, so replies reach your inbox">
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <Input label="Host" value={form.imap_host || ''} onChange={(e) => updateField('imap_host', e.target.value || undefined)} placeholder="imap.example.com" />
              <Input label="Port" type="number" value={String(form.imap_port || '')} onChange={(e) => updateField('imap_port', parseInt(e.target.value) || undefined)} placeholder="993" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3 items-end">
              <Input label="Username (if different)" value={form.imap_user || ''} onChange={(e) => updateField('imap_user', e.target.value)} placeholder="Defaults to the sign-in above" />
              <div className="pb-1.5">
                <EncryptionRadios secure={form.imap_secure !== false} onChange={(v) => updateField('imap_secure', v)} />
              </div>
            </div>
            {/*
              * Said where the empty field is, not only in the collapsed
              * summary. A mailbox with no incoming server is the single
              * commonest reason somebody opens this dialog a second time,
              * having never seen a reply.
              */}
            {!(form.imap_host || '').trim() && (
              <p className="mt-2.5 flex items-start gap-1.5 text-caption leading-snug text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                Without this, Sincerely can send from this address but will never see the replies — they stay in your provider's inbox only.
              </p>
            )}
          </Group>
        </Disclosure>

        {/* ── 3. Sending & signature ── */}
        <Disclosure
          icon={Gauge}
          title="Sending &amp; signature"
          summary={sending}
          open={isOpen('sending')}
          onToggle={() => toggleSection('sending')}
          gap={false}
        >
          <Group icon={Gauge} title="Daily limit" subtitle="— real campaign sends from this mailbox">
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="number"
                min={0}
                placeholder="0 = unlimited"
                value={String(form.daily_send_limit ?? '')}
                onChange={(e) => updateField('daily_send_limit', parseInt(e.target.value) || 0)}
                error={limit.tone === 'danger' ? limit.note : undefined}
                hint={
                  limit.tone !== 'ok' ? undefined
                    : Number(form.daily_send_limit) === 0 ? 'No daily cap on this mailbox'
                    : 'Warm-up ramps up to this over time'
                }
              />
            </div>
            {/*
              * Guidance where the number is typed. The field was a bare
              * input with nothing to say what a survivable figure looks
              * like, which is how a new domain ends up set to 2,000 a day.
              */}
            {limit.tone === 'warning' && (
              <p className="mt-2 flex items-start gap-1.5 text-caption leading-snug text-amber-700 dark:text-amber-400" data-limit-warning>
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" /> {limit.note}
              </p>
            )}
          </Group>

          <div className="my-3.5 h-px bg-[var(--border-subtle)]" />

          <Group icon={Signature} title="Signature" subtitle="— offered in the composer for this inbox">
            <div className="flex items-center justify-end mb-1.5">
              <button type="button" role="switch" aria-checked={!!form.signature_auto} onClick={() => updateField('signature_auto', !form.signature_auto)} className="flex items-center gap-2 text-caption font-medium text-[var(--text-secondary)]">
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
              placeholder={`e.g. ${PLACEHOLDER.senderName} — Growth, ${PLACEHOLDER.senderCompany} · ${PLACEHOLDER.senderEmail}`}
            />
          </Group>
        </Disclosure>

        {/* ── Connection panel — always present, so the check is never a no-op ── */}
        <div className={cn(
          'rounded-xl border px-3.5 py-3 space-y-2',
          verify.status === 'idle' && 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60',
          verify.status === 'checking' && 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]',
          verifyOk && 'border-emerald-500/30 bg-emerald-500/8',
          verifyFailed && 'border-rose-500/30 bg-rose-500/8',
        )}>
          {verify.status === 'idle' && (
            missing.length ? (
              <div className="flex items-start gap-2 text-body text-[var(--text-secondary)]">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-px" />
                <span>
                  Still needed before testing:{' '}
                  {missing.map((m, i) => (
                    <span key={m.key}>
                      {i > 0 && ', '}
                      <button type="button" onClick={() => { reveal(m.section); setFlagged([m.key]); }} className="font-medium text-[var(--indigo)] hover:underline">
                        {m.label}
                      </button>
                    </span>
                  ))}
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-body text-[var(--text-secondary)]">
                <Circle className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0 mt-px" />
                <span>
                  Not tested yet — hit <span className="font-medium text-[var(--text-primary)]">Check connection</span> to send a probe email to yourself
                  {form.imap_host ? ' and log into IMAP' : ''}.
                </span>
              </div>
            )
          )}

          {verify.status === 'checking' && (
            <div className="flex items-center gap-2 text-body text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Testing SMTP{form.imap_host ? ' and IMAP' : ''}…
            </div>
          )}

          {verify.status === 'done' && (
            <div className="space-y-1.5">
              <LegRow label="SMTP (sending)" leg={verify.smtp} />
              <LegRow label="IMAP (receiving)" leg={verify.imap} />
            </div>
          )}

          {senderMismatch && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2.5" data-sender-mismatch>
              <p className="text-body font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                This mailbox signs in as a different address
              </p>
              <p className="text-caption text-[var(--text-secondary)] mt-1 leading-relaxed">
                Sending as <span className="font-medium text-[var(--text-primary)]">{form.email_address}</span>{' '}
                but signing in as <span className="font-medium text-[var(--text-primary)]">{form.smtp_user}</span>.
                Most providers reject that outright, and the ones that allow it need the
                sender authorised first. Receiving is the quieter risk: those credentials
                work, so this mailbox would read {form.smtp_user}&rsquo;s inbox instead of its own.
              </p>
              <button
                type="button"
                onClick={() => { setUserEdited(false); updateField('smtp_user', form.email_address); }}
                className="mt-1.5 text-caption font-semibold text-[var(--indigo)] hover:underline"
                data-fix-sender
              >
                Sign in as {form.email_address} instead
              </button>
            </div>
          )}

          {/*
            * Diagnostics on demand, not only after a failed check.
            *
            * This used to appear solely when a check had run AND come back
            * failed, so the one thing that explains a connection was locked
            * behind the thing that could not explain itself - and if the
            * check errored at the transport, or somebody simply wanted to
            * know why a saved mailbox was quiet, there was no way in at all.
            * There is nothing to protect here: it is four read-only probes.
            */}
          {!diagnostics && form.smtp_host && (
            <button
              type="button"
              onClick={() => diagnoseMutation.mutate()}
              disabled={diagnoseMutation.isPending}
              className="mt-1 inline-flex items-center gap-1.5 text-caption font-semibold text-[var(--indigo)] hover:underline disabled:opacity-60"
              data-run-diagnostics
            >
              {diagnoseMutation.isPending
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Pinpointing the failure…</>
                : <><Stethoscope className="h-3 w-3" /> {verifyFailed ? 'Find out exactly why' : 'Run diagnostics'}</>}
            </button>
          )}
        </div>

        {/* Staged diagnosis — turns "timed out" into a specific, fixable cause */}
        {diagnostics && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-3.5 space-y-3">
            <div className="flex items-center gap-1.5">
              <Stethoscope className="h-3.5 w-3.5 text-[var(--indigo)]" />
              <p className="text-body font-semibold text-[var(--text-primary)]">Diagnosis</p>
              <span className="flex-1" />
              <button type="button" onClick={() => setDiagnostics(null)} className="text-caption text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                Hide
              </button>
            </div>

            {/*
              * Both halves, always, and labelled.
              *
              * This used to show one unlabelled staircase for the SMTP host.
              * When sending worked and receiving did not - which is the
              * common case, and the reason anybody presses this button - it
              * reported every stage green and answered a question nobody had
              * asked.
              */}
            <DiagLeg title="Sending (SMTP)" diag={diagnostics.smtp} relayHealthy={diagnostics.smtp.relayHealthy} />
            {diagnostics.imap
              ? <DiagLeg title="Receiving (IMAP)" diag={diagnostics.imap} relayHealthy={null} />
              : (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
                  <p className="text-body font-medium text-[var(--text-primary)]">Receiving (IMAP) — nothing to test</p>
                  <p className="text-caption text-[var(--text-secondary)] mt-1 leading-relaxed">
                    No IMAP server is set on this mailbox, so replies cannot sync into the unibox.
                    <button type="button" onClick={() => reveal('servers')} className="ml-1 font-medium text-[var(--indigo)] hover:underline">
                      Add one under Servers.
                    </button>
                  </p>
                </div>
              )}
          </div>
        )}

        <p className="text-caption text-[var(--text-tertiary)] flex items-center gap-1">
          <Globe className="h-3 w-3" /> Sending from your own domain?{' '}
          <Link to="/domains" className="underline underline-offset-2 hover:text-[var(--text-secondary)]">Set up SPF, DKIM &amp; DMARC</Link> for better deliverability.
        </p>
      </form>
    </Modal>
  );
}

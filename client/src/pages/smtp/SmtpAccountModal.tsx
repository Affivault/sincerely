import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { smtpApi } from '../../api/smtp.api';
import { domainApi } from '../../api/domain.api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Modal } from '../../components/ui/Modal';
import { RichTextEditor } from '../../components/ui/RichTextEditor';
import { ProviderLogo } from '../../components/mailbox/ProviderLogo';
import { cn } from '../../lib/utils';
import {
  CheckCircle2, XCircle, Globe, Server, Loader2, Plug, Inbox,
  Send, ShieldCheck, Signature, Gauge, Sparkles, Mail, MinusCircle,
  Stethoscope, AlertTriangle, Eye, EyeOff, ChevronDown, ArrowLeft, ArrowRight,
  ExternalLink, KeyRound, Flame, Check, Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { SmtpAccount, CreateSmtpAccountInput, SmtpPreset, VerifyLegResult, MailboxDiagnostics, DiagStage, SetupSectionId, SetupField, SetupSummary } from '@lemlist/shared';
import {
  SMTP_PRESETS, detectPresetFromEmail, PLACEHOLDER, isSenderMismatch,
  missingFields, mailboxLabel, serverSummary, sendingSummary, limitAdvice, sectionsToOpen,
  providerGuide, isSendOnlyProvider, isFreeMailDomain,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Connecting a mailbox, and changing one.

   NEW MAILBOXES are a three-step walk, each step one decision:

     1. Which address?     Type it, or pick the provider. Servers are
                           found from the address while you type.
     2. Sign in            The password - with the provider's own steps for
                           getting the right KIND of password beside it,
                           because that, not the server, is why most
                           connections fail. Servers are a one-line summary
                           that opens only when they need you.
     3. Connect            One button that tests AND saves. Sending is
                           proven with a probe to yourself, receiving by
                           signing in to IMAP, and the mailbox is saved
                           verified - or not saved at all, with the reason
                           in plain words and the fix one click away.

   Then a short finish: daily limit, warm-up, signature, the domain - all
   with safe defaults, all optional.

   SAVED MAILBOXES open as one scroll of sections (below), which is what
   somebody coming back to change one thing wants: everything visible,
   nothing to step through.
   ═══════════════════════════════════════════════════════════════════════ */

/** Map the MX check's provider hint onto our connection presets. */
const HINT_TO_PRESET: Record<string, string> = {
  'Google Workspace': 'Google Workspace',
  'Microsoft 365': 'Outlook / Microsoft 365',
  'Zoho Mail': 'Zoho Mail',
  'Fastmail': 'Fastmail',
  'Spacemail': 'Spacemail',
  'Namecheap Private Email': 'Namecheap Private Email',
  'Titan': 'Titan',
  'Yahoo Mail': 'Yahoo Mail',
  'ProtonMail': 'ProtonMail Bridge',
};

/** The tiles on step one. Everything else is one search away. */
const FEATURED = ['Gmail', 'Outlook / Microsoft 365', 'Zoho Mail', 'Yahoo Mail', 'iCloud Mail', 'Fastmail'];

const FORM_ID = 'smtp-account-form';

type Form = CreateSmtpAccountInput & { from_name?: string | null; imap_user?: string };
type WizardStep = 'address' | 'signin' | 'connect' | 'done';
const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'address', label: 'Address' },
  { id: 'signin', label: 'Sign in' },
  { id: 'connect', label: 'Connect' },
  { id: 'done', label: 'Finish' },
];

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

/**
 * The daily limit a NEW mailbox starts with.
 *
 * Presets carry the provider's own ceiling - Workspace 2,000, SendGrid
 * 10,000 - which is what the account can technically send, not what cold
 * outreach survives. Pre-filling it meant the form suggested a number that
 * limitAdvice, one field below, then called dangerous. New mailboxes start
 * at a level that advice calls safe; anyone can raise it knowingly.
 */
function safeDefaultLimit(preset: SmtpPreset): number {
  return Math.min(preset.recommended_daily_limit || 200, 200);
}

export function presetToForm(preset: SmtpPreset): Form {
  return {
    // Unnamed: a mailbox nobody named is called by its address, not its provider.
    label: '',
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
    daily_send_limit: safeDefaultLimit(preset),
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Encryption is derived from port + a secure flag. SSL=implicit TLS (465),
 *  STARTTLS/None = upgrade-or-plain (587/25). Kept simple: SSL vs STARTTLS. */
function EncryptionRadios({ secure, onChange }: { secure: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5 text-caption">
      {[{ v: true, l: 'SSL' }, { v: false, l: 'STARTTLS' }].map((opt) => (
        <button
          key={opt.l}
          type="button"
          onClick={() => onChange(opt.v)}
          className={cn(
            'h-6 rounded-md px-2.5 font-medium transition-colors',
            secure === opt.v ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
          )}
        >
          {opt.l}
        </button>
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
        className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left"
        data-section-toggle
      >
        <span className={cn(
          'mt-px flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg',
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
          'mt-1 h-4 w-4 flex-shrink-0 text-[var(--text-tertiary)] transition-transform',
          open && 'rotate-180',
        )} />
      </button>
      {open && <div className="border-t border-[var(--border-subtle)] px-3.5 py-3.5">{children}</div>}
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
        <h4 className="text-caption font-semibold text-[var(--text-secondary)]">{title}</h4>
        {subtitle && <span className="text-caption text-[var(--text-tertiary)]">{subtitle}</span>}
      </div>
      {children}
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

/** Where the wizard is, as dots joined by a line. */
function Stepper({ step }: { step: WizardStep }) {
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="Progress">
      {STEPS.map((s, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2 last:flex-none">
            <span className={cn(
              'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-micro font-bold transition-colors',
              done ? 'bg-emerald-500 text-white'
                : current ? 'bg-[var(--indigo)] text-white ring-4 ring-[var(--indigo-subtle)]'
                : 'border border-[var(--border-default)] text-[var(--text-muted)]',
            )}>
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn('hidden text-caption font-medium sm:inline', current ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>{s.label}</span>
            {i < STEPS.length - 1 && <span className={cn('h-px flex-1 transition-colors', done ? 'bg-emerald-500/60' : 'bg-[var(--border-subtle)]')} />}
          </li>
        );
      })}
    </ol>
  );
}

/** A line of the live connection checklist. */
function CheckLine({ state, label, detail }: { state: 'waiting' | 'running' | 'ok' | 'fail' | 'skipped'; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center">
        {state === 'running' && <Loader2 className="h-4 w-4 animate-spin text-[var(--indigo)]" />}
        {state === 'ok' && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
        {state === 'fail' && <XCircle className="h-5 w-5 text-rose-500" />}
        {state === 'skipped' && <MinusCircle className="h-5 w-5 text-[var(--text-muted)]" />}
        {state === 'waiting' && <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-body font-medium', state === 'waiting' ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]')}>{label}</span>
        {detail && <span className={cn('block text-caption leading-snug', state === 'fail' ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--text-tertiary)]')}>{detail}</span>}
      </span>
    </li>
  );
}

/**
 * Connect / edit a sending mailbox.
 *
 * New: a stepped walk (see the header). Saved: one scroll of collapsible
 * sections, where what starts open is decided from the values by
 * `sectionsToOpen`, under one rule: nothing missing or broken is ever
 * behind a closed header.
 */
export function SmtpAccountModal({
  open, onClose, editAccount, initialPreset, onConnected,
}: {
  open: boolean;
  onClose: () => void;
  editAccount?: SmtpAccount | null;
  initialPreset?: SmtpPreset | null;
  /** Called with the new mailbox once it is connected. */
  onConnected?: (account: SmtpAccount) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>({ ...emptyForm });
  const [activePreset, setActivePreset] = useState<SmtpPreset | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });
  const [replyToOn, setReplyToOn] = useState(false);
  const [openSections, setOpenSections] = useState<SetupSectionId[]>(['mailbox']);
  const [showPass, setShowPass] = useState(false);
  const [step, setStep] = useState<WizardStep>('address');
  const [providerSearch, setProviderSearch] = useState('');
  const [connected, setConnected] = useState<SmtpAccount | null>(null);
  const [warmupOn, setWarmupOn] = useState(true);
  const [sigOpen, setSigOpen] = useState(false);
  /* Refused for a reason that is not the connection - a plan limit, an
     address already connected - so troubleshooting tips would mislead. */
  const [refused, setRefused] = useState<string | null>(null);
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
  const wizard = !editId;

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
    setConnected(null);
    setWarmupOn(true);
    setSigOpen(false);
    setProviderSearch('');
    setShowPass(false);
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
      setStep('address');
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
      setStep('address');
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
      setAutoDetected(false);
      setForm((prev) => ({
        ...prev,
        smtp_host: preset.smtp_host,
        smtp_port: preset.smtp_port,
        smtp_secure: preset.smtp_secure,
        imap_host: preset.imap_host || undefined,
        imap_port: preset.imap_port || undefined,
        imap_secure: preset.imap_secure ?? undefined,
        daily_send_limit: safeDefaultLimit(preset),
      }));
      // SendGrid signs in as "apikey", Mailgun as a postmaster handle: a
      // provider whose login is not the address gets the override opened.
      if (preset.name === 'SendGrid') {
        setUserEdited(true);
        setForm((prev) => ({ ...prev, smtp_user: 'apikey' }));
      }
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
  useEffect(() => { if (open) { mxCheckedDomain.current = ''; setMxState({ status: 'idle', note: '' }); } }, [open]);

  const applyDetectedPreset = useCallback((preset: SmtpPreset, note: string) => {
    setActivePreset(preset);
    setAutoDetected(true);
    setForm((prev) => ({
      ...prev,
      smtp_user: userEdited ? prev.smtp_user : (prev.email_address || prev.smtp_user),
      label: prev.label,
      smtp_host: preset.smtp_host,
      smtp_port: preset.smtp_port,
      smtp_secure: preset.smtp_secure,
      imap_host: preset.imap_host || undefined,
      imap_port: preset.imap_port || undefined,
      imap_secure: preset.imap_secure ?? undefined,
      daily_send_limit: safeDefaultLimit(preset),
    }));
    setMxState({ status: 'done', note });
  }, [userEdited]);

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
          applyDetectedPreset(preset, `${domain} uses ${result.provider_hint} - servers filled in for you.`);
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
    }, 550);
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
          smtp_user: userEdited ? prev.smtp_user : email,
          label: prev.label,
          smtp_host: detected.smtp_host,
          smtp_port: detected.smtp_port,
          smtp_secure: detected.smtp_secure,
          imap_host: detected.imap_host || undefined,
          imap_port: detected.imap_port || undefined,
          imap_secure: detected.imap_secure ?? undefined,
          daily_send_limit: safeDefaultLimit(detected),
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
  }, [activePreset, autoDetected, editId, scheduleMxDetect, userEdited]);

  const payload = (): Form => {
    const sig = (form.signature_html || '').replace(/<[^>]*>/g, '').trim();
    return {
      ...form,
      label: mailboxLabel(form.label, form.email_address),
      from_name: (form.from_name || '').trim() || null,
      reply_to: (form.reply_to || '').trim() || null,
      smtp_user: form.smtp_user || form.email_address,
      signature_html: sig ? form.signature_html : null,
      signature_auto: sig ? !!form.signature_auto : false,
    };
  };

  /* Saved mailbox: save the sections as they stand. */
  const saveMutation = useMutation({
    mutationFn: (input: Form) => smtpApi.update(editId!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-sync-progress'] });
      toast.success('Changes saved');
      onClose();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || err.message || 'Failed to save');
    },
  });

  /*
   * New mailbox: test and save in one step. The server proves sending (a
   * probe to yourself) and receiving (an IMAP sign-in) and only saves a
   * mailbox that sends - saved verified, so the list agrees with what this
   * screen just said. `verified: false` is the explicit escape hatch for a
   * network that blocks the probe but will be fine in practice.
   */
  const connectMutation = useMutation({
    /*
     * `sendingOnly`: sending passed and receiving did not. Rather than save
     * an unverified mailbox that then fails its inbox sync every few
     * minutes, it is saved without the incoming server - verified, honest
     * about replies, and fixable later from its settings.
     */
    mutationFn: ({ verified, sendingOnly }: { verified: boolean; sendingOnly?: boolean }) =>
      smtpApi.create(sendingOnly ? { ...payload(), imap_host: undefined, imap_port: undefined, imap_user: undefined } : payload(), { verify: verified }),
    onMutate: () => { setVerify({ status: 'checking' }); setDiagnostics(null); setRefused(null); },
    onSuccess: (account, { verified }) => {
      setVerify(verified
        // What was saved, not what the form held: "sending only" drops the incoming server.
        ? { status: 'done', smtp: { ok: true, status: 'ok', message: 'Sending works.' }, imap: account.imap_host ? { ok: true, status: 'ok', message: 'Receiving works.' } : { ok: true, status: 'skipped', message: 'No incoming server set.' } }
        : { status: 'idle' });
      setConnected(account);
      queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-sync-progress'] });
      queryClient.invalidateQueries({ queryKey: ['readiness'] });
      queryClient.invalidateQueries({ queryKey: ['setup-state'] });
      onConnected?.(account);
      setStep('done');
    },
    onError: (err: any) => {
      const v = err.response?.data?.verification;
      setRefused(!v && err.response?.status && err.response.status < 500 ? err.response.data?.error || 'That could not be connected.' : null);
      if (v) {
        setVerify({ status: 'done', smtp: v.smtp, imap: v.imap, message: v.message });
      } else {
        setVerify({
          status: 'done',
          smtp: { ok: false, status: 'fail', message: err.response?.data?.error || (err?.code === 'ECONNABORTED' ? 'The server took too long to answer. It may be slow or blocking the connection - run diagnostics to see where it stops.' : err.message) || 'Connection failed' },
          message: err.response?.data?.error || 'Connection failed',
        });
      }
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
    onSuccess: (res) => {
      setVerify({ status: 'done', smtp: res.smtp, imap: res.imap, message: res.message });
      if (res.success) queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
    },
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

  /* The finishing touches, applied to the mailbox just connected. */
  const finishMutation = useMutation({
    mutationFn: async () => {
      if (!connected) return;
      const p = payload();
      await smtpApi.update(connected.id, {
        daily_send_limit: p.daily_send_limit,
        signature_html: p.signature_html,
        signature_auto: p.signature_auto,
      } as any);
      if (warmupOn && !isSendOnlyProvider(activePreset?.name)) {
        await smtpApi.setWarmup(connected.id, { enabled: true });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['warmup'] });
      toast.success(`${connected?.email_address} is ready`);
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Connected, but the finishing settings did not save - change them from the mailbox.'),
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
    // In the walk, a gap on the address sends you back to the address.
    if (wizard && fields.some((f) => f.key === 'email_address')) setStep('address');
    else if (wizard) setStep('signin');
    toast.error(
      fields.length === 1
        ? `Add your ${fields[0].label} first`
        : `Still needed: ${fields.map((f) => f.label).join(', ')}`
    );
  };

  const handleCheck = () => {
    if (verifyMutation.isPending || connectMutation.isPending) return;
    if (missing.length) { jumpTo(missing); return; }
    setFlagged([]);
    if (wizard) { setStep('connect'); connectMutation.mutate({ verified: true }); return; }
    verifyMutation.mutate();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (wizard && step === 'address') { goToSignin(); return; }
    if (wizard && step === 'done') { finishMutation.mutate(); return; }
    if (missing.length) { jumpTo(missing); return; }
    setFlagged([]);
    if (wizard) { setStep('connect'); connectMutation.mutate({ verified: true }); return; }
    saveMutation.mutate(payload());
  };

  const goToSignin = () => {
    if (!EMAIL_RE.test(form.email_address.trim())) {
      setFlagged(['email_address']);
      toast.error('Enter the full email address you send from');
      return;
    }
    setFlagged([]);
    setStep('signin');
  };

  const err = (key: string, msg = 'Required') => (flagged.includes(key) ? msg : undefined);
  const sectionHasGap = (id: SetupSectionId) =>
    missing.some((m) => m.section === id && flagged.includes(m.key));
  const isOpen = (id: SetupSectionId) => openSections.includes(id);

  const guide = providerGuide(activePreset?.name);
  const passwordLabel = activePreset ? guide.secret : 'Password';
  const passwordPlaceholder = editId ? 'Leave blank to keep the saved password' : (activePreset?.password_hint || 'Password or app password');
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

  const busy = verifyMutation.isPending || connectMutation.isPending;
  const verifyOk = verify.status === 'done' && verify.smtp?.ok && verify.imap?.status !== 'fail';
  const verifyFailed = verify.status === 'done' && !verifyOk;

  const domain = (form.email_address.split('@')[1] || '').toLowerCase();
  const { data: domains } = useQuery({
    queryKey: ['domains'],
    queryFn: domainApi.list,
    enabled: open && step === 'done',
    meta: { silentError: true },
  });
  const domainRow = (domains || []).find((d) => domain === d.domain.toLowerCase() || domain.endsWith(`.${d.domain.toLowerCase()}`));
  // gmail.com and friends cannot be authenticated by their users; no domain step for them.
  const freeMail = isFreeMailDomain(domain);

  const presets = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    return q ? SMTP_PRESETS.filter((p) => p.name.toLowerCase().includes(q)) : SMTP_PRESETS.filter((p) => !FEATURED.includes(p.name));
  }, [providerSearch]);

  /* ── The fields, as blocks both layouts share ─────────────────────── */

  const passwordField = (
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
        autoFocus={wizard && step === 'signin'}
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
  );

  const identityFields = (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        className="mt-3 inline-flex items-center gap-2 text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <span className={cn('relative inline-flex h-[16px] w-7 items-center rounded-full transition-colors', replyToOn ? 'bg-[var(--indigo)]' : 'bg-[var(--border-default)]')}>
          <span className={cn('inline-block h-3 w-3 rounded-full bg-white shadow transition-transform', replyToOn ? 'translate-x-[13px]' : 'translate-x-[2px]')} />
        </span>
        Send replies to a different address
      </button>
      {replyToOn && (
        <Input className="mt-2" type="email" value={form.reply_to || ''} onChange={(e) => updateField('reply_to', e.target.value)} placeholder="replies@company.com" hint="Replies are directed here instead of your From address" />
      )}
    </>
  );

  const serverFields = (
    <>
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

      <Group icon={Send} title="Outgoing" subtitle="SMTP - sends your campaigns">
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {userEdited ? (
            <div className="min-w-[220px] flex-1">
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
            </div>
          ) : (
            <div className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
              <p className="text-caption text-[var(--text-tertiary)]">Signs in as</p>
              <p className="truncate text-body font-medium text-[var(--text-primary)]" data-signs-in-as>
                {form.email_address || 'your email address'}
              </p>
              <button
                type="button"
                onClick={() => setUserEdited(true)}
                className="mt-0.5 text-caption font-semibold text-[var(--indigo)] hover:underline"
                data-override-login
              >
                Use a different username
              </button>
            </div>
          )}
          <EncryptionRadios secure={!!form.smtp_secure} onChange={(v) => updateField('smtp_secure', v)} />
        </div>
      </Group>

      <div className="my-4 h-px bg-[var(--border-subtle)]" />

      <Group icon={Inbox} title="Incoming" subtitle="IMAP - brings replies into Sincerely">
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Input label="Host" value={form.imap_host || ''} onChange={(e) => updateField('imap_host', e.target.value || undefined)} placeholder="imap.example.com" />
          <Input label="Port" type="number" value={String(form.imap_port || '')} onChange={(e) => updateField('imap_port', parseInt(e.target.value) || undefined)} placeholder="993" />
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[220px] flex-1">
            <Input label="Username (if different)" value={form.imap_user || ''} onChange={(e) => updateField('imap_user', e.target.value)} placeholder="Defaults to the sign-in above" />
          </div>
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
    </>
  );

  const limitField = (
    <Group icon={Gauge} title="Daily limit" subtitle="real campaign sends from this mailbox">
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
  );

  const signatureField = (
    <Group icon={Signature} title="Signature" subtitle="offered in the composer for this inbox">
      <div className="flex items-center justify-end mb-1.5">
        <button type="button" role="switch" aria-checked={!!form.signature_auto} onClick={() => updateField('signature_auto', !form.signature_auto)} className="flex items-center gap-2 text-caption font-medium text-[var(--text-secondary)]">
          Always add to new emails
          <span className={cn('relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors', form.signature_auto ? 'bg-[var(--indigo)]' : 'bg-[var(--border-default)]')}>
            <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform', form.signature_auto ? 'translate-x-[15px]' : 'translate-x-[2px]')} />
          </span>
        </button>
      </div>
      <RichTextEditor
        key={`sig-${editId || connected?.id || 'new'}`}
        initialContent={form.signature_html || ''}
        onChange={(html, text) => updateField('signature_html', text.trim() ? html : '')}
        minHeight="100px"
        placeholder={`e.g. ${PLACEHOLDER.senderName} — Growth, ${PLACEHOLDER.senderCompany} · ${PLACEHOLDER.senderEmail}`}
      />
    </Group>
  );

  const mismatchWarning = (
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
  );

  /*
   * Diagnostics on demand, not only after a failed check.
   *
   * This used to appear solely when a check had run AND come back
   * failed, so the one thing that explains a connection was locked
   * behind the thing that could not explain itself - and if the
   * check errored at the transport, or somebody simply wanted to
   * know why a saved mailbox was quiet, there was no way in at all.
   * There is nothing to protect here: it is four read-only probes.
   */
  const diagnosticsBlock = (
    <>
      {!diagnostics && form.smtp_host && (
        <button
          type="button"
          onClick={() => diagnoseMutation.mutate()}
          disabled={diagnoseMutation.isPending}
          className="inline-flex items-center gap-1.5 text-caption font-semibold text-[var(--indigo)] hover:underline disabled:opacity-60"
          data-run-diagnostics
        >
          {diagnoseMutation.isPending
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Pinpointing the failure…</>
            : <><Stethoscope className="h-3 w-3" /> {verifyFailed ? 'Find out exactly why' : 'Run diagnostics'}</>}
        </button>
      )}

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
                  <button type="button" onClick={() => { reveal('servers'); if (wizard) setStep('signin'); }} className="ml-1 font-medium text-[var(--indigo)] hover:underline">
                    Add one under Servers.
                  </button>
                </p>
              </div>
            )}
        </div>
      )}
    </>
  );

  /* ── Wizard bodies ─────────────────────────────────────────────────── */

  const addressStep = (
    <div className="space-y-5">
      <div>
        <Input
          label="Email address you send from"
          type="email"
          value={form.email_address}
          onChange={(e) => handleEmailChange(e.target.value)}
          placeholder={activePreset?.username_hint || 'you@company.com'}
          error={err('email_address', 'Enter a full email address')}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          name="sincerely-from-email"
          autoFocus
        />
        <div className="mt-2 min-h-[20px]">
          {mxState.status === 'checking' && (
            <p className="flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
              <Loader2 className="h-3 w-3 animate-spin" /> Looking up where {form.email_address.split('@')[1]} keeps its mail…
            </p>
          )}
          {activePreset && autoDetected && (
            <p className="flex items-center gap-1.5 text-caption text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {mxState.note || `Recognised ${activePreset.name} - servers filled in for you.`}
            </p>
          )}
          {!autoDetected && mxState.status === 'done' && mxState.note && (
            <p className="flex items-start gap-1.5 text-caption text-[var(--text-secondary)]">
              <Sparkles className="mt-px h-3 w-3 shrink-0 text-[var(--indigo)]" /> {mxState.note}
            </p>
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 text-caption font-medium text-[var(--text-tertiary)]">Or pick your provider</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FEATURED.map((name) => {
            const on = activePreset?.name === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => applyPreset(name)}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all',
                  on
                    ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] shadow-[var(--shadow-sm)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-sm)]',
                )}
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                  <ProviderLogo name={name} />
                </span>
                <span className="min-w-0 truncate text-body font-medium text-[var(--text-primary)]">
                  {name === 'Outlook / Microsoft 365' ? 'Microsoft' : name.replace(' Mail', '')}
                </span>
                {on && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-[var(--indigo)]" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
        <div className="mt-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2 px-3 h-9 border-b border-[var(--border-subtle)]">
            <Search className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <input
              value={providerSearch}
              onChange={(e) => setProviderSearch(e.target.value)}
              placeholder="Other providers - SendGrid, Mailgun, Titan, Spacemail…"
              className="flex-1 bg-transparent text-body text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1.5 p-2">
            {presets.slice(0, 10).map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPreset(p.name)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-caption font-medium transition-colors',
                  activePreset?.name === p.name
                    ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                <ProviderLogo name={p.name} className="h-4 w-4" /> {p.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { applyPreset(''); reveal('servers'); }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-caption font-medium transition-colors',
                !activePreset ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)] text-[var(--indigo)]' : 'border-dashed border-[var(--border-default)] text-[var(--text-secondary)]',
              )}
            >
              <Server className="h-3.5 w-3.5" /> Any other server (IMAP/SMTP)
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const signinStep = (
    <div className="space-y-4">
      {/* Who we are signing in to, and how to get the right password. */}
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-3.5 py-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <ProviderLogo name={activePreset?.name} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-[var(--text-primary)]">{form.email_address}</p>
          <p className="text-caption text-[var(--text-tertiary)]">{activePreset ? activePreset.name : 'Custom mail server'}</p>
        </div>
        <button type="button" onClick={() => setStep('address')} className="text-caption font-medium text-[var(--indigo)] hover:underline">Change</button>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          {passwordField}
          <Input label="From name" value={form.from_name || ''} onChange={(e) => updateField('from_name', e.target.value)} placeholder={`e.g. ${PLACEHOLDER.senderName}`} hint="What recipients see in the From field" />
        </div>
        <div className="rounded-xl border border-[var(--indigo)]/15 bg-[var(--indigo-subtle)]/40 p-3.5">
          <p className="flex items-center gap-1.5 text-caption font-semibold text-[var(--text-primary)]">
            <KeyRound className="h-3.5 w-3.5 text-[var(--indigo)]" /> Getting your {guide.secret.toLowerCase()}
          </p>
          <ol className="mt-2 space-y-1.5">
            {guide.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-caption leading-snug text-[var(--text-secondary)]">
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface)] text-micro font-bold text-[var(--indigo)]">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          {guide.link && (
            <a href={guide.link.url} target="_blank" rel="noreferrer" className="mt-2.5 inline-flex items-center gap-1 text-caption font-semibold text-[var(--indigo)] hover:underline">
              {guide.link.label} <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {guide.gotcha && (
            <p className="mt-2 flex items-start gap-1.5 text-caption leading-snug text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-px h-3 w-3 flex-shrink-0" /> {guide.gotcha}
            </p>
          )}
        </div>
      </div>

      {/* Servers: one line when found, the full fields when they need you. */}
      <Disclosure
        icon={Server}
        title="Servers"
        summary={servers}
        open={isOpen('servers')}
        onToggle={() => toggleSection('servers')}
        gap={sectionHasGap('servers')}
      >
        {serverFields}
      </Disclosure>

      {senderMismatch && (mismatchWarning)}
    </div>
  );

  const connectStep = (() => {
    const pending = connectMutation.isPending;
    const smtp = verify.smtp;
    const imap = verify.imap;
    const failed = !pending && verifyFailed;
    const smtpState = pending ? 'running' : smtp ? (smtp.ok ? 'ok' : 'fail') : 'waiting';
    const imapState = pending ? (form.imap_host ? 'running' : 'skipped')
      : imap ? (imap.status === 'ok' ? 'ok' : imap.status === 'skipped' ? 'skipped' : 'fail')
      : smtp && !smtp.ok ? 'waiting' : 'waiting';
    return (
      <div className="space-y-4">
        <div className={cn(
          'rounded-2xl border px-4 py-3',
          failed ? 'border-rose-500/30 bg-rose-500/[0.04]' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50',
        )}>
          <ul className="divide-y divide-[var(--border-subtle)]">
            <CheckLine
              state={smtpState as any}
              label={`Sending from ${form.email_address}`}
              detail={pending ? `Signing in to ${form.smtp_host} and sending a test email to yourself…` : smtp?.message}
            />
            <CheckLine
              state={imapState as any}
              label="Receiving replies"
              detail={pending ? (form.imap_host ? `Signing in to ${form.imap_host} to read your inbox…` : 'No incoming server - skipped.')
                : imap ? imap.message
                : smtp && !smtp.ok ? 'Tested once sending works.' : undefined}
            />
          </ul>
        </div>

        {failed && refused && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
            <p className="text-body font-semibold text-[var(--text-primary)]">{refused}</p>
            <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => setStep('address')}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          </div>
        )}
        {failed && !refused && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
              <p className="text-body font-semibold text-[var(--text-primary)]">Nothing was saved. Here is what to try:</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-caption text-[var(--text-secondary)]">
                {smtp && !smtp.ok && /password|auth|username|535|credential/i.test(smtp.message) && (
                  <li>Check you pasted the {guide.secret.toLowerCase()}, not your normal password{guide.link ? ' - the steps are on the previous screen' : ''}.</li>
                )}
                {guide.gotcha && <li>{guide.gotcha}</li>}
                <li>Make sure the servers and ports match what your provider publishes.</li>
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => { setStep('signin'); if (smtp?.ok && imap?.status === 'fail') reveal('servers'); }}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Back and fix
                </Button>
                <Button type="button" size="sm" onClick={() => connectMutation.mutate({ verified: true })}>
                  <Plug className="h-3.5 w-3.5" /> Try again
                </Button>
                <span className="flex-1" />
                {smtp?.ok && (
                  <button type="button" onClick={() => connectMutation.mutate({ verified: true, sendingOnly: true })} className="text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" title="Save it without the incoming server. Replies will stay in your provider's inbox until you add one.">
                    Connect for sending only
                  </button>
                )}
              </div>
            </div>
            {diagnosticsBlock}
          </div>
        )}
      </div>
    );
  })();

  const doneStep = (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3.5">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <Check className="h-5 w-5" strokeWidth={3} />
        </span>
        <div className="min-w-0">
          <p className="text-strong font-semibold text-[var(--text-primary)]">{form.email_address} is connected</p>
          <p className="text-caption text-[var(--text-secondary)]">
            {verify.imap?.status === 'ok' ? 'Sending and receiving both work.' : verify.smtp?.ok ? 'Sending works.' : 'Saved.'}
            {' '}A few optional touches below - the defaults are safe.
          </p>
        </div>
      </div>

      {!isSendOnlyProvider(activePreset?.name) && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
          <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400">
            <Flame className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-[var(--text-primary)]">Warm it up <span className="font-normal text-[var(--text-tertiary)]">- recommended</span></span>
            <span className="block text-caption text-[var(--text-secondary)]">Sends a few friendly emails a day between warm-up inboxes and ramps up slowly, so providers learn to trust this address before campaigns go out.</span>
          </span>
          <input type="checkbox" checked={warmupOn} onChange={(e) => setWarmupOn(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--indigo)]" />
        </label>
      )}

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-3">
        {limitField}
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <button type="button" onClick={() => setSigOpen((v) => !v)} className="flex w-full items-center gap-2 px-3.5 py-3 text-left">
          <Signature className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <span className="flex-1 text-body font-semibold text-[var(--text-primary)]">Add a signature <span className="font-normal text-[var(--text-tertiary)]">- optional</span></span>
          <ChevronDown className={cn('h-4 w-4 text-[var(--text-tertiary)] transition-transform', sigOpen && 'rotate-180')} />
        </button>
        {sigOpen && <div className="border-t border-[var(--border-subtle)] px-3.5 py-3">{signatureField}</div>}
      </div>

      {/* The domain: the biggest single thing left between this and the inbox. */}
      {!freeMail && domain && (
        domainRow?.is_verified ? (
          <p className="flex items-center gap-1.5 text-caption text-emerald-700 dark:text-emerald-400">
            <ShieldCheck className="h-3.5 w-3.5" /> {domain} is authenticated (SPF, DKIM, DMARC).
          </p>
        ) : (
          <Link
            to={`/email-accounts?tab=domains${domainRow ? `&domain=${domainRow.id}` : `&add=${encodeURIComponent(domain)}`}`}
            onClick={onClose}
            className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] px-3.5 py-3 transition-colors hover:bg-amber-500/[0.09]"
          >
            <Globe className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 flex-1 text-caption text-[var(--text-secondary)]">
              <span className="block text-body font-semibold text-[var(--text-primary)]">Next: authenticate {domain}</span>
              {domainRow ? 'Its DNS records are not all in place yet.' : 'Three DNS records that decide whether you reach the inbox. We generate them for you.'}
            </span>
            <ArrowRight className="h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          </Link>
        )
      )}
    </div>
  );

  /* ── Footer, per layout ────────────────────────────────────────────── */

  const wizardFooter = (
    <>
      {step === 'signin' && (
        <Button type="button" variant="secondary" onClick={() => setStep('address')} className="mr-auto">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
      )}
      {step === 'done' ? (
        <>
          <Button type="button" variant="secondary" onClick={onClose} className="mr-auto">Skip for now</Button>
          <Button type="submit" form={FORM_ID} disabled={finishMutation.isPending}>
            {finishMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Finish
          </Button>
        </>
      ) : step === 'connect' ? (
        <Button type="button" variant="secondary" onClick={onClose} disabled={connectMutation.isPending}>Close</Button>
      ) : (
        <>
          <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID}>
            {step === 'address' ? <>Continue <ArrowRight className="h-3.5 w-3.5" /></> : <><Plug className="h-3.5 w-3.5" /> Connect mailbox</>}
          </Button>
        </>
      )}
    </>
  );

  const editFooter = (
    <>
      <button
        type="button"
        onClick={handleCheck}
        disabled={busy}
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
        {verifyMutation.isPending ? 'Testing…' : verifyOk ? 'Connection works' : verifyFailed ? 'Test again' : 'Test connection'}
      </button>
      <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
      <Button variant="primary" type="submit" form={FORM_ID} disabled={saveMutation.isPending}>
        {saveMutation.isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </>
  );

  const title = editId
    ? `Settings for ${editAccount!.email_address}`
    : step === 'done' ? 'Connected' : 'Connect a mailbox';
  const description = editId
    ? 'Change how this mailbox signs in, sends and signs off. Test before saving if you change the connection.'
    : step === 'address' ? 'Enter the address you send from. We find its servers for you.'
    : step === 'signin' ? 'Paste its password. Sincerely tests everything before saving.'
    : step === 'connect' ? (connectMutation.isPending ? 'Testing the connection…' : verifyFailed ? 'The test did not pass.' : 'Testing…')
    : 'Optional finishing touches.';

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={title}
      description={description}
      size={editId ? 'xl' : '2xl'}
      footer={editId ? editFooter : wizardFooter}
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
        {wizard ? (
          <>
            <Stepper step={step} />
            {step === 'address' && addressStep}
            {step === 'signin' && signinStep}
            {step === 'connect' && connectStep}
            {step === 'done' && doneStep}
          </>
        ) : (
          <div className="space-y-2.5">
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Email address" type="email" value={form.email_address} onChange={(e) => handleEmailChange(e.target.value)} placeholder="you@company.com" error={err('email_address')} autoComplete="off" data-1p-ignore data-lpignore="true" name="sincerely-from-email" />
                {passwordField}
              </div>
              <div className="mt-3">{identityFields}</div>
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
              {serverFields}
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
              {limitField}
              <div className="my-4 h-px bg-[var(--border-subtle)]" />
              {signatureField}
            </Disclosure>

            {/* ── The test result, when there is one ── */}
            {(verify.status !== 'idle' || senderMismatch || form.smtp_host) && (
              <div className={cn(
                'rounded-xl border px-3.5 py-2 space-y-2',
                verifyOk ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
                  : verifyFailed ? 'border-rose-500/30 bg-rose-500/[0.05]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50',
              )}>
                {verify.status !== 'idle' && (
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    <CheckLine state={verify.status === 'checking' ? 'running' : verify.smtp?.ok ? 'ok' : 'fail'} label="Sending (SMTP)" detail={verify.status === 'checking' ? 'Sending a test email to yourself…' : verify.smtp?.message} />
                    <CheckLine
                      state={verify.status === 'checking' ? (form.imap_host ? 'running' : 'skipped') : verify.imap?.status === 'ok' ? 'ok' : verify.imap?.status === 'skipped' ? 'skipped' : verify.imap ? 'fail' : 'waiting'}
                      label="Receiving (IMAP)"
                      detail={verify.status === 'checking' ? (form.imap_host ? 'Signing in to read the inbox…' : 'No incoming server set.') : verify.imap?.message}
                    />
                  </ul>
                )}
                {senderMismatch && (mismatchWarning)}
                <div className="py-1">{diagnosticsBlock}</div>
              </div>
            )}

            <p className="text-caption text-[var(--text-tertiary)] flex items-center gap-1 pt-1">
              <Globe className="h-3 w-3" /> Sending from your own domain?{' '}
              <Link to="/email-accounts?tab=domains" onClick={onClose} className="underline underline-offset-2 hover:text-[var(--text-secondary)]">Set up SPF, DKIM &amp; DMARC</Link> for better deliverability.
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}

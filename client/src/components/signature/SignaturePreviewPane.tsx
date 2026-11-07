import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Monitor, Smartphone, Moon, Sun, Info, Send, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { signatureAppliesTo, type SignatureUse } from '@lemlist/shared';
import { cn } from '../../lib/utils';
import { Segmented } from '../ui/Segmented';
import { smtpApi } from '../../api/smtp.api';
import { sampleEmailHtml, signatureText, type PreviewKind } from './signatureHtml';

/* ═══════════════════════════════════════════════════════════════════════
   How the signature will look where it is read.

   Each client is drawn with the fonts, sizes and habits it actually applies
   to an email it receives: Gmail's 13px Arial, Outlook's 11pt Aptos and its
   square corners, Apple Mail's system font, a phone's narrow column and the
   colour flip phones make in dark mode. Close enough to catch a logo that is
   too big or a line that wraps; the test send is the real thing.
   ═══════════════════════════════════════════════════════════════════════ */

type ClientId = 'gmail' | 'outlook' | 'apple' | 'phone';

const CLIENTS: readonly { value: ClientId; label: string }[] = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook' },
  { value: 'apple', label: 'Apple Mail' },
  { value: 'phone', label: 'Phone' },
];

const KINDS: readonly { value: PreviewKind; label: string }[] = [
  { value: 'new', label: 'New email' },
  { value: 'reply', label: 'Reply' },
];

/** The base styles each client puts on a message before the email's own HTML. */
function clientCss(client: ClientId, dark: boolean): string {
  const base = 'html,body{margin:0;padding:0;background:#ffffff;color:#222222;}body{padding:2px 2px 8px;word-wrap:break-word;}a{color:#1a0dab;}p{margin:0 0 1em;}';
  const fonts: Record<ClientId, string> = {
    gmail: 'body{font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;}',
    // Outlook ignores rounded corners and max-width, and sets its own font.
    outlook: 'body{font-family:"Segoe UI",Aptos,Calibri,sans-serif;font-size:15px;line-height:1.35;}img{border-radius:0 !important;max-width:none !important;}',
    apple: 'body{font-family:-apple-system,"Helvetica Neue",Helvetica,sans-serif;font-size:14px;line-height:1.4;}',
    phone: 'body{font-family:Helvetica,Roboto,-apple-system,sans-serif;font-size:14px;line-height:1.45;}img{max-width:100% !important;height:auto !important;}table{max-width:100% !important;}',
  };
  // Phone apps in dark mode recolour the whole email; images are left as they are.
  const flip = dark ? 'html{filter:invert(1) hue-rotate(180deg);}img{filter:invert(1) hue-rotate(180deg);}' : '';
  return base + fonts[client] + flip;
}

function EmailFrame({ html, css, title }: { html: string; css: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${css}</style></head><body>${html}</body></html>`, [html, css]);

  const measure = useCallback(() => {
    const d = ref.current?.contentDocument;
    if (!d?.documentElement) return;
    setHeight(Math.min(1400, Math.max(80, d.documentElement.scrollHeight)));
  }, []);

  const onLoad = () => {
    measure();
    ref.current?.contentDocument?.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', measure, { once: true });
    });
  };

  useEffect(() => { measure(); }, [doc, measure]);

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={doc}
      onLoad={onLoad}
      // Same-origin so the height can be read; no scripts run inside.
      sandbox="allow-same-origin allow-popups"
      className="block w-full border-0"
      style={{ height }}
    />
  );
}

function Initial({ name }: { name: string }) {
  return (
    <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--indigo)] text-caption font-semibold text-white">
      {(name.trim()[0] || 'S').toUpperCase()}
    </span>
  );
}

export function SignaturePreviewPane({ html, use, fromName, fromEmail, accountId }: {
  html: string;
  use: SignatureUse;
  fromName: string;
  fromEmail: string;
  /** A saved mailbox, so a real test can be sent from it. */
  accountId?: string | null;
}) {
  const [client, setClient] = useState<ClientId>('gmail');
  const [kind, setKind] = useState<PreviewKind>('new');
  const [dark, setDark] = useState(false);
  const [testTo, setTestTo] = useState(fromEmail);
  const [sending, setSending] = useState(false);
  useEffect(() => { setTestTo((t) => t || fromEmail); }, [fromEmail]);

  const hasSig = !!signatureText(html);
  const added = hasSig && signatureAppliesTo(use, kind);
  const body = sampleEmailHtml(kind, added ? html : null, fromName);
  const name = fromName.trim() || fromEmail || 'You';
  const subject = kind === 'new' ? 'Following up on our call' : 'Re: Following up on our call';
  const isDark = client === 'phone' && dark;
  const css = clientCss(client, isDark);

  const sendTest = async () => {
    if (!accountId || !testTo.trim()) return;
    setSending(true);
    try {
      const res = await smtpApi.sendTestEmail(accountId, {
        to: testTo.trim(),
        subject: 'Signature test from Sincerely',
        body_html: sampleEmailHtml('new', hasSig ? html : null, fromName),
      });
      if (res && res.success === false) throw new Error(res.error || res.message || 'The test did not send');
      toast.success(`Test sent to ${testTo.trim()}. Open it in Gmail and on your phone.`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'The test did not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-signature-preview>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented size="sm" label="Mail app" options={CLIENTS} value={client} onChange={setClient} />
        <Segmented size="sm" label="Kind of email" options={KINDS} value={kind} onChange={setKind} />
        {client === 'phone' && (
          <button
            type="button"
            aria-pressed={dark}
            onClick={() => setDark((d) => !d)}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-caption font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
        )}
      </div>

      {hasSig && !added && (
        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--bg-elevated)] px-2.5 py-2 text-caption text-[var(--text-secondary)]">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
          {use === 'none'
            ? 'With "Don’t add", the signature only goes on when you insert it from the composer.'
            : kind === 'reply'
              ? 'With "New emails only", replies and forwards go without the signature. You can still insert it from the composer.'
              : 'With "Replies & forwards", new emails go without the signature. You can still insert it from the composer.'}
        </p>
      )}

      {client === 'phone' ? (
        <div className="mx-auto w-full max-w-sm rounded-3xl border-4 border-[var(--text-primary)] p-1.5 shadow-lg">
          <div className={cn('overflow-hidden rounded-2xl', isDark ? 'bg-neutral-900' : 'bg-white')}>
            <div className={cn('flex items-center gap-1.5 px-4 pt-2 text-micro', isDark ? 'text-neutral-400' : 'text-neutral-500')}>
              <Smartphone className="h-3 w-3" /> 9:41
            </div>
            <div className={cn('px-4 pb-2 pt-2 text-heading font-semibold', isDark ? 'text-neutral-100' : 'text-neutral-900')}>{subject}</div>
            <div className="flex items-center gap-2 px-4 pb-2">
              <Initial name={name} />
              <div className="min-w-0">
                <p className={cn('truncate text-body font-semibold', isDark ? 'text-neutral-100' : 'text-neutral-900')}>{name}</p>
                <p className={cn('truncate text-micro', isDark ? 'text-neutral-400' : 'text-neutral-500')}>to Sam</p>
              </div>
            </div>
            <div className="px-3 pb-4">
              <EmailFrame html={body} css={css} title="Phone preview" />
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-white shadow-sm">
          <div className="flex items-center gap-1.5 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-micro text-neutral-500">
            <Monitor className="h-3 w-3" /> {CLIENTS.find((c) => c.value === client)?.label} on a computer
          </div>
          <div className={cn('px-5 pt-4', client === 'outlook' && 'border-b border-neutral-200 pb-3')}>
            <p className={cn('text-neutral-900', client === 'gmail' ? 'text-title font-normal' : 'text-heading font-semibold')}>{subject}</p>
            <div className="mt-3 flex items-center gap-2.5">
              <Initial name={name} />
              <div className="min-w-0 text-caption">
                <p className="truncate text-neutral-900"><span className="font-semibold">{name}</span> {fromEmail && <span className="text-neutral-500">&lt;{fromEmail}&gt;</span>}</p>
                <p className="text-neutral-500">to Sam Taylor</p>
              </div>
            </div>
          </div>
          <div className={cn('px-5 pb-5', client === 'gmail' ? 'pl-16 pt-3' : 'pt-4')}>
            <EmailFrame html={body} css={css} title={`${client} preview`} />
          </div>
        </div>
      )}

      {accountId ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <p className="text-body font-medium text-[var(--text-primary)]">See the real thing</p>
          <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">Send a test from this inbox with the signature as it is now, then open it in Gmail, Outlook or on your phone. It counts as one email.</p>
          <div className="mt-2 flex gap-2">
            <input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              aria-label="Send the test to"
              placeholder="you@company.com"
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-body text-[var(--text-primary)] outline-none focus-visible:border-[var(--indigo)]"
            />
            <button
              type="button"
              disabled={sending || !testTo.trim()}
              onClick={sendTest}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--text-primary)] px-3 text-caption font-medium text-[var(--bg-app)] disabled:opacity-40"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send test
            </button>
          </div>
        </div>
      ) : (
        <p className="text-caption text-[var(--text-tertiary)]">Once this inbox is connected you can send yourself a real test from here.</p>
      )}
    </div>
  );
}

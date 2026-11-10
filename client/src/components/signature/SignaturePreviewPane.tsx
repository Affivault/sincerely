import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Loader2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { Segmented } from '../ui/Segmented';
import { smtpApi } from '../../api/smtp.api';
import { sampleEmailHtml, signatureText } from './signatureHtml';

/* ═══════════════════════════════════════════════════════════════════════
   How the signature will look where it is read.

   Each app is drawn with the font and size it really gives an email:
   Gmail's 13px Arial, Outlook's Segoe and square corners, a phone's narrow
   column. Close enough to catch a logo that is too big; the test send is
   the real thing.
   ═══════════════════════════════════════════════════════════════════════ */

type ClientId = 'gmail' | 'outlook' | 'phone';

const CLIENTS: readonly { value: ClientId; label: string }[] = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook' },
  { value: 'phone', label: 'Phone' },
];

function clientCss(client: ClientId): string {
  const base = 'html,body{margin:0;padding:0;background:#ffffff;color:#222222;}body{padding:0 0 4px;word-wrap:break-word;}a{color:#1a0dab;}p{margin:0 0 1em;}';
  const fonts: Record<ClientId, string> = {
    gmail: 'body{font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;}',
    // Outlook ignores rounded corners and max-width, and sets its own font.
    outlook: 'body{font-family:"Segoe UI",Aptos,Calibri,sans-serif;font-size:14px;line-height:1.35;}img{border-radius:0 !important;max-width:none !important;}',
    phone: 'body{font-family:Helvetica,Roboto,-apple-system,sans-serif;font-size:14px;line-height:1.45;}img{max-width:100% !important;height:auto !important;}table{max-width:100% !important;}',
  };
  return base + fonts[client];
}

function EmailFrame({ html, css, title }: { html: string; css: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${css}</style></head><body>${html}</body></html>`, [html, css]);

  const measure = useCallback(() => {
    const d = ref.current?.contentDocument;
    if (!d?.documentElement) return;
    setHeight(Math.min(1400, Math.max(60, d.documentElement.scrollHeight)));
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

function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--indigo)] text-caption font-semibold text-white">
      {(name.trim()[0] || 'S').toUpperCase()}
    </span>
  );
}

export function SignaturePreviewPane({ html, fromName, fromEmail, accountId }: {
  html: string;
  fromName: string;
  fromEmail: string;
  /** A saved mailbox, so a real test can be sent from it. */
  accountId?: string | null;
}) {
  const [client, setClient] = useState<ClientId>('gmail');
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState(fromEmail);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => { setTestTo((t) => t || fromEmail); }, [fromEmail]);

  const hasSig = !!signatureText(html);
  const body = sampleEmailHtml('new', hasSig ? html : null, fromName);
  const name = fromName.trim() || fromEmail || 'You';
  const css = clientCss(client);

  const sendTest = async () => {
    if (!accountId || !testTo.trim()) return;
    setSending(true);
    try {
      const res = await smtpApi.sendTestEmail(accountId, {
        to: testTo.trim(),
        subject: 'Your signature, as it arrives',
        body_html: body,
      });
      if (res && res.success === false) throw new Error(res.error || res.message || 'The test did not send');
      setSent(true);
      toast.success(`Sent to ${testTo.trim()}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'The test did not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-signature-preview>
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption font-medium text-[var(--text-secondary)]">Preview</p>
        <Segmented size="sm" label="Mail app" options={CLIENTS} value={client} onChange={setClient} />
      </div>

      <div className="flex min-h-0 flex-1 items-start justify-center rounded-2xl bg-[var(--bg-elevated)] p-4">
        {client === 'phone' ? (
          <div className="w-full max-w-xs rounded-3xl border-4 border-neutral-800 bg-white p-1 shadow-lg">
            <div className="overflow-hidden rounded-2xl">
              <div className="mx-auto mt-1.5 h-1.5 w-12 rounded-full bg-neutral-200" />
              <div className="px-4 pb-1 pt-3 text-strong font-semibold text-neutral-900">Following up on our call</div>
              <div className="flex items-center gap-2 px-4 pb-3">
                <Avatar name={name} />
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold text-neutral-900">{name}</p>
                  <p className="truncate text-micro text-neutral-500">to Sam</p>
                </div>
              </div>
              <div className="px-4 pb-5">
                <EmailFrame html={body} css={css} title="Phone preview" />
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5">
            <div className={cn('px-5 pt-4', client === 'outlook' && 'border-b border-neutral-200 pb-3')}>
              <p className={cn('text-neutral-900', client === 'gmail' ? 'text-heading' : 'text-strong font-semibold')}>Following up on our call</p>
              <div className="mt-3 flex items-center gap-2.5">
                <Avatar name={name} />
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
      </div>

      {accountId && (
        testOpen ? (
          <div className="flex gap-2">
            <input
              type="email"
              autoFocus
              value={testTo}
              onChange={(e) => { setTestTo(e.target.value); setSent(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendTest(); } }}
              aria-label="Send the test to"
              placeholder="you@company.com"
              className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-body text-[var(--text-primary)] outline-none focus-visible:border-[var(--indigo)]"
            />
            <button
              type="button"
              disabled={sending || !testTo.trim()}
              onClick={sendTest}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--text-primary)] px-3 text-caption font-medium text-[var(--bg-app)] disabled:opacity-40"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : sent ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
              {sent ? 'Sent' : 'Send'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setTestOpen(true)}
            className="inline-flex items-center gap-1.5 self-center text-caption font-medium text-[var(--indigo-text)] hover:underline"
          >
            <Send className="h-3.5 w-3.5" /> Email me a test to check it on my phone
          </button>
        )
      )}
    </div>
  );
}

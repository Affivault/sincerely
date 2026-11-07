import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Upload, Loader2, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { SIGNATURE_USES, SIGNATURE_MAX_CHARS, signatureProblems, type SignatureUse } from '@lemlist/shared';
import { Modal } from '../ui/Modal';
import { Segmented } from '../ui/Segmented';
import { cn } from '../../lib/utils';
import { SignatureEditor, uploadSignatureImage } from './SignatureEditor';
import { SignaturePreviewPane } from './SignaturePreviewPane';
import {
  buildSignatureHtml, sanitizeSignatureHtml, signatureText, EMAIL_FONTS, EMPTY_DETAILS, SIGNATURE_LAYOUTS,
  type SignatureDetails, type SignatureLayout,
} from './signatureHtml';

/* ═══════════════════════════════════════════════════════════════════════
   The signature studio: write it, or build it from your details, or paste
   HTML; choose which emails it goes on; and see it in each mail app before
   it goes anywhere.
   ═══════════════════════════════════════════════════════════════════════ */

type Tab = 'edit' | 'build' | 'html';
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'edit', label: 'Editor' },
  { value: 'build', label: 'Templates' },
  { value: 'html', label: 'HTML' },
];

const DETAILS_KEY = 'sincerely.signature-details';

function loadDetails(fromName: string, fromEmail: string): SignatureDetails {
  let saved: Partial<SignatureDetails> = {};
  try { saved = JSON.parse(localStorage.getItem(DETAILS_KEY) || '{}') || {}; } catch { /* private window */ }
  return { ...EMPTY_DETAILS, ...saved, name: saved.name || fromName || '', email: fromEmail || saved.email || '' };
}

const fieldCls = 'h-8 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-body text-[var(--text-primary)] outline-none focus-visible:border-[var(--indigo)]';

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={cn('block text-caption font-medium text-[var(--text-secondary)]', wide && 'sm:col-span-2')}>
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Builder({ details, setDetails, layout, setLayout, onUse }: {
  details: SignatureDetails;
  setDetails: (d: SignatureDetails) => void;
  layout: SignatureLayout;
  setLayout: (l: SignatureLayout) => void;
  onUse: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const set = (k: keyof SignatureDetails) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.type === 'number' || e.target.type === 'range' ? Number(e.target.value) : e.target.value;
    setDetails({ ...details, [k]: v });
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadSignatureImage(file);
      setDetails({ ...details, imageUrl: url });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'The image did not upload');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-caption font-medium text-[var(--text-secondary)]">Layout</p>
        <div className="grid grid-cols-2 gap-2">
          {SIGNATURE_LAYOUTS.map((l) => (
            <button
              key={l.value}
              type="button"
              aria-pressed={layout === l.value}
              onClick={() => setLayout(l.value)}
              className={cn(
                'rounded-lg border px-2.5 py-2 text-left transition-colors',
                layout === l.value ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]',
              )}
            >
              <span className="block text-body font-medium text-[var(--text-primary)]">{l.label}</span>
              <span className="block text-micro text-[var(--text-tertiary)]">{l.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Full name"><input className={fieldCls} value={details.name} onChange={set('name')} placeholder="Alex Morgan" /></Field>
        <Field label="Job title"><input className={fieldCls} value={details.title} onChange={set('title')} placeholder="Head of Growth" /></Field>
        <Field label="Company"><input className={fieldCls} value={details.company} onChange={set('company')} placeholder="Northwind" /></Field>
        <Field label="Website"><input className={fieldCls} value={details.website} onChange={set('website')} placeholder="northwind.com" /></Field>
        <Field label="Phone"><input className={fieldCls} value={details.phone} onChange={set('phone')} placeholder="+44 20 7946 0000" /></Field>
        <Field label="Mobile"><input className={fieldCls} value={details.mobile} onChange={set('mobile')} placeholder="Optional" /></Field>
        <Field label="Email"><input className={fieldCls} value={details.email} onChange={set('email')} placeholder="alex@northwind.com" /></Field>
        <Field label="Address"><input className={fieldCls} value={details.address} onChange={set('address')} placeholder="Optional" /></Field>
        <Field label="LinkedIn"><input className={fieldCls} value={details.linkedin} onChange={set('linkedin')} placeholder="linkedin.com/in/you" /></Field>
        <Field label="X (Twitter)"><input className={fieldCls} value={details.twitter} onChange={set('twitter')} placeholder="Optional" /></Field>
        <Field label="Booking link"><input className={fieldCls} value={details.booking} onChange={set('booking')} placeholder="Your meeting page, adds a button" /></Field>
        <Field label="Button text"><input className={fieldCls} value={details.bookingLabel} onChange={set('bookingLabel')} /></Field>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] p-3">
        <p className="mb-2 text-caption font-medium text-[var(--text-secondary)]">Logo or photo</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className={cn('inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-caption font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]', uploading && 'pointer-events-none opacity-60')}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? 'Uploading...' : 'Upload'}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <input className={cn(fieldCls, 'flex-1 min-w-40')} value={details.imageUrl} onChange={set('imageUrl')} placeholder="or https://... image address" aria-label="Image address" />
        </div>
        {details.imageUrl && (
          <div className="mt-2 flex flex-wrap items-center gap-4 text-caption text-[var(--text-secondary)]">
            <label className="flex items-center gap-2">
              Width
              <input type="range" min={32} max={layout === 'banner' ? 600 : 200} value={details.imageWidth} onChange={set('imageWidth')} className="w-32 accent-[var(--indigo)]" />
              <span className="tabular-nums">{details.imageWidth}px</span>
            </label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={details.imageRound} onChange={set('imageRound')} /> Round (for a headshot)</label>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Accent colour">
          <div className="flex items-center gap-2">
            <input type="color" value={details.accent} onChange={set('accent')} className="h-8 w-10 cursor-pointer rounded border border-[var(--border-subtle)] bg-transparent" aria-label="Accent colour" />
            <input className={fieldCls} value={details.accent} onChange={set('accent')} aria-label="Accent colour code" />
          </div>
        </Field>
        <Field label="Font">
          <select className={fieldCls} value={details.font} onChange={set('font')}>
            {EMAIL_FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--bg-elevated)] px-3 py-2">
        <p className="text-caption text-[var(--text-tertiary)]">The preview shows this design. Using it replaces the signature in the editor, where you can fine-tune it.</p>
        <button type="button" onClick={onUse} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[var(--indigo)] px-3 text-caption font-medium text-white">
          <Wand2 className="h-3.5 w-3.5" /> Use this design
        </button>
      </div>
    </div>
  );
}

export function SignatureStudio({ isOpen, onClose, initialHtml, initialUse, onSave, fromName, fromEmail, accountId }: {
  isOpen: boolean;
  onClose: () => void;
  initialHtml: string;
  initialUse: SignatureUse;
  onSave: (html: string, use: SignatureUse) => void;
  fromName: string;
  fromEmail: string;
  accountId?: string | null;
}) {
  const [tab, setTab] = useState<Tab>('edit');
  const [draft, setDraft] = useState(initialHtml);
  const [use, setUse] = useState<SignatureUse>(initialUse);
  const [details, setDetailsState] = useState<SignatureDetails>(() => loadDetails(fromName, fromEmail));
  const [layout, setLayout] = useState<SignatureLayout>('logo-left');

  // Each opening starts from what is saved.
  useEffect(() => {
    if (!isOpen) return;
    setDraft(initialHtml);
    setUse(initialUse);
    setTab(signatureText(initialHtml) ? 'edit' : 'build');
    setDetailsState(loadDetails(fromName, fromEmail));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDetails = (d: SignatureDetails) => {
    setDetailsState(d);
    try { localStorage.setItem(DETAILS_KEY, JSON.stringify(d)); } catch { /* private window */ }
  };

  const built = useMemo(() => buildSignatureHtml(details, layout), [details, layout]);
  const shown = tab === 'build' ? built : draft;
  const problems = useMemo(() => signatureProblems(shown), [shown]);
  const empty = !signatureText(draft);

  const save = () => {
    const clean = empty ? '' : sanitizeSignatureHtml(draft);
    onSave(clean, use);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      title="Email signature"
      description="Write it, build it from your details or paste HTML. The preview shows it in each mail app."
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <span className={cn('text-caption tabular-nums', draft.length > SIGNATURE_MAX_CHARS ? 'text-rose-600' : 'text-[var(--text-tertiary)]')}>
            {draft.length.toLocaleString()} / {SIGNATURE_MAX_CHARS.toLocaleString()} characters
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-strong font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Cancel</button>
            <button type="button" onClick={save} className="h-9 rounded-lg bg-[var(--indigo)] px-4 text-strong font-medium text-white hover:opacity-90" data-save-signature>
              {empty ? 'Save without a signature' : 'Save signature'}
            </button>
          </div>
        </div>
      )}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <Segmented label="How to make it" options={TABS} value={tab} onChange={setTab} />
          {tab === 'edit' && (
            <>
              <SignatureEditor value={draft} onChange={setDraft} />
              <p className="text-micro text-[var(--text-tertiary)]">Click an image to resize it, round it or link it. Paste a signature from Gmail, Outlook or a signature generator and it keeps its layout.</p>
            </>
          )}
          {tab === 'build' && (
            <Builder
              details={details}
              setDetails={setDetails}
              layout={layout}
              setLayout={setLayout}
              onUse={() => { setDraft(built); setTab('edit'); toast.success('Design added. Fine-tune it here.'); }}
            />
          )}
          {tab === 'html' && (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setDraft((d) => sanitizeSignatureHtml(d))}
                spellCheck={false}
                aria-label="Signature HTML"
                className="h-80 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 font-mono text-caption text-[var(--text-primary)] outline-none focus-visible:border-[var(--indigo)]"
                placeholder="<table>...</table>"
              />
              <p className="text-micro text-[var(--text-tertiary)]">Inline styles and tables work everywhere. Scripts, forms and style blocks are removed because mail apps drop them.</p>
            </>
          )}

          {problems.length > 0 && (
            <ul className="space-y-1.5" data-signature-problems>
              {problems.map((p) => (
                <li key={p.message} className="flex items-start gap-1.5 text-caption text-[var(--text-secondary)]">
                  {p.level === 'warn'
                    ? <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
                    : <Info className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />}
                  {p.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div>
            <p className="mb-1.5 text-caption font-medium text-[var(--text-secondary)]">Add it on its own to</p>
            <Segmented size="sm" label="Add the signature to" options={SIGNATURE_USES} value={use} onChange={setUse} />
            <p className="mt-1 text-micro text-[var(--text-tertiary)]">{SIGNATURE_USES.find((u) => u.value === use)?.hint}</p>
          </div>
          <SignaturePreviewPane html={shown} use={use} fromName={fromName || details.name} fromEmail={fromEmail} accountId={accountId} />
        </div>
      </div>
    </Modal>
  );
}

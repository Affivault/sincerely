import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ChevronDown, LayoutTemplate, Loader2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { signatureProblems } from '@lemlist/shared';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/utils';
import { SignatureEditor, uploadSignatureImage } from './SignatureEditor';
import { SignaturePreviewPane } from './SignaturePreviewPane';
import {
  buildSignatureHtml, sanitizeSignatureHtml, signatureText, EMPTY_DETAILS,
  type SignatureDetails, type SignatureLayout,
} from './signatureHtml';

/* ═══════════════════════════════════════════════════════════════════════
   The signature editor: one place to write, one live preview.

   Writing is the main thing on screen. A template is a way in for someone
   starting from nothing, and everything rarer (fonts, alignment, HTML) sits
   behind the toolbar's "more" button, so the screen stays quiet.
   ═══════════════════════════════════════════════════════════════════════ */

const LAYOUTS: { value: SignatureLayout; label: string }[] = [
  { value: 'logo-left', label: 'Logo beside' },
  { value: 'classic', label: 'Logo below' },
  { value: 'compact', label: 'Simple' },
];

const DETAILS_KEY = 'sincerely.signature-details';

function loadDetails(fromName: string, fromEmail: string): SignatureDetails {
  let saved: Partial<SignatureDetails> = {};
  try { saved = JSON.parse(localStorage.getItem(DETAILS_KEY) || '{}') || {}; } catch { /* private window */ }
  return { ...EMPTY_DETAILS, ...saved, name: saved.name || fromName || '', email: fromEmail || saved.email || '' };
}

const fieldCls = 'h-9 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-body text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus-visible:border-[var(--indigo)]';

/** A thumbnail of each layout: shapes, not words, so the choice is obvious at a glance. */
function LayoutThumb({ layout }: { layout: SignatureLayout }) {
  const bar = (w: string, strong?: boolean) => <span className={cn('block h-1 rounded-full', w, strong ? 'bg-[var(--text-secondary)]' : 'bg-[var(--border-default)]')} />;
  const logo = <span className="block h-5 w-5 shrink-0 rounded bg-[var(--indigo)] opacity-70" />;
  if (layout === 'logo-left') {
    return <span className="flex items-center gap-1.5">{logo}<span className="space-y-1 border-l-2 border-[var(--indigo)] pl-1.5">{bar('w-10', true)}{bar('w-8')}{bar('w-12')}</span></span>;
  }
  if (layout === 'classic') {
    return <span className="space-y-1">{bar('w-10', true)}{bar('w-8')}{bar('w-12')}<span className="mt-1 block h-3 w-6 rounded bg-[var(--indigo)] opacity-70" /></span>;
  }
  return <span className="space-y-1">{bar('w-14', true)}{bar('w-12')}</span>;
}

function TemplatePanel({ details, setDetails, layout, setLayout, onUse, onBack, canGoBack }: {
  details: SignatureDetails;
  setDetails: (d: SignatureDetails) => void;
  layout: SignatureLayout;
  setLayout: (l: SignatureLayout) => void;
  onUse: () => void;
  onBack: () => void;
  canGoBack: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [more, setMore] = useState(false);
  const set = (k: keyof SignatureDetails) => (e: React.ChangeEvent<HTMLInputElement>) => setDetails({ ...details, [k]: e.target.value });
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      setDetails({ ...details, imageUrl: await uploadSignatureImage(file) });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'The image did not upload');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4" data-signature-template>
      <div className="flex items-center gap-2">
        {canGoBack && (
          <button type="button" onClick={onBack} aria-label="Back to the editor" className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <p className="text-strong font-semibold text-[var(--text-primary)]">Fill in your details</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {LAYOUTS.map((l) => (
          <button
            key={l.value}
            type="button"
            aria-pressed={layout === l.value}
            onClick={() => setLayout(l.value)}
            className={cn(
              'flex flex-col items-start gap-2 rounded-xl border p-2.5 text-left transition-colors',
              layout === l.value ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]' : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]',
            )}
          >
            <span className="flex h-8 items-center"><LayoutThumb layout={l.value} /></span>
            <span className="text-caption font-medium text-[var(--text-primary)]">{l.label}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <input className={fieldCls} value={details.name} onChange={set('name')} placeholder="Full name" aria-label="Full name" />
        <input className={fieldCls} value={details.title} onChange={set('title')} placeholder="Job title" aria-label="Job title" />
        <input className={fieldCls} value={details.company} onChange={set('company')} placeholder="Company" aria-label="Company" />
        <input className={fieldCls} value={details.phone} onChange={set('phone')} placeholder="Phone" aria-label="Phone" />
        <input className={cn(fieldCls, 'col-span-2')} value={details.website} onChange={set('website')} placeholder="Website" aria-label="Website" />
      </div>

      {layout !== 'compact' && (
        details.imageUrl ? (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] p-2.5">
            <img src={details.imageUrl} alt="" className="h-10 w-10 rounded-lg object-contain" />
            <label className="flex flex-1 items-center gap-2 text-caption text-[var(--text-secondary)]">
              Size
              <input type="range" min={40} max={160} value={details.imageWidth} onChange={(e) => setDetails({ ...details, imageWidth: Number(e.target.value) })} className="flex-1 accent-[var(--indigo)]" />
            </label>
            <label className="flex items-center gap-1.5 text-caption text-[var(--text-secondary)]">
              <input type="checkbox" checked={details.imageRound} onChange={(e) => setDetails({ ...details, imageRound: e.target.checked })} /> Round
            </label>
            <button type="button" aria-label="Remove image" onClick={() => setDetails({ ...details, imageUrl: '' })} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <label className={cn('flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-default)] text-caption font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]', uploading && 'pointer-events-none opacity-60')}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? 'Uploading...' : 'Add your logo or a photo'}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        )
      )}

      <div>
        <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)} className="inline-flex items-center gap-1 text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', more && 'rotate-180')} /> More details
        </button>
        {more && (
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <input className={fieldCls} value={details.mobile} onChange={set('mobile')} placeholder="Mobile" aria-label="Mobile" />
            <input className={fieldCls} value={details.email} onChange={set('email')} placeholder="Email" aria-label="Email" />
            <input className={fieldCls} value={details.linkedin} onChange={set('linkedin')} placeholder="LinkedIn profile" aria-label="LinkedIn" />
            <input className={fieldCls} value={details.twitter} onChange={set('twitter')} placeholder="X profile" aria-label="X" />
            <input className={cn(fieldCls, 'col-span-2')} value={details.booking} onChange={set('booking')} placeholder="Booking link (adds a 'Book a call' button)" aria-label="Booking link" />
            <input className={cn(fieldCls, 'col-span-2')} value={details.address} onChange={set('address')} placeholder="Address" aria-label="Address" />
            <label className="col-span-2 flex items-center gap-2 text-caption text-[var(--text-secondary)]">
              <input type="color" value={details.accent} onChange={(e) => setDetails({ ...details, accent: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-[var(--border-subtle)] bg-transparent" aria-label="Accent colour" />
              Accent colour
            </label>
          </div>
        )}
      </div>

      <div className="mt-auto pt-1">
        <button type="button" onClick={onUse} className="h-9 w-full rounded-lg border border-[var(--border-default)] text-strong font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]" data-use-template>
          Fine-tune it in the editor
        </button>
      </div>
    </div>
  );
}

export function SignatureStudio({ isOpen, onClose, initialHtml, onSave, fromName, fromEmail, accountId }: {
  isOpen: boolean;
  onClose: () => void;
  initialHtml: string;
  onSave: (html: string) => void;
  fromName: string;
  fromEmail: string;
  accountId?: string | null;
}) {
  const [mode, setMode] = useState<'edit' | 'template'>('edit');
  const [draft, setDraft] = useState(initialHtml);
  const [details, setDetailsState] = useState<SignatureDetails>(() => loadDetails(fromName, fromEmail));
  const [layout, setLayout] = useState<SignatureLayout>('logo-left');

  // Each opening starts from what is saved; nothing saved starts on the template.
  useEffect(() => {
    if (!isOpen) return;
    setDraft(initialHtml);
    setMode(signatureText(initialHtml) ? 'edit' : 'template');
    setDetailsState(loadDetails(fromName, fromEmail));
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDetails = (d: SignatureDetails) => {
    setDetailsState(d);
    try { localStorage.setItem(DETAILS_KEY, JSON.stringify(d)); } catch { /* private window */ }
  };

  const built = useMemo(() => buildSignatureHtml(details, layout), [details, layout]);
  const shown = mode === 'template' ? built : draft;
  // Only what will actually look wrong; the finer advice is noise here.
  const problem = useMemo(() => signatureProblems(draft).find((p) => p.level === 'warn'), [draft]);
  const empty = !signatureText(draft);

  // Saving from the template keeps the template: no extra step first.
  const save = () => {
    const html = mode === 'template' ? built : draft;
    onSave(signatureText(html) ? sanitizeSignatureHtml(html) : '');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      title="Your signature"
      footer={(
        <div className="flex w-full items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-strong font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Cancel</button>
          <button
            type="button"
            onClick={save}
            className="h-9 rounded-lg bg-[var(--indigo)] px-4 text-strong font-medium text-white hover:opacity-90 disabled:opacity-40"
            data-save-signature
          >
            Save
          </button>
        </div>
      )}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          {mode === 'template' ? (
            <TemplatePanel
              details={details}
              setDetails={setDetails}
              layout={layout}
              setLayout={setLayout}
              canGoBack={!empty}
              onBack={() => setMode('edit')}
              onUse={() => { setDraft(built); setMode('edit'); }}
            />
          ) : (
            <div className="space-y-2.5">
              <SignatureEditor value={draft} onChange={setDraft} minHeight={220} />
              {problem && (
                <p className="flex items-start gap-1.5 text-caption text-[var(--text-secondary)]" data-signature-problems>
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
                  {problem.message}
                </p>
              )}
              <button type="button" onClick={() => setMode('template')} className="inline-flex items-center gap-1.5 text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <LayoutTemplate className="h-3.5 w-3.5" /> Start again from a template
              </button>
            </div>
          )}
        </div>

        <SignaturePreviewPane html={shown} fromName={fromName || details.name} fromEmail={fromEmail} accountId={accountId} />
      </div>
    </Modal>
  );
}

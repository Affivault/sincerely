import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bold, Italic, Underline, Link2, ImagePlus, Minus, AlignLeft, AlignCenter,
  AlignRight, Eraser, Palette, Trash2, Upload, Loader2, X, MoreHorizontal, Code2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '../../lib/utils';
import { smtpApi } from '../../api/smtp.api';
import { EMAIL_FONTS, normaliseHref, sanitizeSignatureHtml } from './signatureHtml';

/* ═══════════════════════════════════════════════════════════════════════
   The signature's own editor.

   Not the email editor: that one keeps to paragraphs and simple marks and
   throws away the tables and inline styles a real signature is made of,
   so a signature pasted from anywhere came back as plain lines. This edits
   the HTML as it is, with the same commands Gmail's signature box uses
   (font, size, colour, alignment, links, images), and cleans what is pasted
   rather than flattening it.
   ═══════════════════════════════════════════════════════════════════════ */

const SIZES: { label: string; value: string }[] = [
  { label: 'Small', value: '1' },
  { label: 'Normal', value: '2' },
  { label: 'Large', value: '4' },
  { label: 'Huge', value: '6' },
];

const COLOURS = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#2F3F9C', '#1a73e8', '#0b8043', '#d93025', '#e37400', '#f6bf26',
  '#7627bb', '#c2185b', '#00796b', '#5d4037', '#455a64', '#0097a7',
];

/** Under the server's 400 KB, with room for base64 rounding. */
const UPLOAD_MAX_BYTES = 380 * 1024;

function dataUrlBytes(url: string): number {
  const i = url.indexOf(',');
  return Math.floor(((url.length - i - 1) * 3) / 4);
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file is not an image this browser can read'));
    img.src = src;
  });
}

/**
 * Shrink an image to something an inbox loads quickly: at most 600px wide
 * (sharp at 300px on a retina screen) and under the upload limit. A small
 * GIF is left alone so an animation survives.
 */
async function prepareImage(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type)) {
    throw new Error('Use a PNG, JPG, GIF or WebP image. Gmail and Outlook do not show SVG.');
  }
  const src = await readFile(file);
  if (file.type === 'image/gif' && file.size <= UPLOAD_MAX_BYTES) return src;
  const img = await loadImage(src);
  const maxW = 600;
  if (file.size <= UPLOAD_MAX_BYTES && img.naturalWidth <= maxW) return src;
  const scale = Math.min(1, maxW / img.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not resize the image');
  const keepPng = file.type === 'image/png';
  if (!keepPng) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let out = canvas.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.9);
  if (dataUrlBytes(out) > UPLOAD_MAX_BYTES) {
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    out = canvas.toDataURL('image/jpeg', 0.82);
  }
  if (dataUrlBytes(out) > UPLOAD_MAX_BYTES) throw new Error('That image is too large even after resizing. Try a smaller one.');
  return out;
}

/** Upload an image file and hand back its public address. */
export async function uploadSignatureImage(file: File): Promise<string> {
  const dataUrl = await prepareImage(file);
  const { url } = await smtpApi.uploadSignatureImage(dataUrl);
  return url;
}

function Btn({ title, onClick, active, children, disabled }: { title: string; onClick: () => void; active?: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-30',
        active ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--border-subtle)]" />;
}

function Popover({ children, onClose, wide, align = 'left' }: { children: ReactNode; onClose: () => void; wide?: boolean; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [onClose]);
  return (
    <div ref={ref} className={cn('absolute top-full z-50 mt-1 rounded-xl', align === 'right' ? 'right-0' : 'left-0', 'border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5 shadow-lg', wide ? 'w-72' : 'w-56')}>
      {children}
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-body text-[var(--text-primary)] outline-none focus-visible:border-[var(--indigo)]';

type Active = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; list: boolean; align: 'left' | 'center' | 'right' };
const NO_ACTIVE: Active = { bold: false, italic: false, underline: false, strike: false, list: false, align: 'left' };

export function SignatureEditor({ value, onChange, minHeight = 180 }: { value: string; onChange: (html: string) => void; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const range = useRef<Range | null>(null);
  const [active, setActive] = useState<Active>(NO_ACTIVE);
  const [open, setOpen] = useState<null | 'colour' | 'link' | 'image' | 'more'>(null);
  const [source, setSource] = useState(false);
  const [selImg, setSelImg] = useState<HTMLImageElement | null>(null);
  const [, force] = useState(0);
  const [uploading, setUploading] = useState(false);

  // Link and image forms.
  const [linkText, setLinkText] = useState('');
  const [linkHref, setLinkHref] = useState('');
  const [imgUrl, setImgUrl] = useState('');

  const emit = useCallback(() => {
    const html = ref.current?.innerHTML || '';
    lastEmitted.current = html;
    onChange(html);
  }, [onChange]);

  // Take a new value from outside (a template, the HTML tab) without
  // fighting the cursor on every keystroke from inside.
  useEffect(() => {
    if (!ref.current) return;
    if (value !== lastEmitted.current) {
      ref.current.innerHTML = value || '';
      lastEmitted.current = value || '';
      setSelImg(null);
    }
  }, [value]);

  const inside = (n: Node | null) => !!n && !!ref.current && ref.current.contains(n);

  const refreshActive = useCallback(() => {
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike: document.queryCommandState('strikeThrough'),
        list: document.queryCommandState('insertUnorderedList'),
        align: document.queryCommandState('justifyCenter') ? 'center' : document.queryCommandState('justifyRight') ? 'right' : 'left',
      });
    } catch { /* queryCommandState can throw with no selection */ }
  }, []);

  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && inside(sel.anchorNode)) {
        range.current = sel.getRangeAt(0).cloneRange();
        refreshActive();
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [refreshActive]);

  /** Put the cursor back where it was before a toolbar control took focus. */
  const restore = () => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (range.current && inside(range.current.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    } else {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };

  const exec = (cmd: string, arg?: string) => {
    restore();
    try { document.execCommand('styleWithCSS', false, 'false'); } catch { /* older browsers */ }
    document.execCommand(cmd, false, arg);
    emit();
    refreshActive();
  };

  const insertHtml = (html: string) => exec('insertHTML', html);

  /* ── Links ── */
  const openLink = () => {
    const sel = window.getSelection();
    const text = sel && inside(sel.anchorNode) ? sel.toString() : '';
    const anchor = (sel?.anchorNode?.parentElement?.closest('a') as HTMLAnchorElement | null);
    setLinkText(text);
    setLinkHref(anchor && inside(anchor) ? anchor.getAttribute('href') || '' : '');
    setOpen('link');
  };
  const applyLink = () => {
    const href = normaliseHref(linkHref);
    if (!href) { setOpen(null); return; }
    const hasSelection = !!range.current && !range.current.collapsed && inside(range.current.startContainer);
    if (hasSelection) {
      exec('createLink', href);
      ref.current?.querySelectorAll('a').forEach((a) => {
        if (a.getAttribute('href') === href) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
      });
      emit();
    } else {
      const label = linkText.trim() || linkHref.trim();
      insertHtml(`<a href="${href.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</a>&nbsp;`);
    }
    setOpen(null);
  };

  /* ── Images ── */
  const insertImage = (url: string, width: number, alt: string) => {
    const w = Math.max(16, Math.min(600, Math.round(width) || 120));
    const safeAlt = alt.replace(/"/g, '&quot;');
    insertHtml(`<img src="${url.replace(/"/g, '&quot;')}" width="${w}" alt="${safeAlt}" style="width:${w}px;max-width:100%;height:auto;border:0;">`);
  };
  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadSignatureImage(file);
      insertImage(url, 120, file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '));
      setOpen(null);
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'The image did not upload');
    } finally {
      setUploading(false);
    }
  };

  /* ── The image under the cursor ── */
  const setImgAttr = (fn: (img: HTMLImageElement) => void) => {
    if (!selImg) return;
    fn(selImg);
    emit();
    force((n) => n + 1);
  };
  const selImgLink = selImg?.parentElement?.tagName === 'A' ? selImg.parentElement.getAttribute('href') || '' : '';
  const setSelImgLink = (raw: string) => setImgAttr((img) => {
    const href = normaliseHref(raw);
    const parent = img.parentElement;
    if (parent && parent.tagName === 'A') {
      if (href) parent.setAttribute('href', href);
      else parent.replaceWith(img);
    } else if (href) {
      const a = document.createElement('a');
      a.setAttribute('href', href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      img.replaceWith(a);
      a.appendChild(img);
    }
  });

  return (
    <div className="overflow-visible rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center gap-0.5 border-b border-[var(--border-subtle)] px-2 py-1.5">
        <Btn title="Bold" active={active.bold} onClick={() => exec('bold')} disabled={source}><Bold className="h-4 w-4" /></Btn>
        <Btn title="Italic" active={active.italic} onClick={() => exec('italic')} disabled={source}><Italic className="h-4 w-4" /></Btn>
        <Btn title="Underline" active={active.underline} onClick={() => exec('underline')} disabled={source}><Underline className="h-4 w-4" /></Btn>
        <span className="relative">
          <Btn title="Text colour" active={open === 'colour'} onClick={() => setOpen(open === 'colour' ? null : 'colour')} disabled={source}><Palette className="h-4 w-4" /></Btn>
          {open === 'colour' && (
            <Popover onClose={() => setOpen(null)}>
              <div className="grid grid-cols-6 gap-1.5">
                {COLOURS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    aria-label={`Colour ${c}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { exec('foreColor', c); setOpen(null); }}
                    className="h-6 w-6 rounded-full border border-[var(--border-default)] transition-transform hover:scale-110"
                    style={{ background: c }}
                  />
                ))}
              </div>
            </Popover>
          )}
        </span>
        <Sep />
        <span className="relative">
          <Btn title="Add a link" active={open === 'link'} onClick={() => (open === 'link' ? setOpen(null) : openLink())} disabled={source}><Link2 className="h-4 w-4" /></Btn>
          {open === 'link' && (
            <Popover onClose={() => setOpen(null)} wide>
              <div className="space-y-2">
                {!(range.current && !range.current.collapsed) && (
                  <input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Text to show" aria-label="Text to show" className={inputCls} />
                )}
                <input
                  autoFocus
                  value={linkHref}
                  onChange={(e) => setLinkHref(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } }}
                  placeholder="Website, email or phone number"
                  aria-label="Link address"
                  className={inputCls}
                />
                <div className="flex justify-end">
                  <button type="button" onClick={applyLink} className="h-7 rounded-md bg-[var(--indigo)] px-3 text-caption font-medium text-white">Add link</button>
                </div>
              </div>
            </Popover>
          )}
        </span>
        <span className="relative">
          <Btn title="Add an image" active={open === 'image'} onClick={() => setOpen(open === 'image' ? null : 'image')} disabled={source}><ImagePlus className="h-4 w-4" /></Btn>
          {open === 'image' && (
            <Popover onClose={() => setOpen(null)} wide>
              <div className="space-y-2">
                <label className={cn('flex h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border-default)] text-caption font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]', uploading && 'pointer-events-none opacity-60')}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? 'Uploading...' : 'Upload a logo or photo'}
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                <div className="flex gap-1.5">
                  <input value={imgUrl} onChange={(e) => setImgUrl(e.target.value)} placeholder="or paste an image link" aria-label="Image address" className={inputCls} />
                  <button
                    type="button"
                    disabled={!/^https:\/\//i.test(imgUrl.trim())}
                    onClick={() => { insertImage(imgUrl.trim(), 120, ''); setImgUrl(''); setOpen(null); }}
                    className="h-8 shrink-0 rounded-md bg-[var(--indigo)] px-3 text-caption font-medium text-white disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            </Popover>
          )}
        </span>
        <span className="flex-1" />
        <span className="relative">
          <Btn title="More formatting" active={open === 'more' || source} onClick={() => setOpen(open === 'more' ? null : 'more')}><MoreHorizontal className="h-4 w-4" /></Btn>
          {open === 'more' && (
            <Popover onClose={() => setOpen(null)} align="right">
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    aria-label="Font"
                    defaultValue=""
                    disabled={source}
                    onChange={(e) => { if (e.target.value) exec('fontName', e.target.value); e.target.value = ''; }}
                    className="h-8 text-caption"
                  >
                    <option value="" disabled>Font</option>
                    {EMAIL_FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
                  </select>
                  <select
                    aria-label="Text size"
                    defaultValue=""
                    disabled={source}
                    onChange={(e) => { if (e.target.value) exec('fontSize', e.target.value); e.target.value = ''; }}
                    className="h-8 text-caption"
                  >
                    <option value="" disabled>Size</option>
                    {SIZES.map((sz) => <option key={sz.value} value={sz.value}>{sz.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-0.5">
                  <Btn title="Align left" active={active.align === 'left'} onClick={() => exec('justifyLeft')} disabled={source}><AlignLeft className="h-4 w-4" /></Btn>
                  <Btn title="Centre" active={active.align === 'center'} onClick={() => exec('justifyCenter')} disabled={source}><AlignCenter className="h-4 w-4" /></Btn>
                  <Btn title="Align right" active={active.align === 'right'} onClick={() => exec('justifyRight')} disabled={source}><AlignRight className="h-4 w-4" /></Btn>
                  <Sep />
                  <Btn title="Divider line" onClick={() => insertHtml('<hr style="border:0;border-top:1px solid #dadce0;margin:8px 0;">')} disabled={source}><Minus className="h-4 w-4" /></Btn>
                  <Btn title="Clear formatting" onClick={() => exec('removeFormat')} disabled={source}><Eraser className="h-4 w-4" /></Btn>
                </div>
                <button
                  type="button"
                  onClick={() => { if (source) onChange(sanitizeSignatureHtml(value)); setSource(!source); setOpen(null); }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  <Code2 className="h-3.5 w-3.5" /> {source ? 'Back to the editor' : 'Edit as HTML'}
                </button>
              </div>
            </Popover>
          )}
        </span>
      </div>

      {selImg && inside(selImg) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-caption text-[var(--text-secondary)]" data-image-controls>
          <span className="font-medium text-[var(--text-primary)]">Image</span>
          <label className="flex items-center gap-1.5">
            Width
            <input
              type="range"
              min={16}
              max={600}
              value={Number(selImg.getAttribute('width')) || selImg.width || 120}
              onChange={(e) => setImgAttr((img) => { const w = e.target.value; img.setAttribute('width', w); img.style.width = `${w}px`; img.style.height = 'auto'; })}
              className="w-28 accent-[var(--indigo)]"
            />
            <span className="w-10 tabular-nums">{Number(selImg.getAttribute('width')) || selImg.width}px</span>
          </label>
          <label className="flex items-center gap-1.5">
            Round
            <input type="checkbox" checked={/border-radius:\s*50%/.test(selImg.getAttribute('style') || '')} onChange={(e) => setImgAttr((img) => { img.style.borderRadius = e.target.checked ? '50%' : ''; })} />
          </label>
          <input defaultValue={selImgLink} key={`href-${selImg.src}`} onBlur={(e) => setSelImgLink(e.target.value)} placeholder="Link it to a website" aria-label="Image link" className="h-7 w-44 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-caption" />
          <button type="button" onClick={() => { const img = selImg; setSelImg(null); (img.parentElement?.tagName === 'A' && img.parentElement.childNodes.length === 1 ? img.parentElement : img).remove(); emit(); }} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-rose-600 hover:bg-[var(--bg-hover)]">
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </button>
          <button type="button" aria-label="Done with image" onClick={() => setSelImg(null)} className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-[var(--bg-hover)]"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {source && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          aria-label="Signature HTML"
          className="block w-full resize-y rounded-b-xl border-0 bg-[var(--bg-elevated)] p-3 font-mono text-caption text-[var(--text-primary)] outline-none"
          style={{ minHeight }}
        />
      )}
      {/* The writing area is always white, as the email will be: what you see is what is sent. */}
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label="Signature"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        data-signature-editor
        onInput={emit}
        onKeyUp={refreshActive}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          setSelImg(t.tagName === 'IMG' ? (t as HTMLImageElement) : null);
          if (t.closest('a')) e.preventDefault();
        }}
        onPaste={(e) => {
          const file = Array.from(e.clipboardData.files || []).find((f) => f.type.startsWith('image/'));
          if (file) { e.preventDefault(); onUpload(file); return; }
          const html = e.clipboardData.getData('text/html');
          if (html) { e.preventDefault(); insertHtml(sanitizeSignatureHtml(html)); }
        }}
        onDrop={(e) => {
          const file = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith('image/'));
          if (file) { e.preventDefault(); onUpload(file); }
        }}
        className={cn('overflow-auto rounded-b-xl px-5 py-4 outline-none [&_a]:cursor-text [&_img]:cursor-pointer [&_img]:inline-block', source && 'hidden')}
        style={{ minHeight, background: '#ffffff', color: '#1f2328', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 13, lineHeight: 1.45 }}
      />
    </div>
  );
}

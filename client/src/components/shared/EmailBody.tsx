import { useEffect, useMemo, useRef, useState } from 'react';
import { splitQuotedHtml, stripQuoted } from '@lemlist/shared';

/**
 * Tracking pixels out. Opening an email in Sincerely should not tell a
 * newsletter's sender that it was read - the images people can see stay.
 */
function withoutTrackers(html: string): string {
  return html
    // 0 or 1 exactly - not the 1 in 100.
    .replace(/<img\b[^>]*\b(width|height)\s*=\s*["']?[01](px)?(?=["'\s>/])[^>]*>/gi, '')
    .replace(/<img\b[^>]*style\s*=\s*["'][^"']*(display\s*:\s*none|width\s*:\s*[01]px|height\s*:\s*[01]px)[^"']*["'][^>]*>/gi, '');
}

/** Plain text, with every URL shown as its site rather than 200 characters of tracking. */
function linkifiedText(text: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(text).replace(/https?:\/\/[^\s<"']+/g, (url) => {
    let host = url;
    try { host = new URL(url.replace(/&amp;/g, '&')).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${host}&nbsp;&#8599;</a>`;
  });
}

/* ─── Email HTML Renderer (sandboxed iframe) ──────────
   Renders received/sent email HTML in a sandboxed, self-sizing iframe so
   remote styles can't leak into the app. Shared by the Unibox and the
   contact page's conversation history. */
export function EmailBody({ html, text }: { html: string | null; text: string | null }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  // The history a reply quotes is folded away, like every mail client does:
  // what they wrote is the message; the rest is one click away.
  const [showQuoted, setShowQuoted] = useState(false);

  const parts = useMemo(() => {
    if (html) {
      const { main, quoted } = splitQuotedHtml(withoutTrackers(html));
      return { main, quoted, isHtml: true };
    }
    const { text: main, quoted } = stripQuoted(text || '');
    return { main: main || text || '', quoted: main ? quoted : '', isHtml: false };
  }, [html, text]);

  const srcDoc = useMemo(() => {
    let bodyContent: string;
    if (parts.isHtml) {
      bodyContent = showQuoted && parts.quoted ? parts.main + parts.quoted : parts.main;
    } else {
      const shown = showQuoted && parts.quoted ? `${parts.main}\n\n${parts.quoted}` : parts.main;
      bodyContent = `<div style="white-space:pre-wrap;">${linkifiedText(shown)}</div>`;
    }

    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
body {
  margin: 0;
  padding: 20px 24px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14.5px;
  line-height: 1.7;
  color: #1F2328;
  word-wrap: break-word;
  overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
  max-width: 680px;
}
img { max-width: 100%; height: auto; display: block; border-radius: 6px; }
a { color: #4F46E5; text-decoration: none; }
a:hover { text-decoration: underline; }
blockquote { margin: 10px 0; padding-left: 14px; border-left: 3px solid #E4E4EA; color: #6B7280; }
pre { white-space: pre-wrap; font-size: 13px; background: #F6F7F9; padding: 12px 14px; border-radius: 8px; }
table { border-collapse: collapse; max-width: 100%; }
hr { border: none; border-top: 1px solid #ECECEF; margin: 18px 0; }
p { margin: 0 0 13px; }
h1, h2, h3, h4 { margin: 0 0 10px; line-height: 1.35; }
</style><base target="_blank"></head><body>${bodyContent}</body></html>`;
  }, [parts, showQuoted]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const resize = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) {
          const h = doc.body.scrollHeight;
          if (h > 0) setHeight(h + 32);
        }
      } catch { /* cross-origin safety */ }
    };

    iframe.addEventListener('load', resize);
    const timer = setTimeout(resize, 500);

    return () => {
      iframe.removeEventListener('load', resize);
      clearTimeout(timer);
    };
  }, [srcDoc]);

  return (
    <>
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        // allow-popups: links open in a new tab (base target) instead of
        // doing nothing inside the sandbox. Still no scripts.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="w-full border-0"
        style={{ height: `${height}px`, minHeight: '60px' }}
        title="Email content"
      />
      {parts.quoted && (
        <button
          type="button"
          onClick={() => setShowQuoted((v) => !v)}
          className="ml-6 mb-3 inline-flex items-center gap-1 h-6 px-2 rounded-md bg-[var(--bg-elevated)] text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          title={showQuoted ? 'Hide the earlier messages this reply quotes' : 'Show the earlier messages this reply quotes'}
        >
          {showQuoted ? 'Hide quoted text' : '\u2022\u2022\u2022 Show quoted text'}
        </button>
      )}
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';

/* ─── Email HTML Renderer (sandboxed iframe) ──────────
   Renders received/sent email HTML in a sandboxed, self-sizing iframe so
   remote styles can't leak into the app. Shared by the Unibox and the
   contact page's conversation history. */
export function EmailBody({ html, text }: { html: string | null; text: string | null }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const srcDoc = useMemo(() => {
    let bodyContent: string;
    if (html) {
      bodyContent = html;
    } else {
      const escaped = (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      bodyContent = `<div style="white-space:pre-wrap;">${escaped}</div>`;
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
</style></head><body>${bodyContent}</body></html>`;
  }, [html, text]);

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
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      className="w-full border-0"
      style={{ height: `${height}px`, minHeight: '80px' }}
      title="Email content"
    />
  );
}

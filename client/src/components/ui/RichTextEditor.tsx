import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  Quote,
  Minus,
  Undo2,
  Redo2,
  FileText,
  ChevronDown,
  X,
} from 'lucide-react';

/* ─── Types ───────────────────────────────────── */
interface Template {
  id: string;
  name: string;
  subject: string;
  body_html: string;
}

interface RichTextEditorProps {
  initialContent?: string;
  placeholder?: string;
  onChange?: (html: string, text: string) => void;
  onTemplateSelect?: (template: Template) => void;
  templates?: Template[];
  minHeight?: string;
  autoFocus?: boolean;
}

/* ─── Toolbar Button ──────────────────────────── */
function ToolbarBtn({
  active,
  onClick,
  title,
  children,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
          : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
      } disabled:opacity-30 disabled:pointer-events-none`}
    >
      {children}
    </button>
  );
}

/* ─── Toolbar Separator ───────────────────────── */
function Sep() {
  return <div className="w-px h-5 bg-[var(--border-subtle)] mx-0.5" />;
}

/* ─── Link Input Popover ──────────────────────── */
function LinkPopover({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(editor.getAttributes('link').href || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const setLink = () => {
    if (!url.trim()) {
      (editor.chain().focus().extendMarkRange('link') as any).unsetLink().run();
    } else {
      const href = url.startsWith('http') ? url : `https://${url}`;
      (editor.chain().focus().extendMarkRange('link') as any).setLink({ href }).run();
    }
    onClose();
  };

  return (
    <div className="absolute top-full left-0 mt-1 z-50 flex items-center gap-1.5 p-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg shadow-lg">
      <input
        ref={inputRef}
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') setLink();
          if (e.key === 'Escape') onClose();
        }}
        placeholder="https://example.com"
        className="text-xs bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-[var(--text-primary)] outline-none w-52"
      />
      <button
        onClick={setLink}
        className="px-2 py-1.5 rounded bg-[var(--text-primary)] text-[var(--bg-app)] text-xs font-medium hover:opacity-90"
      >
        Apply
      </button>
      {editor.isActive('link') && (
        <button
          onClick={() => {
            (editor.chain().focus().extendMarkRange('link') as any).unsetLink().run();
            onClose();
          }}
          className="p-1.5 rounded hover:bg-[var(--bg-hover)]"
          title="Remove link"
        >
          <X className="h-3 w-3 text-[var(--text-tertiary)]" />
        </button>
      )}
    </div>
  );
}

/* ─── Template Picker ─────────────────────────── */
function TemplatePicker({
  templates,
  onSelect,
  onClose,
}: {
  templates: Template[];
  onSelect: (template: Template) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (templates.length === 0) {
    return (
      <div
        ref={ref}
        className="absolute top-full right-0 mt-1 z-50 p-4 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl shadow-xl w-64"
      >
        <p className="text-xs text-[var(--text-tertiary)] text-center">
          No templates yet. Create one in the Templates page.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1 z-50 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl shadow-xl w-72 max-h-64 overflow-y-auto"
    >
      <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
        <p className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          Insert Template
        </p>
      </div>
      {templates.map(t => (
        <button
          key={t.id}
          onClick={() => {
            onSelect(t);
            onClose();
          }}
          className="w-full text-left px-3 py-2.5 hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border-subtle)] last:border-0"
        >
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{t.name}</p>
          <p className="text-[11px] text-[var(--text-tertiary)] truncate mt-0.5">{t.subject}</p>
        </button>
      ))}
    </div>
  );
}

/* ─── Main Editor ─────────────────────────────── */
export function RichTextEditor({
  initialContent = '',
  placeholder = 'Write your message...',
  onChange,
  onTemplateSelect,
  templates,
  minHeight = '200px',
  autoFocus = false,
}: RichTextEditorProps) {
  const [showLink, setShowLink] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline as any,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-blue-600 dark:text-blue-400 underline cursor-pointer' },
      }) as any,
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent,
    autofocus: autoFocus,
    onUpdate: ({ editor: ed }) => {
      onChange?.(ed.getHTML(), ed.getText());
    },
    editorProps: {
      attributes: {
        class: 'outline-none prose prose-sm max-w-none text-[var(--text-primary)] px-4 py-3',
        style: `min-height: ${minHeight}`,
      },
    },
  });

  // Sync external content changes (e.g. template insertion clears & sets)
  const setContent = useCallback(
    (html: string) => {
      if (!editor) return;
      editor.commands.setContent(html);
      onChange?.(editor.getHTML(), editor.getText());
    },
    [editor, onChange],
  );

  // Update content when initialContent changes from outside
  useEffect(() => {
    if (editor && initialContent && !editor.getText().trim()) {
      editor.commands.setContent(initialContent);
    }
  }, [editor, initialContent]);

  // Listen for AI reply insertion events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.html && editor) {
        editor.commands.setContent(detail.html);
        onChange?.(editor.getHTML(), editor.getText());
      }
    };
    window.addEventListener('ai-reply-insert', handler);
    return () => window.removeEventListener('ai-reply-insert', handler);
  }, [editor, onChange]);

  if (!editor) return null;

  const insertTemplate = (template: Template) => {
    setContent(template.body_html);
    onTemplateSelect?.(template);
  };

  return (
    <div className="border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-surface)] overflow-hidden focus-within:border-[var(--text-primary)] transition-colors">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] flex-wrap relative">
        <ToolbarBtn
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive('underline')}
          onClick={() => (editor.chain().focus() as any).toggleUnderline().run()}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough"
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <Sep />

        <ToolbarBtn
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet List"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered List"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <Sep />

        <div className="relative">
          <ToolbarBtn
            active={editor.isActive('link') || showLink}
            onClick={() => setShowLink(!showLink)}
            title="Insert Link"
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </ToolbarBtn>
          {showLink && (
            <LinkPopover editor={editor} onClose={() => setShowLink(false)} />
          )}
        </div>
        <ToolbarBtn
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Blockquote"
        >
          <Quote className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Rule"
        >
          <Minus className="h-3.5 w-3.5" />
        </ToolbarBtn>

        <Sep />

        <ToolbarBtn
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </ToolbarBtn>

        {/* Template picker */}
        {templates && (
          <>
            <div className="flex-1" />
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTemplates(!showTemplates)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  showTemplates
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <FileText className="h-3 w-3" />
                Templates
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
              {showTemplates && (
                <TemplatePicker
                  templates={templates}
                  onSelect={insertTemplate}
                  onClose={() => setShowTemplates(false)}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Editor area */}
      <EditorContent editor={editor} />
    </div>
  );
}

/** Hook to get HTML + plain text from editor */
export function useRichTextEditorRef() {
  const [html, setHtml] = useState('');
  const [text, setText] = useState('');

  const handleChange = useCallback((newHtml: string, newText: string) => {
    setHtml(newHtml);
    setText(newText);
  }, []);

  return { html, text, handleChange, isEmpty: !text.trim() };
}

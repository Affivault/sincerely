/* ═══════════════════════════════════════════════════════════════════════
   The editor's shape, with none of its weight.

   Types erase at build time, so both sides of the lazy boundary can import
   this and neither pulls the other in. Keeping the props here rather than
   in the implementation is what lets the door describe the editor without
   loading it.
   ═══════════════════════════════════════════════════════════════════════ */

export interface Template {
  id: string;
  name: string;
  subject: string;
  body_html: string;
}

export interface RichTextEditorProps {
  initialContent?: string;
  placeholder?: string;
  /** Accessible name of the editable region. Defaults to "Email body"; say what this one is when it is not an email body. */
  label?: string;
  onChange?: (html: string, text: string) => void;
  onTemplateSelect?: (template: Template) => void;
  templates?: Template[];
  minHeight?: string;
  autoFocus?: boolean;
  /** Seamless variant: no outer border/background, transparent toolbar — lets a
      parent card own the framing (used by the Unibox reply composer). */
  bare?: boolean;
}

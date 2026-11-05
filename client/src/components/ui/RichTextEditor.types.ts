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
  /**
   * Put a short formatting toolbar in this element (a composer's action bar)
   * instead of a strip above the text. Pass the element once it exists; while
   * it is null no toolbar shows. Leave undefined for the usual top strip.
   */
  toolbarSlot?: HTMLElement | null;
  /** Padding of the writing area. Defaults to 'px-4 py-3'. */
  contentClassName?: string;
}

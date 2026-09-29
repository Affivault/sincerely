export interface AssetTemplateLayer {
  type: 'text' | 'image' | 'shape';
  x: number;
  y: number;
  width?: number;
  height?: number;
  content?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  color?: string;
  align?: 'left' | 'center' | 'right';
  src?: string;
  shape?: 'rectangle' | 'circle';
  fill?: string;
  borderRadius?: number;
  opacity?: number;
}

export interface AssetTemplate {
  id: string;
  user_id: string;
  name: string;
  width: number;
  height: number;
  background_color: string;
  layers: AssetTemplateLayer[];
  preview_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateAssetTemplateInput {
  name: string;
  width?: number;
  height?: number;
  background_color?: string;
  layers?: AssetTemplateLayer[];
}

export interface UpdateAssetTemplateInput extends Partial<CreateAssetTemplateInput> {}

export interface AssetRenderParams {
  [key: string]: string;
}

// ─── Email & Sequence Templates ──────────────────────────────────────

export type TemplateCategory =
  | 'cold_outreach'
  | 'follow_up'
  | 'introduction'
  | 'meeting_request'
  | 'nurture'
  | 're_engagement'
  | 'custom';

export const TEMPLATE_CATEGORIES: { value: TemplateCategory; label: string }[] = [
  { value: 'cold_outreach', label: 'Cold outreach' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'introduction', label: 'Introduction' },
  { value: 'meeting_request', label: 'Meeting request' },
  { value: 'nurture', label: 'Nurture' },
  { value: 're_engagement', label: 'Re-engagement' },
  { value: 'custom', label: 'Custom' },
];

export interface EmailTemplate {
  id: string;
  user_id: string | null;
  name: string;
  subject: string;
  body_html: string;
  category: TemplateCategory;
  tags: string[];
  is_preset: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailTemplateInput {
  name: string;
  subject: string;
  body_html: string;
  category?: TemplateCategory;
  tags?: string[];
}

export interface UpdateEmailTemplateInput extends Partial<CreateEmailTemplateInput> {}

export interface SequenceTemplateStep {
  step_order: number;
  subject: string;
  body_html: string;
  delay_days: number;
  delay_hours: number;
}

export interface SequenceTemplate {
  id: string;
  user_id: string | null;
  name: string;
  description: string;
  category: TemplateCategory;
  steps: SequenceTemplateStep[];
  tags: string[];
  is_preset: boolean;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSequenceTemplateInput {
  name: string;
  description: string;
  category?: TemplateCategory;
  steps: SequenceTemplateStep[];
  tags?: string[];
}

export interface UpdateSequenceTemplateInput extends Partial<CreateSequenceTemplateInput> {}

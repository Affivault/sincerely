import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { templateApi } from '../../api/template.api';
import { Skeleton } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { RichTextEditor } from '../../components/ui/RichTextEditor';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card } from '../../components/shared/Card';
import {
  Mail,
  Plus,
  Trash2,
  Copy,
  Pencil,
  Search,
  Layers,
  ChevronRight,
  Clock,
  Send,
  ArrowRight,
  Sparkles,
  Tag,
  Eye,
  Rocket,
  FileText,
  X,
  Check,
  MoreHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  EmailTemplate,
  SequenceTemplate,
  TemplateCategory,
  SequenceTemplateStep,
  CreateEmailTemplateInput,
  CreateSequenceTemplateInput,
} from '@lemlist/shared';
import { TEMPLATE_CATEGORIES } from '@lemlist/shared';
import { cn } from '../../lib/utils';

// ─── Email Preview Component ────────────────────────────────────────

function EmailPreview({ subject, bodyHtml, compact }: { subject: string; bodyHtml: string; compact?: boolean }) {
  const sampleData: Record<string, string> = {
    first_name: 'Alex',
    last_name: 'Johnson',
    company: 'Acme Inc',
    email: 'alex@acme.com',
    industry: 'SaaS',
    sender_name: 'Jordan',
    value_proposition: 'streamline your outreach',
    pain_point: 'low reply rates',
    result_achieved: '3x their response rates',
    key_benefit: 'close deals faster',
    reference_company: 'TechCorp',
    timeframe: '30 days',
    mutual_connection: 'Sarah from StartupX',
    topic: 'sales automation',
    sender_company: 'Sincerely',
  };

  const interpolate = (text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key) => sampleData[key] || `{{${key}}}`);

  return (
    <div className={`rounded-lg border border-[var(--border-subtle)] bg-white overflow-hidden ${compact ? '' : 'shadow-lg'}`}>
      {/* Email chrome */}
      <div className="bg-[#f8f9fa] border-b border-[#e5e7eb] px-4 py-2.5">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          </div>
        </div>
        <div className={`${compact ? 'text-[10px]' : 'text-xs'} text-[#6b7280] space-y-0.5`}>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#374151] w-10">From:</span>
            <span>{sampleData.sender_name}@yourcompany.com</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#374151] w-10">To:</span>
            <span>{sampleData.first_name}@{sampleData.company.toLowerCase().replace(/\s/g, '')}.com</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#374151] w-10 shrink-0">Subj:</span>
            <span className="font-medium text-[#111827] truncate">{interpolate(subject)}</span>
          </div>
        </div>
      </div>
      {/* Email body */}
      <div
        className={`${compact ? 'p-3 text-[11px] leading-relaxed max-h-[160px]' : 'p-5 text-sm leading-relaxed max-h-[400px]'} overflow-hidden text-[#374151]`}
        dangerouslySetInnerHTML={{ __html: interpolate(bodyHtml) }}
      />
      {compact && (
        <div className="h-8 bg-gradient-to-t from-[var(--bg-surface)] to-transparent -mt-8 relative z-10" />
      )}
    </div>
  );
}

// ─── Sequence Timeline ──────────────────────────────────────────────

function SequenceTimeline({ steps, compact }: { steps: SequenceTemplateStep[]; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-4'}>
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        const delay = step.delay_days > 0 ? `${step.delay_days}d` : step.delay_hours > 0 ? `${step.delay_hours}h` : '';
        return (
          <div key={idx} className="relative">
            {/* Connector */}
            {!isLast && (
              <div className={`absolute left-4 ${compact ? 'top-8 bottom-[-8px]' : 'top-10 bottom-[-16px]'} w-px bg-[var(--border-subtle)]`} />
            )}
            {/* Delay badge */}
            {idx > 0 && delay && (
              <div className={`flex items-center gap-2 ${compact ? 'mb-1 ml-9' : 'mb-2 ml-11'}`}>
                <Clock className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-amber-500`} />
                <span className={`${compact ? 'text-[10px]' : 'text-xs'} text-amber-500 font-medium`}>
                  Wait {step.delay_days > 0 ? `${step.delay_days} day${step.delay_days > 1 ? 's' : ''}` : `${step.delay_hours} hour${step.delay_hours > 1 ? 's' : ''}`}
                </span>
              </div>
            )}
            {/* Step card */}
            <div className="flex items-start gap-3">
              <div className={`shrink-0 ${compact ? 'w-8 h-8' : 'w-9 h-9'} rounded-full bg-[var(--bg-elevated)] border-2 border-[var(--border-subtle)] flex items-center justify-center z-10`}>
                <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-bold text-[var(--text-primary)]`}>{idx + 1}</span>
              </div>
              <div className={`flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] ${compact ? 'p-2.5' : 'p-3.5'} hover:bg-[var(--bg-hover)] transition-colors`}>
                <div className="flex items-center gap-2 mb-1">
                  <Mail className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-[var(--text-secondary)]`} />
                  <span className={`${compact ? 'text-[11px]' : 'text-sm'} font-medium text-[var(--text-primary)] truncate`}>
                    {step.subject || 'Untitled email'}
                  </span>
                </div>
                <p className={`${compact ? 'text-[10px] line-clamp-2' : 'text-xs line-clamp-3'} text-[var(--text-secondary)]`}>
                  {(() => {
                    const text = step.body_html.replace(/<[^>]*>/g, '');
                    const limit = compact ? 80 : 150;
                    return text.length > limit ? `${text.substring(0, limit)}...` : text;
                  })()}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Category Badge ─────────────────────────────────────────────────

const CATEGORY_COLORS: Record<TemplateCategory, string> = {
  cold_outreach: 'bg-blue-500/10 text-blue-500',
  follow_up: 'bg-amber-500/10 text-amber-500',
  introduction: 'bg-green-500/10 text-green-500',
  meeting_request: 'bg-purple-500/10 text-purple-500',
  nurture: 'bg-teal-500/10 text-teal-500',
  re_engagement: 'bg-rose-500/10 text-rose-500',
  custom: 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]',
};

function CategoryBadge({ category }: { category: TemplateCategory }) {
  const label = TEMPLATE_CATEGORIES.find(c => c.value === category)?.label || category;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full ${CATEGORY_COLORS[category]}`}>
      {label}
    </span>
  );
}

// ─── Library list row (master column) ───────────────────────────────

function TemplateListRow({ title, snippet, category, isPreset, meta, active, onClick }: {
  title: string;
  snippet: string;
  category: TemplateCategory;
  isPreset?: boolean;
  meta: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-[9px] border transition-colors',
        active
          ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)] shadow-[0_1px_2px_rgba(27,27,31,0.05)]'
          : 'border-transparent hover:bg-[var(--bg-hover)]'
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn('text-[13px] font-semibold truncate', active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
          {title}
        </span>
        {isPreset && (
          <Sparkles className="h-3 w-3 text-amber-500 flex-shrink-0" strokeWidth={2} />
        )}
      </div>
      <p className="mt-0.5 text-[11.5px] text-[var(--text-tertiary)] truncate">{snippet}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <CategoryBadge category={category} />
        <span className="text-[10.5px] text-[var(--text-muted)] tabular">{meta}</span>
      </div>
    </button>
  );
}

// ─── Detail pane (persistent preview + actions) ─────────────────────

function DetailShell({ title, category, isPreset, meta, onUse, onEdit, onDuplicate, onDelete, children }: {
  title: string;
  category: TemplateCategory;
  isPreset?: boolean;
  meta: React.ReactNode;
  onUse: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="panel overflow-hidden flex flex-col min-h-[540px]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)] tracking-[-0.015em] truncate">{title}</h2>
            <CategoryBadge category={category} />
            {isPreset && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-amber-600 dark:text-amber-400">
                <Sparkles className="h-3 w-3" /> Preset
              </span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-[var(--text-tertiary)]">{meta}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button className="btn-primary" onClick={onUse}>
            <Rocket className="h-3.5 w-3.5" /> Use in campaign
          </button>
          <button className="icon-btn" title="Edit" onClick={onEdit}><Pencil className="h-4 w-4" /></button>
          <button className="icon-btn" title="Duplicate" onClick={onDuplicate}><Copy className="h-4 w-4" /></button>
          {onDelete && (
            <button className="icon-btn hover:text-rose-500 hover:bg-rose-500/10" title="Delete" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5 bg-[var(--bg-muted)]">{children}</div>
    </div>
  );
}

// ─── Email Editor Modal ─────────────────────────────────────────────

function EmailEditorModal({
  isOpen,
  onClose,
  initial,
  onSave,
  saving,
}: {
  isOpen: boolean;
  onClose: () => void;
  initial?: Partial<CreateEmailTemplateInput>;
  onSave: (data: CreateEmailTemplateInput) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [subject, setSubject] = useState(initial?.subject || '');
  const [bodyHtml, setBodyHtml] = useState(initial?.body_html || '');
  const [category, setCategory] = useState<TemplateCategory>((initial?.category as TemplateCategory) || 'custom');
  const [showPreview, setShowPreview] = useState(true);

  const insertMergeTag = (tag: string) => {
    window.dispatchEvent(new CustomEvent('rte-insert-text', { detail: { text: `{{${tag}}}` } }));
  };

  const mergeTags = ['first_name', 'last_name', 'company', 'email', 'industry', 'title', 'sender_name'];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Email Template Editor" size="2xl">
      <div className="flex gap-4 min-h-[500px]">
        {/* Editor side */}
        <div className="flex-1 space-y-3 min-w-0">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Template Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Cold Intro v2" required />
            <div>
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as TemplateCategory)}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--indigo)]"
              >
                {TEMPLATE_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <Input label="Subject Line" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g., Quick question about {{company}}" required />

          <div>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">Email Body</label>
              <div className="flex items-center gap-1 flex-wrap justify-end">
                {mergeTags.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertMergeTag(tag)}
                    title={`Insert {{${tag}}}`}
                    className="px-1.5 py-0.5 text-[10px] font-data rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:bg-[var(--indigo-subtle)] transition-colors"
                  >
                    {`{{${tag}}}`}
                  </button>
                ))}
              </div>
            </div>
            <RichTextEditor
              initialContent={bodyHtml}
              onChange={(html) => setBodyHtml(html)}
              placeholder="Hi {{first_name}}, I noticed that {{company}} is…"
              minHeight="300px"
            />
            <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">
              Use the toolbar to format — no HTML needed. Insert merge tags above to personalise.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => onSave({ name, subject, body_html: bodyHtml, category })} disabled={saving || !name || !subject}>
              {saving ? 'Saving...' : 'Save Template'}
            </Button>
          </div>
        </div>

        {/* Preview side */}
        {showPreview && (
          <div className="w-[380px] shrink-0 sticky top-0 self-start space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Live Preview</span>
              <button onClick={() => setShowPreview(false)} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]">
                <X className="h-3 w-3" />
              </button>
            </div>
            <EmailPreview subject={subject || 'Your subject here'} bodyHtml={bodyHtml || '<p>Start writing your email...</p>'} />
          </div>
        )}

        {!showPreview && (
          <button
            onClick={() => setShowPreview(true)}
            className="shrink-0 w-10 flex flex-col items-center justify-center gap-1 border-l border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            <Eye className="h-4 w-4" />
            <span className="text-[9px] font-medium [writing-mode:vertical-lr]">Preview</span>
          </button>
        )}
      </div>
    </Modal>
  );
}

// ─── Sequence Editor Modal ──────────────────────────────────────────

function SequenceEditorModal({
  isOpen,
  onClose,
  initial,
  onSave,
  saving,
}: {
  isOpen: boolean;
  onClose: () => void;
  initial?: Partial<CreateSequenceTemplateInput>;
  onSave: (data: CreateSequenceTemplateInput) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [category, setCategory] = useState<TemplateCategory>((initial?.category as TemplateCategory) || 'cold_outreach');
  const [steps, setSteps] = useState<SequenceTemplateStep[]>(
    initial?.steps || [{ step_order: 1, subject: '', body_html: '', delay_days: 0, delay_hours: 0 }]
  );
  const [activeStep, setActiveStep] = useState(0);

  const updateStep = (idx: number, updates: Partial<SequenceTemplateStep>) => {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s));
  };

  const addStep = () => {
    setSteps(prev => [...prev, { step_order: prev.length + 1, subject: '', body_html: '', delay_days: 2, delay_hours: 0 }]);
    setActiveStep(steps.length);
  };

  const removeStep = (idx: number) => {
    if (steps.length <= 1) return;
    setSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_order: i + 1 })));
    if (activeStep >= steps.length - 1) setActiveStep(Math.max(0, steps.length - 2));
  };

  const current = steps[activeStep];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Campaign Sequence Editor" size="xl">
      <div className="flex gap-5 min-h-[520px]">
        {/* Left: sequence overview */}
        <div className="w-[200px] shrink-0 space-y-3">
          <Input label="Sequence Name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., 5-Step Outreach" required />
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as TemplateCategory)}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--indigo)]"
            >
              {TEMPLATE_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5 pt-2">
            <span className="text-[11px] font-medium text-[var(--text-tertiary)]">Steps</span>
            {steps.map((step, idx) => (
              <div key={idx}>
                {idx > 0 && (
                  <div className="flex items-center gap-1 ml-3.5 text-[10px] text-amber-500 my-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {step.delay_days}d {step.delay_hours}h
                  </div>
                )}
                <button
                  onClick={() => setActiveStep(idx)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                    activeStep === idx
                      ? 'bg-[rgba(99,102,241,0.08)] text-[var(--indigo)] font-medium'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <div className="w-5 h-5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0">
                    <span className="text-[9px] font-bold">{idx + 1}</span>
                  </div>
                  <span className="truncate">{step.subject || `Email ${idx + 1}`}</span>
                </button>
              </div>
            ))}
            <button
              onClick={addStep}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Step
            </button>
          </div>
        </div>

        {/* Right: step editor + preview */}
        {current && (
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                Step {activeStep + 1} of {steps.length}
              </h4>
              {steps.length > 1 && (
                <button onClick={() => removeStep(activeStep)} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                  <Trash2 className="h-3 w-3" /> Remove step
                </button>
              )}
            </div>

            {activeStep > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Delay (days)</label>
                  <input
                    type="number"
                    min={0}
                    value={current.delay_days}
                    onChange={e => updateStep(activeStep, { delay_days: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--indigo)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Delay (hours)</label>
                  <input
                    type="number"
                    min={0}
                    value={current.delay_hours}
                    onChange={e => updateStep(activeStep, { delay_hours: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--indigo)]"
                  />
                </div>
              </div>
            )}

            <Input label="Subject" value={current.subject} onChange={e => updateStep(activeStep, { subject: e.target.value })} placeholder="Email subject line" />

            <div>
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <label className="text-sm font-medium text-[var(--text-primary)]">Email Body</label>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {['first_name', 'company', 'sender_name'].map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => window.dispatchEvent(new CustomEvent('rte-insert-text', { detail: { text: `{{${tag}}}` } }))}
                      title={`Insert {{${tag}}}`}
                      className="px-1.5 py-0.5 text-[10px] font-data rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--indigo)] hover:bg-[var(--indigo-subtle)] transition-colors"
                    >
                      {`{{${tag}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <RichTextEditor
                key={activeStep}
                initialContent={current.body_html}
                onChange={(html) => updateStep(activeStep, { body_html: html })}
                placeholder="Hi {{first_name}}, …"
                minHeight="200px"
              />
            </div>

            {/* Inline preview */}
            <div className="space-y-1">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Preview</span>
              <EmailPreview subject={current.subject || 'Subject'} bodyHtml={current.body_html || '<p>...</p>'} compact />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)] mt-4">
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Brief description of this sequence..."
          rows={1}
          className="flex-1 mr-4 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)] resize-none"
        />
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave({ name, description, category, steps })} disabled={saving || !name || steps.length === 0}>
            {saving ? 'Saving...' : 'Save Sequence'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Detail bodies (persistent preview pane) ────────────────────────

function EmailDetailBody({ template }: { template: EmailTemplate }) {
  return (
    <div className="max-w-[680px] mx-auto space-y-3">
      {template.tags && template.tags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {template.tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
              <Tag className="h-2.5 w-2.5" /> {tag}
            </span>
          ))}
        </div>
      )}
      <EmailPreview subject={template.subject} bodyHtml={template.body_html} />
      <p className="text-[11.5px] text-[var(--text-muted)] text-center">
        Merge tags like {'{{first_name}}'} render with sample data in this preview.
      </p>
    </div>
  );
}

function SequenceDetailBody({ template }: { template: SequenceTemplate }) {
  const [activeStep, setActiveStep] = useState(0);
  const steps = (template.steps || []) as SequenceTemplateStep[];
  if (steps.length === 0) {
    return <p className="text-[13px] text-[var(--text-tertiary)] text-center py-12">This sequence has no steps yet — hit Edit to add some.</p>;
  }
  const idx = Math.min(activeStep, steps.length - 1);
  const step = steps[idx];
  const totalDays = steps.reduce((s, st) => s + (st.delay_days || 0), 0);

  return (
    <div className="flex gap-5">
      {/* Step rail */}
      <div className="w-[240px] shrink-0">
        {template.description && (
          <p className="text-[12.5px] text-[var(--text-secondary)] mb-1.5">{template.description}</p>
        )}
        <p className="text-[11px] text-[var(--text-tertiary)] mb-3 tabular">
          {steps.length} email{steps.length === 1 ? '' : 's'} · {totalDays} day{totalDays === 1 ? '' : 's'} total
        </p>
        <div className="space-y-1">
          {steps.map((st, i) => (
            <div key={i}>
              {i > 0 && st.delay_days > 0 && (
                <div className="flex items-center gap-1 ml-4 text-[10px] text-amber-500 my-1">
                  <Clock className="h-2.5 w-2.5" /> Wait {st.delay_days}d
                </div>
              )}
              <button
                onClick={() => setActiveStep(i)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 rounded-[9px] text-left border transition-colors',
                  idx === i
                    ? 'bg-[var(--bg-surface)] border-[var(--border-subtle)] shadow-[0_1px_2px_rgba(27,27,31,0.05)]'
                    : 'border-transparent hover:bg-[var(--bg-hover)]'
                )}
              >
                <span className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold',
                  idx === i ? 'bg-[var(--indigo)] text-white' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                )}>
                  {i + 1}
                </span>
                <span className={cn('text-[12px] font-medium truncate', idx === i ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}>
                  {st.subject || `Email ${i + 1}`}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Step preview */}
      <div className="flex-1 min-w-0">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-medium text-[var(--text-secondary)] tabular">Email {idx + 1} of {steps.length}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setActiveStep(Math.max(0, idx - 1))}
              disabled={idx === 0}
              className="icon-btn disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
            </button>
            <button
              onClick={() => setActiveStep(Math.min(steps.length - 1, idx + 1))}
              disabled={idx === steps.length - 1}
              className="icon-btn disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
        <EmailPreview subject={step.subject || ''} bodyHtml={step.body_html || ''} />
      </div>
    </div>
  );
}

// ─── Main Templates Page — library rail + persistent detail pane ────

export function TemplatesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'emails' | 'sequences'>('emails');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Editor modals (feature-complete; the page around them was rebuilt)
  const [showEmailEditor, setShowEmailEditor] = useState(false);
  const [showSequenceEditor, setShowSequenceEditor] = useState(false);
  const [editEmailData, setEditEmailData] = useState<{ id?: string; initial?: Partial<CreateEmailTemplateInput> } | null>(null);
  const [editSequenceData, setEditSequenceData] = useState<{ id?: string; initial?: Partial<CreateSequenceTemplateInput> } | null>(null);

  // Queries
  const { data: emailTemplates, isLoading: loadingEmails } = useQuery({
    queryKey: ['email-templates'],
    queryFn: templateApi.listEmails,
  });
  const { data: sequenceTemplates, isLoading: loadingSequences } = useQuery({
    queryKey: ['sequence-templates'],
    queryFn: templateApi.listSequences,
  });
  const { data: presets } = useQuery({
    queryKey: ['template-presets'],
    queryFn: templateApi.getPresets,
  });

  // Mutations
  const createEmailMut = useMutation({
    mutationFn: (input: CreateEmailTemplateInput) =>
      editEmailData?.id
        ? templateApi.updateEmail(editEmailData.id, input)
        : templateApi.createEmail(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      toast.success(editEmailData?.id ? 'Template updated' : 'Template created');
      setShowEmailEditor(false);
      setEditEmailData(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const createSequenceMut = useMutation({
    mutationFn: (input: CreateSequenceTemplateInput) =>
      editSequenceData?.id
        ? templateApi.updateSequence(editSequenceData.id, input)
        : templateApi.createSequence(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sequence-templates'] });
      toast.success(editSequenceData?.id ? 'Sequence updated' : 'Sequence created');
      setShowSequenceEditor(false);
      setEditSequenceData(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const deleteEmailMut = useMutation({
    mutationFn: templateApi.deleteEmail,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['email-templates'] }); toast.success('Deleted'); setSelectedId(null); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to delete'),
  });
  const duplicateEmailMut = useMutation({
    mutationFn: templateApi.duplicateEmail,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['email-templates'] }); toast.success('Duplicated'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to duplicate'),
  });
  const deleteSequenceMut = useMutation({
    mutationFn: templateApi.deleteSequence,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sequence-templates'] }); toast.success('Deleted'); setSelectedId(null); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to delete'),
  });
  const duplicateSequenceMut = useMutation({
    mutationFn: templateApi.duplicateSequence,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sequence-templates'] }); toast.success('Duplicated'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to duplicate'),
  });

  // Filtering (same rules as before: category + name/subject/description search)
  const filteredEmails = useMemo(() => {
    if (!emailTemplates) return [];
    return emailTemplates.filter(t => {
      if (activeCategory !== 'all' && t.category !== activeCategory) return false;
      if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.subject.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [emailTemplates, activeCategory, search]);

  const filteredSequences = useMemo(() => {
    if (!sequenceTemplates) return [];
    return sequenceTemplates.filter(t => {
      if (activeCategory !== 'all' && t.category !== activeCategory) return false;
      if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !(t.description || '').toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [sequenceTemplates, activeCategory, search]);

  // Keep a valid selection: fall back to the first visible row of the tab.
  const visibleRows = tab === 'emails' ? filteredEmails : filteredSequences;
  const selectedEmail = tab === 'emails' ? filteredEmails.find(t => t.id === selectedId) : undefined;
  const selectedSequence = tab === 'sequences' ? filteredSequences.find(t => t.id === selectedId) : undefined;
  const selection = selectedEmail || selectedSequence || visibleRows[0];
  const effectiveId = selection?.id ?? null;

  // Use template in campaign (unchanged behavior)
  const handleUseEmail = (template: EmailTemplate) => {
    navigate('/campaigns/new', { state: { templateEmail: template } });
  };
  const handleUseSequence = (template: SequenceTemplate) => {
    navigate('/campaigns/new', { state: { templateSequence: template } });
  };

  const openCreate = () => {
    if (tab === 'emails') { setEditEmailData(null); setShowEmailEditor(true); }
    else { setEditSequenceData(null); setShowSequenceEditor(true); }
  };

  const isLoading = tab === 'emails' ? loadingEmails : loadingSequences;
  const isEmpty = tab === 'emails' ? (!emailTemplates || emailTemplates.length === 0) : (!sequenceTemplates || sequenceTemplates.length === 0);
  const hasPresets = !!presets && ((tab === 'emails' && (presets.emails?.length ?? 0) > 0) || (tab === 'sequences' && (presets.sequences?.length ?? 0) > 0));

  const relTime = (iso?: string) => {
    if (!iso) return '';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days < 1) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div>
      <PageHeader
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <FileText className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Templates"
        description="Your library of reusable emails and full campaign sequences — previewed live, one click from a campaign."
        meta={
          <>
            {emailTemplates && <span className="tabular">{emailTemplates.length} email{emailTemplates.length === 1 ? '' : 's'}</span>}
            {sequenceTemplates && <span className="sep-dot" />}
            {sequenceTemplates && <span className="tabular">{sequenceTemplates.length} sequence{sequenceTemplates.length === 1 ? '' : 's'}</span>}
          </>
        }
        actions={
          <button className="btn-primary" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> New {tab === 'emails' ? 'email template' : 'sequence'}
          </button>
        }
      />

      <div className="flex gap-4 items-start">
        {/* ── Library rail ── */}
        <aside className="w-[300px] flex-shrink-0 space-y-3">
          {/* Type tabs */}
          <div className="flex items-center p-0.5 rounded-[9px] bg-[var(--bg-elevated)]">
            {([
              { key: 'emails' as const, label: 'Emails', icon: Mail, count: emailTemplates?.length ?? 0 },
              { key: 'sequences' as const, label: 'Sequences', icon: Layers, count: sequenceTemplates?.length ?? 0 },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setSelectedId(null); }}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 h-8 rounded-[7px] text-[12.5px] font-medium transition-all',
                  tab === t.key
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                )}
              >
                <t.icon className="h-3.5 w-3.5" /> {t.label}
                <span className="text-[10.5px] tabular text-[var(--text-muted)]">{t.count}</span>
              </button>
            ))}
          </div>

          {/* Search + category */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${tab}…`}
                className="input-field pl-8"
              />
            </div>
            <select
              value={activeCategory}
              onChange={e => setActiveCategory(e.target.value as TemplateCategory | 'all')}
              className="input-field cursor-pointer"
            >
              <option value="all">All categories</option>
              {TEMPLATE_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Rows */}
          <div className="space-y-1 max-h-[calc(100vh-330px)] overflow-y-auto pr-0.5 -mr-0.5">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-3 py-2.5 space-y-2">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-2.5 w-full" />
                  <Skeleton className="h-4 w-24 rounded-full" />
                </div>
              ))
            ) : visibleRows.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <p className="text-[12.5px] text-[var(--text-tertiary)]">
                  {isEmpty ? `No ${tab} yet.` : 'Nothing matches your filters.'}
                </p>
                {isEmpty && (
                  <button className="btn-secondary mx-auto mt-3" onClick={openCreate}>
                    <Plus className="h-3.5 w-3.5" /> Create your first
                  </button>
                )}
              </div>
            ) : tab === 'emails' ? (
              filteredEmails.map(t => (
                <TemplateListRow
                  key={t.id}
                  title={t.name}
                  snippet={t.subject}
                  category={t.category}
                  isPreset={t.is_preset}
                  meta={relTime(t.updated_at || t.created_at)}
                  active={effectiveId === t.id}
                  onClick={() => setSelectedId(t.id)}
                />
              ))
            ) : (
              filteredSequences.map(t => {
                const steps = (t.steps || []) as SequenceTemplateStep[];
                return (
                  <TemplateListRow
                    key={t.id}
                    title={t.name}
                    snippet={t.description || `${steps.length} steps`}
                    category={t.category}
                    isPreset={t.is_preset}
                    meta={`${steps.length} emails · ${relTime(t.updated_at || t.created_at)}`}
                    active={effectiveId === t.id}
                    onClick={() => setSelectedId(t.id)}
                  />
                );
              })
            )}
          </div>
        </aside>

        {/* ── Detail pane ── */}
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="panel p-5 space-y-4 min-h-[540px]">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-[380px] w-full rounded-lg" />
            </div>
          ) : selectedEmail || (tab === 'emails' && selection) ? (
            (() => {
              const t = (selectedEmail || selection) as EmailTemplate;
              return (
                <DetailShell
                  title={t.name}
                  category={t.category}
                  isPreset={t.is_preset}
                  meta={<>Updated {relTime(t.updated_at || t.created_at)}</>}
                  onUse={() => handleUseEmail(t)}
                  onEdit={() => { setEditEmailData({ id: t.id, initial: t }); setShowEmailEditor(true); }}
                  onDuplicate={() => duplicateEmailMut.mutate(t.id)}
                  onDelete={t.is_preset ? undefined : () => { if (confirm('Delete this template?')) deleteEmailMut.mutate(t.id); }}
                >
                  <EmailDetailBody key={t.id} template={t} />
                </DetailShell>
              );
            })()
          ) : selectedSequence || (tab === 'sequences' && selection) ? (
            (() => {
              const t = (selectedSequence || selection) as SequenceTemplate;
              return (
                <DetailShell
                  title={t.name}
                  category={t.category}
                  isPreset={t.is_preset}
                  meta={<>Updated {relTime(t.updated_at || t.created_at)}</>}
                  onUse={() => handleUseSequence(t)}
                  onEdit={() => {
                    setEditSequenceData({
                      id: t.id,
                      initial: { ...t, steps: t.steps as SequenceTemplateStep[] },
                    });
                    setShowSequenceEditor(true);
                  }}
                  onDuplicate={() => duplicateSequenceMut.mutate(t.id)}
                  onDelete={t.is_preset ? undefined : () => { if (confirm('Delete this sequence?')) deleteSequenceMut.mutate(t.id); }}
                >
                  <SequenceDetailBody key={t.id} template={t} />
                </DetailShell>
              );
            })()
          ) : (
            <div className="panel min-h-[540px] flex flex-col items-center justify-center text-center p-8">
              {isEmpty && hasPresets ? (
                <>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] mb-3">
                    <Sparkles className="h-5 w-5 text-[var(--indigo)]" />
                  </span>
                  <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">Start from a proven {tab === 'emails' ? 'template' : 'sequence'}</h3>
                  <p className="mt-1.5 text-[13px] text-[var(--text-secondary)] max-w-[380px]">
                    {(tab === 'emails' ? presets?.emails?.length : presets?.sequences?.length) ?? 0} preset {tab} ship with your library — pick one from the list, duplicate it, and make it yours.
                  </p>
                  <button className="btn-primary mt-4" onClick={openCreate}>
                    <Plus className="h-3.5 w-3.5" /> Or create from scratch
                  </button>
                </>
              ) : (
                <>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-elevated)] mb-3">
                    <FileText className="h-5 w-5 text-[var(--text-tertiary)]" />
                  </span>
                  <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">No {tab} yet</h3>
                  <p className="mt-1.5 text-[13px] text-[var(--text-secondary)] max-w-[360px]">
                    Build reusable {tab === 'emails' ? 'emails' : 'multi-step sequences'} once and drop them into any campaign.
                  </p>
                  <button className="btn-primary mt-4" onClick={openCreate}>
                    <Plus className="h-3.5 w-3.5" /> New {tab === 'emails' ? 'email template' : 'sequence'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Email Editor Modal */}
      {showEmailEditor && (
        <EmailEditorModal
          isOpen={showEmailEditor}
          onClose={() => { setShowEmailEditor(false); setEditEmailData(null); }}
          initial={editEmailData?.initial}
          onSave={data => createEmailMut.mutate(data)}
          saving={createEmailMut.isPending}
        />
      )}

      {/* Sequence Editor Modal */}
      {showSequenceEditor && (
        <SequenceEditorModal
          isOpen={showSequenceEditor}
          onClose={() => { setShowSequenceEditor(false); setEditSequenceData(null); }}
          initial={editSequenceData?.initial}
          onSave={data => createSequenceMut.mutate(data)}
          saving={createSequenceMut.isPending}
        />
      )}
    </div>
  );
}

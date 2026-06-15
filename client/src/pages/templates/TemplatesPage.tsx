import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { templateApi } from '../../api/template.api';
import { Skeleton } from '../../components/ui/Skeleton';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
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
    sender_company: 'SkySend',
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
                  {step.body_html.replace(/<[^>]*>/g, '').substring(0, compact ? 80 : 150)}...
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
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wider ${CATEGORY_COLORS[category]}`}>
      {label}
    </span>
  );
}

// ─── Email Template Card ────────────────────────────────────────────

function EmailCard({
  template,
  onPreview,
  onEdit,
  onDuplicate,
  onDelete,
  onUse,
}: {
  template: EmailTemplate;
  onPreview: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUse: () => void;
}) {
  const [showActions, setShowActions] = useState(false);

  return (
    <div className="group relative rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden hover:border-[var(--text-tertiary)] transition-all hover:shadow-lg hover:shadow-black/5">
      {/* Preview thumbnail */}
      <div className="relative cursor-pointer" onClick={onPreview}>
        <div className="p-3 pb-0">
          <EmailPreview subject={template.subject} bodyHtml={template.body_html} compact />
        </div>
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onPreview(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-xs font-medium text-gray-900 hover:bg-gray-100 transition-colors shadow-lg"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onUse(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-xs font-medium text-gray-900 hover:bg-gray-100 transition-colors shadow-lg"
            >
              <Rocket className="h-3.5 w-3.5" />
              Use
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 pt-2.5 border-t border-[var(--border-subtle)] mt-2">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{template.name}</h3>
          <div className="relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {showActions && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowActions(false)} />
                <div className="absolute right-0 top-7 z-50 w-36 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl py-1">
                  <button onClick={() => { onEdit(); setShowActions(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button onClick={() => { onDuplicate(); setShowActions(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                    <Copy className="h-3 w-3" /> Duplicate
                  </button>
                  {!template.is_preset && (
                    <button onClick={() => { onDelete(); setShowActions(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10">
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CategoryBadge category={template.category} />
          {template.is_preset && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-500">
              <Sparkles className="h-2.5 w-2.5" /> Preset
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sequence Template Card ─────────────────────────────────────────

function SequenceCard({
  template,
  onPreview,
  onEdit,
  onDuplicate,
  onDelete,
  onUse,
}: {
  template: SequenceTemplate;
  onPreview: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUse: () => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const steps = (template.steps || []) as SequenceTemplateStep[];
  const totalDays = steps.reduce((sum, s) => sum + (s.delay_days || 0), 0);

  return (
    <div className="group relative rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden hover:border-[var(--text-tertiary)] transition-all hover:shadow-lg hover:shadow-black/5">
      {/* Sequence preview */}
      <div className="relative cursor-pointer p-4" onClick={onPreview}>
        <SequenceTimeline steps={steps} compact />
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-t-xl">
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onPreview(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-xs font-medium text-gray-900 hover:bg-gray-100 transition-colors shadow-lg"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onUse(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-xs font-medium text-gray-900 hover:bg-gray-100 transition-colors shadow-lg"
            >
              <Rocket className="h-3.5 w-3.5" />
              Use
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 pt-2.5 border-t border-[var(--border-subtle)]">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{template.name}</h3>
          <div className="relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {showActions && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowActions(false)} />
                <div className="absolute right-0 top-7 z-50 w-36 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl py-1">
                  <button onClick={() => { onEdit(); setShowActions(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button onClick={() => { onDuplicate(); setShowActions(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">
                    <Copy className="h-3 w-3" /> Duplicate
                  </button>
                  {!template.is_preset && (
                    <button onClick={() => { onDelete(); setShowActions(false); }} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10">
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mb-2">{template.description}</p>
        <div className="flex items-center gap-3">
          <CategoryBadge category={template.category} />
          <span className="text-[10px] text-[var(--text-tertiary)] font-medium">
            {steps.length} emails &middot; {totalDays} days
          </span>
          {template.is_preset && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-500">
              <Sparkles className="h-2.5 w-2.5" /> Preset
            </span>
          )}
        </div>
      </div>
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
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const insertMergeTag = (tag: string) => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newVal = bodyHtml.substring(0, start) + `{{${tag}}}` + bodyHtml.substring(end);
    setBodyHtml(newVal);
    setTimeout(() => {
      el.focus();
      const pos = start + tag.length + 4;
      el.setSelectionRange(pos, pos);
    }, 0);
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-[var(--text-primary)]">Email Body</label>
              <div className="flex items-center gap-1">
                {mergeTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => insertMergeTag(tag)}
                    className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    {`{{${tag}}}`}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              ref={bodyRef}
              value={bodyHtml}
              onChange={e => setBodyHtml(e.target.value)}
              placeholder="<p>Hi {{first_name}},</p>\n\n<p>Your message here...</p>"
              rows={14}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] font-mono placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)] resize-none"
            />
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
              <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Live Preview</span>
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
            <span className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">Steps</span>
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
              <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Body (HTML)</label>
              <textarea
                value={current.body_html}
                onChange={e => updateStep(activeStep, { body_html: e.target.value })}
                placeholder="<p>Hi {{first_name}},</p>"
                rows={8}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] font-mono placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--text-primary)] resize-none"
              />
            </div>

            {/* Inline preview */}
            <div className="space-y-1">
              <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Preview</span>
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

// ─── Full Preview Modal ─────────────────────────────────────────────

function PreviewModal({
  isOpen,
  onClose,
  type,
  emailTemplate,
  sequenceTemplate,
}: {
  isOpen: boolean;
  onClose: () => void;
  type: 'email' | 'sequence';
  emailTemplate?: EmailTemplate;
  sequenceTemplate?: SequenceTemplate;
}) {
  const [activeStep, setActiveStep] = useState(0);
  const steps = sequenceTemplate?.steps as SequenceTemplateStep[] | undefined;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={type === 'email' ? emailTemplate?.name || 'Email Preview' : sequenceTemplate?.name || 'Sequence Preview'} size="xl">
      {type === 'email' && emailTemplate && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <CategoryBadge category={emailTemplate.category} />
            {emailTemplate.tags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] rounded-full bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
                <Tag className="h-2.5 w-2.5" /> {tag}
              </span>
            ))}
          </div>
          <EmailPreview subject={emailTemplate.subject} bodyHtml={emailTemplate.body_html} />
        </div>
      )}

      {type === 'sequence' && sequenceTemplate && steps && (
        <div className="flex gap-4">
          {/* Timeline */}
          <div className="w-[240px] shrink-0">
            <div className="mb-3">
              <p className="text-sm text-[var(--text-secondary)]">{sequenceTemplate.description}</p>
              <div className="flex items-center gap-2 mt-2">
                <CategoryBadge category={sequenceTemplate.category} />
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  {steps.length} emails &middot; {steps.reduce((s, st) => s + st.delay_days, 0)} days
                </span>
              </div>
            </div>
            <div className="space-y-1">
              {steps.map((step, idx) => (
                <div key={idx}>
                  {idx > 0 && step.delay_days > 0 && (
                    <div className="flex items-center gap-1 ml-4 text-[10px] text-amber-500 my-1">
                      <Clock className="h-2.5 w-2.5" /> Wait {step.delay_days}d
                    </div>
                  )}
                  <button
                    onClick={() => setActiveStep(idx)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      activeStep === idx
                        ? 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)]'
                        : 'hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                      activeStep === idx
                        ? 'bg-[var(--indigo)] text-white'
                        : 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)]'
                    }`}>
                      <span className="text-[10px] font-bold">{idx + 1}</span>
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-medium truncate ${activeStep === idx ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                        {step.subject || `Email ${idx + 1}`}
                      </p>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                Email {activeStep + 1} of {steps.length}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
                  disabled={activeStep === 0}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4 rotate-180" />
                </button>
                <button
                  onClick={() => setActiveStep(Math.min(steps.length - 1, activeStep + 1))}
                  disabled={activeStep === steps.length - 1}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <EmailPreview subject={steps[activeStep].subject} bodyHtml={steps[activeStep].body_html} />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Main Templates Page ────────────────────────────────────────────

export function TemplatesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'emails' | 'sequences'>('emails');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'all'>('all');

  // Modals
  const [showEmailEditor, setShowEmailEditor] = useState(false);
  const [showSequenceEditor, setShowSequenceEditor] = useState(false);
  const [editEmailData, setEditEmailData] = useState<{ id?: string; initial?: Partial<CreateEmailTemplateInput> } | null>(null);
  const [editSequenceData, setEditSequenceData] = useState<{ id?: string; initial?: Partial<CreateSequenceTemplateInput> } | null>(null);
  const [previewData, setPreviewData] = useState<{
    type: 'email' | 'sequence';
    email?: EmailTemplate;
    sequence?: SequenceTemplate;
  } | null>(null);

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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['email-templates'] }); toast.success('Deleted'); },
  });

  const duplicateEmailMut = useMutation({
    mutationFn: templateApi.duplicateEmail,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['email-templates'] }); toast.success('Duplicated'); },
  });

  const deleteSequenceMut = useMutation({
    mutationFn: templateApi.deleteSequence,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sequence-templates'] }); toast.success('Deleted'); },
  });

  const duplicateSequenceMut = useMutation({
    mutationFn: templateApi.duplicateSequence,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sequence-templates'] }); toast.success('Duplicated'); },
  });

  // Filtering
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
      if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [sequenceTemplates, activeCategory, search]);

  // Use template in campaign
  const handleUseEmail = (template: EmailTemplate) => {
    navigate('/campaigns/new', { state: { templateEmail: template } });
  };

  const handleUseSequence = (template: SequenceTemplate) => {
    navigate('/campaigns/new', { state: { templateSequence: template } });
  };

  const isLoading = tab === 'emails' ? loadingEmails : loadingSequences;
  const hasPresets = presets && ((tab === 'emails' && presets.emails.length > 0) || (tab === 'sequences' && presets.sequences.length > 0));
  const isEmpty = tab === 'emails' ? (!emailTemplates || emailTemplates.length === 0) : (!sequenceTemplates || sequenceTemplates.length === 0);

  return (
    <div>
      {/* Page header */}
      <PageHeader
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <FileText className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Templates library"
        description="Build, preview and reuse email templates and full campaign sequences."
        meta={
          <>
            {emailTemplates && <span className="tabular">{emailTemplates.length} emails</span>}
            <span className="sep-dot" />
            {sequenceTemplates && <span className="tabular">{sequenceTemplates.length} sequences</span>}
          </>
        }
        actions={
          tab === 'emails' ? (
            <Button size="sm" onClick={() => { setEditEmailData(null); setShowEmailEditor(true); }}>
              <Plus className="h-3.5 w-3.5" /> New email template
            </Button>
          ) : (
            <Button size="sm" onClick={() => { setEditSequenceData(null); setShowSequenceEditor(true); }}>
              <Plus className="h-3.5 w-3.5" /> New sequence
            </Button>
          )
        }
      />

      {/* Tab segmented control + search + category chips */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5">
          <button
            onClick={() => setTab('emails')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 h-7 rounded-md text-[12px] font-medium transition-all',
              tab === 'emails'
                ? 'bg-[var(--bg-surface)] text-[var(--indigo)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            )}
          >
            <Mail className="h-3.5 w-3.5" />
            Emails
            {emailTemplates && <span className="ml-0.5 text-[10.5px] tabular text-[var(--text-tertiary)]">{emailTemplates.length}</span>}
          </button>
          <button
            onClick={() => setTab('sequences')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 h-7 rounded-md text-[12px] font-medium transition-all',
              tab === 'sequences'
                ? 'bg-[var(--bg-surface)] text-[var(--indigo)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            Sequences
            {sequenceTemplates && <span className="ml-0.5 text-[10.5px] tabular text-[var(--text-tertiary)]">{sequenceTemplates.length}</span>}
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'emails' ? 'Search emails…' : 'Search sequences…'}
            className="h-7 pl-8 pr-3 text-[12.5px] rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[rgba(91,91,245,0.4)] focus:shadow-[0_0_0_3px_rgba(91,91,245,0.12)] focus:bg-[var(--bg-surface)] transition w-48"
          />
        </div>

        <div className="flex items-center gap-1 flex-wrap ml-auto">
          <button
            onClick={() => setActiveCategory('all')}
            className={cn(
              'px-2.5 h-7 rounded-md text-[11.5px] font-medium transition-all',
              activeCategory === 'all'
                ? 'bg-[var(--indigo)] text-white shadow-[0_1px_3px_rgba(91,91,245,0.3)]'
                : 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            All
          </button>
          {TEMPLATE_CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={cn(
                'px-2.5 h-7 rounded-md text-[11.5px] font-medium transition-all',
                activeCategory === cat.value
                  ? 'bg-[var(--indigo)] text-white shadow-[0_1px_3px_rgba(91,91,245,0.3)]'
                  : 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className={cn(
          'grid gap-4',
          tab === 'emails' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 lg:grid-cols-2'
        )}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3"
              style={{ minHeight: tab === 'emails' ? 240 : 280 }}
            >
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-4 w-14 rounded-full" />
              </div>
              <Skeleton className="h-2.5 w-3/4" />
              <div className="pt-2 space-y-2">
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="h-2.5 w-5/6" />
                <Skeleton className="h-2.5 w-2/3" />
              </div>
              <div className="flex items-center gap-2 pt-3">
                <Skeleton className="h-7 w-20 rounded-lg" />
                <Skeleton className="h-7 w-7 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Preset banner for empty state */}
          {isEmpty && hasPresets && (
            <Card variant="premium" padding="md" className="mb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--indigo-subtle)] flex items-center justify-center shrink-0 border border-[rgba(91,91,245,0.18)]">
                  <Sparkles className="h-4 w-4 text-[var(--indigo)]" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold text-[var(--text-primary)] tracking-[-0.005em]">
                    Get started with preset {tab === 'emails' ? 'emails' : 'sequences'}
                  </h3>
                  <p className="text-[12.5px] text-[var(--text-secondary)] mt-1">
                    We've crafted {tab === 'emails' ? presets!.emails.length : presets!.sequences.length} battle-tested
                    {' '}{tab === 'emails' ? 'email templates' : 'campaign sequences'} used by top performers. Save any preset and customise it.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Email templates grid */}
          {tab === 'emails' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredEmails.map(template => (
                <EmailCard
                  key={template.id}
                  template={template}
                  onPreview={() => setPreviewData({ type: 'email', email: template })}
                  onEdit={() => {
                    setEditEmailData({ id: template.id, initial: template });
                    setShowEmailEditor(true);
                  }}
                  onDuplicate={() => duplicateEmailMut.mutate(template.id)}
                  onDelete={() => { if (confirm('Delete this template?')) deleteEmailMut.mutate(template.id); }}
                  onUse={() => handleUseEmail(template)}
                />
              ))}
              {/* Create new card */}
              <button
                onClick={() => { setEditEmailData(null); setShowEmailEditor(true); }}
                className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-6 flex flex-col items-center justify-center gap-2 hover:border-[rgba(91,91,245,0.35)] hover:bg-[rgba(91,91,245,0.03)] transition-all group min-h-[240px]"
              >
                <div className="w-9 h-9 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center group-hover:border-[rgba(91,91,245,0.18)] group-hover:bg-[var(--indigo-subtle)] transition-colors">
                  <Plus className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[var(--indigo)] transition-colors" />
                </div>
                <div className="text-center">
                  <p className="text-[12.5px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">Create template</p>
                  <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">Start from scratch</p>
                </div>
              </button>
            </div>
          )}

          {/* Sequence templates grid */}
          {tab === 'sequences' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredSequences.map(template => (
                <SequenceCard
                  key={template.id}
                  template={template}
                  onPreview={() => setPreviewData({ type: 'sequence', sequence: template })}
                  onEdit={() => {
                    setEditSequenceData({
                      id: template.id,
                      initial: {
                        name: template.name,
                        description: template.description,
                        category: template.category,
                        steps: template.steps as SequenceTemplateStep[],
                      },
                    });
                    setShowSequenceEditor(true);
                  }}
                  onDuplicate={() => duplicateSequenceMut.mutate(template.id)}
                  onDelete={() => { if (confirm('Delete this sequence?')) deleteSequenceMut.mutate(template.id); }}
                  onUse={() => handleUseSequence(template)}
                />
              ))}
              {/* Create new card */}
              <button
                onClick={() => { setEditSequenceData(null); setShowSequenceEditor(true); }}
                className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-6 flex flex-col items-center justify-center gap-2 hover:border-[rgba(91,91,245,0.35)] hover:bg-[rgba(91,91,245,0.03)] transition-all group min-h-[280px]"
              >
                <div className="w-9 h-9 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center group-hover:border-[rgba(91,91,245,0.18)] group-hover:bg-[var(--indigo-subtle)] transition-colors">
                  <Plus className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[var(--indigo)] transition-colors" />
                </div>
                <div className="text-center">
                  <p className="text-[12.5px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">Create sequence</p>
                  <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">Build a multi-step campaign</p>
                </div>
              </button>
            </div>
          )}

          {/* No results */}
          {!isEmpty && ((tab === 'emails' && filteredEmails.length === 0) || (tab === 'sequences' && filteredSequences.length === 0)) && (
            <Card padding="lg" className="text-center">
              <div className="mx-auto w-10 h-10 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex items-center justify-center mb-2">
                <Search className="h-4 w-4 text-[var(--text-tertiary)]" />
              </div>
              <p className="text-[13px] text-[var(--text-secondary)]">No templates match your filters</p>
              <button onClick={() => { setSearch(''); setActiveCategory('all'); }} className="text-[12px] text-[var(--indigo)] hover:underline mt-1">
                Clear filters
              </button>
            </Card>
          )}
        </>
      )}

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

      {/* Preview Modal */}
      {previewData && (
        <PreviewModal
          isOpen={!!previewData}
          onClose={() => setPreviewData(null)}
          type={previewData.type}
          emailTemplate={previewData.email}
          sequenceTemplate={previewData.sequence}
        />
      )}
    </div>
  );
}

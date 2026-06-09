import { useState, useCallback } from 'react';
import {
  Mail,
  Clock,
  Trash2,
  GripVertical,
  Plus,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  MousePointerClick,
  MessageSquare,
  ArrowDown,
  Sparkles,
  Settings,
  SkipForward,
  GitBranch,
  Webhook,
  ShieldCheck,
  Brain,
} from 'lucide-react';
import { StepType, ConditionField, ConditionOperator } from '@lemlist/shared';
import type { CreateStepInput } from '@lemlist/shared';
import { cn } from '../../lib/utils';

export type FlowStepType = 'email' | 'delay' | 'condition' | 'webhook_wait';

export interface FlowStep extends CreateStepInput {
  id?: string;
}

interface FlowBuilderProps {
  steps: FlowStep[];
  onStepsChange: (steps: FlowStep[]) => void;
  onEditStep: (index: number) => void;
  editingStep: number | null;
}

const stepTypeConfig: Record<string, {
  icon: any;
  label: string;
}> = {
  email: {
    icon: Mail,
    label: 'Email',
  },
  delay: {
    icon: Clock,
    label: 'Delay',
  },
  condition: {
    icon: GitBranch,
    label: 'Condition',
  },
  webhook_wait: {
    icon: Webhook,
    label: 'Webhook Wait',
  },
};

const conditionFieldOptions = [
  { value: ConditionField.Opened, label: 'Email Opened', icon: Eye },
  { value: ConditionField.Clicked, label: 'Link Clicked', icon: MousePointerClick },
  { value: ConditionField.Replied, label: 'Reply Received', icon: MessageSquare },
  { value: ConditionField.SaraIntent, label: 'SARA Intent', icon: Brain },
  { value: ConditionField.DcsScore, label: 'DCS Score', icon: ShieldCheck },
  { value: ConditionField.WebhookReceived, label: 'Webhook Received', icon: Webhook },
];

const conditionOperatorOptions = [
  { value: ConditionOperator.IsTrue, label: 'Is True' },
  { value: ConditionOperator.IsFalse, label: 'Is False' },
  { value: ConditionOperator.Equals, label: 'Equals' },
  { value: ConditionOperator.NotEquals, label: 'Not Equals' },
  { value: ConditionOperator.GreaterThan, label: 'Greater Than' },
  { value: ConditionOperator.LessThan, label: 'Less Than' },
  { value: ConditionOperator.Contains, label: 'Contains' },
];

interface AddStepMenuProps {
  onAdd: (type: StepType) => void;
  showAbove?: boolean;
}

function AddStepMenu({ onAdd, showAbove }: AddStepMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative flex justify-center">
      {/* Connector line */}
      <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-0.5 bg-gradient-to-b from-[var(--border-default)] to-[var(--border-subtle)]" />

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-surface)] border border-dashed border-[var(--indigo)]/30 hover:border-[var(--indigo)] hover:bg-[var(--indigo-subtle)] transition-all my-2"
      >
        <Plus className="h-3 w-3 text-[var(--indigo)]/50 group-hover:text-[var(--indigo)]" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setIsOpen(false)} />
          <div className={cn(
            "absolute z-30 w-52 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] shadow-xl py-1 animate-fade-in",
            showAbove ? "bottom-full mb-2" : "top-full mt-2"
          )}>
            <p className="px-3 pb-1.5 pt-1.5 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-[0.08em]">
              Add Step
            </p>
            {[
              { type: StepType.Email, icon: Mail, label: 'Email Step', desc: 'Send a personalised email', accent: 'bg-[var(--indigo-subtle)] text-[var(--indigo)] border-[rgba(91,91,245,0.18)]' },
              { type: StepType.Delay, icon: Clock, label: 'Wait / Delay', desc: 'Wait before the next step', accent: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
            ].map(({ type, icon: Icon, label, desc, accent }) => (
              <button
                key={type}
                type="button"
                onClick={() => { onAdd(type); setIsOpen(false); }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-[var(--bg-hover)] transition-colors text-left"
              >
                <div className={cn('flex h-7 w-7 items-center justify-center rounded-md border flex-shrink-0', accent)}>
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-[var(--text-primary)]">{label}</p>
                  <p className="text-[10.5px] text-[var(--text-tertiary)] leading-tight">{desc}</p>
                </div>
              </button>
            ))}
            <div className="border-t border-[var(--border-subtle)] my-1" />
            {[
              { type: StepType.Condition, icon: GitBranch, label: 'Condition', desc: 'If/else branch logic', accent: 'bg-violet-500/10 text-violet-600 border-violet-500/20' },
              { type: StepType.WebhookWait, icon: Webhook, label: 'Webhook Wait', desc: 'Wait for external event', accent: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20' },
            ].map(({ type, icon: Icon, label, desc, accent }) => (
              <button
                key={type}
                type="button"
                onClick={() => { onAdd(type); setIsOpen(false); }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 hover:bg-[var(--bg-hover)] transition-colors text-left"
              >
                <div className={cn('flex h-7 w-7 items-center justify-center rounded-md border flex-shrink-0', accent)}>
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-[var(--text-primary)]">{label}</p>
                  <p className="text-[10.5px] text-[var(--text-tertiary)] leading-tight">{desc}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const getStepColors = (stepType: string) => {
  switch (stepType) {
    case 'email':
      return {
        iconBg: 'bg-[var(--indigo-subtle)] text-[var(--indigo)] border border-[rgba(91,91,245,0.18)]',
        borderColor: 'border-l-[3px] border-l-[var(--indigo)]',
        badgeBg: 'bg-[var(--indigo)] text-white',
      };
    case 'delay':
      return {
        iconBg: 'bg-amber-500/10 text-amber-600 border border-amber-500/20',
        borderColor: 'border-l-[3px] border-l-amber-500',
        badgeBg: 'bg-amber-500 text-white',
      };
    case 'condition':
      return {
        iconBg: 'bg-violet-500/10 text-violet-600 border border-violet-500/20',
        borderColor: 'border-l-[3px] border-l-violet-500',
        badgeBg: 'bg-violet-500 text-white',
      };
    case 'webhook_wait':
      return {
        iconBg: 'bg-cyan-500/10 text-cyan-600 border border-cyan-500/20',
        borderColor: 'border-l-[3px] border-l-cyan-500',
        badgeBg: 'bg-cyan-500 text-white',
      };
    default:
      return {
        iconBg: 'bg-slate-500/10 text-slate-600 border border-slate-500/20',
        borderColor: 'border-l-[3px] border-l-slate-400',
        badgeBg: 'bg-slate-500 text-white',
      };
  }
};

function FlowNode({
  step,
  index,
  totalSteps,
  isEditing,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  onUpdate,
}: {
  step: FlowStep;
  index: number;
  totalSteps: number;
  isEditing: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: (updates: Partial<FlowStep>) => void;
}) {
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const config = stepTypeConfig[step.step_type] || stepTypeConfig.email;
  const Icon = config.icon;
  const stepColors = getStepColors(step.step_type);

  const getStepSummary = () => {
    if (step.step_type === 'email') {
      return step.subject || 'Untitled Email';
    }
    if (step.step_type === 'delay') {
      const parts = [];
      if (step.delay_days) parts.push(`${step.delay_days} day${step.delay_days !== 1 ? 's' : ''}`);
      if (step.delay_hours) parts.push(`${step.delay_hours} hour${step.delay_hours !== 1 ? 's' : ''}`);
      if (step.delay_minutes) parts.push(`${step.delay_minutes} min`);
      return parts.length > 0 ? `Wait ${parts.join(', ')}` : 'No delay set';
    }
    if (step.step_type === 'condition') {
      const field = conditionFieldOptions.find((f) => f.value === step.condition_field);
      const op = conditionOperatorOptions.find((o) => o.value === step.condition_operator);
      if (field && op) {
        const valueStr = step.condition_value ? ` "${step.condition_value}"` : '';
        return `If ${field.label} ${op.label}${valueStr}`;
      }
      return 'Configure condition...';
    }
    if (step.step_type === 'webhook_wait') {
      return step.webhook_event
        ? `Wait for: ${step.webhook_event} (${step.webhook_timeout_hours || 72}h timeout)`
        : 'Configure webhook event...';
    }
    return '';
  };

  return (
    <div className="relative">
      {/* Node Card */}
      <div
        className={cn(
          'group relative mx-auto max-w-xl rounded-xl border bg-[var(--bg-surface)] transition-all duration-200 overflow-hidden',
          stepColors.borderColor,
          isEditing
            ? 'border-[var(--indigo)]/40 shadow-[0_0_0_2px_var(--indigo-subtle),0_4px_12px_rgba(91,91,245,0.12)]'
            : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[0_2px_8px_rgba(15,15,25,0.06)]'
        )}
      >
        {/* Step Number Badge */}
        <div className={cn(
          'absolute -top-2.5 left-5 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold shadow-sm',
          stepColors.badgeBg
        )}>
          <span>Step {index + 1}</span>
          <span className="opacity-70">/ {totalSteps}</span>
        </div>

        <div className="p-4 pt-5">
          <div className="flex items-start gap-3">
            {/* Drag Handle & Icon */}
            <div className="flex flex-col items-center gap-1">
              <button type="button" className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-grab active:cursor-grabbing">
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', stepColors.iconBg)}>
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{config.label}</h3>
                {step.step_type === 'email' && step.skip_if_replied !== false && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-semibold bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                    <SkipForward className="h-2.5 w-2.5" />
                    Skip if replied
                  </span>
                )}
                {step.step_type === 'condition' && (
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[10px] font-semibold bg-violet-500/10 text-violet-600 border border-violet-500/20">
                    <GitBranch className="h-2.5 w-2.5" />
                    If/Else
                  </span>
                )}
              </div>
              <p className="text-[12px] text-[var(--text-secondary)] truncate">{getStepSummary()}</p>

              {/* Email preview */}
              {step.step_type === 'email' && step.body_html && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowHtmlPreview((v) => !v); }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] transition-colors"
                  >
                    {showHtmlPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {showHtmlPreview ? 'Hide preview' : 'Preview email'}
                  </button>
                  {showHtmlPreview && (
                    <div className="mt-2 rounded-lg border border-[var(--border-subtle)] overflow-hidden bg-white">
                      <iframe
                        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.6;color:#111;word-break:break-word;}img{max-width:100%;}</style></head><body>${step.body_html}</body></html>`}
                        sandbox="allow-same-origin"
                        className="w-full"
                        style={{ height: '240px', border: 'none', display: 'block', pointerEvents: 'none' }}
                        title="Email HTML preview"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Condition inline config */}
              {step.step_type === 'condition' && isEditing && (
                <div className="mt-3 p-4 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Condition Field</label>
                    <select
                      value={step.condition_field || ''}
                      onChange={(e) => onUpdate({ condition_field: e.target.value })}
                      className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm focus:border-[var(--text-primary)] focus:ring-2 focus:ring-[var(--text-primary)]/20"
                    >
                      <option value="">Select field...</option>
                      {conditionFieldOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Operator</label>
                      <select
                        value={step.condition_operator || ''}
                        onChange={(e) => onUpdate({ condition_operator: e.target.value })}
                        className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm focus:border-[var(--text-primary)] focus:ring-2 focus:ring-[var(--text-primary)]/20"
                      >
                        <option value="">Select...</option>
                        {conditionOperatorOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Value</label>
                      <input
                        type="text"
                        value={step.condition_value || ''}
                        onChange={(e) => onUpdate({ condition_value: e.target.value })}
                        placeholder="e.g., interested"
                        className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm focus:border-[var(--text-primary)] focus:ring-2 focus:ring-[var(--text-primary)]/20"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
                      <p className="text-xs font-semibold text-emerald-700">✓ True Branch</p>
                      <p className="text-xs text-emerald-600 mt-0.5">Continues to next step</p>
                    </div>
                    <div className="p-2.5 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] space-y-1.5">
                      <p className="text-xs font-semibold text-[var(--text-primary)]">✗ False Branch</p>
                      <select
                        value={step.false_branch_step ?? ''}
                        onChange={(e) => onUpdate({ false_branch_step: e.target.value === '' ? undefined : Number(e.target.value) })}
                        className="w-full h-7 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-xs focus:border-[#6366F1] outline-none"
                      >
                        <option value="">Skip to end</option>
                        {Array.from({ length: totalSteps }, (_, i) => i).filter((i) => i !== index).map((i) => (
                          <option key={i} value={i}>Jump to Step {i + 1}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Webhook wait inline config */}
              {step.step_type === 'webhook_wait' && isEditing && (
                <div className="mt-3 p-4 bg-[var(--bg-elevated)] rounded-xl border border-[var(--border-subtle)] space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Webhook Event</label>
                    <input
                      type="text"
                      value={step.webhook_event || ''}
                      onChange={(e) => onUpdate({ webhook_event: e.target.value })}
                      placeholder="e.g., payment.completed"
                      className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm focus:border-[var(--text-primary)] focus:ring-2 focus:ring-[var(--text-primary)]/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Timeout (hours)</label>
                    <input
                      type="number"
                      min="1"
                      max="720"
                      value={step.webhook_timeout_hours || 72}
                      onChange={(e) => onUpdate({ webhook_timeout_hours: parseInt(e.target.value) || 72 })}
                      className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm focus:border-[var(--text-primary)] focus:ring-2 focus:ring-[var(--text-primary)]/20"
                    />
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">Contact proceeds to next step after timeout if webhook not received.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-px opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={onMoveUp}
                disabled={index === 0}
                className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={index === totalSteps - 1}
                className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {(step.step_type === 'email' || step.step_type === 'condition' || step.step_type === 'webhook_wait') && (
                <button
                  type="button"
                  onClick={onEdit}
                  className={cn(
                    'px-2 py-1 rounded text-[11.5px] font-semibold transition-colors',
                    isEditing
                      ? 'bg-[var(--indigo)] text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  )}
                >
                  {isEditing ? 'Close' : 'Edit'}
                </button>
              )}
              <button
                type="button"
                onClick={onRemove}
                className="p-1 rounded text-[var(--text-tertiary)] hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FlowBuilder({ steps, onStepsChange, onEditStep, editingStep }: FlowBuilderProps) {
  const addStep = useCallback((type: StepType, atIndex?: number) => {
    const newStep: FlowStep = {
      step_type: type,
      step_order: steps.length,
      subject: type === StepType.Email ? '' : undefined,
      body_html: type === StepType.Email ? '' : undefined,
      delay_days: type === StepType.Delay ? 1 : 0,
      delay_hours: 0,
      delay_minutes: 0,
      skip_if_replied: type === StepType.Email ? true : undefined,
      condition_field: type === StepType.Condition ? '' : undefined,
      condition_operator: type === StepType.Condition ? '' : undefined,
      condition_value: type === StepType.Condition ? '' : undefined,
      webhook_event: type === StepType.WebhookWait ? '' : undefined,
      webhook_timeout_hours: type === StepType.WebhookWait ? 72 : undefined,
    };

    if (atIndex !== undefined) {
      const newSteps = [...steps];
      newSteps.splice(atIndex, 0, newStep);
      onStepsChange(newSteps);
      if (type === StepType.Email || type === StepType.Condition || type === StepType.WebhookWait) onEditStep(atIndex);
    } else {
      onStepsChange([...steps, newStep]);
      if (type === StepType.Email || type === StepType.Condition || type === StepType.WebhookWait) onEditStep(steps.length);
    }
  }, [steps, onStepsChange, onEditStep]);

  const removeStep = useCallback((index: number) => {
    onStepsChange(steps.filter((_, i) => i !== index));
    if (editingStep === index) onEditStep(-1);
  }, [steps, onStepsChange, editingStep, onEditStep]);

  const moveStep = useCallback((from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    const newSteps = [...steps];
    const [moved] = newSteps.splice(from, 1);
    newSteps.splice(to, 0, moved);
    onStepsChange(newSteps);
    if (editingStep === from) onEditStep(to);
  }, [steps, onStepsChange, editingStep, onEditStep]);

  const updateStep = useCallback((index: number, updates: Partial<FlowStep>) => {
    onStepsChange(steps.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  }, [steps, onStepsChange]);

  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center py-10">
        {/* Start node */}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)] mb-3">
          <Sparkles className="h-6 w-6 text-[var(--indigo)]" strokeWidth={1.5} />
        </div>
        <p className="text-[14px] font-semibold text-[var(--text-primary)] mb-1">Campaign Start</p>
        <p className="text-[12px] text-[var(--text-tertiary)] mb-5">Add your first step to begin building the sequence</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 max-w-2xl">
          {[
            { type: StepType.Email, icon: Mail, label: 'Add Email', desc: 'Send a personalised message', accent: 'bg-[var(--indigo-subtle)] text-[var(--indigo)] border-[rgba(91,91,245,0.18)]' },
            { type: StepType.Delay, icon: Clock, label: 'Add Delay', desc: 'Wait before next step', accent: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
            { type: StepType.Condition, icon: GitBranch, label: 'Add Condition', desc: 'If / else branching', accent: 'bg-violet-500/10 text-violet-600 border-violet-500/20' },
          ].map(({ type, icon: Icon, label, desc, accent }) => (
            <button
              key={type}
              type="button"
              onClick={() => addStep(type)}
              className="flex items-center gap-2.5 px-3.5 py-3 bg-[var(--bg-surface)] rounded-xl border border-dashed border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] transition-all group text-left"
            >
              <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg flex-shrink-0 border', accent)}>
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{label}</p>
                <p className="text-[10.5px] text-[var(--text-tertiary)] leading-tight">{desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative py-4">
      {/* Start Node */}
      <div className="flex justify-center mb-1">
        <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--indigo)] text-white text-[11.5px] font-bold shadow-[0_2px_6px_rgba(91,91,245,0.3)]">
          <Sparkles className="h-3 w-3" />
          Campaign Start
        </div>
      </div>

      {/* Steps */}
      {steps.map((step, index) => (
        <div key={index}>
          {/* Add step between nodes */}
          <AddStepMenu onAdd={(type) => addStep(type, index)} />

          {/* Flow Node */}
          <FlowNode
            step={step}
            index={index}
            totalSteps={steps.length}
            isEditing={editingStep === index}
            onEdit={() => onEditStep(editingStep === index ? -1 : index)}
            onRemove={() => removeStep(index)}
            onMoveUp={() => moveStep(index, index - 1)}
            onMoveDown={() => moveStep(index, index + 1)}
            onUpdate={(updates) => updateStep(index, updates)}
          />
        </div>
      ))}

      {/* Add step at end */}
      <AddStepMenu onAdd={(type) => addStep(type)} showAbove />

      {/* End Node */}
      <div className="flex justify-center mt-1">
        <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-tertiary)] text-[11.5px] font-bold border border-[var(--border-subtle)]">
          <Settings className="h-3 w-3" />
          Campaign End
        </div>
      </div>
    </div>
  );
}

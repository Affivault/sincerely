import { useState, useCallback } from 'react';
import { usePopover } from '../../hooks/usePopover';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Mail,
  Clock,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  MousePointerClick,
  MessageSquare,
  GitBranch,
  Webhook,
  ShieldCheck,
  Brain,
  Copy,
  Check,
  AlertTriangle,
  Linkedin,
} from 'lucide-react';
import { StepType, ConditionField, ConditionOperator, isLinkedinStep, LINKEDIN_NOTE_MAX } from '@lemlist/shared';
import type { CreateStepInput } from '@lemlist/shared';
import { campaignsApi } from '../../api/campaigns.api';
import { cn } from '../../lib/utils';

export type FlowStepType = 'email' | 'delay' | 'condition' | 'webhook_wait';

export interface FlowStep extends CreateStepInput {
  id?: string;
  _clientKey?: string;
}

interface FlowBuilderProps {
  steps: FlowStep[];
  onStepsChange: (steps: FlowStep[]) => void;
  onEditStep: (index: number) => void;
  editingStep: number | null;
  /** Present once the campaign has been saved — lets the webhook_wait step show its inbound URL. */
  campaignId?: string;
}

/** Read-only inbound webhook URL + one-click copy, shown inside a webhook_wait step's config panel. */
function WebhookUrlField({ campaignId }: { campaignId: string }) {
  const [copied, setCopied] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['campaign-webhook-token', campaignId],
    queryFn: () => campaignsApi.getWebhookToken(campaignId),
  });

  const copy = () => {
    if (!data?.url) return;
    navigator.clipboard.writeText(data.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => toast.error('Failed to copy to clipboard'));
  };

  return (
    <div>
      <label className="block text-body font-medium text-[var(--text-secondary)] mb-1">Inbound webhook URL</label>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          readOnly
          aria-label="Inbound webhook URL"
          value={isLoading ? 'Loading…' : data?.url || ''}
          onFocus={(e) => e.target.select()}
          className="flex-1 h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-body font-mono text-[var(--text-secondary)] outline-none focus-visible:border-[var(--indigo)] focus-visible:shadow-[var(--ring-focus)]"
        />
        <button
          type="button"
          onClick={copy}
          disabled={!data?.url}
          className="h-9 w-9 flex items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          title="Copy URL"
          aria-label="Copy URL"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="text-body text-[var(--text-tertiary)] mt-1">POST here with <code>{'{ event, contact_email }'}</code> to resume matching contacts. The token proves the call is authorized — keep this URL private.</p>
    </div>
  );
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
  linkedin_connect: {
    icon: Linkedin,
    label: 'LinkedIn invite',
  },
  linkedin_message: {
    icon: Linkedin,
    label: 'LinkedIn message',
  },
  linkedin_visit: {
    icon: Linkedin,
    label: 'Profile visit',
  },
};

const conditionFieldOptions = [
  { value: ConditionField.Opened, label: 'Email Opened', icon: Eye },
  { value: ConditionField.Clicked, label: 'Link Clicked', icon: MousePointerClick },
  { value: ConditionField.Replied, label: 'Reply Received', icon: MessageSquare },
  { value: ConditionField.SaraIntent, label: 'Relay Intent', icon: Brain },
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

function AddStepMenu({ onAdd, showAbove, last }: AddStepMenuProps & { last?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const menu = usePopover(isOpen, () => setIsOpen(false));

  const groups: Array<Array<{ type: StepType; icon: typeof Mail; label: string; desc: string }>> = [
    [
      { type: StepType.Email, icon: Mail, label: 'Email', desc: 'A message in the thread' },
      { type: StepType.Delay, icon: Clock, label: 'Wait', desc: 'Pause before the next step' },
    ],
    [
      { type: StepType.LinkedinConnect, icon: Linkedin, label: 'LinkedIn invite', desc: 'Connection request, with a note' },
      { type: StepType.LinkedinMessage, icon: Linkedin, label: 'LinkedIn message', desc: 'Message someone you know' },
      { type: StepType.LinkedinVisit, icon: Linkedin, label: 'Profile visit', desc: 'Show up in their notifications' },
    ],
    [
      { type: StepType.Condition, icon: GitBranch, label: 'Condition', desc: 'Go one way or another' },
      { type: StepType.WebhookWait, icon: Webhook, label: 'Wait for a webhook', desc: 'Hold until another system says so' },
    ],
  ];

  return (
    <div className={cn('group/add relative grid grid-cols-[64px_1fr] gap-4', last ? 'pt-3' : 'h-7')}>
      <span />
      <div className="relative flex items-center">
        {/* Between steps the control waits for a pointer, so the document
            reads as writing and not as a diagram of plus signs. At the end
            it is always there: that is where the next step goes. */}
        <button
          {...menu.triggerProps}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          title="Add a step here"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md text-caption font-medium transition-[opacity,color,background-color]',
            last
              ? 'h-8 px-2.5 -ml-2.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              : cn('h-6 px-2 -ml-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:opacity-100', isOpen ? 'opacity-100' : 'opacity-0 group-hover/add:opacity-100 group-focus-within/add:opacity-100'),
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          {last ? 'Add a step' : 'Insert a step'}
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-20" aria-hidden onClick={() => setIsOpen(false)} />
            <div {...menu.panelProps} className={cn(
              'absolute left-0 z-30 w-60 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1 shadow-[var(--shadow-xl)] animate-fade-in',
              showAbove ? 'bottom-full mb-1.5' : 'top-full mt-1',
            )}>
              {groups.map((g, gi) => (
                <div key={gi} className={cn(gi > 0 && 'mt-1 pt-1 border-t border-[var(--border-subtle)]')}>
                  {g.map(({ type, icon: Icon, label, desc }) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { onAdd(type); setIsOpen(false); }}
                      className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
                    >
                      <Icon className="h-4 w-4 flex-shrink-0 text-[var(--text-tertiary)]" strokeWidth={1.7} />
                      <span className="min-w-0">
                        <span className="block text-body font-medium text-[var(--text-primary)]">{label}</span>
                        <span className="block text-caption text-[var(--text-tertiary)] leading-tight">{desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Plain text of an email body, for the opening lines shown in the outline. */
function bodyText(html: string | undefined | null): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text with its {{merge fields}} drawn as quiet tokens, so they read as slots. */
function WithFields({ text }: { text: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\{\{[^}]+\}\}$/.test(part) ? (
          <span key={i} className="rounded bg-[var(--bg-elevated)] px-1 py-px font-mono text-[0.86em] text-[var(--text-secondary)]">
            {part.slice(2, -2).trim()}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** When a step fires, in the words someone would use. */
function dayLabel(dayOffset: number, index: number): string {
  if (dayOffset === 0) return index === 0 ? 'Day 1' : 'Same day';
  return `Day ${dayOffset + 1}`;
}

/** Total delay of a single delay step, expressed in (fractional) days. */
const stepDelayInDays = (step: FlowStep): number =>
  (step.delay_days || 0) + (step.delay_hours || 0) / 24 + (step.delay_minutes || 0) / 1440;

function FlowNode({
  step,
  index,
  totalSteps,
  dayOffset,
  timedByDelayNode,
  isEditing,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
  onUpdate,
  campaignId,
}: {
  step: FlowStep;
  index: number;
  totalSteps: number;
  dayOffset: number;
  /** True when the step directly above is an explicit Wait node — it owns the timing. */
  timedByDelayNode?: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: (updates: Partial<FlowStep>) => void;
  campaignId?: string;
}) {
  const [showHtmlPreview, setShowHtmlPreview] = useState(false);
  const config = stepTypeConfig[step.step_type] || stepTypeConfig.email;
  const Icon = config.icon;

  const getStepSummary = () => {
    if (step.step_type === 'email') {
      return (step as any).thread_mode === 'reply' ? 'Reply in same thread' : (step.subject || 'Reply in same thread');
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

  // A condition/webhook-wait step with no field/event picked yet can't do
  // anything at send time — the launch checklist catches this too, but that
  // only surfaces once the user tries to launch. Flagging it right on the
  // card means they see it the moment they add the step instead.
  const isUnconfigured =
    (step.step_type === 'condition' && (!step.condition_field || !step.condition_operator)) ||
    (step.step_type === 'webhook_wait' && !step.webhook_event);

  const editable = step.step_type === 'email' || step.step_type === 'condition' || step.step_type === 'webhook_wait' || isLinkedinStep(step.step_type);
  const opening = step.step_type === 'email' ? bodyText(step.body_html) : '';

  return (
    /*
     * One step, set like a passage in a document: when it happens sits in
     * the margin on the timeline, what it says is the body. The step's
     * number is its position on the page; it does not need a badge.
     */
    <div className="group relative grid grid-cols-[64px_1fr] gap-4">
      <div className="relative pt-[18px] text-right">
        <span className="text-caption font-medium tabular text-[var(--text-secondary)]" title="When this step goes out, counted from the day someone is enrolled">
          {dayLabel(dayOffset, index)}
        </span>
        <span aria-hidden className={cn(
          'absolute -right-[11.5px] top-[22px] h-[7px] w-[7px] rounded-full ring-[3px] ring-[var(--bg-surface)]',
          isEditing ? 'bg-[var(--indigo)]' : isUnconfigured ? 'bg-amber-500' : 'bg-[var(--border-strong)]',
        )} />
      </div>
      <div
        onClick={editable && !isEditing ? onEdit : undefined}
        className={cn(
          'relative min-w-0 rounded-lg border bg-[var(--bg-surface)] transition-[border-color,box-shadow] duration-150',
          editable && !isEditing && 'cursor-pointer',
          isEditing
            ? 'border-[var(--border-strong)] shadow-[var(--shadow-md)]'
            : 'border-[var(--border-subtle)] hover:border-[var(--border-default)]',
        )}
      >
        {isEditing && <span aria-hidden className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r bg-[var(--indigo)]" />}
        <div className="px-5 py-4">
          <div className="flex items-start gap-3">
            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-caption text-[var(--text-tertiary)]">
                <Icon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.7} />
                <span className="font-medium">{config.label}</span>
                {step.step_type === 'email' && step.skip_if_replied !== false && (
                  <span title="Anyone who has replied by then does not get this one">- skipped if they have replied</span>
                )}
                {isUnconfigured && (
                  <span
                    className="ml-1 inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400"
                    title="This step won't do anything until it's configured - it'll block launch."
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Needs setup
                  </span>
                )}
              </div>
              {step.step_type === 'email' ? (
                <>
                  <p className={cn('mt-1.5 text-heading font-semibold leading-snug tracking-[-0.01em] break-words', step.subject ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
                    {step.subject ? <WithFields text={step.subject} /> : 'No subject yet'}
                  </p>
                  {step.subject_b && (
                    <p className="mt-0.5 text-body text-[var(--text-tertiary)] break-words">
                      <span className="font-medium text-[var(--text-secondary)]">or, for half: </span><WithFields text={step.subject_b} />
                    </p>
                  )}
                  <p className={cn('mt-1.5 line-clamp-3 max-w-[68ch] text-body leading-relaxed', opening ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)] italic')}>
                    {opening ? <WithFields text={opening} /> : 'Nothing written yet - open it to write the email.'}
                  </p>
                </>
              ) : (
                <p className={cn('mt-1.5 text-strong break-words', isUnconfigured ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--text-primary)]')}>
                  {getStepSummary()}
                </p>
              )}

              {/* Built-in send timing — lives on the email itself, no separate
                  delay node needed. First email always goes out at launch, and
                  when a Wait node sits directly above, that node owns the
                  timing (matching the engine, which ignores the built-in wait
                  after an explicit delay). */}
              {step.step_type === 'email' && index > 0 && !timedByDelayNode && (
                <div
                  className="mt-3 inline-flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Clock className="h-3 w-3 text-[var(--text-tertiary)] flex-shrink-0" strokeWidth={2} />
                  <span className="text-caption text-[var(--text-secondary)]">Sends</span>
                  <DelayUnit value={step.delay_days || 0} unit="d" onChange={(v) => onUpdate({ delay_days: v })} />
                  <DelayUnit value={step.delay_hours || 0} unit="h" onChange={(v) => onUpdate({ delay_hours: v })} />
                  <span className="text-caption text-[var(--text-tertiary)] whitespace-nowrap">
                    {stepDelayInDays(step) > 0 ? 'after the previous step' : 'straight after the previous step'}
                  </span>
                </div>
              )}

              {/* LinkedIn timing — same control, so a channel switch doesn't
                  change how you set the wait. */}
              {isLinkedinStep(step.step_type) && index > 0 && !timedByDelayNode && (
                <div
                  className="mt-3 inline-flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Clock className="h-3 w-3 text-[var(--text-tertiary)] flex-shrink-0" strokeWidth={2} />
                  <span className="text-caption text-[var(--text-secondary)]">Do this</span>
                  <DelayUnit value={step.delay_days || 0} unit="d" onChange={(v) => onUpdate({ delay_days: v })} />
                  <DelayUnit value={step.delay_hours || 0} unit="h" onChange={(v) => onUpdate({ delay_hours: v })} />
                  <span className="text-caption text-[var(--text-tertiary)] whitespace-nowrap">
                    {stepDelayInDays(step) > 0 ? 'after the previous step' : 'straight after the previous step'}
                  </span>
                </div>
              )}

              {/* LinkedIn wording. An invite's note is capped by LinkedIn at
                  300 characters; a message has no subject and no HTML. */}
              {isLinkedinStep(step.step_type) && isEditing && (
                <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                  {step.step_type === 'linkedin_connect' && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-caption font-semibold text-[var(--text-secondary)]">
                          Invite note <span className="font-normal text-[var(--text-tertiary)]">(optional)</span>
                        </label>
                        <span className={cn(
                          'text-micro tabular',
                          (step.linkedin_note || '').length > LINKEDIN_NOTE_MAX
                            ? 'text-[var(--error)] font-semibold'
                            : 'text-[var(--text-tertiary)]',
                        )}>
                          {(step.linkedin_note || '').length}/{LINKEDIN_NOTE_MAX}
                        </span>
                      </div>
                      <textarea
                        aria-label="Invite note (optional)"
                        value={step.linkedin_note || ''}
                        onChange={(e) => onUpdate({ linkedin_note: e.target.value })}
                        rows={3}
                        maxLength={LINKEDIN_NOTE_MAX}
                        placeholder="Hi {{first_name}} — saw you're leading growth at {{company}}. Would love to connect."
                        className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-2 text-body text-[var(--text-primary)] outline-none focus:border-sky-500 focus-visible:shadow-[var(--ring-focus)]"
                      />
                      <p className="mt-1 text-micro text-[var(--text-tertiary)]">
                        Invites without a note are accepted more often — leave it empty and it's sent bare.
                      </p>
                    </div>
                  )}

                  {step.step_type === 'linkedin_message' && (
                    <div>
                      <label className="block text-caption font-semibold text-[var(--text-secondary)] mb-1">Message</label>
                      <textarea
                        aria-label="Message"
                        value={step.body_text || ''}
                        onChange={(e) => onUpdate({ body_text: e.target.value })}
                        rows={4}
                        placeholder="Thanks for connecting, {{first_name}}…"
                        className="w-full resize-none rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-2 text-body text-[var(--text-primary)] outline-none focus:border-sky-500 focus-visible:shadow-[var(--ring-focus)]"
                      />
                      <p className="mt-1 text-micro text-[var(--text-tertiary)]">
                        Only reaches people you're already connected to — put an invite step before this one.
                      </p>
                    </div>
                  )}

                  {step.step_type === 'linkedin_visit' && (
                    <p className="text-caption text-[var(--text-tertiary)]">
                      Nothing to write — a visit shows up in their notifications and often earns a look back.
                    </p>
                  )}

                  <div className="flex items-start gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.06] px-2.5 py-2">
                    <Linkedin className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 flex-shrink-0 mt-0.5" />
                    <p className="text-micro text-[var(--text-secondary)] leading-snug">
                      LinkedIn has no API for this, so the step lands in your Activities queue when it's due —
                      personalised, with the profile one click away. Tick it off and the sequence carries on.
                      Leads without a LinkedIn URL skip the step.
                    </p>
                  </div>
                </div>
              )}

              {/* Email preview */}
              {step.step_type === 'email' && step.body_html && (
                <div className="mt-2.5">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowHtmlPreview((v) => !v); }}
                    className="inline-flex items-center gap-1.5 text-caption font-medium text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {showHtmlPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {showHtmlPreview ? 'Hide the email' : 'See it as they will'}
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
                    <label className="block text-body font-medium text-[var(--text-secondary)] mb-1">Condition field</label>
                    <select
                      aria-label="Condition field"
                      value={step.condition_field || ''}
                      onChange={(e) => onUpdate({ condition_field: (e.target.value || undefined) as ConditionField | undefined })}
                      className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-strong focus:border-[var(--text-primary)] focus:ring-2 focus:ring-[var(--text-primary)]/20"
                    >
                      <option value="">Select field...</option>
                      {conditionFieldOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-body font-medium text-[var(--text-secondary)] mb-1">Operator</label>
                      <select
                        aria-label="Operator"
                        value={step.condition_operator || ''}
                        onChange={(e) => onUpdate({ condition_operator: (e.target.value || undefined) as ConditionOperator | undefined })}
                        className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-strong focus:border-[var(--text-primary)] focus:ring-2 focus:ring-[var(--text-primary)]/20"
                      >
                        <option value="">Select...</option>
                        {conditionOperatorOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-body font-medium text-[var(--text-secondary)] mb-1">Value</label>
                      <input
                        type="text"
                        aria-label="Value"
                        value={step.condition_value || ''}
                        onChange={(e) => onUpdate({ condition_value: e.target.value })}
                        placeholder="e.g., interested"
                        className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-strong focus:border-[var(--text-primary)] focus:ring-2 focus:ring-[var(--text-primary)]/20"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="p-2.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                      <p className="text-body font-semibold text-emerald-700 dark:text-emerald-400">✓ True branch</p>
                      <p className="text-caption text-emerald-600 dark:text-emerald-400 mt-0.5">Continues to next step</p>
                    </div>
                    <div className="p-2.5 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] space-y-1.5">
                      <p className="text-body font-semibold text-[var(--text-primary)]">✗ False Branch</p>
                      <select
                        aria-label="False branch goes to"
                        value={step.false_branch_step ?? ''}
                        onChange={(e) => onUpdate({ false_branch_step: e.target.value === '' ? undefined : Number(e.target.value) })}
                        className="w-full h-7 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-body focus:border-[var(--indigo)] outline-none"
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
                    <label className="block text-body font-medium text-[var(--text-secondary)] mb-1">Webhook event</label>
                    <input
                      type="text"
                      aria-label="Webhook event"
                      value={step.webhook_event || ''}
                      onChange={(e) => onUpdate({ webhook_event: e.target.value })}
                      placeholder="e.g., payment.completed"
                      className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-strong focus:border-[var(--text-primary)] focus:ring-2 focus:ring-[var(--text-primary)]/20"
                    />
                  </div>
                  <div>
                    <label className="block text-body font-medium text-[var(--text-secondary)] mb-1">Timeout (hours)</label>
                    <input
                      type="number"
                      aria-label="Timeout (hours)"
                      min="1"
                      max="720"
                      value={step.webhook_timeout_hours || 72}
                      onChange={(e) => onUpdate({ webhook_timeout_hours: parseInt(e.target.value) || 72 })}
                      className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-strong focus:border-[var(--text-primary)] focus:ring-2 focus:ring-[var(--text-primary)]/20"
                    />
                    <p className="text-body text-[var(--text-tertiary)] mt-1">Contact proceeds to next step after timeout if webhook not received.</p>
                  </div>
                  {campaignId ? (
                    <WebhookUrlField campaignId={campaignId} />
                  ) : (
                    <p className="text-body text-[var(--text-tertiary)]">Save the campaign to get your inbound webhook URL.</p>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className={cn('flex items-center gap-px transition-opacity focus-within:opacity-100', isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100')} onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={onMoveUp}
                disabled={index === 0}
                aria-label={`Move step ${index + 1} up`}
                title="Move up"
                className="inline-flex min-h-6 min-w-6 items-center justify-center p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={index === totalSteps - 1}
                aria-label={`Move step ${index + 1} down`}
                title="Move down"
                className="inline-flex min-h-6 min-w-6 items-center justify-center p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {editable && (
                <button
                  type="button"
                  onClick={onEdit}
                  aria-expanded={isEditing}
                  aria-label={`${isEditing ? 'Done editing' : 'Edit'} step ${index + 1}`}
                  className={cn(
                    'min-h-6 px-2 py-1 rounded text-caption font-semibold transition-colors',
                    isEditing
                      ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  )}
                >
                  {isEditing ? 'Done' : 'Edit'}
                </button>
              )}
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove step ${index + 1}`}
                title="Remove step"
                className="inline-flex min-h-6 min-w-6 items-center justify-center p-1 rounded text-[var(--text-tertiary)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
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

/* ─── Inline delay unit input ───────────────────────────────────── */
function DelayUnit({ value, unit, onChange }: { value: number; unit: string; onChange: (v: number) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min={0}
        max={999}
        aria-label={`Delay in ${unit === 'd' ? 'days' : unit === 'h' ? 'hours' : 'minutes'}`}
        value={value || 0}
        onChange={(e) => onChange(Math.max(0, Math.min(999, parseInt(e.target.value) || 0)))}
        onClick={(e) => e.stopPropagation()}
        className="w-9 h-7 text-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-body font-medium text-[var(--text-primary)] tabular hover:border-[var(--border-default)] focus:border-[var(--indigo)] focus:shadow-[var(--ring-focus)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="text-caption font-medium text-[var(--text-tertiary)]">{unit}</span>
    </span>
  );
}

/* ─── Delay chip — compact, inline-editable wait between steps ───── */
function DelayChip({ step, onUpdate, onRemove, onMoveUp, onMoveDown, isFirst, isLast }: {
  step: FlowStep;
  onUpdate: (u: Partial<FlowStep>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const empty = !step.delay_days && !step.delay_hours && !step.delay_minutes;
  return (
    <div className="grid grid-cols-[64px_1fr] gap-4">
      <span />
      {/* A wait is a pause in the text, not a box: one line on the timeline. */}
      <div className={cn(
        'group/chip relative inline-flex w-fit items-center gap-2.5 rounded-md py-1.5 pl-0 pr-1.5',
        empty && 'text-amber-700 dark:text-amber-400',
      )}>
        <Clock className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" strokeWidth={1.8} />
        <span className="text-body font-medium text-[var(--text-secondary)]">Wait</span>
        <DelayUnit value={step.delay_days || 0} unit="d" onChange={(v) => onUpdate({ delay_days: v })} />
        <DelayUnit value={step.delay_hours || 0} unit="h" onChange={(v) => onUpdate({ delay_hours: v })} />
        <DelayUnit value={step.delay_minutes || 0} unit="m" onChange={(v) => onUpdate({ delay_minutes: v })} />

        <div className="flex items-center gap-px ml-1 opacity-0 group-hover/chip:opacity-100 focus-within:opacity-100 transition-opacity">
          <button type="button" onClick={onMoveUp} disabled={isFirst} title="Move up" aria-label="Move wait up"
            className="inline-flex min-h-6 min-w-6 items-center justify-center p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onMoveDown} disabled={isLast} title="Move down" aria-label="Move wait down"
            className="inline-flex min-h-6 min-w-6 items-center justify-center p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onRemove} title="Remove delay" aria-label="Remove wait"
            className="inline-flex min-h-6 min-w-6 items-center justify-center p-1 rounded text-[var(--text-tertiary)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function FlowBuilder({ steps, onStepsChange, onEditStep, editingStep, campaignId }: FlowBuilderProps) {
  const makeStep = (type: StepType): FlowStep => ({
    _clientKey: `step-${crypto.randomUUID()}`,
    step_type: type,
    step_order: steps.length,
    subject: type === StepType.Email ? '' : undefined,
    body_html: type === StepType.Email ? '' : undefined,
    delay_days: type === StepType.Delay ? 3 : 0,
    delay_hours: 0,
    delay_minutes: 0,
    skip_if_replied: type === StepType.Email ? true : undefined,
    condition_field: undefined,
    condition_operator: undefined,
    condition_value: type === StepType.Condition ? '' : undefined,
    webhook_event: type === StepType.WebhookWait ? '' : undefined,
    webhook_timeout_hours: type === StepType.WebhookWait ? 72 : undefined,
    // An invite carries a note; a message carries plain text (LinkedIn has no
    // subject and no HTML); a visit carries nothing at all.
    linkedin_note: type === StepType.LinkedinConnect ? '' : undefined,
    body_text: type === StepType.LinkedinMessage ? '' : undefined,
  });

  // Condition steps store true_branch_step/false_branch_step as raw array
  // indices — removing or reordering steps without remapping them leaves
  // existing conditions silently pointed at the wrong step (or one that no
  // longer exists).
  const remapConditionBranches = useCallback(
    (newSteps: FlowStep[], remap: (value: number) => number | null) =>
      newSteps.map((s) =>
        s.step_type === StepType.Condition
          ? {
              ...s,
              true_branch_step: s.true_branch_step != null ? remap(s.true_branch_step) ?? undefined : s.true_branch_step,
              false_branch_step: s.false_branch_step != null ? remap(s.false_branch_step) ?? undefined : s.false_branch_step,
            }
          : s
      ),
    []
  );

  const addStep = useCallback((type: StepType, atIndex?: number) => {
    const insertAt = atIndex ?? steps.length;
    const newStep = makeStep(type);

    // Built-in timing lives ON the email step itself: a follow-up defaults to
    // "3 days after the previous step" (editable right on the card, down to 0
    // for immediate). The first email always sends at launch.
    if (type === StepType.Email && insertAt > 0) {
      newStep.delay_days = 3;
    }
    // A LinkedIn touch straight after an email reads as coordinated rather
    // than automated if it waits a day.
    if (isLinkedinStep(type) && insertAt > 0) {
      newStep.delay_days = 1;
    }

    const newSteps = [...steps];
    newSteps.splice(insertAt, 0, newStep);
    // Inserting shifts every existing step at/after insertAt up by one, so
    // any condition branch pointing there must shift too — same reason
    // removeStep/moveStep remap below.
    const remapped = remapConditionBranches(newSteps, (value) =>
      value >= insertAt ? value + 1 : value
    );
    onStepsChange(remapped);
    if (editingStep !== null && editingStep >= insertAt) onEditStep(editingStep + 1);
    if (
      type === StepType.Email || type === StepType.Condition ||
      type === StepType.WebhookWait ||
      type === StepType.LinkedinConnect || type === StepType.LinkedinMessage
    ) {
      onEditStep(insertAt);
    }
  }, [steps, onStepsChange, onEditStep, editingStep, remapConditionBranches]);

  const removeStep = useCallback((index: number) => {
    const remapped = remapConditionBranches(
      steps.filter((_, i) => i !== index),
      (value) => {
        if (value === index) return null; // the target step was deleted
        return value > index ? value - 1 : value;
      }
    );
    onStepsChange(remapped);
    // Keep the editor pointed at the same step after the indices shift down.
    if (editingStep === index) onEditStep(-1);
    else if (editingStep !== null && editingStep > index) onEditStep(editingStep - 1);
  }, [steps, onStepsChange, editingStep, onEditStep, remapConditionBranches]);

  const moveStep = useCallback((from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    const newSteps = [...steps];
    const [moved] = newSteps.splice(from, 1);
    newSteps.splice(to, 0, moved);
    const remapped = remapConditionBranches(newSteps, (value) => {
      if (value === from) return to;
      if (from < to) return value > from && value <= to ? value - 1 : value;
      return value >= to && value < from ? value + 1 : value;
    });
    onStepsChange(remapped);
    // Remap the edited step's index to follow the reorder.
    if (editingStep === from) onEditStep(to);
    else if (editingStep !== null && editingStep > from && editingStep <= to) onEditStep(editingStep - 1);
    else if (editingStep !== null && editingStep < from && editingStep >= to) onEditStep(editingStep + 1);
  }, [steps, onStepsChange, editingStep, onEditStep, remapConditionBranches]);

  const updateStep = useCallback((index: number, updates: Partial<FlowStep>) => {
    onStepsChange(steps.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  }, [steps, onStepsChange]);

  if (steps.length === 0) {
    return (
      <div className="py-10 grid grid-cols-[64px_1fr] gap-4">
        <span className="pt-0.5 text-right text-caption font-medium text-[var(--text-tertiary)]">Day 1</span>
        {/* A blank page with a first line to write - not a menu of node types. */}
        <div className="max-w-md">
          <p className="text-heading font-semibold text-[var(--text-primary)]">Start with the first email</p>
          <p className="mt-1 text-body text-[var(--text-secondary)]">
            It goes out the day someone is added. Follow-ups, waits and LinkedIn steps come after it.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => addStep(StepType.Email)}
              className="btn-primary"
            >
              <Mail className="h-3.5 w-3.5" /> Write the first email
            </button>
            <button type="button" onClick={() => addStep(StepType.LinkedinConnect)} className="btn-ghost">
              <Linkedin className="h-3.5 w-3.5" /> Start on LinkedIn
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Cumulative day-offset for each step (sum of delays preceding it), plus
  // overall sequence stats shown in the summary chip.
  const dayOffsets: number[] = [];
  let cumulative = 0;
  // (email steps add their own built-in wait BEFORE they fire; delay nodes
  // add theirs AFTER — both feed the Day-N badges below; a webhook-wait node
  // can hold a contact up to its timeout, so it adds its worst-case duration
  // AFTER too, the same way a delay node does)
  steps.forEach((step, i) => {
    // Built-in waits (email and LinkedIn steps both carry one — see
    // isLinkedinStep in the sequence/email-sender engine) count only when no
    // Wait node sits directly above (the engine gives explicit Wait nodes
    // precedence over built-in timing).
    if ((step.step_type === 'email' || isLinkedinStep(step.step_type)) && steps[i - 1]?.step_type !== 'delay') {
      cumulative += stepDelayInDays(step);
    }
    dayOffsets.push(Math.round(cumulative));
    if (step.step_type === 'delay') cumulative += stepDelayInDays(step);
    if (step.step_type === 'webhook_wait') cumulative += (step.webhook_timeout_hours || 72) / 24;
  });
  const emailCount = steps.filter((s) => s.step_type === 'email').length;
  const totalDays = Math.round(cumulative);

  return (
    <div className="relative py-2">
      {/* The timeline: one rule down the margin, between the days and the words. */}
      <span aria-hidden className="pointer-events-none absolute left-[72px] top-6 bottom-14 w-px bg-[var(--border-subtle)]" />
      {emailCount > 0 && (
        <div className="grid grid-cols-[64px_1fr] gap-4 pb-3">
          <span />
          <p className="text-caption text-[var(--text-tertiary)]">
            {emailCount} email{emailCount !== 1 ? 's' : ''}
            {totalDays > 0 && <> over {totalDays + 1} days</>}, stopping for anyone who replies.
          </p>
        </div>
      )}

      {/* Steps */}
      {steps.map((step, index) => (
        <div key={step.id || step._clientKey}>
          {/* Add step between nodes */}
          <AddStepMenu onAdd={(type) => addStep(type, index)} />

          {/* Delays render as compact inline chips; everything else is a card */}
          {step.step_type === 'delay' ? (
            <DelayChip
              step={step}
              isFirst={index === 0}
              isLast={index === steps.length - 1}
              onRemove={() => removeStep(index)}
              onMoveUp={() => moveStep(index, index - 1)}
              onMoveDown={() => moveStep(index, index + 1)}
              onUpdate={(updates) => updateStep(index, updates)}
            />
          ) : (
            <FlowNode
              step={step}
              index={index}
              totalSteps={steps.length}
              dayOffset={dayOffsets[index]}
              timedByDelayNode={steps[index - 1]?.step_type === 'delay'}
              isEditing={editingStep === index}
              onEdit={() => onEditStep(editingStep === index ? -1 : index)}
              onRemove={() => removeStep(index)}
              onMoveUp={() => moveStep(index, index - 1)}
              onMoveDown={() => moveStep(index, index + 1)}
              onUpdate={(updates) => updateStep(index, updates)}
              campaignId={campaignId}
            />
          )}
        </div>
      ))}

      {/* Add step at end */}
      <AddStepMenu onAdd={(type) => addStep(type)} showAbove last />
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignsApi } from '../../api/campaigns.api';
import { smtpApi } from '../../api/smtp.api';
import { contactsApi, listsApi } from '../../api/contacts.api';
import { sendingSchedulesApi, type SendingSchedule } from '../../api/sending-schedules.api';
import { templateApi } from '../../api/template.api';
import { apiClient } from '../../api/client';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { StatCard } from '../../components/shared/StatCard';
import { Avatar } from '../../components/shared/Avatar';
import { FlowBuilder } from '../../components/campaigns/FlowBuilder';
import { PersonalizationDropdown } from '../../components/campaigns/PersonalizationDropdown';
import type { FlowStep } from '../../components/campaigns/FlowBuilder';
import { cn } from '../../lib/utils';
import {
  ArrowLeft,
  Mail,
  Clock,
  Save,
  Users,
  Check,
  Settings,
  Layers,
  UserPlus,
  CheckCircle2,
  Search,
  Building2,
  ChevronRight,
  SkipForward,
  Gauge,
  Shield,
  Eye,
  MousePointerClick,
  MessageSquare,
  Send,
  AlertTriangle,
  Rocket,
  RotateCcw,
  Plus,
  FolderOpen,
  ListPlus,
  Sparkles,
  Loader2,
  X,
  Timer,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  CreateCampaignInput,
  CreateStepInput,
  CampaignStep,
  SmtpAccount,
  ContactWithTags,
} from '@lemlist/shared';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const WIZARD_STEPS = [
  { label: 'Settings', icon: Settings },
  { label: 'Sequence', icon: Layers },
  { label: 'Contacts', icon: Users },
  { label: 'Review', icon: Rocket },
];

function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  icon: Icon,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
  icon?: any;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] cursor-pointer hover:border-[var(--border-default)] transition-all select-none"
    >
      <div className="flex items-center gap-3">
        {Icon && (
          <Icon className={`h-4 w-4 flex-shrink-0 transition-colors ${checked ? 'text-[#6366F1]' : 'text-[var(--text-tertiary)]'}`} />
        )}
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
          <p className="text-xs text-[var(--text-tertiary)]">{description}</p>
        </div>
      </div>
      <div
        className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
          checked ? 'bg-gradient-to-r from-[#6366F1] to-[#8B5CF6]' : 'bg-[var(--border-default)]'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </div>
    </div>
  );
}

export function CampaignCreatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const [campaignForm, setCampaignForm] = useState<CreateCampaignInput>({
    name: '',
    timezone: 'UTC',
    send_window_start: '00:00',
    send_window_end: '23:59',
    send_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    daily_limit: 50,
    delay_between_emails_min: 50,
    delay_between_emails_max: 200,
    stop_on_reply: true,
    track_opens: true,
    track_clicks: true,
    include_unsubscribe: false,
  });

  const [steps, setSteps] = useState<FlowStep[]>([]);
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [contactModalTab, setContactModalTab] = useState<'individual' | 'lists'>('individual');
  const [wizardStep, setWizardStep] = useState(0);

  const [senderPoolIds, setSenderPoolIds] = useState<string[]>([]);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [activeField, setActiveField] = useState<'subject' | 'body'>('body');
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiGoal, setAiGoal] = useState('');
  const [aiTone, setAiTone] = useState('professional');
  const [aiProduct, setAiProduct] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);

  const { data: existingCampaign, isLoading: loadingCampaign } = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => campaignsApi.get(id!),
    enabled: isEdit,
  });

  const { data: existingSenderPool } = useQuery({
    queryKey: ['sender-pool', id],
    queryFn: () => campaignsApi.getSenderPool(id!),
    enabled: isEdit,
  });

  const { data: smtpAccounts } = useQuery({
    queryKey: ['smtp-accounts'],
    queryFn: smtpApi.list,
  });

  const { data: contactsData } = useQuery({
    queryKey: ['contacts', 'select', contactSearch],
    queryFn: () => contactsApi.list({ limit: 50, search: contactSearch || undefined }),
  });

  const { data: allLists } = useQuery({
    queryKey: ['lists'],
    queryFn: listsApi.list,
  });

  // Saved sending schedules
  const { data: savedSchedules = [] } = useQuery({
    queryKey: ['sending-schedules'],
    queryFn: sendingSchedulesApi.list,
  });

  // Sequence templates (for "Load from template")
  const { data: sequenceTemplates = [] } = useQuery({
    queryKey: ['templates', 'sequences'],
    queryFn: templateApi.listSequences,
  });

  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Map saved schedule day codes ('mon','tue',…) to full names used here
  const expandDayCode = (code: string): string => {
    const map: Record<string, string> = {
      mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday',
      fri: 'friday', sat: 'saturday', sun: 'sunday',
    };
    return map[code] || code;
  };

  const applySchedule = (s: SendingSchedule) => {
    setCampaignForm((prev: any) => ({
      ...prev,
      timezone: s.timezone,
      send_window_start: s.send_window_start,
      send_window_end: s.send_window_end,
      send_days: (s.send_days || []).map(expandDayCode),
    }));
    toast.success(`Applied schedule "${s.name}"`);
  };

  // Auto-apply default schedule when creating a new campaign
  useEffect(() => {
    if (!isEdit && savedSchedules.length > 0) {
      const def = savedSchedules.find((s) => s.is_default);
      if (def) {
        setCampaignForm((prev: any) => ({
          ...prev,
          timezone: prev.timezone === 'UTC' ? def.timezone : prev.timezone,
          send_window_start: prev.send_window_start === '00:00' ? def.send_window_start : prev.send_window_start,
          send_window_end:   prev.send_window_end   === '23:59' ? def.send_window_end   : prev.send_window_end,
          send_days: (def.send_days || []).map(expandDayCode),
        }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSchedules.length, isEdit]);

  const loadTemplate = (templateId: string) => {
    const t = sequenceTemplates.find((x) => x.id === templateId);
    if (!t || !t.steps || !Array.isArray(t.steps)) {
      toast.error('Template has no steps');
      return;
    }
    const newSteps: FlowStep[] = (t.steps as any[]).map((s: any, i: number) => ({
      step_type: s.step_type || 'email',
      step_order: i,
      delay_days: s.delay_days || 0,
      delay_hours: s.delay_hours || 0,
      delay_minutes: s.delay_minutes || 0,
      subject: s.subject || '',
      body_html: s.body_html || '',
      body_text: s.body_text || '',
    }));
    setSteps(newSteps);
    setShowTemplatePicker(false);
    toast.success(`Loaded "${t.name}" — ${newSteps.length} step${newSteps.length === 1 ? '' : 's'}`);
  };

  const [addingListId, setAddingListId] = useState<string | null>(null);
  const addListContacts = async (listId: string) => {
    setAddingListId(listId);
    try {
      const contactIds = await listsApi.getContacts(listId);
      if (contactIds.length === 0) {
        toast.error('This list has no contacts');
        setAddingListId(null);
        return;
      }
      setSelectedContactIds((prev) => {
        const set = new Set(prev);
        for (const cid of contactIds) set.add(cid);
        return Array.from(set);
      });
      const listName = (allLists || []).find((l: any) => l.id === listId)?.name || 'list';
      toast.success(`Added ${contactIds.length} contacts from "${listName}"`);
    } catch {
      toast.error('Failed to load list contacts');
    }
    setAddingListId(null);
  };

  const { data: campaignContacts } = useQuery({
    queryKey: ['campaign-contacts', id],
    queryFn: () => campaignsApi.getContacts(id!, { limit: 100 }),
    enabled: isEdit,
  });

  useEffect(() => {
    if (existingCampaign) {
      setCampaignForm({
        name: existingCampaign.name,
        smtp_account_id: existingCampaign.smtp_account_id || undefined,
        timezone: existingCampaign.timezone,
        send_window_start: existingCampaign.send_window_start || '09:00',
        send_window_end: existingCampaign.send_window_end || '17:00',
        send_days: existingCampaign.send_days,
        daily_limit: existingCampaign.daily_limit ?? 50,
        delay_between_emails_min:
          existingCampaign.delay_between_emails_min ??
          existingCampaign.delay_between_emails ??
          50,
        delay_between_emails_max:
          existingCampaign.delay_between_emails_max ??
          existingCampaign.delay_between_emails ??
          200,
        stop_on_reply: existingCampaign.stop_on_reply ?? true,
        track_opens: existingCampaign.track_opens ?? true,
        track_clicks: existingCampaign.track_clicks ?? true,
        include_unsubscribe: existingCampaign.include_unsubscribe ?? false,
      });
      if (existingCampaign.steps) {
        setSteps(
          existingCampaign.steps.map((s: CampaignStep) => ({
            id: s.id,
            step_type: s.step_type,
            step_order: s.step_order,
            subject: s.subject || '',
            body_html: s.body_html || '',
            body_text: s.body_text || '',
            delay_days: s.delay_days,
            delay_hours: s.delay_hours,
            delay_minutes: s.delay_minutes,
            skip_if_replied: s.skip_if_replied,
          }))
        );
      }
    }
  }, [existingCampaign]);

  useEffect(() => {
    if (campaignContacts?.data) {
      setSelectedContactIds(campaignContacts.data.map((cc: any) => cc.contact_id));
    }
  }, [campaignContacts]);

  useEffect(() => {
    if (existingSenderPool && existingSenderPool.length > 0) {
      setSenderPoolIds(existingSenderPool);
    }
  }, [existingSenderPool]);

  const [launching, setLaunching] = useState(false);
  const [showLaunchConfirm, setShowLaunchConfirm] = useState(false);

  const saveCampaign = async (): Promise<string | null> => {
    try {
      const campaign = isEdit
        ? await campaignsApi.update(id!, campaignForm)
        : await campaignsApi.create(campaignForm);
      const campaignId = isEdit ? id! : campaign.id;

      // Delete steps that have been removed from the sequence during editing.
      if (isEdit && existingCampaign?.steps) {
        const currentStepIds = new Set(steps.map(s => s.id).filter(Boolean));
        const stepsToDelete = (existingCampaign.steps as CampaignStep[]).filter(s => !currentStepIds.has(s.id));
        for (const step of stepsToDelete) {
          await campaignsApi.deleteStep(campaignId, step.id);
        }
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepData = { ...step, step_order: i };
        if (step.id && isEdit) {
          await campaignsApi.updateStep(campaignId, step.id, stepData);
        } else {
          await campaignsApi.addStep(campaignId, stepData);
        }
      }

      // Persist sender rotation pool (previously UI-only, never saved)
      await campaignsApi.setSenderPool(campaignId, senderPoolIds);

      if (selectedContactIds.length > 0) {
        await campaignsApi.addContacts(campaignId, selectedContactIds);
      }

      return campaignId;
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save');
      return null;
    }
  };

  const createCampaignMutation = useMutation({
    mutationFn: (input: CreateCampaignInput) =>
      isEdit ? campaignsApi.update(id!, input) : campaignsApi.create(input),
    onSuccess: async (campaign) => {
      const campaignId = isEdit ? id! : campaign.id;

      // Delete steps that have been removed from the sequence during editing.
      if (isEdit && existingCampaign?.steps) {
        const currentStepIds = new Set(steps.map(s => s.id).filter(Boolean));
        const stepsToDelete = (existingCampaign.steps as CampaignStep[]).filter(s => !currentStepIds.has(s.id));
        for (const step of stepsToDelete) {
          await campaignsApi.deleteStep(campaignId, step.id);
        }
      }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepData = { ...step, step_order: i };
        if (step.id && isEdit) {
          await campaignsApi.updateStep(campaignId, step.id, stepData);
        } else {
          await campaignsApi.addStep(campaignId, stepData);
        }
      }

      // Persist sender rotation pool
      await campaignsApi.setSenderPool(campaignId, senderPoolIds);

      if (selectedContactIds.length > 0) {
        await campaignsApi.addContacts(campaignId, selectedContactIds);
      }

      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success(isEdit ? 'Campaign updated' : 'Campaign created');
      navigate(`/campaigns/${campaignId}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save'),
  });

  const handleSaveAndLaunch = async () => {
    if (!campaignForm.name) {
      toast.error('Campaign name is required');
      setWizardStep(0);
      return;
    }
    setLaunching(true);
    try {
      const campaignId = await saveCampaign();
      if (!campaignId) {
        setLaunching(false);
        return;
      }
      await campaignsApi.launch(campaignId);
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Campaign launched!');
      navigate(`/campaigns/${campaignId}`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to launch');
    }
    setLaunching(false);
    setShowLaunchConfirm(false);
  };

  const updateStep = (index: number, updates: Partial<CreateStepInput>) => {
    setSteps(steps.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  };

  const handleGenerateEmail = async () => {
    if (!aiGoal || editingStep === null) return;
    setAiGenerating(true);
    try {
      const { data } = await apiClient.post('/sara/generate-email', {
        goal: aiGoal,
        tone: aiTone,
        product: aiProduct,
      });
      updateStep(editingStep, { subject: data.subject, body_html: data.body_html });
      setShowAiModal(false);
      setAiGoal('');
      toast.success('Email generated');
    } catch {
      toast.error('Generation failed');
    } finally {
      setAiGenerating(false);
    }
  };

  const toggleContact = (contactId: string) => {
    setSelectedContactIds((prev) =>
      prev.includes(contactId) ? prev.filter((cid) => cid !== contactId) : [...prev, contactId]
    );
  };

  const handleSave = () => {
    if (!campaignForm.name) {
      toast.error('Campaign name is required');
      setWizardStep(0);
      return;
    }
    createCampaignMutation.mutate(campaignForm);
  };

  const insertPersonalization = (tag: string) => {
    if (editingStep === null) return;
    const step = steps[editingStep];
    if (!step || step.step_type !== 'email') return;

    if (activeField === 'subject') {
      const input = subjectRef.current;
      if (input) {
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const current = step.subject || '';
        const newValue = current.slice(0, start) + tag + current.slice(end);
        updateStep(editingStep, { subject: newValue });
        setTimeout(() => {
          input.selectionStart = input.selectionEnd = start + tag.length;
          input.focus();
        }, 0);
      }
    } else {
      const textarea = bodyRef.current;
      if (textarea) {
        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        const current = step.body_html || '';
        const newValue = current.slice(0, start) + tag + current.slice(end);
        updateStep(editingStep, { body_html: newValue });
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + tag.length;
          textarea.focus();
        }, 0);
      }
    }
  };

  if (isEdit && loadingCampaign) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const contacts = contactsData?.data || [];

  /* ─────────────────────── shared input class ─────────────────────── */
  const inputCls =
    'w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[#6366F1] focus:outline-none focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all';

  /* ─────────────────────── card header ─────────────────────── */
  const CardHeader = ({
    icon: Icon,
    title,
    subtitle,
    action,
  }: {
    icon: any;
    title: string;
    subtitle: string;
    action?: React.ReactNode;
  }) => (
    <div className="px-6 py-5 border-b border-[var(--border-subtle)] flex items-center gap-3">
      <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] flex items-center justify-center text-white flex-shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wide">{title}</h2>
        <p className="text-xs text-[var(--text-tertiary)]">{subtitle}</p>
      </div>
      {action}
    </div>
  );

  return (
    <div className="pb-16">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between mb-8 gap-4">
        <button
          onClick={() => navigate('/campaigns')}
          className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group flex-shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
          Campaigns
        </button>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] flex-shrink-0">
            <Rocket className="h-3.5 w-3.5 text-white" />
          </span>
          <h1 className="text-[15px] font-semibold text-[var(--text-primary)] truncate">
            {isEdit ? 'Edit Campaign' : 'New Campaign'}
          </h1>
          {campaignForm.name && (
            <span className="hidden sm:inline px-2 py-0.5 h-[18px] rounded-[4px] bg-[var(--bg-elevated)] text-[var(--text-secondary)] text-[10.5px] font-medium truncate max-w-[180px] border border-[var(--border-subtle)]">
              {campaignForm.name}
            </span>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={handleSave} disabled={createCampaignMutation.isPending}>
          <Save className="h-3.5 w-3.5" />
          {createCampaignMutation.isPending ? 'Saving…' : 'Save Draft'}
        </Button>
      </div>

      {/* ── Wizard Progress Indicator ── */}
      <div className="mb-10">
        <div className="flex items-start justify-center">
          {WIZARD_STEPS.map((ws, i) => {
            const Icon = ws.icon;
            const isCompleted = i < wizardStep;
            const isCurrent = i === wizardStep;
            return (
              <div key={ws.label} className="flex items-start">
                <button
                  onClick={() => setWizardStep(i)}
                  className="flex flex-col items-center gap-2 group min-w-[80px]"
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200 ${
                      isCompleted
                        ? 'bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-white shadow-[0_2px_8px_rgba(99,102,241,0.3)]'
                        : isCurrent
                        ? 'bg-gradient-to-br from-[#6366F1] to-[#8B5CF6] text-white shadow-[0_2px_8px_rgba(99,102,241,0.3)] ring-4 ring-[rgba(99,102,241,0.2)]'
                        : 'bg-[var(--bg-elevated)] border-2 border-[var(--border-default)] text-[var(--text-tertiary)]'
                    }`}
                  >
                    {isCompleted ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  </div>
                  <span
                    className={`text-xs whitespace-nowrap transition-colors ${
                      isCurrent
                        ? 'text-[#6366F1] font-semibold'
                        : isCompleted
                        ? 'text-[var(--text-secondary)] font-medium'
                        : 'text-[var(--text-tertiary)]'
                    }`}
                  >
                    {ws.label}
                  </span>
                </button>
                {i < WIZARD_STEPS.length - 1 && (
                  <div
                    className={`min-w-[48px] h-[2px] mt-5 mx-1 transition-colors duration-500 ${
                      i < wizardStep ? 'bg-gradient-to-r from-[#6366F1] to-[#8B5CF6]' : 'bg-[var(--border-subtle)]'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          STEP 1 — Campaign Settings
      ════════════════════════════════════════════════════════ */}
      {wizardStep === 0 && (
        <div className="max-w-4xl mx-auto space-y-5">

          {/* Campaign Identity */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-card">
            <CardHeader icon={Rocket} title="Campaign Identity" subtitle="Name your campaign and choose your sending account" />
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                  Campaign Name
                </label>
                <input
                  type="text"
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                  placeholder="e.g., Q1 Enterprise Outreach"
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 text-[var(--text-primary)] text-base font-medium placeholder:text-[var(--text-tertiary)] focus:border-[#6366F1] focus:outline-none focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                  Primary Sending Account
                </label>
                <select
                  value={campaignForm.smtp_account_id || ''}
                  onChange={(e) =>
                    setCampaignForm({ ...campaignForm, smtp_account_id: e.target.value || undefined })
                  }
                  className={inputCls}
                >
                  <option value="">Select an SMTP account…</option>
                  {(smtpAccounts || []).map((a: SmtpAccount) => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {a.email_address}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sender Rotation */}
              {(smtpAccounts || []).length > 1 && (
                <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <RotateCcw className="h-4 w-4 text-[var(--text-secondary)]" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Sender Rotation</h3>
                    <span className="px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-tertiary)] text-xs">
                      Optional
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mb-3">
                    Distribute sends across multiple accounts to protect reputation and boost deliverability.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(smtpAccounts || []).map((a: SmtpAccount) => {
                      const isSelected = senderPoolIds.includes(a.id);
                      return (
                        <label
                          key={a.id}
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${
                            isSelected
                              ? 'bg-[var(--bg-elevated)] border-[var(--border-default)]'
                              : 'bg-[var(--bg-elevated)] border-transparent hover:border-[var(--border-subtle)]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) setSenderPoolIds([...senderPoolIds, a.id]);
                              else setSenderPoolIds(senderPoolIds.filter((id) => id !== a.id));
                            }}
                            className="h-4 w-4 rounded border-[var(--border-default)] accent-[#6366F1]"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{a.label}</p>
                            <p className="text-xs text-[var(--text-tertiary)]">
                              {a.email_address} · {a.daily_send_limit}/day
                            </p>
                          </div>
                          <span className={cn(
                            'inline-flex items-center px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold flex-shrink-0',
                            a.health_score >= 80
                              ? 'bg-emerald-500/10 text-emerald-700'
                              : a.health_score >= 50
                              ? 'bg-amber-500/10 text-amber-700'
                              : 'bg-rose-500/10 text-rose-700'
                          )}>
                            {a.health_score}%
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Schedule + Rate Controls — two columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Sending Schedule */}
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-card">
              <CardHeader
                icon={Clock}
                title="Sending Schedule"
                subtitle="When emails will be delivered"
                action={
                  <Link to="/schedules" className="text-[10px] font-medium text-[#6366F1] hover:underline">Manage saved →</Link>
                }
              />
              <div className="p-6 space-y-4">
                {savedSchedules.length > 0 && (
                  <div className="rounded-lg border border-[#6366F1]/20 bg-[#6366F1]/5 p-3">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-[#6366F1] mb-1.5">
                      Quick apply saved schedule
                    </label>
                    <select
                      onChange={(e) => {
                        const s = savedSchedules.find((x) => x.id === e.target.value);
                        if (s) applySchedule(s);
                        e.target.value = '';
                      }}
                      className={inputCls}
                      defaultValue=""
                    >
                      <option value="" disabled>Choose a schedule...</option>
                      {savedSchedules.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.is_default ? ' (default)' : ''} — {s.send_window_start}–{s.send_window_end} {s.timezone}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                    Timezone
                  </label>
                  <input
                    type="text"
                    value={campaignForm.timezone || 'UTC'}
                    onChange={(e) => setCampaignForm({ ...campaignForm, timezone: e.target.value })}
                    className={inputCls}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                      Start
                    </label>
                    <input
                      type="time"
                      value={campaignForm.send_window_start || '09:00'}
                      onChange={(e) =>
                        setCampaignForm({ ...campaignForm, send_window_start: e.target.value })
                      }
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                      End
                    </label>
                    <input
                      type="time"
                      value={campaignForm.send_window_end || '17:00'}
                      onChange={(e) =>
                        setCampaignForm({ ...campaignForm, send_window_end: e.target.value })
                      }
                      className={inputCls}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                    Active Days
                  </label>
                  <div className="flex gap-1.5">
                    {DAYS.map((day, i) => {
                      const isActive = (campaignForm.send_days || []).includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            const current = campaignForm.send_days || [];
                            setCampaignForm({
                              ...campaignForm,
                              send_days: isActive
                                ? current.filter((d: string) => d !== day)
                                : [...current, day],
                            });
                          }}
                          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                            isActive
                              ? 'bg-[#6366F1] text-white shadow-sm'
                              : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                          }`}
                        >
                          {DAY_LABELS[i]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Rate Controls */}
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-card">
              <CardHeader icon={Gauge} title="Rate Controls" subtitle="Protect your sender reputation" />
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                    Daily Limit
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      value={campaignForm.daily_limit ?? 50}
                      onChange={(e) =>
                        setCampaignForm({ ...campaignForm, daily_limit: parseInt(e.target.value) || 0 })
                      }
                      className={inputCls}
                    />
                    <span className="text-xs text-[var(--text-tertiary)] whitespace-nowrap">/ day</span>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1.5">Set 0 for unlimited sends.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                    Delay Between Emails
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      value={campaignForm.delay_between_emails_min ?? 50}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          delay_between_emails_min: parseInt(e.target.value) || 0,
                        })
                      }
                      className={inputCls}
                    />
                    <span className="text-xs font-medium text-[var(--text-tertiary)]">to</span>
                    <input
                      type="number"
                      min="0"
                      value={campaignForm.delay_between_emails_max ?? 200}
                      onChange={(e) =>
                        setCampaignForm({
                          ...campaignForm,
                          delay_between_emails_max: parseInt(e.target.value) || 0,
                        })
                      }
                      className={inputCls}
                    />
                    <span className="text-xs text-[var(--text-tertiary)] whitespace-nowrap">sec</span>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
                    Random delay added between each individual send.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Behaviour Toggles */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-card">
            <CardHeader
              icon={Shield}
              title="Behaviour & Tracking"
              subtitle="Control how your campaign responds and what data it collects"
            />
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ToggleSwitch
                checked={campaignForm.stop_on_reply !== false}
                onChange={(v) => setCampaignForm({ ...campaignForm, stop_on_reply: v })}
                label="Stop on Reply"
                description="Pause sending when a contact replies"
                icon={MessageSquare}
              />
              <ToggleSwitch
                checked={campaignForm.track_opens !== false}
                onChange={(v) => setCampaignForm({ ...campaignForm, track_opens: v })}
                label="Track Opens"
                description="Detect when recipients open your emails"
                icon={Eye}
              />
              <ToggleSwitch
                checked={campaignForm.track_clicks !== false}
                onChange={(v) => setCampaignForm({ ...campaignForm, track_clicks: v })}
                label="Track Clicks"
                description="Monitor click-throughs on your links"
                icon={MousePointerClick}
              />
              <ToggleSwitch
                checked={campaignForm.include_unsubscribe === true}
                onChange={(v) => setCampaignForm({ ...campaignForm, include_unsubscribe: v })}
                label="Unsubscribe Link"
                description="Add a footer opt-out link to all emails"
                icon={Mail}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end pt-2">
            <Button onClick={() => setWizardStep(1)} className="bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white shadow-[0_2px_8px_rgba(99,102,241,0.3)] hover:opacity-95 hover:shadow-[0_4px_12px_rgba(99,102,241,0.4)]">
              Continue to Sequence
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          STEP 2 — Sequence Builder
      ════════════════════════════════════════════════════════ */}
      {wizardStep === 1 && (
        <div className="space-y-4">
          {/* Quick action bar */}
          {steps.length === 0 && sequenceTemplates.length > 0 && (
            <div className="rounded-xl border border-[#6366F1]/20 bg-[#6366F1]/5 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#6366F1]/10 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-[#6366F1]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Start from a template</p>
                  <p className="text-xs text-[var(--text-secondary)]">Apply one of your saved sequences to skip building from scratch.</p>
                </div>
              </div>
              <button onClick={() => setShowTemplatePicker(true)} className="btn-primary text-xs px-4 py-2">
                <FolderOpen className="h-3.5 w-3.5" /> Browse templates
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Flow Canvas */}
            <div className="lg:col-span-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-card flex flex-col">
              <CardHeader
                icon={Layers}
                title="Campaign Sequence"
                subtitle="Build the email flow your contacts will experience"
                action={
                  <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
                    {sequenceTemplates.length > 0 && (
                      <button
                        onClick={() => setShowTemplatePicker(true)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[#6366F1] transition-colors"
                      >
                        <FolderOpen className="h-3 w-3" /> Apply template
                      </button>
                    )}
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {steps.filter((s) => s.step_type === 'email').length} emails
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {steps.filter((s) => s.step_type === 'delay').length} delays
                    </span>
                  </div>
                }
              />
              <div className="flex-1 p-4 min-h-[420px] overflow-y-auto">
                <FlowBuilder
                  steps={steps}
                  onStepsChange={setSteps}
                  onEditStep={(i) => setEditingStep(i === -1 ? null : i)}
                  editingStep={editingStep}
                />
              </div>
            </div>

            {/* Editor Panel */}
            <div className="lg:col-span-2">
              {editingStep !== null && steps[editingStep]?.step_type === 'email' ? (
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] sticky top-20 overflow-hidden">
                  <div className="px-5 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Mail className="h-4 w-4 text-[var(--text-tertiary)]" />
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]">Email Editor</p>
                        <p className="text-xs text-[var(--text-tertiary)]">
                          Step {(editingStep ?? 0) + 1} of {steps.length}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAiModal(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-xs font-semibold hover:opacity-90 transition-all"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Generate with AI
                      </button>
                      <PersonalizationDropdown onInsert={insertPersonalization} />
                    </div>
                  </div>

                  <div className="p-5 space-y-4">
                    {/* Subject */}
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                        Subject Line
                      </label>
                      <input
                        ref={subjectRef}
                        type="text"
                        value={steps[editingStep].subject || ''}
                        onChange={(e) => updateStep(editingStep, { subject: e.target.value })}
                        onFocus={() => setActiveField('subject')}
                        placeholder="e.g., Quick question about {{company}}"
                        className={inputCls}
                      />
                      {(() => {
                        const len = (steps[editingStep].subject || '').length;
                        if (len === 0) return null;
                        const quality =
                          len >= 30 && len <= 60
                            ? { label: 'Great length', color: 'text-green-500' }
                            : len < 30
                            ? { label: 'Too short', color: 'text-amber-500' }
                            : len <= 80
                            ? { label: 'A bit long', color: 'text-amber-500' }
                            : { label: 'Too long — may truncate', color: 'text-red-400' };
                        return (
                          <div className="flex items-center justify-between mt-1.5 px-1">
                            <span className={`text-[11px] font-medium ${quality.color}`}>{quality.label}</span>
                            <span className={`text-[11px] tabular-nums ${quality.color}`}>{len} / 80</span>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Body */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                          Email Body
                        </label>
                        <PersonalizationDropdown onInsert={insertPersonalization} variant="icon" />
                      </div>
                      <textarea
                        ref={bodyRef}
                        value={steps[editingStep].body_html || ''}
                        onChange={(e) => updateStep(editingStep, { body_html: e.target.value })}
                        onFocus={() => setActiveField('body')}
                        placeholder={`<p>Hi {{first_name}},</p>\n\n<p>I noticed that {{company}} is…</p>`}
                        className="w-full min-h-[200px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[#6366F1] focus:outline-none focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all font-mono resize-y"
                      />
                      {(() => {
                        const rawText = (steps[editingStep].body_html || '')
                          .replace(/<[^>]*>/g, ' ')
                          .replace(/\s+/g, ' ')
                          .trim();
                        const words = rawText ? rawText.split(/\s+/).filter(Boolean).length : 0;
                        if (words === 0) return null;
                        const quality =
                          words <= 100
                            ? { label: 'Concise length', color: 'text-green-500' }
                            : words <= 200
                            ? { label: 'Good length', color: 'text-amber-500' }
                            : { label: 'Long — consider trimming', color: 'text-red-400' };
                        return (
                          <div className="flex items-center justify-between mt-1.5 px-1">
                            <span className={`text-[11px] font-medium ${quality.color}`}>{quality.label}</span>
                            <span className="text-[11px] tabular-nums text-[var(--text-tertiary)]">{words} words</span>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Recipient inbox preview */}
                    {steps[editingStep].body_html && (
                      <RecipientPreview
                        subject={steps[editingStep].subject || '(no subject)'}
                        bodyHtml={steps[editingStep].body_html || ''}
                        fromName={smtpAccounts?.find((a: any) => a.id === campaignForm.smtp_account_id)?.label || 'Your Name'}
                        fromEmail={smtpAccounts?.find((a: any) => a.id === campaignForm.smtp_account_id)?.email_address || 'you@example.com'}
                      />
                    )}

                    {/* Skip if replied */}
                    <ToggleSwitch
                      checked={steps[editingStep].skip_if_replied !== false}
                      onChange={(v) => updateStep(editingStep, { skip_if_replied: v })}
                      label="Skip if Replied"
                      description="Don't send if the contact already replied"
                      icon={SkipForward}
                    />

                    {/* A/B Testing */}
                    <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                          A/B Subject Testing
                        </p>
                        {(steps[editingStep] as any).subject_b && (
                          <button
                            type="button"
                            onClick={() =>
                              setSteps(
                                steps.map((s, i) =>
                                  i === editingStep ? ({ ...s, subject_b: '' } as any) : s
                                )
                              )
                            }
                            className="text-xs text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div className="space-y-2.5">
                        <div>
                          <label className="block text-xs text-[var(--text-tertiary)] mb-1">
                            Variant A (current subject)
                          </label>
                          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)] truncate">
                            {steps[editingStep].subject || 'No subject set'}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-[var(--text-tertiary)] mb-1">Variant B</label>
                          <input
                            type="text"
                            value={(steps[editingStep] as any).subject_b || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSteps(
                                steps.map((s, i) =>
                                  i === editingStep ? ({ ...s, subject_b: val } as any) : s
                                )
                              );
                            }}
                            placeholder="Alternate subject line…"
                            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[#6366F1] focus:outline-none focus:ring-1 focus:ring-[rgba(99,102,241,0.2)] transition-all"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] mt-2.5">
                        50/50 split — half your contacts get Variant A, half get Variant B.
                      </p>
                    </div>

                    {/* A/B Body Testing */}
                    <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                          A/B Body Testing
                        </p>
                        {(steps[editingStep] as any).body_html_b && (
                          <button
                            type="button"
                            onClick={() =>
                              setSteps(steps.map((s, i) => i === editingStep ? ({ ...s, body_html_b: '' } as any) : s))
                            }
                            className="text-xs text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div className="space-y-2.5">
                        <div>
                          <label className="block text-xs text-[var(--text-tertiary)] mb-1">Variant A (current body)</label>
                          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)] line-clamp-2">
                            {steps[editingStep].body_html ? steps[editingStep].body_html!.replace(/<[^>]*>/g, '').slice(0, 100) + '...' : 'No body set'}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-[var(--text-tertiary)] mb-1">Variant B body</label>
                          <textarea
                            value={(steps[editingStep] as any).body_html_b || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setSteps(steps.map((s, i) => i === editingStep ? ({ ...s, body_html_b: val } as any) : s));
                            }}
                            rows={4}
                            placeholder="Alternative email body HTML..."
                            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[#6366F1] focus:outline-none focus:ring-1 focus:ring-[rgba(99,102,241,0.2)] transition-all font-mono resize-y"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] mt-2.5">
                        50/50 split — uses the same contact assignment as subject A/B.
                      </p>
                    </div>

                    {/* Send Test Email */}
                    {campaignForm.smtp_account_id && (
                      <div className="rounded-xl border border-[var(--border-subtle)] p-4">
                        <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                          Send Test Email
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="email"
                            value={testEmailTo}
                            onChange={(e) => setTestEmailTo(e.target.value)}
                            placeholder="your@email.com"
                            className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[#6366F1] focus:outline-none focus:ring-1 focus:ring-[rgba(99,102,241,0.2)] transition-all"
                          />
                          <button
                            type="button"
                            disabled={sendingTest || !testEmailTo || !steps[editingStep].subject}
                            onClick={async () => {
                              setSendingTest(true);
                              try {
                                const result = await smtpApi.sendTestEmail(
                                  campaignForm.smtp_account_id!,
                                  {
                                    to: testEmailTo,
                                    subject: steps[editingStep].subject || 'Test',
                                    body_html: steps[editingStep].body_html || '',
                                  }
                                );
                                if (result.success) toast.success(result.message || 'Test sent!');
                                else toast.error(result.error || 'Failed');
                              } catch (err: any) {
                                toast.error(err.response?.data?.error || 'Send failed');
                              }
                              setSendingTest(false);
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6366F1] text-white text-xs font-semibold disabled:opacity-40 hover:bg-[#4F46E5] transition-colors"
                          >
                            <Send className="h-3 w-3" />
                            {sendingTest ? 'Sending…' : 'Send'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : editingStep !== null && steps[editingStep]?.step_type === 'delay' ? (
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] sticky top-20 overflow-hidden">
                  <div className="px-5 py-2.5 border-b border-[var(--border-subtle)] flex items-center gap-2.5">
                    <Clock className="h-4 w-4 text-[var(--text-tertiary)]" />
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">Wait / Delay</p>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        Step {(editingStep ?? 0) + 1}
                      </p>
                    </div>
                  </div>
                  <div className="p-5 space-y-4">
                    <p className="text-sm text-[var(--text-secondary)]">
                      Set how long to wait before the next step is triggered.
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: 'Days', key: 'delay_days', max: undefined },
                        { label: 'Hours', key: 'delay_hours', max: 23 },
                        { label: 'Minutes', key: 'delay_minutes', max: 59 },
                      ].map(({ label, key, max }) => (
                        <div key={key}>
                          <label className="block text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
                            {label}
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={max}
                            value={(steps[editingStep] as any)[key] || 0}
                            onChange={(e) =>
                              updateStep(editingStep, {
                                [key]: parseInt(e.target.value) || 0,
                              } as any)
                            }
                            className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3 text-center text-[15px] font-semibold text-[var(--text-primary)] focus:border-[#6366F1] focus:outline-none focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3.5">
                      <p className="text-xs text-[var(--text-tertiary)]">
                        A 1–3 day gap between emails typically delivers the best reply rates.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border-2 border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)]/20 p-10 text-center sticky top-20 flex flex-col items-center justify-center min-h-[240px]">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] mb-4">
                    <Mail className="h-6 w-6 text-[var(--text-tertiary)]" />
                  </div>
                  <h3 className="font-semibold text-[var(--text-primary)] mb-1.5">Step Editor</h3>
                  <p className="text-sm text-[var(--text-secondary)] max-w-[200px]">
                    Click "Edit" on any step in the sequence to configure it here.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer nav */}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setWizardStep(0)}>
              <ArrowLeft className="h-4 w-4" />
              Settings
            </Button>
            <Button onClick={() => setWizardStep(2)}>
              Continue to Contacts
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          STEP 3 — Select Contacts
      ════════════════════════════════════════════════════════ */}
      {wizardStep === 2 && (
        <div className="max-w-2xl mx-auto space-y-5">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-card">
            <CardHeader
              icon={Users}
              title="Recipients"
              subtitle="Who will receive this campaign"
              action={
                selectedContactIds.length > 0 ? (
                  <span className="text-xs text-[var(--text-secondary)]">
                    {selectedContactIds.length} selected
                  </span>
                ) : undefined
              }
            />
            <div className="p-6">
              {selectedContactIds.length === 0 ? (
                <div className="text-center py-12">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] mx-auto mb-5">
                    <Users className="h-7 w-7 text-[var(--text-tertiary)]" />
                  </div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">
                    No recipients yet
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)] mb-6 max-w-[280px] mx-auto">
                    Add individual contacts or entire contact lists to receive this campaign.
                  </p>
                  <Button onClick={() => setShowContactModal(true)}>
                    <UserPlus className="h-4 w-4" />
                    Add Contacts
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                    <div className="flex items-center gap-4">
                      <CheckCircle2 className="h-5 w-5 text-[var(--text-secondary)] flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-[var(--text-primary)]">
                          {selectedContactIds.length} contacts selected
                        </p>
                        <p className="text-sm text-[var(--text-secondary)]">
                          {steps.filter((s) => s.step_type === 'email').length} email
                          {steps.filter((s) => s.step_type === 'email').length !== 1 ? 's' : ''} will be sent per contact
                        </p>
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => setShowContactModal(true)}>
                      Modify
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setWizardStep(1)}>
              <ArrowLeft className="h-4 w-4" />
              Sequence
            </Button>
            <Button onClick={() => setWizardStep(3)}>
              Continue to Review
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
          STEP 4 — Review & Launch
      ════════════════════════════════════════════════════════ */}
      {wizardStep === 3 &&
        (() => {
          const emailSteps = steps.filter((s) => s.step_type === 'email');
          const delaySteps = steps.filter((s) => s.step_type === 'delay');

          // Estimated completion calculation
          const totalSends = emailSteps.length * selectedContactIds.length;
          const avgDelaySec = ((campaignForm.delay_between_emails_min ?? 50) + (campaignForm.delay_between_emails_max ?? 200)) / 2;
          const sendsPerHour = avgDelaySec > 0 ? Math.floor(3600 / avgDelaySec) : 3600;
          const [startH = 0, startM = 0] = (campaignForm.send_window_start || '00:00').split(':').map(Number);
          const [endH = 23, endM = 59] = (campaignForm.send_window_end || '23:59').split(':').map(Number);
          const windowMinutes = Math.max(0, (endH * 60 + endM) - (startH * 60 + startM));
          const windowHours = windowMinutes / 60;
          const activeDaysPerWeek = (campaignForm.send_days || []).length || 5;
          const dailyCapacity = Math.min(
            campaignForm.daily_limit && campaignForm.daily_limit > 0 ? campaignForm.daily_limit : Infinity,
            sendsPerHour * windowHours
          );
          const effectiveDailyCapacity = isFinite(dailyCapacity) ? dailyCapacity : totalSends;
          const weeklyCapacity = effectiveDailyCapacity * activeDaysPerWeek;
          const estDays = totalSends > 0 && weeklyCapacity > 0
            ? Math.ceil((totalSends / weeklyCapacity) * 7)
            : 0;
          const estLabel = estDays === 0 ? '—'
            : estDays === 1 ? '~1 day'
            : estDays <= 7 ? `~${estDays} days`
            : estDays <= 14 ? `~${Math.ceil(estDays / 7)} weeks`
            : `~${Math.ceil(estDays / 7)} weeks`;

          const warnings: string[] = [];
          if (!campaignForm.name) warnings.push('Campaign name is required');
          if (!campaignForm.smtp_account_id) warnings.push('No SMTP account selected');
          if (steps.length === 0) warnings.push('No sequence steps added');
          if (emailSteps.length === 0) warnings.push('No email steps in sequence');
          if (selectedContactIds.length === 0) warnings.push('No contacts selected');
          if (emailSteps.some((s) => !s.subject))
            warnings.push('Some email steps have no subject line');
          if (emailSteps.some((s) => !s.body_html))
            warnings.push('Some email steps have no body content');
          const smtpAccount = (smtpAccounts || []).find(
            (a: SmtpAccount) => a.id === campaignForm.smtp_account_id
          );
          const isReady = warnings.length === 0;

          return (
            <div className="max-w-4xl mx-auto space-y-5">
              {/* Warnings */}
              {warnings.length > 0 && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-4">
                  <div className="flex items-center gap-2.5 mb-3">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                    <h3 className="text-sm font-semibold text-red-600">Resolve before launching</h3>
                  </div>
                  <ul className="space-y-1.5">
                    {warnings.map((w, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-red-500/90">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0" />
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Stat Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <StatCard label="Recipients" value={selectedContactIds.length.toLocaleString()} icon={Users} accent="indigo" />
                <StatCard label="Email Steps" value={emailSteps.length} icon={Mail} accent="violet" />
                <StatCard label="Wait Steps" value={delaySteps.length} icon={Clock} accent="slate" />
                <StatCard label="Total Sends" value={totalSends.toLocaleString()} icon={Send} accent="emerald" />
                <StatCard label="Est. Completion" value={estLabel} icon={Timer} accent="amber" />
              </div>

              {/* Campaign Summary */}
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-card">
                <CardHeader icon={Settings} title="Campaign Summary" subtitle="Review all settings before launch" />
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
                  {[
                    { label: 'Campaign Name', value: campaignForm.name || '—' },
                    {
                      label: 'Primary Sender',
                      value: smtpAccount
                        ? `${smtpAccount.label} (${smtpAccount.email_address})`
                        : '—',
                    },
                    {
                      label: 'Send Window',
                      value: `${campaignForm.send_window_start} – ${campaignForm.send_window_end} (${campaignForm.timezone})`,
                    },
                    {
                      label: 'Active Days',
                      value:
                        (campaignForm.send_days || [])
                          .map((d: string) => d.slice(0, 3).charAt(0).toUpperCase() + d.slice(1, 3))
                          .join(', ') || '—',
                    },
                    {
                      label: 'Daily Limit',
                      value: campaignForm.daily_limit ? `${campaignForm.daily_limit} emails` : 'Unlimited',
                    },
                    {
                      label: 'Send Delay',
                      value: `${campaignForm.delay_between_emails_min ?? 50}s – ${campaignForm.delay_between_emails_max ?? 200}s`,
                    },
                    {
                      label: 'Stop on Reply',
                      value: campaignForm.stop_on_reply !== false ? 'Enabled' : 'Disabled',
                    },
                    {
                      label: 'Tracking',
                      value:
                        [
                          campaignForm.track_opens !== false && 'Opens',
                          campaignForm.track_clicks !== false && 'Clicks',
                        ]
                          .filter(Boolean)
                          .join(', ') || 'None',
                    },
                    {
                      label: 'Unsubscribe Link',
                      value: campaignForm.include_unsubscribe ? 'Included' : 'Not included',
                    },
                    senderPoolIds.length > 0
                      ? {
                          label: 'Sender Rotation',
                          value: `${senderPoolIds.length} accounts`,
                        }
                      : null,
                  ]
                    .filter(Boolean)
                    .map(({ label, value }: any) => (
                      <div key={label}>
                        <dt className="text-xs text-[var(--text-tertiary)] mb-0.5">{label}</dt>
                        <dd className="font-medium text-[var(--text-primary)]">{value}</dd>
                      </div>
                    ))}
                </div>
              </div>

              {/* Sequence Timeline */}
              {steps.length > 0 && (
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-card">
                  <CardHeader
                    icon={Layers}
                    title="Sequence Timeline"
                    subtitle={`${steps.length} step${steps.length !== 1 ? 's' : ''} in this campaign`}
                  />
                  <div className="p-5 space-y-2">
                    {steps.map((step, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 p-3.5 rounded-xl bg-[var(--bg-elevated)]"
                      >
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface)] text-xs font-bold text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                          {i + 1}
                        </span>
                        {step.step_type === 'email' ? (
                          <>
                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                              <Mail className="h-3.5 w-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                                {step.subject || 'Untitled Email'}
                              </p>
                              {(step as any).subject_b && (
                                <p className="text-xs text-[var(--text-tertiary)]">
                                  A/B: "{(step as any).subject_b}"
                                </p>
                              )}
                            </div>
                          </>
                        ) : step.step_type === 'delay' ? (
                          <>
                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                              <Clock className="h-3.5 w-3.5" />
                            </div>
                            <p className="text-sm text-[var(--text-secondary)]">
                              Wait {step.delay_days || 0}d {step.delay_hours || 0}h{' '}
                              {step.delay_minutes || 0}m
                            </p>
                          </>
                        ) : (
                          <>
                            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                              <Settings className="h-3.5 w-3.5" />
                            </div>
                            <p className="text-sm text-[var(--text-secondary)] capitalize">
                              {step.step_type}
                            </p>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Launch Area */}
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-[var(--text-primary)]">
                      {isReady ? 'Ready to launch' : 'Almost there'}
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                      {isReady
                        ? `${selectedContactIds.length} contacts will start receiving emails once launched.`
                        : 'Resolve the issues above before launching.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Button
                      variant="secondary"
                      onClick={handleSave}
                      disabled={createCampaignMutation.isPending || launching}
                    >
                      <Save className="h-4 w-4" />
                      {createCampaignMutation.isPending ? 'Saving…' : 'Save Draft'}
                    </Button>
                    <button
                      onClick={() =>
                        isReady
                          ? setShowLaunchConfirm(true)
                          : toast.error('Resolve all issues before launching')
                      }
                      disabled={launching || createCampaignMutation.isPending}
                      className="inline-flex items-center gap-2 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white font-bold px-8 py-3 rounded-xl shadow-[0_4px_16px_rgba(99,102,241,0.4)] hover:shadow-[0_6px_20px_rgba(99,102,241,0.5)] hover:opacity-95 transition-all disabled:opacity-40"
                    >
                      <Rocket className="h-4 w-4" />
                      {launching ? 'Launching…' : 'Launch Campaign'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex justify-start">
                <Button variant="secondary" onClick={() => setWizardStep(2)}>
                  <ArrowLeft className="h-4 w-4" />
                  Back to Contacts
                </Button>
              </div>

              {/* Launch Confirmation Modal */}
              <Modal
                isOpen={showLaunchConfirm}
                onClose={() => setShowLaunchConfirm(false)}
                title="Launch Campaign"
              >
                <div className="space-y-4">
                  <p className="text-sm text-[var(--text-secondary)]">
                    You're about to launch{' '}
                    <strong className="text-[var(--text-primary)]">{campaignForm.name}</strong>. This will
                    start sending emails to{' '}
                    <strong className="text-[var(--text-primary)]">
                      {selectedContactIds.length} contacts
                    </strong>{' '}
                    with{' '}
                    <strong className="text-[var(--text-primary)]">
                      {emailSteps.length} email step{emailSteps.length !== 1 ? 's' : ''}
                    </strong>
                    .
                  </p>
                  <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-4 space-y-1.5 text-xs text-[var(--text-secondary)]">
                    <p>
                      Sending window: {campaignForm.send_window_start} – {campaignForm.send_window_end} (
                      {campaignForm.timezone})
                    </p>
                    <p>Daily limit: {campaignForm.daily_limit || 'Unlimited'}</p>
                    <p>Stop on reply: {campaignForm.stop_on_reply !== false ? 'Yes' : 'No'}</p>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="secondary" onClick={() => setShowLaunchConfirm(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveAndLaunch} disabled={launching}>
                      <Rocket className="h-4 w-4" />
                      {launching ? 'Launching…' : 'Confirm & Launch'}
                    </Button>
                  </div>
                </div>
              </Modal>
            </div>
          );
        })()}

      {/* ════════════════════════════════════════════════════════
          Contact Selection Modal (shared across steps)
      ════════════════════════════════════════════════════════ */}
      <Modal
        isOpen={showContactModal}
        onClose={() => setShowContactModal(false)}
        title="Select Contacts"
        size="lg"
      >
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-[var(--bg-elevated)] rounded-xl">
            {[
              { key: 'individual', label: 'Individual Contacts', icon: UserPlus },
              { key: 'lists', label: 'Add from Lists', icon: ListPlus },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setContactModalTab(key as any)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  contactModalTab === key
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          {contactModalTab === 'individual' ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  placeholder="Search by name, email, or company…"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-10 pr-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[#6366F1] focus:outline-none focus:ring-2 focus:ring-[rgba(99,102,241,0.2)] transition-all"
                />
              </div>
              <div className="max-h-[350px] overflow-y-auto rounded-xl border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                {contacts.map((contact: ContactWithTags) => {
                  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
                  return (
                    <label
                      key={contact.id}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedContactIds.includes(contact.id)}
                        onChange={() => toggleContact(contact.id)}
                        className="h-4 w-4 rounded border-[var(--border-default)] accent-[#6366F1]"
                      />
                      <Avatar name={fullName || contact.email} email={contact.email} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[var(--text-primary)]">
                          {fullName || contact.email}
                        </p>
                        <p className="text-[11px] text-[var(--text-tertiary)]">{contact.email}</p>
                      </div>
                      {contact.company && (
                        <span className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] flex-shrink-0">
                          <Building2 className="h-3 w-3" />
                          {contact.company}
                        </span>
                      )}
                    </label>
                  );
                })}
                {contacts.length === 0 && (
                  <p className="p-6 text-center text-sm text-[var(--text-tertiary)]">
                    No contacts found
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="max-h-[400px] overflow-y-auto rounded-xl border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
              {(allLists || []).length === 0 ? (
                <p className="p-6 text-center text-sm text-[var(--text-tertiary)]">
                  No lists found. Create lists on the Contacts page first.
                </p>
              ) : (
                (allLists || []).map((list: any) => (
                  <div
                    key={list.id}
                    className="flex items-center gap-3 p-4 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0 border border-[var(--border-subtle)]">
                      <FolderOpen className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)]">{list.name}</p>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        {list.contact_count || 0} contact
                        {(list.contact_count || 0) !== 1 ? 's' : ''}
                        {list.description && ` · ${list.description}`}
                      </p>
                    </div>
                    <button
                      onClick={() => addListContacts(list.id)}
                      disabled={addingListId === list.id || (list.contact_count || 0) === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] disabled:opacity-40 transition-all flex-shrink-0"
                    >
                      {addingListId === list.id ? (
                        <Spinner size="sm" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      {addingListId === list.id ? 'Adding…' : 'Add All'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">{selectedContactIds.length}</span>{' '}
              selected
            </p>
            <Button onClick={() => setShowContactModal(false)}>
              <Check className="h-4 w-4" />
              Done
            </Button>
          </div>
        </div>
      </Modal>

      {/* AI Email Generation Modal */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-[var(--bg-surface)] rounded-2xl border border-[var(--border-default)] shadow-2xl w-full max-w-md p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[#6366F1]" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Generate Email with AI</h2>
              </div>
              <button onClick={() => setShowAiModal(false)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">What's the goal of this email? <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={aiGoal}
                  onChange={(e) => setAiGoal(e.target.value)}
                  placeholder="e.g., Book a demo call, introduce our product..."
                  className="w-full h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Product / Service</label>
                <input
                  type="text"
                  value={aiProduct}
                  onChange={(e) => setAiProduct(e.target.value)}
                  placeholder="e.g., SkySend email automation..."
                  className="w-full h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Tone</label>
                <select
                  value={aiTone}
                  onChange={(e) => setAiTone(e.target.value)}
                  className="w-full h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 outline-none"
                >
                  <option value="professional">Professional</option>
                  <option value="casual">Casual & Friendly</option>
                  <option value="formal">Formal</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="secondary" className="flex-1" onClick={() => setShowAiModal(false)}>Cancel</Button>
              <button
                disabled={!aiGoal || aiGenerating}
                onClick={handleGenerateEmail}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-xl bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {aiGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {aiGenerating ? 'Generating...' : 'Generate Email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template picker modal */}
      {showTemplatePicker && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowTemplatePicker(false)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Apply sequence template</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">This will replace your current sequence steps.</p>
              </div>
              <button onClick={() => setShowTemplatePicker(false)} className="p-1 rounded hover:bg-[var(--bg-hover)]"><X className="h-4 w-4 text-[var(--text-tertiary)]" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {sequenceTemplates.length === 0 ? (
                <div className="text-center py-12">
                  <Layers className="h-10 w-10 mx-auto text-[var(--text-tertiary)] mb-2" />
                  <p className="text-sm text-[var(--text-secondary)]">No sequence templates yet.</p>
                  <Link to="/templates" className="text-xs text-[#6366F1] hover:underline mt-2 inline-block">Create one →</Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {sequenceTemplates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => loadTemplate(t.id)}
                      className="w-full text-left p-4 rounded-lg border border-[var(--border-subtle)] hover:border-[#6366F1]/30 hover:bg-[#6366F1]/5 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[#6366F1] transition-colors">{t.name}</h3>
                          {t.description && <p className="text-xs text-[var(--text-secondary)] mt-0.5 line-clamp-2">{t.description}</p>}
                          <div className="flex items-center gap-3 mt-2 text-[10px] text-[var(--text-tertiary)]">
                            <span>{(t.steps as any[])?.length || 0} steps</span>
                            {t.category && <span>· {t.category}</span>}
                            {t.is_preset && <span className="px-1.5 py-0.5 rounded bg-[#6366F1]/10 text-[#6366F1] font-medium">Preset</span>}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] flex-shrink-0 group-hover:text-[#6366F1] transition-colors" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Recipient Inbox Preview ─────────────────────────────────────
 * Renders the email exactly as it would appear in a recipient's
 * inbox: header bar with sender / subject / avatar, then the body
 * in a sandboxed iframe so HTML from the editor can't break the page.
 */
function RecipientPreview({ subject, bodyHtml, fromName, fromEmail }: {
  subject: string;
  bodyHtml: string;
  fromName: string;
  fromEmail: string;
}) {
  const previewHtml = (bodyHtml || '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const fillers: Record<string, string> = {
      first_name: 'Sarah', last_name: 'Chen', company: 'Acme Inc',
      job_title: 'Head of Sales', industry: 'SaaS',
    };
    return fillers[k] || `[${k}]`;
  });

  const previewSubject = subject.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const fillers: Record<string, string> = { first_name: 'Sarah', last_name: 'Chen', company: 'Acme Inc' };
    return fillers[k] || `[${k}]`;
  });

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
        <Eye className="h-3.5 w-3.5 text-[#6366F1]" />
        <span className="text-[11px] font-semibold text-[var(--text-primary)]">Inbox preview</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
          sample data
        </span>
      </div>

      {/* Email header — mimics Gmail/Outlook */}
      <div className="bg-white text-gray-900 px-4 py-3 border-b border-gray-200">
        <h3 className="text-[14px] font-semibold text-gray-900 mb-2 leading-snug">
          {previewSubject}
        </h3>
        <div className="flex items-center gap-2.5">
          <Avatar name={fromName || fromEmail} email={fromEmail} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-gray-900 truncate">
              <span className="font-semibold">{fromName}</span>{' '}
              <span className="text-gray-500">&lt;{fromEmail}&gt;</span>
            </div>
            <div className="text-[10px] text-gray-500">to Sarah Chen — now</div>
          </div>
        </div>
      </div>

      {/* Email body — sandboxed iframe */}
      <iframe
        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
          html,body{margin:0;padding:16px;background:#fff;color:#111;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
            font-size:14px;line-height:1.6;word-break:break-word;}
          a{color:#1a73e8;text-decoration:none}
          img{max-width:100%;height:auto}
          p{margin:0 0 12px}
          h1,h2,h3{margin:16px 0 8px}
        </style></head><body>${previewHtml}</body></html>`}
        sandbox="allow-same-origin"
        style={{
          width: '100%',
          height: '280px',
          border: 'none',
          display: 'block',
          backgroundColor: '#fff',
          pointerEvents: 'none',
        }}
        title="Recipient inbox preview"
      />
    </div>
  );
}

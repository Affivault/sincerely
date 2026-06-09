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
  ArrowLeft, Mail, Clock, Save, Users, Check, Settings, Layers, UserPlus,
  CheckCircle2, Search, Building2, ChevronRight, SkipForward, Gauge, Shield,
  Eye, MousePointerClick, MessageSquare, Send, AlertTriangle, Rocket,
  RotateCcw, Plus, FolderOpen, ListPlus, Sparkles, Loader2, X, Timer,
  Zap, FileText, TrendingUp, ShieldCheck, Brain, Wand2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  CreateCampaignInput, CreateStepInput, CampaignStep, SmtpAccount, ContactWithTags,
} from '@lemlist/shared';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const WIZARD_STEPS = [
  { label: 'Settings', icon: Settings, description: 'Schedule, sender, behaviour' },
  { label: 'Sequence', icon: Layers, description: 'Build your email flow' },
  { label: 'Audience', icon: Users, description: 'Who will receive it' },
  { label: 'Review', icon: Rocket, description: 'Validate & launch' },
];

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional', icon: '💼', description: 'Polite, B2B, formal-leaning' },
  { value: 'casual', label: 'Casual', icon: '👋', description: 'Friendly, conversational' },
  { value: 'formal', label: 'Formal', icon: '🎩', description: 'Strict, traditional business' },
];

/* ─── Polished toggle switch ─────────────────────────────────────── */

function ToggleSwitch({
  checked, onChange, label, description, icon: Icon,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
  icon?: any;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'flex items-start gap-3 p-3.5 rounded-xl border bg-[var(--bg-surface)] text-left transition-all',
        checked
          ? 'border-[var(--indigo)]/30 bg-[var(--indigo-subtle)]/40 shadow-[0_0_0_1px_var(--indigo-subtle)]'
          : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
      )}
    >
      {Icon && (
        <div className={cn(
          'flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0 transition-colors',
          checked
            ? 'bg-[var(--indigo)] text-white'
            : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)]'
        )}>
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-[var(--text-primary)] mb-0.5">{label}</p>
        <p className="text-[11px] text-[var(--text-tertiary)] leading-snug">{description}</p>
      </div>
      <div
        className={cn(
          'relative inline-flex h-[18px] w-[30px] flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out mt-0.5',
          checked ? 'bg-[var(--indigo)]' : 'bg-[var(--border-default)]'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow transition duration-200 ease-in-out',
            checked ? 'translate-x-3' : 'translate-x-0'
          )}
        />
      </div>
    </button>
  );
}

/* ─── Section card with clean header ─────────────────────────────── */

function SectionCard({
  icon: Icon, title, description, action, children, accent = 'indigo',
}: {
  icon: any;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  accent?: 'indigo' | 'emerald' | 'amber' | 'violet';
}) {
  const accentMap = {
    indigo: 'bg-[var(--indigo-subtle)] text-[var(--indigo)] border-[rgba(91,91,245,0.18)]',
    emerald: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    violet: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
  };
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center gap-3">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg border', accentMap[accent])}>
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
          {description && <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ─── Field components ───────────────────────────────────────────── */

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-[0.06em] mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[var(--text-tertiary)] mt-1.5">{hint}</p>}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo)]/15 transition-all';

/* ─── Main component ─────────────────────────────────────────────── */

export function CampaignCreatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const [campaignForm, setCampaignForm] = useState<CreateCampaignInput>({
    name: '',
    timezone: 'UTC',
    send_window_start: '09:00',
    send_window_end: '17:00',
    send_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
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

  // Fetch full contact details for selected IDs preview (subset)
  const { data: selectedContactsPreview } = useQuery({
    queryKey: ['contacts', 'selected-preview', selectedContactIds.slice(0, 8).join(',')],
    queryFn: async () => {
      if (selectedContactIds.length === 0) return [];
      const list = await contactsApi.list({ limit: 200 });
      return (list.data || []).filter((c: any) => selectedContactIds.includes(c.id)).slice(0, 8);
    },
    enabled: selectedContactIds.length > 0,
  });

  const { data: allLists } = useQuery({
    queryKey: ['lists'],
    queryFn: listsApi.list,
  });

  const { data: savedSchedules = [] } = useQuery({
    queryKey: ['sending-schedules'],
    queryFn: sendingSchedulesApi.list,
  });

  const { data: sequenceTemplates = [] } = useQuery({
    queryKey: ['templates', 'sequences'],
    queryFn: templateApi.listSequences,
  });

  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

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

  useEffect(() => {
    if (!isEdit && savedSchedules.length > 0) {
      const def = savedSchedules.find((s) => s.is_default);
      if (def) {
        setCampaignForm((prev: any) => ({
          ...prev,
          timezone: prev.timezone === 'UTC' ? def.timezone : prev.timezone,
          send_window_start: prev.send_window_start === '09:00' ? def.send_window_start : prev.send_window_start,
          send_window_end:   prev.send_window_end   === '17:00' ? def.send_window_end   : prev.send_window_end,
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
      if (!campaignId) { setLaunching(false); return; }
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
        goal: aiGoal, tone: aiTone, product: aiProduct,
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

  // ── Validation ──
  const emailSteps = steps.filter((s) => s.step_type === 'email');
  const sectionIssues: Record<number, string[]> = {
    0: [
      !campaignForm.name && 'Campaign name',
      !campaignForm.smtp_account_id && 'Sending account',
    ].filter(Boolean) as string[],
    1: [
      steps.length === 0 && 'Add at least one step',
      steps.length > 0 && emailSteps.length === 0 && 'No email steps in sequence',
      emailSteps.some((s) => !s.subject) && 'Some emails missing subject',
      emailSteps.some((s) => !s.body_html) && 'Some emails missing body',
    ].filter(Boolean) as string[],
    2: [
      selectedContactIds.length === 0 && 'No recipients selected',
    ].filter(Boolean) as string[],
    3: [],
  };
  const sectionStatus = (i: number): 'ok' | 'warn' | 'empty' => {
    if (i === 0) {
      if (!campaignForm.name && !campaignForm.smtp_account_id) return 'empty';
      return sectionIssues[0].length > 0 ? 'warn' : 'ok';
    }
    if (i === 1) {
      if (steps.length === 0) return 'empty';
      return sectionIssues[1].length > 0 ? 'warn' : 'ok';
    }
    if (i === 2) {
      return selectedContactIds.length === 0 ? 'empty' : 'ok';
    }
    return 'ok';
  };
  const totalIssues = sectionIssues[0].length + sectionIssues[1].length + sectionIssues[2].length;
  const isReady = totalIssues === 0 && steps.length > 0 && selectedContactIds.length > 0 && !!campaignForm.name && !!campaignForm.smtp_account_id;

  return (
    <div className="-mx-8 -my-6 flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>
      {/* ── Top bar ──────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-2.5 flex items-center gap-3">
        <button
          onClick={() => navigate('/campaigns')}
          className="flex items-center gap-1.5 px-2 h-7 rounded-md text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors flex-shrink-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Campaigns
        </button>
        <div className="h-5 w-px bg-[var(--border-subtle)]" />
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)] flex-shrink-0">
          <Rocket className="h-3.5 w-3.5 text-[var(--indigo)]" />
        </span>
        <input
          type="text"
          value={campaignForm.name}
          onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
          placeholder={isEdit ? 'Edit campaign…' : 'Untitled campaign — give it a name'}
          className="flex-1 max-w-md min-w-0 bg-transparent border-0 text-[14px] font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] placeholder:font-normal outline-none focus:bg-[var(--bg-elevated)] rounded-md px-2 h-7 transition-colors"
        />
        <div className="flex-1" />

        {totalIssues > 0 ? (
          <span className="inline-flex items-center gap-1.5 px-2 h-7 rounded-md text-[11.5px] font-semibold bg-amber-500/10 text-amber-700 border border-amber-500/20">
            <AlertTriangle className="h-3 w-3" />
            {totalIssues} {totalIssues === 1 ? 'issue' : 'issues'}
          </span>
        ) : isReady ? (
          <span className="inline-flex items-center gap-1.5 px-2 h-7 rounded-md text-[11.5px] font-semibold bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3" />
            Ready to launch
          </span>
        ) : null}

        <button
          onClick={handleSave}
          disabled={createCampaignMutation.isPending || !campaignForm.name}
          className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-all"
        >
          <Save className="h-3.5 w-3.5" />
          {createCampaignMutation.isPending ? 'Saving…' : 'Save draft'}
        </button>
        <button
          onClick={() => isReady ? handleSaveAndLaunch() : toast.error('Resolve all issues before launching')}
          disabled={!isReady || launching}
          title={!isReady ? `${totalIssues} issue${totalIssues === 1 ? '' : 's'} remaining` : 'Launch this campaign'}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 h-7 rounded-md text-[12px] font-semibold transition-all',
            isReady
              ? 'bg-[var(--indigo)] text-white hover:bg-[var(--indigo-hover)] shadow-[0_1px_3px_rgba(91,91,245,0.4)]'
              : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] cursor-not-allowed'
          )}
        >
          <Rocket className="h-3.5 w-3.5" />
          {launching ? 'Launching…' : 'Launch'}
        </button>
      </header>

      {/* ── Wizard progress stepper ──────────────────────────── */}
      <div className="flex-shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-3">
        <div className="flex items-center max-w-3xl mx-auto">
          {WIZARD_STEPS.map((ws, i) => {
            const Icon = ws.icon;
            const active = i === wizardStep;
            const completed = i < wizardStep && sectionStatus(i) === 'ok';
            const status = sectionStatus(i);
            const isLast = i === WIZARD_STEPS.length - 1;
            return (
              <div key={ws.label} className={cn('flex items-center', !isLast && 'flex-1')}>
                <button
                  onClick={() => setWizardStep(i)}
                  className="flex items-center gap-3 group"
                >
                  <div className={cn(
                    'flex items-center justify-center h-8 w-8 rounded-full text-[12px] font-bold transition-all',
                    active
                      ? 'bg-[var(--indigo)] text-white shadow-[0_2px_6px_rgba(91,91,245,0.3)] ring-4 ring-[var(--indigo-subtle)]'
                      : completed
                      ? 'bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/20'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] ring-1 ring-[var(--border-subtle)]'
                  )}>
                    {completed ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Icon className="h-4 w-4" strokeWidth={2} />}
                  </div>
                  <div className="text-left hidden sm:block">
                    <p className={cn(
                      'text-[12.5px] font-semibold transition-colors',
                      active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
                    )}>
                      {ws.label}
                    </p>
                    <p className="text-[10.5px] text-[var(--text-tertiary)] leading-tight">
                      {status === 'warn'
                        ? `${sectionIssues[i].length} issue${sectionIssues[i].length === 1 ? '' : 's'}`
                        : ws.description
                      }
                    </p>
                  </div>
                </button>
                {!isLast && (
                  <div className="flex-1 h-px mx-4 bg-gradient-to-r from-[var(--border-subtle)] via-[var(--border-subtle)] to-[var(--border-subtle)] relative">
                    {completed && (
                      <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/40 to-[var(--border-subtle)]" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Body: sidebar + content ─────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 flex-shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-app)] overflow-y-auto p-3">

          {/* Pre-flight checks */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className={cn(
                'h-3.5 w-3.5',
                totalIssues === 0 ? 'text-emerald-500' : 'text-amber-500'
              )} />
              <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                Pre-flight
              </p>
              {totalIssues > 0 && (
                <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded text-[10px] font-bold bg-amber-500/10 text-amber-700 tabular">
                  {totalIssues}
                </span>
              )}
            </div>
            {totalIssues === 0 ? (
              <p className="text-[11px] text-emerald-600 font-medium">All checks passed ✓</p>
            ) : (
              <ul className="space-y-1">
                {Object.entries(sectionIssues).flatMap(([sectionIdx, issues]) =>
                  issues.map((issue, j) => (
                    <li key={`${sectionIdx}-${j}`}>
                      <button
                        onClick={() => setWizardStep(Number(sectionIdx))}
                        className="w-full text-left flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors py-0.5"
                      >
                        <span className="h-1 w-1 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                        <span className="leading-snug">{issue}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          {/* Live stats */}
          {(selectedContactIds.length > 0 || steps.length > 0) && (
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 mb-3">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-[var(--indigo)]" />
                Quick stats
              </p>
              <div className="space-y-1.5">
                {selectedContactIds.length > 0 && (
                  <StatRow label="Recipients" value={selectedContactIds.length.toLocaleString()} />
                )}
                {emailSteps.length > 0 && (
                  <>
                    <StatRow label="Email steps" value={emailSteps.length} />
                    <StatRow label="Total sends" value={(emailSteps.length * selectedContactIds.length).toLocaleString()} accent="indigo" />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Help */}
          <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-3">
            <Sparkles className="h-3.5 w-3.5 text-[var(--text-tertiary)] mb-1.5" />
            <p className="text-[11px] font-semibold text-[var(--text-secondary)] mb-1">Need a head start?</p>
            <p className="text-[10.5px] text-[var(--text-tertiary)] leading-snug mb-2">
              Use AI to generate emails or load a saved template to skip the blank page.
            </p>
            <button
              onClick={() => setWizardStep(1)}
              className="text-[10.5px] font-semibold text-[var(--indigo)] hover:underline"
            >
              Go to sequence →
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto px-6 py-5 pb-16">

          {/* ════════ STEP 1 — Settings ════════ */}
          {wizardStep === 0 && (
            <div className="max-w-4xl mx-auto space-y-4">
              {/* Identity */}
              <SectionCard
                icon={Rocket}
                title="Campaign identity"
                description="Name your campaign and choose your primary sending account"
                accent="indigo"
              >
                <div className="space-y-4">
                  <Field label="Campaign name">
                    <input
                      type="text"
                      value={campaignForm.name}
                      onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                      placeholder="e.g. Q1 Enterprise Outreach"
                      className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-[14px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] placeholder:font-normal focus:border-[var(--indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo)]/15 transition-all"
                    />
                  </Field>

                  <Field label="Primary sending account" hint="The default account that will be used for sends">
                    <select
                      value={campaignForm.smtp_account_id || ''}
                      onChange={(e) => setCampaignForm({ ...campaignForm, smtp_account_id: e.target.value || undefined })}
                      className={inputCls}
                    >
                      <option value="">Select an account…</option>
                      {(smtpAccounts || []).map((a: SmtpAccount) => (
                        <option key={a.id} value={a.id}>{a.label} — {a.email_address}</option>
                      ))}
                    </select>
                    {(smtpAccounts || []).length === 0 && (
                      <div className="mt-2 p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/15 flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0 mt-px" />
                        <p className="text-[11.5px] text-amber-700">
                          No sending accounts yet.{' '}
                          <Link to="/settings/smtp" className="font-semibold underline">Add one to continue</Link>.
                        </p>
                      </div>
                    )}
                  </Field>

                  {/* Sender rotation pool */}
                  {(smtpAccounts || []).length > 1 && (
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <RotateCcw className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                        <h4 className="text-[12.5px] font-semibold text-[var(--text-primary)]">Sender rotation pool</h4>
                        <span className="text-[10px] font-medium text-[var(--text-tertiary)] bg-[var(--bg-surface)] px-1.5 py-0.5 rounded">Optional</span>
                      </div>
                      <p className="text-[11.5px] text-[var(--text-secondary)] mb-3 leading-snug">
                        Distribute sends across multiple accounts to protect reputation and boost deliverability.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(smtpAccounts || []).map((a: SmtpAccount) => {
                          const isSelected = senderPoolIds.includes(a.id);
                          return (
                            <label
                              key={a.id}
                              className={cn(
                                'flex items-center gap-2.5 p-2.5 rounded-lg cursor-pointer transition-all border',
                                isSelected
                                  ? 'bg-[var(--indigo-subtle)]/40 border-[var(--indigo)]/30'
                                  : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--border-default)]'
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) setSenderPoolIds([...senderPoolIds, a.id]);
                                  else setSenderPoolIds(senderPoolIds.filter((id) => id !== a.id));
                                }}
                                className="h-3.5 w-3.5 rounded border-[var(--border-default)] accent-[var(--indigo)]"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{a.label}</p>
                                <p className="text-[10.5px] text-[var(--text-tertiary)]">{a.email_address} · {a.daily_send_limit}/day</p>
                              </div>
                              <span className={cn(
                                'inline-flex items-center px-1.5 h-[18px] rounded text-[10px] font-bold flex-shrink-0',
                                a.health_score >= 80 ? 'bg-emerald-500/10 text-emerald-700'
                                  : a.health_score >= 50 ? 'bg-amber-500/10 text-amber-700'
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
              </SectionCard>

              {/* Schedule + Rate */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SectionCard
                  icon={Clock}
                  title="Sending schedule"
                  description="When emails will be delivered"
                  accent="amber"
                  action={
                    <Link to="/schedules" className="text-[11px] font-medium text-[var(--indigo)] hover:underline whitespace-nowrap">
                      Manage saved →
                    </Link>
                  }
                >
                  <div className="space-y-4">
                    {savedSchedules.length > 0 && (
                      <div className="rounded-lg border border-[var(--indigo)]/20 bg-[var(--indigo-subtle)]/40 p-2.5">
                        <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[var(--indigo)] mb-1.5">
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
                          <option value="" disabled>Choose a schedule…</option>
                          {savedSchedules.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}{s.is_default ? ' (default)' : ''} — {s.send_window_start}–{s.send_window_end} {s.timezone}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <Field label="Timezone">
                      <input
                        type="text"
                        value={campaignForm.timezone || 'UTC'}
                        onChange={(e) => setCampaignForm({ ...campaignForm, timezone: e.target.value })}
                        className={inputCls}
                      />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Start">
                        <input
                          type="time"
                          value={campaignForm.send_window_start || '09:00'}
                          onChange={(e) => setCampaignForm({ ...campaignForm, send_window_start: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="End">
                        <input
                          type="time"
                          value={campaignForm.send_window_end || '17:00'}
                          onChange={(e) => setCampaignForm({ ...campaignForm, send_window_end: e.target.value })}
                          className={inputCls}
                        />
                      </Field>
                    </div>

                    <Field label="Active days">
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
                              className={cn(
                                'flex-1 py-2 rounded-md text-[11px] font-semibold transition-all',
                                isActive
                                  ? 'bg-[var(--indigo)] text-white shadow-sm'
                                  : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                              )}
                            >
                              {DAY_LABELS[i]}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                  </div>
                </SectionCard>

                <SectionCard
                  icon={Gauge}
                  title="Rate controls"
                  description="Protect your sender reputation"
                  accent="emerald"
                >
                  <div className="space-y-4">
                    <Field label="Daily limit" hint="Set 0 for unlimited sends">
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="0"
                          value={campaignForm.daily_limit ?? 50}
                          onChange={(e) => setCampaignForm({ ...campaignForm, daily_limit: parseInt(e.target.value) || 0 })}
                          className={inputCls}
                        />
                        <span className="text-[11.5px] text-[var(--text-tertiary)] whitespace-nowrap font-medium">/ day</span>
                      </div>
                    </Field>

                    <Field label="Delay between emails" hint="Random delay added between each individual send">
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="0"
                          value={campaignForm.delay_between_emails_min ?? 50}
                          onChange={(e) => setCampaignForm({ ...campaignForm, delay_between_emails_min: parseInt(e.target.value) || 0 })}
                          className={inputCls}
                        />
                        <span className="text-[11.5px] font-medium text-[var(--text-tertiary)]">to</span>
                        <input
                          type="number" min="0"
                          value={campaignForm.delay_between_emails_max ?? 200}
                          onChange={(e) => setCampaignForm({ ...campaignForm, delay_between_emails_max: parseInt(e.target.value) || 0 })}
                          className={inputCls}
                        />
                        <span className="text-[11.5px] text-[var(--text-tertiary)] whitespace-nowrap font-medium">sec</span>
                      </div>
                    </Field>

                    {/* Visual capacity hint */}
                    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-medium text-[var(--text-secondary)]">Est. throughput</span>
                        <span className="text-[11px] font-bold text-[var(--text-primary)] tabular">
                          ~{Math.floor(3600 / Math.max(1, ((campaignForm.delay_between_emails_min ?? 50) + (campaignForm.delay_between_emails_max ?? 200)) / 2))}/hour
                        </span>
                      </div>
                      <p className="text-[10.5px] text-[var(--text-tertiary)] leading-snug">
                        Capped by daily limit, then split by send window length.
                      </p>
                    </div>
                  </div>
                </SectionCard>
              </div>

              {/* Behaviour & Tracking */}
              <SectionCard
                icon={Shield}
                title="Behaviour & tracking"
                description="Control how your campaign responds and what data it collects"
                accent="violet"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <ToggleSwitch
                    checked={campaignForm.stop_on_reply !== false}
                    onChange={(v) => setCampaignForm({ ...campaignForm, stop_on_reply: v })}
                    label="Stop on reply"
                    description="Pause sending when a contact replies"
                    icon={MessageSquare}
                  />
                  <ToggleSwitch
                    checked={campaignForm.track_opens !== false}
                    onChange={(v) => setCampaignForm({ ...campaignForm, track_opens: v })}
                    label="Track opens"
                    description="Detect when recipients open your emails"
                    icon={Eye}
                  />
                  <ToggleSwitch
                    checked={campaignForm.track_clicks !== false}
                    onChange={(v) => setCampaignForm({ ...campaignForm, track_clicks: v })}
                    label="Track clicks"
                    description="Monitor click-throughs on your links"
                    icon={MousePointerClick}
                  />
                  <ToggleSwitch
                    checked={campaignForm.include_unsubscribe === true}
                    onChange={(v) => setCampaignForm({ ...campaignForm, include_unsubscribe: v })}
                    label="Unsubscribe link"
                    description="Add a footer opt-out link to all emails"
                    icon={Mail}
                  />
                </div>
              </SectionCard>

              <div className="flex justify-end pt-2">
                <Button onClick={() => setWizardStep(1)}>
                  Continue to sequence
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* ════════ STEP 2 — Sequence ════════ */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              {/* Quick start callout */}
              {steps.length === 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {sequenceTemplates.length > 0 && (
                    <button
                      onClick={() => setShowTemplatePicker(true)}
                      className="group text-left p-4 rounded-xl border border-[var(--indigo)]/20 bg-[var(--indigo-subtle)]/30 hover:border-[var(--indigo)]/35 hover:bg-[var(--indigo-subtle)]/50 transition-all"
                    >
                      <div className="flex items-center gap-2.5 mb-2">
                        <div className="h-8 w-8 rounded-lg bg-[var(--indigo)] flex items-center justify-center text-white">
                          <FolderOpen className="h-4 w-4" />
                        </div>
                        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Start from a template</h3>
                      </div>
                      <p className="text-[11.5px] text-[var(--text-secondary)] leading-snug">
                        Apply one of your saved sequences to skip building from scratch — {sequenceTemplates.length} available.
                      </p>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--indigo)] mt-3 group-hover:gap-1.5 transition-all">
                        Browse templates <ChevronRight className="h-3 w-3" />
                      </span>
                    </button>
                  )}
                  <div className="text-left p-4 rounded-xl border border-violet-500/20 bg-violet-500/5">
                    <div className="flex items-center gap-2.5 mb-2">
                      <div className="h-8 w-8 rounded-lg bg-violet-500 flex items-center justify-center text-white">
                        <Wand2 className="h-4 w-4" />
                      </div>
                      <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">AI assistance available</h3>
                    </div>
                    <p className="text-[11.5px] text-[var(--text-secondary)] leading-snug">
                      Add an email step below, then use "Generate with AI" inside the editor to write the content for you.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* Flow Canvas */}
                <div className="lg:col-span-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden flex flex-col">
                  <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
                      <Layers className="h-3.5 w-3.5 text-[var(--indigo)]" strokeWidth={1.75} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Sequence builder</h3>
                      <p className="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">Build the email flow your contacts will experience</p>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
                      {sequenceTemplates.length > 0 && (
                        <button
                          onClick={() => setShowTemplatePicker(true)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--indigo)] transition-colors"
                        >
                          <FolderOpen className="h-3 w-3" /> Template
                        </button>
                      )}
                      <span className="flex items-center gap-1 font-medium">
                        <Mail className="h-3 w-3" />
                        {emailSteps.length}
                      </span>
                      <span className="flex items-center gap-1 font-medium">
                        <Clock className="h-3 w-3" />
                        {steps.filter((s) => s.step_type === 'delay').length}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 p-4 min-h-[420px] overflow-y-auto bg-[var(--bg-app)]/40">
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
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] sticky top-4 overflow-hidden">
                      <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)] flex-shrink-0">
                            <Mail className="h-3 w-3 text-[var(--indigo)]" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">Email editor</p>
                            <p className="text-[10.5px] text-[var(--text-tertiary)]">Step {(editingStep ?? 0) + 1} of {steps.length}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setShowAiModal(true)}
                            className="inline-flex items-center gap-1 px-2 h-7 rounded-md bg-[var(--indigo)] text-white text-[11px] font-semibold hover:bg-[var(--indigo-hover)] transition-all"
                          >
                            <Sparkles className="h-3 w-3" />
                            AI
                          </button>
                          <PersonalizationDropdown onInsert={insertPersonalization} />
                        </div>
                      </div>

                      <div className="p-4 space-y-3 max-h-[calc(100vh-220px)] overflow-y-auto">
                        {/* Subject */}
                        <Field label="Subject line">
                          <input
                            ref={subjectRef}
                            type="text"
                            value={steps[editingStep].subject || ''}
                            onChange={(e) => updateStep(editingStep, { subject: e.target.value })}
                            onFocus={() => setActiveField('subject')}
                            placeholder="e.g. Quick question about {{company}}"
                            className={inputCls}
                          />
                          {(() => {
                            const len = (steps[editingStep].subject || '').length;
                            if (len === 0) return null;
                            const quality =
                              len >= 30 && len <= 60 ? { label: 'Great length', color: 'text-emerald-500' }
                              : len < 30 ? { label: 'Could be longer', color: 'text-amber-500' }
                              : len <= 80 ? { label: 'A bit long', color: 'text-amber-500' }
                              : { label: 'Too long — may truncate', color: 'text-rose-500' };
                            return (
                              <div className="flex items-center justify-between mt-1 px-0.5">
                                <span className={cn('text-[10.5px] font-semibold', quality.color)}>{quality.label}</span>
                                <span className="text-[10.5px] tabular text-[var(--text-tertiary)]">{len} / 80</span>
                              </div>
                            );
                          })()}
                        </Field>

                        {/* Body */}
                        <Field label="Email body">
                          <textarea
                            ref={bodyRef}
                            value={steps[editingStep].body_html || ''}
                            onChange={(e) => updateStep(editingStep, { body_html: e.target.value })}
                            onFocus={() => setActiveField('body')}
                            placeholder={`<p>Hi {{first_name}},</p>\n\n<p>I noticed that {{company}} is…</p>`}
                            className="w-full min-h-[180px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo)]/15 transition-all font-mono resize-y"
                          />
                          {(() => {
                            const rawText = (steps[editingStep].body_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                            const words = rawText ? rawText.split(/\s+/).filter(Boolean).length : 0;
                            if (words === 0) return null;
                            const quality = words <= 100 ? { label: 'Concise', color: 'text-emerald-500' }
                              : words <= 200 ? { label: 'Good length', color: 'text-amber-500' }
                              : { label: 'Long — consider trimming', color: 'text-rose-500' };
                            return (
                              <div className="flex items-center justify-between mt-1 px-0.5">
                                <span className={cn('text-[10.5px] font-semibold', quality.color)}>{quality.label}</span>
                                <span className="text-[10.5px] tabular text-[var(--text-tertiary)]">{words} words</span>
                              </div>
                            );
                          })()}
                        </Field>

                        {/* Preview */}
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
                          checked={steps[editingStep].skip_if_replied === true}
                          onChange={(v) => updateStep(editingStep, { skip_if_replied: v })}
                          label="Skip if replied"
                          description="Don't send if the contact already replied"
                          icon={SkipForward}
                        />

                        {/* A/B Subject Testing */}
                        <ABSection
                          title="A/B Subject Testing"
                          variantA={steps[editingStep].subject || ''}
                          variantB={(steps[editingStep] as any).subject_b || ''}
                          onChangeB={(val) => setSteps(steps.map((s, i) => i === editingStep ? ({ ...s, subject_b: val } as any) : s))}
                          onClear={() => setSteps(steps.map((s, i) => i === editingStep ? ({ ...s, subject_b: '' } as any) : s))}
                          variantBPlaceholder="Alternate subject line…"
                          variantALabel="Variant A (current subject)"
                        />

                        {/* A/B Body Testing */}
                        <ABSection
                          title="A/B Body Testing"
                          variantA={(steps[editingStep].body_html || '').replace(/<[^>]*>/g, '').slice(0, 100) + ((steps[editingStep].body_html || '').length > 100 ? '…' : '')}
                          variantB={(steps[editingStep] as any).body_html_b || ''}
                          onChangeB={(val) => setSteps(steps.map((s, i) => i === editingStep ? ({ ...s, body_html_b: val } as any) : s))}
                          onClear={() => setSteps(steps.map((s, i) => i === editingStep ? ({ ...s, body_html_b: '' } as any) : s))}
                          variantBPlaceholder="Alternative email body HTML…"
                          variantALabel="Variant A (current body)"
                          isTextarea
                        />

                        {/* Send test */}
                        {campaignForm.smtp_account_id && (
                          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                            <p className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                              <Send className="h-3 w-3" />
                              Send test email
                            </p>
                            <div className="flex gap-2">
                              <input
                                type="email"
                                value={testEmailTo}
                                onChange={(e) => setTestEmailTo(e.target.value)}
                                placeholder="your@email.com"
                                className="flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[11.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--indigo)]/15 transition-all"
                              />
                              <button
                                type="button"
                                disabled={sendingTest || !testEmailTo || !steps[editingStep].subject}
                                onClick={async () => {
                                  setSendingTest(true);
                                  try {
                                    const result = await smtpApi.sendTestEmail(campaignForm.smtp_account_id!, {
                                      to: testEmailTo,
                                      subject: steps[editingStep].subject || 'Test',
                                      body_html: steps[editingStep].body_html || '',
                                    });
                                    if (result.success) toast.success(result.message || 'Test sent!');
                                    else toast.error(result.error || 'Failed');
                                  } catch (err: any) {
                                    toast.error(err.response?.data?.error || 'Send failed');
                                  }
                                  setSendingTest(false);
                                }}
                                className="inline-flex items-center gap-1 px-3 rounded-md bg-[var(--indigo)] text-white text-[11px] font-semibold disabled:opacity-40 hover:bg-[var(--indigo-hover)] transition-colors"
                              >
                                <Send className="h-3 w-3" />
                                {sendingTest ? '…' : 'Send'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : editingStep !== null && steps[editingStep]?.step_type === 'delay' ? (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] sticky top-4 overflow-hidden">
                      <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 border border-amber-500/20">
                          <Clock className="h-3 w-3 text-amber-600" />
                        </span>
                        <div>
                          <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">Wait / Delay</p>
                          <p className="text-[10.5px] text-[var(--text-tertiary)]">Step {(editingStep ?? 0) + 1}</p>
                        </div>
                      </div>
                      <div className="p-4 space-y-3">
                        <p className="text-[12px] text-[var(--text-secondary)] leading-snug">
                          Set how long to wait before triggering the next step.
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: 'Days', key: 'delay_days', max: undefined },
                            { label: 'Hours', key: 'delay_hours', max: 23 },
                            { label: 'Min', key: 'delay_minutes', max: 59 },
                          ].map(({ label, key, max }) => (
                            <div key={key}>
                              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5 text-center">
                                {label}
                              </label>
                              <input
                                type="number" min="0" max={max}
                                value={(steps[editingStep] as any)[key] || 0}
                                onChange={(e) => updateStep(editingStep, { [key]: parseInt(e.target.value) || 0 } as any)}
                                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-2 text-center text-[14px] font-bold text-[var(--text-primary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo)]/15 transition-all tabular"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3 flex items-start gap-2">
                          <Sparkles className="h-3.5 w-3.5 text-[var(--indigo)] flex-shrink-0 mt-px" />
                          <p className="text-[11px] text-[var(--text-secondary)] leading-snug">
                            <span className="font-semibold text-[var(--text-primary)]">Pro tip:</span> A 1–3 day gap between emails typically yields the best reply rates.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 p-8 text-center sticky top-4 flex flex-col items-center justify-center min-h-[280px]">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] mb-3">
                        <FileText className="h-5 w-5 text-[var(--text-tertiary)]" strokeWidth={1.5} />
                      </div>
                      <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">Step editor</h3>
                      <p className="text-[11.5px] text-[var(--text-tertiary)] max-w-[200px] leading-snug">
                        Select any step in the sequence to configure its content and behaviour here.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setWizardStep(0)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Settings
                </Button>
                <Button onClick={() => setWizardStep(2)}>
                  Continue to audience
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* ════════ STEP 3 — Audience ════════ */}
          {wizardStep === 2 && (
            <div className="max-w-3xl mx-auto space-y-4">
              <SectionCard
                icon={Users}
                title="Recipients"
                description="Who will receive this campaign"
                accent="emerald"
                action={selectedContactIds.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-[11px] font-semibold">
                    <CheckCircle2 className="h-3 w-3" />
                    {selectedContactIds.length.toLocaleString()} selected
                  </span>
                ) : undefined}
              >
                {selectedContactIds.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] mx-auto mb-4">
                      <Users className="h-6 w-6 text-[var(--text-tertiary)]" strokeWidth={1.5} />
                    </div>
                    <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1">No recipients yet</h3>
                    <p className="text-[12px] text-[var(--text-secondary)] mb-5 max-w-xs mx-auto leading-snug">
                      Add individual contacts or pull from your saved lists to start populating the campaign.
                    </p>
                    <div className="flex items-center gap-2 justify-center">
                      <Button onClick={() => setShowContactModal(true)}>
                        <UserPlus className="h-3.5 w-3.5" />
                        Add contacts
                      </Button>
                      <Button variant="secondary" onClick={() => navigate('/contacts/import')}>
                        Import CSV
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                        <p className="text-[10.5px] uppercase tracking-wider text-[var(--text-tertiary)] font-bold">Recipients</p>
                        <p className="text-[20px] font-bold text-[var(--text-primary)] tabular leading-tight mt-0.5">
                          {selectedContactIds.length.toLocaleString()}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                        <p className="text-[10.5px] uppercase tracking-wider text-[var(--text-tertiary)] font-bold">Email steps</p>
                        <p className="text-[20px] font-bold text-[var(--text-primary)] tabular leading-tight mt-0.5">
                          {emailSteps.length}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--indigo-subtle)]/40 p-3">
                        <p className="text-[10.5px] uppercase tracking-wider text-[var(--indigo)] font-bold">Total sends</p>
                        <p className="text-[20px] font-bold text-[var(--indigo)] tabular leading-tight mt-0.5">
                          {(emailSteps.length * selectedContactIds.length).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {/* Selected preview */}
                    {(selectedContactsPreview || []).length > 0 && (
                      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-3">
                        <div className="flex items-center justify-between mb-2.5">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                            Preview ({Math.min(8, selectedContactIds.length)} of {selectedContactIds.length.toLocaleString()})
                          </p>
                          <Button variant="secondary" size="sm" onClick={() => setShowContactModal(true)}>
                            Modify recipients
                          </Button>
                        </div>
                        <div className="space-y-1.5">
                          {(selectedContactsPreview || []).map((c: any) => {
                            const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ');
                            return (
                              <div key={c.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                                <Avatar name={fullName || c.email} email={c.email} size="sm" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12px] font-medium text-[var(--text-primary)] truncate">{fullName || c.email}</p>
                                  {fullName && <p className="text-[10.5px] text-[var(--text-tertiary)] truncate">{c.email}</p>}
                                </div>
                                {c.company && (
                                  <span className="flex items-center gap-1 text-[10.5px] text-[var(--text-tertiary)] flex-shrink-0">
                                    <Building2 className="h-3 w-3" />
                                    <span className="truncate max-w-[120px]">{c.company}</span>
                                  </span>
                                )}
                                <button
                                  onClick={() => toggleContact(c.id)}
                                  className="text-[var(--text-tertiary)] hover:text-rose-500 p-0.5"
                                  title="Remove"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                          {selectedContactIds.length > 8 && (
                            <p className="text-[11px] text-[var(--text-tertiary)] text-center pt-1.5">
                              and {(selectedContactIds.length - 8).toLocaleString()} more…
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setWizardStep(1)}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Sequence
                </Button>
                <Button onClick={() => setWizardStep(3)}>
                  Continue to review
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* ════════ STEP 4 — Review ════════ */}
          {wizardStep === 3 && (() => {
            const delaySteps = steps.filter((s) => s.step_type === 'delay');
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
            const estDays = totalSends > 0 && weeklyCapacity > 0 ? Math.ceil((totalSends / weeklyCapacity) * 7) : 0;
            const estLabel = estDays === 0 ? '—'
              : estDays === 1 ? '~1 day'
              : estDays <= 7 ? `~${estDays} days`
              : `~${Math.ceil(estDays / 7)} weeks`;

            const healthChecks = [
              { label: 'Campaign name set', ok: !!campaignForm.name },
              { label: 'Sending account selected', ok: !!campaignForm.smtp_account_id },
              { label: 'At least one email step', ok: emailSteps.length > 0 },
              { label: 'All emails have subject', ok: emailSteps.every((s) => !!s.subject) },
              { label: 'All emails have body', ok: emailSteps.every((s) => !!s.body_html) },
              { label: 'Recipients added', ok: selectedContactIds.length > 0 },
              { label: 'Active days selected', ok: (campaignForm.send_days || []).length > 0 },
              { label: 'Daily limit configured', ok: (campaignForm.daily_limit ?? 0) >= 0 },
            ];
            const passedChecks = healthChecks.filter((c) => c.ok).length;
            const healthPct = (passedChecks / healthChecks.length) * 100;

            const smtpAccount = (smtpAccounts || []).find((a: SmtpAccount) => a.id === campaignForm.smtp_account_id);
            const reviewReady = passedChecks === healthChecks.length;

            return (
              <div className="max-w-5xl mx-auto space-y-4">
                {/* KPI strip */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  <StatCard label="Recipients" value={selectedContactIds.length.toLocaleString()} icon={Users} accent="indigo" />
                  <StatCard label="Email steps" value={emailSteps.length} icon={Mail} accent="emerald" />
                  <StatCard label="Wait steps" value={delaySteps.length} icon={Clock} accent="amber" />
                  <StatCard label="Total sends" value={totalSends.toLocaleString()} icon={Send} accent="violet" />
                  <StatCard label="Est. completion" value={estLabel} icon={Timer} accent="rose" />
                </div>

                {/* Health checks + Sequence preview */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <SectionCard
                    icon={ShieldCheck}
                    title="Health checks"
                    description={`${passedChecks} of ${healthChecks.length} passed`}
                    accent={reviewReady ? 'emerald' : 'amber'}
                  >
                    <div className="mb-3">
                      <div className="h-1.5 rounded-full overflow-hidden bg-[var(--bg-elevated)]">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-700',
                            reviewReady ? 'bg-emerald-500' : 'bg-amber-500'
                          )}
                          style={{ width: `${healthPct}%` }}
                        />
                      </div>
                    </div>
                    <ul className="space-y-1.5">
                      {healthChecks.map((c, i) => (
                        <li key={i} className="flex items-center gap-2 text-[12px]">
                          <span className={cn(
                            'flex h-4 w-4 items-center justify-center rounded-full flex-shrink-0',
                            c.ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-amber-500/15 text-amber-600'
                          )}>
                            {c.ok ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : <X className="h-2.5 w-2.5" strokeWidth={3} />}
                          </span>
                          <span className={c.ok ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)] font-medium'}>
                            {c.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </SectionCard>

                  <SectionCard
                    icon={Layers}
                    title="Sequence timeline"
                    description={`${steps.length} step${steps.length !== 1 ? 's' : ''} in this campaign`}
                    accent="indigo"
                  >
                    {steps.length === 0 ? (
                      <p className="text-[12px] text-[var(--text-tertiary)] py-4 text-center">No sequence steps yet</p>
                    ) : (
                      <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                        {steps.map((step, i) => (
                          <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[10.5px] font-bold text-[var(--text-secondary)] border border-[var(--border-subtle)] tabular">
                              {i + 1}
                            </span>
                            {step.step_type === 'email' ? (
                              <>
                                <Mail className="h-3.5 w-3.5 text-[var(--indigo)] flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12px] font-medium text-[var(--text-primary)] truncate">
                                    {step.subject || 'Untitled Email'}
                                  </p>
                                  {(step as any).subject_b && (
                                    <p className="text-[10.5px] text-[var(--text-tertiary)] truncate">
                                      A/B: "{(step as any).subject_b}"
                                    </p>
                                  )}
                                </div>
                              </>
                            ) : step.step_type === 'delay' ? (
                              <>
                                <Clock className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                                <p className="text-[12px] text-[var(--text-secondary)]">
                                  Wait {step.delay_days || 0}d {step.delay_hours || 0}h {step.delay_minutes || 0}m
                                </p>
                              </>
                            ) : (
                              <>
                                <Settings className="h-3.5 w-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
                                <p className="text-[12px] text-[var(--text-secondary)] capitalize">{step.step_type}</p>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                </div>

                {/* Capacity over time visualization */}
                {totalSends > 0 && (
                  <SectionCard
                    icon={TrendingUp}
                    title="Daily send capacity"
                    description={`${Math.round(effectiveDailyCapacity).toLocaleString()} emails/day · ${activeDaysPerWeek} active days/week`}
                    accent="violet"
                  >
                    <CapacityChart
                      totalSends={totalSends}
                      dailyCapacity={effectiveDailyCapacity}
                      sendDays={campaignForm.send_days || []}
                      estDays={estDays}
                    />
                  </SectionCard>
                )}

                {/* Settings summary */}
                <SectionCard icon={Settings} title="Settings summary" description="Configured options for this campaign" accent="indigo">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-[12.5px]">
                    {[
                      { label: 'Campaign name', value: campaignForm.name || '—' },
                      { label: 'Primary sender', value: smtpAccount ? `${smtpAccount.label} (${smtpAccount.email_address})` : '—' },
                      { label: 'Send window', value: `${campaignForm.send_window_start} – ${campaignForm.send_window_end} (${campaignForm.timezone})` },
                      { label: 'Active days', value: (campaignForm.send_days || []).map((d: string) => d.slice(0, 3).charAt(0).toUpperCase() + d.slice(1, 3)).join(', ') || '—' },
                      { label: 'Daily limit', value: campaignForm.daily_limit ? `${campaignForm.daily_limit} emails` : 'Unlimited' },
                      { label: 'Send delay', value: `${campaignForm.delay_between_emails_min ?? 50}s – ${campaignForm.delay_between_emails_max ?? 200}s` },
                      { label: 'Stop on reply', value: campaignForm.stop_on_reply !== false ? 'Enabled' : 'Disabled' },
                      { label: 'Tracking', value: [campaignForm.track_opens !== false && 'Opens', campaignForm.track_clicks !== false && 'Clicks'].filter(Boolean).join(', ') || 'None' },
                      { label: 'Unsubscribe link', value: campaignForm.include_unsubscribe ? 'Included' : 'Not included' },
                      senderPoolIds.length > 0 ? { label: 'Sender rotation', value: `${senderPoolIds.length} accounts` } : null,
                    ].filter(Boolean).map(({ label, value }: any) => (
                      <div key={label}>
                        <dt className="text-[10.5px] uppercase tracking-wider text-[var(--text-tertiary)] font-bold mb-0.5">{label}</dt>
                        <dd className="font-medium text-[var(--text-primary)]">{value}</dd>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                {/* Launch area */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-gradient-to-r from-[var(--indigo-subtle)]/30 to-violet-500/5 p-5">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0',
                        reviewReady ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
                      )}>
                        {reviewReady ? <Rocket className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                      </div>
                      <div>
                        <h3 className="text-[14px] font-bold text-[var(--text-primary)]">
                          {reviewReady ? 'Ready to launch' : 'Almost there'}
                        </h3>
                        <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 leading-snug max-w-md">
                          {reviewReady
                            ? `${selectedContactIds.length.toLocaleString()} contacts will receive ${emailSteps.length} email${emailSteps.length === 1 ? '' : 's'} once you launch.`
                            : `${healthChecks.length - passedChecks} health check${healthChecks.length - passedChecks === 1 ? '' : 's'} not yet passing — resolve before launching.`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="secondary"
                        onClick={handleSave}
                        disabled={createCampaignMutation.isPending || launching}
                      >
                        <Save className="h-3.5 w-3.5" />
                        {createCampaignMutation.isPending ? 'Saving…' : 'Save draft'}
                      </Button>
                      <button
                        onClick={() => reviewReady ? setShowLaunchConfirm(true) : toast.error('Resolve all health checks before launching')}
                        disabled={launching || createCampaignMutation.isPending}
                        className={cn(
                          'inline-flex items-center gap-2 px-5 py-2 rounded-md text-[13px] font-bold transition-all',
                          reviewReady
                            ? 'bg-[var(--indigo)] text-white hover:bg-[var(--indigo-hover)] shadow-[0_2px_8px_rgba(91,91,245,0.35)] hover:shadow-[0_4px_12px_rgba(91,91,245,0.45)]'
                            : 'bg-[var(--bg-elevated)] text-[var(--text-tertiary)] cursor-not-allowed'
                        )}
                      >
                        <Rocket className="h-4 w-4" />
                        {launching ? 'Launching…' : 'Launch campaign'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-start">
                  <Button variant="secondary" onClick={() => setWizardStep(2)}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to audience
                  </Button>
                </div>

                <Modal isOpen={showLaunchConfirm} onClose={() => setShowLaunchConfirm(false)} title="Launch campaign">
                  <div className="space-y-4">
                    <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                      You're about to launch{' '}
                      <strong className="text-[var(--text-primary)]">{campaignForm.name}</strong>. This will start sending emails to{' '}
                      <strong className="text-[var(--text-primary)]">{selectedContactIds.length.toLocaleString()} contacts</strong>{' '}
                      with{' '}
                      <strong className="text-[var(--text-primary)]">{emailSteps.length} email step{emailSteps.length !== 1 ? 's' : ''}</strong>.
                    </p>
                    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3.5 space-y-1.5 text-[12px] text-[var(--text-secondary)]">
                      <p>Sending window: {campaignForm.send_window_start} – {campaignForm.send_window_end} ({campaignForm.timezone})</p>
                      <p>Daily limit: {campaignForm.daily_limit || 'Unlimited'}</p>
                      <p>Stop on reply: {campaignForm.stop_on_reply !== false ? 'Yes' : 'No'}</p>
                      <p>Est. completion: {estLabel}</p>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="secondary" onClick={() => setShowLaunchConfirm(false)}>Cancel</Button>
                      <Button onClick={handleSaveAndLaunch} disabled={launching}>
                        <Rocket className="h-3.5 w-3.5" />
                        {launching ? 'Launching…' : 'Confirm & launch'}
                      </Button>
                    </div>
                  </div>
                </Modal>
              </div>
            );
          })()}
        </main>
      </div>

      {/* Contact selection modal */}
      <Modal isOpen={showContactModal} onClose={() => setShowContactModal(false)} title="Select contacts" size="lg">
        <div className="space-y-4">
          <div className="flex gap-1 p-1 bg-[var(--bg-elevated)] rounded-lg">
            {[
              { key: 'individual', label: 'Individual contacts', icon: UserPlus },
              { key: 'lists', label: 'Add from lists', icon: ListPlus },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setContactModalTab(key as any)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-[12.5px] font-medium transition-colors',
                  contactModalTab === key
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {contactModalTab === 'individual' ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  placeholder="Search by name, email, or company…"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-9 pr-3 py-2 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-2 focus:ring-[var(--indigo)]/15 transition-all"
                />
              </div>
              <div className="max-h-[350px] overflow-y-auto rounded-lg border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                {contacts.map((contact: ContactWithTags) => {
                  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
                  const isSelected = selectedContactIds.includes(contact.id);
                  return (
                    <label
                      key={contact.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors',
                        isSelected ? 'bg-[var(--indigo-subtle)]/30' : 'hover:bg-[var(--bg-hover)]'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleContact(contact.id)}
                        className="h-3.5 w-3.5 rounded border-[var(--border-default)] accent-[var(--indigo)]"
                      />
                      <Avatar name={fullName || contact.email} email={contact.email} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{fullName || contact.email}</p>
                        <p className="text-[10.5px] text-[var(--text-tertiary)] truncate">{contact.email}</p>
                      </div>
                      {contact.company && (
                        <span className="flex items-center gap-1 text-[10.5px] text-[var(--text-tertiary)] flex-shrink-0">
                          <Building2 className="h-3 w-3" />
                          {contact.company}
                        </span>
                      )}
                    </label>
                  );
                })}
                {contacts.length === 0 && (
                  <p className="p-6 text-center text-[12px] text-[var(--text-tertiary)]">No contacts found</p>
                )}
              </div>
            </>
          ) : (
            <div className="max-h-[400px] overflow-y-auto rounded-lg border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
              {(allLists || []).length === 0 ? (
                <p className="p-6 text-center text-[12px] text-[var(--text-tertiary)]">
                  No lists found. Create lists on the Contacts page first.
                </p>
              ) : (
                (allLists || []).map((list: any) => (
                  <div key={list.id} className="flex items-center gap-3 p-3 hover:bg-[var(--bg-hover)] transition-colors">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-secondary)] flex-shrink-0 border border-[var(--border-subtle)]">
                      <FolderOpen className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{list.name}</p>
                      <p className="text-[10.5px] text-[var(--text-tertiary)]">
                        {list.contact_count || 0} contact{(list.contact_count || 0) !== 1 ? 's' : ''}
                        {list.description && ` · ${list.description}`}
                      </p>
                    </div>
                    <button
                      onClick={() => addListContacts(list.id)}
                      disabled={addingListId === list.id || (list.contact_count || 0) === 0}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11.5px] font-medium border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 transition-all flex-shrink-0"
                    >
                      {addingListId === list.id ? <Spinner size="sm" /> : <Plus className="h-3 w-3" />}
                      {addingListId === list.id ? 'Adding…' : 'Add all'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <p className="text-[12.5px] text-[var(--text-secondary)]">
              <span className="font-bold text-[var(--text-primary)] tabular">{selectedContactIds.length.toLocaleString()}</span> selected
            </p>
            <Button onClick={() => setShowContactModal(false)}>
              <Check className="h-3.5 w-3.5" />
              Done
            </Button>
          </div>
        </div>
      </Modal>

      {/* AI generation modal */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowAiModal(false)}>
          <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-default)] shadow-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 border border-violet-500/20">
                  <Wand2 className="h-3.5 w-3.5 text-violet-600" />
                </span>
                <div>
                  <h2 className="text-[13.5px] font-semibold text-[var(--text-primary)]">Generate email with AI</h2>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">SARA will write the subject and body for you</p>
                </div>
              </div>
              <button onClick={() => setShowAiModal(false)} className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <Field label={<>What's the goal? <span className="text-rose-500">*</span></>}>
                <input
                  type="text"
                  value={aiGoal}
                  onChange={(e) => setAiGoal(e.target.value)}
                  placeholder="e.g. Book a demo call, introduce our product…"
                  className={inputCls}
                />
              </Field>
              <Field label="Product / Service">
                <input
                  type="text"
                  value={aiProduct}
                  onChange={(e) => setAiProduct(e.target.value)}
                  placeholder="e.g. SkySend email automation"
                  className={inputCls}
                />
              </Field>
              <Field label="Tone">
                <div className="grid grid-cols-3 gap-2">
                  {TONE_OPTIONS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setAiTone(t.value)}
                      className={cn(
                        'p-2.5 rounded-lg border text-center transition-all',
                        aiTone === t.value
                          ? 'border-violet-500/40 bg-violet-500/10 shadow-[0_0_0_1px_rgba(139,92,246,0.15)]'
                          : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
                      )}
                    >
                      <div className="text-lg mb-1">{t.icon}</div>
                      <p className={cn(
                        'text-[12px] font-semibold',
                        aiTone === t.value ? 'text-violet-700' : 'text-[var(--text-primary)]'
                      )}>{t.label}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 leading-tight">{t.description}</p>
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setShowAiModal(false)}>Cancel</Button>
              <button
                disabled={!aiGoal || aiGenerating}
                onClick={handleGenerateEmail}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2 rounded-md bg-violet-600 text-white text-[12.5px] font-semibold hover:bg-violet-700 disabled:opacity-50 transition-all"
              >
                {aiGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {aiGenerating ? 'Generating…' : 'Generate email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template picker */}
      {showTemplatePicker && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowTemplatePicker(false)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
                  <FolderOpen className="h-3.5 w-3.5 text-[var(--indigo)]" />
                </span>
                <div>
                  <h2 className="text-[13.5px] font-semibold text-[var(--text-primary)]">Apply sequence template</h2>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">This will replace your current sequence steps.</p>
                </div>
              </div>
              <button onClick={() => setShowTemplatePicker(false)} className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]">
                <X className="h-4 w-4 text-[var(--text-tertiary)]" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {sequenceTemplates.length === 0 ? (
                <div className="text-center py-12">
                  <Layers className="h-10 w-10 mx-auto text-[var(--text-tertiary)] mb-2" strokeWidth={1.5} />
                  <p className="text-[13px] text-[var(--text-secondary)] mb-1">No sequence templates yet</p>
                  <Link to="/templates" className="text-[11.5px] text-[var(--indigo)] hover:underline font-semibold">
                    Create your first template →
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {sequenceTemplates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => loadTemplate(t.id)}
                      className="text-left p-4 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--indigo)]/30 hover:bg-[var(--indigo-subtle)]/20 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="text-[13px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--indigo)] transition-colors flex-1 min-w-0 truncate">
                          {t.name}
                        </h3>
                        {t.is_preset && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--indigo-subtle)] text-[var(--indigo)] flex-shrink-0">
                            Preset
                          </span>
                        )}
                      </div>
                      {t.description && <p className="text-[11px] text-[var(--text-secondary)] mt-1 line-clamp-2 leading-snug">{t.description}</p>}
                      <div className="flex items-center gap-3 mt-2.5 text-[10.5px] text-[var(--text-tertiary)]">
                        <span className="flex items-center gap-1">
                          <Mail className="h-2.5 w-2.5" />
                          {(t.steps as any[])?.length || 0} steps
                        </span>
                        {t.category && (
                          <>
                            <span className="text-[var(--text-muted)]">·</span>
                            <span>{t.category}</span>
                          </>
                        )}
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

/* ─── Sub-components ───────────────────────────────────────────── */

function StatRow({ label, value, accent }: { label: string; value: string | number; accent?: 'indigo' }) {
  return (
    <div className="flex items-center justify-between text-[11.5px]">
      <span className="text-[var(--text-tertiary)]">{label}</span>
      <span className={cn(
        'tabular font-semibold',
        accent === 'indigo' ? 'text-[var(--indigo)]' : 'text-[var(--text-primary)]'
      )}>{value}</span>
    </div>
  );
}

function ABSection({
  title, variantA, variantB, onChangeB, onClear, variantBPlaceholder, variantALabel, isTextarea,
}: {
  title: string;
  variantA: string;
  variantB: string;
  onChangeB: (v: string) => void;
  onClear: () => void;
  variantBPlaceholder: string;
  variantALabel: string;
  isTextarea?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-3.5">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
          <Brain className="h-3 w-3 text-violet-600" />
          {title}
        </p>
        {variantB && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-[var(--text-tertiary)] hover:text-rose-500 transition-colors font-medium"
          >
            Clear
          </button>
        )}
      </div>
      <div className="space-y-2">
        <div>
          <label className="block text-[10.5px] font-medium text-[var(--text-tertiary)] mb-1 uppercase tracking-wider">
            {variantALabel}
          </label>
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[11.5px] text-[var(--text-secondary)] line-clamp-2">
            {variantA || 'Not yet set'}
          </div>
        </div>
        <div>
          <label className="block text-[10.5px] font-medium text-[var(--text-tertiary)] mb-1 uppercase tracking-wider">
            Variant B
          </label>
          {isTextarea ? (
            <textarea
              value={variantB}
              onChange={(e) => onChangeB(e.target.value)}
              rows={3}
              placeholder={variantBPlaceholder}
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[11.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--indigo)]/15 transition-all font-mono resize-y"
            />
          ) : (
            <input
              type="text"
              value={variantB}
              onChange={(e) => onChangeB(e.target.value)}
              placeholder={variantBPlaceholder}
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[11.5px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--indigo)]/15 transition-all"
            />
          )}
        </div>
      </div>
      <p className="text-[10.5px] text-[var(--text-tertiary)] mt-2 leading-snug">
        50/50 split — half your contacts receive Variant A, half receive Variant B.
      </p>
    </div>
  );
}

/* ─── Capacity chart ─────────────────────────────────────────── */

function CapacityChart({ totalSends, dailyCapacity, sendDays, estDays }: {
  totalSends: number;
  dailyCapacity: number;
  sendDays: string[];
  estDays: number;
}) {
  // Generate a 14-day projection
  const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const DAY_LBL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let remaining = totalSends;
  const days: { label: string; sends: number; active: boolean }[] = [];
  const today = new Date().getDay(); // 0 = Sunday
  // map: JS getDay 0=Sun..6=Sat → DAY_KEYS index where 0=Mon..6=Sun
  const jsToOurIdx = (jsDay: number) => (jsDay === 0 ? 6 : jsDay - 1);

  const maxDays = Math.min(14, Math.max(estDays + 1, 7));
  for (let i = 0; i < maxDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const ourIdx = jsToOurIdx(d.getDay());
    const dayKey = DAY_KEYS[ourIdx];
    const active = sendDays.includes(dayKey);
    let sends = 0;
    if (active && remaining > 0) {
      sends = Math.min(dailyCapacity, remaining);
      remaining -= sends;
    }
    const lbl = i === 0 ? 'Today' : DAY_LBL[ourIdx];
    days.push({ label: lbl, sends: Math.round(sends), active });
  }

  const maxBar = Math.max(1, ...days.map((d) => d.sends), dailyCapacity);

  return (
    <div>
      <div className="flex items-end gap-1.5 h-32 mb-2">
        {days.map((d, i) => {
          const pct = (d.sends / maxBar) * 100;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex-1 flex items-end relative">
                <div
                  className={cn(
                    'w-full rounded-t transition-all duration-700',
                    d.active && d.sends > 0
                      ? 'bg-gradient-to-t from-[var(--indigo)] to-violet-500'
                      : d.active
                      ? 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)]'
                      : 'bg-[var(--bg-elevated)]/50 border border-dashed border-[var(--border-subtle)]'
                  )}
                  style={{ height: `${Math.max(pct, d.active && d.sends > 0 ? 6 : 2)}%` }}
                  title={d.active ? `${d.sends.toLocaleString()} sends` : 'Inactive day'}
                />
              </div>
              <span className={cn(
                'text-[10px] font-medium tabular',
                d.active ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'
              )}>
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10.5px] text-[var(--text-tertiary)] pt-2 border-t border-[var(--border-subtle)]">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-gradient-to-t from-[var(--indigo)] to-violet-500" />
            Active send
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-[var(--bg-elevated)] border border-dashed border-[var(--border-subtle)]" />
            Inactive day
          </span>
        </span>
        <span className="font-semibold text-[var(--text-secondary)]">
          {estDays > 14 ? 'Showing first 14 days' : `Completes in ~${estDays} day${estDays === 1 ? '' : 's'}`}
        </span>
      </div>
    </div>
  );
}

/* ─── Recipient Preview ──────────────────────────────────────── */

function RecipientPreview({ subject, bodyHtml, fromName, fromEmail }: {
  subject: string;
  bodyHtml: string;
  fromName: string;
  fromEmail: string;
}) {
  const fillers: Record<string, string> = {
    first_name: 'Sarah', last_name: 'Chen', company: 'Acme Inc',
    job_title: 'Head of Sales', industry: 'SaaS',
  };
  const previewHtml = (bodyHtml || '').replace(/\{\{(\w+)\}\}/g, (_, k) => fillers[k] || `[${k}]`);
  const previewSubject = subject.replace(/\{\{(\w+)\}\}/g, (_, k) => fillers[k] || `[${k}]`);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)]">
        <Eye className="h-3 w-3 text-[var(--indigo)]" />
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Inbox preview</span>
        <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">sample data</span>
      </div>

      <div className="bg-white text-gray-900 px-3.5 py-2.5 border-b border-gray-200">
        <h3 className="text-[13px] font-semibold text-gray-900 mb-1.5 leading-snug">{previewSubject}</h3>
        <div className="flex items-center gap-2">
          <Avatar name={fromName || fromEmail} email={fromEmail} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="text-[11.5px] text-gray-900 truncate">
              <span className="font-semibold">{fromName}</span>{' '}
              <span className="text-gray-500">&lt;{fromEmail}&gt;</span>
            </div>
            <div className="text-[10px] text-gray-500">to Sarah Chen — now</div>
          </div>
        </div>
      </div>

      <iframe
        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
          html,body{margin:0;padding:14px;background:#fff;color:#111;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
            font-size:13.5px;line-height:1.55;word-break:break-word;}
          a{color:#1a73e8;text-decoration:none}
          img{max-width:100%;height:auto}
          p{margin:0 0 10px}
          h1,h2,h3{margin:14px 0 8px}
        </style></head><body>${previewHtml}</body></html>`}
        sandbox="allow-same-origin"
        style={{
          width: '100%', height: '220px', border: 'none', display: 'block',
          backgroundColor: '#fff', pointerEvents: 'none',
        }}
        title="Recipient inbox preview"
      />
    </div>
  );
}

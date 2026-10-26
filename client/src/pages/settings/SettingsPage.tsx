import { useState, useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { settingsApi, type UserSettings } from '../../api/settings.api';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { PageHeader } from '../../components/shared/PageHeader';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import { PLACEHOLDER } from '@lemlist/shared';
import { RelayEngineNote } from '../../components/inbox/PeopleFirstNotices';
import { NotificationTryOut } from '../../components/settings/NotificationTryOut';
import { Chip } from '../../components/ui/Chip';
import { BlackoutDatesEditor } from '../../components/shared/BlackoutDatesEditor';
import {
  User,
  Mail,
  Bell,
  Shield,
  Key,
  Globe,
  Palette,
  Save,
  CheckCircle,
  AlertCircle,
  Sun,
  Moon,
  Monitor,
  Sparkles,
  Zap,
  Info,
  Loader2,
  Settings as SettingsIcon,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';

type Tab = 'profile' | 'account' | 'notifications' | 'preferences' | 'ai';

interface TabConfig {
  id: Tab;
  label: string;
  icon: React.ElementType;
}

/** Quick heuristic strength score for the change-password meter — length + character variety. */
function getPasswordStrength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string; barClass: string; textClass: string } {
  if (!password) return { score: 0, label: '', barClass: 'bg-transparent', textClass: '' };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;

  const levels: Record<number, { label: string; barClass: string; textClass: string }> = {
    0: { label: 'Very weak', barClass: 'bg-[var(--error)]', textClass: 'text-[var(--error)]' },
    1: { label: 'Weak', barClass: 'bg-[var(--error)]', textClass: 'text-[var(--error)]' },
    2: { label: 'Fair', barClass: 'bg-amber-500', textClass: 'text-amber-600 dark:text-amber-400' },
    3: { label: 'Good', barClass: 'bg-[var(--indigo)]', textClass: 'text-[var(--indigo-text)]' },
    4: { label: 'Strong', barClass: 'bg-[var(--success)]', textClass: 'text-[var(--success)]' },
  };
  return { score: score as 0 | 1 | 2 | 3 | 4, ...levels[score] };
}

const tabs: TabConfig[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'account', label: 'Account', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'preferences', label: 'Preferences', icon: Palette },
  { id: 'ai', label: 'AI features', icon: Sparkles },
];

const TAB_IDS = tabs.map((t) => t.id);

export function SettingsPage() {
  const { user, signOut } = useAuth();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<Tab>(
    (TAB_IDS as string[]).includes(requestedTab || '') ? (requestedTab as Tab) : 'profile'
  );

  // Re-sync when the URL's ?tab= changes on an already-mounted SettingsPage
  // (e.g. clicking "Account" in the header dropdown while already on /settings).
  // Keyed on location.key (not just requestedTab) so this still fires when the
  // header re-navigates to the same ?tab= value after the user has since
  // clicked a different in-page tab — otherwise the string comparison sees no
  // change and the resync silently no-ops.
  useEffect(() => {
    if (requestedTab && (TAB_IDS as string[]).includes(requestedTab)) {
      setActiveTab(requestedTab as Tab);
    }
  }, [requestedTab, location.key]);

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');

  const [emailNotifications, setEmailNotifications] = useState(true);
  const [campaignAlerts, setCampaignAlerts] = useState(true);
  const [replyNotifications, setReplyNotifications] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(false);
  const [monthlyResults, setMonthlyResults] = useState(true);

  const [defaultSignature, setDefaultSignature] = useState('');

  // AI Features settings (uses same DB columns as Relay for backwards compat)
  const [aiTaggingEnabled, setAiTaggingEnabled] = useState(true);
  const [aiAutoClassify, setAiAutoClassify] = useState(true);
  const [aiAutoUnsubscribe, setAiAutoUnsubscribe] = useState(true);
  const [aiAutoBounce, setAiAutoBounce] = useState(true);
  const [crmAutoDeals, setCrmAutoDeals] = useState(true);
  const [stopAllOnReply, setStopAllOnReply] = useState(false);
  const [pauseCompany, setPauseCompany] = useState(true);
  const [bounceGuard, setBounceGuard] = useState(true);
  const [bounceThreshold, setBounceThreshold] = useState(8);
  // The other two brakes beside it: spam complaints and an open-rate cliff.
  const [complaintGuard, setComplaintGuard] = useState(true);
  const [complaintThreshold, setComplaintThreshold] = useState(0.3);
  const [openGuard, setOpenGuard] = useState(true);
  const [openDrop, setOpenDrop] = useState(60);
  // Days nothing is sent, account-wide (shared/blackout).
  const [blackoutDates, setBlackoutDates] = useState<string[]>([]);
  const [domainLimit, setDomainLimit] = useState(5);
  const [autoVerifyContacts, setAutoVerifyContacts] = useState(true);
  // When a prospect becomes a contact without anyone moving them.
  const [autoPromote, setAutoPromote] = useState(true);
  const [promoteOnReply, setPromoteOnReply] = useState<'any' | 'positive' | 'off'>('any');
  const [promoteOnMeeting, setPromoteOnMeeting] = useState(true);
  const [promoteOnDeal, setPromoteOnDeal] = useState(true);
  // What Relay's drafts and the sequence writer start from.
  const [relayOffer, setRelayOffer] = useState('');
  const [relayTone, setRelayTone] = useState<'friendly' | 'direct' | 'formal'>('friendly');

  // Password change
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Delete account
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  // Track if form has unsaved changes
  const [hasChanges, setHasChanges] = useState(false);
  // Mirrors hasChanges for the hydration effect below, which must read the
  // latest value without re-running every time hasChanges itself changes.
  const hasChangesRef = useRef(false);
  useEffect(() => {
    hasChangesRef.current = hasChanges;
  }, [hasChanges]);

  // ── Fetch settings from backend ──
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  // Populate form when settings load. Guarded against hasChanges: a
  // background refetch (e.g. React Query's refetchOnWindowFocus firing after
  // the user alt-tabs away and back) must not silently overwrite in-progress
  // edits — the user would lose their edits with no warning.
  useEffect(() => {
    if (hasChangesRef.current) return;
    if (settings) {
      setFirstName(settings.first_name || '');
      setLastName(settings.last_name || '');
      setCompany(settings.company || '');
      setJobTitle(settings.job_title || '');
      setTimezone(settings.timezone || 'America/New_York');
      setEmailNotifications(settings.email_notifications ?? true);
      setCampaignAlerts(settings.campaign_alerts ?? true);
      setReplyNotifications(settings.reply_notifications ?? true);
      setWeeklyDigest(settings.weekly_digest ?? false);
      setMonthlyResults(settings.monthly_results ?? true);
      setDefaultSignature(settings.default_signature || '');
      setAiTaggingEnabled((settings as any).ai_tagging_enabled ?? settings.sara_enabled ?? true);
      setAiAutoClassify(settings.sara_auto_classify ?? true);
      setAiAutoUnsubscribe(settings.sara_auto_unsubscribe ?? true);
      setAiAutoBounce(settings.sara_auto_bounce ?? true);
      setCrmAutoDeals((settings as any).crm_auto_deals ?? true);
      setStopAllOnReply((settings as any).stop_all_campaigns_on_reply ?? false);
      setPauseCompany((settings as any).pause_company_on_reply ?? true);
      setBounceGuard((settings as any).bounce_guard_enabled ?? true);
      setBounceThreshold(Number((settings as any).bounce_guard_threshold ?? 8));
      setComplaintGuard(settings.complaint_guard_enabled ?? true);
      setComplaintThreshold(Number(settings.complaint_guard_threshold ?? 0.3));
      setOpenGuard(settings.open_guard_enabled ?? true);
      setOpenDrop(Number(settings.open_guard_drop ?? 60));
      setBlackoutDates(Array.isArray(settings.blackout_dates) ? settings.blackout_dates : []);
      setDomainLimit(Number((settings as any).domain_hourly_limit ?? 5));
      setAutoVerifyContacts((settings as any).auto_verify_contacts ?? true);
      setAutoPromote(settings.contact_auto_promote ?? true);
      setPromoteOnReply(settings.contact_promote_on_reply ?? 'any');
      setPromoteOnMeeting(settings.contact_promote_on_meeting ?? true);
      setPromoteOnDeal(settings.contact_promote_on_deal ?? true);
      setRelayOffer((settings as any).relay_offer ?? '');
      setRelayTone((settings as any).relay_tone ?? 'friendly');
      setHasChanges(false);
    }
  }, [settings]);

  // Track changes
  const markChanged = () => setHasChanges(true);

  // Warn before the tab closes/refreshes with unsaved edits — otherwise they're
  // lost silently, since the "unsaved changes" label is easy to miss unless
  // you're already looking at the Save button.
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  // ── Save settings mutation ──
  const saveMutation = useMutation({
    mutationFn: (updates: Partial<UserSettings>) => settingsApi.update(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Settings saved');
      setHasChanges(false);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to save settings');
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      first_name: firstName,
      last_name: lastName,
      company,
      job_title: jobTitle,
      timezone,
      email_notifications: emailNotifications,
      campaign_alerts: campaignAlerts,
      reply_notifications: replyNotifications,
      weekly_digest: weeklyDigest,
      monthly_results: monthlyResults,
      default_signature: defaultSignature,
      theme: themeMode,
      sara_enabled: aiTaggingEnabled,
      sara_auto_classify: aiAutoClassify,
      // These three have no UI control on this page yet — preserve whatever
      // is already saved instead of clobbering it with a hardcoded default
      // on every unrelated save (e.g. just editing First Name).
      sara_auto_execute: settings?.sara_auto_execute ?? true,
      sara_confidence_threshold: settings?.sara_confidence_threshold ?? 85,
      sara_draft_replies: (settings as any)?.sara_draft_replies ?? false,
      sara_auto_unsubscribe: aiAutoUnsubscribe,
      sara_auto_bounce: aiAutoBounce,
      crm_auto_deals: crmAutoDeals,
      stop_all_campaigns_on_reply: stopAllOnReply,
      pause_company_on_reply: pauseCompany,
      bounce_guard_enabled: bounceGuard,
      bounce_guard_threshold: bounceThreshold,
      complaint_guard_enabled: complaintGuard,
      complaint_guard_threshold: complaintThreshold,
      open_guard_enabled: openGuard,
      open_guard_drop: openDrop,
      blackout_dates: blackoutDates,
      domain_hourly_limit: domainLimit,
      ai_tagging_enabled: aiTaggingEnabled,
      auto_verify_contacts: autoVerifyContacts,
      contact_auto_promote: autoPromote,
      contact_promote_on_reply: promoteOnReply,
      contact_promote_on_meeting: promoteOnMeeting,
      contact_promote_on_deal: promoteOnDeal,
      relay_offer: relayOffer,
      relay_tone: relayTone,
    });
  };

  // ── Change password mutation ──
  const changePasswordMutation = useMutation({
    mutationFn: () => settingsApi.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast.success('Password updated successfully');
      setShowPasswordModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to update password');
    },
  });

  const handleChangePassword = () => {
    if (!currentPassword) {
      toast.error('Enter your current password');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    changePasswordMutation.mutate();
  };

  // ── Delete account mutation ──
  const deleteAccountMutation = useMutation({
    mutationFn: (confirmation: string) => settingsApi.deleteAccount(confirmation),
    onSuccess: async () => {
      toast.success('Account deleted');
      await signOut();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to delete account');
    },
  });

  const handleDeleteAccount = () => {
    if (deleteConfirmation !== 'DELETE') {
      toast.error('Please type DELETE to confirm');
      return;
    }
    deleteAccountMutation.mutate(deleteConfirmation);
  };

  // Helper to handle theme change — also marks form as changed
  const handleThemeChange = (value: 'light' | 'dark' | 'system') => {
    setThemeMode(value);
    markChanged();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  return (
    <>
    <div>
      <PageHeader
        icon={SettingsIcon}
        title="General"
        description="Your profile, account, notifications and AI preferences."
      />

      {/* Section tabs — horizontal; the settings categories live in the shell rail */}
      <div className="flex items-center gap-1 border-b border-[var(--border-subtle)] max-w-full overflow-x-auto scrollbar-none mb-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative -mb-px flex items-center gap-1.5 h-9 px-2.5 border-b-[1.5px] text-strong font-medium whitespace-nowrap transition-colors',
                isActive
                  ? 'border-[var(--text-primary)] text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', isActive ? 'opacity-90' : 'opacity-60')} strokeWidth={1.75} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="min-w-0">
          {/* The form on the page, not in a box on the page; held to a
              readable width so a name field is not 900px long. */}
          <div className="max-w-3xl">
            {/* ═══ Profile Tab ═══ */}
            {activeTab === 'profile' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-heading font-semibold text-[var(--text-primary)]">Profile information</h2>
                  <p className="text-strong text-[var(--text-secondary)] mt-1">Update your personal details</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="settings-first-name" className="block text-strong font-medium text-[var(--text-secondary)] mb-1.5">First name</label>
                    <input id="settings-first-name"
                      type="text"
                      value={firstName}
                      onChange={(e) => { setFirstName(e.target.value); markChanged(); }}
                      placeholder="John"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-last-name" className="block text-strong font-medium text-[var(--text-secondary)] mb-1.5">Last name</label>
                    <input id="settings-last-name"
                      type="text"
                      value={lastName}
                      onChange={(e) => { setLastName(e.target.value); markChanged(); }}
                      placeholder="Doe"
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="settings-company" className="block text-strong font-medium text-[var(--text-secondary)] mb-1.5">Company</label>
                    <input id="settings-company"
                      type="text"
                      value={company}
                      onChange={(e) => { setCompany(e.target.value); markChanged(); }}
                      placeholder="Acme Inc."
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label htmlFor="settings-job-title" className="block text-strong font-medium text-[var(--text-secondary)] mb-1.5">Job title</label>
                    <input id="settings-job-title"
                      type="text"
                      value={jobTitle}
                      onChange={(e) => { setJobTitle(e.target.value); markChanged(); }}
                      placeholder="Sales Manager"
                      className="input-field"
                    />
                  </div>
                </div>

                <div>
                  <span className="block text-strong font-medium text-[var(--text-secondary)] mb-1.5">Email</span>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5">
                      <Mail className="h-4 w-4 text-[var(--text-tertiary)]" />
                      <span className="text-strong text-[var(--text-secondary)]">{user?.email || 'Not set'}</span>
                    </div>
                    <span className="flex items-center gap-1.5 text-body text-[var(--success)] bg-[var(--success-bg)] px-3 py-1.5 rounded-full font-medium">
                      <CheckCircle className="h-3.5 w-3.5" />
                      Verified
                    </span>
                  </div>
                </div>

                <div>
                  <label htmlFor="settings-timezone" className="block text-strong font-medium text-[var(--text-secondary)] mb-1.5">
                    <Globe className="inline h-3.5 w-3.5 mr-1.5 text-[var(--text-tertiary)]" />
                    Timezone
                  </label>
                  <select id="settings-timezone"
                    value={timezone}
                    onChange={(e) => { setTimezone(e.target.value); markChanged(); }}
                    className="input-field"
                  >
                    <option value="America/New_York">Eastern Time (ET)</option>
                    <option value="America/Chicago">Central Time (CT)</option>
                    <option value="America/Denver">Mountain Time (MT)</option>
                    <option value="America/Los_Angeles">Pacific Time (PT)</option>
                    <option value="Europe/London">London (GMT)</option>
                    <option value="Europe/Paris">Paris (CET)</option>
                    <option value="Europe/Berlin">Berlin (CET)</option>
                    <option value="Asia/Tokyo">Tokyo (JST)</option>
                    <option value="Asia/Shanghai">Shanghai (CST)</option>
                    <option value="Australia/Sydney">Sydney (AEST)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
              </div>
            )}

            {/* ═══ Account Tab ═══ */}
            {activeTab === 'account' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-heading font-semibold text-[var(--text-primary)]">Account security</h2>
                  <p className="text-strong text-[var(--text-secondary)] mt-1">Manage your password and security settings</p>
                </div>

                {/* Change Password */}
                <div className="p-5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-[var(--bg-surface)] flex items-center justify-center">
                      <Key className="h-5 w-5 text-[var(--text-primary)]" />
                    </div>
                    <div>
                      <p className="text-strong font-medium text-[var(--text-primary)]">Password</p>
                      <p className="text-body text-[var(--text-tertiary)]">Update your account password</p>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setShowPasswordModal(true)}>
                    Change password
                  </Button>
                </div>

                {/* Password Modal */}
                {showPasswordModal && (
                  <div className="p-5 rounded-xl bg-[var(--bg-surface)] space-y-4" style={{ border: '2px solid rgba(47,63,156,0.25)' }}>
                    <h3 className="text-strong font-semibold text-[var(--text-primary)]">Change password</h3>
                    <div>
                      <label htmlFor="settings-current-password" className="block text-body font-medium text-[var(--text-secondary)] mb-1.5">Current password</label>
                      <input id="settings-current-password"
                        type={showPassword ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label htmlFor="settings-new-password" className="block text-body font-medium text-[var(--text-secondary)] mb-1.5">New password</label>
                      <div className="relative">
                        <input
                          id="settings-new-password"
                          type={showPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min. 6 characters"
                          className="input-field pr-10"
                        />
                        <button aria-label={showPassword ? "Hide password" : "Show password"}
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] after:absolute after:-inset-1 after:content-['']"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      {newPassword && (
                        <div className="mt-2">
                          <div className="flex gap-1">
                            {[0, 1, 2, 3].map((i) => (
                              <div
                                key={i}
                                className={cn(
                                  'h-1 flex-1 rounded-full transition-colors',
                                  i < getPasswordStrength(newPassword).score ? getPasswordStrength(newPassword).barClass : 'bg-[var(--border-subtle)]'
                                )}
                              />
                            ))}
                          </div>
                          <p className={cn('text-caption mt-1 font-medium', getPasswordStrength(newPassword).textClass)}>
                            {getPasswordStrength(newPassword).label}
                          </p>
                        </div>
                      )}
                    </div>
                    <div>
                      <label htmlFor="settings-confirm-password" className="block text-body font-medium text-[var(--text-secondary)] mb-1.5">Confirm password</label>
                      <input id="settings-confirm-password"
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className="input-field"
                      />
                      {confirmPassword && newPassword !== confirmPassword && (
                        <p className="text-body text-[var(--error)] mt-1">Passwords do not match</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleChangePassword}
                        disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || newPassword !== confirmPassword}
                      >
                        {changePasswordMutation.isPending ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating...</>
                        ) : (
                          'Update Password'
                        )}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { setShowPasswordModal(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* 2FA placeholder */}
                <div className="p-5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-[var(--bg-surface)] flex items-center justify-center">
                        <Shield className="h-5 w-5 text-[var(--text-primary)]" />
                      </div>
                      <div>
                        <p className="text-strong font-medium text-[var(--text-primary)]">Two-Factor Authentication</p>
                        <p className="text-body text-[var(--text-tertiary)]">Add an extra layer of security</p>
                      </div>
                    </div>
                    <span className="flex items-center gap-1.5 text-body text-[var(--warning)] bg-[var(--warning-bg)] px-3 py-1.5 rounded-full font-medium">
                      <AlertCircle className="h-3 w-3" />
                      Coming soon
                    </span>
                  </div>
                </div>

                {/* Connected accounts */}
                <div className="pt-6 border-t border-[var(--border-subtle)]">
                  <h3 className="text-strong font-semibold text-[var(--text-primary)] mb-4">Connected accounts</h3>
                  <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors">
                    <div className="flex items-center gap-3">
                      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                      <span className="text-strong font-medium text-[var(--text-primary)]">Google</span>
                    </div>
                    <span className="text-body text-[var(--text-tertiary)]">Managed via Supabase Auth</span>
                  </div>
                </div>

                {/* Danger Zone */}
                <div className="pt-6 border-t border-[var(--border-subtle)]">
                  <h3 className="text-strong font-semibold text-[var(--error)] mb-4">Danger zone</h3>
                  <div className="p-5 border border-[var(--error)]/20 rounded-xl bg-[var(--error-bg)]">
                    <p className="text-strong text-[var(--text-secondary)] mb-4">
                      Once you delete your account, there is no going back. All your campaigns, contacts, SMTP accounts, and data will be permanently removed.
                    </p>
                    {!showDeleteModal ? (
                      <Button variant="danger" size="sm" onClick={() => setShowDeleteModal(true)}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete account
                      </Button>
                    ) : (
                      <div className="space-y-3 p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--error)]/30">
                        <p className="text-body font-medium text-[var(--error)]">
                          Type <span className="font-bold">DELETE</span> to confirm permanent account deletion:
                        </p>
                        <input
                          type="text"
                          aria-label="Type DELETE to confirm"
                          value={deleteConfirmation}
                          onChange={(e) => setDeleteConfirmation(e.target.value)}
                          placeholder="Type DELETE"
                          className="input-field text-strong"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={handleDeleteAccount}
                            disabled={deleteAccountMutation.isPending || deleteConfirmation !== 'DELETE'}
                          >
                            {deleteAccountMutation.isPending ? (
                              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting...</>
                            ) : (
                              'Permanently Delete Account'
                            )}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => { setShowDeleteModal(false); setDeleteConfirmation(''); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ Notifications Tab ═══ */}
            {activeTab === 'notifications' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-heading font-semibold text-[var(--text-primary)]">Notifications</h2>
                  <p className="text-strong text-[var(--text-secondary)] mt-1">
                    Emails about your own account. They come from your first connected mailbox to the address you sign in with.
                  </p>
                </div>

                <div>
                  <ToggleSetting
                    label="Something needs attention"
                    description="A mailbox that cannot send, replies that stopped syncing, every mailbox resting, a spam complaint, or a reply check that failed. One email when it starts, nothing more until something new happens."
                    checked={emailNotifications}
                    onChange={(v) => { setEmailNotifications(v); markChanged(); }}
                  />
                  <ToggleSetting
                    label="Campaign alerts"
                    description="When something happens to a campaign without you: the bounce guard pauses it, or it finishes. Never for your own launch, pause or resume."
                    checked={campaignAlerts}
                    onChange={(v) => { setCampaignAlerts(v); markChanged(); }}
                  />
                  <ToggleSetting
                    label="Reply notifications"
                    description="An email for each reply from a prospect, with what they said. At most 20 an hour, so a busy morning does not bury you."
                    checked={replyNotifications}
                    onChange={(v) => { setReplyNotifications(v); markChanged(); }}
                  />
                  <ToggleSetting
                    label="Weekly digest"
                    description="Monday at 8am in your time zone: what went out, who replied, meetings booked, what bounced, and anything that needs a look."
                    checked={weeklyDigest}
                    onChange={(v) => { setWeeklyDigest(v); markChanged(); }}
                  />
                  <ToggleSetting
                    label="Monthly results"
                    description="On the 1st: last month's meetings, pipeline and revenue from outreach, compared with the month before. Only sent when something went out."
                    checked={monthlyResults}
                    onChange={(v) => { setMonthlyResults(v); markChanged(); }}
                  />
                </div>

                <NotificationTryOut />
              </div>
            )}

            {/* ═══ Preferences Tab ═══ */}
            {activeTab === 'preferences' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-heading font-semibold text-[var(--text-primary)]">Preferences</h2>
                  <p className="text-strong text-[var(--text-secondary)] mt-1">Customize your experience</p>
                </div>

                <div>
                  <span id="settings-theme-label" className="block text-strong font-medium text-[var(--text-secondary)] mb-3">Theme</span>
                  <div className="flex gap-2" role="group" aria-labelledby="settings-theme-label">
                    {([
                      { value: 'light' as const, label: 'Light', icon: Sun },
                      { value: 'dark' as const, label: 'Dark', icon: Moon },
                      { value: 'system' as const, label: 'System', icon: Monitor },
                    ]).map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => handleThemeChange(value)}
                        aria-pressed={themeMode === value}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-strong font-medium transition-all duration-200 border ${
                          themeMode === value
                            ? 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)] border-[var(--indigo)]'
                            : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--border-default)]'
                        }`}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.5} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="settings-default-email-signature" className="block text-strong font-medium text-[var(--text-secondary)] mb-1.5">
                    Default email signature
                  </label>
                  <textarea id="settings-default-email-signature"
                    value={defaultSignature}
                    onChange={(e) => { setDefaultSignature(e.target.value); markChanged(); }}
                    placeholder={`Best regards,\n${PLACEHOLDER.senderName}`}
                    rows={4}
                    className="input-field resize-none"
                  />
                  <p className="mt-2 text-body text-[var(--text-tertiary)]">
                    Use {'{{signature}}'} in emails to insert this
                  </p>
                </div>

                {/* Closed days. Every campaign skips them; a campaign can add
                    its own on top in the builder. */}
                <div className="pt-2">
                  <span className="block text-strong font-medium text-[var(--text-secondary)] mb-1">Closed days</span>
                  <p className="text-body text-[var(--text-tertiary)] mb-3 leading-snug">
                    No campaign sends on these dates. Emails due on one wait for the next open day, on each
                    campaign&rsquo;s own clock &mdash; or the recipient&rsquo;s, when a campaign sends in their time zone.
                  </p>
                  <BlackoutDatesEditor
                    idPrefix="settings"
                    value={blackoutDates}
                    onChange={(next) => { setBlackoutDates(next); markChanged(); }}
                  />
                </div>

                <div className="pt-2">
                  <span className="block text-strong font-medium text-[var(--text-secondary)] mb-1.5">Deliverability</span>
                  <ToggleSetting
                    label="Auto-verify contacts"
                    description="Automatically check new and imported contacts in the background (syntax, mail server & mailbox) so the verification status stays up to date."
                    checked={autoVerifyContacts}
                    onChange={(v) => { setAutoVerifyContacts(v); markChanged(); }}
                  />
                </div>

                {/* Prospects -> Contacts. Auto-replies, out-of-office notes,
                    bounces and unsubscribe requests never count; that is
                    enforced on the server, not offered as a choice. */}
                <div className="pt-2">
                  <span className="block text-strong font-medium text-[var(--text-secondary)] mb-1.5">Prospects and contacts</span>
                  <ToggleSetting
                    label="Move prospects to Contacts automatically"
                    description="When a prospect engages, move them to Contacts for you. Turn off to move people only by hand, from the Contacts list or a contact's page."
                    checked={autoPromote}
                    onChange={(v) => { setAutoPromote(v); markChanged(); }}
                  />
                  {autoPromote && (
                    <div className="pl-0 sm:pl-4 border-l-0 sm:border-l-2 border-[var(--border-subtle)]">
                      <div className="py-3.5 border-b border-[var(--border-subtle)]">
                        <p id="settings-promote-reply-label" className="text-strong font-medium text-[var(--text-primary)]">When they reply</p>
                        <p className="text-body text-[var(--text-tertiary)] mt-0.5 leading-snug">
                          Auto-replies, out-of-office notes, bounces and unsubscribe requests never move anyone.
                        </p>
                        <div className="mt-2.5 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="settings-promote-reply-label">
                          {([
                            { value: 'any' as const, label: 'Any reply from a person' },
                            { value: 'positive' as const, label: 'Only interested replies' },
                            { value: 'off' as const, label: 'Never' },
                          ]).map(({ value, label }) => (
                            <button
                              key={value}
                              type="button"
                              role="radio"
                              aria-checked={promoteOnReply === value}
                              onClick={() => { setPromoteOnReply(value); markChanged(); }}
                              className={`py-2 px-3 rounded-lg text-strong font-medium transition-colors duration-200 border ${
                                promoteOnReply === value
                                  ? 'bg-[var(--indigo-subtle)] text-[var(--indigo-text)] border-[var(--indigo)]'
                                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border-[var(--border-subtle)] hover:border-[var(--border-default)]'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {promoteOnReply === 'positive' && (
                          <p className="mt-2 text-body text-[var(--text-tertiary)] leading-snug">
                            Interested means the reply reads as a yes or asks to meet. Questions, objections and "not now" stay in Prospects.
                          </p>
                        )}
                      </div>
                      <ToggleSetting
                        label="When a meeting is booked"
                        description="Someone books time through your booking page, or you log a meeting with them."
                        checked={promoteOnMeeting}
                        onChange={(v) => { setPromoteOnMeeting(v); markChanged(); }}
                      />
                      <ToggleSetting
                        label="When they become a lead or join a deal"
                        description="You make them a lead, or add them to a deal in the pipeline."
                        checked={promoteOnDeal}
                        onChange={(v) => { setPromoteOnDeal(v); markChanged(); }}
                      />
                    </div>
                  )}
                  <p className="mt-2 text-body text-[var(--text-tertiary)] leading-snug">
                    People you move back to Prospects by hand stay there until you move them again.
                  </p>
                </div>
              </div>
            )}

            {/* ═══ AI Features Tab ═══ */}
            {activeTab === 'ai' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-heading font-semibold text-[var(--text-primary)]">AI features</h2>
                  <p className="text-strong text-[var(--text-secondary)] mt-1">
                    How Relay reads your replies and drafts your answers.
                  </p>
                </div>

                <div className="relative overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-[inset_3px_0_0_var(--indigo)]">
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-5 w-5 text-[var(--indigo-text)] mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-strong font-medium text-[var(--text-primary)]">Smart email tagging</p>
                      <p className="text-body text-[var(--text-secondary)] mt-1 leading-relaxed">
                        AI automatically tags incoming replies by intent &mdash; Interested, Wants a meeting,
                        Not Interested, Objection, Out of Office, Unsubscribe, and Bounce.
                        Filter your inbox by tag to quickly find the messages that matter most.
                      </p>
                    </div>
                  </div>
                </div>

                <RelayEngineNote />

                {/* What Relay knows about you. Every draft and every sequence
                    it writes starts here; without it, it can only be generic. */}
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
                  <div>
                    <label htmlFor="relay-offer" className="text-strong font-semibold text-[var(--text-primary)]">What you sell</label>
                    <p className="text-body text-[var(--text-tertiary)] mt-0.5">
                      Who it is for, what it does for them, and any proof you are happy to have quoted. Relay uses this for reply drafts and for writing sequences.
                    </p>
                  </div>
                  <textarea
                    id="relay-offer"
                    value={relayOffer}
                    onChange={(e) => { setRelayOffer(e.target.value); markChanged(); }}
                    rows={4}
                    maxLength={2000}
                    placeholder="e.g. We help logistics firms cut failed deliveries with route checks before dispatch. Customers typically see 20% fewer failed drops in the first month."
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--indigo)] focus:ring-2 focus:ring-[var(--indigo)]/15"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-medium text-[var(--text-secondary)]">How you sound</span>
                    {(['friendly', 'direct', 'formal'] as const).map((t) => (
                      <Chip key={t} active={relayTone === t} onClick={() => { setRelayTone(t); markChanged(); }}>
                        {t === 'friendly' ? 'Friendly' : t === 'direct' ? 'Direct' : 'Formal'}
                      </Chip>
                    ))}
                  </div>
                </div>

                <ToggleSetting
                  label="AI Email Tagging"
                  description="Automatically tag incoming emails by intent (interested, meeting, etc.)"
                  checked={aiTaggingEnabled}
                  onChange={(v) => { setAiTaggingEnabled(v); markChanged(); }}
                />

                {aiTaggingEnabled && (
                  <>
                    <div className="space-y-3">
                      <div className="px-1">
                        <h3 className="text-strong font-semibold text-[var(--text-primary)] flex items-center gap-2">
                          <Zap className="h-4 w-4 text-[var(--c-indigo)]" />
                          Auto-Tagging
                        </h3>
                      </div>

                      <ToggleSetting
                        label="Auto-tag new replies"
                        description="Automatically tag incoming replies as they arrive in your inbox"
                        checked={aiAutoClassify}
                        onChange={(v) => { setAiAutoClassify(v); markChanged(); }}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="px-1">
                        <h3 className="text-strong font-semibold text-[var(--text-primary)] flex items-center gap-2">
                          <Zap className="h-4 w-4 text-[var(--c-indigo)]" />
                          Auto actions
                        </h3>
                        <p className="text-body text-[var(--text-tertiary)] mt-1">
                          Actions that are automatically performed for high-confidence tags
                        </p>
                      </div>

                      <ToggleSetting
                        label="Auto-unsubscribe"
                        description="Automatically unsubscribe contacts who request removal (high confidence)"
                        checked={aiAutoUnsubscribe}
                        onChange={(v) => { setAiAutoUnsubscribe(v); markChanged(); }}
                      />
                      <ToggleSetting
                        label="Auto-handle bounces"
                        description="Automatically mark bounced contacts and stop sequences (high confidence)"
                        checked={aiAutoBounce}
                        onChange={(v) => { setAiAutoBounce(v); markChanged(); }}
                      />
                      <ToggleSetting
                        label="Auto-create CRM deals"
                        description="When a reply is tagged Interested or Meeting, create a qualified deal and a follow-up task in your CRM automatically"
                        checked={crmAutoDeals}
                        onChange={(v) => { setCrmAutoDeals(v); markChanged(); }}
                      />
                      <ToggleSetting
                        label="One reply stops every campaign"
                        description="When someone answers one sequence, stop the others they are in. Still receiving a different pitch after replying reads as though nobody is paying attention."
                        checked={stopAllOnReply}
                        onChange={(v) => { setStopAllOnReply(v); markChanged(); }}
                      />
                      <ToggleSetting
                        label="A yes pauses the rest of the company"
                        description="When someone replies Interested or asks for a meeting, pause the sequences still running to their colleagues. Nothing is stopped for good - resume them from the campaign in one click."
                        checked={pauseCompany}
                        onChange={(v) => { setPauseCompany(v); markChanged(); }}
                      />
                      <ToggleSetting
                        label="Stop a campaign that is bouncing"
                        description="A bad list bounces heavily, mailbox providers read that as a spam signal, and the damage to your sending domain is not undone by stopping later. This pauses the campaign instead."
                        checked={bounceGuard}
                        onChange={(v) => { setBounceGuard(v); markChanged(); }}
                      />
                      <label className="flex flex-wrap items-center gap-3 pl-1">
                        <span className="text-body text-[var(--text-secondary)]">
                          At most
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          value={domainLimit}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setDomainLimit(Number.isFinite(next) && next >= 0 ? next : 5);
                            markChanged();
                          }}
                          className="w-16 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)] tabular focus:border-[var(--indigo)] focus:outline-none"
                        />
                        <span className="text-body text-[var(--text-secondary)]">
                          emails per hour to any one company
                        </span>
                        <span className="w-full text-caption text-[var(--text-tertiary)] leading-snug">
                          A list sorted by company sends every address at one business back to back,
                          which is the burst their mail gateway is built to notice. Gmail, Outlook and
                          the other consumer providers are exempt &mdash; they aren&rsquo;t one
                          organisation. Set to 0 to turn this off.
                        </span>
                      </label>

                      {bounceGuard && (
                        <label className="flex items-center gap-3 pl-1">
                          <span className="text-body text-[var(--text-secondary)]">Pause above</span>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={bounceThreshold}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              setBounceThreshold(Number.isFinite(next) ? next : 8);
                              markChanged();
                            }}
                            className="w-16 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)] tabular focus:border-[var(--indigo)] focus:outline-none"
                          />
                          <span className="text-body text-[var(--text-secondary)]">% bounced</span>
                          <span className="text-caption text-[var(--text-tertiary)]">
                            A healthy list bounces at 2&ndash;3%. Needs 20 sends before it can act.
                          </span>
                        </label>
                      )}

                      {/* The same brake for the two other signs that mail has
                          stopped being welcome. Recommended values are the
                          defaults; both judge on a confidence bound after a
                          minimum sample, like the bounce guard. */}
                      <ToggleSetting
                        label="Stop a campaign people report as spam"
                        description="Gmail and Yahoo start filtering a sender whose mail is reported more than about 3 times in 1,000. This pauses the campaign before it gets there, and emails you why."
                        checked={complaintGuard}
                        onChange={(v) => { setComplaintGuard(v); markChanged(); }}
                      />
                      {complaintGuard && (
                        <label className="flex flex-wrap items-center gap-3 pl-1">
                          <span className="text-body text-[var(--text-secondary)]">Pause above</span>
                          <input
                            type="number"
                            min={0.05}
                            max={5}
                            step={0.05}
                            value={complaintThreshold}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              setComplaintThreshold(Number.isFinite(next) && next > 0 ? next : 0.3);
                              markChanged();
                            }}
                            className="w-20 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)] tabular focus:border-[var(--indigo)] focus:outline-none"
                          />
                          <span className="text-body text-[var(--text-secondary)]">% reported as spam</span>
                          <span className="text-caption text-[var(--text-tertiary)]">
                            Recommended 0.3%. Needs 100 sends and 2 complaints before it can act.
                          </span>
                        </label>
                      )}
                      <ToggleSetting
                        label="Stop a campaign whose opens collapse"
                        description="Opens falling off a cliff is usually the first sign that mail has started landing in spam. Only real opens count - privacy proxies and scanners are left out - and it does nothing when open tracking is off."
                        checked={openGuard}
                        onChange={(v) => { setOpenGuard(v); markChanged(); }}
                      />
                      {openGuard && (
                        <label className="flex flex-wrap items-center gap-3 pl-1">
                          <span className="text-body text-[var(--text-secondary)]">Pause when opens fall</span>
                          <input
                            type="number"
                            min={20}
                            max={95}
                            step={5}
                            value={openDrop}
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              setOpenDrop(Number.isFinite(next) && next > 0 ? next : 60);
                              markChanged();
                            }}
                            className="w-16 h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-body text-[var(--text-primary)] tabular focus:border-[var(--indigo)] focus:outline-none"
                          />
                          <span className="text-body text-[var(--text-secondary)]">% below the campaign&rsquo;s usual rate</span>
                          <span className="w-full text-caption text-[var(--text-tertiary)] leading-snug">
                            Recommended 60%. Compared step for step against the campaign&rsquo;s own earlier sends, on emails
                            at least a day old, once there are 100 recent and 200 earlier ones.
                          </span>
                        </label>
                      )}
                    </div>

                    <div className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                      <div className="flex items-start gap-3">
                        <Info className="h-4 w-4 text-[var(--text-tertiary)] mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-body text-[var(--text-secondary)] leading-relaxed">
                            Use the tag filter in your Inbox to quickly find messages by category.
                            When replying, click the AI Assist button to generate context-aware reply
                            drafts based on your prompt.
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ═══ Save button ═══ */}
            <div className="mt-8 pt-6 border-t border-[var(--border-subtle)] flex items-center justify-between">
              {hasChanges && (
                <p className="text-body text-[var(--warning)] flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  You have unsaved changes
                </p>
              )}
              {!hasChanges && <div />}
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending || !hasChanges}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--indigo)] text-white text-strong font-medium hover:bg-[var(--indigo-hover)] transition-all ${
                  hasChanges ? 'shadow-[0_2px_8px_rgba(47,63,156,0.35)] hover:opacity-90' : 'opacity-50 cursor-not-allowed'
                }`}
              >
                {saveMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save changes
                  </>
                )}
              </button>
            </div>
          </div>
      </div>
    </div>
    </>
  );
}

function ToggleSetting({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    // A row in a list of switches, not a box per switch: hairlines between,
    // and the label and its explanation set as text.
    <div className="flex items-center justify-between gap-6 py-3.5 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="min-w-0">
        <p className="text-strong font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-body text-[var(--text-tertiary)] mt-0.5 leading-snug">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

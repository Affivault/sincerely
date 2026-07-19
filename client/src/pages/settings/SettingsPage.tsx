import { useState, useEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { settingsApi, type UserSettings } from '../../api/settings.api';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { PageHeader } from '../../components/shared/PageHeader';
import { SettingsShell } from '../../components/shared/SettingsShell';
import { Avatar } from '../../components/shared/Avatar';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import {
  User,
  Mail,
  Bell,
  Shield,
  Key,
  Globe,
  Palette,
  Save,
  LogOut,
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
    2: { label: 'Fair', barClass: 'bg-amber-500', textClass: 'text-amber-500' },
    3: { label: 'Good', barClass: 'bg-[var(--indigo)]', textClass: 'text-[var(--indigo)]' },
    4: { label: 'Strong', barClass: 'bg-[var(--success)]', textClass: 'text-[var(--success)]' },
  };
  return { score: score as 0 | 1 | 2 | 3 | 4, ...levels[score] };
}

const tabs: TabConfig[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'account', label: 'Account', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'preferences', label: 'Preferences', icon: Palette },
  { id: 'ai', label: 'AI Features', icon: Sparkles },
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

  const [defaultSignature, setDefaultSignature] = useState('');

  // AI Features settings (uses same DB columns as SARA for backwards compat)
  const [aiTaggingEnabled, setAiTaggingEnabled] = useState(true);
  const [aiAutoClassify, setAiAutoClassify] = useState(true);
  const [aiAutoUnsubscribe, setAiAutoUnsubscribe] = useState(true);
  const [aiAutoBounce, setAiAutoBounce] = useState(true);
  const [crmAutoDeals, setCrmAutoDeals] = useState(true);
  const [autoVerifyContacts, setAutoVerifyContacts] = useState(true);

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

  // ── Fetch settings from backend ──
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  // Populate form when settings load
  useEffect(() => {
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
      setDefaultSignature(settings.default_signature || '');
      setAiTaggingEnabled((settings as any).ai_tagging_enabled ?? settings.sara_enabled ?? true);
      setAiAutoClassify(settings.sara_auto_classify ?? true);
      setAiAutoUnsubscribe(settings.sara_auto_unsubscribe ?? true);
      setAiAutoBounce(settings.sara_auto_bounce ?? true);
      setCrmAutoDeals((settings as any).crm_auto_deals ?? true);
      setAutoVerifyContacts((settings as any).auto_verify_contacts ?? true);
      setHasChanges(false);
    }
  }, [settings]);

  // Track changes
  const markChanged = () => setHasChanges(true);

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
      default_signature: defaultSignature,
      theme: themeMode,
      sara_enabled: aiTaggingEnabled,
      sara_auto_classify: aiAutoClassify,
      sara_auto_execute: true,
      sara_confidence_threshold: 85,
      sara_auto_unsubscribe: aiAutoUnsubscribe,
      sara_auto_bounce: aiAutoBounce,
      crm_auto_deals: crmAutoDeals,
      sara_draft_replies: false,
      ai_tagging_enabled: aiTaggingEnabled,
      auto_verify_contacts: autoVerifyContacts,
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

  const handleSignOut = async () => {
    await signOut();
    toast.success('Signed out');
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
    <SettingsShell>
    <div>
      <PageHeader
        className="!mx-0 !mt-0 rounded-xl border border-[var(--border-subtle)]"
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <SettingsIcon className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="General"
        description="Your profile, account, notifications and AI preferences."
        meta={user?.email ? <><Mail className="h-3 w-3" /> <span>{user.email}</span></> : undefined}
        actions={
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium text-[var(--error)] border border-[var(--border-default)] hover:bg-[var(--error-bg)] transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} /> Sign out
          </button>
        }
      />

      {/* Section tabs — horizontal; the settings categories live in the shell rail */}
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg-elevated)] w-max max-w-full overflow-x-auto mb-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 h-7 px-3 rounded-md text-[12.5px] font-medium whitespace-nowrap transition-colors',
                isActive
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', isActive && 'text-[var(--indigo)]')} strokeWidth={1.75} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="min-w-0 max-w-3xl">
          <div className="card p-5">
            {/* ═══ Profile Tab ═══ */}
            {activeTab === 'profile' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Profile Information</h2>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-1">Update your personal details</p>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                  <Avatar
                    name={firstName && lastName ? `${firstName} ${lastName}` : undefined}
                    email={user?.email}
                    size="xl"
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text-primary)]">
                      {firstName && lastName ? `${firstName} ${lastName}` : 'Profile photo'}
                    </p>
                    <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5">{user?.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">First Name</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => { setFirstName(e.target.value); markChanged(); }}
                      placeholder="John"
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">Last Name</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => { setLastName(e.target.value); markChanged(); }}
                      placeholder="Doe"
                      className="input-field"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">Company</label>
                    <input
                      type="text"
                      value={company}
                      onChange={(e) => { setCompany(e.target.value); markChanged(); }}
                      placeholder="Acme Inc."
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">Job Title</label>
                    <input
                      type="text"
                      value={jobTitle}
                      onChange={(e) => { setJobTitle(e.target.value); markChanged(); }}
                      placeholder="Sales Manager"
                      className="input-field"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">Email</label>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5">
                      <Mail className="h-4 w-4 text-[var(--text-tertiary)]" />
                      <span className="text-sm text-[var(--text-secondary)]">{user?.email || 'Not set'}</span>
                    </div>
                    <span className="flex items-center gap-1.5 text-xs text-[var(--success)] bg-[var(--success-bg)] px-3 py-1.5 rounded-full font-medium">
                      <CheckCircle className="h-3.5 w-3.5" />
                      Verified
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">
                    <Globe className="inline h-3.5 w-3.5 mr-1.5 text-[var(--text-tertiary)]" />
                    Timezone
                  </label>
                  <select
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
                  <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Account Security</h2>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-1">Manage your password and security settings</p>
                </div>

                {/* Change Password */}
                <div className="p-5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-[var(--bg-surface)] flex items-center justify-center">
                      <Key className="h-5 w-5 text-[var(--text-primary)]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">Password</p>
                      <p className="text-xs text-[var(--text-tertiary)]">Update your account password</p>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setShowPasswordModal(true)}>
                    Change Password
                  </Button>
                </div>

                {/* Password Modal */}
                {showPasswordModal && (
                  <div className="p-5 rounded-xl bg-[var(--bg-surface)] space-y-4" style={{ border: '2px solid rgba(99,102,241,0.25)' }}>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">Change Password</h3>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Current Password</label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">New Password</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Min. 6 characters"
                          className="input-field pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
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
                          <p className={cn('text-[11px] mt-1 font-medium', getPasswordStrength(newPassword).textClass)}>
                            {getPasswordStrength(newPassword).label}
                          </p>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Confirm Password</label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className="input-field"
                      />
                      {confirmPassword && newPassword !== confirmPassword && (
                        <p className="text-xs text-[var(--error)] mt-1">Passwords do not match</p>
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
                        <p className="text-sm font-medium text-[var(--text-primary)]">Two-Factor Authentication</p>
                        <p className="text-xs text-[var(--text-tertiary)]">Add an extra layer of security</p>
                      </div>
                    </div>
                    <span className="flex items-center gap-1.5 text-xs text-[var(--warning)] bg-[var(--warning-bg)] px-3 py-1.5 rounded-full font-medium">
                      <AlertCircle className="h-3 w-3" />
                      Coming soon
                    </span>
                  </div>
                </div>

                {/* Connected accounts */}
                <div className="pt-6 border-t border-[var(--border-subtle)]">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Connected Accounts</h3>
                  <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors">
                    <div className="flex items-center gap-3">
                      <svg className="h-5 w-5" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                      </svg>
                      <span className="text-sm font-medium text-[var(--text-primary)]">Google</span>
                    </div>
                    <span className="text-xs text-[var(--text-tertiary)]">Managed via Supabase Auth</span>
                  </div>
                </div>

                {/* Danger Zone */}
                <div className="pt-6 border-t border-[var(--border-subtle)]">
                  <h3 className="text-sm font-semibold text-[var(--error)] mb-4">Danger Zone</h3>
                  <div className="p-5 border border-[var(--error)]/20 rounded-xl bg-[var(--error-bg)]">
                    <p className="text-sm text-[var(--text-secondary)] mb-4">
                      Once you delete your account, there is no going back. All your campaigns, contacts, SMTP accounts, and data will be permanently removed.
                    </p>
                    {!showDeleteModal ? (
                      <Button variant="danger" size="sm" onClick={() => setShowDeleteModal(true)}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete Account
                      </Button>
                    ) : (
                      <div className="space-y-3 p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--error)]/30">
                        <p className="text-xs font-medium text-[var(--error)]">
                          Type <span className="font-bold">DELETE</span> to confirm permanent account deletion:
                        </p>
                        <input
                          type="text"
                          value={deleteConfirmation}
                          onChange={(e) => setDeleteConfirmation(e.target.value)}
                          placeholder="Type DELETE"
                          className="input-field text-sm"
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
                  <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Notifications</h2>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-1">Choose what notifications you receive</p>
                </div>

                <div className="space-y-3">
                  <ToggleSetting
                    label="Email Notifications"
                    description="Receive email notifications for important updates"
                    checked={emailNotifications}
                    onChange={(v) => { setEmailNotifications(v); markChanged(); }}
                  />
                  <ToggleSetting
                    label="Campaign Alerts"
                    description="Get notified when campaigns start, pause, or complete"
                    checked={campaignAlerts}
                    onChange={(v) => { setCampaignAlerts(v); markChanged(); }}
                  />
                  <ToggleSetting
                    label="Reply Notifications"
                    description="Receive instant notifications when contacts reply"
                    checked={replyNotifications}
                    onChange={(v) => { setReplyNotifications(v); markChanged(); }}
                  />
                  <ToggleSetting
                    label="Weekly Digest"
                    description="Receive a weekly summary of your campaign performance"
                    checked={weeklyDigest}
                    onChange={(v) => { setWeeklyDigest(v); markChanged(); }}
                  />
                </div>
              </div>
            )}

            {/* ═══ Preferences Tab ═══ */}
            {activeTab === 'preferences' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Preferences</h2>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-1">Customize your experience</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-3">Theme</label>
                  <div className="flex gap-2">
                    {([
                      { value: 'light' as const, label: 'Light', icon: Sun },
                      { value: 'dark' as const, label: 'Dark', icon: Moon },
                      { value: 'system' as const, label: 'System', icon: Monitor },
                    ]).map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => handleThemeChange(value)}
                        className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 border ${
                          themeMode === value
                            ? 'bg-[var(--indigo-subtle)] text-[var(--indigo)] border-[var(--indigo)]'
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
                  <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">
                    Default Email Signature
                  </label>
                  <textarea
                    value={defaultSignature}
                    onChange={(e) => { setDefaultSignature(e.target.value); markChanged(); }}
                    placeholder="Best regards,&#10;John Doe"
                    rows={4}
                    className="input-field resize-none"
                  />
                  <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                    Use {'{{signature}}'} in emails to insert this
                  </p>
                </div>

                <div className="pt-2">
                  <label className="block text-[13px] font-medium text-[var(--text-secondary)] mb-1.5">Deliverability</label>
                  <ToggleSetting
                    label="Auto-verify contacts"
                    description="Automatically check new and imported contacts in the background (syntax, mail server & mailbox) so the verification status stays up to date."
                    checked={autoVerifyContacts}
                    onChange={(v) => { setAutoVerifyContacts(v); markChanged(); }}
                  />
                </div>
              </div>
            )}

            {/* ═══ AI Features Tab ═══ */}
            {activeTab === 'ai' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">AI Features</h2>
                  <p className="text-[13px] text-[var(--text-secondary)] mt-1">
                    Configure intelligent email tagging and AI-powered reply assistance
                  </p>
                </div>

                <div className="p-4 rounded-xl border" style={{ background: 'rgba(99,102,241,0.05)', borderColor: 'rgba(99,102,241,0.2)' }}>
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-5 w-5 text-[var(--indigo)] mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">Smart Email Tagging</p>
                      <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                        AI automatically tags incoming replies by intent &mdash; Interested, Meeting Booked,
                        Not Interested, Objection, Out of Office, Unsubscribe, and Bounce.
                        Filter your inbox by tag to quickly find the messages that matter most.
                      </p>
                    </div>
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
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                          <Zap className="h-4 w-4 text-[#818CF8]" />
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
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                          <Zap className="h-4 w-4 text-[#818CF8]" />
                          Auto Actions
                        </h3>
                        <p className="text-xs text-[var(--text-tertiary)] mt-1">
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
                    </div>

                    <div className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                      <div className="flex items-start gap-3">
                        <Info className="h-4 w-4 text-[var(--text-tertiary)] mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
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
                <p className="text-xs text-[var(--warning)] flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  You have unsaved changes
                </p>
              )}
              {!hasChanges && <div />}
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending || !hasChanges}
                className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--indigo)] text-white text-[13px] font-medium hover:bg-[var(--indigo-hover)] transition-all ${
                  hasChanges ? 'shadow-[0_2px_8px_rgba(99,102,241,0.35)] hover:opacity-90' : 'opacity-50 cursor-not-allowed'
                }`}
              >
                {saveMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Saving...</>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
      </div>
    </div>
    </SettingsShell>
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
    <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] transition-colors">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5 leading-snug">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

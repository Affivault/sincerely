import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './components/layout/AppLayout';

// Eagerly loaded — needed on every first paint
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';

// Lazy-loaded — each becomes its own JS chunk
const DashboardPage        = lazy(() => import('./pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ContactsListPage     = lazy(() => import('./pages/contacts/ContactsListPage').then(m => ({ default: m.ContactsListPage })));
const ContactDetailPage    = lazy(() => import('./pages/contacts/ContactDetailPage').then(m => ({ default: m.ContactDetailPage })));
const BulkImportPage       = lazy(() => import('./pages/contacts/BulkImportPage').then(m => ({ default: m.BulkImportPage })));
const CampaignsListPage    = lazy(() => import('./pages/campaigns/CampaignsListPage').then(m => ({ default: m.CampaignsListPage })));
const CampaignCreatePage   = lazy(() => import('./pages/campaigns/CampaignCreatePage').then(m => ({ default: m.CampaignCreatePage })));
const CampaignDetailPage   = lazy(() => import('./pages/campaigns/CampaignDetailPage').then(m => ({ default: m.CampaignDetailPage })));
const EmailAccountsPage    = lazy(() => import('./pages/smtp/EmailAccountsPage').then(m => ({ default: m.EmailAccountsPage })));
const SmtpGuidePage        = lazy(() => import('./pages/smtp/SmtpGuidePage').then(m => ({ default: m.SmtpGuidePage })));
const AnalyticsDashboardPage = lazy(() => import('./pages/analytics/AnalyticsDashboardPage').then(m => ({ default: m.AnalyticsDashboardPage })));
const InboxPage            = lazy(() => import('./pages/inbox/InboxPage').then(m => ({ default: m.InboxPage })));
const DealsPage            = lazy(() => import('./pages/crm/DealsPage').then(m => ({ default: m.DealsPage })));
const CompaniesPage        = lazy(() => import('./pages/companies/CompaniesPage').then(m => ({ default: m.CompaniesPage })));
const CompanyDetailPage    = lazy(() => import('./pages/companies/CompanyDetailPage').then(m => ({ default: m.CompanyDetailPage })));
const TasksPage            = lazy(() => import('./pages/crm/TasksPage').then(m => ({ default: m.TasksPage })));
const CalendarPage         = lazy(() => import('./pages/crm/CalendarPage').then(m => ({ default: m.CalendarPage })));
const ProspectorPage       = lazy(() => import('./pages/prospector/ProspectorPage').then(m => ({ default: m.ProspectorPage })));
const AdminPage            = lazy(() => import('./pages/admin/AdminPage').then(m => ({ default: m.AdminPage })));
const SettingsPage         = lazy(() => import('./pages/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const SseDashboardPage     = lazy(() => import('./pages/sse/SseDashboardPage').then(m => ({ default: m.SseDashboardPage })));
const AssetBuilderPage     = lazy(() => import('./pages/assets/AssetBuilderPage').then(m => ({ default: m.AssetBuilderPage })));
const TemplatesPage        = lazy(() => import('./pages/templates/TemplatesPage').then(m => ({ default: m.TemplatesPage })));
const DeveloperPage        = lazy(() => import('./pages/developer/DeveloperPage').then(m => ({ default: m.DeveloperPage })));
const IntegrationsPage     = lazy(() => import('./pages/integrations/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })));
const SuppressionPage      = lazy(() => import('./pages/suppression/SuppressionPage').then(m => ({ default: m.SuppressionPage })));
const VerificationPage     = lazy(() => import('./pages/verification/VerificationPage').then(m => ({ default: m.VerificationPage })));
const TeamPage             = lazy(() => import('./pages/team/TeamPage').then(m => ({ default: m.TeamPage })));
const SchedulesPage        = lazy(() => import('./pages/schedules/SchedulesPage').then(m => ({ default: m.SchedulesPage })));
const InviteAcceptPage     = lazy(() => import('./pages/team/InviteAcceptPage').then(m => ({ default: m.InviteAcceptPage })));
const LandingPageV2        = lazy(() => import('./pages/LandingPageV2').then(m => ({ default: m.LandingPageV2 })));
const ToolkitPage          = lazy(() => import('./pages/toolkit/ToolkitPage').then(m => ({ default: m.ToolkitPage })));
const BillingPage          = lazy(() => import('./pages/billing/BillingPage').then(m => ({ default: m.BillingPage })));
const TermsPage            = lazy(() => import('./pages/legal/TermsPage').then(m => ({ default: m.TermsPage })));
const PrivacyPage          = lazy(() => import('./pages/legal/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const StatusPage           = lazy(() => import('./pages/status/StatusPage').then(m => ({ default: m.StatusPage })));

function PageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (user) {
    // A pending team invite (stashed by InviteAcceptPage before sending an
    // unauthenticated visitor here to log in) needs to be resumed now —
    // otherwise it's silently dropped and the invite is never accepted.
    const inviteToken = sessionStorage.getItem('invite_token');
    if (inviteToken) {
      sessionStorage.removeItem('invite_token');
      return <Navigate to={`/invite?token=${encodeURIComponent(inviteToken)}`} replace />;
    }
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function LandingOrDashboard() {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

export default function App() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        {/* Public landing page */}
        <Route path="/" element={<LandingOrDashboard />} />

        {/* Auth routes */}
        <Route path="/login"           element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/signup"          element={<PublicRoute><SignupPage /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
        {/* Reset password must be public — user arrives via email link without a session */}
        <Route path="/reset-password"  element={<ResetPasswordPage />} />

        {/* Protected app routes */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard"          element={<DashboardPage />} />
          {/* Today briefly lived here and the dashboard was pushed to /overview.
              Kept as a redirect so bookmarks and old links still land. */}
          <Route path="/dashboard/overview" element={<Navigate to="/dashboard" replace />} />
          <Route path="/contacts"           element={<ContactsListPage />} />
          <Route path="/contacts/import"    element={<BulkImportPage />} />
          <Route path="/contacts/:id"       element={<ContactDetailPage />} />
          <Route path="/campaigns"          element={<CampaignsListPage />} />
          <Route path="/campaigns/new"      element={<CampaignCreatePage />} />
          <Route path="/campaigns/:id"      element={<CampaignDetailPage />} />
          <Route path="/campaigns/:id/edit" element={<CampaignCreatePage />} />
          <Route path="/email-accounts"     element={<EmailAccountsPage />} />
          <Route path="/smtp-accounts"      element={<Navigate to="/email-accounts" replace />} />
          <Route path="/smtp-accounts/guide" element={<SmtpGuidePage />} />
          <Route path="/domains"            element={<Navigate to="/email-accounts" replace />} />
          <Route path="/analytics"          element={<AnalyticsDashboardPage />} />
          <Route path="/inbox"              element={<InboxPage />} />
          <Route path="/deals"              element={<DealsPage />} />
          <Route path="/companies"          element={<CompaniesPage />} />
          <Route path="/companies/:id"      element={<CompanyDetailPage />} />
          <Route path="/tasks"              element={<TasksPage />} />
          <Route path="/calendar"           element={<CalendarPage />} />
          {/* CRM used to be one tabbed page; keep old links working. */}
          <Route path="/crm"                element={<Navigate to="/deals" replace />} />
          <Route path="/prospector"         element={<ProspectorPage />} />
          <Route path="/admin"              element={<AdminPage />} />
          <Route path="/sara"               element={<Navigate to="/inbox" replace />} />
          <Route path="/sse"                element={<SseDashboardPage />} />
          <Route path="/templates"          element={<TemplatesPage />} />
          <Route path="/assets"             element={<AssetBuilderPage />} />
          <Route path="/developer"          element={<DeveloperPage />} />
          <Route path="/integrations"       element={<IntegrationsPage />} />
          <Route path="/settings"           element={<SettingsPage />} />
          <Route path="/billing"            element={<BillingPage />} />
          <Route path="/suppression"        element={<SuppressionPage />} />
          <Route path="/verification"       element={<VerificationPage />} />
          <Route path="/toolkit"            element={<ToolkitPage />} />
          <Route path="/team"               element={<TeamPage />} />
          <Route path="/schedules"          element={<SchedulesPage />} />
        </Route>

        {/* Legal pages — public */}
        <Route path="/terms"   element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />

        {/* Self-diagnostics — public, used to debug connection problems */}
        <Route path="/status"  element={<StatusPage />} />

        {/* Landing page preview */}
        <Route path="/lp2"    element={<LandingPageV2 />} />

        {/* Invite accept — public, handles auth redirect internally */}
        <Route path="/invite" element={<InviteAcceptPage />} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

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
const SmtpAccountsPage     = lazy(() => import('./pages/smtp/SmtpAccountsPage').then(m => ({ default: m.SmtpAccountsPage })));
const SmtpGuidePage        = lazy(() => import('./pages/smtp/SmtpGuidePage').then(m => ({ default: m.SmtpGuidePage })));
const AnalyticsDashboardPage = lazy(() => import('./pages/analytics/AnalyticsDashboardPage').then(m => ({ default: m.AnalyticsDashboardPage })));
const InboxPage            = lazy(() => import('./pages/inbox/InboxPage').then(m => ({ default: m.InboxPage })));
const SettingsPage         = lazy(() => import('./pages/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const SseDashboardPage     = lazy(() => import('./pages/sse/SseDashboardPage').then(m => ({ default: m.SseDashboardPage })));
const AssetBuilderPage     = lazy(() => import('./pages/assets/AssetBuilderPage').then(m => ({ default: m.AssetBuilderPage })));
const TemplatesPage        = lazy(() => import('./pages/templates/TemplatesPage').then(m => ({ default: m.TemplatesPage })));
const DeveloperPage        = lazy(() => import('./pages/developer/DeveloperPage').then(m => ({ default: m.DeveloperPage })));
const DomainsPage          = lazy(() => import('./pages/domains/DomainsPage').then(m => ({ default: m.DomainsPage })));
const SuppressionPage      = lazy(() => import('./pages/suppression/SuppressionPage').then(m => ({ default: m.SuppressionPage })));
const VerificationPage     = lazy(() => import('./pages/verification/VerificationPage').then(m => ({ default: m.VerificationPage })));
const TeamPage             = lazy(() => import('./pages/team/TeamPage').then(m => ({ default: m.TeamPage })));
const SchedulesPage        = lazy(() => import('./pages/schedules/SchedulesPage').then(m => ({ default: m.SchedulesPage })));
const InviteAcceptPage     = lazy(() => import('./pages/team/InviteAcceptPage').then(m => ({ default: m.InviteAcceptPage })));
const LandingPageV2        = lazy(() => import('./pages/LandingPageV2').then(m => ({ default: m.LandingPageV2 })));
const ToolkitPage          = lazy(() => import('./pages/toolkit/ToolkitPage').then(m => ({ default: m.ToolkitPage })));

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
  if (user) return <Navigate to="/dashboard" replace />;
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
          <Route path="/contacts"           element={<ContactsListPage />} />
          <Route path="/contacts/import"    element={<BulkImportPage />} />
          <Route path="/contacts/:id"       element={<ContactDetailPage />} />
          <Route path="/campaigns"          element={<CampaignsListPage />} />
          <Route path="/campaigns/new"      element={<CampaignCreatePage />} />
          <Route path="/campaigns/:id"      element={<CampaignDetailPage />} />
          <Route path="/campaigns/:id/edit" element={<CampaignCreatePage />} />
          <Route path="/smtp-accounts"      element={<SmtpAccountsPage />} />
          <Route path="/smtp-accounts/guide" element={<SmtpGuidePage />} />
          <Route path="/domains"            element={<DomainsPage />} />
          <Route path="/analytics"          element={<AnalyticsDashboardPage />} />
          <Route path="/inbox"              element={<InboxPage />} />
          <Route path="/sara"               element={<Navigate to="/inbox" replace />} />
          <Route path="/sse"                element={<SseDashboardPage />} />
          <Route path="/templates"          element={<TemplatesPage />} />
          <Route path="/assets"             element={<AssetBuilderPage />} />
          <Route path="/developer"          element={<DeveloperPage />} />
          <Route path="/settings"           element={<SettingsPage />} />
          <Route path="/suppression"        element={<SuppressionPage />} />
          <Route path="/verification"       element={<VerificationPage />} />
          <Route path="/toolkit"            element={<ToolkitPage />} />
          <Route path="/team"               element={<TeamPage />} />
          <Route path="/schedules"          element={<SchedulesPage />} />
        </Route>

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

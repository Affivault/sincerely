import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './components/layout/AppLayout';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ContactsListPage } from './pages/contacts/ContactsListPage';
import { ContactDetailPage } from './pages/contacts/ContactDetailPage';
import { CampaignsListPage } from './pages/campaigns/CampaignsListPage';
import { CampaignCreatePage } from './pages/campaigns/CampaignCreatePage';
import { CampaignDetailPage } from './pages/campaigns/CampaignDetailPage';
import { SmtpAccountsPage } from './pages/smtp/SmtpAccountsPage';
import { SmtpGuidePage } from './pages/smtp/SmtpGuidePage';
import { AnalyticsDashboardPage } from './pages/analytics/AnalyticsDashboardPage';
import { InboxPage } from './pages/inbox/InboxPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { SseDashboardPage } from './pages/sse/SseDashboardPage';
import { AssetBuilderPage } from './pages/assets/AssetBuilderPage';
import { TemplatesPage } from './pages/templates/TemplatesPage';
import { DeveloperPage } from './pages/developer/DeveloperPage';
import { DomainsPage } from './pages/domains/DomainsPage';
import { SuppressionPage } from './pages/suppression/SuppressionPage';
import { VerificationPage } from './pages/verification/VerificationPage';
import { TeamPage } from './pages/team/TeamPage';
import { InviteAcceptPage } from './pages/team/InviteAcceptPage';
import { LandingPageV2 } from './pages/LandingPageV2';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function LandingOrDashboard() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <LandingPage />;
}

export default function App() {
  return (
    <Routes>
      {/* Public landing page - redirect to dashboard if logged in */}
      <Route path="/" element={<LandingOrDashboard />} />

      {/* Auth routes */}
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />

      {/* Protected app routes */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/contacts" element={<ContactsListPage />} />
        <Route path="/contacts/:id" element={<ContactDetailPage />} />
        <Route path="/campaigns" element={<CampaignsListPage />} />
        <Route path="/campaigns/new" element={<CampaignCreatePage />} />
        <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
        <Route path="/campaigns/:id/edit" element={<CampaignCreatePage />} />
        <Route path="/smtp-accounts" element={<SmtpAccountsPage />} />
        <Route path="/smtp-accounts/guide" element={<SmtpGuidePage />} />
        <Route path="/domains" element={<DomainsPage />} />
        <Route path="/analytics" element={<AnalyticsDashboardPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/sara" element={<Navigate to="/inbox" replace />} />
        <Route path="/sse" element={<SseDashboardPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/assets" element={<AssetBuilderPage />} />
        <Route path="/developer" element={<DeveloperPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/suppression" element={<SuppressionPage />} />
        <Route path="/verification" element={<VerificationPage />} />
        <Route path="/team" element={<TeamPage />} />
      </Route>

      {/* New landing page preview */}
      <Route path="/lp2" element={<LandingPageV2 />} />

      {/* Invite accept — public, handles auth redirect internally */}
      <Route path="/invite" element={<InviteAcceptPage />} />

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

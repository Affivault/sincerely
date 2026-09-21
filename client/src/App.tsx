import { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Skeleton, SkeletonList } from './components/ui/Skeleton';
import { lazyRoute } from './lib/prefetch';
import { useAuth } from './context/AuthContext';
import { AppLayout } from './components/layout/AppLayout';

// Eagerly loaded — needed on every first paint
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';

/*
 * Lazy-loaded — each becomes its own JS chunk.
 *
 * The path is declared here as well as on the <Route> below, and that is
 * deliberate: it registers the chunk against the path so that hovering a
 * link to it starts the download (see lib/prefetch). The two have to agree
 * or the wrong screen gets warmed, so first-paint-check.mts compares them
 * and fails if any pair has drifted.
 */
const DashboardPage       = lazyRoute('/dashboard', () => import('./pages/dashboard/DashboardPage'), m => m.DashboardPage);
const CampaignRevenuePage  = lazyRoute('/analytics/revenue/:id', () => import('./pages/analytics/CampaignRevenuePage'), m => m.CampaignRevenuePage);
const PlacementPage        = lazyRoute('/placement', () => import('./pages/placement/PlacementPage'), m => m.PlacementPage);
const RepliesPage          = lazyRoute('/replies', () => import('./pages/replies/RepliesPage'), m => m.RepliesPage);
const SegmentsPage         = lazyRoute('/analytics/segments', () => import('./pages/analytics/SegmentsPage'), m => m.SegmentsPage);
const RevenuePage          = lazyRoute('/analytics/revenue', () => import('./pages/analytics/RevenuePage'), m => m.RevenuePage);
const ContactsListPage     = lazyRoute(['/leads', '/contacts'], () => import('./pages/contacts/ContactsListPage'), m => m.ContactsListPage);
const ContactDetailPage    = lazyRoute('/contacts/:id', () => import('./pages/contacts/ContactDetailPage'), m => m.ContactDetailPage);
const BulkImportPage       = lazyRoute('/contacts/import', () => import('./pages/contacts/BulkImportPage'), m => m.BulkImportPage);
const CampaignsListPage    = lazyRoute('/campaigns', () => import('./pages/campaigns/CampaignsListPage'), m => m.CampaignsListPage);
const CampaignCreatePage   = lazyRoute(['/campaigns/new', '/campaigns/:id/edit'], () => import('./pages/campaigns/CampaignCreatePage'), m => m.CampaignCreatePage);
const CampaignDetailPage   = lazyRoute('/campaigns/:id', () => import('./pages/campaigns/CampaignDetailPage'), m => m.CampaignDetailPage);
const EmailAccountsPage    = lazyRoute('/email-accounts', () => import('./pages/smtp/EmailAccountsPage'), m => m.EmailAccountsPage);
const SmtpGuidePage        = lazyRoute('/smtp-accounts/guide', () => import('./pages/smtp/SmtpGuidePage'), m => m.SmtpGuidePage);
const AnalyticsDashboardPage = lazyRoute('/analytics', () => import('./pages/analytics/AnalyticsDashboardPage'), m => m.AnalyticsDashboardPage);
const InboxPage            = lazyRoute('/inbox', () => import('./pages/inbox/InboxPage'), m => m.InboxPage);
const DealsPage            = lazyRoute('/deals', () => import('./pages/crm/DealsPage'), m => m.DealsPage);
const LeadsPage            = lazyRoute('/leads/inbox', () => import('./pages/leads/LeadsPage'), m => m.LeadsPage);
const DealDetailPage       = lazyRoute('/deals/:id', () => import('./pages/crm/DealDetailPage'), m => m.DealDetailPage);
const DealInsightsPage     = lazyRoute('/deals/insights', () => import('./pages/crm/DealInsightsPage'), m => m.DealInsightsPage);
const CompaniesPage        = lazyRoute('/companies', () => import('./pages/companies/CompaniesPage'), m => m.CompaniesPage);
const LinkedinPage         = lazyRoute('/linkedin', () => import('./pages/linkedin/LinkedinPage'), m => m.LinkedinPage);
const CompanyDetailPage    = lazyRoute('/companies/:id', () => import('./pages/companies/CompanyDetailPage'), m => m.CompanyDetailPage);
const TasksPage            = lazyRoute('/tasks', () => import('./pages/crm/TasksPage'), m => m.TasksPage);
const AvailabilityPage     = lazyRoute('/calendar/availability', () => import('./pages/crm/AvailabilityPage'), m => m.AvailabilityPage);
const BookingLinksPage     = lazyRoute('/calendar/links', () => import('./pages/crm/BookingLinksPage'), m => m.BookingLinksPage);
const BookPage             = lazyRoute('/b/:slug', () => import('./pages/public/BookPage'), m => m.BookPage);
const ManageBookingPage    = lazyRoute('/booking/:token', () => import('./pages/public/ManageBookingPage'), m => m.ManageBookingPage);
const CalendarPage         = lazyRoute('/calendar', () => import('./pages/crm/CalendarPage'), m => m.CalendarPage);
const ProspectorPage       = lazyRoute('/prospector', () => import('./pages/prospector/ProspectorPage'), m => m.ProspectorPage);
const AdminPage            = lazyRoute('/admin', () => import('./pages/admin/AdminPage'), m => m.AdminPage);
const SettingsPage         = lazyRoute('/settings', () => import('./pages/settings/SettingsPage'), m => m.SettingsPage);
const SseDashboardPage     = lazyRoute('/sse', () => import('./pages/sse/SseDashboardPage'), m => m.SseDashboardPage);
const AssetBuilderPage     = lazyRoute('/assets', () => import('./pages/assets/AssetBuilderPage'), m => m.AssetBuilderPage);
const TemplatesPage        = lazyRoute('/templates', () => import('./pages/templates/TemplatesPage'), m => m.TemplatesPage);
const DeveloperPage        = lazyRoute('/developer', () => import('./pages/developer/DeveloperPage'), m => m.DeveloperPage);
const IntegrationsPage     = lazyRoute('/integrations', () => import('./pages/integrations/IntegrationsPage'), m => m.IntegrationsPage);
const SuppressionPage      = lazyRoute('/suppression', () => import('./pages/suppression/SuppressionPage'), m => m.SuppressionPage);
const VerificationPage     = lazyRoute('/verification', () => import('./pages/verification/VerificationPage'), m => m.VerificationPage);
const TeamPage             = lazyRoute('/team', () => import('./pages/team/TeamPage'), m => m.TeamPage);
const SchedulesPage        = lazyRoute('/schedules', () => import('./pages/schedules/SchedulesPage'), m => m.SchedulesPage);
const InviteAcceptPage     = lazyRoute('/invite', () => import('./pages/team/InviteAcceptPage'), m => m.InviteAcceptPage);
const LandingPageV2        = lazyRoute('/lp2', () => import('./pages/LandingPageV2'), m => m.LandingPageV2);
const ToolkitPage          = lazyRoute('/toolkit', () => import('./pages/toolkit/ToolkitPage'), m => m.ToolkitPage);
const BillingPage          = lazyRoute('/billing', () => import('./pages/billing/BillingPage'), m => m.BillingPage);
const TermsPage            = lazyRoute('/terms', () => import('./pages/legal/TermsPage'), m => m.TermsPage);
const PrivacyPage          = lazyRoute('/privacy', () => import('./pages/legal/PrivacyPage'), m => m.PrivacyPage);
const StatusPage           = lazyRoute('/status', () => import('./pages/status/StatusPage'), m => m.StatusPage);

/**
 * What a route looks like while its chunk downloads.
 *
 * This was a bare div spinning in `border-primary-600` - a colour with no
 * definition anywhere in the theme, so it rendered as the browser default
 * and was the sixth loading idiom in an app that only needed one. It
 * holds the shape of a page now rather than spinning in the middle of an
 * empty screen, which stops the layout jumping when the chunk lands.
 */
function PageSpinner() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6" aria-busy data-route-loading>
      <Skeleton className="h-16 rounded-xl" />
      <SkeletonList rows={6} />
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

        {/*
          Booking pages. Public on purpose, and deliberately NOT wrapped in
          PublicRoute — that redirects anybody with a session to the app,
          which would stop an account ever opening its own link to check it.
          They sit outside AppLayout too: a stranger gets no sidebar.
        */}
        <Route path="/b/:slug"          element={<BookPage />} />
        <Route path="/booking/:token"   element={<ManageBookingPage />} />

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
          {/*
            One component, two pages. /leads is the outreach side - lead
            lists, the people campaigns send to. /contacts is the CRM, and
            nothing cold reaches it. Separate routes rather than a toggle so
            each is linkable and neither can be mistaken for the other.
          */}
          <Route path="/leads"              element={<ContactsListPage kind="lead" />} />
          <Route path="/contacts"           element={<ContactsListPage kind="contact" />} />
          <Route path="/contacts/import"    element={<BulkImportPage />} />
          <Route path="/contacts/:id"       element={<ContactDetailPage />} />
          <Route path="/campaigns"          element={<CampaignsListPage />} />
          <Route path="/campaigns/new"      element={<CampaignCreatePage />} />
          <Route path="/campaigns/:id"      element={<CampaignDetailPage />} />
          <Route path="/campaigns/:id/edit" element={<CampaignCreatePage />} />
          <Route path="/email-accounts"     element={<EmailAccountsPage />} />
          <Route path="/smtp-accounts"      element={<Navigate to="/email-accounts" replace />} />
          <Route path="/smtp-accounts/guide" element={<SmtpGuidePage />} />
          <Route path="/placement"          element={<PlacementPage />} />
          <Route path="/replies"            element={<RepliesPage />} />
          <Route path="/domains"            element={<Navigate to="/email-accounts" replace />} />
          <Route path="/analytics"          element={<AnalyticsDashboardPage />} />
          <Route path="/analytics/revenue"   element={<RevenuePage />} />
          <Route path="/analytics/revenue/:id" element={<CampaignRevenuePage />} />
          <Route path="/analytics/segments"   element={<SegmentsPage />} />
          <Route path="/inbox"              element={<InboxPage />} />
          <Route path="/leads/inbox"        element={<LeadsPage />} />
          <Route path="/deals"              element={<DealsPage />} />
          <Route path="/deals/insights"     element={<DealInsightsPage />} />
          <Route path="/deals/:id"          element={<DealDetailPage />} />
          <Route path="/companies"          element={<CompaniesPage />} />
          <Route path="/linkedin"           element={<LinkedinPage />} />
          <Route path="/companies/:id"      element={<CompanyDetailPage />} />
          <Route path="/tasks"              element={<TasksPage />} />
          <Route path="/calendar"           element={<CalendarPage />} />
          <Route path="/calendar/availability" element={<AvailabilityPage />} />
          <Route path="/calendar/links"        element={<BookingLinksPage />} />
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

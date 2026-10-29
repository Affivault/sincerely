import { Navigate, useLocation, useParams } from 'react-router-dom';
import { useIsOwner } from '../../hooks/useIsOwner';
import { Spinner } from '../../components/ui/Spinner';
import { AdminShell } from '../../components/admin/AdminShell';
import { AdminOverview } from '../../components/admin/AdminOverview';
import { AdminAccounts } from '../../components/admin/AdminAccounts';
import { AdminBilling } from '../../components/admin/AdminBilling';
import { AdminActivity } from '../../components/admin/AdminActivity';
import { AdminSending } from '../../components/admin/AdminSending';
import { AdminInsights } from '../../components/admin/AdminInsights';
import { AdminSettings } from '../../components/admin/AdminSettings';

/*
 * The admin backend. It exists for the platform owners alone: the server
 * 404s every admin endpoint for anyone else, and this page answers anyone
 * else exactly as an unknown address does, by sending them home.
 */
export function AdminPage() {
  const { isOwner, loading } = useIsOwner();
  const { pathname } = useLocation();
  const { id } = useParams();

  if (loading) return <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>;
  if (!isOwner) return <Navigate to="/" replace />;
  // Old links to a full-page account open it in the side panel instead.
  if (id) return <Navigate to={`/admin/accounts?a=${encodeURIComponent(id)}`} replace />;

  const body = pathname.startsWith('/admin/accounts') ? <AdminAccounts />
    : pathname.startsWith('/admin/insights') ? <AdminInsights />
    : pathname.startsWith('/admin/billing') ? <AdminBilling />
    : pathname.startsWith('/admin/sending') ? <AdminSending />
    : pathname.startsWith('/admin/settings') ? <AdminSettings />
    : pathname.startsWith('/admin/activity') ? <AdminActivity />
    : <AdminOverview />;

  return <AdminShell>{body}</AdminShell>;
}

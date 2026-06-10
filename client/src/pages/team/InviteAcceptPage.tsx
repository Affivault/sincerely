import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { teamApi } from '../../api/team.api';
import { useAuth } from '../../context/AuthContext';
import { Spinner } from '../../components/ui/Spinner';
import { CheckCircle2, XCircle } from 'lucide-react';

export function InviteAcceptPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'idle' | 'accepting' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) {
      // Store token in sessionStorage and redirect to login
      if (token) sessionStorage.setItem('invite_token', token);
      navigate('/login');
      return;
    }
    if (!token) {
      setStatus('error');
      setError('No invite token found in the URL.');
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus('accepting');
    teamApi.acceptInvite(token)
      .then(() => {
        setStatus('success');
        timer = setTimeout(() => navigate('/team'), 2000);
      })
      .catch((err) => {
        setStatus('error');
        setError(err.response?.data?.error || 'Failed to accept invite');
      });
    return () => clearTimeout(timer);
  }, [user, loading, token, navigate]);

  if (loading || status === 'idle' || status === 'accepting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
        <div className="text-center space-y-3">
          <Spinner size="lg" />
          <p className="text-sm text-[var(--text-secondary)]">Accepting invite…</p>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
        <div className="text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Invite accepted!</h1>
          <p className="text-sm text-[var(--text-secondary)]">Redirecting to your team page…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
      <div className="text-center space-y-3">
        <XCircle className="h-12 w-12 text-red-500 mx-auto" />
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Unable to accept invite</h1>
        <p className="text-sm text-[var(--text-secondary)]">{error}</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="mt-4 px-4 py-2 rounded-xl bg-[var(--indigo)] text-white text-sm font-semibold hover:opacity-90"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}

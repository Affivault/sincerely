import { useQuery } from '@tanstack/react-query';
import { analyticsApi, type TrendDataPoint } from '../../api/analytics.api';
import { campaignsApi } from '../../api/campaigns.api';
import { inboxApi } from '../../api/inbox.api';
import { templateApi } from '../../api/template.api';
import { useUnreadCount } from '../../hooks/useUnreadCount';
import { useAuth } from '../../context/AuthContext';
import { Spinner } from '../../components/ui/Spinner';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { Avatar } from '../../components/shared/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  Plus, Megaphone, Users, Mail, MousePointer,
  Send, Inbox, FileText, BarChart3, Sparkles, Tag,
  CircleDot, MessageSquare, ChevronRight, ShieldCheck, ShieldOff, UserPlus,
  TrendingUp,
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

/* ─── Helpers ─────────────────────────────────────── */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function fmtNum(n: number | undefined | null): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

function fmtPct(n: number | undefined | null): string {
  return `${(Number(n) || 0).toFixed(1)}%`;
}

function timeAgo(date: string): string {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ─── Trend chart ────────────────────────────── */
function TrendChart({ data }: { data: TrendDataPoint[] }) {
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="h-[180px] flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">
        No sending data yet
      </div>
    );
  }
  const recent = data.slice(-14);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={recent} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="sentGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5B5BF5" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#5B5BF5" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="openGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10B981" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        />
        <YAxis hide />
        <Tooltip
          contentStyle={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            fontSize: 11,
            padding: '6px 10px',
            boxShadow: 'var(--shadow-md)',
          }}
          labelStyle={{ color: 'var(--text-tertiary)', fontSize: 10, marginBottom: 4 }}
          formatter={(value: number, name: string) => [fmtNum(value), name.charAt(0).toUpperCase() + name.slice(1)]}
        />
        <Area type="monotone" dataKey="sent" stroke="#5B5BF5" strokeWidth={2} fill="url(#sentGrad)" />
        <Area type="monotone" dataKey="opened" stroke="#10B981" strokeWidth={1.5} fill="url(#openGrad)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ─── Status chip ─────────────────────────────── */
const STATUS_PILL: Record<string, { cls: string; dot: string }> = {
  running:   { cls: 'bg-emerald-500/10 text-emerald-700', dot: 'bg-emerald-500' },
  active:    { cls: 'bg-emerald-500/10 text-emerald-700', dot: 'bg-emerald-500' },
  paused:    { cls: 'bg-amber-500/10 text-amber-700',     dot: 'bg-amber-500' },
  draft:     { cls: 'bg-slate-500/10 text-slate-600',     dot: 'bg-slate-400' },
  scheduled: { cls: 'bg-blue-500/10 text-blue-700',       dot: 'bg-blue-500' },
  completed: { cls: 'bg-indigo-500/10 text-indigo-700',   dot: 'bg-indigo-500' },
  cancelled: { cls: 'bg-rose-500/10 text-rose-700',       dot: 'bg-rose-500' },
};
function StatusPill({ status }: { status: string }) {
  const s = STATUS_PILL[status] || STATUS_PILL.draft;
  return (
    <span className={cn('inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[4px] text-[10.5px] font-medium leading-none', s.cls)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', s.dot)} />
      <span className="capitalize">{status}</span>
    </span>
  );
}

/* ─── Dashboard Page ──────────────────────────────── */
export function DashboardPage() {
  const navigate = useNavigate();
  const unreadCount = useUnreadCount();
  const { user } = useAuth();

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => analyticsApi.overview(),
  });
  const { data: trendData } = useQuery({
    queryKey: ['analytics', 'trend', 14],
    queryFn: () => analyticsApi.trend(14),
  });
  const { data: campaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.list({ limit: 10 }),
  });
  const { data: inboxData } = useQuery({
    queryKey: ['inbox', 'dashboard'],
    queryFn: () => inboxApi.list({ limit: 6, folder: 'inbox' }),
  });
  const { data: emailTemplates } = useQuery({
    queryKey: ['templates', 'emails', 'dashboard'],
    queryFn: () => templateApi.listEmails(),
  });

  if (analyticsLoading || campaignsLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const stats = analytics || {
    total_campaigns: 0, active_campaigns: 0, total_contacts: 0,
    total_sent: 0, total_opened: 0, total_clicked: 0, total_replied: 0,
    avg_open_rate: 0, avg_click_rate: 0, avg_reply_rate: 0,
    suppressed_count: 0, avg_dcs_score: 0, verified_contacts: 0, bounced_contacts: 0,
  };

  const allCampaigns = campaigns?.data || [];
  const activeCampaigns = allCampaigns.filter((c: any) => c.status === 'running');
  const recentCampaigns = allCampaigns.slice(0, 5);
  const recentMessages = Array.isArray(inboxData?.data) ? inboxData.data : [];
  const templates = Array.isArray(emailTemplates) ? emailTemplates : [];
  const trend = Array.isArray(trendData) ? trendData : [];
  const sparkSent = trend.slice(-12).map((d: any) => Number(d.sent || 0));
  const sparkOpened = trend.slice(-12).map((d: any) => Number(d.opened || 0));
  const sparkClicked = trend.slice(-12).map((d: any) => Number(d.clicked || 0));
  const sparkReplied = trend.slice(-12).map((d: any) => Number(d.replied || 0));

  const workspaceName = user?.email?.split('@')[0] || 'there';

  return (
    <div className="animate-fade-in pb-4">
      {/* ── PageHeader with hero decoration ── */}
      <PageHeader
        decorate
        title={
          <span>
            {getGreeting()},{' '}
            <span className="bg-gradient-to-r from-[#5B5BF5] to-[#8B5CF6] bg-clip-text text-transparent">
              {workspaceName}
            </span>
          </span>
        }
        description="Here's how your outreach is performing right now."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => navigate('/analytics')}>
              <BarChart3 className="h-3.5 w-3.5" />
              Analytics
            </Button>
            <Button size="sm" onClick={() => navigate('/campaigns/new')}>
              <Plus className="h-3.5 w-3.5" />
              New campaign
            </Button>
          </>
        }
      />

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Emails sent"
          value={fmtNum(stats.total_sent)}
          icon={Send}
          accent="indigo"
          sparkline={sparkSent}
          hint={`${fmtNum(stats.total_campaigns)} total campaigns`}
          onClick={() => navigate('/campaigns')}
        />
        <StatCard
          label="Open rate"
          value={fmtPct(stats.avg_open_rate)}
          icon={Mail}
          accent="violet"
          sparkline={sparkOpened}
          hint={`${fmtNum(stats.total_opened)} opens`}
          onClick={() => navigate('/analytics')}
        />
        <StatCard
          label="Click rate"
          value={fmtPct(stats.avg_click_rate)}
          icon={MousePointer}
          accent="emerald"
          sparkline={sparkClicked}
          hint={`${fmtNum(stats.total_clicked)} clicks`}
          onClick={() => navigate('/analytics')}
        />
        <StatCard
          label="Reply rate"
          value={fmtPct(stats.avg_reply_rate)}
          icon={MessageSquare}
          accent="amber"
          sparkline={sparkReplied}
          hint={`${fmtNum(stats.total_replied)} replies`}
          onClick={() => navigate('/inbox')}
        />
      </div>

      {/* ── Activity + active campaigns ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 mb-4">
        <Card className="lg:col-span-3" padding="md">
          <CardHeader
            action={
              <Link to="/analytics" className="text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 transition-colors">
                Details <ChevronRight className="h-3 w-3" />
              </Link>
            }
          >
            <div className="flex items-center gap-2">
              <CardTitle>Sending activity</CardTitle>
              <Badge variant="default" size="sm">14d</Badge>
            </div>
            <CardDescription>Sent vs. opened across the last two weeks.</CardDescription>
          </CardHeader>

          <ErrorBoundary fallback={<div className="h-[180px] flex items-center justify-center text-[12px] text-[var(--text-tertiary)]">Chart unavailable</div>}>
            <TrendChart data={trend} />
          </ErrorBoundary>

          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[var(--border-subtle)]">
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
              <span className="w-2 h-2 rounded-full bg-[#5B5BF5]" /> Sent
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
              <span className="w-2 h-2 rounded-full bg-[#10B981]" /> Opened
            </span>
          </div>
        </Card>

        <Card className="lg:col-span-2" padding="none">
          <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
            <div>
              <CardTitle>Running now</CardTitle>
              <CardDescription>{activeCampaigns.length} campaign{activeCampaigns.length === 1 ? '' : 's'} live</CardDescription>
            </div>
            <Link to="/campaigns" className="text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 transition-colors">
              All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="divide-y divide-[var(--border-subtle)]">
            {activeCampaigns.length > 0 ? activeCampaigns.slice(0, 4).map((c: any) => (
              <button
                key={c.id}
                onClick={() => navigate(`/campaigns/${c.id}`)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors text-left group"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                  <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 tabular">
                    {fmtNum(c.sent_count || 0)} sent · {fmtPct(c.open_rate || 0)} opens · {fmtPct(c.reply_rate || 0)} replies
                  </p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )) : (
              <div className="px-4 py-8 text-center">
                <div className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] mb-2">
                  <Megaphone className="h-4 w-4 text-[var(--text-tertiary)]" strokeWidth={1.75} />
                </div>
                <p className="text-[12px] text-[var(--text-secondary)] mb-2">No campaigns running</p>
                <Button size="sm" variant="secondary" onClick={() => navigate('/campaigns/new')}>
                  Launch one
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── Recent campaigns + inbox + AI ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <Card className="lg:col-span-2" padding="none">
          <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
            <CardTitle>Recent campaigns</CardTitle>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => navigate('/campaigns/new')}>
                <Plus className="h-3 w-3" />New
              </Button>
              <Link to="/campaigns" className="text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 px-2 transition-colors">
                All <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </div>

          {recentCampaigns.length > 0 ? (
            <div className="divide-y divide-[var(--border-subtle)]">
              {recentCampaigns.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/campaigns/${c.id}`)}
                  className="w-full grid grid-cols-[1fr,auto,auto] items-center gap-4 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors text-left group"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text-primary)] truncate leading-tight">{c.name}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[11px] text-[var(--text-tertiary)] tabular">{fmtNum(c.sent_count || 0)} sent</span>
                      <span className="text-[11px] text-[var(--text-tertiary)] tabular">{fmtPct(c.open_rate || 0)} opens</span>
                      <span className="text-[11px] text-[var(--text-tertiary)] tabular">{fmtPct(c.reply_rate || 0)} replies</span>
                    </div>
                  </div>
                  <StatusPill status={c.status} />
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center">
              <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] mb-3">
                <Megaphone className="h-4 w-4 text-[var(--text-tertiary)]" strokeWidth={1.75} />
              </div>
              <p className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">No campaigns yet</p>
              <p className="text-[12px] text-[var(--text-tertiary)] mb-3">Create your first email campaign</p>
              <Button size="sm" onClick={() => navigate('/campaigns/new')}>
                <Plus className="h-3.5 w-3.5" />Create campaign
              </Button>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-3">
          {/* Inbox preview */}
          <Card padding="none">
            <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <CardTitle>Unibox</CardTitle>
                {unreadCount > 0 && (
                  <Badge variant="brand" size="sm">{unreadCount > 99 ? '99+' : unreadCount} new</Badge>
                )}
              </div>
              <Link to="/inbox" className="text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-0.5 transition-colors">
                Open <ChevronRight className="h-3 w-3" />
              </Link>
            </div>

            {recentMessages.length > 0 ? (
              <div className="divide-y divide-[var(--border-subtle)]">
                {recentMessages.slice(0, 4).map((msg: any) => (
                  <Link key={msg.id} to="/inbox" className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors">
                    <div className="relative flex-shrink-0 mt-0.5">
                      <Avatar name={msg.contact_name} email={msg.from_email} size="sm" />
                      {!msg.is_read && (
                        <span className="absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full bg-[var(--indigo)] ring-2 ring-[var(--bg-surface)]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn('text-[12px] truncate', msg.is_read ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]')}>
                          {msg.contact_name || msg.from_email?.split('@')[0] || 'Unknown'}
                        </span>
                        <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular">{timeAgo(msg.received_at)}</span>
                      </div>
                      <p className="text-[11px] text-[var(--text-tertiary)] truncate leading-tight mt-0.5">
                        {msg.subject || '(no subject)'}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center">
                <Inbox className="h-4 w-4 text-[var(--text-tertiary)] mx-auto mb-1.5" strokeWidth={1.75} />
                <p className="text-[11.5px] text-[var(--text-tertiary)]">No messages yet</p>
              </div>
            )}
          </Card>

          {/* AI assist */}
          <Link to="/inbox" className="card-premium block p-4 group">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-gradient-to-br from-[#5B5BF5] to-[#8B5CF6] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
                <Sparkles className="h-4 w-4 text-white" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">AI Assist</p>
                <p className="text-[11px] text-[var(--text-tertiary)]">Auto-tagging + reply drafting</p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[var(--bg-elevated)]/70">
                <Tag className="h-3 w-3 text-[var(--indigo)]" />
                <p className="text-[11.5px] text-[var(--text-secondary)]">Tags emails by intent automatically</p>
              </div>
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[var(--bg-elevated)]/70">
                <Sparkles className="h-3 w-3 text-[var(--indigo)]" />
                <p className="text-[11.5px] text-[var(--text-secondary)]">Drafts personalised replies for you</p>
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* ── Quick nav grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {[
          { to: '/campaigns/new', icon: Megaphone,   label: 'New campaign', desc: 'Build a sequence' },
          { to: '/contacts',      icon: Users,       label: 'Lead lists',   desc: `${fmtNum(stats.total_contacts)} contacts` },
          { to: '/templates',     icon: FileText,    label: 'Templates',    desc: `${templates.length} saved` },
          { to: '/verification',  icon: ShieldCheck, label: 'Verification', desc: 'DCS scoring' },
          { to: '/suppression',   icon: ShieldOff,   label: 'Suppression',  desc: `${fmtNum(stats.suppressed_count)} blocked` },
          { to: '/team',          icon: UserPlus,    label: 'Team',         desc: 'Invite teammates' },
        ].map(item => (
          <Link
            key={item.to}
            to={item.to}
            className="group card hover:card-hover transition-all px-3 py-3 hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]"
          >
            <item.icon className="h-3.5 w-3.5 text-[var(--text-tertiary)] mb-1.5 group-hover:text-[var(--indigo)] transition-colors" strokeWidth={1.75} />
            <p className="text-[12.5px] font-semibold text-[var(--text-primary)] leading-tight">{item.label}</p>
            <p className="text-[10.5px] text-[var(--text-tertiary)] mt-0.5 truncate">{item.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { verificationApi } from '../../api/verification.api';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { StatCard } from '../../components/shared/StatCard';
import { ShieldCheck, ShieldX, AlertTriangle, CheckCircle2, XCircle, Loader2, Search, Users, Activity, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import type { DcsVerificationResult } from '@lemlist/shared';

function DcsBadge({ score }: { score: number }) {
  const level = score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low';
  const cfg = {
    high:   { label: 'High',   color: 'text-emerald-700 bg-emerald-500/10' },
    medium: { label: 'Medium', color: 'text-amber-700 bg-amber-500/10'    },
    low:    { label: 'Low',    color: 'text-rose-700 bg-rose-500/10'      },
  }[level];
  return (
    <span className={cn('inline-flex items-center gap-1 px-1.5 h-[18px] rounded-[4px] text-[10.5px] font-semibold tabular', cfg.color)}>
      {score}/100 · {cfg.label}
    </span>
  );
}

function VerificationResultCard({ result }: { result: DcsVerificationResult }) {
  const passed = result.score >= 60;
  return (
    <div className={cn(
      'rounded-xl border p-3.5 space-y-3',
      passed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={cn(
            'flex h-9 w-9 items-center justify-center rounded-xl border',
            passed ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'
          )}>
            {passed
              ? <ShieldCheck className="h-4 w-4 text-emerald-600" />
              : <ShieldX className="h-4 w-4 text-rose-500" />
            }
          </span>
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-primary)] tracking-[-0.005em]">{result.email}</p>
            <p className="text-[12px] text-[var(--text-secondary)]">{passed ? 'Email looks deliverable' : 'Deliverability issue detected'}</p>
          </div>
        </div>
        <DcsBadge score={result.score} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Syntax', ok: result.syntax_ok },
          { label: 'Domain / DNS', ok: result.domain_ok },
          { label: 'SMTP handshake', ok: result.smtp_ok },
        ].map((check) => (
          <div key={check.label} className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            {check.ok
              ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
              : <XCircle className="h-3.5 w-3.5 text-rose-500 flex-shrink-0" />
            }
            <span className="text-[11.5px] font-medium text-[var(--text-secondary)]">{check.label}</span>
          </div>
        ))}
      </div>

      {result.fail_reason && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11.5px] text-rose-700">{result.fail_reason}</p>
        </div>
      )}
    </div>
  );
}

export function VerificationPage() {
  const [emailInput, setEmailInput] = useState('');
  const [lastResult, setLastResult] = useState<DcsVerificationResult | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['verification-stats'],
    queryFn: verificationApi.getStats,
  });

  const verifyMut = useMutation({
    mutationFn: (email: string) => verificationApi.verifyEmail(email),
    onSuccess: (result) => {
      setLastResult(result);
      setEmailInput('');
    },
    onError: () => toast.error('Verification failed'),
  });

  const batchMut = useMutation({
    mutationFn: () => verificationApi.batchVerify(),
    onSuccess: (res) => toast.success(`Verified ${res.verified} contact(s)`),
    onError: () => toast.error('Batch verification failed'),
  });

  const verifiedPct = stats && stats.total > 0 ? Math.round((stats.verified / stats.total) * 100) : 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        icon={<ShieldCheck className="h-4 w-4 text-white" />}
        iconBg="bg-gradient-to-br from-emerald-500 to-teal-600"
        title="Email Verification"
        description="3-layer pipeline: syntax → DNS → SMTP handshake"
        meta={stats ? [
          { label: `${stats.verified} verified`, dot: 'bg-emerald-500' },
          { label: `${stats.unverified} pending`, dot: 'bg-amber-400' },
        ] : undefined}
      />

      {/* KPI strip */}
      {statsLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Total contacts"
            value={stats.total}
            icon={<Users className="h-3.5 w-3.5" />}
            accent="text-[var(--text-primary)]"
          />
          <StatCard
            label="Verified"
            value={stats.verified}
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            accent="text-emerald-600"
            sub={`${verifiedPct}% of total`}
          />
          <StatCard
            label="Unverified"
            value={stats.unverified}
            icon={<Activity className="h-3.5 w-3.5" />}
            accent="text-amber-600"
          />
          <StatCard
            label="Avg DCS score"
            value={`${Math.round(stats.avg_score || 0)}/100`}
            icon={<Zap className="h-3.5 w-3.5" />}
            accent="text-[var(--indigo,#6366F1)]"
          />
        </div>
      ) : null}

      {/* Score distribution */}
      {stats?.score_distribution && stats.score_distribution.length > 0 && (
        <Card padding="md">
          <CardHeader>
            <CardTitle>DCS Score Distribution</CardTitle>
            <CardDescription>Breakdown of deliverability confidence scores across all contacts</CardDescription>
          </CardHeader>
          <div className="space-y-2.5 mt-3">
            {stats.score_distribution.map((bucket) => {
              const pct = stats.total > 0 ? Math.round((bucket.count / stats.total) * 100) : 0;
              const isGood = bucket.range.startsWith('80') || bucket.range.startsWith('9') || bucket.range === '100';
              const isMid = bucket.range.startsWith('5') || bucket.range.startsWith('6') || bucket.range.startsWith('7');
              return (
                <div key={bucket.range} className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-[var(--text-tertiary)] w-12 flex-shrink-0">{bucket.range}</span>
                  <div className="flex-1 h-3 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        isGood ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' :
                        isMid  ? 'bg-gradient-to-r from-amber-400 to-amber-500' :
                                 'bg-gradient-to-r from-rose-400 to-rose-500'
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[11px] tabular text-[var(--text-secondary)] w-16 text-right flex-shrink-0">{bucket.count} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Single verify */}
      <Card padding="md" className="space-y-4">
        <CardHeader>
          <CardTitle>Verify a single address</CardTitle>
          <CardDescription>Instantly check syntax, DNS records, and SMTP handshake</CardDescription>
        </CardHeader>
        <div className="flex gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
            <input
              type="email"
              placeholder="email@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && emailInput) verifyMut.mutate(emailInput); }}
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-sm focus:border-[#6366F1] focus:ring-2 focus:ring-[#6366F1]/20 outline-none transition-all"
            />
          </div>
          <button
            disabled={!emailInput || verifyMut.isPending}
            onClick={() => verifyMut.mutate(emailInput)}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 transition-all shadow-[0_1px_3px_rgba(99,102,241,0.4)]"
          >
            {verifyMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Verify
          </button>
        </div>
        {lastResult && <VerificationResultCard result={lastResult} />}
      </Card>

      {/* Batch verify */}
      <Card padding="md">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--indigo-subtle,rgba(99,102,241,0.1))]">
                <Users className="h-3.5 w-3.5 text-[#6366F1]" />
              </span>
              <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Batch verify all contacts</h2>
            </div>
            <p className="text-[12px] text-[var(--text-secondary)] pl-9">
              Run the full 3-layer pipeline on every unverified contact. Results are saved automatically.
            </p>
          </div>
          <button
            disabled={batchMut.isPending}
            onClick={() => batchMut.mutate()}
            className="inline-flex items-center gap-1.5 px-3.5 h-8 rounded-lg border border-[var(--border-default)] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-all flex-shrink-0"
          >
            {batchMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Run batch verify
          </button>
        </div>
      </Card>
    </div>
  );
}

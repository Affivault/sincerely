import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { verificationApi } from '../../api/verification.api';
import { Spinner } from '../../components/ui/Spinner';
import {
  ShieldCheck, ShieldX, CheckCircle2, XCircle, Loader2,
  Search, Zap, ArrowRight, Sparkles, Globe, Mail, FileCheck2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import toast from 'react-hot-toast';
import type { DcsVerificationResult } from '@lemlist/shared';

type Stage = 'idle' | 'pending' | 'pass' | 'fail';

function StageCell({ icon: Icon, label, state }: { icon: any; label: string; state: Stage }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'relative flex h-7 w-7 items-center justify-center rounded-lg border transition-all',
          state === 'idle' && 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-tertiary)]',
          state === 'pending' && 'bg-[#5B5BF5]/10 border-[#5B5BF5]/40 text-[var(--indigo)]',
          state === 'pass' && 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
          state === 'fail' && 'bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400',
        )}
      >
        {state === 'pending' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : state === 'pass' ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : state === 'fail' ? (
          <XCircle className="h-3.5 w-3.5" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
        {state === 'pending' && (
          <span className="absolute inset-0 rounded-lg ring-2 ring-[#5B5BF5]/30 animate-ping" />
        )}
      </span>
      <span
        className={cn(
          'text-[11px] font-medium uppercase tracking-wider',
          state === 'idle' && 'text-[var(--text-tertiary)]',
          state === 'pending' && 'text-[var(--indigo)]',
          state === 'pass' && 'text-emerald-600 dark:text-emerald-400',
          state === 'fail' && 'text-rose-600 dark:text-rose-400',
        )}
      >
        {label}
      </span>
    </div>
  );
}

function PipelineConnector({ active }: { active: boolean }) {
  return (
    <div className="flex-1 h-px relative overflow-hidden">
      <div className="absolute inset-0 bg-[var(--border-subtle)]" />
      {active && (
        <div className="absolute inset-y-0 left-0 right-0 bg-[var(--indigo)] animate-pulse" />
      )}
    </div>
  );
}

function HealthGauge({ score, size = 160 }: { score: number; size?: number }) {
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const stroke = score >= 80 ? '#10B981' : score >= 50 ? '#F59E0B' : '#F43F5E';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke="var(--border-subtle)" strokeWidth="10" fill="none"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={stroke} strokeWidth="10" fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[34px] font-semibold tabular tracking-[-0.03em] text-[var(--text-primary)] leading-none">
          {score}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)] mt-1">
          Avg DCS
        </div>
      </div>
    </div>
  );
}

export function VerificationPage() {
  const [emailInput, setEmailInput] = useState('');
  const [lastResult, setLastResult] = useState<DcsVerificationResult | null>(null);
  const [history, setHistory] = useState<DcsVerificationResult[]>([]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['verification-stats'],
    queryFn: verificationApi.getStats,
  });

  const verifyMut = useMutation({
    mutationFn: (email: string) => verificationApi.verifyEmail(email),
    onSuccess: (result) => {
      setLastResult(result);
      setHistory((h) => [result, ...h].slice(0, 6));
      setEmailInput('');
    },
    onError: () => toast.error('Verification failed'),
  });

  const batchMut = useMutation({
    mutationFn: () => verificationApi.batchVerify(),
    onSuccess: (res) => toast.success(`Verified ${res.verified} contact(s)`),
    onError: () => toast.error('Batch verification failed'),
  });

  const isPending = verifyMut.isPending;
  const syntaxState: Stage = isPending ? 'pending' : lastResult ? (lastResult.syntax_ok ? 'pass' : 'fail') : 'idle';
  const dnsState: Stage = isPending ? 'pending' : lastResult ? (lastResult.domain_ok ? 'pass' : 'fail') : 'idle';
  const smtpState: Stage = isPending ? 'pending' : lastResult ? (lastResult.smtp_ok ? 'pass' : 'fail') : 'idle';

  const verifiedPct = stats && stats.total > 0 ? Math.round((stats.verified / stats.total) * 100) : 0;
  const avgScore = Math.round(stats?.avg_score || 0);

  return (
    <div className="space-y-5">
      {/* ── Hero command bar with live pipeline ──────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
        <div className="absolute inset-0 bg-[var(--indigo-subtle)] opacity-40 pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-3.5 w-3.5 text-[var(--indigo)]" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Live deliverability pipeline
            </span>
          </div>

          <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center">
            {/* Input */}
            <form
              onSubmit={(e) => { e.preventDefault(); if (emailInput) verifyMut.mutate(emailInput); }}
              className="flex-1 flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-tertiary)]" />
                <input
                  type="email"
                  placeholder="Type an email address to verify it instantly…"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full h-11 pl-10 pr-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[14px] text-[var(--text-primary)] focus:border-[var(--indigo)] focus:ring-2 focus:ring-[#5B5BF5]/15 outline-none transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={!emailInput || isPending}
                className="inline-flex items-center gap-1.5 px-4 h-11 rounded-xl bg-[var(--indigo)] text-white text-[13px] font-semibold hover:bg-[#4F46E5] disabled:opacity-40 transition-all shadow-[0_1px_3px_rgba(91,91,245,0.4)]"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Verify
              </button>
            </form>

            {/* Pipeline */}
            <div className="flex items-center gap-2 lg:gap-3 lg:pl-4 lg:border-l lg:border-[var(--border-subtle)]">
              <StageCell icon={FileCheck2} label="Syntax" state={syntaxState} />
              <PipelineConnector active={isPending || syntaxState === 'pass'} />
              <StageCell icon={Globe} label="DNS" state={dnsState} />
              <PipelineConnector active={isPending || dnsState === 'pass'} />
              <StageCell icon={Mail} label="SMTP" state={smtpState} />
            </div>
          </div>

          {/* Result row */}
          {lastResult && !isPending && (
            <div className="mt-4 flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] animate-fade-in">
              {lastResult.score >= 60 ? (
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              ) : (
                <ShieldX className="h-4 w-4 text-rose-500 flex-shrink-0" />
              )}
              <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                {lastResult.email}
              </span>
              <span className="text-[12px] text-[var(--text-secondary)] truncate">
                {lastResult.fail_reason || (lastResult.score >= 60 ? 'Deliverable' : 'Delivery issue detected')}
              </span>
              <span className={cn(
                'ml-auto inline-flex items-center px-1.5 h-[20px] rounded-[5px] text-[11px] font-bold tabular flex-shrink-0',
                lastResult.score >= 80 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : lastResult.score >= 50 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
              )}>
                {lastResult.score}/100
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Health overview row ──────────────────────────────────────── */}
      {statsLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : stats ? (
        <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-4">
          {/* Health gauge */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 flex flex-col items-center justify-center">
            <HealthGauge score={avgScore} />
            <div className="mt-3 text-center">
              <div className="text-[13px] font-medium text-[var(--text-primary)]">
                {verifiedPct}% verified
              </div>
              <div className="text-[11px] text-[var(--text-tertiary)]">
                {stats.verified.toLocaleString()} of {stats.total.toLocaleString()} contacts
              </div>
            </div>
          </div>

          {/* Distribution + actions */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">DCS distribution</h2>
                <p className="text-[11.5px] text-[var(--text-tertiary)]">How your contacts score across the deliverability spectrum.</p>
              </div>
              <button
                disabled={batchMut.isPending || stats.unverified === 0}
                onClick={() => batchMut.mutate()}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 transition-all flex-shrink-0"
              >
                {batchMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {batchMut.isPending ? 'Running…' : `Verify ${stats.unverified} pending`}
              </button>
            </div>

            {/* Stacked horizontal distribution bar */}
            {stats.score_distribution && stats.score_distribution.length > 0 && (
              <>
                <div className="flex h-7 w-full rounded-md overflow-hidden gap-px bg-[var(--bg-elevated)] mb-3">
                  {stats.score_distribution.map((bucket) => {
                    const pct = stats.total > 0 ? (bucket.count / stats.total) * 100 : 0;
                    if (pct === 0) return null;
                    const isGood = bucket.range.startsWith('80') || bucket.range.startsWith('9') || bucket.range === '100';
                    const isMid = bucket.range.startsWith('5') || bucket.range.startsWith('6') || bucket.range.startsWith('7');
                    return (
                      <div
                        key={bucket.range}
                        className={cn(
                          'group relative h-full transition-all hover:opacity-90 cursor-help',
                          isGood ? 'bg-emerald-500'
                            : isMid ? 'bg-amber-500'
                            : 'bg-rose-500'
                        )}
                        style={{ width: `${pct}%` }}
                        title={`${bucket.range}: ${bucket.count} (${Math.round(pct)}%)`}
                      >
                        {pct >= 8 && (
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white/95 tabular">
                            {bucket.count}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {stats.score_distribution.map((bucket) => {
                    const pct = stats.total > 0 ? Math.round((bucket.count / stats.total) * 100) : 0;
                    const isGood = bucket.range.startsWith('80') || bucket.range.startsWith('9') || bucket.range === '100';
                    const isMid = bucket.range.startsWith('5') || bucket.range.startsWith('6') || bucket.range.startsWith('7');
                    return (
                      <div key={bucket.range} className="flex items-center gap-1.5">
                        <span className={cn(
                          'w-2 h-2 rounded-sm',
                          isGood ? 'bg-emerald-500' : isMid ? 'bg-amber-500' : 'bg-rose-500'
                        )} />
                        <span className="text-[11px] font-mono text-[var(--text-tertiary)]">{bucket.range}</span>
                        <span className="text-[11px] font-semibold tabular text-[var(--text-secondary)]">{bucket.count}</span>
                        <span className="text-[10.5px] tabular text-[var(--text-tertiary)]">({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Recent verifications ─────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">Recent checks</h2>
            <span className="text-[11px] text-[var(--text-tertiary)]">{history.length} this session</span>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {history.map((r, i) => {
              const passed = r.score >= 60;
              return (
                <div key={i} className="flex items-center gap-3 py-2">
                  <span className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg flex-shrink-0',
                    passed ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-500'
                  )}>
                    {passed ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldX className="h-3.5 w-3.5" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{r.email}</p>
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                      <span className={cn('flex items-center gap-0.5', r.syntax_ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500')}>
                        {r.syntax_ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />} Syntax
                      </span>
                      <ArrowRight className="h-2.5 w-2.5" />
                      <span className={cn('flex items-center gap-0.5', r.domain_ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500')}>
                        {r.domain_ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />} DNS
                      </span>
                      <ArrowRight className="h-2.5 w-2.5" />
                      <span className={cn('flex items-center gap-0.5', r.smtp_ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500')}>
                        {r.smtp_ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />} SMTP
                      </span>
                    </div>
                  </div>
                  <span className={cn(
                    'inline-flex items-center px-1.5 h-[20px] rounded-[5px] text-[11px] font-bold tabular flex-shrink-0',
                    r.score >= 80 ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : r.score >= 50 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                      : 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
                  )}>
                    {r.score}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

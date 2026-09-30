import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Gauge } from 'lucide-react';
import { AI_FEATURE_LABELS, aiCapChoices, formatDayMonth, formatTokens, type AiUsage } from '@lemlist/shared';
import { aiApi } from '../../api/ai.api';
import { Chip } from '../ui/Chip';
import { cn } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   What Relay's AI has used this month, and where it stops.

   One bar against the allowance, what the tokens went on, and the
   allowance itself - an account can choose less than the server allows,
   never more. At the limit Relay reads with its rules until the month
   turns; nothing stops sending.
   ═══════════════════════════════════════════════════════════════════════ */

/** The day the allowance starts again, as a calendar day (it is midnight UTC). */
function when(iso: string): string {
  return formatDayMonth(iso.slice(0, 10));
}

export function AiUsageCard() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['ai-usage'], queryFn: aiApi.usage, staleTime: 30_000, meta: { silentError: true } });
  const setCap = useMutation({
    mutationFn: aiApi.setCap,
    onSuccess: (next) => {
      qc.setQueryData(['ai-usage'], next);
      qc.invalidateQueries({ queryKey: ['system-status'] });
      toast.success(next.cap_tokens ? `Relay's AI now stops at ${formatTokens(next.cap_tokens)} tokens a month.` : 'Relay\'s AI has no monthly limit.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'The allowance could not be changed.'),
  });

  if (!data || !data.available) return null;
  return <Meter usage={data} saving={setCap.isPending} onPick={(cap) => setCap.mutate(cap)} />;
}

function Meter({ usage, saving, onPick }: { usage: AiUsage; saving: boolean; onPick: (cap: number | null) => void }) {
  const u = usage;
  const pct = u.cap_tokens ? Math.min(100, Math.round((u.used_tokens / u.cap_tokens) * 100)) : 0;
  const bar = u.state === 'reached' ? 'bg-rose-500' : u.state === 'near' ? 'bg-amber-500' : 'bg-[var(--indigo)]';
  const spent = u.by_feature.filter((f) => f.calls > 0);
  const choices = aiCapChoices(u.ceiling_tokens);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3" data-ai-usage={u.state}>
      <div className="flex items-start gap-3">
        <Gauge className="h-5 w-5 text-[var(--indigo)] mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-strong font-semibold text-[var(--text-primary)]">AI used this month</p>
          <p className="text-body text-[var(--text-tertiary)] mt-0.5">
            {u.cap_tokens
              ? `${formatTokens(u.used_tokens)} of ${formatTokens(u.cap_tokens)} tokens`
              : `${formatTokens(u.used_tokens)} tokens, no limit`}
            {' '}across {u.calls.toLocaleString()} {u.calls === 1 ? 'call' : 'calls'}
            {u.cost_usd != null && ` · about $${u.cost_usd.toFixed(2)}`}
            {' '}· starts again {when(u.resets_at)}
          </p>
        </div>
      </div>

      {u.cap_tokens > 0 && (
        <div
          className="h-2 overflow-hidden rounded-full bg-[var(--bg-hover)]"
          role="meter"
          aria-label="AI allowance used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className={cn('h-full rounded-full transition-[width]', bar)} style={{ width: `${Math.max(pct, u.used_tokens ? 2 : 0)}%` }} />
        </div>
      )}

      {u.state === 'reached' && (
        <p className="text-body text-rose-700 dark:text-rose-400">
          The allowance is used up. Relay is reading replies with its keyword rules and writing from templates until {when(u.resets_at)}. Nothing has stopped sending.
        </p>
      )}
      {u.state === 'near' && (
        <p className="text-body text-amber-800 dark:text-amber-300">
          Over 80% used. At the limit Relay carries on with its keyword rules until {when(u.resets_at)}.
        </p>
      )}

      {spent.length > 0 && (
        <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
          {spent.map((f) => (
            <li key={f.feature} className="flex items-center justify-between gap-2 text-caption">
              <span className="text-[var(--text-secondary)]">{AI_FEATURE_LABELS[f.feature]}</span>
              <span className="tabular-nums text-[var(--text-tertiary)]">
                {formatTokens(f.input_tokens + f.output_tokens)} · {f.calls.toLocaleString()}×
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
        <span className="text-body font-medium text-[var(--text-secondary)]">Monthly allowance</span>
        {choices.map((c) => {
          const isCeiling = c === u.ceiling_tokens;
          const active = isCeiling ? !u.cap_is_custom : u.cap_is_custom && u.cap_tokens === c;
          return (
            <Chip key={c} active={active} disabled={saving} onClick={() => onPick(isCeiling ? null : c)}>
              {formatTokens(c)}{isCeiling ? ' (most)' : ''}
            </Chip>
          );
        })}
        {!u.ceiling_tokens && (
          <Chip active={!u.cap_is_custom} disabled={saving} onClick={() => onPick(null)}>No limit</Chip>
        )}
      </div>
      <p className="text-caption text-[var(--text-tertiary)]">
        Only replies from the last {u.fresh_days} days are read by Claude; older mail found while syncing your history is read by the rules, so a first sync never spends the allowance.
        {!u.persisted && ' Run migration 079 to keep this count across restarts.'}
      </p>
    </div>
  );
}

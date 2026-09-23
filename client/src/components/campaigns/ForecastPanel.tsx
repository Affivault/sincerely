/* ═══════════════════════════════════════════════════════════════════════
   What launching this campaign will actually do.

   Before the button: when the last email goes, when everyone has had the
   first, how many sends a day the mailboxes can carry, what holds it back,
   and what the account's own history says will come back. The bars are
   the send calendar - each one a day, weekends left empty.
   ═══════════════════════════════════════════════════════════════════════ */

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, Gauge, MessageSquareReply, Sparkles, TrendingUp } from 'lucide-react';
import type { CampaignForecast } from '@lemlist/shared';
import { campaignsApi } from '../../api/campaigns.api';
import { parseDay } from '@lemlist/shared';
import { cn } from '../../lib/utils';

function dayLabel(iso: string | null): string {
  const d = parseDay(iso);
  return d ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
}

function Stat({ icon: Icon, label, value, hint }: { icon: typeof Gauge; label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <Icon className="h-3 w-3" />{label}
      </p>
      <p className="mt-0.5 truncate text-strong font-semibold text-[var(--text-primary)] tabular">{value}</p>
      {hint && <p className="truncate text-caption text-[var(--text-tertiary)]">{hint}</p>}
    </div>
  );
}

export function ForecastView({ f }: { f: CampaignForecast }) {
  // Show up to the finish, and at least three weeks, so the shape reads.
  const last = Math.max(20, Math.min(f.days.length - 1, (f.finish_day ?? f.days.length - 1) + 2));
  const shown = f.days.slice(0, last + 1);
  const peak = Math.max(1, ...shown.map((d) => Math.max(d.sends, d.capacity)));
  const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={CalendarRange}
          label="Last email"
          value={f.finish_day === null ? 'Beyond 4 months' : f.finish_day === 0 ? 'Today' : dayLabel(f.finish_date)}
          hint={f.finish_day !== null ? `${f.finish_day} day${f.finish_day === 1 ? '' : 's'} from now` : undefined}
        />
        <Stat
          icon={TrendingUp}
          label="Everyone reached"
          value={f.first_touch_day === null ? 'Not within 4 months' : f.first_touch_day === 0 ? 'Today' : `In ${f.first_touch_day} days`}
          hint="first email sent to all"
        />
        <Stat
          icon={Gauge}
          label="Per sending day"
          value={f.daily_capacity > 0 ? `~${f.daily_capacity.toLocaleString()}` : 'No cap'}
          hint={f.bottleneck === 'mailboxes' ? 'held back by mailboxes' : f.bottleneck === 'daily_limit' ? 'held back by daily limit' : `${f.total_sends.toLocaleString()} emails in all`}
        />
        <Stat
          icon={MessageSquareReply}
          label="Expected back"
          value={`~${f.projection.replies.toLocaleString()} replies`}
          hint={`~${f.projection.positive.toLocaleString()} interested${f.projection.assumed ? ' (typical rates)' : ''}`}
        />
      </div>

      <div className="flex h-16 items-end gap-[2px]" aria-label="Sends per day">
        {shown.map((d, i) => (
          <div
            key={d.date}
            title={`${dayLabel(d.date)}: ${d.sends.toLocaleString()} sent${d.sending_day ? ` of ${d.capacity.toLocaleString()} possible` : ' (not a sending day)'}`}
            className="relative flex-1 min-w-[3px] rounded-sm bg-[var(--bg-elevated)]"
            style={{ height: d.sending_day ? `${Math.max(6, (d.capacity / peak) * 100)}%` : '4%' }}
          >
            <div
              className={cn('absolute inset-x-0 bottom-0 rounded-sm', i === f.finish_day ? 'bg-emerald-500' : 'bg-[var(--indigo)]')}
              style={{ height: `${d.capacity > 0 ? Math.min(100, (d.sends / d.capacity) * 100) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-micro text-[var(--text-tertiary)]">
        <span>Today</span>
        <span>{dayLabel(shown[shown.length - 1]?.date ?? null)}</span>
      </div>

      <p className="flex items-start gap-1.5 text-caption text-[var(--text-tertiary)]">
        <Sparkles className="mt-0.5 h-3 w-3 flex-shrink-0" />
        {f.projection.assumed
          ? 'Replies use typical cold-email rates until this account has more history.'
          : `Based on your last 6 months: ${pct(f.projection.reply_rate)} of emails got a reply, ${pct(f.projection.positive_rate)} an interested one, over ${f.projection.basis_sent.toLocaleString()} sends.`}
      </p>

      {f.warnings.length > 0 && (
        <ul className="space-y-1">
          {f.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-caption text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />{w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ForecastPanel({ campaignId, title = 'What happens next' }: { campaignId: string; title?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign-forecast', campaignId],
    queryFn: () => campaignsApi.forecast(campaignId),
    staleTime: 60_000,
  });
  if (isError) return null;
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-strong font-semibold text-[var(--text-primary)]">
        <CalendarRange className="h-4 w-4 text-[var(--indigo)]" /> {title}
      </h3>
      {isLoading || !data
        ? <div className="h-24 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
        : data.total_sends === 0 && data.finish_day === null && data.warnings.length === 0
          ? <p className="text-body text-[var(--text-tertiary)]">Nobody is waiting for an email in this campaign.</p>
          : <ForecastView f={data} />}
    </section>
  );
}

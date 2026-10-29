import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, BarChart3, Flame, Table2 } from 'lucide-react';
import type { AdminInsightsMonth } from '@lemlist/shared';
import { adminApi } from '../../api/admin.api';
import { Spinner } from '../ui/Spinner';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { cn } from '../../lib/utils';
import { AdminHeader } from './AdminShell';
import { Banner, Card, Tile, errMsg } from './adminUi';
import { moneyTone, monthLabel, planName, usd } from './adminFormat';

const tooltipStyle = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '10px',
  boxShadow: 'var(--shadow-lg)',
  padding: '8px 12px',
  fontSize: '12px',
};
const short = (m: string) => monthLabel(m).split(' ')[0];
const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

interface Series {
  key: string;
  title: string;
  hint: string;
  kind: 'bar' | 'line';
  value: (m: AdminInsightsMonth) => number | null;
  format: (n: number) => string;
}

const SERIES: Series[] = [
  { key: 'signups', title: 'Sign-ups', hint: 'New accounts a month', kind: 'bar', value: (m) => m.signups, format: (n) => n.toLocaleString() },
  { key: 'active', title: 'Active senders', hint: 'Accounts that sent email that month', kind: 'bar', value: (m) => m.active_senders, format: (n) => n.toLocaleString() },
  { key: 'revenue', title: 'Money in', hint: 'Payments less refunds', kind: 'bar', value: (m) => m.revenue_usd, format: (n) => usd(n) },
  { key: 'payers', title: 'Paying accounts', hint: 'Paid for a subscription that month', kind: 'line', value: (m) => m.payers, format: (n) => n.toLocaleString() },
  { key: 'churn', title: 'Churned', hint: 'Paid the month before, then stopped and cancelled', kind: 'bar', value: (m) => m.churned, format: (n) => n.toLocaleString() },
  { key: 'trials', title: 'Trial conversion', hint: 'Trials ending that month that went on to pay', kind: 'line', value: (m) => (m.trials_ended ? m.trials_converted / m.trials_ended : null), format: (n) => pct(n) },
];

/*
 * The business over the last twelve months, one measure to a chart so each
 * reads on its own scale, with a table of the same numbers a click away.
 */
export function AdminInsights() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['admin', 'insights'], queryFn: adminApi.insights });
  const [asTable, setAsTable] = useState(false);
  const reduced = usePrefersReducedMotion();

  const toggle = (
    <div className="inline-flex rounded-lg border border-[var(--border-default)] overflow-hidden" role="radiogroup" aria-label="Show as">
      {([[false, 'Charts', BarChart3], [true, 'Table', Table2]] as const).map(([v, label, Icon]) => (
        <button key={label} role="radio" aria-checked={asTable === v} onClick={() => setAsTable(v)}
          className={cn('inline-flex items-center gap-1.5 h-8 px-3 text-body', asTable === v ? 'bg-[var(--text-primary)] text-[var(--bg-app)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );

  if (isLoading) return <><AdminHeader title="Insights" /><div className="flex justify-center py-16"><Spinner size="lg" /></div></>;
  if (isError || !data) return <><AdminHeader title="Insights" /><p className="text-body text-[var(--text-tertiary)]">{errMsg(error, 'Insights could not be loaded.')}</p></>;

  const months = data.months;
  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const recentTrials = months.slice(-4, -1).reduce((t, m) => ({ e: t.e + m.trials_ended, c: t.c + m.trials_converted }), { e: 0, c: 0 });
  const churnRate = prev && months.length > 2 && months[months.length - 3].payers ? (prev.churned ?? 0) / months[months.length - 3].payers : null;

  return (
    <>
      <AdminHeader title="Insights" sub="The last twelve months. This month is still running." actions={toggle} />
      <div className="space-y-4">
        {data.provider_balance.low && <Banner tone="danger" icon={AlertTriangle}>Icypeas is down to {Math.round(data.provider_balance.credits || 0).toLocaleString()} credits. Searches and email finding stop for everyone when it runs out.</Banner>}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Est. MRR" value={`$${Math.round(data.est_mrr_usd).toLocaleString()}`} sub="Active paid plans at list price" />
          <Tile label="Paying this month" value={last.payers.toLocaleString()} sub={prev ? `${prev.payers.toLocaleString()} last month` : undefined} />
          <Tile label={`Churn in ${prev ? monthLabel(prev.month) : 'last month'}`} value={pct(churnRate)} sub={prev?.churned != null ? `${prev.churned} account${prev.churned === 1 ? '' : 's'}` : undefined} tone={churnRate && churnRate > 0.08 ? 'text-red-600 dark:text-red-400' : undefined} />
          <Tile label="Trial conversion" value={recentTrials.e ? pct(recentTrials.c / recentTrials.e) : '—'} sub={recentTrials.e ? `${recentTrials.c} of ${recentTrials.e}, last 3 full months` : 'No trials ended yet'} />
        </div>

        {asTable ? (
          <Card title="Month by month" icon={Table2}>
            <div className="relative overflow-x-auto -mx-4 -my-4">
              <table className="w-full min-w-[720px] text-left text-body">
                <thead>
                  <tr className="text-caption text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                    <th className="py-2 px-4 font-medium">Month</th>
                    {SERIES.map((s) => <th key={s.key} className="py-2 px-2 font-medium text-right">{s.title}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...months].reverse().map((m) => (
                    <tr key={m.month} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="py-2 px-4 text-[var(--text-primary)]">{monthLabel(m.month)}</td>
                      {SERIES.map((s) => { const v = s.value(m); return <td key={s.key} className="py-2 px-2 text-right tabular text-[var(--text-secondary)]">{v == null ? '—' : s.format(v)}</td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {SERIES.map((s) => <Chart key={s.key} s={s} months={months} reduced={reduced} />)}
          </div>
        )}

        <Card title="Costing us the most this month" icon={Flame} aside={<span className="text-caption text-[var(--text-tertiary)]">Icypeas spend</span>}>
          {data.top_cost.length === 0 ? (
            <p className="text-body text-[var(--text-tertiary)]">No paid calls yet this month.</p>
          ) : (
            <div className="relative overflow-x-auto -mx-4 -my-4">
              <table className="w-full min-w-[520px] text-left text-body">
                <thead>
                  <tr className="text-caption text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                    <th className="py-2 px-4 font-medium">Account</th>
                    <th className="py-2 px-2 font-medium">Plan</th>
                    <th className="py-2 px-2 font-medium text-right">Cost</th>
                    <th className="py-2 px-2 font-medium text-right">Paid</th>
                    <th className="py-2 px-4 font-medium text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_cost.map((u) => (
                    <tr key={u.user_id} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="py-2 px-4 max-w-[260px] truncate"><Link to={`/admin/accounts?a=${u.user_id}&tab=credits`} className="text-[var(--text-primary)] hover:underline">{u.email}</Link></td>
                      <td className="py-2 px-2 text-[var(--text-secondary)]">{planName(u.plan)}</td>
                      <td className="py-2 px-2 text-right tabular">{usd(u.cost_usd)}</td>
                      <td className="py-2 px-2 text-right tabular text-[var(--text-secondary)]">{usd(u.revenue_usd)}</td>
                      <td className={cn('py-2 px-4 text-right tabular font-medium', moneyTone(u.profit_usd))}>{usd(u.profit_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Chart({ s, months, reduced }: { s: Series; months: AdminInsightsMonth[]; reduced: boolean }) {
  const rows = months.map((m) => ({ label: short(m.month), month: monthLabel(m.month), v: s.value(m) }));
  const latest = [...rows].reverse().find((r) => r.v != null);
  const axis = { axisLine: false, tickLine: false, tick: { fill: 'var(--text-tertiary)', fontSize: 10 } } as const;
  const tip = <Tooltip contentStyle={tooltipStyle} labelFormatter={(_l, p) => (p?.[0]?.payload?.month ?? '')} formatter={(v: number) => [s.format(v), s.title]} cursor={s.kind === 'bar' ? { fill: 'var(--bg-hover)', radius: 4 } : { stroke: 'var(--border-default)', strokeDasharray: '4 4' }} />;

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4" aria-label={s.title}>
      <div className="flex items-baseline gap-2">
        <h3 className="text-strong font-semibold text-[var(--text-primary)] flex-1">{s.title}</h3>
        <span className="text-heading font-semibold tabular text-[var(--text-primary)]">{latest?.v != null ? s.format(latest.v) : '—'}</span>
      </div>
      <p className="text-micro text-[var(--text-tertiary)]">{s.hint}{latest ? `, ${latest.month}` : ''}</p>
      <div className="h-36 mt-3 -ml-2">
        <ResponsiveContainer width="100%" height="100%">
          {s.kind === 'bar' ? (
            <BarChart data={rows} barCategoryGap={4}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} width={44} allowDecimals={false} tickFormatter={(v: number) => (s.key === 'revenue' ? `$${v >= 1000 ? `${Math.round(v / 100) / 10}k` : v}` : String(v))} />
              {tip}
              <Bar dataKey="v" fill="var(--indigo)" radius={[4, 4, 0, 0]} isAnimationActive={!reduced} />
            </BarChart>
          ) : (
            <LineChart data={rows}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} width={44} allowDecimals={s.key === 'trials'} domain={s.key === 'trials' ? [0, 1] : [0, 'auto']} tickFormatter={(v: number) => (s.key === 'trials' ? pct(v) : String(v))} />
              {tip}
              <Line dataKey="v" type={s.key === 'trials' ? 'linear' : 'monotone'} stroke="var(--indigo)" strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4, fill: 'var(--indigo)', stroke: 'var(--bg-surface)', strokeWidth: 2 }} isAnimationActive={!reduced} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

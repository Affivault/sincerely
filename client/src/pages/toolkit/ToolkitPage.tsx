import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/shared/PageHeader';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../../api/analytics.api';
import { cn } from '../../lib/utils';
import {
  Wrench, Shield, ShieldCheck, ShieldOff, Globe, Zap,
  CheckCircle, AlertTriangle, BarChart3, ArrowRight,
  Mail, Thermometer,
} from 'lucide-react';

export function ToolkitPage() {
  const navigate = useNavigate();

  const { data: deliverability } = useQuery({
    queryKey: ['analytics', 'deliverability'],
    queryFn: analyticsApi.deliverability,
  });

  const highDcs = deliverability?.dcs_distribution.find((d) => d.label.startsWith('High'))?.value ?? 0;
  const medDcs  = deliverability?.dcs_distribution.find((d) => d.label.startsWith('Medium'))?.value ?? 0;
  const lowDcs  = deliverability?.dcs_distribution.find((d) => d.label.startsWith('Low'))?.value ?? 0;
  const bouncedContacts = deliverability?.bounced_contacts ?? 0;
  const totalVerified = highDcs + medDcs;

  return (
    <div>
      <PageHeader
        decorate
        leading={
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--indigo-subtle)] border border-[rgba(91,91,245,0.18)]">
            <Wrench className="h-4 w-4 text-[var(--indigo)]" />
          </span>
        }
        title="Toolkit"
        description="Email health tools, verification, domain monitoring, and deliverability utilities."
      />

      {/* Health overview strip */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <HealthCard
          icon={CheckCircle}
          label="Verified contacts"
          value={totalVerified}
          color="#10B981"
          desc="DCS score ≥ 50"
        />
        <HealthCard
          icon={AlertTriangle}
          label="Low quality"
          value={lowDcs}
          color="#EF4444"
          desc="DCS score < 50"
          negative
        />
        <HealthCard
          icon={ShieldOff}
          label="Bounced"
          value={bouncedContacts}
          color={bouncedContacts > 0 ? '#EF4444' : '#10B981'}
          desc="Hard bounces detected"
          negative={bouncedContacts > 0}
        />
        <HealthCard
          icon={ShieldCheck}
          label="Suppressed"
          value={deliverability?.suppression_by_reason.reduce((s, r) => s + r.value, 0) ?? 0}
          color="#6366F1"
          desc="Across all reasons"
        />
      </div>

      {/* Tool cards */}
      <div className="grid grid-cols-3 gap-4">
        <ToolCard
          icon={ShieldCheck}
          iconColor="#10B981"
          iconBg="bg-emerald-500/10"
          title="Email Verification"
          description="Verify email addresses before sending. Check syntax, DNS, and mailbox existence to protect your sender reputation."
          badge="Via settings"
          onClick={() => navigate('/verification')}
          stats={[
            { label: 'High DCS (≥80)', value: highDcs, color: '#10B981' },
            { label: 'Medium DCS (50–79)', value: medDcs, color: '#F59E0B' },
            { label: 'Low DCS (<50)', value: lowDcs, color: '#EF4444' },
          ]}
        />

        <ToolCard
          icon={ShieldOff}
          iconColor="#6366F1"
          iconBg="bg-[rgba(99,102,241,0.1)]"
          title="Suppression List"
          description="Manage your suppression list to prevent emails from being sent to opted-out, complained, or bounced contacts."
          onClick={() => navigate('/suppression')}
          stats={deliverability?.suppression_by_reason.filter((r) => r.value > 0).map((r) => ({
            label: r.label, value: r.value, color: r.color,
          })) ?? []}
        />

        <ToolCard
          icon={Globe}
          iconColor="#06B6D4"
          iconBg="bg-cyan-500/10"
          title="Domain Management"
          description="Monitor your sending domains, check DKIM/SPF/DMARC status, and manage custom tracking domains."
          onClick={() => navigate('/domains')}
        />

        <ToolCard
          icon={Mail}
          iconColor="#8B5CF6"
          iconBg="bg-violet-500/10"
          title="SMTP Accounts"
          description="Configure and manage sending accounts. Monitor send rates, test connections, and rotate accounts for deliverability."
          onClick={() => navigate('/smtp-accounts')}
        />

        <ToolCard
          icon={Thermometer}
          iconColor="#F59E0B"
          iconBg="bg-amber-500/10"
          title="Warm-up Status"
          description="Track your email account warm-up progress. Good warm-up leads to better inbox placement rates."
          badge="Coming soon"
          disabled
        />

        <ToolCard
          icon={BarChart3}
          iconColor="#6366F1"
          iconBg="bg-[rgba(99,102,241,0.1)]"
          title="Deliverability Report"
          description="Get a full breakdown of your sending health — bounce rates, open rates by domain, and reputation signals."
          onClick={() => navigate('/analytics')}
        />
      </div>

      {/* DCS distribution */}
      {deliverability && (
        <div className="mt-6 panel p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">Data quality score (DCS) distribution</h3>
              <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">Quality breakdown across all contacts in your workspace</p>
            </div>
            <button onClick={() => navigate('/verification')} className="flex items-center gap-1 text-[11.5px] font-medium text-[var(--indigo)] hover:underline">
              Verify contacts <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-3">
            {deliverability.dcs_distribution.map((d) => {
              const total = deliverability.dcs_distribution.reduce((s, x) => s + x.value, 0);
              const pct = total > 0 ? (d.value / total) * 100 : 0;
              return (
                <div key={d.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] text-[var(--text-secondary)]">{d.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-[var(--text-primary)] tabular-nums">{d.value.toLocaleString()}</span>
                      <span className="text-[11px] text-[var(--text-tertiary)] tabular-nums w-10 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: d.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function HealthCard({ icon: Icon, label, value, color, desc, negative }: {
  icon: React.ElementType; label: string; value: number; color: string; desc: string; negative?: boolean;
}) {
  return (
    <div className="panel p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-[6px]" style={{ background: `${color}18` }}>
          <Icon className="h-3.5 w-3.5" style={{ color }} />
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{label}</span>
      </div>
      <div className="text-[22px] font-bold tabular-nums tracking-[-0.02em]" style={{ color: negative && value > 0 ? color : value === 0 ? '#10B981' : color }}>
        {value.toLocaleString()}
      </div>
      <p className="text-[10.5px] text-[var(--text-tertiary)] mt-0.5">{desc}</p>
    </div>
  );
}

function ToolCard({ icon: Icon, iconColor, iconBg, title, description, badge, onClick, disabled, stats }: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  badge?: string;
  onClick?: () => void;
  disabled?: boolean;
  stats?: { label: string; value: number; color: string }[];
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={cn(
        'panel p-4 flex flex-col gap-3 transition-all',
        !disabled && onClick && 'cursor-pointer hover:shadow-[0_2px_8px_rgba(15,15,25,0.06)] hover:border-[var(--border-default)]',
        disabled && 'opacity-60'
      )}
    >
      <div className="flex items-start justify-between">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl flex-shrink-0', iconBg)}>
          <Icon className="h-4.5 w-4.5" style={{ color: iconColor }} />
        </span>
        {badge && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
            {badge}
          </span>
        )}
      </div>
      <div>
        <div className="flex items-center gap-1.5">
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
          {!disabled && onClick && <ArrowRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />}
        </div>
        <p className="text-[11.5px] text-[var(--text-secondary)] mt-1 leading-relaxed">{description}</p>
      </div>
      {stats && stats.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[11px] text-[var(--text-tertiary)]">{s.label}</span>
              </div>
              <span className="text-[11px] font-semibold text-[var(--text-primary)] tabular-nums">{s.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

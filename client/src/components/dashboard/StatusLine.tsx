import { Notice } from '../ui/Notice';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, XCircle, ShieldCheck, ArrowRight } from 'lucide-react';
import { systemApi } from '../../api/system.api';
import { autopilotApi } from '../../api/autopilot.api';
import { smtpApi } from '../../api/smtp.api';
import { autopilotBits } from './autopilotBits';
import { cn } from '../../lib/utils';

/** Below this a mailbox's health is worth a word on Home. */
const LOW_HEALTH = 50;

/**
 * One line at the top of Home for everything about the machinery: a job
 * or campaign that stopped, a mailbox whose health is low, and what the
 * deliverability autopilot is doing. It used to be up to three stacked
 * banners; now the most serious one leads and the autopilot rides along.
 * Nothing at all when there is nothing to say.
 */
export function StatusLine() {
  const { data: system } = useQuery({ queryKey: ['system-status'], queryFn: systemApi.status, staleTime: 60_000, meta: { silentError: true } });
  const { data: autopilot } = useQuery({ queryKey: ['autopilot'], queryFn: autopilotApi.status, staleTime: 60_000, meta: { silentError: true } });
  const { data: accounts } = useQuery({ queryKey: ['smtp-accounts'], queryFn: () => smtpApi.list(), staleTime: 5 * 60_000, meta: { silentError: true } });

  const low = (accounts || []).filter((a: any) => a.is_active && a.health_score < LOW_HEALTH);
  const pilot = autopilotBits(autopilot);

  let lead: { tone: 'down' | 'warn' | 'calm'; text: string; to: string } | null = null;
  if (system && system.level !== 'ok') {
    lead = { tone: system.level === 'down' ? 'down' : 'warn', text: system.headline, to: '/system' };
  } else if (low.length) {
    lead = {
      tone: 'warn',
      text: `${low.length === 1 ? `${low[0].label || low[0].email_address} has` : `${low.length} mailboxes have`} low health - sending from ${low.length === 1 ? 'it is' : 'them is'} being held back`,
      to: '/email-accounts',
    };
  }
  if (!lead && !pilot.length) return null;

  const Icon = lead?.tone === 'down' ? XCircle : lead ? AlertTriangle : ShieldCheck;
  return (
    <Notice
      tone={lead?.tone === 'down' ? 'negative' : lead ? 'attention' : 'positive'}
      icon={Icon}
      data-status-line={lead?.tone || 'calm'}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {lead && (
        <Link to={lead.to} className="group inline-flex min-w-0 flex-1 items-center gap-1.5 text-body text-[var(--text-primary)] hover:underline">
          <span className="truncate">{lead.text}</span>
          <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
        </Link>
      )}
      {pilot.length > 0 && (
        <Link
          to="/email-accounts?tab=autopilot"
          className={cn('min-w-0 truncate text-caption text-[var(--text-secondary)] hover:text-[var(--text-primary)]', !lead && 'flex-1 text-body')}
          data-autopilot-note
        >
          <span className="font-semibold text-[var(--text-primary)]">Autopilot</span> {pilot.join(', ')}{lead ? '' : '. Your campaigns keep sending.'}
        </Link>
      )}
      </div>
    </Notice>
  );
}

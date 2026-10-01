import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown, ExternalLink, ShieldAlert } from 'lucide-react';
import { autopilotApi } from '../../api/autopilot.api';
import { cn, formatRelativeTime } from '../../lib/utils';

/* ═══════════════════════════════════════════════════════════════════════
   Spam complaints - who pressed "Report spam", and how to hear about it.

   Providers only say so to senders registered with their feedback loop,
   so the card leads with how to register when nothing has been reported:
   an empty list here means "nobody told us", not "nobody complained".
   ═══════════════════════════════════════════════════════════════════════ */

const LOOPS = [
  { name: 'Yahoo and AOL', href: 'https://senders.yahooinc.com/complaint-feedback-loop/', note: 'Complaint Feedback Loop - register each sending domain (it needs DKIM).' },
  { name: 'Outlook and Hotmail', href: 'https://sendersupport.olc.protection.outlook.com/snds/JMRP.aspx', note: 'Junk Mail Reporting Program - register your sending IPs or domain.' },
  { name: 'Gmail', href: 'https://postmaster.google.com/', note: 'Gmail does not report individual complaints; Postmaster Tools shows your spam rate per domain.' },
];

export function ComplaintsCard() {
  const [showHow, setShowHow] = useState(false);
  const { data } = useQuery({ queryKey: ['autopilot', 'complaints'], queryFn: autopilotApi.complaints, staleTime: 60_000, meta: { silentError: true } });
  if (!data) return null;
  const rate = data.sent > 0 ? (data.total / data.sent) * 100 : 0;
  const high = rate >= 0.1;

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-complaints={data.total}>
      <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <ShieldAlert className={cn('mt-0.5 h-5 w-5 flex-shrink-0', data.total ? 'text-rose-500' : 'text-[var(--text-muted)]')} />
        <div className="min-w-0 flex-1">
          <p className="text-strong font-semibold text-[var(--text-primary)]">Spam complaints</p>
          <p className="text-caption text-[var(--text-tertiary)]">
            {data.total === 0
              ? 'None reported in the last 30 days.'
              : `${data.total} in the last 30 days, ${rate.toFixed(rate < 1 ? 2 : 1)}% of ${data.sent.toLocaleString()} sent${high ? ' - above the 0.1% providers start to act on' : ''}.`}
            {' '}Each one is suppressed, its sequences stopped, and counted against the mailbox that sent it.
          </p>
        </div>
      </div>

      {data.items.length > 0 && (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {data.items.slice(0, 8).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
              <span className="min-w-0 basis-full truncate text-body font-medium text-[var(--text-primary)] sm:basis-0 sm:flex-1">{c.email || 'Address withheld'}</span>
              <span className="text-caption text-[var(--text-tertiary)]">
                {c.campaign_name && <Link to={`/campaigns/${c.campaign_id}`} className="hover:underline">{c.campaign_name}</Link>}
                {c.mailbox && ` · from ${c.mailbox}`}
                {c.provider && ` · ${c.provider}`}
                {` · ${formatRelativeTime(c.at)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setShowHow((v) => !v)}
        aria-expanded={showHow}
        className="flex w-full items-center gap-2 border-t border-[var(--border-subtle)] px-4 h-10 text-left text-body text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      >
        How to be told about complaints
        <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', showHow && 'rotate-180')} />
      </button>
      {showHow && (
        <div className="space-y-2 px-4 pb-4 text-caption leading-relaxed text-[var(--text-secondary)]" data-complaints-how>
          <p>Register your sending domains with each provider's feedback loop and give one of your connected mailboxes as the address for reports. Sincerely reads them as they arrive, like any other mail.</p>
          <ul className="space-y-1.5">
            {LOOPS.map((l) => (
              <li key={l.name}>
                <a href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--indigo)] hover:underline">
                  {l.name} <ExternalLink className="h-3 w-3" />
                </a>
                {' '}- {l.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

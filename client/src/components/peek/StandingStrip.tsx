/* ═══════════════════════════════════════════════════════════════════════
   Where somebody stands, and the one-click moves, in the peek.

   A glance at a person should answer the questions that decide the next
   move: are they in a sequence right now and which step, is there a deal
   and is it healthy, and when did we last speak. Then the moves themselves
   - hold their sequences, let them go again, set a follow-up - without
   leaving whatever page the peek was opened over.
   ═══════════════════════════════════════════════════════════════════════ */

import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarPlus, Clock, Handshake, Megaphone, PauseCircle, PlayCircle } from 'lucide-react';
import { engagementWindow } from '@lemlist/shared';
import { analyticsApi } from '../../api/analytics.api';
import { contactsApi } from '../../api/contacts.api';
import { crmApi } from '../../api/crm.api';
import { commandApi } from '../../api/command.api';
import { cn, formatTimeUntil } from '../../lib/utils';
import { StatusBadge } from '../shared/StatusBadge';
import { DealHealthDot, useDealHealth } from '../crm/DealHealth';

export function StandingStrip({ contactId, email, name }: { contactId: string; email: string; name: string }) {
  const qc = useQueryClient();
  const { data: memberships = [] } = useQuery({
    queryKey: ['contact-campaigns', contactId],
    queryFn: () => contactsApi.getCampaigns(contactId),
  });
  const { data: deals = [] } = useQuery({
    queryKey: ['crm', 'deals', 'contact', contactId],
    queryFn: () => crmApi.listDeals({ contact_id: contactId, contact_email: email }),
  });
  const { data: health } = useDealHealth();
  // Same query the peek already runs for the history below, so no extra request.
  const { data: timeline } = useQuery({
    queryKey: ['contact-timeline', contactId],
    queryFn: () => analyticsApi.contactTimeline(contactId),
  });
  const readWindow = engagementWindow((timeline || []) as any[]);
  const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });

  const live = memberships.filter((m) => m.status === 'active' || m.status === 'pending');
  const paused = memberships.filter((m) => m.status === 'paused');
  const openDeals = deals.filter((d) => d.stage === 'lead' || d.stage === 'qualified' || d.stage === 'proposal');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['contact-campaigns', contactId] });
    qc.invalidateQueries({ queryKey: ['campaign-contacts'] });
  };
  const pause = useMutation({
    mutationFn: () => commandApi.pause(email),
    onSuccess: (r) => { refresh(); toast.success(`Paused ${r.paused} sequence${r.paused === 1 ? '' : 's'}`); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not pause'),
  });
  const resume = useMutation({
    mutationFn: () => commandApi.resume(email),
    onSuccess: (r) => { refresh(); toast.success(`Resumed ${r.resumed} sequence${r.resumed === 1 ? '' : 's'}`); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not resume'),
  });
  const followUp = useMutation({
    mutationFn: () => {
      const due = new Date();
      due.setDate(due.getDate() + 1);
      due.setHours(9, 0, 0, 0);
      return crmApi.createTask({
        title: `Follow up with ${name || email}`,
        due_date: due.toISOString(),
        priority: 'normal',
        contact_id: contactId,
        contact_name: name || email,
        deal_id: openDeals[0]?.id || null,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['crm'] }); qc.invalidateQueries({ queryKey: ['flow'] }); toast.success('Follow-up set for tomorrow 9:00'); },
    onError: () => toast.error('Could not add the follow-up'),
  });

  const btn = 'inline-flex items-center gap-1 h-7 px-2 rounded-md border border-[var(--border-subtle)] text-caption font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors';

  return (
    <div className="px-4 py-3 space-y-2.5 border-b border-[var(--border-subtle)]">
      <p className="text-micro font-semibold uppercase tracking-wider text-[var(--text-muted)]">Where they stand</p>

      {openDeals.length > 0 ? openDeals.slice(0, 2).map((d) => (
        <Link key={d.id} to={`/deals/${d.id}`} className="flex items-center gap-2 min-w-0 text-body hover:text-[var(--indigo)]">
          <Handshake className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
          <DealHealthDot health={health?.[d.id]} />
          <span className="truncate text-[var(--text-secondary)]">{d.title}</span>
          <span className="ml-auto flex-shrink-0 text-caption text-[var(--text-tertiary)]">{d.stage}</span>
        </Link>
      )) : (
        <p className="flex items-center gap-2 text-caption text-[var(--text-tertiary)]"><Handshake className="h-3.5 w-3.5" /> No open deal</p>
      )}

      {memberships.length === 0 ? (
        <p className="flex items-center gap-2 text-caption text-[var(--text-tertiary)]"><Megaphone className="h-3.5 w-3.5" /> Not in any campaign</p>
      ) : memberships.filter((m) => m.is_active).slice(0, 3).map((m) => (
        <Link key={m.campaign_contact_id} to={`/campaigns/${m.campaign_id}`} className="flex items-center gap-2 min-w-0 text-body hover:text-[var(--indigo)]">
          <Megaphone className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
          <span className="truncate text-[var(--text-secondary)]">{m.campaign_name || 'Campaign'}</span>
          <span className="ml-auto flex flex-shrink-0 items-center gap-1.5">
            <span className="text-caption tabular text-[var(--text-tertiary)]">
              step {(m.current_step_order ?? 0) + 1}{m.next_send_at ? ` · next ${formatTimeUntil(m.next_send_at)}` : ''}
            </span>
            <StatusBadge status={m.status} type="contact" />
          </span>
        </Link>
      ))}

      {readWindow && (
        <p className="flex items-center gap-2 text-caption text-[var(--text-tertiary)]" title={`From ${readWindow.count} opens, clicks and replies`}>
          <Clock className="h-3.5 w-3.5" /> Usually reads email {hourLabel(readWindow.from)}-{hourLabel(readWindow.to)} your time
        </p>
      )}

      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {live.length > 0 && (
          <button className={btn} disabled={pause.isPending} onClick={() => pause.mutate()} title="Hold every sequence to this person">
            <PauseCircle className="h-3.5 w-3.5" /> Pause sequences
          </button>
        )}
        {paused.length > 0 && (
          <button className={cn(btn, 'text-amber-600 dark:text-amber-400')} disabled={resume.isPending} onClick={() => resume.mutate()}>
            <PlayCircle className="h-3.5 w-3.5" /> Resume {paused.length}
          </button>
        )}
        <button className={btn} disabled={followUp.isPending} onClick={() => followUp.mutate()}>
          <CalendarPlus className="h-3.5 w-3.5" /> Follow up tomorrow
        </button>
      </div>
    </div>
  );
}

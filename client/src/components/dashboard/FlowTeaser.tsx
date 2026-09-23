import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Waves } from 'lucide-react';
import { flowApi } from '../../api/flow.api';

/**
 * The dashboard's way into Flow: how many decisions are waiting, and the
 * top one by name, so the first click of the day is the right one.
 */
export function FlowTeaser() {
  const { data } = useQuery({ queryKey: ['flow'], queryFn: flowApi.get, staleTime: 60_000 });
  const total = data ? data.items.length : 0;
  if (!data || total === 0) return null;
  const top = data.items[0];
  const topLabel = top.reply ? `${top.reply.contact_name || top.reply.from_email} - ${top.why.toLowerCase()}`
    : top.meeting ? `${top.meeting.title} - ${top.why.toLowerCase()}`
      : top.deal ? `${top.deal.title} - ${top.why}`
        : top.task ? top.task.title : '';
  return (
    <Link
      to="/flow"
      className="group flex items-center gap-3 rounded-xl border border-[var(--indigo)]/25 bg-[var(--indigo-subtle)] px-4 py-3 transition-colors hover:border-[var(--indigo)]/50"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--indigo)] text-white">
        <Waves className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold text-[var(--text-primary)]">
          {total} thing{total === 1 ? '' : 's'} need{total === 1 ? 's' : ''} a decision
        </span>
        <span className="block truncate text-caption text-[var(--text-secondary)]">First up: {topLabel}</span>
      </span>
      <span className="inline-flex flex-shrink-0 items-center gap-1 text-caption font-semibold text-[var(--indigo)]">
        Start Flow <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

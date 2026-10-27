import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Shuffle, AlertTriangle, Loader2, PauseCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { bookingLinksApi } from '../../api/booking.api';
import { cn } from '../../lib/utils';
import {
  ROUND_ROBIN_STRATEGIES, ROUND_ROBIN_MAX_HOSTS, ROUND_ROBIN_WINDOW_DAYS,
  type BookingLinkHost, type RoundRobinStatus, type RoundRobinStrategy,
} from '@lemlist/shared';

/* ═══════════════════════════════════════════════════════════════════════
   Team round-robin booking, in the UI.

   Off unless a team owner or admin switches it on. While it is off none of
   this shows anywhere except the switch itself, so a team that does not
   want it never has to think about it.
   ═══════════════════════════════════════════════════════════════════════ */

export const ROUND_ROBIN_KEY = ['team', 'round-robin'];

export function useRoundRobinStatus() {
  return useQuery({
    queryKey: ROUND_ROBIN_KEY,
    queryFn: bookingLinksApi.roundRobin,
    staleTime: 60_000,
    // A team without 097, or a blip, reads as "off": nothing round robin
    // appears rather than a broken control.
    retry: false,
  });
}

/** The switch, for the Team page. */
export function RoundRobinTeamCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useRoundRobinStatus();

  const set = useMutation({
    mutationFn: (enabled: boolean) => bookingLinksApi.setRoundRobin(enabled),
    onSuccess: (status: RoundRobinStatus) => {
      qc.setQueryData(ROUND_ROBIN_KEY, status);
      qc.invalidateQueries({ queryKey: ['booking-links'] });
      toast.success(status.enabled ? 'Round-robin booking is on' : 'Round-robin booking is off');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not change that'),
  });

  if (isLoading || isError || !data) return null;

  const hosts = data.members.length;
  return (
    <div className="panel p-4 mb-4" data-round-robin-card>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
          <Shuffle className="h-4 w-4 text-[var(--text-secondary)]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-strong font-semibold text-[var(--text-primary)]">Round-robin booking</h2>
          <p className="mt-0.5 text-body text-[var(--text-secondary)]">
            One booking link that shares meetings out across teammates. Each meeting goes to whoever
            is free and has had the fewest from that link lately, and lands in their own calendar.
          </p>
          <p className="mt-1.5 text-caption text-[var(--text-tertiary)]">
            {data.enabled
              ? 'On. Any booking link can now be set to round robin from its settings. Switching this off pauses those links; nothing else changes.'
              : 'Off. Booking links only ever book their owner, and none of this appears anywhere else.'}
            {data.enabled && hosts < 2 && ' Invite a teammate first: a rotation needs more than one person.'}
          </p>
          {!data.can_manage && (
            <p className="mt-1.5 text-caption text-[var(--text-tertiary)]">Only the team owner or an admin can change this.</p>
          )}
        </div>
        <button
          role="switch"
          aria-checked={data.enabled}
          aria-label="Round-robin booking for the team"
          disabled={!data.can_manage || set.isPending}
          onClick={() => set.mutate(!data.enabled)}
          title={data.can_manage ? undefined : 'Only the team owner or an admin can change this'}
          className={cn(
            "relative h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 after:absolute after:-inset-1 after:content-['']",
            data.enabled ? 'bg-[var(--indigo)]' : 'bg-[var(--border-subtle)]',
          )}
          data-round-robin-switch
        >
          <span className={cn(
            'absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
            data.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]',
          )} />
        </button>
      </div>
    </div>
  );
}

export interface HostDraft { user_id: string; priority: number; is_active: boolean }

/**
 * Who takes a round-robin link's meetings, inside the link editor.
 *
 * `stored` is what the server knows about each host (their own pause, mail
 * readiness, recent meetings); `value` is the owner's draft of the list.
 */
export function HostPicker({ members, stored, value, onChange, strategy, onStrategy }: {
  members: RoundRobinStatus['members'];
  stored: BookingLinkHost[];
  value: HostDraft[];
  onChange: (v: HostDraft[]) => void;
  strategy: RoundRobinStrategy;
  onStrategy: (s: RoundRobinStrategy) => void;
}) {
  const byId = new Map(stored.map((h) => [h.user_id, h]));
  const chosen = new Map(value.map((h) => [h.user_id, h]));
  const active = value.filter((h) => h.is_active && !byId.get(h.user_id)?.host_paused);

  const toggle = (userId: string, on: boolean) => {
    if (on) {
      if (value.length >= ROUND_ROBIN_MAX_HOSTS) {
        toast.error(`At most ${ROUND_ROBIN_MAX_HOSTS} hosts on one link`);
        return;
      }
      onChange([...value, { user_id: userId, priority: value.length + 1, is_active: true }]);
    } else {
      onChange(value.filter((h) => h.user_id !== userId));
    }
  };
  const setPriority = (userId: string, n: number) =>
    onChange(value.map((h) => (h.user_id === userId ? { ...h, priority: Math.min(100, Math.max(1, n || 1)) } : h)));

  return (
    <div className="space-y-2" data-host-picker>
      <div className="grid grid-cols-2 gap-1.5">
        {ROUND_ROBIN_STRATEGIES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => onStrategy(s.value)}
            aria-pressed={strategy === s.value}
            className={cn(
              'rounded-md border px-2 py-1.5 text-left transition-colors',
              strategy === s.value
                ? 'border-[var(--indigo)] bg-[var(--indigo-subtle)]'
                : 'border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]',
            )}
            data-strategy={s.value}
          >
            <span className="block text-body font-medium text-[var(--text-primary)]">{s.label}</span>
            <span className="block text-micro leading-snug text-[var(--text-tertiary)]">{s.hint}</span>
          </button>
        ))}
      </div>

      <div className="rounded-md border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
        {members.map((m) => {
          const pick = chosen.get(m.user_id);
          const info = byId.get(m.user_id);
          const label = m.name || m.email;
          return (
            <div key={m.user_id} className="flex items-center gap-2 px-2 py-1.5" data-host={m.email}>
              <input
                type="checkbox"
                checked={!!pick}
                onChange={(e) => toggle(m.user_id, e.target.checked)}
                aria-label={`${label} takes meetings from this link`}
                className="h-3.5 w-3.5 accent-[var(--indigo)]"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body text-[var(--text-primary)]">{label}</p>
                {pick && info && (
                  <p className="truncate text-micro text-[var(--text-tertiary)]">
                    {info.recent_bookings ?? 0} in the last {ROUND_ROBIN_WINDOW_DAYS} days
                  </p>
                )}
              </div>
              {pick && info?.host_paused && (
                <span
                  className="flex flex-shrink-0 items-center gap-1 rounded bg-[var(--bg-elevated)] px-1.5 py-[1px] text-micro text-[var(--text-tertiary)]"
                  title="They have paused themselves on this link. Only they can switch it back."
                >
                  <PauseCircle className="h-3 w-3" /> Away
                </span>
              )}
              {pick && info && info.can_email === false && (
                <span
                  className="flex flex-shrink-0 items-center"
                  title="No mailbox connected: people booked with them get no confirmation email"
                  aria-label="No mailbox connected"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" />
                </span>
              )}
              {pick && strategy === 'priority' && (
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={pick.priority}
                  onChange={(e) => setPriority(m.user_id, Number(e.target.value))}
                  aria-label={`Priority for ${label}`}
                  title="1 is offered first"
                  className="h-7 w-12 flex-shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1 text-center text-body tabular"
                />
              )}
            </div>
          );
        })}
        {members.length === 0 && (
          <p className="px-2 py-2 text-body text-[var(--text-tertiary)]">Nobody on your team has joined yet.</p>
        )}
      </div>

      {value.length > 0 && active.length === 0 && (
        <p className="flex items-start gap-1.5 text-caption text-[var(--warning)]" data-no-active-host>
          <AlertTriangle className="mt-[1px] h-3 w-3 flex-shrink-0" />
          Everyone picked is away, so the page will not take bookings until one of them is back.
        </p>
      )}
    </div>
  );
}

/**
 * The round-robin links somebody hosts, with their own "I am away" switch.
 *
 * Shown on their booking links page only when they are on at least one, so
 * somebody who is not part of a rotation never sees it.
 */
export function HostingCard() {
  const qc = useQueryClient();
  const { data: links = [] } = useQuery({
    queryKey: ['booking-links', 'hosting'],
    queryFn: bookingLinksApi.hosting,
    retry: false,
  });

  const set = useMutation({
    mutationFn: ({ linkId, paused }: { linkId: string; paused: boolean }) =>
      bookingLinksApi.setHostingPaused(linkId, paused),
    onSuccess: (next, { paused }) => {
      qc.setQueryData(['booking-links', 'hosting'], next);
      toast.success(paused ? 'You are out of that rotation for now' : 'You are back in that rotation');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Could not change that'),
  });

  if (links.length === 0) return null;

  return (
    <div className="panel px-4 py-3 mt-4" data-hosting>
      <div className="flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <h2 className="text-strong font-semibold text-[var(--text-primary)]">Team links you take meetings for</h2>
      </div>
      <p className="mt-0.5 text-caption text-[var(--text-tertiary)]">
        Away for a while? Pause yourself and the rest of the team takes your share until you are back.
      </p>
      <div className="mt-2 space-y-1.5">
        {links.map((l) => (
          <div key={l.link_id} className="flex items-center gap-2" data-hosted={l.slug}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body text-[var(--text-primary)]">{l.headline}</p>
              <p className="truncate text-micro text-[var(--text-tertiary)]">
                /b/{l.slug} &middot; run by {l.owner_name}
                {!l.is_active && ' · they have left you out of it for now'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => set.mutate({ linkId: l.link_id, paused: !l.host_paused })}
              disabled={set.isPending}
              className="btn-secondary flex-shrink-0"
              data-pause={l.slug}
            >
              {set.isPending && set.variables?.linkId === l.link_id
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : null}
              {l.host_paused ? 'Resume' : 'Pause me'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

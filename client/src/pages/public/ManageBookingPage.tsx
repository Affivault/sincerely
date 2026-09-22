import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock, Check, Loader2, AlertCircle, Download, CalendarX, CalendarClock, ArrowLeft,
} from 'lucide-react';
import { publicBookingApi, type WireSlot } from '../../api/booking.api';
import { cn } from '../../lib/utils';
import { PublicShell } from './PublicShell';
import { keepPrevious } from '../../lib/listQuery';

/* ═══════════════════════════════════════════════════════════════════════
   Moving or cancelling a booking, without an account.

   The token in the URL is the whole of the authorisation, which means two
   things. It is treated as a secret - never logged, never put in a link
   that leaves the page. And the page has to work for somebody who has
   arrived here from an email six weeks later with no memory of booking
   anything, so it leads with what and when rather than with buttons.
   ═══════════════════════════════════════════════════════════════════════ */

export function ManageBookingPage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'view' | 'move' | 'cancel'>('view');
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<WireSlot | null>(null);

  const booking = useQuery({
    queryKey: ['manage-booking', token],
    queryFn: () => publicBookingApi.byToken(token),
    retry: false,
  });

  const zone = booking.data?.timezone
    || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } })();

  const range = useMemo(() => ({
    from: new Date().toISOString(),
    to: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  }), []);

  const slots = useQuery({
    queryKey: ['manage-booking-slots', token, range.from],
    queryFn: () => publicBookingApi.rescheduleSlots(token, range.from, range.to),
    enabled: mode === 'move',
    retry: false,
    ...keepPrevious,
  });

  const move = useMutation({
    mutationFn: () => publicBookingApi.reschedule(token, picked!.start),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manage-booking'] });
      setMode('view');
      setPicked(null);
    },
  });

  const drop = useMutation({
    mutationFn: () => publicBookingApi.cancel(token, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manage-booking'] });
      setMode('view');
    },
  });

  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', timeZone: zone,
  });
  const fmtLong = (iso: string) => new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zone,
  });

  if (booking.isError) {
    return (
      <PublicShell>
        <div className="text-center py-14" data-state="error">
          <AlertCircle className="h-8 w-8 mx-auto text-[var(--text-tertiary)]" />
          <h1 className="mt-3 text-title font-semibold text-[var(--text-primary)]">
            This link is no longer valid
          </h1>
          <p className="mt-1 text-strong text-[var(--text-secondary)]">
            It may have been used already, or the meeting may have been removed.
          </p>
        </div>
      </PublicShell>
    );
  }

  if (booking.isLoading || !booking.data) {
    return (
      <PublicShell>
        <div className="py-20 flex items-center justify-center text-[var(--text-tertiary)]">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </PublicShell>
    );
  }

  const b = booking.data;
  const cancelled = b.status === 'cancelled';
  const past = new Date(b.start).getTime() < Date.now();

  /* ── Cancelled ── */
  if (cancelled) {
    return (
      <PublicShell>
        <div className="text-center py-10" data-state="cancelled">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-elevated)]">
            <CalendarX className="h-6 w-6 text-[var(--text-tertiary)]" />
          </span>
          <h1 className="mt-4 text-title font-semibold text-[var(--text-primary)]">
            This meeting was cancelled
          </h1>
          <p className="mt-1 text-strong text-[var(--text-secondary)] line-through">
            {fmtLong(b.start)} at {fmtTime(b.start)}
          </p>
          {b.cancel_reason && (
            <p className="mt-2 text-body text-[var(--text-tertiary)]">&ldquo;{b.cancel_reason}&rdquo;</p>
          )}
          {b.slug && (
            <a href={`/b/${b.slug}`} className="btn-primary mt-6 inline-flex">
              Book another time
            </a>
          )}
        </div>
      </PublicShell>
    );
  }

  /* ── Choosing a new time ── */
  if (mode === 'move') {
    const list = slots.data || [];
    const byDay = new Map<string, WireSlot[]>();
    for (const s of list) {
      const key = fmtLong(s.start);
      const arr = byDay.get(key);
      if (arr) arr.push(s); else byDay.set(key, [s]);
    }

    return (
      <PublicShell>
        <button
          onClick={() => { setMode('view'); setPicked(null); move.reset(); }}
          className="flex items-center gap-1 text-body text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <h1 className="mt-3 text-title font-semibold text-[var(--text-primary)]">Pick a new time</h1>
        <p className="mt-0.5 text-body text-[var(--text-tertiary)]">
          {b.duration_minutes} minutes with {b.organiser} &middot; times in {zone.replace(/_/g, ' ')}
        </p>

        {slots.isFetching && (
          <p className="mt-5 flex items-center gap-1.5 text-body text-[var(--text-tertiary)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Looking at the diary&hellip;
          </p>
        )}

        <div className="mt-4 space-y-4 max-h-[400px] overflow-y-auto pr-1" data-slots>
          {[...byDay.entries()].map(([day, times]) => (
            <div key={day}>
              <p className="text-body font-semibold text-[var(--text-primary)]">{day}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {times.map((s) => (
                  <button
                    key={s.start}
                    onClick={() => setPicked(s)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-body tabular transition-colors',
                      picked?.start === s.start
                        ? 'border-[var(--indigo)] bg-[var(--indigo)] text-white'
                        : 'border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-[var(--indigo)]',
                    )}
                  >
                    {fmtTime(s.start)}
                    {new Date(s.start).getTime() === new Date(b.start).getTime() && (
                      <span className="ml-1 opacity-60">now</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!slots.isFetching && list.length === 0 && (
            <p className="text-body text-[var(--text-secondary)]">
              Nothing free in the next month. Leave this one as it is, or cancel and
              get in touch another way.
            </p>
          )}
        </div>

        {move.isError && (
          <p className="mt-3 flex items-start gap-1.5 text-body text-[var(--text-primary)]" data-error>
            <AlertCircle className="h-3.5 w-3.5 mt-[1px] text-[#ef4444]" />
            {(move.error as any)?.response?.data?.error || 'That did not go through.'}
          </p>
        )}

        <button
          onClick={() => move.mutate()}
          disabled={!picked || move.isPending || picked.start === b.start}
          className="btn-primary mt-4 w-full justify-center"
        >
          {move.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Moving&hellip;</>
            : 'Move my meeting'}
        </button>
      </PublicShell>
    );
  }

  /* ── Confirming a cancellation ── */
  if (mode === 'cancel') {
    return (
      <PublicShell>
        <button
          onClick={() => { setMode('view'); drop.reset(); }}
          className="flex items-center gap-1 text-body text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <h1 className="mt-3 text-title font-semibold text-[var(--text-primary)]">
          Cancel this meeting?
        </h1>
        <p className="mt-1 text-strong text-[var(--text-secondary)]">
          {fmtLong(b.start)} at {fmtTime(b.start)}
        </p>
        <label className="mt-4 block">
          <span className="text-body font-medium text-[var(--text-primary)]">
            Anything you want to say? <span className="text-[var(--text-tertiary)]">Optional</span>
          </span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Something came up."
            className="input-field mt-1 w-full resize-none"
          />
        </label>
        {drop.isError && (
          <p className="mt-3 text-body text-[#ef4444]" data-error>
            {(drop.error as any)?.response?.data?.error || 'That did not go through.'}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button onClick={() => setMode('view')} className="btn-secondary flex-1 justify-center">
            Keep it
          </button>
          <button
            onClick={() => drop.mutate()}
            disabled={drop.isPending}
            className="btn-danger flex-1 justify-center"
          >
            {drop.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cancelling&hellip;</>
              : 'Cancel meeting'}
          </button>
        </div>
      </PublicShell>
    );
  }

  /* ── The booking itself ── */
  return (
    <PublicShell>
      <div data-state="confirmed">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--indigo-subtle,var(--bg-elevated))]">
          <Check className="h-5 w-5 text-[var(--indigo)]" />
        </span>
        <h1 className="mt-3 text-title font-semibold text-[var(--text-primary)]">{b.headline}</h1>
        <p className="mt-0.5 text-body text-[var(--text-tertiary)]">with {b.organiser}</p>

        <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5">
          <p className="text-strong font-medium text-[var(--text-primary)]">{fmtLong(b.start)}</p>
          <p className="mt-0.5 flex items-center gap-1 text-body text-[var(--text-secondary)]">
            <Clock className="h-3.5 w-3.5" />
            {fmtTime(b.start)} &ndash; {fmtTime(b.end)}
            <span className="text-[var(--text-tertiary)]">&middot; {zone.replace(/_/g, ' ')}</span>
          </p>
        </div>

        {past ? (
          <p className="mt-4 text-body text-[var(--text-tertiary)]">
            This meeting has already happened.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={publicBookingApi.icsUrl(token)} className="btn-secondary">
                <Download className="h-3.5 w-3.5" /> Add to calendar
              </a>
              <button onClick={() => setMode('move')} className="btn-secondary">
                <CalendarClock className="h-3.5 w-3.5" /> Move it
              </button>
              <button onClick={() => setMode('cancel')} className="btn-ghost text-[#ef4444]">
                <CalendarX className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>
            <p className="mt-3 text-caption text-[var(--text-tertiary)]">
              Booked as {b.invitee_name} &middot; {b.invitee_email}
            </p>
          </>
        )}
      </div>
    </PublicShell>
  );
}

